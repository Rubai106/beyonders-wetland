"""Independent optical cross-check for NISAR open-water change candidates.

HLS is used only as a date-matched reference layer. It never drives the NISAR
classification. The reported scores are cross-sensor agreement on common clear
pixels, not field-measured accuracy or ground truth.
"""
from network_retry import remote_call
from datetime import date, datetime, timedelta
import logging
import re
import hashlib
import json
import os
import uuid
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import from_bounds, Window
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

from raster_utils import area_km2


class ReferenceUnavailable(RuntimeError):
    """Raised when CMR has no usable date-matched HLS pair."""


def _identity(granule):
    title = granule.get("umm", {}).get("GranuleUR", "")
    match = re.fullmatch(r"HLS\.(S30|L30)\.(T[^.]+)\.(\d{7}T\d{6})\.v2\.0", title)
    if not match:
        return None
    acquired = datetime.strptime(match.group(3), "%Y%jT%H%M%S")
    return {"product": match.group(1), "tile": match.group(2), "date": acquired.date(), "timestamp": acquired,
            "granule_id": title}


def _scene_bands(granule):
    identity = _identity(granule)
    if identity is None:
        raise ReferenceUnavailable("Unrecognized HLS S30/L30 scene.")
    # NASA's harmonized green/SWIR1 matchup is S30 B03/B11 and L30 B03/B06.
    return "B03", "B06" if identity["product"] == "L30" else "B11", "Fmask"


def _footprint(granule):
    polygons = []
    domains = (granule.get("umm", {}).get("SpatialExtent", {})
               .get("HorizontalSpatialDomain", {}).get("Geometry", {}).get("GPolygons", []))
    for item in domains:
        points = item.get("Boundary", {}).get("Points", [])
        coords = [(point["Longitude"], point["Latitude"]) for point in points
                  if "Longitude" in point and "Latitude" in point]
        if len(coords) >= 4:
            polygon = Polygon(coords)
            if polygon.is_valid and not polygon.is_empty:
                polygons.append(polygon)
    return unary_union(polygons) if polygons else None


def _common_tile_pairs(granules, baseline_date, event_date, tolerance_days, boundary):
    before = {}
    after = {}
    for granule in granules:
        identity = _identity(granule)
        if identity is None:
            continue
        footprint = _footprint(granule)
        if footprint is not None and not footprint.intersects(boundary):
            continue
        identity["granule"] = granule
        identity["overlap"] = (footprint.intersection(boundary).area / boundary.area
                               if footprint is not None and boundary.area else 0.0)
        baseline_offset = abs((identity["date"] - baseline_date).days)
        event_offset = abs((identity["date"] - event_date).days)
        if baseline_offset <= tolerance_days:
            before.setdefault(identity["tile"], []).append((baseline_offset, identity))
        if event_offset <= tolerance_days:
            after.setdefault(identity["tile"], []).append((event_offset, identity))

    pairs = []
    for tile in before.keys() & after.keys():
        for before_offset, first in before[tile]:
            for after_offset, second in after[tile]:
                if second["timestamp"] <= first["timestamp"]:
                    continue
                if all(any(urlparse(link).path.lower().endswith(f".{band.lower()}.tif")
                           for link in scene["granule"].data_links())
                       for scene in (first, second) for band in _scene_bands(scene["granule"])):
                    pairs.append((min(first["overlap"], second["overlap"]),
                                  before_offset + after_offset, tile, first, second))
    if not pairs:
        raise ReferenceUnavailable("No overlapping HLS S30/L30 scenes match both NISAR dates within the configured time tolerance.")
    pairs.sort(key=lambda item: (-item[0], item[1], item[2], item[3]["granule_id"], item[4]["granule_id"]))
    return [(item[3], item[4]) for item in pairs]


def _common_tile_pair(granules, baseline_date, event_date, tolerance_days, boundary):
    return _common_tile_pairs(granules, baseline_date, event_date, tolerance_days, boundary)[0]


def _best_clear_pair(pairs, target_profile, boundary_bounds, study_valid, maximum_pairs=16, loader=None, progress=None):
    """Select by independent clear coverage, never by agreement with detections."""
    loader = loader or _read_hls_scene
    cache, attempts, best = {}, [], None
    selected_pairs = pairs[:maximum_pairs]
    for pair_index, (first, second) in enumerate(selected_pairs, 1):
        if progress:
            progress(f"Reading optical reference pair {pair_index}/{len(selected_pairs)}: {first['date']} to {second['date']}")
        try:
            for scene in (first, second):
                key = scene["granule_id"]
                if key not in cache:
                    loaded = loader(scene["granule"], target_profile, boundary_bounds)
                    cache[key] = loaded
            before_loaded = cache[first["granule_id"]]
            after_loaded = cache[second["granule_id"]]
            before, before_valid = before_loaded[:2]
            after, after_valid = after_loaded[:2]
            before_native = before_loaded[2] if len(before_loaded) > 2 else None
            after_native = after_loaded[2] if len(after_loaded) > 2 else None
            clear = study_valid & before_valid & after_valid & np.isfinite(before) & np.isfinite(after)
            pixels = int(clear.sum())
            attempts.append({"baseline_scene": first["granule_id"], "event_scene": second["granule_id"],
                             "baseline_clear_pixels": int((study_valid & before_valid & np.isfinite(before)).sum()),
                             "event_clear_pixels": int((study_valid & after_valid & np.isfinite(after)).sum()),
                             "common_clear_pixels": pixels, "status": "READ"})
            logging.info("HLS pair checked: %s / %s, %s common clear pixels", first.get("date", "unknown"), second.get("date", "unknown"), pixels)
            if best is None or pixels > best[0]:
                best = (pixels, first, second, before, before_valid, after, after_valid, before_native, after_native)
        except Exception as error:
            attempts.append({"baseline_scene": first["granule_id"], "event_scene": second["granule_id"],
                             "status": "UNAVAILABLE", "error_type": type(error).__name__})
            logging.warning("HLS pair unavailable (%s): %s / %s", type(error).__name__, first.get("date", "unknown"), second.get("date", "unknown"))
    if best is None:
        raise ReferenceUnavailable("None of the date-matched HLS pairs could be read.")
    return best[1:], attempts


def _band_url(granule, band):
    suffix = f".{band.lower()}.tif"
    matches = [link for link in granule.data_links()
               if urlparse(link).path.lower().endswith(suffix)]
    if len(matches) != 1:
        raise ReferenceUnavailable(f"HLS granule does not expose one {band} layer.")
    return matches[0]


def _read_hls_qa(granule, target_profile, boundary_bounds, cache_dir=None):
    """Screen cloud coverage cheaply, without fetching spectral bands."""
    import earthaccess
    identity = _identity(granule)
    if identity is None:
        raise ReferenceUnavailable("Unrecognized HLS quality scene.")
    signature = {"scene": identity["granule_id"], "crs": str(target_profile["crs"]),
                 "transform": list(target_profile["transform"]), "height": target_profile["height"],
                 "width": target_profile["width"], "bounds": list(boundary_bounds)}
    key = hashlib.sha256(json.dumps(signature, sort_keys=True).encode()).hexdigest()
    cached = Path(cache_dir)/f"{key}.npz" if cache_dir else None
    if cached and cached.is_file():
        with np.load(cached, allow_pickle=False) as saved:
            values = saved["qa"]
        if values.shape == (target_profile["height"], target_profile["width"]) and values.dtype == np.uint8:
            return values
    handles = remote_call(lambda: earthaccess.open([_band_url(granule, "Fmask")], show_progress=False))
    if len(handles) != 1:
        raise ReferenceUnavailable("HLS quality mask could not be opened.")
    try:
        with rasterio.open(handles[0]) as source:
            if source.crs is None or source.count != 1:
                raise ReferenceUnavailable("HLS quality mask has no georeferencing.")
            projected = transform_bounds("EPSG:4326", source.crs, *boundary_bounds, densify_pts=21)
            window = from_bounds(*projected, source.transform).round_offsets().round_lengths()
            window = window.intersection(Window(0, 0, source.width, source.height))
            native = source.read(1, window=window, masked=True).astype("uint8").filled(255)
            values = np.full((target_profile["height"], target_profile["width"]), 255, dtype="uint8")
            reproject(native, values, src_transform=source.window_transform(window), src_crs=source.crs,
                      dst_transform=target_profile["transform"], dst_crs=target_profile["crs"],
                      src_nodata=255, dst_nodata=255, resampling=Resampling.nearest)
    finally:
        handles[0].close()
    if cached:
        cached.parent.mkdir(parents=True, exist_ok=True)
        temporary = cached.with_name(f"{key}.{os.getpid()}.{uuid.uuid4().hex}.partial.npz")
        try:
            np.savez_compressed(temporary, qa=values)
            os.replace(temporary, cached)
        finally:
            temporary.unlink(missing_ok=True)
    return values


def _qa_clear(qa):
    return (qa != 255) & ((qa & 30) == 0) & (((qa >> 6) & 3) < 3)


def area_supported_metrics(radar_candidates, radar_valid, study_mask, radar_profile,
                           before_native, after_native, threshold):
    """Compare radar area support to native HLS cells without upsampling optical labels.

    Radar candidate/valid fractions are area-averaged onto the native HLS grid. Confusion
    areas then use those fractions as weights, so a 30 m optical pixel is counted once
    with partial radar support instead of being replicated across finer radar pixels.
    """
    native = before_native
    if (native is None or after_native is None or native["index"].shape != after_native["index"].shape or
            native["crs"] != after_native["crs"] or native["transform"] != after_native["transform"]):
        raise ReferenceUnavailable("Native HLS grids are not aligned for area-supported comparison.")
    shape_native = native["index"].shape

    def average_to_hls(values):
        destination = np.zeros(shape_native, dtype="float32")
        reproject(values.astype("float32"), destination,
            src_transform=radar_profile["transform"], src_crs=radar_profile["crs"],
            dst_transform=native["transform"], dst_crs=native["crs"],
            # Zero is a measured absence of valid/candidate/study area, not NoData.
            # Preserve those zeros instead of asking GDAL to replace them with
            # the smallest positive float during average resampling.
            src_nodata=None, dst_nodata=None, init_dest_nodata=False,
            resampling=Resampling.average)
        return np.clip(destination, 0, 1)

    valid_fraction = average_to_hls(radar_valid)
    candidate_fraction = average_to_hls(radar_candidates)
    study_fraction = average_to_hls(study_mask)
    candidate_share = np.divide(candidate_fraction, valid_fraction, out=np.zeros_like(candidate_fraction), where=valid_fraction > 0)
    candidate_share = np.clip(candidate_share, 0, 1)
    common = (before_native["valid"] & after_native["valid"] &
              np.isfinite(before_native["index"]) & np.isfinite(after_native["index"]) &
              (study_fraction > 0) & (valid_fraction > 0))
    optical_change = common & (after_native["index"] > threshold) & (before_native["index"] <= threshold)
    weight = np.where(common, valid_fraction, 0).astype("float64")
    optical = optical_change.astype("float64")
    radar = candidate_share.astype("float64")
    transform = native["transform"]
    pixel = Polygon([transform @ (0,0), transform @ (1,0), transform @ (1,1), transform @ (0,1)])
    pixel_area = area_km2(pixel, native["crs"])
    tp = float(np.sum(weight * radar * optical, dtype="float64") * pixel_area)
    fp = float(np.sum(weight * radar * (1-optical), dtype="float64") * pixel_area)
    fn = float(np.sum(weight * (1-radar) * optical, dtype="float64") * pixel_area)
    numerical_floor = max(pixel_area * 1e-10, 1e-15)
    tp = 0.0 if abs(tp) < numerical_floor else tp
    fp = 0.0 if abs(fp) < numerical_floor else fp
    fn = 0.0 if abs(fn) < numerical_floor else fn
    common_area = float(np.sum(weight, dtype="float64") * pixel_area)
    study_area = float(np.sum(study_fraction, dtype="float64") * pixel_area)
    candidate_area = float(np.sum(weight * radar, dtype="float64") * pixel_area)
    candidate_area_in_footprint = float(np.sum(candidate_fraction, dtype="float64") * pixel_area)
    candidate_area_assessed = float(np.sum(candidate_fraction * common, dtype="float64") * pixel_area)
    optical_area = float(np.sum(weight * optical, dtype="float64") * pixel_area)
    f1_denominator = 2*tp + fp + fn
    union = tp + fp + fn
    return {
        "support": "native HLS 30 m cells with area-averaged NISAR valid/candidate fractions",
        "resampling": "area-weighted average from native GCOV grid to HLS grid",
        "native_hls_pixels_assessed": int(common.sum()),
        "hls_pixel_area_km2": pixel_area,
        "study_area_km2": study_area,
        "common_clear_area_km2": common_area,
        "common_clear_fraction": common_area/study_area if study_area else 0.0,
        "radar_candidate_area_km2": candidate_area,
        "radar_candidate_area_in_hls_footprint_km2": candidate_area_in_footprint,
        "candidate_assessed_area_km2": candidate_area_assessed,
        "candidate_assessed_fraction": candidate_area_assessed/candidate_area_in_footprint if candidate_area_in_footprint else None,
        "optical_new_water_area_km2": optical_area,
        "true_positive_area_km2": tp, "false_positive_area_km2": fp,
        "false_negative_area_km2": fn,
        "precision": tp/(tp+fp) if tp+fp else None,
        "recall": tp/(tp+fn) if tp+fn else None,
        "f1": 2*tp/f1_denominator if f1_denominator else None,
        "intersection_over_union": tp/union if union else None,
    }


def _read_hls_scene(granule, target_profile, boundary_bounds, details=False, cache_dir=None, return_native=False):
    import earthaccess

    arrays = {}
    source_profile = None
    handles = []
    try:
        green_band, swir_band, qa_band = _scene_bands(granule)
        bands = (green_band, swir_band, qa_band, "B04", "B02") if details else (green_band, swir_band, qa_band)
        for band in bands:
            signature = json.dumps({"scene": _identity(granule)["granule_id"], "band": band, "bounds": list(boundary_bounds)}, sort_keys=True)
            key = hashlib.sha256(signature.encode()).hexdigest()
            cached = Path(cache_dir)/f"{key}.tif" if cache_dir else None
            if cached and cached.is_file():
                handle = cached
            else:
                opened = remote_call(lambda: earthaccess.open([_band_url(granule, band)], show_progress=False))
                if len(opened) != 1:
                    raise ReferenceUnavailable(f"HLS {band} layer could not be opened.")
                handle = opened[0]
                handles.append(handle)
            with rasterio.open(handle) as source:
                if source.crs is None or source.count != 1:
                    raise ReferenceUnavailable(f"HLS {band} layer lacks a single georeferenced band.")
                left, bottom, right, top = transform_bounds(
                    "EPSG:4326", source.crs, *boundary_bounds, densify_pts=21)
                full = Window(0, 0, source.width, source.height)
                window = full if isinstance(handle, Path) else from_bounds(left, bottom, right, top, source.transform).round_offsets().round_lengths().intersection(full)
                if window.width <= 0 or window.height <= 0:
                    raise ReferenceUnavailable("Selected HLS footprint does not cover the study boundary.")
                masked = source.read(1, window=window, masked=True)
                arrays[band] = {"values": np.asarray(masked.filled(0)),
                                "valid": (~np.ma.getmaskarray(masked)).astype("uint8"),
                                "profile": source.profile.copy(),
                                "transform": source.window_transform(window)}
                if cached and not cached.is_file():
                    cached.parent.mkdir(parents=True, exist_ok=True)
                    saved_profile = source.profile.copy()
                    saved_profile.update(width=masked.shape[1], height=masked.shape[0], transform=source.window_transform(window), compress="deflate")
                    temporary = cached.with_name(f"{key}.{uuid.uuid4().hex}.partial.tif")
                    try:
                        with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True):
                            with rasterio.open(temporary, "w", **saved_profile) as saved:
                                saved.write(masked.filled(source.nodata if source.nodata is not None else 0), 1)
                                saved.write_mask((~np.ma.getmaskarray(masked)).astype("uint8") * 255)
                        os.replace(temporary, cached)
                    finally:
                        temporary.unlink(missing_ok=True)
                current = arrays[band]
                if source_profile is None:
                    source_profile = current
                elif (current["profile"]["crs"] != source_profile["profile"]["crs"] or
                      current["values"].shape != source_profile["values"].shape or
                      not current["transform"].almost_equals(source_profile["transform"], precision=1e-8)):
                    raise ReferenceUnavailable("HLS spectral and QA layers are not on the same grid.")
    finally:
        for handle in handles:
            handle.close()

    green = arrays[green_band]["values"].astype("float32")
    swir = arrays[swir_band]["values"].astype("float32")
    qa = arrays["Fmask"]["values"].astype("int16") & 0xFF
    # HLS v2 QA bit 1 cloud, 2 cloud/shadow adjacency, 3 shadow, 4 snow/ice.
    # Bit 5 is Fmask water and is not used by the MNDWI rule; bits 6-7 encode
    # aerosol level, with 11 representing high aerosol optical thickness.
    bad_qa = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4)
    valid = (arrays[green_band]["valid"].astype(bool) & arrays[swir_band]["valid"].astype(bool) &
             arrays["Fmask"]["valid"].astype(bool) & ((qa & bad_qa) == 0) &
             (((qa >> 6) & 0b11) < 0b11) &
             (green > -9999) & (swir > -9999) & (green < 12000) & (swir < 12000))
    denominator = green + swir
    valid &= np.isfinite(denominator) & (denominator > 0)
    index = np.full(green.shape, np.nan, dtype="float32")
    index[valid] = ((green[valid] - swir[valid]) / denominator[valid]).astype("float32")

    height, width = target_profile["height"], target_profile["width"]
    target_index = np.full((height, width), np.nan, dtype="float32")
    target_valid = np.zeros((height, width), dtype="uint8")
    common = {"src_transform": arrays["B03"]["transform"],
              "src_crs": arrays["B03"]["profile"]["crs"],
              "dst_transform": target_profile["transform"],
              "dst_crs": target_profile["crs"]}
    reproject(index, target_index, src_nodata=np.nan, dst_nodata=np.nan,
              resampling=Resampling.bilinear, **common)
    reproject(valid.astype("uint8"), target_valid, src_nodata=0, dst_nodata=0,
              resampling=Resampling.nearest, **common)
    native_result = {"index": index, "valid": valid,
                     "crs": source_profile["profile"]["crs"],
                     "transform": arrays[green_band]["transform"],
                     "shape": list(index.shape)}
    if not details:
        result = (target_index, target_valid.astype(bool))
        return (*result, native_result) if return_native else result
    nearest_index = np.full((height, width), np.nan, dtype="float32")
    reproject(index, nearest_index, src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.nearest, **common)
    target_qa = np.full((height, width), 255, dtype="uint8")
    native_qa = arrays["Fmask"]["values"].astype("uint8").copy()
    native_qa[arrays["Fmask"]["valid"] == 0] = 255
    reproject(native_qa, target_qa, src_nodata=255, dst_nodata=255,
              resampling=Resampling.nearest, **common)
    rgb = []
    for band in ("B04", "B03", "B02"):
        values = arrays[band]["values"].astype("float32") * .0001
        values[arrays[band]["valid"] == 0] = np.nan
        target = np.full((height, width), np.nan, dtype="float32")
        reproject(values, target, src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.bilinear, **common)
        rgb.append(target)
    return {"index": target_index, "valid": target_valid.astype(bool), "nearest_index": nearest_index,
            "rgb": np.stack(rgb), "qa": target_qa,
            "native": native_result,
            "source_crs": str(source_profile["profile"]["crs"]), "source_transform": list(source_profile["transform"]),
            "source_shape": list(source_profile["values"].shape)}


def validate_hls_open_water(config, baseline_date, event_date, site_boundary_path,
                            baseline_hh_path, event_raster_paths, classification_path,
                            wetland_mask_path, progress=None, baseline_observation_dates=None):
    """Compare NISAR open-water change with date-paired HLS MNDWI water change."""
    import earthaccess

    baseline_dates = sorted(set(baseline_observation_dates or [baseline_date]))
    baseline_days = sorted(date.fromisoformat(item) for item in baseline_dates)
    if len(baseline_days) % 2:
        baseline_day = baseline_days[len(baseline_days)//2]
    else:
        baseline_day = baseline_days[0] + (baseline_days[-1]-baseline_days[0]) // 2
    event_day = date.fromisoformat(event_date)
    tolerance = int(config["validation"]["date_tolerance_days"])
    bounds = config["site"]["bbox"]
    bbox = tuple(float(bounds[key]) for key in ("min_lon", "min_lat", "max_lon", "max_lat"))
    start = min(baseline_day, event_day) - timedelta(days=tolerance)
    end = max(baseline_day, event_day) + timedelta(days=tolerance)
    products = config["validation"].get("reference_products", [config["validation"]["reference_product"]])
    granules, searches = [], []
    for product in products:
        if product not in ("HLSS30", "HLSL30"):
            raise ValueError("Reference collections must be HLSS30 or HLSL30.")
        try:
            found = earthaccess.search_data(short_name=product, bounding_box=bbox,
                temporal=(start.isoformat(), end.isoformat()), count=200)
            granules.extend(found)
            searches.append({"collection": product, "records": len(found), "limit_reached": len(found) >= 200, "status": "SEARCHED"})
        except Exception as error:
            searches.append({"collection": product, "status": "UNAVAILABLE", "error_type": type(error).__name__})
    with open(site_boundary_path, encoding="utf-8") as handle:
        boundary_doc = __import__("json").load(handle)
    boundary_parts = [shape(feature["geometry"]) for feature in boundary_doc.get("features", [])
                      if feature.get("geometry")]
    if not boundary_parts:
        raise ReferenceUnavailable("Study boundary is missing; HLS cross-check cannot be placed.")
    boundary = unary_union(boundary_parts)
    pairs = _common_tile_pairs(granules, baseline_day, event_day, tolerance, boundary)

    with rasterio.open(classification_path) as classification:
        if classification.crs is None:
            raise ReferenceUnavailable("NISAR classification has no CRS for reference alignment.")
        target_profile = classification.profile.copy()
        nisar_grid = classification.read(1)
    with rasterio.open(wetland_mask_path) as mask_source:
        wetland = mask_source.read(1) == 1
        if (mask_source.crs != target_profile["crs"] or wetland.shape != nisar_grid.shape or
                not mask_source.transform.almost_equals(target_profile["transform"], precision=1e-8)):
            raise ReferenceUnavailable("Wetland mask and NISAR class grid do not align.")

    from raster_utils import read_rasters
    nisar_inputs, _ = read_rasters([baseline_hh_path, *event_raster_paths])
    nisar_valid = np.logical_and.reduce([np.isfinite(values) for values in nisar_inputs])
    native_loader = lambda granule, profile, bounds: _read_hls_scene(granule, profile, bounds, return_native=True)
    best, attempts = _best_clear_pair(pairs, target_profile, boundary.bounds, wetland & nisar_valid,
                                     maximum_pairs=int(config["validation"].get("maximum_reference_pairs", 16)),
                                     loader=native_loader, progress=progress)
    first, second, hls_before, hls_before_valid, hls_after, hls_after_valid, hls_before_native, hls_after_native = best
    common = wetland & nisar_valid & hls_before_valid & hls_after_valid & np.isfinite(hls_before) & np.isfinite(hls_after)
    study_pixels = int(wetland.sum())
    common_pixels = int(common.sum())
    clear_coverage = common_pixels / study_pixels if study_pixels else 0.0
    threshold = float(config["validation"]["mndwi_water_threshold"])
    optical_change = common & (hls_after > threshold) & (hls_before <= threshold)
    nisar_change = common & (nisar_grid == 1)
    tp = int(np.count_nonzero(nisar_change & optical_change))
    fp = int(np.count_nonzero(nisar_change & ~optical_change))
    fn = int(np.count_nonzero(~nisar_change & optical_change))
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1_denominator = 2 * tp + fp + fn
    f1 = 2 * tp / f1_denominator if f1_denominator else None
    union = tp + fp + fn
    iou = tp / union if union else None
    minimum_coverage = float(config["validation"]["minimum_clear_coverage"])
    minimum_pixels = int(config["validation"]["minimum_comparison_pixels"])
    native_support = area_supported_metrics(nisar_grid == 1, nisar_valid, wetland, target_profile,
                                            hls_before_native, hls_after_native, threshold)
    enough_reference = (native_support["common_clear_fraction"] >= minimum_coverage and
                        native_support["common_clear_area_km2"] >= minimum_pixels * native_support["hls_pixel_area_km2"])
    has_positive_classes = (native_support["true_positive_area_km2"] + native_support["false_positive_area_km2"] > 0 and
                            native_support["true_positive_area_km2"] + native_support["false_negative_area_km2"] > 0)
    status = "CROSS_SENSOR_CHECK" if enough_reference and has_positive_classes else "INCONCLUSIVE"
    reason = None
    if not enough_reference:
        reason = "Too few co-registered, cloud-free pixels overlap the wetland mask for a useful check."
    elif not has_positive_classes:
        reason = "One of the two change layers has no open-water change pixels; precision/recall cannot be interpreted."

    transform = target_profile["transform"]
    from shapely.geometry import Polygon
    pixel = Polygon([transform @ (0, 0), transform @ (1, 0),
                     transform @ (1, 1), transform @ (0, 1)])
    pixel_area = area_km2(pixel, target_profile["crs"])
    used_products = sorted({first["product"], second["product"]})
    reference_label = ("NASA HLS S30 v2.0 (Sentinel-2 surface reflectance)" if used_products == ["S30"]
                       else "NASA HLS L30 v2.0 (Landsat surface reflectance)" if used_products == ["L30"]
                       else "NASA HLS v2.0 (Landsat L30 + Sentinel-2 S30 surface reflectance)")
    return {
        "status": status,
        # This flag means the comparison could be computed, not that the detector
        # has been validated against field truth or an authoritative flood map.
        "reference_validated": False,
        "cross_sensor_check_completed": status == "CROSS_SENSOR_CHECK",
        "site": config["site"]["name"],
        "reference_product": reference_label,
        "reference_product_short_name": ", ".join(products),
        "source_url": "https://hls.gsfc.nasa.gov/data-products/",
        "selection": {"method": "Maximum common cloud-free study-area coverage; ties favor closer dates. Detection agreement is not used for selection.",
                      "date_tolerance_days": tolerance, "available_pairs": len(pairs),
                      "evaluated_pairs": len(attempts), "attempts": attempts, "catalog_searches": searches},
        "comparison": {
            "baseline": {"nisar_date": baseline_day.isoformat(), "nisar_observation_dates": baseline_dates,
                         "nisar_method": "per-pixel median of preceding GCOV observations" if len(baseline_dates) > 1 else "single preceding GCOV observation",
                         "hls_date": first["date"].isoformat(),
                         "offset_days": (first["date"] - baseline_day).days,
                         "scene": first["granule_id"], "product": first["product"]},
            "event": {"nisar_date": event_day.isoformat(), "hls_date": second["date"].isoformat(),
                      "offset_days": (second["date"] - event_day).days,
                      "scene": second["granule_id"], "product": second["product"]},
            "hls_tile": first["tile"],
            "spatial_resolution_m": 30,
            "mndwi_threshold": threshold,
            "qa_mask": "HLS v2 Fmask: cloud, adjacent-to-cloud/shadow, cloud shadow, snow/ice, and high aerosol",
            "evaluated_class": "OPEN_WATER",
            "vegetated_inundation_checked": False,
        },
        "coverage": {"study_area_valid_pixels": study_pixels, "common_clear_pixels": common_pixels,
                     "common_clear_fraction": clear_coverage,
                     "common_clear_area_km2": common_pixels * pixel_area,
                     "minimum_clear_fraction_for_check": minimum_coverage},
        "metrics": {"true_positive_pixels": tp, "false_positive_pixels": fp,
                    "false_negative_pixels": fn, "precision": precision,
                    "recall": recall, "f1": f1, "intersection_over_union": iou},
        "radar_grid_metrics": {"note": "Legacy aligned radar-grid counts retained for reproducibility; finer radar pixels are not independent HLS samples.",
                    "true_positive_pixels": tp, "false_positive_pixels": fp, "false_negative_pixels": fn,
                    "precision": precision, "recall": recall, "f1": f1, "intersection_over_union": iou},
        "optical_support": native_support,
        "reason": reason,
        "limitations": [
            "This is a cross-sensor agreement check, not field truth or a formal accuracy estimate.",
            "HLS dates may differ from NISAR dates by the offsets shown; water can change between acquisitions.",
            "Clouds and HLS's 30 m pixels reduce comparable coverage relative to the NISAR grid.",
            "Pixels flagged with high aerosol optical thickness are excluded; lower aerosol levels can still affect reflectance.",
            "MNDWI can miss flooded vegetation, turbid water, and mixed shoreline pixels.",
            "S30/L30 bands are harmonized, but residual sensor and atmospheric differences can affect mixed-sensor pairs.",
            "Only open-water candidates are evaluated; vegetated-inundation candidates are not validated.",
        ],
    }

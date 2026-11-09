"""Run a safe, offline fake-data pipeline by default. Real access is explicit."""
from network_retry import remote_call
import argparse
import json
import logging
import math
import os
import re
import shutil
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import rasterio
from rasterio.features import rasterize, shapes
from rasterio.warp import transform_geom
from shapely.geometry import shape
from shapely.ops import unary_union
import yaml

from raster_utils import atomic_json, area_km2, read_rasters, write_temporal_median
from extract_gcov import extract_polarization_to_tiff, extract_quality_layers_to_tiff
from preprocess import apply_masks
from detect_inundation import process_inundation
from spatial_analysis import run_spatial_analysis
from validation import validate_patches
from temporal_analysis import generate_temporal_data
from threshold_sensitivity import run_sensitivity_sweep
from generate_outputs import consolidate_outputs
from hls_reference import validate_hls_open_water

ROOT = Path(__file__).resolve().parent


def _login_earthdata():
    import earthaccess
    from requests.exceptions import ConnectionError as RequestConnectionError, Timeout as RequestTimeout

    for attempt in range(3):
        try:
            if os.environ.get("BEYONDERS_WEB_JOB"):
                strategy = "environment" if os.environ.get("EARTHDATA_TOKEN") or os.environ.get("EARTHDATA_USERNAME") else "netrc"
                auth = earthaccess.login(strategy=strategy)
            else:
                auth = earthaccess.login()
            break
        except (RequestConnectionError, RequestTimeout) as exc:
            if attempt == 2:
                raise RuntimeError(
                    "Could not connect to NASA Earthdata Login (urs.earthdata.nasa.gov:443) "
                    "after three attempts. Check the connection in this terminal and rerun the "
                    "pipeline; the previous completed run remains available."
                ) from exc
            logging.warning("Earthdata Login connection failed; retrying (%s/3): %s", attempt + 1, exc)
            time.sleep(2 ** attempt)
    if not auth.authenticated:
        raise RuntimeError("Configure a NASA Earthdata Login in the local terminal before processing.")


def load_config(config_path=None):
    with open(config_path or ROOT/"config.yaml", encoding="utf-8") as handle:
        config = yaml.safe_load(handle)
    if not isinstance(config, dict):
        raise ValueError("Config must be a mapping.")
    cfg = config["processing"]
    if int(cfg["minimum_region_pixels"]) < 1 or not 0 <= float(cfg["minimum_valid_fraction"]) <= 1:
        raise ValueError("Invalid region size or valid fraction.")
    if not .5 <= float(cfg["base_threshold_db"]) <= 5:
        raise ValueError("Base threshold must be within the 0.5–5 dB sensitivity sweep.")
    if float(cfg["vegetated_delta_hv_max"]) < 0:
        raise ValueError("HV stability threshold cannot be negative.")
    if not all(math.isfinite(float(cfg[key])) for key in ("vegetated_delta_hv_max", "open_water_delta_hh", "vegetated_delta_hh")):
        raise ValueError("Signal thresholds must be finite.")
    if float(cfg["open_water_delta_hh"]) >= 0 or float(cfg["vegetated_delta_hh"]) <= 0:
        raise ValueError("Water cutoff must be negative and vegetation cutoff positive.")
    validation = config.get("validation", {})
    if validation.get("use_reference"):
        if not isinstance(validation.get("reference_product"), str) or not validation["reference_product"]:
            raise ValueError("Reference validation requires a NASA HLS collection name.")
        products = validation.get("reference_products", [validation["reference_product"]])
        if not isinstance(products, list) or not products or any(item not in ("HLSS30", "HLSL30") for item in products):
            raise ValueError("Reference collections must be a nonempty list of HLSS30/HLSL30.")
        if not 1 <= int(validation.get("maximum_reference_pairs", 16)) <= 256:
            raise ValueError("Maximum reference pairs must be between 1 and 256.")
        if int(validation.get("date_tolerance_days", 0)) < 0:
            raise ValueError("Reference date tolerance cannot be negative.")
        if not 0 <= float(validation.get("minimum_clear_coverage", -1)) <= 1:
            raise ValueError("Minimum reference coverage must be between 0 and 1.")
        if int(validation.get("minimum_comparison_pixels", 0)) < 1:
            raise ValueError("Minimum reference comparison pixels must be positive.")
        if not math.isfinite(float(validation.get("mndwi_water_threshold", math.nan))):
            raise ValueError("MNDWI water threshold must be finite.")
    if config["nisar"]["preferred_polarizations"] != ["HHHH", "HVHV"]:
        raise ValueError("This workflow requires HHHH and HVHV diagonal power terms.")
    return config


def _real_inputs(config, run):
    # Nodata is excluded during extraction. An optional quality mask may be
    # supplied, while the sourced wetland boundary is rasterized to each scene grid.
    masks = config.get("masks", {})
    quality = ROOT/masks["quality"] if masks.get("quality") else None
    if quality is not None and not quality.is_file():
        raise FileNotFoundError("Configured quality mask not found.")
    boundary = config["site"].get("boundary")
    if not boundary or not (ROOT/boundary).is_file():
        raise FileNotFoundError("Real mode requires the configured study-area boundary GeoJSON.")
    boundary_path = ROOT/boundary
    with open(boundary_path, encoding="utf-8") as handle:
        boundary_data = json.load(handle)
    boundary_features = boundary_data.get("features") if isinstance(boundary_data, dict) else None
    boundary_geometries = [feature.get("geometry") for feature in boundary_features or []
                           if isinstance(feature, dict) and feature.get("geometry")]
    if not boundary_geometries:
        raise ValueError("Study-area boundary GeoJSON contains no polygon geometry.")
    polygons = [shape(geometry) for geometry in boundary_geometries]
    if any(polygon.geom_type not in ("Polygon", "MultiPolygon") or polygon.is_empty or not polygon.is_valid
           for polygon in polygons):
        raise ValueError("Study-area boundary must contain valid Polygon or MultiPolygon features.")
    boundary_bounds = [min(p.bounds[0] for p in polygons), min(p.bounds[1] for p in polygons),
                       max(p.bounds[2] for p in polygons), max(p.bounds[3] for p in polygons)]
    from search_nisar import search_scenes, select_compatible_series
    import earthaccess
    results = search_scenes(config)
    selected_names = config["nisar"].get("selected_scene_names")
    if selected_names:
        results = [item for item in results if item.get("umm", {}).get("GranuleUR") in selected_names]
        if {item.get("umm", {}).get("GranuleUR") for item in results} != set(selected_names):
            raise ValueError("The selected NISAR pair is no longer available in this area/date search.")
    series = select_compatible_series(results, config)
    before_identity, before_granule = series[0]
    after_scenes = series[1:]
    if not after_scenes:
        raise ValueError("At least two matching NISAR observations are required.")
    _login_earthdata()
    opened = []

    def open_science_file(granule):
        handles = remote_call(lambda: earthaccess.open([granule]))
        opened.extend(handles)
        if len(handles) != 1:
            raise ValueError("Granule did not resolve to exactly one science file.")
        return handles[0]

    try:
        before = open_science_file(before_granule)
        observations = [{"date": identity["date"], "path": open_science_file(granule),
                         "scene_name": identity["name"]} for identity, granule in after_scenes]
    except Exception:
        for handle in opened:
            handle.close()
        raise
    return {"before": before, "observations": observations,
            "quality": str(quality.resolve()) if quality else None,
            "wetland_boundary": str(boundary_path.resolve()), "boundary_bounds": boundary_bounds,
            "handles": opened,
            "baseline_date": before_identity["date"], "baseline_scene": before_identity["name"],
            "scene_names": [item["scene_name"] for item in observations]}


def _saved_real_inputs(config, output, source_run_id):
    """Reuse measured dB subsets only for the identical polygon and product."""
    if not re.fullmatch(r"[a-f0-9]{32}", source_run_id):
        raise ValueError("Invalid saved run ID.")
    source = output/"runs"/source_run_id
    with open(source/"run_manifest.json", encoding="utf-8") as handle:
        manifest = json.load(handle)
    if manifest.get("status") != "COMPLETE" or manifest.get("data_source") != "NISAR":
        raise ValueError("Reuse requires a completed real NISAR run.")
    if manifest.get("product") != config["nisar"]["product"]:
        raise ValueError("Saved product does not match the requested product.")
    if config.get("masks", {}).get("quality") or manifest.get("quality_mask_method") != "finite, positive HHHH/HVHV samples; no external QA mask configured":
        raise ValueError("Saved subset reuse currently requires runs without an external QA mask.")
    recorded_path = source/"processing_config.json"
    with open(recorded_path, encoding="utf-8") as handle:
        recorded = json.load(handle)
    recorded_frequency = recorded.get("nisar", {}).get("frequency") or manifest.get("frequency")
    if recorded_frequency is None:
        raise ValueError("Saved run has no recorded frequency. Confirm its source metadata or extract a new run before reuse.")
    if recorded_frequency != config["nisar"]["frequency"]:
        raise ValueError("Saved frequency does not match the requested frequency.")
    boundary = (ROOT/config["site"]["boundary"]).resolve()
    def polygon(path):
        with open(path, encoding="utf-8") as handle:
            features = json.load(handle)["features"]
        return unary_union([shape(item["geometry"]) for item in features])
    requested = polygon(boundary)
    if not requested.equals(polygon(source/"site_boundary.geojson")):
        raise ValueError("Saved subsets cannot be reused for a different study boundary.")
    with open(source/"observations.json", encoding="utf-8") as handle:
        observations = json.load(handle)
    rasters = {manifest["baseline_scene"]: {channel: observations[0]["rasters"][f"before_{channel}"] for channel in ("hh", "hv")}}
    rasters.update({item["scene_name"]: {channel: item["rasters"][f"after_{channel}"] for channel in ("hh", "hv")} for item in observations})
    quality_by_scene = {}
    quality_manifest = source/"quality_observations.json"
    if quality_manifest.is_file():
        with open(quality_manifest, encoding="utf-8") as handle:
            quality_doc = json.load(handle)
        quality_by_scene.update(quality_doc.get("by_scene", {}))
    names = config["nisar"].get("selected_scene_names", [])
    if len(names) != 2 or len(set(names)) != 2 or any(name not in rasters for name in names):
        raise ValueError("Choose two different scenes present in the saved run.")
    from search_nisar import scene_identity
    identities = sorted([scene_identity(name, config["nisar"]["frequency"]) for name in names], key=lambda item: item["timestamp"])
    first, second = identities
    if first["compatibility"] != second["compatibility"] or first["date"] >= second["date"]:
        raise ValueError("Saved scenes must be a compatible chronological date pair.")
    def paths(identity):
        result = {}
        for channel, filename in rasters[identity["name"]].items():
            path = (source/filename).resolve()
            if path.parent != source.resolve() or not path.is_file() or path.suffix != ".tif":
                raise ValueError("Saved radar artifact is missing or outside the run folder.")
            result[channel] = path
        return result
    def quality_paths(identity):
        recorded = quality_by_scene.get(identity["name"], {})
        source_quality = recorded.get("quality_valid_file")
        if not source_quality:
            return None
        path = (source/source_quality).resolve()
        if path.parent != source.resolve() or not path.is_file() or path.suffix != ".tif":
            raise ValueError("Saved GCOV quality artifact is missing or outside the run folder.")
        return {"quality_valid_path": path, **{key: value for key, value in recorded.items() if key != "quality_valid_file"}}
    _login_earthdata()
    selected_quality = {first["name"]: quality_paths(first), second["name"]: quality_paths(second)}
    return {"saved_rasters": paths(first), "quality_by_scene": selected_quality,
            "observations": [{"date": second["date"], "scene_name": second["name"], "saved_rasters": paths(second)}],
            "wetland_boundary": str(boundary), "boundary_bounds": list(requested.bounds), "handles": [],
            "boundary_source": manifest.get("wetland_boundary_source"),
            "baseline_date": first["date"], "baseline_scene": first["name"], "scene_names": [second["name"]],
            "source_run_id": source_run_id}


def _rasterize_wetland_boundary(reference_tiff, boundary_geojson, output_tiff):
    """Rasterize the configured study-area polygon onto the exact GCOV pixel grid."""
    with open(boundary_geojson, encoding="utf-8") as handle:
        boundary = json.load(handle)
    features = boundary.get("features") if isinstance(boundary, dict) else None
    geometries = [feature.get("geometry") for feature in features or []
                  if isinstance(feature, dict) and feature.get("geometry")]
    if not geometries:
        raise ValueError("Study-area boundary GeoJSON contains no polygon geometry.")
    if any(geometry.get("type") not in ("Polygon", "MultiPolygon") for geometry in geometries):
        raise ValueError("Study-area boundary must contain only Polygon or MultiPolygon features.")
    with rasterio.open(reference_tiff) as src:
        projected = [transform_geom("EPSG:4326", src.crs, geometry) for geometry in geometries]
        mask = rasterize([(geometry, 1) for geometry in projected], out_shape=(src.height, src.width),
                         transform=src.transform, fill=0, dtype="uint8")
        if not mask.any():
            raise ValueError("NISAR scene does not intersect the configured study area.")
        profile = src.profile.copy()
        profile.update(count=1, dtype="uint8", nodata=None)
        if not profile.get("tiled"):
            profile.pop("blockxsize", None)
            profile.pop("blockysize", None)
    with rasterio.open(output_tiff, "w", **profile) as dst:
        dst.write(mask, 1)
    return str(output_tiff)


def _copy_saved_quality_layers(recorded, source_run, destination_run, prefix):
    """Copy retained GCOV quality sidecars into a derived saved-subset run."""
    if not isinstance(recorded, dict):
        return None
    copied = dict(recorded)
    for key, file_key in (("quality_valid_path", "quality_valid_file"),
                          ("number_of_looks_path", "number_of_looks_file"),
                          ("mask_ensemble_path", "mask_ensemble_file")):
        filename = recorded.get(file_key)
        existing = recorded.get(key)
        if existing:
            source_path = Path(existing).resolve()
        elif filename:
            if Path(filename).name != filename:
                raise ValueError("Saved GCOV quality artifact path is invalid.")
            source_path = (source_run/filename).resolve()
        else:
            copied.pop(key, None)
            copied[file_key] = None
            continue
        if source_path.parent != source_run.resolve() or not source_path.is_file() or source_path.suffix != ".tif":
            raise ValueError("Saved GCOV quality artifact is missing or outside its source run folder.")
        target = destination_run/f"{prefix}_{file_key.removesuffix('_file')}.tif"
        shutil.copyfile(source_path, target)
        copied[key] = str(target)
        copied[file_key] = target.name
    return copied


def _validated_site_name(value):
    if not isinstance(value, str):
        raise ValueError("Study-area name must be text.")
    name = value.strip()
    if not 2 <= len(name) <= 80 or any(ord(character) < 32 for character in name):
        raise ValueError("Study-area name must be 2–80 characters without control characters.")
    return name


def _validated_bbox(bounds):
    """Validate a WGS84 bbox in west, south, east, north order."""
    if len(bounds) != 4:
        raise ValueError("AOI bounds must be west, south, east, north.")
    west, south, east, north = (float(value) for value in bounds)
    if not all(math.isfinite(value) for value in (west, south, east, north)):
        raise ValueError("AOI bounds must be finite numbers.")
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("AOI bounds must be valid WGS84 coordinates: west south east north.")
    return {"min_lon": west, "min_lat": south, "max_lon": east, "max_lat": north}


def _read_boundary(path):
    """Load and validate a WGS84 GeoJSON polygon boundary."""
    with open(path, encoding="utf-8") as handle:
        document = json.load(handle)
    features = document.get("features") if isinstance(document, dict) else None
    geometries = [feature.get("geometry") for feature in features or []
                  if isinstance(feature, dict) and feature.get("geometry")]
    if not geometries:
        raise ValueError("Study-area GeoJSON must contain Polygon or MultiPolygon features.")
    polygons = [shape(geometry) for geometry in geometries]
    if any(polygon.geom_type not in ("Polygon", "MultiPolygon") or polygon.is_empty or not polygon.is_valid
           for polygon in polygons):
        raise ValueError("Study-area GeoJSON must contain valid Polygon or MultiPolygon features.")
    bounds = [min(p.bounds[0] for p in polygons), min(p.bounds[1] for p in polygons),
              max(p.bounds[2] for p in polygons), max(p.bounds[3] for p in polygons)]
    _validated_bbox(bounds)
    return bounds


def _set_study_area(config, boundary_geojson=None, bbox=None):
    """Apply per-run AOI settings without changing the default config file."""
    if boundary_geojson is not None and bbox is not None:
        raise ValueError("Choose either --boundary-geojson or --bbox, not both.")
    if boundary_geojson is not None:
        path = Path(boundary_geojson).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Study-area GeoJSON not found: {path}")
        bounds = _read_boundary(path)
        with open(path, encoding="utf-8") as handle:
            boundary_document = json.load(handle)
        source_labels = {feature["properties"]["boundary_source"]
                         for feature in boundary_document.get("features", [])
                         if isinstance(feature, dict) and isinstance(feature.get("properties"), dict)
                         and isinstance(feature["properties"].get("boundary_source"), str)
                         and 0 < len(feature["properties"]["boundary_source"]) <= 250}
        config["site"]["boundary"] = str(path)
        config["site"]["bbox"] = _validated_bbox(bounds)
        config["site"]["boundary_source"] = (source_labels.pop() if len(source_labels) == 1 else
                                               f"User-supplied GeoJSON: {path.name}")
    elif bbox is not None:
        area = _validated_bbox(bbox)
        west, south, east, north = (area[key] for key in ("min_lon", "min_lat", "max_lon", "max_lat"))
        rectangle = {"type": "FeatureCollection", "features": [{
            "type": "Feature", "properties": {"boundary_source": "user_bbox"},
            "geometry": {"type": "Polygon", "coordinates": [[[west, south], [east, south],
                         [east, north], [west, north], [west, south]]]}
        }]}
        config["site"]["_boundary_geojson"] = rectangle
        config["site"]["bbox"] = area
        config["site"]["boundary_source"] = "User-supplied rectangular AOI; not a wetland boundary"


def _not_run_reference(mode):
    """Explain why reference comparison was not requested without mislabelling real runs."""
    if mode == "demo":
        reason = (
            "This is a simulated run; independent satellite comparison only runs "
            "on real NISAR observations."
        )
    elif mode == "real":
        reason = (
            "Independent reference validation was disabled for this real-data run. "
            "Any source-publication reference assessment remains separate and is "
            "not inherited or upgraded by this run."
        )
    else:
        raise ValueError("Mode must be demo or real.")
    return {"status": "NOT_RUN", "reference_validated": False, "reason": reason}


def run_pipeline(config_path=None, mode="demo", output_root=None, site_name=None,
                 boundary_geojson=None, bbox=None, start_date=None, end_date=None, scene_names=None,
                 progress=None, cached_run_id=None, reference_case_selection=None):
    if mode not in ("demo", "real"):
        raise ValueError("Mode must be demo or real.")
    if cached_run_id is not None and mode != "real":
        raise ValueError("Saved NISAR subsets can only be reused in real mode.")
    config = load_config(config_path)
    if scene_names is not None:
        if mode != "real" or len(scene_names) != 2 or len(set(scene_names)) != 2:
            raise ValueError("Select two different real NISAR scenes.")
        config["nisar"]["selected_scene_names"] = list(scene_names)
    if mode == "demo" and config["nisar"]["frequency"] != "frequencyA":
        raise ValueError("The fake fixture supports frequencyA.")
    output = Path(output_root or ROOT/"output").resolve()
    output.mkdir(parents=True, exist_ok=True)
    if site_name is not None and mode != "real":
        raise ValueError("A custom study-area name can only be applied to a real run.")
    if mode == "real":
        if site_name is None and config_path is None:
            override_path = output/"site_name_override.json"
            if override_path.is_file():
                with open(override_path, encoding="utf-8") as handle:
                    site_name = json.load(handle).get("site_name")
        has_custom_area = boundary_geojson is not None or bbox is not None
        if has_custom_area and site_name is None:
            raise ValueError("A custom study area requires --site-name so the run is labeled correctly.")
        if site_name is not None:
            config["site"]["name"] = _validated_site_name(site_name)
        _set_study_area(config, boundary_geojson=boundary_geojson, bbox=bbox)
    elif boundary_geojson is not None or bbox is not None:
        raise ValueError("Custom study areas can only be applied to a real-data run.")
    if (start_date is not None or end_date is not None) and mode != "real":
        raise ValueError("Custom observation dates can only be applied to a real-data run.")
    if start_date is not None or end_date is not None:
        dates = config["nisar"].get("temporal", [])
        start_date = start_date or (dates[0] if len(dates) == 2 else None)
        end_date = end_date or (dates[1] if len(dates) == 2 else None)
        if not start_date or not end_date:
            raise ValueError("Provide both --start-date and --end-date when no date range is configured.")
        start_day, end_day = datetime.fromisoformat(start_date), datetime.fromisoformat(end_date)
        if start_day > end_day:
            raise ValueError("Start date must be on or before end date.")
        config["nisar"]["temporal"] = [start_day.date().isoformat(), end_day.date().isoformat()]
    lock = output/".run.lock"
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.write(descriptor, json.dumps({"pid": os.getpid()}).encode("utf-8"))
    os.close(descriptor)
    run_id = uuid.uuid4().hex
    run = output/"runs"/run_id
    manifest = {"schema_version": 1, "run_id": run_id, "mode": mode,
                "data_source": "SIMULATED_DEMO" if mode == "demo" else "NISAR",
                "started_at": datetime.now(timezone.utc).isoformat(), "status": "RUNNING"}
    inputs = None
    try:
        run.mkdir(parents=True)
        inline_boundary = config["site"].pop("_boundary_geojson", None)
        if inline_boundary is not None:
            boundary_path = run/"site_boundary.geojson"
            atomic_json(boundary_path, inline_boundary)
            config["site"]["boundary"] = str(boundary_path.resolve())
        atomic_json(run/"run_manifest.json", manifest)
        atomic_json(output/"last_attempt.json", manifest)
        atomic_json(run/"processing_config.json", {"site": config["site"], "nisar": config["nisar"],
                                                    "processing": config["processing"], "validation": config["validation"]})
        if reference_case_selection is not None:
            atomic_json(run/"reference_case_selection.json", reference_case_selection)
        if mode == "demo":
            from mock_data import generate_mock_series
            inputs = generate_mock_series(run, config)
        else:
            if progress:
                progress("Reusing saved measured NISAR dB subsets" if cached_run_id else "Opening the selected NISAR science files")
            inputs = _saved_real_inputs(config, output, cached_run_id) if cached_run_id else _real_inputs(config, run)
            if inputs.get("boundary_source"):
                config["site"]["boundary_source"] = inputs["boundary_source"]
                atomic_json(run/"processing_config.json", {"site": config["site"], "nisar": config["nisar"],
                                                          "processing": config["processing"], "validation": config["validation"]})
            boundary_source = Path(inputs["wetland_boundary"]).resolve()
            boundary_target = (run/"site_boundary.geojson").resolve()
            if boundary_source != boundary_target:
                shutil.copyfile(boundary_source, boundary_target)
        source = manifest["data_source"]
        frequency = config["nisar"]["frequency"]
        bbox = config["site"]["bbox"]
        bounds = tuple(bbox[k] for k in ("min_lon", "min_lat", "max_lon", "max_lat")) if mode == "real" else None
        paths = {}
        for pol, channel in (("HHHH", "hh"), ("HVHV", "hv")):
            destination = run/f"before_{channel}.tif"
            if inputs.get("saved_rasters"):
                shutil.copyfile(inputs["saved_rasters"][channel], destination)
            else:
                extract_polarization_to_tiff(inputs["before"], frequency, pol, destination, bbox=bounds)
        before_wetland_mask = inputs.get("wetland")
        if mode == "real":
            before_wetland_mask = _rasterize_wetland_boundary(run/"before_hh.tif", inputs["wetland_boundary"], run/"wetland_mask.tif")
            inputs["wetland"] = before_wetland_mask
        quality_by_scene = inputs.get("quality_by_scene", {})
        if mode == "real" and not inputs.get("saved_rasters"):
            before_quality = extract_quality_layers_to_tiff(inputs["before"], frequency, run/"gcov_before", bbox=bounds)
            before_quality["quality_valid_file"] = Path(before_quality["quality_valid_path"]).name
            before_quality["number_of_looks_file"] = Path(before_quality["number_of_looks_path"]).name
            before_quality["mask_ensemble_file"] = Path(before_quality["mask_ensemble_path"]).name if before_quality.get("mask_ensemble_path") else None
            quality_by_scene[inputs["baseline_scene"]] = before_quality
        else:
            before_quality = quality_by_scene.get(inputs.get("baseline_scene"))
            if before_quality and before_quality.get("quality_valid_path"):
                before_quality = _copy_saved_quality_layers(before_quality, output/"runs"/cached_run_id, run, "gcov_before")
                quality_by_scene[inputs["baseline_scene"]] = before_quality
        quality_observations = {inputs.get("baseline_scene", inputs.get("baseline_date", "baseline")): before_quality or {"status": "NOT_AVAILABLE", "reason": "Saved dB subsets did not retain GCOV quality sidecars."}}
        for _, channel in (("HHHH", "hh"), ("HVHV", "hv")):
            destination = run/f"before_{channel}.tif"
            scene_quality_masks = [item for item in (inputs.get("quality"), (before_quality or {}).get("quality_valid_path")) if item]
            paths[f"before_{channel}"] = apply_masks(destination, scene_quality_masks, before_wetland_mask,
                                                       run/f"before_{channel}_masked.tif")
        masks, mask_profile = read_rasters([inputs["wetland"]])
        wetland_area = sum(area_km2(shape(g), mask_profile["crs"]) for g, value in
                           shapes(masks[0].astype("uint8"), mask=masks[0] == 1, transform=mask_profile["transform"]))
        observations, previous = [], None
        per_observation_baselines = []
        pipeline_baseline_date = inputs.get("baseline_date", config["demo"]["baseline_date"])
        for index, observation in enumerate(inputs["observations"]):
            if progress:
                progress(f"Extracting and detecting change for {observation['date']} ({index+1}/{len(inputs['observations'])})")
            for pol, channel in (("HHHH", "hh"), ("HVHV", "hv")):
                destination = run/f"after_{index:02d}_{channel}.tif"
                if observation.get("saved_rasters"):
                    shutil.copyfile(observation["saved_rasters"][channel], destination)
                else:
                    extract_polarization_to_tiff(observation["path"], frequency, pol, destination, bbox=bounds)
            if mode == "real" and not observation.get("saved_rasters"):
                observation_quality = extract_quality_layers_to_tiff(observation["path"], frequency,
                    run/f"gcov_after_{index:02d}", bbox=bounds)
                observation_quality["quality_valid_file"] = Path(observation_quality["quality_valid_path"]).name
                observation_quality["number_of_looks_file"] = Path(observation_quality["number_of_looks_path"]).name
                observation_quality["mask_ensemble_file"] = Path(observation_quality["mask_ensemble_path"]).name if observation_quality.get("mask_ensemble_path") else None
                quality_by_scene[observation["scene_name"]] = observation_quality
            else:
                observation_quality = quality_by_scene.get(observation.get("scene_name"))
                if observation_quality and observation_quality.get("quality_valid_path"):
                    observation_quality = _copy_saved_quality_layers(observation_quality, output/"runs"/cached_run_id,
                                                                      run, f"gcov_after_{index:02d}")
                    quality_by_scene[observation["scene_name"]] = observation_quality
            quality_observations[observation.get("scene_name", observation["date"])] = observation_quality or {
                "status": "NOT_AVAILABLE", "reason": "Saved dB subsets did not retain GCOV quality sidecars."}
            wetland_mask = inputs.get("wetland")
            if mode == "real":
                wetland_mask = _rasterize_wetland_boundary(run/f"after_{index:02d}_hh.tif", inputs["wetland_boundary"],
                                                           run/f"wetland_mask_{index:02d}.tif")
            for _, channel in (("HHHH", "hh"), ("HVHV", "hv")):
                destination = run/f"after_{index:02d}_{channel}.tif"
                scene_quality_masks = [item for item in (inputs.get("quality"), (observation_quality or {}).get("quality_valid_path")) if item]
                paths[f"after_{channel}"] = apply_masks(destination, scene_quality_masks, wetland_mask,
                                                          run/f"after_{index:02d}_{channel}_masked.tif")
            baseline_dates = [pipeline_baseline_date, *[item["date"] for item in inputs["observations"][:index]]]
            baseline_paths = {"hh": paths["before_hh"], "hv": paths["before_hv"]}
            baseline_hh_mad = None
            if mode == "real" and index > 0:
                baseline_observation_paths = {channel: [paths[f"before_{channel}"],
                    *[run/f"after_{prior:02d}_{channel}_masked.tif" for prior in range(index)]] for channel in ("hh", "hv")}
                for channel in ("hh", "hv"):
                    baseline_paths[channel], mad = write_temporal_median(
                        baseline_observation_paths[channel], run/f"baseline_{index:02d}_{channel}_median.tif")
                    if channel == "hh":
                        baseline_hh_mad = mad
            baseline_metadata = {"baseline_method": "PER_PIXEL_MEDIAN" if mode == "real" and index > 0 else "SINGLE_PRECEDING_OBSERVATION",
                "baseline_observation_count": len(baseline_dates), "baseline_observation_dates": baseline_dates,
                "baseline_hh_temporal_mad_db": baseline_hh_mad}
            baseline_scene_names = [inputs.get("baseline_scene"), *[item.get("scene_name") for item in inputs["observations"][:index]]]
            baseline_metadata["baseline_scene_names"] = [name for name in baseline_scene_names if name]
            per_observation_baselines.append({**baseline_metadata, "date": observation["date"]})
            ordered_paths = [baseline_paths["hh"], paths["after_hh"], baseline_paths["hv"], paths["after_hv"]]
            candidate_path = run/f"patches_{index:02d}.geojson"
            result, grid = process_inundation(*ordered_paths, config, observation["date"], candidate_path,
                                             data_source=source, threshold=config["processing"]["base_threshold_db"],
                                             previous_class_grid=previous, baseline_metadata=baseline_metadata)
            spatial_path = run_spatial_analysis(candidate_path)
            final_path = validate_patches(spatial_path, run/f"patches_{index:02d}_final.geojson")
            with open(final_path, encoding="utf-8") as handle:
                result = json.load(handle)
            observations.append(result)
            previous = grid
            observation["rasters"] = {"before_hh": Path(ordered_paths[0]).name, "after_hh": Path(ordered_paths[1]).name,
                                       "before_hv": Path(ordered_paths[2]).name, "after_hv": Path(ordered_paths[3]).name}
            observation["baseline_observation_dates"] = baseline_dates
            observation["baseline_method"] = baseline_metadata
            observation["quality"] = {key: observation_quality.get(key) for key in ("number_of_looks_valid_fraction", "number_of_looks_median", "number_of_looks_min", "number_of_looks_max", "mask_ensemble_counts", "mask_interpretation")} if observation_quality else None
            with rasterio.open(ordered_paths[0]) as src:
                classification_profile = src.profile.copy()
            classification_profile.update(dtype="uint8", nodata=0)
            if not classification_profile.get("tiled"):
                classification_profile.pop("blockxsize", None)
                classification_profile.pop("blockysize", None)
            with rasterio.open(run/f"classification_{index:02d}.tif", "w", **classification_profile) as dst:
                dst.write(grid, 1)
        pulse = generate_temporal_data(run, observations, config["site"]["name"], wetland_area, source)
        peak_index = next(i for i, o in enumerate(observations) if o["date"] == pulse["peak"]["date"])
        atomic_json(run/"patches_final.geojson", observations[peak_index])
        selected = inputs["observations"][peak_index]["rasters"]
        ordered_paths = [run/selected[key] for key in ("before_hh", "after_hh", "before_hv", "after_hv")]
        sensitivity = run_sensitivity_sweep(*ordered_paths, config, out_json=run/"sensitivity_results.json", data_source=source)
        reference = _not_run_reference(mode)
        if mode == "real" and config["validation"].get("use_reference"):
            if progress:
                progress("Checking independent HLS reference pairs for cloud-free coverage")
            try:
                reference = validate_hls_open_water(
                    config, inputs["baseline_date"], observations[peak_index]["date"],
                    inputs["wetland_boundary"], ordered_paths[0], ordered_paths[1:],
                    run/f"classification_{peak_index:02d}.tif", run/"wetland_mask.tif", progress=progress,
                    baseline_observation_dates=inputs["observations"][peak_index].get("baseline_observation_dates", [inputs["baseline_date"]]))
            except Exception as error:
                # A missing/obscured optical reference must not discard a completed NISAR run.
                logging.warning("Independent HLS cross-check unavailable (%s).", type(error).__name__)
                reference = {"status": "UNAVAILABLE", "reference_validated": False,
                            "reference_product": "NASA HLS optical surface reflectance (Sentinel-2 S30 / Landsat L30)",
                            "reason": "Date-matched HLS data could not be processed in this run. Check Earthdata access, archive availability, and the run log."}
        atomic_json(run/"reference_validation.json", reference)

        event_features = observations[peak_index].get("features", [])
        class_summary = {}
        for feature in event_features:
            props = feature.get("properties", {})
            name = props.get("classification", "UNCERTAIN")
            group = class_summary.setdefault(name, {"patches": 0, "area_km2": 0.0,
                                                     "mean_delta_hh_db": None, "mean_delta_hv_db": None,
                                                     "valid_fraction": []})
            group["patches"] += 1
            group["area_km2"] += float(props.get("area_km2", 0.0))
            if isinstance(props.get("delta_hh"), (int, float)):
                group.setdefault("_hh_sum", 0.0)
                group["_hh_sum"] += float(props["delta_hh"])
            if isinstance(props.get("delta_hv"), (int, float)):
                group.setdefault("_hv_sum", 0.0)
                group["_hv_sum"] += float(props["delta_hv"])
            if isinstance(props.get("valid_fraction"), (int, float)):
                group["valid_fraction"].append(float(props["valid_fraction"]))
        for group in class_summary.values():
            group["mean_delta_hh_db"] = round(group.pop("_hh_sum", 0.0) / group["patches"], 3) if group["patches"] else None
            group["mean_delta_hv_db"] = round(group.pop("_hv_sum", 0.0) / group["patches"], 3) if group["patches"] else None
            fractions = group.pop("valid_fraction")
            group["candidate_bbox_valid_fraction_mean"] = round(sum(fractions) / len(fractions), 3) if fractions else None
        event_scene = inputs["observations"][peak_index]
        baseline_date = pipeline_baseline_date
        case_title = f"{config['site']['name']} · {baseline_date} to {observations[peak_index]['date']}"
        if mode == "demo":
            case_title = f"SIMULATED DEMO · {case_title}"
        case_study = {
            "title": case_title, "data_source": source,
            "site": config["site"]["name"], "baseline_date": baseline_date,
            "event_date": observations[peak_index]["date"],
            "baseline_scene": inputs.get("baseline_scene"), "event_scene": event_scene.get("scene_name"),
            "baseline_scenes": per_observation_baselines[peak_index].get("baseline_scene_names", []),
            "product": config["nisar"]["product"] if mode == "real" else None,
            "frequency": config["nisar"]["frequency"] if mode == "real" else None,
            "product_maturity": ("BETA" if "BETA" in config["nisar"]["product"] else "PROVISIONAL") if mode == "real" else "SIMULATED",
            "input_origin": "SAVED_NISAR_DB_SUBSETS" if cached_run_id else "NISAR_GCOV" if mode == "real" else "SIMULATED",
            "source_run_id": cached_run_id,
            "date_pair_selection": reference_case_selection,
            "polarizations": ["HHHH", "HVHV"], "classes": class_summary,
            "candidate_patches": sum(item["patches"] for item in class_summary.values()),
            "candidate_area_km2": round(sum(item["area_km2"] for item in class_summary.values()), 3),
            "method": {
                "description": ("Co-registered NISAR GCOV backscatter change in dB, evaluated inside the supplied study boundary. Later dates use the per-pixel median of all preceding observations. The HH decrease output is a radar-darkening candidate, not a water classification."
                                 if mode == "real" else "Synthetic date-pair change generated for interface demonstration; this is not NISAR data."),
                "open_water_rule": f"HHHH change ≤ −{abs(float(config['processing']['open_water_delta_hh'])):.1f} dB.",
                "vegetated_inundation_rule": f"HHHH increase ≥ {float(config['processing']['vegetated_delta_hh']):.1f} dB and |HVHV change| ≤ {float(config['processing']['vegetated_delta_hv_max']):.1f} dB.",
                "minimum_region_pixels": int(config["processing"]["minimum_region_pixels"]),
                "minimum_valid_fraction": float(config["processing"]["minimum_valid_fraction"]),
                "validity_rule": ("Finite positive HH/HV power in all comparison layers; GCOV numberOfLooks finite and positive where available; metadata-declared fill values and the study boundary are excluded. GCOV mask ensemble codes are retained as provenance, not interpreted as validity." if mode == "real" and any(item.get("number_of_looks_median") is not None for item in quality_observations.values() if isinstance(item, dict)) else "Finite positive HH/HV power and study boundary; reused dB subsets lack GCOV quality sidecars, so numberOfLooks was not applied." if mode == "real" else "Finite synthetic HH/HV samples inside the demo mask."),
                "baseline_method": per_observation_baselines[peak_index],
                "gcov_quality": {"scenes": [{"scene": name, **{key: item.get(key) for key in ("number_of_looks_valid_fraction", "number_of_looks_median", "number_of_looks_min", "number_of_looks_max", "mask_ensemble_counts", "mask_interpretation")}} for name, item in quality_observations.items() if isinstance(item, dict)],
                                  "number_of_looks_rule": "finite and greater than zero; no arbitrary minimum-look cutoff",
                                  "mask_rule": "record ensemble categories; exclude only HDF5-declared fill values"},
                "threshold_db": float(config["processing"]["base_threshold_db"]),
            },
            "uncertainty": {
                "threshold_sensitivity": {key: sensitivity.get(key) for key in
                                           ("base_threshold_db", "stable_range", "stability_verdict", "sensitivity_note")},
                "reference_status": reference.get("status"),
                "reference_coverage": reference.get("coverage"),
                "interpretation": "These are algorithmic candidate regions. Rule stability and cross-sensor agreement do not establish field accuracy or prove a flood.",
            },
            "reference_validation": reference,
            "impact_context": ("The mapped change is a place for wetland teams to prioritize a closer look. It does not measure damage, water depth, or impacts to people or habitat."
                               if mode == "real" else "This synthetic scenario illustrates the interface only and makes no claim about real places, events, or impacts."),
            "spatial_scope": (f"This run processes the configured {config['site']['name']} study boundary only. Blank areas elsewhere on the global map mean no detector result is available."
                              if mode == "real" else "This is a synthetic scenario, not a real event or detector result."),
        }
        atomic_json(run/"case_study.json", case_study)
        atomic_json(run/"observations.json", [{"date": o["date"], "scene_name": inputs["observations"][i].get("scene_name"),
                                             "baseline_observation_dates": inputs["observations"][i].get("baseline_observation_dates", [pipeline_baseline_date]),
                                             "baseline_method": inputs["observations"][i].get("baseline_method"),
                                             "quality": inputs["observations"][i].get("quality"),
                                             "patches_file": f"patches_{i:02d}_final.geojson",
                                             "classification_file": f"classification_{i:02d}.tif",
                                             "rasters": inputs["observations"][i]["rasters"]} for i, o in enumerate(observations)])
        # All files are complete before the manifest pointer becomes readable.
        manifest.update(status="COMPLETE", completed_at=datetime.now(timezone.utc).isoformat(),
                        selected_date=pulse["peak"]["date"], observation_count=len(observations),
                        baseline_date=config["demo"]["baseline_date"] if mode == "demo" else inputs["baseline_date"],
                        seed=inputs.get("seed"),
                        input_origin=case_study["input_origin"], source_run_id=cached_run_id,
                        product=config["nisar"]["product"] if mode == "real" else None,
                        frequency=config["nisar"]["frequency"] if mode == "real" else None,
                        baseline_scene=inputs.get("baseline_scene"),
                        baseline_observation_dates=per_observation_baselines[peak_index].get("baseline_observation_dates", [baseline_date]),
                        baseline_method=per_observation_baselines[peak_index].get("baseline_method"),
                        observation_scenes=inputs.get("scene_names", []),
                        polarizations=["HHHH", "HVHV"] if mode == "real" else None,
                        site_bounds=inputs.get("boundary_bounds"),
                        product_maturity=("BETA" if "BETA" in config["nisar"]["product"] else "PROVISIONAL") if mode == "real" else "SIMULATED",
                        site_name=config["site"]["name"],
                        wetland_boundary_source=config["site"].get("boundary_source") if mode == "real" else None,
                        # A satellite-to-satellite comparison is not field or ground-truth validation.
                        reference_validated=False,
                        cross_sensor_check_completed=reference.get("cross_sensor_check_completed", False),
                        reference_check_status=reference.get("status"),
                        reference_validation_status=reference.get("status"),
                        quality_mask_method=("finite positive HHHH/HVHV; GCOV numberOfLooks > 0 and metadata-declared fill exclusions where raw quality layers are present; optional external binary mask; GCOV averaging-ensemble mask recorded but not treated as validity" if any(item.get("number_of_looks_median") is not None for item in quality_observations.values() if isinstance(item, dict)) else "finite positive HHHH/HVHV; GCOV quality sidecars unavailable in reused dB subsets; optional external binary mask") if mode == "real" else None)
        if mode == "real":
            safe_quality = {scene: {key: value for key, value in item.items() if key not in ("quality_valid_path", "number_of_looks_path", "mask_ensemble_path")}
                            for scene, item in quality_observations.items()}
            by_scene_quality = {}
            for scene, item in quality_by_scene.items():
                if not isinstance(item, dict):
                    continue
                row = {key: value for key, value in item.items() if key not in ("quality_valid_path", "number_of_looks_path", "mask_ensemble_path")}
                row.update(quality_valid_file=Path(item["quality_valid_path"]).name if item.get("quality_valid_path") else None,
                           number_of_looks_file=Path(item["number_of_looks_path"]).name if item.get("number_of_looks_path") else None,
                           mask_ensemble_file=Path(item["mask_ensemble_path"]).name if item.get("mask_ensemble_path") else None)
                by_scene_quality[scene] = row
            atomic_json(run/"quality_observations.json", {"by_scene": by_scene_quality, "summary": safe_quality})
        consolidate_outputs(run, ROOT.parent/"data") if mode == "demo" and output == (ROOT/"output").resolve() else None
        atomic_json(run/"run_manifest.json", manifest)
        if mode == "real":
            if progress:
                progress("Rendering the actual before/after radar layers")
            from radar_previews import render_run
            render_run(run)
            if reference.get("comparison"):
                try:
                    from reference_evidence import build_reference_evidence
                    build_reference_evidence(run_id, progress=progress or logging.info, output_root=output)
                except Exception as error:
                    logging.warning("Optical evidence could not be prepared (%s); the real radar run is retained.", type(error).__name__)
        atomic_json(output/"last_attempt.json", manifest)
        atomic_json(output/"current_run.json", manifest)
        logging.info("Complete %s run: %s", source, run)
        return manifest
    except Exception as error:
        manifest.update(status="FAILED", error=str(error))
        if run.is_dir():
            atomic_json(run/"run_manifest.json", manifest)
        atomic_json(output/"last_attempt.json", manifest)
        raise
    finally:
        for handle in (inputs or {}).get("handles", []):
            handle.close()
        lock.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("demo", "real"), default="demo")
    parser.add_argument("--config", type=Path)
    parser.add_argument("--output-root", type=Path)
    parser.add_argument("--site-name", help="Override the configured site label for a real run.")
    parser.add_argument("--boundary-geojson", type=Path,
                        help="Use a WGS84 Polygon/MultiPolygon GeoJSON boundary for this real run; bbox is derived from it.")
    parser.add_argument("--bbox", nargs=4, type=float, metavar=("WEST", "SOUTH", "EAST", "NORTH"),
                        help="Use a rectangular WGS84 AOI for this real run; the rectangle is not a wetland boundary.")
    parser.add_argument("--start-date", help="First NISAR search date (YYYY-MM-DD).")
    parser.add_argument("--end-date", help="Last NISAR search date (YYYY-MM-DD).")
    parser.add_argument("--scene-names", nargs=2, help="Exact compatible baseline and event granule names.")
    parser.add_argument("--cached-run-id", help="Reuse measured dB subsets for an identical study boundary.")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    try:
        run_pipeline(args.config, args.mode, args.output_root, args.site_name,
                     args.boundary_geojson, args.bbox, args.start_date, args.end_date,
                     scene_names=args.scene_names, cached_run_id=args.cached_run_id, progress=logging.info)
        return 0
    except Exception:
        logging.exception("Pipeline failed; no successful output was published for this attempt.")
        return 1


if __name__ == "__main__":
    sys.exit(main())

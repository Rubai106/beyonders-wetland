"""Preserve optical evidence and audit disagreement without tuning the detector."""
import argparse
from datetime import date, datetime, timezone
import json
import logging
from pathlib import Path
import re

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import array_bounds, from_bounds
from rasterio.warp import reproject, transform_bounds, transform_geom
from scipy.ndimage import distance_transform_edt
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

from hls_reference import _identity, _read_hls_scene, area_supported_metrics
from raster_utils import atomic_json, area_km2, read_rasters, same_grid

ROOT = Path(__file__).resolve().parent
LEGEND = [
    {"value": 1, "label": "Clear · neither shows new water", "color": "#233747"},
    {"value": 2, "label": "Both show new water", "color": "#48dec6"},
    {"value": 3, "label": "Radar candidate only", "color": "#ffb54c"},
    {"value": 4, "label": "Optical new water only", "color": "#d397ff"},
    {"value": 5, "label": "Unassessed · excluded or missing", "color": "#7c8b9e"},
]


def compare(grid, valid, before, after, threshold):
    common = valid & before["valid"] & after["valid"] & np.isfinite(before["index"]) & np.isfinite(after["index"])
    optical = common & (after["index"] > threshold) & (before["index"] <= threshold)
    radar = common & (grid == 1)
    tp, fp, fn = (int(value.sum()) for value in (radar & optical, radar & ~optical, ~radar & optical))
    return common, radar, optical, {"matching_pixels": tp, "radar_only_pixels": fp, "optical_only_pixels": fn,
        "precision": tp/(tp+fp) if tp+fp else None, "recall": tp/(tp+fn) if tp+fn else None,
        "f1": 2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else None}


def _profile(folder, selected):
    paths = []
    for key in ("before_hh", "after_hh", "before_hv", "after_hv"):
        name = selected["rasters"][key]
        if Path(name).name != name:
            raise ValueError("Unsafe saved radar artifact path.")
        paths.append(folder/name)
    arrays, profile = read_rasters(paths)
    with rasterio.open(folder/selected["classification_file"]) as source:
        if not same_grid(profile, source):
            raise ValueError("Classification and radar inputs do not align.")
        grid = source.read(1)
    with rasterio.open(folder/"wetland_mask.tif") as source:
        if not same_grid(profile, source):
            raise ValueError("Study boundary mask and radar inputs do not align.")
        study = source.read(1) == 1
    return arrays, profile, grid, study


def _resolve_scenes(names, bounds):
    import earthaccess
    granules = {}
    for name in names:
        identity = _identity({"umm": {"GranuleUR": name}})
        if identity is None:
            raise ValueError("Recorded reference scene is not HLS v2.0.")
        found = earthaccess.search_data(short_name=f"HLS{identity['product']}", bounding_box=bounds,
            temporal=(identity["date"].isoformat(), identity["date"].isoformat()), count=200)
        matches = [item for item in found if item.get("umm", {}).get("GranuleUR") == name]
        if len(matches) != 1:
            raise ValueError("Recorded optical scene is not uniquely available in NASA CMR.")
        granules[name] = matches[0]
    return granules


def _write_tiff(path, values, profile, nodata):
    saved = profile.copy()
    saved.update(count=1, dtype=values.dtype, nodata=nodata, compress="deflate")
    if not saved.get("tiled"):
        saved.pop("blockxsize", None)
        saved.pop("blockysize", None)
    with rasterio.open(path, "w", **saved) as target:
        target.write(values, 1)


def _render(folder, profile, study, before, after, common, radar, optical, threshold, candidates, prefix=""):
    left, bottom, right, top = transform_bounds(profile["crs"], "EPSG:3857",
        *array_bounds(profile["height"], profile["width"], profile["transform"]), densify_pts=21)
    dx, dy = right-left, top-bottom
    width, height = max(1, round(1024*dx/max(dx, dy))), max(1, round(1024*dy/max(dx, dy)))
    transform = from_bounds(left, bottom, right, top, width, height)
    def project(values, categorical=False):
        destination = np.zeros((height, width), dtype="uint8") if categorical else np.full((height, width), np.nan, dtype="float32")
        reproject(values, destination, src_transform=profile["transform"], src_crs=profile["crs"],
            dst_transform=transform, dst_crs="EPSG:3857", src_nodata=0 if categorical else np.nan,
            dst_nodata=0 if categorical else np.nan, resampling=Resampling.nearest if categorical else Resampling.bilinear)
        return destination
    visible = project(study.astype("uint8"), True) == 1
    def save(name, pixels):
        pixels[:, :, 3] = np.where(visible, pixels[:, :, 3], 0)
        filename = f"reference_{prefix}{name}.png"
        Image.fromarray(pixels).save(folder/filename)
        return filename
    images = {}
    for stage, scene in (("before", before), ("after", after)):
        rgb = np.stack([project(values) for values in scene["rgb"]], axis=-1)
        pixels = np.zeros((height, width, 4), dtype="uint8")
        pixels[:, :, :3] = (255*np.power(np.clip(np.nan_to_num(rgb)/.3, 0, 1), 1/2.2)).astype("uint8")
        pixels[:, :, 3] = np.where(np.isfinite(rgb).all(axis=-1), 255, 0)
        images[f"{stage}_rgb"] = save(f"{stage}_rgb", pixels)
        water = np.zeros(study.shape, dtype="uint8")
        water[study] = 3
        water[study & scene["valid"] & np.isfinite(scene["index"])] = 1
        water[study & scene["valid"] & (scene["index"] > threshold)] = 2
        display = project(water, True)
        colors = np.array([[0,0,0,0], [35,55,71,255], [72,222,198,255], [124,139,158,255]], dtype="uint8")
        images[f"{stage}_water"] = save(f"{stage}_water", colors[display])
    agreement = np.zeros(study.shape, dtype="uint8")
    agreement[study] = 5
    agreement[common] = 1
    agreement[radar & optical] = 2
    agreement[radar & ~optical] = 3
    agreement[~radar & optical] = 4
    colors = np.array([[0,0,0,0], [35,55,71,255], [72,222,198,255], [255,181,76,255], [211,151,255,255], [124,139,158,255]], dtype="uint8")
    images["agreement"] = save("agreement", colors[project(agreement, True)])
    coverage = np.zeros(study.shape, dtype="uint8")
    coverage[study] = 2
    coverage[common] = 1
    images["coverage"] = save("coverage", np.array([[0,0,0,0],[72,222,198,255],[124,139,158,255]], dtype="uint8")[project(coverage, True)])
    overlay = np.zeros((height, width, 4), dtype="uint8")
    displayed_radar = project(candidates.astype("uint8"), True) == 1
    overlay[displayed_radar] = [255,181,76,255]
    images["candidate_overlay"] = save("candidate_overlay", overlay)
    artifacts = []
    for name, values, nodata in (("agreement", agreement, 0), ("before_mndwi", before["index"], np.nan), ("after_mndwi", after["index"], np.nan)):
        filename = f"reference_{prefix}{name}.tif"
        _write_tiff(folder/filename, values, profile, nodata)
        artifacts.append(filename)
    west, south, east, north = transform_bounds("EPSG:3857", "EPSG:4326", left, bottom, right, top)
    return {"images": images, "raster_artifacts": artifacts, "width": width, "height": height, "bounds": [[south, west], [north, east]],
            "legend": LEGEND, "water_legend": [LEGEND[0] | {"label": "Clear · MNDWI ≤ threshold"}, LEGEND[1] | {"label": "Water index > threshold"}, LEGEND[4]],
            "rgb_display": "B04/B03/B02 surface reflectance, common 0–0.30 brightness scale and gamma 2.2. Clouds remain visible in RGB; grey water-mask pixels are excluded.",
            "display_note": "All panels share geographic extent. Continuous images use bilinear display resampling; categorical masks use nearest neighbour. Transparent pixels are outside the study mask. HLS source resolution is 30 m; radar-grid pixels are not independent optical samples. The report also includes an area-weighted score on native HLS cells."}


def build_reference_evidence(run_id, progress=print, output_root=None):
    if not isinstance(run_id, str) or not re.fullmatch(r"[a-f0-9]{32}", run_id):
        raise ValueError("Invalid run ID.")
    folder = Path(output_root or ROOT/"output")/"runs"/run_id
    manifest = json.loads((folder/"run_manifest.json").read_text(encoding="utf-8"))
    if manifest.get("status") != "COMPLETE" or manifest.get("data_source") != "NISAR":
        raise ValueError("Evidence requires a completed real NISAR run.")
    reference = json.loads((folder/"reference_validation.json").read_text(encoding="utf-8"))
    pair = reference.get("comparison")
    if not pair:
        raise ValueError("Run the independent reference check first.")
    observations = json.loads((folder/"observations.json").read_text(encoding="utf-8"))
    selected = next(item for item in observations if item["date"] == pair["event"]["nisar_date"])
    arrays, profile, grid, study = _profile(folder, selected)
    boundary = unary_union([shape(item["geometry"]) for item in json.loads((folder/"site_boundary.geojson").read_text(encoding="utf-8"))["features"]])
    threshold = float(pair["mndwi_threshold"])
    valid = study & np.logical_and.reduce([np.isfinite(values) for values in arrays])
    names = [pair[stage]["scene"] for stage in ("baseline", "event")]
    minimum = reference["coverage"]["minimum_clear_fraction_for_check"]
    alternatives = []
    for attempt in reference.get("selection", {}).get("attempts", []):
        identity_a = _identity({"umm": {"GranuleUR": attempt["baseline_scene"]}})
        identity_b = _identity({"umm": {"GranuleUR": attempt["event_scene"]}})
        if attempt.get("status") != "READ" or attempt.get("common_clear_pixels", 0)/int(study.sum()) < minimum:
            continue
        offset = abs((identity_a["date"]-date.fromisoformat(pair["baseline"]["nisar_date"])).days) + abs((identity_b["date"]-date.fromisoformat(pair["event"]["nisar_date"])).days)
        if [attempt["baseline_scene"], attempt["event_scene"]] != names:
            alternatives.append((offset, -attempt["common_clear_pixels"], attempt["baseline_scene"], attempt["event_scene"]))
    alternate = min(alternatives) if alternatives else None
    needed = list(dict.fromkeys(names + (list(alternate[2:]) if alternate else [])))
    from web_job import authenticate
    authenticate()
    granules = _resolve_scenes(needed, boundary.bounds)
    scenes = {}
    for index, name in enumerate(needed, 1):
        progress(f"Reading optical evidence scene {index}/{len(needed)}: {name}")
        scenes[name] = _read_hls_scene(granules[name], profile, boundary.bounds, details=True, cache_dir=folder/"reference_source_cache")
    before, after = (scenes[name] for name in names)
    common, radar, optical, metrics = compare(grid, valid, before, after, threshold)
    optical_support = area_supported_metrics(grid == 1, valid, study, profile,
        before["native"], after["native"], threshold)
    recorded = reference["metrics"]
    expected = (recorded["true_positive_pixels"], recorded["false_positive_pixels"], recorded["false_negative_pixels"])
    if (metrics["matching_pixels"], metrics["radar_only_pixels"], metrics["optical_only_pixels"]) != expected or int(common.sum()) != reference["coverage"]["common_clear_pixels"]:
        raise ValueError("Rebuilt reference does not reproduce the published counts. Evidence was not published; retry the reference check.")
    transform = profile["transform"]
    pixel_area = area_km2(Polygon([transform @ (0,0),transform @ (1,0),transform @ (1,1),transform @ (0,1)]),profile["crs"])
    candidates = valid & (grid == 1)
    radar_only = radar & ~optical
    states = {
        "water_on_both_optical_dates": radar_only & (before["index"] > threshold) & (after["index"] > threshold),
        "not_water_on_either_optical_date": radar_only & (before["index"] <= threshold) & (after["index"] <= threshold),
        "optical_water_recession": radar_only & (before["index"] > threshold) & (after["index"] <= threshold),
    }
    categories = [{"key": key, "pixels": int(mask.sum()), "area_km2": int(mask.sum())*pixel_area,
                   "fraction_of_radar_only": int(mask.sum())/int(radar_only.sum()) if radar_only.any() else None} for key, mask in states.items()]
    nearest_before, nearest_after = ({**scene, "index": scene["nearest_index"]} for scene in (before, after))
    nearest_common, _, _, nearest_metrics = compare(grid, valid, nearest_before, nearest_after, threshold)
    nearby = distance_transform_edt(~optical, sampling=(abs(transform.e), abs(transform.a))) <= 30 if optical.any() else np.zeros(study.shape, bool)
    alternate_result = None
    if alternate:
        ac, ar, ao, am = compare(grid, valid, scenes[alternate[2]], scenes[alternate[3]], threshold)
        alternate_support = area_supported_metrics(grid == 1, valid, study, profile,
            scenes[alternate[2]]["native"], scenes[alternate[3]]["native"], threshold)
        existing = ar & (scenes[alternate[2]]["index"] > threshold) & (scenes[alternate[3]]["index"] > threshold)
        alternate_result = {"method": "Closest total date offset among previously evaluated pairs meeting the unchanged coverage floor; ties favour larger clear area. Agreement is not used for selection.",
            "baseline_scene": alternate[2], "event_scene": alternate[3],
            "baseline_date": _identity(granules[alternate[2]])["date"].isoformat(), "event_date": _identity(granules[alternate[3]])["date"].isoformat(),
            "total_absolute_offset_days": alternate[0], "common_clear_fraction": int(ac.sum())/int(study.sum()), "metrics": am,
            "candidate_compared_fraction": int(ar.sum())/int(candidates.sum()) if candidates.any() else None,
            "optical_support": alternate_support,
            "already_water_pixels": int(existing.sum()),
            "visuals": _render(folder, profile, study, scenes[alternate[2]], scenes[alternate[3]], ac, ar, ao, threshold, candidates, prefix="alternate_")}
    progress("Rendering optical images, clear coverage and agreement maps")
    rendered = _render(folder, profile, study, before, after, common, radar, optical, threshold, candidates)
    patches = json.loads((folder/selected["patches_file"]).read_text(encoding="utf-8"))
    patch_context = []
    for feature in patches["features"]:
        if feature["properties"]["classification"] != "OPEN_WATER":
            continue
        geometry = transform_geom("EPSG:4326", profile["crs"], feature["geometry"])
        mask = rasterize([(geometry, 1)], out_shape=grid.shape, transform=profile["transform"], fill=0, dtype="uint8") == 1
        assessed = mask & radar
        patch_context.append({"id": feature["properties"]["id"], "area_km2": feature["properties"]["area_km2"],
            "total_pixels": int(mask.sum()), "compared_pixels": int(assessed.sum()),
            "clear_fraction": int(assessed.sum())/int(mask.sum()) if mask.any() else 0,
            "matching_new_water_pixels": int((assessed & optical).sum()),
            "water_on_both_optical_dates_pixels": int((assessed & states["water_on_both_optical_dates"]).sum())})
    report = {"schema_version": 1, "run_id": run_id, "created_at": datetime.now(timezone.utc).isoformat(),
        "baseline_date": manifest["baseline_date"], "event_date": selected["date"],
        "baseline_method": selected.get("baseline_method"), "comparison": pair,
        "reference_status": reference["status"], "reference_validated": False, "counts_reproduced": True,
        "coverage": reference["coverage"], "metrics": metrics,
        "optical_support": optical_support,
        "candidate_coverage": {"total_pixels": int(candidates.sum()), "compared_pixels": int(radar.sum()),
            "unassessed_pixels": int((candidates & ~common).sum()), "compared_fraction": int(radar.sum())/int(candidates.sum()) if candidates.any() else None},
        "radar_only_categories": categories,
        "signal_summary": {key: {"median_hh_before_db": float(np.median(arrays[0][mask])), "median_hh_after_db": float(np.median(arrays[1][mask])),
            "median_delta_hh_db": float(np.median((arrays[1]-arrays[0])[mask]))} for key, mask in {"all_candidates": candidates, "compared_candidates": radar}.items() if mask.any()},
        "resampling_audit": {"method": "Nearest-neighbour index resampling diagnostic, without changing the published bilinear comparison.",
            "common_clear_pixels": int(nearest_common.sum()), "metrics": nearest_metrics},
        "proximity_audit": {"radius_m": 30, "radar_only_pixels_near_optical_change": int((radar_only & nearby).sum()),
            "note": "Proximity is a diagnostic only; it does not change exact-match scores or demonstrate a registration error."},
        "alternate_date_check": alternate_result,
        "patch_context": patch_context,
        "detector_audit": {"finding": "The HH-darkening rule tests backscatter decrease only; it does not test whether a previously dry pixel became water.",
            "existing_water_interpretation": "Water on both optical dates supports a change over existing water rather than independently observed new inundation. The physical cause remains unknown.",
            "quality_limitation": ("This saved measured dB subset does not include its original GCOV numberOfLooks/mask sidecars, so the saved detector run cannot be quality-screened retroactively. New raw-GCOV runs apply finite positive numberOfLooks screening and report the ensemble mask without guessing flag meanings." if not manifest.get("quality_mask_method") or "sidecars unavailable" in manifest.get("quality_mask_method", "") else f"Radar quality screening for this run: {manifest.get('quality_mask_method')}.")},
        "artifacts": ["reference_evidence.json", *rendered["raster_artifacts"], *rendered["images"].values(),
            *(alternate_result["visuals"]["raster_artifacts"] + list(alternate_result["visuals"]["images"].values()) if alternate_result else [])],
        "sources": {name: {"crs": scene["source_crs"], "transform": scene["source_transform"], "shape": scene["source_shape"]} for name, scene in scenes.items()},
        "limitations": ["Optical water on both dates is persistent over this pair, not proof of permanent water.",
            "Radar darkening alone does not distinguish new water from changes in existing water or other scattering changes.",
            "The optical image dates differ from radar dates; this audit cannot isolate the cause of disagreement.",
            "HLS MNDWI is a simple reference rule, not an authoritative flood map or field truth.",
            "Legacy radar-grid confusion counts are retained for reproducibility; native-HLS area-weighted scores use partial radar support per 30 m HLS cell.",
            "No detector thresholds or results were tuned to the optical scores."], **rendered}
    # Store the support-aware score beside the reproducible legacy pixel counts so
    # the application can report the native 30 m comparison without resampling HLS
    # into replicated radar-grid samples.
    reference["optical_support"] = optical_support
    reference["comparison"]["optical_support_method"] = optical_support["support"]
    atomic_json(folder/"reference_validation.json", reference)
    case_path = folder/"case_study.json"
    if case_path.is_file():
        case = json.loads(case_path.read_text(encoding="utf-8"))
        case["reference_validation"] = reference
        atomic_json(case_path, case)
    atomic_json(folder/"reference_evidence.json", report)
    progress(f"Evidence published: {metrics['matching_pixels']} matched, {metrics['radar_only_pixels']} radar-only, {metrics['optical_only_pixels']} optical-only pixels")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    logging.basicConfig(level=logging.WARNING)
    result = build_reference_evidence(parser.parse_args().run_id, progress=lambda message: print(message, flush=True))
    print(json.dumps({key: result[key] for key in ("metrics", "candidate_coverage", "radar_only_categories", "resampling_audit", "proximity_audit", "alternate_date_check")}, indent=2))

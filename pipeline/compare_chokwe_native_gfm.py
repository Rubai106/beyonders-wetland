"""Compare recovered native Chókwè NISAR candidates with close-date GFM.

GFM categorical layers are sampled onto the native NISAR grid with nearest
neighbour resampling. NISAR/GFM no-data, GFM exclusion and reference-water
masks remain separate. This reports positive cross-sensor support only; it
does not calculate accuracy or confusion-matrix metrics.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from pyproj import CRS as PyprojCRS
from rasterio.enums import Resampling
from rasterio.warp import reproject

import discover_chokwe_gfm as discovery
import inspect_chokwe_gfm_pixels as gfm
from recover_chokwe_native import (
    EXPECTED_FREQUENCY,
    EXPECTED_PRODUCT,
    REQUIRED_RUN_FILES,
    SOURCE_BASELINE_SCENE,
    SOURCE_EVENT_SCENE,
    SOURCE_RUN_ID,
    inspect_native_run,
    load_source_package,
)


GFM_COMPARISON_ASSETS = (
    "ensemble_flood_extent",
    "ensemble_likelihood",
    "exclusion_mask",
    "reference_water_mask",
)
DEFAULT_OUTPUT = (
    Path(__file__).resolve().parent
    / "output"
    / "reference-cache"
    / "chokwe_native_gfm_comparison.json"
)


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read recovery evidence file: {path.name}") from error


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_recovery_run_dir(artifact_root: Path) -> Path:
    """Resolve exactly one recovered run folder from a downloaded Actions artifact."""
    root = artifact_root.expanduser().resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Recovery artifact directory does not exist: {root}")
    if (root / "recovery_manifest.json").is_file():
        return root
    candidates = sorted(path.parent for path in root.rglob("recovery_manifest.json"))
    if len(candidates) != 1:
        raise ValueError(
            "Expected exactly one recovery_manifest.json in the downloaded artifact; "
            f"found {len(candidates)}."
        )
    return candidates[0]


def _verify_hash_entries(run_dir: Path, entries: dict, label: str) -> None:
    if not isinstance(entries, dict):
        raise ValueError(f"Recovery manifest {label} hashes are malformed.")
    for name, metadata in entries.items():
        if not isinstance(name, str) or Path(name).name != name:
            raise ValueError(f"Recovery manifest contains an unsafe {label} filename.")
        if not isinstance(metadata, dict):
            raise ValueError(f"Recovery manifest hash metadata is malformed for {name}.")
        path = run_dir / name
        if not path.is_file():
            raise FileNotFoundError(f"Recovered {label} artifact is missing: {name}")
        expected_hash = metadata.get("sha256")
        expected_bytes = metadata.get("bytes")
        if not isinstance(expected_hash, str) or len(expected_hash) != 64:
            raise ValueError(f"Recovery manifest SHA-256 is malformed for {name}.")
        if not isinstance(expected_bytes, int) or expected_bytes < 0:
            raise ValueError(f"Recovery manifest byte count is malformed for {name}.")
        if path.stat().st_size != expected_bytes or _sha256(path) != expected_hash:
            raise ValueError(f"Recovered artifact checksum/size mismatch: {name}")


def read_native_classification(path: Path) -> tuple[np.ndarray, dict]:
    """Read class codes unmasked and return the original native grid metadata."""
    with rasterio.open(path) as src:
        if src.nodata != 0 or src.count != 1 or src.crs is None:
            raise ValueError("Native classification GeoTIFF metadata is invalid.")
        # Do not use masked=True here: code 0 is the valid no-candidate class
        # inside the separately reconstructed native_valid support.
        classification = src.read(1)
        if not np.isin(classification, (0, 1, 2)).all():
            raise ValueError("Native classification contains an undocumented class code.")
        grid = {
            "crs": src.crs,
            "transform": src.transform,
            "width": src.width,
            "height": src.height,
            "shape": classification.shape,
            "nodata_metadata": src.nodata,
        }
    return classification, grid


def load_native_run(run_dir: Path) -> dict:
    """Verify recovery provenance and load native classes/validity without treating 0 as NoData."""
    run_dir = run_dir.expanduser().resolve()
    manifest_path = run_dir / "recovery_manifest.json"
    manifest = _read_json(manifest_path)
    if not isinstance(manifest, dict):
        raise ValueError("Native recovery manifest must be a JSON object.")
    if (
        manifest.get("status") != "RECOVERED_NATIVE_RASTERS"
        or manifest.get("source_published_run_id") != SOURCE_RUN_ID
        or manifest.get("product") != EXPECTED_PRODUCT
        or manifest.get("frequency") != EXPECTED_FREQUENCY
        or manifest.get("baseline_scene") != SOURCE_BASELINE_SCENE
        or manifest.get("event_scene") != SOURCE_EVENT_SCENE
        or manifest.get("baseline_date") != "2026-01-05"
        or manifest.get("event_date") != "2026-01-17"
        or manifest.get("comparison_status") != "NATIVE_NISAR_GFM_COMPARISON_NOT_YET_RUN"
    ):
        raise ValueError("Recovery manifest does not describe the pinned Chókwè NISAR pair.")
    if manifest.get("recovery_is_reprocessing_not_original_binary_restoration") is not True:
        raise ValueError("Recovery manifest does not preserve the reprocessing limitation.")
    reference = manifest.get("reference_validation")
    if (
        not isinstance(reference, dict)
        or reference.get("source_release_status") != "INCONCLUSIVE"
        or reference.get("recomputed_during_recovery") is not False
        or reference.get("reference_validated") is not False
    ):
        raise ValueError("Recovery manifest changed the inherited INCONCLUSIVE reference status.")

    source = load_source_package()
    expected_source_hash_fields = {
        "source_manifest_sha256": "run_manifest",
        "source_observations_sha256": "observations",
        "source_case_study_sha256": "case_study",
        "source_boundary_sha256": "site_boundary",
    }
    for manifest_field, source_field in expected_source_hash_fields.items():
        if manifest.get(manifest_field) != source["source_file_hashes"].get(source_field):
            raise ValueError(f"Recovered source provenance differs from the published {source_field}.")

    recovery_id = manifest.get("recovery_run_id")
    if not isinstance(recovery_id, str) or len(recovery_id) != 32:
        raise ValueError("Recovery manifest has no valid recovery run ID.")
    run_manifest = _read_json(run_dir / "run_manifest.json")
    if (
        not isinstance(run_manifest, dict)
        or run_manifest.get("run_id") != recovery_id
        or run_manifest.get("status") != "COMPLETE"
        or run_manifest.get("baseline_scene") != SOURCE_BASELINE_SCENE
        or run_manifest.get("observation_scenes") != [SOURCE_EVENT_SCENE]
    ):
        raise ValueError("Recovered run manifest does not match the completed pinned NISAR pair.")

    required_hashes = manifest.get("required_artifacts")
    if not isinstance(required_hashes, dict) or set(REQUIRED_RUN_FILES) - set(required_hashes):
        raise ValueError("Recovery manifest omits hashes for required native run files.")
    _verify_hash_entries(run_dir, required_hashes, "native run")
    quality_hashes = manifest.get("gcov_quality_artifacts")
    _verify_hash_entries(run_dir, quality_hashes, "GCOV quality")

    observations = _read_json(run_dir / "observations.json")
    if (
        not isinstance(observations, list)
        or len(observations) != 1
        or not isinstance(observations[0], dict)
        or observations[0].get("date") != "2026-01-17"
        or observations[0].get("scene_name") != SOURCE_EVENT_SCENE
    ):
        raise ValueError("Recovered observations do not contain the exact event granule.")
    observation = observations[0]
    native_summary = inspect_native_run(run_dir, observation)
    declared_native = manifest.get("native_classification")
    if not isinstance(declared_native, dict):
        raise ValueError("Recovery manifest omits native classification grid metadata.")
    for key in (
        "grid",
        "raw_class_value_counts",
        "common_valid_native_pixel_count",
        "valid_no_candidate_pixel_count",
        "valid_open_water_candidate_pixel_count",
        "valid_vegetated_candidate_pixel_count",
    ):
        if declared_native.get(key) != native_summary.get(key):
            raise ValueError(f"Recovered native classification differs from manifest field: {key}")

    class_path = run_dir / "classification_00.tif"
    classification, native_grid = read_native_classification(class_path)

    native_aoi = np.zeros(classification.shape, dtype=bool)
    native_valid = np.ones(classification.shape, dtype=bool)
    with rasterio.open(run_dir / "wetland_mask.tif") as src:
        values = src.read(1, masked=True)
        wetland = np.asarray(values.data)
        wetland_valid = ~np.ma.getmaskarray(values) & np.isfinite(wetland)
        native_aoi = wetland_valid & (wetland == 1)

    raster_map = observation["rasters"]
    for key in ("before_hh", "after_hh", "before_hv", "after_hv"):
        filename = raster_map[key]
        with rasterio.open(run_dir / filename) as src:
            values = src.read(1, masked=True)
            data = np.asarray(values.data)
            valid = ~np.ma.getmaskarray(values) & np.isfinite(data)
            native_valid &= valid
    native_valid &= native_aoi
    if np.any((classification > 0) & ~native_valid):
        raise ValueError("A native candidate is outside the recovered common-valid AOI support.")

    crs = PyprojCRS.from_user_input(native_grid["crs"])
    if not crs.is_projected or len(crs.axis_info) < 2:
        raise ValueError("Native NISAR grid must have a projected horizontal CRS.")
    factors = [axis.unit_conversion_factor for axis in crs.axis_info[:2]]
    transform = native_grid["transform"]
    pixel_area_km2 = (
        abs(transform.a * transform.e - transform.b * transform.d)
        * factors[0] * factors[1] / 1_000_000.0
    )
    if not math.isfinite(pixel_area_km2) or pixel_area_km2 <= 0:
        raise ValueError("Native NISAR pixel area is invalid.")

    return {
        "run_dir": run_dir,
        "recovery_manifest": manifest,
        "native_summary": native_summary,
        "classification": classification,
        "native_aoi": native_aoi,
        "native_valid": native_valid,
        "grid": native_grid,
        "pixel_area_km2": pixel_area_km2,
    }


def resample_gfm_layer_to_native(layer: dict, native_grid: dict) -> dict:
    """Nearest-neighbour sample one GFM value layer and its validity mask to NISAR cells."""
    data = np.asarray(layer["data"])
    valid = np.asarray(layer["valid"], dtype=bool)
    if data.ndim != 2 or valid.shape != data.shape:
        raise ValueError("GFM source data and validity mask must be aligned 2D arrays.")
    if layer.get("transform") is None or not layer.get("grid", {}).get("crs"):
        raise ValueError("GFM source layer lacks a georeferenced raster grid.")

    shape = tuple(native_grid["shape"])
    destination = np.zeros(shape, dtype=data.dtype)
    reproject(
        source=data,
        destination=destination,
        src_transform=layer["transform"],
        src_crs=layer["grid"]["crs"],
        dst_transform=native_grid["transform"],
        dst_crs=native_grid["crs"],
        resampling=Resampling.nearest,
        init_dest_nodata=False,
    )
    destination_valid = np.zeros(shape, dtype=np.uint8)
    reproject(
        source=valid.astype(np.uint8),
        destination=destination_valid,
        src_transform=layer["transform"],
        src_crs=layer["grid"]["crs"],
        src_nodata=0,
        dst_transform=native_grid["transform"],
        dst_crs=native_grid["crs"],
        dst_nodata=0,
        resampling=Resampling.nearest,
        init_dest_nodata=True,
    )
    return {"data": destination, "valid": destination_valid == 1}


def summarize_native_candidate_class(
    classification: np.ndarray,
    native_valid: np.ndarray,
    native_aoi: np.ndarray,
    gfm_layers: dict,
    class_code: int,
    pixel_area_km2: float,
) -> dict:
    """Summarize GFM positive support for one native candidate class; excluded pixels are not negatives."""
    arrays = [classification, native_valid, native_aoi]
    names = GFM_COMPARISON_ASSETS
    if set(gfm_layers) != set(names):
        raise ValueError("Native comparison requires all four GFM layers.")
    arrays.extend(gfm_layers[name]["data"] for name in names)
    arrays.extend(gfm_layers[name]["valid"] for name in names)
    if len({np.asarray(array).shape for array in arrays}) != 1:
        raise ValueError("Native NISAR and resampled GFM arrays must share one grid.")
    if class_code not in (1, 2):
        raise ValueError("Native NISAR candidate class must be OPEN_WATER (1) or VEGETATED (2).")
    if not math.isfinite(pixel_area_km2) or pixel_area_km2 <= 0:
        raise ValueError("Native NISAR pixel area must be finite and positive.")

    flood = np.asarray(gfm_layers["ensemble_flood_extent"]["data"])
    likelihood = np.asarray(gfm_layers["ensemble_likelihood"]["data"])
    exclusion = np.asarray(gfm_layers["exclusion_mask"]["data"])
    reference_water = np.asarray(gfm_layers["reference_water_mask"]["data"])
    flood_valid = np.asarray(gfm_layers["ensemble_flood_extent"]["valid"], dtype=bool)
    likelihood_valid = np.asarray(gfm_layers["ensemble_likelihood"]["valid"], dtype=bool)
    exclusion_valid = np.asarray(gfm_layers["exclusion_mask"]["valid"], dtype=bool)
    reference_valid = np.asarray(gfm_layers["reference_water_mask"]["valid"], dtype=bool)

    for label, values, valid, allowed in (
        ("ensemble flood", flood, flood_valid, (0, 1)),
        ("exclusion mask", exclusion, exclusion_valid, (0, 1)),
        ("reference-water mask", reference_water, reference_valid, (0, 1, 2)),
    ):
        if not np.isin(values[valid], allowed).all():
            raise ValueError(f"Resampled GFM {label} contains undocumented valid values.")
    if not np.isfinite(likelihood[likelihood_valid]).all() or (
        (likelihood[likelihood_valid] < 0) | (likelihood[likelihood_valid] > 100)
    ).any():
        raise ValueError("Resampled GFM likelihood must be within [0, 100] on valid cells.")

    candidate = (
        (classification == class_code)
        & np.asarray(native_valid, dtype=bool)
        & np.asarray(native_aoi, dtype=bool)
    )
    common_gfm_valid = flood_valid & likelihood_valid & exclusion_valid & reference_valid
    has_gfm = candidate & common_gfm_valid
    no_gfm = candidate & ~common_gfm_valid
    excluded = has_gfm & (exclusion == 1)
    permanent_reference = has_gfm & (reference_water == 1)
    seasonal_reference = has_gfm & (reference_water == 2)
    reference = permanent_reference | seasonal_reference
    eligible = has_gfm & (exclusion == 0) & (reference_water == 0)
    positive = eligible & (flood == 1)
    not_mapped_flood = eligible & (flood == 0)

    def count(mask: np.ndarray) -> int:
        return int(np.count_nonzero(mask))

    positive_likelihood = likelihood[positive]
    likelihood_summary = None
    if positive_likelihood.size:
        likelihood_summary = {
            "count": int(positive_likelihood.size),
            "minimum": float(np.min(positive_likelihood)),
            "median": float(np.median(positive_likelihood)),
            "mean": float(np.mean(positive_likelihood)),
            "maximum": float(np.max(positive_likelihood)),
            "below_50_count": int(np.count_nonzero(positive_likelihood < 50)),
            "histogram": gfm.value_histogram(positive_likelihood),
        }

    candidate_count = count(candidate)
    eligible_count = count(eligible)
    positive_count = count(positive)
    return {
        "native_class_code": class_code,
        "candidate_pixels_on_native_grid": candidate_count,
        "candidate_area_km2_on_native_grid": candidate_count * pixel_area_km2,
        "candidate_pixels_without_common_valid_gfm_data": count(no_gfm),
        "candidate_pixels_with_common_valid_gfm_data": count(has_gfm),
        "candidate_pixels_in_gfm_exclusion_mask": count(excluded),
        "candidate_pixels_in_gfm_reference_water": count(reference),
        "candidate_pixels_in_gfm_permanent_reference_water": count(permanent_reference),
        "candidate_pixels_in_gfm_seasonal_reference_water": count(seasonal_reference),
        "candidate_pixels_in_both_exclusion_and_reference_water": count(excluded & reference),
        "eligible_candidate_pixels_after_gfm_masks": eligible_count,
        "eligible_candidate_area_km2": eligible_count * pixel_area_km2,
        "gfm_flood_positive_overlap_pixels": positive_count,
        "gfm_flood_positive_overlap_area_km2": positive_count * pixel_area_km2,
        "fraction_of_eligible_candidates_with_gfm_flood_support": (
            positive_count / eligible_count if eligible_count else None
        ),
        "eligible_candidates_not_mapped_as_gfm_flood": count(not_mapped_flood),
        "positive_overlap_gfm_likelihood": likelihood_summary,
        "denominator_note": (
            "The denominator is native NISAR candidate pixels with common-valid sampled GFM flood, "
            "likelihood, exclusion and reference-water data, outside GFM exclusion and permanent/"
            "seasonal reference water. NISAR/GFM no-data, excluded and reference-water cells are "
            "reported separately and are not treated as negative reference labels."
        ),
    }


def compare_native_candidates(native: dict, item: dict, asset_urls: dict) -> dict:
    """Compare native NISAR class pixels with the selected close-date GFM raster layers."""
    loaded = {}
    grid = None
    for name in GFM_COMPARISON_ASSETS:
        url = asset_urls.get(name)
        if not isinstance(url, str):
            raise ValueError(f"Selected GFM item is missing required asset: {name}")
        loaded[name] = gfm.read_asset_window(url, expected_grid=grid)
        if grid is None:
            grid = loaded[name]["grid"]
    base = loaded["ensemble_flood_extent"]
    for name, layer in loaded.items():
        if (
            layer["grid"] != base["grid"]
            or layer["window"] != base["window"]
            or layer["transform"] != base["transform"]
            or layer["data"].shape != base["data"].shape
        ):
            raise ValueError(f"GFM {name} is not aligned to the ensemble flood grid.")

    sampled = {
        name: resample_gfm_layer_to_native(layer, native["grid"])
        for name, layer in loaded.items()
    }
    classification = native["classification"]
    native_valid = native["native_valid"]
    native_aoi = native["native_aoi"]
    if classification.shape != tuple(native["grid"]["shape"]):
        raise ValueError("Native classification does not match its declared grid.")
    summaries = {
        "OPEN_WATER": summarize_native_candidate_class(
            classification, native_valid, native_aoi, sampled, 1, native["pixel_area_km2"]
        ),
        "VEGETATED": summarize_native_candidate_class(
            classification, native_valid, native_aoi, sampled, 2, native["pixel_area_km2"]
        ),
    }
    all_candidates = (
        (classification > 0)
        & native_valid.astype(bool)
        & native_aoi.astype(bool)
    )
    common_gfm = np.ones(classification.shape, dtype=bool)
    for layer in sampled.values():
        common_gfm &= layer["valid"].astype(bool)
    native_aoi_count = int(np.count_nonzero(native_aoi))
    supported_aoi = native_aoi.astype(bool) & common_gfm
    flood = sampled["ensemble_flood_extent"]["data"]
    exclusion = sampled["exclusion_mask"]["data"]
    reference_water = sampled["reference_water_mask"]["data"]
    eligible_aoi = (
        supported_aoi
        & (exclusion == 0)
        & (reference_water == 0)
    )
    pixel_area = native["pixel_area_km2"]
    native_grid = native["grid"]
    grid_transform = native_grid["transform"]

    return {
        "status": "NATIVE_GRID_POSITIVE_SUPPORT_AUDITED",
        "gfm_item": {
            "id": item.get("id"),
            "datetime": item.get("properties", {}).get("datetime"),
            "minutes_from_nisar_event": round((
                datetime.fromisoformat(item["properties"]["datetime"].replace("Z", "+00:00"))
                - datetime.fromisoformat("2026-01-17T03:42:32+00:00")
            ).total_seconds() / 60, 2),
            "gfm_nrt_version": base["raster"]["tags"].get("gfm_nrt_version"),
            "source_crs": base["grid"]["crs"],
            "source_pixel_size": [
                abs(base["transform"].a),
                abs(base["transform"].e),
            ],
        },
        "native_nisar_grid": {
            "crs": native_grid["crs"].to_string(),
            "width": int(native_grid["width"]),
            "height": int(native_grid["height"]),
            "transform": [float(value) for value in grid_transform[:6]],
            "pixel_area_km2": pixel_area,
            "candidate_class_counts": native["native_summary"]["raw_class_value_counts"],
            "common_valid_native_pixel_count": native["native_summary"]["common_valid_native_pixel_count"],
            "class_zero_handling": {
                "geo_tiff_nodata_metadata": native["grid"]["nodata_metadata"],
                "meaning_within_native_valid_support": "Valid no-candidate class; not NoData.",
                "valid_no_candidate_pixel_count": native["native_summary"]["valid_no_candidate_pixel_count"],
                "consumer_rule": (
                    "Read classification_00.tif unmasked and apply native_valid derived from "
                    "the four masked HH/HV inputs and the wetland/AOI mask. Do not use the "
                    "GeoTIFF nodata metadata alone to determine class-zero validity."
                ),
            },
        },
        "alignment": {
            "method": "Nearest-neighbour sampling of each GFM layer and its validity mask onto the native NISAR grid.",
            "categorical_layers": [
                "ensemble_flood_extent",
                "exclusion_mask",
                "reference_water_mask",
            ],
            "sampled_continuous_layer": "ensemble_likelihood (0–100)",
            "grid_of_record": "Native NISAR classification GeoTIFF; no NISAR raster is resampled.",
            "validity_rule": "Each GFM asset validity mask is sampled separately; a target cell is common-valid only when all four sampled layers are valid.",
        },
        "native_aoi_support": {
            "native_aoi_pixel_count": native_aoi_count,
            "native_common_valid_input_pixel_count": int(np.count_nonzero(native_valid)),
            "native_aoi_pixels_with_common_valid_gfm_data": int(np.count_nonzero(supported_aoi)),
            "native_aoi_pixels_without_common_valid_gfm_data": int(
                native_aoi_count - np.count_nonzero(supported_aoi)
            ),
            "gfm_common_valid_fraction_of_native_aoi": (
                int(np.count_nonzero(supported_aoi)) / native_aoi_count
                if native_aoi_count else None
            ),
            "gfm_flood_pixels_after_exclusion_and_reference_water_masks": int(
                np.count_nonzero(eligible_aoi & (flood == 1))
            ),
        },
        "candidate_comparison_by_native_class": summaries,
        "all_native_candidates": {
            "candidate_pixel_count": int(np.count_nonzero(all_candidates)),
            "candidate_area_km2": int(np.count_nonzero(all_candidates)) * pixel_area,
            "eligible_candidate_pixel_count": sum(
                summaries[name]["eligible_candidate_pixels_after_gfm_masks"]
                for name in summaries
            ),
            "gfm_flood_positive_overlap_pixel_count": sum(
                summaries[name]["gfm_flood_positive_overlap_pixels"]
                for name in summaries
            ),
        },
        "interpretation_limits": [
            "This is positive-only spatial support between native NISAR radar-change candidates and an independent Sentinel-1 GFM algorithm product.",
            "It is not field validation, not an accuracy assessment, and not precision, recall or F1.",
            "GFM non-flood cells are not treated as ground-truth negatives for NISAR; the sensors and algorithms differ.",
            "NISAR/GFM no-data, GFM exclusion and permanent/seasonal reference-water cells are not counted as negative labels.",
            "The original public HLS optical reference remains INCONCLUSIVE; this comparison does not upgrade it.",
            "The analysis box is the published operator-selected rectangle, not an authoritative flood or wetland boundary.",
            "The comparison uses the reprocessed native NISAR grid; recovery is reprocessing, not restoration of the original TIFF bytes.",
        ],
    }


def select_best_event_item(items: list[dict]) -> tuple[dict, dict]:
    """Select the 17 January item with the largest source-valid ensemble-flood AOI fraction."""
    selected = gfm.select_event_items(items)
    scored = []
    for item in selected:
        assets = item.get("assets")
        asset = assets.get("ensemble_flood_extent") if isinstance(assets, dict) else None
        if not isinstance(asset, dict):
            continue
        url = gfm._safe_asset_url(asset, str(item.get("id", "unknown")), "ensemble_flood_extent")
        inspected = gfm.inspect_asset(url)
        coverage = inspected.get("coverage", {})
        fraction = coverage.get("valid_fraction_of_aoi")
        scored.append((float(fraction or 0.0), item))
    if not scored:
        raise ValueError("No 17 January GFM item has a usable ensemble_flood_extent asset.")
    _, best = max(scored, key=lambda pair: pair[0])
    assets = best.get("assets")
    urls = {}
    for name in GFM_COMPARISON_ASSETS:
        asset = assets.get(name) if isinstance(assets, dict) else None
        if not isinstance(asset, dict):
            raise ValueError(f"Selected GFM item is missing required asset: {name}")
        urls[name] = gfm._safe_asset_url(asset, str(best.get("id", "unknown")), name)
    return best, urls


def build_report(native_run_dir: Path, items: list[dict]) -> dict:
    native = load_native_run(native_run_dir)
    best_item, urls = select_best_event_item(items)
    comparison = compare_native_candidates(native, best_item, urls)
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_recovery": {
            "source_published_run_id": SOURCE_RUN_ID,
            "recovery_run_id": native["recovery_manifest"]["recovery_run_id"],
            "recovery_manifest_sha256": _sha256(native["run_dir"] / "recovery_manifest.json"),
            "native_run_directory": native["run_dir"].name,
        },
        "comparison": comparison,
        "status": "NATIVE_GRID_POSITIVE_SUPPORT_AUDIT_COMPLETE",
        "accuracy_metrics": {
            "precision": None,
            "recall": None,
            "f1": None,
            "accuracy": None,
            "reason": "GFM is an independent algorithmic satellite product, not field truth.",
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--recovery-artifact-root",
        type=Path,
        required=True,
        help="Downloaded private recovery artifact root containing exactly one recovery_manifest.json.",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    try:
        run_dir = resolve_recovery_run_dir(args.recovery_artifact_root)
        payload = discovery.build_search_payload("2026-01-17", "2026-01-17")
        items = discovery.fetch_stac_items(payload)
        report = build_report(run_dir, items)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
            encoding="utf-8",
        )
    except Exception as error:
        print(f"Native Chókwè/GFM comparison failed: {error}", file=sys.stderr)
        return 2

    comparison = report["comparison"]
    print("Status:", report["status"])
    print("GFM item:", comparison["gfm_item"]["id"], comparison["gfm_item"]["datetime"])
    print("Native NISAR grid:", comparison["native_nisar_grid"]["crs"],
          comparison["native_nisar_grid"]["width"], "x", comparison["native_nisar_grid"]["height"])
    for class_name, summary in comparison["candidate_comparison_by_native_class"].items():
        print(class_name, json.dumps(summary, ensure_ascii=False))
    print("No precision, recall, F1 or accuracy metrics were calculated.")
    print("Saved native-grid positive-support audit:", args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Validate a reviewed Dynamic World artifact before optional SME2 crop-area analysis.

This is a provenance and raster-integrity gate, not a scientific validation of
the Dynamic World crop class or a ground-truth accuracy assessment.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from rasterio.crs import CRS

DATASET = "GOOGLE/DYNAMICWORLD/V1"
PROBABILITY_FILE = "dynamic-world-crops-probability.tif"
COUNT_FILE = "dynamic-world-valid-observation-count.tif"
MANIFEST_FILE = "dynamic-world-source-manifest.json"
NODATA = -9999.0
EXPECTED_CRS = CRS.from_epsg(6933)
EXPECTED_PIXEL_AREA_M2 = 100.0
GRID_TOLERANCE = 1e-6


class ArtifactValidationError(RuntimeError):
    """Raised when an upstream crop-evidence artifact is unsafe or inconsistent."""


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ArtifactValidationError(f"{label} is missing or is not valid JSON.") from exc
    if not isinstance(value, dict):
        raise ArtifactValidationError(f"{label} must contain a JSON object.")
    return value


def _iso_date(value: Any, label: str) -> date:
    if not isinstance(value, str):
        raise ArtifactValidationError(f"{label} must be an ISO YYYY-MM-DD date.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ArtifactValidationError(f"{label} must be an ISO YYYY-MM-DD date.") from exc
    if parsed.isoformat() != value:
        raise ArtifactValidationError(f"{label} must use exact zero-padded YYYY-MM-DD format.")
    return parsed


def _finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool):
        raise ArtifactValidationError(f"{label} must be a finite number.")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ArtifactValidationError(f"{label} must be a finite number.") from exc
    if not math.isfinite(number):
        raise ArtifactValidationError(f"{label} must be a finite number.")
    return number


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _required_file(root: Path, name: str) -> Path:
    path = root / name
    if path.is_symlink() or not path.is_file() or path.resolve().parent != root.resolve():
        raise ArtifactValidationError(f"Artifact is missing the expected regular file: {name}")
    if path.stat().st_size <= 0:
        raise ArtifactValidationError(f"Artifact file is empty: {name}")
    return path


def _near_sequence(actual: Any, expected: Any, label: str) -> None:
    if not isinstance(actual, list) or not isinstance(expected, list) or len(actual) != len(expected):
        raise ArtifactValidationError(f"{label} metadata does not match the GeoTIFF.")
    for left, right in zip(actual, expected):
        if not math.isclose(_finite_number(left, label), _finite_number(right, label),
                            rel_tol=0.0, abs_tol=GRID_TOLERANCE):
            raise ArtifactValidationError(f"{label} metadata does not match the GeoTIFF.")


def _validate_manifest_and_series(
    manifest: dict[str, Any],
    search: dict[str, Any],
    receipt: dict[str, Any],
) -> tuple[dict[str, Any], list[str], float, int]:
    if manifest.get("schema_version") != 1 or manifest.get("dataset") != DATASET:
        raise ArtifactValidationError("Unsupported Dynamic World manifest schema or dataset.")
    if manifest.get("class") != "crops":
        raise ArtifactValidationError("The artifact is not the Dynamic World crops-probability band.")
    interpretation = manifest.get("class_interpretation")
    if not isinstance(interpretation, str) or "generic" not in interpretation.lower():
        raise ArtifactValidationError("Crop class interpretation is missing its generic-cropland limitation.")

    run_id = search.get("run_id")
    if not isinstance(run_id, str) or not run_id or receipt.get("run_id") != run_id:
        raise ArtifactValidationError("SME2 search and download receipts do not belong to the same run.")
    series_id = receipt.get("series_id")
    series_list = search.get("compatible_series")
    if not isinstance(series_id, str) or not isinstance(series_list, list):
        raise ArtifactValidationError("SME2 download receipt has no selected compatible series.")
    selected = [item for item in series_list if isinstance(item, dict) and item.get("series_id") == series_id]
    if len(selected) != 1:
        raise ArtifactValidationError("The downloaded SME2 series is not uniquely present in its saved search manifest.")
    dates = selected[0].get("dates")
    if not isinstance(dates, list) or not dates:
        raise ArtifactValidationError("The selected SME2 series has no acquisition dates.")
    parsed_sme_dates = [_iso_date(value, "SME2 acquisition date") for value in dates]
    if parsed_sme_dates != sorted(set(parsed_sme_dates)):
        raise ArtifactValidationError("Selected SME2 dates must be unique and chronologically sorted.")

    source_aoi, target_aoi = manifest.get("aoi_wgs84"), search.get("aoi")
    if not isinstance(source_aoi, dict) or not isinstance(target_aoi, dict):
        raise ArtifactValidationError("Dynamic World and SME2 AOI metadata are missing.")
    for key in ("west", "south", "east", "north"):
        source_value = _finite_number(source_aoi.get(key), f"Dynamic World AOI {key}")
        target_value = _finite_number(target_aoi.get(key), f"SME2 AOI {key}")
        if not math.isclose(source_value, target_value, rel_tol=0.0, abs_tol=1e-7):
            raise ArtifactValidationError(f"Dynamic World AOI does not match the SME2 AOI ({key}).")

    window = manifest.get("requested_window")
    if not isinstance(window, dict):
        raise ArtifactValidationError("Dynamic World requested date window is missing.")
    window_start = _iso_date(window.get("start"), "Dynamic World window start")
    window_end = _iso_date(window.get("end"), "Dynamic World window end")
    if window_start > window_end:
        raise ArtifactValidationError("Dynamic World date window is reversed.")
    if window_start > parsed_sme_dates[0] or window_end < parsed_sme_dates[-1]:
        raise ArtifactValidationError(
            "Dynamic World composite window must cover every selected SME2 acquisition date."
        )

    observations = manifest.get("source_observations")
    composite = manifest.get("composite")
    if not isinstance(observations, dict) or not isinstance(composite, dict):
        raise ArtifactValidationError("Dynamic World observation/composite provenance is incomplete.")
    if composite.get("method") != "PIXELWISE_MEDIAN_OF_DAILY_MEDIANS":
        raise ArtifactValidationError("Dynamic World composite method is not the expected daily-median method.")
    acquisition_dates = observations.get("acquisition_dates")
    if not isinstance(acquisition_dates, list) or not acquisition_dates:
        raise ArtifactValidationError("Dynamic World manifest has no distinct acquisition dates.")
    parsed_dates = [_iso_date(value, "Dynamic World acquisition date") for value in acquisition_dates]
    if parsed_dates != sorted(set(parsed_dates)):
        raise ArtifactValidationError("Dynamic World acquisition dates must be unique and chronologically sorted.")
    unique_count = observations.get("unique_acquisition_date_count")
    scene_count = observations.get("scene_record_count")
    image_ids = observations.get("source_image_ids")
    if (isinstance(unique_count, bool) or unique_count != len(parsed_dates)
            or isinstance(scene_count, bool) or not isinstance(scene_count, int)
            or scene_count < unique_count
            or not isinstance(image_ids, list) or len(image_ids) != scene_count
            or any(not isinstance(item, str) or not item for item in image_ids)):
        raise ArtifactValidationError("Dynamic World source image/date counts are internally inconsistent.")
    if (observations.get("first_acquisition_date") != parsed_dates[0].isoformat()
            or observations.get("latest_acquisition_date") != parsed_dates[-1].isoformat()):
        raise ArtifactValidationError("Dynamic World first/latest acquisition dates do not match the date list.")
    if parsed_dates[0] < window_start or parsed_dates[-1] > window_end:
        raise ArtifactValidationError("Dynamic World source scenes fall outside the requested window.")
    if composite.get("distinct_acquisition_dates") != len(parsed_dates):
        raise ArtifactValidationError("Dynamic World composite date count does not match source observations.")
    date_gaps = [(right - left).days for left, right in zip(parsed_dates, parsed_dates[1:])]
    expected_maximum_gap = max(date_gaps) if date_gaps else None
    if observations.get("maximum_gap_between_acquisition_dates_days") != expected_maximum_gap:
        raise ArtifactValidationError("Dynamic World maximum acquisition-date gap is inconsistent.")

    minimum = composite.get("minimum_valid_dates_per_pixel")
    if (isinstance(minimum, bool) or not isinstance(minimum, int)
            or minimum < 1 or minimum > len(parsed_dates)):
        raise ArtifactValidationError("Dynamic World per-pixel minimum observation count is invalid.")
    threshold = _finite_number(manifest.get("downstream_probability_threshold"),
                               "Downstream crop-probability threshold")
    if not 0 <= threshold <= 1:
        raise ArtifactValidationError("Downstream crop-probability threshold must be in [0, 1].")

    recency = composite.get("recency_assessment")
    if not isinstance(recency, dict):
        raise ArtifactValidationError("Dynamic World source-recency assessment is missing.")
    if observations.get("recency_cue_days") != 18 or recency.get("cue_days") != 18:
        raise ArtifactValidationError("Dynamic World 18-day recency cue metadata is inconsistent.")
    latest_gap = (window_end - parsed_dates[-1]).days
    if (observations.get("days_from_latest_scene_to_requested_end") != latest_gap
            or recency.get("days_from_latest_scene_to_requested_end") != latest_gap):
        raise ArtifactValidationError("Dynamic World latest-scene recency metadata is inconsistent.")
    status = "RECENT_WITHIN_18_DAY_WINDOW" if latest_gap <= 18 else "STALE_MORE_THAN_18_DAYS_BEFORE_WINDOW_END"
    if (manifest.get("status") != status or observations.get("status") != status
            or recency.get("status") != status):
        raise ArtifactValidationError("Dynamic World recency status does not match its source dates.")
    # A stale cue is deliberately reported, not rejected: 18 days is descriptive,
    # not a scientifically validated acceptance threshold.
    return window, [item.isoformat() for item in parsed_dates], threshold, minimum, run_id, series_id


def _check_grid(dataset: rasterio.DatasetReader, grid: dict[str, Any], label: str) -> None:
    if not isinstance(grid, dict):
        raise ArtifactValidationError(f"{label} grid metadata is missing.")
    if (dataset.width != grid.get("width") or dataset.height != grid.get("height")
            or dataset.crs is None or dataset.crs.to_string() != grid.get("crs")):
        raise ArtifactValidationError(f"{label} raster dimensions or CRS do not match its manifest.")
    _near_sequence(list(dataset.transform)[:6], grid.get("transform"), f"{label} affine transform")
    _near_sequence(
        [dataset.bounds.left, dataset.bounds.bottom, dataset.bounds.right, dataset.bounds.top],
        grid.get("bounds"), f"{label} bounds",
    )


def validate_dynamic_world_artifact(
    artifact_dir: Path,
    search_manifest_path: Path,
    download_receipt_path: Path,
) -> dict[str, Any]:
    artifact_dir = Path(artifact_dir).resolve()
    if not artifact_dir.is_dir():
        raise ArtifactValidationError("Dynamic World artifact directory does not exist.")
    manifest_path = _required_file(artifact_dir, MANIFEST_FILE)
    probability_path = _required_file(artifact_dir, PROBABILITY_FILE)
    count_path = _required_file(artifact_dir, COUNT_FILE)
    manifest = _read_json(manifest_path, "Dynamic World source manifest")
    search = _read_json(Path(search_manifest_path), "SME2 search manifest")
    receipt = _read_json(Path(download_receipt_path), "SME2 download receipt")
    window, acquisition_dates, threshold, minimum, run_id, series_id = _validate_manifest_and_series(
        manifest, search, receipt,
    )

    export = manifest.get("export")
    if not isinstance(export, dict):
        raise ArtifactValidationError("Dynamic World export integrity metadata is missing.")
    expected_files = (
        (probability_path, "probability_file", "probability_sha256", "probability_bytes"),
        (count_path, "observation_count_file", "observation_count_sha256", "observation_count_bytes"),
    )
    for path, file_key, hash_key, bytes_key in expected_files:
        if export.get(file_key) != path.name:
            raise ArtifactValidationError(f"Dynamic World manifest references an unexpected {file_key}.")
        if export.get(bytes_key) != path.stat().st_size or export.get(hash_key) != _sha256(path):
            raise ArtifactValidationError(f"Dynamic World artifact checksum/byte-count mismatch: {path.name}")
    if export.get("crs") != "EPSG:6933" or export.get("pixel_size_metres") != 10:
        raise ArtifactValidationError("Dynamic World export must be 10 m in EPSG:6933.")

    probability_grid = export.get("probability_grid")
    count_grid = export.get("observation_count_grid")
    if not isinstance(probability_grid, dict) or not isinstance(count_grid, dict):
        raise ArtifactValidationError("Dynamic World raster grid statistics are missing.")

    valid_pixels = 0
    total_pixels = 0
    count_min = None
    count_max = None
    count_nonzero = 0
    count_meeting_minimum = 0
    probability_min = math.inf
    probability_max = -math.inf

    try:
        with rasterio.open(probability_path) as probability, rasterio.open(count_path) as counts:
            if probability.count != 1 or probability.dtypes[0] != "float32":
                raise ArtifactValidationError("Dynamic World probability raster must be one float32 band.")
            if probability.crs != EXPECTED_CRS or probability.nodata is None or probability.nodata != NODATA:
                raise ArtifactValidationError("Dynamic World probability raster must use EPSG:6933 and nodata=-9999.")
            if counts.count != 1 or counts.dtypes[0] != "uint16":
                raise ArtifactValidationError("Dynamic World observation-count raster must be one uint16 band.")
            if counts.crs != EXPECTED_CRS or counts.nodata is not None:
                raise ArtifactValidationError("Dynamic World count raster must use EPSG:6933 and preserve zero counts.")
            if (probability.width != counts.width or probability.height != counts.height
                    or probability.crs != counts.crs
                    or any(not math.isclose(float(a), float(b), rel_tol=0.0, abs_tol=GRID_TOLERANCE)
                           for a, b in zip(list(probability.transform)[:6], list(counts.transform)[:6]))
                    or any(not math.isclose(float(a), float(b), rel_tol=0.0, abs_tol=GRID_TOLERANCE)
                           for a, b in zip(
                               [probability.bounds.left, probability.bounds.bottom, probability.bounds.right, probability.bounds.top],
                               [counts.bounds.left, counts.bounds.bottom, counts.bounds.right, counts.bounds.top],
                           ))):
                raise ArtifactValidationError("Probability and count rasters are not on the identical grid.")
            if probability.width > 10_000 or probability.height > 10_000:
                raise ArtifactValidationError("Dynamic World raster exceeds the validated 10,000-pixel grid limit.")
            _check_grid(probability, probability_grid, "Probability")
            _check_grid(counts, count_grid, "Observation-count")
            pixel_area = abs(
                probability.transform.a * probability.transform.e
                - probability.transform.b * probability.transform.d
            )
            if not math.isclose(pixel_area, EXPECTED_PIXEL_AREA_M2, rel_tol=0.0, abs_tol=0.05):
                raise ArtifactValidationError("Dynamic World raster pixels are not the expected 10 m equal-area cells.")

            probability_tags = probability.tags()
            count_tags = counts.tags()
            required_tags = {
                "DATASET": DATASET,
                "PROBABILITY_BAND": "crops",
                "SOURCE_WINDOW_START": window["start"],
                "SOURCE_WINDOW_END": window["end"],
                "MINIMUM_OBSERVATIONS_PER_PIXEL": str(minimum),
                "PROBABILITY_THRESHOLD_FOR_DOWNSTREAM_AUDIT": str(threshold),
                "SOURCE_CRS": "EPSG:6933",
                "SOURCE_PIXEL_SIZE_METRES": "10",
            }
            for key, value in required_tags.items():
                if probability_tags.get(key) != value or count_tags.get(key) != value:
                    raise ArtifactValidationError(f"Dynamic World raster provenance tag mismatch: {key}")

            for _, block_window in probability.block_windows(1):
                probability_values = probability.read(1, window=block_window).astype("float64")
                probability_valid = probability.read_masks(1, window=block_window) > 0
                count_values = counts.read(1, window=block_window).astype("uint32")
                count_valid = counts.read_masks(1, window=block_window) > 0
                if not np.all(count_valid):
                    raise ArtifactValidationError("Observation-count raster must retain valid zero-count cells.")
                if np.any(count_values > len(acquisition_dates)):
                    raise ArtifactValidationError("Observation-count raster exceeds the number of source dates.")
                expected_probability_valid = count_values >= minimum
                if np.any(probability_valid != expected_probability_valid):
                    raise ArtifactValidationError(
                        "Probability NoData mask does not match the per-pixel minimum observation-count rule."
                    )
                if np.any(probability_valid & (
                    ~np.isfinite(probability_values) | (probability_values < 0) | (probability_values > 1)
                )):
                    raise ArtifactValidationError("Dynamic World probability raster contains values outside [0, 1].")
                values = probability_values[probability_valid]
                if values.size:
                    probability_min = min(probability_min, float(values.min()))
                    probability_max = max(probability_max, float(values.max()))
                valid_pixels += int(probability_valid.sum())
                total_pixels += int(probability_valid.size)
                count_nonzero += int(np.count_nonzero(count_values))
                count_meeting_minimum += int(np.count_nonzero(expected_probability_valid))
                local_min, local_max = int(count_values.min()), int(count_values.max())
                count_min = local_min if count_min is None else min(count_min, local_min)
                count_max = local_max if count_max is None else max(count_max, local_max)
    except ArtifactValidationError:
        raise
    except Exception as exc:
        raise ArtifactValidationError(f"Could not read the Dynamic World GeoTIFF evidence: {exc}") from exc

    if total_pixels <= 0 or valid_pixels <= 0:
        raise ArtifactValidationError("Dynamic World probability raster has no valid pixels.")
    checks = (
        (probability_grid.get("valid_probability_pixels"), valid_pixels, "probability valid-pixel count"),
        (probability_grid.get("export_grid_pixels"), total_pixels, "probability grid-pixel count"),
        (count_grid.get("minimum_valid_date_count"), count_min, "count minimum"),
        (count_grid.get("maximum_valid_date_count"), count_max, "count maximum"),
        (count_grid.get("pixels_with_any_valid_observation"), count_nonzero, "count nonzero-pixel count"),
        (count_grid.get("pixels_meeting_minimum_observations"), count_meeting_minimum, "count threshold-pixel count"),
    )
    for actual, expected, label in checks:
        if actual != expected:
            raise ArtifactValidationError(f"Dynamic World manifest has an inconsistent {label}.")
    recorded_fraction = _finite_number(
        probability_grid.get("valid_probability_fraction"), "Valid probability fraction"
    )
    if not math.isclose(recorded_fraction, valid_pixels / total_pixels, rel_tol=0.0, abs_tol=1e-8):
        raise ArtifactValidationError("Dynamic World valid probability fraction does not match the raster.")
    if not math.isclose(
        _finite_number(probability_grid.get("pixel_area_m2"), "Probability pixel area"),
        pixel_area, rel_tol=0.0, abs_tol=0.05,
    ):
        raise ArtifactValidationError("Dynamic World manifest pixel-area metadata does not match the rasters.")

    source_label = (
        f"Dynamic World {DATASET} crops probability median composite "
        f"({window['start']} to {window['end']})"
    )
    return {
        "status": "VALIDATED_FOR_OPTIONAL_SME2_AREA_AUDIT",
        "dataset": DATASET,
        "class": "crops",
        "class_interpretation": "Generic cropland likelihood; not rice-specific or field-level ground truth.",
        "requested_window": window,
        "aoi_wgs84": manifest["aoi_wgs84"],
        "source_acquisition_dates": acquisition_dates,
        "unique_acquisition_dates": len(acquisition_dates),
        "minimum_valid_dates_per_pixel": minimum,
        "probability_threshold": threshold,
        "valid_probability_pixels": valid_pixels,
        "export_grid_pixels": total_pixels,
        "valid_probability_fraction": valid_pixels / total_pixels,
        "probability_range": [probability_min, probability_max],
        "latest_scene_recency": manifest["composite"]["recency_assessment"],
        "manifest_sha256": _sha256(manifest_path),
        "probability_sha256": _sha256(probability_path),
        "observation_count_sha256": _sha256(count_path),
        "sme2_run_id": run_id,
        "sme2_series_id": series_id,
        "source_label": source_label,
        "interpretation_limit": (
            "This is a generic cropland-likelihood composite, not crop-species identification, "
            "verified parcel boundaries, independent field validation, or ground truth."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--search-manifest", type=Path, required=True)
    parser.add_argument("--download-receipt", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args(argv)
    try:
        result = validate_dynamic_world_artifact(
            args.artifact_dir, args.search_manifest, args.download_receipt,
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if args.github_output:
            with args.github_output.open("a", encoding="utf-8") as handle:
                handle.write(f"probability_threshold={result['probability_threshold']:.6f}\n")
                handle.write(f"source_label={result['source_label']}\n")
        print(
            "Dynamic World artifact passed integrity, provenance, AOI, temporal-coverage, "
            f"and SME2-grid preflight ({result['valid_probability_fraction']:.1%} valid source pixels)."
        )
        print("Generic cropland likelihood remains unvalidated ground context; SME2 analysis is still exploratory.")
        return 0
    except (ArtifactValidationError, OSError, ValueError, TypeError, KeyError) as exc:
        print(f"DYNAMIC WORLD ARTIFACT VALIDATION ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

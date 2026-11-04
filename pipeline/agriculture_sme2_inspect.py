#!/usr/bin/env python3
"""Produce a non-publishing, HDF5-level quality inspection for one SME2 series.

The inspector deliberately stops before study analysis, crop-mask interpretation,
rainfall attachment, or publication. It exposes per-date native-grid support and
the existing quality diagnostics so candidate tracks can be compared honestly.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from agriculture_sme2 import (
    AgricultureError,
    COLLECTION,
    PRODUCT,
    _matched_support,
    _read_scene,
    _validate_grid,
    json_read,
    run_folder,
    safe_run_id,
    sha256_file,
)


def summarize_observation(scene: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    """Return compact evidence for one granule without writing spatial products."""
    aoi = np.asarray(scene["aoi_mask"], dtype=bool)
    valid = np.asarray(scene["valid"], dtype=bool) & aoi
    moisture = np.asarray(scene["moisture"], dtype="float64")
    uncertainty = np.asarray(scene["uncertainty"], dtype="float64")
    if aoi.ndim != 2 or any(item.shape != aoi.shape for item in (valid, moisture, uncertainty)):
        raise AgricultureError("Inspection arrays do not share one two-dimensional AOI grid.")

    values = moisture[valid]
    errors = uncertainty[valid]
    stats = None
    if values.size:
        stats = {
            "median": float(np.median(values)),
            "p05": float(np.percentile(values, 5)),
            "p95": float(np.percentile(values, 95)),
            "uncertainty_median": float(np.median(errors)),
        }

    aoi_pixels = int(np.sum(aoi))
    valid_pixels = int(np.sum(valid))
    if aoi_pixels <= 0:
        raise AgricultureError("Inspection found no native SME2 pixels inside the requested AOI.")

    return {
        "date": scene["date"],
        "granule_name": scene["file"].name,
        "source_bytes": int(source["bytes"]),
        "source_sha256": source["sha256"],
        "signature": scene["signature"],
        "native_grid": {
            "epsg": int(scene["epsg"]),
            "shape": [int(value) for value in aoi.shape],
        },
        "aoi_pixels": aoi_pixels,
        "quality_valid_pixels": valid_pixels,
        "quality_valid_fraction": valid_pixels / aoi_pixels,
        "soil_moisture_summary_on_quality_valid_pixels": stats,
        "retrieval_flag_counts": scene["retrieval_flag_counts"],
        "surface_flag_counts": scene["surface_flag_counts"],
        "quality_screen_diagnostics": scene["quality_diagnostics"],
        "surface_flag_diagnostics": scene["surface_flag_diagnostics"],
        "algorithm_candidate_diagnostics": scene["algorithm_candidate_diagnostics"],
    }


def build_inspection_report(
    run_id: str,
    label: str,
    algorithm: str,
    search_manifest: dict[str, Any],
    receipt: dict[str, Any],
    scenes: list[dict[str, Any]],
    source_records: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    if not scenes:
        raise AgricultureError("No HDF5 scenes were available for inspection.")
    scenes = sorted(scenes, key=lambda item: item["date"])
    if len({scene["date"] for scene in scenes}) != len(scenes):
        raise AgricultureError("Inspection cannot compare duplicate acquisition dates.")

    observations = []
    for scene in scenes:
        source = source_records.get(scene["file"].name)
        if source is None:
            raise AgricultureError(f"No verified download receipt exists for {scene['file'].name}.")
        observations.append(summarize_observation(scene, source))

    fractions = [item["quality_valid_fraction"] for item in observations]
    valid_dates = sum(item["quality_valid_pixels"] > 0 for item in observations)
    series = next(
        item for item in search_manifest["compatible_series"]
        if item.get("series_id") == receipt.get("series_id")
    )
    signature = series["signature"]
    gaps = [
        (datetime.fromisoformat(right) - datetime.fromisoformat(left)).days
        for left, right in zip(series["dates"], series["dates"][1:])
    ]

    report: dict[str, Any] = {
        "schema_version": 1,
        "inspection_type": "NON_PUBLISHING_SME2_HDF5_QUALITY_INSPECTION",
        "run_id": run_id,
        "label": label,
        "collection": COLLECTION,
        "product": PRODUCT,
        "product_maturity": "PROVISIONAL",
        "algorithm": "DSG" if algorithm == "DSG" else "BASELINE",
        "series_id": receipt["series_id"],
        "signature": signature,
        "aoi": search_manifest["aoi"],
        "date_range": search_manifest["date_range"],
        "catalogue_observation_count": int(series["observation_count"]),
        "downloaded_observation_count": len(observations),
        "valid_observation_count": int(valid_dates),
        "zero_valid_observation_dates": [
            item["date"] for item in observations if item["quality_valid_pixels"] == 0
        ],
        "quality_valid_fraction": {
            "median": float(np.median(fractions)),
            "minimum": float(np.min(fractions)),
            "maximum": float(np.max(fractions)),
            "mean": float(np.mean(fractions)),
        },
        "revisit_days": {
            "median": float(np.median(gaps)) if gaps else None,
            "maximum": int(max(gaps)) if gaps else None,
        },
        "observations": observations,
        "decision": "NOT_RANKED_FOR_AGRICULTURAL_SUITABILITY",
        "interpretation_limits": [
            "This is an HDF5 and native-pixel quality inspection, not a soil-moisture study or scientific validation.",
            "The reported valid fraction uses the existing strict SME2 screen: finite in-range moisture, non-negative finite uncertainty, retrievalQualityFlag equal to zero, and surfaceQualityFlag equal to zero.",
            "Algorithm-candidate diagnostics are reported separately; the root baseline stream and DSG candidate stream are never blended.",
            "No independently dated crop mask has been applied, so AOI-wide valid-pixel support is not a crop-area support estimate.",
            "The two track footprints can cover different native pixels inside the same AOI; do not treat their medians as a field-level head-to-head result without crop-mask alignment.",
            "No study.json, web preview, or public Agriculture publication is created by this inspection.",
            "NISAR SME2 PROVISIONAL remains exploratory; consult the current product maturity and known-issues guidance before scientific interpretation.",
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    if algorithm == "DSG":
        usable_scenes = [
            scene for scene in scenes
            if np.any(np.asarray(scene["valid"], dtype=bool) & np.asarray(scene["aoi_mask"], dtype=bool))
        ]
        usable_fractions = [
            item["quality_valid_fraction"]
            for item in observations if item["quality_valid_pixels"] > 0
        ]
        common_support = None
        if usable_scenes:
            common_support, _ = _matched_support(usable_scenes)
        report["candidate_analysis"] = {
            "algorithm": "DSG",
            "usable_observation_count": len(usable_scenes),
            "usable_dates": [scene["date"] for scene in usable_scenes],
            "minimum_usable_dates_for_existing_pipeline": 4,
            "meets_existing_minimum_date_gate": len(usable_scenes) >= 4,
            "quality_valid_fraction_on_usable_dates": (
                {
                    "median": float(np.median(usable_fractions)),
                    "minimum": float(np.min(usable_fractions)),
                    "maximum": float(np.max(usable_fractions)),
                    "mean": float(np.mean(usable_fractions)),
                }
                if usable_fractions else None
            ),
            "matched_support": common_support or {
                "method": "ALL_DATE_VALID_PIXEL_INTERSECTION",
                "status": "NO_USABLE_DATES",
                "valid_fraction": 0.0,
                "valid_pixels": 0,
                "total_pixels": int(sum(np.sum(np.asarray(scene["aoi_mask"], dtype=bool)) for scene in scenes)),
                "observations": [],
            },
        }

    return report


def inspect_series(run_id: str, expected_series_id: str, label: str, algorithm: str = "baseline") -> Path:
    safe_run_id(run_id)
    if algorithm not in {"baseline", "DSG"}:
        raise AgricultureError("Inspection algorithm must be baseline or DSG.")
    if len(expected_series_id) != 12 or any(char not in "0123456789abcdef" for char in expected_series_id):
        raise AgricultureError("Expected series ID must be 12 lowercase hexadecimal characters.")

    folder = run_folder(run_id)
    search_manifest = json_read(folder / "search.json")
    receipt = json_read(folder / "download.json")
    if search_manifest.get("run_id") != run_id or receipt.get("run_id") != run_id:
        raise AgricultureError("Inspection run identity mismatch.")
    if search_manifest.get("collection") != COLLECTION:
        raise AgricultureError("Inspection search manifest has the wrong SME2 collection.")
    if receipt.get("series_id") != expected_series_id:
        raise AgricultureError("Downloaded series ID does not match the expected candidate series ID.")

    series = next(
        (item for item in search_manifest.get("compatible_series", [])
         if item.get("series_id") == expected_series_id),
        None,
    )
    if series is None:
        raise AgricultureError("Expected candidate series is not present in the saved CMR search manifest.")

    receipt_files = receipt.get("files")
    if not isinstance(receipt_files, list) or len(receipt_files) != len(series.get("granules", [])):
        raise AgricultureError("Download receipt does not cover every granule in the selected CMR series.")
    if len(receipt_files) < 4:
        raise AgricultureError("At least four downloaded SME2 dates are required for an inspection.")

    scenes = []
    source_records: dict[str, dict[str, Any]] = {}
    for item in receipt_files:
        path = (folder / str(item.get("path") or "")).resolve()
        if folder.resolve() not in path.parents or not path.is_file():
            raise AgricultureError("Download receipt contains an unsafe or missing HDF5 path.")
        if path.stat().st_size != item.get("bytes") or sha256_file(path) != item.get("sha256"):
            raise AgricultureError(f"Downloaded SME2 source failed receipt verification: {path.name}")
        if path.name in source_records:
            raise AgricultureError(f"Duplicate local HDF5 filename in receipt: {path.name}")
        source_records[path.name] = {"bytes": path.stat().st_size, "sha256": item["sha256"]}
        scenes.append(_read_scene(path, search_manifest["aoi"], series["signature"], algorithm))

    scenes.sort(key=lambda item: item["date"])
    expected_dates = sorted(item["date"] for item in series["granules"])
    if [scene["date"] for scene in scenes] != expected_dates:
        raise AgricultureError("Downloaded HDF5 acquisition dates do not match the selected CMR series.")
    for scene in scenes[1:]:
        _validate_grid(scenes[0], scene)

    report = build_inspection_report(
        run_id, label, algorithm, search_manifest, receipt, scenes, source_records,
    )
    output_name = "inspection.json" if algorithm == "baseline" else "inspection-dsg.json"
    output = folder / "result" / output_name
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"{label}: {report['downloaded_observation_count']} HDF5 dates inspected; "
        f"{report['valid_observation_count']} have non-zero quality-valid AOI support; "
        f"median valid fraction {report['quality_valid_fraction']['median']:.1%}."
    )
    print(f"Non-publishing inspection report: {output}")
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--expected-series-id", required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--algorithm", choices=("baseline", "DSG"), default="baseline")
    args = parser.parse_args()
    try:
        inspect_series(args.run_id, args.expected_series_id, args.label, args.algorithm)
        return 0
    except (AgricultureError, OSError, ValueError, KeyError, StopIteration) as exc:
        print(f"SME2 INSPECTION ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

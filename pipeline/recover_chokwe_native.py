"""Re-create the missing native Chókwè NISAR run artifacts from exact source scenes.

This is a recovery/reprocessing tool, not a validation tool. It uses the exact
published baseline/event granule identities and the original analysis-box
geometry/method metadata. It writes a new private run under the selected output
root and never changes the public study or the current production run pointer.

Dry-run:
    python pipeline/recover_chokwe_native.py --dry-run

Reprocess (requires NASA Earthdata access):
    python pipeline/recover_chokwe_native.py
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import re
import sys
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
import yaml
from shapely.geometry import shape
from shapely.ops import unary_union

from main import load_config, run_pipeline


REPO_ROOT = Path(__file__).resolve().parents[1]
PIPELINE_ROOT = Path(__file__).resolve().parent
SOURCE_RUN_ID = "ec8fa5ee15ae41d1aa89f930f2b47e36"
SOURCE_RELEASE = "2026.10.29-chokwe"
SOURCE_RUN_RELATIVE = (
    Path("public") / "studies" / "releases" / SOURCE_RELEASE / "runs" / SOURCE_RUN_ID
)
SOURCE_BASELINE_SCENE = (
    "NISAR_L2_PR_GCOV_009_114_A_165_4005_DHDH_A_"
    "20260105T034232_20260105T034253_X05010_N_P_J_001"
)
SOURCE_EVENT_SCENE = (
    "NISAR_L2_PR_GCOV_010_114_A_165_4005_DHDH_A_"
    "20260117T034232_20260117T034254_X05010_N_P_J_001"
)
EXPECTED_PRODUCT = "NISAR_L2_GCOV_BETA_V1"
EXPECTED_FREQUENCY = "frequencyA"
EXPECTED_BOUNDS = (32.93, -24.58, 33.03, -24.48)
DEFAULT_OUTPUT_ROOT = PIPELINE_ROOT / "output" / "chokwe-native-recovery"

MASKED_RASTER_KEYS = ("before_hh", "after_hh", "before_hv", "after_hv")
REQUIRED_RUN_FILES = (
    "classification_00.tif",
    "before_hh_masked.tif",
    "before_hv_masked.tif",
    "after_00_hh_masked.tif",
    "after_00_hv_masked.tif",
    "wetland_mask.tif",
    "processing_config.json",
    "observations.json",
    "quality_observations.json",
    "run_manifest.json",
)


def _read_json(path: Path) -> dict[str, Any] | list[Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read required JSON file: {path}") from error
    if not isinstance(value, (dict, list)):
        raise ValueError(f"Expected a JSON object or array: {path}")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _close(left: float, right: float, tolerance: float = 1e-8) -> bool:
    return math.isfinite(left) and math.isfinite(right) and abs(left - right) <= tolerance


def _method_parameters(case_study: dict[str, Any]) -> dict[str, float | int]:
    method = case_study.get("method")
    if not isinstance(method, dict):
        raise ValueError("Published Chókwè case study has no method object.")

    try:
        minimum_region_pixels = int(method["minimum_region_pixels"])
        minimum_valid_fraction = float(method["minimum_valid_fraction"])
        base_threshold_db = float(method["threshold_db"])
        water_rule = str(method["open_water_rule"])
        vegetation_rule = str(method["vegetated_inundation_rule"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("Published Chókwè method metadata is incomplete.") from error

    water_match = re.search(
        r"HHHH change\s*≤\s*[−-]\s*(\d+(?:\.\d+)?)\s*dB",
        water_rule,
        flags=re.IGNORECASE,
    )
    vegetation_match = re.search(
        r"HHHH increase\s*≥\s*(\d+(?:\.\d+)?)\s*dB\s+and\s+"
        r"\|HVHV change\|\s*≤\s*(\d+(?:\.\d+)?)\s*dB",
        vegetation_rule,
        flags=re.IGNORECASE,
    )
    if not water_match or not vegetation_match:
        raise ValueError(
            "Could not parse the published HH/HV threshold rules; refusing to guess."
        )
    if minimum_region_pixels < 1:
        raise ValueError("Published minimum_region_pixels must be positive.")
    if not 0 <= minimum_valid_fraction <= 1:
        raise ValueError("Published minimum_valid_fraction must be between zero and one.")
    if not 0.5 <= base_threshold_db <= 5:
        raise ValueError("Published base_threshold_db is outside the supported sweep.")

    return {
        "minimum_region_pixels": minimum_region_pixels,
        "minimum_valid_fraction": minimum_valid_fraction,
        "base_threshold_db": base_threshold_db,
        "open_water_delta_hh": -float(water_match.group(1)),
        "vegetated_delta_hh": float(vegetation_match.group(1)),
        "vegetated_delta_hv_max": float(vegetation_match.group(2)),
    }


def load_source_package(repo_root: Path = REPO_ROOT) -> dict[str, Any]:
    """Load and cross-check the exact published source run before any data access."""
    source_dir = repo_root / SOURCE_RUN_RELATIVE
    manifest_path = source_dir / "run_manifest.json"
    observations_path = source_dir / "observations.json"
    case_study_path = source_dir / "case_study.json"
    boundary_path = source_dir / "site_boundary.geojson"

    manifest = _read_json(manifest_path)
    observations = _read_json(observations_path)
    case_study = _read_json(case_study_path)
    boundary_doc = _read_json(boundary_path)

    if not isinstance(manifest, dict) or not isinstance(case_study, dict):
        raise ValueError("Published Chókwè run/case-study manifests are malformed.")
    if not isinstance(observations, list) or len(observations) != 1:
        raise ValueError("Expected exactly one published Chókwè event observation.")
    if not isinstance(boundary_doc, dict):
        raise ValueError("Published Chókwè boundary is malformed.")

    expected_manifest = {
        "run_id": SOURCE_RUN_ID,
        "status": "COMPLETE",
        "mode": "real",
        "data_source": "NISAR",
        "product": EXPECTED_PRODUCT,
        "frequency": EXPECTED_FREQUENCY,
        "baseline_date": "2026-01-05",
        "selected_date": "2026-01-17",
        "baseline_scene": SOURCE_BASELINE_SCENE,
        "site_name": "Chokwe event study box",
    }
    for key, expected in expected_manifest.items():
        if manifest.get(key) != expected:
            raise ValueError(
                f"Published run manifest mismatch for {key}: "
                f"expected {expected!r}, got {manifest.get(key)!r}."
            )
    if manifest.get("reference_check_status") != "INCONCLUSIVE":
        raise ValueError("The source run's recorded reference status changed; review before recovery.")
    if manifest.get("reference_validated") is not False:
        raise ValueError("The source run must remain explicitly not field/reference validated.")

    observation = observations[0]
    if not isinstance(observation, dict):
        raise ValueError("Published Chókwè observation entry is malformed.")
    if observation.get("date") != "2026-01-17":
        raise ValueError("Published event observation date is not 2026-01-17.")
    if observation.get("scene_name") != SOURCE_EVENT_SCENE:
        raise ValueError("Published event granule does not match the pinned source identity.")
    if observation.get("classification_file") != "classification_00.tif":
        raise ValueError("Published classification reference changed; inspect source metadata.")
    rasters = observation.get("rasters")
    expected_rasters = {
        "before_hh": "before_hh_masked.tif",
        "after_hh": "after_00_hh_masked.tif",
        "before_hv": "before_hv_masked.tif",
        "after_hv": "after_00_hv_masked.tif",
    }
    if rasters != expected_rasters:
        raise ValueError("Published source raster mapping differs from the expected native inputs.")

    case_pair = (case_study.get("baseline_scene"), case_study.get("event_scene"))
    if case_pair != (SOURCE_BASELINE_SCENE, SOURCE_EVENT_SCENE):
        raise ValueError("Published case-study scene pair does not match the pinned source pair.")
    if case_study.get("data_source") != "NISAR" or case_study.get("frequency") != EXPECTED_FREQUENCY:
        raise ValueError("Published case-study product identity is inconsistent.")
    parameters = _method_parameters(case_study)

    features = boundary_doc.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("Published Chókwè boundary has no polygon features.")
    geometries = [
        shape(feature["geometry"])
        for feature in features
        if isinstance(feature, dict) and isinstance(feature.get("geometry"), dict)
    ]
    if len(geometries) != len(features):
        raise ValueError("Every Chókwè boundary feature must have a geometry.")
    if any(
        geometry.is_empty
        or not geometry.is_valid
        or geometry.geom_type not in ("Polygon", "MultiPolygon")
        for geometry in geometries
    ):
        raise ValueError("Chókwè analysis boundary must contain valid polygon geometry.")
    boundary = unary_union(geometries)
    bounds = tuple(float(value) for value in boundary.bounds)
    if len(bounds) != 4 or any(
        not _close(actual, expected)
        for actual, expected in zip(bounds, EXPECTED_BOUNDS)
    ):
        raise ValueError(
            f"Published Chókwè analysis-box bounds changed: {bounds!r}; "
            f"expected {EXPECTED_BOUNDS!r}."
        )

    source_files = {
        "run_manifest": manifest_path,
        "observations": observations_path,
        "case_study": case_study_path,
        "site_boundary": boundary_path,
    }
    return {
        "source_dir": source_dir,
        "manifest": manifest,
        "observation": observation,
        "case_study": case_study,
        "boundary_path": boundary_path,
        "boundary_bounds": bounds,
        "method_parameters": parameters,
        "source_file_hashes": {
            name: _sha256(path) for name, path in source_files.items()
        },
    }


def build_recovery_config(
    source: dict[str, Any],
    repo_root: Path = REPO_ROOT,
) -> dict[str, Any]:
    """Build a one-pair real-data config only from the pinned publication."""
    config = load_config(repo_root / "pipeline" / "config.yaml")
    manifest = source["manifest"]
    parameters = source["method_parameters"]

    west, south, east, north = source["boundary_bounds"]
    config["site"] = {
        "name": "Chokwe event study box",
        "bbox": {
            "min_lon": west,
            "min_lat": south,
            "max_lon": east,
            "max_lat": north,
        },
        "boundary": str(source["boundary_path"].resolve()),
        "boundary_source": (
            "Operator-selected rectangular analysis box from the published "
            "Chókwè run; not an authoritative flood or wetland extent"
        ),
    }
    config["nisar"] = {
        "product": EXPECTED_PRODUCT,
        "frequency": EXPECTED_FREQUENCY,
        "preferred_polarizations": ["HHHH", "HVHV"],
        "temporal": [manifest["baseline_date"], manifest["selected_date"]],
        "search_limit": 100,
        "selected_scene_names": [SOURCE_BASELINE_SCENE, SOURCE_EVENT_SCENE],
    }
    config["processing"] = {
        "minimum_valid_fraction": parameters["minimum_valid_fraction"],
        "minimum_region_pixels": parameters["minimum_region_pixels"],
        "base_threshold_db": parameters["base_threshold_db"],
        "open_water_delta_hh": parameters["open_water_delta_hh"],
        "vegetated_delta_hh": parameters["vegetated_delta_hh"],
        "vegetated_delta_hv_max": parameters["vegetated_delta_hv_max"],
    }
    # The source HLS result remains INCONCLUSIVE. This recovery focuses on native
    # NISAR inputs/outputs and deliberately does not rerun or upgrade reference status.
    config["validation"]["use_reference"] = False
    return config


def _raster_valid_values(path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    with rasterio.open(path) as source:
        if source.count != 1 or source.crs is None:
            raise ValueError(f"Expected a georeferenced single-band raster: {path.name}")
        values = source.read(1, masked=True)
        data = np.asarray(values.data)
        valid = ~np.ma.getmaskarray(values) & np.isfinite(data)
        profile = source.profile.copy()
        profile["transform"] = source.transform
        profile["crs"] = source.crs
        profile["bounds"] = tuple(float(value) for value in source.bounds)
        profile["resolution"] = tuple(float(value) for value in source.res)
        return data, {"valid": valid, "profile": profile}


def inspect_native_run(
    run_dir: Path,
    observation: dict[str, Any],
) -> dict[str, Any]:
    """Fail closed unless the native class raster and all four masked inputs align."""
    class_name = observation.get("classification_file")
    raster_map = observation.get("rasters")
    if class_name != "classification_00.tif" or not isinstance(raster_map, dict):
        raise ValueError("Recovered run has no expected native classification/raster mapping.")

    classification_path = run_dir / class_name
    if not classification_path.is_file():
        raise FileNotFoundError(f"Native classification raster is missing: {classification_path}")
    class_values, class_meta = _raster_valid_values(classification_path)
    class_raw = class_values.astype(np.uint8, copy=False)
    if not np.isin(class_raw, (0, 1, 2)).all():
        raise ValueError("Native classification contains an undocumented class code.")

    common_valid = np.ones(class_raw.shape, dtype=bool)
    aligned_paths: dict[str, Path] = {}
    for key in MASKED_RASTER_KEYS:
        filename = raster_map.get(key)
        if not isinstance(filename, str) or Path(filename).name != filename:
            raise ValueError(f"Recovered observation has an unsafe/missing raster path for {key}.")
        path = run_dir / filename
        if not path.is_file():
            raise FileNotFoundError(f"Required masked native input is missing: {path}")
        values, metadata = _raster_valid_values(path)
        if values.shape != class_raw.shape:
            raise ValueError(f"Native raster dimensions differ for {filename}.")
        if not (
            metadata["profile"]["crs"] == class_meta["profile"]["crs"]
            and metadata["profile"]["transform"].almost_equals(
                class_meta["profile"]["transform"], precision=1e-8
            )
            and metadata["profile"]["width"] == class_meta["profile"]["width"]
            and metadata["profile"]["height"] == class_meta["profile"]["height"]
        ):
            raise ValueError(f"Native raster georeferencing differs for {filename}.")
        common_valid &= metadata["valid"]
        aligned_paths[key] = path

    if np.any((class_raw > 0) & ~common_valid):
        raise ValueError("A detected native candidate falls outside the four-input valid-data mask.")

    class_counts = {
        str(code): int(np.count_nonzero(class_raw == code))
        for code in (0, 1, 2)
    }
    valid_count = int(common_valid.sum())
    water_count = int(np.count_nonzero(common_valid & (class_raw == 1)))
    vegetation_count = int(np.count_nonzero(common_valid & (class_raw == 2)))
    no_candidate_count = int(np.count_nonzero(common_valid & (class_raw == 0)))

    transform = class_meta["profile"]["transform"]
    crs = class_meta["profile"]["crs"]
    if not crs.is_projected or len(crs.axis_info) < 2:
        raise ValueError("Native NISAR classification must use a projected horizontal CRS.")
    unit_factors = [axis.unit_conversion_factor for axis in crs.axis_info[:2]]
    pixel_area_km2 = (
        abs(transform.a * transform.e - transform.b * transform.d)
        * unit_factors[0]
        * unit_factors[1]
        / 1_000_000.0
    )
    if not math.isfinite(pixel_area_km2) or pixel_area_km2 <= 0:
        raise ValueError("Native NISAR pixel area is invalid.")

    wetland_mask = run_dir / "wetland_mask.tif"
    if not wetland_mask.is_file():
        raise FileNotFoundError("Recovered native wetland/AOI mask is missing.")
    _, wetland_meta = _raster_valid_values(wetland_mask)
    if (
        wetland_meta["profile"]["crs"] != crs
        or wetland_meta["profile"]["transform"].almost_equals(transform, precision=1e-8) is False
        or wetland_meta["profile"]["width"] != class_meta["profile"]["width"]
        or wetland_meta["profile"]["height"] != class_meta["profile"]["height"]
    ):
        raise ValueError("Native AOI mask is not aligned to the classification grid.")

    return {
        "classification_file": class_name,
        "input_rasters": {key: path.name for key, path in aligned_paths.items()},
        "grid": {
            "crs": crs.to_string(),
            "width": int(class_meta["profile"]["width"]),
            "height": int(class_meta["profile"]["height"]),
            "transform": [float(value) for value in transform[:6]],
            "bounds": list(class_meta["profile"]["bounds"]),
            "resolution": list(class_meta["profile"]["resolution"]),
            "nodata": class_meta["profile"].get("nodata"),
        },
        "class_codes": {
            "0": "No candidate within valid input support; the masked input rasters identify invalid/no-data cells separately",
            "1": "OPEN_WATER change candidate",
            "2": "VEGETATED change candidate",
        },
        "raw_class_value_counts": class_counts,
        "common_valid_native_pixel_count": valid_count,
        "valid_no_candidate_pixel_count": no_candidate_count,
        "valid_open_water_candidate_pixel_count": water_count,
        "valid_vegetated_candidate_pixel_count": vegetation_count,
        "native_pixel_area_km2": pixel_area_km2,
        "valid_open_water_candidate_area_km2": water_count * pixel_area_km2,
        "valid_vegetated_candidate_area_km2": vegetation_count * pixel_area_km2,
        "wetland_mask_file": wetland_mask.name,
    }


def _verify_required_files(run_dir: Path) -> dict[str, dict[str, Any]]:
    missing = [name for name in REQUIRED_RUN_FILES if not (run_dir / name).is_file()]
    if missing:
        raise FileNotFoundError(
            "Recovered NISAR run is incomplete; missing required files: "
            + ", ".join(missing)
        )
    return {
        name: {
            "bytes": (run_dir / name).stat().st_size,
            "sha256": _sha256(run_dir / name),
        }
        for name in REQUIRED_RUN_FILES
    }


def recover(
    output_root: Path = DEFAULT_OUTPUT_ROOT,
    repo_root: Path = REPO_ROOT,
) -> dict[str, Any]:
    """Reprocess the exact pinned NISAR pair and validate that native rasters exist."""
    source = load_source_package(repo_root)
    config = build_recovery_config(source, repo_root)
    output_root = output_root.expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    config_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".yaml",
            prefix=".chokwe-native-recovery-",
            dir=output_root,
            delete=False,
        ) as handle:
            yaml.safe_dump(config, handle, sort_keys=False, allow_unicode=True)
            config_path = Path(handle.name)

        logging.info(
            "Reprocessing exact NISAR pair %s -> %s using %s / %s",
            SOURCE_BASELINE_SCENE,
            SOURCE_EVENT_SCENE,
            EXPECTED_PRODUCT,
            EXPECTED_FREQUENCY,
        )
        run_manifest = run_pipeline(
            config_path=config_path,
            mode="real",
            output_root=output_root,
            scene_names=[SOURCE_BASELINE_SCENE, SOURCE_EVENT_SCENE],
            progress=logging.info,
        )
    finally:
        if config_path is not None:
            config_path.unlink(missing_ok=True)

    run_id = run_manifest.get("run_id")
    if not isinstance(run_id, str) or not re.fullmatch(r"[a-f0-9]{32}", run_id):
        raise ValueError("Processing completed without a valid new run ID.")
    if run_manifest.get("status") != "COMPLETE":
        raise RuntimeError("NISAR reprocessing did not complete successfully.")
    if (
        run_manifest.get("baseline_scene") != SOURCE_BASELINE_SCENE
        or run_manifest.get("observation_scenes") != [SOURCE_EVENT_SCENE]
        or run_manifest.get("product") != EXPECTED_PRODUCT
        or run_manifest.get("frequency") != EXPECTED_FREQUENCY
    ):
        raise ValueError("Completed run identity differs from the exact requested source pair.")

    run_dir = output_root / "runs" / run_id
    observations = _read_json(run_dir / "observations.json")
    if not isinstance(observations, list) or len(observations) != 1:
        raise ValueError("Recovered run does not contain exactly one observation.")
    native_summary = inspect_native_run(run_dir, observations[0])
    files = _verify_required_files(run_dir)

    # Include the actual GCOV quality products recorded for both selected granules.
    quality_doc = _read_json(run_dir / "quality_observations.json")
    if not isinstance(quality_doc, dict) or not isinstance(quality_doc.get("by_scene"), dict):
        raise ValueError("Recovered GCOV quality provenance is missing.")
    by_scene = quality_doc["by_scene"]
    quality_artifacts: dict[str, dict[str, Any]] = {}
    for scene_name in (SOURCE_BASELINE_SCENE, SOURCE_EVENT_SCENE):
        row = by_scene.get(scene_name)
        if not isinstance(row, dict):
            raise ValueError(f"GCOV quality provenance is missing for {scene_name}.")
        for field in ("quality_valid_file", "number_of_looks_file"):
            filename = row.get(field)
            if not isinstance(filename, str) or Path(filename).name != filename:
                raise ValueError(f"GCOV quality sidecar reference is missing: {scene_name}/{field}.")
            path = run_dir / filename
            if not path.is_file():
                raise FileNotFoundError(f"GCOV quality sidecar is missing: {path}")
            quality_artifacts[filename] = {
                "bytes": path.stat().st_size,
                "sha256": _sha256(path),
            }
        mask_name = row.get("mask_ensemble_file")
        if isinstance(mask_name, str):
            path = run_dir / mask_name
            if not path.is_file():
                raise FileNotFoundError(f"GCOV ensemble-mask sidecar is missing: {path}")
            quality_artifacts[mask_name] = {
                "bytes": path.stat().st_size,
                "sha256": _sha256(path),
            }

    recovery_manifest = {
        "schema_version": 1,
        "status": "RECOVERED_NATIVE_RASTERS",
        "created_at": run_manifest.get("completed_at"),
        "recovery_run_id": run_id,
        "recovery_is_reprocessing_not_original_binary_restoration": True,
        "source_published_run_id": SOURCE_RUN_ID,
        "source_publication_release": SOURCE_RELEASE,
        "source_manifest_sha256": source["source_file_hashes"]["run_manifest"],
        "source_observations_sha256": source["source_file_hashes"]["observations"],
        "source_case_study_sha256": source["source_file_hashes"]["case_study"],
        "source_boundary_sha256": source["source_file_hashes"]["site_boundary"],
        "product": EXPECTED_PRODUCT,
        "frequency": EXPECTED_FREQUENCY,
        "baseline_date": "2026-01-05",
        "event_date": "2026-01-17",
        "baseline_scene": SOURCE_BASELINE_SCENE,
        "event_scene": SOURCE_EVENT_SCENE,
        "aoi": {
            "bounds_wgs84": list(source["boundary_bounds"]),
            "geometry_source": "Published operator-selected rectangular analysis box; not an authoritative wetland/flood boundary",
            "boundary_file": "site_boundary.geojson",
        },
        "method_parameters": source["method_parameters"],
        "reference_validation": {
            "source_release_status": "INCONCLUSIVE",
            "recomputed_during_recovery": False,
            "reference_validated": False,
        },
        "native_classification": native_summary,
        "required_artifacts": files,
        "gcov_quality_artifacts": quality_artifacts,
        "comparison_status": "NATIVE_NISAR_GFM_COMPARISON_NOT_YET_RUN",
        "scientific_limitations": [
            "This run reprocesses the pinned NISAR source scenes; it does not restore the original missing TIFF bytes.",
            "The source publication records the optical reference as INCONCLUSIVE; this recovery does not rerun or upgrade that assessment.",
            "The analyst-selected rectangle is not an authoritative wetland or flood boundary.",
            "The NISAR classes remain algorithmic change candidates, not confirmed flooding or field truth.",
            "No accuracy, precision, recall or F1 metric is computed by this recovery tool.",
            "The native-grid comparison with GFM is a separate next step and has not been performed here.",
        ],
    }
    recovery_path = run_dir / "recovery_manifest.json"
    recovery_path.write_text(
        json.dumps(recovery_manifest, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    recovery_manifest["recovery_manifest_sha256"] = _sha256(recovery_path)
    return {
        "status": "RECOVERED_NATIVE_RASTERS",
        "source_published_run_id": SOURCE_RUN_ID,
        "recovery_run_id": run_id,
        "run_directory": str(run_dir),
        "recovery_manifest": str(recovery_path),
        "native_classification": native_summary,
        "required_artifact_count": len(files),
        "quality_artifact_count": len(quality_artifacts),
        "reference_status": "INCONCLUSIVE (inherited; not recomputed)",
        "native_gfm_comparison": "NOT RUN",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help="Private output directory; defaults to pipeline/output/chokwe-native-recovery.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate pinned source metadata and print the exact request without NASA downloads.",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    try:
        source = load_source_package()
        config = build_recovery_config(source)
        request = {
            "status": "DRY_RUN_VALIDATED" if args.dry_run else "READY_TO_REPROCESS",
            "source_published_run_id": SOURCE_RUN_ID,
            "product": config["nisar"]["product"],
            "frequency": config["nisar"]["frequency"],
            "temporal": config["nisar"]["temporal"],
            "selected_scene_names": config["nisar"]["selected_scene_names"],
            "aoi_bounds_wgs84": source["boundary_bounds"],
            "method_parameters": source["method_parameters"],
            "reference_recomputed": False,
            "network_access_required": not args.dry_run,
            "output_root": str(args.output_root.expanduser().resolve()),
        }
        if args.dry_run:
            print(json.dumps(request, indent=2, ensure_ascii=False, allow_nan=False))
            return 0
        result = recover(args.output_root)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except Exception as error:
        logging.exception("Chókwè native-raster recovery failed: %s", error)
        return 1


if __name__ == "__main__":
    sys.exit(main())

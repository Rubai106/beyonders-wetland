#!/usr/bin/env python3
"""Acquire a dated Dynamic World crop-probability candidate through Earth Engine.

Evidence acquisition only: this command does not run SME2 analysis or publication.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import zipfile
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

DATASET = "GOOGLE/DYNAMICWORLD/V1"
PROBABILITY_BAND = "crops"
EXPORT_CRS = "EPSG:6933"
EXPORT_SCALE_METRES = 10
MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024
MAX_GRID_DIMENSION = 10_000
NODATA = -9999.0
RECENCY_CUE_DAYS = 18


class DynamicWorldError(RuntimeError):
    """Raised when a Dynamic World crop-probability candidate is unsafe or incomplete."""


def parse_iso_date(value: str, label: str) -> date:
    if not isinstance(value, str):
        raise DynamicWorldError(f"{label} must use YYYY-MM-DD.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise DynamicWorldError(f"{label} must use YYYY-MM-DD.") from exc
    if parsed.isoformat() != value:
        raise DynamicWorldError(f"{label} must use the exact zero-padded YYYY-MM-DD format.")
    return parsed


def validate_request(west: float, south: float, east: float, north: float,
                     start_text: str, end_text: str, buffer_m: int,
                     minimum_observations: int) -> tuple[date, date]:
    if not all(math.isfinite(value) for value in (west, south, east, north)):
        raise DynamicWorldError("AOI coordinates must be finite numbers.")
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise DynamicWorldError("AOI must be a valid WGS84 bounding box.")
    if east - west > 2 or north - south > 2:
        raise DynamicWorldError("AOI must not exceed 2 degrees in either dimension.")
    start, end = parse_iso_date(start_text, "Start date"), parse_iso_date(end_text, "End date")
    if start > end:
        raise DynamicWorldError("Start date must not be after end date.")
    if (end - start).days > 366:
        raise DynamicWorldError("Dynamic World request window cannot exceed 366 days.")
    if isinstance(buffer_m, bool) or not isinstance(buffer_m, int) or not 100 <= buffer_m <= 2_000:
        raise DynamicWorldError("Export buffer must be an integer from 100 to 2,000 metres.")
    if isinstance(minimum_observations, bool) or not isinstance(minimum_observations, int) or not 1 <= minimum_observations <= 30:
        raise DynamicWorldError("Minimum valid observations per pixel must be an integer from 1 to 30.")
    return start, end


def summarize_acquisition_timestamps(timestamps_ms: list[int]) -> dict[str, Any]:
    """Deduplicate source granules to UTC dates before counting per-pixel support."""
    if not isinstance(timestamps_ms, list) or not timestamps_ms:
        raise DynamicWorldError("No Dynamic World Sentinel-2 scenes intersect the requested AOI and date window.")
    parsed = []
    for timestamp in timestamps_ms:
        if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp):
            raise DynamicWorldError("Earth Engine returned a malformed acquisition timestamp.")
        parsed.append(datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).date())
    unique_dates = sorted(set(parsed))
    gaps = [(right - left).days for left, right in zip(unique_dates, unique_dates[1:])]
    return {
        "scene_record_count": len(parsed),
        "unique_acquisition_date_count": len(unique_dates),
        "acquisition_dates": [item.isoformat() for item in unique_dates],
        "first_acquisition_date": unique_dates[0].isoformat(),
        "latest_acquisition_date": unique_dates[-1].isoformat(),
        "maximum_gap_between_acquisition_dates_days": max(gaps) if gaps else None,
    }


def assess_temporal_recency(latest_date: str, requested_end: str) -> dict[str, Any]:
    latest = parse_iso_date(latest_date, "Latest source acquisition date")
    end = parse_iso_date(requested_end, "Requested end date")
    gap = (end - latest).days
    if gap < 0:
        raise DynamicWorldError("Latest source date falls after the requested end date.")
    return {
        "days_from_latest_scene_to_requested_end": gap,
        "recency_cue_days": RECENCY_CUE_DAYS,
        "status": "RECENT_WITHIN_18_DAY_WINDOW" if gap <= RECENCY_CUE_DAYS else "STALE_MORE_THAN_18_DAYS_BEFORE_WINDOW_END",
        "interpretation": "Descriptive source-recency cue only; not a validated scientific acceptance threshold.",
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _service_account_payload(raw: str) -> dict[str, Any]:
    if not raw.strip():
        raise DynamicWorldError("Missing EARTH_ENGINE_SERVICE_ACCOUNT_JSON. Configure the GitHub Actions secret first.")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise DynamicWorldError("EARTH_ENGINE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.") from exc
    if (not isinstance(value, dict) or value.get("type") != "service_account"
            or not isinstance(value.get("client_email"), str)
            or not value["client_email"].endswith(".gserviceaccount.com")
            or not isinstance(value.get("private_key"), str)
            or not value["private_key"].startswith("-----BEGIN PRIVATE KEY-----")
            or not isinstance(value.get("token_uri"), str)):
        raise DynamicWorldError("EARTH_ENGINE_SERVICE_ACCOUNT_JSON is not a complete Google service-account key.")
    return value


def _initialize_earth_engine(project: str, raw_key: str) -> Any:
    if not isinstance(project, str) or not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project):
        raise DynamicWorldError("EARTH_ENGINE_PROJECT must be a valid Google Cloud project ID.")
    key_info = _service_account_payload(raw_key)
    try:
        import ee
        from google.oauth2 import service_account
        credentials = service_account.Credentials.from_service_account_info(
            key_info, scopes=["https://www.googleapis.com/auth/earthengine"],
        )
        ee.Initialize(credentials=credentials, project=project)
        return ee
    except DynamicWorldError:
        raise
    except Exception as exc:
        detail = str(exc).splitlines()[0][:300]
        raise DynamicWorldError(
            "Earth Engine initialization failed. Confirm that the project is registered, "
            "the Earth Engine API is enabled, and the service account has Earth Engine "
            f"Resource Viewer permission (plus Service Usage Consumer if required). Detail: {detail}"
        ) from exc


def _download_bytes(url: str) -> bytes:
    try:
        import requests
        response = requests.get(url, timeout=(30, 180), stream=True)
        response.raise_for_status()
        chunks, size = [], 0
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                size += len(chunk)
                if size > MAX_DOWNLOAD_BYTES:
                    raise DynamicWorldError("Earth Engine download exceeded the 32 MB request limit; reduce the AOI.")
                chunks.append(chunk)
        payload = b"".join(chunks)
        if not payload:
            raise DynamicWorldError("Earth Engine returned an empty raster download.")
        if zipfile.is_zipfile(BytesIO(payload)):
            with zipfile.ZipFile(BytesIO(payload)) as archive:
                names = [n for n in archive.namelist() if n.lower().endswith((".tif", ".tiff"))]
                if len(names) != 1:
                    raise DynamicWorldError("Earth Engine ZIP must contain exactly one GeoTIFF.")
                payload = archive.read(names[0])
        return payload
    except DynamicWorldError:
        raise
    except Exception as exc:
        raise DynamicWorldError(f"Earth Engine raster download failed: {str(exc).splitlines()[0][:300]}") from exc


def _download_ee_geotiff(image: Any, region: Any, path: Path, name: str) -> None:
    try:
        url = image.getDownloadURL({
            "name": name, "crs": EXPORT_CRS, "scale": EXPORT_SCALE_METRES,
            "region": region, "format": "GEO_TIFF",
        })
    except Exception as exc:
        raise DynamicWorldError("Earth Engine could not create the GeoTIFF URL; check AOI and image export limits.") from exc
    path.write_bytes(_download_bytes(url))


def _require_north_up_10m(transform: Any, label: str) -> None:
    """Reject equal-area but anisotropic/rotated grids masquerading as 10 m pixels."""
    if not (
        math.isclose(float(transform.a), 10.0, rel_tol=0.0, abs_tol=0.01)
        and math.isclose(float(transform.e), -10.0, rel_tol=0.0, abs_tol=0.01)
        and math.isclose(float(transform.b), 0.0, rel_tol=0.0, abs_tol=1e-6)
        and math.isclose(float(transform.d), 0.0, rel_tol=0.0, abs_tol=1e-6)
    ):
        raise DynamicWorldError(
            f"{label} must use a north-up 10 m by 10 m grid in EPSG:6933."
        )


def _normalise_probability_geotiff(raw_path: Path, output_path: Path,
                                   tags: dict[str, str]) -> dict[str, Any]:
    import numpy as np
    import rasterio
    from rasterio.crs import CRS
    try:
        with rasterio.open(raw_path) as source:
            if source.count != 1 or source.crs is None or source.crs != CRS.from_string(EXPORT_CRS):
                raise DynamicWorldError("Probability export must be a single-band EPSG:6933 GeoTIFF.")
            _require_north_up_10m(source.transform, "Probability export")
            raw = source.read(1).astype("float64")
            source_mask = source.read_masks(1) > 0
            valid = source_mask & np.isfinite(raw) & (raw != NODATA)
            unexpected = source_mask & np.isfinite(raw) & (raw != NODATA) & ((raw < 0) | (raw > 1))
            if np.any(unexpected):
                raise DynamicWorldError("Dynamic World crops probability contains values outside [0, 1].")
            if not np.any(valid):
                raise DynamicWorldError("No pixels met the per-pixel observation-count requirement.")
            pixel_area = abs(source.transform.a * source.transform.e - source.transform.b * source.transform.d)
            if not math.isfinite(pixel_area) or pixel_area <= 0 or pixel_area >= 40_000:
                raise DynamicWorldError("Exported probability pixels are not demonstrably finer than SME2 native cells.")
            profile = source.profile.copy()
            values = np.where(valid, raw, NODATA).astype("float32")
            valid_values = raw[valid]
            width, height = source.width, source.height
            bounds = [float(v) for v in source.bounds]
            transform = [float(v) for v in source.transform[:6]]
            if width > MAX_GRID_DIMENSION or height > MAX_GRID_DIMENSION:
                raise DynamicWorldError("Earth Engine output grid exceeds the 10,000-pixel dimension limit.")
            profile.update(driver="GTiff", count=1, dtype="float32", nodata=NODATA, compress="deflate", predictor=3)
        with rasterio.open(output_path, "w", **profile) as target:
            target.write(values, 1)
            target.write_mask(valid.astype("uint8") * 255)
            target.update_tags(**tags)
        return {
            "width": width, "height": height, "crs": EXPORT_CRS,
            "transform": transform, "bounds": bounds, "pixel_area_m2": pixel_area,
            "valid_probability_pixels": int(valid.sum()), "export_grid_pixels": int(valid.size),
            "valid_probability_fraction": float(valid.mean()),
            "probability_median": float(np.median(valid_values)),
            "probability_p05": float(np.percentile(valid_values, 5)),
            "probability_p95": float(np.percentile(valid_values, 95)),
        }
    except DynamicWorldError:
        raise
    except Exception as exc:
        raise DynamicWorldError(f"Could not validate the probability GeoTIFF: {exc}") from exc


def _normalise_count_geotiff(raw_path: Path, output_path: Path, scene_date_count: int,
                             tags: dict[str, str]) -> dict[str, Any]:
    import numpy as np
    import rasterio
    from rasterio.crs import CRS
    try:
        with rasterio.open(raw_path) as source:
            if source.count != 1 or source.crs is None or source.crs != CRS.from_string(EXPORT_CRS):
                raise DynamicWorldError("Observation-count export must be a single-band EPSG:6933 GeoTIFF.")
            _require_north_up_10m(source.transform, "Observation-count export")
            raw = source.read(1).astype("float64")
            if not np.all(np.isfinite(raw)):
                raise DynamicWorldError("Observation-count raster contains non-finite values.")
            rounded = np.rint(raw)
            if np.any(np.abs(raw - rounded) > 1e-6) or np.any(rounded < 0) or np.any(rounded > scene_date_count):
                raise DynamicWorldError("Observation-count raster contains invalid distinct-date counts.")
            values = rounded.astype("uint16")
            profile = source.profile.copy()
            profile.update(driver="GTiff", count=1, dtype="uint16", nodata=None, compress="deflate")
            width, height = source.width, source.height
            bounds = [float(v) for v in source.bounds]
            transform = [float(v) for v in source.transform[:6]]
            if width > MAX_GRID_DIMENSION or height > MAX_GRID_DIMENSION:
                raise DynamicWorldError("Earth Engine count grid exceeds the 10,000-pixel dimension limit.")
        with rasterio.open(output_path, "w", **profile) as target:
            target.write(values, 1)
            target.write_mask(np.ones(values.shape, dtype="uint8") * 255)
            target.update_tags(**tags)
        return {
            "width": width, "height": height, "crs": EXPORT_CRS,
            "transform": transform, "bounds": bounds,
            "minimum_valid_date_count": int(values.min()),
            "maximum_valid_date_count": int(values.max()),
            "pixels_with_any_valid_observation": int(np.count_nonzero(values)),
            "pixels_meeting_minimum_observations": int(np.count_nonzero(values >= int(tags["MINIMUM_OBSERVATIONS_PER_PIXEL"]))),
        }
    except DynamicWorldError:
        raise
    except Exception as exc:
        raise DynamicWorldError(f"Could not validate the observation-count GeoTIFF: {exc}") from exc


def acquire_dynamic_world_mask(*, west: float, south: float, east: float, north: float,
                               start_text: str, end_text: str, buffer_m: int,
                               minimum_observations: int, probability_threshold: float,
                               output_dir: Path, project: str, service_account_json: str) -> dict[str, Any]:
    start, end = validate_request(
        west, south, east, north, start_text, end_text, buffer_m, minimum_observations,
    )
    if not math.isfinite(probability_threshold) or not 0 <= probability_threshold <= 1:
        raise DynamicWorldError("Probability threshold must be between 0 and 1.")
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    ee = _initialize_earth_engine(project, service_account_json)

    aoi = ee.Geometry.Rectangle([west, south, east, north], proj="EPSG:4326", geodesic=False)
    export_region = aoi.transform(EXPORT_CRS, 1).buffer(buffer_m, 1).bounds(1, EXPORT_CRS)
    collection = (
        ee.ImageCollection(DATASET)
        .filterBounds(aoi)
        .filterDate(start.isoformat(), (end + timedelta(days=1)).isoformat())
    )
    try:
        timestamps = collection.aggregate_array("system:time_start").getInfo()
        image_ids = collection.aggregate_array("system:index").getInfo()
    except Exception as exc:
        raise DynamicWorldError("Earth Engine could not query Dynamic World metadata; confirm dataset and project access.") from exc
    source = summarize_acquisition_timestamps(timestamps)
    if not isinstance(image_ids, list) or len(image_ids) != source["scene_record_count"]:
        raise DynamicWorldError("Earth Engine returned inconsistent scene IDs and acquisition timestamps.")
    source["source_image_ids"] = [str(item) for item in image_ids]
    source.update(assess_temporal_recency(source["latest_acquisition_date"], end.isoformat()))

    # Daily medians stop overlapping Sentinel-2 tiles on one date counting as multiple observations.
    daily_images = []
    for day_text in source["acquisition_dates"]:
        day = date.fromisoformat(day_text)
        daily_images.append(
            collection.filterDate(day.isoformat(), (day + timedelta(days=1)).isoformat())
            .select(PROBABILITY_BAND).median().rename(PROBABILITY_BAND)
        )
    daily_collection = ee.ImageCollection.fromImages(daily_images)
    daily_count = daily_collection.select(PROBABILITY_BAND).count().rename("valid_observation_count")
    probability = (
        daily_collection.select(PROBABILITY_BAND).median().rename("crops_probability")
        .updateMask(daily_count.gte(minimum_observations))
        .unmask(NODATA, False).clip(export_region)
    )
    count = daily_count.unmask(0, False).toUint16().clip(export_region)

    tags = {
        "DATASET": DATASET,
        "PROBABILITY_BAND": PROBABILITY_BAND,
        "SOURCE_WINDOW_START": start.isoformat(),
        "SOURCE_WINDOW_END": end.isoformat(),
        "COMPOSITE": "PIXELWISE_MEDIAN_OF_DAILY_MEDIANS",
        "MINIMUM_OBSERVATIONS_PER_PIXEL": str(minimum_observations),
        "EXPORT_BUFFER_METRES": str(buffer_m),
        "PROBABILITY_THRESHOLD_FOR_DOWNSTREAM_AUDIT": str(probability_threshold),
        "SOURCE_CRS": EXPORT_CRS,
        "SOURCE_PIXEL_SIZE_METRES": str(EXPORT_SCALE_METRES),
        "INTERPRETATION": "GENERIC_CROPS_LIKELIHOOD_NOT_RICE_SPECIFIC_OR_FIELD_TRUTH",
    }
    probability_name = "dynamic-world-crops-probability.tif"
    count_name = "dynamic-world-valid-observation-count.tif"
    with tempfile.TemporaryDirectory(prefix="dynamic-world-ee-") as temp:
        raw_probability, raw_count = Path(temp) / "probability.tif", Path(temp) / "count.tif"
        _download_ee_geotiff(probability, export_region, raw_probability, "dw-crop-probability")
        _download_ee_geotiff(count, export_region, raw_count, "dw-valid-observation-count")
        probability_stats = _normalise_probability_geotiff(raw_probability, output_dir / probability_name, tags)
        count_stats = _normalise_count_geotiff(raw_count, output_dir / count_name, source["unique_acquisition_date_count"], tags)
    grid_matches = (
        probability_stats["width"] == count_stats["width"]
        and probability_stats["height"] == count_stats["height"]
        and probability_stats["crs"] == count_stats["crs"]
        and all(
            math.isclose(float(left), float(right), rel_tol=0.0, abs_tol=1e-6)
            for field in ("transform", "bounds")
            for left, right in zip(probability_stats[field], count_stats[field])
        )
    )
    if not grid_matches:
        raise DynamicWorldError(
            "Probability and observation-count rasters do not share an identical CRS, affine transform, dimensions and bounds."
        )

    manifest = {
        "schema_version": 1,
        "status": source["status"],
        "dataset": DATASET,
        "dataset_producer": "World Resources Institute and Google",
        "dataset_doi": "10.1038/s41597-022-01307-4",
        "class": "crops",
        "class_interpretation": "Generic crops likelihood; not rice-specific, crop-species identification, or parcel ground truth.",
        "aoi_wgs84": {"west": west, "south": south, "east": east, "north": north},
        "requested_window": {"start": start.isoformat(), "end": end.isoformat()},
        "source_observations": source,
        "composite": {
            "method": "PIXELWISE_MEDIAN_OF_DAILY_MEDIANS",
            "distinct_acquisition_dates": source["unique_acquisition_date_count"],
            "minimum_valid_dates_per_pixel": minimum_observations,
            "cloud_and_shadow_masking": "INHERITED_FROM_DYNAMIC_WORLD_SOURCE_MASK",
            "recency_assessment": {
                "days_from_latest_scene_to_requested_end": source["days_from_latest_scene_to_requested_end"],
                "cue_days": RECENCY_CUE_DAYS,
                "status": source["status"],
                "interpretation": source["interpretation"],
            },
        },
        "downstream_probability_threshold": probability_threshold,
        "export": {
            "crs": EXPORT_CRS, "pixel_size_metres": EXPORT_SCALE_METRES, "buffer_metres": buffer_m,
            "probability_file": probability_name,
            "probability_sha256": _sha256(output_dir / probability_name),
            "probability_bytes": (output_dir / probability_name).stat().st_size,
            "probability_grid": probability_stats,
            "observation_count_file": count_name,
            "observation_count_sha256": _sha256(output_dir / count_name),
            "observation_count_bytes": (output_dir / count_name).stat().st_size,
            "observation_count_grid": count_stats,
        },
        "interpretation_limits": [
            "Dynamic World is a Sentinel-2-derived generic land-cover probability product; the crops band does not identify rice or a specific crop.",
            "The median composite represents the requested time window, not the crop state on every individual SME2 acquisition date.",
            "The per-pixel count raster records distinct UTC acquisition dates with valid crops-band pixels; it is not a ground-truth confidence score.",
            "The 18-day source-recency cue is descriptive only, not a scientific acceptance threshold.",
            "A high crops probability is not a verified field boundary or independent field validation.",
            "No SME2 quality mask, crop-area aggregation, study analysis, rainfall attachment, public publication, or automatic track ranking is performed by this acquisition step.",
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    manifest_path = output_dir / "dynamic-world-source-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    summary = [
        "## Dynamic World independent crop-mask acquisition", "",
        f"- Source: {DATASET} / crops probability (10 m)",
        f"- Requested window: {start.isoformat()} to {end.isoformat()}",
        f"- Unique acquisition dates: {source['unique_acquisition_date_count']} ({source['first_acquisition_date']} to {source['latest_acquisition_date']})",
        f"- Latest-scene recency: {source['days_from_latest_scene_to_requested_end']} days before requested end ({source['status']})",
        f"- Minimum distinct valid observations per pixel: {minimum_observations}",
        f"- Probability raster valid pixels: {probability_stats['valid_probability_pixels']:,} / {probability_stats['export_grid_pixels']:,} ({probability_stats['valid_probability_fraction']:.1%})",
        f"- Median crops probability on exported valid pixels: {probability_stats['probability_median']:.3f}",
        f"- Export grid: {probability_stats['width']} × {probability_stats['height']} at 10 m in EPSG:6933", "",
        "This is an independent generic-cropland candidate, not rice identification or a validated crop mask. "
        "Review source dates, latest-scene gap, probability distribution, per-pixel counts and spatial coverage before SME2 use.",
        "",
        "This workflow does not run SME2 analysis, attach rainfall, call the publisher, or modify public/agriculture/current.", "",
    ]
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n".join(summary))
    print(f"Dynamic World source manifest: {manifest_path}")
    print(f"Crop-probability raster: {output_dir / probability_name}")
    print(f"Distinct-date observation-count raster: {output_dir / count_name}")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--west", type=float, required=True)
    parser.add_argument("--south", type=float, required=True)
    parser.add_argument("--east", type=float, required=True)
    parser.add_argument("--north", type=float, required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--buffer-m", type=int, default=600)
    parser.add_argument("--minimum-observations", type=int, default=3)
    parser.add_argument("--probability-threshold", type=float, default=0.5)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        acquire_dynamic_world_mask(
            west=args.west, south=args.south, east=args.east, north=args.north,
            start_text=args.start, end_text=args.end, buffer_m=args.buffer_m,
            minimum_observations=args.minimum_observations,
            probability_threshold=args.probability_threshold,
            output_dir=args.output_dir,
            project=os.environ.get("EARTH_ENGINE_PROJECT", ""),
            service_account_json=os.environ.get("EARTH_ENGINE_SERVICE_ACCOUNT_JSON", ""),
        )
        return 0
    except (DynamicWorldError, OSError, ValueError, TypeError, KeyError) as exc:
        print(f"DYNAMIC WORLD ACQUISITION ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

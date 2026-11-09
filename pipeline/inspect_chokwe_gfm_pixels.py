"""Audit exact Chókwè pixels in close-date Copernicus GFM COG assets.

This inspects only the analyst-defined Chókwè rectangle and only the
17 January 2026 Sentinel-1 GFM items. It reports source masks and value
histograms; it does not calculate overlap with NISAR or accuracy scores.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import rasterio
from rasterio.features import bounds as geometry_bounds
from rasterio.features import geometry_mask
from rasterio.transform import array_bounds
from rasterio.warp import transform_geom
from rasterio.windows import Window, from_bounds

import discover_chokwe_gfm as discovery


STUDY_GEOMETRY = {
    "type": "Polygon",
    "coordinates": [[
        [32.93, -24.58],
        [33.03, -24.58],
        [33.03, -24.48],
        [32.93, -24.48],
        [32.93, -24.58],
    ]],
}
EVENT_DATE = "2026-01-17"
NISAR_EVENT_TIME = "2026-01-17T03:42:32Z"
ASSET_NAMES = (
    "ensemble_flood_extent",
    "ensemble_likelihood",
    "ensemble_water_extent",
    "exclusion_mask",
    "reference_water_mask",
)
DEFAULT_OUTPUT = (
    Path(__file__).resolve().parent
    / "output"
    / "reference-cache"
    / "chokwe_gfm_pixel_audit.json"
)
API_HOST = "data.eodc.eu"


def select_event_items(items: list[dict], event_date: str = EVENT_DATE) -> list[dict]:
    """Select and chronologically sort source items for the NISAR event date."""
    selected = []
    for item in items:
        properties = item.get("properties")
        if not isinstance(properties, dict):
            continue
        timestamp = properties.get("datetime")
        if isinstance(timestamp, str) and timestamp[:10] == event_date:
            selected.append(item)
    return sorted(selected, key=lambda item: (
        item["properties"].get("datetime", ""),
        item.get("id", ""),
    ))


def value_histogram(values: np.ndarray) -> dict[str, int]:
    """Return deterministic counts for all observed raster values."""
    unique, counts = np.unique(values, return_counts=True)
    return {str(value.item()): int(count) for value, count in zip(unique, counts)}


def _safe_asset_url(asset: dict, item_id: str, asset_name: str) -> str:
    href = asset.get("href")
    parsed = urlparse(href if isinstance(href, str) else "")
    if (
        parsed.scheme != "https"
        or parsed.hostname != API_HOST
        or not parsed.path.lower().endswith((".tif", ".tiff"))
    ):
        raise ValueError(
            f"Refusing unexpected URL for {item_id}/{asset_name}."
        )
    return href


def _window_for_geometry(src, projected_geometry: dict) -> Window:
    bounds = geometry_bounds(projected_geometry)
    requested = from_bounds(*bounds, transform=src.transform)
    requested = requested.round_offsets().round_lengths()
    full = Window(0, 0, src.width, src.height)
    try:
        clipped = requested.intersection(full)
    except Exception as error:
        raise ValueError("The Chókwè geometry does not intersect the GFM raster.") from error
    if clipped.width <= 0 or clipped.height <= 0:
        raise ValueError("The Chókwè geometry does not intersect the GFM raster.")
    return clipped


def inspect_asset(url: str, expected_grid: dict | None = None) -> dict:
    """Read a small exact-AOI window from a public COG over HTTP range requests."""
    with rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.tiff",
        GDAL_HTTP_MULTIRANGE="YES",
        GDAL_CACHEMAX=128,
    ):
        with rasterio.open(url) as src:
            if src.crs is None or src.count != 1:
                raise ValueError("GFM source raster must have a CRS and one band.")

            grid = {
                "crs": src.crs.to_string(),
                "width": int(src.width),
                "height": int(src.height),
                "transform": [float(value) for value in src.transform[:6]],
            }
            if expected_grid is not None and grid != expected_grid:
                raise ValueError("GFM layers for one acquisition do not share an identical grid.")

            projected = transform_geom("EPSG:4326", src.crs, STUDY_GEOMETRY)
            window = _window_for_geometry(src, projected)
            data = src.read(1, window=window, masked=False)
            source_mask = src.read_masks(1, window=window) > 0
            transform = src.window_transform(window)
            inside_aoi = geometry_mask(
                [projected],
                out_shape=data.shape,
                transform=transform,
                all_touched=False,
                invert=True,
            )
            finite = np.isfinite(data)
            nodata = src.nodata
            if nodata is not None and math.isfinite(float(nodata)):
                finite &= data != nodata
            valid = inside_aoi & source_mask & finite
            values = data[valid]

            inside_count = int(inside_aoi.sum())
            valid_count = int(valid.sum())
            invalid_count = inside_count - valid_count
            if inside_count == 0:
                raise ValueError("The projected Chókwè AOI contains no raster pixel centers.")

            return {
                "url": url,
                "grid": grid,
                "raster": {
                    "driver": src.driver,
                    "dtype": src.dtypes[0],
                    "nodata": nodata,
                    "compression": src.compression.value if src.compression else None,
                    "block_shapes": [list(shape) for shape in src.block_shapes],
                    "descriptions": list(src.descriptions),
                    "tags": {
                        str(key): str(value)[:500]
                        for key, value in src.tags().items()
                    },
                },
                "window": {
                    "row_off": int(window.row_off),
                    "col_off": int(window.col_off),
                    "height": int(window.height),
                    "width": int(window.width),
                    "aoi_pixel_centers": inside_count,
                },
                "coverage": {
                    "valid_pixel_count": valid_count,
                    "invalid_or_nodata_pixel_count": invalid_count,
                    "valid_fraction_of_aoi": valid_count / inside_count,
                    "value_histogram_on_valid_aoi_pixels": value_histogram(values),
                },
            }


def build_report(items: list[dict]) -> dict:
    selected = select_event_items(items)
    if not selected:
        raise ValueError(f"No GFM STAC items were returned for {EVENT_DATE}.")
    cache: dict[str, dict] = {}
    acquisitions = []

    for item in selected:
        item_id = item.get("id")
        properties = item.get("properties", {})
        timestamp = properties.get("datetime")
        if not isinstance(item_id, str) or not isinstance(timestamp, str):
            raise ValueError("A selected GFM item is missing its ID or datetime.")
        assets = item.get("assets")
        if not isinstance(assets, dict):
            raise ValueError(f"GFM item {item_id} has no assets dictionary.")

        grid = None
        results = {}
        for asset_name in ASSET_NAMES:
            asset = assets.get(asset_name)
            if not isinstance(asset, dict):
                results[asset_name] = {"status": "MISSING_ASSET"}
                continue
            url = _safe_asset_url(asset, item_id, asset_name)
            if url not in cache:
                cache[url] = inspect_asset(url, expected_grid=grid)
            result = cache[url]
            grid = result["grid"] if grid is None else grid
            results[asset_name] = {
                key: value for key, value in result.items() if key != "url"
            }

        event_time = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        nisar_time = datetime.fromisoformat(NISAR_EVENT_TIME.replace("Z", "+00:00"))
        acquisitions.append({
            "item_id": item_id,
            "datetime": timestamp,
            "minutes_from_nisar_event": round(
                (event_time - nisar_time).total_seconds() / 60, 2
            ),
            "source_properties": {
                key: properties.get(key)
                for key in ("constellation", "platform", "instruments", "gsd",
                            "proj:epsg", "proj:wkt2", "proj:shape", "proj:transform")
                if key in properties
            },
            "assets": results,
        })

    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "AOI_RASTER_WINDOWS_INSPECTED",
        "study": {
            "name": "Chokwe event study box",
            "bounds_wgs84": [32.93, -24.58, 33.03, -24.48],
            "boundary_type": "operator-selected rectangular analysis box",
            "boundary_is_authoritative": False,
        },
        "event": {
            "nisar_event_time_utc": NISAR_EVENT_TIME,
            "gfm_event_date_utc": EVENT_DATE,
            "gfm_item_count": len(acquisitions),
            "assets_inspected": list(ASSET_NAMES),
            "raster_pixels_read": True,
        },
        "acquisitions": acquisitions,
        "interpretation_limits": [
            "This is an exact-AOI raster-support and value audit, not a NISAR/GFM spatial overlap result.",
            "Raster value codes are reported without assigning flood-class meanings; consult the version-matched GFM manual before interpreting them.",
            "Valid coverage includes source-valid pixels only and does not itself imply flood observability or classification confidence.",
            "Reference-water and exclusion masks must be interpreted separately; permanent water and excluded pixels are not event flood positives or reference negatives.",
            "No precision, recall, F1, accuracy or field-validation score is calculated.",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)

    try:
        payload = discovery.build_search_payload(EVENT_DATE, EVENT_DATE)
        items = discovery.fetch_stac_items(payload)
        report = build_report(items)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(report, indent=2, allow_nan=False) + chr(10),
            encoding="utf-8",
        )
    except Exception as error:
        print(f"GFM pixel audit failed: {error}", file=sys.stderr)
        return 2

    print("Status:", report["status"])
    print("GFM event-date items:", report["event"]["gfm_item_count"])
    for acquisition in report["acquisitions"]:
        flood = acquisition["assets"].get("ensemble_flood_extent", {})
        coverage = flood.get("coverage", {})
        print(
            acquisition["datetime"],
            "AOI-valid fraction:",
            coverage.get("valid_fraction_of_aoi", "unavailable"),
            "flood value histogram:",
            coverage.get("value_histogram_on_valid_aoi_pixels", {}),
        )
    print("Saved metadata and raster-window audit:", args.output)
    print("No NISAR overlap or accuracy metrics were calculated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

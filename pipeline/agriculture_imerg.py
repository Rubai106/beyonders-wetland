#!/usr/bin/env python3
"""NASA GPM IMERG Final daily precipitation context for Agriculture SME2 studies.

This module deliberately keeps IMERG on its native 0.1-degree grid. It attaches
only AOI-area-weighted daily summaries to an existing, already analyzed SME2
study. It does not resample precipitation to the SME2 grid or claim causation.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import h5py
import numpy as np

from agriculture_sme2 import (
    AgricultureError,
    CMR_PAGE_SIZE,
    OUTPUT_ROOT,
    json_read,
    json_write,
    run_folder,
    safe_run_id,
    sha256_file,
)

IMERG_COLLECTION = "GPM_3IMERGDF"
IMERG_VERSION = "07"
IMERG_PRODUCT = "GPM_3IMERGDF_V07"
IMERG_DOI = "10.5067/GPM/IMERGDF/DAY/07"
IMERG_RESOLUTION_DEGREES = 0.1
IMERG_SPATIAL_COVERAGE_FLOOR = 0.90
IMERG_MAX_HALF_HOURLY_SAMPLES = 48
IMERG_WINDOWS = (1, 3, 7, 12)
DATE_IN_TITLE = re.compile(r"(?<!\d)(20\d{6})(?!\d)")


def _utc_day(value: str) -> date:
    try:
        parsed = date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise AgricultureError(f"Invalid SME2 observation date for IMERG alignment: {value!r}") from exc
    if parsed.isoformat() != value:
        raise AgricultureError(f"Non-canonical SME2 observation date for IMERG alignment: {value!r}")
    return parsed


def required_imerg_dates(observation_dates: list[str]) -> list[str]:
    """Return the exact union of complete UTC days preceding all SME2 dates."""
    if not observation_dates:
        raise AgricultureError("SME2 study contains no observations for rainfall alignment.")
    required: set[date] = set()
    parsed = [_utc_day(value) for value in observation_dates]
    if parsed != sorted(set(parsed)):
        raise AgricultureError("SME2 observation dates must be unique and chronological.")
    for acquisition in parsed:
        for offset in range(1, max(IMERG_WINDOWS) + 1):
            required.add(acquisition - timedelta(days=offset))
    return [item.isoformat() for item in sorted(required)]


def parse_imerg_granule_date(entry: dict[str, Any]) -> str:
    """Resolve the daily UTC date from CMR's start time, then the granule title."""
    for key in ("time_start", "BeginningDateTime", "beginningDateTime"):
        value = entry.get(key)
        if isinstance(value, str):
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                return parsed.date().isoformat()
            except ValueError:
                pass
    title = str(entry.get("title") or "")
    match = DATE_IN_TITLE.search(title)
    if not match:
        raise AgricultureError(f"IMERG CMR granule has no parseable UTC day: {title!r}")
    return datetime.strptime(match.group(1), "%Y%m%d").date().isoformat()


def select_imerg_granules(
    entries: list[dict[str, Any]],
    required_dates: list[str],
) -> dict[str, dict[str, Any]]:
    """Keep one V07 daily granule per date; break reprocessing ties deterministically."""
    required = set(required_dates)
    selected: dict[str, dict[str, Any]] = {}
    for entry in entries:
        title = str(entry.get("title") or "").strip()
        concept_id = str(entry.get("id") or "").strip()
        if not title or not concept_id:
            continue
        filename = Path(title).name
        if not filename.lower().endswith((".nc4", ".nc", ".hdf5", ".h5")):
            continue
        try:
            granule_date = parse_imerg_granule_date(entry)
        except AgricultureError:
            continue
        if granule_date not in required:
            continue
        updated = str(entry.get("updated") or "")
        candidate = {
            "date": granule_date,
            "concept_id": concept_id,
            "title": title,
            "filename": filename,
            "updated": updated,
        }
        previous = selected.get(granule_date)
        if previous is None or (updated, concept_id) > (previous["updated"], previous["concept_id"]):
            selected[granule_date] = candidate
    return selected


def search_imerg_daily(aoi: dict[str, float], required_dates: list[str]) -> dict[str, Any]:
    """Discover daily V07 Final granules through CMR, not retired GES DISC hosts."""
    if not required_dates:
        raise AgricultureError("No daily dates were requested for IMERG.")
    start, end = required_dates[0], required_dates[-1]
    params = {
        "short_name": IMerg_COLLECTION,
        "version": IMERG_VERSION,
        "provider": "GES_DISC",
        "temporal": f"{start}T00:00:00Z,{end}T23:59:59Z",
        "bounding_box": ",".join(str(aoi[key]) for key in ("west", "south", "east", "north")),
        "page_size": str(CMR_PAGE_SIZE),
        "sort_key": "-start_date",
    }
    from urllib.parse import urlencode
    from urllib.request import Request, urlopen

    url = "https://cmr.earthdata.nasa.gov/search/granules.json?" + urlencode(params)
    request = Request(url, headers={"User-Agent": "Beyonders-Agriculture-IMERG/1.0", "Accept": "application/json"})
    try:
        with urlopen(request, timeout=45) as response:
            raw_hits = response.headers.get("CMR-Hits")
            payload = json.load(response)
    except Exception as exc:
        raise AgricultureError(f"NASA CMR IMERG search failed: {exc}") from exc

    entries = payload.get("feed", {}).get("entry", [])
    if not isinstance(entries, list):
        raise AgricultureError("NASA CMR returned an invalid IMERG granule list.")
    try:
        hit_count = int(raw_hits) if raw_hits is not None else None
    except (TypeError, ValueError):
        hit_count = None
    if hit_count is not None and hit_count > len(entries):
        raise AgricultureError(
            f"NASA CMR matched {hit_count} IMERG granules but returned {len(entries)}; "
            "refusing to process a truncated daily series."
        )
    if hit_count is None and len(entries) >= CMR_PAGE_SIZE:
        raise AgricultureError("NASA CMR returned a full page without a usable hit count; narrow the date range.")

    selected = select_imerg_granules(entries, required_dates)
    return {
        "schema_version": 1,
        "collection": IMerg_COLLECTION,
        "version": IMERG_VERSION,
        "product": IMERG_PRODUCT,
        "doi": IMERG_DOI,
        "aoi": aoi,
        "required_dates": required_dates,
        "catalogue_hits": hit_count if hit_count is not None else len(entries),
        "selected_granules": [selected[day] for day in sorted(selected)],
        "missing_dates": [day for day in required_dates if day not in selected],
        "searched_at": datetime.now(timezone.utc).isoformat(),
    }


def download_imerg_granules(run_id: str, search_manifest: dict[str, Any]) -> dict[str, Path]:
    """Download selected CMR concept IDs using Earthaccess authentication."""
    folder = run_folder(run_id) / "imerg" / "granules"
    folder.mkdir(parents=True, exist_ok=True)
    try:
        import earthaccess
        auth = earthaccess.login(strategy="interactive", persist=True)
        if not auth:
            raise AgricultureError("Earthdata Login was not established for IMERG download.")
        downloaded_by_date: dict[str, Path] = {}
        for item in search_manifest["selected_granules"]:
            exact = earthaccess.search_data(concept_id=item["concept_id"])
            if not exact:
                raise AgricultureError(f"Could not re-resolve IMERG CMR concept ID {item['concept_id']}.")
            downloaded = earthaccess.download(exact, str(folder))
            candidates = [Path(value) for value in (downloaded or []) if Path(value).is_file()]
            matches = [path for path in candidates if path.name == item["filename"]]
            if not matches:
                matches = [path for path in folder.rglob("*") if path.is_file() and path.name == item["filename"]]
            if len(matches) != 1:
                raise AgricultureError(
                    f"Expected exactly one downloaded IMERG file named {item['filename']}; found {len(matches)}."
                )
            downloaded_by_date[item["date"]] = matches[0]
        return downloaded_by_date
    except AgricultureError:
        raise
    except Exception as exc:
        raise AgricultureError(f"Earthdata IMERG download failed: {exc}") from exc


def _dataset_by_basename(handle: h5py.File, basename: str) -> h5py.Dataset:
    matches: list[h5py.Dataset] = []
    def collect(_name: str, obj: Any) -> None:
        if isinstance(obj, h5py.Dataset) and obj.name.rsplit("/", 1)[-1] == basename:
            matches.append(obj)
    handle.visititems(collect)
    if len(matches) != 1:
        raise AgricultureError(
            f"IMERG daily file must contain exactly one {basename!r} dataset; found {len(matches)}."
        )
    return matches[0]


def _attribute_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace").strip("\x00 ")
    if isinstance(value, np.ndarray) and value.size == 1:
        return _attribute_text(value.reshape(-1)[0])
    return str(value).strip()


def _scaled_variable(dataset: h5py.Dataset, label: str) -> tuple[np.ndarray, np.ndarray]:
    raw = np.asarray(dataset[...], dtype="float64")
    valid = np.isfinite(raw)
    for key in ("_FillValue", "missing_value"):
        if key in dataset.attrs:
            fills = np.asarray(dataset.attrs[key]).reshape(-1)
            for fill in fills:
                try:
                    valid &= raw != float(fill)
                except (TypeError, ValueError):
                    continue
    valid_min = dataset.attrs.get("valid_min")
    valid_max = dataset.attrs.get("valid_max")
    if valid_min is not None:
        valid &= raw >= float(np.asarray(valid_min).reshape(-1)[0])
    if valid_max is not None:
        valid &= raw <= float(np.asarray(valid_max).reshape(-1)[0])
    scale = float(np.asarray(dataset.attrs.get("scale_factor", 1.0)).reshape(-1)[0])
    offset = float(np.asarray(dataset.attrs.get("add_offset", 0.0)).reshape(-1)[0])
    if not np.isfinite(scale) or not np.isfinite(offset):
        raise AgricultureError(f"IMERG {label} has non-finite scale/offset metadata.")
    values = raw * scale + offset
    return values, valid


def _orient_grid(values: np.ndarray, lat_count: int, lon_count: int, label: str) -> np.ndarray:
    squeezed = np.squeeze(values)
    if squeezed.ndim != 2:
        raise AgricultureError(f"IMERG {label} must resolve to a two-dimensional daily grid.")
    if squeezed.shape == (lat_count, lon_count):
        return np.asarray(squeezed, dtype="float64")
    if squeezed.shape == (lon_count, lat_count):
        return np.asarray(squeezed.T, dtype="float64")
    raise AgricultureError(
        f"IMERG {label} shape {squeezed.shape} does not match latitude/longitude axes "
        f"({lat_count}, {lon_count}) or ({lon_count}, {lat_count})."
    )


def _normalize_coordinates(lon: np.ndarray, lat: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    lon = np.asarray(lon, dtype="float64").reshape(-1)
    lat = np.asarray(lat, dtype="float64").reshape(-1)
    if lon.size < 2 or lat.size < 2 or not np.isfinite(lon).all() or not np.isfinite(lat).all():
        raise AgricultureError("IMERG daily file has invalid latitude/longitude coordinates.")
    if np.nanmax(lon) > 180:
        lon = ((lon + 180.0) % 360.0) - 180.0
    lon_order = np.argsort(lon)
    lat_order = np.argsort(lat)
    lon = lon[lon_order]
    lat = lat[lat_order]
    values = values[np.ix_(lat_order, lon_order)]
    dx = np.diff(lon)
    dy = np.diff(lat)
    if (np.any(dx <= 0) or np.any(dy <= 0) or
            np.max(np.abs(dx - IMERG_RESOLUTION_DEGREES)) > 0.001 or
            np.max(np.abs(dy - IMERG_RESOLUTION_DEGREES)) > 0.001):
        raise AgricultureError("IMERG V07 daily coordinate axes are not regular 0.1-degree grids.")
    return lon, lat, values


def _aoi_area_weights(
    lon: np.ndarray,
    lat: np.ndarray,
    aoi: dict[str, float],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Compute exact spherical area weights for native grid-cell/AOI intersections."""
    west, south, east, north = (float(aoi[key]) for key in ("west", "south", "east", "north"))
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise AgricultureError("IMERG AOI must be a non-wrapping WGS84 bounding box.")
    half = IMERG_RESOLUTION_DEGREES / 2.0
    lon_columns = np.flatnonzero((lon + half > west) & (lon - half < east))
    lat_rows = np.flatnonzero((lat + half > south) & (lat - half < north))
    if lon_columns.size == 0 or lat_rows.size == 0:
        raise AgricultureError("The Agriculture AOI does not intersect the native IMERG 0.1-degree grid.")
    weights = np.zeros((lat_rows.size, lon_columns.size), dtype="float64")
    for row_pos, row in enumerate(lat_rows):
        cell_south = max(south, float(lat[row]) - half)
        cell_north = min(north, float(lat[row]) + half)
        lat_factor = np.sin(np.deg2rad(cell_north)) - np.sin(np.deg2rad(cell_south))
        for col_pos, col in enumerate(lon_columns):
            cell_west = max(west, float(lon[col]) - half)
            cell_east = min(east, float(lon[col]) + half)
            lon_factor = np.deg2rad(cell_east - cell_west)
            weights[row_pos, col_pos] = lon_factor * lat_factor
    if not np.isfinite(weights).all() or np.any(weights <= 0):
        raise AgricultureError("IMERG AOI intersection produced invalid native-cell area weights.")
    return lat_rows, lon_columns, weights


def read_imerg_daily(path: Path, aoi: dict[str, float]) -> dict[str, Any]:
    """Read daily mm/day estimates and count support from a genuine NetCDF4/HDF5 file."""
    try:
        with h5py.File(path, "r") as handle:
            precip_ds = _dataset_by_basename(handle, "precipitation")
            count_ds = _dataset_by_basename(handle, "precipitation_cnt")
            lat_ds = _dataset_by_basename(handle, "lat")
            lon_ds = _dataset_by_basename(handle, "lon")
            units = _attribute_text(precip_ds.attrs.get("units", "")).lower().replace(" ", "")
            if units not in {"mm/day", "mmd-1", "mmday-1", "mmday^-1"}:
                raise AgricultureError(
                    f"IMERG daily precipitation units must be mm/day; {path.name} declares {units!r}."
                )
            lat = np.asarray(lat_ds[...], dtype="float64").reshape(-1)
            lon = np.asarray(lon_ds[...], dtype="float64").reshape(-1)
            precip_raw, precip_valid = _scaled_variable(precip_ds, "precipitation")
            count_raw, count_valid = _scaled_variable(count_ds, "precipitation_cnt")
            precip = _orient_grid(precip_raw, lat.size, lon.size, "precipitation")
            pvalid = _orient_grid(precip_valid, lat.size, lon.size, "precipitation validity").astype(bool)
            counts = _orient_grid(count_raw, lat.size, lon.size, "precipitation_cnt")
            cvalid = _orient_grid(count_valid, lat.size, lon.size, "precipitation_cnt validity").astype(bool)
    except AgricultureError:
        raise
    except (OSError, KeyError, ValueError) as exc:
        raise AgricultureError(f"Could not read IMERG NetCDF4 daily granule {path.name}: {exc}") from exc

    # V07 daily precipitation is the daily mean rate (mm/hour) multiplied by 24,
    # i.e. a daily estimate in mm/day. It is not a half-hourly rate field.
    source_lon, source_lat = lon.copy(), lat.copy()
    lon, lat, precip = _normalize_coordinates(source_lon, source_lat, precip)
    lon_check, lat_check, pvalid_grid = _normalize_coordinates(source_lon, source_lat, pvalid.astype("float64"))
    lon_count, lat_count, counts = _normalize_coordinates(source_lon, source_lat, counts)
    lon_count_check, lat_count_check, cvalid_grid = _normalize_coordinates(
        source_lon, source_lat, cvalid.astype("float64"),
    )
    if not (np.allclose(lon, lon_check) and np.allclose(lat, lat_check) and
            np.allclose(lon, lon_count) and np.allclose(lat, lat_count) and
            np.allclose(lon, lon_count_check) and np.allclose(lat, lat_count_check)):
        raise AgricultureError("IMERG precipitation, count and validity layers use inconsistent coordinate axes.")
    pvalid = pvalid_grid > 0.5
    cvalid = cvalid_grid > 0.5
    rows, columns, weights = _aoi_area_weights(lon, lat, aoi)
    selected_precip = precip[np.ix_(rows, columns)]
    selected_counts = counts[np.ix_(rows, columns)]
    valid = pvalid[np.ix_(rows, columns)] & cvalid[np.ix_(rows, columns)]
    valid &= np.isfinite(selected_precip) & (selected_precip >= 0)
    valid &= np.isfinite(selected_counts) & (selected_counts >= 1)
    valid &= (selected_counts <= IMERG_MAX_HALF_HOURLY_SAMPLES)
    valid &= np.abs(selected_counts - np.round(selected_counts)) < 1e-6
    total_weight = float(weights.sum())
    valid_weight = float(weights[valid].sum())
    coverage = valid_weight / total_weight if total_weight > 0 else 0.0
    if valid_weight > 0:
        rainfall = float(np.sum(selected_precip[valid] * weights[valid]) / valid_weight)
        mean_samples = float(np.sum(selected_counts[valid] * weights[valid]) / valid_weight)
    else:
        rainfall, mean_samples = None, None
    if coverage + 1e-12 < IMERG_SPATIAL_COVERAGE_FLOOR:
        rainfall = None
    return {
        "rainfall_mm": rainfall,
        "spatial_coverage_fraction": float(coverage),
        "mean_half_hourly_samples": mean_samples,
        "valid_grid_cells": int(np.sum(valid)),
        "total_grid_cells": int(valid.size),
    }


def build_imerg_windows(
    observation_dates: list[str],
    daily: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Sum complete daily mm/day estimates; incomplete or under-covered windows stay null."""
    output: list[dict[str, Any]] = []
    for acquisition_text in observation_dates:
        acquisition = _utc_day(acquisition_text)
        windows: dict[str, Any] = {}
        for length in IMERG_WINDOWS:
            daily_records: list[dict[str, Any] | None] = []
            for offset in range(length, 0, -1):
                key = (acquisition - timedelta(days=offset)).isoformat()
                daily_records.append(daily.get(key))
            valid_records = [
                item for item in daily_records
                if item is not None and item.get("rainfall_mm") is not None and
                float(item.get("spatial_coverage_fraction", 0)) >= IMERG_SPATIAL_COVERAGE_FLOOR
            ]
            complete = len(valid_records) == length
            coverages = [
                float(item["spatial_coverage_fraction"]) if item is not None else 0.0
                for item in daily_records
            ]
            samples = [
                float(item["mean_half_hourly_samples"])
                for item in valid_records if item.get("mean_half_hourly_samples") is not None
            ]
            windows[f"{length}d"] = {
                "rainfall_mm": round(sum(float(item["rainfall_mm"]) for item in valid_records), 4) if complete else None,
                "valid_days": len(valid_records),
                "expected_days": length,
                "spatial_coverage_fraction": round(min(coverages, default=0.0), 6),
                "mean_half_hourly_samples": round(float(np.mean(samples)), 3) if complete and samples else None,
            }
        output.append({"date": acquisition_text, "windows": windows})
    return output


def attach_imerg_rainfall(run_id: str) -> dict[str, Any]:
    """Search, download, summarize and attach real IMERG context to an analyzed SME2 run."""
    safe_run_id(run_id)
    folder = run_folder(run_id)
    result_dir = folder / "result"
    study_path = result_dir / "study.json"
    study = json_read(study_path)
    if study.get("run_id") != run_id or not isinstance(study.get("observations"), list):
        raise AgricultureError("A matching analyzed SME2 study is required before IMERG rainfall can be attached.")
    if "rainfall_context" in study:
        raise AgricultureError("This SME2 study already has rainfall_context; analyze again before replacing it.")
    observation_dates = [str(item.get("date", "")) for item in study["observations"]]
    required_dates = required_imerg_dates(observation_dates)
    aoi = study.get("aoi")
    if not isinstance(aoi, dict):
        raise AgricultureError("Analyzed SME2 study has no valid AOI metadata.")
    search_manifest = search_imerg_daily(aoi, required_dates)
    imerg_dir = folder / "imerg"
    imerg_dir.mkdir(parents=True, exist_ok=True)
    json_write(imerg_dir / "search.json", search_manifest)
    if not search_manifest["selected_granules"]:
        raise AgricultureError("NASA CMR found no GPM IMERG Final daily V07 granules for the SME2 observation windows.")

    files = download_imerg_granules(run_id, search_manifest)
    daily: dict[str, dict[str, Any]] = {}
    granule_receipts: list[dict[str, Any]] = []
    daily_diagnostics: list[dict[str, Any]] = []
    selected_by_date = {item["date"]: item for item in search_manifest["selected_granules"]}
    for granule_date, path in sorted(files.items()):
        metadata = selected_by_date[granule_date]
        record = read_imerg_daily(path, aoi)
        daily[granule_date] = record
        receipt = {
            "date": granule_date,
            "concept_id": metadata["concept_id"],
            "filename": path.name,
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        granule_receipts.append(receipt)
        daily_diagnostics.append({"date": granule_date, **record})

    if not daily:
        raise AgricultureError("No IMERG daily files passed the local file verification step.")
    canonical_sources = json.dumps(granule_receipts, sort_keys=True, separators=(",", ":")).encode("utf-8")
    source_digest = hashlib.sha256(canonical_sources).hexdigest()
    total_source_bytes = sum(item["bytes"] for item in granule_receipts)
    windows = build_imerg_windows(observation_dates, daily)
    if not any(
        item["windows"][f"{length}d"]["rainfall_mm"] is not None
        for item in windows for length in IMERG_WINDOWS
    ):
        raise AgricultureError(
            "IMERG files were found, but no complete rainfall window met the 90% native-cell spatial coverage rule; "
            "the SME2 publication was left unchanged."
        )

    context = {
        "method": "GPM_IMERG_FINAL_DAILY_AOI_MEAN_V1",
        "product": IMERG_PRODUCT,
        "resolution_degrees": IMERG_RESOLUTION_DEGREES,
        "units": "mm",
        "time_basis": "UTC_COMPLETE_DAYS_BEFORE_ACQUISITION",
        "source": "NASA GPM IMERG Final daily precipitation V07",
        "source_doi": IMERG_DOI,
        "source_sha256": source_digest,
        "source_bytes": total_source_bytes,
        "granules": granule_receipts,
        "aoi_grid_cells": max((item["total_grid_cells"] for item in daily_diagnostics), default=0),
        "spatial_coverage_floor": IMERG_SPATIAL_COVERAGE_FLOOR,
        "observations": windows,
    }
    # Persist local diagnostics before the study mutation. A failed write cannot
    # leave a partially published context; public publication still happens later.
    json_write(imerg_dir / "daily-diagnostics.json", daily_diagnostics)
    json_write(imerg_dir / "receipt.json", {
        "run_id": run_id,
        "product": IMERG_PRODUCT,
        "source_sha256": source_digest,
        "source_bytes": total_source_bytes,
        "granules": granule_receipts,
        "missing_dates": search_manifest["missing_dates"],
        "attached_at": datetime.now(timezone.utc).isoformat(),
    })
    study.setdefault("sources", [])
    if not any(isinstance(source, dict) and source.get("url") == "https://doi.org/10.5067/GPM/IMERGDF/DAY/07" for source in study["sources"]):
        study["sources"].append({
            "title": "NASA GPM IMERG Final daily precipitation V07",
            "url": "https://doi.org/10.5067/GPM/IMERGDF/DAY/07",
        })
    study["rainfall_context"] = context
    json_write(study_path, study)
    return context

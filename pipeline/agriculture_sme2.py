#!/usr/bin/env python3
"""Conservative NISAR L3 SME2 PROVISIONAL soil-moisture workflow.

This module is deliberately separate from the wetland/forest/volcano pipelines.
It never fabricates an Agriculture study: public assets are written only after
real Earthdata granules have been downloaded, screened, analyzed and checksummed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import sys
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import h5py
import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.transform import from_origin

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / "pipeline" / "output" / "agriculture"
PUBLIC_ROOT = ROOT / "public" / "agriculture"
COLLECTION = "NISAR_L3_SME2_PROVISIONAL_V1"
PRODUCT = "NISAR_L3_SME2_PROVISIONAL_V1"
MIN_RELEASE = 5023
COVERAGE_FLOOR = 0.20
MOISTURE_MIN = 0.02
MOISTURE_MAX = 0.60
RUN_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
DATE_RE = re.compile(r"(?<!\d)(20\d{6})T\d{6}(?!\d)")
RELEASE_RE = re.compile(r"(?<![A-Z0-9])(P\d{5})(?!\d)", re.I)
FLAG_NAMES = ("retrievalQualityFlag", "surfaceQualityFlag")
SOURCE_LIST = [
    {"title": "ASF NISAR SME2 guide", "url": "https://nisar-docs.asf.alaska.edu/sme2/"},
    {"title": "NISAR PROVISIONAL product known issues", "url": "https://nisar-docs.asf.alaska.edu/provisional-known-issues/"},
    {"title": "NISAR SME2 product specification", "url": "https://nisar.asf.earthdatacloud.nasa.gov/NISAR-SAMPLE-DATA/DOCS/NISAR_D-107677_RevC_NASA_SDS_Product_Specification_L3_SME2_Nov8_2024_w-sigs.pdf"},
    {"title": "earthaccess API documentation", "url": "https://earthaccess.readthedocs.io/en/latest/api/"},
}


class AgricultureError(RuntimeError):
    """A fail-closed workflow error suitable for CLI display."""


def safe_run_id(value: str) -> str:
    if not isinstance(value, str) or not RUN_RE.fullmatch(value):
        raise AgricultureError("Run ID must match ^[a-z0-9][a-z0-9-]{0,39}$")
    return value


def run_folder(run_id: str) -> Path:
    return OUTPUT_ROOT / safe_run_id(run_id)


def json_write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".partial")
    temp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temp, path)


def json_read(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AgricultureError(f"Could not read valid JSON at {path.name}: {exc}") from exc


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def parse_granule_date(title: str, metadata: dict[str, Any]) -> str:
    for key in ("time_start", "BeginningDateTime", "beginningDateTime"):
        value = metadata.get(key)
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
            except ValueError:
                pass
    match = DATE_RE.search(title)
    if not match:
        raise AgricultureError(f"Granule has no supported acquisition date: {title}")
    return datetime.strptime(match.group(1), "%Y%m%d").date().isoformat()


def _flatten_items(value: Any):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key, item
            yield from _flatten_items(item)
    elif isinstance(value, list):
        for item in value:
            yield from _flatten_items(item)


def _find_metadata_value(metadata: dict[str, Any], names: tuple[str, ...]) -> str | None:
    wanted = {name.lower().replace("_", "") for name in names}
    for key, value in _flatten_items(metadata):
        if key.lower().replace("_", "") in wanted and isinstance(value, (str, int, float)):
            text = str(value).strip()
            if text:
                return text
    return None


def _direction(value: str | None, title: str) -> str:
    candidate = (value or "").strip().lower()
    if candidate in {"a", "asc", "ascending", "ascending pass"} or "ascend" in candidate:
        return "A"
    if candidate in {"d", "desc", "descending", "descending pass"} or "descend" in candidate:
        return "D"
    upper = title.upper()
    if "ASCENDING" in upper or re.search(r"(?:^|_)(?:ASC|A)(?:_|$)", upper):
        return "A"
    if "DESCENDING" in upper or re.search(r"(?:^|_)(?:DESC|D)(?:_|$)", upper):
        return "D"
    raise AgricultureError(f"Could not establish orbit direction from CMR metadata/name: {title}")


def granule_signature(title: str, metadata: dict[str, Any]) -> dict[str, str]:
    release_match = RELEASE_RE.search(title.upper())
    if not release_match:
        raise AgricultureError(f"Granule filename does not contain a Pxxxxx release token: {title}")
    release_number = int(release_match.group(1)[1:])
    if release_number < MIN_RELEASE:
        raise AgricultureError(f"Granule release {release_match.group(1)} predates supported SME2 release P05023.")

    direction = _direction(_find_metadata_value(metadata, ("OrbitDirection", "PassDirection")), title)
    track = _find_metadata_value(metadata, ("TrackNumber", "Track", "PathNumber"))
    frame = _find_metadata_value(metadata, ("FrameNumber", "Frame"))
    bandwidth = _find_metadata_value(metadata, ("Bandwidth", "RangeBandwidth"))
    polarization = _find_metadata_value(metadata, ("Polarization", "Polarisation"))
    frequency = _find_metadata_value(metadata, ("Frequency", "RadarFrequency"))
    upper = title.upper()
    if track is None:
        m = re.search(r"(?:TRACK|TRK|T)(\d{1,4})", upper)
        track = m.group(1) if m else "UNSPECIFIED"
    if frame is None:
        m = re.search(r"(?:FRAME|FRM|F)(\d{1,5})", upper)
        frame = m.group(1) if m else "UNSPECIFIED"
    if bandwidth is None:
        m = re.search(r"(\d{1,3}\s*MHZ)", upper)
        bandwidth = m.group(1).replace(" ", "") if m else "UNSPECIFIED"
    if polarization is None:
        polarization = "HH+HV" if ("HH" in upper and "HV" in upper) else "UNSPECIFIED"
    if frequency is None:
        m = re.search(r"FREQUENCY([AB])", upper)
        frequency = m.group(1) if m else "UNSPECIFIED"
    return {
        "release": release_match.group(1).upper(),
        "track": str(track),
        "direction": direction,
        "frame": str(frame),
        "bandwidth": str(bandwidth),
        "polarization": str(polarization),
        "frequency": str(frequency).upper(),
    }


def _cmr_search(aoi: dict[str, float], start: str, end: str) -> list[dict[str, Any]]:
    temporal = f"{start}T00:00:00Z,{end}T23:59:59Z"
    params = urllib.parse.urlencode({
        "short_name": COLLECTION,
        "temporal": temporal,
        "bounding_box": ",".join(str(aoi[key]) for key in ("west", "south", "east", "north")),
        "page_size": "2000",
        "sort_key": "-start_date",
    })
    url = "https://cmr.earthdata.nasa.gov/search/granules.json?" + params
    request = urllib.request.Request(url, headers={"User-Agent": "Beyonders-Agriculture/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.load(response)
    except Exception as exc:
        raise AgricultureError(f"NASA CMR search failed: {exc}") from exc
    entries = payload.get("feed", {}).get("entry", [])
    result: list[dict[str, Any]] = []
    for entry in entries:
        title = str(entry.get("title") or "")
        concept_id = str(entry.get("id") or "")
        if not title or not concept_id:
            continue
        try:
            signature = granule_signature(title, entry)
            date = parse_granule_date(title, entry)
        except AgricultureError:
            continue
        result.append({
            "concept_id": concept_id,
            "title": title,
            "date": date,
            "signature": signature,
            "updated": entry.get("updated"),
            "links": [link.get("href") for link in entry.get("links", []) if link.get("href")],
        })
    return result


def search(run_id: str, aoi: dict[str, float], start: str, end: str) -> dict[str, Any]:
    safe_run_id(run_id)
    validate_aoi_dates(aoi, start, end)
    entries = _cmr_search(aoi, start, end)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in entries:
        key = json.dumps(item["signature"], sort_keys=True)
        grouped.setdefault(key, []).append(item)
    series = []
    for key, items in grouped.items():
        items.sort(key=lambda item: item["date"])
        unique: dict[str, dict[str, Any]] = {}
        for item in items:
            unique[item["date"]] = item
        if len(unique) < 4:
            continue
        signature = json.loads(key)
        series.append({
            "series_id": hashlib.sha256(key.encode()).hexdigest()[:12],
            "signature": signature,
            "granules": list(unique.values()),
            "observation_count": len(unique),
            "dates": sorted(unique),
        })
    series.sort(key=lambda item: (-item["observation_count"], item["series_id"]))
    if not series:
        raise AgricultureError("CMR returned no compatible series with at least four unique dates. This is not evidence of zero soil moisture or no change.")
    folder = run_folder(run_id)
    folder.mkdir(parents=True, exist_ok=True)
    result = {
        "schema_version": 1, "run_id": run_id, "collection": COLLECTION,
        "aoi": aoi, "date_range": {"start": start, "end": end},
        "catalogue_result_count": len(entries), "compatible_series": series,
        "selected_series_id": series[0]["series_id"] if len(series) == 1 else None,
        "search_completed_at": datetime.now(timezone.utc).isoformat(),
        "limitations": ["CMR discovery is not a soil-moisture result.", "SME2 PROVISIONAL data are exploratory and not fully calibrated."],
    }
    json_write(folder / "search.json", result)
    print(f"Found {len(entries)} granule(s) and {len(series)} compatible series.")
    for item in series:
        print(f"  {item['series_id']} · {item['observation_count']} dates · {item['signature']}")
    print(f"Search manifest: {folder / 'search.json'}")
    return result


def _select_series(search_manifest: dict[str, Any], series_id: str | None) -> dict[str, Any]:
    series = search_manifest.get("compatible_series")
    if not isinstance(series, list) or not series:
        raise AgricultureError("Search manifest contains no compatible series.")
    if series_id:
        selected = next((item for item in series if item.get("series_id") == series_id), None)
        if selected is None:
            raise AgricultureError(f"Series ID {series_id!r} is not in the saved CMR search manifest.")
        return selected
    if len(series) == 1:
        return series[0]
    best = max(int(item.get("observation_count", 0)) for item in series)
    candidates = [item for item in series if int(item.get("observation_count", 0)) == best]
    if len(candidates) != 1:
        raise AgricultureError("More than one compatible series is tied for the most dates. Re-run download with --series-id from search.json.")
    return candidates[0]


def download(run_id: str, series_id: str | None = None) -> list[Path]:
    folder = run_folder(run_id)
    manifest = json_read(folder / "search.json")
    if manifest.get("run_id") != run_id or manifest.get("collection") != COLLECTION:
        raise AgricultureError("Saved search manifest identity/collection mismatch.")
    series = _select_series(manifest, series_id)
    try:
        import earthaccess
        auth = earthaccess.login(strategy="interactive", persist=True)
        if not auth:
            raise AgricultureError("Earthdata Login was not established.")
        local = folder / "granules"
        local.mkdir(parents=True, exist_ok=True)
        accepted: list[Path] = []
        for item in series["granules"]:
            exact = earthaccess.search_data(concept_id=item["concept_id"])
            if not exact:
                raise AgricultureError(f"Could not re-resolve CMR concept ID {item['concept_id']}.")
            # Re-resolve the exact concept ID, then require an exact local granule filename after download.
            downloaded = earthaccess.download(exact, str(local))
            paths = [Path(value) for value in (downloaded or [])]
            found = [path for path in paths if path.is_file() and path.suffix.lower() in {".h5", ".hdf5"}]
            if not found:
                found = [path for path in local.rglob("*") if path.is_file() and path.suffix.lower() in {".h5", ".hdf5"}]
            expected_stem = Path(item["title"]).name
            matches = [path for path in found if path.name == expected_stem]
            if not matches:
                raise AgricultureError(f"Downloaded payload did not match the selected CMR granule {expected_stem}.")
            target = matches[0]
            if not _looks_like_sme2_hdf5(target):
                raise AgricultureError(f"Downloaded file is not a valid SME2 HDF5 payload: {target.name}")
            accepted.append(target)
        distinct = {path.resolve() for path in accepted}
        if len(distinct) != len(series["granules"]):
            raise AgricultureError("Not every selected granule resolved to one distinct local HDF5 file.")
        receipt = {
            "run_id": run_id, "series_id": series["series_id"],
            "files": [{"path": str(path.relative_to(folder)), "name": path.name, "bytes": path.stat().st_size, "sha256": sha256_file(path)} for path in sorted(distinct)],
            "downloaded_at": datetime.now(timezone.utc).isoformat(),
        }
        json_write(folder / "download.json", receipt)
        return sorted(distinct)
    except AgricultureError:
        raise
    except Exception as exc:
        raise AgricultureError(f"Earthdata download failed: {exc}") from exc


def _looks_like_sme2_hdf5(path: Path) -> bool:
    try:
        with h5py.File(path, "r") as handle:
            base = handle.get("/science/LSAR/SME2/grids")
            if base is None:
                return False
            found: set[str] = set()
            base.visititems(lambda name, obj: found.add(Path(name).name) if isinstance(obj, h5py.Dataset) else None)
            return {"soilMoisture", "soilMoistureUncertainty", *FLAG_NAMES}.issubset(found)
    except (OSError, ValueError):
        return False


def validate_aoi_dates(aoi: dict[str, float], start: str, end: str) -> None:
    keys = ("west", "south", "east", "north")
    if not isinstance(aoi, dict) or any(key not in aoi for key in keys):
        raise AgricultureError("AOI must contain west, south, east and north.")
    values = [float(aoi[key]) for key in keys]
    west, south, east, north = values
    if not all(math.isfinite(v) for v in values) or not (-180 <= west < east <= 180) or not (-90 <= south < north <= 90):
        raise AgricultureError("AOI must be a valid WGS84 bounding box.")
    try:
        start_date = datetime.strptime(start, "%Y-%m-%d").date()
        end_date = datetime.strptime(end, "%Y-%m-%d").date()
    except (TypeError, ValueError) as exc:
        raise AgricultureError("Date range must contain real YYYY-MM-DD dates.") from exc
    if start_date.isoformat() < "2026-06-17" or start_date > end_date or end_date > datetime.now(timezone.utc).date():
        raise AgricultureError("Date range is reversed, in the future, or starts before the SME2 workflow gate (2026-06-17).")


def _find_dataset(handle: h5py.File, name: str) -> h5py.Dataset:
    candidates: list[h5py.Dataset] = []
    root = handle.get("/science/LSAR/SME2/grids")
    if root is None:
        raise AgricultureError("HDF5 is missing /science/LSAR/SME2/grids.")
    def visit(path: str, obj: Any) -> None:
        if isinstance(obj, h5py.Dataset) and Path(path).name == name:
            candidates.append(obj)
    root.visititems(visit)
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        preferred = [item for item in candidates if "frequencyA" in item.name]
        if len(preferred) == 1:
            return preferred[0]
        raise AgricultureError(f"SME2 HDF5 contains ambiguous {name} datasets.")
    raise AgricultureError(f"SME2 HDF5 is missing required dataset {name}.")


def _text_value(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace").strip("\x00 ")
    if isinstance(value, np.ndarray) and value.size == 1:
        return _text_value(value.reshape(-1)[0])
    return str(value).strip()


def _epsg_from_handle(handle: h5py.File, x: np.ndarray, y: np.ndarray) -> int:
    values: list[Any] = []
    for obj in (handle, handle.get("/science/LSAR/SME2"), handle.get("/science/LSAR/SME2/grids")):
        if obj is not None:
            for key, value in obj.attrs.items():
                if key.lower() in {"epsg", "spatial_epsg", "srid", "projection", "crs"}:
                    values.append(value)
    handle.visititems(lambda name, obj: values.extend([obj[()]]) if isinstance(obj, h5py.Dataset) and Path(name).name.lower() in {"projection", "epsg"} and obj.size <= 8 else None)
    for value in values:
        text = _text_value(value)
        numbers = re.findall(r"\b(\d{4,6})\b", text)
        if numbers:
            code = int(numbers[0])
            if 1000 <= code <= 999999:
                return code
        try:
            code = int(float(text))
            if 1000 <= code <= 999999:
                return code
        except (TypeError, ValueError):
            pass
    if np.nanmin(x) >= -180 and np.nanmax(x) <= 180 and np.nanmin(y) >= -90 and np.nanmax(y) <= 90:
        return 4326
    raise AgricultureError("Could not establish the SME2 grid CRS from HDF5 projection metadata; refusing to guess.")


def _read_scene(path: Path, aoi: dict[str, float]) -> dict[str, Any]:
    if not _looks_like_sme2_hdf5(path):
        raise AgricultureError(f"Not a compatible SME2 HDF5 file: {path.name}")
    with h5py.File(path, "r") as handle:
        moisture_ds = _find_dataset(handle, "soilMoisture")
        uncertainty_ds = _find_dataset(handle, "soilMoistureUncertainty")
        retrieval_ds = _find_dataset(handle, "retrievalQualityFlag")
        surface_ds = _find_dataset(handle, "surfaceQualityFlag")
        moisture = np.asarray(moisture_ds[...], dtype="float64")
        uncertainty = np.asarray(uncertainty_ds[...], dtype="float64")
        retrieval = np.asarray(retrieval_ds[...])
        surface = np.asarray(surface_ds[...])
        if moisture.ndim != 2 or any(item.shape != moisture.shape for item in (uncertainty, retrieval, surface)):
            raise AgricultureError(f"Required SME2 layers have incompatible shapes in {path.name}.")
        grids = handle["/science/LSAR/SME2/grids"]
        x_ds = _find_dataset(handle, "xCoordinates")
        y_ds = _find_dataset(handle, "yCoordinates")
        x = np.asarray(x_ds[...], dtype="float64").reshape(-1)
        y = np.asarray(y_ds[...], dtype="float64").reshape(-1)
        if len(x) != moisture.shape[1] or len(y) != moisture.shape[0]:
            raise AgricultureError("SME2 x/y coordinate vectors do not match the raster dimensions.")
        epsg = _epsg_from_handle(handle, x, y)
        attrs = {}
        for obj in (handle, grids, moisture_ds.parent):
            for key, value in obj.attrs.items():
                attrs[str(key)] = _text_value(value)
        fill_values = []
        uncertainty_fill_values = []
        for key in ("_FillValue", "missing_value", "fillValue"):
            if key in moisture_ds.attrs:
                fill_values.append(float(np.asarray(moisture_ds.attrs[key]).reshape(-1)[0]))
            if key in uncertainty_ds.attrs:
                uncertainty_fill_values.append(float(np.asarray(uncertainty_ds.attrs[key]).reshape(-1)[0]))
        metadata = {
            "track": _find_metadata_value(attrs, ("track", "tracknumber", "pathnumber")) or "UNSPECIFIED",
            "direction": _direction(_find_metadata_value(attrs, ("orbitdirection", "passdirection")), path.name),
            "frame": _find_metadata_value(attrs, ("frame", "framenumber")) or "UNSPECIFIED",
            "bandwidth": _find_metadata_value(attrs, ("bandwidth", "rangebandwidth")) or "UNSPECIFIED",
            "polarization": _find_metadata_value(attrs, ("polarization", "polarisation")) or "HH+HV",
            "frequency": "A" if "frequencyA" in moisture_ds.name else "B" if "frequencyB" in moisture_ds.name else "UNSPECIFIED",
        }

    if not np.isfinite(x).all() or not np.isfinite(y).all() or len(x) < 2 or len(y) < 2:
        raise AgricultureError(f"Invalid SME2 coordinate vectors in {path.name}.")
    dx_values, dy_values = np.diff(x), np.diff(y)
    dx, dy = float(np.median(np.abs(dx_values))), float(np.median(np.abs(dy_values)))
    if dx <= 0 or dy <= 0 or np.max(np.abs(np.abs(dx_values) - dx)) > dx * 0.01 or np.max(np.abs(np.abs(dy_values) - dy)) > dy * 0.01:
        raise AgricultureError("SME2 grid is not regular within 1%; refusing to resample.")
    flip_x = x[0] > x[-1]
    flip_y = y[0] < y[-1]
    if flip_x:
        x = x[::-1]; moisture = moisture[:, ::-1]; uncertainty = uncertainty[:, ::-1]
        retrieval = retrieval[:, ::-1]; surface = surface[:, ::-1]
    if flip_y:
        y = y[::-1]; moisture = moisture[::-1, :]; uncertainty = uncertainty[::-1, :]
        retrieval = retrieval[::-1, :]; surface = surface[::-1, :]
    epsg = int(epsg)
    transformer = Transformer.from_crs(4326, epsg, always_xy=True)
    corners = [transformer.transform(aoi["west"], aoi["south"]), transformer.transform(aoi["west"], aoi["north"]),
               transformer.transform(aoi["east"], aoi["south"]), transformer.transform(aoi["east"], aoi["north"])]
    min_x = min(value[0] for value in corners); max_x = max(value[0] for value in corners)
    min_y = min(value[1] for value in corners); max_y = max(value[1] for value in corners)
    xx, yy = np.meshgrid(x, y)
    in_aoi = (xx >= min_x) & (xx <= max_x) & (yy >= min_y) & (yy <= max_y)
    fill_ok = np.ones(moisture.shape, dtype=bool)
    for fill in fill_values:
        fill_ok &= moisture != fill
    for fill in uncertainty_fill_values:
        fill_ok &= uncertainty != fill
    valid = quality_mask(moisture, uncertainty, retrieval, surface, fill_ok)
    valid &= in_aoi
    rows, cols = np.where(in_aoi)
    if rows.size == 0 or cols.size == 0:
        raise AgricultureError("The selected AOI does not intersect this SME2 native grid.")
    row0, row1 = int(rows.min()), int(rows.max()) + 1
    col0, col1 = int(cols.min()), int(cols.max()) + 1
    fill_excluded = int(np.sum(~fill_ok & in_aoi))
    retrieval_counts = {str(int(value)): int(np.sum(retrieval[in_aoi] == value)) for value in np.unique(retrieval[in_aoi]) if np.isfinite(value)}
    surface_counts = {str(int(value)): int(np.sum(surface[in_aoi] == value)) for value in np.unique(surface[in_aoi]) if np.isfinite(value)}
    moisture = moisture[row0:row1, col0:col1]
    uncertainty = uncertainty[row0:row1, col0:col1]
    retrieval = retrieval[row0:row1, col0:col1]
    surface = surface[row0:row1, col0:col1]
    valid = valid[row0:row1, col0:col1]
    in_aoi = in_aoi[row0:row1, col0:col1]
    x = x[col0:col1]
    y = y[row0:row1]
    transform = from_origin(float(x.min() - dx / 2), float(y.max() + dy / 2), dx, dy)
    to_wgs84 = Transformer.from_crs(epsg, 4326, always_xy=True)
    edge_x = [float(x.min() - dx / 2), float(x.max() + dx / 2)]
    edge_y = [float(y.min() - dy / 2), float(y.max() + dy / 2)]
    geographic = [to_wgs84.transform(px, py) for px in edge_x for py in edge_y]
    preview_bounds = {
        "west": min(point[0] for point in geographic), "south": min(point[1] for point in geographic),
        "east": max(point[0] for point in geographic), "north": max(point[1] for point in geographic),
    }
    signature = granule_signature(path.name, {"OrbitDirection": metadata["direction"], "TrackNumber": metadata["track"], "FrameNumber": metadata["frame"], "Bandwidth": metadata["bandwidth"], "Polarization": metadata["polarization"], "Frequency": metadata["frequency"]})
    for key in ("track", "frame", "bandwidth", "polarization", "frequency"):
        if signature[key] != "UNSPECIFIED" and metadata[key] != "UNSPECIFIED" and signature[key] != metadata[key]:
            raise AgricultureError(f"Granule filename/HDF5 {key} metadata disagree in {path.name}.")
    for key in ("track", "frame", "bandwidth", "polarization", "frequency"):
        if signature[key] == "UNSPECIFIED":
            signature[key] = metadata[key]
    signature["direction"] = metadata["direction"]
    return {
        "date": parse_granule_date(path.name, {}),
        "moisture": moisture, "uncertainty": uncertainty, "valid": valid,
        "aoi_mask": in_aoi, "epsg": epsg, "transform": transform, "preview_bounds": preview_bounds,
        "signature": signature, "file": path, "fill_excluded": fill_excluded,
        "retrieval_flag_counts": retrieval_counts, "surface_flag_counts": surface_counts,
    }


def quality_mask(moisture: np.ndarray, uncertainty: np.ndarray, retrieval_flag: np.ndarray,
                 surface_flag: np.ndarray, fill_ok: np.ndarray | None = None) -> np.ndarray:
    """Strict SME2 flag screen; cast uint8 to float64 before using -1 sentinel.

    retrievalQualityFlag is a bit field: bits 0-3 must all be set and bits 4-7
    must all be clear. surfaceQualityFlag must equal zero. Fractional flags,
    NoData, invalid uncertainty and moisture outside the conservative physical
    range are not assessed.
    """
    moisture = np.asarray(moisture, dtype="float64")
    uncertainty = np.asarray(uncertainty, dtype="float64")
    retrieval_values = np.asarray(retrieval_flag, dtype="float64")
    surface_values = np.asarray(surface_flag, dtype="float64")
    if not (moisture.shape == uncertainty.shape == retrieval_values.shape == surface_values.shape):
        raise AgricultureError("SME2 quality layers have incompatible dimensions.")
    valid = np.isfinite(moisture) & (moisture >= MOISTURE_MIN) & (moisture <= MOISTURE_MAX)
    valid &= np.isfinite(uncertainty) & (uncertainty >= 0)
    retrieval_integer = np.where(np.isfinite(retrieval_values), retrieval_values, -1).astype("int64")
    surface_integer = np.where(np.isfinite(surface_values), surface_values, -1).astype("int64")
    valid &= np.isfinite(retrieval_values) & (retrieval_values >= 0) & (retrieval_values <= 255) & np.isclose(retrieval_values, np.round(retrieval_values))
    valid &= (retrieval_integer & 0x0F) == 0x0F
    valid &= (retrieval_integer & 0xF0) == 0
    valid &= np.isfinite(surface_values) & np.isclose(surface_values, np.round(surface_values))
    valid &= surface_integer == 0
    if fill_ok is not None:
        valid &= np.asarray(fill_ok, dtype=bool)
    return valid


def _summary(values: np.ndarray, mask: np.ndarray, uncertainty: np.ndarray | None = None,
             denominator_mask: np.ndarray | None = None) -> dict[str, Any]:
    valid = np.asarray(mask, dtype=bool) & np.isfinite(values)
    denominator = np.asarray(denominator_mask if denominator_mask is not None else mask, dtype=bool)
    count = int(np.sum(valid))
    total = int(np.sum(denominator))
    if count == 0 or total == 0:
        raise AgricultureError("No valid pixels remain inside the AOI after the SME2 quality screen.")
    selected = np.asarray(values, dtype="float64")[valid]
    unc = np.asarray(uncertainty, dtype="float64")[valid] if uncertainty is not None else np.zeros(count)
    return {
        "valid_fraction": count / total, "valid_pixels": count, "total_pixels": total,
        "median": float(np.median(selected)), "p05": float(np.percentile(selected, 5)),
        "p95": float(np.percentile(selected, 95)), "uncertainty_median": float(np.median(unc)),
    }


def _preview(values: np.ndarray, valid: np.ndarray, path: Path, change: bool = False) -> None:
    data = np.asarray(values, dtype="float64")
    mask = np.asarray(valid, dtype=bool) & np.isfinite(data)
    if not np.any(mask):
        raise AgricultureError(f"Refusing to render an empty preview: {path.name}")
    rgb = np.zeros((*data.shape, 3), dtype=np.uint8)
    if change:
        scale = max(float(np.percentile(np.abs(data[mask]), 98)), 0.005)
        v = np.clip(data / scale, -1, 1)
        rgb[..., 0] = np.where(v > 0, 35 + 180 * v, 35).astype("uint8")
        rgb[..., 1] = np.where(v < 0, 70 + 90 * (1 + v), 190 - 100 * v).astype("uint8")
        rgb[..., 2] = np.where(v < 0, 170 + 70 * (-v), 210 - 140 * v).astype("uint8")
    else:
        v = np.clip((data - MOISTURE_MIN) / (MOISTURE_MAX - MOISTURE_MIN), 0, 1)
        rgb[..., 0] = (18 + 60 * v).astype("uint8")
        rgb[..., 1] = (55 + 150 * v).astype("uint8")
        rgb[..., 2] = (110 + 130 * (1 - v)).astype("uint8")
    rgba = np.dstack([rgb, np.where(mask, 235, 0).astype("uint8")])
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, mode="RGBA").save(path, format="PNG", optimize=True)


def _write_geotiff(path: Path, values: np.ndarray, valid: np.ndarray, epsg: int, transform: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    array = np.where(valid & np.isfinite(values), values, -9999).astype("float32")
    with rasterio.open(path, "w", driver="GTiff", height=array.shape[0], width=array.shape[1],
                       count=1, dtype="float32", crs=f"EPSG:{epsg}", transform=transform,
                       nodata=-9999, compress="deflate") as dataset:
        dataset.write(array, 1)
        dataset.write_mask((valid & np.isfinite(values)).astype("uint8") * 255)


def _validate_grid(first: dict[str, Any], other: dict[str, Any]) -> None:
    if other["moisture"].shape != first["moisture"].shape or other["epsg"] != first["epsg"]:
        raise AgricultureError("SME2 observations use different native grids/CRSs; no resampling is permitted.")
    if other["preview_bounds"] != first["preview_bounds"] or tuple(other["transform"]) != tuple(first["transform"]):
        raise AgricultureError("SME2 observations have different native grid transforms; no resampling is permitted.")
    if other["signature"] != first["signature"]:
        raise AgricultureError("SME2 observations have mixed track/direction/frame/bandwidth/polarization/frequency/release signatures.")


def analyze(run_id: str) -> dict[str, Any]:
    folder = run_folder(run_id)
    search_manifest = json_read(folder / "search.json")
    receipt = json_read(folder / "download.json")
    if search_manifest.get("run_id") != run_id or receipt.get("run_id") != run_id:
        raise AgricultureError("Run identity mismatch between CMR search and download receipt.")
    files = []
    for item in receipt.get("files", []):
        path = (folder / item["path"]).resolve()
        if folder.resolve() not in path.parents or not path.is_file():
            raise AgricultureError("Download receipt contains an unsafe or missing local path.")
        if path.stat().st_size != item["bytes"] or sha256_file(path) != item["sha256"]:
            raise AgricultureError(f"Downloaded source changed after verification: {path.name}")
        files.append(path)
    if len(files) < 4:
        raise AgricultureError("At least four real SME2 granules are required (three baseline dates plus one target).")
    scenes = [_read_scene(path, search_manifest["aoi"]) for path in files]
    scenes.sort(key=lambda item: item["date"])
    if len({scene["date"] for scene in scenes}) != len(scenes):
        raise AgricultureError("Multiple selected granules resolve to the same acquisition date.")
    for scene in scenes[1:]:
        _validate_grid(scenes[0], scene)
    first = scenes[0]
    for scene in scenes:
        scene["date"]
    baseline = scenes[:3]
    target = scenes[-1]
    selected_series = next((item for item in search_manifest["compatible_series"] if item.get("series_id") == receipt.get("series_id")), None)
    if selected_series is None:
        raise AgricultureError("Download receipt series does not match the saved search manifest.")
    base_stack = np.stack([np.where(scene["valid"], scene["moisture"], np.nan) for scene in baseline])
    with np.errstate(all="ignore"):
        baseline_median = np.nanmedian(base_stack, axis=0)
    baseline_valid = np.all(np.stack([scene["valid"] for scene in baseline]), axis=0)
    change_valid = baseline_valid & target["valid"] & np.isfinite(baseline_median)
    change = target["moisture"] - baseline_median
    output = folder / "result"
    (output / "previews").mkdir(parents=True, exist_ok=True)
    (output / "native").mkdir(parents=True, exist_ok=True)
    observations = []
    for index, scene in enumerate(scenes):
        name = f"moisture-{scene['date']}.png"
        preview = output / "previews" / name
        native = output / "native" / f"moisture-{scene['date']}.tif"
        summary = _summary(scene["moisture"], scene["valid"], scene["uncertainty"], scene["aoi_mask"])
        _preview(scene["moisture"], scene["valid"], preview)
        _write_geotiff(native, scene["moisture"], scene["valid"], scene["epsg"], scene["transform"])
        observations.append({
            "date": scene["date"], "preview": f"previews/{name}", "native_layer": f"native/{native.name}",
            **summary, **scene["signature"],
            "source_sha256": sha256_file(scene["file"]), "source_bytes": scene["file"].stat().st_size,
            "granule_name": scene["file"].name,
            "fill_excluded_pixels": scene["fill_excluded"],
            "retrieval_flag_counts": scene["retrieval_flag_counts"],
            "surface_flag_counts": scene["surface_flag_counts"],
        })
    target_summary = _summary(target["moisture"], target["valid"], target["uncertainty"], target["aoi_mask"])
    change_summary = _summary(change, change_valid, target["uncertainty"], target["aoi_mask"])
    change_name = "change-latest-minus-baseline.png"
    _preview(change, change_valid, output / "previews" / change_name, change=True)
    change_native = output / "native" / "change-latest-minus-baseline.tif"
    _write_geotiff(change_native, change, change_valid, target["epsg"], target["transform"])
    evidence_status = "INCONCLUSIVE_COVERAGE" if min(target_summary["valid_fraction"], change_summary["valid_fraction"]) < COVERAGE_FLOOR else "EXPLORATORY"
    signature = first["signature"]
    study = {
        "schema_version": 1, "study_id": run_id, "run_id": run_id,
        "product": PRODUCT, "product_maturity": "PROVISIONAL",
        **signature,
        "aoi": search_manifest["aoi"], "preview_bounds": target["preview_bounds"], "date_range": search_manifest["date_range"],
        "coverage_floor": COVERAGE_FLOOR, "baseline_count": 3,
        "baseline_dates": [item["date"] for item in baseline],
        "target_date": target["date"], "observations": observations,
        "change_preview": f"previews/{change_name}", "change_native_layer": f"native/{change_native.name}",
        "change_summary": change_summary, "target_summary": target_summary,
        "evidence_status": evidence_status, "sources": SOURCE_LIST,
        "provenance": {
            "collection": COLLECTION, "cmr_concept_ids": [item["concept_id"] for item in selected_series["granules"]],
            "source_files": [{"name": path.name, "bytes": path.stat().st_size, "sha256": sha256_file(path)} for path in files],
            "crs": f"EPSG:{target['epsg']}", "native_grid_shape": list(target["moisture"].shape),
            "pixel_spacing": [abs(float(target["transform"].a)), abs(float(target["transform"].e))],
            "quality_protocol": "soilMoisture in [0.02,0.60] m3/m3; finite non-negative uncertainty; retrievalQualityFlag bits 0-3 set and 4-7 clear; surfaceQualityFlag zero; NoData/fractional flags excluded",
        },
        "limitations": [
            "SME2 PROVISIONAL soil-moisture estimates are not fully calibrated; this is exploratory evidence.",
            "A soil-moisture difference is not a crop-stress, drought, irrigation, yield, crop-type, or field-boundary assessment.",
            "The 20% coverage floor is fixed. Below-floor target or change coverage is inconclusive.",
            "No independent field validation or accuracy estimate is included.",
            "The source SHA-256 values identify the locally downloaded bytes; they are not NASA digital signatures.",
            "Native rasters are local operator artifacts and are not included in the public preview package.",
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    json_write(output / "study.json", study)
    # Record a concise operator report separately from the public study.
    json_write(output / "analysis-report.json", {
        "run_id": run_id, "evidence_status": evidence_status,
        "target_coverage": target_summary["valid_fraction"], "change_coverage": change_summary["valid_fraction"],
        "valid_pixels": change_summary["valid_pixels"], "total_pixels": change_summary["total_pixels"],
        "native_layers": [str((output / item["native_layer"]).relative_to(folder)) for item in observations] + [str(change_native.relative_to(folder))],
    })
    return study


def publish(run_id: str, public_root: Path | None = None) -> Path:
    folder = run_folder(run_id)
    output = folder / "result"
    study_path = output / "study.json"
    study = json_read(study_path)
    if study.get("run_id") != run_id or study.get("product") != PRODUCT or study.get("product_maturity") != "PROVISIONAL":
        raise AgricultureError("Study identity/product maturity validation failed.")
    if study.get("evidence_status") not in {"EXPLORATORY", "INCONCLUSIVE_COVERAGE"}:
        raise AgricultureError("Unsupported evidence status.")
    assets = [study_path, *(output / item["preview"] for item in study["observations"]), output / study["change_preview"]]
    checksums = {"schema_version": 1, "files": {}}
    for path in assets:
        if not path.is_file() or path.stat().st_size <= 0:
            raise AgricultureError(f"Required publication asset is missing/empty: {path.name}")
        rel = str(path.relative_to(output)).replace("\\", "/")
        checksums["files"][rel] = {"bytes": path.stat().st_size, "sha256": sha256_file(path)}
    json_write(output / "web-checksums.json", checksums)
    target = (public_root or PUBLIC_ROOT) / "current"
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = target.with_name("current.staging")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    shutil.copy2(study_path, staging / "study.json")
    shutil.copy2(output / "web-checksums.json", staging / "web-checksums.json")
    if (output / "previews").exists():
        shutil.copytree(output / "previews", staging / "previews")
    json_write(staging / "index.json", {
        "schema_version": 1, "study_url": "current/study.json",
        "checksums_url": "current/web-checksums.json",
        "published_at": datetime.now(timezone.utc).isoformat(),
    })
    # The directory swap is local and atomic on the same filesystem. Preserve the
    # previous publication until the staging directory is complete.
    previous = target.with_name("current.previous")
    if previous.exists():
        shutil.rmtree(previous)
    if target.exists():
        os.replace(target, previous)
    try:
        os.replace(staging, target)
    except Exception:
        if previous.exists() and not target.exists():
            os.replace(previous, target)
        raise
    if previous.exists():
        shutil.rmtree(previous)
    return target


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="NISAR SME2 PROVISIONAL soil-moisture feasibility workflow")
    sub = parser.add_subparsers(dest="command", required=True)
    discover = sub.add_parser("search", help="Search NASA CMR for compatible SME2 granules")
    discover.add_argument("--run-id", required=True)
    for key, default in (("west", None), ("south", None), ("east", None), ("north", None)):
        discover.add_argument(f"--{key}", required=True, type=float)
    discover.add_argument("--start", required=True)
    discover.add_argument("--end", required=True)
    get = sub.add_parser("download", help="Download exact selected CMR granules via Earthdata")
    get.add_argument("--run-id", required=True)
    get.add_argument("--series-id")
    process = sub.add_parser("analyze", help="Analyze genuine compatible SME2 HDF5 granules")
    process.add_argument("--run-id", required=True)
    release = sub.add_parser("publish", help="Publish checksum-verified display previews only")
    release.add_argument("--run-id", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "search":
            aoi = {key: getattr(args, key) for key in ("west", "south", "east", "north")}
            search(args.run_id, aoi, args.start, args.end)
        elif args.command == "download":
            downloaded = download(args.run_id, args.series_id)
            print(f"Downloaded and verified {len(downloaded)} granule(s).")
        elif args.command == "analyze":
            study = analyze(args.run_id)
            print(f"{study['evidence_status']}: {study['target_summary']['valid_fraction']:.1%} target coverage; {study['change_summary']['valid_fraction']:.1%} change coverage.")
        elif args.command == "publish":
            target = publish(args.run_id)
            print(f"Published display-only SME2 previews to {target}.")
        return 0
    except AgricultureError as exc:
        print(f"AGRICULTURE ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

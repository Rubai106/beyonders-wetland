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
CMR_PAGE_SIZE = 2000
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
]


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
    """Read the fixed SME2 granule-name fields and cross-check catalog metadata.

    Current SME2 names place track, direction, frame, mode, polarization and
    frequency in fixed tokens. Never group granules with UNSPECIFIED identity:
    that can silently mix adjacent tracks or frames into one time series.
    """
    filename = Path(title).name
    stem = filename[:-4] if filename.lower().endswith(".h5") else filename
    tokens = stem.split("_")
    if len(tokens) < 18 or tokens[:4] != ["NISAR", "L3", "PR", "SME2"]:
        raise AgricultureError(f"Granule does not match the supported NISAR L3 SME2 naming convention: {title}")

    track, direction, frame, bandwidth, polarization, frequency = tokens[5:11]
    release = tokens[13].upper()
    if not re.fullmatch(r"\d{3}", track) or direction not in {"A", "D"}:
        raise AgricultureError(f"Granule has invalid track/direction filename fields: {title}")
    if not re.fullmatch(r"\d{3}", frame) or not re.fullmatch(r"\d{4}", bandwidth):
        raise AgricultureError(f"Granule has invalid frame/bandwidth filename fields: {title}")
    if not re.fullmatch(r"[A-Z0-9]{2,8}", polarization) or frequency not in {"A", "B"}:
        raise AgricultureError(f"Granule has invalid polarization/frequency filename fields: {title}")

    release_match = RELEASE_RE.fullmatch(release)
    if not release_match:
        raise AgricultureError(f"Granule filename does not contain a supported release token: {title}")
    release_number = int(release_match.group(1)[1:])
    if release_number < MIN_RELEASE:
        raise AgricultureError(f"Granule release {release_match.group(1)} predates supported SME2 release P05023.")

    # CMR/HDF5 metadata is useful as a cross-check for orbit identity. Other
    # mode/polarization tokens are taken from the product name because metadata
    # services do not consistently expose the same encoding.
    metadata_track = _find_metadata_value(metadata, ("TrackNumber", "Track", "PathNumber"))
    metadata_frame = _find_metadata_value(metadata, ("FrameNumber", "Frame"))
    metadata_direction = _find_metadata_value(metadata, ("OrbitDirection", "PassDirection"))

    def numeric_identity(value: str | None) -> int | None:
        if value is None:
            return None
        match = re.search(r"\d+", str(value))
        return int(match.group(0)) if match else None

    if metadata_track is not None and numeric_identity(metadata_track) != int(track):
        raise AgricultureError(f"CMR/HDF5 track metadata conflicts with the granule name: {title}")
    if metadata_frame is not None and numeric_identity(metadata_frame) != int(frame):
        raise AgricultureError(f"CMR/HDF5 frame metadata conflicts with the granule name: {title}")
    if metadata_direction is not None and _direction(metadata_direction, title) != direction:
        raise AgricultureError(f"CMR/HDF5 orbit direction conflicts with the granule name: {title}")

    return {
        "release": release_match.group(1),
        "track": track,
        "direction": direction,
        "frame": frame,
        "bandwidth": bandwidth,
        "polarization": polarization,
        "frequency": frequency,
    }


def _cmr_search(aoi: dict[str, float], start: str, end: str) -> list[dict[str, Any]]:
    temporal = f"{start}T00:00:00Z,{end}T23:59:59Z"
    params = urllib.parse.urlencode({
        "short_name": COLLECTION,
        "temporal": temporal,
        "bounding_box": ",".join(str(aoi[key]) for key in ("west", "south", "east", "north")),
        "page_size": str(CMR_PAGE_SIZE),
        "sort_key": "-start_date",
    })
    url = "https://cmr.earthdata.nasa.gov/search/granules.json?" + params
    request = urllib.request.Request(url, headers={"User-Agent": "Beyonders-Agriculture/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            hit_header = getattr(response, "headers", {}).get("CMR-Hits")
            payload = json.load(response)
    except Exception as exc:
        raise AgricultureError(f"NASA CMR search failed: {exc}") from exc
    entries = payload.get("feed", {}).get("entry", [])
    try:
        catalog_hits = int(hit_header) if hit_header is not None else None
    except (TypeError, ValueError):
        catalog_hits = None
    if catalog_hits is not None and catalog_hits > len(entries):
        raise AgricultureError(
            f"NASA CMR matched {catalog_hits} granules but only {len(entries)} were retrieved "
            f"(single-page limit {CMR_PAGE_SIZE}). Narrow the AOI or date range; no truncated series will be analyzed."
        )
    if catalog_hits is None and len(entries) >= CMR_PAGE_SIZE:
        raise AgricultureError(
            f"NASA CMR returned a full {CMR_PAGE_SIZE}-granule page without a usable hit count. "
            "Narrow the AOI or date range so the result cannot be silently truncated."
        )
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
            previous = unique.get(item["date"])
            # Duplicate same-day versions can appear in CMR. Keep the most
            # recently updated record; break ties deterministically by concept ID.
            rank = (str(item.get("updated") or ""), str(item.get("concept_id") or ""))
            previous_rank = (str(previous.get("updated") or ""), str(previous.get("concept_id") or "")) if previous else None
            if previous is None or rank > previous_rank:
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
    """Check for the baseline SME2 layer set, not similarly named algorithm layers."""
    try:
        with h5py.File(path, "r") as handle:
            _baseline_layers(handle)
            return True
    except (OSError, ValueError, AgricultureError):
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


def _baseline_layers(handle: h5py.File) -> dict[str, h5py.Dataset]:
    """Resolve the baseline layers from SME2's root grid group.

    Algorithm-candidate datasets reuse the same basenames. They are deliberately
    excluded. surfaceQualityFlag is the known exception: it may be in the root
    grid group or in ancillaryData, depending on the product release.
    """
    grids = handle.get("/science/LSAR/SME2/grids")
    if not isinstance(grids, h5py.Group):
        raise AgricultureError("HDF5 is missing /science/LSAR/SME2/grids.")

    layers: dict[str, h5py.Dataset] = {}
    for name in ("soilMoisture", "soilMoistureUncertainty", "retrievalQualityFlag"):
        item = grids.get(name)
        if not isinstance(item, h5py.Dataset):
            raise AgricultureError(f"Baseline SME2 layer is missing at /science/LSAR/SME2/grids/{name}.")
        layers[name] = item

    surface = grids.get("surfaceQualityFlag")
    if not isinstance(surface, h5py.Dataset):
        ancillary = grids.get("ancillaryData")
        surface = ancillary.get("surfaceQualityFlag") if isinstance(ancillary, h5py.Group) else None
    if not isinstance(surface, h5py.Dataset):
        raise AgricultureError("Baseline surfaceQualityFlag is missing from the root grid and ancillaryData groups.")
    layers["surfaceQualityFlag"] = surface

    shape = layers["soilMoisture"].shape
    if len(shape) != 2 or any(item.shape != shape for item in layers.values()):
        raise AgricultureError("Baseline SME2 measurement and quality layers do not share one 2-D grid.")
    return layers


def _text_value(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace").strip("\x00 ")
    if isinstance(value, np.ndarray) and value.size == 1:
        return _text_value(value.reshape(-1)[0])
    return str(value).strip()


def _epsg_from_handle(handle: h5py.File, x: np.ndarray, y: np.ndarray) -> int:
    """Read the shared SME2 root-grid projection; do not guess from coordinate ranges."""
    grids = handle.get("/science/LSAR/SME2/grids")
    projection = grids.get("projection") if isinstance(grids, h5py.Group) else None
    if not isinstance(projection, h5py.Dataset) or projection.size != 1:
        raise AgricultureError("SME2 root grid has no scalar projection dataset.")
    raw = projection[()]
    try:
        scalar = np.asarray(raw).reshape(-1)[0].item()
        if isinstance(scalar, (int, np.integer, float, np.floating)) and np.isfinite(scalar):
            code = int(scalar)
        else:
            text = _text_value(scalar)
            crs = rasterio.crs.CRS.from_user_input(text)
            code = crs.to_epsg()
    except Exception as exc:
        raise AgricultureError(f"Could not parse the SME2 root-grid projection: {exc}") from exc
    if code != 6933:
        raise AgricultureError(f"Expected the SME2 EASE-Grid 2.0 projection EPSG:6933, found EPSG:{code}.")
    return code


def _validate_moisture_units(dataset: h5py.Dataset, label: str) -> None:
    raw = dataset.attrs.get("units")
    if raw is None:
        raise AgricultureError(f"{label} has no units attribute; refusing to assume m³/m³.")
    units = _text_value(raw).lower().replace("³", "3").replace("^", "")
    units = re.sub(r"\s+", "", units)
    units = units.replace("meters", "m").replace("meter", "m")
    if units not in {"m3/m3", "m3m-3"}:
        raise AgricultureError(f"{label} units are not recognized as volumetric soil moisture: {_text_value(raw)!r}.")


def _read_scene(path: Path, aoi: dict[str, float], expected_signature: dict[str, str]) -> dict[str, Any]:
    if not _looks_like_sme2_hdf5(path):
        raise AgricultureError(f"Not a compatible SME2 HDF5 file: {path.name}")
    with h5py.File(path, "r") as handle:
        grids = handle["/science/LSAR/SME2/grids"]
        layers = _baseline_layers(handle)
        moisture_ds = layers["soilMoisture"]
        uncertainty_ds = layers["soilMoistureUncertainty"]
        retrieval_ds = layers["retrievalQualityFlag"]
        surface_ds = layers["surfaceQualityFlag"]
        _validate_moisture_units(moisture_ds, "soilMoisture")
        _validate_moisture_units(uncertainty_ds, "soilMoistureUncertainty")
        moisture = np.asarray(moisture_ds[...], dtype="float64")
        uncertainty = np.asarray(uncertainty_ds[...], dtype="float64")
        retrieval = np.asarray(retrieval_ds[...])
        surface = np.asarray(surface_ds[...])
        if moisture.ndim != 2 or any(item.shape != moisture.shape for item in (uncertainty, retrieval, surface)):
            raise AgricultureError(f"Required SME2 baseline layers have incompatible shapes in {path.name}.")

        x_ds, y_ds = grids.get("xCoordinates"), grids.get("yCoordinates")
        if not isinstance(x_ds, h5py.Dataset) or not isinstance(y_ds, h5py.Dataset):
            raise AgricultureError("SME2 root grid is missing xCoordinates or yCoordinates.")
        x = np.asarray(x_ds[...], dtype="float64").reshape(-1)
        y = np.asarray(y_ds[...], dtype="float64").reshape(-1)
        if len(x) != moisture.shape[1] or len(y) != moisture.shape[0]:
            raise AgricultureError("SME2 root x/y coordinate vectors do not match the baseline raster dimensions.")
        epsg = _epsg_from_handle(handle, x, y)

        # Acquisition identity lives under identification; do not inspect
        # algorithmCandidates or unrelated grids for metadata with matching names.
        identity = handle.get("/science/LSAR/identification")
        identity_attrs: dict[str, Any] = {}
        if identity is not None:
            for key, value in identity.attrs.items():
                identity_attrs[str(key)] = _text_value(value)
            def collect_identity_metadata(name: str, obj: Any) -> None:
                if isinstance(obj, h5py.Dataset) and obj.size <= 8:
                    identity_attrs[Path(name).name] = _text_value(obj[()])
            identity.visititems(collect_identity_metadata)

        metadata = {
            "track": _find_metadata_value(identity_attrs, ("trackNumber", "track", "pathNumber")),
            "frame": _find_metadata_value(identity_attrs, ("frameNumber", "frame")),
            "direction": _find_metadata_value(identity_attrs, ("orbitDirection", "passDirection")),
        }
        signature = granule_signature(path.name, {
            "TrackNumber": metadata["track"] or "",
            "FrameNumber": metadata["frame"] or "",
            "OrbitDirection": metadata["direction"] or "",
        })
        for key, expected in expected_signature.items():
            if signature.get(key) != expected:
                raise AgricultureError(f"CMR and local SME2 {key} filename metadata disagree in {path.name}.")

        fill_values = []
        uncertainty_fill_values = []
        for key in ("_FillValue", "missing_value", "fillValue"):
            if key in moisture_ds.attrs:
                fill_values.append(float(np.asarray(moisture_ds.attrs[key]).reshape(-1)[0]))
            if key in uncertainty_ds.attrs:
                uncertainty_fill_values.append(float(np.asarray(uncertainty_ds.attrs[key]).reshape(-1)[0]))


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
    inverse = Transformer.from_crs(epsg, 4326, always_xy=True)
    longitude, latitude = inverse.transform(xx, yy)
    in_aoi = (longitude >= aoi["west"]) & (longitude <= aoi["east"]) & (latitude >= aoi["south"]) & (latitude <= aoi["north"])
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
    selected_series = next((item for item in search_manifest["compatible_series"] if item.get("series_id") == receipt.get("series_id")), None)
    if selected_series is None:
        raise AgricultureError("Download receipt series does not match the saved search manifest.")
    expected_signature = selected_series["signature"]
    scenes = [_read_scene(path, search_manifest["aoi"], expected_signature) for path in files]
    scenes.sort(key=lambda item: item["date"])
    if len({scene["date"] for scene in scenes}) != len(scenes):
        raise AgricultureError("Multiple selected granules resolve to the same acquisition date.")
    for scene in scenes[1:]:
        _validate_grid(scenes[0], scene)
    first = scenes[0]
    baseline = scenes[:3]
    target = scenes[-1]
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

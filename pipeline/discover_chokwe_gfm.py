"""Read-only STAC discovery for an independent Chókwè flood-reference lead.

This preflight returns catalogue metadata only. It does not download raster
pixels, infer flood extent, or calculate validation scores.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


API_ROOT = "https://stac.eodc.eu/api/v1"
SEARCH_URL = API_ROOT + "/search"
COLLECTION = "GFM"
RUN_ID = "ec8fa5ee15ae41d1aa89f930f2b47e36"
STUDY_BOUNDS = (32.93, -24.58, 33.03, -24.48)
DEFAULT_START = "2026-01-07"
DEFAULT_END = "2026-01-28"
DEFAULT_OUTPUT = (
    Path(__file__).resolve().parent
    / "output"
    / "reference-cache"
    / "chokwe_gfm_stac_preflight.json"
)
MAX_PAGES = 100


def validate_date_range(start_date: str, end_date: str) -> tuple[date, date]:
    """Validate ISO calendar dates and return an inclusive range."""
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except (TypeError, ValueError) as error:
        raise ValueError("Dates must use YYYY-MM-DD format.") from error
    if start.isoformat() != start_date or end.isoformat() != end_date:
        raise ValueError("Dates must use YYYY-MM-DD format.")
    if start > end:
        raise ValueError("Start date must be on or before end date.")
    return start, end


def build_search_payload(
    start_date: str = DEFAULT_START,
    end_date: str = DEFAULT_END,
    limit: int = 100,
) -> dict:
    """Build the exact-AOI STAC query, with inclusive UTC calendar dates."""
    start, end = validate_date_range(start_date, end_date)
    if not isinstance(limit, int) or not 1 <= limit <= 1000:
        raise ValueError("Page limit must be an integer between 1 and 1000.")
    return {
        "collections": [COLLECTION],
        "bbox": list(STUDY_BOUNDS),
        "datetime": (
            start.isoformat() + "T00:00:00Z/"
            + end.isoformat() + "T23:59:59Z"
        ),
        "limit": limit,
    }


def _safe_next_url(href: str) -> str:
    """Accept only HTTPS pagination links from the configured STAC host."""
    absolute = urljoin(API_ROOT + "/", href)
    parsed = urlparse(absolute)
    if parsed.scheme != "https" or parsed.hostname != "stac.eodc.eu":
        raise ValueError("STAC pagination returned a link outside stac.eodc.eu.")
    return absolute


def _read_page(url: str, method: str, body: dict | None, opener) -> dict:
    if method not in ("GET", "POST"):
        raise ValueError("Unsupported STAC pagination method.")
    payload = json.dumps(body).encode("utf-8") if method == "POST" and body is not None else None
    headers = {"Accept": "application/geo+json, application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    request = Request(url, data=payload, headers=headers, method=method)
    with opener(request, timeout=60) as response:
        raw = response.read()
    try:
        result = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("The GFM STAC API returned invalid JSON.") from error
    if not isinstance(result, dict) or not isinstance(result.get("features"), list):
        raise ValueError("The GFM STAC response is missing its features array.")
    return result


def fetch_stac_items(payload: dict, opener=None, max_pages: int = MAX_PAGES) -> list[dict]:
    """Fetch STAC search pages, validating all server-provided next links."""
    request_opener = opener or urlopen
    if not isinstance(max_pages, int) or not 1 <= max_pages <= MAX_PAGES:
        raise ValueError(f"max_pages must be between 1 and {MAX_PAGES}.")

    url = SEARCH_URL
    method = "POST"
    body = payload
    seen_pages: set[tuple[str, str]] = set()
    items_by_id: dict[str, dict] = {}

    for _ in range(max_pages):
        signature = (url, json.dumps(body, sort_keys=True) if body is not None else "")
        if signature in seen_pages:
            raise ValueError("The GFM STAC API repeated a pagination link.")
        seen_pages.add(signature)

        page = _read_page(url, method, body, request_opener)
        for item in page["features"]:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
                raise ValueError("A GFM STAC feature is missing its item ID.")
            items_by_id.setdefault(item["id"], item)

        next_links = [
            link for link in page.get("links", [])
            if isinstance(link, dict) and link.get("rel") == "next"
        ]
        if not next_links:
            return list(items_by_id.values())
        if len(next_links) != 1:
            raise ValueError("The GFM STAC page returned an ambiguous next link.")

        link = next_links[0]
        if not isinstance(link.get("href"), str) or not link["href"]:
            raise ValueError("The GFM STAC next link has no URL.")
        url = _safe_next_url(link["href"])
        method = str(link.get("method", "GET")).upper()
        body = link.get("body") if method == "POST" else None
        if method == "POST" and not isinstance(body, dict):
            raise ValueError("The GFM STAC POST next link is missing its body.")

    raise ValueError(f"The GFM STAC query exceeded the {max_pages}-page safety limit.")


def _acquisition_date(properties: dict) -> str | None:
    raw = properties.get("datetime") or properties.get("start_datetime")
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValueError("A GFM STAC datetime property is not a string.")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"Invalid GFM STAC datetime: {raw}") from error
    return parsed.date().isoformat()


def _item_record(item: dict) -> dict:
    properties = item.get("properties")
    if not isinstance(properties, dict):
        raise ValueError(f"GFM STAC item {item['id']} has no properties object.")

    assets = item.get("assets") or {}
    if not isinstance(assets, dict):
        raise ValueError(f"GFM STAC item {item['id']} has invalid assets metadata.")

    asset_records = {}
    for name, asset in sorted(assets.items()):
        if not isinstance(asset, dict):
            continue
        asset_records[name] = {
            key: asset[key]
            for key in ("href", "type", "title", "roles")
            if key in asset
        }

    return {
        "id": item["id"],
        "datetime": properties.get("datetime"),
        "start_datetime": properties.get("start_datetime"),
        "acquisition_date": _acquisition_date(properties),
        "platform": properties.get("platform"),
        "constellation": properties.get("constellation"),
        "instruments": properties.get("instruments"),
        "gsd": properties.get("gsd"),
        "proj:epsg": properties.get("proj:epsg"),
        "proj:shape": properties.get("proj:shape"),
        "proj:transform": properties.get("proj:transform"),
        "bbox": item.get("bbox"),
        "assets": asset_records,
    }


def build_report(items: list[dict], start_date: str, end_date: str) -> dict:
    """Create an auditable discovery summary; deliberately no pixel metrics."""
    start, end = validate_date_range(start_date, end_date)
    records = [_item_record(item) for item in items]
    records.sort(key=lambda item: (item["acquisition_date"] or "9999-99-99", item["id"]))
    date_counts = Counter(
        item["acquisition_date"] for item in records if item["acquisition_date"]
    )
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "CATALOGUE_ITEMS_FOUND" if records else "NO_CATALOGUE_ITEMS",
        "study": {
            "name": "Chokwe event study box",
            "run_id": RUN_ID,
            "bounds_wgs84": list(STUDY_BOUNDS),
            "boundary_type": "operator-selected rectangular analysis box",
            "boundary_is_authoritative": False,
            "nisar_event_date": "2026-01-17",
            "nisar_baseline_date": "2026-01-05",
        },
        "source": {
            "name": "Copernicus Global Flood Monitoring (GFM)",
            "provider": "Copernicus Emergency Management Service",
            "sensor": "Sentinel-1 C-band SAR",
            "collection": COLLECTION,
            "stac_api": API_ROOT,
            "candidate_assets": [
                "ensemble_flood_extent",
                "reference_water_mask",
                "exclusion_mask",
            ],
            "method_note": (
                "The ensemble flood layer is an algorithmic satellite product, "
                "not field truth. Reference-water and exclusion masks must be "
                "inspected before any spatial comparison."
            ),
        },
        "query": {
            "collections": [COLLECTION],
            "bbox_wgs84": list(STUDY_BOUNDS),
            "start_date_utc": start.isoformat(),
            "end_date_utc": end.isoformat(),
            "datetime": (
                start.isoformat() + "T00:00:00Z/"
                + end.isoformat() + "T23:59:59Z"
            ),
        },
        "summary": {
            "item_count": len(records),
            "dated_item_count": sum(date_counts.values()),
            "unique_acquisition_dates": sorted(date_counts),
            "items_per_date": dict(sorted(date_counts.items())),
            "asset_names": sorted({
                name for item in records for name in item["assets"]
            }),
            "pixel_coverage_checked": False,
            "flood_extent_calculated": False,
            "accuracy_metrics_calculated": False,
        },
        "items": records,
        "interpretation_limits": [
            "A STAC item match is catalogue metadata, not proof that valid pixels cover the full Chokwe box.",
            "The EODC southern Mozambique example uses a broader region and the 7–28 January 2026 window; it is a search precedent, not proof of local coverage.",
            "The exact AOI must be checked against raster NoData, reference-water and exclusion masks after assets are read.",
            "Any candidate overlap with GFM is cross-sensor algorithmic support only, not field validation or a precision, recall, F1 or accuracy score.",
            "Unobserved, excluded and permanent-water pixels must not be treated as reference negatives.",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-date", default=DEFAULT_START, help="Inclusive UTC start date (YYYY-MM-DD).")
    parser.add_argument("--end-date", default=DEFAULT_END, help="Inclusive UTC end date (YYYY-MM-DD).")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)

    try:
        payload = build_search_payload(args.start_date, args.end_date)
        items = fetch_stac_items(payload)
        report = build_report(items, args.start_date, args.end_date)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + chr(10), encoding="utf-8")
    except Exception as error:
        print(f"GFM preflight failed: {error}", file=sys.stderr)
        return 2

    print(f"Status: {report['status']}")
    print(f"STAC items: {report['summary']['item_count']}")
    print("Acquisition dates: " + (", ".join(report["summary"]["unique_acquisition_dates"]) or "none"))
    print(f"Saved metadata report: {args.output}")
    print("No raster pixels or validation metrics were calculated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

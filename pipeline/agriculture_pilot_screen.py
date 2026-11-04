#!/usr/bin/env python3
"""Screen candidate Bangladesh Agriculture AOIs against the live NASA CMR catalogue.

This is a metadata-only preflight. It does not authenticate, download granules,
read soil-moisture arrays, create a study, or publish data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any, Callable

from agriculture_sme2 import _cmr_search

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SITES = ROOT / "pipeline" / "agriculture_pilot_sites.json"
DEFAULT_OUTPUT = ROOT / "pipeline" / "output" / "agriculture" / "pilot-screening" / "report.json"


def _validate_range(start: str, end: str) -> None:
    try:
        start_day = date.fromisoformat(start)
        end_day = date.fromisoformat(end)
    except ValueError as exc:
        raise ValueError("Dates must use YYYY-MM-DD format.") from exc
    if start_day >= end_day:
        raise ValueError("The start date must be earlier than the end date.")


def summarize_series(
    entries: list[dict[str, Any]],
    minimum_observations: int = 6,
    minimum_span_days: int = 60,
) -> list[dict[str, Any]]:
    """Group granules by the full compatible SME2 identity and deduplicate dates."""
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in entries:
        signature = item.get("signature")
        if not isinstance(signature, dict):
            continue
        key = json.dumps(signature, sort_keys=True)
        grouped.setdefault(key, []).append(item)

    output: list[dict[str, Any]] = []
    for key, items in grouped.items():
        unique: dict[str, dict[str, Any]] = {}
        for item in items:
            acquisition_date = item.get("date")
            if not isinstance(acquisition_date, str):
                continue
            previous = unique.get(acquisition_date)
            rank = (str(item.get("updated") or ""), str(item.get("concept_id") or ""))
            previous_rank = (
                (str(previous.get("updated") or ""), str(previous.get("concept_id") or ""))
                if previous else None
            )
            if previous is None or rank > previous_rank:
                unique[acquisition_date] = item

        dates = sorted(unique)
        if not dates:
            continue
        date_values = [date.fromisoformat(value) for value in dates]
        gaps = [(right - left).days for left, right in zip(date_values, date_values[1:])]
        span_days = (date_values[-1] - date_values[0]).days
        identity = json.loads(key)
        qualifies = (
            len(dates) >= minimum_observations
            and span_days >= minimum_span_days
        )
        output.append({
            "series_id": hashlib.sha256(key.encode("utf-8")).hexdigest()[:12],
            "signature": identity,
            "observation_count": len(dates),
            "dates": dates,
            "span_days": span_days,
            "median_revisit_days": sorted(gaps)[len(gaps) // 2] if gaps else None,
            "maximum_gap_days": max(gaps) if gaps else None,
            "meets_preflight_gate": qualifies,
            "granules": [
                {
                    "date": acquisition_date,
                    "concept_id": unique[acquisition_date].get("concept_id"),
                    "title": unique[acquisition_date].get("title"),
                    "updated": unique[acquisition_date].get("updated"),
                }
                for acquisition_date in dates
            ],
        })

    output.sort(
        key=lambda item: (
            item["meets_preflight_gate"],
            item["observation_count"],
            item["span_days"],
            -(item["maximum_gap_days"] or 0),
            item["series_id"],
        ),
        reverse=True,
    )
    return output


def screen_sites(
    sites: list[dict[str, Any]],
    start: str,
    end: str,
    minimum_observations: int = 6,
    minimum_span_days: int = 60,
    searcher: Callable[[dict[str, float], str, str], list[dict[str, Any]]] = _cmr_search,
) -> dict[str, Any]:
    """Query CMR for each AOI and report full-identity compatible time series."""
    _validate_range(start, end)
    results: list[dict[str, Any]] = []

    for site in sites:
        site_id = str(site.get("id") or "unknown")
        aoi = site.get("aoi")
        if not isinstance(aoi, dict):
            results.append({
                "site_id": site_id,
                "status": "INVALID_SITE_CONFIG",
                "error": "The site has no AOI object.",
                "series": [],
            })
            continue
        try:
            entries = searcher(aoi, start, end)
            series = summarize_series(entries, minimum_observations, minimum_span_days)
            eligible = any(item["meets_preflight_gate"] for item in series)
            results.append({
                "site_id": site_id,
                "name": site.get("name"),
                "priority": site.get("priority"),
                "aoi": aoi,
                "compatible_granules": len(entries),
                "status": (
                    "ELIGIBLE_FOR_OPERATOR_REVIEW" if eligible
                    else "INSUFFICIENT_TEMPORAL_COVERAGE" if series
                    else "NO_COMPATIBLE_SERIES"
                ),
                "series": series,
            })
        except Exception as exc:
            results.append({
                "site_id": site_id,
                "name": site.get("name"),
                "priority": site.get("priority"),
                "aoi": aoi,
                "status": "CMR_QUERY_FAILED",
                "error": str(exc),
                "series": [],
            })

    results.sort(
        key=lambda item: (
            item["status"] == "ELIGIBLE_FOR_OPERATOR_REVIEW",
            max((s["observation_count"] for s in item.get("series", [])), default=0),
            max((s["span_days"] for s in item.get("series", [])), default=0),
            -(int(item.get("priority") or 999)),
        ),
        reverse=True,
    )
    return {
        "schema_version": 1,
        "collection": "NISAR_L3_SME2_PROVISIONAL_V1",
        "date_range": {"start": start, "end": end},
        "preflight_gate": {
            "minimum_unique_acquisitions": minimum_observations,
            "minimum_temporal_span_days": minimum_span_days,
            "meaning": "Catalogue feasibility only; not a data-quality or scientific-validation threshold.",
        },
        "sites": results,
        "recommended_site_id": (
            results[0]["site_id"]
            if results and results[0]["status"] == "ELIGIBLE_FOR_OPERATOR_REVIEW"
            else None
        ),
        "next_action": (
            "Review the selected series identity and granule dates, then use the secure master-branch Agriculture cloud workflow to process the selected series. The runner uses the repository Actions secret EARTH_DATA; do not place credentials in the browser or workflow inputs."
            if any(item["status"] == "ELIGIBLE_FOR_OPERATOR_REVIEW" for item in results)
            else "No site passed the catalogue preflight. Inspect the returned dates/errors, revise the AOIs or date range, and do not start a download."
        ),
        "interpretation_limits": [
            "CMR footprint intersection is not a count of valid SME2 pixels inside the AOI.",
            "The preflight does not inspect HDF5 hierarchy, quality flags, crop mask, soil-moisture values or uncertainty.",
            "No CMR match means no compatible catalogue result for this exact query; it does not mean no agriculture or no soil moisture.",
            "No data are downloaded or published by this script.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sites", type=Path, default=DEFAULT_SITES)
    parser.add_argument("--start-date", default="2026-06-17")
    parser.add_argument("--end-date", default="2026-10-31")
    parser.add_argument("--min-observations", type=int, default=6)
    parser.add_argument("--min-span-days", type=int, default=60)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    if args.min_observations < 2 or args.min_span_days < 1:
        parser.error("The minimum observations must be at least 2 and the minimum span at least 1 day.")
    try:
        config = json.loads(args.sites.read_text(encoding="utf-8"))
        sites = config.get("sites")
        if not isinstance(sites, list) or not sites:
            raise ValueError("The site configuration must contain a non-empty sites array.")
        report = screen_sites(
            sites, args.start_date, args.end_date,
            args.min_observations, args.min_span_days,
        )
        report["study_intent"] = config.get("study_intent")
        report["source_site_config"] = str(args.sites)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"PILOT PREFLIGHT ERROR: {exc}", file=sys.stderr)
        return 2

    print(f"NISAR SME2 catalogue preflight · {report['date_range']['start']} → {report['date_range']['end']}")
    for item in report["sites"]:
        print(f"- {item['site_id']}: {item['status']}")
        if item.get("error"):
            print(f"  {item['error']}")
        for series in item.get("series", []):
            identity = series["signature"]
            print(
                f"  {series['series_id']} · {series['observation_count']} dates · "
                f"{series['span_days']} days · track {identity['track']} / frame {identity['frame']} / "
                f"{identity['direction']} · {identity['release']} · "
                f"{'passes screen' if series['meets_preflight_gate'] else 'below screen'}"
            )
    print(f"Recommended site: {report['recommended_site_id'] or 'NONE'}")
    print(f"Report: {args.output}")
    print(report["next_action"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

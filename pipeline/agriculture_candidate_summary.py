#!/usr/bin/env python3
"""Render a transparent, non-publishing summary of two SME2 track inspections."""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / "pipeline" / "output" / "agriculture"
EXTENDED_GAP_DAYS = 18


class SummaryError(ValueError):
    """Raised when inspection evidence cannot be compared safely."""


def _iso_date(value: Any, context: str) -> date:
    if not isinstance(value, str):
        raise SummaryError(f"{context} must be an ISO YYYY-MM-DD date.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise SummaryError(f"{context} must be an ISO YYYY-MM-DD date.") from exc
    if parsed.isoformat() != value:
        raise SummaryError(f"{context} must use the exact YYYY-MM-DD format.")
    return parsed


def _integer(value: Any, context: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise SummaryError(f"{context} must be a non-negative integer.")
    return value


def _safe_cell(value: Any) -> str:
    return str(value).replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def build_candidate_summary(baseline: dict[str, Any], dsg: dict[str, Any]) -> dict[str, Any]:
    """Validate two same-series reports and derive date-level temporal observability."""
    label = baseline.get("label")
    series_id = baseline.get("series_id")
    if not isinstance(label, str) or not label.strip():
        raise SummaryError("Baseline report is missing a candidate label.")
    if not isinstance(series_id, str) or not re.fullmatch(r"[a-f0-9]{12}", series_id):
        raise SummaryError("Baseline report has an invalid series ID.")
    if dsg.get("label") != label or dsg.get("series_id") != series_id:
        raise SummaryError("Baseline and DSG reports do not identify the same candidate series.")
    if not baseline.get("run_id") or dsg.get("run_id") != baseline.get("run_id"):
        raise SummaryError("Baseline and DSG reports do not share the same inspection run ID.")
    if dsg.get("algorithm") != "DSG":
        raise SummaryError("Candidate report is not the DSG inspection.")

    baseline_obs = baseline.get("observations")
    observations = dsg.get("observations")
    if not isinstance(baseline_obs, list) or not isinstance(observations, list) or not observations:
        raise SummaryError("Inspection reports must contain non-empty observation lists.")
    baseline_dates = [item.get("date") for item in baseline_obs if isinstance(item, dict)]
    dates = [item.get("date") for item in observations if isinstance(item, dict)]
    if len(baseline_dates) != len(baseline_obs) or len(dates) != len(observations):
        raise SummaryError("Inspection observations must be JSON objects.")
    parsed_dates = [_iso_date(value, "Observation date") for value in dates]
    if parsed_dates != sorted(parsed_dates) or len(set(parsed_dates)) != len(parsed_dates):
        raise SummaryError("DSG observations must have unique dates in chronological order.")
    if baseline_dates != dates:
        raise SummaryError("Baseline and DSG reports do not cover the same ordered acquisition dates.")

    candidate = dsg.get("candidate_analysis")
    if not isinstance(candidate, dict):
        raise SummaryError("DSG report is missing candidate-analysis evidence.")
    usable_dates = candidate.get("usable_dates")
    if not isinstance(usable_dates, list):
        raise SummaryError("DSG report is missing its usable-date list.")
    usable_parsed = [_iso_date(value, "Usable date") for value in usable_dates]
    if usable_parsed != sorted(usable_parsed) or len(set(usable_parsed)) != len(usable_parsed):
        raise SummaryError("Usable dates must be unique and chronological.")

    date_rows: list[dict[str, Any]] = []
    derived_usable: list[str] = []
    for item in observations:
        day = item["date"]
        valid_pixels = _integer(item.get("quality_valid_pixels"), f"{day} quality-valid pixels")
        aoi_pixels = _integer(item.get("aoi_pixels"), f"{day} AOI pixels")
        if aoi_pixels <= 0 or valid_pixels > aoi_pixels:
            raise SummaryError(f"{day} has inconsistent valid-pixel and AOI counts.")
        fraction = valid_pixels / aoi_pixels
        is_usable = valid_pixels > 0
        if is_usable:
            derived_usable.append(day)

        retrieval_counts = item.get("retrieval_flag_counts") or {}
        surface_diag = item.get("surface_flag_diagnostics") or {}
        surface_flags = surface_diag.get("flags") or {}
        moisture = item.get("soil_moisture_summary_on_quality_valid_pixels") or {}
        retrieval_zero = _integer(retrieval_counts.get("0", 0), f"{day} retrieval-flag-zero pixels")
        precipitation = _integer(surface_flags.get("precipitation", 0), f"{day} precipitation-flag pixels")
        snow_ice = _integer(surface_flags.get("snow_or_ice", 0), f"{day} snow-or-ice flag pixels")
        unsupported = _integer(surface_diag.get("unsupported_encoding_pixels", 0), f"{day} unsupported surface encodings")
        clear_surface = _integer(surface_diag.get("unflagged_pixels", 0), f"{day} surface-clear pixels")
        if any(value > aoi_pixels for value in (retrieval_zero, precipitation, snow_ice, unsupported, clear_surface)):
            raise SummaryError(f"{day} diagnostic pixel counts exceed the AOI size.")
        if valid_pixels > min(retrieval_zero, clear_surface):
            raise SummaryError(f"{day} quality-valid pixels exceed retrieval/surface-clear support.")
        median_moisture = moisture.get("median")
        if median_moisture is not None and (
            isinstance(median_moisture, bool) or not isinstance(median_moisture, (int, float))
        ):
            raise SummaryError(f"{day} moisture median must be numeric or null.")
        date_rows.append({
            "date": day,
            "valid_pixels": valid_pixels,
            "aoi_pixels": aoi_pixels,
            "valid_fraction": fraction,
            "usable": is_usable,
            "median_moisture": median_moisture,
            "retrieval_zero_pixels": retrieval_zero,
            "surface_clear_pixels": clear_surface,
            "precipitation_flag_pixels": precipitation,
            "snow_ice_flag_pixels": snow_ice,
            "unsupported_surface_pixels": unsupported,
        })

    if derived_usable != usable_dates:
        raise SummaryError("DSG usable dates do not match the per-date quality-valid pixel counts.")
    if candidate.get("usable_observation_count") != len(usable_dates):
        raise SummaryError("DSG usable-observation count does not match the usable-date list.")

    baseline_valid = _integer(baseline.get("valid_observation_count"), "Baseline valid-observation count")
    baseline_count = _integer(baseline.get("downloaded_observation_count"), "Baseline downloaded-observation count")
    if baseline_count != len(observations) or baseline_valid > baseline_count:
        raise SummaryError("Baseline observation totals do not match the inspected DSG dates.")
    baseline_observed_valid = sum(
        _integer(item.get("quality_valid_pixels"), "Baseline quality-valid pixels") > 0
        for item in baseline_obs
    )
    if baseline_valid != baseline_observed_valid:
        raise SummaryError("Baseline valid-observation count does not match its per-date evidence.")
    if dsg.get("valid_observation_count") != len(usable_dates):
        raise SummaryError("DSG valid-observation count does not match its per-date evidence.")

    gaps: list[int] = []
    gap_windows: list[str] = []
    for previous, current in zip(usable_parsed, usable_parsed[1:]):
        gap = (current - previous).days
        gaps.append(gap)
        if gap > EXTENDED_GAP_DAYS:
            gap_windows.append(f"{previous.isoformat()} → {current.isoformat()} ({gap} days)")
    matched = candidate.get("matched_support") or {}
    total_common = _integer(matched.get("total_pixels", 0), "Matched-support total pixels")
    valid_common = _integer(matched.get("valid_pixels", 0), "Matched-support valid pixels")
    if valid_common > total_common:
        raise SummaryError("Matched-support valid pixels exceed the total cohort.")
    common_fraction = valid_common / total_common if total_common else None
    common_status = matched.get("status") if isinstance(matched.get("status"), str) else "NOT_RECORDED"

    usable_fractions = [row["valid_fraction"] for row in date_rows if row["usable"]]
    return {
        "label": label,
        "series_id": series_id,
        "acquisition_count": len(observations),
        "baseline_valid_count": baseline_valid,
        "dsg_valid_count": len(usable_dates),
        "dsg_valid_fraction": len(usable_dates) / len(observations),
        "median_usable_fraction": statistics.median(usable_fractions) if usable_fractions else None,
        "matched_valid_pixels": valid_common,
        "matched_total_pixels": total_common,
        "matched_fraction": common_fraction,
        "matched_status": common_status,
        "usable_span_days": (usable_parsed[-1] - usable_parsed[0]).days if len(usable_parsed) > 1 else 0,
        "median_usable_gap_days": statistics.median(gaps) if gaps else None,
        "maximum_usable_gap_days": max(gaps) if gaps else None,
        "gap_windows": gap_windows,
        "date_rows": date_rows,
    }


def render_markdown(summaries: list[dict[str, Any]]) -> str:
    """Render concise comparison and auditable acquisition-level evidence."""
    if not summaries:
        raise SummaryError("At least one candidate summary is required.")

    lines = [
        "## Baniachong native SME2 quality inspection",
        "",
        "### Candidate comparison",
        "",
        "| Candidate | Acquisitions | Baseline valid dates | DSG valid dates | Median DSG AOI support on usable dates | Fixed DSG cohort | Cohort status | Usable-date span | Median gap | Longest gap |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in summaries:
        median_support = "n/a" if row["median_usable_fraction"] is None else f"{row['median_usable_fraction']:.1%}"
        matched = "n/a" if row["matched_fraction"] is None else f"{row['matched_valid_pixels']}/{row['matched_total_pixels']} ({row['matched_fraction']:.1%})"
        median_gap = "n/a" if row["median_usable_gap_days"] is None else f"{row['median_usable_gap_days']:g} d"
        max_gap = "n/a" if row["maximum_usable_gap_days"] is None else f"{row['maximum_usable_gap_days']} d"
        lines.append(
            f"| {_safe_cell(row['label'])} | {row['acquisition_count']} | "
            f"{row['baseline_valid_count']}/{row['acquisition_count']} | "
            f"{row['dsg_valid_count']}/{row['acquisition_count']} ({row['dsg_valid_fraction']:.0%}) | "
            f"{median_support} | {matched} | {_safe_cell(row['matched_status'])} | "
            f"{row['usable_span_days']} d | {median_gap} | {max_gap} |"
        )

    lines.extend([
        "",
        "### Acquisition-by-acquisition DSG evidence",
        "",
        "| Candidate | Acquisition date | Quality-valid pixels / AOI | AOI support | Median moisture (m³/m³) | DSG retrieval flag = 0 | Surface-clear pixels | Snow/ice flag pixels | Precipitation flag pixels | Unsupported surface encodings |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ])
    for row in summaries:
        for item in row["date_rows"]:
            median = "—" if item["median_moisture"] is None else f"{item['median_moisture']:.3f}"
            lines.append(
                f"| {_safe_cell(row['label'])} | {item['date']} | "
                f"{item['valid_pixels']}/{item['aoi_pixels']} | {item['valid_fraction']:.1%} | "
                f"{median} | {item['retrieval_zero_pixels']} | {item['surface_clear_pixels']} | "
                f"{item['snow_ice_flag_pixels']} | {item['precipitation_flag_pixels']} | "
                f"{item['unsupported_surface_pixels']} |"
            )

    lines.extend(["", "### Extended gaps in usable DSG observations", ""])
    for row in summaries:
        lines.append(f"**{_safe_cell(row['label'])}:**")
        if row["gap_windows"]:
            for window in row["gap_windows"]:
                lines.append(f"- {window}")
        else:
            lines.append("- No interval exceeds the 18-day visual gap cue.")
    lines.extend([
        "",
        "**Interpretation:** a usable date means at least one AOI pixel passed the existing strict SME2 screen; it does not mean the entire scene is usable. The 18-day cue is descriptive, not a scientific rejection threshold. Missing dates are not interpolated.",
        "",
        "**No track winner is selected automatically.** These are AOI-wide native-pixel diagnostics, not crop-area coverage or scientific validation. DSG matched support is the exact intersection across its non-empty dates; it must not be interpreted as evidence of crop identity.",
        "",
        "Review the dated independent crop mask and raw surface/retrieval flags before selecting a track. Undocumented or out-of-range surface flag encodings are counted separately and are not reinterpreted.",
        "",
        "This workflow does not run study analysis, attach rainfall, call the publisher, or write to public/agriculture/current.",
        "",
    ])
    return "\n".join(lines)


def load_candidate(run_id: str) -> dict[str, Any]:
    if not re.fullmatch(r"agri-cmp-[0-9]+-(?:141|069)", run_id):
        raise SummaryError(f"Unsafe Agriculture inspection run ID: {run_id}")
    base = OUTPUT_ROOT / run_id / "result"
    baseline_path = base / "inspection.json"
    dsg_path = base / "inspection-dsg.json"
    try:
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
        dsg = json.loads(dsg_path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise SummaryError(f"Could not read inspection evidence for {run_id}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise SummaryError(f"Inspection evidence for {run_id} is invalid JSON: {exc}") from exc
    if not isinstance(baseline, dict) or not isinstance(dsg, dict):
        raise SummaryError(f"Inspection evidence for {run_id} must contain JSON objects.")
    if baseline.get("run_id") != run_id or dsg.get("run_id") != run_id:
        raise SummaryError(f"Inspection evidence does not match requested run ID {run_id}.")
    expected_track = run_id.rsplit("-", 1)[-1]
    for report in (baseline, dsg):
        signature = report.get("signature") or {}
        if str(signature.get("track")) != expected_track:
            raise SummaryError(f"Inspection evidence for {run_id} belongs to a different track.")
    return build_candidate_summary(baseline, dsg)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_ids", nargs=2, help="run IDs for the two track inspections")
    args = parser.parse_args()
    try:
        summaries = [load_candidate(run_id) for run_id in args.run_ids]
        markdown = render_markdown(summaries)
        summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary_path:
            with open(summary_path, "a", encoding="utf-8") as summary:
                summary.write(markdown)
        else:
            sys.stdout.write(markdown)
        return 0
    except (SummaryError, OSError, ValueError, KeyError, TypeError) as exc:
        print(f"AGRICULTURE CANDIDATE SUMMARY ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

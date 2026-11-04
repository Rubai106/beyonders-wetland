"""Regression tests for the non-publishing SME2 candidate summary."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from agriculture_candidate_summary import SummaryError, build_candidate_summary, render_markdown  # noqa: E402


def report_fixture(label="Track 141 / frame 014", series_id="c5f219dd7bbc"):
    dates = ["2026-06-20", "2026-07-02", "2026-08-19", "2026-08-31"]
    baseline_observations = []
    dsg_observations = []
    usable_dates = [dates[0], dates[2], dates[3]]
    for index, day in enumerate(dates):
        valid = 70 if day in usable_dates else 0
        row = {
            "date": day,
            "quality_valid_pixels": valid,
            "aoi_pixels": 100,
            "retrieval_flag_counts": {"0": valid, "1": 30},
            "surface_flag_diagnostics": {
                "unflagged_pixels": 75,
                "unsupported_encoding_pixels": 20,
                "flags": {"precipitation": 5, "snow_or_ice": 0},
            },
            "soil_moisture_summary_on_quality_valid_pixels": {"median": 0.2 + index / 100} if valid else None,
        }
        baseline_observations.append({"date": day, "quality_valid_pixels": 0, "aoi_pixels": 100})
        dsg_observations.append(row)
    baseline = {
        "label": label,
        "series_id": series_id,
        "run_id": "agri-cmp-123-141",
        "downloaded_observation_count": 4,
        "valid_observation_count": 0,
        "observations": baseline_observations,
    }
    dsg = {
        "label": label,
        "series_id": series_id,
        "run_id": "agri-cmp-123-141",
        "valid_observation_count": 3,
        "algorithm": "DSG",
        "observations": dsg_observations,
        "candidate_analysis": {
            "usable_dates": usable_dates,
            "usable_observation_count": 3,
            "matched_support": {"total_pixels": 100, "valid_pixels": 65, "status": "COMPARABLE"},
        },
    }
    return baseline, dsg


class AgricultureCandidateSummaryTests(unittest.TestCase):
    def test_derives_long_gaps_only_between_usable_observations(self):
        baseline, dsg = report_fixture()
        result = build_candidate_summary(baseline, dsg)
        self.assertEqual(result["acquisition_count"], 4)
        self.assertEqual(result["dsg_valid_count"], 3)
        self.assertEqual(result["usable_span_days"], 72)
        self.assertEqual(result["median_usable_gap_days"], 36)
        self.assertEqual(result["maximum_usable_gap_days"], 60)
        self.assertEqual(result["gap_windows"], ["2026-06-20 → 2026-08-19 (60 days)"])

    def test_report_exposes_date_level_support_and_caveats_without_ranking(self):
        baseline, dsg = report_fixture()
        markdown = render_markdown([build_candidate_summary(baseline, dsg)])
        self.assertIn("Acquisition-by-acquisition DSG evidence", markdown)
        self.assertIn("Unsupported surface encodings", markdown)
        self.assertIn("2026-06-20 → 2026-08-19 (60 days)", markdown)
        self.assertIn("No track winner is selected automatically", markdown)
        self.assertIn("Missing dates are not interpolated", markdown)
        self.assertIn("not crop-area coverage", markdown)

    def test_rejects_misaligned_reports(self):
        baseline, dsg = report_fixture()
        dsg["series_id"] = "540e079403d5"
        with self.assertRaisesRegex(SummaryError, "same candidate series"):
            build_candidate_summary(baseline, dsg)

    def test_rejects_inconsistent_usable_dates(self):
        baseline, dsg = report_fixture()
        dsg["candidate_analysis"]["usable_dates"] = ["2026-06-20", "2026-08-19"]
        dsg["candidate_analysis"]["usable_observation_count"] = 2
        with self.assertRaisesRegex(SummaryError, "usable dates do not match"):
            build_candidate_summary(baseline, dsg)

    def test_rejects_valid_pixels_exceeding_aoi(self):
        baseline, dsg = report_fixture()
        dsg["observations"][0]["quality_valid_pixels"] = 101
        with self.assertRaisesRegex(SummaryError, "inconsistent valid-pixel"):
            build_candidate_summary(baseline, dsg)

    def test_rejects_non_chronological_or_duplicate_dates(self):
        baseline, dsg = report_fixture()
        dsg["observations"][2]["date"] = "2026-07-02"
        with self.assertRaisesRegex(SummaryError, "unique dates in chronological"):
            build_candidate_summary(baseline, dsg)


if __name__ == "__main__":
    unittest.main(verbosity=2)

import hashlib
import json
import unittest

from agriculture_pilot_screen import screen_sites, summarize_series


def entry(acquisition_date: str, *, track: str = "171", frame: str = "066", updated: str = "2026-11-01T00:00:00Z", concept: str | None = None):
    stamp = acquisition_date.replace("-", "")
    title = (
        f"NISAR_L3_PR_SME2_024_{track}_D_{frame}_4005_DHDH_A_"
        f"{stamp}T013930_{stamp}T014005_P05023_N_F_J_001.h5"
    )
    return {
        "concept_id": concept or f"G-{track}-{stamp}",
        "title": title,
        "date": acquisition_date,
        "updated": updated,
        "signature": {
            "release": "P05023", "track": track, "direction": "D",
            "frame": frame, "bandwidth": "4005", "polarization": "DHDH", "frequency": "A",
        },
    }


class AgriculturePilotScreenTests(unittest.TestCase):
    def test_groups_full_series_identity_and_requires_minimum_span(self):
        dates = [
            "2026-06-01", "2026-06-13", "2026-06-25",
            "2026-07-07", "2026-07-19", "2026-07-31",
        ]
        rows = summarize_series([entry(day) for day in dates])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["observation_count"], 6)
        self.assertEqual(rows[0]["span_days"], 60)
        self.assertTrue(rows[0]["meets_preflight_gate"])
        expected_id = hashlib.sha256(json.dumps(rows[0]["signature"], sort_keys=True).encode("utf-8")).hexdigest()[:12]
        self.assertEqual(rows[0]["series_id"], expected_id)

    def test_does_not_mix_track_or_frame_into_one_series(self):
        rows = summarize_series([
            entry("2026-06-01", track="171"),
            entry("2026-06-13", track="171"),
            entry("2026-06-25", track="171"),
            entry("2026-07-07", track="171"),
            entry("2026-07-19", track="171"),
            entry("2026-07-31", track="171"),
            entry("2026-06-01", track="033", frame="120"),
            entry("2026-06-13", track="033", frame="120"),
            entry("2026-06-25", track="033", frame="120"),
        ])
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["observation_count"], 6)
        self.assertEqual(rows[1]["observation_count"], 3)
        self.assertNotEqual(rows[0]["signature"]["track"], rows[1]["signature"]["track"])

    def test_deduplicates_same_date_by_update_timestamp_then_concept_id(self):
        original = entry("2026-06-01", updated="2026-06-02T00:00:00Z", concept="G-OLD")
        revised = entry("2026-06-01", updated="2026-06-03T00:00:00Z", concept="G-NEW")
        rows = summarize_series([original, revised])
        self.assertEqual(rows[0]["observation_count"], 1)
        self.assertEqual(rows[0]["granules"][0]["concept_id"], "G-NEW")

    def test_four_date_series_is_not_misrepresented_as_event_response_ready(self):
        dates = ["2026-06-01", "2026-06-13", "2026-06-25", "2026-07-07"]
        rows = summarize_series([entry(day) for day in dates])
        self.assertFalse(rows[0]["meets_preflight_gate"])
        self.assertEqual(rows[0]["observation_count"], 4)

    def test_reports_insufficient_temporal_support_without_claiming_no_agriculture(self):
        dates = ["2026-06-17", "2026-06-29", "2026-07-11"]
        site = {"id": "test", "name": "Test site", "priority": 1, "aoi": {
            "west": 91.3, "south": 24.3, "east": 91.4, "north": 24.4,
        }}
        report = screen_sites(
            [site], "2026-06-17", "2026-07-11",
            searcher=lambda aoi, start, end: [entry(day) for day in dates],
        )
        self.assertIsNone(report["recommended_site_id"])
        self.assertEqual(report["sites"][0]["status"], "INSUFFICIENT_TEMPORAL_COVERAGE")
        self.assertIn("does not mean no agriculture", report["interpretation_limits"][2].lower())

    def test_rejects_dates_outside_the_cloud_workers_supported_range(self):
        site = {"id": "test", "name": "Test site", "priority": 1, "aoi": {
            "west": 91.3, "south": 24.3, "east": 91.4, "north": 24.4,
        }}
        with self.assertRaisesRegex(ValueError, "cannot start before 2026-06-17"):
            screen_sites([site], "2026-01-01", "2026-10-31", searcher=lambda *_: [])

        with self.assertRaisesRegex(ValueError, "cannot exceed 366 days"):
            screen_sites([site], "2026-06-17", "2027-07-01", searcher=lambda *_: [])

    def test_eligible_report_points_to_master_cloud_workflow(self):
        site = {"id": "test", "name": "Test site", "priority": 1, "aoi": {
            "west": 91.3, "south": 24.3, "east": 91.4, "north": 24.4,
        }}
        dates = [
            "2026-06-17", "2026-06-29", "2026-07-11",
            "2026-07-23", "2026-08-04", "2026-08-16",
        ]
        report = screen_sites(
            [site], "2026-06-17", "2026-08-16",
            searcher=lambda aoi, start, end: [entry(day) for day in dates],
        )
        self.assertEqual(report["sites"][0]["status"], "ELIGIBLE_FOR_OPERATOR_REVIEW")
        self.assertIn("master-branch Agriculture cloud workflow", report["next_action"])
        self.assertIn("EARTH_DATA", report["next_action"])
        self.assertNotIn("run the existing authenticated download/analyze workflow locally", report["next_action"])

    def test_records_site_specific_cmr_failure_and_continues(self):
        good_site = {"id": "good", "priority": 1, "aoi": {
            "west": 91.3, "south": 24.3, "east": 91.4, "north": 24.4,
        }}
        bad_site = {"id": "bad", "priority": 2, "aoi": {
            "west": 91.3, "south": 24.3, "east": 91.4, "north": 24.4,
        }}
        def searcher(aoi, start, end):
            if aoi["west"] == 91.3:
                if not hasattr(searcher, "calls"):
                    searcher.calls = 0
                searcher.calls += 1
                if searcher.calls == 1:
                    raise RuntimeError("simulated network failure")
                return [entry(day) for day in [
                    "2026-06-17", "2026-06-29", "2026-07-11",
                    "2026-07-23", "2026-08-04", "2026-08-16",
                ]]
        report = screen_sites([bad_site, good_site], "2026-06-17", "2026-08-16", searcher=searcher)
        self.assertEqual(len(report["sites"]), 2)
        # The first error is recorded; a later site can still pass even when one
        # location fails, rather than aborting the complete screening report.
        statuses = {item["status"] for item in report["sites"]}
        self.assertEqual(statuses, {"CMR_QUERY_FAILED", "ELIGIBLE_FOR_OPERATOR_REVIEW"})
        self.assertIsNotNone(report["recommended_site_id"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

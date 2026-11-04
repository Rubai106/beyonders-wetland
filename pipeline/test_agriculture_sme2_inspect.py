import unittest
from pathlib import Path

import numpy as np

from agriculture_sme2 import AgricultureError
from agriculture_sme2_inspect import build_inspection_report, summarize_observation


def scene(day, valid):
    return {
        "date": day,
        "file": Path(f"NISAR_L3_PR_SME2_025_141_D_014_4005_DHDH_A_{day.replace('-', '')}T013930_{day.replace('-', '')}T014005_P05023_N_F_J_001.h5"),
        "signature": {
            "release": "P05023", "track": "141", "direction": "D",
            "frame": "014", "bandwidth": "4005", "polarization": "DHDH", "frequency": "A",
        },
        "epsg": 6933,
        "aoi_mask": np.ones((2, 2), dtype=bool),
        "valid": np.asarray(valid, dtype=bool),
        "moisture": np.array([[0.20, 0.25], [0.30, 0.35]], dtype=float),
        "uncertainty": np.full((2, 2), 0.03, dtype=float),
        "retrieval_flag_counts": {"0": 3, "1": 1},
        "surface_flag_counts": {"0": 4},
        "quality_diagnostics": {"aoi": {"aoi_pixels": 4, "all_screen_pass_pixels": int(np.sum(valid))}},
        "surface_flag_diagnostics": {"unflagged_pixels": 4, "flags": {"static_water": 0}},
        "algorithm_candidate_diagnostics": {"status": "AUDITED", "algorithms": {"DSG": {"status": "AUDITED"}}},
    }


class AgricultureSME2InspectionTests(unittest.TestCase):
    def test_observation_reports_quality_support_and_preserves_raw_diagnostics(self):
        item = summarize_observation(
            scene("2026-06-20", [[True, False], [True, False]]),
            {"bytes": 1234, "sha256": "a" * 64},
        )
        self.assertEqual(item["aoi_pixels"], 4)
        self.assertEqual(item["quality_valid_pixels"], 2)
        self.assertEqual(item["quality_valid_fraction"], 0.5)
        self.assertAlmostEqual(item["soil_moisture_summary_on_quality_valid_pixels"]["median"], 0.25)
        self.assertEqual(item["retrieval_flag_counts"], {"0": 3, "1": 1})
        self.assertEqual(item["algorithm_candidate_diagnostics"]["algorithms"]["DSG"]["status"], "AUDITED")
        self.assertEqual(item["source_sha256"], "a" * 64)

    def test_zero_valid_pixels_are_reported_without_fabricating_moisture_statistics(self):
        item = summarize_observation(
            scene("2026-06-20", np.zeros((2, 2), dtype=bool)),
            {"bytes": 1234, "sha256": "b" * 64},
        )
        self.assertEqual(item["quality_valid_pixels"], 0)
        self.assertEqual(item["quality_valid_fraction"], 0)
        self.assertIsNone(item["soil_moisture_summary_on_quality_valid_pixels"])

    def test_series_report_is_explicitly_non_publishing_and_not_an_agriculture_ranking(self):
        one = scene("2026-06-20", [[True, True], [True, False]])
        two = scene("2026-07-02", [[True, False], [False, False]])
        sources = {
            one["file"].name: {"bytes": 100, "sha256": "1" * 64},
            two["file"].name: {"bytes": 200, "sha256": "2" * 64},
        }
        manifest = {
            "collection": "NISAR_L3_SME2_PROVISIONAL_V1",
            "aoi": {"west": 91.38, "south": 24.35, "east": 91.44, "north": 24.41},
            "date_range": {"start": "2026-06-17", "end": "2026-10-31"},
            "compatible_series": [{
                "series_id": "c5f219dd7bbc",
                "signature": one["signature"],
                "observation_count": 2,
                "dates": ["2026-06-20", "2026-07-02"],
                "granules": [{"date": "2026-06-20"}, {"date": "2026-07-02"}],
            }],
        }
        receipt = {"series_id": "c5f219dd7bbc"}
        report = build_inspection_report(
            "agri-cmp-test-141", "Track 141 / frame 014", "baseline",
            manifest, receipt, [two, one], sources,
        )
        self.assertEqual(report["downloaded_observation_count"], 2)
        self.assertEqual(report["valid_observation_count"], 2)
        self.assertEqual(report["zero_valid_observation_dates"], [])
        self.assertEqual(report["decision"], "NOT_RANKED_FOR_AGRICULTURAL_SUITABILITY")
        self.assertIn("no independently dated crop mask", " ".join(report["interpretation_limits"]).lower())
        self.assertEqual([item["date"] for item in report["observations"]], ["2026-06-20", "2026-07-02"])

    def test_observation_refuses_mismatched_array_shapes(self):
        item = scene("2026-06-20", [[True, False], [False, True]])
        item["uncertainty"] = np.ones((1, 4))
        with self.assertRaisesRegex(AgricultureError, "same two-dimensional AOI grid"):
            summarize_observation(item, {"bytes": 100, "sha256": "c" * 64})


if __name__ == "__main__":
    unittest.main(verbosity=2)

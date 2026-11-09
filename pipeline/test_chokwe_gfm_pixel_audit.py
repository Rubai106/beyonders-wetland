"""Offline unit tests for the exact-AOI GFM raster audit."""
from __future__ import annotations

import unittest
import numpy as np

import inspect_chokwe_gfm_pixels as audit


class ChokweGfmPixelAuditTests(unittest.TestCase):
    def test_selects_only_the_event_date_and_sorts_by_time(self):
        items = [
            {"id": "later", "properties": {"datetime": "2026-01-17T03:19:12Z"}},
            {"id": "before", "properties": {"datetime": "2026-01-16T03:26:10Z"}},
            {"id": "earlier", "properties": {"datetime": "2026-01-17T03:18:22Z"}},
        ]
        selected = audit.select_event_items(items)
        self.assertEqual([item["id"] for item in selected], ["earlier", "later"])

    def test_value_histogram_counts_all_values_deterministically(self):
        values = np.array([[0, 1, 1], [2, 255, 0]], dtype=np.uint8)
        self.assertEqual(
            audit.value_histogram(values),
            {"0": 2, "1": 2, "2": 1, "255": 1},
        )

    def test_external_or_non_tiff_asset_urls_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "unexpected URL"):
            audit._safe_asset_url(
                {"href": "https://example.invalid/flood.tif"}, "item", "ensemble_flood_extent"
            )
        with self.assertRaisesRegex(ValueError, "unexpected URL"):
            audit._safe_asset_url(
                {"href": "https://data.eodc.eu/flood.json"}, "item", "ensemble_flood_extent"
            )

    def test_no_event_date_items_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "No GFM STAC items"):
            audit.build_report([
                {"id": "other", "properties": {"datetime": "2026-01-16T03:26:10Z"}}
            ])

    def test_ensemble_binary_is_checked_against_three_algorithm_majority(self):
        def layer(data):
            data = np.array(data, dtype=np.uint8)
            return {"data": data, "valid": np.ones(data.shape, dtype=bool)}

        ensemble_flood = np.array([[1, 1], [1, 0]], dtype=np.uint8)
        likelihood = np.array([[80, 40], [49, 20]], dtype=np.uint8)
        exclusion = np.zeros((2, 2), dtype=np.uint8)
        exclusion_valid = np.ones((2, 2), dtype=bool)
        reference = np.zeros((2, 2), dtype=np.uint8)
        reference_valid = np.ones((2, 2), dtype=bool)
        inside = np.ones((2, 2), dtype=bool)
        layers = {
            "list_flood_extent": layer([[1, 1], [1, 0]]),
            "dlr_flood_extent": layer([[1, 0], [0, 0]]),
            "tuw_flood_extent": layer([[0, 1], [0, 0]]),
        }
        advisory = np.array([[0, 1], [0, 0]], dtype=np.uint8)
        algorithm_likelihoods = {
            "list_likelihood": layer([[80, 70], [65, 20]]),
            "dlr_likelihood": layer([[75, 30], [25, 10]]),
            "tuw_likelihood": layer([[20, 80], [90, 90]]),
        }
        result = audit.summarize_algorithm_consistency(
            ensemble_flood, likelihood, exclusion, exclusion_valid,
            reference, reference_valid, inside, layers, algorithm_likelihoods,
            candidate_mask=np.array([[0, 1], [1, 0]], dtype=bool),
            advisory_flags=advisory, advisory_valid=np.ones((2, 2), dtype=bool),
        )
        self.assertEqual(result["source_algorithm_positive_pixel_counts"], {
            "list_flood_extent": 3, "dlr_flood_extent": 1, "tuw_flood_extent": 1
        })
        self.assertEqual(result["ensemble_binary_vs_two_of_three_disagreement_count"], 1)
        self.assertEqual(result["ensemble_flood_pixels_with_likelihood_below_50"], 2)
        self.assertEqual(result["low_likelihood_flood_algorithm_vote_histogram"], {
            "0": 0, "1": 1, "2": 1, "3": 0
        })
        self.assertEqual(result["low_likelihood_flood_pixels_with_advisory_flag"], 1)
        self.assertEqual(result["raw_intermediate_likelihood_uncertainty_on_all_low_likelihood_flood_pixels"]["list_likelihood"]["valid_sample_count"], 2)
        self.assertEqual(result["raw_intermediate_likelihood_uncertainty_on_low_likelihood_candidate_overlap_pixels"]["tuw_likelihood"]["valid_sample_count"], 1)

    def test_candidate_overlap_keeps_excluded_water_and_nodata_out_of_denominator(self):
        candidate = np.array([[1, 1], [1, 1]], dtype=np.uint8)
        inside = np.ones((2, 2), dtype=bool)
        flood = np.array([[1, 1], [0, 1]], dtype=np.uint8)
        flood_valid = np.array([[1, 1], [1, 0]], dtype=bool)
        exclusion = np.array([[0, 0], [1, 0]], dtype=np.uint8)
        exclusion_valid = np.ones((2, 2), dtype=bool)
        reference = np.array([[0, 1], [0, 0]], dtype=np.uint8)
        reference_valid = np.ones((2, 2), dtype=bool)
        likelihood = np.array([[80, 60], [20, 90]], dtype=np.uint8)
        likelihood_valid = np.array([[1, 1], [1, 0]], dtype=bool)

        result = audit.summarize_candidate_overlap(
            candidate, inside, flood, flood_valid, exclusion,
            exclusion_valid, reference, reference_valid,
            likelihood, likelihood_valid, 0.0004,
        )
        self.assertEqual(result["candidate"]["rasterized_pixel_count_in_aoi"], 4)
        self.assertEqual(result["candidate"]["candidate_pixels_without_common_valid_gfm_data"], 1)
        self.assertEqual(result["candidate"]["candidate_pixels_in_exclusion_mask"], 1)
        self.assertEqual(result["candidate"]["candidate_pixels_in_reference_water_mask"], 1)
        self.assertEqual(result["candidate"]["eligible_candidate_pixel_count"], 1)
        self.assertEqual(result["gfm_positive_support"]["overlap_pixel_count"], 1)
        self.assertEqual(result["gfm_positive_support"]["overlap_area_km2"], 0.0004)
        self.assertEqual(result["gfm_positive_support"]["fraction_of_eligible_candidate_pixels"], 1.0)
        self.assertEqual(result["gfm_positive_support"]["positive_pixel_likelihood"]["median"], 80.0)


if __name__ == "__main__":
    unittest.main()

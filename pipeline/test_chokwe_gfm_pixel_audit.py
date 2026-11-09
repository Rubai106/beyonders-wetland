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


if __name__ == "__main__":
    unittest.main()

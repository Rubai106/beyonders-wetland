"""Offline tests for the read-only Chókwè GFM STAC preflight."""
from __future__ import annotations

import json
import unittest

import discover_chokwe_gfm as gfm


def feature(item_id: str, timestamp: str) -> dict:
    return {
        "type": "Feature",
        "id": item_id,
        "bbox": [32.8, -24.7, 33.2, -24.3],
        "properties": {
            "datetime": timestamp,
            "platform": "sentinel-1a",
            "constellation": "sentinel-1",
            "instruments": ["c-sar"],
            "gsd": 20,
            "proj:epsg": 32636,
        },
        "assets": {
            "ensemble_flood_extent": {
                "href": "https://example.invalid/ensemble.tif",
                "type": "image/tiff; application=geotiff",
            },
            "reference_water_mask": {"href": "https://example.invalid/water.tif"},
            "exclusion_mask": {"href": "https://example.invalid/exclusion.tif"},
        },
    }


class FakeResponse:
    def __init__(self, document: dict):
        self.document = document

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self) -> bytes:
        return json.dumps(self.document).encode("utf-8")


class GfmDiscoveryTests(unittest.TestCase):
    def test_payload_uses_exact_chokwe_box_and_inclusive_dates(self):
        payload = gfm.build_search_payload("2026-01-07", "2026-01-28")
        self.assertEqual(payload["collections"], ["GFM"])
        self.assertEqual(payload["bbox"], [32.93, -24.58, 33.03, -24.48])
        self.assertEqual(
            payload["datetime"],
            "2026-01-07T00:00:00Z/2026-01-28T23:59:59Z",
        )

    def test_invalid_or_reversed_date_range_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "YYYY-MM-DD"):
            gfm.build_search_payload("2026/01/07", "2026-01-28")
        with self.assertRaisesRegex(ValueError, "on or before"):
            gfm.build_search_payload("2026-01-29", "2026-01-28")

    def test_pagination_collects_items_and_posts_search_body(self):
        first = feature("tile-a-1", "2026-01-17T03:00:00Z")
        second = feature("tile-a-2", "2026-01-22T03:00:00Z")
        calls = []

        def opener(request, timeout):
            calls.append((request, timeout))
            if len(calls) == 1:
                return FakeResponse({
                    "type": "FeatureCollection",
                    "features": [first],
                    "links": [{
                        "rel": "next",
                        "href": "https://stac.eodc.eu/api/v1/search?cursor=next",
                        "method": "POST",
                        "body": {"token": "next"},
                    }],
                })
            return FakeResponse({"type": "FeatureCollection", "features": [second], "links": []})

        payload = gfm.build_search_payload()
        items = gfm.fetch_stac_items(payload, opener=opener)
        self.assertEqual([item["id"] for item in items], ["tile-a-1", "tile-a-2"])
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][0].get_method(), "POST")
        self.assertEqual(json.loads(calls[0][0].data.decode("utf-8")), payload)
        self.assertEqual(calls[1][0].get_method(), "POST")
        self.assertEqual(json.loads(calls[1][0].data.decode("utf-8")), {"token": "next"})
        self.assertEqual(calls[0][1], 60)

    def test_duplicate_items_are_deduplicated_by_stac_id(self):
        item = feature("same-item", "2026-01-17T03:00:00Z")

        def opener(request, timeout):
            return FakeResponse({"type": "FeatureCollection", "features": [item, item], "links": []})

        items = gfm.fetch_stac_items(gfm.build_search_payload(), opener=opener)
        self.assertEqual(len(items), 1)

    def test_external_pagination_link_is_rejected(self):
        calls = []

        def opener(request, timeout):
            calls.append(request)
            return FakeResponse({
                "type": "FeatureCollection",
                "features": [],
                "links": [{"rel": "next", "href": "https://evil.example/search"}],
            })

        with self.assertRaisesRegex(ValueError, "outside stac.eodc.eu"):
            gfm.fetch_stac_items(gfm.build_search_payload(), opener=opener)
        self.assertEqual(len(calls), 1)

    def test_report_discloses_catalogue_only_status_and_masks(self):
        items = [
            feature("late", "2026-01-22T03:00:00Z"),
            feature("early", "2026-01-17T03:00:00Z"),
        ]
        report = gfm.build_report(items, "2026-01-07", "2026-01-28")
        self.assertEqual(report["status"], "CATALOGUE_ITEMS_FOUND")
        self.assertEqual(report["summary"]["item_count"], 2)
        self.assertEqual(
            report["summary"]["unique_acquisition_dates"],
            ["2026-01-17", "2026-01-22"],
        )
        self.assertEqual(
            report["summary"]["asset_names"],
            ["ensemble_flood_extent", "exclusion_mask", "reference_water_mask"],
        )
        self.assertFalse(report["summary"]["pixel_coverage_checked"])
        self.assertFalse(report["summary"]["accuracy_metrics_calculated"])
        self.assertIn("exclusion_mask", report["source"]["candidate_assets"])

    def test_empty_catalogue_result_is_a_valid_no_items_report(self):
        report = gfm.build_report([], "2026-01-07", "2026-01-28")
        self.assertEqual(report["status"], "NO_CATALOGUE_ITEMS")
        self.assertEqual(report["summary"]["item_count"], 0)
        self.assertEqual(report["summary"]["unique_acquisition_dates"], [])
        self.assertFalse(report["summary"]["flood_extent_calculated"])

    def test_invalid_stac_datetime_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "Invalid GFM STAC datetime"):
            gfm.build_report([feature("bad-date", "not-a-date")], "2026-01-07", "2026-01-28")


if __name__ == "__main__":
    unittest.main()

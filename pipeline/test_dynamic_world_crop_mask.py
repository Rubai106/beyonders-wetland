"""Offline tests for Dynamic World acquisition and raster evidence normalization."""
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

sys.path.insert(0, str(Path(__file__).resolve().parent))
from download_dynamic_world_crop_mask import (  # noqa: E402
    DynamicWorldError, _normalise_count_geotiff, _normalise_probability_geotiff, _service_account_payload,
    assess_temporal_recency, summarize_acquisition_timestamps, validate_request,
)


class DynamicWorldAcquisitionTests(unittest.TestCase):
    def test_baniachong_request_is_valid(self):
        start, end = validate_request(
            91.3867, 24.3533, 91.4467, 24.4133, "2026-06-17", "2026-10-31", 600, 3,
        )
        self.assertEqual(start, date(2026, 6, 17))
        self.assertEqual(end, date(2026, 10, 31))

    def test_rejects_invalid_bounds_dates_buffer_and_observation_floor(self):
        invalid = [
            lambda: validate_request(91, 25, 90, 26, "2026-06-17", "2026-10-31", 600, 3),
            lambda: validate_request(91, 25, 92, 26, "2026-06-18", "2026-06-17", 600, 3),
            lambda: validate_request(91, 25, 92, 26, "2026-06-17", "2026-06-17", 99, 3),
            lambda: validate_request(91, 25, 92, 26, "2026-06-17", "2026-06-17", 600, 0),
            lambda: validate_request(91, 25, 92, 26, "2026-06-17", "2028-06-17", 600, 3),
        ]
        for call in invalid:
            with self.subTest(call=call), self.assertRaises(DynamicWorldError):
                call()

    def test_scene_granules_are_deduplicated_to_distinct_utc_dates(self):
        values = [
            datetime(2026, 10, 20, 1, tzinfo=timezone.utc),
            datetime(2026, 10, 20, 4, tzinfo=timezone.utc),
            datetime(2026, 10, 21, 1, tzinfo=timezone.utc),
            datetime(2026, 10, 22, 1, tzinfo=timezone.utc),
        ]
        result = summarize_acquisition_timestamps([int(item.timestamp() * 1000) for item in values])
        self.assertEqual(result["scene_record_count"], 4)
        self.assertEqual(result["unique_acquisition_date_count"], 3)
        self.assertEqual(result["acquisition_dates"], ["2026-10-20", "2026-10-21", "2026-10-22"])
        self.assertEqual(result["maximum_gap_between_acquisition_dates_days"], 1)

    def test_empty_catalogue_result_fails_closed(self):
        with self.assertRaisesRegex(DynamicWorldError, "No Dynamic World Sentinel-2 scenes"):
            summarize_acquisition_timestamps([])

    def test_temporal_recency_is_descriptive_and_reports_large_end_gap(self):
        recent = assess_temporal_recency("2026-10-28", "2026-10-31")
        stale = assess_temporal_recency("2026-09-10", "2026-10-31")
        self.assertEqual(recent["status"], "RECENT_WITHIN_18_DAY_WINDOW")
        self.assertEqual(recent["days_from_latest_scene_to_requested_end"], 3)
        self.assertEqual(stale["status"], "STALE_MORE_THAN_18_DAYS_BEFORE_WINDOW_END")
        self.assertEqual(stale["days_from_latest_scene_to_requested_end"], 51)
        self.assertIn("not a validated", stale["interpretation"])

    def test_service_account_secret_validation_does_not_echo_key_material(self):
        with self.assertRaisesRegex(DynamicWorldError, "valid service-account JSON"):
            _service_account_payload("{not-json")
        with self.assertRaisesRegex(DynamicWorldError, "complete Google service-account key"):
            _service_account_payload('{"type":"service_account","private_key":"do-not-print"}')

    def test_probability_geotiff_is_written_with_nodata_mask_and_provenance(self):
        with tempfile.TemporaryDirectory() as temp:
            raw, output = Path(temp) / "raw.tif", Path(temp) / "probability.tif"
            values = np.array([[0.25, 0.75], [-9999.0, 0.50]], dtype=np.float32)
            with rasterio.open(raw, "w", driver="GTiff", height=2, width=2, count=1,
                               dtype="float32", crs="EPSG:6933",
                               transform=from_origin(500000, 2800000, 10, 10)) as ds:
                ds.write(values, 1)
            stats = _normalise_probability_geotiff(
                raw, output, {"DATASET": "GOOGLE/DYNAMICWORLD/V1", "SOURCE_WINDOW_START": "2026-06-17"},
            )
            with rasterio.open(output) as ds:
                self.assertEqual(ds.crs.to_string(), "EPSG:6933")
                self.assertEqual(ds.count, 1)
                self.assertEqual(ds.nodata, -9999)
                self.assertEqual(ds.tags()["DATASET"], "GOOGLE/DYNAMICWORLD/V1")
                self.assertEqual(int((ds.read_masks(1) > 0).sum()), 3)
                self.assertEqual(float(ds.read(1)[0, 0]), 0.25)
            self.assertEqual(stats["valid_probability_pixels"], 3)
            self.assertAlmostEqual(stats["valid_probability_fraction"], 0.75)

    def test_count_geotiff_preserves_zero_counts_and_returns_exact_grid_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            raw, output = Path(temp) / "raw-count.tif", Path(temp) / "count.tif"
            values = np.array([[0, 1], [2, 3]], dtype=np.uint16)
            transform = from_origin(500000, 2800000, 10, 10)
            with rasterio.open(raw, "w", driver="GTiff", height=2, width=2, count=1,
                               dtype="uint16", crs="EPSG:6933", transform=transform) as ds:
                ds.write(values, 1)
            stats = _normalise_count_geotiff(
                raw, output, 3, {"MINIMUM_OBSERVATIONS_PER_PIXEL": "2"},
            )
            with rasterio.open(output) as ds:
                self.assertEqual(ds.crs.to_string(), "EPSG:6933")
                self.assertIsNone(ds.nodata)
                np.testing.assert_array_equal(ds.read(1), values)
                self.assertTrue(np.all(ds.read_masks(1) > 0))
            self.assertEqual(stats["minimum_valid_date_count"], 0)
            self.assertEqual(stats["maximum_valid_date_count"], 3)
            self.assertEqual(stats["pixels_meeting_minimum_observations"], 2)
            self.assertEqual(stats["transform"], [10.0, 0.0, 500000.0, 0.0, -10.0, 2800000.0])

    def test_probability_geotiff_rejects_class_labels_and_coarse_pixels(self):
        with tempfile.TemporaryDirectory() as temp:
            raw, output = Path(temp) / "bad.tif", Path(temp) / "out.tif"
            with rasterio.open(raw, "w", driver="GTiff", height=2, width=2, count=1,
                               dtype="float32", crs="EPSG:6933",
                               transform=from_origin(500000, 2800000, 10, 10)) as ds:
                ds.write(np.array([[0.2, 1.4], [0.3, 0.4]], dtype=np.float32), 1)
            with self.assertRaisesRegex(DynamicWorldError, "outside \\[0, 1\\]"):
                _normalise_probability_geotiff(raw, output, {})
            with rasterio.open(raw, "w", driver="GTiff", height=2, width=2, count=1,
                               dtype="float32", crs="EPSG:6933",
                               transform=from_origin(500000, 2800000, 250, 250)) as ds:
                ds.write(np.ones((2, 2), dtype=np.float32) * 0.7, 1)
            with self.assertRaisesRegex(DynamicWorldError, "finer than SME2 native cells"):
                _normalise_probability_geotiff(raw, output, {})


if __name__ == "__main__":
    unittest.main(verbosity=2)

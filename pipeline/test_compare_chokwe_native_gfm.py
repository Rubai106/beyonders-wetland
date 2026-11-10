"""Offline tests for native-grid Chókwè NISAR/GFM comparison."""
from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

import compare_chokwe_native_gfm as comparison


def layer(data, valid=None):
    values = np.asarray(data)
    return {
        "data": values,
        "valid": np.ones(values.shape, dtype=bool) if valid is None else np.asarray(valid, dtype=bool),
    }


class NativeChokweGfmComparisonTests(unittest.TestCase):
    def test_native_class_overlap_keeps_missing_excluded_and_reference_water_separate(self):
        classification = np.array([[1, 1, 1, 2, 2, 2]], dtype=np.uint8)
        native_valid = np.ones(classification.shape, dtype=bool)
        native_aoi = np.ones(classification.shape, dtype=bool)
        gfm_layers = {
            "ensemble_flood_extent": layer([[1, 1, 0, 1, 0, 1]]),
            "ensemble_likelihood": layer(
                [[80, 70, 30, 55, 65, 90]],
                [[1, 1, 0, 1, 1, 1]],
            ),
            "exclusion_mask": layer([[0, 1, 0, 0, 0, 0]]),
            "reference_water_mask": layer([[0, 0, 0, 2, 0, 0]]),
        }

        open_water = comparison.summarize_native_candidate_class(
            classification, native_valid, native_aoi, gfm_layers, 1, 0.0004
        )
        vegetation = comparison.summarize_native_candidate_class(
            classification, native_valid, native_aoi, gfm_layers, 2, 0.0004
        )

        self.assertEqual(open_water["candidate_pixels_on_native_grid"], 3)
        self.assertEqual(open_water["candidate_pixels_without_common_valid_gfm_data"], 1)
        self.assertEqual(open_water["candidate_pixels_in_gfm_exclusion_mask"], 1)
        self.assertEqual(open_water["eligible_candidate_pixels_after_gfm_masks"], 1)
        self.assertEqual(open_water["gfm_flood_positive_overlap_pixels"], 1)
        self.assertEqual(open_water["fraction_of_eligible_candidates_with_gfm_flood_support"], 1.0)

        self.assertEqual(vegetation["candidate_pixels_on_native_grid"], 3)
        self.assertEqual(vegetation["candidate_pixels_in_gfm_reference_water"], 1)
        self.assertEqual(vegetation["candidate_pixels_in_gfm_permanent_reference_water"], 0)
        self.assertEqual(vegetation["candidate_pixels_in_gfm_seasonal_reference_water"], 1)
        self.assertEqual(vegetation["eligible_candidate_pixels_after_gfm_masks"], 2)
        self.assertEqual(vegetation["eligible_candidates_not_mapped_as_gfm_flood"], 1)
        self.assertEqual(vegetation["gfm_flood_positive_overlap_pixels"], 1)
        self.assertEqual(vegetation["fraction_of_eligible_candidates_with_gfm_flood_support"], 0.5)
        self.assertEqual(vegetation["positive_overlap_gfm_likelihood"]["median"], 90.0)
        self.assertIn("not treated as negative", vegetation["denominator_note"])

    def test_permanent_and_seasonal_reference_water_are_reported_separately(self):
        classification = np.array([[1, 1]], dtype=np.uint8)
        gfm_layers = {
            "ensemble_flood_extent": layer([[1, 1]]),
            "ensemble_likelihood": layer([[80, 75]]),
            "exclusion_mask": layer([[0, 0]]),
            "reference_water_mask": layer([[1, 2]]),
        }
        result = comparison.summarize_native_candidate_class(
            classification,
            np.ones((1, 2), dtype=bool),
            np.ones((1, 2), dtype=bool),
            gfm_layers,
            1,
            0.0004,
        )
        self.assertEqual(result["candidate_pixels_in_gfm_reference_water"], 2)
        self.assertEqual(result["candidate_pixels_in_gfm_permanent_reference_water"], 1)
        self.assertEqual(result["candidate_pixels_in_gfm_seasonal_reference_water"], 1)
        self.assertEqual(result["eligible_candidate_pixels_after_gfm_masks"], 0)
        self.assertEqual(result["gfm_flood_positive_overlap_pixels"], 0)

    def test_native_classification_reader_preserves_valid_zero_class_despite_nodata_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "classification_00.tif"
            values = np.array([[0, 1, 2], [0, 0, 1]], dtype=np.uint8)
            profile = {
                "driver": "GTiff",
                "height": values.shape[0],
                "width": values.shape[1],
                "count": 1,
                "dtype": "uint8",
                "crs": "EPSG:32736",
                "transform": from_origin(500000, 7300000, 10, 10),
                "nodata": 0,
            }
            with rasterio.open(path, "w", **profile) as destination:
                destination.write(values, 1)

            loaded, grid = comparison.read_native_classification(path)

        self.assertEqual(loaded.tolist(), values.tolist())
        self.assertEqual(grid["nodata_metadata"], 0)
        self.assertIs(type(grid["nodata_metadata"]), int)
        self.assertEqual(int(np.count_nonzero(loaded == 0)), 3)
        self.assertEqual(int(np.count_nonzero(loaded == 1)), 2)
        self.assertEqual(int(np.count_nonzero(loaded == 2)), 1)

    def test_nearest_neighbour_resamples_values_and_validity_mask_separately(self):
        source_data = np.arange(9, dtype=np.uint8).reshape((3, 3))
        source_valid = np.ones((3, 3), dtype=bool)
        source_valid[1, 1] = False
        source_layer = {
            "data": source_data,
            "valid": source_valid,
            "transform": from_origin(0, 30, 10, 10),
            "grid": {"crs": "EPSG:32736"},
        }
        native_grid = {
            "shape": (1, 1),
            "transform": from_origin(10, 20, 10, 10),
            "crs": "EPSG:32736",
        }

        sampled = comparison.resample_gfm_layer_to_native(source_layer, native_grid)

        self.assertEqual(int(sampled["data"][0, 0]), 4)
        self.assertFalse(bool(sampled["valid"][0, 0]))

    def test_native_candidate_summary_rejects_grid_shape_mismatch(self):
        classification = np.array([[1, 2]], dtype=np.uint8)
        bad_layers = {
            "ensemble_flood_extent": layer([[1]]),
            "ensemble_likelihood": layer([[80]]),
            "exclusion_mask": layer([[0]]),
            "reference_water_mask": layer([[0]]),
        }
        with self.assertRaisesRegex(ValueError, "share one grid"):
            comparison.summarize_native_candidate_class(
                classification,
                np.ones((1, 2), dtype=bool),
                np.ones((1, 2), dtype=bool),
                bad_layers,
                1,
                0.0004,
            )

    def test_undocumented_valid_gfm_class_fails_closed(self):
        classification = np.array([[1]], dtype=np.uint8)
        bad_layers = {
            "ensemble_flood_extent": layer([[2]]),
            "ensemble_likelihood": layer([[80]]),
            "exclusion_mask": layer([[0]]),
            "reference_water_mask": layer([[0]]),
        }
        with self.assertRaisesRegex(ValueError, "undocumented valid values"):
            comparison.summarize_native_candidate_class(
                classification,
                np.ones((1, 1), dtype=bool),
                np.ones((1, 1), dtype=bool),
                bad_layers,
                1,
                0.0004,
            )

    def test_recovery_artifact_root_must_resolve_exactly_one_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            nested = root / "runs" / "abc"
            nested.mkdir(parents=True)
            (nested / "recovery_manifest.json").write_text("{}", encoding="utf-8")
            self.assertEqual(comparison.resolve_recovery_run_dir(root), nested.resolve())

            another = root / "runs" / "def"
            another.mkdir(parents=True)
            (another / "recovery_manifest.json").write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "exactly one"):
                comparison.resolve_recovery_run_dir(root)

    def test_recovery_artifact_hash_verification_detects_changed_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "classification_00.tif"
            path.write_bytes(b"native-raster-fixture")
            expected = {
                "classification_00.tif": {
                    "bytes": path.stat().st_size,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
            }
            comparison._verify_hash_entries(root, expected, "fixture")
            path.write_bytes(b"tampered-raster")
            with self.assertRaisesRegex(ValueError, "checksum/size mismatch"):
                comparison._verify_hash_entries(root, expected, "fixture")


if __name__ == "__main__":
    unittest.main()

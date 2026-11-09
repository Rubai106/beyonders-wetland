"""Offline tests for the guarded Chókwè native-raster recovery entry point."""
import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from main import _not_run_reference
from recover_chokwe_native import (
    EXPECTED_BOUNDS,
    SOURCE_BASELINE_SCENE,
    SOURCE_EVENT_SCENE,
    build_recovery_config,
    inspect_native_run,
    load_source_package,
)


class ChokweNativeRecoveryChecks(unittest.TestCase):
    def test_published_source_package_is_pinned_and_consistent(self):
        source = load_source_package()
        self.assertEqual(source["manifest"]["run_id"], "ec8fa5ee15ae41d1aa89f930f2b47e36")
        self.assertEqual(source["manifest"]["product"], "NISAR_L2_GCOV_BETA_V1")
        self.assertEqual(source["manifest"]["frequency"], "frequencyA")
        self.assertEqual(source["manifest"]["baseline_scene"], SOURCE_BASELINE_SCENE)
        self.assertEqual(source["observation"]["scene_name"], SOURCE_EVENT_SCENE)
        self.assertEqual(source["boundary_bounds"], EXPECTED_BOUNDS)
        self.assertEqual(source["manifest"]["reference_check_status"], "INCONCLUSIVE")

    def test_not_run_reference_reason_distinguishes_demo_from_real(self):
        demo = _not_run_reference("demo")
        real = _not_run_reference("real")
        self.assertEqual(demo["status"], "NOT_RUN")
        self.assertIn("simulated run", demo["reason"])
        self.assertEqual(real["status"], "NOT_RUN")
        self.assertIn("real-data run", real["reason"])
        self.assertNotIn("simulated", real["reason"])
        self.assertFalse(real["reference_validated"])

    def test_config_uses_exact_granules_and_published_method(self):
        source = load_source_package()
        config = build_recovery_config(source)
        self.assertEqual(config["nisar"]["selected_scene_names"], [
            SOURCE_BASELINE_SCENE, SOURCE_EVENT_SCENE,
        ])
        self.assertEqual(config["nisar"]["temporal"], ["2026-01-05", "2026-01-17"])
        self.assertEqual(config["nisar"]["product"], "NISAR_L2_GCOV_BETA_V1")
        self.assertEqual(config["nisar"]["frequency"], "frequencyA")
        self.assertEqual(config["processing"]["minimum_region_pixels"], 50)
        self.assertAlmostEqual(config["processing"]["minimum_valid_fraction"], 0.85)
        self.assertAlmostEqual(config["processing"]["base_threshold_db"], 2.5)
        self.assertAlmostEqual(config["processing"]["open_water_delta_hh"], -2.5)
        self.assertAlmostEqual(config["processing"]["vegetated_delta_hh"], 2.5)
        self.assertAlmostEqual(config["processing"]["vegetated_delta_hv_max"], 1.5)
        self.assertFalse(config["validation"]["use_reference"])

    def _write_raster(
        self,
        path: Path,
        values: np.ndarray,
        *,
        dtype: str,
        nodata,
        transform=None,
    ) -> None:
        transform = transform or from_origin(500000, 7300000, 10, 10)
        profile = {
            "driver": "GTiff",
            "height": values.shape[0],
            "width": values.shape[1],
            "count": 1,
            "dtype": dtype,
            "crs": "EPSG:32736",
            "transform": transform,
            "nodata": nodata,
            "compress": "deflate",
        }
        with rasterio.open(path, "w", **profile) as destination:
            destination.write(values.astype(dtype), 1)

    def _make_native_fixture(
        self, folder: Path, *, shifted_after_hv=False, bad_class=False, exclude_non_candidate=False
    ):
        classes = np.array([[1, 0, 2], [0, 1, 0]], dtype=np.uint8)
        if bad_class:
            classes[0, 0] = 3
        class_path = folder / "classification_00.tif"
        self._write_raster(class_path, classes, dtype="uint8", nodata=0)

        float_values = np.array([[0.12, 0.14, 0.16], [0.18, 0.20, 0.22]], dtype=np.float32)
        names = {
            "before_hh": "before_hh_masked.tif",
            "after_hh": "after_00_hh_masked.tif",
            "before_hv": "before_hv_masked.tif",
            "after_hv": "after_00_hv_masked.tif",
        }
        for key, filename in names.items():
            transform = from_origin(500001, 7300000, 10, 10) if shifted_after_hv and key == "after_hv" else None
            self._write_raster(
                folder / filename,
                float_values,
                dtype="float32",
                nodata=np.nan,
                transform=transform,
            )
        wetland_values = np.ones((2, 3), dtype=np.uint8)
        if exclude_non_candidate:
            wetland_values[1, 2] = 0
        self._write_raster(
            folder / "wetland_mask.tif",
            wetland_values,
            dtype="uint8",
            nodata=None,
        )
        return {
            "classification_file": "classification_00.tif",
            "rasters": names,
        }

    def test_native_grid_summary_preserves_classes_and_valid_denominator(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            observation = self._make_native_fixture(folder)
            summary = inspect_native_run(folder, observation)
        self.assertEqual(summary["grid"]["crs"], "EPSG:32736")
        self.assertEqual(summary["grid"]["width"], 3)
        self.assertEqual(summary["grid"]["height"], 2)
        self.assertEqual(summary["common_valid_native_pixel_count"], 6)
        self.assertEqual(summary["valid_no_candidate_pixel_count"], 3)
        self.assertEqual(summary["valid_open_water_candidate_pixel_count"], 2)
        self.assertEqual(summary["valid_vegetated_candidate_pixel_count"], 1)
        self.assertAlmostEqual(summary["native_pixel_area_km2"], 0.0001)

    def test_valid_denominator_is_restricted_to_aoi_mask(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            observation = self._make_native_fixture(folder, exclude_non_candidate=True)
            summary = inspect_native_run(folder, observation)
        self.assertEqual(summary["wetland_mask_pixel_count"], 5)
        self.assertEqual(summary["common_valid_native_pixel_count"], 5)
        self.assertEqual(summary["valid_no_candidate_pixel_count"], 2)

    def test_candidate_outside_aoi_mask_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            observation = self._make_native_fixture(folder)
            outside = np.ones((2, 3), dtype=np.uint8)
            outside[0, 2] = 0
            self._write_raster(
                folder / "wetland_mask.tif",
                outside,
                dtype="uint8",
                nodata=None,
            )
            with self.assertRaisesRegex(ValueError, "outside the published AOI mask"):
                inspect_native_run(folder, observation)

    def test_misaligned_native_input_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            observation = self._make_native_fixture(folder, shifted_after_hv=True)
            with self.assertRaisesRegex(ValueError, "georeferencing differs"):
                inspect_native_run(folder, observation)

    def test_undocumented_class_code_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            observation = self._make_native_fixture(folder, bad_class=True)
            with self.assertRaisesRegex(ValueError, "undocumented class code"):
                inspect_native_run(folder, observation)

    def test_missing_native_input_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            observation = self._make_native_fixture(folder)
            (folder / "after_00_hv_masked.tif").unlink()
            with self.assertRaises(FileNotFoundError):
                inspect_native_run(folder, observation)


if __name__ == "__main__":
    unittest.main()

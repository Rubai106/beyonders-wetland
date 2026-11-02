"""Focused offline checks for the SME2 quality/publish contract.

Synthetic arrays/HDF5 are test fixtures only. They are never written to public/agriculture.
"""
import importlib.util
import io
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

import h5py
import numpy as np
import rasterio
from rasterio.transform import from_origin

from agriculture_sme2 import (
    AgricultureError, COLLECTION, CMR_PAGE_SIZE, quality_mask, safe_run_id, validate_aoi_dates, _cmr_search,
    parse_granule_date, granule_signature, _looks_like_sme2_hdf5, _summary, _matched_support,
    _baseline_layers, _epsg_from_handle, _validate_moisture_units, surface_flag_diagnostics,
    _align_crop_probability_mask, _crop_support_audit,
)


class AgricultureSME2Tests(unittest.TestCase):
    def test_cmr_truncation_fails_closed(self):
        class Response(io.BytesIO):
            headers = {"CMR-Hits": str(CMR_PAGE_SIZE + 1)}
        response = Response(b'{"feed":{"entry":[]}}')
        with patch("agriculture_sme2.urllib.request.urlopen", return_value=response):
            with self.assertRaisesRegex(AgricultureError, "Narrow the AOI or date range"):
                _cmr_search({"west": 90, "south": 24, "east": 91, "north": 25}, "2026-06-17", "2026-10-29")

    def test_uint8_retrieval_bitfield_is_numpy2_safe(self):
        moisture = np.full((2, 3), 0.25)
        uncertainty = np.full((2, 3), 0.03)
        retrieval = np.array([[15, 14, 31], [255, 15, 15]], dtype=np.uint8)
        surface = np.array([[0, 0, 0], [0, 1, 0]], dtype=np.uint8)
        result = quality_mask(moisture, uncertainty, retrieval, surface)
        np.testing.assert_array_equal(result, [[True, False, False], [False, False, True]])

    def test_fractional_and_nonfinite_flags_are_not_accepted(self):
        moisture = np.full((1, 4), 0.25)
        uncertainty = np.full((1, 4), 0.02)
        retrieval = np.array([[15.0, 15.5, np.nan, 271.0]])
        surface = np.array([[0.0, 0.0, 0.0, 0.0]])
        result = quality_mask(moisture, uncertainty, retrieval, surface)
        np.testing.assert_array_equal(result, [[True, False, False, False]])

    def test_surface_quality_must_be_zero(self):
        shape = (1, 4)
        result = quality_mask(np.full(shape, .2), np.full(shape, .01),
                              np.full(shape, 15, dtype=np.uint8),
                              np.array([[0, 1, 2, 255]], dtype=np.uint8))
        np.testing.assert_array_equal(result, [[True, False, False, False]])

    def test_surface_flag_diagnostics_decode_overlapping_documented_bits(self):
        flags = np.array([[0, 1, 4, 128, 3, 256, -9999, np.nan, 1.5]], dtype="float64")
        aoi = np.ones(flags.shape, dtype=bool)
        result = surface_flag_diagnostics(flags, aoi, [-9999])
        self.assertEqual(result["method"], "NISAR_SME2_SURFACE_QUALITY_FLAG_BITS")
        self.assertEqual(result["total_aoi_pixels"], 9)
        self.assertEqual(result["encoded_pixels"], 5)
        self.assertEqual(result["unflagged_pixels"], 1)
        self.assertEqual(result["flagged_pixels"], 4)
        self.assertEqual(result["fill_pixels"], 1)
        self.assertEqual(result["invalid_pixels"], 2)
        self.assertEqual(result["unsupported_encoding_pixels"], 1)
        self.assertEqual(result["flags"]["static_water"], 2)
        self.assertEqual(result["flags"]["urban_area"], 1)
        self.assertEqual(result["flags"]["precipitation"], 1)
        self.assertEqual(result["flags"]["dense_vegetation"], 1)
        self.assertGreater(sum(result["flags"].values()), result["flagged_pixels"])
        self.assertEqual(result["flag_combinations"], [
            {"mask": 1, "pixels": 1},
            {"mask": 3, "pixels": 1},
            {"mask": 4, "pixels": 1},
            {"mask": 128, "pixels": 1},
        ])
        self.assertEqual(sum(item["pixels"] for item in result["flag_combinations"]), result["flagged_pixels"])

    def test_surface_flag_combinations_are_exclusive_and_sorted_by_count(self):
        values = np.array([[1, 3, 3, 1, 5, 0]], dtype="float64")
        result = surface_flag_diagnostics(values, np.ones(values.shape, dtype=bool))
        self.assertEqual(result["flag_combinations"], [
            {"mask": 1, "pixels": 2},
            {"mask": 3, "pixels": 2},
            {"mask": 5, "pixels": 1},
        ])
        self.assertEqual(sum(item["pixels"] for item in result["flag_combinations"]), 5)
        self.assertEqual(result["flags"]["static_water"], 5)
        self.assertEqual(result["flags"]["urban_area"], 2)
        self.assertEqual(result["flags"]["precipitation"], 1)

    def test_surface_flag_diagnostics_respect_aoi_and_reject_shape_mismatch(self):
        values = np.array([[0, 1, 2]], dtype="float64")
        aoi = np.array([[True, False, True]])
        result = surface_flag_diagnostics(values, aoi)
        self.assertEqual(result["total_aoi_pixels"], 2)
        self.assertEqual(result["unflagged_pixels"], 1)
        self.assertEqual(result["flags"]["urban_area"], 1)
        with self.assertRaisesRegex(AgricultureError, "matching two-dimensional arrays"):
            surface_flag_diagnostics(values, np.ones((1, 2), dtype=bool))

    def _crop_reference_scene(self):
        return {
            "aoi_mask": np.ones((2, 2), dtype=bool),
            "epsg": 6933,
            "transform": from_origin(0, 400, 200, 200),
        }

    def test_crop_mask_area_averages_fine_probability_cells_to_native_sme2_cells(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "crop-probability.tif"
            columns = np.arange(40).reshape(1, 40)
            values = np.broadcast_to(np.where((columns % 20) < 10, 0.9, 0.1), (40, 40)).astype("float32")
            with rasterio.open(
                path, "w", driver="GTiff", height=40, width=40, count=1,
                dtype="float32", crs="EPSG:6933", transform=from_origin(0, 400, 10, 10),
            ) as dataset:
                dataset.write(values, 1)

            weights, source_coverage, metadata = _align_crop_probability_mask(
                path, self._crop_reference_scene(), "Dynamic World crops probability",
                "2026-10-20", probability_threshold=0.5, minimum_cell_coverage=0.8,
            )
            np.testing.assert_allclose(weights, np.full((2, 2), 0.5), atol=0.01)
            np.testing.assert_allclose(source_coverage, np.ones((2, 2)), atol=0.01)
            self.assertEqual(metadata["method"], "AREA_WEIGHTED_INDEPENDENT_CROP_MASK_TO_SME2_NATIVE_GRID_V1")
            self.assertEqual(metadata["mask_covered_cells"], 4)
            self.assertAlmostEqual(metadata["mask_coverage_fraction"], 1.0)
            self.assertAlmostEqual(metadata["crop_area_equivalent_pixels"], 2.0, places=2)
            self.assertEqual(metadata["source_date"], "2026-10-20")
            self.assertEqual(metadata["source_sha256"], __import__("hashlib").sha256(path.read_bytes()).hexdigest())

    def test_crop_mask_nodata_is_not_treated_as_non_crop(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "crop-with-gap.tif"
            values = np.full((40, 40), 0.9, dtype="float32")
            values[:20, :20] = -9999
            with rasterio.open(
                path, "w", driver="GTiff", height=40, width=40, count=1,
                dtype="float32", crs="EPSG:6933", transform=from_origin(0, 400, 10, 10),
                nodata=-9999,
            ) as dataset:
                dataset.write(values, 1)

            weights, source_coverage, metadata = _align_crop_probability_mask(
                path, self._crop_reference_scene(), "Independent crop mask",
            )
            self.assertEqual(metadata["mask_covered_cells"], 3)
            self.assertAlmostEqual(metadata["mask_coverage_fraction"], 0.75)
            self.assertAlmostEqual(source_coverage[0, 0], 0.0)
            np.testing.assert_allclose(source_coverage[1, :], 1.0, atol=0.01)
            np.testing.assert_allclose(source_coverage[0, 1], 1.0, atol=0.01)
            self.assertEqual(weights[0, 0], 0)
            np.testing.assert_allclose(weights[0, 1:], 1.0, atol=0.01)
            np.testing.assert_allclose(weights[1, :], 1.0, atol=0.01)

    def test_crop_mask_rejects_coarse_source_instead_of_upsampling_it(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "coarse-mask.tif"
            with rasterio.open(
                path, "w", driver="GTiff", height=2, width=2, count=1,
                dtype="float32", crs="EPSG:6933", transform=from_origin(-200, 600, 400, 400),
            ) as dataset:
                dataset.write(np.ones((2, 2), dtype="float32"), 1)
            with self.assertRaisesRegex(AgricultureError, "coarser than the SME2 native grid"):
                _align_crop_probability_mask(path, self._crop_reference_scene(), "Coarse mask")

    def _crop_scene(self, date, moisture, valid):
        values = np.asarray(moisture, dtype="float64")
        return {
            "date": date,
            "moisture": values,
            "uncertainty": np.full(values.shape, 0.03, dtype="float64"),
            "valid": np.asarray(valid, dtype=bool),
            "aoi_mask": np.ones(values.shape, dtype=bool),
        }

    def test_crop_area_audit_uses_fractional_weights_and_strict_all_date_intersection(self):
        weights = np.array([[1.0, 0.5], [0.25, 0.0]], dtype="float64")
        scenes = [
            self._crop_scene("2026-06-20", [[0.20, 0.30], [0.40, 0.50]], [[1, 1], [1, 0]]),
            self._crop_scene("2026-06-25", [[0.22, 0.32], [0.42, 0.52]], [[0, 0], [1, 0]]),
            self._crop_scene("2026-06-30", [[0.24, 0.34], [0.44, 0.54]], [[0, 0], [1, 0]]),
        ]
        result, common = _crop_support_audit(
            scenes, weights, {"mask_coverage_fraction": 1.0, "source": "test fixture"},
        )
        self.assertAlmostEqual(result["crop_area_equivalent_pixels"], 1.75)
        self.assertEqual(result["crop_supported_cells"], 3)
        self.assertEqual(result["common_support"]["status"], "INCONCLUSIVE_COVERAGE")
        self.assertAlmostEqual(result["common_support"]["valid_crop_area_equivalent_pixels"], 0.25)
        self.assertAlmostEqual(result["common_support"]["valid_crop_area_fraction"], 0.25 / 1.75)
        np.testing.assert_array_equal(common, [[False, False], [True, False]])
        self.assertAlmostEqual(result["observations"][0]["valid_crop_area_fraction"], 1.0)
        self.assertAlmostEqual(result["observations"][1]["valid_crop_area_fraction"], 0.25 / 1.75)
        self.assertAlmostEqual(
            result["common_support"]["observations"][0]["weighted_soil_moisture"]["median"], 0.40,
        )

    def test_insufficient_mask_coverage_is_not_misreported_as_no_crop(self):
        scenes = [
            self._crop_scene("2026-06-20", np.full((2, 2), 0.2), np.ones((2, 2), dtype=bool)),
            self._crop_scene("2026-06-25", np.full((2, 2), 0.3), np.ones((2, 2), dtype=bool)),
        ]
        metadata = {"mask_coverage_fraction": 0.1, "source": "mostly missing mask"}
        result, common = _crop_support_audit(scenes, np.zeros((2, 2)), metadata)
        self.assertEqual(result["common_support"]["status"], "INSUFFICIENT_MASK_COVERAGE")
        self.assertEqual(result["observations"][0]["status"], "INSUFFICIENT_MASK_COVERAGE")
        self.assertEqual(result["common_support"]["observations"], [])
        self.assertFalse(common.any())

    def test_crop_area_audit_reports_no_crop_support_without_fabricating_summaries(self):
        scenes = [
            self._crop_scene("2026-06-20", np.full((2, 2), 0.2), np.ones((2, 2), dtype=bool)),
            self._crop_scene("2026-06-25", np.full((2, 2), 0.3), np.ones((2, 2), dtype=bool)),
        ]
        result, common = _crop_support_audit(
            scenes, np.zeros((2, 2)), {"mask_coverage_fraction": 1.0, "source": "empty test mask"},
        )
        self.assertEqual(result["common_support"]["status"], "NO_CROP_SUPPORT")
        self.assertEqual(result["common_support"]["observations"], [])
        self.assertFalse(common.any())
        self.assertIsNone(result["observations"][0]["weighted_soil_moisture"])

    def test_moisture_and_uncertainty_are_screened(self):
        moisture = np.array([[.01, .2, .61, .3]])
        uncertainty = np.array([[.01, np.nan, .01, -1]])
        result = quality_mask(moisture, uncertainty, np.full((1, 4), 15), np.zeros((1, 4)))
        self.assertFalse(result.any())

    def _matched_scene(self, date, values, valid, aoi=None):
        values = np.asarray(values, dtype="float64")
        mask = np.asarray(valid, dtype=bool)
        return {
            "date": date,
            "moisture": values,
            "uncertainty": np.full(values.shape, 0.03, dtype="float64"),
            "valid": mask,
            "aoi_mask": np.ones(values.shape, dtype=bool) if aoi is None else np.asarray(aoi, dtype=bool),
        }

    def test_matched_support_uses_one_exact_all_date_pixel_cohort(self):
        aoi = np.ones((2, 2), dtype=bool)
        scenes = [
            self._matched_scene("2026-06-20", [[.20, .21], [.22, .23]], [[1, 1], [0, 0]], aoi),
            self._matched_scene("2026-06-25", [[.24, .25], [.26, .27]], [[1, 0], [1, 0]], aoi),
            self._matched_scene("2026-06-30", [[.28, .29], [.30, .31]], [[1, 0], [0, 1]], aoi),
            self._matched_scene("2026-07-05", [[.32, .33], [.34, .35]], [[1, 1], [1, 0]], aoi),
        ]
        result, common = _matched_support(scenes)
        self.assertEqual(result["method"], "ALL_DATE_VALID_PIXEL_INTERSECTION")
        self.assertEqual(result["status"], "COMPARABLE")
        self.assertEqual(result["valid_pixels"], 1)
        self.assertEqual(result["total_pixels"], 4)
        self.assertEqual(result["valid_fraction"], .25)
        np.testing.assert_array_equal(common, [[True, False], [False, False]])
        self.assertEqual([item["date"] for item in result["observations"]], [scene["date"] for scene in scenes])
        self.assertEqual([item["median"] for item in result["observations"]], [.20, .24, .28, .32])
        self.assertTrue(all(item["valid_pixels"] == 1 and item["total_pixels"] == 4 for item in result["observations"]))

    def test_matched_support_marks_non_empty_below_floor_cohort_inconclusive(self):
        aoi = np.ones((10, 10), dtype=bool)
        valid = np.zeros((10, 10), dtype=bool)
        valid[0, 0] = True
        scenes = [
            self._matched_scene("2026-06-20", np.full((10, 10), .20), valid, aoi),
            self._matched_scene("2026-06-25", np.full((10, 10), .24), valid, aoi),
            self._matched_scene("2026-06-30", np.full((10, 10), .28), valid, aoi),
            self._matched_scene("2026-07-05", np.full((10, 10), .32), valid, aoi),
        ]
        result, common = _matched_support(scenes)
        self.assertEqual(result["status"], "INCONCLUSIVE_COVERAGE")
        self.assertEqual(result["valid_pixels"], 1)
        self.assertEqual(result["valid_fraction"], .01)
        self.assertEqual(len(result["observations"]), 4)
        self.assertTrue(common[0, 0])
        self.assertEqual([item["median"] for item in result["observations"]], [.20, .24, .28, .32])

    def test_matched_support_reports_zero_common_pixels_without_filling(self):
        aoi = np.ones((2, 2), dtype=bool)
        scenes = [
            self._matched_scene("2026-06-20", np.full((2, 2), .2), [[1, 0], [0, 0]], aoi),
            self._matched_scene("2026-06-25", np.full((2, 2), .3), [[0, 1], [0, 0]], aoi),
            self._matched_scene("2026-06-30", np.full((2, 2), .4), [[0, 0], [1, 0]], aoi),
            self._matched_scene("2026-07-05", np.full((2, 2), .5), [[0, 0], [0, 1]], aoi),
        ]
        result, common = _matched_support(scenes)
        self.assertEqual(result["status"], "NO_COMMON_PIXELS")
        self.assertEqual(result["valid_pixels"], 0)
        self.assertEqual(result["valid_fraction"], 0)
        self.assertEqual(result["observations"], [])
        self.assertFalse(common.any())

    def test_matched_support_refuses_different_aoi_pixel_footprints(self):
        aoi = np.ones((2, 2), dtype=bool)
        scenes = [
            self._matched_scene("2026-06-20", np.full((2, 2), .2), np.ones((2, 2), dtype=bool), aoi),
            self._matched_scene("2026-06-25", np.full((2, 2), .3), np.ones((2, 2), dtype=bool), np.array([[1, 1], [1, 0]])),
        ]
        with self.assertRaisesRegex(AgricultureError, "same AOI pixel footprint"):
            _matched_support(scenes)

    def test_summary_coverage_uses_all_aoi_pixels_as_denominator(self):
        values = np.array([[.2, .3], [.4, .5]])
        valid = np.array([[True, False], [False, True]])
        summary = _summary(values, valid, np.full((2, 2), .02), np.ones((2, 2), dtype=bool))
        self.assertEqual(summary["valid_fraction"], .5)
        self.assertEqual(summary["valid_pixels"], 2)
        self.assertEqual(summary["total_pixels"], 4)

    def test_retrieval_flag_above_uint8_range_is_rejected(self):
        result = quality_mask(np.full((1, 1), .2), np.full((1, 1), .01),
                              np.array([[271.0]]), np.zeros((1, 1)))
        self.assertFalse(result[0, 0])

    def test_fill_mask_is_applied(self):
        mask = quality_mask(np.full((1, 2), .2), np.full((1, 2), .01),
                            np.full((1, 2), 15), np.zeros((1, 2)),
                            np.array([[True, False]]))
        np.testing.assert_array_equal(mask, [[True, False]])

    def test_shape_mismatch_fails_closed(self):
        with self.assertRaises(AgricultureError):
            quality_mask(np.ones((2, 2)), np.ones((2, 2)), np.ones((2, 2)), np.ones((1, 4)))

    def test_safe_run_ids(self):
        self.assertEqual(safe_run_id("agri-pilot-01"), "agri-pilot-01")
        for value in ("../bad", "UpperCase", "a b", "", "x" * 41):
            with self.assertRaises(AgricultureError):
                safe_run_id(value)

    def test_aoi_and_date_validation(self):
        validate_aoi_dates({"west": 90, "south": 24, "east": 91, "north": 25}, "2026-06-17", "2026-10-29")
        for aoi, start, end in [
            ({"west": 91, "south": 24, "east": 90, "north": 25}, "2026-06-17", "2026-10-29"),
            ({"west": 90, "south": -91, "east": 91, "north": 25}, "2026-06-17", "2026-10-29"),
            ({"west": 90, "south": 24, "east": 91, "north": 25}, "2026-06-16", "2026-10-29"),
            ({"west": 90, "south": 24, "east": 91, "north": 25}, "2026-10-29", "2026-06-17"),
        ]:
            with self.assertRaises(AgricultureError):
                validate_aoi_dates(aoi, start, end)

    def test_cmr_filename_date_and_release_contract(self):
        title = "NISAR_L3_PR_SME2_025_171_D_066_4005_DHDH_A_20260720T013930_20260720T014005_P05023_N_F_J_001.h5"
        self.assertEqual(parse_granule_date(title, {}), "2026-07-20")
        signature = granule_signature(title, {"OrbitDirection": "Descending", "TrackNumber": "171", "FrameNumber": "66"})
        self.assertEqual(signature["release"], "P05023")
        self.assertEqual(signature["track"], "171")
        self.assertEqual(signature["direction"], "D")
        self.assertEqual(signature["frame"], "066")
        self.assertEqual(signature["bandwidth"], "4005")
        self.assertEqual(signature["polarization"], "DHDH")
        self.assertEqual(signature["frequency"], "A")

    def test_metadata_conflict_with_granule_name_is_rejected(self):
        title = "NISAR_L3_PR_SME2_025_171_D_066_4005_DHDH_A_20260720T013930_20260720T014005_P05023_N_F_J_001.h5"
        with self.assertRaisesRegex(AgricultureError, "track metadata conflicts"):
            granule_signature(title, {"TrackNumber": "172"})

    def test_old_release_is_rejected(self):
        title = "NISAR_L3_PR_SME2_025_171_D_066_4005_DHDH_A_20260720T013930_20260720T014005_P05022_N_F_J_001.h5"
        with self.assertRaises(AgricultureError):
            granule_signature(title, {})

    def _make_baseline_hdf5(self, path: Path, surface_in_ancillary: bool = False):
        with h5py.File(path, "w") as handle:
            grids = handle.create_group("/science/LSAR/SME2/grids")
            grids.create_dataset("xCoordinates", data=np.arange(5, dtype="float64") * 200)
            grids.create_dataset("yCoordinates", data=800 - np.arange(4, dtype="float64") * 200)
            grids.create_dataset("projection", data=np.int32(6933))
            moisture = grids.create_dataset("soilMoisture", data=np.full((4, 5), 0.20, dtype="float32"))
            moisture.attrs["units"] = "m^3/m^3"
            uncertainty = grids.create_dataset("soilMoistureUncertainty", data=np.full((4, 5), 0.03, dtype="float32"))
            uncertainty.attrs["units"] = "m^3 m^-3"
            grids.create_dataset("retrievalQualityFlag", data=np.full((4, 5), 15, dtype="int16"))
            if surface_in_ancillary:
                surface_group = grids.create_group("ancillaryData")
                surface_group.create_dataset("surfaceQualityFlag", data=np.zeros((4, 5), dtype="int16"))
            else:
                grids.create_dataset("surfaceQualityFlag", data=np.zeros((4, 5), dtype="int16"))

            # These duplicate basenames represent algorithm candidates and must
            # never replace the baseline layers used by the application.
            candidate = grids.create_group("algorithmCandidates").create_group("DSG")
            candidate.create_dataset("soilMoisture", data=np.full((4, 5), 0.59, dtype="float32"))
            candidate.create_dataset("soilMoistureUncertainty", data=np.full((4, 5), 0.18, dtype="float32"))
            candidate.create_dataset("retrievalQualityFlag", data=np.zeros((4, 5), dtype="int16"))

    def test_hdf5_hierarchy_uses_root_baseline_not_algorithm_candidates(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "fixture.h5"
            self._make_baseline_hdf5(path, surface_in_ancillary=False)
            self.assertTrue(_looks_like_sme2_hdf5(path))
            with h5py.File(path, "r") as handle:
                layers = _baseline_layers(handle)
                self.assertEqual(layers["soilMoisture"].name, "/science/LSAR/SME2/grids/soilMoisture")
                self.assertEqual(layers["soilMoistureUncertainty"].name, "/science/LSAR/SME2/grids/soilMoistureUncertainty")
                self.assertEqual(layers["retrievalQualityFlag"].name, "/science/LSAR/SME2/grids/retrievalQualityFlag")
                self.assertEqual(layers["surfaceQualityFlag"].name, "/science/LSAR/SME2/grids/surfaceQualityFlag")
                self.assertAlmostEqual(float(layers["soilMoisture"][0, 0]), 0.20, places=6)
                self.assertEqual(_epsg_from_handle(handle, np.arange(5), np.arange(4)), 6933)

    def test_surface_quality_flag_release_location_fallback(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "fixture.h5"
            self._make_baseline_hdf5(path, surface_in_ancillary=True)
            with h5py.File(path, "r") as handle:
                layers = _baseline_layers(handle)
                self.assertEqual(layers["surfaceQualityFlag"].name, "/science/LSAR/SME2/grids/ancillaryData/surfaceQualityFlag")

    def test_moisture_units_are_normalized_and_verified(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "units.h5"
            with h5py.File(path, "w") as handle:
                good = handle.create_dataset("good", data=np.ones((1, 1)))
                good.attrs["units"] = "meter^3 / meter^3"
                _validate_moisture_units(good, "soilMoisture")
                missing = handle.create_dataset("missing", data=np.ones((1, 1)))
                with self.assertRaisesRegex(AgricultureError, "has no units attribute"):
                    _validate_moisture_units(missing, "soilMoisture")
                bad = handle.create_dataset("bad", data=np.ones((1, 1)))
                bad.attrs["units"] = "dB"
                with self.assertRaisesRegex(AgricultureError, "not recognized"):
                    _validate_moisture_units(bad, "soilMoisture")

    def test_algorithm_candidate_only_file_is_not_accepted_as_baseline(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "candidate-only.h5"
            with h5py.File(path, "w") as handle:
                group = handle.create_group("/science/LSAR/SME2/grids/algorithmCandidates/DSG")
                for name in ("soilMoisture", "soilMoistureUncertainty", "retrievalQualityFlag", "surfaceQualityFlag"):
                    group.create_dataset(name, data=np.ones((4, 5), dtype="float32"))
            self.assertFalse(_looks_like_sme2_hdf5(path))


if __name__ == "__main__":
    unittest.main(verbosity=2)

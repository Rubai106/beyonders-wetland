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

from agriculture_sme2 import (
    AgricultureError, COLLECTION, CMR_PAGE_SIZE, quality_mask, safe_run_id, validate_aoi_dates, _cmr_search,
    parse_granule_date, granule_signature, _looks_like_sme2_hdf5, _summary, _matched_support,
    _baseline_layers, _epsg_from_handle, _validate_moisture_units,
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

    def test_matched_support_reports_below_floor_without_expanding_cohort(self):
        aoi = np.ones((2, 2), dtype=bool)
        scenes = [
            self._matched_scene("2026-06-20", [[.20, .21], [.22, .23]], [[1, 1], [0, 0]], aoi),
            self._matched_scene("2026-06-25", [[.24, .25], [.26, .27]], [[1, 0], [1, 0]], aoi),
            self._matched_scene("2026-06-30", [[.28, .29], [.30, .31]], [[1, 0], [0, 1]], aoi),
            self._matched_scene("2026-07-05", [[.32, .33], [.34, .35]], [[1, 1], [1, 0]], aoi),
        ]
        scenes[0]["valid"][0, 0] = False
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

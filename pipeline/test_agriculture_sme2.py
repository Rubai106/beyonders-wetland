"""Focused offline checks for the SME2 quality/publish contract.

Synthetic arrays/HDF5 are test fixtures only. They are never written to public/agriculture.
"""
import importlib.util
import tempfile
import unittest
from pathlib import Path

import h5py
import numpy as np

from agriculture_sme2 import (
    AgricultureError, COLLECTION, quality_mask, safe_run_id, validate_aoi_dates,
    parse_granule_date, granule_signature, _looks_like_sme2_hdf5,
)


class AgricultureSME2Tests(unittest.TestCase):
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
        title = "NISAR_L3_PR_SME2_TRACK034_ASC_FRAME120_20260620T000000_P05023_A.h5"
        self.assertEqual(parse_granule_date(title, {}), "2026-06-20")
        signature = granule_signature(title, {"OrbitDirection": "Ascending", "TrackNumber": "034", "FrameNumber": "120"})
        self.assertEqual(signature["release"], "P05023")
        self.assertEqual(signature["direction"], "A")

    def test_old_release_is_rejected(self):
        title = "NISAR_L3_PR_SME2_TRACK034_ASC_FRAME120_20260620T000000_P05022_A.h5"
        with self.assertRaises(AgricultureError):
            granule_signature(title, {"OrbitDirection": "Ascending"})

    def test_hdf5_hierarchy_fixture_is_test_only(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "fixture.h5"
            with h5py.File(path, "w") as handle:
                group = handle.create_group("/science/LSAR/SME2/grids/frequencyA")
                for name in ("soilMoisture", "soilMoistureUncertainty", "retrievalQualityFlag", "surfaceQualityFlag"):
                    group.create_dataset(name, data=np.ones((4, 5), dtype=np.uint8))
            self.assertTrue(_looks_like_sme2_hdf5(path))


if __name__ == "__main__":
    unittest.main(verbosity=2)

"""Focused offline checks for the SME2 quality/publish contract.

Synthetic arrays/HDF5 are test fixtures only. They are never written to public/agriculture.
"""
import hashlib
import importlib.util
import json
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
    _crop_mask_temporal_provenance,
    _baseline_layers, _epsg_from_handle, _validate_moisture_units, surface_flag_diagnostics,
    _align_crop_probability_mask, _crop_support_audit, _matches_granule_filename,
    quality_screen_diagnostics, _masked_array_diagnostics, _algorithm_candidate_diagnostics,
    _resolve_measurement_layers, agriculture_publication_index,
)


class AgricultureSME2Tests(unittest.TestCase):
    def test_publication_index_uses_immutable_run_scoped_asset_paths(self):
        publication = agriculture_publication_index(
            "agri-41647231453", "2026-11-03T13:47:12.554134+00:00"
        )
        self.assertEqual(
            publication["study_url"],
            "current/releases/agri-41647231453/study.json",
        )
        self.assertEqual(
            publication["checksums_url"],
            "current/releases/agri-41647231453/web-checksums.json",
        )
        self.assertEqual(publication["schema_version"], 1)

    def test_publication_index_rejects_unsafe_run_id(self):
        with self.assertRaises(AgricultureError):
            agriculture_publication_index("../latest", "2026-11-03T00:00:00+00:00")

    def test_cmr_granule_title_matches_downloaded_hdf5_extension_exactly(self):
        title = "NISAR_L3_PR_SME2_023_170_A_014_4005_DHDH_A_20260625T232955_20260625T233029_P05023_N_F_J_001"
        self.assertTrue(_matches_granule_filename(Path(title + ".h5"), title))
        self.assertTrue(_matches_granule_filename(Path(title + ".hdf5"), title))
        self.assertTrue(_matches_granule_filename(Path(title), title))
        self.assertFalse(_matches_granule_filename(Path(title + "_QA_STATS.h5"), title))
        self.assertFalse(_matches_granule_filename(Path(title + "_other.h5"), title))
        self.assertFalse(_matches_granule_filename(Path("different-granule.h5"), title))

    def test_cmr_truncation_fails_closed(self):
        class Response(io.BytesIO):
            headers = {"CMR-Hits": str(CMR_PAGE_SIZE + 1)}
        response = Response(b'{"feed":{"entry":[]}}')
        with patch("agriculture_sme2.urllib.request.urlopen", return_value=response):
            with self.assertRaisesRegex(AgricultureError, "Narrow the AOI or date range"):
                _cmr_search({"west": 90, "south": 24, "east": 91, "north": 25}, "2026-06-17", "2026-10-29")

    def test_algorithm_candidate_diagnostics_uses_matching_grid_and_shared_surface_flags(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "candidate-audit.h5"
            with h5py.File(path, "w") as handle:
                grids = handle.require_group("/science/LSAR/SME2/grids")
                grids.create_dataset("xCoordinates", data=np.array([100.0, 300.0]))
                grids.create_dataset("yCoordinates", data=np.array([300.0, 100.0]))
                candidates = grids.create_group("algorithmCandidates")
                dsg = candidates.create_group("DSG")
                moisture = dsg.create_dataset("soilMoisture", data=np.full((2, 2), 0.24, dtype="float32"))
                moisture.attrs["_FillValue"] = -9999.0
                moisture.attrs["units"] = "m^3/m^3"
                uncertainty = dsg.create_dataset("soilMoistureUncertainty", data=np.full((2, 2), 0.02, dtype="float32"))
                uncertainty.attrs["_FillValue"] = -9999.0
                uncertainty.attrs["units"] = "m^3/m^3"
                dsg.create_dataset("retrievalQualityFlag", data=np.zeros((2, 2), dtype="int16"))
                dsg.create_dataset("xCoordinates", data=np.array([100.0, 300.0]))
                dsg.create_dataset("yCoordinates", data=np.array([300.0, 100.0]))
                candidates.create_group("PMI")

            result = _algorithm_candidate_diagnostics(
                path, (2, 2), 0, 2, 0, 2, False, False,
                np.array([100.0, 300.0]), np.array([300.0, 100.0]),
                np.zeros((2, 2), dtype="int16"), np.ones((2, 2), dtype=bool),
            )
            self.assertEqual(result["status"], "AUDITED")
            self.assertEqual(result["algorithms"]["DSG"]["status"], "AUDITED")
            self.assertEqual(result["algorithms"]["DSG"]["quality"]["all_screen_pass_pixels"], 4)
            self.assertEqual(result["algorithms"]["DSG"]["quality"]["retrieval_interpretation"], "candidate-zero-clear")
            self.assertEqual(result["algorithms"]["DSG"]["surface_flag_source"], "shared_root_surfaceQualityFlag")
            self.assertEqual(result["algorithms"]["PMI"]["status"], "MISSING_REQUIRED_LAYERS")

    def test_algorithm_candidate_diagnostics_rejects_coordinate_mismatch(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "candidate-mismatch.h5"
            with h5py.File(path, "w") as handle:
                candidates = handle.create_group("/science/LSAR/SME2/grids/algorithmCandidates")
                dsg = candidates.create_group("DSG")
                dsg.create_dataset("soilMoisture", data=np.full((2, 2), 0.24, dtype="float32"))
                dsg.create_dataset("soilMoistureUncertainty", data=np.full((2, 2), 0.02, dtype="float32"))
                dsg.create_dataset("retrievalQualityFlag", data=np.full((2, 2), 15, dtype="int16"))
                dsg.create_dataset("xCoordinates", data=np.array([101.0, 301.0]))
                dsg.create_dataset("yCoordinates", data=np.array([300.0, 100.0]))

            result = _algorithm_candidate_diagnostics(
                path, (2, 2), 0, 2, 0, 2, False, False,
                np.array([100.0, 300.0]), np.array([300.0, 100.0]),
                np.zeros((2, 2), dtype="int16"), np.ones((2, 2), dtype=bool),
            )
            self.assertEqual(result["algorithms"]["DSG"]["status"], "GRID_COORDINATE_MISMATCH")

    def test_root_and_dsg_candidate_retrieval_flags_both_use_zero_clear_semantics(self):
        moisture = np.full((1, 4), 0.24)
        uncertainty = np.full((1, 4), 0.02)
        retrieval = np.array([[0, 1, 77, -9999]], dtype="int16")
        surface = np.zeros((1, 4), dtype="int16")
        candidate_valid = quality_mask(
            moisture, uncertainty, retrieval, surface,
            retrieval_mode="candidate-zero-clear",
        )
        np.testing.assert_array_equal(candidate_valid, [[True, False, False, False]])

        root_valid = quality_mask(
            moisture, uncertainty, retrieval, surface,
            retrieval_mode="root-zero-clear",
        )
        np.testing.assert_array_equal(root_valid, candidate_valid)

    def test_dsg_algorithm_selector_reads_candidate_layers_and_requires_grid_alignment(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "selector.h5"
            with h5py.File(path, "w") as handle:
                grids = handle.create_group("/science/LSAR/SME2/grids")
                grids.create_dataset("xCoordinates", data=np.array([100.0, 300.0]))
                grids.create_dataset("yCoordinates", data=np.array([300.0, 100.0]))
                grids.create_dataset("projection", data=np.int32(6933))
                baseline = grids.create_dataset("soilMoisture", data=np.full((2, 2), 0.20, dtype="float32"))
                baseline.attrs["units"] = "m^3/m^3"
                baseline_unc = grids.create_dataset("soilMoistureUncertainty", data=np.full((2, 2), 0.02, dtype="float32"))
                baseline_unc.attrs["units"] = "m^3/m^3"
                grids.create_dataset("retrievalQualityFlag", data=np.zeros((2, 2), dtype="int16"))
                grids.create_dataset("surfaceQualityFlag", data=np.zeros((2, 2), dtype="int16"))

                candidate = grids.create_group("algorithmCandidates").create_group("DSG")
                candidate_moisture = candidate.create_dataset("soilMoisture", data=np.full((2, 2), 0.24, dtype="float32"))
                candidate_moisture.attrs["units"] = "m^3/m^3"
                candidate_unc = candidate.create_dataset("soilMoistureUncertainty", data=np.full((2, 2), 0.03, dtype="float32"))
                candidate_unc.attrs["units"] = "m^3/m^3"
                candidate.create_dataset("retrievalQualityFlag", data=np.zeros((2, 2), dtype="int16"))
                candidate.create_dataset("xCoordinates", data=np.array([100.0, 300.0]))
                candidate.create_dataset("yCoordinates", data=np.array([300.0, 100.0]))

            with h5py.File(path, "r") as handle:
                grids = handle["/science/LSAR/SME2/grids"]
                baseline_layers = _baseline_layers(handle)
                x = np.asarray(grids["xCoordinates"][...], dtype="float64")
                y = np.asarray(grids["yCoordinates"][...], dtype="float64")
                selected, mode = _resolve_measurement_layers(handle, "DSG", baseline_layers, x, y)
                self.assertEqual(selected["soilMoisture"].name, "/science/LSAR/SME2/grids/algorithmCandidates/DSG/soilMoisture")
                self.assertEqual(selected["retrievalQualityFlag"].name, "/science/LSAR/SME2/grids/algorithmCandidates/DSG/retrievalQualityFlag")
                self.assertEqual(mode, "candidate-zero-clear")
                baseline_selected, baseline_mode = _resolve_measurement_layers(
                    handle, "baseline", baseline_layers, x, y,
                )
                self.assertEqual(baseline_selected["soilMoisture"].name, "/science/LSAR/SME2/grids/soilMoisture")
                self.assertEqual(baseline_mode, "root-zero-clear")

    def test_dsg_quality_diagnostics_report_zero_clear_retrieval_intersection(self):
        moisture = np.full((1, 4), 0.24)
        uncertainty = np.full((1, 4), 0.02)
        retrieval = np.array([[0, 1, 0, -9999]], dtype="int16")
        surface = np.array([[0, 0, 1, 0]], dtype="int16")
        diagnostics = quality_screen_diagnostics(
            moisture, uncertainty, retrieval, surface, np.ones((1, 4), dtype=bool),
            retrieval_mode="candidate-zero-clear",
        )
        self.assertEqual(diagnostics["retrieval_interpretation"], "candidate-zero-clear")
        self.assertEqual(diagnostics["retrieval_flag_pass_pixels"], 2)
        self.assertEqual(diagnostics["retrieval_zero_and_surface_zero_intersection"], 1)
        self.assertEqual(diagnostics["all_screen_pass_pixels"], 1)

    def test_masked_array_diagnostics_reports_fill_like_and_flag_distributions(self):
        values = np.array([[0.2, -9999.0, np.nan, 0.4]], dtype="float64")
        mask = np.array([[True, True, True, False]])
        result = _masked_array_diagnostics(values, mask, histogram=True)
        self.assertEqual(result["selected_pixels"], 3)
        self.assertEqual(result["finite_pixels"], 2)
        self.assertEqual(result["nonfinite_pixels"], 1)
        self.assertEqual(result["minimum"], -9999.0)
        self.assertEqual(result["maximum"], 0.2)
        self.assertEqual(result["value_counts"]["0.2"], 1)
        self.assertEqual(result["value_counts"]["-9999.0"], 1)
        self.assertEqual(result["value_counts"]["nan"], 1)
        self.assertFalse(result["histogram_truncated"])

    def test_quality_screen_diagnostics_count_each_strict_gate_without_changing_mask(self):
        moisture = np.array([[.20, .01, .20, .20, .20, .20]], dtype="float64")
        uncertainty = np.array([[.02, .02, np.nan, .02, .02, .02]], dtype="float64")
        retrieval = np.array([[0, 1, 0, 1, 0, 0]], dtype="uint8")
        surface = np.array([[0, 0, 0, 0, 1, 0]], dtype="uint8")
        fill_ok = np.array([[True, True, True, True, True, False]])
        aoi = np.ones((1, 6), dtype=bool)

        diagnostics = quality_screen_diagnostics(
            moisture, uncertainty, retrieval, surface, aoi, fill_ok,
        )
        valid = quality_mask(moisture, uncertainty, retrieval, surface, fill_ok)
        self.assertEqual(diagnostics, {
            "retrieval_interpretation": "root-zero-clear",
            "aoi_pixels": 6,
            "moisture_range_pass_pixels": 5,
            "uncertainty_pass_pixels": 5,
            "retrieval_flag_pass_pixels": 4,
            "surface_flag_clear_pixels": 5,
            "fill_pass_pixels": 5,
            "moisture_uncertainty_fill_intersection": 3,
            "after_retrieval_flag_intersection": 2,
            "after_surface_flag_intersection": 1,
            "retrieval_flag_exact_zero_pixels": 4,
            "moisture_uncertainty_fill_retrieval_zero_intersection": 2,
            "retrieval_zero_and_surface_zero_intersection": 1,
            "all_screen_pass_pixels": int(np.sum(valid & aoi)),
        })
        self.assertEqual(diagnostics["all_screen_pass_pixels"], 1)

    def test_uint8_retrieval_bitfield_is_numpy2_safe(self):
        moisture = np.full((2, 3), 0.25)
        uncertainty = np.full((2, 3), 0.03)
        retrieval = np.array([[0, 1, 0], [255, 0, 0]], dtype=np.uint8)
        surface = np.array([[0, 0, 0], [0, 1, 0]], dtype=np.uint8)
        result = quality_mask(moisture, uncertainty, retrieval, surface)
        np.testing.assert_array_equal(result, [[True, False, True], [False, False, True]])

    def test_fractional_and_nonfinite_flags_are_not_accepted(self):
        moisture = np.full((1, 4), 0.25)
        uncertainty = np.full((1, 4), 0.02)
        retrieval = np.array([[15.0, 15.5, np.nan, 271.0]])
        surface = np.array([[0.0, 0.0, 0.0, 0.0]])
        result = quality_mask(moisture, uncertainty, retrieval, surface)
        np.testing.assert_array_equal(result, [[False, False, False, False]])

    def test_surface_quality_must_be_zero(self):
        shape = (1, 4)
        result = quality_mask(np.full(shape, .2), np.full(shape, .01),
                              np.zeros(shape, dtype=np.uint8),
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
        self.assertEqual(result["unsupported_values"], [{"value": 256, "pixels": 1}])
        self.assertFalse(result["unsupported_values_truncated"])
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

    def test_surface_flag_unsupported_values_are_sorted_and_bounded(self):
        values = np.array([[
            256, 256, 257, 257, 257, 258, 259, 260, 261,
            262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272,
        ]], dtype="float64")
        result = surface_flag_diagnostics(values, np.ones(values.shape, dtype=bool))
        self.assertEqual(result["unsupported_encoding_pixels"], 20)
        self.assertEqual(len(result["unsupported_values"]), 16)
        self.assertTrue(result["unsupported_values_truncated"])
        self.assertEqual(result["unsupported_values"][:3], [
            {"value": 257, "pixels": 3},
            {"value": 256, "pixels": 2},
            {"value": 258, "pixels": 1},
        ])
        self.assertEqual(sum(item["pixels"] for item in result["unsupported_values"]), 19)

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

    def _write_crop_validation_receipt(self, root, mask_path):
        validation_path = root / "validation.json"
        manifest_path = root / "dynamic-world-source-manifest.json"
        count_path = root / "dynamic-world-valid-observation-count.tif"
        manifest_path.write_bytes(b"validated source manifest bytes")
        count_path.write_bytes(b"validated observation-count raster bytes")
        validation = {
            "status": "VALIDATED_FOR_OPTIONAL_SME2_AREA_AUDIT",
            "dataset": "GOOGLE/DYNAMICWORLD/V1",
            "class": "crops",
            "sme2_run_id": "agri-test-01",
            "sme2_series_id": "c5f219dd7bbc",
            "source_label": "Dynamic World GOOGLE/DYNAMICWORLD/V1 crops probability median composite (2026-08-01 to 2026-08-15)",
            "requested_window": {"start": "2026-08-01", "end": "2026-08-15"},
            "source_acquisition_dates": ["2026-08-01", "2026-08-08", "2026-08-15"],
            "unique_acquisition_dates": 3,
            "maximum_gap_between_acquisition_dates_days": 7,
            "minimum_valid_dates_per_pixel": 2,
            "valid_probability_fraction": 0.75,
            "probability_threshold": 0.5,
            "latest_scene_recency": {
                "days_from_latest_scene_to_requested_end": 0,
                "cue_days": 18,
                "status": "RECENT_WITHIN_18_DAY_WINDOW",
            },
            "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
            "probability_sha256": hashlib.sha256(mask_path.read_bytes()).hexdigest(),
            "observation_count_sha256": hashlib.sha256(count_path.read_bytes()).hexdigest(),
        }
        validation_path.write_text(json.dumps(validation), encoding="utf-8")
        return validation_path, validation

    def test_crop_mask_temporal_provenance_is_persistable_and_checksum_bound(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            mask_path = root / "probability.tif"
            mask_path.write_bytes(b"validated raster bytes")
            validation_path, _ = self._write_crop_validation_receipt(root, mask_path)

            result = _crop_mask_temporal_provenance(
                validation_path, mask_path,
                run_id="agri-test-01",
                series_id="c5f219dd7bbc",
                source_label="Dynamic World GOOGLE/DYNAMICWORLD/V1 crops probability median composite (2026-08-01 to 2026-08-15)",
                probability_threshold=0.5,
                expected_dates=["2026-08-01", "2026-08-15"],
            )
            self.assertEqual(result["unique_acquisition_dates"], 3)
            self.assertEqual(result["maximum_gap_between_acquisition_dates_days"], 7)
            self.assertEqual(result["latest_scene_recency"]["days_from_latest_scene_to_requested_end"], 0)
            self.assertEqual(result["probability_sha256"], hashlib.sha256(mask_path.read_bytes()).hexdigest())
            self.assertEqual(result["validation_sha256"], hashlib.sha256(validation_path.read_bytes()).hexdigest())

    def test_crop_mask_temporal_provenance_rechecks_manifest_and_count_raster_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            mask_path = root / "probability.tif"
            mask_path.write_bytes(b"validated raster bytes")
            validation_path, _ = self._write_crop_validation_receipt(root, mask_path)

            for filename, changed_bytes, expected_message in (
                ("dynamic-world-source-manifest.json", b"changed source manifest", "source manifest checksum"),
                ("dynamic-world-valid-observation-count.tif", b"changed count raster", "observation-count raster checksum"),
            ):
                with self.subTest(filename=filename):
                    fixture_path = root / filename
                    original = fixture_path.read_bytes()
                    fixture_path.write_bytes(changed_bytes)
                    with self.assertRaisesRegex(AgricultureError, expected_message):
                        _crop_mask_temporal_provenance(
                            validation_path, mask_path, run_id="agri-test-01",
                            series_id="c5f219dd7bbc",
                            source_label="Dynamic World GOOGLE/DYNAMICWORLD/V1 crops probability median composite (2026-08-01 to 2026-08-15)",
                            probability_threshold=0.5,
                            expected_dates=["2026-08-01", "2026-08-15"],
                        )
                    fixture_path.write_bytes(original)

    def test_crop_mask_temporal_provenance_rejects_wrong_run_series_and_threshold(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            mask_path = root / "probability.tif"
            mask_path.write_bytes(b"validated raster bytes")
            validation_path, validation = self._write_crop_validation_receipt(root, mask_path)
            kwargs = {
                "source_label": validation["source_label"],
                "probability_threshold": 0.5,
                "expected_dates": ["2026-08-01", "2026-08-15"],
            }
            for changes, message in (
                ({"sme2_run_id": "other-run"}, "does not match"),
                ({"sme2_series_id": "540e079403d5"}, "does not match"),
                ({"probability_threshold": 0.6}, "threshold does not match"),
            ):
                changed = dict(validation)
                changed.update(changes)
                validation_path.write_text(json.dumps(changed), encoding="utf-8")
                with self.subTest(changes=changes), self.assertRaisesRegex(AgricultureError, message):
                    _crop_mask_temporal_provenance(
                        validation_path, mask_path, run_id="agri-test-01",
                        series_id="c5f219dd7bbc", **kwargs,
                    )

    def test_crop_mask_temporal_provenance_rejects_inconsistent_source_recency(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            mask_path = root / "probability.tif"
            mask_path.write_bytes(b"validated raster bytes")
            validation_path, validation = self._write_crop_validation_receipt(root, mask_path)
            validation["latest_scene_recency"]["days_from_latest_scene_to_requested_end"] = 4
            validation_path.write_text(json.dumps(validation), encoding="utf-8")
            with self.assertRaisesRegex(AgricultureError, "recency metadata is inconsistent"):
                _crop_mask_temporal_provenance(
                    validation_path, mask_path, run_id="agri-test-01",
                    series_id="c5f219dd7bbc",
                    source_label=validation["source_label"],
                    probability_threshold=0.5,
                    expected_dates=["2026-08-01", "2026-08-15"],
                )

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
                            np.zeros((1, 2), dtype=np.uint8), np.zeros((1, 2)),
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
            grids.create_dataset("retrievalQualityFlag", data=np.zeros((4, 5), dtype="int16"))
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


def _step6_bits_rule_pass(flag_value):
    """Step 6 QA-bundle retrieval interpretation, kept ONLY as a comparator.

    The bundle rule passed a pixel iff retrievalQualityFlag bits 0-3 were
    set and bits 4-7 were clear (within a byte, that is exactly value 15).
    It is NOT a supported retrieval-mode of quality_mask, and these tests
    exist to show why it must never be adopted.
    """
    value = int(flag_value)
    return (value & 0x0F) == 0x0F and (value & 0xF0) == 0


class SME2FlagInterpretationTests(unittest.TestCase):
    """Each SME2 flag interpretation, tested against the official definition
    and against the real published Naogaon granule data.

    Official source: NASA CMR UMM-Var for NISAR_L3_SME2_PROVISIONAL_V1,
    variable /science/LSAR/SME2/grids/retrievalQualityFlag (retrieved
    2026-11-08, collection C2854344945-ASF): "Soil moisture retrieval
    quality flag while 0 means clear and non-zero means anomaly. Flag bits
    0: Retrieval recommended flag; 1: Retrieval attempted flag; 2:
    Retrieval success flag; 3: Soil moisture thresholds between (0.02 and
    0.60); 4: NISAR sigma-hh anomaly flag; 5: NISAR sigma-hv anomaly flag;
    6: NISAR sigma-vv anomaly flag; 7: NISAR sigma-vh anomaly flag."
    """

    def test_step6_bits_rule_contradicts_cmr_zero_clear_definition(self):
        values = [0, 1, 7, 9, 15, 77, 255, -9999]
        moisture = np.full((1, len(values)), 0.25)
        uncertainty = np.full((1, len(values)), 0.03)
        retrieval = np.array([values], dtype="int16")
        surface = np.zeros((1, len(values)), dtype="int16")
        valid = quality_mask(moisture, uncertainty, retrieval, surface)
        # Zero-clear (live code, matches CMR): only flag 0 is clear.
        np.testing.assert_array_equal(
            valid, [[True, False, False, False, False, False, False, False]]
        )
        # Bundle rule: the ONLY value it accepts is 15 -- it rejects 0,
        # the single value CMR calls clear, and accepts 15, which CMR
        # calls an anomaly. The two rules are mutually exclusive.
        self.assertEqual(
            [_step6_bits_rule_pass(value) for value in values],
            [False, False, False, False, True, False, False, False],
        )

    def test_real_naogaon_flag_counts_zero_clear_matches_published_study(self):
        study_path = (
            Path(__file__).resolve().parent.parent
            / "public" / "agriculture" / "current" / "study.json"
        )
        study = json.loads(study_path.read_text(encoding="utf-8"))
        self.assertEqual(study["study_id"], "agri-41647231453")
        expected_zero_clear = [3636, 1338, 3636, 3636, 3634, 3636]
        for observation, expected in zip(study["observations"], expected_zero_clear):
            counts = {
                int(key): int(value)
                for key, value in observation["retrieval_flag_counts"].items()
            }
            zero_clear = counts.get(0, 0)
            bits_rule = sum(
                count for value, count in counts.items()
                if _step6_bits_rule_pass(value)
            )
            self.assertEqual(
                zero_clear, expected,
                f"zero-clear count for {observation['date']}",
            )
            # No real granule pixel carries value 15: the bundle rule
            # would leave the published study with zero valid pixels.
            self.assertEqual(bits_rule, 0, f"bits-rule count for {observation['date']}")
        # The published change summary's valid-pixel count equals the
        # smallest per-observation zero-clear count (2026-08-24 baseline),
        # which is only possible under zero-clear gating.
        change = study["change_summary"]
        self.assertEqual(change["valid_pixels"], 1338)
        self.assertEqual(change["total_pixels"], 6278)
        self.assertAlmostEqual(change["valid_fraction"], 1338 / 6278, places=6)

    def test_surface_flag_unknown_high_bits_are_fail_closed(self):
        # Real Naogaon granules set surfaceQualityFlag bits 8 and 9
        # (values 256/512), which are outside the code's SURFACE_FLAG_BITS
        # table (bits 0-7). JPL D-107677 Rev C Table 4.2.1 defines only
        # bits 0-7 for surfaceQualityFlag (static water, urban,
        # precipitation, snow/ice, permanent snow/ice, frozen ground,
        # terrain, dense vegetation); bits 8-9 carry no defined meaning
        # in the spec. The == 0 gate must exclude them anyway: an
        # unknown encoding can never leak into a valid mask.
        moisture = np.full((1, 8), 0.25)
        uncertainty = np.full((1, 8), 0.03)
        retrieval = np.zeros((1, 8), dtype="int16")
        surface = np.array([[0, 1, 4, 8, 256, 512, 257, 513]], dtype="int16")
        valid = quality_mask(moisture, uncertainty, retrieval, surface)
        np.testing.assert_array_equal(
            valid, [[True, False, False, False, False, False, False, False]]
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)

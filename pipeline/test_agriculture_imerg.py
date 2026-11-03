"""Offline contract tests for the NASA GPM IMERG daily rainfall sidecar."""
import json
import tempfile
import unittest
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch
from datetime import date, timedelta
from pathlib import Path

import h5py
import numpy as np

from agriculture_imerg import (
    IMERG_SPATIAL_COVERAGE_FLOOR,
    _aoi_area_weights,
    attach_imerg_rainfall,
    build_imerg_windows,
    parse_imerg_granule_date,
    read_imerg_daily,
    required_imerg_dates,
    search_imerg_daily,
    select_imerg_granules,
    validate_imerg_publication,
)
from agriculture_sme2 import AgricultureError


class AgricultureIMERGTests(unittest.TestCase):
    def setUp(self):
        self.aoi = {
            "west": 91.32, "south": 24.32,
            "east": 91.58, "north": 24.48,
        }
        self.lon_desc = np.array([91.55, 91.45, 91.35], dtype="float32")
        self.lat_desc = np.array([24.45, 24.35], dtype="float32")

    def write_daily_fixture(self, path: Path, precipitation, counts=None, units="mm/day"):
        if counts is None:
            counts = np.full(np.asarray(precipitation).shape, 48, dtype="int16")
        with h5py.File(path, "w") as handle:
            handle.create_dataset("lon", data=self.lon_desc)
            handle.create_dataset("lat", data=self.lat_desc)
            precip = handle.create_dataset("precipitation", data=np.asarray(precipitation, dtype="float32"))
            precip.attrs["units"] = units
            precip.attrs["_FillValue"] = np.float32(-9999.9)
            count = handle.create_dataset("precipitation_cnt", data=np.asarray(counts, dtype="int16"))
            count.attrs["_FillValue"] = np.int16(-9999)

    def test_required_dates_are_exact_union_of_preceding_days(self):
        result = required_imerg_dates(["2026-06-20", "2026-07-02"])
        self.assertEqual(len(result), 24)
        self.assertEqual(result[0], "2026-06-08")
        self.assertEqual(result[-1], "2026-07-01")
        # The first acquisition date may correctly be in a later acquisition's look-back window;
        # only the last acquisition day is excluded from this union.
        self.assertNotIn("2026-07-02", result)

    def test_required_dates_reject_duplicate_or_unordered_sme2_dates(self):
        with self.assertRaises(AgricultureError):
            required_imerg_dates(["2026-06-20", "2026-06-20"])
        with self.assertRaises(AgricultureError):
            required_imerg_dates(["2026-07-02", "2026-06-20"])

    def test_cmr_duplicate_daily_granules_choose_latest_update(self):
        entries = [
            {"id": "G1-PROV", "title": "3IMERG.20260620.V07.nc4", "time_start": "2026-06-20T00:00:00Z", "updated": "2026-06-21T00:00:00Z"},
            {"id": "G2-PROV", "title": "3IMERG.20260620.V07.nc4", "time_start": "2026-06-20T00:00:00Z", "updated": "2026-06-22T00:00:00Z"},
            {"id": "G3-PROV", "title": "3IMERG.20260621.V07.nc4", "time_start": "2026-06-21T00:00:00Z", "updated": "2026-06-22T00:00:00Z"},
            {"id": "G4-PROV", "title": "wrong-format.tif", "time_start": "2026-06-20T00:00:00Z"},
            {"id": "G5-PROV", "title": "3B-DAY.MS.MRG.3IMERG.20260621-S000000-E235959.V07B.HDF5", "time_start": "2026-06-21T00:00:00Z", "updated": "2026-06-23T00:00:00Z"},
        ]
        selected = select_imerg_granules(entries, ["2026-06-20", "2026-06-21"])
        self.assertEqual(selected["2026-06-20"]["concept_id"], "G2-PROV")
        self.assertEqual(selected["2026-06-21"]["concept_id"], "G5-PROV")
        self.assertEqual(selected["2026-06-21"]["filename"].lower().endswith(".hdf5"), True)

    def test_parse_daily_granule_date_uses_title_when_time_start_missing(self):
        self.assertEqual(
            parse_imerg_granule_date({"title": "3IMERG.20260620-S000000-E235959.V07.nc4"}),
            "2026-06-20",
        )

    def test_native_grid_cells_are_area_weighted_and_keep_original_resolution(self):
        lon = np.array([91.35, 91.45])
        lat = np.array([24.35, 24.45])
        rows, columns, weights = _aoi_area_weights(lon, lat, {
            "west": 91.41, "south": 24.41, "east": 91.44, "north": 24.44,
        })
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(columns), 1)
        self.assertGreater(float(weights.sum()), 0)

    def test_reads_daily_net_cdf_with_lon_lat_axis_order_and_spherical_aoi_mean(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "imerg-day.nc4"
            # NetCDF dimension order is (time, lon, lat); coordinates are descending.
            data = np.array([[[1.0, 4.0], [2.0, 5.0], [3.0, 6.0]]], dtype="float32")
            self.write_daily_fixture(path, data)
            result = read_imerg_daily(path, self.aoi)
        self.assertAlmostEqual(result["spatial_coverage_fraction"], 1.0, places=6)
        self.assertEqual(result["valid_grid_cells"], 6)
        self.assertEqual(result["total_grid_cells"], 6)
        self.assertGreaterEqual(result["rainfall_mm"], 1.0)
        self.assertLessEqual(result["rainfall_mm"], 6.0)
        self.assertAlmostEqual(result["mean_half_hourly_samples"], 48.0, places=6)

    def test_missing_native_grid_cells_do_not_get_treated_as_zero_rainfall(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "imerg-day-missing.nc4"
            data = np.array([[[1.0, 4.0], [2.0, -9999.9], [3.0, 6.0]]], dtype="float32")
            self.write_daily_fixture(path, data)
            result = read_imerg_daily(path, self.aoi)
        self.assertGreater(result["spatial_coverage_fraction"], 0.0)
        self.assertLess(result["spatial_coverage_fraction"], IMERG_SPATIAL_COVERAGE_FLOOR)
        self.assertEqual(result["valid_grid_cells"], 5)
        self.assertEqual(result["total_grid_cells"], 6)
        self.assertIsNone(result["rainfall_mm"])

    def test_missing_or_bad_half_hour_count_invalidates_cell_support(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "imerg-day-count.nc4"
            data = np.ones((1, 3, 2), dtype="float32")
            counts = np.full((1, 3, 2), 48, dtype="int16")
            counts[0, 0, 0] = -9999
            self.write_daily_fixture(path, data, counts)
            result = read_imerg_daily(path, self.aoi)
        self.assertLess(result["spatial_coverage_fraction"], 1.0)

    def test_daily_product_units_are_not_confused_with_half_hourly_rates(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "wrong-units.nc4"
            self.write_daily_fixture(path, np.ones((1, 3, 2)), units="mm/hr")
            with self.assertRaisesRegex(AgricultureError, "mm/day"):
                read_imerg_daily(path, self.aoi)

    def test_windows_sum_prior_daily_mm_and_exclude_acquisition_day(self):
        observation_dates = ["2026-06-20"]
        daily = {}
        for offset in range(1, 13):
            day = (date(2026, 6, 20) - timedelta(days=offset)).isoformat()
            daily[day] = {
                "rainfall_mm": float(offset),
                "spatial_coverage_fraction": 1.0,
                "mean_half_hourly_samples": 48.0,
            }
        daily["2026-06-20"] = {
            "rainfall_mm": 999.0,
            "spatial_coverage_fraction": 1.0,
            "mean_half_hourly_samples": 48.0,
        }
        row = build_imerg_windows(observation_dates, daily)[0]["windows"]
        self.assertEqual(row["1d"]["rainfall_mm"], 1.0)
        self.assertEqual(row["3d"]["rainfall_mm"], 6.0)
        self.assertEqual(row["7d"]["rainfall_mm"], 28.0)
        self.assertEqual(row["12d"]["rainfall_mm"], 78.0)

    def test_incomplete_window_is_null_not_a_partial_or_zero_total(self):
        daily = {
            "2026-06-18": {"rainfall_mm": 2.0, "spatial_coverage_fraction": 1.0, "mean_half_hourly_samples": 48.0},
            "2026-06-19": {"rainfall_mm": None, "spatial_coverage_fraction": 0.2, "mean_half_hourly_samples": 3.0},
        }
        row = build_imerg_windows(["2026-06-20"], daily)[0]["windows"]
        self.assertEqual(row["1d"]["rainfall_mm"], None)
        self.assertEqual(row["1d"]["valid_days"], 0)
        self.assertEqual(row["3d"]["rainfall_mm"], None)
        self.assertEqual(row["3d"]["valid_days"], 1)
        self.assertEqual(row["3d"]["spatial_coverage_fraction"], 0.0)


    def test_attach_records_verified_rainfall_context_without_publishing_source_granules(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            run = root / "agri-run"
            result_dir = run / "result"
            result_dir.mkdir(parents=True)
            study_path = result_dir / "study.json"
            study_path.write_text(json.dumps({
                "run_id": "agri-run",
                "aoi": self.aoi,
                "observations": [{"date": "2026-06-20"}],
                "sources": [],
            }), encoding="utf-8")
            source = root / "granule.nc4"
            source.write_bytes(b"verified test fixture bytes")
            day = "2026-06-19"
            search_manifest = {
                "selected_granules": [{
                    "date": day, "concept_id": "G123-PROV",
                    "filename": "GPM_3IMERGDF_20260619.nc4",
                }],
                "missing_dates": [],
            }
            with patch("agriculture_imerg.run_folder", return_value=run), \
                    patch("agriculture_imerg.search_imerg_daily", return_value=search_manifest), \
                    patch("agriculture_imerg.download_imerg_granules", return_value={day: source}), \
                    patch("agriculture_imerg.read_imerg_daily", return_value={
                        "rainfall_mm": 5.0,
                        "spatial_coverage_fraction": 1.0,
                        "mean_half_hourly_samples": 48.0,
                        "valid_grid_cells": 4,
                        "total_grid_cells": 4,
                    }):
                context = attach_imerg_rainfall("agri-run")

            saved = json.loads(study_path.read_text(encoding="utf-8"))
            one_day = saved["rainfall_context"]["observations"][0]["windows"]["1d"]
            self.assertEqual(one_day["rainfall_mm"], 5.0)
            self.assertEqual(one_day["valid_days"], 1)
            self.assertEqual(context["granules"][0]["concept_id"], "G123-PROV")
            self.assertEqual(context["source_bytes"], source.stat().st_size)
            self.assertEqual(
                saved["sources"][-1]["url"],
                "https://doi.org/10.5067/GPM/IMERGDF/DAY/07",
            )
            self.assertTrue((run / "imerg" / "receipt.json").is_file())
            self.assertTrue((run / "imerg" / "daily-diagnostics.json").is_file())
            self.assertFalse((root / "public").exists())



    def test_cmr_discovery_queries_the_v07_daily_collection_and_checks_hit_count(self):
        class FakeResponse:
            headers = {"CMR-Hits": "1"}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps({"feed": {"entry": [{
                    "id": "G123-PROV",
                    "title": "GPM_3IMERGDF_20260619.nc4",
                    "time_start": "2026-06-19T00:00:00Z",
                    "updated": "2026-06-20T00:00:00Z",
                }]}}).encode("utf-8")

        with patch("urllib.request.urlopen", return_value=FakeResponse()) as mocked:
            manifest = search_imerg_daily(self.aoi, ["2026-06-19"])

        request = mocked.call_args.args[0]
        query = parse_qs(urlparse(request.full_url).query)
        self.assertEqual(query["short_name"], ["GPM_3IMERGDF"])
        self.assertEqual(query["version"], ["07"])
        self.assertEqual(query["provider"], ["GES_DISC"])
        self.assertEqual(manifest["selected_granules"][0]["concept_id"], "G123-PROV")
        self.assertEqual(manifest["missing_dates"], [])

    def test_cmr_discovery_rejects_truncated_results_instead_of_silently_dropping_days(self):
        class TruncatedResponse:
            headers = {"CMR-Hits": "2010"}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps({"feed": {"entry": []}}).encode("utf-8")

        with patch("urllib.request.urlopen", return_value=TruncatedResponse()):
            with self.assertRaisesRegex(AgricultureError, "truncated daily series"):
                search_imerg_daily(self.aoi, ["2026-06-19"])


    def test_publish_gate_rechecks_local_granule_bytes_and_aggregate_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            run = Path(temp)
            granule_dir = run / "imerg" / "granules"
            granule_dir.mkdir(parents=True)
            payload = b"actual local source bytes"
            (granule_dir / "day.nc4").write_bytes(payload)
            import hashlib
            item = {
                "date": "2026-06-19",
                "concept_id": "G123-PROV",
                "filename": "day.nc4",
                "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
            digest = hashlib.sha256(json.dumps([item], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            receipt = {
                "run_id": "agri-run", "product": "GPM_3IMERGDF_V07",
                "source_sha256": digest, "source_bytes": len(payload), "granules": [item],
            }
            (run / "imerg" / "receipt.json").write_text(json.dumps(receipt), encoding="utf-8")
            study = {
                "run_id": "agri-run",
                "observations": [{"date": "2026-06-20"}],
                "rainfall_context": {
                    "method": "GPM_IMERG_FINAL_DAILY_AOI_MEAN_V1",
                    "product": "GPM_3IMERGDF_V07",
                    "source_doi": "10.5067/GPM/IMERGDF/DAY/07",
                    "units": "mm",
                    "time_basis": "UTC_COMPLETE_DAYS_BEFORE_ACQUISITION",
                    "spatial_coverage_floor": 0.9,
                    "granules": [item],
                    "source_bytes": len(payload),
                    "source_sha256": digest,
                },
            }
            validate_imerg_publication(study, run)
            (granule_dir / "day.nc4").write_bytes(b"tampered source bytes")
            with self.assertRaisesRegex(AgricultureError, "checksum"):
                validate_imerg_publication(study, run)

    def test_publish_gate_rejects_granule_outside_required_lookback_dates(self):
        with tempfile.TemporaryDirectory() as temp:
            run = Path(temp)
            (run / "imerg" / "granules").mkdir(parents=True)
            item = {
                "date": "2026-06-20", "concept_id": "G123-PROV",
                "filename": "day.nc4", "bytes": 1, "sha256": "0" * 64,
            }
            study = {
                "run_id": "agri-run",
                "observations": [{"date": "2026-06-20"}],
                "rainfall_context": {
                    "method": "GPM_IMERG_FINAL_DAILY_AOI_MEAN_V1",
                    "product": "GPM_3IMERGDF_V07",
                    "source_doi": "10.5067/GPM/IMERGDF/DAY/07",
                    "units": "mm",
                    "time_basis": "UTC_COMPLETE_DAYS_BEFORE_ACQUISITION",
                    "spatial_coverage_floor": 0.9,
                    "granules": [item], "source_bytes": 1, "source_sha256": "0" * 64,
                },
            }
            with self.assertRaisesRegex(AgricultureError, "invalid date"):
                validate_imerg_publication(study, run)



if __name__ == "__main__":
    unittest.main()

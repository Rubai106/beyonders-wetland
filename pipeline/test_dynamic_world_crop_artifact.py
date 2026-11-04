"""Offline regression tests for Dynamic World artifact-to-SME2 preflight."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_dynamic_world_crop_artifact import (  # noqa: E402
    ArtifactValidationError,
    COUNT_FILE,
    MANIFEST_FILE,
    PROBABILITY_FILE,
    validate_dynamic_world_artifact,
)


class DynamicWorldArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.artifact = self.root / "artifact"
        self.artifact.mkdir()
        self.search_path = self.root / "search.json"
        self.receipt_path = self.root / "download.json"
        self.manifest_path = self.artifact / MANIFEST_FILE
        self.probability_path = self.artifact / PROBABILITY_FILE
        self.count_path = self.artifact / COUNT_FILE
        self.transform = from_origin(500000, 2800000, 10, 10)
        self.aoi = {"west": 91.3867, "south": 24.3533, "east": 91.4467, "north": 24.4133}
        self.series_id = "c5f219dd7bbc"
        self.probabilities = np.array([[0.2, 0.6], [-9999.0, 0.9]], dtype=np.float32)
        self.counts = np.array([[2, 2], [1, 2]], dtype=np.uint16)
        self._write_rasters()
        self._write_context()
        self._write_manifest()

    def tearDown(self):
        self.temp.cleanup()

    def _write_rasters(self, *, probabilities=None, counts=None, probability_transform=None,
                       count_transform=None, count_nodata=None, window_end="2026-08-15"):
        p_values = self.probabilities if probabilities is None else np.asarray(probabilities, dtype=np.float32)
        c_values = self.counts if counts is None else np.asarray(counts, dtype=np.uint16)
        p_transform = probability_transform or self.transform
        c_transform = count_transform or self.transform
        tags = {
            "DATASET": "GOOGLE/DYNAMICWORLD/V1",
            "PROBABILITY_BAND": "crops",
            "SOURCE_WINDOW_START": "2026-08-01",
            "SOURCE_WINDOW_END": window_end,
            "COMPOSITE": "PIXELWISE_MEDIAN_OF_DAILY_MEDIANS",
            "MINIMUM_OBSERVATIONS_PER_PIXEL": "2",
            "EXPORT_BUFFER_METRES": "600",
            "PROBABILITY_THRESHOLD_FOR_DOWNSTREAM_AUDIT": "0.5",
            "SOURCE_CRS": "EPSG:6933",
            "SOURCE_PIXEL_SIZE_METRES": "10",
            "INTERPRETATION": "GENERIC_CROPS_LIKELIHOOD_NOT_RICE_SPECIFIC_OR_FIELD_TRUTH",
        }
        with rasterio.open(
            self.probability_path, "w", driver="GTiff", height=2, width=2, count=1,
            dtype="float32", crs="EPSG:6933", transform=p_transform, nodata=-9999.0,
            compress="deflate",
        ) as ds:
            ds.write(p_values, 1)
            ds.write_mask((p_values != -9999.0).astype("uint8") * 255)
            ds.update_tags(**tags)
        with rasterio.open(
            self.count_path, "w", driver="GTiff", height=2, width=2, count=1,
            dtype="uint16", crs="EPSG:6933", transform=c_transform, nodata=count_nodata,
            compress="deflate",
        ) as ds:
            ds.write(c_values, 1)
            ds.write_mask(np.ones(c_values.shape, dtype="uint8") * 255)
            ds.update_tags(**tags)

    def _write_context(self):
        search = {
            "run_id": "agri-test-01",
            "aoi": self.aoi,
            "compatible_series": [{
                "series_id": self.series_id,
                "dates": ["2026-08-01", "2026-08-15"],
            }],
        }
        receipt = {"run_id": "agri-test-01", "series_id": self.series_id}
        self.search_path.write_text(json.dumps(search), encoding="utf-8")
        self.receipt_path.write_text(json.dumps(receipt), encoding="utf-8")

    def _grid(self, path):
        with rasterio.open(path) as ds:
            return {
                "width": ds.width,
                "height": ds.height,
                "crs": ds.crs.to_string(),
                "transform": list(ds.transform)[:6],
                "bounds": [ds.bounds.left, ds.bounds.bottom, ds.bounds.right, ds.bounds.top],
            }

    def _write_manifest(self):
        with rasterio.open(self.probability_path) as ds:
            valid = ds.read_masks(1) > 0
            values = ds.read(1)[valid]
            probability_grid = self._grid(self.probability_path)
            probability_grid.update({
                "pixel_area_m2": 100.0,
                "valid_probability_pixels": int(valid.sum()),
                "export_grid_pixels": int(valid.size),
                "valid_probability_fraction": float(valid.mean()),
                "probability_median": float(np.median(values)),
                "probability_p05": float(np.percentile(values, 5)),
                "probability_p95": float(np.percentile(values, 95)),
            })
        with rasterio.open(self.count_path) as ds:
            values = ds.read(1)
            count_grid = self._grid(self.count_path)
            count_grid.update({
                "minimum_valid_date_count": int(values.min()),
                "maximum_valid_date_count": int(values.max()),
                "pixels_with_any_valid_observation": int(np.count_nonzero(values)),
                "pixels_meeting_minimum_observations": int(np.count_nonzero(values >= 2)),
            })
        p_hash = hashlib.sha256(self.probability_path.read_bytes()).hexdigest()
        c_hash = hashlib.sha256(self.count_path.read_bytes()).hexdigest()
        manifest = {
            "schema_version": 1,
            "status": "RECENT_WITHIN_18_DAY_WINDOW",
            "dataset": "GOOGLE/DYNAMICWORLD/V1",
            "dataset_producer": "World Resources Institute and Google",
            "dataset_doi": "10.1038/s41597-022-01307-4",
            "class": "crops",
            "class_interpretation": "Generic crops likelihood; not rice-specific or parcel ground truth.",
            "aoi_wgs84": self.aoi,
            "requested_window": {"start": "2026-08-01", "end": "2026-08-15"},
            "source_observations": {
                "scene_record_count": 2,
                "unique_acquisition_date_count": 2,
                "acquisition_dates": ["2026-08-01", "2026-08-15"],
                "first_acquisition_date": "2026-08-01",
                "latest_acquisition_date": "2026-08-15",
                "maximum_gap_between_acquisition_dates_days": 14,
                "source_image_ids": ["dw-001", "dw-002"],
                "days_from_latest_scene_to_requested_end": 0,
                "recency_cue_days": 18,
                "status": "RECENT_WITHIN_18_DAY_WINDOW",
            },
            "composite": {
                "method": "PIXELWISE_MEDIAN_OF_DAILY_MEDIANS",
                "distinct_acquisition_dates": 2,
                "minimum_valid_dates_per_pixel": 2,
                "cloud_and_shadow_masking": "INHERITED_FROM_DYNAMIC_WORLD_SOURCE_MASK",
                "recency_assessment": {
                    "days_from_latest_scene_to_requested_end": 0,
                    "cue_days": 18,
                    "status": "RECENT_WITHIN_18_DAY_WINDOW",
                    "interpretation": "Descriptive cue only.",
                },
            },
            "downstream_probability_threshold": 0.5,
            "export": {
                "crs": "EPSG:6933",
                "pixel_size_metres": 10,
                "buffer_metres": 600,
                "probability_file": PROBABILITY_FILE,
                "probability_sha256": p_hash,
                "probability_bytes": self.probability_path.stat().st_size,
                "probability_grid": probability_grid,
                "observation_count_file": COUNT_FILE,
                "observation_count_sha256": c_hash,
                "observation_count_bytes": self.count_path.stat().st_size,
                "observation_count_grid": count_grid,
            },
        }
        self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    def _manifest(self):
        return json.loads(self.manifest_path.read_text(encoding="utf-8"))

    def _save_manifest(self, value):
        self.manifest_path.write_text(json.dumps(value), encoding="utf-8")

    def _refresh_export_hashes(self, manifest):
        manifest["export"]["probability_sha256"] = hashlib.sha256(
            self.probability_path.read_bytes()
        ).hexdigest()
        manifest["export"]["probability_bytes"] = self.probability_path.stat().st_size
        manifest["export"]["observation_count_sha256"] = hashlib.sha256(
            self.count_path.read_bytes()
        ).hexdigest()
        manifest["export"]["observation_count_bytes"] = self.count_path.stat().st_size
        self._save_manifest(manifest)

    def test_valid_artifact_passes_and_preserves_generic_class_limit(self):
        result = validate_dynamic_world_artifact(self.artifact, self.search_path, self.receipt_path)
        self.assertEqual(result["status"], "VALIDATED_FOR_OPTIONAL_SME2_AREA_AUDIT")
        self.assertEqual(result["probability_threshold"], 0.5)
        self.assertEqual(result["valid_probability_pixels"], 3)
        self.assertIn("not rice-specific", result["class_interpretation"])
        self.assertIn("2026-08-01 to 2026-08-15", result["source_label"])
        self.assertEqual(result["source_acquisition_dates"], ["2026-08-01", "2026-08-15"])
        self.assertEqual(result["aoi_wgs84"]["west"], 91.3867)
        self.assertEqual(result["sme2_run_id"], "agri-test-01")
        self.assertEqual(result["sme2_series_id"], self.series_id)

    def test_rejects_aoi_mismatch(self):
        manifest = self._manifest()
        manifest["aoi_wgs84"]["west"] += 0.001
        self._save_manifest(manifest)
        with self.assertRaisesRegex(ArtifactValidationError, "AOI does not match"):
            validate_dynamic_world_artifact(self.artifact, self.search_path, self.receipt_path)

    def test_rejects_composite_that_does_not_cover_all_sme2_dates(self):
        manifest = self._manifest()
        manifest["requested_window"]["start"] = "2026-08-02"
        self._save_manifest(manifest)
        with self.assertRaisesRegex(ArtifactValidationError, "must cover every selected SME2"):
            validate_dynamic_world_artifact(self.artifact, self.search_path, self.receipt_path)

    def test_rejects_artifact_for_a_different_downloaded_series(self):
        receipt = {"run_id": "agri-test-01", "series_id": "540e079403d5"}
        self.receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
        with self.assertRaisesRegex(ArtifactValidationError, "not uniquely present"):
            validate_dynamic_world_artifact(self.artifact, self.search_path, self.receipt_path)

    def test_rejects_tampered_probability_bytes(self):
        with self.probability_path.open("ab") as handle:
            handle.write(b"tamper")
        with self.assertRaisesRegex(ArtifactValidationError, "checksum/byte-count mismatch"):
            validate_dynamic_world_artifact(self.artifact, self.search_path, self.receipt_path)

    def test_rejects_probability_and_count_grid_shift(self):
        shifted = from_origin(500010, 2800000, 10, 10)
        self._write_rasters(count_transform=shifted)
        self._write_manifest()
        with self.assertRaisesRegex(ArtifactValidationError, "not on the identical grid"):
            validate_dynamic_world_artifact(self.artifact, self.search_path, self.receipt_path)

    def test_rejects_observation_count_greater_than_distinct_source_dates(self):
        invalid_counts = np.array([[2, 3], [1, 2]], dtype=np.uint16)
        self._write_rasters(counts=invalid_counts)
        self._write_manifest()
        with self.assertRaisesRegex(ArtifactValidationError, "exceeds the number of source dates"):
            validate_dynamic_world_artifact(self.artifact, self.search_path, self.receipt_path)

    def test_rejects_probability_mask_that_disagrees_with_per_pixel_counts(self):
        mismatched = np.array([[0.2, 0.6], [-9999.0, -9999.0]], dtype=np.float32)
        self._write_rasters(probabilities=mismatched)
        self._write_manifest()
        with self.assertRaisesRegex(ArtifactValidationError, "NoData mask does not match"):
            validate_dynamic_world_artifact(self.artifact, self.search_path, self.receipt_path)

    def test_rejects_probability_outside_zero_to_one(self):
        invalid = np.array([[0.2, 1.2], [-9999.0, 0.9]], dtype=np.float32)
        self._write_rasters(probabilities=invalid)
        self._write_manifest()
        with self.assertRaises(ArtifactValidationError):
            validate_dynamic_world_artifact(self.artifact, self.search_path, self.receipt_path)

    def test_rejects_count_raster_that_drops_zero_values_as_nodata(self):
        self._write_rasters(count_nodata=0)
        self._write_manifest()
        with self.assertRaisesRegex(ArtifactValidationError, "preserve zero counts"):
            validate_dynamic_world_artifact(self.artifact, self.search_path, self.receipt_path)

    def test_stale_recency_is_reported_but_is_not_misrepresented_as_a_scientific_gate(self):
        self._write_rasters(window_end="2026-09-10")
        self._write_manifest()
        manifest = self._manifest()
        manifest["requested_window"]["end"] = "2026-09-10"
        manifest["source_observations"]["days_from_latest_scene_to_requested_end"] = 26
        manifest["source_observations"]["status"] = "STALE_MORE_THAN_18_DAYS_BEFORE_WINDOW_END"
        manifest["composite"]["recency_assessment"]["days_from_latest_scene_to_requested_end"] = 26
        manifest["composite"]["recency_assessment"]["status"] = "STALE_MORE_THAN_18_DAYS_BEFORE_WINDOW_END"
        manifest["status"] = "STALE_MORE_THAN_18_DAYS_BEFORE_WINDOW_END"
        # The source window still covers both SME2 dates; the descriptive recency cue is stale.
        self._save_manifest(manifest)
        result = validate_dynamic_world_artifact(self.artifact, self.search_path, self.receipt_path)
        self.assertEqual(result["latest_scene_recency"]["status"], "STALE_MORE_THAN_18_DAYS_BEFORE_WINDOW_END")


if __name__ == "__main__":
    unittest.main(verbosity=2)

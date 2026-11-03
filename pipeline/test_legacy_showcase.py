"""Tests for the legacy-run showcase adapter and the modern exporter. Standard library only.

These tests are self-contained: they build every input in a temporary directory, so they pass on a clean
checkout with no `pipeline/output/`. The synthetic manifests exist ONLY inside temporary directories for
testing and are never published. The only repository file used is the committed boundary
`pipeline/data/tanguar_haor_adb_boundary.geojson`, because the adapter verifies boundaries against it.

`RealLocalLegacyOutput` additionally exercises a genuine legacy run if one happens to be present locally
and is skipped otherwise.
"""
import copy
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import legacy_showcase as legacy  # noqa: E402

BOUNDARY_FILE = HERE / "data" / "tanguar_haor_adb_boundary.geojson"
RUN_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
OBS_DATES = ["2026-06-30", "2026-07-12", "2026-07-24", "2026-08-17", "2026-08-29", "2026-09-10", "2026-09-22"]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value)
    path.write_text(text, encoding="utf-8")
    return len(text)


def scene(date, number):
    stamp = date.replace("-", "")
    return f"NISAR_L2_PR_GCOV_{number:03d}_069_A_014_4005_DHDH_A_{stamp}T232134_{stamp}T232209_P05023_N_F_J_001"


def boundary_facts():
    """Source string and bounds of the committed boundary file, so the fixture manifest can be verified against it."""
    collection = json.loads(BOUNDARY_FILE.read_text(encoding="utf-8"))
    props = collection["features"][0]["properties"]
    return props["boundary_source"], legacy.bbox_of(collection)


def make_manifest():
    source, bounds = boundary_facts()
    return {
        "run_id": RUN_ID, "mode": "real", "data_source": "NISAR", "status": "COMPLETE", "seed": None,
        "product": legacy.EXPECTED_PRODUCT, "product_maturity": "PROVISIONAL", "frequency": "L-band",
        "site_name": "Tanguar Haor mapped boundary", "site_bounds": bounds, "wetland_boundary_source": source,
        "selected_date": "2026-08-29", "observation_count": 7,
        "baseline_date": "2026-06-18", "baseline_scene": scene("2026-06-18", 23), "baseline_method": "PER_PIXEL_MEDIAN",
        "baseline_observation_dates": ["2026-06-18", "2026-06-30"],
        "observation_scenes": [scene(d, 24 + i) for i, d in enumerate(OBS_DATES)],
        "reference_validated": False, "cross_sensor_check_completed": True, "reference_check_status": "INCONCLUSIVE",
        "quality_mask_method": "fixture", "completed_at": "2026-10-05T00:00:00+00:00",
    }


def make_demo_style_loose_files(run: Path):
    """Loose derived files that do NOT belong to the manifest above: wrong site, wrong dates, wrong place."""
    props = {"id": "demo_1", "date": "2026-07-24", "area_km2": 1.0, "classification": "OPEN_WATER", "quality_status": "PASS",
             "spatial_status": "PASS", "temporal_status": "PASS", "threshold_stability": "STABLE", "evidence_state": "SUPPORTED",
             "mean_delta_db": -3.0, "valid_fraction": 0.9, "centroid": [24.65, 91.55]}
    ring = [[91.52, 24.64], [91.58, 24.64], [91.58, 24.67], [91.52, 24.64]]
    write_json(run / "patches_final.geojson", {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": props}]})
    dates = ["2026-06-18", "2026-06-30", "2026-07-12", "2026-07-24", "2026-08-05", "2026-08-17", "2026-08-29", "2026-09-10"]
    write_json(run / "wetland_pulse.json", {"site": "Hakaluki Haor", "peak": {"date": "2026-07-24", "area_km2": 1.0},
               "dates": [{"date": d, "area_km2": 1.0, "fraction": 0.1, "mean_delta_db": 1.0, "patches": 1} for d in dates]})
    write_json(run / "sensitivity_results.json", {"thresholds": [{"delta_db": 2.0, "area_km2": 1.0, "patches": 1}], "stability_verdict": "STABLE", "stable_range": [1, 3], "sensitivity_note": "fixture"})
    (run / "before_hh.tif").write_bytes(b"not a real raster")  # must never be published


@unittest.skipUnless(BOUNDARY_FILE.is_file(), "committed Tanguar boundary file not present")
class LegacyShowcase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.run = self.tmp / "runs" / RUN_ID
        self.run.mkdir(parents=True)
        self.manifest = make_manifest()
        write_json(self.run / "last_attempt.json", self.manifest)
        make_demo_style_loose_files(self.run)
        self.out = self.tmp / "out"
        self.out.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def export(self):
        return legacy.export_legacy(self.run, self.out, RUN_ID, ROOT, write_json)

    def test_detected_as_legacy(self):
        self.assertTrue(legacy.is_legacy_run(self.run))

    def test_inconsistent_loose_files_are_not_exported_as_real(self):
        """Loose pulse/patch files with the wrong site, dates and location must be skipped, not published."""
        summary = self.export()
        self.assertEqual(summary["completeness"], "METADATA_ONLY")
        self.assertFalse((self.out / "pulse.json").exists())
        self.assertFalse((self.out / "patches").exists())
        self.assertFalse((self.out / "sensitivity.json").exists())
        reasons = " ".join(item["reason"] for item in summary["skipped"])
        self.assertIn("Hakaluki", reasons)
        self.assertIn("outside the run's study bounds", reasons)

    def test_exports_only_real_acquisition_metadata_and_verified_boundary(self):
        self.export()
        manifest = json.loads((self.out / "manifest.json").read_text())
        self.assertEqual(manifest["observation_count"], 7)
        self.assertEqual(manifest["observation_dates"][0], "2026-06-30")
        self.assertEqual(manifest["observation_dates"][-1], "2026-09-22")
        self.assertEqual(manifest["product"], "NISAR_L2_GCOV_PROVISIONAL_V1")
        self.assertFalse(manifest["reference_validated"])
        self.assertFalse(manifest["availability"]["pulse"])
        self.assertTrue(manifest["availability"]["boundary"])
        self.assertEqual(manifest["radar_dates"], [])
        self.assertTrue(any("provisional" in text for text in manifest["limitations"]))
        self.assertTrue(any("not confirmed flooding" in text for text in manifest["limitations"]))
        observations = json.loads((self.out / "observations.json").read_text())
        self.assertTrue(all(item["patches_file"] is None for item in observations))

    def test_never_copies_rasters_or_credentials(self):
        self.export()
        names = [p.suffix.lower() for p in self.out.rglob("*") if p.is_file()]
        self.assertNotIn(".tif", names)
        self.assertNotIn(".png", names)
        blob = " ".join(p.read_text() for p in self.out.rglob("*.json"))
        self.assertNotIn(str(self.tmp), blob)

    def test_refuses_wrong_identity_status_source_product(self):
        for key, value in (("run_id", "f" * 32), ("status", "FAILED"), ("data_source", "SIMULATED_DEMO"), ("product", "OTHER")):
            broken = dict(self.manifest, **{key: value})
            write_json(self.run / "last_attempt.json", broken)
            with self.assertRaises(legacy.LegacyRunError, msg=key):
                legacy.validate_manifest(broken, RUN_ID)

    def test_boundary_is_withheld_when_it_does_not_match_the_manifest(self):
        broken = copy.deepcopy(self.manifest)
        broken["wetland_boundary_source"] = "some other source"
        write_json(self.run / "last_attempt.json", broken)
        manifest = json.loads((self.run / "last_attempt.json").read_text())
        self.assertIsNone(legacy.find_boundary(ROOT, manifest)[0])
        summary = self.export()
        self.assertFalse((self.out / "boundary.geojson").exists())
        self.assertIn("boundary.geojson", [item["artifact"] for item in summary["skipped"]])

    def test_consistent_derived_files_are_exported_for_the_selected_date_only(self):
        """Synthetic, self-consistent derived files (test fixture only)."""
        dates = legacy.validate_manifest(self.manifest, RUN_ID)["observation_dates"]
        bounds = self.manifest["site_bounds"]
        cx, cy = (bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2
        ring = [[cx, cy], [cx + 0.01, cy], [cx + 0.01, cy + 0.01], [cx, cy]]
        props = {"id": "p1", "date": self.manifest["selected_date"], "area_km2": 2.0, "classification": "OPEN_WATER", "quality_status": "PASS",
                 "spatial_status": "PASS", "temporal_status": "PASS", "threshold_stability": "STABLE", "evidence_state": "SUPPORTED",
                 "mean_delta_db": -3.0, "valid_fraction": 0.9, "centroid": [cy, cx]}
        write_json(self.run / "patches_final.geojson", {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": props}]})
        write_json(self.run / "wetland_pulse.json", {"site": self.manifest["site_name"], "onset": dates[0], "recession_start": dates[-2],
                   "peak": {"date": self.manifest["selected_date"], "area_km2": 2.0},
                   "dates": [{"date": d, "area_km2": 1.0 + i, "fraction": 0.1, "mean_delta_db": 1.0, "patches": 1} for i, d in enumerate(dates)]})
        write_json(self.run / "sensitivity_results.json", {"thresholds": [{"delta_db": 2.0, "area_km2": 2.0, "patches": 1}], "stability_verdict": "STABLE", "stable_range": [1, 3], "sensitivity_note": "fixture"})
        summary = self.export()
        self.assertEqual(summary["completeness"], "PARTIAL")
        self.assertEqual(summary["patch_dates"], [self.manifest["selected_date"]])
        observations = json.loads((self.out / "observations.json").read_text())
        with_files = [o["date"] for o in observations if o["patches_file"]]
        self.assertEqual(with_files, [self.manifest["selected_date"]])
        self.assertTrue((self.out / "pulse.json").exists())


REAL_LOCAL = HERE / "output" / "last_attempt.json"


@unittest.skipUnless(REAL_LOCAL.is_file(), "no local legacy run in pipeline/output (expected on a clean checkout)")
class RealLocalLegacyOutput(unittest.TestCase):
    """Identity and safety checks against a genuine local legacy run, when one exists. Completeness is not asserted,
    because it legitimately depends on whether that run's loose derived files verify."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.manifest = json.loads(REAL_LOCAL.read_text())
        self.run_id = self.manifest["run_id"]
        self.run = self.tmp / "runs" / self.run_id
        self.run.mkdir(parents=True)
        for item in (HERE / "output").iterdir():
            if item.is_file():
                shutil.copy(item, self.run / item.name)
        self.out = self.tmp / "out"
        self.out.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_legacy_export_respects_current_product_gate(self):
        if legacy.is_legacy_run(self.run):
            try:
                legacy.validate_manifest(self.manifest, self.run_id)
            except legacy.LegacyRunError as exc:
                # The repository's saved 2026-01 Chókwè fixture is genuine BETA
                # GCOV, while this public legacy adapter intentionally accepts
                # only PROVISIONAL. Keep the historical file private; do not
                # weaken the product gate merely to make this test pass.
                self.assertIn("product is", str(exc))
                self.assertFalse(any(self.out.iterdir()))
                return
            legacy.export_legacy(self.run, self.out, self.run_id, ROOT, write_json)
            self.assertNotIn(".tif", [p.suffix.lower() for p in self.out.rglob("*") if p.is_file()])
            self.assertNotIn(str(self.tmp), " ".join(p.read_text() for p in self.out.rglob("*.json")))

    def test_real_manifest_identity_is_enforced(self):
        broken = dict(self.manifest, run_id="f" * 32)
        with self.assertRaises(legacy.LegacyRunError):
            legacy.validate_manifest(broken, self.run_id)


class PackagedShowcaseAssets(unittest.TestCase):
    def test_radar_preview_references_resolve_inside_the_package(self):
        case = ROOT / "public" / "showcase" / "featured"
        previews = sorted((case / "radar").glob("preview_*.json"))
        self.assertEqual(len(previews), 7)
        for path in previews:
            with self.subTest(preview=path.name):
                preview = json.loads(path.read_text(encoding="utf-8"))
                date = preview["date"]
                patch_ref = preview.get("patches_file")
                self.assertEqual(patch_ref, f"patches/{date}.geojson")
                self.assertTrue((case / patch_ref).is_file())
                self.assertNotIn("classification_file", preview)
                for layer in preview.get("layers", {}).values():
                    self.assertNotIn("source_rasters", layer)
                    for image_ref in layer.get("images", {}).values():
                        self.assertTrue((case / image_ref).is_file(), image_ref)
                serialized = json.dumps(preview)
                self.assertNotIn(".tif", serialized.lower())


class ModernExporterUnchanged(unittest.TestCase):
    def test_modern_run_still_exports(self):
        rid = "c" * 32
        output_dir = HERE / "output"
        output_existed = output_dir.exists()
        run = output_dir / "runs" / rid
        case = "selftest-modern"
        out = ROOT / "public" / "showcase" / case
        # The exporter rewrites the showcase index; snapshot it so this test
        # leaves the project's published assets byte-identical.
        index_path = ROOT / "public" / "showcase" / "index.json"
        index_existed = index_path.exists()
        index_before = index_path.read_bytes() if index_existed else None
        try:
            fc = {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[91.1, 24.1], [91.2, 24.1], [91.2, 24.2], [91.1, 24.1]]]}, "properties": {"id": "p"}}]}
            write_json(run / "run_manifest.json", {"status": "COMPLETE", "data_source": "NISAR", "run_id": rid, "site_name": "T"})
            write_json(run / "wetland_pulse.json", {"dates": [{"date": "2026-06-18"}], "peak": {"date": "2026-06-18"}})
            write_json(run / "site_boundary.geojson", fc)
            write_json(run / "p0.geojson", fc)
            write_json(run / "sensitivity_results.json", {"thresholds": []})
            write_json(run / "observations.json", [{"date": "2026-06-18", "patches_file": "p0.geojson"}])
            for filename in ("radar_00_hh_before.png", "radar_00_hh_after.png", "radar_00_hh_change.png"):
                (run / filename).write_bytes(b"test-image")
            write_json(run / "radar_preview_00.json", {
                "date": "2026-06-18",
                "layers": {"hh": {"images": {"before": "radar_00_hh_before.png", "after": "radar_00_hh_after.png", "change": "radar_00_hh_change.png"},
                                  "source_rasters": {"before": "before_hh.tif", "after": "after_hh.tif"}}},
                "patches_file": "patches_00_final.geojson", "classification_file": "classification_00.tif",
            })
            result = subprocess.run([sys.executable, str(HERE / "export_showcase.py"), "--run-id", rid, "--case-id", case], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            manifest = json.loads((out / "manifest.json").read_text())
            self.assertNotIn("legacy_format", manifest)
            self.assertTrue((out / "patches" / "2026-06-18.geojson").exists())
            preview = json.loads((out / "radar" / "preview_2026-06-18.json").read_text())
            self.assertEqual(preview["patches_file"], "patches/2026-06-18.geojson")
            self.assertTrue((out / preview["patches_file"]).is_file())
            self.assertNotIn("classification_file", preview)
            self.assertNotIn("source_rasters", preview["layers"]["hh"])
            for layer in preview["layers"].values():
                for image in layer["images"].values():
                    self.assertTrue((out / image).is_file(), image)
        finally:
            shutil.rmtree(out, ignore_errors=True)
            shutil.rmtree(run, ignore_errors=True)
            if index_before is not None:
                index_path.write_bytes(index_before)
            elif index_path.exists():
                index_path.unlink()
            runs = output_dir / "runs"
            if runs.exists() and not any(runs.iterdir()):
                runs.rmdir()
            if not output_existed and output_dir.exists() and not any(output_dir.iterdir()):
                output_dir.rmdir()  # leave a clean checkout clean


if __name__ == "__main__":
    unittest.main()

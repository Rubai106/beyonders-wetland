from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

try:
    from .export_showcase import build_file_checksums, verify_file_checksums
except ImportError:
    from export_showcase import build_file_checksums, verify_file_checksums


class ShowcaseIntegrityTests(unittest.TestCase):
    def test_hash_map_uses_relative_posix_paths_and_excludes_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "manifest.json").write_text("{}", encoding="utf-8")
            (root / "observations.json").write_text('{"dates": []}', encoding="utf-8")
            (root / "patches").mkdir()
            (root / "patches" / "a.geojson").write_text('{"type":"FeatureCollection","features":[]}', encoding="utf-8")
            hashes = build_file_checksums(root)
            self.assertEqual(set(hashes), {"observations.json", "patches/a.geojson"})
            self.assertTrue(all(len(value) == 64 for value in hashes.values()))
            self.assertEqual(verify_file_checksums(root, hashes), {"missing_from_manifest": [], "missing_on_disk": [], "mismatched": []})

    def test_verifier_detects_modified_missing_and_unlisted_assets(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "a.json").write_text('{"ok":true}', encoding="utf-8")
            expected = build_file_checksums(root)
            (root / "a.json").write_text('{"ok":false}', encoding="utf-8")
            (root / "extra.png").write_bytes(b"extra")
            expected["gone.json"] = "0" * 64
            result = verify_file_checksums(root, expected)
            self.assertEqual(result["missing_from_manifest"], ["extra.png"])
            self.assertEqual(result["missing_on_disk"], ["gone.json"])
            self.assertEqual(result["mismatched"], ["a.json"])

if __name__ == "__main__":
    unittest.main()

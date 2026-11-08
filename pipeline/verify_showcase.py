"""Verify all payload assets for a published showcase package against files_sha256."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from .export_showcase import verify_file_checksums
except ImportError:
    from export_showcase import verify_file_checksums

ROOT = Path(__file__).resolve().parents[1]

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case-id", default="featured", help="Case folder under public/showcase/")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,40}", args.case_id):
        print("Invalid case id.", file=sys.stderr)
        return 2
    directory = ROOT / "public" / "showcase" / args.case_id
    manifest_path = directory / "manifest.json"
    if not manifest_path.is_file():
        print(f"No published manifest at {manifest_path}", file=sys.stderr)
        return 2
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"Cannot read package manifest: {error}", file=sys.stderr)
        return 2
    expected = manifest.get("files_sha256")
    if not isinstance(expected, dict) or not expected:
        print("No files_sha256 entries in manifest; package integrity is NOT VERIFIED.", file=sys.stderr)
        return 2
    result = verify_file_checksums(directory, expected)
    failed = False
    for key, title in (("missing_from_manifest", "Unlisted payload files"), ("missing_on_disk", "Files missing from disk"), ("mismatched", "SHA-256 mismatches")):
        paths = result[key]
        if paths:
            failed = True
            print(f"{title} ({len(paths)}):")
            for path in paths:
                print(f"  {path}")
    if failed:
        return 1
    print(f"PASS: {len(expected)} payload files match SHA-256 values in {manifest_path.relative_to(ROOT)}.")
    print("Note: this detects payload corruption relative to the manifest; it is not a signed authenticity proof.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

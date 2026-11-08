"""Package a COMPLETED real NISAR run into compact, deployment-safe showcase assets.

The public site must open without Earthdata credentials, Python, or a local
`pipeline/output/runs/` folder. This script copies only *derived* artifacts of a
saved real run (GeoJSON, JSON summaries, small PNG previews) into
`public/showcase/<case-id>/`, which can be committed to Git.

It never copies raw HDF5/GeoTIFF inputs, credentials, or absolute local paths.
It refuses simulated runs and incomplete runs.

Usage (from the repository root, inside the pipeline virtualenv):
    python pipeline/export_showcase.py --run-id <32-hex-run-id>
    python pipeline/export_showcase.py --run-id <id> --case-id featured --max-mb 8
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "pipeline" / "output" / "runs"
SHOWCASE_VERSION = 1

# Manifest keys that are safe, scientific, and path-free.
MANIFEST_KEYS = (
    "run_id", "site_name", "baseline_date", "selected_date", "observation_count", "product",
    "product_maturity", "frequency", "reference_check_status", "reference_validated",
    "cross_sensor_check_completed", "wetland_boundary_source", "site_bounds",
    "quality_mask_method", "completed_at", "data_source",
)

LIMITATIONS = [
    "NISAR L2 GCOV input is a provisional product; results are exploratory.",
    "A radar change candidate is not confirmed flooding; backscatter change can have several causes.",
    "No field truth is included. Cross-sensor (HLS optical) comparison is not field validation.",
    "The study boundary is a reference GIS mask, not a legal or official wetland extent.",
    "Areas with no candidate polygon were not classified as unchanged; they have no detector result.",
    "Acquisition gaps are real: no values are interpolated between NISAR observations.",
]


def build_file_checksums(directory: Path) -> dict[str, str]:
    """Return SHA-256 hashes for every regular payload file, excluding manifest.json.

    Paths are relative POSIX paths so the manifest is portable across OSes. The
    manifest cannot hash itself; the hashes detect accidental payload corruption,
    not malicious edits to both a payload and its manifest.
    """
    root = directory.resolve()
    checksums: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root).as_posix()
        if relative == "manifest.json":
            continue
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        checksums[relative] = digest.hexdigest()
    return checksums


def verify_file_checksums(directory: Path, expected: dict[str, str]) -> dict[str, list[str]]:
    """Compare a package against its manifest and report missing/extra/mismatched paths."""
    actual = build_file_checksums(directory)
    expected_paths = set(expected)
    actual_paths = set(actual)
    return {
        "missing_from_manifest": sorted(actual_paths - expected_paths),
        "missing_on_disk": sorted(expected_paths - actual_paths),
        "mismatched": sorted(path for path in actual_paths & expected_paths if actual[path] != expected[path]),
    }


def add_payload_checksums(directory: Path, manifest: dict) -> dict:
    """Populate integrity metadata for a completed published package."""
    manifest["files_sha256"] = build_file_checksums(directory)
    manifest["total_bytes"] = sum(
        path.stat().st_size for path in directory.rglob("*")
        if path.is_file() and not path.is_symlink() and path.relative_to(directory.resolve()).as_posix() != "manifest.json"
    )
    return manifest


def update_case_index(case_id: str, manifest: dict) -> None:
    """Keep public/showcase/index.json listing every exported case, newest first.

    The website reads this file to offer all packaged real cases. Entries are
    keyed by case_id so re-exporting a case updates it in place."""
    index_path = ROOT / "public" / "showcase" / "index.json"
    try:
        index = json.loads(index_path.read_text(encoding="utf-8"))
        cases = index.get("cases", []) if isinstance(index, dict) else []
    except (OSError, ValueError):
        cases = []
    entry = {
        "id": case_id,
        "label": manifest.get("label", "REAL NISAR-DERIVED SHOWCASE"),
        "site_name": manifest.get("site_name", case_id),
        "site_display_name": manifest.get("site_display_name") or manifest.get("site_name", case_id),
        "site_bounds": manifest.get("site_bounds"),
        "observation_count": manifest.get("observation_count"),
        "exported_at": manifest.get("exported_at"),
    }
    cases = [c for c in cases if c.get("id") != case_id]
    cases.insert(0, entry)
    write_json(index_path, {"version": 1, "cases": cases})
    print(f"Case index updated: {len(cases)} case(s) -> {index_path.relative_to(ROOT)}")


def load(path: Path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, value) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def round_coords(value, places=5):
    if isinstance(value, (int, float)):
        return round(value, places)
    return [round_coords(item, places) for item in value]


def slim_geojson(document):
    """Keep properties, round coordinates to ~1 m, drop nothing scientific."""
    features = []
    for feature in document.get("features", []):
        geometry = feature.get("geometry")
        if geometry:
            geometry = {"type": geometry["type"], "coordinates": round_coords(geometry["coordinates"])}
        features.append({"type": "Feature", "geometry": geometry, "properties": feature.get("properties", {})})
    return {"type": "FeatureCollection", "features": features}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run-id", required=True, help="32-character hexadecimal run id under pipeline/output/runs/")
    parser.add_argument("--case-id", default="featured", help="Output folder name under public/showcase/")
    parser.add_argument("--max-mb", type=float, default=8.0, help="Total size budget for committed assets")
    parser.add_argument("--no-radar", action="store_true", help="Skip radar preview PNGs")
    parser.add_argument("--legacy-dir", help="Folder holding a legacy loose-output run (last_attempt.json ...), used when runs/<id> does not exist")
    args = parser.parse_args()

    if not re.fullmatch(r"[a-f0-9]{32}", args.run_id):
        print("Invalid run id.", file=sys.stderr)
        return 2
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,40}", args.case_id):
        print("Invalid case id (lowercase letters, digits, hyphen).", file=sys.stderr)
        return 2

    run = RUNS / args.run_id
    if args.legacy_dir and not run.exists():
        run = Path(args.legacy_dir).resolve()

    # Legacy loose-output runs (last_attempt.json, no run_manifest.json) go through a verifying adapter.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from legacy_showcase import LegacyRunError, export_legacy, is_legacy_run
    if is_legacy_run(run):
        out = ROOT / "public" / "showcase" / args.case_id
        if out.exists():
            shutil.rmtree(out)
        out.mkdir(parents=True)
        try:
            summary = export_legacy(run, out, args.run_id, ROOT, write_json)
        except LegacyRunError as error:
            shutil.rmtree(out, ignore_errors=True)
            print(str(error), file=sys.stderr)
            return 2
        legacy_manifest_path = out / "manifest.json"
        if legacy_manifest_path.is_file():
            legacy_manifest = add_payload_checksums(out, load(legacy_manifest_path))
            write_json(legacy_manifest_path, legacy_manifest)
            update_case_index(args.case_id, legacy_manifest)
        print(f"Legacy run {args.run_id}: {summary['completeness']} export of {summary['site']} "
              f"({summary['observations']} real acquisition dates, patches for {summary['patch_dates'] or 'no dates'}, "
              f"{summary['bytes'] / 1024:.0f} KB) -> {out.relative_to(ROOT)}")
        for item in summary["skipped"]:
            print(f"  SKIPPED {item['artifact']}: {item['reason']}")
        print("Only artifacts verified against the run manifest were exported. Nothing was reconstructed.")
        return 0

    manifest_path = run / "run_manifest.json"
    if not manifest_path.is_file():
        print(f"No saved run at {run}", file=sys.stderr)
        return 2
    manifest = load(manifest_path)
    if manifest.get("status") != "COMPLETE":
        print(f"Run status is {manifest.get('status')}; only COMPLETE runs can be exported.", file=sys.stderr)
        return 2
    if manifest.get("data_source") != "NISAR":
        print("Refusing to export a non-NISAR run as a real showcase.", file=sys.stderr)
        return 2

    out = ROOT / "public" / "showcase" / args.case_id
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    budget = int(args.max_mb * 1024 * 1024)
    used = 0

    pulse = load(run / "wetland_pulse.json")
    used += write_json(out / "pulse.json", pulse)
    used += write_json(out / "boundary.geojson", slim_geojson(load(run / "site_boundary.geojson")))
    used += write_json(out / "sensitivity.json", load(run / "sensitivity_results.json"))

    observations = load(run / "observations.json")
    exported_observations = []
    for index, item in enumerate(observations):
        patches_file = run / item["patches_file"]
        target = f"patches/{item['date']}.geojson"
        used += write_json(out / target, slim_geojson(load(patches_file)))
        exported_observations.append({"date": item["date"], "index": index, "patches_file": target,
                                      "scene_name": item.get("scene_name"),
                                      "baseline_observation_dates": item.get("baseline_observation_dates"),
                                      "baseline_method": item.get("baseline_method")})

    # Reference (cross-sensor) summary: statistics and status only, plus small evidence images if budget allows.
    reference = {"available": False}
    validation_path = run / "reference_validation.json"
    evidence_path = run / "reference_evidence.json"
    if validation_path.is_file():
        reference = {"available": True, "validation": load(validation_path)}
        if evidence_path.is_file():
            evidence = load(evidence_path)
            images = {}
            for name in evidence.get("artifacts", []):
                source = run / name
                if re.fullmatch(r"reference_[a-z_]+\.png", name) and source.is_file() and used + source.stat().st_size < budget * 0.6:
                    (out / "reference").mkdir(exist_ok=True)
                    shutil.copyfile(source, out / "reference" / name)
                    used += source.stat().st_size
                    images[name] = f"reference/{name}"
            evidence["showcase_images"] = images
            reference["evidence"] = evidence
    used += write_json(out / "reference.json", reference)

    # Radar previews: peak date first, then the rest, until the budget is reached.
    radar_dates = []
    if not args.no_radar:
        peak_date = pulse.get("peak", {}).get("date")
        order = sorted(range(len(observations)), key=lambda i: (observations[i]["date"] != peak_date, i))
        for index in order:
            preview_path = run / f"radar_preview_{index:02d}.json"
            if not preview_path.is_file():
                continue
            preview = load(preview_path)
            files = [image for layer in preview["layers"].values() for image in layer["images"].values()]
            size = sum((run / f).stat().st_size for f in files if (run / f).is_file())
            if used + size > budget:
                continue
            for f in files:
                (out / "radar").mkdir(exist_ok=True)
                shutil.copyfile(run / f, out / "radar" / f)
            for layer in preview["layers"].values():
                layer["images"] = {k: f"radar/{v}" for k, v in layer["images"].items()}
                layer.pop("source_rasters", None)  # local raster filenames are not published
            preview.pop("event_scene", None)
            # Public previews may only point at artifacts included in this case export.
            public_patches = f"patches/{observations[index]['date']}.geojson"
            preview["patches_file"] = public_patches if (out / public_patches).is_file() else None
            preview.pop("classification_file", None)  # classified rasters are intentionally not published
            used += size + write_json(out / "radar" / f"preview_{observations[index]['date']}.json", preview)
            radar_dates.append(observations[index]["date"])

    maturity = str(manifest.get("product_maturity") or "UNKNOWN").upper()
    maturity_note = {
        "BETA": "NISAR L2 GCOV input is a BETA pre-calibration product; interpret results cautiously and do not mix it with PROVISIONAL inputs.",
        "PROVISIONAL": "NISAR L2 GCOV input is PROVISIONAL: calibrated and partially validated, but not fully validated.",
        "SIMULATED": "This is a simulated test artifact and must never be presented as a real NISAR observation.",
    }.get(maturity, "NISAR product maturity was not recorded; scientific interpretation must remain unverified.")
    clean = {key: manifest.get(key) for key in MANIFEST_KEYS if key in manifest}
    clean["reference_validated"] = False if not manifest.get("reference_validated") else True
    clean.update({
        "showcase_version": SHOWCASE_VERSION,
        "case_id": args.case_id,
        "label": "REAL NISAR-DERIVED SHOWCASE",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "observation_dates": [o["date"] for o in exported_observations],
        "radar_dates": radar_dates,
        "has_reference": bool(reference.get("available")),
        "limitations": [maturity_note, *LIMITATIONS],
        "source": "NASA/JPL NISAR L2 GCOV via NASA CMR / ASF DAAC (processed locally; raw HDF5 not distributed)",
        "total_bytes": used,
    })
    write_json(out / "observations.json", exported_observations)
    clean = add_payload_checksums(out, clean)
    write_json(out / "manifest.json", clean)
    update_case_index(args.case_id, clean)

    print(f"Exported {len(exported_observations)} observations, {len(radar_dates)} radar dates, "
          f"{used / 1024 / 1024:.2f} MB -> {out.relative_to(ROOT)}")
    print("Review the folder, then commit public/showcase/. No credentials or raw rasters were copied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

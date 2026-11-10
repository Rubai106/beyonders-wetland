# Chókwè native NISAR raster recovery

## Purpose

The public Chókwè release refers to a native `classification_00.tif` and its HH/HV masked inputs, but those GeoTIFFs were not included in the public release or found in the previously checked worktrees. This procedure reprocesses the exact published NISAR scene pair and retains a private native-raster package for a separate same-grid GFM comparison. That comparison completed on 10 November 2026; compact provenance and result summaries are published under `public/evidence/`.

This is **reprocessing, not restoration of the original TIFF bytes**. It does not publish new study evidence and does not alter the public release.

## Pinned source identity

- Published run: `ec8fa5ee15ae41d1aa89f930f2b47e36`
- Publication release: `2026.10.29-chokwe`
- Product: `NISAR_L2_GCOV_BETA_V1` · frequency A
- Baseline: 2026-01-05 — `NISAR_L2_PR_GCOV_009_114_A_165_4005_DHDH_A_20260105T034232_20260105T034253_X05010_N_P_J_001`
- Event: 2026-01-17 — `NISAR_L2_PR_GCOV_010_114_A_165_4005_DHDH_A_20260117T034232_20260117T034254_X05010_N_P_J_001`
- AOI: [32.93, -24.58, 33.03, -24.48] WGS84, from the published operator-selected rectangular analysis box. It is not an authoritative wetland or flood boundary.

Before any network access, the recovery script verifies the published run manifest, observation record, case-study scene identities, boundary geometry and method rules. It refuses to proceed if those source facts have changed.

## Commands

Validate the pinned request without contacting NASA:

```bash
python pipeline/recover_chokwe_native.py --dry-run
```

Reprocess the exact scene pair (requires a configured NASA Earthdata session/token):

```bash
python pipeline/recover_chokwe_native.py
```

The default private output root is `pipeline/output/chokwe-native-recovery/`. An alternate location can be supplied with `--output-root PATH`.

## GitHub Actions

The manual workflow is **Chokwe native NISAR raster recovery** (`.github/workflows/chokwe-native-recovery.yml`). It defaults to `DO_NOT_RUN` and proceeds only when the operator explicitly selects `REPROCESS_EXACT_CHOKWE_PAIR`.

The workflow expects one of these repository Actions secret configurations:

- `EARTHDATA_TOKEN`; or
- `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`.

Credentials are injected into the job environment and are never written to the repository, recovery manifest or uploaded artifact. The workflow uploads the private recovery output as a 30-day Actions artifact.

## Required recovered artifacts

The recovery validator requires and SHA-256 hashes:

- `classification_00.tif`
- `before_hh_masked.tif` and `before_hv_masked.tif`
- `after_00_hh_masked.tif` and `after_00_hv_masked.tif`
- `wetland_mask.tif`
- `processing_config.json`, `observations.json`, `quality_observations.json`, and `run_manifest.json`
- GCOV `numberOfLooks` and `quality_valid` sidecars for both source granules; the averaging-ensemble mask is retained when present.
- `recovery_manifest.json` with source-package hashes, exact source IDs, method parameters, native CRS/grid, class counts, masks, artifact hashes and scientific limitations.

The validator checks that the four masked HH/HV inputs and classification have the same CRS, affine transform, dimensions and valid-pixel support. Class code 0 is not treated as a negative label: the four masked input rasters are used to separate valid no-candidate pixels from invalid/no-data pixels.

## Interpretation boundaries

- The source release records HLS reference status as **INCONCLUSIVE**. Recovery does not repeat that analysis or upgrade its status.
- NISAR classes remain algorithmic radar-change candidates, not confirmed floods or field truth.
- No accuracy, precision, recall or F1 metric is calculated.
- The native-grid GFM comparison completed in workflow run `42863187071`, using GFM NRT v4.1.0 acquired 23 minutes 45 seconds before the NISAR event scene. It reports positive-only support over 57,997 of 147,151 eligible OPEN_WATER candidate pixels (39.4133%; 5.7997 km²). It does not produce accuracy, precision, recall or F1.
- The recovery rasters remain in the private Actions artifact. Only reviewable metadata summaries are published: `public/evidence/chokwe-native-recovery-2026-11-10.json` and `public/evidence/chokwe-native-gfm-comparison-2026-11-10.json`. The original publication directory and production-run pointer are unchanged.


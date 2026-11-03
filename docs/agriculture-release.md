# Agriculture / SME2 release and QA status

## Implemented product

The `/agriculture` workspace is a soil-moisture measurement explorer for real NISAR L3 SME2 PROVISIONAL products. It has map navigation, verified moisture/change previews, a real-acquisition timeline, statistics, CSV export, Operator command generation and an Evidence drawer. It does not synthesize results when no publication exists.

The operator pipeline is isolated in `pipeline/agriculture_sme2.py`. It can run locally or through the cloud-only GitHub Actions workflow `.github/workflows/agriculture-cloud.yml`; browser controls never receive Earthdata credentials. The cloud workflow uses an Actions secret for Earthdata authentication, processes exact granules on a GitHub-hosted runner, and commits only the compact display package and checksums to `public/agriculture/current`. Raw HDF5/NetCDF granules and native GeoTIFFs are not committed.

## Review work completed on Rubai-dev

The following implementation and safety changes are committed on the development branch:

- Added `pipeline/output/agriculture/` to `.gitignore` so granules, receipts, native rasters and operator logs remain private.
- Updated the repository README to describe Agriculture accurately as a fourth, separate workspace.
- Changed HDF5 selection to use the primary baseline soil-moisture layers from the SME2 root grid, avoiding duplicate names under `algorithmCandidates`.
- Added support for the documented `surfaceQualityFlag` location variation between the root grid and `ancillaryData`.
- Required the root projection to identify EASE-Grid 2.0 (EPSG:6933), checked moisture/uncertainty units, and parsed standardized granule identity fields before grouping scenes.
- Added a fail-closed CMR result-count check: a query that exceeds one 2,000-result page is rejected rather than treated as complete.
- Made duplicate same-date granule selection deterministic using CMR update time, with concept ID as a tie-breaker.
- Added offline regression fixtures for product filename fields, metadata conflicts, old releases, root-vs-candidate layer collisions, surface-flag path variants, CRS, units and CMR truncation.
- Clarified in the UI that the change-layer uncertainty display is the target-date product uncertainty and is not propagated into the target-minus-baseline difference.

The NASA/JPL specification lists the root SME2 moisture/uncertainty layers separately from algorithm-candidate datasets and defines the retrieval and surface quality flags. The current `surfaceQualityFlag == 0` rule is intentionally conservative: it excludes static water, urban, precipitation, snow/ice, frozen ground, terrain and dense-vegetation flags. This can reduce valid coverage in vegetated crop areas; it must not be interpreted as evidence of no soil moisture.

## Surface-flag observability audit

New Agriculture study observations now carry a decoded per-date NISAR SME2 surfaceQualityFlag audit. It reports the eight documented surface-flag reasons, zero-valued surface flags, fill/invalid values and unsupported encodings over the AOI. Per-bit reason counts can overlap by design.

The screen remains strict and unchanged: the published moisture-valid mask still requires surfaceQualityFlag == 0 along with all existing retrieval, moisture, uncertainty, fill and AOI checks. A clear surface flag alone is not a valid retrieval.

This is an AOI-level observability diagnostic, not yet a crop-mask intersection. It must not be described as crop-area coverage until an independent crop mask is provided, versioned and aligned to the SME2 native grid.

## Exact flag-overlap atlas (Step 1C)

New analyses now preserve each distinct non-zero eight-bit surfaceQualityFlag pattern and its pixel count. These exact pattern rows are mutually exclusive and must sum to the observation's flagged-pixel total. The publication validator also reconstructs every marginal per-bit count from the pattern masks, so mismatched summary and signature counts are rejected.

The Agriculture Explore panel presents the most frequent signatures in a clickable eight-bit matrix, with a detail view for the selected combination and an option to display all combinations. The CSV export retains the marginal counts and exact signatures separately. Older schema-v2 packages without the optional signature array remain readable and show the audit as not recorded.

This adds a joint-pattern view to the existing overlapping reason counts; it does not infer a physical cause or crop identity. The strict surfaceQualityFlag == 0 rule and all other SME2 quality checks remain unchanged. It is a bitfield diagnostic, not a quality correction or field validation result.

## Spatial-support sensitivity audit

The Explore panel now plots the per-date median from each date's valid footprint beside the median from the fixed all-date pixel cohort. Vertical connectors show the gap between those spatial samples at each acquisition. The summary reports the median absolute gap, first-to-last gap shift and largest absolute gap. These values are a descriptive diagnostic for spatial-support sensitivity, not a correction or physical change estimate. The fixed-cohort coverage status remains visible; below 20% is inconclusive and zero common pixels stays unavailable.

## Event-aligned IMERG rainfall integration

The local Agriculture pipeline now has an optional rainfall stage in pipeline/agriculture_imerg.py, invoked after SME2 analysis:

~~~powershell
python pipeline/agriculture_sme2.py rainfall --run-id agri-pilot-01
python pipeline/agriculture_sme2.py publish --run-id agri-pilot-01
~~~

The stage queries NASA CMR for GPM_3IMERGDF version 07 daily granules covering the exact UTC days needed before each SME2 acquisition, authenticates/downloads exact concept IDs with earthaccess, and reads the daily precipitation plus half-hourly sample-count fields. It uses native 0.1-degree grid cells and spherical cell/AOI overlap area weights. A daily AOI estimate is accepted only at 90% or greater spatial support. Incomplete 1-, 3-, 7- or 12-day windows remain null; no missing value is converted to zero. The study embeds a per-granule receipt and aggregate source-manifest digest. Raw NetCDF4 data and daily diagnostics stay in ignored local operator storage; publication copies only the compact study summary and existing preview assets.

The browser has an acquisition-aligned rainfall timeline with four accumulation windows, explicit missing-state markers, spatial-coverage and half-hour-sample support, and an official NASA dataset link. It only appears for a checksum-verified study that contains a schema-valid rainfall context. The existing no-publication state remains unchanged.

This integration is code-complete on Rubai-dev, but a real Earthdata-authenticated run has not been completed here. The CMR/download/NetCDF4 integration, new Python regression tests, updated TypeScript schema tests, lint, production build and browser smoke test must pass before this milestone is considered QA-complete. No actual Agriculture rainfall values or SME2 study are claimed by the implementation itself.

## Scientific boundaries

- Product: `NISAR_L3_SME2_PROVISIONAL_V1`, PROVISIONAL maturity.
- SME2 PROVISIONAL measurements are not fully calibrated; outputs remain exploratory.
- No real Agriculture case is currently published.
- No claim is made about crop stress, drought, irrigation need, crop type, field boundaries, yield or agricultural accuracy.
- The baseline is the first three unique observations in a compatible series; the target is the latest observation.
- The 20% AOI coverage floor is fixed. Below-floor target or change coverage is inconclusive.
- The reported change-layer uncertainty is currently the target observation's product uncertainty, not a propagated uncertainty for the difference.
- Synthetic HDF5 fixtures are test-only and never published.

## QA execution status

The latest complete **Agriculture and project QA** GitHub Actions run is [run #162](https://github.com/Rubai106/beyonders-wetland/actions/runs/41510560042), on commit `9b4f62e7c010dde15a5d47eb682463c03e295e71` on `Rubai-dev`. All automated steps passed:

| Automated check | Result |
|---|---|
| Python module and browser-test syntax compilation | PASS |
| Full offline Python regression suite | PASS |
| TypeScript unit/schema regression tests | PASS |
| ESLint | PASS |
| Next.js public-viewer production build | PASS |
| Whole-project TypeScript check | PASS |
| Chromium production-browser smoke tests: Chókwè, Scattering and Agriculture unpublished-state guard | PASS |

These are code, fixture and browser-workflow checks. They do **not** establish that a genuine Agriculture SME2 pilot has been processed or validated.

| Real-data/operator check | Status |
|---|---|
| Live NASA CMR discovery and Earthdata-authenticated granule download | NOT RUN — Earthdata credentials and operator-selected AOI required |
| Real PROVISIONAL SME2 HDF5 hierarchy, units, projection, fill values and flag verification | NOT RUN — no authenticated operator granule review is claimed |
| Independent crop-mask processing on a real SME2 series | NOT RUN — no real crop mask/pilot is published |
| Interactive overlap-atlas review using a real published Agriculture study | NOT RUN — the production-browser check verifies that the atlas is withheld when no study is published |

Do not represent synthetic regression fixtures or a passing production build as a real-data agricultural validation result.

## Next pilot plan

1. From the repository root, run the focused offline checks:
   ```powershell
   python -m unittest pipeline.test_agriculture_sme2 -v
   python -m py_compile pipeline/agriculture_sme2.py pipeline/test_agriculture_sme2.py
   node --experimental-strip-types --no-warnings=ExperimentalWarning --loader ./tests/strip-loader.mjs --test src/lib/agriculture-study.test.ts
   npm run lint
   npx tsc --noEmit
   npm run build
   ```
2. Run a real CMR search for a small analyst-selected AOI and a period with at least four acquisitions. Review the compatible series printed by the script; do not mix different tracks, frames, directions, bandwidths, polarizations, frequencies or releases.
3. Download one selected series using the exact CMR concept IDs. Inspect the receipts and one real HDF5 granule's hierarchy, dataset attributes, axes, projection, fill values and quality-flag counts.
4. Run `analyze`. Review the actual target/change coverage, baseline dates, surface/retrieval flag counts, maps and analysis report. Coverage below 20% is inconclusive; low coverage must not be “fixed” by weakening flags or changing the AOI after seeing the results.
5. Publish only after the operator signs off on the actual HDF5 checks and study package. Then run the public-mode production build and inspect `/agriculture` in desktop and mobile layouts.
6. Keep all generated operator data under the ignored local output directory. Do not merge `Rubai-dev` into `master` until the focused and whole-project regression gates pass.

The example operator commands and current schema are in [Agriculture method and operator workflow](agriculture-method.md).


## Cloud operation status

A manual cloud workflow is now available on `Rubai-dev`: **Actions → Cloud Agriculture SME2 publication**. It requires the repository Actions secret `EARTHDATA_TOKEN` (a NASA Earthdata Login token) and operator-selected WGS84 AOI/date inputs. It runs the SME2 and optional IMERG stages on GitHub-hosted compute, then commits only the verified website publication package to `Rubai-dev`. Raw source granules remain ephemeral on the runner; non-sensitive receipts are retained as a 30-day Actions artifact.

The cloud workflow itself has not yet completed a real-data run. It cannot authenticate until the repository secret is configured, and it cannot select a meaningful study area without AOI/date inputs.

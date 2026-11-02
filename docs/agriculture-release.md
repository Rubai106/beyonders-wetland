# Agriculture / SME2 release and QA status

## Implemented product

The `/agriculture` workspace is a soil-moisture measurement explorer for real NISAR L3 SME2 PROVISIONAL products. It has map navigation, verified moisture/change previews, a real-acquisition timeline, statistics, CSV export, Operator command generation and an Evidence drawer. It does not synthesize results when no publication exists.

The operator pipeline is isolated in `pipeline/agriculture_sme2.py`. Search, Earthdata authentication, exact-granule download, analysis and publication run locally; browser controls do not receive Earthdata credentials or start local jobs. The publish step writes only the compact display package and checksums to `public/agriculture/current`; source HDF5 files and native GeoTIFFs remain local.

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

## Spatial-support sensitivity audit

The Explore panel now plots the per-date median from each date's valid footprint beside the median from the fixed all-date pixel cohort. Vertical connectors show the gap between those spatial samples at each acquisition. The summary reports the median absolute gap, first-to-last gap shift and largest absolute gap. These values are a descriptive diagnostic for spatial-support sensitivity, not a correction or physical change estimate. The fixed-cohort coverage status remains visible; below 20% is inconclusive and zero common pixels stays unavailable.

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

The connected review session can inspect and change the GitHub repository but cannot run its local Python/Node environment or authenticate to the user's Earthdata account. The following checks are therefore **NOT RUN HERE** and must not be represented as passing:

| Check | Status |
|---|---|
| Agriculture Python unit suite | NOT RUN HERE |
| Python syntax compilation | NOT RUN HERE |
| Agriculture TypeScript schema tests | NOT RUN HERE |
| Project ESLint | NOT RUN HERE |
| Whole-project TypeScript check | NOT RUN HERE |
| Next.js production build | NOT RUN HERE |
| Agriculture desktop/mobile browser checks | NOT RUN HERE |
| Existing Wetland/Explore browser regression suites | NOT RUN HERE |
| Live NASA CMR and Earthdata granule download | NOT RUN — Earthdata credentials required |
| Real PROVISIONAL SME2 HDF5 hierarchy/fill/flag verification | NOT RUN |

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

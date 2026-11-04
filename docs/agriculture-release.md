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

## Explicit SME2 algorithm stream and zero-clear DSG semantics

The cloud workflow and local analysis CLI expose \`algorithm=baseline|DSG\`, defaulting to \`baseline\`. The baseline continues to read the root SME2 measurement/quality layers. The opt-in DSG mode reads the separate \`algorithmCandidates/DSG\` soil-moisture, uncertainty and retrieval layers and verifies its own coordinate vectors against the root native grid before use.

NASA/JPL D-107677 Revision C defines both the root `/science/LSAR/SME2/grids/retrievalQualityFlag` and candidate `algorithmCandidates/DSG/retrievalQualityFlag` as zero=clear and non-zero=anomaly. Algorithm selection changes which measurement arrays and provenance are used, not the documented retrieval-flag interpretation. Both paths require valid moisture, finite non-negative uncertainty, fill screening, the shared surface-quality screen and AOI membership. The product specification is linked from the [ASF NISAR product-specification index](https://nisar-docs.asf.alaska.edu/product-specification/).

For DSG, dates with no valid AOI pixels are excluded from the plotted and statistical series and recorded in the study's \`quality_exclusions\` field. Each exclusion retains its acquisition date, granule filename, AOI pixel denominator and flag interpretation. No gaps are imputed. A DSG study requires at least four remaining dates; the baseline mode retains its existing fail-closed empty-date behavior. The website labels the selected algorithm and exposes the excluded dates, and its schema validator rejects a DSG package if the quality interpretation or exclusion audit is missing or inconsistent.

## Scientific boundaries

- Product: `NISAR_L3_SME2_PROVISIONAL_V1`, PROVISIONAL maturity.
- SME2 PROVISIONAL measurements are not fully calibrated; outputs remain exploratory.
- The current public index points to immutable release `agri-41647231453`, a checksum-verified Naogaon study using the separate DSG algorithm-candidate stream. It contains six valid dates (12 August, 24 August, 17 September, 29 September, 11 October and 23 October 2026) and four explicitly recorded dates excluded because no valid DSG AOI retrieval remained.
- No claim is made about crop stress, drought, irrigation need, crop type, field boundaries, yield or agricultural accuracy.
- The baseline is the first three unique observations in a compatible series; the target is the latest observation.
- The 20% AOI coverage floor is fixed. Below-floor target or change coverage is inconclusive.
- The reported change-layer uncertainty is currently the target observation's product uncertainty, not a propagated uncertainty for the difference.
- Synthetic HDF5 fixtures are test-only and never published.

## QA execution status

The most recent fully verified **Agriculture and project QA** run before the current cloud-handoff UI changes is [run #328](https://github.com/Rubai106/beyonders-wetland/actions/runs/41655750891), on commit `773c70b1b579a9c484e3b7539d90d9ed740c9022` on `Rubai-dev`. All 15 execution steps completed successfully:

| Automated check | Result |
|---|---|
| Python module and browser-test syntax compilation | PASS |
| Full offline Python regression suite | PASS |
| TypeScript unit/schema regression tests | PASS |
| ESLint | PASS |
| Next.js public-viewer production build | PASS |
| Whole-project TypeScript check | PASS |
| Chromium production-browser smoke tests | PASS |

Subsequent commits add the secure Actions handoff, stale-catalogue protection, preflight gating and browser regression coverage for those behaviors. Their new Actions result must be checked before calling the current head fully green; run #328 does not verify code committed after its SHA.

The QA workflow now keeps an active run from being cancelled by the next push. Its path filters include source, tests, public publication assets and root build configuration, so changes to published study packages also trigger regression checks.

| Current real-data / evidence item | Status |
|---|---|
| NASA CMR discovery and Earthdata-authenticated SME2 download | COMPLETED in cloud run [#41647231453](https://github.com/Rubai106/beyonders-wetland/actions/runs/41647231453) |
| SME2 analysis, package validation and public build | COMPLETED in cloud run [#41647231453](https://github.com/Rubai106/beyonders-wetland/actions/runs/41647231453) |
| Naogaon public display package | PUBLISHED as `agri-41647231453`; study and preview assets are checksum-referenced |
| Independent crop-mask support | NOT INCLUDED in the current release |
| IMERG rainfall context | NOT INCLUDED; missing windows remain unavailable rather than zero |
| Independent field validation and precision/recall/F1 | NOT RECORDED; no matched field reference is published |

A checksum-verified PROVISIONAL package establishes integrity relative to its manifest, not independent NASA digital signing or agricultural ground truth. The study remains exploratory.

## Next pilot plan

1. In `/agriculture`, choose a WGS84 study area and date window beginning no earlier than 17 June 2026, then run NASA CMR discovery.
2. Select only a series marked `PRE-FLIGHT PASS`. The website copies the exact AOI, date range, series ID, algorithm and optional-IMERG setting for the GitHub Actions inputs. Results are invalidated when the form changes; run discovery again after edits.
3. Open the linked cloud workflow on `Rubai-dev`, select **Run workflow**, and supply the copied inputs. The runner uses the `EARTH_DATA` Actions secret; never paste an Earthdata token into the website or the workflow input fields.
4. Review the resulting checksum-verified publication, dated quality exclusions, coverage and same-pixel cohort. Coverage below 20% remains inconclusive; gaps are never filled.
5. Add an independently sourced crop mask and matched field/soil observations before making crop-area or agricultural-accuracy claims. Rainfall context can be added when complete IMERG windows pass the spatial-coverage gate.

No raw HDF5 granules, native rasters or Earthdata credentials belong in Git.

## Cloud operation status

The cloud workflow on `Rubai-dev` supports both manual `workflow_dispatch` inputs and a push request file at `pipeline/agriculture-cloud-request.json`. The website now links to the manual workflow and prepares the exact AOI/date/series/algorithm inputs; the user still confirms **Run workflow** in GitHub Actions. The run requires the repository Actions secret `EARTH_DATA`. It downloads and processes the selected series on GitHub-hosted compute, builds the public site and commits only the checksum-verified display package to `Rubai-dev`. Raw HDF5 granules and native rasters remain on the runner; only non-sensitive receipts are retained as a 30-day Actions artifact.

The current Naogaon release was produced by successful cloud run [#41647231453](https://github.com/Rubai106/beyonders-wetland/actions/runs/41647231453). The website does not trigger processing silently or collect Earthdata credentials; it prepares a reviewable handoff to the authenticated GitHub workflow.

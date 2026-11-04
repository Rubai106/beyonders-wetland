# Agriculture / SME2 release and QA status

## Implemented product

The `/agriculture` workspace is a soil-moisture measurement explorer for real NISAR L3 SME2 PROVISIONAL products. It has map navigation, verified moisture/change previews, a real-acquisition timeline, statistics, CSV export, Operator command generation and an Evidence drawer. It does not synthesize results when no publication exists.

The operator pipeline is isolated in `pipeline/agriculture_sme2.py`. It can run locally or through the cloud-only GitHub Actions workflow `.github/workflows/agriculture-cloud.yml`; browser controls never receive Earthdata credentials. The cloud workflow uses an Actions secret for Earthdata authentication, processes exact granules on a GitHub-hosted runner, and commits only the compact display package and checksums to `public/agriculture/current`. Raw HDF5/NetCDF granules and native GeoTIFFs are not committed.

## Implementation review

The following implementation and safety changes are committed on `master`:

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

The documented surface flag contains bits 0–7. Values above 255 are not assigned a guessed meaning and remain excluded from the clear-pixel set. New publications retain a sorted histogram of the 16 most frequent raw out-of-range values, with a truncation marker when further values exist. Earlier releases that retained only the aggregate count remain valid and the UI explicitly identifies the missing raw histogram.

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

The browser has an acquisition-aligned rainfall timeline with four accumulation windows, explicit missing-state markers, spatial-coverage and half-hour-sample support, and an official NASA dataset link. It only appears for a checksum-verified study that contains a schema-valid rainfall context. The published Naogaon SME2 release does not contain rainfall context, so its browser state correctly remains unavailable rather than plotting zero rainfall.

The SME2 cloud run completed authenticated granule discovery/download, analysis, publication and the public build. It did not attach an IMERG series to the published study. Keep rainfall claims separate from the verified SME2 measurements; no rainfall values are inferred.

## Explicit SME2 algorithm stream and zero-clear DSG semantics

The cloud workflow and local analysis CLI expose \`algorithm=baseline|DSG\`, defaulting to \`baseline\`. The baseline continues to read the root SME2 measurement/quality layers. The opt-in DSG mode reads the separate \`algorithmCandidates/DSG\` soil-moisture, uncertainty and retrieval layers and verifies its own coordinate vectors against the root native grid before use.

NASA/JPL D-107677 Revision C defines both the root `/science/LSAR/SME2/grids/retrievalQualityFlag` and candidate `algorithmCandidates/DSG/retrievalQualityFlag` as zero=clear and non-zero=anomaly. Algorithm selection changes which measurement arrays and provenance are used, not the documented retrieval-flag interpretation. Both paths require valid moisture, finite non-negative uncertainty, fill screening, the shared surface-quality screen and AOI membership. The product specification is linked from the [ASF NISAR product-specification index](https://nisar-docs.asf.alaska.edu/product-specification/).

For DSG, dates with no valid AOI pixels are excluded from the plotted and statistical series and recorded in the study's \`quality_exclusions\` field. Each exclusion retains its acquisition date, granule filename, AOI pixel denominator and flag interpretation. No gaps are imputed. A DSG study requires at least four remaining dates; the baseline mode retains its existing fail-closed empty-date behavior. The website labels the selected algorithm and exposes the excluded dates, and its schema validator rejects a DSG package if the quality interpretation or exclusion audit is missing or inconsistent.

## Scientific boundaries

- Product: `NISAR_L3_SME2_PROVISIONAL_V1`, PROVISIONAL maturity.
- SME2 PROVISIONAL measurements are not fully calibrated; outputs remain exploratory.
- The current public index points to immutable release `agri-41647231453`, a checksum-verified Naogaon study using the separate DSG algorithm-candidate stream.
- The release contains six valid acquisition dates: 12 August, 24 August, 17 September, 29 September, 11 October and 23 October 2026. Four other dates are explicitly recorded as exclusions because no valid DSG AOI retrieval remained; they are not interpolated.
- Its change summary has 21.31% valid AOI coverage and its fixed all-date cohort has 21.28% coverage, only slightly above the fixed 20% policy floor. These are exploratory support measures, not evidence of broad representativeness.
- No independent crop mask, IMERG rainfall context, field reference or agricultural accuracy estimate is included in this release.
- No claim is made about crop stress, drought, irrigation need, crop type, field boundaries or yield.
- The baseline is the first three unique observations in a compatible series; the target is the latest observation.
- The 20% AOI coverage floor is fixed. Below-floor target or change coverage is inconclusive.
- The reported change-layer uncertainty is the target observation's product uncertainty, not a propagated uncertainty for the difference.
- Synthetic HDF5 fixtures are test-only and never published.

## QA execution status

The latest verified full-project QA run is [run #531](https://github.com/Rubai106/beyonders-wetland/actions/runs/41871546524), on `master` commit `382b530670af02a00bdb3ddbd7f82eb6272da44a`. The offline Python regression suite passed **179 tests** and the TypeScript suite passed **117 tests**; ESLint, the public production build, whole-project TypeScript checking, and every production-browser check also passed. The production-browser suite exercised Wetlands, Forests, Volcanoes, Chókwè, scattering and Agriculture. The Agriculture check verifies the out-of-range SME2 flag explanation, the top-16 histogram truncation contract, and evidence-panel visibility without horizontal overflow at tablet (768 px) and phone (390 px) widths. This is code, schema, build and browser verification—not a new authenticated Earthdata or Earth Engine acquisition, crop-mask validation or field-accuracy assessment.

Three earlier intermediate QA runs failed during the incremental changes: two exposed a Python manifest-field lookup error and one exposed a TypeScript schema-narrowing error. Those were corrected on `master`; the current head passed the complete suite. This is still code and browser verification, not a live authenticated Earthdata or Earth Engine acquisition test. The QA runner uses committed public study packages and offline fixtures; it does not prove that a new satellite acquisition or optional crop-mask workflow completed.

The `.github/workflows/agriculture-qa.yml` workflow now runs the Python suite, `npm test`, ESLint, the public production build, `npx tsc --noEmit` and production-browser tests on pushes to `master` and pull requests targeting `master` only. Its path filters include `public/**`, application source, tests and root build configuration. Active QA runs are not cancelled by later pushes.

The Agriculture pilot-preflight workflow is also aligned to `master`; it uses the current SME2 supported start date and checks out `master` explicitly.

| Current real-data / evidence item | Status |
|---|---|
| NASA CMR discovery and Earthdata-authenticated SME2 granule download | COMPLETED in historical cloud run [#41647231453](https://github.com/Rubai106/beyonders-wetland/actions/runs/41647231453) |
| SME2 analysis, package validation and public build | COMPLETED in historical cloud run [#41647231453](https://github.com/Rubai106/beyonders-wetland/actions/runs/41647231453) |
| Naogaon display package | PUBLISHED as `agri-41647231453`; study and previews are checksum-referenced in the current public index |
| Independent crop-mask support | NOT INCLUDED in the current release |
| IMERG rainfall context | NOT INCLUDED; missing windows remain unavailable rather than zero |
| Independent field validation and precision/recall/F1 | NOT RECORDED; no matched field reference is published |

The historical cloud run originally produced the package on `Rubai-dev`; that published package was subsequently brought into `master`. Future processing runs now check out and commit the display package directly to `master`. The checksum manifest protects against accidental changes relative to the published manifest; it is not a NASA digital signature or independent agricultural validation.

## Next pilot plan

1. In `/agriculture`, enter a valid WGS84 study rectangle and a date window beginning no earlier than 17 June 2026, then run NASA CMR discovery.
2. Select a compatible series marked `PRE-FLIGHT PASS`. The website prepares the exact AOI, date range, series ID, algorithm and IMERG fallback setting. Old results are invalidated automatically when the AOI or date window changes.
3. Copy the workflow inputs, open the linked cloud workflow on `master`, and select **Run workflow**. The GitHub-hosted runner uses the repository secret `EARTH_DATA`; never paste an Earthdata token into the website or workflow inputs.
4. Review the resulting publication, checksum manifest, dated quality exclusions, coverage and fixed-cohort support. Coverage below 20% remains inconclusive; gaps are never filled.
5. Add an independently sourced crop mask and matched field/soil observations before making crop-area or agricultural-accuracy claims. Rainfall context can be added when complete IMERG windows pass the spatial-coverage gate.
6. Keep all further Agriculture implementation and publication changes on `master`. Do not bulk-merge the diverged `Rubai-dev` branch; port only individually reviewed changes that are needed.

No raw HDF5 granules, native rasters or Earthdata credentials belong in Git.

## Cloud operation status

The cloud workflow is available on `master` and supports manual `workflow_dispatch` inputs plus an optional push request file at `pipeline/agriculture-cloud-request.json`. The website now links to the `master` workflow and prepares the exact AOI/date/series/algorithm inputs; the user still confirms **Run workflow** in GitHub Actions. The workflow requires the repository Actions secret `EARTH_DATA`. It discovers and downloads the selected compatible series, analyses the real SME2 granules, optionally attaches complete IMERG context, verifies the publication package, builds the public site and commits only the display package to `master`. Raw HDF5/NetCDF granules and native rasters remain on the runner; non-sensitive receipts are retained as a 30-day Actions artifact.

The currently published Naogaon study was produced in historical cloud run [#41647231453](https://github.com/Rubai106/beyonders-wetland/actions/runs/41647231453), originally on `Rubai-dev`, before its package was merged into `master`. New manual runs should select `master` in the workflow branch selector. The website does not trigger processing silently and never receives Earthdata credentials.

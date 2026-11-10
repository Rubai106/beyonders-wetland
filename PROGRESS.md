# GeoNexSAR v11 — Global Change Investigator

## Master migration — 2026-11-08 (Phase 1–4 work ported from Rubai-dev, file by file, no blind merge)

- Master is the canonical branch. The verified Phase 1–4 improvements from `Rubai-dev` (HEAD `fb3d445`, 6 local commits + uncommitted work) were reconciled against latest remote `master` (`f2dbdd2`) using `docs/PHASE4_BASELINE.md` and the port manifest + migration workbook (`~/workspace/beyonders-master-port/`).
- Ported: SHA-256 showcase integrity (fail-closed), `/observability` (7 studies, maturity ladder, Evidence Quality Explorer, Reproducible Investigation Capsule `GET /api/capsule/<id>`), `/lineage` (Evidence Lineage Explorer), security headers + enforcing CSP, API rate limiting (22 routes + geocode's own throttle), GeoTIFF download gating to operator mode, dead-component removal, and the Phase 2/3/4 docs.
- Deliberately kept from master: the 847-byte 2-case showcase index (Tanguar + Hakaluki), the 3D Field Volume / visual-refresh work, the newer homepage (reduced-motion guards, pin form, mobile nav), the newer registry wording for Wetlands, the catalogue min-date validation, and master's Dynamic World crop-mask / publication-index tests. The one real merge was `src/lib/showcase.ts` (verification + master's external-asset fields).
- `Rubai-dev` was kept intact as the recovery source until this master result is verified and pushed.

## Implemented

- Added place-name lookup through OpenStreetMap Nominatim. Searches are user-submitted, throttled, validated, attributed, and return explicit error/no-result states. Place lookup never creates scientific candidates.
- Added opt-in map-click pin selection to the worldwide map. A selected pin can create a small editable analysis rectangle and carry coordinates/place label into the local processing workflow. The UI explicitly says that this geometry is user-selected, not a wetland boundary or detection.
- Made the NASA catalogue step a clear availability/compatibility preflight: it shows returned scene dates/IDs, catalog hits, search-limit status and an explicit no-compatible-scenes message. Processing is available only for returned compatible observations.
- Added export builders for CSV, GeoJSON, JSON provenance snapshots and printable HTML reports with source, product maturity, date, run, reference status and caveats. Included share links for packaged showcase cases and run/date links for local analyses. A fresh candidate-layer load is count-checked against the pulse manifest; failures stay visibly unavailable and report exports remain disabled instead of implying zero candidates.
- Kept the existing real-data Wetland Time Machine, synchronized discrete timeline, comparison drawer, threshold challenge/sensitivity, independent-reference evidence, and region investigation controls.
- Integrated the Forest and Volcano modules from the master project into this website, including their global directories, published evidence pages, local processing APIs, and study artifacts. They remain scientifically separate from the Wetland detector.
- Updated the README with the new workflow, OpenStreetMap attribution, export/report details and limitations.

## Verification on this integration

- `npx tsc --noEmit --pretty false`: passed after fixing three existing type errors in the global NISAR workflow and wetland export selector.
- Manual browser smoke check: `/`, `/wetland`, `/forest/global`, `/forest/rondonia`, `/volcano/global`, and `/volcano/hayli-gubbi` rendered. Wetland case data and both published evidence pages loaded.
- Live volcano catalog returned 1,214 Smithsonian records during the check. Catalog and map tile availability still depends on external services.
- `git diff --check`: passed.
- The formal JavaScript/Python test suites and production build were not run for this integration. No new satellite processing was run.

## Scientific constraints

- A radar-change candidate is not confirmed flooding, forest loss, or ground deformation.
- The packaged Tanguar optical comparison remains inconclusive because common clear coverage is about 0.333% of the study mask, below the configured 20% minimum.
- Global imagery and acquisition footprints show observations/context, not global change classifications.
- Forest and Volcano pages and published studies are available; their outputs remain exploratory or publication-context evidence and are not global detection claims.
- Synthetic raster data exist only as temporary unit-test fixtures. They are not exposed by the web app or the production CLI.


## Step 7 — Agriculture / SME2 integration

- Added Agriculture to the phenomenon registry and shared investigation navigation without replacing the current Wetland, Forest or Volcano workspaces.
- Added /agriculture with interactive Leaflet map, basemap toggle, moisture/change layers, dated timeline, keyboard-operable percentile chart, Explore/Operator/Evidence drawers, CSV export and integrity-checked preview loading.
- Added online NASA CMR catalogue discovery with WGS84/date validation and deterministic compatible-series grouping. Eligible series now prepare a secure `master` GitHub Actions handoff with copyable AOI/date/series/algorithm inputs; the user explicitly confirms `Run workflow` in GitHub. The runner uses the `EARTH_DATA` secret; the browser never receives Earthdata credentials or launches processing silently.
- Added the isolated pipeline/agriculture_sme2.py search/download/analyze/publish workflow and unit fixtures. Quality screening handles uint8 bit fields safely under NumPy 2.x, and AOI coverage uses all pixels inside the AOI as its denominator.
- Added study schema and checksum validators with TypeScript tests.
- Added preflight safeguards to the website handoff: the worker's 17 June 2026 minimum date is reflected in the form, catalogue results are invalidated when AOI/date values change, and series below six unique acquisitions or 60 days cannot be prepared for processing. The production-browser regression covers eligible, below-gate, clipboard and stale-result states.
- Added a date-by-date spatial-support drift profile that compares each acquisition's own valid-footprint median with the fixed all-date cohort median. The visual gap and first-to-last gap shift expose when changing valid-pixel composition could alter the apparent time series; low coverage remains inconclusive and no pixels are filled.
- A checksum-verified Naogaon SME2 DSG study is now published as `agri-41647231453`, with six valid dates and four dated exclusions. The cloud processing, publication and public build completed in [run #41647231453](https://github.com/Rubai106/beyonders-wetland/actions/runs/41647231453). The release remains exploratory and has no independent crop mask, IMERG context or field-validation metrics.


## Agriculture observability gate — Steps 1A and 1B

- Added a per-date decoded SME2 surface-quality flag audit for the eight documented surfaceQualityFlag bits. Counts are AOI-bounded and explicitly non-exclusive; fill, invalid and unsupported encodings remain separate.
- Added an optional independently sourced single-band probability/binary GeoTIFF input. It must have a declared CRS, values in [0, 1], finer cell area than SME2 and buffered coverage of the complete target grid; coarse, invalid or incomplete masks fail closed.
- Added separate area-averaging of the thresholded crop indicator and source-data coverage onto the native SME2 EPSG:6933 grid. Fractional crop area is retained at native-cell boundaries; source gaps do not become non-crop.
- Added provenance (date/source/filename/SHA-256/CRS/areas/thresholds), per-date crop-area-weighted moisture summaries, and an exact fixed all-date intersection using the unchanged SME2 valid masks.
- Added interactive crop-area, per-cell Mask QA and all-date crop-cohort map layers, clickable date coverage bars, common-support status, source provenance and crop-support columns in CSV export. The mask coverage preview distinctly shows adequate, partial and absent source pixels. Published assets remain display-only previews and summaries; source GeoTIFFs/HDF5/native rasters stay local.
- Historical packages without crop observability remain valid. Missing masks display NOT ASSESSED; no AOI is assumed cropland.
- The strict surfaceQualityFlag == 0 and all other existing SME2 quality checks are unchanged. No independent crop mask or field-validation dataset is published; synthetic raster fixtures remain test-only.


## 2026-11-04 — Baniachong dual-track inspection (non-publishing)

- Authenticated CMR discovery and Earthdata downloads completed for ten SME2 acquisitions on each preflight series. Every granule was checked against its download receipt and SHA-256 before HDF5 inspection. Evidence is retained in the non-public Actions artifact for run [#41825328589](https://github.com/Rubai106/beyonders-wetland/actions/runs/41825328589).
- The root/baseline stream produced no quality-valid AOI pixels on either series (0/10 usable dates). The independently inspected DSG candidate stream produced five usable dates on each series (5/10); its dates are listed in the Actions summary.
- The exact DSG all-usable-date intersection is 681/986 AOI pixels (69.1%) for track 141 and 684/986 (69.4%) for track 069. These are AOI-wide spatial-support fractions, not crop-area coverage.
- Usable-date gaps are material: track 141 has a 48-day maximum interval between usable acquisitions; track 069 has a 72-day maximum. The 18-day cue in the summary is descriptive only, not a scientific acceptance threshold; no missing acquisition is interpolated.
- The date-level surface audit records 750 snow/ice-flag pixels on non-usable dates, 43 precipitation-flag pixels, and 236 out-of-range surface-flag encodings per acquisition. Unsupported encodings remain separate and are not reinterpreted.
- Added a testable, fail-closed summary generator for the candidate workflow. It cross-checks baseline/DSG identity, acquisition dates, usable-date counts, AOI bounds and exact-cohort counts before it renders the comparison and per-date timeline. Six regression tests cover gap derivation, report alignment, evidence consistency and the no-ranking caveat.
- **Decision:** neither track is ranked for agricultural suitability. No independent crop mask has been applied, no crop-area result is claimed, and no public Agriculture study or preview was created. The existing SME2 quality filters and public publication pointer are unchanged.


## 2026-11-09 — Chókwè GFM reference discovery (preflight only)

- Added a read-only STAC preflight for the exact Chókwè analyst-defined box (32.93–33.03°E, 24.58–24.48°S) and the 7–28 January 2026 window. It returns item IDs, dates, asset names and metadata only; it does not download raster pixels or produce flood metrics.
- Added a manual GitHub Actions workflow that saves the discovery report as a short-lived artifact. Continuous QA remains offline and does not depend on the external STAC service.
- Added offline regression tests for inclusive date queries, pagination, host validation, deduplication, no-result states and fail-closed datetime parsing.
- The source lead is EODC's published southern Mozambique GFM example, whose larger AOI contains the Chókwè box. Exact valid-pixel coverage over Chókwè is **not yet checked**.
- **Decision pending:** inspect the workflow artifact, then inspect the GFM ensemble flood, reference-water and exclusion masks over the exact box. Until those steps succeed, keep the Chókwè case unverified and do not publish an overlap or accuracy score.


## 2026-11-09 — Chókwè GFM close-date raster audit (in progress)

- Exact-AOI GFM STAC preflight completed successfully: 33 catalogue items across 12 dates in 7–28 January 2026, including three 17 January items at 03:18 UTC (about 24 minutes before the 03:42 UTC NISAR event).
- Added a bounded COG audit for the 17 January event-date items. It reads only the Chókwè AOI window from the ensemble flood, likelihood, observed-water, exclusion and reference-water assets, and reports source-valid coverage and raw value histograms.
- This is a raster-support check only. It does not calculate NISAR/GFM overlap or accuracy scores, and no raster value is assigned a scientific class until the version-matched GFM documentation is checked.
- **Pending:** inspect the raster audit artifact, check class/mask meanings and then decide whether any positive-support overlay is defensible.


## 2026-11-09 — Chókwè GFM close-date candidate overlay (pending)

- The exact-pixel audit found three 17 January 2026 GFM items over the same tile: 03:18:22 UTC (10.57% valid AOI coverage), 03:18:47 UTC (88.67%), and 03:19:12 UTC (0%). The middle scene is 23 minutes 45 seconds before the NISAR 03:42:32 UTC event timestamp.
- The selected 03:18:47 COG is tagged GFM NRT v4.1.0. On its 264,771 valid Chókwè AOI pixels, the observed-flood layer contains 25,130 value-1 pixels and 239,641 value-0 pixels; 62,948 valid pixels are flagged by the binary exclusion layer. The shared reference-water raster has 334 permanent-water and 827 seasonal-water pixel centers inside the AOI.
- Added a candidate-overlay calculation that rasterizes the published Chókwè NISAR GeoJSON onto the exact GFM 20 m grid, uses only common-valid support outside exclusion and reference-water masks, and reports positive overlap only. It explicitly notes that the polygons are simplified display geometries, not the private native NISAR classification raster.
- **Pending:** verify the GFM/NISAR positive-support overlap and confidence distribution from the next pixel-audit artifact. No accuracy, precision, recall or F1 score is produced.


## 2026-11-09 — GFM ensemble-consistency investigation

- The public GFM manual states that the ensemble flood mask is a two-of-three consensus from LIST, DLR and TU Wien and that binary flooded pixels should have likelihood values 50–100. A small set of 33 pixels in the January 17 COG appeared to violate the likelihood rule.
- The exact-AOI audit now reads the three intermediate algorithm flood masks on the same grid and compares their votes with the final ensemble binary layer. It also checks whether advisory flags coincide with low-likelihood ensemble-flood pixels.
- This is a product-internal consistency check. The close-date overlap remains positive-only cross-sensor support and is not field truth or an accuracy score.
- **Pending:** inspect the follow-up Actions artifact before deciding whether the COG's binary/likelihood inconsistency is material or explained by the intermediate algorithm layers/advisory flags.


## 2026-11-09 — GFM raw likelihood-input audit

- Added all three individual likelihood/uncertainty COGs (LIST, DLR and TUW) to the exact-AOI comparison. TUW's source layer is explicitly an uncertainty estimate; it must be inverted/harmonized according to the PDD before any comparison with the final ensemble likelihood.
- The audit now reports raw per-algorithm values on all low-ensemble-likelihood flooded cells and, separately, on the NISAR candidate overlap subset. It does not treat raw TUW uncertainty as flood likelihood.
- **Pending:** inspect the next artifact, then verify whether the harmonized component values reproduce the final ensemble likelihood within expected integer rounding.


## 2026-11-09 — Chókwè GFM close-date comparison completed

- The exact Chókwè AOI STAC preflight returned 33 items across 12 dates from 7–28 January 2026. Three items fell on 17 January; the 03:18:47 UTC COG was selected because it had 88.67% valid AOI coverage (the 03:18:22 item had 10.57%; 03:19:12 had 0%). The selected GFM NRT v4.1.0 20 m Sentinel-1 scene is 23 minutes 45 seconds before the 03:42:32 UTC NISAR event timestamp.
- On the selected scene's 264,771 valid AOI pixels, 25,130 were mapped as GFM flood and 239,641 as non-flood; 62,948 were flagged by the exclusion layer. Permanent and seasonal reference water were screened separately.
- The published NISAR display polygons rasterized to 81,843 pixels. After common-valid support, exclusion and reference-water masks, 40,449 candidate pixels (16.1796 km²) were eligible. GFM flood overlapped 15,931 of them (6.3724 km²), a positive-support fraction of 39.39% among eligible candidate pixels.
- The overlapping flood pixels have median GFM likelihood 76/100 (mean 78.30); 33 of 15,931 have likelihood below 50. Across the AOI, all 77 low-likelihood GFM flooded pixels still had two-of-three LIST/DLR/TUW flood votes; no binary-vote disagreement or advisory flag was recorded in the checked subset.
- The intersection is **not** an accuracy score: it uses simplified display polygons rather than the private native NISAR classification raster, and GFM is an independent satellite algorithm product rather than field truth. No precision, recall or F1 is reported. The public Chókwè case remains unverified.
- **Next gate:** recover the native NISAR classification raster from the saved Chókwè run and repeat the comparison on its original pixels. Preserve GFM valid, exclusion and reference-water masks separately; do not treat missing/excluded pixels as negatives.
- The full offline Python/TypeScript suites, lint, public build, type check and production browser suite passed on [QA run #659](https://github.com/Rubai106/beyonders-wetland/actions/runs/42631758988), commit `81bcf9146af339c277eae014d746d6a281429776`.

## 2026-11-09 — Chókwè native NISAR recovery implementation (not yet run)

- Added `pipeline/recover_chokwe_native.py`, a guarded reprocessing entry point pinned to the exact published baseline/event granules for run `ec8fa5ee15ae41d1aa89f930f2b47e36`.
- The request is assembled from the published run manifest, observation row, case-study method rules and exact operator-selected AOI polygon. It refuses to proceed if those source identities or bounds change.
- The script reconstructs the published processing parameters, re-extracts HH/HV and GCOV quality layers, reapplies the AOI/quality masks, and requires the native `classification_00.tif` plus four aligned masked inputs before recording a recovery manifest and SHA-256 checksums.
- Class code 0 is not interpreted as a negative reference label: the four masked HH/HV inputs are used to separate valid no-candidate pixels from invalid/no-data pixels.
- Added offline tests in `pipeline/test_recover_chokwe_native.py` and added both recovery modules to the project QA compile list.
- Added manual, credential-gated workflow `.github/workflows/chokwe-native-recovery.yml`. It defaults to `DO_NOT_RUN`, requires an explicit exact-pair confirmation, and stores output as a private 30-day Actions artifact. Local output defaults to `pipeline/output/chokwe-native-recovery/`.
- Added `docs/chokwe-native-recovery.md` with source identity, commands, workflow credentials and output contract.
- The recovery is **reprocessing, not restoration of the original TIFF bytes**. It does not publish to `public/`, does not change the production run pointer, does not rerun or upgrade the source HLS `INCONCLUSIVE` result, and does not calculate accuracy/precision/recall/F1.
- **Status:** implementation committed to `master`; independent Muse QA and any credentialed Earthdata reprocessing have not yet been performed. Native NISAR–GFM comparison remains a separate next gate.

## 2026-11-09/10 — Observability mobile overflow fixes (verified)

- Restored `contain: layout` on `.obs-matrix-scroll` after Muse isolated a 390 px page overflow (761/390) to the maturity matrix. Muse independently verified 390/390 after the fix; the matrix remains 980 px wide and internally scrollable.
- A separate pre-existing 360 px overflow (389/360) was isolated to long product/run-ID values in `.obs-facts dd`. Updated the facts grid to use shrinkable columns and allow long values to wrap anywhere. Application fix commit: `6ba71324e6ef67d98bb07b505e0e7bd4301a0dcd`.
- Muse independently verified the final application tree at `739d6a222ee32df93c99dcafc6b294a558a226b9`: `/observability` document width exactly matches viewport at 360, 390, 820, and 1440 px; all 36 facts rows across seven cards remain readable with no clipping; the maturity matrix remains internally scrollable and all seven studies / eleven columns remain reachable.
- `/agriculture` also passed at all four viewports; toolbar remains separate from Leaflet zoom controls.
- Full independent regression: 210/210 Python tests, 186/186 JS tests, lint, TypeScript check, public production build, and 477/477 browser-suite checks passed.
- GitHub Actions run `42682317233` completed successfully on application fix commit `6ba71324e6ef67d98bb07b505e0e7bd4301a0dcd`. The documentation-only HEAD `739d6a2` was not separately run by Actions at the time of Muse's audit.
- **Status: PASS.** The 390 px matrix regression and the 360 px facts-grid overflow are both independently verified resolved.

## 2026-11-10 — Desktop investigation drawer reflow fixes (Muse verified)

- Muse independently verified the Wetland region-register class-filter fix at 360, 390, 820, 961, 1024, 1440 and 1920 px. “Vegetation-related” is fully visible at every width, including the 338.4 px and 360 px desktop drawer columns; no control overlap or page overflow was found.
- Muse independently verified the Chókwè Learn case at the same widths. The content now reflows inside the drawer, the verdict and long scene IDs wrap, all comparison/CIMA figures render at usable sizes, and the case has no forced horizontal scrolling or content wider than the drawer.
- Muse rechecked the existing 360/390 px Observability and Agriculture protections; both routes remain viewport-width with the Agriculture toolbar separated from map zoom controls.
- Application CSS commits: `ffebe9ef5e70530e0a3797037509480ceb506c74` (class filter) and `2d1e1ab76d46125cd6375ec3e5a174ec14e2c80b` (Chókwè reflow). Muse tested exact HEAD `1e7f9d3b892b33cbefb2a2e4f673013ad70f069a`; production build passed. The two application commits each have successful CI runs.
- **Status: PASS.** O-3 and the Chókwè Learn drawer issue are closed. The empty second grid column beside Sort at 1440/1920 px is cosmetic only.
- **O-4 status: PASS.** Muse completed an unmocked real-browser Clipboard API success click-through: native write/read-back, exact URL-state preservation, expected success status, absent fallback UI, and fresh-tab restoration all verified. See the 2026-11-10 O-4 QA report.

## 2026-11-10 — Step 2B hydrograph smoke retest (CI verified)

- Rechecked commit `4cd149aba66a2fb139ba60c579c14297af9e0e12`, which changed the hydrograph smoke probe to read the current-value label and active-bar value in one browser evaluation so autoplay cannot advance between separate reads.
- The production QA workflow ran on descendant `2d1e1ab76d46125cd6375ec3e5a174ec14e2c80b` in Actions run [`42696147131`](https://github.com/Rubai106/beyonders-wetland/actions/runs/42696147131). The updated `wetland_smoke.py` ran twice; each run passed 122/122 checks with no application errors. Both logs show the live hydrograph current value matching the active bar and staying non-negative through the observed date transition.
- The run uploaded `wetland-step2b-browser-evidence-2d1e1ab76d46125cd6375ec3e5a174ec14e2c80b`. The workflow also passed the landing hydrograph smoke and the remaining project browser checks.
- **Status: PASS in production CI.** The Step 2B atomic-sampling regression is closed; this is separate from O-4's manual clipboard-success click-through.


## 2026-11-10 — O-4 clipboard success and Step 2B final confirmation (Muse verified)

- Muse tested exact `master` HEAD `e6e641c2536977335ff1954e23b08d77309b873c`; the application tree was unchanged from the successful production CI tree at `2d1e1ab76d46125cd6375ec3e5a174ec14e2c80b`. A fresh public production build completed successfully.
- **O-4: PASS.** In Chromium on a trustworthy localhost origin, Muse granted ordinary clipboard-read/write permissions and used the native Clipboard API without stubbing or monkey-patching. Clicking the visible **Copy direct region link** control wrote a URL that was read back from the native clipboard. The URL preserved the selected date, `VEGETATED_INUNDATION` filter, `RADAR` view, `SPLIT` map mode, candidate ID and `featured` case ID. The exact success status appeared; fallback UI remained absent. Opening the copied URL in a fresh tab restored the selected candidate, date, filter, modes and investigation drawer.
- **Step 2B atomic hydrograph check: PASS.** The `4cd149a` single-browser-task read of current value and active-bar value remains in `tests/e2e/wetland_smoke.py`; equality and non-negative assertions remain intact. Against the production build, two consecutive smoke runs each passed 122/122 checks with no application errors. Each sampled `24.5/24.5` six times, then `21.0/21.0` twice, demonstrating the animation's date transition without a mismatch.
- Evidence includes Muse's `o4-toast.png`, `o4-fresh-tab-restored.png`, native clipboard probe results, and both smoke logs. Muse did not modify source or tests.
- **Status: O-4 and the Step 2B atomic-sampling confirmation are PASS and closed.** Scope note: this commission verified the atomic hydrograph sample and ran `wetland_smoke.py` twice; it did not repeat the broader historical Step 2B scope (offline pipeline suites, all six browser suites, four-viewport chart review, or Step 2A reconfirmation). Do not treat those broader checks as newly run here.


## 2026-11-10 — Chókwè native-recovery credential gate verified

- Muse independently tested exact commit `84cf0583e4a24468ce3ad3a2c2c77dffd7e72716`. The workflow credential preflight passed the synthetic matrix: token only and username+password accepted; no credentials, username only and password only rejected; when all are present the token path takes precedence.
- `bash -n` passed. No synthetic values appeared in output. The native recovery workflow was not dispatched, the recovery script was not run, and no NASA/Earthdata endpoint or NISAR data was accessed.
- The manual-only trigger, `DO_NOT_RUN` default, exact-pair condition, pre-processing dry-run step order and 30-day private artifact retention remain intact. CI run [`42798753324`](https://github.com/Rubai106/beyonders-wetland/actions/runs/42798753324) passed on the exact tested HEAD.
- Credential preflight status: **PASS**. B-1 remains open until a credentialed exact-pair recovery package is produced, checksum/grid/class-count verified and compared with GFM on the native NISAR grid.

## 2026-11-10 — Native-grid Chókwè NISAR/GFM comparison path (implementation and review refinement; QA pending)

- Added `pipeline/compare_chokwe_native_gfm.py` to validate the private recovery manifest, pinned published-source hashes, native raster hashes, GCOV quality sidecar hashes, native class grid, four masked HH/HV inputs and AOI mask before comparison.
- The comparison uses the native NISAR classification grid as the grid of record. It samples GFM ensemble flood, likelihood, exclusion and reference-water values **and their validity masks** onto that grid with nearest-neighbour resampling. Native NISAR pixels are not resampled.
- OPEN_WATER and VEGETATED candidate classes are reported separately. GFM no-data, exclusion and permanent/seasonal reference-water intersections remain separate from the eligible denominator. Permanent (mask value 1) and seasonal (mask value 2) reference-water counts are now emitted separately, retaining the combined count for compatibility.
- The comparator reads `classification_00.tif` unmasked and reconstructs native validity from the four masked HH/HV inputs and wetland/AOI mask. The output explicitly warns that GeoTIFF metadata declares nodata=0 even though class 0 means valid "no candidate" inside native support; downstream consumers must not rely on that metadata alone.
- Added regression tests for permanent/seasonal count separation and for preserving all class-0 pixels when reading a nodata=0 categorical TIFF.
- Added synthetic offline tests for class-separated support, no-data/exclusion/reference-water denominator handling, nearest-neighbour sampling, valid-mask sampling, invalid class values, grid-shape mismatch, unambiguous recovery-artifact resolution and hash-tampering detection.
- Added manual workflow `.github/workflows/chokwe-native-gfm-comparison.yml`, which downloads a private native-recovery artifact from a specified completed Actions run and uploads a private 30-day comparison report. It does not launch recovery or require Earthdata credentials. Updated the QA compile list and `docs/chokwe-gfm-reference.md`.
- **Pending:** CI and Muse independent QA of this comparator and workflow. No recovered native raster package is available in this QA environment; no native-grid comparison or result has been produced. B-1 remains open.

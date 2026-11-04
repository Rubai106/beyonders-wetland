# GeoNexSAR v11 — Global Change Investigator

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

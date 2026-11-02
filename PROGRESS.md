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
- Added WGS84/date/run-ID validation and terminal command generation. Earthdata credentials remain in the terminal; the browser does not execute processing.
- Added the isolated pipeline/agriculture_sme2.py search/download/analyze/publish workflow and unit fixtures. Quality screening handles uint8 bit fields safely under NumPy 2.x, and AOI coverage uses all pixels inside the AOI as its denominator.
- Added study schema and checksum validators with TypeScript tests.
- Added a date-by-date spatial-support drift profile that compares each acquisition's own valid-footprint median with the fixed all-date cohort median. The visual gap and first-to-last gap shift expose when changing valid-pixel composition could alter the apparent time series; low coverage remains inconclusive and no pixels are filled.
- No Agriculture data are published. Live SME2 search/download, real-HDF5 metadata verification and local Earthdata processing remain not run in this connected session.

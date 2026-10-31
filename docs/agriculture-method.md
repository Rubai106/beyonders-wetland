# Agriculture / SME2 method and operator workflow

## Scope

The Agriculture workspace is a soil-moisture measurement explorer for the NASA/JPL NISAR Level-3 SME2 PROVISIONAL collection. It displays the baseline soilMoisture variable and a dated difference against the pixel-wise median of the first three observations in a selected compatible series.

This module does not classify crop type, identify field boundaries, diagnose crop stress, forecast drought, recommend irrigation, estimate yield, or claim agricultural accuracy. SME2 PROVISIONAL products are not fully calibrated. Results remain exploratory.

## Browser workflow

The /agriculture route uses the shared GeoNexSAR investigation workspace.

- **Explore:** checksum-verified moisture previews, per-date statistics, target-minus-baseline layer, timeline, P05–P95 range chart and CSV export.
- **Operator:** validated WGS84 AOI, date range and run ID; creates CLI commands for the local terminal. The browser does not start Earthdata downloads or local Python jobs.
- **Evidence:** product maturity, granule identity, source digests, retrieval/surface flag method, coverage floor and official sources.

When public/agriculture/current/index.json is absent, the page displays an explicit no-publication state. The basemap is context only; no synthetic map or measurements are substituted.

The browser verifies the byte count and SHA-256 of study.json and the active preview before displaying them. The checksum manifest is unsigned; it detects accidental corruption relative to the manifest, not malicious replacement of both files.

## Local operator workflow

Install the Python requirements using the repository's existing pipeline/requirements.txt and configure Earthdata Login through the terminal. Never place Earthdata credentials in the browser UI or commit them.

Example search:

~~~powershell
python pipeline/agriculture_sme2.py search --run-id agri-pilot-01 --west 90.20 --south 23.80 --east 90.60 --north 24.20 --start 2026-06-17 --end 2026-10-29
python pipeline/agriculture_sme2.py download --run-id agri-pilot-01
python pipeline/agriculture_sme2.py analyze --run-id agri-pilot-01
python pipeline/agriculture_sme2.py publish --run-id agri-pilot-01
~~~

The search command writes `pipeline/output/agriculture/<run-id>/search.json`. It groups CMR granules by their standardized product identity, deduplicates acquisition dates using the most recently updated CMR record, and requires at least four dates. The current discovery query reads at most 2,000 CMR results; if NASA reports more matches, it fails instead of silently using a truncated catalogue. Narrow the AOI or date range and search again. If multiple compatible series are returned, pass the selected `series_id` explicitly to `download --series-id`.

The download command re-resolves each exact CMR concept ID through earthaccess, requires the matching HDF5 granule filename, checks the SME2 grid hierarchy and writes a local SHA-256 receipt.

The analyze command reads only the files listed in that receipt. It resolves the primary baseline layers from the root SME2 grid group; it does not search nested algorithm-candidate groups for matching dataset names. The product specification lists `soilMoisture` and `soilMoistureUncertainty` at `/science/LSAR/SME2/grids/`, while candidate algorithms may carry separate datasets with the same names. These are not interchangeable.

SME2 uses the shared EASE-Grid 2.0 Global grid (EPSG:6933) at approximately 200 m posting. The reader requires the root `projection` dataset to resolve to EPSG:6933, verifies the root x/y axes against the measurement dimensions, and refuses incompatible grids rather than silently resampling. The surface-quality layer is resolved from the root grid or its documented ancillary-data location, as release tiers can differ. Granule filenames are parsed using the standardized track, direction, frame, bandwidth, polarization, frequency and release fields; the selected series must match those identities.

 It requires at least three baseline dates plus a later target, one consistent series signature, identical native raster dimensions/CRS/affine grid and a regular coordinate spacing. It does not resample incompatible grids. It writes native GeoTIFFs and display-only PNG previews under the local run output.

The publish command copies only study.json, the web checksum manifest and preview PNGs into public/agriculture/current. Native GeoTIFFs and original HDF5 granules remain in local operator storage.

## Quality protocol

- `soilMoisture` must be finite and in [0.02, 0.60] m³/m³.
- `soilMoistureUncertainty` must have a recognized volumetric soil-moisture unit, be finite and non-negative; declared fill values are excluded.
- `retrievalQualityFlag` is interpreted as a bit field. Bits 0–3 must all be set (recommended, attempted, successful, and within the product's moisture range); bits 4–7 must be clear. Values must be finite, integer-valued and within the stored 16-bit dataset range.
- `surfaceQualityFlag` is also a bit field. The current conservative screen accepts only value zero. This excludes pixels flagged for static water, urban area, precipitation, snow/ice, frozen ground, terrain or dense vegetation. In particular, the screen can reduce coverage in crop areas with dense vegetation; it is a quality-screening choice, not evidence that those excluded areas have no soil moisture.
- Missing/fill values and pixel centers outside the WGS84 AOI are excluded.
- Target and change coverage use the full AOI pixel count as the denominator, not only the valid subset.
- The minimum coverage floor is fixed at 20%. If target or change coverage is below that value, the study status is `INCONCLUSIVE_COVERAGE`.
- The baseline is the first three unique dates in the selected compatible series. The target is the latest unique date.
- The change summary's `uncertainty_median` currently reports the target-date uncertainty values for valid change pixels; it is **not** a propagated uncertainty estimate for the target-minus-baseline difference.

The NASA/JPL product specification defines the retrieval and surface flags as bit fields and identifies the root baseline moisture datasets separately from algorithm-candidate datasets. SME2 PROVISIONAL known-issues documentation warns that soil-moisture retrievals are not yet fully calibrated and flags may be null or incompletely implemented in some releases. Null, fill or unrecognized quality values are excluded, not converted into valid pixels.

## Verification

From the repository root:

~~~powershell
python -m unittest pipeline.test_agriculture_sme2 -v
python -m py_compile pipeline/agriculture_sme2.py pipeline/test_agriculture_sme2.py
node --experimental-strip-types --no-warnings=ExperimentalWarning --loader ./tests/strip-loader.mjs --test src/lib/agriculture-study.test.ts
npm run lint
npx tsc --noEmit
npm run build
~~~

No live Earthdata-authenticated SME2 search/download/analyze run is claimed by these unit tests. A real HDF5 granule must be inspected before asserting compatibility with a specific current collection release.

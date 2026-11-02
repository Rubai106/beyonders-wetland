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

## Surface-flag observability audit

Each new per-date study observation records a **surface-flag observability audit** from the SME2 surfaceQualityFlag layer. The diagnostic decodes the eight conditions documented in the product specification: static water, urban area, precipitation, snow/ice, permanent snow/ice, frozen ground, terrain and dense vegetation.

The audit reports the AOI denominator, decodable values, zero-valued surface flags, one-or-more flagged pixels, fill/invalid values and unsupported encodings. Per-bit counts are deliberately **non-exclusive**: a pixel carrying more than one bit appears in more than one reason row. Do not sum the reason rows as if they partition the AOI.

This explains one gate only. The existing acceptance rule remains unchanged: surfaceQualityFlag must equal zero, and the complete SME2 screen must also pass the retrieval flag, moisture range, uncertainty, fill and AOI tests. “Surface-flag clear” is not the same as “valid soil-moisture retrieval”. Dense-vegetation flags are relevant when assessing crop observability, but they do not identify crops or prove that all flagged pixels are cropland.

Fill and non-finite/fractional values are reported separately. Encodings outside the documented eight-bit range are reported as unsupported rather than relabelled. Historical packages without this optional field remain readable; the UI identifies the missing audit rather than reconstructing it.

## Spatial-support drift profile

The browser derives a support-composition gap for each acquisition date:

`gap(date) = median(date-valid pixels) - median(fixed all-date cohort)`

The date-valid median uses every AOI pixel passing that date's SME2 quality screen. The fixed-cohort median uses only native pixels that passed the screen on every date in the series. The two lines therefore summarize different spatial samples. Their date-by-date gap reveals whether a changing valid footprint could alter the apparent temporal trajectory; the change in that gap from the first to last date is a descriptive sensitivity measure.

This is not a correction to the SME2 product, a second moisture measurement, an accuracy estimate, or a crop-stress indicator. The all-date cohort may be spatially selective and must retain its actual AOI coverage. A cohort below 20% remains inconclusive; an empty cohort produces no profile. No missing pixels are filled and no cohort is widened.

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

## Temporal support-composition audit

The v2 study package adds a strict **same-pixel cohort** alongside the existing date-specific summaries.

For a series of compatible observations, the fixed cohort is the intersection of the AOI and every date's existing SME2 quality-valid mask:

`cohort = AOI ∩ valid(date 1) ∩ valid(date 2) ∩ … ∩ valid(date n)`

Each date is then re-summarized over that identical set of native grid cells. This keeps the spatial sample fixed across the plotted series; it does not change the SME2 retrieval, resample pixels, fill gaps, or weaken any quality flag. The original date-specific summaries and first-three-date baseline / latest-target difference remain available separately.

The package records the matched pixel count, fraction of all AOI pixels, status and one matched moisture preview per date. Status meanings are:

- `COMPARABLE`: the fixed cohort covers at least the existing 20% AOI floor.
- `INCONCLUSIVE_COVERAGE`: some common pixels exist, but the cohort covers less than 20% of the AOI.
- `NO_COMMON_PIXELS`: no pixel passed the quality screen on every selected date; no matched series or matched map is produced.

The UI can display the ordinary date-specific trajectory or the same-pixel trajectory. It also reports the **support-composition gap** for a selected date: date-specific median minus same-pixel median. This describes how the two spatial samples differ on that date; it is not a temporal moisture change, an accuracy score, or a physical cause. The CSV export includes both summaries and the gap.

The all-date intersection is intentionally strict. A low or empty cohort can be spatially unrepresentative, especially where SME2 flags or acquisition gaps move across dates. The app reports that limitation instead of expanding the cohort or interpolating missing values. A matched cohort is a comparability diagnostic, not proof that the remaining pixels represent every crop, soil type or part of the AOI.

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

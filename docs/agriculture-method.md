# Agriculture / SME2 method and operator workflow

## Scope

The Agriculture workspace is a soil-moisture measurement explorer for the NASA/JPL NISAR Level-3 SME2 PROVISIONAL collection. It displays the baseline soilMoisture variable and a dated difference against the pixel-wise median of the first three observations in a selected compatible series.

This module does not classify crop type, identify field boundaries, diagnose crop stress, forecast drought, recommend irrigation, estimate yield, or claim agricultural accuracy. SME2 PROVISIONAL products are not fully calibrated. Results remain exploratory.

## Browser workflow

The /agriculture route uses the shared GeoNexSAR investigation workspace.

- **Explore:** checksum-verified moisture, change, independent crop-area and all-date crop-cohort previews; per-date statistics, timeline, support audits and CSV export.
- **Operator:** validated WGS84 AOI, date range and run ID, plus an optional local crop-mask path and provenance label; creates CLI commands for the local terminal. The browser does not upload masks or start Earthdata downloads/local Python jobs.
- **Evidence:** product maturity, granule identity, source digests, retrieval/surface flags, crop-mask provenance, coverage floors and official sources.

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

## Exact surface-flag overlap atlas (Step 1C)

New analyses also retain the exact non-zero eight-bit surfaceQualityFlag values found inside the AOI, grouped by raw bit pattern. Each pattern is a mutually exclusive pixel group: a pixel with mask 0x05, for example, appears once in that pattern, while it contributes to both the static-water and precipitation marginal counts above.

The published flag_combinations array stores each integer mask and its pixel count, sorted by descending frequency and then ascending mask. Its counts must sum exactly to flagged_pixels; the browser publication validator also reconstructs every per-bit marginal count from those masks and rejects inconsistent packages. The eight columns in the interactive atlas show which documented bits are set for each signature. Selecting a row reveals its hexadecimal mask, named conditions, AOI share and encoded-pixel share. The interface initially shows the eight most frequent signatures and can expand to the full list.

The distinction is important:

- **Marginal reason counts** answer how many pixels contain each individual bit. These counts overlap and must not be added together.
- **Exact signatures** answer how many pixels have each complete combination of documented bits. These rows are mutually exclusive and reconcile to the total flagged-pixel count.
- Fill, invalid and unsupported encodings remain separate from valid eight-bit signatures; they are not coerced into a synthetic flag combination.

The CSV export preserves the marginal counts and exact signatures as separate JSON columns, alongside the AOI, encoded, clear, flagged, fill, invalid and unsupported totals. Historical schema-v2 packages without flag_combinations remain readable and show an explicit “not recorded” state rather than fabricating combinations.

This is an audit of the stored bitfield only. It does not identify the underlying physical cause, crop type, field boundary or a crop-specific exclusion. The quality rule remains surfaceQualityFlag == 0 with all existing SME2 retrieval, moisture, uncertainty, fill and AOI checks unchanged. The overlap atlas does not turn a flagged pixel into a valid measurement or provide a quality correction.

## Independent crop-mask observability gate

The optional **Step 1B crop-area gate** tests whether the selected AOI contains independently mapped crop area that also remains observable under the existing SME2 quality screen. It does not infer cropland from moisture, surface flags or AOI geometry.

### Input contract and command

Supply a local, single-band GeoTIFF with a declared CRS and values in [0, 1]. Values may be binary (0/1) or probabilities. Class IDs, RGB masks, multi-band files, rasters without CRS, source pixels coarser than the SME2 native cell area, and rasters that do not cover the full clipped SME2 grid extent are rejected. Export the source mask with a buffer around the AOI so edge cells are not falsely treated as fully observed.

Example (PowerShell; run after the regular search and download commands):

~~~powershell
python pipeline/agriculture_sme2.py analyze --run-id agri-pilot-01 --crop-mask "D:\data\crop-probability.tif" --crop-mask-source "Dynamic World V1 · crops probability" --crop-mask-date 2026-07-18 --crop-probability-threshold 0.5 --crop-mask-coverage-floor 0.8
~~~

The Operator tab can generate the optional arguments. The path is read by the local Python process. The browser does not transmit the GeoTIFF. The source label and date must identify the actual collection/product and source observation window; do not write "Dynamic World" unless that is the exact data product used.

### Native-grid aggregation

The pipeline thresholds source pixels at the recorded probability threshold (default 0.50), then area-averages the binary crop indicator onto each native SME2 cell using Resampling.average in the SME2 EPSG:6933 equal-area grid. It independently area-averages a valid-source indicator. The workbench exposes this as a separate Mask QA map layer, so a mapped non-crop cell is not visually indistinguishable from missing or incomplete source data. These outputs must not be conflated:

- **Source coverage** is the share of a target cell for which a valid source value exists. A target cell is eligible only when this reaches the configured within-cell floor (default 0.80).
- **Crop fraction** is the crop-classified share of the *complete* SME2 target cell. It remains fractional at field boundaries; missing source data are not re-normalized into crop or non-crop.
- The sum of eligible crop fractions is reported as crop-area-equivalent SME2 pixels. It is an area accounting unit, not a count of whole fields or a number of independent samples.

The AOI footprint uses the same SME2 pixel-centre selection as the original moisture analysis. Cells outside the AOI, or with insufficient valid mask coverage, receive no crop weight. No coarse mask is upsampled to create finer detail. The selected source file's byte count, SHA-256, CRS, cell-area estimate, date/label, threshold and coverage policy are recorded in the study package. The Mask QA preview colours each AOI cell as meeting the source-coverage floor, partially covered, or having no valid source coverage; it is generated from the uncollapsed per-cell coverage array, independently of the crop-fraction preview.

### Date-specific and fixed crop support

For acquisition date t, crop-area support is the sum of crop fractions for native cells passing the unchanged SME2 quality screen on date t. Crop coverage(t) is valid crop area(t) divided by total mapped crop area.

The pipeline reports a crop-area-weighted empirical median, P05, P95 and product uncertainty for each date. Weights are fractional crop-area equivalents, not equal whole-cell counts. The fixed crop cohort is the strict intersection of native cells with positive mapped crop fraction that pass the existing SME2 screen on **every** selected date. Each date's weighted summary is then recalculated over that identical common support.

No missing SME2 pixels are filled, no flagged pixels are accepted, and the surfaceQualityFlag == 0 rule is not relaxed. The crop cohort is a support-comparability diagnostic; a spatially small cohort may not represent every crop, field or soil type.

### Status interpretation

- `COMPARABLE`: mask coverage meets the 20% AOI policy floor and valid crop support/common support covers at least 20% of mapped crop area.
- `INCONCLUSIVE_COVERAGE`: some common crop support exists, but it covers less than 20% of mapped crop area.
- `INSUFFICIENT_MASK_COVERAGE`: less than 20% of AOI native cells meet the within-cell source-coverage floor. This takes precedence over a no-crop status because missing source data cannot establish that an area is non-crop.
- `NO_CROP_SUPPORT`: no eligible crop area remains after adequate source-mask coverage has been established.
- `NO_COMMON_CROP_SUPPORT`: mapped crop area exists, but no crop-supported native cell passed SME2 quality on every date.
- Per-date `NO_VALID_CROP_SUPPORT`: no crop-weighted SME2 pixel is valid on that acquisition.

The 20% gates are conservative comparability policy thresholds, not validated universal scientific standards. A higher mask-coverage requirement can be chosen for a study, but a threshold change must be explicitly versioned and reviewed; it must not silently lower the policy floor.

### Publication and interpretation boundary

The raw crop-mask GeoTIFF, original HDF5 files and native raster arrays remain in local operator storage. Publication includes only the display-only PNG support previews, derived weighted summaries, mask provenance and integrity checksums. If no mask is supplied, the UI says **NOT ASSESSED**; the AOI is never assumed to be cropland.

A Dynamic World crop-probability layer is cropland-likelihood context, not crop-species identification, a verified field boundary, or independent ground truth. A mask threshold does not prove crop identity. **SME2's native-cell estimate remains a cell-scale measurement that can mix crop and non-crop land.** Weighting a mixed cell by its mapped crop fraction improves area accounting but does not retrieve moisture from only the cropped sub-pixels. The result is a crop-area-weighted summary of native-cell SME2 surface-soil-moisture estimates, not crop-only moisture, root-zone moisture, crop health, yield or irrigation need.

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

# Agriculture / SME2 method and operator workflow

## Scope

The Agriculture workspace is a soil-moisture measurement explorer for the NASA/JPL NISAR Level-3 SME2 PROVISIONAL collection. It displays the baseline soilMoisture variable and a dated difference against the pixel-wise median of the first three observations in a selected compatible series.

This module does not classify crop type, identify field boundaries, diagnose crop stress, forecast drought, recommend irrigation, estimate yield, or claim agricultural accuracy. SME2 PROVISIONAL products are not fully calibrated. Results remain exploratory.

## Browser workflow

The /agriculture route uses the shared GeoNexSAR investigation workspace.

- **Explore:** checksum-verified moisture, change, independent crop-area and all-date crop-cohort previews; per-date statistics, timeline, support audits and CSV export.
- **Operator:** enter a WGS84 AOI and date range, then search NASA CMR directly from the website. The server groups returned SME2 granules by the full release/track/direction/frame/bandwidth/polarization/frequency identity, deduplicates same-date records and shows actual acquisition dates, revisit gaps and preflight eligibility. This public metadata search does not require Earthdata authentication and does not download granules or claim valid pixels.
- **Hosted processing:** the intended next stage will hand a selected CMR series to a private, authenticated processing worker. The worker must keep Earthdata tokens, original HDF5 granules and native rasters outside the public Next.js runtime and publish only a reviewed checksum-verified display package. The hosted worker is not yet configured; do not interpret a catalogue preflight as a processed study.
- **Evidence:** product maturity, granule identity, source digests, retrieval/surface flags, crop-mask provenance, coverage floors and official sources.

When public/agriculture/current/index.json is absent, the page displays an explicit no-publication state. The basemap is context only; no synthetic map or measurements are substituted.

The browser verifies the byte count and SHA-256 of study.json and the active preview before displaying them. The checksum manifest is unsigned; it detects accidental corruption relative to the manifest, not malicious replacement of both files.

## Maintainer-only local processing fallback

This fallback is for maintainers validating or reprocessing a study from a trusted workstation. It is not the intended website-user workflow. End users should be able to submit a selected series from the website once the authenticated hosted worker has been deployed. Never place Earthdata credentials in the browser UI or commit them.

Example SME2 processing, optional IMERG context, then publication:

~~~powershell
python pipeline/agriculture_sme2.py search --run-id agri-pilot-01 --west 90.20 --south 23.80 --east 90.60 --north 24.20 --start 2026-06-17 --end 2026-10-29
python pipeline/agriculture_sme2.py download --run-id agri-pilot-01
python pipeline/agriculture_sme2.py analyze --run-id agri-pilot-01
python pipeline/agriculture_sme2.py rainfall --run-id agri-pilot-01
python pipeline/agriculture_sme2.py publish --run-id agri-pilot-01
~~~

The optional rainfall command reads the analyzed SME2 dates/AOI, discovers the exact daily GPM IMERG Final V07 granule dates needed for preceding windows, and downloads selected CMR concept IDs with Earthdata authentication through earthaccess. It uses CMR/Earthdata Cloud discovery and does not construct legacy on-premises GES DISC URLs. Earthdata credentials remain local to the operator process.

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

The existing local pipeline can read this file during maintainer-only processing. The website worker still needs a private storage/upload path and recorded source provenance before this mask can be supplied online. The source label and date must identify the actual collection/product and source observation window; do not write "Dynamic World" unless that is the exact data product used.

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
- `retrievalQualityFlag` must be finite, integer-valued and zero. NASA/JPL D-107677 Revision C defines zero as clear and non-zero as anomaly for both the root SME2 grid layer and the separate algorithm-candidate layers. Non-zero, fractional, missing and fill encodings are excluded.
- `surfaceQualityFlag` is also a bit field. The current conservative screen accepts only value zero. This excludes pixels flagged for static water, urban area, precipitation, snow/ice, frozen ground, terrain or dense vegetation. In particular, the screen can reduce coverage in crop areas with dense vegetation; it is a quality-screening choice, not evidence that those excluded areas have no soil moisture.
- Missing/fill values and pixel centers outside the WGS84 AOI are excluded.
- Target and change coverage use the full AOI pixel count as the denominator, not only the valid subset.
- The minimum coverage floor is fixed at 20%. If target or change coverage is below that value, the study status is `INCONCLUSIVE_COVERAGE`.
- The baseline is the first three unique dates in the selected compatible series. The target is the latest unique date.
- The change summary's `uncertainty_median` currently reports the target-date uncertainty values for valid change pixels; it is **not** a propagated uncertainty estimate for the target-minus-baseline difference.

The NASA/JPL product specification defines retrievalQualityFlag = 0 as clear and non-zero as anomaly for both the root baseline and algorithm-candidate datasets. It identifies root baseline moisture datasets separately from algorithm candidates. SME2 PROVISIONAL known issues warn that estimates are not yet fully calibrated and some candidate algorithms may have spatial gaps. Null, fill or unrecognized quality values are excluded, not converted into valid pixels.

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

## Event-aligned rainfall context (optional)

The Agriculture pipeline can attach NASA GPM IMERG Final daily precipitation as coarse-scale temporal context. It is not an SME2 measurement, independent field validation or proof that rainfall caused a soil-moisture change.

- Product: GPM IMERG Final Precipitation L3 1-day, 0.1° × 0.1°, Version 07 (collection GPM_3IMERGDF; product GPM_3IMERGDF_V07), DOI [10.5067/GPM/IMERGDF/DAY/07](https://doi.org/10.5067/GPM/IMERGDF/DAY/07).
- Daily field: the V07 daily NetCDF4 precipitation field is expressed as a daily mean rate in mm/day. NASA defines it from the mean valid half-hourly rate (mm/hour) multiplied by 24. The daily file also provides precipitation_cnt, the number of contributing half-hourly inputs (0–48). The pipeline reads both fields; it does not apply the half-hourly ×0.5 conversion to a daily product.
- Windows: for each SME2 acquisition date, the 1-, 3-, 7- and 12-day windows sum daily IMERG estimates for complete UTC days strictly before the SME2 calendar date. The acquisition day is excluded because this browser contract does not carry a validated exact SME2 observation time.
- Spatial support: keep IMERG at its native 0.1° grid. Each intersecting cell is weighted by the spherical area of its overlap with the WGS84 AOI rectangle. This produces an AOI-area-weighted context summary; it does not create field-scale or 200 m precipitation data.
- Spatial completeness: a daily AOI mean is numeric only when cells covering at least 90% of the AOI-overlap grid-cell area have valid precipitation and a valid, non-zero half-hourly sample count. This is a conservative implementation gate, not a NASA-certified universal threshold. The window reports its minimum daily spatial coverage; no-data is never converted to zero rainfall.
- Temporal completeness: a window is numeric only when every expected daily granule has a usable AOI summary. Otherwise its total is null and its valid/expected day counts remain visible. The UI also exposes minimum AOI grid coverage and mean half-hourly samples per day.
- Provenance: the study records each CMR concept ID, UTC date, original filename, byte count and SHA-256. source_sha256 is the digest of the canonical sorted granule-receipt list; the published study checksum protects that provenance block. Original NetCDF4 granules and per-day diagnostics stay in ignored local operator storage.
- Access: discovery uses NASA CMR; downloads use Earthdata authentication through earthaccess. NASA's migration guidance directs users to Earthdata Cloud and CMR-based granule discovery rather than constructing URLs for retired on-premises GES DISC hosts.
- Interpretation: rainfall/moisture co-variation is descriptive temporal context only. It does not establish causality, calibration, crop stress, drought status or irrigation need.

If CMR finds no files, a granule fails validation, or no complete window meets the spatial-support gate, the rainfall command fails without adding partial or synthetic rainfall context to the SME2 study. The rainfall panel remains unpublished until a real checksummed context is attached and the subsequent publish command completes.

## Verification

From the repository root:

~~~powershell
python -m unittest pipeline.test_agriculture_sme2 pipeline.test_agriculture_imerg -v
python -m py_compile pipeline/agriculture_sme2.py pipeline/agriculture_imerg.py pipeline/test_agriculture_sme2.py pipeline/test_agriculture_imerg.py
node --experimental-strip-types --no-warnings=ExperimentalWarning --loader ./tests/strip-loader.mjs --test src/lib/agriculture-study.test.ts
npm run lint
npx tsc --noEmit
npm run build
~~~

No live Earthdata-authenticated SME2 search/download/analyze run is claimed by these unit tests. A real HDF5 granule must be inspected before asserting compatibility with a specific current collection release.


## Explicit algorithm selection: root baseline versus DSG candidate

The analysis command exposes two separate inputs and defaults to the existing root baseline:

~~~bash
python pipeline/agriculture_sme2.py analyze --run-id agri-pilot-01 --algorithm baseline
python pipeline/agriculture_sme2.py analyze --run-id agri-pilot-01 --algorithm DSG
~~~

The cloud request file uses the same `algorithm` field (`baseline` or `DSG`). This is an explicit product choice, not an automatic fallback. The root baseline reads the root `/science/LSAR/SME2/grids/` measurement layers. The DSG path reads only `/science/LSAR/SME2/grids/algorithmCandidates/DSG/` for its separate soil-moisture, uncertainty and retrieval-quality arrays. It requires the candidate's own x/y coordinates to match the root native grid; equal array shapes alone are not enough. If the DSG group has no separate surface-quality dataset, it uses the product's shared root `surfaceQualityFlag` layer.

**Both retrieval-flag layers use the same documented semantics.** NASA/JPL D-107677 Revision C defines `retrievalQualityFlag == 0` as clear and non-zero as anomaly for both the root SME2 grid layer and DSG candidate layer. Algorithm choice selects distinct measurement arrays and provenance; it does not change the flag meaning. The other quality gates remain in force for both modes: valid volumetric moisture range, finite non-negative uncertainty, valid fill values, the common surface-quality screen and AOI membership. See the [NASA/JPL SME2 product specification](https://nisar-docs.asf.alaska.edu/product-specification/) and the [ASF SME2 guide](https://nisar-docs.asf.alaska.edu/sme2/).

The DSG mode retains source-date ordering but excludes any acquisition with zero usable AOI pixels after its selected algorithm's quality screen. Every excluded date is recorded in \`quality_exclusions\` with its granule name, total AOI denominator, zero valid-pixel count and retrieval interpretation. No value is interpolated, copied forward, or interpreted as dry soil. At least four valid DSG dates are still required (three valid baseline dates and one later target). The study displays the selected algorithm label and the exclusions; the browser validator rejects missing or inconsistent DSG provenance. The diagnostic artifact retains the per-date full-scene and candidate-layer audit.

This candidate analysis is still exploratory: it does not transform SME2 PROVISIONAL data into calibrated ground truth, and it is not a validated crop-stress or irrigation product. Compare the algorithm outputs as distinct product streams, not as if they were interchangeable layers from one retrieval.

## Cloud-only processing (recommended)

A cloud-only GitHub Actions workflow is available at `.github/workflows/agriculture-cloud.yml`. It runs on GitHub-hosted compute and does not require a local Python environment or manual satellite-file downloads. The canonical development and publication branch is `master`. Start a manual run from the GitHub website by opening the Agriculture cloud workflow on `master`, or create/edit `pipeline/agriculture-cloud-request.json` on `master` to trigger the push-based workflow. Use the request fields `west`, `south`, `east`, `north`, `start`, `end`, optional `series_id`, and optional `allow_missing_imerg`.

Before the first run, add a repository Actions secret named `EARTH_DATA` containing a NASA Earthdata Login token. Do not place credentials in workflow inputs, source files, issue comments, or commits. The workflow passes the token only as an environment variable to `earthaccess.login(strategy="environment", persist=False)`.

The workflow discovers compatible SME2 series, downloads exact granules, analyzes the selected series, attempts to attach IMERG Final daily context, verifies source receipts, builds the public website, and publishes the web-ready package. It commits only `public/agriculture/current` to `master`; raw HDF5/NetCDF granules and local processing directories are not committed. Non-sensitive receipts are retained as a GitHub Actions artifact for 30 days.

If the IMERG Final product has no matching granules or no complete 90%-coverage rainfall window, the default workflow setting permits the valid SME2 package to publish without rainfall context and records that limitation in the workflow summary. Other rainfall processing errors still fail the run. Disable **allow_missing_imerg** when rainfall context is mandatory.

The workflow is deliberately restricted to `master`. A run can fail if the selected AOI/date range yields no compatible SME2 series, or if multiple equally ranked series require an explicit series ID. Do not weaken the quality gates to force a publication.


## Cloud acquisition of independent Dynamic World crop evidence

The manual Agriculture Dynamic World crop observability workflow provides a cloud-only source-acquisition path for the Baniachong pilot. It reads GOOGLE/DYNAMICWORLD/V1 from Earth Engine and exports a 10 m EPSG:6933 median of the generic crops probability band, plus a separate count of distinct valid UTC acquisition dates per pixel. Daily median mosaics are built before the across-window median/count so overlapping tiles from one date do not count as multiple observations.

The probability raster requires at least three valid acquisition dates per pixel by default. Cells below that floor are NoData in the probability GeoTIFF; the count raster keeps zeros and lower counts to expose gaps. A 600 m buffer is exported around the requested WGS84 AOI so the existing SME2 crop-mask alignment can verify complete native-grid coverage. The workflow records source image IDs, unique acquisition dates, latest-scene recency, raster checksums, grid metadata and the exact requested time window.

Credentials: create or select a Google Cloud project, register it for Earth Engine, enable the Earth Engine API, and create a service account. Grant the narrow Earth Engine Resource Viewer role and Service Usage Consumer only if the project requires it. Store the JSON key as EARTH_ENGINE_SERVICE_ACCOUNT_JSON and the project ID as EARTH_ENGINE_PROJECT in repository Actions secrets. The credentials are passed only to the acquisition step and are never written to the repository or uploaded as an artifact.

Evidence boundary: Dynamic World is near-real-time 10 m Sentinel-2-derived land-cover probability. The crops band is generic crops likelihood, not rice-species identification, a verified parcel boundary, or ground truth. A window-level median is not a date-specific crop state for each SME2 acquisition. Review its date range, the gap from the latest valid scene to the requested window end, and the separate valid-observation-count raster before using it. The workflow creates a time-limited 30-day Actions artifact that is not committed to Git; artifact access follows the repository's Actions permissions. It does not call agriculture_sme2.py analyze, rainfall, or publish, and it does not modify public/agriculture/current.

A successful download is not an automatic go decision. The existing probability range, CRS, 10 m pixel support, buffered-coverage, area-weighting and all-date SME2 quality checks remain mandatory.

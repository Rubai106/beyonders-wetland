# Agriculture research and novelty design review

**Review date:** 2 November 2026  
**Repository branch:** Rubai-dev  
**Decision:** Build a support-aware, event-centred crop-water response investigation. Do not build another generic crop-health dashboard.

## Executive decision

The next Agriculture milestone should be an **Agricultural Observability Gate**, followed by a **Water-to-Canopy Response Audit**.

The present Agriculture module is a careful NISAR SME2 PROVISIONAL soil-moisture explorer. It has source identity checks, local Earthdata processing, strict quality screening, per-date summaries, a fixed all-date pixel cohort, a spatial-support drift profile, and checksum-verified publication. The code now accepts an optional independently sourced fine-resolution crop-probability GeoTIFF, area-aggregates it to the native SME2 grid, and reports per-date and fixed-cohort crop support with provenance. No real Agriculture crop mask or Earthdata pilot has yet been processed/published; HLS vegetation time series, GPM precipitation context, and field validation remain future steps.

The best differentiator is not another index, map, or AI-generated crop score. It is a reproducible evidence chain that answers:

> For independently identified crop-covered parts of a field or study area, did a rainfall event coincide with an observable NISAR surface-soil-moisture response, and was a later canopy response visible in quality-screened optical observations?

The workflow must also show where this question **cannot** be answered: crop-mask uncertainty, SME2 flags, sparse acquisitions, cloud/shadow gaps, different spatial supports, missing field observations, or a provisional product release.

This is a product/workflow contribution, not a claim that rainfall–soil-moisture–vegetation lag analysis has never been studied. Public research already contains such methods, including recent work in heterogeneous tropical agriculture.

## 1. What is already in the repository

The existing implementation is the baseline; the next phase must extend it rather than duplicate it.

- The Agriculture Python pipeline discovers compatible SME2 granules through NASA CMR, re-resolves exact concept IDs, downloads through Earthdata, validates HDF5 identity/units/grid, applies a strict quality screen, and publishes display assets only.
- SME2 observations are kept on the native EASE-Grid 2.0 grid. Incompatible grids and mixed product signatures are rejected rather than silently resampled.
- The baseline is the pixel-wise median of the first three observations; the target is the latest observation.
- The v2 study package includes the strict intersection of pixels that passed the SME2 screen on every date, plus a date-by-date spatial-support drift diagnostic.
- The UI has map/timeline exploration, CSV export, operator command generation, evidence/provenance and interpretation limits.
- The public workspace explicitly shows an empty publication state when no genuine Agriculture study exists.

**Important readiness boundary:** the current repository documentation says that no real Agriculture study has been published and no Earthdata-authenticated SME2 processing run has been verified in this workflow. Passing CI demonstrates code/build/test integrity, not the availability or agricultural validity of a real dataset.

## 2. Research and product landscape

### 2.1 NISAR SME2: useful, but not a finished crop-health measurement

The ASF NISAR SME2 guide describes a nominal 200 m pixel spacing and, on average, two observations every 12 days. The 5+5 MHz product is aggregated to 400 m while retaining the 200 m posting. It is a surface-soil-moisture estimate, not a root-zone moisture measurement or a crop-health score.

The ASF guide also states that dense vegetation (vegetation water content above 5 kg/m²) and precipitation-period estimates may be flagged as potentially unreliable. The PROVISIONAL collection is not fully calibrated. The known-issues page says the PROVISIONAL release has validation at a limited set of sites and that the SME2 workflow needs longer time series of fully calibrated GCOV inputs before some calibration/validation metrics can be computed. In quad-pol areas, the SME2 processing can also leave swath gaps where one or more of the three algorithms may not provide an estimate.

**Implication:** an agricultural application must measure its usable crop-area support per acquisition. It must not weaken the existing quality mask to make the map look more complete. A pixel excluded by a quality flag is unassessed for this workflow, not a dry pixel, a healthy pixel, or proof that the field has no moisture.

### 2.2 HLS: the canopy-response source

NASA HLS harmonizes Landsat 8/9 and Sentinel-2 into analysis-ready surface reflectance at 30 m. NASA reports an average revisit of about 1.4 days across the constellation, but actual clear observations vary substantially; the HLS documentation specifically notes less frequent observations in equatorial regions due to persistent cloudiness.

HLS includes a per-pixel Fmask quality layer for clouds, shadows and aerosols. The HLS-VI suite provides nine vegetation indices, including NDVI, EVI and NDMI. EVI is useful in dense vegetation; NDMI is a canopy/vegetation moisture-sensitive index. Neither one is a direct measurement of root-zone water or proof of crop stress.

HLS low-latency products are still in implementation, with initial delivery expected in early 2027. The first Agriculture release should therefore use the currently available HLS products and explicitly record the actual scene dates and QA coverage rather than promise near-real-time optical monitoring.

**Implication:** HLS is a useful independent canopy-response stream, but cloud gaps, its 30 m support, the chosen index and the time difference from a NISAR acquisition must all remain visible.

### 2.3 GPM IMERG: rainfall timing, not field-scale rainfall

NASA GPM's IMERG V07B products provide global precipitation estimates on a 0.1° grid (roughly 10 km), with 30-minute and daily products. Early and Late runs have different latency and interpolation behaviour.

**Implication:** IMERG can supply regional rainfall-event context and cumulative precipitation windows. It must not be resampled and presented as a 200 m or parcel-specific rain measurement. The interface should show the IMERG grid/cell and its footprint separately from the NISAR and HLS supports. Local gauges or farmer records are needed for field-level rainfall confirmation where available.

### 2.4 Crop masks and crop calendars

A field polygon supplied by an analyst or producer is the strongest starting geometry when it is current and trustworthy.

For an independent, time-varying cropland context, Dynamic World provides 10 m land-cover labels and class probabilities, including a crops probability band, from Sentinel-2 observations. Its documentation recommends thresholding the class probability for confident classification and warns that the crops probability may be comparatively low where crop cover is not visually distinctive. It is a cropland-likelihood layer, not a crop-species map or a verified parcel boundary.

ESA WorldCereal offers 10 m temporary-crop, crop-type and irrigation maps, but its currently listed global map collection is for 2021. It is valuable as historical context, not as a current 2026 field truth layer.

For a Bangladesh pilot, the official BAMIS crop-weather calendar lists Rice Aman, Rice Aus, Rice Boro and many other crops. Such calendars should inform season context, but local planting/harvest dates can shift; user-confirmed crop and dates must override a generic regional calendar.

**Implication:** every study should record crop-mask source, acquisition/date window, confidence threshold, crop fraction and calendar source. Unknown crop type must stay unknown. The app must not infer that every pixel in a user-drawn AOI is cropland.

### 2.5 Existing platforms: what is not novel

The public product documentation shows substantial overlap with a generic crop-monitoring dashboard:

- **GEOGLAM Crop Monitor / AGMET:** crop masks, crop calendars, NDVI, soil moisture, precipitation, temperature and other EO indicators, with historical baselines and expert review/consensus workflows.
- **OneSoil:** field monitoring, satellite crop monitoring, anomaly highlighting, weather, season comparisons, field operations, productivity zones, scouting and an AI Agronomist that cross-references satellite signals, weather and crop calendars.
- **EOSDA Crop Monitoring:** vegetation and moisture indices, weather/precipitation charts, crop-growth stages, field analytics, scouting and variable-rate application workflows.

Therefore these are **not** differentiators by themselves: an NDVI/NDMI chart, a moisture map, a rainfall chart, an anomaly layer, a crop calendar, field selection, or a chat summary.

## 3. Research novelty check

The literature already contains the core concepts we might otherwise be tempted to present as new:

- A 2025 systematic review of 64 agricultural soil-moisture remote-sensing studies reports growing use of multi-sensor fusion across optical, thermal and microwave data, alongside persistent issues with vegetation interference, surface roughness and limited in-situ calibration.
- A 2026 review of 181 agricultural-drought remote-sensing studies discusses multisensor drought indices, temporal/time-lag analysis, validation, and the need for more interpretable and uncertainty-aware approaches.
- A 2026 study of heterogeneous tropical agriculture in Mozambique explicitly studies drought propagation through precipitation, soil moisture and vegetation, including lag timing and permutation-based significance assessment.
- Earlier work has also documented lagged vegetation response to rainfall and vegetation-memory effects.

**Conclusion:** a simple rainfall → soil-moisture → NDVI lag chart is not scientifically novel. Neither is combining satellite datasets, applying machine learning to indices, or creating a drought score.

### Defensible project-level differentiation

The proposed contribution is the **way the evidence is made comparable, challenged and auditable**:

1. The crop mask is an independent, versioned input rather than inferred from SME2 moisture.
2. SME2's native support, quality flags, uncertainty, acquisition gaps and provisional maturity remain explicit.
3. HLS pixels are QA-screened and aggregated to SME2 cells using area-aware support accounting; no 30 m optical detail is invented from a 200/400 m moisture measurement.
4. IMERG remains a coarse regional rainfall context, with its actual 0.1° support shown rather than downscaled to field pixels.
5. The time series is organised around observed rainfall events and real acquisition dates, not an arbitrary regular daily series.
6. A fixed common-support cohort and coverage report expose whether the same crop-covered pixels were observed across the compared dates.
7. The system presents competing explanations and missing evidence—phenology, irrigation, waterlogging/flooding, dense canopy, clouds, changing support and product flags—instead of producing a single unexplained stress score.
8. Every derived status can be traced to source assets, source checksums, algorithm version, mask rules, date windows and per-sensor coverage.

This can be a distinctive and defensible implementation. Public-source research cannot prove that no private or unpublished product implements a similar workflow, so the project must not claim “the world's first” or that no web application has these features.

## 4. The chosen next implementation

### Step 1 — Agricultural Observability Gate (first slice implemented)

The first implementation slice is the **SME2 surface-flag observability audit**:

- Decode the eight documented surfaceQualityFlag bits for static water, urban area, precipitation, snow/ice, permanent snow/ice, frozen ground, terrain and dense vegetation.
- Report per-date AOI counts for surface-flag-clear, one-or-more flagged, fill/invalid and unsupported encodings.
- Show each flag as a separate count, explicitly allowing overlap; the counts are not a partition of the AOI.
- Keep the existing strict surfaceQualityFlag == 0 gate and every other SME2 quality check unchanged.
- Report dense-vegetation flags as a possible crop-observability limitation, not as evidence of crop identity.

The **Step 1B independent crop-area gate is implemented in code** on Rubai-dev:

- Accept an optional local single-band probability/binary GeoTIFF with declared CRS, values in [0, 1], a finer source-cell area than SME2, and full buffered coverage of the target native grid. Coarse, multi-band, unreferenced, invalid or incomplete masks fail closed.
- Threshold source pixels at a declared confidence threshold, then separately area-average the classified crop indicator and valid-source indicator onto the native SME2 EPSG:6933 grid. Each output cell retains crop fraction of the complete native cell and source-data coverage; under-covered cells are not inferred as non-crop.
- Record the source label/date, filename, checksum, bytes, CRS/cell-area estimate, threshold and coverage policy.
- Compute per-date valid crop-area fraction and fractional-area-weighted SME2 median/range/uncertainty, then an exact all-date intersection of crop-weighted cells passing the unchanged SME2 quality screen on every acquisition.
- Add interactive map layers, date-selectable crop-support bars, fixed-cohort status, provenance, checksum-verified previews and CSV export.
- Keep the existing surfaceQualityFlag == 0 and all other SME2 quality rules unchanged. The raw crop GeoTIFF remains local; the public package contains only derived statistics/provenance and PNG previews.
- Mark weak mask or common crop support inconclusive/unavailable instead of widening the mask, filling missing pixels or relaxing quality rules. Historical packages without this optional field remain readable.

**Gate output:** a reproducible answer to “how much independently mapped crop area is covered by the selected AOI, and what fraction remains SME2 quality-valid for each date and across the exact common cohort?” This is an observability/comparability gate, not a crop identity guarantee or a crop-health diagnosis. The implementation is code-complete for this slice, but no real mask or pilot result is claimed until an operator supplies an actual source raster and verifies it against the real SME2 granules.

### Step 2 — Water-to-Canopy Response Audit

Only after Step 1 passes on a real pilot:

- Discover and download HLS-VI observations around actual SME2 acquisition dates and rainfall events.
- Use EVI and NDMI as distinct canopy-response indicators; retain NDVI as a supporting, familiar indicator rather than the sole health metric.
- Decode HLS Fmask and retain per-date clear-pixel support.
- Aggregate HLS observations from 30 m to the native SME2 grid with an explicit valid-area threshold and source-pixel count. Never upsample SME2 into a finer apparent measurement.
- Add GPM IMERG V07B event totals at its native 0.1° support. Show the relevant grid cell(s) and their coverage; do not label the value as field-local rainfall.
- Compute event-relative changes and lag **ranges** with uncertainty. Require adequate independent events and samples before any significance test; use a temporally appropriate permutation/block procedure and disclose the test.
- Report only evidence states such as **CONSISTENT_WITH_RESPONSE**, **DIVERGENT_RESPONSE**, **INSUFFICIENT_SUPPORT** or **NOT_ASSESSED**. These are evidence-consistency states, not probabilities, diagnoses or causal claims.

### Step 3 — Evidence challenge and field validation

- Add a map-linked evidence chain that lets an analyst challenge each link and inspect alternate explanations.
- Export the response timeline, support maps, source/product versions, query manifests, checksums, exclusions, calculation settings and warnings.
- Validate a pilot against field soil-moisture measurements, crop-stage observations, rainfall-gauge data and irrigation/field-operation records where available.
- Report independent sample counts and metrics only when a genuine reference dataset exists. Do not train a model or claim accuracy from synthetic test fixtures.

## 5. Non-negotiable scientific and product rules

- Never call surface soil moisture “root-zone moisture”.
- Never equate low NDVI/EVI/NDMI with drought without crop-stage and confounder context.
- Never infer irrigation need or prescribe watering from provisional SME2 alone.
- Never treat IMERG's 10 km field as a parcel-level rainfall measurement.
- Never imply that HLS cloud-free observations exist at every nominal revisit.
- Never resample a coarse source to create a finer measurement.
- Never turn missing/flagged pixels into zero, dry, unchanged or healthy observations.
- Never claim crop identity from Dynamic World alone.
- Never call a lag relationship causal.
- Keep synthetic fixtures strictly in offline tests; never publish them as a real Agriculture case.
- Keep Earthdata credentials and raw HDF5/native rasters local.

## 6. Go/no-go criteria for a credible pilot

A pilot is ready for public display only when:

1. A real CMR search returns a complete, compatible SME2 series and the exact HDF5 granules are downloaded and checksum-verified.
2. The actual release, HDF5 hierarchy, native grid, units, fill values and quality-flag definitions are confirmed from the files and official specification.
3. The independent crop-mask provenance and season context are recorded.
4. The crop-covered, unflagged, common-pixel fraction is sufficient and spatially interpretable; all thresholds are versioned and shown.
5. HLS and IMERG source coverage, native supports and time differences are reported rather than hidden.
6. The UI and all export artifacts agree on the same status and limitations.
7. The browser, type, lint and offline scientific tests pass, followed by a real-data operator review.

A successful code build alone does not satisfy these criteria.

## 7. Reference sources

**Official product and data documentation**

- ASF, NISAR Soil Moisture (SME2): https://nisar-docs.asf.alaska.edu/sme2/
- ASF, PROVISIONAL product known issues: https://nisar-docs.asf.alaska.edu/provisional-known-issues/
- NASA HLS, data products and QA: https://hls.gsfc.nasa.gov/data-products/
- NASA HLS, current data status: https://hls.gsfc.nasa.gov/hls-data/
- NASA, HLS vegetation indices: https://science.nasa.gov/mission/landsat/hls-vegetation-indices/
- NASA GPM, IMERG data directory: https://gpm.nasa.gov/data/directory
- Google/WRI, Dynamic World data catalog: https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1
- ESA WorldCereal, global maps: https://esa-worldcereal.org/en/products/global-maps
- Bangladesh Agro-Meteorological Information Service, crop-weather calendar: https://www.bamis.gov.bd/en/calendar

**Operational comparison**

- GEOGLAM Crop Monitor methodology: https://www.cropmonitor.org/methodology
- GEOGLAM agricultural monitoring and AGMET EO indicators: https://geoglam.org/ag-monitoring/
- OneSoil Platform: https://onesoil.ai/en/platform
- EOSDA Crop Monitoring field guide: https://eos.com/user-guide/crop-monitoring/fields/

**Peer-reviewed research and recent demonstrations**

- 2025 systematic review, agricultural soil-moisture remote sensing: https://www.sciencedirect.com/science/article/pii/S2666017225001348
- 2026 review, remote sensing for agricultural drought (2015–2025 literature): https://doi.org/10.1080/15481603.2026.2738981
- 2026 study, agricultural drought propagation with Sentinel-1 cross-ratio in heterogeneous tropical agriculture (Mozambique): https://doi.org/10.1080/01431161.2026.2723611
- Harris et al. (2022), satellite-observed vegetation responses to intraseasonal precipitation variability: https://doi.org/10.1029/2022GL099635
- ISRO (14 February 2026), NISAR-derived 100 m soil-moisture demonstration over India. This is a separate ISRO/SAC-developed retrieval, not the NASA L3 SME2 product: https://www.isro.gov.in/NisarData_soil_moisture_products.html

---

**Decision recorded:** the SME2 surface-flag audit and Step 1B area-weighted independent crop observability gate are implemented in code on Rubai-dev. The next evidence step is to run the pipeline on a real compatible SME2 series with a provenance-verified crop mask, inspect the resulting spatial support, and only then proceed to HLS canopy-response QA. Do not jump straight to a combined crop-stress score or AI recommendation.

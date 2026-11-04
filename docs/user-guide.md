# User guide and roadmap

## Read the global map

Use the top header to switch between **Wetlands**, **Volcanoes**, and **Forests**. Each section uses separate datasets and methods. The global pages show observations and acquired-scene coverage worldwide; project-derived change results are limited to published study areas.

- NASA GIBS mosaic: NISAR GCOV false-colour backscatter, not a global flood classification.
- NASA CMR footprints: acquired-scene coverage; outline color identifies orbit direction, not flood status.
- Published study boundary: area where one completed detector run was processed.
- Candidate polygons: rule-based radar change under the case's dates, HH/HV rule and mask.
- Blank area: no detector result available.

Select a published study and acquisition date to synchronize map, statistics, inputs, evidence and downloads. Open the radar panel to compare baseline/after/change layers. Optical evidence shows HLS clear coverage and cross-sensor water-change agreement; gray/unassessed regions contain insufficient comparable data. A low common-clear fraction means scores are suppressed. Published Chókwè and Rondônia cases have compact nearest-pixel inspectors; exact native pixel values require the local operator app.

## Interpret claims

Read each case's evidence card and validation page. A completed run means the workflow finished. It does not mean the algorithm's interpretation was confirmed. “Cross-sensor check” is a satellite comparison; field truth requires independent field/reference evidence. Vegetated inundation is exploratory in this version.

The Chókwè panel includes NASA's NISAR browse images, this project's processed 5/17 January BETA pair, CIMA event context, an inconclusive HLS check, and an overlay with later UNOSAT Sentinel-1 water extents. The local detector produced 127 HH-darkening candidates (29.87 km²). UNOSAT water on 23/24 January overlaps 88.2%/89.1% of candidate pixels, six/seven days after the NISAR event, and the reference is preliminary and not field validated. This is positive spatial support, not an accuracy score; HLS has only 1.26% common-clear coverage and assesses none of the candidates. Treat the study as unverified. Use **Open the processed Chókwè run** to inspect its map and evidence in the study explorer.

## Explore forest evidence

Choose **Forests** in the header. The global page supports place names, decimal
coordinates, saved studies and observation dates. Green WorldCover land-cover
tiles describe tree cover in **2021** and appear from zoom 6. Other WorldCover
colors represent other land-cover classes. NASA mosaic colors are backscatter
imagery, not classified loss. Amber outlines are acquired scene footprints;
filled amber polygons are published unverified radar-change candidates.

Open the Rondônia evidence page for the fixed three-date baseline and later
observations. Date selection changes statistics, maps, reference information
and candidate downloads. Compare HH/HV, HV change, baseline variability,
assessed persistence coverage, current radar quality, actual optical imagery
and vegetation-index changes. A transparent candidate layer does not prove
unchanged forest; inspect assessed coverage and masks. The first post-baseline
date has no persistence pair and is deliberately unassessed for classification.

The independent comparison reports actual HLS dates and offsets, common clear
coverage and candidate support/unassessed area. Passing 20% coverage makes it
assessable, not confirmed. The 29 September Rondônia candidate has 97.5%
common-clear coverage; 71.1% of its assessed candidate area overlaps cells where
both NDVI and NBR decreased. The page labels this an **exploratory optical
signal, not proof of forest loss**: index decreases can have multiple causes,
and this comparison has no reference-negative labels or accuracy score.

On the Rondônia case, **Show GLAD-S2 alerts for the NISAR study window** loads
UMD GLAD Sentinel-2 alert tiles through Global Forest Watch and filters alert
detection dates from the first baseline date through the selected NISAR date.
Choose all alerts in that window or confirmed alerts only. This live overlay is
not embedded in the immutable study package, and the project has not computed
a dated candidate-to-alert overlap statistic. Use it as a visual positive-alert
cross-check; a visible match would corroborate a possible disturbance, not
prove permanent forest loss. Missing alerts remain unassessed, not negatives,
and alert pixels are not an area estimate. The map requires an internet
connection to the tile service.

The public forest inspector offers nearest-native-pixel samples from a compact
128 × 128 preview grid; use the evidence package/native crops for exact analysis.
The page also compares actual optical clear coverage with Chókwè, offers
user-started radar sonification, and exports an evidence triage JSON. The brief
does not estimate biomass or carbon without a validated reference.

## Next work

1. Investigate Hakaluki's weak independent agreement and existing-water candidates.
2. Seek an adequately clear independent Tanguar comparison; the saved 22 September check had only about 0.003% common-clear coverage and remains inconclusive.
3. Improve the Chókwè comparison with closer-date or field evidence; the available HLS coverage is inadequate, and the later UNOSAT layer is preliminary and provides positive water labels only.
4. Collect diverse independently validated sites/dates before making generalized accuracy claims.
5. Extend volcanic phase investigations with independent corrections/reference checks before stronger attribution; there is no eruption forecasting. See [volcano method and limitations](volcano-method.md).

## Explore volcano evidence

Open **Volcanoes**, then **Open the Hayli Gubbi case**. The cyan global-map rectangle identifies the published study box. The case has three NISAR intervals: before, spanning, and after the November 23, 2025 eruption. Switch intervals to change the NISAR map, table, inspector and native raster download together. These are separately referenced intervals, not cumulative motion.

Choose apparent LOS (red away / blue toward, cm), coherence (dark low / light high), or screened coverage (white assessed / transparent unassessed). Select ascending or descending Sentinel-1 for the second map. Both sensors have different observation windows and satellite directions, so equal colors are not an accuracy test. Transparent LOS means no usable phase result, not zero deformation. Coherence itself is not a confidence percentage.

Select a region button, click a map, or enter latitude and longitude to inspect both views at that location. Values come from a published geographic grid using nearest native samples; use the native GeoTIFF for exact analysis. The evidence package contains actual source crops, masks, method, provenance and checksums. It loads in public mode without Earthdata login. Optical pictures and the eruption report supply event context. Published paper peaks below the explorer are separately attributed literature values.

The pixel inspector converts unwrapped phase to LOS millimeters with each
product's published sign and wavelength. The L/C-band panel reports the actual
selected pair values and warns that the NISAR and Sentinel-1 intervals do not
form a controlled coherence comparison. Hear a manually started phase/coherence
transect after selecting a map point. The downloadable evidence brief does not
assign a volcano alert level or forecast.

The Chókwè case includes a click-to-sample HH/HV map and a coordinate inspector
using a 128 × 128 nearest-native-pixel grid. It displays backscatter and
HH/HV-derived quantities; these do not uniquely label flooded vegetation, and
the case has no matched C-band pixel comparison. See [radar physics tools](radar-physics-tools.md)
for formulas, sample-grid provenance, and limitations.


## Explore Agriculture soil moisture

Open /agriculture to inspect the published Naogaon NISAR L3 SME2 PROVISIONAL study. The current DSG release contains six valid acquisition dates from 12 August through 23 October 2026; four other dates are explicitly listed as quality exclusions. The workspace includes an interactive map, selectable observation timeline, moisture and target-minus-baseline change layers, uncertainty/coverage summaries, a strict same-pixel cohort comparison, CSV export, and evidence/provenance review.

Read the coverage figures separately: the latest target date has 57.9% valid AOI coverage; the change layer has 21.31% valid coverage; and the fixed all-date cohort covers 21.28% of the AOI. The change and cohort values are close to the fixed 20% policy floor, so the study remains exploratory. The release contains no Dynamic World crop mask, IMERG rainfall context, field reference or independent agricultural accuracy estimate.

The Operator tab searches public NASA CMR metadata and prepares a guided handoff to the manual master-only GitHub Actions processing workflow. An operator must confirm the workflow run in GitHub; the browser does not download source granules or receive Earthdata credentials. The workspace verifies the published study and active preview checksums before rendering measurements. If publication is absent or integrity checks fail, it shows an explicit unavailable state rather than sample measurements.

Interpret SME2 values as exploratory product estimates. NASA documents that the PROVISIONAL SME2 collection is not yet fully calibrated. The values are not crop-health labels, drought diagnoses, irrigation recommendations, crop-type maps or yield predictions.

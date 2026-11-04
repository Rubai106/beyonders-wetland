# Baniachong Agriculture pilot — site selection and CMR preflight

**Branch:** `master`  
**Status:** catalogue preflight passed; awaiting authenticated granule inspection and independent crop-mask verification  
**Product:** `NISAR_L3_SME2_PROVISIONAL_V1`

## Why Baniachong

Baniachong, Habiganj is a defensible Bangladesh starting point because the agricultural context is independently documented:

- NASA's Landsat feature identifies irrigated Boro rice fields surrounding Baniachong and shows a 17 March 2021 image. It is historical context, not a current crop mask: https://science.nasa.gov/missions/landsat/south-asian-farmers-fine-tune-when-to-water/
- A published Bangladesh rice-field experiment identifies an irrigated rice research site in Baniachong at **24°22′59.9″N, 91°25′00.1″E** (24.3833056, 91.4166944). It documents the historical experimental location; it does not establish current 2026 crop cover or a field boundary: https://pmc.ncbi.nlm.nih.gov/articles/PMC11219493/
- BAMIS provides Bangladesh crop-weather calendars for interpreting the timing of rice seasons. A calendar is context; local planting dates and crop identity still need confirmation: https://www.bamis.gov.bd/en/agro-climate/crop-weather-calendar/

The selected primary AOI is a compact rectangle around the published experimental-site coordinates. A second rectangle covers the wider Baniachong Boro-rice landscape described by NASA. They are **separate candidates**, not one combined study. The primary site ranks first, but neither becomes the pilot until the catalogue and crop-mask gates pass.

## What the preflight does

`pipeline/agriculture_pilot_screen.py` queries the public NASA CMR catalogue for each candidate AOI and date range. It then:

1. Parses only granules matching the supported SME2 naming convention.
2. Groups acquisitions by the full product identity: release, track, direction, frame, bandwidth, polarization and frequency.
3. Deduplicates same-date records deterministically using CMR update timestamp and concept ID.
4. Reports acquisition dates, time span, median revisit and largest gap for every compatible series.
5. Marks a series `ELIGIBLE_FOR_OPERATOR_REVIEW` only when it has at least six unique dates spanning at least 60 days.

Six dates and 60 days is a **catalogue preflight threshold for this proposed event-response study**, not a product-quality threshold, a guarantee of regular observations, or a validation result. The existing SME2 search and analysis quality rules are not changed.

The script makes no Earthdata login, downloads no granules, reads no HDF5 data, creates no study package and publishes nothing. CMR footprint intersection alone cannot establish the number of valid pixels inside the AOI.

## Run the preflight

From the repository root, with Python dependencies installed:

```powershell
python pipeline/agriculture_pilot_screen.py --start-date 2026-06-17 --end-date 2026-10-31
```

The JSON report is written to:

```
pipeline/output/agriculture/pilot-screening/report.json
```

The same check is available in GitHub Actions under **Agriculture pilot preflight**. Select branch `master`, choose **Run workflow**, set the date range if needed, and download the `agriculture-pilot-preflight` artifact. This workflow only performs public catalogue discovery; Earthdata credentials are not required.

## Decision gate after CMR returns

Choose the primary or fallback AOI only if at least one exact-compatible series passes the six-date/60-day preflight. Review the track/frame/direction and every acquisition date. Do not combine series that differ in product identity.

Then run the existing local workflow for the chosen AOI (example shown for the primary candidate):

```powershell
python pipeline/agriculture_sme2.py search --run-id baniachong-2026 --west 91.3867 --south 24.3533 --east 91.4467 --north 24.4133 --start 2026-06-17 --end 2026-10-31
```

Inspect `pipeline/output/agriculture/baniachong-2026/search.json` and select the exact series ID if more than one is returned. The preferred website handoff opens the secure `master` cloud workflow, which reads the repository Actions secret `EARTH_DATA`; the browser and workflow inputs never receive the token. The local CLI remains an optional maintainer fallback and uses local Earthdata authentication.

## Crop-mask gate

A CMR match does not show that the AOI is predominantly cropland. Before analysis, create or obtain a dated independent fine-resolution crop-probability GeoTIFF (Dynamic World crops probability is a candidate source). Use the actual 2026 observation context, record the source/date/checksum and threshold, and inspect water, settlement, vegetation and crop confounders. Do not infer crop identity from SME2 moisture or assume the whole AOI is cropland.

The existing pipeline already has the strict crop-mask alignment, fractional area aggregation and same-pixel observability checks. Keep those rules unchanged. The historical 2020 Bangladesh Rice Boro CropID product at 250 m may be useful as broad historical context, but it is coarser than the native SME2 cell and must **not** be passed as the required finer-resolution crop-mask input.

## Go / no-go

- **Go to local granule inspection:** one site has an unambiguous compatible series with at least six dates across at least 60 days.
- **Go to analysis:** exact granule IDs are downloaded and checksum-verified; actual HDF5 hierarchy, release, native grid, units, fill values and quality flags pass the existing checks; the independent crop mask passes its own provenance and spatial-support checks.
- **No-go:** no series passes, the series identity is mixed, HDF5 validation fails, crop coverage is insufficient, or common valid crop support falls below the existing policy floor. Revise the site/date window or keep the pilot unpublished. Do not weaken quality flags or manufacture sample measurements.

Passing the build and catalogue preflight is not a real-data agricultural validation. No Baniachong SME2 observations, crop-mask outputs or Agriculture publication are claimed by this document.


## Live CMR preflight result — 3 November 2026

The historical [Agriculture pilot preflight run #3](https://github.com/Rubai106/beyonders-wetland/actions/runs/41578135246) completed successfully on `Rubai-dev`; it predates the master-only branch policy and is retained here as a historical catalogue record. It queried the public NASA CMR catalogue for `NISAR_L3_SME2_PROVISIONAL_V1` over 2026-01-01 through 2026-10-31. Both configured Baniachong AOIs returned the same 30 compatible granules and the same four product-identity series. The primary AOI is therefore a workflow priority, not a catalogue-coverage winner.

The updated [master-branch preflight run #6](https://github.com/Rubai106/beyonders-wetland/actions/runs/41791107089) completed successfully on 4 November 2026 using 2026-06-17 through 2026-10-31, the date window supported by the current cloud worker. Both AOIs were `ELIGIBLE_FOR_OPERATOR_REVIEW`; each returned the same two qualifying ascending series (tracks 141 and 069), with 10 acquisitions over 120 days and 12-day median / 24-day maximum gaps. Two descending track-091 series had five acquisitions and remained below the six-date gate. The workflow checked out `master`, generated a metadata-only JSON artifact and did not download or validate any HDF5 granules.

Two series pass the six-date / 60-day preflight:

| Download-compatible series ID | Track / frame | Orbit | Polarization / bandwidth / frequency | Dates | Span | Median / maximum gap |
|---|---|---|---|---:|---:|---:|
| `c5f219dd7bbc` | 141 / 014 | Ascending | DHDH / 4005 / A | 10 | 120 days | 12 / 24 days |
| `540e079403d5` | 069 / 014 | Ascending | DHDH / 4005 / A | 10 | 120 days | 12 / 24 days |

The series are separate tracks and must remain separate time series. Their acquisition dates are:

- Track 141: 2026-06-23, 07-05, 07-17, 08-10, 08-22, 09-03, 09-15, 09-27, 10-09 and 10-21.
- Track 069: 2026-06-18, 06-30, 07-12, 07-24, 08-17, 08-29, 09-10, 09-22, 10-04 and 10-16.

Two additional descending-track 091 series each have five observations and do not pass the current six-date gate: QPDH/2005 (120-day span, maximum gap 48 days) and DHDH/4005 (96-day span, maximum gap 24 days). The preflight gate is intended to retain enough real acquisitions for a later event-response investigation; it is not a scientific quality threshold.

**Season qualification:** the earliest returned acquisition is 2026-06-18. These series do not cover the full historical Boro season represented in NASA's March 2021 Baniachong image. Do not call this a 2026 Boro-season study. The crop/season present during June–October 2026 must be established with independent, date-aligned crop observations and local crop-calendar context.

**Still unverified:** the CMR result is catalogue/footprint evidence only. No SME2 granule was downloaded in this preflight; no HDF5 hierarchy, native grid, fill values, retrieval/surface flags, moisture values, uncertainty, or valid-pixel fraction has been inspected. No crop mask has been aligned and no Agriculture study has been published.

### Website-first handoff and maintainer fallback

In the website, open `/agriculture` → **Operator**, keep or adjust the Baniachong AOI and date window, then choose **Discover SME2 observations**. Compare the track cards and select one compatible series. Online discovery reads public NASA metadata only. For an eligible series, the website prepares the exact inputs for the secure `master` cloud workflow; the browser does not download granules or receive Earthdata credentials. Copy the inputs, open the workflow link, select **Run workflow**, and review the resulting Actions run. The commands below remain an optional maintainer fallback for local pipeline inspection.

```powershell
python pipeline/agriculture_sme2.py search --run-id baniachong-2026 --west 91.3867 --south 24.3533 --east 91.4467 --north 24.4133 --start 2026-06-17 --end 2026-10-31
python pipeline/agriculture_sme2.py download --run-id baniachong-2026 --series-id c5f219dd7bbc
```

To inspect the second track, use a separate run ID (for example `baniachong-track069-2026`) and series ID `540e079403d5`. Downloading requires a local interactive Earthdata Login through the existing terminal workflow; do not put credentials in GitHub Actions, the website or this preflight. Start with the better-supported track only after checking the actual HDF5 metadata and native-grid AOI support from the downloaded receipt. The CMR count alone cannot rank track 141 versus track 069.

Next gate: supply a dated independent fine-resolution crop-probability GeoTIFF, verify its source and alignment against the actual SME2 grid, and run the existing crop-support audit. If the actual crop-covered valid common support is inadequate, keep the study unpublished or revise the AOI/date window transparently.


## Dynamic World independent crop-evidence acquisition — 4 November 2026

- The official Dynamic World V1 catalogue currently lists source imagery through 31 October 2026. It provides 10 m class probabilities from cloud-masked Sentinel-2 scenes; the crops band is a generic land-cover probability and does not identify rice or field boundaries.
- A new manual, master-only workflow acquires the selected Baniachong AOI and date window through Earth Engine. It exports a 10 m EPSG:6933 single-band median crop-probability GeoTIFF and a separate per-pixel count of distinct valid UTC acquisition dates.
- The daily-median step prevents overlapping Sentinel-2 granules acquired on the same day from satisfying the minimum-observation requirement multiple times. Pixels with fewer than three valid acquisition dates remain NoData in the probability raster; the count raster retains zero and low-count locations for review.
- The export is buffered by 600 m so the later SME2 native-grid alignment can test complete spatial coverage. It is an acquisition artifact only: no SME2 analysis, rainfall attachment, automatic track selection or public publication runs.
- Cloud access requires a registered Earth Engine Cloud project, the Earth Engine API enabled, and a service account with Earth Engine Resource Viewer permission (plus Service Usage Consumer where required). The JSON key and project ID belong in repository Actions secrets EARTH_ENGINE_SERVICE_ACCOUNT_JSON and EARTH_ENGINE_PROJECT; they are only injected into the acquisition step.
- Use limitation: the window-level median is not the crop state on every individual SME2 date. Inspect source acquisition dates, latest-scene gap, probability distribution and per-pixel observation counts before using the raster. It remains generic cropland likelihood, not rice validation or ground truth.

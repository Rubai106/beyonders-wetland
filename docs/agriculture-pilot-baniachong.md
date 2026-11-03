# Baniachong Agriculture pilot — site selection and CMR preflight

**Branch:** `Rubai-dev`  
**Status:** candidate site selected; live CMR coverage not yet checked from this commit  
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
python pipeline/agriculture_pilot_screen.py --start-date 2026-01-01 --end-date 2026-10-31
```

The JSON report is written to:

```
pipeline/output/agriculture/pilot-screening/report.json
```

The same check is available in GitHub Actions under **Agriculture pilot preflight**. Select branch `Rubai-dev`, choose **Run workflow**, set the date range if needed, and download the `agriculture-pilot-preflight` artifact. This workflow only performs public catalogue discovery; Earthdata credentials are not required.

## Decision gate after CMR returns

Choose the primary or fallback AOI only if at least one exact-compatible series passes the six-date/60-day preflight. Review the track/frame/direction and every acquisition date. Do not combine series that differ in product identity.

Then run the existing local workflow for the chosen AOI (example shown for the primary candidate):

```powershell
python pipeline/agriculture_sme2.py search --run-id baniachong-2026 --west 91.3867 --south 24.3533 --east 91.4467 --north 24.4133 --start 2026-01-01 --end 2026-10-31
```

Inspect `pipeline/output/agriculture/baniachong-2026/search.json`, select the exact series ID if more than one is returned, and only then proceed to the authenticated download step. Earthdata Login remains local in the terminal.

## Crop-mask gate

A CMR match does not show that the AOI is predominantly cropland. Before analysis, create or obtain a dated independent fine-resolution crop-probability GeoTIFF (Dynamic World crops probability is a candidate source). Use the actual 2026 observation context, record the source/date/checksum and threshold, and inspect water, settlement, vegetation and crop confounders. Do not infer crop identity from SME2 moisture or assume the whole AOI is cropland.

The existing pipeline already has the strict crop-mask alignment, fractional area aggregation and same-pixel observability checks. Keep those rules unchanged. The historical 2020 Bangladesh Rice Boro CropID product at 250 m may be useful as broad historical context, but it is coarser than the native SME2 cell and must **not** be passed as the required finer-resolution crop-mask input.

## Go / no-go

- **Go to local granule inspection:** one site has an unambiguous compatible series with at least six dates across at least 60 days.
- **Go to analysis:** exact granule IDs are downloaded and checksum-verified; actual HDF5 hierarchy, release, native grid, units, fill values and quality flags pass the existing checks; the independent crop mask passes its own provenance and spatial-support checks.
- **No-go:** no series passes, the series identity is mixed, HDF5 validation fails, crop coverage is insufficient, or common valid crop support falls below the existing policy floor. Revise the site/date window or keep the pilot unpublished. Do not weaken quality flags or manufacture sample measurements.

Passing the build and catalogue preflight is not a real-data agricultural validation. No Baniachong SME2 observations, crop-mask outputs or Agriculture publication are claimed by this document.

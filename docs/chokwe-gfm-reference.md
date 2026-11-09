# Chókwè: Copernicus GFM reference discovery

**Status: preflight only. No GFM pixels have been downloaded or compared, and no validation score is supported.**

## Why this source is worth checking

The Chókwè NISAR case uses a real L-band GCOV pair from 5 and 17 January 2026. Its HLS optical comparison is inconclusive because only 1.26% of the analyst-defined study box has common clear coverage. The existing UNOSAT Sentinel-1 water products are dated 23–24 January, six to seven days after the NISAR event; their overlap with the NISAR candidates is positive spatial support only.

EODC publishes a reproducible Copernicus Global Flood Monitoring (GFM) example for **southern Mozambique, 7–28 January 2026**. Its broader regional bounding box contains the project's Chókwè analysis box. The example queries the EODC GFM STAC collection and works with the ensemble flood extent, reference-water mask and exclusion mask. This establishes a credible archive-discovery route, not proof that each GFM acquisition has valid pixels over this exact small AOI.

GFM is based on Sentinel-1 C-band SAR and combines three independent flood algorithms in an ensemble. It is independent of the project's NISAR L-band processing, but it is still an algorithmic satellite product, not field truth.

## Step 1 — run the exact-AOI metadata preflight

In GitHub, open **Actions → Chokwe GFM reference preflight → Run workflow**. Keep the default dates (7–28 January 2026) for the first search. The workflow queries the public STAC API at https://stac.eodc.eu/api/v1 using the exact Chókwè box:

- West, south, east, north: 32.93, -24.58, 33.03, -24.48
- Inclusive dates: 2026-01-07 to 2026-01-28 UTC
- Collection: GFM

Download the workflow artifact named **chokwe-gfm-stac-preflight**. It contains item IDs, acquisition dates, asset names and source metadata. It contains no raster pixels or Earthdata credentials.

A result of **NO_CATALOGUE_ITEMS** is a valid outcome; do not widen the AOI silently. A **CATALOGUE_ITEMS_FOUND** result means only that the catalogue returned intersecting tile items. GFM STAC tile geometry can represent a whole grid tile rather than the actual valid Sentinel-1 footprint.

## Step 2 — inspect raster support before comparison

For every returned acquisition, inspect the actual data assets for:

1. **ensemble_flood_extent** — the ensemble's observed-flood layer.
2. **reference_water_mask** — distinguish pre-existing/permanent water from event candidates.
3. **exclusion_mask** — retain the product's excluded or unobservable areas as unassessed.
4. NoData and valid-pixel coverage over the exact Chókwè box.
5. Acquisition time, pixel size, projection, and the actual overlap with the 17 January NISAR footprint.

Do not infer full AOI coverage from a STAC item bbox. If the assets do not expose usable pixels over the study box, stop and record the reason.

## Step 3 — only then make a cross-sensor comparison

If the rasters provide adequate, documented support, align the GFM products to the NISAR study grid with an explicit nearest-neighbour categorical resampling rule and preserve the valid, permanent-water and exclusion masks separately. Report the exact GFM acquisition dates and supported area.

The first comparison should be a **positive-support overlay**: the NISAR candidate area intersecting observed GFM flood extent, with denominator and GFM-supported candidate area stated. Do not report precision, recall, F1 or accuracy from GFM as ground truth. Do not treat missing, excluded or unobserved pixels as negative labels. Keep this separate from any optical HLS check and from the later UNOSAT 23–24 January comparison.

Even a close-date GFM overlap would be independent cross-sensor algorithmic support, not field validation. The study remains **unverified radar-change candidates** unless stronger independent or field evidence becomes available.

## Sources

- EODC, [GFM/GloFAS southern Mozambique example notebook](https://www.docs.eodc.eu/notebooks/gfm-glofas.html), including its 7–28 January 2026 regional search window and STAC workflow.
- EODC, [GFM STAC API](https://stac.eodc.eu/api/v1).
- Copernicus EMS, [Global Flood Monitoring Product User Manual](https://extwiki.eodc.eu/gfm_assets/gfm4.0_pum_2025.pdf).
- OCHA Centre for Humanitarian Data, [GFM exploration guide](https://ocha-dap.github.io/ds-flood-gfm/gfm-exploration/index.html).
- NASA, [NISAR reveals major flooding in Mozambique](https://svs.gsfc.nasa.gov/5661/).
- Existing project comparison and limitations: [evidence report](evidence-report.md) and [scientific method](scientific-method.md).

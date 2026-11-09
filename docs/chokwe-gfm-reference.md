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


## January 17 close-date GFM raster audit

The exact Chókwè box query returned three GFM items on 17 January 2026. The item at 03:18:47 UTC is the only one with high local coverage (88.67% of AOI pixel centers); the other two have 10.57% and 0% valid coverage. The selected COG is tagged GFM NRT v4.1.0, uses a 20 m EPSG:27701 grid, and is 23 minutes 45 seconds before the NISAR event timestamp.

The 03:18:47 item has 264,771 source-valid pixels in the AOI. Its observed-flood raster has 25,130 value-1 pixels and 239,641 value-0 pixels. The exclusion layer marks 62,948 valid AOI pixels as excluded. The shared reference-water mask contains 334 permanent-water and 827 seasonal-water pixels in the AOI.

A follow-up overlay rasterizes the published NISAR candidate GeoJSON to the GFM pixel grid using pixel-center inclusion. The denominator includes only common-valid pixels outside the GFM exclusion mask and outside both permanent and seasonal reference water. The resulting intersection is positive-only independent satellite support; it is not a confusion-matrix score or field validation. Because the public NISAR GeoJSON is a simplified display product, not the private native NISAR classification raster, the overlap is approximate at candidate polygon edges.

The GFM manual describes the observed-flood layer as binary, with value 1 denoting flood, and the likelihood layer as 0–100 with 50 separating flooded from unflooded classes. Its reference-water classes distinguish no water (0), permanent water (1) and seasonal water (2); excluded pixels are not suitable as negative labels. The retrieved COGs themselves are tagged with GFM NRT version 4.1.0. See the [GFM output-layer manual](https://extwiki.eodc.eu/GFM/PUM/Products) and the [GFM recommendations](https://extwiki.eodc.eu/GFM/PUM/Recommendations).

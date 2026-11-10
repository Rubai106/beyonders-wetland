# Chókwè: Copernicus GFM reference discovery

**Status: exact-AOI, close-date GFM raster audit completed. The result is positive-only cross-sensor support; it is not field validation or an accuracy score.**

## Why this source is worth checking

The Chókwè NISAR case uses a real L-band GCOV pair from 5 and 17 January 2026. Its HLS optical comparison is inconclusive because only 1.26% of the analyst-defined study box has common clear coverage. The existing UNOSAT Sentinel-1 water products are dated 23–24 January, six to seven days after the NISAR event; their overlap with the NISAR candidates is positive spatial support only.

EODC publishes a reproducible Copernicus Global Flood Monitoring (GFM) example for **southern Mozambique, 7–28 January 2026**. Its broader regional bounding box contains the project's Chókwè analysis box. The example queries the EODC GFM STAC collection and works with the ensemble flood extent, reference-water mask and exclusion mask. This establishes a credible archive-discovery route, not proof that each GFM acquisition has valid pixels over this exact small AOI.

GFM is based on Sentinel-1 C-band SAR and combines three independent flood algorithms in an ensemble. It is independent of the project's NISAR L-band processing, but it is still an algorithmic satellite product, not field truth.

## Step 1 — run the exact-AOI metadata preflight

The initial query completed automatically on the workflow-definition update. To repeat it for a different time window, open **Actions → Chokwe GFM reference preflight → Run workflow**. The workflow queries the public STAC API at https://stac.eodc.eu/api/v1 using the exact Chókwè box:

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


## Completed close-date comparison — 17 January 2026

The exact AOI search returned 33 GFM catalogue items across 12 acquisition dates from 7–28 January. Three items were dated 17 January 2026. Their source-valid pixel-center coverage inside the Chókwè box was:

| GFM acquisition (UTC) | Valid AOI coverage | Decision |
|---|---:|---|
| 03:18:22 | 10.57% | Too incomplete for the primary comparison |
| **03:18:47** | **88.67%** | Selected for the close-date comparison |
| 03:19:12 | 0% | No valid AOI pixels |

The selected COG is tagged GFM NRT v4.1.0, uses a 20 m grid, and was acquired 23 minutes 45 seconds before the NISAR event timestamp (03:42:32 UTC). The selected item has 264,771 source-valid pixels inside the AOI. Of those, 25,130 are mapped as GFM observed flood and 239,641 are not. The exclusion mask flags 62,948 valid AOI pixels; the separate reference-water mask identifies 334 permanent-water and 827 seasonal-water pixels.

### Positive-only overlap with published NISAR candidates

The comparison rasterizes the public NISAR candidate GeoJSON to the GFM grid using pixel-center inclusion. It does **not** use the private native NISAR classification raster.

| Measure | Result |
|---|---:|
| NISAR display-polygon pixels rasterized in the AOI | 81,843 |
| Candidate pixels with common-valid GFM data | 62,779 (76.71%) |
| Candidate pixels removed by GFM exclusion | 22,329 |
| Candidate pixels in reference water | 1 |
| Eligible candidate pixels after masks | 40,449 (16.1796 km²) |
| Eligible candidate pixels also mapped as GFM flood | **15,931 (6.3724 km²)** |
| Fraction of eligible candidate pixels with positive GFM support | **39.39%** |

This is a **positive-support intersection only**. The remaining 24,518 eligible NISAR candidate pixels were not mapped as flood by this GFM scene, but they are not counted as false alarms: the products use different sensors, wavelengths, acquisition geometry and algorithms, and GFM is not field truth. Excluded, reference-water and unobserved cells are not negative reference labels.

The GFM likelihood among the 15,931 overlapping pixels has a median of 76/100 and a mean of 78.30/100 (range 32–100). Thirty-three overlapping pixels have a binary GFM flood label while their final likelihood is below 50. This should be disclosed, not hidden. The GFM Product Definition Document defines the binary ensemble class by a two-of-three LIST/DLR/TUW vote and computes the final likelihood separately as the average of the available algorithm likelihood inputs. TUW's intermediate layer is an uncertainty measure and is inverted/harmonized for the ensemble. In this audit, the 77 AOI-wide low-likelihood pixels that were still classed as flood all had two algorithm flood votes; the final binary layer agreed with the two-of-three vote throughout the common-valid eligible AOI. None of those 77 pixels carried an advisory flag. This supports the internal binary-vote consistency of the scene; it does not establish that any particular NISAR candidate was floodwater.

Sources: [GFM Product Definition Document v4.0 — LIST likelihood](https://extwiki.eodc.eu/gfm_assets/gfm_pdd_v4_0.pdf), [DLR likelihood method](https://extwiki.eodc.eu/en/GFM/PDD/GFM_algorithms/DLR_algo), [TUW uncertainty-to-likelihood handling](https://extwiki.eodc.eu/GFM/PDD/GFM_algorithms/TUW_algorithm), and [GFM output-layer manual](https://extwiki.eodc.eu/GFM/PUM/Products).

### Limitations and next validation gate

The percentage above is approximate at polygon edges because it uses the simplified display GeoJSON. Before this can be promoted into a stronger evidence result, repeat the overlay using the **native NISAR classification raster** for run `ec8fa5ee15ae41d1aa89f930f2b47e36`, preserve the exact common-valid mask, and compare cell counts on the same GFM grid. The project still has no field validation and no supported precision, recall, F1 or accuracy metric for Chókwè. Keep the public case labelled **unverified radar-change candidates** until an adequately documented independent reference or field evidence is available.


## Native NISAR-grid comparison — completed 2026-11-10

The public-polygon comparison above is an exploratory edge-approximation only. A separate native-grid comparison entry point is now available in `pipeline/compare_chokwe_native_gfm.py`. It is deliberately separate from the existing polygon audit and does not change the public Chókwè case.

### Input and provenance gates

The comparator consumes the private recovery artifact from the manual **Chokwe native NISAR raster recovery** workflow. Before reading candidate classes, it verifies:

- The recovery manifest is for the pinned published run `ec8fa5ee15ae41d1aa89f930f2b47e36`, exact 5 January / 17 January 2026 scene pair, NISAR L2 GCOV BETA v1 / frequency A.
- The source manifest, observation, case-study and AOI boundary SHA-256 values match the checked-in published source package.
- All required native-run files and GCOV quality sidecars match their recovery-manifest byte counts and SHA-256 hashes.
- The native classification, four masked HH/HV inputs, AOI mask, CRS and affine grid align; candidate class codes remain 1 (OPEN_WATER) and 2 (VEGETATED), while valid class 0 remains “no candidate” rather than NoData.
- The inherited HLS reference status remains INCONCLUSIVE and the recovery is reprocessing, not restoration of the original TIFF bytes.

### Alignment and denominator rules

The comparator selects the 17 January GFM item with the largest source-valid ensemble-flood coverage within the exact study box, using the same coverage-selection rule as the existing GFM audit. It reads the ensemble flood, ensemble likelihood, exclusion and reference-water COG windows.

Each GFM value layer **and its validity mask** is sampled independently onto the native NISAR classification grid with nearest-neighbour resampling. The native NISAR grid is the grid of record; the NISAR rasters are not resampled. The four sampled GFM layers must all be valid for a native cell to count as common-valid support.

Results are reported separately for OPEN_WATER and VEGETATED candidate classes. For each class, the comparator retains separate counts for:
- candidate pixels without common-valid GFM data;
- candidate pixels intersecting the GFM exclusion mask;
- candidate pixels intersecting permanent or seasonal reference water;
- eligible candidate pixels after all GFM masks;
- eligible candidate pixels also mapped as GFM flood.

Exclusion and reference-water counts are reported independently and may overlap. Missing, excluded and permanent/seasonal water cells are never turned into negative labels. GFM non-flood cells among eligible candidates are reported descriptively, not as false alarms or verified non-flood labels.

No precision, recall, F1 or accuracy metric is calculated. The output is positive-only independent cross-sensor algorithm support, not field truth. The comparison workflow itself writes no result to `public/` and does not change the production-run pointer. Following review, a compact public provenance/result summary was separately added at `public/evidence/chokwe-native-gfm-comparison-2026-11-10.json`; the full private Actions artifact remains the detailed machine-readable report.

### Mask reporting and class-zero reader caution

Per-class candidate reporting keeps the combined reference-water total for continuity and additionally reports permanent reference water (GFM value 1) and seasonal reference water (GFM value 2) as separate counts. These are disjoint classes in the source mask; both remain outside the eligible denominator. GFM exclusion may overlap reference water and is still reported independently, including a separate count for candidates in both categories.

The native classification GeoTIFF declares `nodata=0`, while the processing convention also uses class value 0 for a valid "no candidate" result inside the common-valid support. The comparator intentionally reads `classification_00.tif` unmasked and reconstructs `native_valid` separately from all four masked HH/HV inputs and the wetland/AOI mask. Any downstream consumer must follow the same rule: **do not rely on the GeoTIFF NoData metadata alone to identify valid class-zero pixels**. The comparison report includes the metadata value, the valid no-candidate count and this reader warning.

### Manual execution after native recovery

The manual workflow **Chokwe native NISAR–GFM comparison** accepts the GitHub Actions run ID of a completed native-recovery workflow. It downloads the private `chokwe-native-nisar-recovery-<run-id>` artifact from that run, validates the package, queries the public GFM catalogue and writes a private 30-day comparison-report artifact. It does not require Earthdata credentials and it does not launch native NISAR processing.

The workflow is manual-only; it must not be dispatched until an exact-pair native recovery has completed and its artifact has been independently checked. A missing, expired, ambiguous, modified or mismatched recovery package fails closed.

**Execution status (2026-11-10): COMPLETE.** The credentialed recovery and the live native-grid comparison both completed successfully and their private Actions artifacts were retrieved and inspected.

### Run provenance

- Native recovery workflow: [run 42847205114](https://github.com/Rubai106/beyonders-wetland/actions/runs/42847205114), latest attempt 3, conclusion SUCCESS. Recovery artifact: `chokwe-native-nisar-recovery-42847205114`, artifact ID `13785806193`, 104,750,777 bytes, archive SHA-256 `b344ab9fb2c3b460010b647de9a12ee36f7df979dc14a629ad2ad42bdeaedec0`.
- Native-grid comparison workflow: [run 42863187071](https://github.com/Rubai106/beyonders-wetland/actions/runs/42863187071), attempt 1, conclusion SUCCESS. Comparison artifact: `chokwe-native-gfm-comparison-42863187071`, artifact ID `13785762170`, 2,756 bytes, archive SHA-256 `a82eda0108e83aede34ef101621a5b2a00915e569d413b85420c792e754be751`.
- The comparison report records recovery manifest SHA-256 `68793ffb310ad8df09e72e093827414ffd579368c5347bd5bbe97cc6f4c23739` and internal native processing run `6cbe03836ada44b09188b9aee2b94bc3`, sourced from published run `ec8fa5ee15ae41d1aa89f930f2b47e36`.

### Observed GFM source and native grid

- Selected item: `ENSEMBLE_FLOOD_20260117T031847_VV_AF020M_E066N021T3`, acquired `2026-01-17T03:18:47Z`; 23 minutes 45 seconds before the NISAR event timestamp.
- GFM product: NRT v4.1.0, 20 m source grid, EPSG:27701.
- Native NISAR grid: EPSG:32736, 10 m pixels, 1,014 × 1,108. Nearest-neighbour sampling was applied to each of the four GFM layers and each layer's validity mask; the native NISAR raster was not resampled.
- The AOI contains 1,121,391 reconstructed native-valid pixels. 993,517 have common-valid GFM data across all four layers (88.5968%); 127,874 do not.

### Native candidate result

| Measure | OPEN_WATER | VEGETATED |
|---|---:|---:|
| Native candidate pixels | 298,718 | 0 |
| Candidate area | 29.8718 km² | 0 km² |
| Without common-valid GFM data | 69,656 | 0 |
| With common-valid GFM data | 229,062 | 0 |
| In GFM exclusion mask | 81,909 | 0 |
| In permanent reference water | 2 | 0 |
| In seasonal reference water | 0 | 0 |
| Eligible after masks | 147,151 | 0 |
| Eligible area | 14.7151 km² | 0 km² |
| GFM flood-positive overlap | **57,997** | 0 |
| Positive overlap area | **5.7997 km²** | 0 |
| Positive support / eligible candidates | **39.4133%** | Not applicable |

Among the 147,151 eligible OPEN_WATER candidates, 89,154 were not mapped as flood by this GFM scene. These are descriptive non-overlaps, not false alarms or ground-truth negatives. The overlap pixels' GFM likelihood has median 76/100, mean 78.3054/100, range 32–100; 129 overlap pixels are below 50.

The 39.41% native-grid result is close to the earlier 39.39% display-polygon audit, but the two percentages use different rasterization/grid paths and the same GFM observation. Treat that similarity as an implementation-consistency check, not as a second independent validation.

### Class-zero count interpretation

The JSON field `native_nisar_grid.candidate_class_counts` is copied from the recovery's **raw whole-raster class-value counts**: class 0 = 824,794; class 1 = 298,718; class 2 = 0. It must not be interpreted as counts within native-valid AOI support. After reconstructing the four-input and wetland/AOI masks, valid counts are class 0 = 822,673, class 1 = 298,718, class 2 = 0; these sum to the 1,121,391 valid AOI pixels. The 2,121 extra raw class-zero cells lie outside reconstructed valid support. The comparator uses the reconstructed mask for all candidate denominators.

### Interpretation boundary and next validation gate

This is positive-only spatial support between native NISAR radar-change candidates and an independent Sentinel-1 GFM algorithm product. It is **not field validation, accuracy, precision, recall or F1**. The GFM no-data, exclusion and permanent/seasonal reference-water cells are not negative labels. The original HLS optical reference remains `INCONCLUSIVE`; this comparison does not upgrade it. The published case remains **unverified radar-change candidates** until adequately documented independent reference or field evidence is available. Recovery was reprocessing, not restoration of the original TIFF bytes.

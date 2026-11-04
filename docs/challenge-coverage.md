# 2026 NASA Space Apps challenge coverage

Assessment of the challenge brief against the current code and published data packages, updated 4 November 2026.

## Covered in the application

| Challenge element | Project implementation | Scope/limit |
|---|---|---|
| Interactive application for radar-based Earth change | Globe, map-based study pages, date timelines, layer selection, coordinate/place search, animations, case walkthrough, evidence cards, comparison sliders, and pixel inspection. | User-facing interaction is implemented; processing remains an operator workflow. |
| Use NASA–ISRO NISAR | Wetland and forest studies process real L2 GCOV backscatter; Hayli Gubbi uses official L2 GUNW phase/coherence products. | Product maturity and product type are shown per case; the products support different measurements. |
| Track one or more change types at locations around the world | Flood/inundation candidates in Hakaluki and Tanguar, a processed but inconclusive Chókwè event case, persistent forest radar-change candidates in Rondônia, and apparent LOS deformation candidates near Hayli Gubbi/Erta Ale. | These are local studies in Bangladesh, Mozambique, Brazil, and Ethiopia. Worldwide layers show observations and coverage, not worldwide detections. |
| Explore time steps and radar signal | HH/HV GCOV time series for wetlands and forest; phase cycles, LOS displacement, and coherence for the volcano case. | Volcano intervals are independently referenced pairs, not cumulative motion. |
| Track agricultural soil-moisture change | A published Naogaon NISAR L3 SME2 PROVISIONAL DSG study with six valid acquisition dates, four dated quality exclusions, checksum-verified previews, per-date quality/coverage audits, a date-specific timeline, and a fixed all-date pixel cohort. | Exploratory soil-moisture evidence only: latest target-date valid coverage is 57.9%; target-minus-baseline change coverage is 21.31%; the fixed all-date cohort is 21.28%. No independent field validation, crop mask, rainfall context or agricultural accuracy is included. No crop-stress, drought, irrigation, yield or crop-type claim is made. |
| Add contextual/independent datasets | HLS optical imagery, WorldCover 2021, Sentinel-1/ARIA products, NASA imagery, Smithsonian/USGS event records, and CIMA/UNOSAT flood maps. | These have different purposes. Some provide contextual support only; none should be called ground truth unless the case says it is. |
| Explain what the results mean | Method, dates, product maturity, boundaries, assessed coverage, uncertainty, provenance, and explicit “candidate”/“inconclusive” states are shown. | Human and environmental causes are not inferred from radar patterns alone. |
| Tell an event story | The Chókwè page pairs NASA’s 5/17 January NISAR imagery with this project's processed BETA scene pair, CIMA’s 16 January Sentinel-1/2 map, and UNOSAT’s later Sentinel-1 water extents. | The later UNOSAT layer overlaps 88.2%/89.1% of candidates on 23/24 January, but is 6–7 days later and preliminary. HLS has 1.26% common-clear coverage and assesses none of the candidate area. The result remains unverified; no accuracy score is supported. |

## Global map reading

- The NISAR GIBS layer is backscatter imagery/context, not a global flood classification.
- NASA CMR outlines show acquisitions and scene coverage, not detections.
- Volcano catalog points and forest tree-cover context are reference layers, not NISAR results.
- Candidate polygons and deformation layers are displayed only for published, processed study areas.
- A blank area means **no result available**, not “no change.”

This coverage distinction is present in the Wetlands worldwide views, the Forests map, and the Volcanoes directory. A global map does not imply worldwide processed or validated detections.

## Evidence and scientific status

- **Hakaluki:** one HLS comparison is assessable but weak (50.7% clear coverage, F1 0.074); another date has F1 0.0. No confirmed new-flood claim is supported.
- **Tanguar:** the 29 August check has 0.34% common-clear coverage; the 22 September check has about 0.003%. Both are inconclusive.
- **Rondônia:** one 0.0128 km² radar candidate has an exploratory HLS NDVI/NBR support signature over 71.1% of its small area. This is not a labeled forest-loss reference and no accuracy score is available.
- **Hayli Gubbi:** official NISAR phase products show screened apparent LOS values; Sentinel-1 comparison and eruption reporting are complementary context, not proof of volcanic causation.
- **Chókwè:** the matching NISAR BETA pair was processed into 127 HH-darkening candidates covering 29.87 km². HLS common-clear coverage is 1.26% of the 112.14 km² study box; all candidate area is unassessed. A later UNOSAT Sentinel-1 water extent overlaps 88.2%/89.1% of candidates (23/24 Jan), but temporal offset, preliminary status, and no negative labels preclude an accuracy claim. The case remains unverified.

Full values, acquisition offsets, data links, and limitations are in [evidence-report.md](evidence-report.md). The machine-readable saved wetland checks are in [evidence-inventory.json](evidence-inventory.json).

## Not claimed

The application does not claim worldwide flood/forest/deformation classification, validated flood or forest-loss accuracy, field-confirmed deformation, causal attribution, flood prediction, earthquake monitoring, or eruption forecasting. The challenge asks for one or more surface-change types; additional hazards are outside the current application scope.

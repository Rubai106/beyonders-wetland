# Project status and next work

Updated 29 October 2026. The project now contains three separate NISAR-oriented modules and five processed study areas: Hakaluki and Tanguar in Bangladesh, Chókwè in Mozambique, Rondônia in Brazil, and Hayli Gubbi/Erta Ale in Ethiopia. The global views are for observation discovery and coverage; they do not imply global change classifications.

## Implemented

- **Wetlands:** global NISAR imagery and acquisition footprints; real HH/HV GCOV studies for Hakaluki and Tanguar; date series, study boundaries, candidate layers, evidence panels, HLS checks, and local processing tools.
- **Forests:** global historical ESA WorldCover 2021 context and NISAR footprints; a seven-date Rondônia GCOV study with an independent HLS optical support comparison. The result remains unverified radar-change candidates.
- **Volcanoes:** global Smithsonian directory and NISAR GUNW coverage; a Hayli Gubbi/Erta Ale NISAR phase/coherence case with Sentinel-1 contextual comparison.
- **Mozambique event story:** NASA’s published NISAR before/during imagery for Chókwè, the project's own run on the matching BETA pair, CIMA event context, and a measured later-date spatial overlap with UNOSAT Sentinel-1 water extents. The HLS check remains inconclusive and the local result is still an unverified candidate map.
- **User experience:** place and coordinate search, layer controls, time selection, evidence cards, case walkthrough, comparative imagery, provenance, and explicit no-result states.

## Evidence status and release claims

The saved wetland and forest checks remain unverified. Hakaluki's 27 September HLS comparison has 50.7% study-area common-clear coverage but F1 0.074; a separate Hakaluki date has F1 0. Tanguar's 29 August check has 0.34% clear coverage, and a 22 September check has about 0.003%. Chókwè's BETA pair yields 127 HH-darkening candidates (29.87 km²); its HLS check has 1.26% common-clear coverage and assesses none of the candidate area. A later UNOSAT Sentinel-1 product overlaps 88.2%/89.1% of candidates on 23/24 January, six/seven days after the NISAR event, but is preliminary and has no field validation or assessed negatives. This is positive spatial support, not a validation score. Rondônia's 29 September radar candidate overlaps an exploratory HLS index-decrease signature, but no assessed negative reference exists. The volcano products show apparent LOS change and coherence; Sentinel-1 and the eruption record do not prove causal attribution.

See [evidence-report.md](evidence-report.md) for the full data, offsets, and limitations. The app must retain these outcomes rather than tune thresholds to create a favorable score.

## Remaining science work

1. **Chókwè reference comparison:** the local BETA run is complete and published. The later UNOSAT Sentinel-1 layer provides positive spatial support, but its 6–7 day offset, preliminary status, and lack of negative labels prevent accuracy assessment. Seek a closer-date or field reference; keep the HLS result inconclusive and publish no accuracy score.
2. **Wetland references:** seek a clearer independent observation window for Tanguar and inspect Hakaluki radar-only regions. Until coverage improves, keep both interpretations unverified.
3. **Forest reference:** if a dated authoritative alert or mapped loss reference overlaps the Rondônia box, import it with its date/confidence and keep absent alerts unassessed. Do not treat WorldCover 2021 or no-alert pixels as current forest truth.
4. **Volcano attribution:** pursue correction/reference data and a surveyed stable area before narrowing apparent LOS candidates to eruption-caused deformation.
5. **Reproducibility:** continue recording exact input IDs, maturity, dates, boundary provenance, method version, masks, checksums, reference status, and per-case limitations.

## Deliberate limits

This release does not claim worldwide flood or forest-loss detection, validated hazard maps, operational alerts, flood prediction, earthquake processing, or eruption forecasting. It presents worldwide observation coverage and a small set of local studies. A blank map area means no result is available.


## Agriculture / soil-moisture feasibility

The /agriculture workspace and isolated SME2 PROVISIONAL operator pipeline are implemented on the development branch. No real Agriculture result is published. The browser shows a verified no-publication state until genuine granules are processed and published. The product is not fully calibrated; the module is a soil-moisture measurement explorer, not crop-stress/drought/irrigation/yield detection. Live Earthdata processing and full project regression remain release gates. See [Agriculture method](agriculture-method.md) and [Agriculture release status](agriculture-release.md).

# Scientific method and limitations

## Product and detector

The app uses NISAR L2 GCOV gamma-zero power, usually frequency A HHHH/HH and HVHV/HV. It reads actual scene CRS, spacing, power units and quality layers, masks invalid/fill/look-count pixels and study boundaries, and aligns HH/HV before calculating change. The real pipeline uses a per-pixel median of preceding compatible observations after the first date. The current configured thresholds flag illustrative HH-darkening/open-water and HH-increase with stable-HV/vegetated-inundation candidates. These rules do not uniquely identify flooding; soil moisture, crop state, surface roughness, seasonal water, wind, viewing geometry and calibration can influence backscatter.

A polygon's reported area comes from the original native-grid result. The publisher simplifies only its separate web display geometry and records that simplification; use source GeoTIFFs/original GeoJSON for measurement. Visual previews may be resampled and must not be mistaken for detection input.

## Independent HLS comparison

NASA HLS Landsat L30 and Sentinel-2 S30 reflectance supplies a cross-sensor optical water-change indicator using green/SWIR MNDWI and HLS Fmask exclusions. Candidate and validity fractions are area averaged to native HLS cells; zero means measured absence, while masked pixels are excluded. HLS is an imperfect reference: clouds, temporal offsets, mixed pixels, vegetation and index thresholds all affect agreement. It is not field truth and this workflow evaluates open water, not flooded vegetation.

Only report scores when the recorded reference status is usable and common clear coverage meets the configured 20% floor. State the native optical resolution, common clear area/fraction, candidate fraction assessed, and NISAR↔HLS offsets. Low coverage is `INCONCLUSIVE`, never a zero score. `reference_validated` remains false for satellite-to-satellite comparisons.

## Baseline-water diagnostic

`baseline_water_experiment.py` accepts an independent baseline-water mask and an explicit known-data mask. It returns candidate-over-baseline-water, new-water-eligible and unknown-baseline masks separately. It is an experimental screen, not an updated production classifier. Never derive a mask from the held-out reference dates used for the reported final score. Unknown baseline pixels remain unassessed.

## Provenance and interpretation

NISAR BETA and PROVISIONAL are different maturities and must not be silently combined. Each case names its exact collection, scene IDs, time span, boundary source, HH/HV rules, mask, thresholds, reference scenes, offsets, coverage and software method version. A runnable pipeline does not validate an interpretation. Supported wording follows evidence; otherwise say “unverified radar-change candidates.”

## Known cases

Hakaluki's clearest saved HLS check has weak agreement and many radar-only pixels over water on both dates. Tanguar's mapped boundary has very limited common-clear HLS coverage. These cases currently do not support a confirmed flood claim. Chókwè's local January BETA run flags 127 HH-darkening candidates (29.87 km²) using a single-date baseline and a −2.5 dB rule. Its best date-matched HLS pair has 1.26% common-clear coverage and assesses none of the candidates; that comparison is inconclusive. A separate native-grid follow-up reprocessed the pinned NISAR pair and compared its 10 m grid with GFM NRT v4.1.0 item `ENSEMBLE_FLOOD_20260117T031847_VV_AF020M_E066N021T3`, acquired 23 minutes 45 seconds before the NISAR event scene. Positive GFM support covered 57,997 of 147,151 eligible OPEN_WATER candidate pixels (39.4133%, 5.7997 km²). This is positive-only algorithm-to-algorithm spatial support, not field validation, precision, recall, F1, accuracy, or candidate-level confirmation; the original published run remains unchanged. A separate raster overlay finds that UNOSAT Sentinel-1 water extents from 23/24 January overlap 88.2%/89.1% of the NISAR candidates, six/seven days after the 17 January scene, with all candidates inside the reference analysis extent. This is positive follow-up spatial support only. The product is preliminary, not field-validated, and provides no assessed reference-negative pixels, so the overlay is not precision, accuracy, or proof of same-date inundation. NASA imagery and CIMA/UNOSAT also provide regional event context. The temporally close GFM result strengthens cross-sensor algorithm agreement but does not replace field-reviewed positive and negative labels. Keep the local flood interpretation unverified.

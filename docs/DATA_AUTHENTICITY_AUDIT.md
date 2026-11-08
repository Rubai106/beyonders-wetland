# Beyonders — Data Authenticity Audit (Phase 2)

Audited 2026-11-08 against the actual files on branch `Rubai-dev`
(HEAD `a5d72dc` + uncommitted Tanguar-surfacing change). Every claim below
was checked against a stored file, a stored manifest, or a live NASA
metadata response fetched during the audit. Nothing in this document is
inferred from a README alone.

A SHA-256 checksum verifies file integrity against a recorded digest. It
does **not** prove the original source, measurement accuracy, or scientific
validity. This audit therefore traces each study back to its source
collection, product identifier, acquisition dates, processing method, and
quality screening — and says plainly where the chain is thin.

## Method

- Read every published study's manifests, catalog entries, processing
  outputs, and reference evidence in `public/`.
- Recomputed spot checks: Tanguar `boundary.geojson` SHA-256 matches its
  recorded digest; `pulse.json` peak (24.4765 km², 2026-08-29, 295 patches)
  matches the `sensitivity.json` sweep at 2.5 dB exactly.
- Ran `pipeline/verify_showcase.py --case-id featured`: 68/68 packaged
  payloads pass SHA-256 (Phase 1 result, re-confirmed in the audit window).
- Fetched the official NASA CMR variable metadata (UMM-Var) for
  `NISAR_L3_SME2_PROVISIONAL_V1` live during the audit (collection
  `C2854344945-ASF`) to resolve the SME2 flag dispute — see §7.
- Environment limit at audit time: shell file writes, `next build`, and
  browser E2E are blocked by a VM-level EPERM fault; `tsc`, `eslint`,
  `node --test`, and read-only Python checks still run. Browser re-verification
  of the Hakaluki wording fix is therefore pending, not passed.

## Data categories used in this audit

- **A — Official source observations.** Real downloaded observations from
  identifiable source collections (NISAR L2 GCOV/GUNW, L3 SME2).
- **B — Derived scientific measurements.** Computed from real inputs with a
  documented algorithm (change candidates, LOS displacement, soil moisture).
- **C — External reference evidence.** Optical imagery (HLS), land-cover
  (ESA WorldCover), rainfall (IMERG), geological catalogues (Smithsonian GVP).
- **D — Catalogue and contextual information.** Acquisition footprints,
  historical land-cover layers, availability metadata.
- **E — Synthetic or test-only information.** Mock responses, fixtures,
  simulated rasters. Category E must never appear as production evidence.
  No published study in this audit contains category E material presented
  as evidence; fixtures exist only under `pipeline/` test files and are
  labelled as such.

## 1. Tanguar Haor — Wetlands (flagship)

- **Source (A):** 7 NISAR L2 GCOV scenes + 2026-06-18 baseline, all track
  069, frame 014, ascending, release P05023. Product
  `NISAR_L2_GCOV_PROVISIONAL_V1`. Source string: "NASA/JPL NISAR L2 GCOV
  via NASA CMR / ASF DAAC (processed locally; raw HDF5 not distributed)".
- **Boundary (D):** Bangladesh CRIIPS Haor Boundary layer 147, OBJECTID 202
  — explicitly *not* Ramsar site 1031.
- **Derived (B):** `pulse.json` peak 24.4765 km² on 2026-08-29 (295 patches);
  matches the sensitivity sweep at 2.5 dB. Displayed statistics correspond
  to stored results.
- **Reference (C):** INCONCLUSIVE. `reference.json` documents 15 HLS pairs
  evaluated (max-common-clear selection, 5-day tolerance, real HLS scene
  IDs); the cross-sensor check was not completed. Tanguar HLS common-clear
  coverage is 0.333%. The headline metrics are computed zeros, not nulls
  (TP 0, FP 23, FN 29 over 3,880 common-clear pixels → precision/recall/F1
  0.0) — a real computed result that is still inconclusive because coverage
  is below the 20% floor.
- **Integrity:** 68 SHA-256 checksums in the showcase package; spot-check
  of `boundary.geojson` MATCH; `total_bytes` 31,089,421.
- **Acceptance gate:** source identified ✓, metadata verified ✓, integrity
  verified ✓, product compatibility verified ✓, quality screening complete
  ✓, processing reproducible ✓, independent reference available ✗
  (inconclusive), validation assessed ✗. Correctly published as
  **exploratory**, never as a validated flood detector.
- **Granule parsing note:** filename tokens are cycle, track, direction,
  frame, bandwidth, pol, acquisition, then start/stop/release. The
  incrementing number in Tanguar filenames (024→031) is the **cycle**, not
  the track. All scenes share track 069, so they are geometrically
  compatible.

## 2. Hakaluki Haor — Wetlands

- **Source (A):** run `d6e65a58802e4cf4907ddefa42a435d6`, release 2026.10.07.
  7 scenes, track 141, frame 014, ascending, P05023. Method
  `hh-hv-change-v1`. 213 patches, 2.57 km². Baseline HH temporal MAD
  0.962 dB; threshold 2.5 dB; stability verdict SENSITIVE (stable 2.0–3.0 dB).
- **Integrity:** no *standalone* checksums file exists in the release
  directory — but `publication.json` carries a per-artifact SHA-256 map
  (81 digests; all 81 verified matching on disk 2026-11-08, Phase 3).
  `/observability` now reads that map (`checksumsPresent: true`). The
  catalog entry is thin — most provenance fields are null.
- **Reference (C):** INCONCLUSIVE, and this is where the audit found a
  **critical presentation defect** (fixed in this pass, see below).

### Defect: headline metrics misattribution (FIXED 2026-11-08)

The widely-cited figures — precision 12.9%, recall 5.2%, F1 7.4% — are
real, but they belong to the **2026-09-27 date check**
(`date_checks/2026-09-27/evidence.json`: optical_support precision 0.1288,
recall 0.0522, f1 0.0743; common-clear 50.7% of the study area; candidate
assessed fraction 0.933; `counts_reproduced: true`; radar-grid metrics
0.1344/0.0617/0.0846). Origin: `docs/evidence-report.md` line 9, which
attributes them correctly to "Hakaluki Haor · 27 Sep 2026".

The **headline case** (`case_study.json`, pair 2026-06-23 → 2026-07-17) has
**null** reference metrics: TP=FP=FN=0, only **9 common-clear pixels** of
1,729,130 valid (fraction 5.2e-6), status INCONCLUSIVE, reason "Too few
co-registered, cloud-free pixels overlap the wetland mask for a useful
check."

Phase 3 code and three Phase 1 documents repeated the numbers without the
date, implying they described the headline pair:

- `src/lib/observation-health.ts:136` (validationNote)
- `docs/MASTER_PLATFORM_AUDIT.md:91`
- `docs/SCIENTIFIC_VALIDATION_MATRIX.md:17`
- `docs/COMPETITION_READINESS.md:15`

**Fix applied:** all four now pair the numbers to the 27 Sep 2026 date
check and state the headline pair is unassessable (9 common-clear pixels).
`docs/evidence-report.md` already attributed them correctly and was not
changed. (The live `~/MEMORY.md` was checked 2026-11-08 and does not
carry the unattributed wording, so no memory correction is outstanding.)

## 3. Rondônia — Forests

- **Source (A):** `public/forests/rondonia/2026.10.08-v1/study.json`.
  Exemplary provenance: per-input `granule_id` + `cmr_concept_id` (e.g.
  `G4250796722-ASF`) + per-file `subset_sha256`. Compatibility tuple:
  track 161 / frame 172 / A / 20 / DH / P05023.
- **Reference (C):** ESA WorldCover 2021 v200 class 10, with source URL and
  subset SHA-256. Bbox [-62.75,-10.4,-62.55,-10.2]; CRS EPSG:32720; pixel
  0.0004 km². Method `forest-hv-persistence-1.0.0`. Interpretation
  `UNVERIFIED_RADAR_CHANGE_CANDIDATES`.
- **Derived (B):** per-date stats stored (e.g. 2026-08-24: 0.0 km²
  candidates, 148.3488 km² eligible, HLS common-clear 0.997).
- **Integrity:** `index.json` carries archive + native-archive SHA-256;
  `checksums.json` covers 65 files.
- **Acceptance gate:** all stages through reproducible ✓; independent
  reference available ✓ (WorldCover + HLS); validation assessed ✗ —
  correctly labelled unverified candidates.

## 4. Hayli Gubbi / Erta Ale — Volcanoes

- **Source (A):** current version `2026.10.30-v3` (resolved via
  `public/volcanoes/hayli-gubbi/index.json`; v2 exists but is superseded),
  method `gunw-relative-los-1.0.1`. GUNW pairs with granule IDs + CMR concept IDs
  (e.g. `G4058289806-ASF`), collection `NISAR_L2_GUNW_BETA_V1` (**BETA** —
  labelled as such, never mixed silently with PROVISIONAL), direct
  `data_url`s to ASF Earthdata Cloud. Track 172, ascending, left-looking,
  HH; product v1.0.2; upstream processor R05.00.8; wavelength 0.24393 m;
  CRS EPSG:32637; 80 m spacing; phase-sign convention documented;
  `original_dates_verified: true`; per-pair `subset_sha256` + config and
  method-source SHA-256.
- **Corrections:** ionosphere, troposphere, solid-earth-tides all
  **NOT_APPLIED** — disclosed, not hidden. Coherence floor 0.3.
- **Reference (C):** Sentinel-1 comparisons, common-valid fraction ≈0.815.
  Event date 2025-11-23. Catalog source: Smithsonian GVP Volcanoes of the
  World v5.4.0.
- **Limitation, stated in the data:** the reference patch is an *assumption*
  ("west of the volcanic chain; assumed stable… not surveyed or proven
  stationary"). Interferogram signals are never presented as eruption or
  deformation predictions.

## 5. Kīlauea Episode 36 — Volcanoes

- **Source (A):** current `2026.10.30-v3`, same method
  `gunw-relative-los-1.0.1`. Single GUNW pair 2025-11-03 → 2025-11-15
  (concept `G4058287539-ASF`, track 072, **descending**). Event 2025-11-09.
- **Reference (C):** availability `EVENT_CONTEXT_ONLY`. Corrections
  NOT_APPLIED. Has `evidence-card.json`.
- **Acceptance gate:** through reproducible ✓; validation assessed ✗.
  Audited independently of Hayli Gubbi as the directive required; no
  cross-study assumptions were transferred.

## 6. Naogaon — Agriculture

- **Source (A):** `public/agriculture/current/study.json`, id/run
  `agri-41647231453`, published 2026-11-03 via GitHub Actions run
  #41647231453. Product `NISAR_L3_SME2_PROVISIONAL_V1`, algorithm **DSG**
  (`algorithmCandidates`). 10 CMR concept IDs in provenance. Track 170 /
  frame 014 / A / DHDH / 4005 / P05023. AOI 88.42–88.57E / 24.97–25.12N.
  CRS EPSG:6933; grid 86×73; ~200.18 m pixels; coverage floor 0.20.
- **Derived (B):** baselines 2026-08-12/08-24/09-17, target 2026-10-23; 6
  valid observations with granule names + median/p05/p95 + 1,616
  fill-excluded pixels each. Change summary: median +0.0328 m³/m³, valid
  fraction 0.2131 (1,338/6,278). Target median 0.3598, valid 0.5792.
- **Quality protocol (recorded verbatim in the study):** "NASA/JPL
  D-107677 Rev C retrievalQualityFlag == 0 (zero=clear; non-zero=anomaly);
  … soilMoisture in [0.02,0.60] m³/m³; finite non-negative uncertainty;
  surfaceQualityFlag == 0". Quality exclusions (2026-06-25, 07-07, 07-19,
  …) all `NO_VALID_PIXELS_AFTER_SELECTED_ALGORITHM_QUALITY_SCREEN` with
  `retrieval_interpretation: "candidate-zero-clear"`, 0/6,278 valid pixels.
- **Sources cited:** ASF SME2 guide and the D-107677 Rev C spec PDF.
  Native GeoTIFFs are referenced but not in the public package — honestly
  disclosed, not silently omitted.
- **Flag dispute:** see §7 — resolved in favour of the live code.

## 7. SME2 quality-flag discrepancy — RESOLVED (retrieval), NARROWED (surface)

### The conflict

The live code (`pipeline/agriculture_sme2.py`, `quality_mask()`) gates on
`retrievalQualityFlag == 0` and `surfaceQualityFlag == 0` (zero-clear).
The Step 6 QA bundle (a different code lineage) used a bits rule for the
retrieval mask: bits 0–3 set and bits 4–7 clear — within a byte, exactly
value 15. The two rules are mutually exclusive: 0 passes one and fails the
other.

### Official evidence (fetched live 2026-11-08)

NASA CMR UMM-Var for `NISAR_L3_SME2_PROVISIONAL_V1`, variable
`/science/LSAR/SME2/grids/retrievalQualityFlag` (collection
`C2854344945-ASF`):

> "Soil moisture retrieval quality flag while **0 means clear and
> non-zero means anomaly**. Flag bits 0: Retrieval recommended flag; 1:
> Retrieval attempted flag; 2: Retrieval success flag; 3: Soil moisture
> thresholds between (0.02 and 0.60); 4: NISAR σhh anomaly flag; 5: NISAR
> σhv anomaly flag; 6: NISAR σvv anomaly flag; 7: NISAR σvh anomaly flag."

**Verdict: zero-clear is correct. The bundle rule is wrong.** It rejects 0
(the only value the official metadata calls clear) and accepts 15 (which
the metadata calls an anomaly).

### Real-data falsification

The published Naogaon study records per-observation retrieval flag counts
(AOI 6,278 px). Observed values across all 6 observations: `-9999` (fill,
40 px), `0`, `1`, `77`, and `9` (2 px, 2026-10-11 only). Zero-clear pass
counts: 3636 / 1338 / 3636 / 3636 / 3634 / 3636. The bits rule passes
**0 pixels in every observation** — no real granule pixel carries value 15
— so adopting it would leave the published study with no valid data at all.
The published change summary (1,338 valid pixels) equals the smallest
per-observation zero-clear count (2026-08-24 baseline), which is only
possible under zero-clear gating. Flag 77 (bits 0, 2, 3, 6 set) includes
bit 6, the σvv anomaly flag — correctly excluded by zero-clear.

### Tests

`pipeline/test_agriculture_sme2.py`, new class `SME2FlagInterpretationTests`
(3 tests, all passing 2026-11-08):

1. Both interpretations side by side on values [0, 1, 7, 9, 15, 77, 255,
   -9999] — zero-clear accepts only 0; the bundle rule accepts only 15.
2. Real Naogaon flag counts from `study.json` — zero-clear counts match
   the published study per observation; bits-rule count is 0 everywhere;
   change-summary valid pixels (1,338/6,278) reproduced.
3. Surface flag: values 256/512 (bits 8–9, observed in real granules, see
   below) are excluded by the `== 0` gate — unknown encodings cannot leak
   into a valid mask.

### Surface flag — RESOLVED 2026-11-08 (JPL D-107677 Rev C, Table 4.2.1)

The spec PDF is now reachable, and its Table 4.2.1 gives the
`surfaceQualityFlag` definition verbatim
(`/science/LSAR/SME2/grids/ancillaryData/surfaceQualityFlag`, Int16):

> "Surface quality flag. Flag bits 0: Static water body flag; 1: Urban
> area flag; 2: Precipitation flag; 3: Snow or ice flag; 4: Permanent
> snow or ice flag; 5: Frozen ground flag based on soil surface
> temperature; 6: Terrain flag; 7: Dense vegetation flag."

The spec defines **only bits 0–7**, and the code's `SURFACE_FLAG_BITS`
matches that table exactly. **Bits 8–9 carry no defined meaning in Rev C.**
The same table independently confirms the retrieval flag ("0 means clear
and non-zero means anomaly", bits 0–7 as quoted above), so both flags are
now grounded in the primary source, not only in CMR metadata. Real
granules set bits 8 and 9 (values 256 and 512; 2,559 px in the 2026-08-12
observation); they are honestly recorded as `unsupported_encoding_pixels`
and excluded by the `== 0` gate, so the published valid mask is
unaffected. **No gate change: the current handling is correct, and no
code change was made.** (Caveat: Rev C is dated Nov 8, 2024; if a later
revision defines bits 8–9, the table should be revisited then.)

### Quality gates were not weakened

No threshold, gate, or mask was changed to resolve this dispute. The live
code was already correct; the resolution is documented evidence plus
regression tests, not a code change.

## 8. Chókwè — standing record corrected

The earlier record ("Chókwè BETA processing still unrun") is outdated.
`public/studies/releases/2026.10.29-chokwe/runs/ec8fa5ee15ae41d1aa89f930f2b47e36/`
holds a **completed** run (mode `real`, input origin NISAR_GCOV, product
`NISAR_L2_GCOV_BETA_V1`, completed 2026-10-28T20:01:59Z): baseline
2026-01-05 → event 2026-01-17 (event granule
`NISAR_L2_PR_GCOV_010_114_A_165_4005_DHDH_A_20260117T034232…_X05010`),
29.872 km² / 127 patches, reference INCONCLUSIVE (too few common-clear
pixels). BETA maturity is labelled; it is not mixed with PROVISIONAL
results.

## 9. Acceptance-gate summary

| Study | Source | Metadata | Integrity | Compat. | Screening | Repro. | Reference | Validation |
|---|---|---|---|---|---|---|---|---|
| Tanguar Haor | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ inconclusive | ✗ |
| Hakaluki Haor | ✓ | partial | ✗ no checksums | ✓ | ✓ | ✓ | ✗ inconclusive | ✗ |
| Rondônia | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Hayli Gubbi | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (S1) | ✗ |
| Kīlauea | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | event-only | ✗ |
| Naogaon | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (IMERG context) | ✗ |

No study reaches "validation complete". That is honest and by design: the
maturity ladder must never award green completion indicators for stages
that have not been completed.

## 10. Remaining integrity work

1. ~~Hakaluki: add a checksums file to the release directory~~ — RESOLVED
   2026-11-08 (Phase 3): no standalone checksums file exists, but
   `publication.json` carries a per-artifact SHA-256 map; all 81 recorded
   digests match the files on disk (0 mismatches, 0 missing). The two
   files outside that map are `evidence_card.json` and `publication.json`
   itself. `/observability` now reads the map (`checksumsPresent: true`).
   The catalog entry's provenance fields are still thin.
2. ~~Surface flag bits 8–9: confirm against D-107677 Rev C~~ — RESOLVED
   2026-11-08 (Phase 3): Rev C Table 4.2.1 defines only bits 0–7; bits
   8–9 are undefined in the spec. Gate unchanged (`== 0`, fail-closed).
3. Browser re-verification of the Hakaluki wording fix once the environment
   recovers (Chromium SIGTRAP + shell EPERM at audit time).

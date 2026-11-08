# PHASE 4 SCIENCE AUDIT — Beyonders, master-targeted

Date: 2026-11-08. Scope: all seven published investigations, re-verified against
the published files in this checkout (not from memory of Phase 2/3).
Method: read the manifests directly (`public/studies/catalog.json`,
`case_study.json`, `reference.json`, `publication.json`, `study.json`,
`run_manifest.json`) and recompute the headline figures.

## 1. Results re-verified this session

| Study | Check | Result |
|---|---|---|
| Tanguar Haor | Showcase integrity | 68/68 payload files match SHA-256 (`pipeline/verify_showcase.py --case-id featured`, PASS) |
| Tanguar Haor | Reference coverage | 3,880 common-clear of 1,166,097 valid pixels (0.3327%, floor 20%) — INCONCLUSIVE |
| Tanguar Haor | Reference metrics | TP 0, FP 23, FN 29; P/R/F1/IoU 0.0 — computed zeros, not nulls |
| Hakaluki Haor | Fingerprints | **81/81** recorded SHA-256 digests + byte sizes match (`publication.json` artifacts) |
| Hakaluki Haor | Headline pair | 9 common-clear of 1,729,130 valid (5.2e-06); metrics null (TP=FP=FN=0) — unassessable |
| Hakaluki Haor | 27 Sep date check | P 0.1288 / R 0.0522 / F1 0.0743; common-clear fraction 0.5072; candidate assessed 0.933 — belongs to the date check ONLY |
| Chókwè | Fingerprints | **24/24** recorded SHA-256 digests + byte sizes match (`publication.json` artifacts) |
| Chókwè | Processing | `run_manifest.json`: status COMPLETE, mode real, product NISAR_L2_GCOV_BETA_V1, completed 2026-10-28T20:01:59Z; 127 patches, 29.872 km²; reference INCONCLUSIVE |
| Rondônia | Candidate | 1 candidate, 0.0128 km² (2026-09-29 frame); optical support overlap 0.7109 (71.1%); 4 frames, 7 input granules; method `forest-hv-persistence-1.0.0`; interpretation UNVERIFIED_RADAR_CHANGE_CANDIDATES |
| Hayli Gubbi | Pairs | 5 pairs (3 NISAR GUNW + 2 Sentinel-1 ARIA GUNW); corrections NOT_APPLIED; reference patch assumed |
| Kīlauea | Pairs | 1 GUNW pair 2025-11-03 → 2025-11-15; reference EVENT_CONTEXT_ONLY; corrections NOT_APPLIED |
| Naogaon | Valid coverage | 1,338 of 6,278 valid (21.31%); median change +0.0328 m³/m³ (p05 −0.0206, p95 +0.1580) |

## 2. Hakaluki attribution — preserved

Two assessments remain separate everywhere they are displayed (lineage graph,
`/observability`, evidence panels, and now the Quality Explorer):
- Headline 23 Jun → 17 Jul 2026: 9 pixels, unassessable, metrics null.
- 27 Sep 2026 date check: P 12.9% / R 5.2% / F1 7.4%, weak agreement.
No standalone Hakaluki checksums file exists; the claim is the 81-artifact
publication record, verified twice (Phase 3 and this session).

## 3. Tanguar — computed zeros

TP 0 / FP 23 / FN 29 with P/R/F1/IoU 0.0 are computed from 3,880 overlapping
pixels. They are displayed as zeros with the denominator, never as nulls and
never as proof of no change. The outcome stays INCONCLUSIVE.

## 4. SME2 quality — final, unchanged

Live code `pipeline/agriculture_sme2.py` `quality_mask()` gates on
`retrievalQualityFlag == 0` AND `surfaceQualityFlag == 0` (zero-clear), per CMR
UMM-Var (collection C2854344945-ASF): "0 means clear and non-zero means anomaly".
The old Step 6 bits rule (value 15 only) stays falsified — no pixel anywhere has
value 15; published valid count 1,338 = 2026-08-24's zero-clear count.
JPL D-107677 Rev C Table 4.2.1 defines surface-quality bits 0–7 only; bits 8–9
observed in real granules are undefined there and are fail-closed by the `== 0`
gate. No gate change in Phase 4. The Phase 3 comment-only edit citing Rev C
Table 4.2.1 stands. Distinctions kept: defined bits / undefined bits / NoData /
invalid values / unassessed observations.

## 5. Chókwè — defect fixed in Phase 4

Chókwè was a published investigation with completed real processing that did
not appear on `/observability` at all. Fixed: `src/lib/observation-health.ts`
now loads it from the catalog (run `ec8fa5ee…`, 24/24 fingerprints verified),
with state INCONCLUSIVE_VALIDATION and no validation stage. `/observability`
now lists all 7 published investigations. Processing completed is still not
presented as validation.

## 6. No study validated

The maturity ladder's validation column is empty for all seven studies, by
evidence and by design. This is a disclosure for judges, not a bug to hide.

## 7. Remaining uncertainties (not invented)

- `web_job.py` → `run_pipeline` mode argument (demo vs real) still untraced;
  `pipeline/main.py` defaults to `mode="demo"`.
- Hakaluki catalog entry is thin (most provenance fields null); the app still
  does not re-verify catalog-run artifacts at load time the way the showcase
  loader verifies Tanguar (Chókwè/Hakaluki fingerprints were verified by hand
  in this audit, not by the app at runtime).
- If a later JPL spec revision defines SME2 bits 8–9, the fail-closed gate
  must be revisited.

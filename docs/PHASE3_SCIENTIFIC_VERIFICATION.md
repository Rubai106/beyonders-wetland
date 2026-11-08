# Phase 3 — Scientific Verification

**Date:** 2026-11-08
**Branch:** `Rubai-dev` (HEAD `fb3d445`; all work local, no push, no merge)
**Scope:** close the four open scientific questions from Phase 2 (§5 of the
Phase 3 directive) and verify the corrected facts everywhere they are shown.
Two of the four are now **resolved**; the other two were **verified against
the source manifests**.

## 1. Hakaluki checksums — RESOLVED (better than expected)

**Finding.** The claim "Hakaluki has no checksums file" was imprecise. There
is no *standalone* `checksums.json` in the release directory, but the run's
`publication.json` (written at publication time, 2026-10-07) carries a
per-artifact SHA-256 map.

**Verification (run 2026-11-08, pure reads):**

| | Count |
|---|---|
| Artifacts recorded in `publication.json` | 81 (each with `sha256` + `bytes`) |
| Files on disk in the run directory | 83 |
| Recorded digests matching the files on disk | **81 / 81, 0 mismatches, 0 missing** |
| Files on disk outside the map | 2: `evidence_card.json` and `publication.json` itself (a manifest cannot hash itself) |

**What this means.** The published Hakaluki files are intact as of the
2026-10-07 publication record. No new "trusted" checksum file was created
by hashing the local files — that would be circular. Instead, the existing
publication record is now *used*: `src/lib/observation-health.ts` reads
the run's `publication.json` (via the catalog `path`) and sets
`checksumsPresent` from its artifact map, so `/observability` now reports
Hakaluki as "Published and verifiable" instead of "Not published for this
study". A test pins it (`observation-health.test.ts`).

**Remaining gap (honest).** The app does not re-verify Hakaluki artifacts
at load time the way the showcase loader verifies Tanguar (fail-closed
SHA-256). The 81/81 check above was a one-off audit verification, not a
runtime gate. Porting the showcase integrity pattern to catalog runs is
recommended follow-up, not done here (it needs browser verification, which
is blocked — see `docs/PHASE3_ENVIRONMENT_REPAIR.md`).

## 2. SME2 surface-flag bits 8–9 — RESOLVED (authoritative source)

**Question.** Real Naogaon granules set `surfaceQualityFlag` bits 8–9
(values 256/512; 2,559 px in the 2026-08-12 observation). The code's
`SURFACE_FLAG_BITS` covers bits 0–7 only, and the CMR metadata gave no bit
table for the surface flag.

**Answer (fetched live 2026-11-08).** JPL **D-107677 Rev C** (Nov 8, 2024),
* NASA SDS Product Specification, Level-3 Soil Moisture (L3_SME2)*,
Table 4.2.1, `/science/LSAR/SME2/grids/ancillaryData/surfaceQualityFlag`
(Int16):

> "Surface quality flag. Flag bits 0: Static water body flag; 1: Urban
> area flag; 2: Precipitation flag; 3: Snow or ice flag; 4: Permanent
> snow or ice flag; 5: Frozen ground flag based on soil surface
> temperature; 6: Terrain flag; 7: Dense vegetation flag."

**The spec defines only bits 0–7.** The code's `SURFACE_FLAG_BITS`
matches that table exactly (static_water 0, urban_area 1, precipitation 2,
snow_or_ice 3, permanent_snow_or_ice 4, frozen_ground 5, terrain 6,
dense_vegetation 7). **Bits 8–9 carry no defined meaning in Rev C.**

**Consequences.**
- **No gate change.** The live `surfaceQualityFlag == 0` gate excludes
  bits 8–9 (fail-closed); the published valid mask is unaffected. An
  unknown encoding can never leak into a valid mask. The test
  `test_surface_flag_unknown_high_bits_are_fail_closed` pins this, and its
  comment now cites Rev C Table 4.2.1.
- The same table independently confirms the retrieval flag ("0 means
  clear and non-zero means anomaly", bits 0–7 as quoted in Phase 2), so
  both flags are now grounded in the primary source, not only in CMR
  metadata.
- Caveat: Rev C is dated Nov 8, 2024. If a later revision defines bits
  8–9, the table should be revisited then. Until then, "undefined in the
  spec, excluded by the gate" is the correct and complete statement.

## 3. Hakaluki reference wording — VERIFIED EVERYWHERE

Every displayed occurrence of the 12.9% / 5.2% / 7.4% figures was checked
(grep across `src/` and `docs/`, 2026-11-08). All of them attribute the
figures to the **27 Sep 2026 date check** and state that the headline
**23 Jun → 17 Jul 2026** pair is unassessable (9 common-clear pixels of
1,729,130 valid). No occurrence reintroduces the old misleading label.

| Location | Wording |
|---|---|
| `src/lib/observation-health.ts:136` (the `/observability` note) | "27 Sep 2026 date check: weak agreement … (precision 12.9%, recall 5.2%, F1 7.4%). The headline 23 Jun → 17 Jul pair is unassessable — only 9 cloud-free pixels overlap the wetland mask." |
| `docs/evidence-report.md:9` | Table row headed "Hakaluki Haor · 27 Sep 2026", "Weak agreement". |
| `docs/MASTER_PLATFORM_AUDIT.md:91`, `docs/SCIENTIFIC_VALIDATION_MATRIX.md:17`, `docs/SCIENTIFIC_EVIDENCE_LINEAGE.md:57`, `docs/PHASE2_PRODUCT_AUDIT.md:23`, `docs/PHASE2_QA_REPORT.md:38` | All explicitly "27 Sep 2026 date check" + headline pair unassessable. |
| `/lineage` (verified by the geometry script, §4 below) | Two separate reference nodes: headline pair INCONCLUSIVE (metrics null) and 27 Sep date check WEAK_AGREEMENT (P 12.9%, R 5.2%, F1 7.4%). |
| `src/lib/lineage-studies.test.ts:35–37` | Pins the date-check precision 0.1288 / recall 0.0522 / F1 0.0743 against the real manifest. |

The headline pair's null metrics are also confirmed in the source:
`case_study.json` `reference_validation` has TP=FP=FN=0 with 9
common-clear pixels (`common_clear_fraction` 5.5e-06) — a null, not a
computed zero. (Contrast Tanguar, §4: computed zeros.)

## 4. Other corrected study facts — VERIFIED AGAINST MANIFESTS

| Fact | Source (read 2026-11-08) | Result |
|---|---|---|
| **Chókwè processing status** | `public/studies/releases/2026.10.29-chokwe/runs/ec8fa5ee…/run_manifest.json` | `status: COMPLETE`, `mode: real`, completed 2026-10-28T20:01:59Z, product `NISAR_L2_GCOV_BETA_V1`. Complete, not unrun. |
| **Hayli Gubbi v3 provenance** | `public/volcanoes/hayli-gubbi/index.json` | Current version `2026.10.30-v3`, `study_url` + `evidence_url` + archive `sha256`. v2 superseded. |
| **Kīlauea v3** | `public/volcanoes/kilauea-episode-36-2025/2026.10.30-v3/study.json` | v3 present; LOS GeoTIFF `nisar-2025-11-03-2025-11-15/los_cm.tif` exists on disk. (Note: the directory is `kilauea-episode-36-2025`, not `kilauea`.) |
| **Tanguar reference counts** | `…/runs/3b01cdb5…/case_study.json` `reference_validation` | **Computed zeros, not nulls:** TP 0, FP 23, FN 29 → P/R/F1 0.0, IoU 0.0, over 3,880 common-clear pixels of 1,166,097 valid (0.333%, below the 20% floor). Status INCONCLUSIVE. |
| **Tanguar integrity** | `pipeline/verify_showcase.py --case-id featured` | **68/68 payload files match SHA-256** (re-run 2026-11-08). |
| **Hakaluki run** | `…/runs/d6e65a58…/run_manifest.json` | `mode: real`, `COMPLETE`, 7 scenes, track 141, frame 014, ascending, P05023, method `hh-hv-change-v1`, 213 patches, 2.57 km². |
| **Naogaon** | `public/agriculture/current/study.json` | `agri-41647231453`, SME2 PROVISIONAL, 6 observations, change valid 1,338/6,278. |

## 5. Lineage data check (all 7 studies)

A static verification script (Node, read-only) built and laid out every
lineage graph from the real manifests: 7 chains loaded, 0 unavailable,
**0 geometry issues** (no node overlaps, every edge resolves to a real
node, columns hold the expected kinds). Per-study node counts: Tanguar 14,
Hakaluki 15 (2 references), Chókwè 8, Rondônia 16, Hayli Gubbi 15,
Kīlauea 10, Naogaon 15. Missing-data nodes render as missing (Kīlauea:
"Sentinel-1 ARIA GUNW comparison" not recorded; Naogaon: "Independent
field or crop-condition reference" not recorded) — nothing is fabricated
to fill the gap.

## 6. Remaining scientific uncertainties (disclose to judges)

1. **No study reaches validation.** The maturity ladder's "validation
   complete" column is empty for all seven studies, by design and by
   evidence. Tanguar and Hakaluki references are inconclusive; Rondônia,
   Hayli Gubbi, Kīlauea, and Naogaon are exploratory.
2. **Hakaluki load-time verification.** The 81/81 digest check was an
   audit-time verification against `publication.json`; the app does not
   re-verify catalog-run artifacts at load (Tanguar's showcase loader
   does). Two files sit outside the digest map (`evidence_card.json`,
   `publication.json` itself).
3. **SME2 surface bits 8–9.** Undefined in D-107677 Rev C and excluded
   by the gate. If a later spec revision defines them, revisit the table.
4. **Hakaluki catalog entry** is still thin (most provenance fields
   null); the run manifest itself is complete.
5. **No independent field reference** exists for Naogaon (soil moisture)
   or Rondônia (forest loss); both are explicitly exploratory.

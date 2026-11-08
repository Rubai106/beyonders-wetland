# Beyonders — Phase 2 Product Audit

Audited and built 2026-11-08 on branch `Rubai-dev` (Phase 1 HEAD `a5d72dc`
plus uncommitted work; no push, no merge, per the Phase 2 directive).

## 1. What was inspected

- All six published studies' manifests, catalogs, processing outputs, and
  reference evidence (see `docs/DATA_AUTHENTICITY_AUDIT.md` for the
  study-by-study findings).
- The existing evidence layer (`src/lib/evidence-chain.ts`, builders per
  domain, `EvidenceChainPanel`), the observability page, the homepage, and
  the hypothesis/reporting libs (`scattering-hypothesis.ts`,
  `investigation-report.ts`).
  (Phase 3 removed the unimported legacy dashboard components
  `CounterfactualLab`, `DateScrubber`, `DemoExperience`, `EvidenceCard`,
  `MethodGuide`, `PatchTable`, `VegToggle`; `WetlandPulse` is live and kept.)
- The SME2 quality-flag code (`pipeline/agriculture_sme2.py`) against the
  official NASA CMR variable metadata (fetched live during the audit).
- The full test surface: node suite, tsc, eslint, Python suite.

## 2. Findings that changed something

| # | Finding | Action |
|---|---|---|
| 1 | **Hakaluki metrics misattribution (critical presentation defect).** Precision 12.9% / recall 5.2% / F1 7.4% were shown as the headline pair's result; they belong to the 27 Sep 2026 date check. The headline pair (23 Jun → 17 Jul) is unassessable: 9 common-clear pixels. | Fixed in `src/lib/observation-health.ts` + 3 docs; recorded in `DATA_AUTHENTICITY_AUDIT.md` §2. |
| 2 | **SME2 flag dispute — resolved.** CMR UMM-Var: retrievalQualityFlag "0 means clear and non-zero means anomaly". The Step 6 bundle's bits rule (value 15 only) is falsified by the real Naogaon flag counts (no pixel is 15; zero-clear reproduces the published 1,338 valid pixels). | 3 new tests in `pipeline/test_agriculture_sme2.py` (`SME2FlagInterpretationTests`), all passing. No gate was weakened; the live code was already correct. |
| 3 | **Surface flag bits 8–9 undefined in code.** Real granules set surfaceQualityFlag bits 8–9 (2,559 px); the code's table covers bits 0–7 only. The `== 0` gate excludes them, so no invalid pixel leaks. | RESOLVED Phase 3: JPL D-107677 Rev C Table 4.2.1 defines only bits 0–7; bits 8–9 are undefined in the spec. Gate unchanged. |
| 4 | **Hayli Gubbi current version is v3, not v2.** The index resolves to `2026.10.30-v3` (5 pairs: 3 NISAR + 2 Sentinel-1). The audit doc initially said v2. | Corrected in `DATA_AUTHENTICITY_AUDIT.md`; the lineage loader resolves versions through index.json. |
| 5 | **Tanguar headline metrics are computed zeros, not nulls** (TP 0, FP 23, FN 29 → P/R/F1 0.0 over 3,880 common-clear pixels). Still inconclusive (coverage 0.333% < 20% floor), but a different evidentiary state from Hakaluki's nulls. | Recorded in the audit doc and pinned by the lineage loader test. |
| 6 | **Chókwè processing is complete** (run `ec8fa5ee…`, BETA, 29.872 km² / 127 patches). The standing record said "unrun". | Corrected in the audit doc; Chókwè added to the lineage explorer as a 7th chain. |

## 3. What was built in Phase 2

- **Evidence Lineage Explorer** (`/lineage`): interactive SVG graph
  (result → method → screen → observations → reference → provenance) for
  all 7 published chains, built on the existing `EvidenceChain` builders.
  See `docs/SCIENTIFIC_EVIDENCE_LINEAGE.md`.
- **Observability maturity matrix**: studies × 8 stages at a glance, with
  observation-count bars, on `/observability` (cards kept for detail).
- **Homepage published-investigations strip**: real study markers from
  `listGlobeStudies()` plus the Naogaon study from its own manifest; links
  to `/lineage` and `/observability` added to nav and footer.
- **Hakaluki wording fix** and **SME2 interpretation tests** (above).

## 4. What already existed and was deliberately not rebuilt

- `EvidenceChain` builders + `EvidenceChainPanel` (the lineage explorer
  reuses them; no parallel data layer).
- Hypothesis workspace (`ScatteringHypothesisPanel`: 4 competing scattering
  explanations per candidate, with "not distinguished" as a real status).
- Evidence-aware reporting (`investigation-report.ts`: JSON/CSV/GeoJSON/HTML
  exports with provenance and limitations).
- Counterfactual threshold lab; per-domain workbenches with temporal
  timelines, comparison modes, and coverage checks.

## 5. Still open after Phase 2

1. Browser verification of `/lineage`, the observability matrix, and the
   homepage strip — blocked by the environment (Chromium SIGTRAP, shell
   EPERM, `next build` unwritable). Geometry is pinned by tests; the
   remaining risk is presentational.
2. ~~Hakaluki: no checksums file in the release directory; thin catalog entry.~~
   RESOLVED Phase 3: `publication.json` holds 81 SHA-256 digests, all
   verified matching; catalog entry still thin.
3. ~~Surface flag bits 8–9: confirm against D-107677 Rev C with direct access.~~
   RESOLVED Phase 3: Rev C Table 4.2.1 defines only bits 0–7; bits 8–9
   undefined in the spec; gate unchanged (`== 0`, fail-closed).
4. All Phase 2 work is uncommitted (environment blocks git writes; the
   directive forbids pushing in any case).
6. No real-user evaluation exists for any Phase 2 feature; no live-model or
   live-data test was fabricated to fill that gap.

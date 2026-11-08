# Phase 3 — Final QA

**Date:** 2026-11-08
**Branch:** `Rubai-dev` (HEAD `fb3d445`; all work local, no push, no merge)
**Scope:** visual acceptance, environment recovery, scientific
verification, and demo readiness for the Phase 2 product. No new features
were added beyond the §2–§3 visual improvements and the §5 scientific
corrections.

## 1. Code changes (Phase 3)

| File | Change |
|---|---|
| `src/lib/evidence-lineage.ts` | Column families: each lineage column now carries a `group` (`derived` / `process` / `measured` / `reference` / `record`) + `groupLabel`. Layout geometry unchanged. |
| `src/components/shared/EvidenceLineageExplorer.tsx` | Zoom toolbar (− / + / 100%, 0.5–2×); SVG arrowheads on edges; column-family band backgrounds + group word in each column hint + group key in the legend. |
| `src/components/shared/evidence-lineage.css` | Node hover state, 0.15s transitions (reduced-motion guard extended), zoom toolbar styles, canvas border. |
| `src/lib/evidence-lineage.test.ts` | New test: column families present and correct. |
| `src/lib/observation-health.ts` | Hakaluki `checksumsPresent` now reads the run's `publication.json` artifact map (81 digests) instead of hardcoded `false`. |
| `src/lib/observation-health.test.ts` | Pins Hakaluki `checksumsPresent === true`. |
| `pipeline/test_agriculture_sme2.py` | Comment only: cites JPL D-107677 Rev C Table 4.2.1 for the surface-flag bits 0–7 definition. No behavior change. |
| `src/components/global/RadarComparison.tsx` | GeoTIFF download links gated to operator mode (`!publicClient`); public-mode note added. |
| `src/components/global/ReferenceEvidence.tsx` | Same gating for the three reference GeoTIFF links; public-mode note added. |
| `src/components/dashboard/*.tsx` (7 files) | **Deleted** (unimported, untested, unused): `CounterfactualLab`, `DateScrubber`, `DemoExperience`, `EvidenceCard`, `MethodGuide`, `PatchTable`, `VegToggle`. `WetlandPulse` is live and kept. Verified by tsc + lint + full node tests. |
| `docs/DATA_AUTHENTICITY_AUDIT.md`, `docs/PHASE2_QA_REPORT.md`, `docs/PHASE2_PRODUCT_AUDIT.md` | Stale "open" items struck through with the Phase 3 resolutions (Hakaluki checksums; SME2 bits 8–9; dashboard-component mention). |
| `docs/PHASE3_ENVIRONMENT_REPAIR.md`, `docs/PHASE3_SCIENTIFIC_VERIFICATION.md`, `docs/PHASE3_VISUAL_ACCEPTANCE.md`, `docs/PHASE3_FINAL_QA.md` (this file) | New. |

**Preserved untouched:** all Phase 1 commits, all Phase 2 implementations
(lineage explorer, observability matrix, homepage strip, Hakaluki wording
fix, SME2 gate), all seven published investigations, SHA-256 integrity
verification, all scientific datasets. `public/showcase/index.json` was
found truncated to 0 bytes three times and restored byte-identical each
time (md5 `e8522112…` = HEAD); see §5.

## 2. Test matrix (measured 2026-11-08, this tree)

| Check | Result |
|---|---|
| Node tests (direct runner: `node --test src/lib/*.test.ts`) | **120/120 pass, 0 fail** (was 119; +1 column-family test) |
| `npm test` (wrapper) | **BLOCKED** — `npm` dies at startup (EPERM writing its log). The suite itself passes when run directly (above). |
| TypeScript (`tsc --noEmit --incremental false`) | **clean, exit 0** |
| ESLint (binary) | **clean, exit 0** |
| `npm run lint` (wrapper) | **BLOCKED** — same npm EPERM; binary run is clean. |
| `npm run build` | **BLOCKED** — npm EPERM + `next build` cannot write `.next/`. |
| Python suite (`unittest discover -s pipeline`) | 124 collected, 111 ran, **77 pass, 0 fail, 34 errors** — all 34 share one environmental root cause (seccomp write block: 29× "No usable temporary directory", 11× EPERM). No tests changed, skipped, or mocked. |
| `pipeline/verify_showcase.py --case-id featured` | **PASS: 68/68 payload files match SHA-256** |
| Hakaluki integrity (audit script, pure reads) | **81/81 digests match** `publication.json`; 0 mismatches, 0 missing; 2 files outside the map. |
| Lineage geometry (all 7 studies, static) | **0 issues** (no overlaps, all edges resolve, Hakaluki 2 references, missing-data nodes intact). |
| Browser E2E suites (5) | **BLOCKED** — Chromium SIGTRAP, no server. Carried Phase 1 numbers (wetland 67/67, explore 23/23 + 24/24 once, agriculture/chokwe/scattering green) are **not** re-verified against this tree. Do not quote them as current. |
| Routes (10/10, 200) | **BLOCKED** — no server. Carried from Phase 1. |
| Desktop / mobile visual inspection | **BLOCKED** — no screenshots exist for Phase 3. |

## 3. Functional acceptance

- **Navigation:** all links verified in code — homepage nav + footer,
  `HazardNavigation` (Wetlands, Volcanoes, Forests, Agriculture,
  Observation health, Evidence lineage), workspace nav, `/lineage` links
  from homepage/observability. No dead nav found.
- **Rate limiting:** **21/21 API routes covered** — 20 via
  `src/lib/rate-limit.ts`, plus `/api/wetland/geocode` via its own 1.1 s
  throttle (429, live-verified in Phase 1). No outstanding rate-limit
  work.
- **Dead components:** 7 unimported dashboard components deleted (§1);
  `WetlandPulse` kept (live). No other unimported components found.
- **Nonfunctional controls:** none found except the GeoTIFF downloads
  (§4, fixed). No empty `onClick` handlers; no TODO/FIXME/coming-soon;
  all `disabled` buttons are legitimately gated on data/form state
  (loading, form validity, study loaded). The ForestDirectory "duplicated"
  form is a single render (drawer shows one of two ReactNodes).
- **Empty/error states:** lineage empty state + unavailable-studies
  section; homepage hydrograph failure state (no invented values);
  observability missing-manifest section; artifact API returns clear
  404/429 JSON. All present in code; browser behavior unverified.

## 4. Defect fixed in Phase 3

**Wetland GeoTIFF download links returned 404.** `ReferenceEvidence`
(3 links) and `RadarComparison` (5 links) offered GeoTIFF downloads for
files that are not in the published web package (0 `.tif` files under
`public/studies/` or `public/showcase/`; the release ships PNG previews +
GeoJSON + JSON by design). The links are now shown only in operator mode
(`!publicClient`); the public viewer shows an honest note instead. The
PNG/GeoJSON/JSON/CSV downloads point at files that exist (verified on
disk). Volcano LOS GeoTIFF links were verified present (Hayli v3 × 5,
Kīlauea v3 × 1) and left alone.

## 5. Incidents

1. **`public/showcase/index.json` truncated to 0 bytes — three times.**
   Restored byte-identical each time (md5 `e8522112…` = HEAD, parses OK).
   In-place truncation on the same inode; no app/test code writes to it.
   Most likely the broken filesystem/policy layer (see
   `docs/PHASE3_ENVIRONMENT_REPAIR.md` §4). **Re-verify (size 453 + md5)
   before any commit or demo.**
2. **Hung dev server** (`next-server` PID 64887, ~52% CPU for 30+ min,
   serving nothing on :3015). SIGTERM failed; SIGKILL removed it. Nothing
   listens on :3015 now.

## 6. Demo readiness by route

| Route | Code | Tests | Browser | Verdict |
|---|---|---|---|---|
| `/`, `/observability`, `/lineage`, `/wetland`, `/wetland/global`, `/forest/*`, `/volcano/*`, `/agriculture` | reviewed / improved where noted | 120/120 node tests pass; Python 77/0 | **not inspected** | **NOT demo-ready yet.** The product is scientifically sound and the code is green where it can run, but no route has been seen rendered with Phase 2/3 code. A recovered environment + screenshots + E2E re-run is the remaining gate. |

## 7. Limitations that must be disclosed to judges

1. **No study is validated.** The maturity ladder's validation column is
   empty for all seven studies. Tanguar/Hakaluki references are
   inconclusive; the rest are exploratory. Say so; do not let the polish
   imply validation.
2. **Hakaluki load-time verification is absent.** The 81/81 digest check
   was audit-time; the app does not re-verify catalog-run artifacts on
   load (Tanguar's showcase loader does).
3. **SME2 surface bits 8–9 are undefined in the spec** (D-107677 Rev C
   defines only bits 0–7) and are excluded by the gate. Correct, but a
   judge may ask — the answer is in
   `docs/PHASE3_SCIENTIFIC_VERIFICATION.md` §2.
4. **No real-user evaluation** exists for the lineage explorer or any
   Phase 2/3 feature. No live-model or usability sessions have been run.
5. **Browser verification is outstanding** for every Phase 2/3 visual
   change (see §2). Nothing in this phase was seen rendered.
6. **Everything is uncommitted and unpushed** (Phase 1 + Phase 2 +
   Phase 3). The remote `Rubai-dev` is still at `4e72a4c`. Nothing here
   is on GitHub, and nothing was merged.

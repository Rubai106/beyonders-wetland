# Beyonders — Phase 2 QA Report

Date: 2026-11-08. Branch: `Rubai-dev`. All counts below are measured in
this pass, except where a value is explicitly marked as carried from
Phase 1 (not re-run because the environment blocks it).

## Environment (limits what could be verified)

- Shell file writes fail with EPERM (`open()` succeeds, `write()` fails);
  `git hash-object -w`, `next build`, and temp-dir creation all fail.
- Chromium (Playwright builds 1179 and 1248) dies with SIGTRAP on any page
  render; no system browser exists.
- What works: `muse.write`/`muse.edit`, `./node_modules/.bin/tsc`,
  eslint binary, `node --test` (strip-loader), Python with
  `PYTHONDONTWRITEBYTECODE=1`, read-only shell ops, `curl` (CMR reachable).
- Consequence: **build, browser E2E, and git commits are BLOCKED, not
  passed.** Nothing in this report claims a browser check that did not run.

## Test matrix

| Check | Command / method | Result |
|---|---|---|
| Node unit tests | `node --experimental-strip-types --loader ./tests/strip-loader.mjs --test src/lib/*.test.ts` | **119/119 PASS** (was 114; +5 lineage: 4 graph + 1 loader) |
| TypeScript | `./node_modules/.bin/tsc --noEmit --incremental false` | **Clean, exit 0** (plain `--noEmit` reports only the environmental `tsconfig.tsbuildinfo` write EPERM) |
| Lint | `./node_modules/.bin/eslint` | **Clean, exit 0** |
| Python unit tests | `python -m unittest discover -s pipeline` | **77 ok, 34 errors, 0 failures** — all 34 errors are environmental (29× no usable temp dir, EPERM file writes, 1× `test_pipeline` setUpClass temp-dir failure blocking its 13 tests; 124 collected, 111 ran) |
| SME2 interpretation tests | new `SME2FlagInterpretationTests` | **3/3 PASS** (zero-clear vs bundle rule; real Naogaon counts; surface high bits fail-closed) |
| Showcase integrity | `pipeline/verify_showcase.py --case-id featured` | Phase 1 value 68/68 — **not re-run in Phase 2** (script needs temp writes); recorded as carried, not verified |
| Production build (29/29 pages) | `npm run build` | **BLOCKED** (EPERM) — Phase 1 value, not re-verified |
| Browser E2E (5 suites) | Playwright/Chromium | **BLOCKED** (SIGTRAP) — Phase 1 values (wetland 67/67, explore 24/24) not re-verified |
| Route checks (10/10 HTTP 200) | live server :3015 | **Not re-run** — the running server is the pre-Phase-2 build; `/lineage` returns 500 there, as expected for a route the old build does not contain |
| CMR live metadata | `curl` to `cmr.earthdata.nasa.gov` (SME2 collection + UMM-Var) | **PASS** — real responses; retrieval flag definition retrieved verbatim |
| D-107677 Rev C PDF | `curl` to `nisar.asf.earthdatacloud.nasa.gov` | **BLOCKED** — HTTP 200 with 0 bytes through the egress proxy; ASF docs page serves an empty JS shell here |

## Defects found and fixed in Phase 2

1. **Hakaluki metrics misattribution** (critical presentation defect):
   12.9/5.2/7.4 shown as the headline pair's result; they are the 27 Sep
   2026 date check's. Fixed in `src/lib/observation-health.ts:136`,
   `docs/MASTER_PLATFORM_AUDIT.md:91`,
   `docs/SCIENTIFIC_VALIDATION_MATRIX.md:17`,
   `docs/COMPETITION_READINESS.md:15`. Verified by grep (all occurrences
   now pair-specific) + tsc clean.
2. **SME2 flag discrepancy** (blocking scientific issue): resolved in
   favour of zero-clear with official CMR evidence + real-data
   falsification of the bundle rule + 3 regression tests. No gate changed.
3. **Hayli Gubbi version staleness in docs** (v2 → v3): corrected in the
   authenticity audit; loader resolves via index.json.
4. **Unused helper** (`detail` in `evidence-lineage.ts`): removed;
   eslint warning cleared.

## New capabilities and their verification

| Capability | Verification |
|---|---|
| Evidence Lineage Explorer (`/lineage`) | 5 node tests (graph invariants, layout geometry, all 7 real chains load with expected counts/granule IDs/Hakaluki double reference); tsc + lint clean. Browser rendering **not verified**. |
| Observability maturity matrix | tsc clean; renders from the same `buildPlatformHealth()` data as the cards. Browser rendering **not verified**. |
| Homepage investigations strip | tsc clean; data from `listGlobeStudies()` + the Naogaon manifest fetch, both already-used loaders. Browser rendering **not verified**. |
| Hakaluki date-check second reference | Asserted in `lineage-studies.test.ts` (P 0.1288 / R 0.0522 / F1 0.0743, coverage 0.5072). |

## Remaining blockers

1. Environment: shell writes, build, Chromium, git writes (see top).
2. ~~Hakaluki release has no checksums file; catalog entry is thin.~~
   RESOLVED Phase 3: `publication.json` holds 81 SHA-256 digests, all
   verified matching; catalog entry still thin.
3. ~~Surface flag bits 8–9 meanings unverified (needs direct D-107677
   access).~~ RESOLVED Phase 3: Rev C Table 4.2.1 defines only bits 0–7;
   bits 8–9 are undefined in the spec; gate unchanged.
4. Everything in Phase 2 is uncommitted; pushing is forbidden by the
   directive in any case.

## Verdict

**Judge-demo ready with the same precautions as Phase 1, plus one new
caveat:** the Phase 2 visual work (lineage explorer, maturity matrix,
homepage strip) is type-, lint-, and unit-test-verified but has not been
seen in a browser. Do not demo `/lineage` from this environment until the
build/browser path recovers and the page is visually inspected. The
scientific corrections in this pass (Hakaluki attribution, SME2
resolution) make the product *more* honest than Phase 1, and no new
claim in the product is unverified by at least one runnable check.

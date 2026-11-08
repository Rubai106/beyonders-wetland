# PHASE 4 FUNCTIONAL QA

Date: 2026-11-08. Method: code inspection + direct test runs. Browser E2E and
rendered-route checks remain BLOCKED by the environment (see Visual Acceptance).

## 1. API and rate limiting — verified by grep + tests

- API routes: 22 (21 existing + new `/api/capsule/[study]`).
- Rate limiting: **22/22 covered** — 21 via `src/lib/rate-limit.ts`
  (`checkRateLimit`, "general"/"external"/"job" buckets) plus
  `/api/wetland/geocode`'s own 1.1 s in-process throttle returning 429 with
  `Retry-After: 1`. The new capsule route uses the "general" bucket and was
  verified by grep this session.
- Capsule route: unknown study → 404 with the available id list; known study →
  200 JSON download with `Content-Disposition: attachment` and `no-store`.
  Its builder is unit-tested (6 tests); the HTTP layer itself could not be
  exercised without a running server (build blocked).

## 2. Navigation

- All 15 pages exist as `page.tsx`; `/observability` now lists 7 studies and
  links each study card to its workspace; every card links to
  `/api/capsule/<id>`; `/lineage` is linked from observability, homepage nav,
  footer, and HazardNavigation (Phase 2/3, unchanged).
- No dead navigation found in code review. Responsive nav was not
  browser-verified (blocked).

## 3. Interactions — static audit

- Empty/no-op `onClick` handlers: none found (`grep onClick={() => {}}` clean).
- `TODO` / `FIXME` / "coming soon" in `src/components` and `src/app`: none found.
- `disabled` buttons: all gated on data/form state (Phase 3 finding, unchanged).

## 4. Downloads and exports — verified in code

- GeoTIFF links in `ReferenceEvidence.tsx` and `RadarComparison.tsx` remain
  gated to operator mode (`!publicClient`); public view shows the honest note
  that rasters live in the local study package and PNG/GeoJSON are the
  published versions. Volcano LOS GeoTIFFs (Hayli 5, Kīlauea 1) exist on disk
  and stay linked.
- Capsule download is real: JSON generated from the live manifests at request
  time, not a static file.
- PNG/GeoJSON/JSON/CSV downloads point at existing files (Phase 3 check).

## 5. Tests actually run

- Node (direct runner): **135/135 pass, 0 fail** (120 carried + 15 Phase 4).
- `tsc --noEmit --incremental false`: clean, exit 0.
- `eslint` on all Phase 4 files: clean, exit 0.
- `pipeline/verify_showcase.py --case-id featured`: PASS 68/68.
- Hakaluki fingerprints: 81/81 re-verified by hand this session.
- Chókwè fingerprints: 24/24 re-verified by hand this session.
- Python suite: NOT re-run in Phase 4 (Phase 3: 77 pass / 0 fail / 34 env
  errors; the 34 are tempfile EPERM, not code). Re-run on a healthy machine.

## 6. Defects fixed in Phase 4

1. Chókwè missing from `/observability` despite completed processing — fixed
   (health loader + tests; see Platform Improvements §2).
2. No portable evidence package existed — fixed (Capsule + API route).
3. No visual quality/coverage inspection existed — fixed (Quality Explorer).

## 7. Known open items (unchanged)

- `web_job.py` mode argument untraced; `pipeline/main.py` defaults to demo.
- Missing E2E files: `agriculture_smoke.py`, `forest_smoke.py`.
- `/wetland/global` has no saved runs here.
- Live-network tile check under CSP not done.

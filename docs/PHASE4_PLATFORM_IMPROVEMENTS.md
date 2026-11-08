# PHASE 4 PLATFORM IMPROVEMENTS

Date: 2026-11-08. Target branch: `master` (port package in
`~/workspace/beyonders-master-port/PORT_MANIFEST.md`). Work below was built and
tested in the Rubai-dev worktree that already contains Phases 1–3; every file
is listed with its master-port status so it applies cleanly to master.

## 1. Branch correction (the Phase 4 starting point)

- Problem: Phases 1–3 were built on `Rubai-dev` under briefs that named it;
  Rubai clarified the delivery branch is `master` in
  `Rubai106/beyonders-wetland`, and `Rubai-dev` is a separate dev branch.
- Measured: merge-base `8823b95`; `master..Rubai-dev` 377 commits,
  `Rubai-dev..master` 232 commits; 143 files differ. A blind merge or blind
  overwrite in either direction loses real work.
- Done: `docs/PHASE4_BASELINE.md` (branch/HEAD/divergence, environment health,
  143-file reconciliation) + the port manifest. No push, no merge, no
  force-push, no shell git checkout (unsafe on this machine — EPERM truncation
  hazard). A subagent probe confirmed no healthy shell-write environment is
  available here, so the transfer is a prepared, reviewable port for a healthy
  machine — not an executed switch.
- Key catch: master's `public/showcase/index.json` (847 bytes, Tanguar +
  Hakaluki) is newer than Rubai-dev's (453 bytes, Tanguar only). The port keeps
  master's version; overwriting it would delete the Hakaluki showcase case.

## 2. Chókwè added to `/observability` (defect fix)

- Problem: a published investigation with completed real processing did not
  appear on `/observability` at all.
- Files: `src/lib/observation-health.ts`, `src/lib/observation-health.test.ts`.
- Change: Chókwè loads from `public/studies/catalog.json` (run
  `ec8fa5ee15ae41d1aa89f930f2b47e36`, product NISAR_L2_GCOV_BETA_V1, BETA),
  checksums from its `publication.json` artifact map (24/24 verified this
  session), state INCONCLUSIVE_VALIDATION, 7/8 maturity stages (no validation).
- Result: `/observability` now lists all 7 published investigations.
- Tests: health suite now asserts 3 wetland studies and 7 total.

## 3. Evidence Quality Explorer (new, §6.5)

- Files: `src/lib/evidence-quality.ts`, `src/lib/evidence-quality.test.ts`,
  `src/app/observability/page.tsx`, `src/app/observability/observability.css`.
- What it is: per-study coverage/screening/agreement figures with denominators
  and source files, rendered as bars + words on `/observability` (new "How much
  was actually covered?" section). Status is always a word (Recorded /
  Inconclusive / Not recorded), never colour alone. A computed zero keeps a
  visible bar (min 4%) so it reads as a measured zero, not an empty gap.
- Data: all figures re-read from the published files this session (see
  `docs/PHASE4_SCIENCE_AUDIT.md` §1). Tanguar 3,880/1,166,097; Hakaluki 9/1,729,130
  headline vs 50.7% date-check; Naogaon 1,338/6,278; Rondônia 0.0128 km² + 71.1%
  overlap; volcano LOS limits stated as not-recorded, not zero.
- Tests: 9 new tests pin every headline number and the Hakaluki attribution.

## 4. Reproducible Investigation Capsule (new, §6.3)

- Files: `src/lib/investigation-capsule.ts`,
  `src/lib/investigation-capsule.test.ts`,
  `src/app/api/capsule/[study]/route.ts` (dynamic route per Next.js docs:
  `{ params }: { params: Promise<{ study: string }> }`, awaited).
- What it is: `GET /api/capsule/<study-id>` returns a downloadable JSON
  evidence package — study geometry/IDs, product, run ID, method, observation
  dates, maturity, quality figures, references (from the lineage chain),
  limitations, integrity statement, and a reproducibility statement.
- Honesty: the capsule never promises one-click reproduction. Status is
  `verifiable` / `partial` / `not-verifiable` from checksums + run ID + dates,
  and the note always states re-derivation needs Earthdata access to the source
  granules and the named method version. Unknown study → 404 with the available
  ids. Rate-limited like the other API routes ("general").
- Wiring: every `/observability` study card now has a "Download investigation
  capsule (JSON)" link.
- Tests: 6 new tests (sections, verifiable/partial/not-verifiable ladder,
  validation note copied not upgraded, safe filenames).

## 5. What was deliberately NOT built

- Temporal Investigation Studio (§6.1), Hypothesis Workspace (§6.2), and study
  comparison (§6.4) as new pages: not started. The lineage explorer already
  covers traceability and the Quality Explorer + Capsule cover the highest-value
  gaps; adding three more surfaces without browser verification would be
  decoration, not product. They remain the next build once the master port is
  applied and the browser works.
- `/agri` consolidation (§7.4): there is no `/agri` route on either branch —
  nothing to consolidate. Recorded in the baseline, not invented.
- No new visual redesign: without a working browser, CSS changes cannot be
  verified. The Quality Explorer reuses the existing paper/ink/ochre system.

## 6. Routes

- New API route: `/api/capsule/[study]` (GET, rate-limited, 404 for unknown ids).
- Changed page: `/observability` (Quality Explorer section, Chókwè card,
  capsule links). No other route changed in Phase 4.

## 7. Tests performed

- Node (direct runner): **135/135 pass** (was 120; +9 quality, +6 capsule).
- `tsc --noEmit --incremental false`: clean.
- `eslint` on all Phase 4 files: clean.
- Showcase verify: 68/68 PASS. Hakaluki 81/81, Chókwè 24/24 digests re-verified.
- Not run (blocked, see visual acceptance doc): `npm run build`, browser E2E,
  route rendering checks, visual inspection.

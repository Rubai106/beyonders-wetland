# PHASE 4 BASELINE — Beyonders, master-branch correction

Date: 2026-11-08 (Dhaka). Author: Muse (rubai jr).
Status: baseline inspection complete. No push, no merge, no force-push, no history rewrite, no shell git checkout performed.

## 1. Repository and branches (verified by read-only git)

- Authoritative repository: `https://github.com/Rubai106/beyonders-wetland.git`
  - Owner `Rubai106`, repo `beyonders-wetland`. This is NOT `tahsinlabib23/beyonders-wetland`
    (Forest Time Machine patch-only repo — separate lineage, separate rules).
  - Local remote `origin` verified: fetch/push both point at the URL above.
- Target / delivery branch: **`master`** (per Rubai correction 2026-11-08 ~02:03–02:05 Dhaka).
  `Rubai-dev` is a separate development branch, not the primary delivery branch.
- Remote HEADs (via `git ls-remote`, 2026-11-08):
  - `origin/master` = `f2dbdd2869bbb2ff84dd1f6e799fc70aa68158d6`
  - `origin/Rubai-dev` = `4e72a4c8c81ebe1527d5bbc84b879f89d7f1475f`
- Local HEADs:
  - `master` = `f2dbdd2` (matches remote master)
  - `Rubai-dev` = `fb3d445185e16259678c519d6d59919a18ebcde4` (current working branch at inspection)
  - Current HEAD before any transfer: `Rubai-dev` / `fb3d445`
- Divergence: merge-base `8823b95c6827e9cc88c558e709526929767da3d1`
  (`8823b95` "Additions and bug fixes").
  - `master..Rubai-dev`: 377 commits
  - `Rubai-dev..master`: 232 commits
  - Files differing between `master` and `Rubai-dev` HEAD: **143**
- This is a deep, old divergence (branches split well before 2026-10-31), NOT a small
  feature-branch delta. A blind merge or a blind overwrite in either direction would
  lose real work. See §6 for the file-level reconciliation.

## 2. Working-tree status (Rubai-dev worktree, `GIT_OPTIONAL_LOCKS=0`)

42 entries — the Phase 2 + Phase 3 change set, all uncommitted, none pushed:

- Modified (24): `PROGRESS.md`, `docs/COMPETITION_READINESS.md`,
  `docs/MASTER_PLATFORM_AUDIT.md`, `docs/PLATFORM_QA_REPORT.md`,
  `docs/SCIENTIFIC_VALIDATION_MATRIX.md`, `pipeline/test_agriculture_sme2.py`,
  `src/app/landing.css`, `src/app/observability/observability.css`,
  `src/app/observability/page.tsx`, `src/app/page.tsx`,
  `src/components/global/GlobalDetectionsExplorer.tsx`,
  `src/components/global/RadarComparison.tsx`,
  `src/components/global/ReferenceEvidence.tsx`,
  `src/components/layout/HazardNavigation.tsx`,
  `src/lib/observation-health.test.ts`, `src/lib/observation-health.ts`,
  `tests/e2e/explore_smoke.py`, plus 7 deletions below.
- Deleted (7, verified unimported in Phase 3): `src/components/dashboard/`
  `CounterfactualLab.tsx`, `DateScrubber.tsx`, `DemoExperience.tsx`,
  `EvidenceCard.tsx`, `MethodGuide.tsx`, `PatchTable.tsx`, `VegToggle.tsx`.
- Untracked (18): Phase 2/3 docs (`docs/PHASE2_*.md`, `docs/PHASE3_*.md`,
  `docs/DATA_AUTHENTICITY_AUDIT.md`, `docs/FEATURE_DIFFERENTIATION.md`,
  `docs/PREMIUM_DESIGN_SYSTEM.md`, `docs/SCIENTIFIC_EVIDENCE_LINEAGE.md`),
  lineage feature (`src/app/lineage/`, `src/components/shared/EvidenceLineageExplorer.tsx`,
  `src/components/shared/evidence-lineage.css`, `src/lib/evidence-lineage.ts`,
  `src/lib/evidence-lineage.test.ts`, `src/lib/lineage-studies.ts`,
  `src/lib/lineage-studies.test.ts`).
- Local commits on `Rubai-dev` not on remote (6 above `4e72a4c`):
  `e6abdee` (SHA-256 showcase integrity), `e31d805` (E2E smoke repairs),
  `4803b33` (`/observability`), `a5d72dc` (security headers + CSP),
  `dd55a89` (API rate limiting), `fb3d445` (dead layout components removal).

## 3. Critical showcase file — `public/showcase/index.json`

- Worktree / `Rubai-dev` HEAD: **453 bytes, SHA-256
  `2b929ad31c456a75e2efabf757f14a353154ccb856f5ca316f557e89e1c5fd4c`** — intact,
  matches HEAD, parses, 1 case (`featured`, Tanguar Haor).
- `master` version: **847 bytes, SHA-256
  `eb60a50dde632da1de2e8bdbee3a0b879884578c02f2ccff63679017e424b2cf`** — 2 cases
  (`featured` Tanguar + `hakaluki` Hakaluki Haor, 7 observations each).
- **Master's version is newer/more complete. Do NOT overwrite master with the
  Rubai-dev 453-byte version — that would delete the Hakaluki showcase case.**
  The port must keep master's 2-case index and add integrity verification on top.
- Truncation hazard (recurring): the file was found at 0 bytes three times on
  2026-11-08 and restored byte-identical each time. Root cause is the broken
  filesystem/policy layer (see §4), not application code. Re-verify size + SHA-256
  before any commit or demo.

## 4. Environment health (measured 2026-11-08, re-confirmed this session)

Root cause (unchanged): a seccomp filter blocks file-content writes for
shell-spawned processes (`Seccomp: 2`, `Seccomp_filters: 4`, `NoNewPrivs: 1`).
`open(O_CREAT)` succeeds but `write()` to a regular file returns `EPERM` on
overlay, `/home`, tmpfs `/tmp` and `/dev/shm`, for root and `nobody`.
`mkdir`/`symlink`/`unlink`/`rename` and pipe/socket writes work. No AppArmor/SELinux.
`dmesg` blocked.

| Check | Result |
|---|---|
| Disk (overlay) | Working — 7.5G, 7% used, 6.8G free |
| `/tmp` tmpfs | Working — 512M, 9% used |
| Node / npm / Python | Working (read/exec) — Node v24.22.1, npm 10.9.4, Python 3.12.3 |
| `node_modules` | Present (316 entries; `next`/`tsc`/`eslint` binaries exist) |
| `.next/` | Partial — 267M but **no `BUILD_ID`**, not a usable production build |
| Git read (`log`, `diff`, `show`, `ls-remote`, `status --porcelain` with `GIT_OPTIONAL_LOCKS=0`) | Working |
| Git write / shell file writes (`checkout`, `commit`, `stash`, `npm` log writes, Python `tempfile`) | **BLOCKED — EPERM; `git status` without the env flag errors on `index.lock`** |
| `npm test` / `npm run lint` / `npm run build` wrappers | Blocked (npm dies writing its log at startup) |
| Direct binaries (`node --test` runner, `tsc`, `eslint` binary) | Working |
| Playwright Chromium | Blocked — binaries exist but browser dies SIGTRAP on render |
| Python suite | Partial — 77 pass / 0 fail / 34 env errors in Phase 3 (tempfile EPERM) |
| Network (git ls-remote to GitHub) | Working |
| File-editing tools (`muse.write` / `muse.edit`) | Working — run outside the filter; all Phase 2/3 edits used them |

**Safety rule for this machine: never run a shell git checkout / reset / stash /
clean, and never retry shell writes to see if they "might work" — a failed git
write can truncate a worktree file to 0 bytes (the showcase-index mechanism).
Branch transfer must be done as a reviewable file-level port, applied on a
healthy machine (see §7). A subagent probe of a possibly-healthy execution
environment was dispatched 2026-11-08 ~02:05 Dhaka; result pending at baseline time.**

## 5. Current routes and studies (worktree, Rubai-dev)

- Pages (15 `page.tsx`): `/`, `/agriculture`, `/forest`, `/forest/global`,
  `/forest/rondonia`, `/lineage`, `/observability`, `/operator-guide`, `/volcano`,
  `/volcano/global`, `/volcano/hayli-gubbi`, `/volcano/kilauea`, `/wetland`,
  `/wetland/global`, `/wetland/global/scenes`.
- API routes (21 `route.ts`): agriculture catalogue; forests coverage/places/processing;
  volcanoes catalog/coverage; wetland artifact/boundary/date-check/geocode/
  global-coverage/nisar-detections/patches/probe/processing/pulse/radar/
  reference-evidence/runs/sensitivity/site-name.
- **There is no `/agri` route on either branch** (only `/agriculture`). Phase 4 §7.4's
  "consolidate Field Pulse and SME2" has nothing to consolidate — `/agri` Field Pulse
  does not exist. Recorded here so the work is not invented.
- Published investigations (7): Tanguar Haor, Hakaluki Haor, Chókwè (wetlands);
  Rondônia (forest); Hayli Gubbi / Erta Ale, Kīlauea (volcanoes); Naogaon (agriculture).
  No study reaches validation (maturity ladder validation column empty for all 7).

## 6. Reconciliation: Phase 1–3 work vs `master` (file-level, read-only diffs)

"Today's work" = commits `4e72a4c..fb3d445` (51 files) + 42 uncommitted entries.
Port decisions below are per-file, from `git diff 4e72a4c fb3d445`,
`git diff master Rubai-dev`, and `git cat-file -e master:<path>` checks.

### 6.1 Port as new files on master (absent on master, no equivalent found)
- `src/lib/rate-limit.ts` + `src/lib/rate-limit.test.ts` — API rate limiting
  (external 30/min, job 5/min, general 120/min). 20 API routes use it on Rubai-dev;
  `/api/wetland/geocode` has its own 1.1 s throttle (429). Master's only
  "rate-limit" hit is a mention in `dynamic-world-artifacts/route.ts` — verify
  before assuming equivalence.
- `src/lib/observation-health.ts` + `src/lib/observation-health.test.ts`,
  `src/app/observability/page.tsx` + `src/app/observability/observability.css` —
  `/observability` page, 6 studies, 8-stage maturity ladder. New on master.
- `pipeline/verify_showcase.py`, `pipeline/test_showcase_integrity.py` — SHA-256
  showcase verification (68/68 PASS on Rubai-dev). New on master.
- Lineage (uncommitted, new on both branches): `src/lib/evidence-lineage.ts`,
  `src/lib/evidence-lineage.test.ts`, `src/lib/lineage-studies.ts`,
  `src/lib/lineage-studies.test.ts`, `src/components/shared/EvidenceLineageExplorer.tsx`,
  `src/components/shared/evidence-lineage.css`, `src/app/lineage/page.tsx`.
- Phase 2/3 docs: `docs/PHASE2_*.md`, `docs/PHASE3_*.md`,
  `docs/DATA_AUTHENTICITY_AUDIT.md`, `docs/FEATURE_DIFFERENTIATION.md`,
  `docs/PREMIUM_DESIGN_SYSTEM.md`, `docs/SCIENTIFIC_EVIDENCE_LINEAGE.md`.

### 6.2 Surgical port (keep master's file, apply only the Phase hunk)
- `next.config.ts` — Rubai-dev adds `poweredByHeader: false` + `headers()` with
  HSTS / nosniff / SAMEORIGIN / Referrer-Policy / Permissions-Policy / enforcing CSP
  (allowlist: ArcGIS, GIBS, GLAD, Carto, Terrascope, NASA assets, Google Fonts, CMR,
  Nominatim). Master's base config (distDir, images, env, tracing) must be kept.
  CSP was browser-verified with zero violations on Rubai-dev.
- `src/lib/showcase.ts` + `src/lib/showcase-cases.test.ts` — Rubai-dev adds fail-closed
  SHA-256 verification (172 lines changed). Master's loader already supports the
  2-case index; port the verification, keep master's 2-case listing.
- `src/app/page.tsx` — Phase 1–3 hunk is tiny: +`/agriculture` nav link,
  +`/observability` nav link, +`/agriculture` footer link. Master's page is NEWER
  in other respects (reduced-motion guards, pin-coordinate form, mobile nav,
  `/forest/rondonia` + `/volcano/hayli-gubbi` direct links). Port only the
  observability link; do NOT port Rubai-dev's page wholesale (it would regress master).
- `src/app/layout.tsx` — **KEEP MASTER.** Rubai-dev's version only removes
  `field-volume-scene.css` / `platform-visual-refresh.css` imports and the
  "agriculture"/"soil moisture" keywords — those are master features Rubai-dev
  predates. No Phase improvement in this file.
- `src/components/global/ReferenceEvidence.tsx`, `src/components/global/RadarComparison.tsx`,
  `src/components/global/GlobalDetectionsExplorer.tsx`,
  `src/components/layout/HazardNavigation.tsx`, `src/lib/observation-health.ts`
  (Hakaluki checksum fix, uncommitted), `src/app/landing.css`,
  `src/app/observability/*` (uncommitted lineage/zoom tweaks) — port the specific
  hunks after per-hunk review; do not wholesale-copy (master versions differ).
- `src/app/api/*/route.ts` (20 files) — rate-limit wiring from `dd55a89`. Port by
  adding the same `rate-limit.ts` import + guard call to master's route files,
  which have diverged (master has `dynamic-world-artifacts`, Rubai-dev has SME2
  catalogue changes). Per-route check required.
- `pipeline/export_showcase.py`, `public/showcase/featured/manifest.json`,
  `package.json` (`npm test` script), `tests/e2e/explore_smoke.py`,
  `tests/e2e/wetland_smoke.py` — port the Phase hunks only.
- Docs updates (`PROGRESS.md`, `docs/COMPETITION_READINESS.md`,
  `docs/MASTER_PLATFORM_AUDIT.md`, `docs/PLATFORM_QA_REPORT.md`,
  `docs/SCIENTIFIC_VALIDATION_MATRIX.md`) — port the Phase 2/3 factual corrections,
  not the whole files (master's copies have their own newer content).

### 6.3 Safe deletions (verified unimported on BOTH branches)
- `src/components/layout/Header.tsx`, `Footer.tsx`, `Sidebar.tsx` (committed in
  `fb3d445`): no imports on either branch — only `HazardNavigation` is imported
  by `layout.tsx`. Safe to delete on master.
- 7 dashboard components (uncommitted deletions): `CounterfactualLab`,
  `DateScrubber`, `DemoExperience`, `EvidenceCard`, `MethodGuide`, `PatchTable`,
  `VegToggle` — no static/dynamic imports and no test references on master either
  (`EvidenceCardData` type in `src/lib/types.ts`/`mock-data.ts` is separate and
  untouched). Safe to delete on master after the same grep on the master tree.

### 6.4 Keep master — do NOT port Rubai-dev's version
- `public/showcase/index.json` — keep master's 847-byte 2-case version (§3).
- `src/app/layout.tsx`, `src/app/page.tsx` (wholesale), `src/components/shared/FieldVolumeScene.tsx`,
  `src/components/shared/field-volume-scene.css`, `src/styles/platform-visual-refresh.css`,
  master's 3D Field Volume work and Agriculture 3D selection work — Rubai-dev
  predates these; its versions are older.
- The other ~90 of the 143 differing files are pre-existing divergence
  (Agriculture SME2 pipeline + cloud workflows on Rubai-dev vs 3D / visual-refresh /
  dynamic-world work on master), NOT Phase 1–3 work. They are out of scope for this
  port; merging them is a separate decision for Rubai.

## 7. Branch-transfer plan (safe, reviewable, no push/merge without authorisation)

1. This baseline + reconciliation (§6) is the review record.
2. Port package (to be assembled in `~/workspace/beyonders-master-port/`):
   new files in full + surgical hunks with exact master context, per §6.
3. On a healthy machine: `git checkout master` (clean tree), verify
   `public/showcase/index.json` is the 847-byte 2-case version, apply the port
   package, run `npm ci`, `npm test`, lint, `tsc --noEmit`, `npm run build`,
   Python suite, 5 E2E suites, `pipeline/verify_showcase.py --case-id featured`
   (and Hakaluki), then commit locally on `master`. **No push without Rubai's tap.**
4. `Rubai-dev` (local commits + 42 uncommitted entries) is preserved untouched
   until the port is verified on master; nothing on it is discarded.
5. Phase 4 development continues against the ported master baseline: every Phase 4
   change is recorded per-file with its master context so it applies cleanly.

## 8. Reported test status (historical, Phase 3 — to be re-run)

- Node (direct runner): 120/120 pass. `tsc --noEmit`: clean. `eslint` binary: clean.
  (`npm test` / `npm run lint` wrappers blocked by the environment, §4.)
- Python: 124 collected, 111 ran, 77 pass, 0 fail, 34 env errors (tempfile EPERM).
  Not a code regression; Phase 1 healthy baseline was 121 OK.
- `pipeline/verify_showcase.py --case-id featured`: PASS, 68/68.
- Blocked in Phase 3 (unchanged): `npm run build`, browser E2E suites, route checks,
  desktop/mobile visual inspection. **No Phase 3 screenshots exist. Not demo-ready.**

## 9. Existing defects and limitations (carried into Phase 4)

- `web_job.py` → `run_pipeline` mode argument (demo vs real) never traced; live
  `pipeline/main.py` defaults to `mode="demo"`.
- Hakaluki catalog entry thin (most provenance fields null); app does not re-verify
  catalog-run artifacts at load time the way the showcase loader verifies Tanguar.
- SME2 bits 8–9 undefined in JPL D-107677 Rev C; code fail-closes them (see
  `docs/PHASE3_SCIENTIFIC_VERIFICATION.md`). Revisit if a later spec defines them.
- Missing E2E files: `agriculture_smoke.py` / `forest_smoke.py` do not exist.
- Live-network tile check under CSP not done; `/wetland/global` has no saved runs.
- No study validated; validation column empty for all 7 studies (disclosure, by design).

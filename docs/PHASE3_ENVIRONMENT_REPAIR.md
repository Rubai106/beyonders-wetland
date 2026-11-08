# Phase 3 — Environment Repair

**Date:** 2026-11-08
**Branch:** `Rubai-dev` (HEAD `fb3d445`; all work local, no push, no merge)
**Verdict: NOT REPAIRED.** The root cause is identified precisely and is not
fixable from inside this container. The environment is usable for read-only
verification and for file edits through the agent's file tools, but not for
production builds, browser tests, git writes, or any Python test that needs a
temporary file. Every blocked check is listed in §6 with its evidence.

## 1. Root cause

**A seccomp filter on this container blocks file-content writes for
shell-spawned processes.**

Evidence, all measured 2026-11-08:

| Check | Result |
|---|---|
| `/proc/self/status` | `Seccomp: 2` (filter mode), `Seccomp_filters: 4`, `NoNewPrivs: 1` |
| Disk space | overlay 7.5 GB, 7% used, 6.8 GB free — **not full** |
| Inodes | overlay reports 0/0; `/tmp` tmpfs 1% used — **not exhausted** |
| `/tmp` | tmpfs 512 MB, 9% used, `drwxrwxrwt` — **writes still fail** |
| `/dev/shm` | tmpfs — **writes still fail** |
| `/home` (btrfs `/dev/mapper/rv`, rw) | **writes still fail** |
| Permissions | running as root (uid 0); dirs `drwxrws--- root:nogroup` — **not a permission problem** |
| `open(O_CREAT)` | **succeeds** — empty files appear |
| `write()` to any regular file, any path, any filesystem, any uid (root and `nobody`) | **`EPERM: Operation not permitted`** |
| `mkdir`, `symlink`, `unlink` (rm), `rename` | **work** — metadata operations are unaffected |
| `write()` to pipes/sockets (stdout, network) | **works** — only regular-file content writes fail |
| AppArmor / SELinux | absent (`/sys/kernel/security/apparmor` missing, no `getenforce`) |
| `dmesg` | blocked (`read kernel buffer failed: Operation not permitted`) |

The pattern — writes fail identically on overlay, btrfs, and two tmpfs
mounts, for root and for `nobody`, while metadata operations and pipe writes
succeed — cannot be a disk, permissions, or single-filesystem fault. It is a
syscall-level policy (the seccomp filter). The filter cannot be removed from
inside: seccomp is one-way, inherited by children, and `NoNewPrivs: 1` is
set. No in-container repair exists.

The agent's file tools (`muse.write` / `muse.edit`) run outside this
filter and work normally; that is how all Phase 2/3 code and doc edits were
made. Background execution containers are inconsistent: one healthy
container holds a fresh remote clone (Phase 1 state, 109 tests) and runs
`npm ci` / builds / Playwright; another holds a snapshot of this workspace
(with the Phase 2 files) and has the same EPERM fault. Routing between them
is not controllable from here.

## 2. What the fault breaks (measured)

- `npm test` / `npm run lint` / `npm run build` — `npm` dies at startup
  writing its log file (`npm error code EPERM, syscall write`). The
  underlying commands run fine when invoked directly (see §3).
- `next build` — cannot write `.next/` (and the existing `.next/` has no
  `BUILD_ID`: it is not a usable production build).
- Chromium / Playwright — the browser process dies with SIGTRAP on render
  (consistent with the same filter trapping a syscall the sandbox needs).
  `--version` works; any page render does not.
- `git` writes — `git hash-object -w`, `git commit`, index refresh all
  fail (`index.lock` write error: EPERM). Read-only git works
  (`status`, `diff`, `log`, `show`, `ls-remote`).
- Python `tempfile` — `mkstemp`/`mkdtemp` fail everywhere
  (`No usable temporary directory found in ['/tmp', '/var/tmp',
  '/usr/tmp', '<repo>']`). See `docs/PHASE3_FINAL_QA.md` §4: 34 errors,
  one root cause.
- `verify_showcase.py` — works (pure reads + hashing): 68/68 PASS.

## 3. What still works in this environment

- Node tests run directly: `node --experimental-strip-types
  --loader ./tests/strip-loader.mjs --test src/lib/*.test.ts` → **120/120**.
- `tsc --noEmit --incremental false` → clean. `eslint` (binary) → clean.
- Python tests that need no temp files: 77 pass, 0 fail.
- Read-only git, `curl` (CMR, ASF docs reachable), `md5sum`/`sha256sum`,
  file reads, `rm`/`mkdir`.
- File edits through the agent's file tools (verified by md5 against HEAD).

## 4. The `public/showcase/index.json` recurrence (critical)

The showcase manifest (`public/showcase/index.json`, 453 bytes, md5
`e85221126f37977f291f8e70d4fd956c`, identical to HEAD) has been found
**truncated to 0 bytes three times** in this session (first seen
2026-11-08 ~01:04, again ~01:43, and a third time before the Phase 3
final verification). Each time it was restored byte-identical via the
file tools and re-verified by md5 + JSON parse. The truncations happen
**in place on the same inode (1358072)** — not a file replacement — and no
code in the app or test suite writes to this file at runtime (the only
writers are pipeline export scripts, none of which run here). The most
likely cause is the same broken filesystem/policy layer, possibly a
stale snapshot sync from the background container (which holds the file
at 0 bytes). The content is safe in git and can always be restored from
HEAD, but **the working tree must be re-verified (size + md5) before any
commit or demo** — a truncated manifest would break the showcase loader.

## 5. Hung dev server (removed)

A `next-server` (PID 64887, started 00:30) was found spinning at ~52% CPU
for 30+ minutes while accepting no connections on :3015 (`curl` 000 on
every route). SIGTERM did not stop it; SIGKILL did. It served the old
pre-Phase-2 build and could not have verified Phase 2 or 3 work. Nothing
listens on :3015 now. The stale `.next/` (267 MB, no `BUILD_ID`) was left
untouched — it is not a usable build and rebuilding is blocked (§2).

## 6. Blocked checks (exact)

| Check | Status | Evidence |
|---|---|---|
| `npm run build` | BLOCKED | npm EPERM at startup; `next build` cannot write `.next/` |
| Browser visual inspection (all routes) | BLOCKED | Chromium SIGTRAP; no Phase 2/3 server can run (`:3015` dead) |
| Browser E2E smoke suites (5) | BLOCKED | same; last green run was the Phase 1-state remote clone, not this tree |
| `git commit` / `git push` | BLOCKED (and forbidden by directive) | index.lock EPERM; push forbidden in any case |
| Python tempfile tests (34) | BLOCKED | single root cause (§2); 77 pass / 0 fail otherwise |
| `verify_showcase.py` | PASS | 68/68 (pure reads) |
| Node tests / tsc / eslint (direct binaries) | PASS | 120/120, clean, clean |

## 7. Recovery path

Recovery needs a fresh runtime/VM without the faulty seccomp profile —
that is a platform action, not something this container can do to itself.
Until then:

1. Do not demo from this tree without first re-verifying
   `public/showcase/index.json` (size 453, md5 `e8522112…`) and rebuilding
   in a healthy environment.
2. Do not treat the Phase 1-state background container's green results as
   verification of this tree — it holds the remote code (109 tests), not
   the Phase 2/3 working tree (120 tests).
3. Keep edits flowing through the file tools; keep `npm`/`next`/`git`
   writes out of shell commands.
4. After a VM replacement, re-run in order: `npm ci`, `npm test`,
   `npm run lint`, `npx tsc --noEmit`, `npm run build`, the Python suite,
   the 5 E2E suites, and the browser visual checks in
   `docs/PHASE3_VISUAL_ACCEPTANCE.md`.

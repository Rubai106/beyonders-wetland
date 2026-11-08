# PHASE 4 VISUAL ACCEPTANCE

Date: 2026-11-08.

## Status: BLOCKED — no browser verification was possible

The environment still cannot render the site: Playwright Chromium dies
SIGTRAP on render, `npm run build` cannot write `.next/`, and no dev server
can start. **No Phase 4 screenshots exist. Nothing in Phase 4 is visually
verified, and no route may be called demo-ready on visual grounds.**

This document records what was done instead, and exactly what remains.

## What was done without a browser

- The Quality Explorer and capsule links were built inside the existing
  `/observability` design system (paper `#f4f2ec`, ink `#1d2733`, ochre
  `#8a6d2b`, white cards, 1px `#d8d3c4` borders, 12px radius) by reusing the
  page's own classes and the matrix bar pattern. No new palette, no gradients,
  no glass cards, no decorative 3D.
- Status is always a word (Recorded / Inconclusive / Not recorded), never
  colour alone. The quality bar has an `aria-label` with the full value text.
- A mobile media query collapses the quality-figure header at ≤640px.
- `tsc` and `eslint` are clean on all changed files, so the markup at least
  compiles; that is not a visual check and is not presented as one.

## Routes requiring visual inspection (desktop 1440×900, mobile 390×844)

Homepage, Observability (now with Quality Explorer + capsule links),
Lineage, Wetland workspace, Wetland global, Forest workspace, Forest global,
Rondônia, Volcano workspace, Volcano global, Hayli Gubbi, Agriculture,
Agriculture global, Naogaon study detail. For each: initial viewport, full
page, interactions, loading/empty/error states, layout defects — then fix and
re-inspect.

## Recovery checklist (healthy machine)

1. Verify `public/showcase/index.json` (master: 847 bytes, SHA-256
   `eb60a50d…`; this tree: 453 bytes, `2b929ad3…`).
2. Apply the port package, then `npm ci`, `npm test`, lint, `tsc`, `npm run build`.
3. Start the production server; screenshot every route above at both sizes.
4. Click every capsule download link; open one capsule JSON and check it
   against its study's manifests.
5. Exercise the Quality Explorer bars at 390px (overflow, wrapping).
6. Re-run the 5 E2E suites + `verify_showcase.py`.

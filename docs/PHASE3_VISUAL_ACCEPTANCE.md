# Phase 3 — Visual Acceptance

**Date:** 2026-11-08
**Branch:** `Rubai-dev` (HEAD `fb3d445`; all work local, no push, no merge)

## 1. Headline: browser inspection is BLOCKED, not skipped

No screenshots exist for Phase 3, and none are claimed. The browser cannot
render in this environment (Chromium dies SIGTRAP; see
`docs/PHASE3_ENVIRONMENT_REPAIR.md`), no Phase 2/3 server can run (`:3015`
dead; `.next/` has no `BUILD_ID`), and `next build` is blocked. What was
done instead, and what it does and does not prove:

- **Static geometry verification** of `/lineage` for all 7 studies
  (0 issues) — proves the graph model and layout are correct; it does not
  prove how the page looks.
- **Code-level visual review** of the homepage, `/observability`,
  `/lineage`, and all four workspaces — proves the structure, data flow,
  links, and states are correct; it does not prove the rendered pixels.
- **Visual improvements implemented and unit-verified** (§2) — the code is
  tested (120/120 node tests, tsc/lint clean), but the rendered result
  must be inspected in a healthy environment before it is called
  demo-ready.

**Do not present `/lineage` (or any Phase 3 visual change) as demo-ready
until a browser inspection is completed in a recovered environment.**

## 2. `/lineage` — what changed in Phase 3

The Phase 2 explorer was already structurally sound (7 study tabs,
6-column SVG graph, keyboard-selectable nodes, inspector with real
evidence links, missing-data nodes, status glyphs + words). Phase 3 adds
the visual layer the brief asked for:

| Requirement | Change |
|---|---|
| Hover states | `.lineage-node:hover` brightens the node fill and stroke (CSS). |
| Zoom and pan | Zoom toolbar (− / + / 100%, steps 0.5–2×, live % readout); the canvas already scrolls horizontally, which is the pan. |
| Direction of relationships | SVG arrowheads (`marker-end`) on every edge, ochre, following the active/inactive opacity. |
| Measured vs derived vs reference | Column-family bands: each column sits on a subtle tinted band (Derived gold, Process slate, Measured green, Reference violet, Record slate) + the group word is prefixed to each column hint + a group key in the legend. Status is still carried by glyph + words, never by these tints. |
| Smooth interactions | 0.15s transitions on node fill/stroke and edge opacity/width, disabled under `prefers-reduced-motion`. |
| Focus / selection | Unchanged (already had `:focus-visible` + selected-node stroke + connected-edge highlight). |

**Geometry verification (static, all 7 studies, re-run after the changes):
0 issues.** 7 chains loaded, 0 unavailable; no node overlaps; every edge
resolves to a real node; columns hold the expected kinds; Hakaluki keeps
its two separate reference nodes; Kīlauea and Naogaon keep their
missing-data reference nodes. Canvas is 1592 px wide for all studies
(heights 328–752 px by observation count); on mobile it scrolls
horizontally inside `.lineage-canvas` and the inspector details collapse
to one column at ≤640 px.

A new unit test pins the column families (all five groups present;
observations = measured, result = derived, reference = reference).

## 3. Homepage — code review

- Hero: interactive 3D globe with real study markers, hazard filter with
  live counts, pin mode, CTAs (Chókwè event case, Tanguar case). Nav links
  all seven destinations (Wetlands, Forests, Volcanoes, Agriculture,
  Observation health, Evidence lineage, NISAR worldwide).
- Hydrograph: real Tanguar pulse values from `pulse.json` (never
  hardcoded), play/pause, per-date buttons, honest failure state ("no
  chart is shown rather than invented values").
- Counters use real manifest values (observation count, peak candidate
  area); the only fixed numbers are published NISAR mission specs
  (12-day revisit, 242 km swath).
- Phenomena cards are registry-driven with honest evidence summaries
  (Hakaluki weak, Tanguar inconclusive, Chókwè unverified, Rondônia
  0.0128 km², Hayli LOS candidates not attributed to the eruption).
- Published-investigations strip: 6 globe markers + the Naogaon card
  (from its own manifest), with links to `/lineage` and `/observability`.
- No visual defects found in code review. **Not browser-verified in
  Phase 3** (the Phase 2 strip/matrix were also never browser-verified).

## 4. `/observability` — code review

- Maturity matrix (studies × 8 stages, ●/○ with screen-reader text,
  observation-count bars scaled to the max, reached x/8 column) plus
  per-study cards (product, maturity, date range, checksums, run ID,
  published date, ladder, validation note, next step).
- **Phase 3 change:** Hakaluki now correctly shows "Published and
  verifiable" (its `publication.json` artifact map, 81 digests — see
  `docs/PHASE3_SCIENTIFIC_VERIFICATION.md` §1) instead of "Not published
  for this study".
- States glossary, live-services note, and the `/lineage` link are
  present. No visual defects found in code review. **Not
  browser-verified in Phase 3.**

## 5. Workspaces — code review

- **Wetlands:** Tanguar is the featured case (hero CTA, quest empty state,
  `/wetland/global` default); its inconclusive reference validation is
  stated on the page, not hidden. Chókwè deep-link, comparison tools,
  evidence panels, and downloads reviewed (§6).
- **Forests:** drawer tabs (Explore / Check it / Learn), map layers
  (WorldCover 2021, radar imagery, scene footprints, change candidates),
  coverage search, method notes with real source links. The apparent
  "duplicated" place-search form is a single render (the drawer shows the
  selected tab's content *or* the fallback panel, never both) — no
  duplicate-ID defect.
- **Volcanoes:** interferogram/coherence/LOS explorers with coordinate
  probing and downloadable LOS GeoTIFFs (verified present on disk for
  Hayli v3 and Kīlauea v3).
- **Agriculture:** SME2 workbench with dated moisture layers, uncertainty,
  baseline comparison, and quality-flag provenance; CSV export generates
  from real data.

No redesigns were made to working components: without a browser, visual
changes cannot be verified, and untested restyling would be worse than the
current state.

## 6. Downloads — one real defect found and fixed

The wetland reference/radar tools offered GeoTIFF downloads for files
that are **not in the published web package** (0 `.tif` files exist under
`public/studies/` or `public/showcase/`): `reference_agreement.tif`,
`reference_before_mndwi.tif`, `reference_after_mndwi.tif`, the per-stage
radar GeoTIFFs, and `classification_*.tif`. The links rendered
unconditionally and returned 404 from `/api/wetland/artifact`. **Fix:**
those links are now gated to operator mode (`!publicClient`); in the
public viewer they are replaced by a note explaining that GeoTIFF rasters
are part of the local study package and the PNG/GeoJSON versions are the
published ones. The PNG, GeoJSON, JSON, and CSV downloads all point at
files that exist (verified on disk). Volcano LOS GeoTIFF links were
verified present and left alone.

## 7. Demo readiness by route (visual)

| Route | Visual state |
|---|---|
| `/` (homepage) | Code-reviewed; structure + data flow sound. **Browser check pending.** |
| `/lineage` | Geometry verified (0 issues); visual improvements implemented + unit-tested. **Browser check pending — do not demo yet.** |
| `/observability` | Code-reviewed; Hakaluki checksums fixed. **Browser check pending.** |
| `/wetland`, `/wetland/global` | Code-reviewed; Tanguar surfaced, inconclusive state visible. **Browser check pending.** |
| `/forest/global`, `/forest/rondonia` | Code-reviewed. **Browser check pending.** |
| `/volcano/global`, `/volcano/hayli-gubbi`, `/volcano/kilauea` | Code-reviewed; LOS downloads verified on disk. **Browser check pending.** |
| `/agriculture` | Code-reviewed. **Browser check pending.** |

## 8. What must happen in a recovered environment

1. `npm run build`, start the server, and screenshot every route above at
   desktop (1440 px) and mobile (390 px).
2. Exercise `/lineage` in the browser: all 7 study tabs, node selection,
   zoom controls, hover/focus states, inspector links (including
   Hakaluki's two references), and the horizontal scroll on mobile.
3. Re-run the 5 E2E suites and record the results (they are currently
   carried from Phase 1, not re-verified against this tree).
4. Fix whatever the screenshots show, then inspect again.

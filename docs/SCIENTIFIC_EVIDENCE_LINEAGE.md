# Beyonders — Scientific Evidence Lineage (Phase 2)

Route: `/lineage` (linked from `/observability` and the site navigation).
Status: implemented 2026-11-08; typecheck, lint, and unit tests pass;
browser rendering **not yet verified** — Chromium and `next build` are
blocked by the VM-level EPERM fault at the time of writing.

## What it is

An interactive graph that traces a published result backward to its source:

```
RESULT → METHOD → QUALITY SCREEN → OBSERVATIONS → REFERENCE → PROVENANCE
```

Read left to right: start at what you see, trace back to where it came
from. Every node is a button; selecting it opens an inspector with the
node's full evidence. Edges connected to the selected node highlight.

## What it is not

- Not a new data layer. The graph is a pure translation of the existing
  `EvidenceChain` type (`src/lib/evidence-chain.ts`, builders per domain,
  already tested). No new provenance claims were introduced.
- Not a decorative connection diagram. Every node is built from a field
  that actually exists in the chain. A missing field becomes a
  "Not recorded" node — never an invented value, never a silent gap.
- Not a validation claim. An inconclusive reference stays inconclusive in
  the graph; the status glyph and label say so in words, not just colour.

## Graph model (`src/lib/evidence-lineage.ts`)

| Column | Node kinds | Source in the chain |
|---|---|---|
| 0 Result | one per measurement | `chain.measurements` (value, unit, interpretation) |
| 1 Method | one | `chain.method` (id, summary, coverage gate) |
| 2 Quality screen | one | `chain.method.screening_rules` (each rule is a detail row) |
| 3 Observations | one per acquisition | `chain.observations` (date, product, track/frame, granule `source_id`) |
| 4 Reference | one per reference | `chain.references` (status, dates, offsets, coverage, precision/recall/F1, limitations) |
| 5 Provenance | one | `chain.provenance` (run ID, publication, boundary, modality, source URLs) |

Edges follow the trace order. The layout is pure arithmetic (fixed node
size, stacked columns, cubic-bezier edges) so it needs no measurement and
is unit-tested: nodes stay inside the canvas, same-column nodes never
overlap, and no edge points at a node that does not exist.

Node status is shown with a glyph **and** a word, never colour alone:
● Recorded · ◐ Inconclusive · ○ Not recorded · ◆ Partial record.

## Study loader (`src/lib/lineage-studies.ts`, server only)

Builds one chain per published study from the manifests in `public/`:

| Study | Source files | Notes |
|---|---|---|
| Tanguar Haor | `public/studies/catalog.json` → run `3b01cdb5…` (`case_study.json`, `observations.json`) | 7 observations, granule IDs from `scene_name`; reference INCONCLUSIVE with computed-zero metrics (TP 0, FP 23, FN 29) |
| Hakaluki Haor | catalog run `d6e65a58…` + `date_checks/2026-09-27/evidence.json` | **Two** reference nodes: headline pair INCONCLUSIVE (metrics null) and the 27 Sep 2026 date check WEAK_AGREEMENT (P 12.9%, R 5.2%, F1 7.4%). See `docs/DATA_AUTHENTICITY_AUDIT.md` §2 for why. |
| Chókwè | catalog run `ec8fa5ee…` | Product BETA; included although `/observability` lists six studies — it is a published catalog run in the same shape |
| Rondônia | `public/forests/rondonia/index.json` → `study.json` | Version resolved through the index, not hard-coded |
| Hayli Gubbi / Erta Ale | `public/volcanoes/hayli-gubbi/index.json` → `study.json` | Current version is **2026.10.30-v3** (5 pairs: 3 NISAR + 2 Sentinel-1) |
| Kīlauea | `public/volcanoes/kilauea-episode-36-2025/index.json` → `study.json` | Current version 2026.10.30-v3, 1 pair |
| Naogaon | `public/agriculture/current/study.json` | 6 observations, granule IDs, D-107677 zero-clear rule in the screening node |

Two enrichments happen in the loader, both from the same manifests:

1. Wetland observation nodes get granule IDs from `observations.json`
   (`scene_name`); the chain builder only carries dates.
2. Hakaluki's second reference (above). The "weak agreement" label is the
   documented assessment in `docs/evidence-report.md`, not a new
   classification.

A study that cannot be read lands in `unavailable` with its reason and is
shown on the page as unavailable — never as an empty graph.

## Files changed

- `src/lib/evidence-lineage.ts` — graph model + layout (pure, tested).
- `src/lib/evidence-lineage.test.ts` — 4 tests (trace order, missing-data
  handling, layout geometry, real Naogaon manifest).
- `src/lib/lineage-studies.ts` — server loader for all 7 chains.
- `src/lib/lineage-studies.test.ts` — 1 test asserting all 7 chains load
  from the real manifests with the expected counts, granule IDs, and the
  Hakaluki double reference.
- `src/components/shared/EvidenceLineageExplorer.tsx` — client component:
  study switcher, SVG graph, node inspector.
- `src/components/shared/evidence-lineage.css` — dark instrument canvas.
- `src/app/lineage/page.tsx` + `src/app/lineage/lineage.css` — route.
- `src/components/layout/HazardNavigation.tsx` — "Evidence lineage" link.
- `src/app/observability/page.tsx` — "Trace the evidence" section.

## Verification

- `tsc --noEmit --incremental false`: clean.
- `eslint`: clean.
- `node --test src/lib/*.test.ts`: **119/119 pass** (was 114; +5 lineage).
- Browser rendering, `next build`, and E2E: **blocked** by the environment
  (shell writes EPERM, Chromium SIGTRAP). Re-verify visually when the
  environment recovers; the graph geometry is already pinned by tests, so
  the remaining risk is presentational (CSS/SVG rendering), not data.

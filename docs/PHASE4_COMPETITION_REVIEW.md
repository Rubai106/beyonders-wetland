# PHASE 4 COMPETITION REVIEW (judge's view)

Date: 2026-11-08. No numeric score is assigned — the brief forbids inventing
one. This is an evidence-backed assessment of strengths and weaknesses.

> **Status update — 2026-11-08 (after this review was written).** The two
> blockers in "Weaknesses" below are resolved: the Phase 1–4 master migration
> is applied, verified, and pushed to `master` on GitHub (remote head
> `72731abf`, tree byte-identical to the verified local HEAD), and the
> Temporal Investigation Studio is built and browser-verified (all 7 studies
> loading, chart + scrubber + per-date evidence, mobile clean), as are the
> Hypothesis Workspace and study comparison. The review body below is kept
> as the record of what was true when it was written; the remaining open
> weakness is the absence of independent validation anywhere.

## The four judge questions, answered with the product

**What did the satellite actually observe?**
Strong. Seven published investigations name their granules, dates, tracks,
frames, and products. The homepage globe, the lineage explorer, and the new
Quality Explorer all show real acquisitions — and show missing dates and
thin coverage explicitly (Tanguar 0.33%, Hakaluki headline 9 pixels).

**How did we derive the result?**
Strong. Method versions are named per study (`hh-hv-change-v1`,
`forest-hv-persistence-1.0.0`, `gunw-relative-los-1.0.1`, SME2 DSG), quality
screens are documented rules (SME2 zero-clear, verified against JPL Rev C),
and the lineage graph traces RESULT → METHOD → SCREEN → OBSERVATIONS →
REFERENCE → RUN. The new capsule packages that trail as a download.

**What evidence supports the interpretation?**
Honest, and that honesty is the differentiator. Every reference comparison
states its outcome: Tanguar inconclusive, Hakaluki weak agreement on the date
check only, Chókwè inconclusive, Rondônia exploratory overlap with no labelled
reference, volcanoes context-only. Nothing is dressed up as validation.

**What remains uncertain?**
Explicit everywhere: no study validated, LOS is not vertical displacement,
radar candidates are not confirmed floods or deforestation, SME2 is not crop
stress. The Quality Explorer makes the uncertainty quantitative.

## Strengths

- Scientific defensibility: checksums (Tanguar 68/68, Hakaluki 81/81,
  Chókwè 24/24), corrected Hakaluki attribution, falsified SME2 bits rule.
- Distinctive features: lineage explorer, 8-stage maturity ladder, quality
  explorer, investigation capsule — all real-data, none decorative.
- Engineering: 135/135 node tests, clean tsc/lint, rate-limited APIs,
  enforcing CSP, fail-closed integrity.

## Weaknesses (evidence-backed)

1. **The master port is not applied.** All Phase 1–4 work sits on `Rubai-dev`
   + uncommitted files in this VM; `master` does not have it. Until the port
   lands on a healthy machine, the delivery branch is behind the work.
2. **Nothing has been seen rendered.** No build, no browser, no screenshots
   in Phases 3–4. The visual quality claim is unverified, and the capsule
   download has never been clicked in a real browser.
3. **No independent validation anywhere.** All seven studies are exploratory
   or inconclusive. That is honest, but it caps the science story: the
   strongest remaining scientific move is one conclusive reference comparison,
   not another feature.

## Three highest-impact remaining improvements

1. Apply the master port on a healthy machine and verify it end to end
   (build, E2E, screenshots, capsule download) — unblocks everything else.
2. Get one conclusive independent reference for the strongest study
   (Tanguar or Naogaon) — the only thing that moves the validation column.
3. Build the Temporal Investigation Studio on the verified master baseline —
   the signature interactive experience the platform still lacks — with the
   browser available to verify it.

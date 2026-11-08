# Beyonders — Phase 2 Competition Review

A demanding technical and scientific judge's review, written against the
actual product on branch `Rubai-dev` (Phase 2, 2026-11-08). No score is
inflated to a target; where evidence is missing, the review says so.

## The ten questions

1. **Does it solve an actual user problem?** Yes, narrowly and honestly.
   An investigator who wants to know "what changed here, what measured it,
   and how much can I trust it" currently stitches together a catalogue,
   a download tool, a desktop processor, and a notebook. Beyonders keeps
   that whole chain in one place for four NISAR domains. The problem is
   real; the scope (7 published studies) is small but genuine.
2. **Is the scientific workflow meaningful?** Yes. Observe → Investigate →
   Compare → Validate → Understand → Communicate is not a slogan in the
   UI: the lineage explorer literally walks it, and the maturity ladder
   refuses to award stages that were not earned.
3. **Does it do more than show satellite imagery?** Yes — this is the
   strongest point. Derived measurements, quality screens, independent
   references, hypothesis comparison, and evidence-aware exports are the
   product; imagery is the input.
4. **Can a first-time user understand what is happening?** Mostly. The
   homepage (globe + real hydrograph + published-investigations strip)
   explains the product in seconds; the lineage explorer explains any
   single result in one graph. Weakness: the domain workbenches are still
   dense for a non-technical user, and there is no guided first-run tour.
5. **Are the results supported by real observations?** Yes, with receipts.
   Every published study traces to named granules (CMR concept IDs where
   recorded), real acquisition dates, and stored processing outputs. The
   Phase 2 audit verified the chain study by study and fixed the one place
   where numbers were misattributed (Hakaluki).
6. **Can a judge independently follow the evidence?** Yes — better than
   most entries. Checksums, run IDs, method versions, per-file hashes
   (Rondônia), source URLs, and now the lineage graph. Gap: Hakaluki has
   no checksums file, and independent reproduction still needs Earthdata
   access (stated, not hidden).
7. **Is the interface memorable?** The 3D globe hero is; the lineage
   graph is designed to be. The observability matrix gives judges a
   one-glance readiness picture. Risk: the workbenches still look like
   competent instrument panels rather than a distinctive visual system.
8. **Are the differentiating features genuinely useful?** The lineage
   explorer and maturity ladder solve real reviewer problems (provenance
   checking, validation-state reading). The hypothesis workspace solves a
   real analyst problem (one signal, several causes). None of them is a
   decorative demo.
9. **Can a judge independently follow the evidence?** (See 6 — yes, with
   the Hakaluki checksums gap noted.)
10. **Are the limitations clearly communicated?** Yes — this is the
    product's most consistent strength. INCONCLUSIVE is a designed state,
    null metrics are shown as null, computed zeros are shown as zeros, and
    every study page states what was not validated.

## Honest assessment

- **Strongest:** scientific honesty as a feature. The product would
  rather show "9 common-clear pixels — unassessable" than a plausible
  number. In a competition where most entries overclaim, that restraint
  is the differentiator, and Phase 2 made it stronger (Hakaluki fix, SME2
  resolution, lineage explorer).
- **Weakest:** scale and polish under real use. Seven studies, no real
  users, no usability sessions, and the Phase 2 visual work is
  unverified in a browser (environment fault). A judge who clicks
  through will find depth; a judge who skims may find the workbenches
  dense.
- **What would move the needle before judging:** (a) visual verification
  of `/lineage` + matrix + homepage strip once the environment recovers;
  (b) Hakaluki checksums; (c) one real-user walkthrough (even a single
  colleague) with notes, not invented; (d) a 2-minute demo path that
  starts at the globe, opens Tanguar, traces one measurement in the
  lineage explorer, and ends on the inconclusive reference — the honest
  arc, told confidently.

## Verdict

A serious, credible, competition-grade scientific product with an
unusually honest evidence story — not a polished demo of a thin idea.
Its ceiling in judging depends on whether the demo leads with the
lineage and the inconclusive results (its strengths) rather than with
feature count. No score is assigned here: inventing a number would
repeat the exact error this project exists to avoid.

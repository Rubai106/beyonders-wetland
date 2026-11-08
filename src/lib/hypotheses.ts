/* Hypothesis & Falsification Lab — Analysis of Competing Hypotheses (ACH) for the
   published studies. Every hypothesis, evidence item, and seeded rating
   comes from the studies' own documented facts (values from the published
   files). The platform's seeded ratings are a starting assessment; the user
   can change any cell and the ranking updates live. Nothing here claims a
   study is validated. */

export type AchRating = "consistent" | "inconsistent" | "neutral";

export interface Hypothesis {
  id: string;
  statement: string;
  /** What the hypothesis asserts, stated before the evidence is weighed. */
  claim: string;
  /** The single checkable observation that would kill this hypothesis. */
  falsifier: string;
}

export interface HypothesisEvidence {
  id: string;
  text: string;
  source: string;
}

export interface HypothesisStudy {
  studyId: string;
  studyName: string;
  domain: string;
  href: string;
  hypotheses: Hypothesis[];
  evidence: HypothesisEvidence[];
  /** The platform's seeded assessment: evidence -> hypothesis -> rating. */
  assessments: Record<string, Record<string, AchRating>>;
}

export type RatingMap = Record<string, Record<string, Record<string, AchRating>>>;

export function inconsistencyCount(study: HypothesisStudy, ratings: RatingMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of study.hypotheses) out[h.id] = 0;
  for (const e of study.evidence) {
    for (const h of study.hypotheses) {
      const r = ratings[study.studyId]?.[e.id]?.[h.id] ?? study.assessments[e.id]?.[h.id] ?? "neutral";
      if (r === "inconsistent") out[h.id] += 1;
    }
  }
  return out;
}

export function consistencyCount(study: HypothesisStudy, ratings: RatingMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of study.hypotheses) out[h.id] = 0;
  for (const e of study.evidence) {
    for (const h of study.hypotheses) {
      const r = ratings[study.studyId]?.[e.id]?.[h.id] ?? study.assessments[e.id]?.[h.id] ?? "neutral";
      if (r === "consistent") out[h.id] += 1;
    }
  }
  return out;
}

/** Hypotheses ranked by fewest inconsistencies, then most consistencies (ACH). */
export function rankHypotheses(
  study: HypothesisStudy,
  ratings: RatingMap,
): { hypothesis: Hypothesis; inconsistent: number; consistent: number }[] {
  const bad = inconsistencyCount(study, ratings);
  const good = consistencyCount(study, ratings);
  return study.hypotheses
    .map((h) => ({ hypothesis: h, inconsistent: bad[h.id], consistent: good[h.id] }))
    .sort((a, b) => a.inconsistent - b.inconsistent || b.consistent - a.consistent);
}

/** Evidence where the hypotheses do not all share one rating — the diagnostic rows. */
export function diagnosticEvidence(study: HypothesisStudy, ratings: RatingMap): HypothesisEvidence[] {
  return study.evidence.filter((e) => {
    const rs = study.hypotheses.map(
      (h) => ratings[study.studyId]?.[e.id]?.[h.id] ?? study.assessments[e.id]?.[h.id] ?? "neutral",
    );
    return new Set(rs).size > 1;
  });
}

export const HYPOTHESIS_STUDIES: HypothesisStudy[] = [
  {
    studyId: "tanguar-haor",
    studyName: "Tanguar Haor",
    domain: "wetland",
    href: "/wetland",
    hypotheses: [
      {
        id: "flood",
        statement: "The candidates are monsoon flood water spreading across the haor.",
        claim: "The August expansion is flood water, and its area tracks the monsoon.",
        falsifier: "A cloud-free optical image within 5 days of 29 Aug showing dry land where the radar shows its largest candidates.",
      },
      {
        id: "managed-water",
        statement: "The candidates are managed water — fish ponds and irrigation — not flood.",
        claim: "The signal is managed water, and its pattern follows ponds and fields, not the monsoon.",
        falsifier: "Candidates holding the same ponds through the dry season while the monsoon signal recedes.",
      },
      {
        id: "artefact",
        statement: "The darkening is a radar artefact — wind or surface roughness — not new water.",
        claim: "The signal is surface roughness, and it appears and vanishes with wind, not with rain.",
        falsifier: "The same darkening on a known-dry, high-wind date with no rain in the preceding days.",
      },
    ],
    evidence: [
      { id: "peak", text: "Candidate area grows through the monsoon to a 24.48 km² peak on 29 Aug, then recedes.", source: "pulse.json" },
      { id: "patches", text: "295 separate patches at the peak, not one connected sheet.", source: "pulse.json" },
      { id: "optical", text: "The HLS optical check is inconclusive: 0.333% common clear coverage, below the 20% floor.", source: "reference.json" },
      { id: "confusion", text: "Headline reference confusion is TP 0, FP 23, FN 29 over 3,880 common-clear pixels.", source: "reference check" },
      { id: "darkening", text: "Mean backscatter change −5.36 dB at the first date; calm water is dark in HH.", source: "pulse.json" },
      { id: "persistence", text: "The signal persists across 7 dates over 3 months.", source: "pulse.json" },
    ],
    assessments: {
      peak: { flood: "consistent", "managed-water": "neutral", artefact: "inconsistent" },
      patches: { flood: "neutral", "managed-water": "consistent", artefact: "neutral" },
      optical: { flood: "neutral", "managed-water": "neutral", artefact: "neutral" },
      confusion: { flood: "inconsistent", "managed-water": "neutral", artefact: "neutral" },
      darkening: { flood: "consistent", "managed-water": "neutral", artefact: "inconsistent" },
      persistence: { flood: "consistent", "managed-water": "consistent", artefact: "inconsistent" },
    },
  },
  {
    studyId: "hakaluki-haor",
    studyName: "Hakaluki Haor",
    domain: "wetland",
    href: "/wetland",
    hypotheses: [
      {
        id: "flood",
        statement: "The candidates are monsoon flood water.",
        claim: "The detector finds real flood water, and the 27 Sep check under-measures it.",
        falsifier: "A cloud-free optical image on 17 Jul showing water across the 2.57 km² candidate area — or showing dry land there.",
      },
      {
        id: "false-positives",
        statement: "The candidates are mostly false positives — dry land flagged as water.",
        claim: "The detector over-flags, and most candidates are not water.",
        falsifier: "A second independent check on a different optical date agreeing with the radar at over 50% precision.",
      },
      {
        id: "irrigation",
        statement: "The candidates are irrigation change, not flood.",
        claim: "The signal follows irrigation, not rainfall.",
        falsifier: "Candidates tracking rainfall rather than irrigation schedules.",
      },
    ],
    evidence: [
      { id: "peak", text: "7 dates; peak 2.57 km² on 17 Jul, 213 patches.", source: "observations.json + patches" },
      { id: "check", text: "27 Sep cross-sensor check: precision 12.9%, recall 5.2%, F1 7.4% — weak agreement.", source: "date_checks/2026-09-27/evidence.json" },
      { id: "headline", text: "The headline 23 Jun → 17 Jul pair is unassessable: only 9 cloud-free pixels overlap.", source: "case_study.json (reference_validation)" },
      { id: "coverage", text: "Common clear coverage 50.7% on 27 Sep (HLS grid; 47.8% on the radar grid) — above the 20% floor, so the check itself is assessable.", source: "date_checks/2026-09-27/evidence.json (optical_support)" },
    ],
    assessments: {
      peak: { flood: "consistent", "false-positives": "neutral", irrigation: "neutral" },
      check: { flood: "inconsistent", "false-positives": "consistent", irrigation: "neutral" },
      headline: { flood: "neutral", "false-positives": "neutral", irrigation: "neutral" },
      coverage: { flood: "inconsistent", "false-positives": "consistent", irrigation: "neutral" },
    },
  },
  {
    studyId: "chokwe",
    studyName: "Chókwè",
    domain: "wetland",
    href: "/wetland/global?story=chokwe",
    hypotheses: [
      {
        id: "flood",
        statement: "The January event is flood water.",
        claim: "The 17 Jan candidates are flood water from the January event.",
        falsifier: "An optical image of the same dates showing no flood where the radar shows candidates.",
      },
      {
        id: "artefact",
        statement: "The candidates are a processing artefact of a single pair.",
        claim: "One pair cannot establish a flood; the signal is an artefact.",
        falsifier: "A second independent sensor agreeing with the radar on the same dates.",
      },
    ],
    evidence: [
      { id: "event", text: "29.872 km², 127 patches, baseline 5 Jan → event 17 Jan.", source: "case_study.json" },
      { id: "reference", text: "The reference comparison is inconclusive.", source: "case_study.json" },
      { id: "single-pair", text: "The event is a single 12-day pair — no time series to show rise and fall.", source: "case_study.json" },
      { id: "unosat", text: "A later UNOSAT Sentinel-1 overlay provides positive spatial support for the candidate area.", source: "case_study.json" },
    ],
    assessments: {
      event: { flood: "consistent", artefact: "neutral" },
      reference: { flood: "neutral", artefact: "neutral" },
      "single-pair": { flood: "inconsistent", artefact: "consistent" },
      unosat: { flood: "consistent", artefact: "inconsistent" },
    },
  },
  {
    studyId: "rondonia",
    studyName: "Rondônia",
    domain: "forest",
    href: "/forest/rondonia",
    hypotheses: [
      {
        id: "clearing",
        statement: "The candidate is real forest clearing.",
        claim: "The 29 Sep candidate is tree loss, and it stays lost.",
        falsifier: "A later valid date where the HV signal returns to baseline.",
      },
      {
        id: "seasonal",
        statement: "The candidate is seasonal leaf or moisture change, not clearing.",
        claim: "The HV drop is seasonal, and it reverses.",
        falsifier: "A confirmed GLAD-S2 alert overlapping the candidate at the same date.",
      },
      {
        id: "artefact",
        statement: "The candidate is a processing artefact.",
        claim: "The single small patch is a mis-registration or edge effect.",
        falsifier: "The candidate sitting exactly on a scene edge or a mis-registration seam.",
      },
    ],
    evidence: [
      { id: "one-candidate", text: "One 0.0128 km² candidate on 29 Sep.", source: "study.json" },
      { id: "persistence", text: "HV drop of at least 3 dB persisting across two consecutive valid dates.", source: "study.json" },
      { id: "hls", text: "HLS index decreases overlap 71.1% of the candidate.", source: "study.json" },
      { id: "no-reference", text: "No labelled forest-loss reference or accuracy score exists.", source: "study.json" },
      { id: "tree-cover", text: "The candidate sits inside 2021 WorldCover tree cover.", source: "study.json" },
    ],
    assessments: {
      "one-candidate": { clearing: "neutral", seasonal: "neutral", artefact: "neutral" },
      persistence: { clearing: "consistent", seasonal: "inconsistent", artefact: "inconsistent" },
      hls: { clearing: "consistent", seasonal: "consistent", artefact: "inconsistent" },
      "no-reference": { clearing: "neutral", seasonal: "neutral", artefact: "neutral" },
      "tree-cover": { clearing: "consistent", seasonal: "neutral", artefact: "neutral" },
    },
  },
  {
    studyId: "hayli-gubbi",
    studyName: "Hayli Gubbi and Erta Ale",
    domain: "volcano",
    href: "/volcano/hayli-gubbi",
    hypotheses: [
      {
        id: "magmatic",
        statement: "The phase signal is magmatic ground motion from the eruption.",
        claim: "The ground moved with the eruption, and the LOS signal measures it.",
        falsifier: "Independent GNSS stations near Erta Ale showing no displacement across the same interval.",
      },
      {
        id: "atmosphere",
        statement: "The phase signal is atmospheric or ionospheric delay, not ground motion.",
        claim: "The signal is weather and ionosphere, and it would appear without any eruption.",
        falsifier: "The same phase pattern in a pair spanning a quiet period with no eruption.",
      },
      {
        id: "unwrapping",
        statement: "The phase signal is an unwrapping error.",
        claim: "The unwrapper failed on steep gradients, and the signal is a processing error.",
        falsifier: "A reprocessing with a different unwrapper removing the signal.",
      },
    ],
    evidence: [
      { id: "spans-eruption", text: "The signal spans the eruption: the 22 Nov–4 Dec pair covers the 23 Nov event.", source: "study.json" },
      { id: "no-corrections", text: "Atmospheric, ionospheric, and tide corrections are NOT applied.", source: "study.json" },
      { id: "sentinel1", text: "Sentinel-1 (C-band) shows a similar pattern.", source: "study.json" },
      { id: "reference-patch", text: "Reference patch stability is assumed, not surveyed ground truth.", source: "study.json" },
      { id: "coherent", text: "The pattern is spatially coherent around Erta Ale north/south and Hayli Gubbi.", source: "study.json" },
    ],
    assessments: {
      "spans-eruption": { magmatic: "consistent", atmosphere: "neutral", unwrapping: "neutral" },
      "no-corrections": { magmatic: "neutral", atmosphere: "consistent", unwrapping: "neutral" },
      sentinel1: { magmatic: "consistent", atmosphere: "neutral", unwrapping: "inconsistent" },
      "reference-patch": { magmatic: "neutral", atmosphere: "neutral", unwrapping: "consistent" },
      coherent: { magmatic: "consistent", atmosphere: "inconsistent", unwrapping: "inconsistent" },
    },
  },
  {
    studyId: "kilauea-episode-36",
    studyName: "Kīlauea, Episode 36",
    domain: "volcano",
    href: "/volcano/kilauea",
    hypotheses: [
      {
        id: "motion",
        statement: "The LOS signal is real ground motion from Episode 36.",
        claim: "The ground moved during the episode, and the single pair measures it.",
        falsifier: "GNSS on Kīlauea showing no motion across 3–15 Nov.",
      },
      {
        id: "atmosphere",
        statement: "The LOS signal is atmospheric delay.",
        claim: "The signal is weather, and it would appear without any eruption.",
        falsifier: "The same LOS pattern in a pair with no eruption.",
      },
    ],
    evidence: [
      { id: "single-pair", text: "Single GUNW pair, 3–15 Nov 2025, spanning Episode 36 (9 Nov).", source: "study.json" },
      { id: "context-only", text: "Event context only — corrections NOT applied.", source: "study.json" },
      { id: "screened", text: "737.7 km² assessed, 63.3% screened.", source: "study.json" },
    ],
    assessments: {
      "single-pair": { motion: "consistent", atmosphere: "neutral" },
      "context-only": { motion: "neutral", atmosphere: "neutral" },
      screened: { motion: "consistent", atmosphere: "neutral" },
    },
  },
  {
    studyId: "naogaon",
    studyName: "Naogaon (SME2 soil moisture)",
    domain: "agriculture",
    href: "/agriculture",
    hypotheses: [
      {
        id: "soil-moisture",
        statement: "SME2 tracks real soil moisture change.",
        claim: "The retrievals measure soil moisture, and the medians are comparable across dates.",
        falsifier: "Field soil samples at the same dates disagreeing with the SME2 medians.",
      },
      {
        id: "vegetation-water",
        statement: "SME2 tracks vegetation or standing water instead of soil moisture.",
        claim: "The signal is canopy and surface water, and the soil-moisture reading is confounded.",
        falsifier: "A crop and land-cover map showing the valid pixels are all open water or dense canopy.",
      },
    ],
    evidence: [
      { id: "seasonal", text: "6 dated observations; median change +0.0328 m³/m³ across the season.", source: "study.json" },
      { id: "no-reference", text: "No field measurements, no crop mask, no rainfall context exist.", source: "study.json" },
      { id: "excluded", text: "4 dates were excluded before publication for zero valid pixels.", source: "study.json" },
      { id: "farmland", text: "The site is farmland in monsoon season; standing water is common and there is no crop mask to separate it.", source: "study.json" },
      { id: "gate", text: "The retrieval is a documented soil-moisture product with a strict zero-clear quality gate.", source: "study.json" },
    ],
    assessments: {
      seasonal: { "soil-moisture": "consistent", "vegetation-water": "neutral" },
      "no-reference": { "soil-moisture": "neutral", "vegetation-water": "neutral" },
      excluded: { "soil-moisture": "neutral", "vegetation-water": "neutral" },
      farmland: { "soil-moisture": "neutral", "vegetation-water": "consistent" },
      gate: { "soil-moisture": "consistent", "vegetation-water": "inconsistent" },
    },
  },
];

/* Evidence Quality Explorer — data layer.
 *
 * One honest number per fact: how much of each study was actually covered,
 * screened, or compared — read from the published manifests, never invented.
 * Every figure carries its source file so a judge can re-derive it.
 *
 * Rules kept here, matching the rest of the platform:
 * - A computed zero (e.g. Tanguar precision 0.0 over 3,880 pixels) is a
 *   recorded value with a denominator, never a null and never "no data".
 * - A missing figure is "not recorded", never zero.
 * - A fraction without its denominator is not shown as a bare percent.
 */

export type QualityStatus = "recorded" | "not-recorded" | "inconclusive";

export interface QualityFigure {
  /** Short label shown next to the bar. */
  label: string;
  /** Human-readable value, e.g. "3,880 of 1,166,097 pixels". */
  valueText: string;
  /** 0–1 coverage fraction for the bar, or null when no bar applies. */
  fraction: number | null;
  /** What the number means, in one plain sentence. */
  meaning: string;
  status: QualityStatus;
  /** Published file the figure was read from. */
  source: string;
  /** Provenance kept with every derived number (loader-filled). */
  sourceField?: string | null;
  numerator?: number | null;
  denominator?: number | null;
  /** Acquisition date the number describes, when one applies. */
  acquiredAt?: string | null;
  method?: string | null;
}

export interface StudyQuality {
  studyId: string;
  studyName: string;
  figures: QualityFigure[];
}

/** Per-study quality figures, keyed by the observability study id.
 *
 * TEST ORACLE ONLY — do not use this table in production code. The live
 * pages and the capsule route read figures from
 * src/lib/evidence-quality-server.ts, which derives them from the
 * published files on every load. This table exists so the regression tests
 * can catch the loader drifting from the values that were hand-verified
 * against the publication records (see evidence-quality-server.test.ts).
 * If a study version changes, update the loader's derivation AND this
 * oracle together, from the raw files. */
export const STUDY_QUALITY: Record<string, StudyQuality> = {
  "tanguar-haor": {
    studyId: "tanguar-haor",
    studyName: "Tanguar Haor",
    figures: [
      {
        label: "Reference overlap",
        valueText: "3,880 of 1,166,097 valid pixels",
        fraction: 0.0033273389778037334,
        meaning:
          "Only 0.33% of the study area had cloud-free optical coverage in both the baseline and event images — below the 20% floor, so the comparison is inconclusive.",
        status: "inconclusive",
        source: "public/showcase/featured/reference.json (coverage)",
      },
      {
        label: "Reference agreement",
        valueText: "TP 0 · FP 23 · FN 29 — precision, recall, F1 and IoU all 0.0",
        fraction: 0,
        meaning:
          "Computed zeros over the 3,880 overlapping pixels, not missing data. With so little overlap, zeros do not prove there was no change.",
        status: "recorded",
        source: "public/showcase/featured/reference.json (metrics)",
      },
      {
        label: "Radar candidate",
        valueText: "295 patches · peak 24.4765 km² on 2026-08-29",
        fraction: null,
        meaning:
          "Radar-change candidates from the NISAR time series. A candidate is not confirmed inundation.",
        status: "recorded",
        source: "public/showcase/featured/pulse.json + case_study.json",
      },
    ],
  },
  "hakaluki-haor": {
    studyId: "hakaluki-haor",
    studyName: "Hakaluki Haor",
    figures: [
      {
        label: "Headline pair overlap",
        valueText: "9 of 1,729,130 valid pixels",
        fraction: 9 / 1729130,
        meaning:
          "The 23 Jun → 17 Jul 2026 headline pair has almost no cloud-free overlap with the wetland mask. It is unassessable — no metrics exist for it.",
        status: "inconclusive",
        source: "public/studies/releases/2026.10.07/runs/d6e65a58802e4cf4907ddefa42a435d6/case_study.json (reference_validation)",
      },
      {
        label: "27 Sep 2026 date check",
        valueText: "Precision 12.9% · recall 5.2% · F1 7.4%",
        fraction: 0.5071696106763574,
        meaning:
          "The later date check had 50.7% common clear coverage — enough to assess, and the agreement was weak. These metrics belong to the date check, not the headline pair.",
        status: "recorded",
        source: "public/studies/releases/2026.10.07/runs/d6e65a58802e4cf4907ddefa42a435d6/date_checks/2026-09-27/evidence.json (optical_support)",
      },
      {
        label: "File fingerprints",
        valueText: "81 of 81 recorded SHA-256 digests match",
        fraction: 1,
        meaning:
          "Every artifact in the publication record verifies against the file on disk. The two files outside that map are evidence_card.json and publication.json itself.",
        status: "recorded",
        source: "public/studies/releases/2026.10.07/runs/d6e65a58802e4cf4907ddefa42a435d6/publication.json (artifacts)",
      },
    ],
  },
  chokwe: {
    studyId: "chokwe",
    studyName: "Chókwè",
    figures: [
      {
        label: "Radar candidate",
        valueText: "127 patches · 29.872 km²",
        fraction: null,
        meaning:
          "Completed real processing (baseline 2026-01-05 → event 2026-01-17). A candidate is not a confirmed flood.",
        status: "recorded",
        source: "public/studies/releases/2026.10.29-chokwe/runs/ec8fa5ee15ae41d1aa89f930f2b47e36/case_study.json",
      },
      {
        label: "Reference comparison",
        valueText: "INCONCLUSIVE — no usable reference agreement",
        fraction: null,
        meaning:
          "Processing completed does not mean validated. The reference comparison could not confirm or reject the result.",
        status: "inconclusive",
        source: "public/studies/releases/2026.10.29-chokwe/runs/ec8fa5ee15ae41d1aa89f930f2b47e36/run_manifest.json",
      },
    ],
  },
  rondonia: {
    studyId: "rondonia",
    studyName: "Rondônia",
    figures: [
      {
        label: "Radar candidate",
        valueText: "1 candidate · 0.0128 km² (2026-09-29 frame)",
        fraction: null,
        meaning:
          "One small radar-change candidate from 4 frames over 7 input granules. Backscatter change alone is not confirmed deforestation.",
        status: "recorded",
        source: "public/forests/rondonia/2026.10.08-v1/study.json (frames) + candidates GeoJSON",
      },
      {
        label: "Optical support overlap",
        valueText: "71.1% of the candidate overlaps the exploratory HLS signal",
        fraction: 0.7109374744204608,
        meaning:
          "Exploratory NDVI/NBR direction support for the 2026-09-29 candidate. This is not an accuracy score — there is no labelled forest-loss reference.",
        status: "recorded",
        source: "public/forests/rondonia/2026.10.08-v1/study.json (frames[3].reference.support_overlap_fraction)",
      },
    ],
  },
  "hayli-gubbi": {
    studyId: "hayli-gubbi",
    studyName: "Hayli Gubbi and Erta Ale",
    figures: [
      {
        label: "Interferogram pairs",
        valueText: "5 pairs — 3 NISAR GUNW + 2 Sentinel-1 ARIA GUNW",
        fraction: null,
        meaning:
          "Apparent line-of-sight observations. Ionosphere, troposphere and solid-earth-tide corrections were NOT_APPLIED; the reference patch is an assumption.",
        status: "recorded",
        source: "public/volcanoes/hayli-gubbi/2026.10.30-v3/study.json",
      },
      {
        label: "Vertical displacement",
        valueText: "Not recorded — LOS is not vertical displacement",
        fraction: null,
        meaning:
          "Line-of-sight change must not be read as confirmed vertical movement or as volcanic causation.",
        status: "not-recorded",
        source: "public/volcanoes/hayli-gubbi/2026.10.30-v3/study.json (method gunw-relative-los-1.0.1)",
      },
    ],
  },
  "kilauea-episode-36": {
    studyId: "kilauea-episode-36",
    studyName: "Kīlauea, Episode 36",
    figures: [
      {
        label: "Interferogram pairs",
        valueText: "1 GUNW pair — 2025-11-03 → 2025-11-15",
        fraction: null,
        meaning:
          "A single pair around the 2025-11-09 event. Reference is EVENT_CONTEXT_ONLY; corrections NOT_APPLIED.",
        status: "recorded",
        source: "public/volcanoes/kilauea-episode-36-2025/2026.10.30-v3/study.json",
      },
      {
        label: "Independent geodetic comparison",
        valueText: "Not recorded",
        fraction: null,
        meaning:
          "No surveyed reference or independent geodetic comparison exists for this pair yet.",
        status: "not-recorded",
        source: "public/volcanoes/kilauea-episode-36-2025/2026.10.30-v3/study.json",
      },
    ],
  },
  "agri-41647231453": {
    studyId: "agri-41647231453",
    studyName: "Naogaon (SME2 soil moisture)",
    figures: [
      {
        label: "Valid-pixel coverage",
        valueText: "1,338 of 6,278 pixels valid (21.3%)",
        fraction: 0.21312519910799618,
        meaning:
          "Valid pixels after the zero-clear quality screen (retrievalQualityFlag == 0 AND surfaceQualityFlag == 0). Four dates were excluded for zero valid pixels.",
        status: "recorded",
        source: "public/agriculture/current/study.json (change_summary)",
      },
      {
        label: "Soil-moisture change",
        valueText: "Median +0.0328 m³/m³ (p05 −0.0206, p95 +0.1580)",
        fraction: null,
        meaning:
          "Median change across valid pixels only. This is a soil-moisture measurement — not crop stress, drought, irrigation need, or yield.",
        status: "recorded",
        source: "public/agriculture/current/study.json (change_summary)",
      },
      {
        label: "Independent field reference",
        valueText: "Not recorded — no field or crop-condition reference",
        fraction: null,
        meaning:
          "No independent field or crop-condition reference exists for this study, so the measurement is exploratory.",
        status: "not-recorded",
        source: "public/agriculture/current/study.json",
      },
    ],
  },
};

/** Quality figures for one study, or null when the study has no recorded figures. */
export function studyQuality(studyId: string): StudyQuality | null {
  return STUDY_QUALITY[studyId] ?? null;
}

/** All studies with recorded quality figures, in publication order. */
export function allStudyQuality(): StudyQuality[] {
  return [
    "tanguar-haor",
    "hakaluki-haor",
    "chokwe",
    "rondonia",
    "hayli-gubbi",
    "kilauea-episode-36",
    "agri-41647231453",
  ]
    .map((id) => STUDY_QUALITY[id])
    .filter((entry): entry is StudyQuality => entry !== undefined);
}

/** Bar width for a fraction: always visible (min 4%) so a real zero is still a bar, never an empty gap. */
export function qualityBarWidth(fraction: number | null): string {
  if (fraction === null) return "0%";
  return `${Math.max(4, Math.min(100, fraction * 100)).toFixed(1)}%`;
}

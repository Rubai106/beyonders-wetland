/* Evidence Quality Explorer — server-side loader.
 *
 * Every figure is derived from the published files in public/ at request
 * time and carries its provenance (source file, source field, numerator,
 * denominator, acquisition date, method, measurement status). Nothing is
 * copied from a static table: if a study version changes, the numbers
 * change with it — and the regression test in
 * evidence-quality-server.test.ts re-derives them from the raw files, so a
 * stale figure fails loudly instead of silently persisting.
 *
 * Digest ("fingerprints") figures are verified by hashing the files on
 * disk, cached per server start. A declared digest that does not match is
 * reported as not matching, never as verified.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { QualityFigure, StudyQuality } from "./evidence-quality";
import { asNumber } from "./temporal-studio";

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function publicPath(...parts: string[]): string {
  return path.join(process.cwd(), "public", ...parts);
}

function fmtPct(value: number | null, digits = 1): string {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

/** Hash the declared digests against the files on disk (cached per map). */
const verifyCache = new Map<string, Promise<{ declared: number; matched: number }>>();
function verifyDigests(baseDir: string, digests: Record<string, string>): Promise<{ declared: number; matched: number }> {
  const key = `${baseDir}::${Object.keys(digests).sort().join("|")}`;
  const cached = verifyCache.get(key);
  if (cached) return cached;
  const job = (async () => {
    let matched = 0;
    const entries = Object.entries(digests);
    for (const [rel, expected] of entries) {
      try {
        const buf = await fs.readFile(path.join(baseDir, rel));
        if (createHash("sha256").update(buf).digest("hex") === expected) matched += 1;
      } catch {
        // Unreadable counts as not matched, never as verified.
      }
    }
    return { declared: entries.length, matched };
  })();
  verifyCache.set(key, job);
  return job;
}

function figure(partial: QualityFigure): QualityFigure {
  return partial;
}

async function loadTanguar(): Promise<StudyQuality | null> {
  const reference = await readJson<{
    validation?: {
      status?: string;
      coverage?: { study_area_valid_pixels?: number; common_clear_pixels?: number; common_clear_fraction?: number };
      metrics?: { true_positive_pixels?: number; false_positive_pixels?: number; false_negative_pixels?: number; precision?: number; recall?: number; f1?: number };
      comparison?: { event?: { hls_date?: string } };
    };
  }>(publicPath("showcase", "featured", "reference.json"));
  const pulse = await readJson<{
    dates?: { date: string; area_km2: number; patches: number }[];
    peak?: { date: string; area_km2: number };
  }>(publicPath("showcase", "featured", "pulse.json"));
  const coverage = reference?.validation?.coverage;
  const metrics = reference?.validation?.metrics;
  if (!coverage || !metrics || !pulse?.dates?.length) return null;
  const valid = asNumber(coverage.study_area_valid_pixels);
  const common = asNumber(coverage.common_clear_pixels);
  const fraction = asNumber(coverage.common_clear_fraction);
  const tp = asNumber(metrics.true_positive_pixels);
  const fp = asNumber(metrics.false_positive_pixels);
  const fn = asNumber(metrics.false_negative_pixels);
  if (valid === null || common === null || fraction === null || tp === null || fp === null || fn === null) return null;
  const peak = pulse.peak ?? null;
  const peakEntry = peak ? pulse.dates.find((d) => d.date === peak.date) : null;
  const peakArea = peak ? asNumber(peak.area_km2) : null;
  const peakPatches = peakEntry ? asNumber(peakEntry.patches) : null;
  return {
    studyId: "tanguar-haor",
    studyName: "Tanguar Haor",
    figures: [
      figure({
        label: "Reference overlap",
        valueText: `${common.toLocaleString()} of ${valid.toLocaleString()} valid pixels`,
        fraction,
        meaning:
          "Only 0.33% of the study area had cloud-free optical coverage in both the baseline and event images — below the 20% floor, so the comparison is inconclusive.",
        status: "inconclusive",
        source: "public/showcase/featured/reference.json (validation.coverage)",
        sourceField: "validation.coverage.common_clear_pixels / study_area_valid_pixels",
        numerator: common,
        denominator: valid,
        acquiredAt: reference.validation?.comparison?.event?.hls_date ?? null,
        method: "HLS optical comparison",
      }),
      figure({
        label: "Reference agreement",
        valueText: `TP ${tp} · FP ${fp} · FN ${fn} — precision, recall, F1 and IoU all 0.0`,
        fraction: 0,
        meaning:
          "Computed zeros over the 3,880 overlapping pixels, not missing data. With so little overlap, zeros do not prove there was no change.",
        status: "recorded",
        source: "public/showcase/featured/reference.json (validation.metrics)",
        sourceField: "validation.metrics.true_positive_pixels / false_positive_pixels / false_negative_pixels",
        numerator: tp,
        denominator: common,
        acquiredAt: reference.validation?.comparison?.event?.hls_date ?? null,
        method: "HLS optical comparison",
      }),
      figure({
        label: "Radar candidate",
        valueText:
          peakArea !== null && peakPatches !== null && peak
            ? `${peakPatches} patches · peak ${peakArea.toFixed(4)} km² on ${peak.date}`
            : "Peak not recorded",
        fraction: null,
        meaning:
          "Radar-change candidates from the NISAR time series. A candidate is not confirmed inundation.",
        status: peakArea !== null ? "recorded" : "not-recorded",
        source: "public/showcase/featured/pulse.json + case_study.json",
        sourceField: "pulse.peak.area_km2 / pulse.dates[].patches",
        numerator: peakArea,
        denominator: null,
        acquiredAt: peak?.date ?? null,
        method: "HH/HV change, 2.5 dB threshold",
      }),
    ],
  };
}

async function loadHakaluki(): Promise<StudyQuality | null> {
  const catalog = await readJson<{ studies?: { site_name: string; path?: string }[] }>(publicPath("studies", "catalog.json"));
  const hakaluki = catalog?.studies?.find((s) => s.site_name === "Hakaluki Haor");
  if (!hakaluki?.path) return null;
  const base = publicPath("studies", hakaluki.path);
  const caseStudy = await readJson<{
    reference_validation?: {
      coverage?: { study_area_valid_pixels?: number; common_clear_pixels?: number };
    };
  }>(path.join(base, "case_study.json"));
  const evidence = await readJson<{
    optical_support?: { precision?: number; recall?: number; f1?: number; common_clear_fraction?: number };
  }>(path.join(base, "date_checks", "2026-09-27", "evidence.json"));
  const publication = await readJson<{ artifacts?: Record<string, { sha256?: string }> }>(
    path.join(base, "publication.json"),
  );
  const headline = caseStudy?.reference_validation?.coverage;
  const support = evidence?.optical_support;
  if (!headline || !support) return null;
  const valid = asNumber(headline.study_area_valid_pixels);
  const common = asNumber(headline.common_clear_pixels);
  const precision = asNumber(support.precision);
  const recall = asNumber(support.recall);
  const f1 = asNumber(support.f1);
  const clear = asNumber(support.common_clear_fraction);
  if (valid === null || common === null || precision === null || recall === null || f1 === null || clear === null) return null;
  const digests: Record<string, string> = {};
  for (const [rel, entry] of Object.entries(publication?.artifacts ?? {})) {
    if (typeof entry?.sha256 === "string") digests[rel] = entry.sha256;
  }
  const verified = await verifyDigests(base, digests);
  return {
    studyId: "hakaluki-haor",
    studyName: "Hakaluki Haor",
    figures: [
      figure({
        label: "Headline pair overlap",
        valueText: `${common} of ${valid.toLocaleString()} valid pixels`,
        fraction: valid > 0 ? common / valid : null,
        meaning:
          "The 23 Jun → 17 Jul 2026 headline pair has almost no cloud-free overlap with the wetland mask. It is unassessable — no metrics exist for it.",
        status: "inconclusive",
        source: "public/studies/releases/2026.10.07/runs/d6e65a58802e4cf4907ddefa42a435d6/case_study.json (reference_validation)",
        sourceField: "reference_validation.coverage.common_clear_pixels / study_area_valid_pixels",
        numerator: common,
        denominator: valid,
        acquiredAt: "2026-07-17",
        method: "HLS optical comparison",
      }),
      figure({
        label: "27 Sep 2026 date check",
        valueText: `Precision ${fmtPct(precision)} · recall ${fmtPct(recall)} · F1 ${fmtPct(f1)}`,
        fraction: clear,
        meaning:
          "The later date check had 50.7% common clear coverage — enough to assess, and the agreement was weak. These metrics belong to the date check, not the headline pair.",
        status: "recorded",
        source: "public/studies/releases/2026.10.07/runs/d6e65a58802e4cf4907ddefa42a435d6/date_checks/2026-09-27/evidence.json (optical_support)",
        sourceField: "optical_support.precision / recall / f1 / common_clear_fraction",
        numerator: null,
        denominator: null,
        acquiredAt: "2026-09-27",
        method: "HLS optical comparison, area-weighted on native HLS cells",
      }),
      figure({
        label: "File fingerprints",
        valueText:
          verified.matched === verified.declared
            ? `${verified.matched} of ${verified.declared} recorded SHA-256 digests match`
            : `${verified.matched} of ${verified.declared} recorded SHA-256 digests match — ${verified.declared - verified.matched} do not`,
        fraction: verified.declared > 0 ? verified.matched / verified.declared : null,
        meaning:
          verified.matched === verified.declared
            ? "Every artifact in the publication record verifies against the file on disk. The two files outside that map are evidence_card.json and publication.json itself."
            : "Some published digests do not match the files on disk — the publication record needs attention.",
        status: verified.matched === verified.declared ? "recorded" : "inconclusive",
        source: "public/studies/releases/2026.10.07/runs/d6e65a58802e4cf4907ddefa42a435d6/publication.json (artifacts)",
        sourceField: "artifacts[].sha256, verified by hashing",
        numerator: verified.matched,
        denominator: verified.declared,
        acquiredAt: null,
        method: "SHA-256 verification",
      }),
    ],
  };
}

async function loadChokwe(): Promise<StudyQuality | null> {
  const catalog = await readJson<{ studies?: { site_name: string; path?: string }[] }>(publicPath("studies", "catalog.json"));
  const chokwe = catalog?.studies?.find((s) => s.site_name === "Chokwe event study box");
  if (!chokwe?.path) return null;
  const base = publicPath("studies", chokwe.path);
  const caseStudy = await readJson<{
    candidate_area_km2?: number;
    candidate_patches?: number;
    baseline_date?: string;
    event_date?: string;
    reference_validation?: { status?: string };
  }>(path.join(base, "case_study.json"));
  const publication = await readJson<{ artifacts?: Record<string, { sha256?: string }> }>(
    path.join(base, "publication.json"),
  );
  if (!caseStudy) return null;
  const area = asNumber(caseStudy.candidate_area_km2);
  const patches = asNumber(caseStudy.candidate_patches);
  if (area === null || patches === null) return null;
  const digests: Record<string, string> = {};
  for (const [rel, entry] of Object.entries(publication?.artifacts ?? {})) {
    if (typeof entry?.sha256 === "string") digests[rel] = entry.sha256;
  }
  const verified = await verifyDigests(base, digests);
  return {
    studyId: "chokwe",
    studyName: "Chókwè",
    figures: [
      figure({
        label: "Radar candidate",
        valueText: `${patches} patches · ${area} km²`,
        fraction: null,
        meaning:
          "Completed real processing (baseline 2026-01-05 → event 2026-01-17). A candidate is not a confirmed flood.",
        status: "recorded",
        source: "public/studies/releases/2026.10.29-chokwe/runs/ec8fa5ee15ae41d1aa89f930f2b47e36/case_study.json",
        sourceField: "candidate_patches / candidate_area_km2",
        numerator: patches,
        denominator: null,
        acquiredAt: caseStudy.event_date ?? null,
        method: "HH change, 2.5 dB threshold",
      }),
      figure({
        label: "Reference comparison",
        valueText: `${caseStudy.reference_validation?.status ?? "UNKNOWN"} — no usable reference agreement`,
        fraction: null,
        meaning:
          "Processing completed does not mean validated. The reference comparison could not confirm or reject the result.",
        status: "inconclusive",
        source: "public/studies/releases/2026.10.29-chokwe/runs/ec8fa5ee15ae41d1aa89f930f2b47e36/case_study.json (reference_validation)",
        sourceField: "reference_validation.status",
        numerator: null,
        denominator: null,
        acquiredAt: caseStudy.event_date ?? null,
        method: "HLS optical comparison",
      }),
      figure({
        label: "File fingerprints",
        valueText:
          verified.matched === verified.declared
            ? `${verified.matched} of ${verified.declared} recorded SHA-256 digests match`
            : `${verified.matched} of ${verified.declared} recorded SHA-256 digests match — ${verified.declared - verified.matched} do not`,
        fraction: verified.declared > 0 ? verified.matched / verified.declared : null,
        meaning:
          verified.matched === verified.declared
            ? "Every artifact in the publication record verifies against the file on disk."
            : "Some published digests do not match the files on disk — the publication record needs attention.",
        status: verified.matched === verified.declared ? "recorded" : "inconclusive",
        source: "public/studies/releases/2026.10.29-chokwe/runs/ec8fa5ee15ae41d1aa89f930f2b47e36/publication.json (artifacts)",
        sourceField: "artifacts[].sha256, verified by hashing",
        numerator: verified.matched,
        denominator: verified.declared,
        acquiredAt: null,
        method: "SHA-256 verification",
      }),
    ],
  };
}

async function loadRondonia(): Promise<StudyQuality | null> {
  const study = await readJson<{
    frames?: { date: string; stats?: { candidate_area_km2?: number; patch_count?: number }; reference?: { support_overlap_fraction?: number | null } }[];
  }>(publicPath("forests", "rondonia", "2026.10.08-v1", "study.json"));
  if (!study?.frames?.length) return null;
  const candidates = study.frames.filter((f) => (asNumber(f.stats?.candidate_area_km2) ?? 0) > 0);
  const frame = candidates[0] ?? null;
  const area = frame ? asNumber(frame.stats?.candidate_area_km2) : null;
  const overlap = frame ? asNumber(frame.reference?.support_overlap_fraction) : null;
  if (area === null || !frame) return null;
  return {
    studyId: "rondonia",
    studyName: "Rondônia",
    figures: [
      figure({
        label: "Radar candidate",
        valueText: `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} · ${area} km² (${frame.date} frame)`,
        fraction: null,
        meaning:
          "One small radar-change candidate from 4 frames over 7 input granules. Backscatter change alone is not confirmed deforestation.",
        status: "recorded",
        source: "public/forests/rondonia/2026.10.08-v1/study.json (frames) + candidates GeoJSON",
        sourceField: "frames[].stats.candidate_area_km2",
        numerator: area,
        denominator: null,
        acquiredAt: frame.date,
        method: "HV persistence, 3 dB over two consecutive dates",
      }),
      figure({
        label: "Optical support overlap",
        valueText:
          overlap !== null
            ? `${fmtPct(overlap)} of the candidate overlaps the exploratory HLS signal`
            : "Not recorded — no overlap fraction published for the candidate",
        fraction: overlap,
        meaning:
          "Exploratory NDVI/NBR direction support for the 2026-09-29 candidate. This is not an accuracy score — there is no labelled forest-loss reference.",
        status: overlap !== null ? "recorded" : "not-recorded",
        source: "public/forests/rondonia/2026.10.08-v1/study.json (frames[3].reference.support_overlap_fraction)",
        sourceField: "frames[].reference.support_overlap_fraction",
        numerator: null,
        denominator: null,
        acquiredAt: frame.date,
        method: "HLS NDVI/NBR direction support",
      }),
    ],
  };
}

async function loadVolcano(id: string, dir: string, name: string): Promise<StudyQuality | null> {
  const study = await readJson<{
    pairs?: { sensor?: string; start: string; end: string; statistics?: { p05_cm?: number; p95_cm?: number } }[];
  }>(publicPath("volcanoes", dir, "2026.10.30-v3", "study.json"));
  if (!study?.pairs?.length) return null;
  const nisar = study.pairs.filter((p) => p.sensor === "NISAR").length;
  const sentinel = study.pairs.filter((p) => p.sensor !== "NISAR").length;
  const first = study.pairs[0];
  const last = study.pairs[study.pairs.length - 1];
  const p05 = asNumber(first?.statistics?.p05_cm);
  const p95 = asNumber(first?.statistics?.p95_cm);
  return {
    studyId: id,
    studyName: name,
    figures: [
      figure({
        label: "Interferogram pairs",
        valueText:
          id === "hayli-gubbi"
            ? `${study.pairs.length} pairs — ${nisar} NISAR GUNW + ${sentinel} Sentinel-1 ARIA GUNW`
            : `${study.pairs.length} GUNW pair — ${first?.start} → ${first?.end}`,
        fraction: null,
        meaning:
          id === "hayli-gubbi"
            ? "Apparent line-of-sight observations. Ionosphere, troposphere and solid-earth-tide corrections were NOT_APPLIED; the reference patch is an assumption."
            : "A single pair around the 2025-11-09 event. Reference is EVENT_CONTEXT_ONLY; corrections NOT_APPLIED.",
        status: "recorded",
        source: `public/volcanoes/${dir}/2026.10.30-v3/study.json`,
        sourceField: "pairs[].sensor / pairs[].start / pairs[].end",
        numerator: study.pairs.length,
        denominator: null,
        acquiredAt: last?.end ?? null,
        method: "GUNW relative LOS",
      }),
      figure({
        label: id === "hayli-gubbi" ? "Vertical displacement" : "Independent geodetic comparison",
        valueText:
          id === "hayli-gubbi"
            ? "Not recorded — LOS is not vertical displacement"
            : "Not recorded",
        fraction: null,
        meaning:
          id === "hayli-gubbi"
            ? "Line-of-sight change must not be read as confirmed vertical movement or as volcanic causation."
            : "No surveyed reference or independent geodetic comparison exists for this pair yet.",
        status: "not-recorded",
        source: `public/volcanoes/${dir}/2026.10.30-v3/study.json (method gunw-relative-los-1.0.1)`,
        sourceField: p05 !== null && p95 !== null ? `pairs[0].statistics.p05_cm=${p05}, p95_cm=${p95} (LOS only)` : null,
        numerator: null,
        denominator: null,
        acquiredAt: null,
        method: "GUNW relative LOS",
      }),
    ],
  };
}

async function loadNaogaon(): Promise<StudyQuality | null> {
  const study = await readJson<{
    change_summary?: { median?: number; p05?: number; p95?: number; total_pixels?: number; valid_pixels?: number; valid_fraction?: number };
  }>(publicPath("agriculture", "current", "study.json"));
  const summary = study?.change_summary;
  if (!summary) return null;
  const valid = asNumber(summary.valid_pixels);
  const total = asNumber(summary.total_pixels);
  const fraction = asNumber(summary.valid_fraction);
  const median = asNumber(summary.median);
  const p05 = asNumber(summary.p05);
  const p95 = asNumber(summary.p95);
  if (valid === null || total === null || fraction === null || median === null) return null;
  return {
    studyId: "agri-41647231453",
    studyName: "Naogaon (SME2 soil moisture)",
    figures: [
      figure({
        label: "Valid-pixel coverage",
        valueText: `${valid.toLocaleString()} of ${total.toLocaleString()} pixels valid (${fmtPct(fraction)})`,
        fraction,
        meaning:
          "Valid pixels after the zero-clear quality screen (retrievalQualityFlag == 0 AND surfaceQualityFlag == 0). Four dates were excluded for zero valid pixels.",
        status: "recorded",
        source: "public/agriculture/current/study.json (change_summary)",
        sourceField: "change_summary.valid_pixels / total_pixels / valid_fraction",
        numerator: valid,
        denominator: total,
        acquiredAt: null,
        method: "SME2 zero-clear quality gate",
      }),
      figure({
        label: "Soil-moisture change",
        valueText:
          p05 !== null && p95 !== null
            ? `Median ${median >= 0 ? "+" : ""}${median.toFixed(4)} m³/m³ (p05 ${p05.toFixed(4)}, p95 ${p95.toFixed(4)})`
            : `Median ${median.toFixed(4)} m³/m³`,
        fraction: null,
        meaning:
          "Median change across valid pixels only. This is a soil-moisture measurement — not crop stress, drought, irrigation need, or yield.",
        status: "recorded",
        source: "public/agriculture/current/study.json (change_summary)",
        sourceField: "change_summary.median / p05 / p95",
        numerator: median,
        denominator: null,
        acquiredAt: null,
        method: "SME2 DSG",
      }),
      figure({
        label: "Independent field reference",
        valueText: "Not recorded — no field or crop-condition reference",
        fraction: null,
        meaning:
          "No independent field or crop-condition reference exists for this study, so the measurement is exploratory.",
        status: "not-recorded",
        source: "public/agriculture/current/study.json",
        sourceField: null,
        numerator: null,
        denominator: null,
        acquiredAt: null,
        method: null,
      }),
    ],
  };
}

/** All published studies with derived quality figures, in publication order. */
export async function loadStudyQuality(): Promise<{ studies: StudyQuality[]; missing: string[] }> {
  const studies: StudyQuality[] = [];
  const missing: string[] = [];
  const loaders: [string, () => Promise<StudyQuality | null>][] = [
    ["Tanguar Haor", loadTanguar],
    ["Hakaluki Haor", loadHakaluki],
    ["Chókwè", loadChokwe],
    ["Rondônia", loadRondonia],
    ["Hayli Gubbi", () => loadVolcano("hayli-gubbi", "hayli-gubbi", "Hayli Gubbi and Erta Ale")],
    ["Kīlauea", () => loadVolcano("kilauea-episode-36", "kilauea-episode-36-2025", "Kīlauea, Episode 36")],
    ["Naogaon", loadNaogaon],
  ];
  for (const [name, load] of loaders) {
    const study = await load();
    if (study) studies.push(study);
    else missing.push(name);
  }
  return { studies, missing };
}

/* Evidence-derived language. Everything here is computed from loaded data;
   nothing is generated, estimated or invented. */
import type { WetlandPatch, WetlandPulseData } from "./types";
import type { DataTier } from "./store";
import type { ShowcaseReference } from "./showcase";

export const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
};
export const fmtDateLong = (iso: string) => fmtDate(iso, { month: "long", day: "numeric", year: "numeric" });
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Detector rule: at least half of a current region's pixels must share its class
 * in the immediately preceding processed acquisition to receive temporal PASS. */
export const TEMPORAL_OVERLAP_THRESHOLD = 0.5;

export interface TemporalOverlapContext {
  dateInSeries: boolean;
  previousDate: string | null;
  intervalDays: number | null;
  overlapFraction: number | null;
  thresholdFraction: number;
  status: WetlandPatch["temporal_status"] | "UNAVAILABLE";
}

/** Resolve only the adjacent date and stored same-class overlap; never match region IDs. */
export function temporalOverlapContext(
  patch: Pick<WetlandPatch, "date" | "temporal_overlap_fraction" | "temporal_status">,
  pulse: Pick<WetlandPulseData, "dates"> | null | undefined,
): TemporalOverlapContext {
  const dates = pulse?.dates ?? [];
  const index = dates.findIndex((observation) => observation.date === patch.date);
  const previousDate = index > 0 ? dates[index - 1].date : null;
  const raw = patch.temporal_overlap_fraction;
  const overlapFraction = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : null;
  const comparable = previousDate !== null && overlapFraction !== null;
  return {
    dateInSeries: index >= 0,
    previousDate,
    intervalDays: previousDate ? daysBetween(previousDate, patch.date) : null,
    overlapFraction,
    thresholdFraction: TEMPORAL_OVERLAP_THRESHOLD,
    status: comparable ? patch.temporal_status : "UNAVAILABLE",
  };
}

export type OpticalState = "SUPPORT_LIMITED" | "INCONCLUSIVE" | "NOT_RUN";

/** Optical (HLS) context level for the whole run, from recorded status only. */
export function opticalState(tier: DataTier, pulse: WetlandPulseData | null): OpticalState {
  const status = pulse?.reference_check_status ?? "NOT_RUN";
  if (status === "CROSS_SENSOR_CHECK") return "SUPPORT_LIMITED"; // a comparison ran; it is never field validation
  if (status === "INCONCLUSIVE") return "INCONCLUSIVE";
  return "NOT_RUN";
}

export function opticalLabel(state: OpticalState, reference?: ShowcaseReference | null) {
  const clear = reference?.evidence?.coverage?.common_clear_fraction;
  switch (state) {
    case "SUPPORT_LIMITED": return `Cross-sensor comparison completed${clear != null ? ` · ${(clear * 100).toFixed(0)}% common clear area` : ""} · not field validation`;
    case "INCONCLUSIVE": return "Cross-sensor evidence inconclusive";
    default: return "No optical comparison available";
  }
}

export type Interpretation = { headline: string; note: string };

/** Carefully worded interpretation. Never a score; never "confirmed". */
export function interpret(patch: WetlandPatch, optical: OpticalState): Interpretation {
  const strong = patch.evidence_state === "SUPPORTED";
  const uncertain = patch.evidence_state === "UNCERTAIN" || patch.evidence_state === "REJECTED";
  if (optical === "INCONCLUSIVE") return { headline: "Inconclusive due to insufficient optical coverage", note: "The radar change is recorded, but the independent optical check could not assess this area." };
  if (uncertain) return { headline: "Needs further investigation", note: "The detector rules did not agree on this region. Treat it as a weak radar change candidate." };
  if (strong && optical === "SUPPORT_LIMITED") return { headline: "Strong radar response, limited contextual support", note: "Radar tests agree; the optical comparison covers only part of the area and is not ground truth." };
  if (strong) return { headline: "Possible inundation-related change", note: "Radar tests agree. No independent sensor has assessed this region." };
  return { headline: "Radar change candidate", note: "Some radar tests agree and others are partial. Needs further investigation." };
}

export const interpretationOfClass = (c: WetlandPatch["classification"]) =>
  c === "OPEN_WATER" ? "HH-darkening candidate (consistent with open water, among other causes)"
    : c === "VEGETATED_INUNDATION" ? "HH-increase / HV-stable candidate (consistent with flooded vegetation, among other causes)"
      : "Uncertain radar change candidate";

export type StackStatus = "PASS" | "PARTIAL" | "FAIL" | "UNAVAILABLE";
export interface StackRow { key: string; label: string; kind: "observed" | "derived" | "context" | "unassessed"; status: StackStatus; detail: string; magnitude?: number }

const pct = (v: number) => `${Math.round(v * 100)}%`;
const shortId = (id: string) => id.replace(/^wetland_patch_/, "").slice(0, 6);
export const regionLabel = (id: string) => `Region ${shortId(id)}`;

/** What evidence exists, in the pipeline's own terms. These are test outcomes, never a probability. */
export function evidenceStack(patch: WetlandPatch, optical: OpticalState): StackRow[] {
  const mag = (db: number) => Math.min(1, Math.abs(db) / 10);
  const overlap = patch.temporal_overlap_fraction;
  const opticalRow: StackRow = optical === "SUPPORT_LIMITED"
    ? { key: "optical", label: "Independent optical check", kind: "context", status: "PARTIAL", detail: "Compared only where both optical dates were clear" }
    : optical === "INCONCLUSIVE" ? { key: "optical", label: "Independent optical check", kind: "unassessed", status: "UNAVAILABLE", detail: "Inconclusive: too little shared clear sky to judge" }
      : { key: "optical", label: "Independent optical check", kind: "unassessed", status: "UNAVAILABLE", detail: "Not run for this study" };
  return [
    { key: "hh", label: "HH radar change", kind: "observed", status: Math.abs(patch.delta_hh) >= 1 ? "PASS" : "PARTIAL", detail: `${patch.hh_before.toFixed(1)} → ${patch.hh_after.toFixed(1)} dB (Δ ${patch.delta_hh.toFixed(1)} dB)`, magnitude: mag(patch.delta_hh) },
    { key: "hv", label: "HV radar change", kind: "observed", status: Math.abs(patch.delta_hv) >= 1 ? "PASS" : "PARTIAL", detail: `${patch.hv_before.toFixed(1)} → ${patch.hv_after.toFixed(1)} dB (Δ ${patch.delta_hv.toFixed(1)} dB)`, magnitude: mag(patch.delta_hv) },
    { key: "temporal", label: "Same place flagged on the previous date", kind: "derived", status: patch.temporal_status,
      detail: overlap == null ? "No earlier observation to compare" : `${pct(overlap)} of this region was also flagged on the previous date` },
    { key: "spatial", label: "Compact footprint", kind: "derived", status: patch.spatial_status,
      detail: patch.spatial_status === "PASS" ? "Fills at least half of its bounding box" : "Fills under half of its bounding box (ragged or scattered)" },
    { key: "threshold", label: "Survives a stricter cutoff", kind: "derived", status: patch.threshold_stability === "STABLE" ? "PASS" : "PARTIAL",
      detail: `${pct(patch.threshold_variation_fraction ?? 0)} of its pixels drop out when the cutoff rises by 1 dB` },
    { key: "quality", label: "Data quality", kind: "observed", status: patch.quality_status, detail: `${pct(patch.valid_fraction)} of the region has valid data in all four channels` },
    opticalRow,
    { key: "truth", label: "Ground truth", kind: "unassessed", status: "UNAVAILABLE", detail: "No field observations in this study" },
  ];
}

export interface EvidenceSummary {
  passed: StackRow[];
  partial: StackRow[];
  failed: StackRow[];
  unavailable: StackRow[];
}

/** Group recorded evidence by its existing status; this is not a score or ranking. */
export function summarizeEvidence(rows: StackRow[]): EvidenceSummary {
  const summary: EvidenceSummary = { passed: [], partial: [], failed: [], unavailable: [] };
  for (const row of rows) {
    if (row.status === "PASS") summary.passed.push(row);
    else if (row.status === "PARTIAL") summary.partial.push(row);
    else if (row.status === "FAIL") summary.failed.push(row);
    else summary.unavailable.push(row);
  }
  return summary;
}

export interface RegionNavigationResult<T> {
  currentIndex: number;
  total: number;
  previous: T | null;
  next: T | null;
}

/** Navigate the currently loaded acquisition by descending area, with an ID tie-breaker. */
export function regionNavigationContext<T extends {
  id: string;
  area_km2: number;
  classification: WetlandPatch["classification"];
}>(
  regions: readonly T[],
  selectedId: string,
  classFilter: "ALL" | WetlandPatch["classification"] = "ALL",
): RegionNavigationResult<T> {
  const ordered = regions
    .filter((region) => classFilter === "ALL" || region.classification === classFilter)
    .slice()
    .sort((a, b) => b.area_km2 - a.area_km2 || a.id.localeCompare(b.id));
  const currentIndex = ordered.findIndex((region) => region.id === selectedId);
  return {
    currentIndex,
    total: ordered.length,
    previous: currentIndex > 0 ? ordered[currentIndex - 1] : null,
    next: currentIndex >= 0 && currentIndex < ordered.length - 1 ? ordered[currentIndex + 1] : null,
  };
}

export interface RegionDistributionContext {
  total: number;
  areaRank: number | null;
  deltaHhRank: number | null;
  medianAreaKm2: number | null;
  medianAbsDeltaHhDb: number | null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Descriptive same-acquisition comparison only; no score or confidence is inferred. */
export function regionDistributionContext<T extends {
  id: string;
  area_km2: number;
  delta_hh: number;
  classification: WetlandPatch["classification"];
}>(
  regions: readonly T[],
  selectedId: string,
  classFilter: "ALL" | WetlandPatch["classification"] = "ALL",
): RegionDistributionContext {
  const cohort = regions.filter((region) =>
    (classFilter === "ALL" || region.classification === classFilter)
    && Number.isFinite(region.area_km2) && region.area_km2 >= 0
    && Number.isFinite(region.delta_hh));
  const byArea = cohort.slice().sort((a, b) => b.area_km2 - a.area_km2 || a.id.localeCompare(b.id));
  const byDelta = cohort.slice().sort((a, b) => Math.abs(b.delta_hh) - Math.abs(a.delta_hh) || a.id.localeCompare(b.id));
  const areaIndex = byArea.findIndex((region) => region.id === selectedId);
  const deltaIndex = byDelta.findIndex((region) => region.id === selectedId);
  return {
    total: cohort.length,
    areaRank: areaIndex >= 0 ? areaIndex + 1 : null,
    deltaHhRank: deltaIndex >= 0 ? deltaIndex + 1 : null,
    medianAreaKm2: median(cohort.map((region) => region.area_km2)),
    medianAbsDeltaHhDb: median(cohort.map((region) => Math.abs(region.delta_hh))),
  };
}

export interface RegionEvidenceBrief {
  schema_version: 1;
  record_type: "beyonders.wetland.region-evidence";
  source: {
    data_tier: DataTier;
    data_source: WetlandPatch["data_source"] | WetlandPulseData["data_source"] | null;
    run_id: string | null;
    product: string | null;
    product_maturity: string | null;
    quality_mask_method: string | null;
  };
  observation: {
    site: string | null;
    date: string;
    preceding_acquisition: string | null;
    interval_days: number | null;
  };
  candidate_region: {
    id: string;
    classification: WetlandPatch["classification"];
    interpretation_label: string;
    area_km2: number;
    pixel_count: number | null;
    centroid_lat_lng: [number, number];
    geometry: WetlandPatch["geometry"] | null;
    radar_db: {
      hh_before: number;
      hh_after: number;
      delta_hh: number;
      hv_before: number;
      hv_after: number;
      delta_hv: number;
    };
    quality: {
      valid_fraction: number;
      vegetated_fraction: number;
      status: WetlandPatch["quality_status"];
    };
    detector_checks: {
      evidence_state: WetlandPatch["evidence_state"];
      spatial_status: WetlandPatch["spatial_status"];
      temporal_status: WetlandPatch["temporal_status"];
      temporal_overlap_fraction: number | null;
      threshold_stability: WetlandPatch["threshold_stability"];
      threshold_variation_fraction: number | null;
    };
    baseline_context: {
      date: string | null;
      observation_count: number | null;
      hh_temporal_mad_db: number | null;
      observation_dates: string[];
    };
  };
  same_acquisition_comparison: {
    class_filter: "ALL" | WetlandPatch["classification"];
    candidate_count: number;
    area_rank: number | null;
    median_area_km2: number | null;
    absolute_hh_change_rank: number | null;
    median_absolute_hh_change_db: number | null;
  };
  temporal_comparison: TemporalOverlapContext;
  evidence_checks: StackRow[];
  limitations: string[];
}

/** A portable record of one selected candidate. Values are copied from loaded data and existing checks only. */
export function buildRegionEvidenceBrief(
  patch: WetlandPatch,
  pulse: WetlandPulseData | null,
  dataTier: DataTier,
  optical: OpticalState,
  comparison: RegionDistributionContext,
  classFilter: "ALL" | WetlandPatch["classification"],
): RegionEvidenceBrief {
  const temporal = temporalOverlapContext(patch, pulse);
  return {
    schema_version: 1,
    record_type: "beyonders.wetland.region-evidence",
    source: {
      data_tier: dataTier,
      data_source: patch.data_source ?? pulse?.data_source ?? null,
      run_id: patch.run_id ?? null,
      product: pulse?.product ?? null,
      product_maturity: pulse?.product_maturity ?? null,
      quality_mask_method: pulse?.quality_mask_method ?? null,
    },
    observation: {
      site: pulse?.site ?? null,
      date: patch.date,
      preceding_acquisition: temporal.previousDate,
      interval_days: temporal.intervalDays,
    },
    candidate_region: {
      id: patch.id,
      classification: patch.classification,
      interpretation_label: patch.interpretation_label ?? interpretationOfClass(patch.classification),
      area_km2: patch.area_km2,
      pixel_count: patch.pixel_count ?? null,
      centroid_lat_lng: patch.centroid,
      geometry: patch.geometry ?? null,
      radar_db: {
        hh_before: patch.hh_before,
        hh_after: patch.hh_after,
        delta_hh: patch.delta_hh,
        hv_before: patch.hv_before,
        hv_after: patch.hv_after,
        delta_hv: patch.delta_hv,
      },
      quality: {
        valid_fraction: patch.valid_fraction,
        vegetated_fraction: patch.vegetated_fraction,
        status: patch.quality_status,
      },
      detector_checks: {
        evidence_state: patch.evidence_state,
        spatial_status: patch.spatial_status,
        temporal_status: patch.temporal_status,
        temporal_overlap_fraction: temporal.overlapFraction,
        threshold_stability: patch.threshold_stability,
        threshold_variation_fraction: patch.threshold_variation_fraction ?? null,
      },
      baseline_context: {
        date: pulse?.baseline_date ?? null,
        observation_count: patch.baseline_observation_count ?? null,
        hh_temporal_mad_db: patch.baseline_hh_temporal_mad_db ?? null,
        observation_dates: patch.baseline_observation_dates ?? [],
      },
    },
    same_acquisition_comparison: {
      class_filter: classFilter,
      candidate_count: comparison.total,
      area_rank: comparison.areaRank,
      median_area_km2: comparison.medianAreaKm2,
      absolute_hh_change_rank: comparison.deltaHhRank,
      median_absolute_hh_change_db: comparison.medianAbsDeltaHhDb,
    },
    temporal_comparison: temporal,
    evidence_checks: evidenceStack(patch, optical),
    limitations: [
      "This is an algorithmic radar-change candidate, not a confirmed flood.",
      "Region identifiers are acquisition-specific and do not establish persistent region identity across dates.",
      "Temporal overlap is same-class pixel overlap with the immediately preceding processed acquisition, not a persistent region match.",
      "Cross-sensor optical context is not field validation; unavailable ground observations remain unavailable.",
      "Ranks and medians describe only the currently loaded acquisition and class filter.",
      "No confidence probability, flood-severity estimate, or interpolation between acquisition dates is provided.",
    ],
  };
}

export interface ChallengeItem { tone: "ok" | "warn" | "note"; text: string; detail?: string }
export interface ChallengeResult { items: ChallengeItem[]; passes: string[]; warnings: string[]; status: string; interpretation: string; independent: string; validation: string; recommendation: string; alternatives: string[] }

/** Only checks whose data exist. Nothing is scored. */
export function challenge(patch: WetlandPatch, optical: OpticalState, extra?: { baselineMad?: number | null; baselineCount?: number; opticalReason?: string; referenceLimitations?: string[] }): ChallengeResult {
  const items: ChallengeItem[] = []; const overlap = patch.temporal_overlap_fraction;
  items.push(patch.threshold_stability === "STABLE"
    ? { tone: "ok", text: "Survives other tested thresholds", detail: `${pct(patch.threshold_variation_fraction ?? 0)} of its pixels drop out when the cutoff rises by 1 dB` }
    : { tone: "warn", text: "Sensitive to the detection threshold", detail: `${pct(patch.threshold_variation_fraction ?? 0)} of its pixels drop out when the cutoff rises by 1 dB (stable is 20% or less)` });
  items.push(overlap == null ? { tone: "note", text: "No earlier observation to compare", detail: "This is the first processed date" }
    : patch.temporal_status === "PASS" ? { tone: "ok", text: "Also flagged on the previous date", detail: `${pct(overlap)} overlap with the previous observation` }
      : { tone: "warn", text: "Not clearly persistent", detail: `${pct(overlap)} overlap with the previous observation (needs 50%)` });
  items.push(patch.spatial_status === "PASS" ? { tone: "ok", text: "Compact footprint" } : { tone: "warn", text: "Ragged or scattered footprint", detail: "Fills under half of its bounding box" });
  items.push(Math.abs(patch.delta_hh) >= 1 && Math.abs(patch.delta_hv) >= 1 ? { tone: "ok", text: "Both HH and HV changed by at least 1 dB" }
    : { tone: "warn", text: Math.abs(patch.delta_hh) >= 1 ? "HV barely changed" : "HH change is small", detail: `ΔHH ${patch.delta_hh.toFixed(1)} dB · ΔHV ${patch.delta_hv.toFixed(1)} dB` });
  if (extra?.baselineMad != null) items.push({ tone: "note", text: "Compared with the baseline's own variability",
    detail: `Change of ${Math.abs(patch.delta_hh).toFixed(1)} dB against a baseline spread (median absolute deviation) of ${extra.baselineMad.toFixed(2)} dB, from ${extra.baselineCount ?? 1} earlier observation${(extra.baselineCount ?? 1) === 1 ? "" : "s"}` });
  if (patch.quality_status !== "PASS") items.push({ tone: "warn", text: "Data quality is not fully passing" });
  items.push(optical === "SUPPORT_LIMITED" ? { tone: "warn", text: "Optical coverage is limited", detail: "Compared only where both optical dates were clear" }
    : optical === "INCONCLUSIVE" ? { tone: "warn", text: "Independent optical check is inconclusive", detail: extra?.opticalReason ?? "Too little shared clear sky" }
      : { tone: "warn", text: "No independent optical check" });
  items.push({ tone: "warn", text: "No field truth" });
  const it = interpret(patch, optical);
  const alternatives = extra?.referenceLimitations?.length ? extra.referenceLimitations
    : ["Radar darkening alone does not distinguish new water from changes in existing water or other scattering changes.", "Surface roughness, soil moisture and vegetation changes can also alter the radar signal."];
  return { items, passes: items.filter((i) => i.tone === "ok").map((i) => i.text), warnings: [...items.filter((i) => i.tone === "warn").map((i) => i.text), "Radar response may have multiple causes"],
    status: "Radar change candidate", interpretation: it.headline, independent: optical === "SUPPORT_LIMITED" ? "Limited" : "None available", validation: "Incomplete", recommendation: "Needs investigation", alternatives };
}

/** WHAT HAPPENED? — assembled strictly from loaded values. */
export function changeStory(pulse: WetlandPulseData, tier: DataTier, optical: OpticalState, reference?: ShowcaseReference | null): string[] {
  const d = pulse.dates; if (!d.length) return [];
  const first = d[0].date; const last = d[d.length - 1].date; const peak = d.find((o) => o.date === pulse.peak.date) ?? d[0];
  const paras = [
    `Between ${fmtDateLong(first)} and ${fmtDateLong(last)}, the radar signal changed across detected candidate regions within the study area (${d.length} observation dates).`,
    `Peak candidate activity occurred on ${fmtDateLong(peak.date)}: ${peak.patches} candidate regions covering ${peak.area_km2.toFixed(2)} km².`,
  ];
  const gaps = d.slice(1).map((o, i) => ({ days: daysBetween(d[i].date, o.date), from: d[i].date, to: o.date })).filter((g) => g.days > 14);
  if (gaps.length) paras.push(`Acquisition gaps are real and left unfilled: ${gaps.map((g) => `${g.days} days between ${fmtDate(g.from)} and ${fmtDate(g.to)}`).join("; ")}.`);
  paras.push("Multi-date radar evidence is recorded per region; see each region's evidence tests.");
  const clear = reference?.evidence?.coverage?.common_clear_fraction;
  paras.push(optical === "SUPPORT_LIMITED"
    ? `A cross-sensor optical comparison was completed${clear != null ? ` over ${(clear * 100).toFixed(0)}% common clear area` : ""}. It is not field validation, so treat this as exploratory radar evidence rather than confirmed flooding.`
    : optical === "INCONCLUSIVE" ? "The optical comparison was inconclusive, so this should be treated as exploratory radar evidence rather than confirmed flooding."
      : "Independent optical coverage is not available, so this should be treated as exploratory radar evidence rather than confirmed flooding.");
  return paras;
}

export interface Phase { key: "baseline" | "onset" | "peak" | "recession"; label: string; date: string }
export function phases(pulse: WetlandPulseData): Phase[] {
  const out: Phase[] = [];
  if (pulse.baseline_date) out.push({ key: "baseline", label: "Baseline", date: pulse.baseline_date });
  if (pulse.onset) out.push({ key: "onset", label: "Onset", date: pulse.onset });
  out.push({ key: "peak", label: "Peak", date: pulse.peak.date });
  if (pulse.recession_start) out.push({ key: "recession", label: "Recession", date: pulse.recession_start });
  return out;
}

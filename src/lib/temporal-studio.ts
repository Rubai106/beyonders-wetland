/* Temporal Studio — one evidence-synced timeline per published study.
   Every date, metric, and reference outcome comes from the published files
   in public/ (the same sources as observation-health.ts). A study that is
   missing from disk is reported as missing, never invented.

   This module is client-safe: it contains only types and pure helpers.
   The file readers live in temporal-studio-server.ts, which server
   components import instead. */

export type TemporalDomain = "wetland" | "forest" | "volcano" | "agriculture";

export interface TemporalEntry {
  /** Calendar date of the observation (for intervals, the second acquisition). */
  date: string;
  /** Interval label for volcano pairs, e.g. "10 Nov → 22 Nov 2025". */
  intervalLabel?: string;
  /** The headline metric for this date. Null when no metric was published. */
  metricValue: number | null;
  /** e.g. "24.48 km²" or "0.360 m³/m³" — computed, never hand-written. */
  metricLabel: string;
  /** Secondary real figure, e.g. "295 patches · mean Δ −5.36 dB". */
  secondary?: string;
  /** Candidate/region count for this date, when published. */
  patches?: number;
  /** What the independent reference said about this date, when known. */
  reference?: string;
  /** Published image for this date (relative public URL), when available. */
  image?: string;
}

export interface TemporalOpticalDate {
  date: string;
  label: string;
}

export interface TemporalStudy {
  id: string;
  name: string;
  domain: TemporalDomain;
  href: string;
  /** Headline metric name, e.g. "Radar-change candidate area". */
  metricName: string;
  metricUnit: string;
  /** The documented screening rule, in one sentence. */
  screeningRule: string;
  /** What the independent reference concluded overall. */
  referenceNote: string;
  /** INCONCLUSIVE | EXPLORATORY | CROSS_SENSOR_CHECK | NONE */
  referenceStatus: string;
  entries: TemporalEntry[];
  opticalDates: TemporalOpticalDate[];
  /** Dates excluded before publication (e.g. zero valid pixels). */
  excludedNote?: string;
  missing?: string;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Sum of per-patch area_km2 in a patches GeoJSON FeatureCollection. */
export function sumPatchAreas(collection: unknown): { areaKm2: number; count: number } {
  if (!isRecord(collection) || !Array.isArray(collection.features)) return { areaKm2: 0, count: 0 };
  let areaKm2 = 0;
  let count = 0;
  for (const f of collection.features) {
    if (!isRecord(f) || !isRecord(f.properties)) continue;
    const a = asNumber(f.properties.area_km2);
    if (a !== null) areaKm2 += a;
    count += 1;
  }
  return { areaKm2, count };
}

/** Entry with the largest metric value (null metrics never win). */
export function peakEntry(entries: readonly TemporalEntry[]): TemporalEntry | null {
  let best: TemporalEntry | null = null;
  for (const e of entries) {
    if (e.metricValue === null) continue;
    if (best === null || e.metricValue > (best.metricValue ?? -Infinity)) best = e;
  }
  return best;
}

/** Calendar position of each entry on a 0..1 track (single-date studies sit at 0.5). */
export function timelinePositions(entries: readonly TemporalEntry[]): number[] {
  if (entries.length === 0) return [];
  const times = entries.map((e) => new Date(`${e.date}T00:00:00Z`).getTime());
  const min = Math.min(...times);
  const max = Math.max(...times);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return entries.map(() => 0.5);
  }
  return times.map((t) => (t - min) / (max - min));
}

/** Human metric, e.g. 24.4765 -> "24.48 km²", 0.3604 -> "0.3604 m³/m³". */
export function formatMetric(value: number | null, unit: string): string {
  if (value === null) return "Not published";
  if (value === 0) return `0 ${unit}`.trim();
  const rounded = Number(value.toPrecision(4));
  return `${rounded} ${unit}`.trim();
}

/** Parse an HLS scene name (HLS.S30.T46RBN.2026195T042701.v2.0) to an ISO date. */
export function hlsSceneDate(scene: string): string | null {
  const m = scene.match(/HLS\.[SL]30\.[A-Z0-9]+\.(\d{4})(\d{3})T\d{6}\.v/i);
  if (!m) return null;
  const year = Number(m[1]);
  const doy = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(doy) || doy < 1 || doy > 366) return null;
  const d = new Date(Date.UTC(year, 0, doy));
  if (d.getUTCFullYear() !== year) return null;
  return d.toISOString().slice(0, 10);
}

/** Unique sorted ISO dates from HLS scene names. */
export function hlsAttemptDates(attempts: unknown): string[] {
  const dates = new Set<string>();
  if (!Array.isArray(attempts)) return [];
  for (const a of attempts) {
    if (!isRecord(a)) continue;
    for (const key of ["baseline_scene", "event_scene"]) {
      const scene = asString(a[key]);
      if (!scene) continue;
      const date = hlsSceneDate(scene);
      if (date) dates.add(date);
    }
  }
  return [...dates].sort();
}


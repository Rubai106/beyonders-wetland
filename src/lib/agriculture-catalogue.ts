import { createHash } from "node:crypto";

export interface AgricultureCMRGranule {
  id?: string;
  title?: string;
  time_start?: string;
  updated?: string;
  [key: string]: unknown;
}

export interface AgricultureSME2Signature {
  release: string;
  track: string;
  direction: string;
  frame: string;
  bandwidth: string;
  polarization: string;
  frequency: string;
}

export interface AgricultureSME2SeriesGranule {
  date: string;
  concept_id: string;
  title: string;
  updated: string | null;
}

export interface AgricultureSME2Series {
  series_id: string;
  signature: AgricultureSME2Signature;
  observation_count: number;
  dates: string[];
  span_days: number;
  median_revisit_days: number | null;
  maximum_gap_days: number | null;
  meets_preflight_gate: boolean;
  granules: AgricultureSME2SeriesGranule[];
}

export interface AgricultureCatalogueResult {
  schema_version: 1;
  collection: "NISAR_L3_SME2_PROVISIONAL_V1";
  date_range: { start: string; end: string };
  aoi: { west: number; south: number; east: number; north: number };
  catalogue_granules: number;
  preflight_gate: {
    minimum_unique_acquisitions: number;
    minimum_temporal_span_days: number;
    meaning: string;
  };
  series: AgricultureSME2Series[];
  recommended_series_id: string | null;
  status: "ELIGIBLE_FOR_OPERATOR_REVIEW" | "INSUFFICIENT_TEMPORAL_COVERAGE" | "NO_COMPATIBLE_SERIES";
  interpretation_limits: string[];
}

const DATE_IN_NAME = /(?<!\\d)(20\\d{6})T\\d{6}(?!\\d)/;
const RELEASE = /^P(\\d{5})$/;

function flattenMetadata(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.flatMap(flattenMetadata);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => [[key, item] as [string, unknown], ...flattenMetadata(item)]);
}

function findMetadataValue(entry: AgricultureCMRGranule, names: string[]): string | null {
  const wanted = new Set(names.map((name) => name.toLowerCase().replaceAll("_", "")));
  for (const [key, value] of flattenMetadata(entry)) {
    if (!wanted.has(key.toLowerCase().replaceAll("_", ""))) continue;
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return null;
}

function numericIdentity(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\\d+/);
  return match ? Number(match[0]) : null;
}

function parseDirection(value: string | null, title: string): string | null {
  const candidate = (value ?? "").trim().toLowerCase();
  if (["a", "asc", "ascending", "ascending pass"].includes(candidate) || candidate.includes("ascend")) return "A";
  if (["d", "desc", "descending", "descending pass"].includes(candidate) || candidate.includes("descend")) return "D";
  const upper = title.toUpperCase();
  if (upper.includes("ASCENDING") || /(?:^|_)(?:ASC|A)(?:_|$)/.test(upper)) return "A";
  if (upper.includes("DESCENDING") || /(?:^|_)(?:DESC|D)(?:_|$)/.test(upper)) return "D";
  return null;
}

export function parseAgricultureSME2Granule(entry: AgricultureCMRGranule): {
  date: string;
  concept_id: string;
  title: string;
  updated: string | null;
  signature: AgricultureSME2Signature;
} | null {
  const title = String(entry.title ?? "").trim();
  const conceptId = String(entry.id ?? "").trim();
  if (!title || !conceptId) return null;

  const filename = title.split(/[\\/]/).pop() ?? title;
  const stem = filename.toLowerCase().endsWith(".h5") ? filename.slice(0, -3) : filename;
  const tokens = stem.split("_");
  if (tokens.length < 18 || tokens.slice(0, 4).join("_") !== "NISAR_L3_PR_SME2") return null;

  const [track, direction, frame, bandwidth, polarization, frequency] = tokens.slice(5, 11);
  const release = (tokens[13] ?? "").toUpperCase();
  const releaseMatch = RELEASE.exec(release);
  if (
    !/^\\d{3}$/.test(track) || !["A", "D"].includes(direction) ||
    !/^\\d{3}$/.test(frame) || !/^\\d{4}$/.test(bandwidth) ||
    !/^[A-Z0-9]{2,8}$/.test(polarization) || !["A", "B"].includes(frequency) ||
    !releaseMatch || Number(releaseMatch[1]) < 5023
  ) return null;

  const metadataTrack = numericIdentity(findMetadataValue(entry, ["TrackNumber", "Track", "PathNumber"]));
  const metadataFrame = numericIdentity(findMetadataValue(entry, ["FrameNumber", "Frame"]));
  const metadataDirection = findMetadataValue(entry, ["OrbitDirection", "PassDirection"]);
  if (
    (metadataTrack !== null && metadataTrack !== Number(track)) ||
    (metadataFrame !== null && metadataFrame !== Number(frame)) ||
    (metadataDirection !== null && parseDirection(metadataDirection, title) !== direction)
  ) return null;

  let acquisitionDate = "";
  const timeStart = typeof entry.time_start === "string" ? entry.time_start : "";
  if (/^20\\d{2}-\\d{2}-\\d{2}/.test(timeStart)) acquisitionDate = timeStart.slice(0, 10);
  if (!acquisitionDate) {
    const match = DATE_IN_NAME.exec(title);
    if (match) acquisitionDate = match[1].replace(/^(\\d{4})(\\d{2})(\\d{2})$/, "$1-$2-$3");
  }
  if (!/^20\\d{2}-\\d{2}-\\d{2}$/.test(acquisitionDate)) return null;
  const parsedDate = new Date(acquisitionDate + "T00:00:00Z");
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== acquisitionDate) return null;

  return {
    date: acquisitionDate,
    concept_id: conceptId,
    title,
    updated: typeof entry.updated === "string" ? entry.updated : null,
    signature: { release, track, direction, frame, bandwidth, polarization, frequency },
  };
}

function canonicalSignature(signature: AgricultureSME2Signature): string {
  const record = signature as unknown as Record<string, string>;
  return "{" + Object.keys(record).sort().map((key) =>
    JSON.stringify(key) + ": " + JSON.stringify(record[key])
  ).join(", ") + "}";
}

function daysBetween(first: string, second: string): number {
  return Math.round((Date.parse(second + "T00:00:00Z") - Date.parse(first + "T00:00:00Z")) / 86_400_000);
}

export function groupAgricultureSME2Series(
  entries: AgricultureCMRGranule[],
  minimumObservations = 6,
  minimumSpanDays = 60,
): AgricultureSME2Series[] {
  const groups = new Map<string, Array<NonNullable<ReturnType<typeof parseAgricultureSME2Granule>>>>();
  for (const entry of entries) {
    const parsed = parseAgricultureSME2Granule(entry);
    if (!parsed) continue;
    const key = canonicalSignature(parsed.signature);
    const group = groups.get(key) ?? [];
    group.push(parsed);
    groups.set(key, group);
  }

  const output: AgricultureSME2Series[] = [];
  for (const group of groups.values()) {
    const unique = new Map<string, typeof group[number]>();
    for (const item of group) {
      const previous = unique.get(item.date);
      const rank = [item.updated ?? "", item.concept_id];
      const previousRank = previous ? [previous.updated ?? "", previous.concept_id] : null;
      if (!previous || rank[0] > previousRank![0] || (rank[0] === previousRank![0] && rank[1] > previousRank![1])) {
        unique.set(item.date, item);
      }
    }

    const sorted = [...unique.values()].sort((left, right) => left.date.localeCompare(right.date));
    if (!sorted.length) continue;
    const dates = sorted.map((item) => item.date);
    const gaps = dates.slice(1).map((date, index) => daysBetween(dates[index], date)).sort((a, b) => a - b);
    const spanDays = daysBetween(dates[0], dates[dates.length - 1]);
    const canonical = canonicalSignature(sorted[0].signature);
    const seriesId = createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 12);
    output.push({
      series_id: seriesId,
      signature: sorted[0].signature,
      observation_count: dates.length,
      dates,
      span_days: spanDays,
      median_revisit_days: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
      maximum_gap_days: gaps.length ? Math.max(...gaps) : null,
      meets_preflight_gate: dates.length >= minimumObservations && spanDays >= minimumSpanDays,
      granules: sorted.map(({ date, concept_id, title, updated }) => ({ date, concept_id, title, updated })),
    });
  }

  return output.sort((left, right) =>
    Number(right.meets_preflight_gate) - Number(left.meets_preflight_gate) ||
    right.observation_count - left.observation_count ||
    right.span_days - left.span_days ||
    (left.maximum_gap_days ?? 0) - (right.maximum_gap_days ?? 0) ||
    left.series_id.localeCompare(right.series_id)
  );
}

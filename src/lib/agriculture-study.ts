export type AgricultureStatus = "EXPLORATORY" | "INCONCLUSIVE_COVERAGE";

export interface AgricultureAOI {
  west: number; south: number; east: number; north: number;
}

export interface AgricultureSummary {
  valid_fraction: number;
  valid_pixels: number;
  total_pixels: number;
  median: number;
  p05: number;
  p95: number;
  uncertainty_median: number;
}

export interface AgricultureObservation extends AgricultureSummary {
  date: string;
  preview: string;
  release: string;
  track: string;
  direction: "A" | "D";
  frame: string;
  bandwidth: string;
  polarization: string;
  frequency: string;
}

export interface AgricultureStudy {
  schema_version: 1;
  study_id: string;
  run_id: string;
  product: "NISAR_L3_SME2_PROVISIONAL_V1";
  product_maturity: "PROVISIONAL";
  release: string;
  track: string;
  direction: "A" | "D";
  frame: string;
  bandwidth: string;
  polarization: string;
  frequency: string;
  aoi: AgricultureAOI;
  date_range: { start: string; end: string };
  coverage_floor: 0.2;
  baseline_count: number;
  baseline_dates: string[];
  target_date: string;
  observations: AgricultureObservation[];
  change_preview: string;
  change_summary: AgricultureSummary;
  evidence_status: AgricultureStatus;
  sources: { title: string; url: string }[];
}

export interface AgricultureChecksumEntry {
  bytes: number;
  sha256: string;
}

export interface AgricultureChecksumManifest {
  schema_version: 1;
  files: Record<string, AgricultureChecksumEntry>;
}

export interface AgricultureIndex {
  schema_version: 1;
  study_url: string;
  checksums_url: string;
  published_at: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function finiteRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function isoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export function safeRelativeAssetPath(value: unknown, prefix: string): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 240) return false;
  if (value.startsWith("/") || value.includes("\\") || value.includes("?") || value.includes("#")) return false;
  if (value.split("/").some((part) => part === "" || part === "." || part === "..")) return false;
  return value.startsWith(prefix);
}

function validAOI(value: unknown): value is AgricultureAOI {
  if (!isRecord(value)) return false;
  const { west, south, east, north } = value;
  return finiteRange(west, -180, 180) && finiteRange(east, -180, 180) &&
    finiteRange(south, -90, 90) && finiteRange(north, -90, 90) &&
    west < east && south < north;
}

function validSummary(value: unknown): value is AgricultureSummary {
  if (!isRecord(value)) return false;
  return finiteRange(value.valid_fraction, 0, 1) &&
    Number.isInteger(value.valid_pixels) && Number(value.valid_pixels) >= 0 &&
    Number.isInteger(value.total_pixels) && Number(value.total_pixels) > 0 &&
    Number(value.valid_pixels) <= Number(value.total_pixels) &&
    finiteRange(value.median, 0.02, 0.6) &&
    finiteRange(value.p05, 0.02, 0.6) &&
    finiteRange(value.p95, 0.02, 0.6) &&
    Number(value.p05) <= Number(value.median) && Number(value.median) <= Number(value.p95) &&
    finiteRange(value.uncertainty_median, 0, 1) &&
    Math.abs(Number(value.valid_fraction) - Number(value.valid_pixels) / Number(value.total_pixels)) < 0.000001;
}

function validObservation(value: unknown): value is AgricultureObservation {
  if (!isRecord(value)) return false;
  return isoDay(value.date) && safeRelativeAssetPath(value.preview, "previews/") &&
    typeof value.release === "string" && /^P\d{5}$/.test(value.release) &&
    Number(value.release.slice(1)) >= 5023 &&
    typeof value.track === "string" && value.track.length > 0 &&
    (value.direction === "A" || value.direction === "D") &&
    typeof value.frame === "string" && typeof value.bandwidth === "string" &&
    typeof value.polarization === "string" && typeof value.frequency === "string" &&
    validSummary(value);
}

export function isAgricultureStudy(value: unknown): value is AgricultureStudy {
  if (!isRecord(value) || value.schema_version !== 1 ||
      typeof value.study_id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.study_id) ||
      typeof value.run_id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(value.run_id) ||
      value.product !== "NISAR_L3_SME2_PROVISIONAL_V1" || value.product_maturity !== "PROVISIONAL" ||
      typeof value.release !== "string" || !/^P\d{5}$/.test(value.release) ||
      Number(value.release.slice(1)) < 5023 ||
      typeof value.track !== "string" || !value.track ||
      (value.direction !== "A" && value.direction !== "D") ||
      typeof value.frame !== "string" || typeof value.bandwidth !== "string" ||
      typeof value.polarization !== "string" || typeof value.frequency !== "string" ||
      !validAOI(value.aoi) || !isRecord(value.date_range) ||
      !isoDay(value.date_range.start) || !isoDay(value.date_range.end) ||
      value.date_range.start > value.date_range.end || value.coverage_floor !== 0.2 ||
      !Number.isInteger(value.baseline_count) || Number(value.baseline_count) < 3 ||
      !Array.isArray(value.baseline_dates) || !value.baseline_dates.every(isoDay) ||
      !Array.isArray(value.observations) || value.observations.length < Number(value.baseline_count) + 1 ||
      !value.observations.every(validObservation) ||
      !isoDay(value.target_date) || value.target_date !== (value.observations[value.observations.length - 1] as Record<string, unknown>).date ||
      Number(value.baseline_count) !== value.baseline_dates.length ||
      !validSummary(value.change_summary) ||
      !safeRelativeAssetPath(value.change_preview, "previews/") ||
      !Array.isArray(value.sources) || !value.sources.every((item) => isRecord(item) &&
        typeof item.title === "string" && typeof item.url === "string" && item.url.startsWith("https://"))) return false;

  const study = value as unknown as AgricultureStudy;
  const dates = study.observations.map((item) => item.date);
  if (new Set(dates).size !== dates.length || dates.some((date, index) => index > 0 && dates[index - 1] >= date)) return false;
  if (JSON.stringify(dates.slice(0, study.baseline_count)) !== JSON.stringify(study.baseline_dates)) return false;
  if (study.observations.some((item) => item.release !== study.release ||
      item.track !== study.track || item.direction !== study.direction ||
      item.frame !== study.frame || item.bandwidth !== study.bandwidth ||
      item.polarization !== study.polarization || item.frequency !== study.frequency)) return false;

  const target = study.observations[study.observations.length - 1];
  const expectedStatus = target.valid_fraction < study.coverage_floor ||
    study.change_summary.valid_fraction < study.coverage_floor ? "INCONCLUSIVE_COVERAGE" : "EXPLORATORY";
  return study.evidence_status === expectedStatus;
}

export function isAgricultureIndex(value: unknown): value is AgricultureIndex {
  return isRecord(value) && value.schema_version === 1 &&
    safeRelativeAssetPath(value.study_url, "current/") &&
    safeRelativeAssetPath(value.checksums_url, "current/") &&
    value.study_url === "current/study.json" &&
    value.checksums_url === "current/web-checksums.json" &&
    typeof value.published_at === "string" && Number.isFinite(Date.parse(value.published_at));
}

export function isAgricultureChecksumManifest(value: unknown): value is AgricultureChecksumManifest {
  if (!isRecord(value) || value.schema_version !== 1 || !isRecord(value.files)) return false;
  const entries = Object.entries(value.files);
  if (!entries.some(([path]) => path === "study.json")) return false;
  return entries.every(([path, item]) => {
    if (!/^(study\.json|previews\/[a-z0-9][a-z0-9._-]*\.png)$/.test(path) || !isRecord(item)) return false;
    return Number.isInteger(item.bytes) && Number(item.bytes) > 0 && isSha256(item.sha256);
  });
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

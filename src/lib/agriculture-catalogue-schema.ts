import type { AgricultureCatalogueResult, AgricultureSME2Series, AgricultureSME2Signature } from "./agriculture-catalogue";

/** Earliest date supported by the current NISAR SME2 cloud-processing pipeline. */
export const AGRICULTURE_SME2_MIN_DATE = "2026-06-17";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isIntegerAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function daysBetween(first: string, second: string): number {
  return Math.round((Date.parse(second + "T00:00:00Z") - Date.parse(first + "T00:00:00Z")) / 86_400_000);
}

function isSignature(value: unknown): value is AgricultureSME2Signature {
  if (!isRecord(value)) return false;
  return typeof value.release === "string" && /^P\d{5}$/.test(value.release) &&
    Number(value.release.slice(1)) >= 5023 &&
    typeof value.track === "string" && /^\d{3}$/.test(value.track) &&
    (value.direction === "A" || value.direction === "D") &&
    typeof value.frame === "string" && /^\d{3}$/.test(value.frame) &&
    typeof value.bandwidth === "string" && /^\d{4}$/.test(value.bandwidth) &&
    typeof value.polarization === "string" && /^[A-Z0-9]{2,8}$/.test(value.polarization) &&
    (value.frequency === "A" || value.frequency === "B");
}

function isSeries(
  value: unknown,
  minimumObservations: number,
  minimumSpanDays: number,
  startDate: string,
  endDate: string,
): value is AgricultureSME2Series {
  if (!isRecord(value) || !/^[a-f0-9]{12}$/.test(String(value.series_id ?? ""))) return false;
  if (!isSignature(value.signature)) return false;
  if (!isIntegerAtLeast(value.observation_count, 1) || !Array.isArray(value.dates) ||
      !Array.isArray(value.granules) || value.dates.length !== value.observation_count ||
      value.granules.length !== value.observation_count) return false;
  if (!value.dates.every(isIsoDay)) return false;

  const dates = value.dates as string[];
  if (dates.some((date, index) => date < startDate || date > endDate ||
      (index > 0 && date <= dates[index - 1]))) return false;
  const spanDays = daysBetween(dates[0], dates[dates.length - 1]);
  if (!isIntegerAtLeast(value.span_days, 0) || value.span_days !== spanDays) return false;

  const gaps = dates.slice(1).map((date, index) => daysBetween(dates[index], date)).sort((a, b) => a - b);
  const expectedMedian = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const expectedMaximum = gaps.length ? Math.max(...gaps) : null;
  if (value.median_revisit_days !== expectedMedian || value.maximum_gap_days !== expectedMaximum) return false;

  if (typeof value.meets_preflight_gate !== "boolean" ||
      value.meets_preflight_gate !== (dates.length >= minimumObservations && spanDays >= minimumSpanDays)) return false;

  return value.granules.every((item, index) => isRecord(item) &&
    item.date === dates[index] &&
    typeof item.concept_id === "string" && item.concept_id.trim().length > 0 && item.concept_id.length <= 256 &&
    typeof item.title === "string" && item.title.startsWith("NISAR_L3_PR_SME2_") && item.title.length <= 1024 &&
    (item.updated === null || (typeof item.updated === "string" && item.updated.length > 0 && item.updated.length <= 128)));
}

/**
 * Runtime guard for data returned by the public NASA CMR catalogue endpoint.
 * A shallow cast is not sufficient: malformed series could otherwise crash the
 * operator UI or expose a cloud-processing handoff for an invalid time series.
 */
export function isAgricultureCatalogueResult(value: unknown): value is AgricultureCatalogueResult {
  if (!isRecord(value) || value.schema_version !== 1 ||
      value.collection !== "NISAR_L3_SME2_PROVISIONAL_V1") return false;

  if (!isRecord(value.date_range) || !isIsoDay(value.date_range.start) ||
      !isIsoDay(value.date_range.end) || value.date_range.start > value.date_range.end ||
      value.date_range.start < AGRICULTURE_SME2_MIN_DATE ||
      daysBetween(value.date_range.start, value.date_range.end) > 366) return false;

  if (!isRecord(value.aoi)) return false;
  const { west, south, east, north } = value.aoi;
  if (![west, south, east, north].every((item) => typeof item === "number" && Number.isFinite(item))) return false;
  if ((west as number) < -180 || (east as number) > 180 ||
      (south as number) < -90 || (north as number) > 90 ||
      (west as number) >= (east as number) || (south as number) >= (north as number) ||
      (east as number) - (west as number) > 2 || (north as number) - (south as number) > 2) return false;

  if (!isIntegerAtLeast(value.catalogue_granules, 0) || !isRecord(value.preflight_gate) ||
      !isIntegerAtLeast(value.preflight_gate.minimum_unique_acquisitions, 1) ||
      !isIntegerAtLeast(value.preflight_gate.minimum_temporal_span_days, 1) ||
      typeof value.preflight_gate.meaning !== "string" || value.preflight_gate.meaning.trim().length === 0 ||
      !Array.isArray(value.series) || value.series.length > 2000 ||
      !Array.isArray(value.interpretation_limits) || value.interpretation_limits.length === 0 ||
      value.interpretation_limits.length > 16 ||
      !value.interpretation_limits.every((note) => typeof note === "string" && note.trim().length > 0)) return false;

  const minimumObservations = value.preflight_gate.minimum_unique_acquisitions;
  const minimumSpanDays = value.preflight_gate.minimum_temporal_span_days;
  const startDate = value.date_range.start;
  const endDate = value.date_range.end;
  const series = value.series;
  if (!series.every((item) => isSeries(item, minimumObservations, minimumSpanDays, startDate, endDate))) return false;
  const validatedSeries = series as AgricultureSME2Series[];
  const uniqueGranuleCount = validatedSeries.reduce((total, item) => total + item.observation_count, 0);
  if (value.catalogue_granules < uniqueGranuleCount) return false;

  const ids = validatedSeries.map((item) => item.series_id);
  if (new Set(ids).size !== ids.length) return false;
  const eligible = validatedSeries.filter((item) => item.meets_preflight_gate);
  const status = eligible.length > 0
    ? "ELIGIBLE_FOR_OPERATOR_REVIEW"
    : series.length > 0 ? "INSUFFICIENT_TEMPORAL_COVERAGE" : "NO_COMPATIBLE_SERIES";
  if (value.status !== status) return false;

  if (value.recommended_series_id !== null &&
      (typeof value.recommended_series_id !== "string" ||
       !eligible.some((item) => item.series_id === value.recommended_series_id))) return false;
  if (eligible.length > 0 && typeof value.recommended_series_id !== "string") return false;

  return true;
}

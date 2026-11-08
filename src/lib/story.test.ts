// Run: npm test   (node's built-in runner; no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { changeStory, daysBetween, opticalState, challenge, temporalOverlapContext, summarizeEvidence, regionNavigationContext, regionDistributionContext, type StackRow } from "./story.ts";

const pulse = { site: "X", wetland_area_km2: 50, data_source: "NISAR" as const, reference_check_status: "INCONCLUSIVE",
  dates: [{ date: "2026-06-23", area_km2: 1, fraction: 0.1, mean_delta_db: 1, patches: 3 }, { date: "2026-08-29", area_km2: 24.48, fraction: 0.4, mean_delta_db: 2, patches: 295 }],
  onset: null, peak: { date: "2026-08-29", area_km2: 24.48 }, recession_start: null };

test("daysBetween counts real days", () => assert.equal(daysBetween("2026-06-23", "2026-08-29"), 67));
test("optical state follows recorded status only", () => {
  assert.equal(opticalState("SHOWCASE", pulse), "INCONCLUSIVE");
  assert.equal(opticalState("SHOWCASE", { ...pulse, reference_check_status: "NOT_RUN" }), "NOT_RUN");
});
test("story uses loaded values and never claims confirmation", () => {
  const text = changeStory(pulse, "SHOWCASE", "INCONCLUSIVE").join(" ");
  assert.match(text, /295 candidate regions covering 24\.48 km²/);
  assert.match(text, /rather than confirmed flooding/);
  assert.match(text, /67 days/);
});
const temporalSeries = { ...pulse, dates: [
  { date: "2026-08-17", area_km2: 1, fraction: 0.1, mean_delta_db: 1, patches: 3 },
  { date: "2026-08-29", area_km2: 2, fraction: 0.2, mean_delta_db: 2, patches: 4 },
  { date: "2026-09-10", area_km2: 3, fraction: 0.3, mean_delta_db: 3, patches: 5 },
  { date: "2026-09-22", area_km2: 4, fraction: 0.4, mean_delta_db: 4, patches: 6 },
] };

test("temporal overlap resolves the immediately preceding acquisition and real interval", () => {
  const context = temporalOverlapContext({
    date: "2026-09-22", temporal_overlap_fraction: 0.72, temporal_status: "PASS",
  }, temporalSeries);
  assert.equal(context.previousDate, "2026-09-10");
  assert.equal(context.intervalDays, 12);
  assert.equal(context.overlapFraction, 0.72);
  assert.equal(context.thresholdFraction, 0.5);
  assert.equal(context.status, "PASS");
});

test("first acquisition has no invented temporal comparison", () => {
  const context = temporalOverlapContext({
    date: "2026-08-17", temporal_overlap_fraction: null, temporal_status: "PARTIAL",
  }, temporalSeries);
  assert.equal(context.dateInSeries, true);
  assert.equal(context.previousDate, null);
  assert.equal(context.intervalDays, null);
  assert.equal(context.overlapFraction, null);
  assert.equal(context.status, "UNAVAILABLE");
});

test("unknown dates and invalid overlap fractions remain unassessed", () => {
  const unknown = temporalOverlapContext({
    date: "2026-10-01", temporal_overlap_fraction: 0.8, temporal_status: "PASS",
  }, temporalSeries);
  assert.equal(unknown.dateInSeries, false);
  assert.equal(unknown.previousDate, null);
  assert.equal(unknown.status, "UNAVAILABLE");
  const invalid = temporalOverlapContext({
    date: "2026-09-22", temporal_overlap_fraction: 1.2, temporal_status: "PASS",
  }, temporalSeries);
  assert.equal(invalid.previousDate, "2026-09-10");
  assert.equal(invalid.overlapFraction, null);
  assert.equal(invalid.status, "UNAVAILABLE");
});

test("evidence summary preserves all existing statuses without scoring them", () => {
  const rows: StackRow[] = [
    { key: "hh", label: "HH radar change", kind: "observed", status: "PASS", detail: "measured change" },
    { key: "hv", label: "HV radar change", kind: "observed", status: "PARTIAL", detail: "small change" },
    { key: "threshold", label: "Threshold sensitivity", kind: "derived", status: "FAIL", detail: "not stable" },
    { key: "truth", label: "Ground truth", kind: "unassessed", status: "UNAVAILABLE", detail: "not collected" },
  ];
  const summary = summarizeEvidence(rows);
  assert.equal(summary.passed.length, 1);
  assert.equal(summary.partial.length, 1);
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.unavailable.length, 1);
  assert.deepEqual([...summary.passed, ...summary.partial, ...summary.failed, ...summary.unavailable]
    .map((row) => row.key).sort(), rows.map((row) => row.key).sort());
});

test("evidence summary handles an empty set", () => {
  assert.deepEqual(summarizeEvidence([]), { passed: [], partial: [], failed: [], unavailable: [] });
});

test("region navigation follows largest-area order and resolves both neighbors", () => {
  const regions = [
    { id: "small", area_km2: 1, classification: "OPEN_WATER" as const },
    { id: "large", area_km2: 4, classification: "OPEN_WATER" as const },
    { id: "middle", area_km2: 2, classification: "VEGETATED_INUNDATION" as const },
  ];
  const context = regionNavigationContext(regions, "middle");
  assert.equal(context.currentIndex, 1);
  assert.equal(context.total, 3);
  assert.equal(context.previous?.id, "large");
  assert.equal(context.next?.id, "small");
});

test("region navigation respects the class filter and disables unavailable boundaries", () => {
  const regions = [
    { id: "open-large", area_km2: 4, classification: "OPEN_WATER" as const },
    { id: "veg", area_km2: 3, classification: "VEGETATED_INUNDATION" as const },
    { id: "open-small", area_km2: 1, classification: "OPEN_WATER" as const },
  ];
  const first = regionNavigationContext(regions, "open-large", "OPEN_WATER");
  assert.equal(first.currentIndex, 0);
  assert.equal(first.total, 2);
  assert.equal(first.previous, null);
  assert.equal(first.next?.id, "open-small");
  const last = regionNavigationContext(regions, "open-small", "OPEN_WATER");
  assert.equal(last.previous?.id, "open-large");
  assert.equal(last.next, null);
  const missing = regionNavigationContext(regions, "veg", "OPEN_WATER");
  assert.equal(missing.currentIndex, -1);
  assert.equal(missing.previous, null);
  assert.equal(missing.next, null);
});

test("region distribution reports deterministic ranks and medians for one acquisition", () => {
  const regions = [
    { id: "alpha", area_km2: 4, delta_hh: -2, classification: "OPEN_WATER" as const },
    { id: "bravo", area_km2: 2, delta_hh: 5, classification: "OPEN_WATER" as const },
    { id: "charlie", area_km2: 6, delta_hh: -1, classification: "VEGETATED_INUNDATION" as const },
  ];
  const context = regionDistributionContext(regions, "bravo");
  assert.equal(context.total, 3);
  assert.equal(context.areaRank, 3);
  assert.equal(context.deltaHhRank, 1);
  assert.equal(context.medianAreaKm2, 4);
  assert.equal(context.medianAbsDeltaHhDb, 2);
});

test("region distribution respects class filters and leaves excluded candidates unranked", () => {
  const regions = [
    { id: "open-large", area_km2: 4, delta_hh: -2, classification: "OPEN_WATER" as const },
    { id: "veg", area_km2: 3, delta_hh: 5, classification: "VEGETATED_INUNDATION" as const },
    { id: "open-small", area_km2: 2, delta_hh: -1, classification: "OPEN_WATER" as const },
  ];
  const context = regionDistributionContext(regions, "veg", "OPEN_WATER");
  assert.equal(context.total, 2);
  assert.equal(context.areaRank, null);
  assert.equal(context.deltaHhRank, null);
  assert.equal(context.medianAreaKm2, 3);
  assert.equal(context.medianAbsDeltaHhDb, 1.5);
});

test("region distribution excludes invalid measurements and handles an empty cohort", () => {
  const context = regionDistributionContext([
    { id: "bad", area_km2: Number.NaN, delta_hh: 3, classification: "OPEN_WATER" as const },
    { id: "also-bad", area_km2: 2, delta_hh: Number.POSITIVE_INFINITY, classification: "OPEN_WATER" as const },
  ], "bad");
  assert.deepEqual(context, { total: 0, areaRank: null, deltaHhRank: null, medianAreaKm2: null, medianAbsDeltaHhDb: null });
});

test("challenge always lists missing field truth", () => {
  const p = { hh_before: -15, hh_after: -19, hv_before: -22, hv_after: -22.2, delta_hh: -4, delta_hv: -0.2, temporal_status: "PASS", spatial_status: "PASS",
    quality_status: "PASS", threshold_stability: "STABLE", valid_fraction: 0.9, evidence_state: "SUPPORTED", classification: "OPEN_WATER" } as never;
  const c = challenge(p, "NOT_RUN");
  assert.ok(c.warnings.includes("No field truth")); assert.equal(c.validation, "Incomplete");
});

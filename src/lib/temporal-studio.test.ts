import test from "node:test";
import assert from "node:assert/strict";
import {
  formatMetric,
  hlsAttemptDates,
  hlsSceneDate,
  peakEntry,
  sumPatchAreas,
  timelinePositions,
  type TemporalEntry,
} from "./temporal-studio";

function entry(date: string, metricValue: number | null): TemporalEntry {
  return { date, metricValue, metricLabel: formatMetric(metricValue, "km²") };
}

test("sumPatchAreas adds per-patch areas and counts features", () => {
  const collection = {
    type: "FeatureCollection",
    features: [
      { properties: { area_km2: 0.0065 } },
      { properties: { area_km2: 0.0128 } },
      { properties: { area_km2: null } },
      { properties: {} },
    ],
  };
  assert.deepEqual(sumPatchAreas(collection), { areaKm2: 0.0193, count: 4 });
  assert.deepEqual(sumPatchAreas(null), { areaKm2: 0, count: 0 });
  assert.deepEqual(sumPatchAreas({ features: "nope" }), { areaKm2: 0, count: 0 });
});

test("peakEntry picks the largest metric and ignores nulls", () => {
  const entries = [entry("2026-06-30", 2.37), entry("2026-08-29", 24.48), entry("2026-09-22", 9.1)];
  assert.equal(peakEntry(entries)?.date, "2026-08-29");
  assert.equal(peakEntry([entry("2026-06-30", null)]), null);
  assert.equal(peakEntry([]), null);
});

test("timelinePositions spaces dates by real calendar gaps", () => {
  const entries = [entry("2026-06-30", 1), entry("2026-08-29", 2), entry("2026-09-22", 3)];
  const positions = timelinePositions(entries);
  assert.equal(positions[0], 0);
  assert.equal(positions[2], 1);
  // 30 Jun -> 29 Aug is 60 days of an 84-day span.
  assert.ok(Math.abs(positions[1] - 60 / 84) < 0.001);
});

test("timelinePositions centres a single date", () => {
  assert.deepEqual(timelinePositions([entry("2026-01-17", 5)]), [0.5]);
  assert.deepEqual(timelinePositions([]), []);
});

test("formatMetric rounds to the scale of the value", () => {
  assert.equal(formatMetric(24.4765, "km²"), "24.48 km²");
  assert.equal(formatMetric(0.3604, "m³/m³"), "0.3604 m³/m³");
  assert.equal(formatMetric(295, "km²"), "295 km²");
  assert.equal(formatMetric(0.0128, "km²"), "0.0128 km²");
  assert.equal(formatMetric(0, "km²"), "0 km²");
  assert.equal(formatMetric(null, "km²"), "Not published");
});

test("hlsSceneDate parses day-of-year scene names", () => {
  assert.equal(hlsSceneDate("HLS.S30.T46RBN.2026195T042701.v2.0"), "2026-07-14");
  assert.equal(hlsSceneDate("HLS.L30.T46RBN.2026242T042355.v2.0"), "2026-08-30");
  assert.equal(hlsSceneDate("HLS.L30.T46RCN.2026219T041739.v2.0"), "2026-08-07");
  assert.equal(hlsSceneDate("not-a-scene"), null);
  assert.equal(hlsSceneDate("HLS.S30.T46RBN.2026400T042701.v2.0"), null);
});

test("hlsAttemptDates dedupes and sorts optical dates", () => {
  const attempts = [
    { baseline_scene: "HLS.S30.T46RBN.2026195T042701.v2.0", event_scene: "HLS.L30.T46RBN.2026242T042355.v2.0" },
    { baseline_scene: "HLS.S30.T46RBN.2026195T042701.v2.0", event_scene: "HLS.L30.T46RBN.2026242T042355.v2.0" },
    { baseline_scene: "garbage", event_scene: null },
  ];
  assert.deepEqual(hlsAttemptDates(attempts), ["2026-07-14", "2026-08-30"]);
  assert.deepEqual(hlsAttemptDates(null), []);
});

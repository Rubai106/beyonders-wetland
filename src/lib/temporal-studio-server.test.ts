/* Regression tests for the Temporal Studio server loaders (P0 fixes,
   2026-11-08). Every value is checked against the published files in
   public/ — these tests fail if a loader reads the wrong property or turns
   a recorded value into missing data. */
import test from "node:test";
import assert from "node:assert/strict";
import { loadTemporalStudies } from "./temporal-studio-server";

test("all seven studies load with no missing timelines", async () => {
  const { studies, missing } = await loadTemporalStudies();
  assert.deepEqual(missing, []);
  assert.deepEqual(
    studies.map((s) => s.id),
    ["tanguar-haor", "hakaluki-haor", "chokwe", "rondonia", "hayli-gubbi", "kilauea-episode-36", "naogaon"],
  );
});

test("Hakaluki 27 Sep metrics come from optical_support, not comparison", async () => {
  const { studies } = await loadTemporalStudies();
  const hakaluki = studies.find((s) => s.id === "hakaluki-haor");
  assert.ok(hakaluki);
  const check = hakaluki.entries.find((e) => e.date === "2026-09-27");
  assert.ok(check?.reference);
  // evidence.json optical_support: precision 0.1288, recall 0.0522,
  // f1 0.0743, common_clear_fraction 0.5072. comparison holds no metrics.
  assert.match(check.reference, /precision 12\.9%/);
  assert.match(check.reference, /recall 5\.2%/);
  assert.match(check.reference, /F1 7\.4%/);
  assert.match(check.reference, /50\.7% common clear coverage/);
  assert.equal(hakaluki.referenceStatus, "CROSS_SENSOR_CHECK");
});

test("Hakaluki genuine zero stays zero; it is not missing data", async () => {
  const { studies } = await loadTemporalStudies();
  const hakaluki = studies.find((s) => s.id === "hakaluki-haor");
  assert.ok(hakaluki);
  // patches_03_final.geojson exists with 0 features: a recorded zero.
  const zero = hakaluki.entries.find((e) => e.date === "2026-08-22");
  assert.ok(zero);
  assert.equal(zero.metricValue, 0);
  assert.equal(zero.metricLabel, "0 km²");
  assert.equal(zero.patches, 0);
  // Every Hakaluki date has a published patches file, so no entry is null.
  assert.ok(hakaluki.entries.every((e) => e.metricValue !== null));
  const peak = hakaluki.entries.find((e) => e.date === "2026-07-17");
  assert.ok(peak?.metricValue !== null && Math.abs(peak.metricValue - 2.5702) < 0.0001);
});

test("Rondônia reference lines carry real coverage, never a zeroed missing value", async () => {
  const { studies } = await loadTemporalStudies();
  const rondonia = studies.find((s) => s.id === "rondonia");
  assert.ok(rondonia);
  const candidate = rondonia.entries.find((e) => e.date === "2026-09-29");
  assert.ok(candidate?.reference);
  assert.match(candidate.reference, /97\.5% common clear/);
  assert.match(candidate.reference, /71\.1% candidate overlap/);
  assert.doesNotMatch(candidate.reference, /not recorded/);
});

test("Volcano timelines use real LOS statistics, not assessed area", async () => {
  const { studies } = await loadTemporalStudies();
  const hayli = studies.find((s) => s.id === "hayli-gubbi");
  assert.ok(hayli);
  assert.equal(hayli.metricUnit, "cm");
  assert.match(hayli.metricName, /Apparent LOS/);
  // First pair: p05 -0.248 cm, p95 2.628 cm, 83.0% valid, coherence 0.911.
  const first = hayli.entries[0];
  assert.ok(first);
  assert.ok(first.metricValue !== null && Math.abs(first.metricValue - 2.6283559799194336) < 0.001);
  assert.match(first.secondary ?? "", /p05 -0\.25 cm · p95 2\.63 cm/);
  assert.match(first.secondary ?? "", /83\.0% valid/);
  assert.match(first.secondary ?? "", /median coherence 0\.911/);
  assert.match(first.secondary ?? "", /1044 km² assessed/);
  assert.match(hayli.screeningRule, /independent intervals/);

  const kilauea = studies.find((s) => s.id === "kilauea-episode-36");
  assert.ok(kilauea);
  assert.equal(kilauea.entries.length, 1);
  const pair = kilauea.entries[0];
  assert.ok(pair.metricValue !== null && Math.abs(pair.metricValue - 0.52205890417099) < 0.001);
  assert.match(pair.secondary ?? "", /p05 -36\.02 cm/);
  assert.match(pair.secondary ?? "", /63\.3% valid/);
  assert.match(pair.secondary ?? "", /737\.7 km² assessed/);
});

test("Naogaon carries both the per-date view and the same-pixel cohort", async () => {
  const { studies } = await loadTemporalStudies();
  const naogaon = studies.find((s) => s.id === "naogaon");
  assert.ok(naogaon);
  assert.equal(naogaon.entries.length, 6);
  assert.ok(naogaon.matchedEntries);
  assert.equal(naogaon.matchedEntries.length, 6);
  // 2026-08-12: per-date median 0.3272 on 3,636 pixels; matched 0.3198 on
  // the fixed 1,336-pixel cohort. Same date, different coverage, different
  // median — the cohort is the comparable one.
  assert.ok(Math.abs((naogaon.entries[0]?.metricValue ?? 0) - 0.327223539352417) < 0.0001);
  assert.ok(Math.abs((naogaon.matchedEntries[0]?.metricValue ?? 0) - 0.31982290744781494) < 0.0001);
  assert.match(naogaon.matchedEntries[0]?.secondary ?? "", /1,336 pixels · same set every date/);
  assert.match(naogaon.matchedNote ?? "", /ALL_DATE_VALID_PIXEL_INTERSECTION/);
  assert.match(naogaon.matchedNote ?? "", /1,336 pixels valid on all 6 dates/);
});

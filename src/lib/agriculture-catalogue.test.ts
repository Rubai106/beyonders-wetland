import assert from "node:assert/strict";
import test from "node:test";
import { groupAgricultureSME2Series, parseAgricultureSME2Granule } from "./agriculture-catalogue";

function granule(date: string, track = "141", frame = "014", updated = "2026-11-01T00:00:00Z", id?: string) {
  const stamp = date.replaceAll("-", "");
  return {
    id: id ?? "G-" + track + "-" + stamp,
    title: `NISAR_L3_PR_SME2_024_${track}_A_${frame}_4005_DHDH_A_${stamp}T231316_${stamp}T231350_P05023_N_F_J_001`,
    time_start: date + "T00:00:00.000Z",
    updated,
  };
}

test("parses a real NISAR SME2 granule identity and acquisition date", () => {
  const parsed = parseAgricultureSME2Granule(granule("2026-06-23"));
  assert.equal(parsed?.date, "2026-06-23");
  assert.equal(parsed?.signature.track, "141");
  assert.equal(parsed?.signature.frame, "014");
  assert.equal(parsed?.signature.release, "P05023");
});

test("matches the Python operator series ID fingerprint", () => {
  const dates = ["2026-06-23", "2026-07-05", "2026-07-17", "2026-08-10", "2026-08-22", "2026-09-03", "2026-09-15", "2026-09-27", "2026-10-09", "2026-10-21"];
  const rows = groupAgricultureSME2Series(dates.map((date) => granule(date)));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].series_id, "c5f219dd7bbc");
  assert.equal(rows[0].observation_count, 10);
  assert.equal(rows[0].span_days, 120);
  assert.equal(rows[0].median_revisit_days, 12);
  assert.equal(rows[0].maximum_gap_days, 24);
});

test("keeps different tracks, frames, directions and polarisations separate", () => {
  const six = ["2026-06-01", "2026-06-13", "2026-06-25", "2026-07-07", "2026-07-19", "2026-07-31"];
  const rows = groupAgricultureSME2Series([
    ...six.map((date) => granule(date, "141", "014")),
    ...six.slice(0, 3).map((date) => granule(date, "069", "014")),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].observation_count, 6);
  assert.equal(rows[1].observation_count, 3);
});

test("does not promote a five-date series to event-response preflight eligible", () => {
  const dates = ["2026-06-20", "2026-07-14", "2026-08-31", "2026-09-24", "2026-10-18"];
  const rows = groupAgricultureSME2Series(dates.map((date) => granule(date, "091", "076")));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].meets_preflight_gate, false);
  assert.equal(rows[0].maximum_gap_days, 48);
});

test("deduplicates same-day granules using updated timestamp then concept ID", () => {
  const older = granule("2026-06-23", "141", "014", "2026-06-24T00:00:00Z", "G-OLD");
  const newer = granule("2026-06-23", "141", "014", "2026-06-25T00:00:00Z", "G-NEW");
  const rows = groupAgricultureSME2Series([older, newer]);
  assert.equal(rows[0].observation_count, 1);
  assert.equal(rows[0].granules[0].concept_id, "G-NEW");
});

test("rejects a catalogue identity that conflicts with embedded orbit metadata", () => {
  const input = { ...granule("2026-06-23"), TrackNumber: 69 };
  assert.equal(parseAgricultureSME2Granule(input), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  isAgricultureChecksumManifest,
  isAgricultureIndex,
  isAgricultureStudy,
  safeRelativeAssetPath,
  sha256Hex,
} from "./agriculture-study";

const summary = {
  valid_fraction: 0.8, valid_pixels: 80, total_pixels: 100,
  median: 0.24, p05: 0.16, p95: 0.32, uncertainty_median: 0.04,
};
const observation = (date: string) => ({
  date, preview: "previews/moisture-2026-06-20.png",
  release: "P05023", track: "034", direction: "A" as const,
  frame: "120", bandwidth: "20MHz", polarization: "HH+HV", frequency: "A",
  ...summary,
});
const study = {
  schema_version: 1, study_id: "test-study", run_id: "test-run",
  product: "NISAR_L3_SME2_PROVISIONAL_V1", product_maturity: "PROVISIONAL",
  release: "P05023", track: "034", direction: "A", frame: "120",
  bandwidth: "20MHz", polarization: "HH+HV", frequency: "A",
  aoi: { west: 90, south: 24, east: 91, north: 25 },
  date_range: { start: "2026-06-17", end: "2026-07-01" }, coverage_floor: 0.2,
  baseline_count: 3, baseline_dates: ["2026-06-20", "2026-06-25", "2026-06-28"],
  target_date: "2026-07-01",
  observations: ["2026-06-20", "2026-06-25", "2026-06-28", "2026-07-01"].map(observation),
  change_preview: "previews/change-latest-minus-baseline.png",
  change_summary: summary, evidence_status: "EXPLORATORY",
  sources: [{ title: "ASF NISAR SME2 Guide", url: "https://nisar-docs.asf.alaska.edu/sme2/" }],
};

test("accepts a structurally valid exploratory study", () => assert.equal(isAgricultureStudy(study), true));
test("rejects mixed release observations", () => {
  const bad = structuredClone(study);
  bad.observations[2].release = "P05024";
  assert.equal(isAgricultureStudy(bad), false);
});
test("rejects unsorted or duplicate dates", () => {
  const bad = structuredClone(study);
  bad.observations[1].date = bad.observations[0].date;
  assert.equal(isAgricultureStudy(bad), false);
});
test("rejects weaker-than-policy coverage floor", () => {
  assert.equal(isAgricultureStudy({ ...study, coverage_floor: 0.1 }), false);
});
test("requires baseline dates to match the first observations", () => {
  assert.equal(isAgricultureStudy({ ...study, baseline_dates: ["2026-06-25", "2026-06-20", "2026-06-28"] }), false);
});
test("rejects invalid and traversing asset paths", () => {
  assert.equal(safeRelativeAssetPath("../secret.png", "previews/"), false);
  assert.equal(safeRelativeAssetPath("previews/../secret.png", "previews/"), false);
  assert.equal(safeRelativeAssetPath("previews/good.png", "previews/"), true);
});
test("validates the published index contract", () => {
  assert.equal(isAgricultureIndex({ schema_version: 1, study_url: "current/study.json", checksums_url: "current/web-checksums.json", published_at: "2026-10-31T00:00:00Z" }), true);
  assert.equal(isAgricultureIndex({ schema_version: 1, study_url: "../study.json", checksums_url: "current/web-checksums.json", published_at: "2026-10-31" }), false);
});
test("requires a study checksum and valid preview entries", () => {
  const hash = "a".repeat(64);
  assert.equal(isAgricultureChecksumManifest({ schema_version: 1, files: { "study.json": { bytes: 20, sha256: hash }, "previews/a.png": { bytes: 10, sha256: hash } } }), true);
  assert.equal(isAgricultureChecksumManifest({ schema_version: 1, files: { "previews/a.png": { bytes: 10, sha256: hash } } }), false);
});
test("SHA-256 helper returns a lowercase hexadecimal digest", async () => {
  const digest = await sha256Hex(new TextEncoder().encode("abc").buffer);
  assert.equal(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

/* Regression tests for the server-side evidence-quality loader (P0 fix,
   2026-11-08). The loader derives every figure from the published files;
   these tests re-read the raw files independently and compare, so a stale
   number fails loudly when a study version changes. */
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadStudyQuality } from "./evidence-quality-server";

async function readJson<T>(rel: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(process.cwd(), "public", rel), "utf-8")) as T;
}

test("loader returns all seven studies in publication order", async () => {
  const { studies, missing } = await loadStudyQuality();
  assert.deepEqual(missing, []);
  assert.deepEqual(
    studies.map((s) => s.studyId),
    ["tanguar-haor", "hakaluki-haor", "chokwe", "rondonia", "hayli-gubbi", "kilauea-episode-36", "agri-41647231453"],
  );
});

test("Tanguar figures match reference.json and pulse.json", async () => {
  const ref = await readJson<{
    validation: {
      coverage: { study_area_valid_pixels: number; common_clear_pixels: number; common_clear_fraction: number };
      metrics: { true_positive_pixels: number; false_positive_pixels: number; false_negative_pixels: number };
    };
  }>("showcase/featured/reference.json");
  const pulse = await readJson<{ peak: { date: string; area_km2: number } }>("showcase/featured/pulse.json");
  const { studies } = await loadStudyQuality();
  const tanguar = studies.find((s) => s.studyId === "tanguar-haor");
  assert.ok(tanguar);
  const overlap = tanguar.figures.find((f) => f.label === "Reference overlap");
  assert.ok(overlap);
  assert.equal(overlap.numerator, ref.validation.coverage.common_clear_pixels);
  assert.equal(overlap.denominator, ref.validation.coverage.study_area_valid_pixels);
  assert.equal(overlap.fraction, ref.validation.coverage.common_clear_fraction);
  assert.equal(overlap.valueText, "3,880 of 1,166,097 valid pixels");
  const agreement = tanguar.figures.find((f) => f.label === "Reference agreement");
  assert.ok(agreement);
  assert.equal(agreement.numerator, ref.validation.metrics.true_positive_pixels);
  assert.match(agreement.valueText, /TP 0 · FP 23 · FN 29/);
  const candidate = tanguar.figures.find((f) => f.label === "Radar candidate");
  assert.ok(candidate);
  assert.match(candidate.valueText, new RegExp(`peak ${pulse.peak.area_km2} km² on ${pulse.peak.date}`));
});

test("Hakaluki figures match case_study.json, evidence.json and publication.json", async () => {
  const evidence = await readJson<{
    optical_support: { precision: number; recall: number; f1: number; common_clear_fraction: number };
  }>("studies/releases/2026.10.07/runs/d6e65a58802e4cf4907ddefa42a435d6/date_checks/2026-09-27/evidence.json");
  const publication = await readJson<{ artifacts: Record<string, { sha256: string }> }>(
    "studies/releases/2026.10.07/runs/d6e65a58802e4cf4907ddefa42a435d6/publication.json",
  );
  const { studies } = await loadStudyQuality();
  const hakaluki = studies.find((s) => s.studyId === "hakaluki-haor");
  assert.ok(hakaluki);
  const headline = hakaluki.figures.find((f) => f.label === "Headline pair overlap");
  assert.ok(headline);
  assert.equal(headline.valueText, "9 of 1,729,130 valid pixels");
  assert.equal(headline.sourceField, "reference_validation.coverage.common_clear_pixels / study_area_valid_pixels");
  const check = hakaluki.figures.find((f) => f.label === "27 Sep 2026 date check");
  assert.ok(check);
  assert.equal(check.fraction, evidence.optical_support.common_clear_fraction);
  assert.match(check.valueText, /Precision 12\.9% · recall 5\.2% · F1 7\.4%/);
  const prints = hakaluki.figures.find((f) => f.label === "File fingerprints");
  assert.ok(prints);
  assert.equal(prints.denominator, Object.keys(publication.artifacts).length);
  assert.equal(prints.valueText, "81 of 81 recorded SHA-256 digests match");
});

test("Chókwè figures match case_study.json and its digests verify", async () => {
  const { studies } = await loadStudyQuality();
  const chokwe = studies.find((s) => s.studyId === "chokwe");
  assert.ok(chokwe);
  const candidate = chokwe.figures.find((f) => f.label === "Radar candidate");
  assert.ok(candidate);
  assert.equal(candidate.valueText, "127 patches · 29.872 km²");
  const prints = chokwe.figures.find((f) => f.label === "File fingerprints");
  assert.ok(prints);
  assert.equal(prints.valueText, "24 of 24 recorded SHA-256 digests match");
});

test("Rondônia, volcano and Naogaon figures match their study files", async () => {
  const { studies } = await loadStudyQuality();
  const rondonia = studies.find((s) => s.studyId === "rondonia");
  assert.ok(rondonia);
  const overlap = rondonia.figures.find((f) => f.label === "Optical support overlap");
  assert.ok(overlap);
  assert.equal(overlap.fraction, 0.7109374744204608);

  const hayli = studies.find((s) => s.studyId === "hayli-gubbi");
  assert.ok(hayli);
  assert.match(hayli.figures[0]?.valueText ?? "", /5 pairs — 3 NISAR GUNW \+ 2 Sentinel-1 ARIA GUNW/);
  assert.equal(hayli.figures[1]?.status, "not-recorded");

  const kilauea = studies.find((s) => s.studyId === "kilauea-episode-36");
  assert.ok(kilauea);
  assert.match(kilauea.figures[0]?.valueText ?? "", /1 GUNW pair — 2025-11-03 → 2025-11-15/);

  const naogaon = studies.find((s) => s.studyId === "agri-41647231453");
  assert.ok(naogaon);
  const coverage = naogaon.figures.find((f) => f.label === "Valid-pixel coverage");
  assert.ok(coverage);
  assert.equal(coverage.valueText, "1,338 of 6,278 pixels valid (21.3%)");
  assert.equal(coverage.numerator, 1338);
  assert.equal(coverage.denominator, 6278);
  const change = naogaon.figures.find((f) => f.label === "Soil-moisture change");
  assert.ok(change);
  assert.match(change.valueText, /Median \+0\.0328 m³\/m³/);
});

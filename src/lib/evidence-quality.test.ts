import test from "node:test";
import assert from "node:assert/strict";
import {
  allStudyQuality,
  qualityBarWidth,
  studyQuality,
} from "./evidence-quality";

test("all seven published investigations have quality figures", () => {
  const all = allStudyQuality();
  assert.equal(all.length, 7);
  assert.deepEqual(
    all.map((s) => s.studyId),
    [
      "tanguar-haor",
      "hakaluki-haor",
      "chokwe",
      "rondonia",
      "hayli-gubbi",
      "kilauea-episode-36",
      "agri-41647231453",
    ],
  );
});

test("Tanguar keeps computed zeros distinct from missing data", () => {
  const tanguar = studyQuality("tanguar-haor");
  assert.ok(tanguar);
  const overlap = tanguar.figures.find((f) => f.label === "Reference overlap");
  assert.ok(overlap);
  assert.equal(overlap.valueText, "3,880 of 1,166,097 valid pixels");
  assert.equal(overlap.status, "inconclusive");
  const agreement = tanguar.figures.find((f) => f.label === "Reference agreement");
  assert.ok(agreement);
  // Computed zeros, not nulls: the denominator is recorded.
  assert.match(agreement.valueText, /TP 0 · FP 23 · FN 29/);
  assert.equal(agreement.status, "recorded");
});

test("Hakaluki headline and date-check metrics stay attributed to the right assessment", () => {
  const hakaluki = studyQuality("hakaluki-haor");
  assert.ok(hakaluki);
  const headline = hakaluki.figures.find((f) => f.label === "Headline pair overlap");
  assert.ok(headline);
  assert.equal(headline.valueText, "9 of 1,729,130 valid pixels");
  assert.equal(headline.status, "inconclusive");
  const check = hakaluki.figures.find((f) => f.label === "27 Sep 2026 date check");
  assert.ok(check);
  assert.match(check.valueText, /Precision 12\.9% · recall 5\.2% · F1 7\.4%/);
  assert.equal(check.status, "recorded");
  // The date-check fraction is the assessed coverage, not the headline's.
  assert.ok(check.fraction !== null && check.fraction > 0.5);
  assert.ok(headline.fraction !== null && headline.fraction < 0.00001);
});

test("Hakaluki fingerprints are 81 of 81, not a claim about a separate checksum file", () => {
  const hakaluki = studyQuality("hakaluki-haor");
  const prints = hakaluki?.figures.find((f) => f.label === "File fingerprints");
  assert.ok(prints);
  assert.equal(prints.valueText, "81 of 81 recorded SHA-256 digests match");
  assert.equal(prints.fraction, 1);
});

test("Naogaon valid-pixel coverage and change are the published values", () => {
  const naogaon = studyQuality("agri-41647231453");
  assert.ok(naogaon);
  const coverage = naogaon.figures.find((f) => f.label === "Valid-pixel coverage");
  assert.ok(coverage);
  assert.equal(coverage.valueText, "1,338 of 6,278 pixels valid (21.3%)");
  assert.ok(coverage.fraction !== null && Math.abs(coverage.fraction - 0.2131) < 0.001);
  const change = naogaon.figures.find((f) => f.label === "Soil-moisture change");
  assert.ok(change);
  assert.match(change.valueText, /Median \+0\.0328 m³\/m³/);
  assert.match(change.meaning, /not crop stress/);
});

test("Rondônia candidate and optical overlap are the published frame values", () => {
  const rondonia = studyQuality("rondonia");
  assert.ok(rondonia);
  const candidate = rondonia.figures.find((f) => f.label === "Radar candidate");
  assert.ok(candidate);
  assert.match(candidate.valueText, /0\.0128 km²/);
  const overlap = rondonia.figures.find((f) => f.label === "Optical support overlap");
  assert.ok(overlap);
  assert.match(overlap.valueText, /71\.1%/);
  assert.ok(overlap.fraction !== null && Math.abs(overlap.fraction - 0.7109) < 0.001);
});

test("Volcano figures never present LOS as vertical displacement", () => {
  const hayli = studyQuality("hayli-gubbi");
  const vertical = hayli?.figures.find((f) => f.label === "Vertical displacement");
  assert.ok(vertical);
  assert.equal(vertical.status, "not-recorded");
  assert.match(vertical.meaning, /must not be read as confirmed vertical movement/);
});

test("unknown study returns null instead of invented figures", () => {
  assert.equal(studyQuality("no-such-study"), null);
});

test("quality bar width keeps a real zero visible and caps at 100%", () => {
  assert.equal(qualityBarWidth(0), "4.0%");
  assert.equal(qualityBarWidth(null), "0%");
  assert.equal(qualityBarWidth(1), "100.0%");
  assert.equal(qualityBarWidth(0.0033273389778037334), "4.0%");
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildCapsule, capsuleFilename } from "./investigation-capsule";
import type { CapsuleInput } from "./investigation-capsule";

function baseInput(overrides: Partial<CapsuleInput> = {}): CapsuleInput {
  return {
    studyId: "tanguar-haor",
    studyName: "Tanguar Haor",
    domain: "wetland",
    href: "/wetland",
    product: "NISAR_L2_GCOV_PROVISIONAL_V1",
    productMaturity: "PROVISIONAL",
    runId: "3b01cdb5674a44ea9c6c3d17ec8c07b8",
    publishedAt: "2026-10-09T07:22:11.751917+00:00",
    observationDates: ["2026-06-18", "2026-08-29"],
    stagesReached: ["catalogue", "observations", "processing", "exploratory"],
    stagesTotal: 8,
    validationNote: "HLS optical comparison is inconclusive.",
    nextStep: "A conclusive independent reference is needed.",
    checksumsPresent: true,
    quality: [
      {
        label: "Reference overlap",
        valueText: "3,880 of 1,166,097 valid pixels",
        fraction: 0.0033273389778037334,
        meaning: "Below the 20% floor.",
        status: "inconclusive",
        source: "public/showcase/featured/reference.json (coverage)",
      },
    ],
    references: [
      {
        label: "NASA HLS optical comparison",
        status: "INCONCLUSIVE",
        summary: "Common clear coverage 0.333%, below the 20% floor.",
        sourceUrl: "https://hls.gsfc.nasa.gov/data-products/",
      },
    ],
    limitations: ["A radar-change candidate is not confirmed inundation."],
    method: "hh-hv-change-v1",
    siteBounds: [90.96007981, 25.08921642, 91.12858785, 25.18931362],
    ...overrides,
  };
}

test("capsule carries every required section for a complete study", () => {
  const capsule = buildCapsule(baseInput());
  assert.equal(capsule.capsuleVersion, 1);
  assert.equal(capsule.study.id, "tanguar-haor");
  assert.equal(capsule.study.runId, "3b01cdb5674a44ea9c6c3d17ec8c07b8");
  assert.equal(capsule.study.method, "hh-hv-change-v1");
  assert.deepEqual(capsule.study.siteBounds, [90.96007981, 25.08921642, 91.12858785, 25.18931362]);
  assert.equal(capsule.maturity.stagesReached.length, 4);
  assert.equal(capsule.maturity.stagesTotal, 8);
  assert.equal(capsule.quality.length, 1);
  assert.equal(capsule.references.length, 1);
  assert.equal(capsule.limitations.length, 1);
  assert.equal(capsule.integrity.checksumsPublished, true);
});

test("a complete study is verifiable — but the note never promises one-click reproduction", () => {
  const capsule = buildCapsule(baseInput());
  assert.equal(capsule.reproducibility.status, "verifiable");
  assert.match(capsule.reproducibility.note, /does not reproduce the result on its own/);
  assert.ok(capsule.reproducibility.requires.some((r) => r.includes("Earthdata")));
});

test("missing checksums and run ID downgrade reproducibility instead of being hidden", () => {
  const capsule = buildCapsule(baseInput({ checksumsPresent: false, runId: null }));
  assert.equal(capsule.reproducibility.status, "not-verifiable");
  assert.match(capsule.integrity.verification, /cannot be independently verified/);
  assert.equal(capsule.study.runId, null);
});

test("partial trail is labelled partial, not verifiable", () => {
  const capsule = buildCapsule(baseInput({ checksumsPresent: true, runId: null }));
  assert.equal(capsule.reproducibility.status, "partial");
});

test("validation note is copied, never upgraded", () => {
  const capsule = buildCapsule(baseInput());
  assert.equal(capsule.validation.note, "HLS optical comparison is inconclusive.");
});

test("capsule filenames are safe and study-specific", () => {
  assert.equal(capsuleFilename("tanguar-haor"), "beyonders-capsule-tanguar-haor.json");
  assert.equal(capsuleFilename("Kīlauea Episode 36"), "beyonders-capsule-k-lauea-episode-36.json");
  assert.equal(capsuleFilename(""), "beyonders-capsule-study.json");
});

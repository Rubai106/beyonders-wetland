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
    integrity: "PUBLISHED_NOT_VERIFIED",
    digests: { "manifest.json": "9f86d081884c7d659a2feaa0c55ad015" },
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
  assert.equal(capsule.integrity.state, "PUBLISHED_NOT_VERIFIED");
  assert.deepEqual(capsule.integrity.digests, { "manifest.json": "9f86d081884c7d659a2feaa0c55ad015" });
});

test("a complete study is artifact-verifiable — never 'reproducible'", () => {
  const capsule = buildCapsule(baseInput());
  assert.equal(capsule.reproducibility.status, "artifact-verifiable");
  // The note must say what artifact-verifiable means and what it does not.
  assert.match(capsule.reproducibility.note, /checks integrity, not reproduction/);
  assert.match(capsule.reproducibility.note, /re-deriving the result needs/);
  assert.ok(capsule.reproducibility.requires.some((r) => r.includes("Earthdata")));
  // A declaration is not proof of verification.
  assert.match(capsule.integrity.verification, /have not been re-verified in this session/);
});

test("a verified integrity state says so explicitly", () => {
  const capsule = buildCapsule(baseInput({ integrity: "VERIFIED" }));
  assert.match(capsule.integrity.verification, /re-hashed and matched/);
});

test("missing checksums and run ID downgrade reproducibility instead of being hidden", () => {
  const capsule = buildCapsule(
    baseInput({ checksumsPresent: false, runId: null, integrity: "NOT_PUBLISHED", digests: null }),
  );
  assert.equal(capsule.reproducibility.status, "not-verifiable");
  assert.match(capsule.integrity.verification, /cannot be independently verified/);
  assert.equal(capsule.integrity.state, "NOT_PUBLISHED");
  assert.equal(capsule.integrity.digests, null);
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

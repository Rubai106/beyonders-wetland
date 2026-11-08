import test from "node:test";
import assert from "node:assert/strict";
import {
  diagnosticEvidence,
  HYPOTHESIS_STUDIES,
  inconsistencyCount,
  rankHypotheses,
  type HypothesisStudy,
  type RatingMap,
} from "./hypotheses";

test("all seven studies have hypotheses, evidence, and seeded ratings", () => {
  assert.equal(HYPOTHESIS_STUDIES.length, 7);
  for (const s of HYPOTHESIS_STUDIES) {
    assert.ok(s.hypotheses.length >= 2, `${s.studyId} needs hypotheses`);
    assert.ok(s.evidence.length >= 3, `${s.studyId} needs evidence`);
    for (const e of s.evidence) {
      for (const h of s.hypotheses) {
        assert.ok(["consistent", "inconsistent", "neutral"].includes(s.assessments[e.id]?.[h.id] ?? "missing"), `${s.studyId}/${e.id}/${h.id}`);
      }
    }
    for (const h of s.hypotheses) {
      assert.ok(h.falsifier.length > 20, `${s.studyId}/${h.id} needs a falsifier`);
      assert.ok(h.claim.length > 20, `${s.studyId}/${h.id} needs a claim`);
    }
  }
});

test("ACH ranks by fewest inconsistencies on the seeded Tanguar matrix", () => {
  const tanguar = HYPOTHESIS_STUDIES.find((s) => s.studyId === "tanguar-haor") as HypothesisStudy;
  const empty: RatingMap = {};
  const counts = inconsistencyCount(tanguar, empty);
  // flood: confusion only (1). managed-water: 0. artefact: peak, darkening, persistence (3).
  assert.deepEqual(counts, { flood: 1, "managed-water": 0, artefact: 3 });
  const ranked = rankHypotheses(tanguar, empty);
  assert.equal(ranked[0].hypothesis.id, "managed-water");
  assert.equal(ranked[ranked.length - 1].hypothesis.id, "artefact");
});

test("user overrides replace seeded ratings", () => {
  const tanguar = HYPOTHESIS_STUDIES.find((s) => s.studyId === "tanguar-haor") as HypothesisStudy;
  const ratings: RatingMap = { "tanguar-haor": { peak: { flood: "inconsistent" } } };
  const counts = inconsistencyCount(tanguar, ratings);
  assert.equal(counts.flood, 2);
});

test("diagnostic evidence is where hypotheses disagree", () => {
  const rondonia = HYPOTHESIS_STUDIES.find((s) => s.studyId === "rondonia") as HypothesisStudy;
  const diagnostic = diagnosticEvidence(rondonia, {}).map((e) => e.id);
  assert.ok(diagnostic.includes("persistence"));
  assert.ok(diagnostic.includes("hls"));
  assert.ok(!diagnostic.includes("one-candidate"));
  assert.ok(!diagnostic.includes("no-reference"));
});

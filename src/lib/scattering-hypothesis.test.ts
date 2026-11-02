import assert from "node:assert/strict";
import test from "node:test";
import { buildScatteringHypothesisAssessment } from "./scattering-hypothesis";
import type { WetlandPatch } from "./types";

function patch(overrides: Partial<WetlandPatch> = {}): WetlandPatch {
  return {
    id: "candidate-001",
    date: "2026-01-17",
    area_km2: 1,
    mean_delta_db: -3,
    median_delta_db: -3,
    valid_fraction: 0.92,
    vegetated_fraction: 0.4,
    classification: "OPEN_WATER",
    quality_status: "PASS",
    spatial_status: "PASS",
    temporal_status: "PASS",
    threshold_stability: "STABLE",
    temporal_overlap_fraction: 0.7,
    baseline_observation_count: 1,
    evidence_state: "SUPPORTED",
    hh_before: -15,
    hh_after: -18,
    hv_before: -22,
    hv_after: -22.4,
    delta_hh: -3,
    delta_hv: -0.4,
    centroid: [-24.5, 33],
    ...overrides,
  };
}

test("open-water class is reported as a detector-selected signature, not confirmed water", () => {
  const result = buildScatteringHypothesisAssessment(patch());
  const openWater = result.hypotheses.find((item) => item.id === "open-water");
  assert.equal(openWater?.status, "DETECTOR_SIGNATURE_SELECTED");
  assert.match(openWater?.candidateReadout ?? "", /not a verified water observation/i);
  assert.equal(result.measurements.find((item) => item.id === "hh-change")?.value, -3);
});

test("vegetated-inundation class selects only its existing detector signature", () => {
  const result = buildScatteringHypothesisAssessment(patch({
    classification: "VEGETATED_INUNDATION",
    delta_hh: 2.2,
    delta_hv: 0.2,
  }));
  assert.equal(result.hypotheses.find((item) => item.id === "flooded-vegetation")?.status, "DETECTOR_SIGNATURE_SELECTED");
  assert.match(result.hypotheses.find((item) => item.id === "flooded-vegetation")?.limitation ?? "", /not unique/i);
  assert.equal(result.hypotheses.find((item) => item.id === "open-water")?.status, "NOT_SELECTED_BY_DETECTOR");
});

test("soil moisture and vegetation-surface mechanisms remain unresolved for every detector class", () => {
  for (const classification of ["OPEN_WATER", "VEGETATED_INUNDATION", "UNCERTAIN"] as const) {
    const result = buildScatteringHypothesisAssessment(patch({ classification }));
    assert.equal(result.hypotheses.find((item) => item.id === "soil-moisture")?.status, "NOT_DISTINGUISHED");
    assert.equal(result.hypotheses.find((item) => item.id === "vegetation-surface")?.status, "NOT_DISTINGUISHED");
  }
});

test("uncertain detector class does not promote either inundation mechanism", () => {
  const result = buildScatteringHypothesisAssessment(patch({ classification: "UNCERTAIN" }));
  assert.equal(result.hypotheses.find((item) => item.id === "open-water")?.status, "NOT_SELECTED_BY_DETECTOR");
  assert.equal(result.hypotheses.find((item) => item.id === "flooded-vegetation")?.status, "NOT_SELECTED_BY_DETECTOR");
});

test("single-observation baseline and invalid coverage remain explicit", () => {
  const result = buildScatteringHypothesisAssessment(patch({
    baseline_observation_count: 1,
    valid_fraction: 0.65,
  }));
  assert.ok(result.guardrails.some((item) => /one baseline observation/i.test(item)));
  assert.ok(result.guardrails.some((item) => /unassessed pixels/i.test(item)));
});

test("missing or non-finite measurements remain unreported rather than fabricated", () => {
  const result = buildScatteringHypothesisAssessment(patch({
    delta_hh: Number.NaN,
    delta_hv: Number.POSITIVE_INFINITY,
    vegetated_fraction: Number.NaN,
  }));
  assert.equal(result.measurements.find((item) => item.id === "hh-change")?.value, null);
  assert.equal(result.measurements.find((item) => item.id === "hv-change")?.value, null);
  assert.equal(result.measurements.find((item) => item.id === "vegetated-fraction")?.value, null);
});

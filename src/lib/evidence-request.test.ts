import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidenceRequest } from "./evidence-request";
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

const geometry = {
  type: "Polygon" as const,
  coordinates: [[
    [32.9, -24.6],
    [33.1, -24.6],
    [33.1, -24.4],
    [32.9, -24.4],
    [32.9, -24.6],
  ]],
};

function getQuery(searchUrl: string): URLSearchParams {
  return new URL(searchUrl).searchParams;
}

test("open-water request builds product-specific DSWx collection URLs with candidate bounds", () => {
  const request = buildEvidenceRequest(patch({ geometry }), "open-water");
  assert.equal(request.archiveSearches.length, 2);
  const hls = request.archiveSearches[0];
  const query = getQuery(hls.queryUrl);
  assert.equal(query.get("short_name"), "OPERA_L3_DSWX-HLS_V1");
  assert.equal(query.get("version"), "1.0");
  assert.equal(query.has("bounding_box"), true);
  assert.equal(query.has("point"), false);
  assert.equal(request.spatialSearch.method, "candidate-bounding-box");
  assert.deepEqual(request.spatialSearch.boundingBox, [32.9, -24.6, 33.1, -24.4]);
});

test("centroid-only fallback is explicit and the CMR point uses longitude, latitude order", () => {
  const request = buildEvidenceRequest(patch(), "open-water");
  assert.equal(request.spatialSearch.method, "candidate-centroid-only");
  assert.match(request.spatialSearch.interpretation, /does not represent the full candidate footprint/i);
  const query = getQuery(request.archiveSearches[0].queryUrl);
  assert.equal(query.get("point"), "33.000000,-24.500000");
});

test("date window is an explicit UTC discovery range and can cross year boundaries", () => {
  const request = buildEvidenceRequest(patch({ date: "2026-01-01" }), "soil-moisture", 3);
  assert.equal(request.temporalSearch?.startUtc, "2025-12-29T00:00:00Z");
  assert.equal(request.temporalSearch?.endUtc, "2026-01-04T23:59:59Z");
  assert.match(request.temporalSearch?.interpretation ?? "", /not a validation threshold/i);
  assert.equal(getQuery(request.archiveSearches[0].queryUrl).get("temporal[]"), "2025-12-29T00:00:00Z,2026-01-04T23:59:59Z");
});

test("soil-moisture request marks SMAP as coarse context and NISAR SME2 as same-mission provisional context", () => {
  const request = buildEvidenceRequest(patch(), "soil-moisture");
  assert.equal(request.archiveSearches[0].shortName, "SPL4SMGP");
  assert.equal(request.archiveSearches[0].version, "008");
  assert.match(request.archiveSearches[0].limitation, /9 km grid cell/i);
  assert.equal(request.archiveSearches[1].shortName, "NISAR_L3_SME2_PROVISIONAL_V1");
  assert.match(request.archiveSearches[1].limitation, /same NISAR mission/i);
});

test("flooded-vegetation and vegetation-surface requests select relevant evidence products", () => {
  const flooded = buildEvidenceRequest(patch(), "flooded-vegetation");
  assert.equal(flooded.archiveSearches[0].shortName, "OPERA_L3_DSWX-S1_V1");
  assert.equal(flooded.archiveSearches[1].shortName, "HLSS30_VI");
  const surface = buildEvidenceRequest(patch(), "vegetation-surface");
  assert.deepEqual(surface.archiveSearches.map((item) => item.shortName), ["HLSS30_VI", "HLSL30_VI"]);
});

test("multipolygon bounds include all outer rings, while the request retains the original geometry", () => {
  const multi = {
    type: "MultiPolygon" as const,
    coordinates: [
      [[[32.0, -25.0], [32.1, -25.0], [32.1, -24.9], [32.0, -24.9], [32.0, -25.0]]],
      [[[33.0, -24.0], [33.1, -24.0], [33.1, -23.9], [33.0, -23.9], [33.0, -24.0]]],
    ],
  };
  const request = buildEvidenceRequest(patch({ geometry: multi }), "open-water");
  assert.deepEqual(request.spatialSearch.boundingBox, [32, -25, 33.1, -23.9]);
  assert.deepEqual(request.candidate.geometry, multi);
  assert.match(request.spatialSearch.interpretation, /gaps between multipart regions/i);
});

test("invalid date prevents archive URLs rather than inventing a time range", () => {
  const request = buildEvidenceRequest(patch({ date: "not-a-date" }), "open-water");
  assert.equal(request.temporalSearch, null);
  assert.equal(request.archiveSearches.length, 0);
  assert.ok(request.warnings.some((warning) => /valid YYYY-MM-DD/i.test(warning)));
});

test("invalid geometry uses centroid only; invalid centroid blocks spatial searches", () => {
  const invalidGeometry = { type: "Polygon" as const, coordinates: [[[5, 5], [5, 5], [5, 5]]] };
  const fallback = buildEvidenceRequest(patch({ geometry: invalidGeometry }), "open-water");
  assert.equal(fallback.spatialSearch.method, "candidate-centroid-only");
  const noSpace = buildEvidenceRequest(patch({ centroid: [999, 999] }), "open-water");
  assert.equal(noSpace.spatialSearch.method, "unavailable");
  assert.equal(noSpace.archiveSearches.length, 0);
});

test("request IDs are reproducible and include the candidate and selected hypothesis", () => {
  const a = buildEvidenceRequest(patch(), "soil-moisture", 7);
  const b = buildEvidenceRequest(patch(), "soil-moisture", 7);
  assert.equal(a.requestId, b.requestId);
  assert.match(a.requestId, /candidate-001-2026-01-17-soil-moisture/);
});

test("support, challenge and review requirements are all included in the request", () => {
  const request = buildEvidenceRequest(patch(), "open-water");
  assert.ok(request.evidenceThatCouldSupport.length >= 2);
  assert.ok(request.evidenceThatCouldChallenge.length >= 2);
  assert.ok(request.minimumReviewProtocol.some((item) => /positive and negative/i.test(item)));
  assert.ok(request.guardrails.some((item) => /field confirmation/i.test(item)));
});

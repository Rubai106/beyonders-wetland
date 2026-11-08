// Run: npm test   (node's built-in runner; no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformHealth, MATURITY_STAGES } from "./observation-health.ts";

test("platform health reads the real published manifests", async () => {
  const health = await buildPlatformHealth();
  assert.equal(health.domains.length, 4);
  const byDomain = Object.fromEntries(health.domains.map((d) => [d.domain, d.studies]));
  // Tanguar + Hakaluki + Chókwè (Phase 4: Chókwè was a published
  // investigation missing from observability despite completed processing)
  assert.equal(byDomain.wetland.length, 3);
  const tanguar = byDomain.wetland.find((s) => s.id === "tanguar-haor");
  assert.ok(tanguar);
  assert.equal(tanguar.observationDates.length, 7);
  assert.equal(tanguar.state, "INCONCLUSIVE_VALIDATION");
  assert.equal(tanguar.checksumsPresent, true);
  const hakaluki = byDomain.wetland.find((s) => s.id === "hakaluki-haor");
  assert.ok(hakaluki);
  // Hakaluki's checksum record lives in its publication.json artifact map
  // (81 per-file SHA-256 digests), not a standalone checksums file.
  assert.equal(hakaluki.checksumsPresent, true);
  const chokwe = byDomain.wetland.find((s) => s.id === "chokwe");
  assert.ok(chokwe);
  assert.equal(chokwe.state, "INCONCLUSIVE_VALIDATION");
  assert.equal(chokwe.product, "NISAR_L2_GCOV_BETA_V1");
  assert.equal(chokwe.runId, "ec8fa5ee15ae41d1aa89f930f2b47e36");
  // Chókwè's checksum record lives in its publication.json artifact map
  // (24 per-file SHA-256 digests, verified 2026-11-08).
  assert.equal(chokwe.checksumsPresent, true);
  assert.ok(!chokwe.stages.includes("validation"));
  // Rondônia
  assert.equal(byDomain.forest.length, 1);
  assert.equal(byDomain.forest[0].name, "Rondônia");
  // Hayli Gubbi + Kīlauea
  assert.equal(byDomain.volcano.length, 2);
  // Naogaon
  assert.equal(byDomain.agriculture.length, 1);
  const naogaon = byDomain.agriculture[0];
  assert.equal(naogaon.id, "agri-41647231453");
  assert.equal(naogaon.observationDates.length, 6);
  assert.equal(naogaon.evidenceStatus, "EXPLORATORY");
  // No independent reference stage for agriculture yet
  assert.ok(!naogaon.stages.includes("reference"));
  assert.ok(!naogaon.stages.includes("validation"));
});

test("maturity ladder has eight distinct stages and no invented score", () => {
  assert.equal(MATURITY_STAGES.length, 8);
  const ids = new Set(MATURITY_STAGES.map((s) => s.id));
  assert.equal(ids.size, 8);
  assert.ok(MATURITY_STAGES.some((s) => s.id === "validation"));
  assert.ok(MATURITY_STAGES.some((s) => s.id === "reproducible"));
});

test("missing manifests are reported, not silently dropped", async () => {
  const health = await buildPlatformHealth();
  assert.ok(Array.isArray(health.missing));
  // All seven expected publications exist in this checkout.
  assert.deepEqual(health.missing, []);
  const total = health.domains.reduce((n, d) => n + d.studies.length, 0);
  assert.equal(total, 7);
});

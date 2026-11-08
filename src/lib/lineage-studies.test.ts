import assert from "node:assert/strict";
import test from "node:test";
import { loadLineageChains } from "./lineage-studies";
import { buildLineageGraph } from "./evidence-lineage";

test("Lineage loader builds one chain per published study from real manifests", async () => {
  const { chains, unavailable } = await loadLineageChains();
  assert.deepEqual(unavailable, [], "every published study must load; failures are reported, not hidden");
  assert.equal(chains.length, 7);

  const tanguar = chains.find((chain) => chain.site_name === "Tanguar Haor mapped boundary");
  assert.ok(tanguar, "Tanguar chain present");
  assert.equal(tanguar.observations.length, 7);
  assert.ok(tanguar.observations.every((item) => item.source_id?.startsWith("NISAR_L2_PR_GCOV")));
  assert.equal(tanguar.references[0]?.status, "INCONCLUSIVE");
  // Tanguar's headline metrics are computed zeros (TP 0, FP 23, FN 29 over
  // 3,880 common-clear pixels) — not nulls. Still inconclusive: coverage
  // 0.333% is below the 20% floor.
  assert.equal(tanguar.references[0]?.f1, 0);
  assert.equal(tanguar.references[0]?.precision, 0);
  const tanguarArea = tanguar.measurements.find((item) => item.id === "candidate-area");
  assert.ok(tanguarArea && Math.abs((tanguarArea.value ?? 0) - 24.477) < 0.001);

  const hakaluki = chains.find((chain) => chain.site_name === "Hakaluki Haor");
  assert.ok(hakaluki, "Hakaluki chain present");
  assert.equal(hakaluki.observations.length, 7);
  // Two references: the unassessable headline pair AND the assessed date check.
  assert.equal(hakaluki.references.length, 2);
  const headline = hakaluki.references[0];
  assert.equal(headline?.status, "INCONCLUSIVE");
  assert.equal(headline?.f1, null);
  assert.equal(headline?.precision, null);
  const dateCheck = hakaluki.references[1];
  assert.equal(dateCheck?.status, "WEAK_AGREEMENT");
  assert.ok(dateCheck && Math.abs((dateCheck.precision ?? 0) - 0.1288) < 0.0001);
  assert.ok(dateCheck && Math.abs((dateCheck.recall ?? 0) - 0.0522) < 0.0001);
  assert.ok(dateCheck && Math.abs((dateCheck.f1 ?? 0) - 0.0743) < 0.0001);
  assert.ok(dateCheck && Math.abs((dateCheck.common_coverage_fraction ?? 0) - 0.5072) < 0.001);

  const chokwe = chains.find((chain) => chain.site_name.includes("Chokwe"));
  assert.ok(chokwe, "Chókwè chain present");
  assert.equal(chokwe.product_maturity, "BETA");
  assert.equal(chokwe.state, "INCONCLUSIVE");

  const forest = chains.find((chain) => chain.module === "forest");
  assert.ok(forest, "Rondônia chain present");
  assert.ok(forest.observations.length >= 1);
  assert.ok(forest.observations.every((item) => item.source_id !== null));

  const hayli = chains.find((chain) => chain.study_id === "hayli-gubbi");
  assert.ok(hayli, "Hayli Gubbi chain present");
  assert.equal(hayli.observations.length, 5, "current v3 study has 5 pairs (3 NISAR + 2 Sentinel-1)");
  assert.ok(hayli.observations.every((item) => item.source_id !== null));
  assert.equal(hayli.observations.filter((item) => item.sensor === "NISAR").length, 3);
  assert.equal(hayli.observations.filter((item) => item.sensor === "Sentinel-1").length, 2);

  const kilauea = chains.find((chain) => chain.study_id === "kilauea-episode-36-2025");
  assert.ok(kilauea, "Kīlauea chain present");
  assert.equal(kilauea.observations.length, 1);

  const naogaon = chains.find((chain) => chain.study_id === "agri-41647231453");
  assert.ok(naogaon, "Naogaon chain present");
  assert.equal(naogaon.observations.length, 6);

  // Every chain graphs cleanly: no edge points at a missing node.
  for (const chain of chains) {
    const graph = buildLineageGraph(chain);
    const ids = new Set(graph.nodes.map((node) => node.id));
    for (const edge of graph.edges) {
      assert.ok(ids.has(edge.from), `${chain.study_title}: edge from ${edge.from}`);
      assert.ok(ids.has(edge.to), `${chain.study_title}: edge to ${edge.to}`);
    }
    assert.ok(graph.nodes.some((node) => node.kind === "provenance"));
  }
});

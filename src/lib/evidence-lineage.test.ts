import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildAgricultureEvidenceChain,
  buildWetlandEvidenceChain,
} from "./evidence-chain";
import type { AgricultureStudy } from "./agriculture-study";
import {
  LINEAGE_COLUMNS,
  buildLineageGraph,
  layoutLineageGraph,
  truncateLineageText,
} from "./evidence-lineage";

const chokweChain = () =>
  buildWetlandEvidenceChain({
    run_id: "chokwe-run",
    site_name: "Chókwè",
    data_source: "NISAR",
    product: "NISAR_L2_GCOV",
    product_maturity: "BETA",
    baseline_date: "2026-01-05",
    baseline_observation_dates: ["2026-01-05"],
    selected_date: "2026-01-17",
    polarizations: ["HH"],
    dates: ["2026-01-05", "2026-01-17"],
    reference_check_status: "INCONCLUSIVE_COVERAGE",
    case_study: {
      title: "Chókwè event case",
      site: "Chókwè",
      baseline_date: "2026-01-05",
      event_date: "2026-01-17",
      candidate_patches: 127,
      candidate_area_km2: 29.87,
      method: { open_water_rule: "HH darkening screen", threshold_db: -2.5 },
    },
    reference_validation: {
      status: "INCONCLUSIVE_COVERAGE",
      reference_product: "NASA HLS",
      comparison: {
        baseline: { nisar_date: "2026-01-05", hls_date: "2026-01-07", offset_days: 2 },
        event: { nisar_date: "2026-01-17", hls_date: "2026-01-22", offset_days: 5 },
      },
      coverage: { common_clear_fraction: 0.0126 },
      optical_support: { common_clear_fraction: 0.0126, candidate_assessed_fraction: 0 },
      reason: "Only 1.26% common-clear coverage; candidates remain unassessed.",
      limitations: ["No candidate area was assessed by HLS."],
    },
  });

test("Lineage columns carry evidence families for measured, derived and reference data", () => {
  const groups = new Set(LINEAGE_COLUMNS.map((column) => column.group));
  for (const group of ["derived", "process", "measured", "reference", "record"]) {
    assert.ok(groups.has(group as never), `column group ${group} must be present`);
  }
  assert.equal(LINEAGE_COLUMNS.find((column) => column.id === "observations")?.group, "measured");
  assert.equal(LINEAGE_COLUMNS.find((column) => column.id === "result")?.group, "derived");
  assert.equal(LINEAGE_COLUMNS.find((column) => column.id === "reference")?.group, "reference");
  for (const column of LINEAGE_COLUMNS) {
    assert.ok(column.groupLabel.length > 0);
    assert.ok(column.hint.length > 0);
  }
});

test("Lineage graph traces result to provenance without invented nodes", () => {
  const graph = buildLineageGraph(chokweChain());
  const kinds = graph.nodes.map((node) => node.kind);
  assert.ok(kinds.includes("result"));
  assert.ok(kinds.includes("method"));
  assert.ok(kinds.includes("screening"));
  assert.ok(kinds.includes("observation"));
  assert.ok(kinds.includes("reference"));
  assert.ok(kinds.includes("provenance"));

  // Two real observations, one per acquisition date.
  const observations = graph.nodes.filter((node) => node.kind === "observation");
  assert.equal(observations.length, 2);
  assert.deepEqual(
    observations.map((node) => node.title),
    ["2026-01-05", "2026-01-17"],
  );

  // The inconclusive reference keeps its status; nothing is upgraded.
  const reference = graph.nodes.find((node) => node.kind === "reference");
  assert.equal(reference?.status, "inconclusive");
  assert.equal(reference?.statusLabel, "Inconclusive");
  assert.ok(reference?.details.some((item) => item.label === "Common-clear coverage" && item.value === "1.3%"));

  // Every edge endpoint is a real node.
  const ids = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    assert.ok(ids.has(edge.from), `edge from missing node ${edge.from}`);
    assert.ok(ids.has(edge.to), `edge to missing node ${edge.to}`);
  }
  // The trace order holds: result → method → screening → observation → reference → provenance.
  const edgePairs = graph.edges.map((edge) => edge.from + ">" + edge.to);
  assert.ok(edgePairs.some((pair) => pair.startsWith("result-") && pair.endsWith(">method")));
  assert.ok(edgePairs.includes("method>screening"));
  assert.ok(edgePairs.some((pair) => pair.startsWith("screening>observation-")));
  assert.ok(edgePairs.some((pair) => pair.startsWith("observation-") && pair.includes(">reference-")));
  assert.ok(edgePairs.some((pair) => pair.startsWith("reference-") && pair.endsWith(">provenance")));

  // Screening rules come from the case study, not from a template.
  const screening = graph.nodes.find((node) => node.kind === "screening");
  assert.ok(screening?.details.some((item) => item.value.includes("HH darkening screen")));
  assert.ok(screening?.details.some((item) => item.value.includes("-2.5 dB")));
});

test("Lineage graph reports missing data instead of hiding it", () => {
  const graph = buildLineageGraph(buildAgricultureEvidenceChain(null));
  assert.equal(graph.studyState, "NOT_PUBLISHED");
  assert.ok(graph.nodes.some((node) => node.id === "result-none" && node.status === "missing"));
  assert.ok(graph.nodes.some((node) => node.id === "observation-none" && node.status === "missing"));
  const ids = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    assert.ok(ids.has(edge.from));
    assert.ok(ids.has(edge.to));
  }
});

test("Lineage layout keeps nodes inside the canvas and columns apart", () => {
  const graph = buildLineageGraph(chokweChain());
  const layout = layoutLineageGraph(graph);
  assert.ok(layout.width > 0 && layout.height > 0);
  assert.equal(layout.edges.length, graph.edges.length);
  for (const positioned of layout.nodes) {
    assert.ok(positioned.x >= 0 && positioned.x + positioned.width <= layout.width);
    assert.ok(positioned.y >= 0 && positioned.y + positioned.height <= layout.height);
  }
  // Nodes in the same column never overlap.
  const byColumn = new Map<number, { y: number; height: number }[]>();
  for (const positioned of layout.nodes) {
    const list = byColumn.get(positioned.node.column) ?? [];
    list.push({ y: positioned.y, height: positioned.height });
    byColumn.set(positioned.node.column, list);
  }
  for (const list of byColumn.values()) {
    const sorted = [...list].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i].y >= sorted[i - 1].y + sorted[i - 1].height);
    }
  }
  assert.equal(LINEAGE_COLUMNS.length, 6);
  assert.equal(truncateLineageText("short", 28), "short");
  assert.ok(truncateLineageText("a".repeat(40), 28).endsWith("…"));
});

test("Real Naogaon study builds a lineage graph from its own manifest", async () => {
  const studyPath = path.join(process.cwd(), "public", "agriculture", "current", "study.json");
  const study = JSON.parse(await fs.readFile(studyPath, "utf-8")) as AgricultureStudy;
  const graph = buildLineageGraph(buildAgricultureEvidenceChain(study));

  const observations = graph.nodes.filter((node) => node.kind === "observation");
  assert.equal(observations.length, 6);
  // Every real observation carries its granule identifier.
  for (const node of observations) {
    assert.equal(node.status, "ok");
    assert.ok(node.details.some((item) => item.label === "Granule" && item.value.startsWith("NISAR_L3_PR_SME2")));
  }
  // The D-107677 zero-clear rule is in the screening node, verbatim.
  const screening = graph.nodes.find((node) => node.kind === "screening");
  assert.ok(
    screening?.details.some((item) => item.value.includes("retrievalQualityFlag = 0 as clear")),
    "screening node must carry the D-107677 zero-clear rule",
  );
  // Five measured results, including the change median.
  const results = graph.nodes.filter((node) => node.kind === "result");
  assert.equal(results.length, 5);
  assert.ok(results.some((node) => node.title.includes("Latest minus baseline")));
});

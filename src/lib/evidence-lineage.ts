/* Evidence Lineage Explorer — graph model.
 *
 * A pure, dependency-free translation of an EvidenceChain into a traceable
 * graph: RESULT → METHOD → QUALITY SCREEN → OBSERVATIONS → REFERENCE, with
 * PROVENANCE backing the result. Every node is built from a field that
 * actually exists in the chain; a missing field becomes a "not recorded"
 * node, never an invented connection. No node, edge, or value is fabricated.
 *
 * Layout is pure arithmetic (fixed node size, stacked columns) so the SVG
 * renderer needs no measurement and the layout is unit-testable.
 */
import type { EvidenceChain, EvidenceReference } from "./evidence-chain";

export type LineageNodeKind =
  | "result"
  | "method"
  | "screening"
  | "observation"
  | "reference"
  | "provenance";

export type LineageNodeStatus = "ok" | "missing" | "inconclusive" | "info";

export interface LineageDetail {
  label: string;
  value: string;
  href?: string;
}

export interface LineageNode {
  id: string;
  kind: LineageNodeKind;
  /** Trace column: 0 result, 1 method, 2 screening, 3 observations, 4 reference, 5 provenance. */
  column: number;
  title: string;
  subtitle: string;
  status: LineageNodeStatus;
  statusLabel: string;
  details: LineageDetail[];
}

export interface LineageEdge {
  from: string;
  to: string;
}

export type LineageColumnGroup = "derived" | "process" | "measured" | "reference" | "record";

export interface LineageColumn {
  id: string;
  label: string;
  hint: string;
  /** Evidence family: what kind of thing this column holds. */
  group: LineageColumnGroup;
  groupLabel: string;
}

export const LINEAGE_COLUMNS: LineageColumn[] = [
  { id: "result", label: "Result", hint: "What the study measured", group: "derived", groupLabel: "Derived" },
  { id: "method", label: "Method", hint: "How it was derived", group: "process", groupLabel: "Process" },
  { id: "screening", label: "Quality screen", hint: "What was excluded, and why", group: "process", groupLabel: "Process" },
  { id: "observations", label: "Observations", hint: "The real acquisitions behind it", group: "measured", groupLabel: "Measured" },
  { id: "reference", label: "Reference", hint: "Independent evidence, assessed honestly", group: "reference", groupLabel: "Reference" },
  { id: "provenance", label: "Provenance", hint: "Run, boundary, and sources", group: "record", groupLabel: "Record" },
];

export interface LineageGraph {
  studyId: string | null;
  studyTitle: string;
  studyState: EvidenceChain["state"];
  conclusion: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
}

const REFERENCE_STATUS_LABELS: Record<EvidenceReference["status"], string> = {
  NOT_RECORDED: "Not recorded",
  NOT_ASSESSED: "Not assessed",
  INCONCLUSIVE: "Inconclusive",
  ASSESSED_COMPARISON: "Comparison assessed",
  EXPLORATORY_SUPPORT: "Exploratory support",
  WEAK_AGREEMENT: "Weak agreement",
  CONTEXT_ONLY: "Context only",
  CROSS_SENSOR_CONTEXT: "Cross-sensor context",
};

function referenceStatus(reference: EvidenceReference): LineageNodeStatus {
  if (reference.status === "INCONCLUSIVE") return "inconclusive";
  if (reference.status === "NOT_RECORDED" || reference.status === "NOT_ASSESSED") return "missing";
  return "ok";
}

export function formatLineageValue(value: number | null, unit: string): string {
  if (value === null) return "Not recorded";
  if (unit === "fraction") return (value * 100).toFixed(1) + "%";
  if (Number.isInteger(value)) return value.toLocaleString("en") + (unit ? " " + unit : "");
  const digits = unit === "m³/m³" ? 3 : unit === "cm" || unit === "cm MAD" || unit === "dB" ? 2 : 3;
  return value.toFixed(digits) + (unit ? " " + unit : "");
}

function details(values: (LineageDetail | null)[]): LineageDetail[] {
  return values.filter((item): item is LineageDetail => item !== null);
}

export function buildLineageGraph(chain: EvidenceChain): LineageGraph {
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];

  // ── 0 · Results ──
  const resultIds: string[] = [];
  if (chain.measurements.length === 0) {
    const id = "result-none";
    resultIds.push(id);
    nodes.push({
      id,
      kind: "result",
      column: 0,
      title: "No measurements published",
      subtitle: "Nothing to trace for this study",
      status: "missing",
      statusLabel: "Not recorded",
      details: [{ label: "Note", value: chain.conclusion }],
    });
  }
  for (const signal of chain.measurements) {
    const id = "result-" + signal.id;
    resultIds.push(id);
    nodes.push({
      id,
      kind: "result",
      column: 0,
      title: signal.label,
      subtitle: formatLineageValue(signal.value, signal.unit),
      status: signal.value === null ? "missing" : "ok",
      statusLabel: signal.value === null ? "Not recorded" : "Measured",
      details: details([
        { label: "Value", value: formatLineageValue(signal.value, signal.unit) },
        { label: "What this means", value: signal.interpretation },
      ]),
    });
  }

  // ── 1 · Method ──
  const methodId = "method";
  nodes.push({
    id: methodId,
    kind: "method",
    column: 1,
    title: chain.method.id ?? "Method not recorded",
    subtitle: chain.method.summary,
    status: chain.method.id ? "ok" : "missing",
    statusLabel: chain.method.id ? "Documented" : "Not recorded",
    details: details([
      { label: "Method", value: chain.method.summary },
      chain.method.minimum_coverage_fraction !== null
        ? { label: "Minimum coverage gate", value: (chain.method.minimum_coverage_fraction * 100).toFixed(1) + "%" }
        : null,
    ]),
  });
  for (const resultId of resultIds) edges.push({ from: resultId, to: methodId });

  // ── 2 · Quality screen ──
  const screeningId = "screening";
  nodes.push({
    id: screeningId,
    kind: "screening",
    column: 2,
    title: "Quality screen",
    subtitle:
      chain.method.screening_rules.length > 0
        ? chain.method.screening_rules.length + " documented rule" + (chain.method.screening_rules.length === 1 ? "" : "s")
        : "No screening rules recorded",
    status: chain.method.screening_rules.length > 0 ? "ok" : "missing",
    statusLabel: chain.method.screening_rules.length > 0 ? "Documented" : "Not recorded",
    details:
      chain.method.screening_rules.length > 0
        ? chain.method.screening_rules.map((rule, index) => ({ label: "Rule " + (index + 1), value: rule }))
        : [{ label: "Note", value: "No quality-screening rules are recorded for this study." }],
  });
  edges.push({ from: methodId, to: screeningId });

  // ── 3 · Observations ──
  const observationIds: string[] = [];
  if (chain.observations.length === 0) {
    const id = "observation-none";
    observationIds.push(id);
    nodes.push({
      id,
      kind: "observation",
      column: 3,
      title: "No observations published",
      subtitle: "Nothing was acquired and recorded",
      status: "missing",
      statusLabel: "Not recorded",
      details: [{ label: "Note", value: "Do not infer no change from missing observations." }],
    });
  }
  chain.observations.forEach((item, index) => {
    const id = "observation-" + index;
    observationIds.push(id);
    const acquisition = [item.maturity, item.release, item.polarization]
      .filter(Boolean)
      .join(" · ");
    const geometry = [
      item.track ? "Track " + item.track : null,
      item.frame ? "Frame " + item.frame : null,
      item.direction,
      item.wavelength_m !== null ? item.wavelength_m + " m wavelength" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    nodes.push({
      id,
      kind: "observation",
      column: 3,
      title: item.start_date ?? "Date not recorded",
      subtitle: item.sensor + " · " + item.product,
      status: item.source_id ? "ok" : "info",
      statusLabel: item.source_id ? "Granule recorded" : "Granule ID not recorded",
      details: details([
        item.end_date && item.end_date !== item.start_date
          ? { label: "Interval", value: (item.start_date ?? "?") + " → " + item.end_date }
          : null,
        acquisition ? { label: "Product", value: acquisition } : null,
        geometry ? { label: "Acquisition", value: geometry } : null,
        item.source_id ? { label: "Granule", value: item.source_id } : null,
      ]),
    });
  });
  for (const observationId of observationIds) edges.push({ from: screeningId, to: observationId });

  // ── 4 · References ──
  const referenceIds: string[] = [];
  chain.references.forEach((reference, index) => {
    const id = "reference-" + index;
    referenceIds.push(id);
    const status = referenceStatus(reference);
    nodes.push({
      id,
      kind: "reference",
      column: 4,
      title: reference.source,
      subtitle: REFERENCE_STATUS_LABELS[reference.status],
      status,
      statusLabel: REFERENCE_STATUS_LABELS[reference.status],
      details: details([
        { label: "Assessment", value: reference.summary },
        reference.observation_dates.length > 0
          ? { label: "Reference dates", value: reference.observation_dates.join(" → ") }
          : null,
        reference.temporal_offsets_days.length > 0
          ? { label: "Date offsets (days)", value: reference.temporal_offsets_days.join(", ") }
          : null,
        reference.common_coverage_fraction !== null
          ? { label: "Common-clear coverage", value: formatLineageValue(reference.common_coverage_fraction, "fraction") }
          : null,
        reference.candidate_assessed_fraction !== null
          ? { label: "Candidate area assessed", value: formatLineageValue(reference.candidate_assessed_fraction, "fraction") }
          : null,
        reference.precision !== null
          ? { label: "Precision", value: formatLineageValue(reference.precision, "fraction") }
          : null,
        reference.recall !== null
          ? { label: "Recall", value: formatLineageValue(reference.recall, "fraction") }
          : null,
        reference.f1 !== null
          ? { label: "F1", value: formatLineageValue(reference.f1, "fraction") }
          : null,
        ...(reference.limitations.map((item, i) => ({ label: "Limitation " + (i + 1), value: item }) as LineageDetail)),
        reference.source_url
          ? { label: "Reference source", value: reference.source_url, href: reference.source_url }
          : null,
      ]),
    });
  });
  if (referenceIds.length === 0) {
    const id = "reference-none";
    referenceIds.push(id);
    nodes.push({
      id,
      kind: "reference",
      column: 4,
      title: "No reference recorded",
      subtitle: "No independent evidence attached",
      status: "missing",
      statusLabel: "Not recorded",
      details: [{ label: "Note", value: "Without a reference, the result cannot be validated — only explored." }],
    });
  }
  for (const observationId of observationIds) {
    for (const referenceId of referenceIds) edges.push({ from: observationId, to: referenceId });
  }

  // ── 5 · Provenance ──
  const provenanceId = "provenance";
  nodes.push({
    id: provenanceId,
    kind: "provenance",
    column: 5,
    title: "Provenance",
    subtitle: chain.provenance.run_id ? "Run " + chain.provenance.run_id : "Run not recorded",
    status: chain.provenance.run_id ? "ok" : "info",
    statusLabel: chain.provenance.run_id ? "Run recorded" : "Run not recorded",
    details: details([
      chain.provenance.run_id ? { label: "Run ID", value: chain.provenance.run_id } : null,
      chain.provenance.publication_version ? { label: "Publication", value: chain.provenance.publication_version } : null,
      chain.provenance.boundary_source ? { label: "Boundary", value: chain.provenance.boundary_source } : null,
      { label: "Modality", value: chain.modality.replaceAll("_", " ") },
      { label: "Product", value: chain.product },
      chain.product_maturity ? { label: "Product maturity", value: chain.product_maturity } : null,
      ...chain.provenance.source_urls.map((url, i) => ({ label: "Source " + (i + 1), value: url, href: url }) as LineageDetail),
    ]),
  });
  for (const referenceId of referenceIds) edges.push({ from: referenceId, to: provenanceId });

  return {
    studyId: chain.study_id,
    studyTitle: chain.study_title,
    studyState: chain.state,
    conclusion: chain.conclusion,
    nodes,
    edges,
  };
}

// ── Layout (pure SVG geometry; fixed node size, stacked columns) ──

export const LINEAGE_NODE_WIDTH = 216;
export const LINEAGE_NODE_HEIGHT = 92;
export const LINEAGE_COLUMN_GAP = 56;
export const LINEAGE_NODE_GAP = 14;
export const LINEAGE_TOP = 12;
export const LINEAGE_SIDE = 8;

export interface PositionedLineageNode {
  node: LineageNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LineageEdgePath {
  from: string;
  to: string;
  d: string;
}

export interface LineageLayout {
  width: number;
  height: number;
  nodes: PositionedLineageNode[];
  edges: LineageEdgePath[];
}

export function layoutLineageGraph(graph: LineageGraph): LineageLayout {
  const columnCount = LINEAGE_COLUMNS.length;
  const width = LINEAGE_SIDE * 2 + columnCount * LINEAGE_NODE_WIDTH + (columnCount - 1) * LINEAGE_COLUMN_GAP;
  const byColumn = new Map<number, LineageNode[]>();
  for (const node of graph.nodes) {
    const list = byColumn.get(node.column) ?? [];
    list.push(node);
    byColumn.set(node.column, list);
  }
  const positioned: PositionedLineageNode[] = [];
  const positions = new Map<string, { x: number; y: number }>();
  let height = LINEAGE_TOP * 2 + LINEAGE_NODE_HEIGHT;
  for (const [column, list] of byColumn) {
    const x = LINEAGE_SIDE + column * (LINEAGE_NODE_WIDTH + LINEAGE_COLUMN_GAP);
    list.forEach((node, index) => {
      const y = LINEAGE_TOP + index * (LINEAGE_NODE_HEIGHT + LINEAGE_NODE_GAP);
      positions.set(node.id, { x, y });
      positioned.push({ node, x, y, width: LINEAGE_NODE_WIDTH, height: LINEAGE_NODE_HEIGHT });
    });
    height = Math.max(height, LINEAGE_TOP * 2 + list.length * LINEAGE_NODE_HEIGHT + (list.length - 1) * LINEAGE_NODE_GAP);
  }
  const edges: LineageEdgePath[] = [];
  for (const edge of graph.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue; // never draw an edge to a node that does not exist
    const x1 = from.x + LINEAGE_NODE_WIDTH;
    const y1 = from.y + LINEAGE_NODE_HEIGHT / 2;
    const x2 = to.x;
    const y2 = to.y + LINEAGE_NODE_HEIGHT / 2;
    const midX = (x1 + x2) / 2;
    edges.push({ from: edge.from, to: edge.to, d: `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}` });
  }
  return { width, height, nodes: positioned, edges };
}

export function truncateLineageText(value: string, maxLength = 28): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength - 1).trimEnd() + "…";
}

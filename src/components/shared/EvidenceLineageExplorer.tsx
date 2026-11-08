"use client";

import { useMemo, useState } from "react";
import type { EvidenceChain } from "@/lib/evidence-chain";
import {
  LINEAGE_COLUMNS,
  LINEAGE_TOP,
  buildLineageGraph,
  layoutLineageGraph,
  truncateLineageText,
} from "@/lib/evidence-lineage";
import type { LineageGraph, LineageNode, LineageNodeStatus } from "@/lib/evidence-lineage";
import type { LineageColumnGroup } from "@/lib/evidence-lineage";
import "./evidence-lineage.css";

const HEADER_HEIGHT = 30;

/* Column-band tints: measured data, derived results and reference evidence
   read as different families at a glance. Bands are background tints only;
   node state is always carried by the status glyph + words, never by these. */
const GROUP_BAND: Record<LineageColumnGroup, string> = {
  derived: "rgba(216, 164, 74, 0.09)",
  process: "rgba(143, 168, 191, 0.06)",
  measured: "rgba(127, 209, 168, 0.09)",
  reference: "rgba(176, 141, 200, 0.10)",
  record: "rgba(143, 168, 191, 0.04)",
};

const GROUP_LABEL_COLOR: Record<LineageColumnGroup, string> = {
  derived: "#d8a44a",
  process: "#8fa8bf",
  measured: "#7fd1a8",
  reference: "#b08dc8",
  record: "#8fa8bf",
};

const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2];

const STATUS_STYLE: Record<LineageNodeStatus, { color: string; glyph: string }> = {
  ok: { color: "#7fd1a8", glyph: "●" },
  inconclusive: { color: "#e9c88e", glyph: "◐" },
  missing: { color: "#d08a8a", glyph: "○" },
  info: { color: "#9db8d2", glyph: "◆" },
};

const CHAIN_STATE_LABEL: Record<EvidenceChain["state"], string> = {
  NOT_PUBLISHED: "No published study",
  EXPLORATORY: "Exploratory",
  INCONCLUSIVE: "Inconclusive",
};

function stateLabel(state: EvidenceChain["state"]): string {
  return CHAIN_STATE_LABEL[state];
}

function LineageNodeShape({
  node,
  x,
  y,
  width,
  height,
  selected,
  connected,
  onSelect,
}: {
  node: LineageNode;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  connected: boolean;
  onSelect: (id: string) => void;
}) {
  const style = STATUS_STYLE[node.status];
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${node.title}. ${node.subtitle}. Status: ${node.statusLabel}.`}
      className={"lineage-node" + (selected ? " is-selected" : "")}
      transform={`translate(${x}, ${y})`}
      onClick={() => onSelect(node.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      <title>{`${node.title} — ${node.subtitle} (${node.statusLabel})`}</title>
      <rect
        className="lineage-node__box"
        width={width}
        height={height}
        rx={10}
        style={{
          stroke: selected ? "#e9c88e" : connected ? style.color : "rgba(155, 177, 198, .35)",
          strokeWidth: selected ? 2.5 : 1.25,
        }}
      />
      <rect x={0} y={10} width={4} height={height - 20} rx={2} fill={style.color} />
      <text className="lineage-node__title" x={14} y={26}>
        {truncateLineageText(node.title, 26)}
      </text>
      <text className="lineage-node__subtitle" x={14} y={46}>
        {truncateLineageText(node.subtitle, 30)}
      </text>
      <text className="lineage-node__status" x={14} y={72} fill={style.color}>
        {style.glyph} {node.statusLabel}
      </text>
    </g>
  );
}

function NodeInspector({ node, graph }: { node: LineageNode; graph: LineageGraph }) {
  const column = LINEAGE_COLUMNS[node.column];
  return (
    <aside className="lineage-inspector" aria-label="Selected lineage node">
      <p className="lineage-inspector__eyebrow">
        {column.label} · {column.hint}
      </p>
      <h3>{node.title}</h3>
      <p className="lineage-inspector__subtitle">{node.subtitle}</p>
      <p className="lineage-inspector__state">
        <span style={{ color: STATUS_STYLE[node.status].color }}>
          {STATUS_STYLE[node.status].glyph} {node.statusLabel}
        </span>
        <span className="lineage-inspector__study">
          {graph.studyTitle} · {stateLabel(graph.studyState)}
        </span>
      </p>
      <dl className="lineage-inspector__details">
        {node.details.map((item, index) => (
          <div key={index}>
            <dt>{item.label}</dt>
            <dd>
              {item.href ? (
                <a href={item.href} target="_blank" rel="noreferrer">
                  {item.value} ↗
                </a>
              ) : (
                item.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

export default function EvidenceLineageExplorer({
  chains,
  unavailable,
}: {
  chains: EvidenceChain[];
  unavailable: { id: string; reason: string }[];
}) {
  const [chainIndex, setChainIndex] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const chain = chains[chainIndex] ?? null;
  const graph = useMemo(() => (chain ? buildLineageGraph(chain) : null), [chain]);
  const layout = useMemo(() => (graph ? layoutLineageGraph(graph) : null), [graph]);

  const selectedNode =
    graph?.nodes.find((node) => node.id === selectedNodeId) ??
    graph?.nodes.find((node) => node.kind === "result") ??
    graph?.nodes[0] ??
    null;
  const connectedIds = useMemo(() => {
    if (!graph || !selectedNode) return new Set<string>();
    const ids = new Set<string>([selectedNode.id]);
    for (const edge of graph.edges) {
      if (edge.from === selectedNode.id) ids.add(edge.to);
      if (edge.to === selectedNode.id) ids.add(edge.from);
    }
    return ids;
  }, [graph, selectedNode]);

  // Each column band hugs its own content instead of stretching to the
  // tallest column — otherwise short columns sit over a long empty band
  // (the mobile dead space below the Result nodes).
  const columnHeights = useMemo(() => LINEAGE_COLUMNS.map((column, index) => {
    const bottom = (layout?.nodes ?? [])
      .filter((positioned) => positioned.node.column === index)
      .reduce((max, positioned) => Math.max(max, positioned.y + positioned.height), 0);
    return bottom + LINEAGE_TOP;
  }), [layout]);

  if (!chain || !graph || !layout || !selectedNode) {
    return (
      <section className="lineage-empty">
        <p>No published study could be loaded for the lineage explorer.</p>
        {unavailable.length > 0 && (
          <ul>
            {unavailable.map((item) => (
              <li key={item.id}>
                <strong>{item.id}:</strong> {item.reason}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const zoomIndex = ZOOM_STEPS.indexOf(zoom);
  const zoomOut = () => setZoom(ZOOM_STEPS[Math.max(0, zoomIndex - 1)]);
  const zoomIn = () => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, zoomIndex + 1)]);

  return (
    <div className="lineage-explorer">
      <div className="lineage-studies" role="tablist" aria-label="Published studies">
        {chains.map((item, index) => (
          <button
            key={item.study_id ?? item.study_title}
            role="tab"
            aria-selected={index === chainIndex}
            className={"lineage-study" + (index === chainIndex ? " is-active" : "")}
            onClick={() => {
              setChainIndex(index);
              setSelectedNodeId(null);
            }}
          >
            <strong>{item.site_name}</strong>
            <span>
              {item.module} · {stateLabel(item.state)}
            </span>
          </button>
        ))}
      </div>

      <p className="lineage-conclusion">{graph.conclusion}</p>

      <div className="lineage-toolbar" role="group" aria-label="Graph zoom">
        <span className="lineage-toolbar__label">Graph zoom</span>
        <button type="button" className="lineage-zoom" onClick={zoomOut} disabled={zoomIndex <= 0} aria-label="Zoom out">
          −
        </button>
        <span className="lineage-zoom__value" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" className="lineage-zoom" onClick={zoomIn} disabled={zoomIndex >= ZOOM_STEPS.length - 1} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="lineage-zoom" onClick={() => setZoom(1)} disabled={zoom === 1} aria-label="Reset zoom to 100%">
          Reset
        </button>
        <span className="lineage-toolbar__hint">Scroll sideways to pan across the graph.</span>
      </div>

      <div className="lineage-canvas" aria-label={`Evidence lineage graph for ${graph.studyTitle}`}>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height + HEADER_HEIGHT}`}
          width={layout.width * zoom}
          height={(layout.height + HEADER_HEIGHT) * zoom}
          role="img"
          aria-label={`Lineage graph: result, method, quality screen, observations, reference, provenance for ${graph.studyTitle}. Select a node to inspect it.`}
        >
          <defs>
            <marker
              id="lineage-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#c98a2b" />
            </marker>
          </defs>
          {LINEAGE_COLUMNS.map((column, index) => (
            <g key={column.id} transform={`translate(${8 + index * (216 + 56)}, 0)`}>
              <text className="lineage-column__label" x={0} y={14}>
                {index + 1} · {column.label}
              </text>
              <text className="lineage-column__hint" x={0} y={26}>
                <tspan fill={GROUP_LABEL_COLOR[column.group]}>{column.groupLabel}</tspan>
                {" · " + column.hint}
              </text>
            </g>
          ))}
          <g transform={`translate(0, ${HEADER_HEIGHT})`}>
            {LINEAGE_COLUMNS.map((column, index) => (
              <rect
                key={"band-" + column.id}
                x={8 + index * (216 + 56) - 8}
                y={0}
                width={216 + 16}
                height={columnHeights[index]}
                rx={10}
                fill={GROUP_BAND[column.group]}
              />
            ))}
            {layout.edges.map((edge) => {
              const active =
                selectedNode && (edge.from === selectedNode.id || edge.to === selectedNode.id);
              return (
                <path
                  key={edge.from + ">" + edge.to}
                  d={edge.d}
                  className="lineage-edge"
                  markerEnd="url(#lineage-arrow)"
                  style={{ opacity: active ? 1 : 0.45, strokeWidth: active ? 2 : 1.5 }}
                />
              );
            })}
            {layout.nodes.map((positioned) => (
              <LineageNodeShape
                key={positioned.node.id}
                node={positioned.node}
                x={positioned.x}
                y={positioned.y}
                width={positioned.width}
                height={positioned.height}
                selected={positioned.node.id === selectedNode.id}
                connected={connectedIds.has(positioned.node.id)}
                onSelect={setSelectedNodeId}
              />
            ))}
          </g>
        </svg>
      </div>

      <p className="lineage-legend">
        Read left to right: start at what you see, trace back to where it came from.{" "}
        <span style={{ color: "#7fd1a8" }}>● Recorded</span> ·{" "}
        <span style={{ color: "#e9c88e" }}>◐ Inconclusive</span> ·{" "}
        <span style={{ color: "#d08a8a" }}>○ Not recorded</span> ·{" "}
        <span style={{ color: "#9db8d2" }}>◆ Partial record</span> · Select any node to
        inspect its evidence.
        <br />
        Column families:{" "}
        <span style={{ color: "#d8a44a" }}>Derived</span> ·{" "}
        <span style={{ color: "#8fa8bf" }}>Process</span> ·{" "}
        <span style={{ color: "#7fd1a8" }}>Measured</span> ·{" "}
        <span style={{ color: "#b08dc8" }}>Reference</span> ·{" "}
        <span style={{ color: "#8fa8bf" }}>Record</span>.
      </p>

      <NodeInspector node={selectedNode} graph={graph} />

      {unavailable.length > 0 && (
        <section className="lineage-unavailable" aria-label="Studies that could not be loaded">
          <h3>Could not be loaded</h3>
          <p>These studies are reported as unavailable, not as empty results.</p>
          <ul>
            {unavailable.map((item) => (
              <li key={item.id}>
                <strong>{item.id}:</strong> {item.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

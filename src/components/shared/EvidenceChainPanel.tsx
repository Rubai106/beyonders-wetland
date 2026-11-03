"use client";

import type { EvidenceChain, EvidenceReferenceState } from "@/lib/evidence-chain";
import "./evidence-chain.css";

const referenceLabels: Record<EvidenceReferenceState, string> = {
  NOT_RECORDED: "Not recorded",
  NOT_ASSESSED: "Not assessed",
  INCONCLUSIVE: "Inconclusive",
  ASSESSED_COMPARISON: "Comparison assessed",
  EXPLORATORY_SUPPORT: "Exploratory support",
  WEAK_AGREEMENT: "Weak agreement",
  CONTEXT_ONLY: "Context only",
  CROSS_SENSOR_CONTEXT: "Cross-sensor context",
};

function formatSignal(value: number | null, unit: string) {
  if (value === null) return "Not recorded";
  if (unit === "fraction") return (value * 100).toFixed(1) + "%";
  if (Number.isInteger(value)) return value.toLocaleString("en");
  const digits = unit === "m³/m³" ? 3 : unit === "cm" || unit === "cm MAD" || unit === "dB" ? 2 : 3;
  return value.toFixed(digits) + (unit ? " " + unit : "");
}

function formatChainState(state: EvidenceChain["state"]) {
  if (state === "NOT_PUBLISHED") return "No published study";
  if (state === "INCONCLUSIVE") return "Inconclusive";
  return "Exploratory";
}

export default function EvidenceChainPanel({ chain }: { chain: EvidenceChain }) {
  return (
    <section className="evidence-chain" aria-label="Standardized evidence chain">
      <header className="evidence-chain__header">
        <div>
          <span className="evidence-chain__eyebrow">MEASUREMENT → SCREEN → REFERENCE → INTERPRETATION</span>
          <h3>{chain.study_title}</h3>
          <p>{chain.conclusion}</p>
        </div>
        <span className={"evidence-chain__state evidence-chain__state--" + chain.state.toLowerCase().replaceAll("_", "-")}>
          {formatChainState(chain.state)}
        </span>
      </header>

      <div className="evidence-chain__section">
        <h4>1 · Source observations</h4>
        {chain.observations.length ? (
          <ol className="evidence-chain__observations">
            {chain.observations.map((item, index) => (
              <li key={item.source_id ?? item.start_date ?? index}>
                <strong>{item.sensor} · {item.product}</strong>
                <span>{item.start_date ?? "Date not recorded"}{item.end_date && item.end_date !== item.start_date ? " → " + item.end_date : ""}</span>
                <small>{[item.maturity, item.release, item.polarization, item.track ? "Track " + item.track : null, item.frame ? "Frame " + item.frame : null, item.direction].filter(Boolean).join(" · ") || "Additional acquisition metadata not recorded"}</small>
                {item.source_id && <code>{item.source_id}</code>}
              </li>
            ))}
          </ol>
        ) : <p className="evidence-chain__empty">No published observations are available for this study.</p>}
      </div>

      <div className="evidence-chain__section">
        <h4>2 · Method and quality screen</h4>
        <p>{chain.method.summary}</p>
        {chain.method.id && <code className="evidence-chain__method-id">{chain.method.id}</code>}
        {chain.method.screening_rules.length > 0 && (
          <ul>{chain.method.screening_rules.map((rule, index) => <li key={index}>{rule}</li>)}</ul>
        )}
        {chain.method.minimum_coverage_fraction !== null && (
          <p className="evidence-chain__coverage-floor">
            Minimum coverage gate: {(chain.method.minimum_coverage_fraction * 100).toFixed(1)}%
          </p>
        )}
      </div>

      <div className="evidence-chain__section">
        <h4>3 · Measured results</h4>
        {chain.measurements.length ? (
          <dl className="evidence-chain__signals">
            {chain.measurements.map((signal) => (
              <div key={signal.id}>
                <dt>{signal.label}</dt>
                <dd>{formatSignal(signal.value, signal.unit)}</dd>
                <small>{signal.interpretation}</small>
              </div>
            ))}
          </dl>
        ) : <p className="evidence-chain__empty">No measurements are published.</p>}
      </div>

      <div className="evidence-chain__section">
        <h4>4 · Independent and contextual evidence</h4>
        {chain.references.map((reference) => (
          <article className="evidence-chain__reference" key={reference.id}>
            <div className="evidence-chain__reference-head">
              <strong>{reference.source}</strong>
              <span data-reference-state={reference.status}>{referenceLabels[reference.status]}</span>
            </div>
            <p>{reference.summary}</p>
            {reference.observation_dates.length > 0 && (
              <p className="evidence-chain__meta">Reference dates: {reference.observation_dates.join(" → ")}</p>
            )}
            <dl className="evidence-chain__reference-metrics">
              <div><dt>Common coverage</dt><dd>{formatSignal(reference.common_coverage_fraction, "fraction")}</dd></div>
              <div><dt>Candidate area assessed</dt><dd>{formatSignal(reference.candidate_assessed_fraction, "fraction")}</dd></div>
              <div><dt>Precision</dt><dd>{formatSignal(reference.precision, "fraction")}</dd></div>
              <div><dt>Recall</dt><dd>{formatSignal(reference.recall, "fraction")}</dd></div>
              <div><dt>F1</dt><dd>{formatSignal(reference.f1, "fraction")}</dd></div>
            </dl>
            {reference.source_url && <a href={reference.source_url} target="_blank" rel="noreferrer">Open reference source ↗</a>}
            {reference.limitations.length > 0 && <ul>{reference.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>}
          </article>
        ))}
      </div>

      <div className="evidence-chain__section">
        <h4>5 · Provenance and uncertainty</h4>
        <dl className="evidence-chain__provenance">
          <div><dt>Run</dt><dd>{chain.provenance.run_id ?? "Not recorded"}</dd></div>
          <div><dt>Publication</dt><dd>{chain.provenance.publication_version ?? "Not recorded"}</dd></div>
          <div><dt>Boundary</dt><dd>{chain.provenance.boundary_source ?? "Not recorded"}</dd></div>
          <div><dt>Product modality</dt><dd>{chain.modality.replaceAll("_", " ")}</dd></div>
        </dl>
        {chain.provenance.source_urls.length > 0 && (
          <ul className="evidence-chain__sources">{chain.provenance.source_urls.map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul>
        )}
        {chain.uncertainty_and_limits.length > 0 && (
          <ul className="evidence-chain__limits">{chain.uncertainty_and_limits.map((item, index) => <li key={index}>{item}</li>)}</ul>
        )}
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";
import type { WetlandPatch } from "@/lib/types";
import {
  buildScatteringHypothesisAssessment,
  type ScatteringHypothesis,
  type ScatteringHypothesisId,
} from "@/lib/scattering-hypothesis";

function formatMeasurement(value: number | null, unit: string): string {
  if (value === null) return "Not recorded";
  if (unit === "fraction") return (value * 100).toFixed(1) + "%";
  return value.toFixed(2) + (unit ? " " + unit : "");
}

function statusTone(status: ScatteringHypothesis["status"]): string {
  if (status === "DETECTOR_SIGNATURE_SELECTED") return "selected";
  if (status === "NOT_SELECTED_BY_DETECTOR") return "not-selected";
  return "unresolved";
}

function defaultHypothesis(classification: WetlandPatch["classification"]): ScatteringHypothesisId {
  return classification === "VEGETATED_INUNDATION" ? "flooded-vegetation" : "open-water";
}

export default function ScatteringHypothesisPanel({ patch }: { patch: WetlandPatch }) {
  const assessment = buildScatteringHypothesisAssessment(patch);
  const [selectedId, setSelectedId] = useState<ScatteringHypothesisId>(() => defaultHypothesis(patch.classification));
  const selected = assessment.hypotheses.find((item) => item.id === selectedId) ?? assessment.hypotheses[0];

  return (
    <section className="wx-scattering" aria-labelledby="wx-scattering-title">
      <header className="wx-scattering__header">
        <div>
          <p className="wx-micro">MEASURED RESPONSE ≠ PHYSICAL CAUSE</p>
          <h3 id="wx-scattering-title">Scattering hypothesis ledger</h3>
          <p>Compare the detector's selected response with other physical explanations that the available pair cannot resolve.</p>
        </div>
        <span className="wx-scattering__class">{assessment.detectorClassLabel}</span>
      </header>

      <div className="wx-scattering__measurements" aria-label="Recorded candidate measurements">
        {assessment.measurements.slice(0, 4).map((measurement) => (
          <div className="wx-scattering__metric" key={measurement.id}>
            <span>{measurement.label}</span>
            <strong>{formatMeasurement(measurement.value, measurement.unit)}</strong>
          </div>
        ))}
      </div>

      <p className="wx-scattering__hint">
        Select a mechanism to inspect its expected radar behaviour, what this candidate actually records, and which independent evidence could help distinguish it.
      </p>

      <div className="wx-scattering__choices" role="group" aria-label="Competing scattering hypotheses">
        {assessment.hypotheses.map((hypothesis, index) => (
          <button
            className="wx-scattering__choice"
            data-active={selected.id === hypothesis.id}
            key={hypothesis.id}
            type="button"
            aria-pressed={selected.id === hypothesis.id}
            onClick={() => setSelectedId(hypothesis.id)}
          >
            <span className="wx-scattering__choice-index">0{index + 1}</span>
            <span className="wx-scattering__choice-copy">
              <strong>{hypothesis.title}</strong>
              <small data-status={statusTone(hypothesis.status)}>{hypothesis.statusLabel}</small>
            </span>
            <span className="wx-scattering__choice-arrow" aria-hidden="true">›</span>
          </button>
        ))}
      </div>

      <article className="wx-scattering__detail" aria-live="polite" aria-label={selected.title}>
        <div className="wx-scattering__detail-head">
          <span className="wx-micro">SELECTED HYPOTHESIS</span>
          <span className="wx-scattering__status" data-status={statusTone(selected.status)}>{selected.statusLabel}</span>
        </div>
        <h4>{selected.title}</h4>
        <p>{selected.mechanism}</p>
        <div className="wx-scattering__readout">
          <span className="wx-micro">WHAT THIS CANDIDATE SHOWS</span>
          <p>{selected.candidateReadout}</p>
        </div>
        <div className="wx-scattering__next">
          <span className="wx-micro">EVIDENCE THAT COULD DISTINGUISH IT</span>
          <ol>
            {selected.discriminatingEvidence.map((item) => <li key={item}>{item}</li>)}
          </ol>
        </div>
        <p className="wx-scattering__limitation"><strong>Interpretation limit:</strong> {selected.limitation}</p>
      </article>

      <div className="wx-scattering__guardrails">
        <span className="wx-micro">SCIENTIFIC GUARDRAILS</span>
        <ul>{assessment.guardrails.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>

      <footer className="wx-scattering__sources">
        <span>Science basis:</span>
        <a href="https://earthdata.nasa.gov/s3fs-public/2025-04/SARHB_CH5_Content.pdf" target="_blank" rel="noreferrer">NASA SAR Handbook, Chapter 5 ↗</a>
        <a href="https://doi.org/10.3390/rs16040656" target="_blank" rel="noreferrer">Flood Detection with SAR: A Review ↗</a>
      </footer>
    </section>
  );
}

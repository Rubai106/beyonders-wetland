"use client";

import { useMemo, useState } from "react";
import type { WetlandPatch } from "@/lib/types";
import { downloadFile } from "@/lib/real-export";
import { buildEvidenceRequest, type TemporalWindowDays } from "@/lib/evidence-request";
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
  if (classification === "VEGETATED_INUNDATION") return "flooded-vegetation";
  if (classification === "OPEN_WATER") return "open-water";
  return "soil-moisture";
}

export default function ScatteringHypothesisPanel({ patch }: { patch: WetlandPatch }) {
  const assessment = buildScatteringHypothesisAssessment(patch);
  const [selectedId, setSelectedId] = useState<ScatteringHypothesisId>(() => defaultHypothesis(patch.classification));
  const [temporalWindowDays, setTemporalWindowDays] = useState<TemporalWindowDays>(0);
  const selected = assessment.hypotheses.find((item) => item.id === selectedId) ?? assessment.hypotheses[0];
  const evidenceRequest = useMemo(
    () => buildEvidenceRequest(patch, selected.id, temporalWindowDays),
    [patch, selected.id, temporalWindowDays],
  );
  const exportEvidenceRequest = () => {
    const json = JSON.stringify(evidenceRequest, null, 2);
    downloadFile(`evidence-request-${evidenceRequest.requestId.toLowerCase()}.json`, json, "application/json");
  };

  return (
    <section className="wx-scattering" aria-labelledby="wx-scattering-title">
      <header className="wx-scattering__header">
        <div>
          <p className="wx-micro">MEASURED RESPONSE ≠ PHYSICAL CAUSE</p>
          <h3 id="wx-scattering-title">Scattering hypothesis ledger</h3>
          <p>Candidate {assessment.candidateId} · observation {assessment.observationDate}</p>
          <p>Compare the detector&apos;s selected response with other physical explanations that the available pair cannot resolve.</p>
        </div>
        <span className="wx-scattering__class">{assessment.detectorClassLabel}</span>
      </header>

      <div className="wx-scattering__measurements" aria-label="Recorded candidate measurements">
        {assessment.measurements.map((measurement) => (
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

      <section className="wx-evidence-request" aria-labelledby="wx-evidence-request-title">
        <header className="wx-evidence-request__header">
          <p className="wx-micro">STEP 02 · TURN AN EVIDENCE GAP INTO A SEARCHABLE REQUEST</p>
          <h4 id="wx-evidence-request-title">Hypothesis-to-evidence request</h4>
          <p>{evidenceRequest.hypothesis.question}</p>
        </header>

        <div className="wx-evidence-request__controls">
          <label htmlFor="wx-evidence-window">
            Archive date window
            <select
              id="wx-evidence-window"
              data-testid="evidence-window"
              value={temporalWindowDays}
              onChange={(event) => setTemporalWindowDays(Number(event.target.value) as TemporalWindowDays)}
            >
              <option value={0}>Same UTC day</option>
              <option value={1}>±1 day</option>
              <option value={3}>±3 days</option>
              <option value={7}>±7 days</option>
              <option value={14}>±14 days</option>
            </select>
          </label>
          <p>Discovery window only. Widen it to find candidate granules; it does not make an observation scientifically time-equivalent.</p>
        </div>

        <div className="wx-evidence-request__spatial">
          <span className="wx-micro">SPATIAL SEARCH SCOPE</span>
          <strong>{evidenceRequest.spatialSearch.label}</strong>
          <p>{evidenceRequest.spatialSearch.interpretation}</p>
        </div>

        <div className="wx-evidence-request__criteria">
          <div>
            <span className="wx-micro">WHAT COULD SUPPORT THIS HYPOTHESIS</span>
            <ul>{evidenceRequest.evidenceThatCouldSupport.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          <div>
            <span className="wx-micro">WHAT COULD CHALLENGE IT</span>
            <ul>{evidenceRequest.evidenceThatCouldChallenge.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </div>

        <div className="wx-evidence-request__archives">
          <div className="wx-evidence-request__archives-head">
            <span className="wx-micro">PRODUCT-SPECIFIC NASA ARCHIVE SEARCHES</span>
            <span>{evidenceRequest.archiveSearches.length} query templates</span>
          </div>
          {evidenceRequest.archiveSearches.length > 0 ? evidenceRequest.archiveSearches.map((search) => (
            <article className="wx-evidence-request__archive" key={search.shortName}>
              <div>
                <strong>{search.title}</strong>
                <span>{search.shortName} · v{search.version} · {search.nominalResolution} · {search.sensor}</span>
                <small>{search.role}</small>
                <p>{search.limitation}</p>
              </div>
              <a href={search.queryUrl} target="_blank" rel="noreferrer">Search CMR ↗</a>
            </article>
          )) : (
            <p className="wx-evidence-request__empty">A NASA archive query cannot be generated until the candidate date and spatial reference are valid.</p>
          )}
        </div>

        <div className="wx-evidence-request__protocol">
          <span className="wx-micro">MINIMUM REVIEW PROTOCOL</span>
          <ol>{evidenceRequest.minimumReviewProtocol.map((item) => <li key={item}>{item}</li>)}</ol>
        </div>

        <ul className="wx-evidence-request__guardrails">
          {evidenceRequest.guardrails.map((item) => <li key={item}>{item}</li>)}
          {evidenceRequest.warnings.map((item) => <li key={item}>{item}</li>)}
        </ul>

        <div className="wx-evidence-request__export">
          <button type="button" className="wx-btn wx-btn--primary" onClick={exportEvidenceRequest}>
            Download evidence request JSON
          </button>
          <span className="wx-mono">ID · {evidenceRequest.requestId}</span>
        </div>
      </section>

      <footer className="wx-scattering__sources">
        <span>Science basis:</span>
        <a href="https://earthdata.nasa.gov/s3fs-public/2025-04/SARHB_CH5_Content.pdf" target="_blank" rel="noreferrer">NASA SAR Handbook, Chapter 5 ↗</a>
        <a href="https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html" target="_blank" rel="noreferrer">NASA CMR Search API ↗</a>
        <a href="https://doi.org/10.3390/rs16040656" target="_blank" rel="noreferrer">Flood Detection with SAR: A Review ↗</a>
      </footer>
    </section>
  );
}

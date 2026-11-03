"use client";

import { useState } from "react";
import type { WetlandPatch } from "@/lib/types";
import { downloadFile } from "@/lib/real-export";
import { buildEvidenceRequest, type EvidenceArchiveSearch, type TemporalWindowDays } from "@/lib/evidence-request";
import { buildCmrUmmSearchUrl, parseCmrUmmResponse, type CmrGranule } from "@/lib/cmr-granules";
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

interface CmrCollectionResult { search: EvidenceArchiveSearch; totalHits: number | null; granules: CmrGranule[]; error: string | null; }
type CmrSearchStatus = "idle" | "loading" | "success" | "partial" | "error";
function granuleShortlistKey(search: EvidenceArchiveSearch, granule: CmrGranule, index: number): string {
  return `${search.shortName}:${granule.conceptId ?? granule.granuleUr ?? index}`;
}
function granuleDayOffset(candidateDate: string, granule: CmrGranule): number | null {
  const acquisitionDate = (granule.timeStart ?? granule.timeEnd)?.slice(0, 10);
  if (!acquisitionDate || !/^\d{4}-\d{2}-\d{2}$/.test(candidateDate)) return null;
  const candidateMs = Date.parse(candidateDate + "T00:00:00Z");
  const acquisitionMs = Date.parse(acquisitionDate + "T00:00:00Z");
  if (!Number.isFinite(candidateMs) || !Number.isFinite(acquisitionMs)) return null;
  return Math.round((acquisitionMs - candidateMs) / 86_400_000);
}
function dayOffsetLabel(offset: number | null): string {
  if (offset === null) return "Acquisition date not recorded";
  if (offset === 0) return "Same UTC date as candidate";
  return `${Math.abs(offset)} day${Math.abs(offset) === 1 ? "" : "s"} ${offset < 0 ? "before" : "after"} candidate date`;
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
  const [cmrStatus, setCmrStatus] = useState<CmrSearchStatus>("idle");
  const [cmrResults, setCmrResults] = useState<CmrCollectionResult[]>([]);
  const [cmrSearchedKey, setCmrSearchedKey] = useState("");
  const [cmrSearchedAt, setCmrSearchedAt] = useState<string | null>(null);
  const [shortlistedGranules, setShortlistedGranules] = useState<string[]>([]);
  const selected = assessment.hypotheses.find((item) => item.id === selectedId) ?? assessment.hypotheses[0];
  const evidenceRequest = buildEvidenceRequest(patch, selectedId, temporalWindowDays);
  const searchKey = evidenceRequest.archiveSearches.map((item) => item.queryUrl).join("||");
  const hasCurrentCmrResults = cmrSearchedKey !== "" && cmrSearchedKey === searchKey;
  const visibleCmrResults = hasCurrentCmrResults ? cmrResults : [];
  const visibleCmrStatus: CmrSearchStatus = hasCurrentCmrResults ? cmrStatus : "idle";

  const searchCmrGranules = async () => {
    const activeKey = searchKey;
    setCmrStatus("loading");
    setCmrSearchedKey(activeKey);
    setCmrResults([]);
    setCmrSearchedAt(null);
    setShortlistedGranules([]);
    const results = await Promise.all(evidenceRequest.archiveSearches.map(async (search): Promise<CmrCollectionResult> => {
      const url = buildCmrUmmSearchUrl(search.queryUrl);
      if (!url) return { search, totalHits: null, granules: [], error: "This archive query could not be converted to the CMR UMM response format." };
      try {
        const response = await fetch(url, { headers: { Accept: "application/vnd.nasa.cmr.umm_results+json;version=1.18.6" } });
        if (!response.ok) throw new Error(`CMR returned HTTP ${response.status}`);
        const parsed = parseCmrUmmResponse(await response.json());
        return { search, totalHits: parsed.totalHits, granules: parsed.granules, error: null };
      } catch (error) {
        return { search, totalHits: null, granules: [], error: error instanceof Error ? error.message : "The CMR metadata search failed." };
      }
    }));
    setCmrResults(results);
    setCmrSearchedAt(new Date().toISOString());
    const successful = results.filter((result) => result.error === null).length;
    setCmrStatus(successful === 0 ? "error" : successful === results.length ? "success" : "partial");
  };

  const exportEvidenceRequest = () => {
    const activeResults = hasCurrentCmrResults ? visibleCmrResults : [];
    const shortlisted = activeResults.flatMap((group) => group.granules.map((granule, index) => ({
      key: granuleShortlistKey(group.search, granule, index), granule, search: group.search,
    }))).filter((item) => shortlistedGranules.includes(item.key));
    const json = JSON.stringify({
      ...evidenceRequest,
      discovery: {
        status: hasCurrentCmrResults ? cmrStatus : "NOT_SEARCHED",
        searchedAtUtc: hasCurrentCmrResults ? cmrSearchedAt : null,
        resultGroups: activeResults.map((group) => ({
          shortName: group.search.shortName, version: group.search.version, queryUrl: group.search.queryUrl,
          totalHits: group.totalHits, returnedRecords: group.granules.length, error: group.error, granules: group.granules,
        })),
        shortlistedGranules: shortlisted.map((item) => ({
          shortName: item.search.shortName, version: item.search.version, role: item.search.role,
          conceptId: item.granule.conceptId, granuleUr: item.granule.granuleUr,
          timeStart: item.granule.timeStart, timeEnd: item.granule.timeEnd,
          cloudCover: item.granule.cloudCover, metadataUrl: item.granule.metadataUrl,
          dataUrl: item.granule.dataUrl, browseUrl: item.granule.browseUrl, spatialBounds: item.granule.spatialBounds,
        })),
        interpretation: "Shortlisting means an analyst selected a metadata record for further inspection. It does not mean the record supports or challenges the hypothesis, covers valid candidate pixels, or validates the candidate.",
      },
    }, null, 2);
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
            data-hypothesis-id={hypothesis.id}
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

        <section className="wx-cmr-inspector" aria-label="NASA CMR granule match inspector">
          <div className="wx-cmr-inspector__heading">
            <div>
              <span className="wx-micro">STEP 03 · INSPECT ACTUAL ARCHIVE RECORDS</span>
              <h5>Candidate-specific granule inspector</h5>
              <p>Search CMR now to retrieve matching granule metadata for the selected hypothesis and current date window.</p>
            </div>
            <button type="button" className="wx-btn wx-btn--primary" data-testid="cmr-search-button"
              disabled={!evidenceRequest.archiveSearches.length || visibleCmrStatus === "loading"} onClick={searchCmrGranules}>
              {visibleCmrStatus === "loading" ? "Searching CMR…" : "Search NASA CMR granules"}
            </button>
          </div>
          <p className="wx-cmr-inspector__caveat">
            A returned record is a metadata-footprint match to the query geometry, not proof of valid pixels inside this candidate, a water label, or validation. Data access may require an Earthdata login.
          </p>
          {visibleCmrStatus === "loading" ? (
            <p className="wx-cmr-inspector__status" role="status">Searching the selected NASA collections…</p>
          ) : visibleCmrStatus === "error" ? (
            <p className="wx-cmr-inspector__status" role="status">CMR could not be reached for these searches. The external Search CMR links remain available above.</p>
          ) : visibleCmrStatus === "partial" ? (
            <p className="wx-cmr-inspector__status" role="status">Some collection searches completed; others returned errors. Review each collection below.</p>
          ) : visibleCmrStatus === "success" ? (
            <p className="wx-cmr-inspector__status" role="status">CMR search completed at {cmrSearchedAt}. Results are metadata records only.</p>
          ) : (
            <p className="wx-cmr-inspector__status">No live CMR search has been run for this hypothesis and date window.</p>
          )}
          {visibleCmrResults.map((group) => (
            <section className="wx-cmr-inspector__group" data-testid="cmr-result-group" key={group.search.shortName}>
              <header>
                <div>
                  <strong>{group.search.title}</strong>
                  <span>{group.search.shortName} · v{group.search.version} · {group.search.nominalResolution}</span>
                </div>
                <span>{group.error ? "Search error" : `${group.totalHits ?? group.granules.length} metadata hits`}</span>
              </header>
              <p className="wx-cmr-inspector__role">{group.search.role}</p>
              <p className="wx-cmr-inspector__limitation">{group.search.limitation}</p>
              {group.error ? (
                <p className="wx-cmr-inspector__error">{group.error}</p>
              ) : group.granules.length ? group.granules.map((granule, index) => {
                const key = granuleShortlistKey(group.search, granule, index);
                const offset = granuleDayOffset(patch.date, granule);
                return (
                  <article className="wx-cmr-granule" data-testid="cmr-granule-card" key={key}>
                    <div className="wx-cmr-granule__main">
                      <strong>{granule.granuleUr ?? "Granule identifier not supplied"}</strong>
                      <span>{granule.timeStart ? `Acquisition: ${granule.timeStart}${granule.timeEnd && granule.timeEnd !== granule.timeStart ? ` → ${granule.timeEnd}` : ""}` : "Acquisition time not recorded"}</span>
                      <span>{dayOffsetLabel(offset)}</span>
                      {granule.cloudCover !== null && <span>Granule cloud-cover metadata: {granule.cloudCover.toFixed(1)}% (not candidate-local)</span>}
                      {granule.spatialBounds && <span className="wx-mono">Granule bbox: {granule.spatialBounds.map((value) => value.toFixed(3)).join(", ")}</span>}
                      <div className="wx-cmr-granule__links">
                        {granule.metadataUrl && <a href={granule.metadataUrl} target="_blank" rel="noreferrer">Metadata record ↗</a>}
                        {granule.dataUrl && <a href={granule.dataUrl} target="_blank" rel="noreferrer">Data access ↗</a>}
                        {granule.browseUrl && <a href={granule.browseUrl} target="_blank" rel="noreferrer">Browse image ↗</a>}
                      </div>
                    </div>
                    <label className="wx-cmr-granule__shortlist">
                      <input type="checkbox" data-testid="cmr-shortlist-checkbox"
                        checked={shortlistedGranules.includes(key)}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setShortlistedGranules((current) => checked
                            ? current.includes(key) ? current : [...current, key]
                            : current.filter((item) => item !== key));
                        }} />
                      <span>Shortlist for review</span>
                    </label>
                  </article>
                );
              }) : (
                <p className="wx-cmr-inspector__empty">CMR returned no granule metadata matches for this collection and the current time/space filters. This does not show that water or the underlying event was absent.</p>
              )}
            </section>
          ))}
        </section>

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

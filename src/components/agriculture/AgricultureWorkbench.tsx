"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import InvestigationWorkspace from "@/components/layout/InvestigationWorkspace";
import type { InvestigationDrawerTab } from "@/components/layout/InvestigationWorkspace";
import {
  isAgricultureChecksumManifest,
  isAgricultureIndex,
  isAgricultureStudy,
  sha256Hex,
  type AgricultureAOI,
  type AgricultureChecksumManifest,
  type AgricultureObservation,
  type AgricultureStudy,
} from "@/lib/agriculture-study";
import "./agriculture.css";

const AgricultureMap = dynamic(() => import("./AgricultureMap"), {
  ssr: false,
  loading: () => <div className="agri-map-loading">Loading interactive map…</div>,
});

const MIN_DATE = "2026-06-17";
const MAX_DATE = "2026-10-31";
const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

type LoadState = "loading" | "not-published" | "ready" | "error";
type MapLayer = "moisture" | "change";

function formatPercent(value: number) {
  return (value * 100).toFixed(1) + "%";
}
function formatMoisture(value: number) {
  return value.toFixed(3) + " m³/m³";
}
function formatDifference(value: number) {
  return (value > 0 ? "+" : "") + value.toFixed(3) + " m³/m³";
}
function dateLabel(value: string) {
  return new Date(value + "T00:00:00Z").toLocaleDateString("en", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}
function validForm(values: { west: string; south: string; east: string; north: string; start: string; end: string; runId: string }) {
  if (![values.west, values.south, values.east, values.north].every((item) => item.trim() !== "")) return false;
  const west = Number(values.west), south = Number(values.south), east = Number(values.east), north = Number(values.north);
  return [west, south, east, north].every(Number.isFinite) &&
    west >= -180 && east <= 180 && west < east &&
    south >= -90 && north <= 90 && south < north &&
    values.start >= MIN_DATE && values.start <= MAX_DATE &&
    values.end >= MIN_DATE && values.end <= MAX_DATE &&
    values.start <= values.end && RUN_ID_RE.test(values.runId);
}
function commandSet(values: { west: string; south: string; east: string; north: string; start: string; end: string; runId: string }) {
  const common = "--run-id " + values.runId;
  return [
    "python pipeline/agriculture_sme2.py search " + common + " --west " + Number(values.west) +
      " --south " + Number(values.south) + " --east " + Number(values.east) +
      " --north " + Number(values.north) + " --start " + values.start + " --end " + values.end,
    "python pipeline/agriculture_sme2.py download " + common,
    "python pipeline/agriculture_sme2.py analyze " + common,
    "python pipeline/agriculture_sme2.py publish " + common,
  ].join("\n");
}
function csvCell(value: string | number) {
  return "\"" + String(value).replace(/"/g, "\"\"") + "\"";
}

export default function AgricultureWorkbench() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [study, setStudy] = useState<AgricultureStudy | null>(null);
  const [checksums, setChecksums] = useState<AgricultureChecksumManifest | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [layer, setLayer] = useState<MapLayer>("moisture");
  const [previewState, setPreviewState] = useState<{ asset: string; url: string | null; error: string } | null>(null);
  const [satelliteBasemap, setSatelliteBasemap] = useState(false);
  const [west, setWest] = useState("");
  const [south, setSouth] = useState("");
  const [east, setEast] = useState("");
  const [north, setNorth] = useState("");
  const [start, setStart] = useState(MIN_DATE);
  const [end, setEnd] = useState("2026-10-29");
  const [runId, setRunId] = useState("agriculture-pilot-01");
  const [commandsVisible, setCommandsVisible] = useState(false);
  const [copyState, setCopyState] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    async function load() {
      try {
        const indexResponse = await fetch("/agriculture/current/index.json", { signal: controller.signal, cache: "no-store" });
        if (indexResponse.status === 404) {
          if (live) setLoadState("not-published");
          return;
        }
        if (!indexResponse.ok) throw new Error("Agriculture publication index returned HTTP " + indexResponse.status + ".");
        const indexBytes = await indexResponse.arrayBuffer();
        const indexValue: unknown = JSON.parse(new TextDecoder().decode(indexBytes));
        if (!isAgricultureIndex(indexValue)) throw new Error("Agriculture publication index is malformed or contains an unsafe asset path.");

        const checksResponse = await fetch("/agriculture/" + indexValue.checksums_url, { signal: controller.signal, cache: "no-store" });
        if (!checksResponse.ok) throw new Error("Checksum manifest unavailable (HTTP " + checksResponse.status + ").");
        const checksValue: unknown = await checksResponse.json();
        if (!isAgricultureChecksumManifest(checksValue)) throw new Error("The Agriculture checksum manifest is missing or invalid.");

        const studyResponse = await fetch("/agriculture/" + indexValue.study_url, { signal: controller.signal, cache: "no-store" });
        if (!studyResponse.ok) throw new Error("Published study unavailable (HTTP " + studyResponse.status + ").");
        const studyBytes = await studyResponse.arrayBuffer();
        const entry = checksValue.files["study.json"];
        if (!entry || studyBytes.byteLength !== entry.bytes || await sha256Hex(studyBytes) !== entry.sha256) {
          throw new Error("Study integrity check failed: byte count or SHA-256 did not match the publication manifest.");
        }
        const studyValue: unknown = JSON.parse(new TextDecoder().decode(studyBytes));
        if (!isAgricultureStudy(studyValue)) throw new Error("Published Agriculture study failed the SME2 schema and evidence-status checks.");
        if (!live) return;
        setStudy(studyValue);
        setChecksums(checksValue);
        setSelectedIndex(Math.max(0, studyValue.observations.length - 1));
        setLoadState("ready");
      } catch (error) {
        if (!live || (error instanceof DOMException && error.name === "AbortError")) return;
        setLoadError(error instanceof Error ? error.message : "Could not load the published Agriculture study.");
        setLoadState("error");
      }
    }
    void load();
    return () => { live = false; controller.abort(); };
  }, []);

  const selectedObservation: AgricultureObservation | null = study?.observations[selectedIndex] ?? null;
  const activeAsset = study ? (layer === "change" ? study.change_preview : selectedObservation?.preview ?? "") : "";

  useEffect(() => {
    if (!study || !checksums || !activeAsset) return;
    const controller = new AbortController();
    let live = true;
    let objectUrl: string | null = null;
    async function loadPreview() {
      try {
        const entry = checksums.files[activeAsset];
        if (!entry) throw new Error("No checksum entry exists for " + activeAsset + ".");
        const response = await fetch("/agriculture/current/" + activeAsset, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Preview " + activeAsset + " returned HTTP " + response.status + ".");
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== entry.bytes || await sha256Hex(bytes) !== entry.sha256) {
          throw new Error("Preview integrity check failed for " + activeAsset + "; the image has been withheld.");
        }
        if (!live) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        setPreviewState({ asset: activeAsset, url: objectUrl, error: "" });
      } catch (error) {
        if (!live || (error instanceof DOMException && error.name === "AbortError")) return;
        setPreviewState({ asset: activeAsset, url: null, error: error instanceof Error ? error.message : "Preview unavailable." });
      }
    }
    void loadPreview();
    return () => {
      live = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [study, checksums, activeAsset]);

  const previewUrl = previewState?.asset === activeAsset ? previewState.url : null;
  const previewError = previewState?.asset === activeAsset ? previewState.error : "";

  const form = useMemo(() => ({ west, south, east, north, start, end, runId }), [west, south, east, north, start, end, runId]);
  const formValid = useMemo(() => validForm(form), [form]);
  const generatedCommands = useMemo(() => formValid ? commandSet(form) : "", [form, formValid]);
  const chartRange = useMemo(() => {
    if (!study) return { min: 0, max: 1 };
    const lows = study.observations.map((item) => item.p05);
    const highs = study.observations.map((item) => item.p95);
    const min = Math.min(...lows), max = Math.max(...highs);
    return { min: min - (max - min || 0.02) * 0.12, max: max + (max - min || 0.02) * 0.12 };
  }, [study]);

  const exportCsv = useCallback(() => {
    if (!study) return;
    const columns = ["date", "median_m3_m3", "p05_m3_m3", "p95_m3_m3", "valid_fraction", "valid_pixels", "total_pixels", "uncertainty_median", "release", "track", "direction", "frame", "bandwidth", "polarization", "frequency", "granule_name", "source_bytes", "source_sha256"];
    const rows = study.observations.map((item) => [
      item.date, item.median, item.p05, item.p95, item.valid_fraction, item.valid_pixels,
      item.total_pixels, item.uncertainty_median, item.release, item.track, item.direction,
      item.frame, item.bandwidth, item.polarization, item.frequency,
      item.granule_name ?? "", item.source_bytes ?? "", item.source_sha256 ?? "",
    ].map(csvCell).join(","));
    const blob = new Blob([[columns.join(","), ...rows].join("\n"),], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "nisar-sme2-" + study.run_id + "-summary.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [study]);

  const copyCommands = useCallback(async () => {
    if (!generatedCommands) return;
    try {
      await navigator.clipboard.writeText(generatedCommands);
      setCopyState("Commands copied. Run them in the repository terminal.");
    } catch {
      setCopyState("Clipboard access was denied. Select and copy the commands manually.");
    }
  }, [generatedCommands]);

  const aoi: AgricultureAOI | null = study?.aoi ?? null;
  const target = study?.observations[study.observations.length - 1] ?? null;
  const currentCoverage = study ? (layer === "change" ? study.change_summary.valid_fraction : selectedObservation?.valid_fraction ?? 0) : 0;
  const displayedSummary = study ? (layer === "change" ? study.change_summary : selectedObservation) : null;
  const noStudy = loadState === "not-published" || loadState === "loading";
  const statusText = loadState === "loading" ? "Checking published study" :
    loadState === "ready" ? "Checksum verified" :
    loadState === "not-published" ? "No local publication" : "Publication unavailable";

  const drawerTabs: InvestigationDrawerTab[] = [
    {
      id: "explore", number: "01", label: "Explore", hint: "Inspect dates, map layers and summary statistics",
      content: (
        <div className="agri-drawer-panel">
          <p className="agri-intro">Explore the measured SME2 soil-moisture series. The map and statistics below are loaded only from a checksum-verified published study.</p>
          {study ? <>
            <div className="agri-stat-grid">
              <div><span>{layer === "change" ? "Median moisture difference" : "Median soil moisture"}</span><strong>{layer === "change" ? formatDifference(study.change_summary.median) : formatMoisture(selectedObservation?.median ?? 0)}</strong><small>{layer === "change" ? "Latest minus baseline median" : selectedObservation ? dateLabel(selectedObservation.date) : ""}</small></div>
              <div><span>Valid coverage</span><strong>{formatPercent(currentCoverage)}</strong><small>{layer === "change" ? "Change-layer coverage" : "Selected-date coverage"}</small></div>
              <div><span>{layer === "change" ? "Target-date uncertainty" : "Median uncertainty"}</span><strong>{(displayedSummary?.uncertainty_median ?? 0).toFixed(3)}</strong><small>{layer === "change" ? "Not propagated into change" : "Product-reported"}</small></div>
            </div>
            <div className="agri-reading">
              <span className="agri-eyebrow">CURRENT LAYER</span>
              <strong>{layer === "change" ? "Latest − baseline median" : "Soil moisture · selected date"}</strong>
              <p>{layer === "change"
                ? "Difference between " + study.target_date + " and the pixel-wise median of " + study.baseline_count + " baseline dates. Positive and negative values are changes in the measured soil-moisture variable, not crop-health classifications. The displayed uncertainty remains the target-date product uncertainty; it is not propagated into this difference."
                : "The selected observation is " + (selectedObservation ? dateLabel(selectedObservation.date) : "not selected") + ". The estimate is displayed with its valid-pixel coverage and uncertainty."}</p>
            </div>
            {previewError && <p className="agri-alert" role="alert">{previewError}</p>}
            <button type="button" className="agri-secondary-button" onClick={exportCsv}>Export dated statistics · CSV</button>
          </> : <div className="agri-no-study"><strong>No published SME2 result yet</strong><p>The workspace is ready, but no genuine, checksum-verified Agriculture study has been published here.</p></div>}
        </div>
      ),
    },
    {
      id: "operator", number: "02", label: "Operator", hint: "Configure an AOI and generate the local processing workflow",
      content: (
        <div className="agri-drawer-panel">
          <p className="agri-intro">Configure a WGS84 area and date range. This browser creates terminal commands; NASA search, Earthdata login and processing run locally in your repository.</p>
          <div className="agri-form-section">
            <div className="agri-section-heading"><span className="agri-eyebrow">01 / STUDY AREA</span><span>WGS84 · decimal degrees</span></div>
            <div className="agri-coordinate-grid">
              <label>West<input inputMode="decimal" value={west} onChange={(event) => setWest(event.target.value)} placeholder="e.g. 90.20" aria-label="AOI west longitude" /></label>
              <label>South<input inputMode="decimal" value={south} onChange={(event) => setSouth(event.target.value)} placeholder="e.g. 23.80" aria-label="AOI south latitude" /></label>
              <label>East<input inputMode="decimal" value={east} onChange={(event) => setEast(event.target.value)} placeholder="e.g. 90.60" aria-label="AOI east longitude" /></label>
              <label>North<input inputMode="decimal" value={north} onChange={(event) => setNorth(event.target.value)} placeholder="e.g. 24.20" aria-label="AOI north latitude" /></label>
            </div>
          </div>
          <div className="agri-form-section">
            <div className="agri-section-heading"><span className="agri-eyebrow">02 / TIME WINDOW</span><span>SME2 gate: {MIN_DATE} onward</span></div>
            <div className="agri-date-grid">
              <label>Start date<input type="date" min={MIN_DATE} max={MAX_DATE} value={start} onChange={(event) => setStart(event.target.value)} /></label>
              <label>End date<input type="date" min={MIN_DATE} max={MAX_DATE} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
            </div>
          </div>
          <div className="agri-form-section">
            <div className="agri-section-heading"><span className="agri-eyebrow">03 / RUN ID</span><span>Safe lowercase identifier</span></div>
            <label className="agri-run-label">Run ID<input value={runId} onChange={(event) => setRunId(event.target.value)} spellCheck={false} aria-label="Agriculture run ID" /></label>
          </div>
          <div className={"agri-validation " + (formValid ? "is-valid" : "is-invalid")} role="status">
            <i aria-hidden="true" />{formValid ? "AOI, dates and run ID are valid." : "Enter a valid non-crossing WGS84 AOI, ordered dates and safe run ID to enable commands."}
          </div>
          <button type="button" className="agri-primary-button" disabled={!formValid} onClick={() => { setCommandsVisible(true); setCopyState(""); }}>
            Generate processing commands
          </button>
          {commandsVisible && generatedCommands && <div className="agri-commands">
            <div className="agri-section-heading"><span className="agri-eyebrow">LOCAL TERMINAL WORKFLOW</span><button type="button" onClick={() => setCommandsVisible(false)}>Hide</button></div>
            <pre><code>{generatedCommands}</code></pre>
            <button type="button" className="agri-secondary-button" onClick={copyCommands}>Copy all commands</button>
            {copyState && <p role="status" className="agri-copy-status">{copyState}</p>}
          </div>}
          <p className="agri-small-note">Generating commands does not mean NASA data are available. The CLI will stop if CMR has no compatible series, authentication fails, or the native SME2 data do not pass validation.</p>
        </div>
      ),
    },
    {
      id: "evidence", number: "03", label: "Evidence", hint: "Review product maturity, quality flags, coverage and provenance",
      content: (
        <div className="agri-drawer-panel">
          <p className="agri-intro">The workspace separates the product&apos;s observations, derived differences and contextual sources. SME2 PROVISIONAL is not a fully calibrated agricultural decision product.</p>
          {study ? <>
            <div className={"agri-verdict " + (study.evidence_status === "INCONCLUSIVE_COVERAGE" ? "is-inconclusive" : "")}>
              <span className="agri-eyebrow">EVIDENCE STATUS</span>
              <strong>{study.evidence_status === "INCONCLUSIVE_COVERAGE" ? "Inconclusive · coverage below 20%" : "Exploratory · not independently validated"}</strong>
              <p>Target coverage: {formatPercent(target?.valid_fraction ?? 0)} · change coverage: {formatPercent(study.change_summary.valid_fraction)} · fixed floor: 20%.</p>
            </div>
            <details className="agri-details" open>
              <summary>Quality and screening protocol</summary>
              <ul>
                <li>Soil moisture must be finite and within 0.02–0.60 m³/m³.</li>
                <li>Uncertainty must be finite and non-negative.</li>
                <li>retrievalQualityFlag bits 0–3 must all be set; anomaly bits 4–7 must be clear.</li>
                <li>surfaceQualityFlag must equal zero. This excludes water, urban, precipitation, snow/ice, frozen-ground, terrain and dense-vegetation flags; it can reduce coverage over crop areas. Fractional flags and NoData remain unassessed.</li>
                <li>All observations must share the same release and native grid; no resampling is performed.</li>
              </ul>
            </details>
            <details className="agri-details">
              <summary>Source and processing provenance</summary>
              <dl className="agri-provenance">
                <div><dt>Collection</dt><dd>{study.product}</dd></div>
                <div><dt>Maturity</dt><dd>{study.product_maturity}</dd></div>
                <div><dt>Release</dt><dd>{study.release}</dd></div>
                <div><dt>Track / frame</dt><dd>{study.track} / {study.frame}</dd></div>
                <div><dt>Direction / frequency</dt><dd>{study.direction} / {study.frequency}</dd></div>
                <div><dt>Baseline dates</dt><dd>{study.baseline_dates.map(dateLabel).join(", ")}</dd></div>
              </dl>
            </details>
            <details className="agri-details">
              <summary>Granule identity and source hashes</summary>
              <ul className="agri-granule-list">
                {study.observations.map((item) => <li key={item.date}>
                  <strong>{dateLabel(item.date)}</strong>
                  <span>{item.granule_name ?? "Granule filename not recorded"}</span>
                  <code>{item.source_sha256 ?? "Source digest not recorded"}</code>
                </li>)}
              </ul>
            </details>
          </> : <div className="agri-no-study"><strong>No study provenance loaded</strong><p>Source metadata and statistics will appear only after a real publication passes schema and checksum verification.</p></div>}
          <div className="agri-source-list">
            <strong>Official references</strong>
            <a href="https://nisar-docs.asf.alaska.edu/sme2/" target="_blank" rel="noreferrer">ASF NISAR SME2 guide ↗</a>
            <a href="https://nisar-docs.asf.alaska.edu/provisional-known-issues/" target="_blank" rel="noreferrer">PROVISIONAL product known issues ↗</a>
            <a href="https://earthaccess.readthedocs.io/en/latest/api/" target="_blank" rel="noreferrer">earthaccess API documentation ↗</a>
          </div>
          <p className="agri-small-note">Unsigned SHA-256 checksums protect against accidental changes relative to the published manifest. They are not digital signatures or proof of NASA authenticity.</p>
        </div>
      ),
    },
  ];

  return (
    <InvestigationWorkspace
      hazard="agriculture"
      className="agriculture-workspace"
      caseName="SME2 soil-moisture feasibility"
      title="Agriculture · soil moisture"
      subtitle="Explore dated NISAR SME2 PROVISIONAL estimates, quality flags and uncertainty without inferring crop health."
      questContent={<span className={"agri-status-pill " + (loadState === "ready" ? "is-ready" : loadState === "error" ? "is-error" : "")}><i aria-hidden="true" />{statusText}</span>}
      rail={<div className="agri-rail">
        <span className="agri-eyebrow">MEASUREMENT WORKSPACE</span>
        <strong>{study ? study.study_id : "No study published"}</strong>
        <p>{study ? study.observations.length + " dated observations · " + study.release : "Configure an area and run the local SME2 workflow to publish a real result."}</p>
        <div className="agri-rail-divider" />
        <span className="agri-eyebrow">PRODUCT MATURITY</span>
        <strong className="agri-rail-maturity">NISAR L3 · PROVISIONAL</strong>
        <p>Exploratory soil-moisture evidence. Not crop classification.</p>
      </div>}
      map={<AgricultureMap aoi={aoi} displayBounds={study?.preview_bounds ?? null} previewUrl={previewUrl} satelliteBasemap={satelliteBasemap} noStudy={noStudy} layer={layer} />}
      mapToolbar={<div className="agri-map-toolbar" role="group" aria-label="Agriculture map layers">
        <button type="button" aria-pressed={layer === "moisture"} disabled={!study} onClick={() => setLayer("moisture")}>Soil moisture</button>
        <button type="button" aria-pressed={layer === "change"} disabled={!study} onClick={() => setLayer("change")}>Change</button>
        <span>{layer === "change" ? "Latest − baseline" : selectedObservation ? dateLabel(selectedObservation.date) : "No layer loaded"}</span>
      </div>}
      drawerTabs={drawerTabs}
      drawerPersistent={<div className={"agri-drawer-status " + (loadState === "error" ? "is-error" : "")}><i aria-hidden="true" />{loadState === "error" ? loadError : loadState === "ready" ? "SHA-256 checked · " + (study?.evidence_status ?? "") : noStudy ? "No real Agriculture publication is bundled." : "No synthetic study is substituted."}</div>}
      drawer={<div className="agri-drawer-panel"><p>Choose Explore, Operator or Evidence.</p></div>}
      footer={<div className="agri-footer">
        <div className="agri-footer-head">
          <span className="agri-eyebrow">OBSERVATION TIMELINE</span>
          <span>{study ? (selectedIndex + 1) + " / " + study.observations.length + " · " + study.target_date + " target" : "No dated SME2 observations published"}</span>
        </div>
        {study ? <>
          <div className="agri-timeline-strip" role="group" aria-label="Select soil-moisture observation date">
            {study.observations.map((item, index) => <button key={item.date} type="button" className={index === selectedIndex ? "is-active" : ""} aria-pressed={index === selectedIndex} onClick={() => { setSelectedIndex(index); setLayer("moisture"); }}>
              <span>{dateLabel(item.date)}</span><strong>{formatMoisture(item.median)}</strong><small>{formatPercent(item.valid_fraction)} valid</small>
            </button>)}
          </div>
          <div className="agri-chart" role="group" aria-label="Median soil moisture with fifth to ninety-fifth percentile range; select a point to inspect a date">
            <div className="agri-chart-axis"><span>m³/m³</span><span>{chartRange.max.toFixed(2)}</span><span>{chartRange.min.toFixed(2)}</span></div>
            <div className="agri-chart-plot">
              <div className="agri-chart-grid agri-chart-grid--top" />
              <div className="agri-chart-grid agri-chart-grid--middle" />
              <div className="agri-chart-grid agri-chart-grid--bottom" />
              {study.observations.map((item, index) => {
                const left = study.observations.length === 1 ? 50 : (index / (study.observations.length - 1)) * 100;
                const top = 100 - ((item.median - chartRange.min) / (chartRange.max - chartRange.min)) * 100;
                const low = 100 - ((item.p05 - chartRange.min) / (chartRange.max - chartRange.min)) * 100;
                const high = 100 - ((item.p95 - chartRange.min) / (chartRange.max - chartRange.min)) * 100;
                return <div key={item.date} className={"agri-chart-point " + (index === selectedIndex ? "is-active" : "")} style={{ left: left + "%", top: top + "%" }}>
                  <span className="agri-chart-range" style={{ height: Math.max(3, low - high) + "%", top: (high - top) + "%" }} />
                  <button type="button" aria-label={"Select " + dateLabel(item.date) + "; median " + formatMoisture(item.median) + ", P05 " + formatMoisture(item.p05) + ", P95 " + formatMoisture(item.p95)} aria-pressed={index === selectedIndex} onClick={() => { setSelectedIndex(index); setLayer("moisture"); }}><span /></button>
                </div>;
              })}
            </div>
            <div className="agri-chart-legend"><span><i className="median" />Median</span><span><i className="range" />P05–P95 range</span></div>
          </div>
        </> : <div className="agri-footer-empty">Dated observations will appear here after genuine SME2 granules are processed and a checksum-verified study is published.</div>}
      </div>}
      satelliteBasemap={satelliteBasemap}
      onToggleBasemap={() => setSatelliteBasemap((value) => !value)}
    />
  );
}

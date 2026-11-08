"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { VolcanoRecord } from "@/app/api/volcanoes/catalog/route";
import type { VolcanoCoverage } from "./VolcanoGlobalMap";
import InvestigationWorkspace from "@/components/layout/InvestigationWorkspace";
import HazardWalkthrough from "@/components/shared/HazardWalkthrough";

const VolcanoGlobalMap = dynamic(() => import("./VolcanoGlobalMap"), {
  ssr: false,
  loading: () => <div className="global-map-loading">Loading volcano map…</div>,
});

interface CatalogResponse {
  source: string;
  sourceUrl: string;
  status: "LIVE" | "FALLBACK";
  total: number | null;
  message?: string;
  volcanoes: VolcanoRecord[];
}

interface CoverageResponse {
  status: "FOOTPRINTS_FOUND" | "NO_RESULT_AVAILABLE";
  source: string;
  productHits: Record<string, number | null>;
  truncated: boolean;
  features: VolcanoCoverage["features"];
}

const INITIAL_VOLCANO = "221091";
const INITIAL_START = "2025-11-20";
const INITIAL_END = "2025-12-07";
const EMPTY_VOLCANOES: VolcanoRecord[] = [];

function formatCount(value: number | null) {
  return value === null ? "—" : value.toLocaleString();
}

export default function VolcanoDirectory() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [selectedId, setSelectedId] = useState(INITIAL_VOLCANO);
  const [query, setQuery] = useState("");
  const [coverage, setCoverage] = useState<VolcanoCoverage | null>(null);
  const [coverageInfo, setCoverageInfo] = useState<CoverageResponse | null>(null);
  const [coverageError, setCoverageError] = useState("");
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [startDate, setStartDate] = useState(INITIAL_START);
  const [endDate, setEndDate] = useState(INITIAL_END);
  const coverageRequest = useRef<AbortController|null>(null);

  function clearCoverage() {
    coverageRequest.current?.abort();
    coverageRequest.current = null;
    setCoverage(null); setCoverageInfo(null); setCoverageError(""); setCoverageLoading(false);
  }

  useEffect(()=>()=>coverageRequest.current?.abort(),[]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/volcanoes/catalog", { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as CatalogResponse;
        if (!response.ok) throw new Error("Could not load the Smithsonian volcano directory.");
        return result;
      })
      .then(setCatalog)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setCatalog({ source: "Smithsonian source unavailable", sourceUrl: "https://volcano.si.edu/", status: "FALLBACK", total: null, volcanoes: [] });
        }
      });
    return () => controller.abort();
  }, []);

  const volcanoes = catalog?.volcanoes ?? EMPTY_VOLCANOES;
  const selected = volcanoes.find((volcano) => volcano.id === selectedId) ?? volcanoes[0] ?? null;
  const matching = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return volcanoes.slice(0, 8);
    return volcanoes.filter((volcano) => `${volcano.name} ${volcano.country} ${volcano.region}`.toLowerCase().includes(value)).slice(0, 12);
  }, [query, volcanoes]);

  async function findCoverage() {
    if (!selected) return;
    coverageRequest.current?.abort();
    const controller = new AbortController();
    coverageRequest.current = controller;
    setCoverageLoading(true);
    setCoverageError("");
    setCoverage(null);
    setCoverageInfo(null);
    try {
      const params = new URLSearchParams({ lat: String(selected.latitude), lon: String(selected.longitude), start: startDate, end: endDate });
      const response = await fetch(`/api/volcanoes/coverage?${params.toString()}`, {signal:controller.signal});
      const result = await response.json() as CoverageResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || "NASA interferogram search failed.");
      setCoverageInfo(result);
      setCoverage({ type: "FeatureCollection", features: result.features });
    } catch (error) {
      if(!controller.signal.aborted) setCoverageError(error instanceof Error ? error.message : "NASA interferogram search failed.");
    } finally {
      if(coverageRequest.current===controller) setCoverageLoading(false);
    }
  }

  const selectedIsHayli = selected?.id === INITIAL_VOLCANO || selected?.name.toLowerCase() === "hayli gubbi";
  const selectedIsKilauea = selected?.name.toLowerCase().includes("kīlauea") || selected?.name.toLowerCase().includes("kilauea");
  const selectedCaseHref = selectedIsKilauea ? "/volcano/kilauea" : "/volcano/hayli-gubbi";
  const volcanoDrawerTabs = [
    { id: "explore", number: "01", label: "Explore", hint: "Find and select a volcano", anchorIds: ["volcano-guide-explore"], content: <div id="volcano-guide-explore" className="volcano-tab-panel volcano-controls">
      <p className="hazard-tab-intro">Search the Smithsonian volcano directory or select a published NISAR case. The map stays visible as you browse.</p>
      <label htmlFor="volcano-search">Find a volcano</label>
      <input id="volcano-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, country, or region" autoComplete="off" />
      <div className="volcano-results" role="listbox" aria-label="Volcanoes">
        {catalog === null ? <p className="volcano-empty-list" role="status">Loading the Smithsonian volcano directory…</p> : matching.length ? matching.map((volcano) => <button key={volcano.id} type="button" role="option" aria-selected={volcano.id === selected?.id} onClick={() => { setSelectedId(volcano.id); clearCoverage(); }}><span><strong>{volcano.name}</strong><small>{volcano.country} · {volcano.region}</small></span><span aria-hidden="true">›</span></button>) : <p className="volcano-empty-list">No matching volcanoes. Try another spelling or country.</p>}
      </div>
      {selected && <div className="volcano-selected"><div className="volcano-selected__title"><span>Selected volcano</span><strong>{selected.name}</strong></div><dl><div><dt>Country / region</dt><dd>{selected.country} · {selected.region}</dd></div><div><dt>Coordinates</dt><dd>{selected.latitude.toFixed(4)}°, {selected.longitude.toFixed(4)}°</dd></div><div><dt>Elevation</dt><dd>{selected.elevationM === null ? "Not listed" : `${selected.elevationM.toLocaleString()} m`}</dd></div></dl>{selected.gvpUrl && <a href={selected.gvpUrl} target="_blank" rel="noreferrer">Smithsonian profile ↗</a>}{(selectedIsHayli || selectedIsKilauea) && <Link href={selectedCaseHref}>{selectedIsKilauea ? "Read the published Kīlauea study" : "Read the published Hayli Gubbi case"} ↗</Link>}</div>}
      <div className="volcano-featured-links"><Link className="volcano-case-link" href="/volcano/hayli-gubbi">Open Hayli Gubbi case ↗</Link><Link className="volcano-case-link" href="/volcano/kilauea">Open Kīlauea study ↗</Link></div>
    </div> },
    { id: "check", number: "02", label: "Check it", hint: "Search NISAR interferogram observations", anchorIds: ["volcano-guide-check"], content: <div id="volcano-guide-check" className="volcano-tab-panel volcano-controls">
      <p className="hazard-tab-intro">Search for acquired NISAR interferograms near the selected volcano and dates. A footprint is observation coverage, not deformation evidence.</p>
      <div className="volcano-date-range"><label htmlFor="volcano-start">Search NISAR GUNW dates</label><div><input id="volcano-start" type="date" value={startDate} onChange={(event) => {setStartDate(event.target.value);clearCoverage();}} /><span>to</span><input aria-label="End date" type="date" value={endDate} onChange={(event) => {setEndDate(event.target.value);clearCoverage();}} /></div><p>Searches both BETA and PROVISIONAL L2 unwrapped interferograms near the selected volcano.</p><button type="button" onClick={findCoverage} disabled={!selected || coverageLoading || !startDate || !endDate || startDate > endDate}>{coverageLoading ? "Searching NASA catalog…" : "Check NISAR coverage"}</button></div>
      {coverageError && <p className="volcano-api-message is-error" role="alert">{coverageError}</p>}
      {coverageInfo && <div className="volcano-api-message" role="status">{coverageInfo.status === "FOOTPRINTS_FOUND" ? <><strong>{coverage?.features?.length ?? 0} scene footprint(s) found</strong><span>BETA hits: {formatCount(coverageInfo.productHits["NISAR_L2_GUNW_BETA_V1"] ?? null)} · PROVISIONAL hits: {formatCount(coverageInfo.productHits["NISAR_L2_GUNW_PROVISIONAL_V1"] ?? null)}</span>{coverageInfo.truncated && <span>Results are capped; narrow the date range.</span>}</> : <><strong>No interferogram result available for this place and time.</strong><span>This does not mean the volcano had no deformation.</span></>}</div>}
      <p className="volcano-status-strip"><span className={`volcano-status-dot ${catalog?.status === "LIVE" ? "is-live" : ""}`} /><span>{catalog?.status === "LIVE" ? `${formatCount(catalog.total)} volcanoes` : "Volcano catalog"} · {catalog?.source ?? "Smithsonian Global Volcanism Program"}</span></p>
    </div> },
    { id: "learn", number: "03", label: "Learn", hint: "Understand locations, coverage, and result limits", anchorIds: ["volcano-guide-learn"], content: <div id="volcano-guide-learn" className="volcano-tab-panel volcano-controls">
      <p className="hazard-tab-intro">Three layers tell different parts of the story. Only the published case pages show processed deformation evidence.</p>
      <section className="volcano-explainer"><div><span>01</span><h2>Catalog points</h2><p>Locations come from the Smithsonian’s Holocene volcano inventory. It records geological history, not live eruption alerts.</p></div><div><span>02</span><h2>Radar coverage</h2><p>Footprints show NISAR GUNW interferogram products returned by NASA’s catalog near the selected place and date range.</p></div><div><span>03</span><h2>Deformation evidence</h2><p>Published regional phase studies are available near Hayli Gubbi and Kīlauea. Other volcanoes have no processed result available.</p></div></section>
      <p className="volcano-context-note"><strong>Reading an empty area</strong><span>No result available means no published analysis for that location; it does not mean no deformation occurred.</span></p>
      <footer className="volcano-footer"><a href="https://volcano.si.edu/database/webservices.cfm" target="_blank" rel="noreferrer">Smithsonian GVP data source ↗</a><a href="https://nisar-docs.asf.alaska.edu/earthdata-search/" target="_blank" rel="noreferrer">NISAR product guide ↗</a></footer>
    </div> },
  ];

  return (
    <InvestigationWorkspace hazard="volcano" className="volcano-page volcano-workspace" caseName="GLOBAL VOLCANO OBSERVATIONS" title="Volcanoes, seen through radar" subtitle="Browse Smithsonian volcano locations, then check whether NISAR has published an interferogram near a place and date." rail={<>
      <p className="volcano-kicker">NISAR · VOLCANIC GROUND MOTION</p>
      <HazardWalkthrough guideTitle="VOLCANO MAP GUIDE" steps={[{ title: "Explore the volcano directory", target: "volcano-guide-explore", explanation: "The map dots are volcano catalog locations from Smithsonian GVP. Select one to see its record and available published case link." }, { title: "Check NISAR observations", target: "volcano-guide-check", explanation: "Search compatible NISAR interferograms by place and date. Footprints are acquisitions, not deformation detections." }, { title: "Understand the evidence", target: "volcano-guide-learn", explanation: "Only Hayli Gubbi and Kīlauea have published deformation studies here. Other locations mean no result available, not no ground motion." }]} />
      <Link className="volcano-case-link" href="/volcano/hayli-gubbi">Open Hayli Gubbi case <span aria-hidden="true">↗</span></Link>
      <Link className="volcano-case-link" href="/volcano/kilauea">Open Kīlauea NISAR study <span aria-hidden="true">↗</span></Link>
      <div className="volcano-status-strip" role="note">
        <span className={`volcano-status-dot ${catalog?.status === "LIVE" ? "is-live" : ""}`} />
        <span><strong>{catalog?.status === "LIVE" ? `${formatCount(catalog.total)} volcanoes` : "Volcano catalog"}</strong> from {catalog?.source ?? "Smithsonian Global Volcanism Program"}</span>
        {catalog?.status === "FALLBACK" && <span className="volcano-muted">The live inventory is unavailable; only the featured region may be shown.</span>}
      </div>
      <div className="volcano-context-note"><strong>Catalog locations</strong><p>The Smithsonian inventory records volcanic history. It is not a live eruption-alert feed.</p></div>
      <div className="volcano-context-note"><strong>Deformation evidence</strong><p>Two regional phase studies are published: Hayli Gubbi and Kīlauea. Other places have no processed result available.</p></div>
    </>} map={<>
          <div className="volcano-map-title"><strong>Worldwide volcano directory</strong><span>Catalog locations and scene footprints are separate layers.</span></div>
          <div className="volcano-map-frame">
            <VolcanoGlobalMap volcanoes={volcanoes} selected={selected} coverage={coverage} onSelect={(volcano) => { setSelectedId(volcano.id); clearCoverage(); }} />
            {!volcanoes.length && <div className="volcano-map-empty" role="status">{catalog === null ? "Loading Smithsonian volcano locations…" : "Volcano locations are unavailable. Try again later or use the case link above."}</div>}
          </div>
    </>} drawerTabs={volcanoDrawerTabs} drawerTabsPlacement="drawer" footer={<>
      <div className="volcano-map-legend"><span><i className="volcano-legend-pin" />Smithsonian catalog location</span><span><i className="volcano-legend-footprint" />NISAR GUNW footprint</span><span><i className="volcano-legend-processed" />Published study area</span></div>
      <span className="iw-footer-note">Coverage map · no global eruption classification</span>
    </>} />
  );
}

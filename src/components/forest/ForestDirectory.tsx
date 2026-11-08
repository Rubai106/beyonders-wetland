"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { coordinate, RONDONIA_BBOX } from "@/lib/forest-study";
import type { ForestCandidates, ForestCatalogEntry, ForestCoverage, ForestStudy, ForestPublication } from "@/lib/forest-study";
import type { ForestFocus } from "./ForestMap";
import InvestigationWorkspace from "@/components/layout/InvestigationWorkspace";
import HazardWalkthrough from "@/components/shared/HazardWalkthrough";
const ForestMap = dynamic(() => import("./ForestMap"), { ssr: false, loading: () => <div className="forest-loading">Loading forest map…</div> });
const WORLDCOVER_CLASSES = [
    { label: "Tree cover", color: "#006400" },
    { label: "Shrubland", color: "#ffbb22" },
    { label: "Grassland", color: "#ffff4c" },
    { label: "Cropland", color: "#f096ff" },
    { label: "Built-up", color: "#fa0000" },
    { label: "Bare / sparse vegetation", color: "#b4b4b4" },
    { label: "Snow and ice", color: "#f0f0f0" },
    { label: "Permanent water", color: "#0064c8" },
    { label: "Herbaceous wetland", color: "#0096a0" },
    { label: "Mangroves", color: "#00cf75" },
    { label: "Moss and lichen", color: "#fae6a0" },
] as const;
export default function ForestDirectory() {
    const [studies, setStudies] = useState<ForestCatalogEntry[]>([]);
    const [selected, setSelected] = useState("");
    const [catalogError, setCatalogError] = useState("");
    const [focus, setFocus] = useState<ForestFocus | null>(null);
    const [lat, setLat] = useState("-10.3");
    const [lon, setLon] = useState("-62.65");
    const [query, setQuery] = useState("");
    const [places, setPlaces] = useState<{
        name: string;
        latitude: number;
        longitude: number;
    }[]>([]);
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const [tree, setTree] = useState(true);
    const [imagery, setImagery] = useState(false);
    const [footprints, setFootprints] = useState(true);
    const [changes, setChanges] = useState(true);
    const [mosaicDate, setMosaicDate] = useState("");
    const [start, setStart] = useState("2026-06-17");
    const [end, setEnd] = useState("2026-09-30");
    const [coverage, setCoverage] = useState<ForestCoverage | null>(null);
    const [candidates, setCandidates] = useState<ForestCandidates | null>(null);
    const [study, setStudy] = useState<ForestStudy | null>(null);
    const [base, setBase] = useState("");
    const [frameDate, setFrameDate] = useState("");
    const request = useRef<AbortController | null>(null);
    useEffect(() => { const c = new AbortController(); fetch("/forests/catalog.json", { signal: c.signal, cache: "no-store" }).then(async (r) => { if (!r.ok)
        throw Error(); return r.json(); }).then(r => setStudies(r.studies)).catch(() => { if (!c.signal.aborted)
        setCatalogError("Published study catalog unavailable. You can still explore places and coverage."); }); return () => c.abort(); }, []);
    useEffect(() => () => request.current?.abort(), []);
    useEffect(() => {
        const entry = studies.find(s => s.id === selected);
        if (!entry)
            return;
        const c = new AbortController();
        fetch(entry.index_url, { signal: c.signal, cache: "no-store" }).then(async (r) => { if (!r.ok)
            throw Error("Publication index unavailable."); return await r.json() as ForestPublication; })
            .then(async (index) => { const r = await fetch(index.study_url, { signal: c.signal }); if (!r.ok)
            throw Error("Published study unavailable."); return { index, study: await r.json() as ForestStudy }; })
            .then(({ index, study }) => { setStudy(study); setBase(index.study_url.replace(/study.json$/, "")); setFrameDate(study.frames.at(-1)?.date ?? ""); })
            .catch(e => { if (!c.signal.aborted)
            setMessage(e instanceof Error ? e.message : "Could not load study."); });
        return () => c.abort();
    }, [selected, studies]);
    useEffect(() => {
        const frame = study?.frames.find(f => f.date === frameDate);
        if (!frame)
            return;
        const c = new AbortController();
        fetch(`${base}${frame.candidates_geojson}`, { signal: c.signal }).then(async (r) => { if (!r.ok)
            throw Error(); return r.json(); }).then(setCandidates).catch(() => { if (!c.signal.aborted)
            setMessage("Candidate layer unavailable for this publication date."); });
        return () => c.abort();
    }, [frameDate, study, base]);
    function clearLookup() { request.current?.abort(); setLoading(false); setCoverage(null); setMessage(""); }
    function move(latitude: number, longitude: number) { request.current?.abort(); setLoading(false); setCoverage(null); setMessage(""); setLat(String(latitude)); setLon(String(longitude)); setFocus({ lat: latitude, lon: longitude, zoom: 10 }); }
    function searchCoordinates() { const a = coordinate(lat, "latitude"), b = coordinate(lon, "longitude"); if (a === null || b === null) {
        setMessage("Enter valid decimal coordinates: latitude −85.0511 to 85.0511, longitude −180 to 180.");
        return;
    } move(a, b); }
    async function searchPlaces() { request.current?.abort(); const c = new AbortController(); request.current = c; setLoading(true); setPlaces([]); setMessage(""); try {
        const r = await fetch(`/api/forests/places?q=${encodeURIComponent(query)}`, { signal: c.signal });
        const body = await r.json();
        if (!r.ok)
            throw Error(body.error);
        setPlaces(body.places);
        if (!body.places.length)
            setMessage("No matching places. Try another name or coordinates.");
    }
    catch (e) {
        if (!c.signal.aborted)
            setMessage(e instanceof Error ? e.message : "Place search failed.");
    }
    finally {
        if (request.current === c)
            setLoading(false);
    } }
    async function searchCoverage() { const a = coordinate(lat, "latitude"), b = coordinate(lon, "longitude"); if (a === null || b === null) {
        searchCoordinates();
        return;
    } request.current?.abort(); const c = new AbortController(); request.current = c; setLoading(true); setCoverage(null); setMessage(""); try {
        const params = new URLSearchParams({ lat: String(a), lon: String(b), start, end });
        const r = await fetch(`/api/forests/coverage?${params}`, { signal: c.signal });
        const body = await r.json();
        if (!r.ok)
            throw Error(body.error);
        setCoverage({ type: "FeatureCollection", features: body.features });
        setMessage(`${body.features.length} acquired scene footprint(s)${body.truncated ? " · search capped; narrow the dates" : ""}${body.status === "SNAPSHOT" ? " · saved catalog snapshot; live service unavailable" : ""}. ${body.features.length ? "Scene coverage is not a disturbance detection." : "No result available; this does not mean no forest change."}`);
    }
    catch (e) {
        if (!c.signal.aborted)
            setMessage(e instanceof Error ? e.message : "NASA coverage search unavailable.");
    }
    finally {
        if (request.current === c)
            setLoading(false);
    } }
    function selectStudy(id: string) { setSelected(id); setStudy(null); setCandidates(null); setFrameDate(""); setBase(""); const s = studies.find(s => s.id === id); if (s)
        move((s.bbox[1] + s.bbox[3]) / 2, (s.bbox[0] + s.bbox[2]) / 2); }
    const forestDrawerTabs = [
      { id: "explore", number: "01", label: "Explore", hint: "Find a place or open a published forest study", anchorIds: ["forest-guide-explore"], content: <div id="forest-guide-explore" className="forest-tab-panel forest-controls">
        <p className="hazard-tab-intro">Find a place, choose a published study, or jump to coordinates. The map remains visible while you explore.</p>
        <label>Saved study<select aria-label="Saved study" value={selected} onChange={e => selectStudy(e.target.value)}><option value="">Global exploration</option>{studies.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        {!studies.length && <p>No published forest results available yet. <Link href="/forest/rondonia">View the study method.</Link></p>}
        {catalogError && <p role="alert">{catalogError}</p>}
        {study && <label>Processed observation date<select aria-label="Processed observation date" value={frameDate} onChange={e => { setCandidates(null); setFrameDate(e.target.value); }}>{study.frames.map(f => <option key={f.date}>{f.date}</option>)}</select></label>}
        <form onSubmit={e => { e.preventDefault(); searchPlaces(); }}><label htmlFor="forest-place">Find a place</label><div className="forest-input-row"><input id="forest-place" value={query} onChange={e => setQuery(e.target.value)} placeholder="Town, forest, or country"/><button disabled={loading || query.trim().length < 3}>Search</button></div></form>
        {places.length > 0 && <ul className="forest-places">{places.map(p => <li key={`${p.latitude},${p.longitude}`}><button onClick={() => { move(p.latitude, p.longitude); setPlaces([]); }}>{p.name}</button></li>)}</ul>}
        <form onSubmit={e => { e.preventDefault(); searchCoordinates(); }}><div className="forest-two-fields"><label>Latitude<input value={lat} onChange={e => { clearLookup(); setLat(e.target.value); }} placeholder="−10.30"/></label><label>Longitude<input value={lon} onChange={e => { clearLookup(); setLon(e.target.value); }} placeholder="−62.65"/></label></div><button>Go to coordinates</button><small>Decimal degrees · latitude first, longitude second</small></form>
        <button className="forest-secondary" onClick={() => move((RONDONIA_BBOX[1] + RONDONIA_BBOX[3]) / 2, (RONDONIA_BBOX[0] + RONDONIA_BBOX[2]) / 2)}>Go to Rondônia</button>
      </div> },
      { id: "check", number: "02", label: "Check it", hint: "Inspect observation coverage and map layers", anchorIds: ["forest-guide-check"], content: <div id="forest-guide-check" className="forest-tab-panel forest-controls">
        <p className="hazard-tab-intro">Turn context layers on or off, then search the NASA catalog for acquired observations near the selected coordinates.</p>
        <fieldset><legend>Map layers</legend>{[[tree, setTree, "WorldCover land cover · 2021"], [imagery, setImagery, "NISAR radar imagery"], [footprints, setFootprints, "Acquired-scene footprints"], [changes, setChanges, "Published change candidates"]].map(([value, setter, label]) => <label className="forest-check" key={label as string}><input type="checkbox" checked={value as boolean} onChange={e => (setter as (v: boolean) => void)(e.target.checked)}/>{label as string}</label>)}</fieldset>
        <label>Mosaic date (UTC)<input type="date" value={mosaicDate} onChange={e => setMosaicDate(e.target.value)}/></label><small>Blank uses NASA’s latest mosaic. Transparent areas mean no mosaic pixels here at this date or zoom. Mosaic colors are not forest-loss detections.</small>
        <form onSubmit={e => { e.preventDefault(); searchCoverage(); }}><strong>Check observations near these coordinates</strong><div className="forest-two-fields"><label>Start date<input type="date" value={start} onChange={e => { clearLookup(); setStart(e.target.value); }}/></label><label>End date<input type="date" value={end} onChange={e => { clearLookup(); setEnd(e.target.value); }}/></label></div><button disabled={loading || !start || !end || start > end}>{loading ? "Searching…" : "Check NISAR coverage"}</button></form>
        {message && <p className="forest-message" role="status">{message}</p>}
      </div> },
      { id: "learn", number: "03", label: "Learn", hint: "Understand the map sources and limits", anchorIds: ["forest-guide-learn"], content: <div id="forest-guide-learn" className="forest-tab-panel forest-controls">
        <p className="hazard-tab-intro">Use these notes to distinguish historical land cover, acquired radar scenes, and processed change candidates.</p>
        <section className="forest-context-card"><span>MAP READING</span><h2>Coverage is not a detection</h2><p>Green marks tree cover in 2021. Outlines mark acquired scenes. Amber candidates appear only inside a processed study. Blank areas mean no processed result is available.</p></section>
        <details className="forest-method-notes" open><summary>How to read these layers</summary><h3>Historical tree cover</h3><p>The WorldCover map describes land cover in 2021. Green is tree cover; other colors represent other land-cover classes. It is not a current forest inventory.</p><h3>Radar observations</h3><p>NISAR measures radar backscatter. Changes can reflect vegetation structure, moisture, seasons, and land management. A scene footprint records an acquisition, not a clearing.</p><h3>Evidence before interpretation</h3><p>The Rondônia study screens persistent decreases in HV backscatter, then compares optical observations. Candidates remain unverified until independent evidence is reviewed.</p><div><a href="https://esa-worldcover.org/en/data-access">ESA WorldCover source ↗</a><a href="https://nisar-docs.asf.alaska.edu/products-overview/">NISAR products ↗</a><Link href="/operator-guide">Operator guide ↗</Link></div></details>
        <section className="forest-context-card"><span>FIRST CASE</span><h2>Rondônia, Brazil</h2><p>Persistent decreases in HV backscatter are screened against historical tree cover and compared with optical evidence. This is an exploratory candidate study, not confirmed forest loss.</p><Link href="/forest/rondonia">Open case evidence →</Link></section>
      </div> },
    ];
    return <InvestigationWorkspace hazard="forest" className="forest-page forest-workspace" caseName="GLOBAL FOREST OBSERVATIONS" title="Follow the changing forest" subtitle="Explore historical tree cover and worldwide NISAR observations, then inspect a published radar-change study." rail={<>
      <div className="forest-context-heading"><p className="forest-topic">Forest change</p><Link className="forest-button" href="/forest/rondonia">Explore Rondônia evidence ↗</Link></div>
      <div className="forest-status">Historical context: ESA WorldCover 2021 · Acquired scenes: NASA CMR · Change results: processed studies only</div>
      <HazardWalkthrough guideTitle="FOREST MAP GUIDE" steps={[{ title: "Explore the global context", target: "forest-guide-explore", explanation: "Use WorldCover and scene layers to orient yourself. Tree cover is historical context, and an acquired scene outline is not a forest-change detection." }, { title: "Check observations", target: "forest-guide-check", explanation: "Search NISAR coverage for a place and date range. A blank result means coverage or a processed study is unavailable, not that forests are unchanged." }, { title: "Read the method", target: "forest-guide-learn", explanation: "Open the Rondônia study to inspect its radar-change candidates, optical support, screening rule, and limitations." }]} />
      <section className="forest-context-card"><span>MAP READING</span><h2>Coverage is not a detection</h2><p>Green marks tree cover in 2021. Outlines mark acquired scenes. Amber candidates appear only inside a processed study.</p></section>
      <section className="forest-context-card"><span>FIRST CASE</span><h2>Rondônia, Brazil</h2><p>Persistent decreases in HV backscatter are screened against historical tree cover and compared with optical evidence.</p><Link href="/forest/rondonia">Open case evidence →</Link></section>
    </>} map={<>
      <div className="forest-map-title"><strong>Forest context and observation map</strong><span>Blank areas have no processed result available</span></div>
      <div className="forest-map-frame"><ForestMap globalView focus={focus} treeCover={tree} imagery={imagery} mosaicDate={mosaicDate} coverage={footprints ? coverage : null} candidates={changes ? candidates : null} bbox={study?.bbox} studyPublished={Boolean(study)}/></div>
    </>} drawerTabs={forestDrawerTabs} drawerTabsPlacement="drawer" footer={<>
        <div className="forest-legend" aria-label="Map legend">
          {tree && <section className="forest-legend__worldcover" aria-labelledby="worldcover-legend-title">
            <h2 id="worldcover-legend-title">ESA WorldCover 2021 · land-cover classes</h2>
            <ul className="forest-legend__classes">{WORLDCOVER_CLASSES.map(({ label, color }) => <li key={label}><i className="forest-legend__swatch" style={{ backgroundColor: color }} aria-hidden="true" />{label}</li>)}</ul>
            <small>Historical classes · colors may blend with the basemap because this tile overlay is semi-transparent.</small>
          </section>}
          <div className="forest-legend__overlays" aria-label="Additional map layers">
            <span><i style={{ border: "1px solid #dfab45" }}/>Acquired scene footprint</span>
            <span><i style={{ background: "#ffb646" }}/>Unverified radar-change candidate</span>
          </div>
        </div>
        <span className="iw-footer-note">Global context map · no worldwide forest-loss classification</span>
      </>} />;
}

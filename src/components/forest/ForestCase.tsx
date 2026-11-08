"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ForestStudy, ForestPublication, ForestCandidates } from "@/lib/forest-study";
import BandPenetrationExplainer from "../shared/BandPenetrationExplainer";
import InvestigationWorkspace from "@/components/layout/InvestigationWorkspace";
import RadarPixelPhysicsInspector from "@/components/shared/RadarPixelPhysicsInspector";
import OpticalCoverageComparison from "@/components/shared/OpticalCoverageComparison";
import TriageBriefButton from "@/components/shared/TriageBriefButton";
import FieldVolumeDisclosure from "@/components/shared/FieldVolumeDisclosure";
import HazardWalkthrough from "@/components/shared/HazardWalkthrough";
const ForestMap = dynamic(() => import("./ForestMap"), { ssr: false, loading: () => <div className="forest-loading">Loading study map…</div> });
const LABELS: Record<string, string> = { candidates: "Persistent radar-change candidates", delta_hv: "HV change from baseline", hh: "HH backscatter", hv: "HV backscatter", quality: "Valid radar observations", assessed: "Assessed persistence coverage", baseline_hv: "Three-date HV baseline", baseline_hh: "Three-date HH baseline", baseline_mad: "Baseline variability (MAD)", tree_cover: "Tree cover in 2021", optical_support: "Exploratory optical support", ndvi_change: "Optical NDVI change", nbr_change: "Optical NBR change", optical_before: "Optical before", optical_after: "Optical after" };
const number = (n: number | undefined | null) => n === null || n === undefined ? "Not available" : n.toFixed(3);
export default function ForestCase() {
    const [study, setStudy] = useState<ForestStudy | null>(null);
    const [publication, setPublication] = useState<ForestPublication | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [day, setDay] = useState("");
    const [candidateFocus, setCandidateFocus] = useState<{
        lat: number;
        lon: number;
        zoom: number;
    } | null>(null);
    const [mapFocus, setMapFocus] = useState<{
        lat: number;
        lon: number;
        zoom: number;
    } | null>(null);
    const [left, setLeft] = useState("baseline_hv");
    const [right, setRight] = useState("candidates");
    const [showGladS2, setShowGladS2] = useState(false);
    const [gladConfirmedOnly, setGladConfirmedOnly] = useState(false);
    const [showImportedGlad, setShowImportedGlad] = useState(false);
    const [probePoint, setProbePoint] = useState<{ lat: number; lon: number } | null>(null);
    useEffect(() => { const c = new AbortController(); fetch("/forests/rondonia/index.json", { cache: "no-store", signal: c.signal }).then(async (r) => { if (!r.ok)
        throw Error("No published result available yet. The case method and configured observations are shown below."); return await r.json() as ForestPublication; }).then(async (p) => { const r = await fetch(p.study_url, { signal: c.signal }); if (!r.ok)
        throw Error("The published forest study could not load. Reload or open the global forest map."); const s = await r.json() as ForestStudy; if (s.hazard_type !== undefined && s.hazard_type !== "forest_disturbance")
        throw Error("Unexpected study type."); setPublication(p); setStudy(s); setDay(s.frames.at(-1)?.date ?? ""); }).catch(e => { if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : "Study unavailable."); }).finally(() => { if (!c.signal.aborted)
        setLoading(false); }); return () => c.abort(); }, []);
    const frame = study?.frames.find(f => f.date === day);
    const fieldVolumeData = useMemo(() => (study?.frames ?? []).map((item) => ({
        id: item.date,
        label: item.date,
        value: item.stats.candidate_area_km2,
        valueLabel: number(item.stats.candidate_area_km2) + " km²",
        context: item.stats.study_area_km2 > 0 ? item.stats.assessed_area_km2 / item.stats.study_area_km2 : 0,
    })), [study]);
    const base = publication?.study_url.replace(/study.json$/, "") ?? "";
    const layers = { ...(study?.layers ?? {}), ...(frame?.layers ?? {}) };
    const layerLeft = layers[left];
    const layerRight = layers[right];
    const ref = frame?.reference;
    const gladDateRange: [string, string] | undefined = study && day
        ? [study.baseline_dates[0] ?? study.frames[0]?.date ?? day, day]
        : undefined;
    useEffect(() => { const selectedFrame = study?.frames.find(f => f.date === day); if (!selectedFrame || !base)
        return; const c = new AbortController(); fetch(base + selectedFrame.candidates_geojson, { signal: c.signal }).then(async (r) => { if (!r.ok)
        throw Error(); return await r.json() as ForestCandidates; }).then(data => { const geometry = data.features[0]?.geometry; if (!geometry)
        return; const ring = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0][0]; const points = ring.slice(0, -1); setCandidateFocus({ lat: points.reduce((n, p) => n + p[1], 0) / points.length, lon: points.reduce((n, p) => n + p[0], 0) / points.length, zoom: 15 }); }).catch(() => { }); return () => c.abort(); }, [study, day, base]);
    const forestCaseTabs = [
      { id: "explore", number: "01", label: "Explore", hint: "Select an observation date and map layers", anchorIds: ["forest-case-guide-explore"], content: <div id="forest-case-guide-explore" className="forest-tab-panel">
        <p className="hazard-tab-intro">Choose a published date and compare radar layers on the map. Candidate pixels are exploratory signals within historical tree cover.</p>
        {study && frame ? <>
          <section className="forest-study-toolbar"><div><strong>Baseline</strong><p>{study.baseline_dates.join(" · ")}</p></div><div><strong>Method</strong><p>{study.method_version}</p></div></section>
          <FieldVolumeDisclosure
            kind="forest"
            title="Forest persistence through time"
            metricLabel="Recorded candidate area"
            contextLabel="Assessed study-area coverage"
            observations={fieldVolumeData}
            selectedId={day}
            onSelectId={setDay}
            note="Each column is the published candidate area for that date; the companion column is the assessed share of the study area. The canopy is conceptual, not a mapped 3D forest or proof of tree loss."
          />
          {frame.stats.assessed_area_km2 === 0 && <p className="forest-message" role="status">No persistence classification is available for this date. The first later observation needs another valid later date; zero candidate area is not evidence of no forest change.</p>}
          <div className="forest-downloads">{candidateFocus && <button className="forest-button" onClick={() => setMapFocus(candidateFocus)}>Focus candidate patch</button>}<button className="forest-button" onClick={() => setMapFocus({ lat: (study.bbox[1] + study.bbox[3]) / 2, lon: (study.bbox[0] + study.bbox[2]) / 2, zoom: 11 })}>Show full study</button></div>
          <p>Use the selectors above the map to compare the baseline, later observation, persistence result, and reference layers.</p>
        </> : <p role="status">{loading ? "Loading the published forest case…" : error || "No published result is available for this case."}</p>}
      </div> },
      { id: "check", number: "02", label: "Check it", hint: "Review independent optical and alert evidence", anchorIds: ["forest-case-guide-check"], content: <div id="forest-case-guide-check" className="forest-tab-panel">
        <p className="hazard-tab-intro">Compare candidate regions with optical observations and dated GLAD alerts. Missing reference evidence stays unassessed.</p>
        {study && frame ? <>
          <div className="forest-glad-controls"><label className="forest-check"><input type="checkbox" checked={showGladS2} onChange={e => setShowGladS2(e.target.checked)}/>Show GLAD-S2 alerts for the NISAR study window</label>{showGladS2 && <label className="forest-glad-confidence">Alert filter<select aria-label="GLAD-S2 alert confidence filter" value={gladConfirmedOnly ? "confirmed" : "all"} onChange={e => setGladConfirmedOnly(e.target.value === "confirmed")}><option value="all">All alerts in date window</option><option value="confirmed">Confirmed alerts only</option></select></label>}{study.glad && <label className="forest-check"><input type="checkbox" checked={showImportedGlad} onChange={e => setShowImportedGlad(e.target.checked)}/>Show imported, dated GLAD-S2 alerts</label>}</div>
          {showGladS2 && <><p className="forest-glad-key"><i aria-hidden="true"/>Pink pixels: GLAD-S2 alerts from {gladDateRange?.[0] ?? "the baseline"} through {gladDateRange?.[1] ?? day}.</p><p className="forest-message forest-glad-note">A spatial match is independent positive event support, not proof of permanent forest loss. The alert layer has no assessed negative labels; a missing alert is unassessed. Inspect dates and confidence in the <a href="https://glad.earthengine.app/view/s2-forest-alerts" target="_blank" rel="noreferrer">official GLAD-S2 viewer</a>.</p></>}
          <OpticalCoverageComparison />
          <section className="forest-evidence-grid"><article><h2>Exploratory optical signal · not proof of forest loss</h2><p>{ref?.reason ?? ref?.support_rule}</p>{ref?.before_scene && <><dl><div><dt>Before / target offset</dt><dd>{ref.before_date} / {ref.before_offset_days} days</dd></div><div><dt>After / target offset</dt><dd>{ref.after_date} / {ref.after_offset_days} days</dd></div><div><dt>Candidate area with NDVI and NBR decreases</dt><dd>{number(ref.candidate_supported_area_km2)} km²</dd></div><div><dt>Assessed candidate area without both decreases</dt><dd>{number(ref.candidate_without_optical_support_area_km2)} km²</dd></div><div><dt>Unassessed candidate area</dt><dd>{number(ref.candidate_unassessed_area_km2)} km²</dd></div><div><dt>Candidate overlap with index decreases</dt><dd>{ref.support_overlap_fraction == null ? "Suppressed / not available" : `${(ref.support_overlap_fraction * 100).toFixed(1)}%`}</dd></div><div><dt>Median NDVI / NBR change</dt><dd>{number(ref.median_ndvi_change)} / {number(ref.median_nbr_change)}</dd></div></dl><details><summary>Optical scene identifiers</summary><p>{ref.before_scene}</p><p>{ref.after_scene}</p></details></>}<p>{ref?.metric_note ?? "No accuracy score is claimed without an assessed independent classification."}</p><p><strong>This is not a forest-loss reference.</strong> NDVI/NBR decreases can have multiple causes; overlap is exploratory support, not accuracy.</p></article>
          <article><h2>Change through time</h2><p>Median backscatter across valid observations in the analysis rectangle; these summaries do not isolate individual patches.</p><div className="forest-chart"><ResponsiveContainer width="100%" height={230}><LineChart data={study.frames.map(f => ({ date: f.date, HH: f.stats.median_hh_db, HV: f.stats.median_hv_db }))}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="date" tick={{ fontSize: 10 }}/><YAxis unit=" dB" tick={{ fontSize: 10 }}/><Tooltip /><Legend /><Line type="linear" dataKey="HH" stroke="#347151" connectNulls={false}/><Line type="linear" dataKey="HV" stroke="#b87920" connectNulls={false}/></LineChart></ResponsiveContainer></div><table><thead><tr><th>Date</th><th>Candidate km²</th><th>Reference</th></tr></thead><tbody>{study.frames.map(f => <tr key={f.date}><td>{f.date}</td><td>{number(f.stats.candidate_area_km2)}</td><td>{f.reference.status.replaceAll("_", " ")}</td></tr>)}</tbody></table></article></section>
          <RadarPixelPhysicsInspector mode="forest" dataUrl={publication?.physics_grid_url ?? null} date={day} point={probePoint} onPointChange={setProbePoint}/>
          <div className="radar-brief-row"><TriageBriefButton filename="rondonia-evidence-triage.json" title="Rondônia radar-change triage brief" brief={{ site: study.title, event_date: day, baseline_dates: study.baseline_dates, method_version: study.method_version, input_observation: study.inputs.find(input => input.date === day)?.granule_id ?? null, candidate_area_km2: frame.stats.candidate_area_km2, candidate_area_hectares: frame.stats.candidate_area_km2 * 100, assessed_area_km2: frame.stats.assessed_area_km2, optical_reference: { source: ref?.source, before_date: ref?.before_date, after_date: ref?.after_date, common_clear_fraction: ref?.common_clear_fraction, candidate_support_fraction: ref?.support_overlap_fraction, interpretation: ref?.metric_note }, interpretation: "Persistent radar-change candidate within historical 2021 tree cover; not confirmed forest loss.", unavailable: { biomass_or_carbon_estimate: "Not computed: no validated biomass reference for this location and date.", operational_alert: "Not assigned.", population_or_road_exposure: "Not assessed." }, limitations: study.limitations }}/><span>Area uses the native study grid; the public pixel inspector is a compact nearest-pixel preview.</span></div>
        </> : <p role="status">Independent comparison details appear when the publication loads.</p>}
      </div> },
      { id: "learn", number: "03", label: "Learn", hint: "Understand the screening rule, uncertainty, and sources", anchorIds: ["forest-case-guide-learn"], content: <div id="forest-case-guide-learn" className="forest-tab-panel">
        <p className="hazard-tab-intro">The workflow screens for persistent radar change; it does not directly identify why the signal changed.</p>
        <BandPenetrationExplainer variant="forest" />
        <section className="forest-explain"><article><h2>A fixed screening rule</h2><p>Method forest-hv-persistence-1.0.0 compares later HV observations with the median of June 25, July 7 and July 19, 2026. A decrease of at least 3 dB must persist across two consecutive valid later dates. Patches must cover at least 1 hectare.</p></article><article><h2>Historical eligibility</h2><p>The screen applies within WorldCover’s 2021 tree-cover class and an analyst-defined rectangle: −62.75° to −62.55° longitude, −10.40° to −10.20° latitude. Historical trees may have changed before these radar observations.</p></article><article><h2>Interpretation limits</h2><p>Backscatter changes and decreases in optical vegetation indices have multiple possible causes. This case does not estimate carbon, predict clearing, identify illegal logging, or classify worldwide forest loss.</p></article></section>
        {study && frame && <section className="forest-provenance"><h2>Inputs and reproducibility</h2><p>{study.boundary_source} · {study.native_crs} · {study.native_shape.join(" × ")} native pixels · {number(study.pixel_area_km2 * 1e6)} m² per pixel</p><details><summary>All NISAR input observations</summary><ul>{study.inputs.map(input => <li key={input.granule_id}><strong>{input.date} · {input.maturity}</strong><p>{input.granule_id}</p></li>)}</ul></details><p>Run {study.run_id} · Publication {study.publication_version}</p><div className="forest-downloads"><a href={publication?.evidence_url} download>Download evidence package</a><a href={publication?.study_url} download>Study JSON</a><a href={`${base}${frame.candidates_geojson}`} download>{day} candidate GeoJSON</a><a href={publication?.checksums_url} download>Checksums</a>{publication?.native_download_url && <a href={publication.native_download_url}>Native radar and optical subsets</a>}</div><small>Native subsets are operator-managed; an exact native-pixel probe is unavailable in this public viewer.</small><ul>{study.limitations.map(l => <li key={l}>{l}</li>)}</ul></section>}
        <footer className="forest-footer"><a href="https://glad.umd.edu/dataset/glad-forest-alerts">Independent GLAD alerts ↗</a><a href="https://hls.gsfc.nasa.gov/">NASA HLS ↗</a><Link href="/operator-guide">Local processing instructions ↗</Link></footer>
      </div> },
    ];
    return <InvestigationWorkspace hazard="forest" className="forest-page forest-case" caseName="RONDÔNIA · PUBLISHED STUDY" title="What changed in the forest?" subtitle="A real NISAR time series, historical tree-cover context, and an independent optical check. Persistent radar changes remain candidates, not confirmed clearing." rail={<>
      <div className="forest-context-heading"><p className="forest-topic">Rondônia, Brazil</p><Link className="forest-button" href="/forest/global">← Back to forest map</Link></div>
      <HazardWalkthrough guideTitle="RONDÔNIA CASE GUIDE" steps={[{ title: "Choose a radar observation", target: "forest-case-guide-explore", explanation: "Select a later NISAR observation and inspect its HH, HV, baseline, change, and candidate layers on the map." }, { title: "Check the independent evidence", target: "forest-case-guide-check", explanation: "Review optical dates, clear coverage, GLAD alert overlap, and which candidate pixels are supported or unassessed." }, { title: "Read the method and limits", target: "forest-case-guide-learn", explanation: "The output is a persistent radar-change candidate within historical 2021 tree cover, not a confirmed forest-loss claim." }]} />
      {loading && <p role="status">Loading published evidence…</p>}{error && <p className="forest-message" role="status">{error}</p>}
      {study && frame && <>
        <div className="forest-status"><strong>Processing: {study.processing_status}</strong><span>Interpretation: unverified radar-change candidates</span><span>Reference: {ref?.status.replaceAll("_", " ")}</span></div>
        <div className="forest-stats"><div><span>Candidate area</span><strong>{number(frame.stats.candidate_area_km2)} km²</strong><small>{frame.stats.patch_count} patches · not a forest-loss estimate</small></div><div><span>Assessed radar area</span><strong>{number(frame.stats.assessed_area_km2)} km²</strong><small>Historical tree cover with valid persistence pair</small></div><div><span>Common clear optical coverage</span><strong>{ref?.common_clear_fraction === undefined ? "Not available" : `${(ref.common_clear_fraction * 100).toFixed(1)}%`}</strong><small>20% minimum makes a comparison assessable</small></div></div>
      </>}
    </>} map={study && frame ? <>
      <div className="forest-map-title"><strong>Radar and optical evidence</strong><span>Choose layers or click either map to inspect a location</span></div>
      <section id="forest-comparison" className="forest-comparison" aria-label="Radar and optical evidence comparison">{[[left, setLeft, layerLeft, "Left map layer"], [right, setRight, layerRight, "Right map layer"]].map(([value, setter, layer, label]) => { const active = layer as typeof layerLeft; return <article key={label as string}><label>{label as string}<select aria-label={label as string} value={value as string} onChange={e => (setter as (v: string) => void)(e.target.value)}>{Object.keys(layers).map(key => <option key={key} value={key}>{LABELS[key] ?? key}</option>)}</select></label><div className="forest-comparison-map"><ForestMap focus={mapFocus} bbox={study.bbox} imageUrl={active ? `${base}${active.image}` : undefined} studyPublished gladS2Alerts={showGladS2} gladConfirmedOnly={gladConfirmedOnly} gladDateRange={gladDateRange} gladImageUrl={showImportedGlad && study.glad ? `${base}${study.glad.image}` : undefined} probePoint={probePoint} onPickPoint={setProbePoint}/></div><p className="forest-layer-caption">{active?.unit === "class" ? (value === "candidates" ? "Amber: persistent candidate. Transparent: no displayed candidate; consult assessed coverage and validity layers." : value === "optical_support" ? "Green: index-decrease support · orange: no index-decrease support · gray: unassessed. Support is exploratory." : value === "tree_cover" ? "Green: historical 2021 tree cover only." : value === "assessed" ? "Visible: eligible pixels assessed using two valid later observations. Transparent: unassessed." : "Product quality: valid observations only.") : `${active?.minimum} to ${active?.maximum} ${active?.unit ?? ""} · ${value === "optical_before" ? ref?.before_date : value === "optical_after" ? ref?.after_date : String(value).startsWith("baseline") ? study.baseline_dates.join(" · ") : day}`}</p></article>; })}</section>
    </> : <div className="forest-case-empty" role="status">{loading ? "Loading the published case…" : error || "No published result is available for this case."}</div>} drawerTabs={forestCaseTabs} drawerTabsPlacement="drawer" drawerPersistent={study ? <div className="forest-date-ribbon" aria-label="Select a forest observation date"><span>Observation date</span>{study.frames.map(item => <button key={item.date} type="button" aria-pressed={day === item.date} onClick={() => { setDay(item.date); setCandidateFocus(null); setMapFocus(null); setLeft("baseline_hv"); setRight("candidates"); }}>{item.date}</button>)}</div> : <p role="status">{loading ? "Loading observation dates…" : "No published dates available"}</p>} footer={<><span>Persistent radar-change candidates · optical coverage and uncertainty shown in Check it</span><span className="iw-footer-note">Candidate status · no confirmed forest-loss claim</span></>} />;
}

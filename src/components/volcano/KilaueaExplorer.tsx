"use client";

import { useEffect, useMemo, useState } from "react";import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import InvestigationWorkspace from "@/components/layout/InvestigationWorkspace";
import FieldVolumeDisclosure from "@/components/shared/FieldVolumeDisclosure";
import HazardWalkthrough from "@/components/shared/HazardWalkthrough";
import { probeVolcano, validVolcanoGrid, type VolcanoGrid, type VolcanoStudy } from "@/lib/volcano-study";
import type { VolcanoFocus } from "./DeformationMap";

const Map = dynamic(() => import("./DeformationMap"), { ssr: false, loading: () => <div className="deformation-loading">Loading Kīlauea map…</div> });
type Layer = "los_image" | "phase_cycles" | "coherence_image" | "assessed_image";
type Loaded = { study: VolcanoStudy; base: string; evidenceUrl: string };
const date = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function phaseColor(value: number) {
  const sector = ((((value + Math.PI) / (2 * Math.PI)) % 1) + 1) % 1 * 6;
  const x = 1 - Math.abs(sector % 2 - 1);
  return [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(sector) % 6].map(channel => Math.round(channel * 255));
}

export default function KilaueaExplorer() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [grid, setGrid] = useState<VolcanoGrid | null>(null);
  const [error, setError] = useState("");
  const [layer, setLayer] = useState<Layer>("los_image");
  const [phaseUrl, setPhaseUrl] = useState<string | null>(null);
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [focus, setFocus] = useState<VolcanoFocus | null>(null);
  const [latInput, setLatInput] = useState("19.421");
  const [lonInput, setLonInput] = useState("-155.287");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/volcanoes/kilauea-episode-36-2025/index.json", { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("No Kīlauea publication is available yet."); return response.json(); })
      .then(async index => {
        const response = await fetch(index.study_url, { signal: controller.signal });
        if (!response.ok) throw new Error("The published Kīlauea study could not be loaded.");
        const study: VolcanoStudy = await response.json();
        if (study.run_completion !== "COMPLETE" || study.scientific_interpretation !== "PHASE_DERIVED_LOS_CANDIDATES" || !study.pairs?.length) throw new Error("The Kīlauea publication is incomplete or unsupported.");
        const base = index.study_url.slice(0, index.study_url.lastIndexOf("/") + 1);
        setLoaded({ study, base, evidenceUrl: index.evidence_url });
        const pair = study.pairs.find(item => item.id === study.default_pair_id) ?? study.pairs[0];
        const gridResponse = await fetch(base + pair.grid, { signal: controller.signal });
        if (!gridResponse.ok) throw new Error("The published NISAR pixel grid could not be loaded.");
        const publishedGrid = await gridResponse.json() as VolcanoGrid;
        if (!validVolcanoGrid(publishedGrid)) throw new Error("The published NISAR grid failed its consistency check.");
        setGrid(publishedGrid);
      })
      .catch(reason => { if (reason.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Could not load Kīlauea data."); });
    return () => controller.abort();
  }, []);

  const study = loaded?.study;
  const pair = study?.pairs.find(item => item.id === study.default_pair_id) ?? study?.pairs[0];

  useEffect(() => {
    if (!grid || layer !== "phase_cycles") return;
    const canvas = document.createElement("canvas");
    canvas.width = grid.width;
    canvas.height = grid.height;
    const context = canvas.getContext("2d");
    if (!context) {
      const frame = requestAnimationFrame(() => setError("This browser could not render the phase-cycle preview."));
      return () => cancelAnimationFrame(frame);
    }
    const pixels = context.createImageData(grid.width, grid.height);
    for (let index = 0; index < grid.phase_radians.length; index++) {
      const phase = grid.phase_radians[index];
      const coherence = grid.coherence[index];
      const component = grid.component[index];
      if (phase === null || coherence === null || component === null || component <= 0 || coherence < (study?.coherence_floor ?? 0.3)) continue;
      const [red, green, blue] = phaseColor(phase);
      pixels.data.set([red, green, blue, 224], index * 4);
    }
    context.putImageData(pixels, 0, 0);
    let preview: string;
    try { preview = canvas.toDataURL("image/png"); }
    catch {
      const frame = requestAnimationFrame(() => setError("The phase-cycle preview could not be encoded by this browser."));
      return () => cancelAnimationFrame(frame);
    }
    const frame = requestAnimationFrame(() => setPhaseUrl(preview));
    return () => cancelAnimationFrame(frame);
  }, [grid, layer, study?.coherence_floor]);

  function choosePoint(lat: number, lon: number) {
    setPoint({ lat, lon });
    setLatInput(lat.toFixed(5));
    setLonInput(lon.toFixed(5));
  }

  const pixel = point ? probeVolcano(grid, point.lat, point.lon) : null;
  const image = pair && loaded ? layer === "phase_cycles" ? phaseUrl : loaded.base + pair[layer] : null;
  const commonRail = <>
    <p className="volcano-kicker">KĪLAUEA · HAWAIʻI · NISAR L-BAND</p>
    <HazardWalkthrough guideTitle="KĪLAUEA CASE GUIDE" steps={[{ title: "Explore the NISAR observation", target: "kilauea-guide-explore", explanation: "Inspect the published interval, product maturity, screened coverage, coherence, and line-of-sight range." }, { title: "Check a selected sample", target: "kilauea-guide-check", explanation: "Use the map or coordinate inputs to inspect a nearest grid value. Event reports provide context, not a displacement reference." }, { title: "Learn the interpretation limits", target: "kilauea-guide-learn", explanation: "The phase result is exploratory and unverified. It is not vertical uplift, a magma model, or an eruption forecast." }]} />
    <Link className="volcano-case-link" href="/volcano/global">← Back to volcano map</Link>
    <Link className="volcano-case-link" href="/volcano/hayli-gubbi">Explore the Hayli Gubbi case ↗</Link>
    <div className="volcano-context-note"><strong>Event context</strong><p>USGS reported Kīlauea episode 36 on 9 Nov 2025. The NISAR interval spans 3–15 Nov.</p><a href="https://volcanoes.usgs.gov/hans-public/vona/DOI-USGS-HVO-2025-11-10T01:52:38+00:00" target="_blank" rel="noreferrer">Open USGS event notice ↗</a></div>
    <div className="volcano-context-note"><strong>What this result means</strong><p>Phase-derived line-of-sight candidates from one interferogram. Event timing does not prove the eruption caused the measured signal.</p></div>
    {pair && <div className="volcano-context-note"><strong>Screened coverage</strong><p>{percent(pair.statistics.valid_fraction)} · {pair.statistics.assessed_area_km2.toFixed(1)} km² assessed within the analyst-defined box.</p></div>}
  </>;

  const fieldVolumeData = useMemo(() => pair ? [{
    id: pair.id,
    label: date(pair.start) + " – " + date(pair.end),
    value: Math.max(0, pair.statistics.p95_cm - pair.statistics.p05_cm),
    valueLabel: (pair.statistics.p95_cm - pair.statistics.p05_cm).toFixed(1) + " cm spread",
    context: pair.statistics.valid_fraction,
  }] : [], [pair]);

  if (error && !study) return <InvestigationWorkspace hazard="volcano" className="volcano-page volcano-case-workspace" caseName="KĪLAUEA · PUBLISHED STUDY" title="Kīlauea phase evidence" subtitle="The published evidence is currently unavailable." rail={commonRail} map={<p className="deformation-case-state" role="status">{error}</p>} drawer={<Link href="/volcano/global">Return to volcano observations</Link>} footer={<span className="iw-footer-note">No result available is not evidence of no deformation</span>} />;
  if (!study || !pair || !loaded) return <InvestigationWorkspace hazard="volcano" className="volcano-page volcano-case-workspace" caseName="KĪLAUEA · PUBLISHED STUDY" title="Loading Kīlauea phase evidence" subtitle="Loading the published NISAR phase, coherence, and quality-screened layers." rail={commonRail} map={<p className="deformation-case-state" role="status">Loading published NISAR data…</p>} drawer={<p>Loading dates, provenance, and pixel inspection…</p>} footer={<span className="iw-footer-note">NISAR L2 GUNW BETA · local credentials are not required to view published data</span>} />;

  const sampleDescription = !point ? "Choose a point on the map or enter coordinates." : !pixel ? "This point is outside the processed box." : pixel.los === null ? "This sample is unassessed: it failed a phase, coherence, component, mask, or coverage screen." : "This nearest published grid sample passed the published quality screens.";
  const kilaueaTabs = [
    { id: "explore", number: "01", label: "Explore", hint: "Review the observation and map layers", anchorIds: ["kilauea-guide-explore"], content: <div id="kilauea-guide-explore" className="volcano-tab-panel deformation-explorer kilauea-evidence">
      <p className="hazard-tab-intro">One real repeat-pass NISAR interferogram is published for this case. Use the map toolbar to switch phase, coherence, relative motion, and screened coverage.</p>
      <header className="deformation-heading"><div><h2>Real observation · measured evidence</h2><p>{pair.collection} · {pair.granule_id}</p></div><a className="volcano-download-link" href={loaded.evidenceUrl} download>Download evidence package</a></header>
      <dl className="kilauea-stats"><div><dt>Dates</dt><dd>{date(pair.start)} — {date(pair.end)}</dd></div><div><dt>Screened coverage</dt><dd>{percent(pair.statistics.valid_fraction)}</dd></div><div><dt>Assessed area</dt><dd>{pair.statistics.assessed_area_km2.toFixed(1)} km²</dd></div><div><dt>Median coherence</dt><dd>{pair.statistics.median_coherence.toFixed(3)}</dd></div><div><dt>LOS 5th–95th percentile</dt><dd>{pair.statistics.p05_cm.toFixed(1)} to {pair.statistics.p95_cm.toFixed(1)} cm</dd></div><div><dt>Reference patch MAD</dt><dd>{pair.statistics.reference_mad_cm.toFixed(2)} cm</dd></div><div><dt>Product maturity</dt><dd>{pair.maturity} · NISAR L2 GUNW</dd></div></dl>
      <p className="kilauea-uncertainty">Reference-patch MAD describes spatial spread in the selected patch; it is not measurement accuracy or a per-pixel uncertainty estimate. The 40 cm map stretch is fixed and documented.</p>
      <div className="deformation-toolbar"><span><strong>Viewing:</strong> {layer === "los_image" ? "relative LOS motion" : layer === "phase_cycles" ? "phase modulo 2π" : layer === "coherence_image" ? "coherence quality" : "screened coverage"}</span><a href={loaded.base + pair.los_download} download>Download relative LOS GeoTIFF</a></div>
      <FieldVolumeDisclosure
        kind="volcano"
        title="Kīlauea phase measurement in 3D"
        metricLabel="Apparent LOS 5th–95th percentile spread"
        contextLabel="Screened coverage"
        observations={fieldVolumeData}
        selectedId={pair.id}
        note="This is one published repeat-pass interval, not a time series. The column shows its apparent LOS distribution spread and screened coverage. The volcano shape is conceptual and does not represent surveyed topography."
      />
    </div> },
    { id: "check", number: "02", label: "Check it", hint: "Inspect a map sample and review evidence limits", anchorIds: ["kilauea-guide-check"], content: <div id="kilauea-guide-check" className="volcano-tab-panel deformation-explorer kilauea-evidence">
      <p className="hazard-tab-intro">The selected sample reports the nearest published raster value. Event context is independent of the measured radar signal.</p>
      <div className="kilauea-pixel-inspector"><form onSubmit={event => { event.preventDefault(); const lat = Number(latInput); const lon = Number(lonInput); if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) { choosePoint(lat, lon); setFocus({ lat, lon, zoom: 12 }); } }}><h3>Inspect a pixel</h3><label>Latitude<input type="number" min="-90" max="90" step="any" value={latInput} onChange={event => setLatInput(event.target.value)} /></label><label>Longitude<input type="number" min="-180" max="180" step="any" value={lonInput} onChange={event => setLonInput(event.target.value)} /></label><button type="submit">Inspect coordinates</button></form><div><h3>Selected sample</h3><p>{sampleDescription}</p>{pixel && <dl><div><dt>Grid sample</dt><dd>{pixel.centerLat.toFixed(5)}°, {pixel.centerLon.toFixed(5)}°</dd></div><div><dt>Relative LOS</dt><dd>{pixel.los === null ? "Unassessed" : `${pixel.los.toFixed(2)} cm`}</dd></div><div><dt>Coherence</dt><dd>{pixel.coherence === null ? "No data" : pixel.coherence.toFixed(3)}</dd></div><div><dt>Unwrapped phase</dt><dd>{pixel.phase === null ? "Unassessed" : `${pixel.phase.toFixed(3)} rad`}</dd></div><div><dt>Connected component</dt><dd>{pixel.component ?? "Unassessed"}</dd></div></dl>}</div></div>
      <section className="deformation-comparison"><h3>Independent evidence and limits</h3><p>USGS documents an eruption episode during this NISAR interval, but that notice does not measure ground displacement. This publication has no independent deformation reference or Sentinel-1 pair, so the radar result remains unverified. The rectangle is an analyst-defined study box, not the volcano boundary.</p><p>Positive LOS values point toward the satellite. One full NISAR L-band phase cycle is about {(pair.wavelength_m * 50).toFixed(1)} cm of line-of-sight displacement if phase change is caused by ground motion. This is not vertical uplift, a magma model, or an eruption forecast.</p></section>
    </div> },
    { id: "learn", number: "03", label: "Learn", hint: "Learn how phase and coherence are interpreted", anchorIds: ["kilauea-guide-learn"], content: <div id="kilauea-guide-learn" className="volcano-tab-panel deformation-explorer kilauea-evidence">
      <p className="hazard-tab-intro">InSAR phase measures a change between radar passes. Quality screens and the chosen reference area shape what can be interpreted.</p>
      <div className="deformation-method-note"><strong>Exploratory phase-derived LOS, not a confirmed eruption deformation.</strong> One repeat-pass interferogram spans the reported event. Atmospheric, ionospheric, orbit, terrain, unwrapping errors, and reference motion have not been removed or quantified.</div>
      <div className="deformation-legend">{layer === "los_image" ? <><span>Away · −{study.display_limit_cm} cm</span><i className="deformation-scale"/><span>+{study.display_limit_cm} cm · toward</span></> : layer === "phase_cycles" ? <><span>−π</span><i className="deformation-scale deformation-scale--phase"/><span>+π · repeats each cycle</span></> : layer === "coherence_image" ? <><span>Low · 0</span><i className="deformation-scale deformation-scale--gray"/><span>1 · high</span></> : <span>White: passed the quality screens</span>}<b>Transparent pixels are unassessed · teal outline is the assumed reference patch</b></div>
      <details className="deformation-provenance" open><summary>Source, provenance, and limitations</summary><p>{study.boundary_source}. {study.reference_note}. Coherence threshold: {study.coherence_floor.toFixed(2)}. Input dates were checked against original HDF5 metadata.</p><p>Original product: <code>{pair.granule_id}</code></p><a href={pair.data_url ?? "#"} target="_blank" rel="noreferrer">Original NASA product (Earthdata login required) ↗</a><p><a href="https://volcanoes.usgs.gov/hans-public/vona/DOI-USGS-HVO-2025-11-10T01:52:38+00:00" target="_blank" rel="noreferrer">USGS eruption notice · event context only ↗</a></p><ul>{study.limitations.map(item => <li key={item}>{item}</li>)}</ul><a href={loaded.base + "study.json"} download>Study manifest</a> · <a href={loaded.base + "checksums.json"} download>Artifact checksums</a></details>
    </div> },
  ];

  return <InvestigationWorkspace hazard="volcano" className="volcano-page volcano-case-workspace" caseName="KĪLAUEA · EPISODE 36" title="What did NISAR measure at Kīlauea?" subtitle={`One real NISAR L2 GUNW ${pair.maturity} interferogram · ${date(pair.start)} to ${date(pair.end)} · event reported ${date(study.event_date)}.`} rail={commonRail} map={<>
    <div className="deformation-map-hint kilauea-map-toolbar"><button type="button" onClick={() => setFocus({ lat: (study.bbox[1] + study.bbox[3]) / 2, lon: (study.bbox[0] + study.bbox[2]) / 2, zoom: 10, fullStudy: true })}>Show full study</button><label>Map layer<select value={layer} onChange={event => setLayer(event.target.value as Layer)}><option value="los_image">Relative LOS change</option><option value="phase_cycles">Unwrapped phase · modulo 2π</option><option value="coherence_image">Interferometric coherence</option><option value="assessed_image">Quality-screened coverage</option></select></label></div>
    <div className="kilauea-map-surface"><Map bbox={study.bbox} referenceBbox={study.reference_bbox} imageUrl={image} emptyMessage={layer === "phase_cycles" ? "Preparing phase-cycle overlay…" : "This published layer is not available."} point={point} focus={focus} onProbe={choosePoint} regions={study.regions} /></div>
  </>} drawer={<section className="deformation-explorer kilauea-evidence">
    <header className="deformation-heading"><div><h2>Real observation · measured evidence</h2><p>{pair.collection} · {pair.granule_id}</p></div><a className="volcano-download-link" href={loaded.evidenceUrl} download>Download evidence package</a></header>
    <div className="deformation-method-note"><strong>Exploratory phase-derived LOS, not a confirmed eruption deformation.</strong> One repeat-pass interferogram spans the reported event. Atmospheric, ionospheric, orbit, terrain, unwrapping errors, and reference motion have not been removed or quantified.</div>
    <dl className="kilauea-stats"><div><dt>Screened coverage</dt><dd>{percent(pair.statistics.valid_fraction)}</dd></div><div><dt>Assessed area</dt><dd>{pair.statistics.assessed_area_km2.toFixed(1)} km²</dd></div><div><dt>Median coherence</dt><dd>{pair.statistics.median_coherence.toFixed(3)}</dd></div><div><dt>LOS 5th–95th percentile</dt><dd>{pair.statistics.p05_cm.toFixed(1)} to {pair.statistics.p95_cm.toFixed(1)} cm</dd></div><div><dt>Reference patch MAD</dt><dd>{pair.statistics.reference_mad_cm.toFixed(2)} cm</dd></div><div><dt>Product maturity</dt><dd>{pair.maturity} · NISAR L2 GUNW</dd></div></dl>
    <p className="kilauea-uncertainty">Reference-patch MAD describes spatial spread in the selected patch; it is not measurement accuracy or a per-pixel uncertainty estimate. The 40 cm map stretch is fixed and is documented in the study manifest.</p>
    <div className="deformation-toolbar"><span><strong>Viewing:</strong> {layer === "los_image" ? "relative LOS motion" : layer === "phase_cycles" ? "phase modulo 2π" : layer === "coherence_image" ? "coherence quality" : "screened coverage"}</span><a href={loaded.base + pair.los_download} download>Download relative LOS GeoTIFF</a></div>
    <div className="deformation-legend">{layer === "los_image" ? <><span>Away · −{study.display_limit_cm} cm</span><i className="deformation-scale"/><span>+{study.display_limit_cm} cm · toward</span></> : layer === "phase_cycles" ? <><span>−π</span><i className="deformation-scale deformation-scale--phase"/><span>+π · repeats each cycle</span></> : layer === "coherence_image" ? <><span>Low · 0</span><i className="deformation-scale deformation-scale--gray"/><span>1 · high</span></> : <span>White: passed the quality screens</span>}<b>Transparent pixels are unassessed · teal outline is the assumed reference patch</b></div>
    <div className="kilauea-pixel-inspector"><form onSubmit={event => { event.preventDefault(); const lat = Number(latInput); const lon = Number(lonInput); if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) { choosePoint(lat, lon); setFocus({ lat, lon, zoom: 12 }); } }}><h3>Inspect a pixel</h3><label>Latitude<input type="number" min="-90" max="90" step="any" value={latInput} onChange={event => setLatInput(event.target.value)} /></label><label>Longitude<input type="number" min="-180" max="180" step="any" value={lonInput} onChange={event => setLonInput(event.target.value)} /></label><button type="submit">Inspect coordinates</button></form><div><h3>Selected sample</h3><p>{sampleDescription}</p>{pixel && <dl><div><dt>Grid sample</dt><dd>{pixel.centerLat.toFixed(5)}°, {pixel.centerLon.toFixed(5)}°</dd></div><div><dt>Relative LOS</dt><dd>{pixel.los === null ? "Unassessed" : `${pixel.los.toFixed(2)} cm`}</dd></div><div><dt>Coherence</dt><dd>{pixel.coherence === null ? "No data" : pixel.coherence.toFixed(3)}</dd></div><div><dt>Unwrapped phase</dt><dd>{pixel.phase === null ? "Unassessed" : `${pixel.phase.toFixed(3)} rad`}</dd></div><div><dt>Connected component</dt><dd>{pixel.component ?? "Unassessed"}</dd></div></dl>}</div></div>
    <section className="deformation-comparison"><h3>Independent evidence and limits</h3><p>USGS documents an eruption episode during this NISAR interval, but that notice does not measure ground displacement. This publication has no independent deformation reference or Sentinel-1 pair, so the radar result remains unverified. The rectangle is an analyst-defined study box, not the volcano boundary.</p><p>Positive LOS values point toward the satellite. One full NISAR L-band phase cycle is about {(pair.wavelength_m * 50).toFixed(1)} cm of line-of-sight displacement if phase change is caused by ground motion. This is not vertical uplift, a magma model, or an eruption forecast.</p><details className="deformation-provenance"><summary>Open source, provenance, and limitations</summary><p>{study.boundary_source}. {study.reference_note}. Coherence threshold: {study.coherence_floor.toFixed(2)}. Input dates were checked against the original HDF5 metadata.</p><p>Original product: <code>{pair.granule_id}</code></p><a href={pair.data_url ?? "#"} target="_blank" rel="noreferrer">Original NASA product (Earthdata login required) ↗</a><p><a href="https://volcanoes.usgs.gov/hans-public/vona/DOI-USGS-HVO-2025-11-10T01:52:38+00:00" target="_blank" rel="noreferrer">USGS eruption notice · event context only ↗</a></p><ul>{study.limitations.map(item => <li key={item}>{item}</li>)}</ul><a href={loaded.base + "study.json"} download>Study manifest</a> · <a href={loaded.base + "checksums.json"} download>Artifact checksums</a></details></section>
  </section>} drawerTabs={kilaueaTabs} drawerTabsPlacement="drawer" footer={<div className="deformation-legend"><span>Processed study box only</span><b>No global volcanic deformation detections are implied</b></div>} />;
}

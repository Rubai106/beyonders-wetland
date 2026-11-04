"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { probeVolcano, validVolcanoGrid, type VolcanoGrid, type VolcanoPair, type VolcanoStudy } from "@/lib/volcano-study";
import type { VolcanoFocus } from "./DeformationMap";
import SensorCurtain from "../shared/SensorCurtain";
import InvestigationWorkspace from "@/components/layout/InvestigationWorkspace";
import RadarSonifier from "@/components/shared/RadarSonifier";
import TriageBriefButton from "@/components/shared/TriageBriefButton";
import FieldVolumeDisclosure from "@/components/shared/FieldVolumeDisclosure";
import HazardWalkthrough from "@/components/shared/HazardWalkthrough";

const Map = dynamic(() => import("./DeformationMap"), {ssr:false,loading:() => <div className="deformation-loading">Loading radar map…</div>});
type Layer = "los_image" | "phase_cycles" | "coherence_image" | "coherence_change" | "assessed_image";
type Loaded = {study: VolcanoStudy; base: string; evidenceUrl: string};
const date = (value: string) => new Date(value+"T00:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
const percent = (value: number) => `${(value*100).toFixed(1)}%`;
const cm = (value: number | null | undefined) => value == null ? "Unassessed" : `${value>0?"+":""}${value.toFixed(2)} cm`;
const opticalViews = [
  { id:"before", file:"hayli-gubbi-modis-before-2025-11-15.jpg", date:"2025-11-15", sensor:"Aqua MODIS", label:"Before eruption", alt:"NASA Aqua MODIS regional view of the Afar area before the Hayli Gubbi eruption." },
  { id:"eruption", file:"hayli-gubbi-modis-eruption-2025-11-23.jpg", date:"2025-11-23", sensor:"Aqua MODIS", label:"Eruption plume", alt:"NASA Aqua MODIS regional view of the Hayli Gubbi ash plume on the eruption date." },
  { id:"after", file:"hayli-gubbi-landsat-2025-11-24.jpg", date:"2025-11-24", sensor:"Landsat 9 OLI-2", label:"After eruption", alt:"NASA Landsat 9 OLI-2 close view of Hayli Gubbi and Erta Ale after the eruption." },
];

function useGrid(url: string | null) {
  const [state,setState] = useState<{url:string;grid:VolcanoGrid|null;error:string|null}>({url:"",grid:null,error:null});
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url,{signal:controller.signal}).then(r => {if(!r.ok) throw new Error("Published pixel data could not be loaded.");return r.json();})
      .then((grid:VolcanoGrid) => {
        if(!validVolcanoGrid(grid)) throw new Error("Published grid is inconsistent.");
        setState({url,grid,error:null});
      }).catch(error => {if(error.name!=="AbortError") setState({url,grid:null,error:error.message});});
    return () => controller.abort();
  },[url]);
  return {grid:state.url===url?state.grid:null,error:state.url===url?state.error:null};
}

function gridsAlign(a: VolcanoGrid | null, b: VolcanoGrid | null) {
  return !!a && !!b && a.width===b.width && a.height===b.height &&
    a.bbox.every((value,index)=>Math.abs(value-b.bbox[index])<1e-9);
}

function phaseColor(value: number) {
  const sector=(((value+Math.PI)/(2*Math.PI))%1+1)%1*6;
  const x=1-Math.abs(sector%2-1);
  const colors=[[1,x,0],[x,1,0],[0,1,x],[0,x,1],[x,0,1],[1,0,x]][Math.floor(sector)%6];
  return colors.map(channel=>Math.round(channel*255));
}

function useDerivedOverlay(grid: VolcanoGrid | null, comparison: VolcanoGrid | null, mode: "phase_cycles" | "coherence_change", key: string, coherenceFloor: number, enabled: boolean) {
  const [state,setState]=useState<{key:string;url:string|null;error:string|null}>({key:"",url:null,error:null});
  useEffect(()=>{
    if(!enabled||!grid) return;
    if(mode==="coherence_change"&&!gridsAlign(grid,comparison)) return;
    const canvas=document.createElement("canvas");
    canvas.width=grid.width;
    canvas.height=grid.height;
    const context=canvas.getContext("2d");
    if(!context) {
      const frame=requestAnimationFrame(()=>setState({key,url:null,error:"This browser could not create the phase preview."}));
      return ()=>cancelAnimationFrame(frame);
    }
    const pixels=context.createImageData(grid.width,grid.height);
    const values=mode==="phase_cycles"?grid.phase_radians:grid.coherence;
    for(let index=0;index<values.length;index++) {
      const value=values[index];
      if(value===null||!Number.isFinite(value)) continue;
      if(mode==="phase_cycles") {
        const coherence=grid.coherence[index];
        const component=grid.component[index];
        if(coherence===null||coherence<coherenceFloor||component===null) continue;
        const [red,green,blue]=phaseColor(value);
        pixels.data.set([red,green,blue,224],index*4);
      } else {
        const baseline=comparison!.coherence[index];
        if(baseline===null||!Number.isFinite(baseline)) continue;
        const delta=value-baseline;
        const intensity=Math.min(1,Math.abs(delta)/0.4);
        const neutral=[244,239,224];
        const target=delta<0?[190,65,37]:[20,132,139];
        const alpha=Math.round(100+150*intensity);
        pixels.data.set(neutral.map((channel,i)=>Math.round(channel+(target[i]-channel)*intensity)).concat(alpha),index*4);
      }
    }
    context.putImageData(pixels,0,0);
    let nextState:{key:string;url:string|null;error:string|null};
    try {nextState={key,url:canvas.toDataURL("image/png"),error:null};}
    catch {nextState={key,url:null,error:"The derived raster preview could not be encoded."};}
    const frame=requestAnimationFrame(()=>setState(nextState));
    return ()=>cancelAnimationFrame(frame);
  },[grid,comparison,mode,key,coherenceFloor,enabled]);
  return state.key===key?state:{key,url:null,error:null};
}

function coherenceChangeSummary(current: VolcanoGrid | null, baseline: VolcanoGrid | null) {
  if(!current||!baseline||!gridsAlign(current,baseline)) return null;
  let count=0,lower=0,sum=0;
  for(let index=0;index<current.coherence.length;index++) {
    const after=current.coherence[index],before=baseline.coherence[index];
    if(after===null||before===null||!Number.isFinite(after)||!Number.isFinite(before)) continue;
    const delta=after-before;
    count++;
    sum+=delta;
    if(delta<0) lower++;
  }
  return count?{count,lowerFraction:lower/count,meanDelta:sum/count}:null;
}

function Pixel({ pair, grid, point }: {pair:VolcanoPair;grid:VolcanoGrid|null;point:{lat:number;lon:number}|null}) {
  const pixel = point ? probeVolcano(grid,point.lat,point.lon) : null;
  const phaseSign = pair.phase_sign.includes("LOS = -phase") ? -1 : pair.phase_sign.includes("LOS = phase") ? 1 : null;
  const phaseLosMm = pixel?.phase == null || phaseSign == null ? null : pixel.phase * pair.wavelength_m * phaseSign / (4 * Math.PI) * 1000;
  return <div className="deformation-pixel"><strong>{pair.sensor} · {pair.label}</strong>
    {!point ? <p>Select a point on either map or use the coordinate inputs to inspect both views.</p> : !grid ? <p>Loading published pixels…</p> : !pixel ? <p>This point is outside the processed rectangle.</p> : <>
      <dl><div><dt>Apparent LOS change</dt><dd>{cm(pixel.los)}</dd></div><div><dt>Phase-derived LOS</dt><dd>{phaseLosMm==null?"Sign unavailable":`${phaseLosMm>0?"+":""}${phaseLosMm.toFixed(1)} mm`}</dd></div><div><dt>Coherence</dt><dd>{pixel.coherence==null?"No observation":pixel.coherence.toFixed(3)}</dd></div><div><dt>Unwrapped phase</dt><dd>{pixel.phase==null?"Unassessed":`${pixel.phase.toFixed(3)} rad`}</dd></div><div><dt>Connected component</dt><dd>{pixel.component??"Unassessed"}</dd></div></dl>
      <p>{pixel.los==null?"Screened out: low coherence, missing data, invalid sample, water flag (NISAR), or a disconnected phase component.":"Passed the published coherence and component screens. Accuracy is not quantified."}</p>
      <small>Published geographic sample at {pixel.centerLat.toFixed(5)}, {pixel.centerLon.toFixed(5)} · nearest native raster value.</small>
    </>}
  </div>;
}

function CoherenceChangePixel({ pair, grid, baseline, point }: {pair:VolcanoPair;grid:VolcanoGrid|null;baseline:VolcanoGrid|null;point:{lat:number;lon:number}|null}) {
  const currentPixel=point?probeVolcano(grid,point.lat,point.lon):null;
  const baselinePixel=point?probeVolcano(baseline,point.lat,point.lon):null;
  const delta=currentPixel?.coherence!=null&&baselinePixel?.coherence!=null?currentPixel.coherence-baselinePixel.coherence:null;
  return <div className="deformation-pixel"><strong>{pair.sensor} · coherence change at selected point</strong>
    {!point?<p>Select a point on the map to compare the pair values.</p>:!grid||!baseline?<p>Loading both matched coherence grids…</p>:!currentPixel||!baselinePixel?<p>This point is outside the published comparison grid.</p>:<>
      <dl><div><dt>Earlier pair</dt><dd>{baselinePixel.coherence==null?"Unassessed":baselinePixel.coherence.toFixed(3)}</dd></div><div><dt>Selected pair</dt><dd>{currentPixel.coherence==null?"Unassessed":currentPixel.coherence.toFixed(3)}</dd></div><div><dt>Change</dt><dd>{delta==null?"Unassessed":`${delta>0?"+":""}${delta.toFixed(3)}`}</dd></div></dl>
      <small>{delta==null?"At least one pair has no valid coherence sample.":delta<0?"Coherence is lower in the selected interval at this sample.":delta>0?"Coherence is higher in the selected interval at this sample.":"No coherence difference at this sample."} This does not identify the cause.</small>
    </>}
  </div>;
}

export default function DeformationExplorer() {
  const [loaded,setLoaded] = useState<Loaded|null>(null);
  const [error,setError] = useState<string|null>(null);
  const [selected,setSelected] = useState<string>("");
  const [sentinel,setSentinel] = useState<string>("");
  const [layer,setLayer] = useState<Layer>("los_image");
  const [opticalViewId,setOpticalViewId] = useState("eruption");
  const [point,setPoint] = useState<{lat:number;lon:number}|null>(null);
  const [focus,setFocus] = useState<VolcanoFocus|null>(null);
  const [latInput,setLatInput] = useState("13.606");
  const [lonInput,setLonInput] = useState("40.665");
  const [coordinateError,setCoordinateError] = useState<string|null>(null);
  useEffect(() => {
    const controller=new AbortController();
    fetch("/volcanoes/hayli-gubbi/index.json",{signal:controller.signal,cache:"no-store"})
      .then(r => {if(!r.ok) throw new Error("No processed NISAR package is published yet. Source observations remain available below.");return r.json();})
      .then(async index => {
        const response=await fetch(index.study_url,{signal:controller.signal});
        if(!response.ok) throw new Error("The published deformation package is unavailable.");
        const study:VolcanoStudy=await response.json();
        if(study.schema_version!==1 || study.run_completion!=="COMPLETE" || !Array.isArray(study.pairs) || !study.pairs.some(pair=>pair.id===study.default_pair_id) || !Array.isArray(study.bbox) || study.bbox.length!==4) throw new Error("This publication is incomplete or unsupported.");
        setLoaded({study,base:index.study_url.substring(0,index.study_url.lastIndexOf("/")+1),evidenceUrl:index.evidence_url});
        setSelected(study.default_pair_id);
        setSentinel(study.pairs.find(pair=>pair.sensor==="Sentinel-1")?.id??"");
      }).catch(error=>{if(error.name!=="AbortError")setError(error.message);});
    return ()=>controller.abort();
  },[]);
  const study=loaded?.study;
  const pair=study?.pairs.find(pair=>pair.id===selected);
  const reference=study?.pairs.find(pair=>pair.id===sentinel);
  const primaryGrid=useGrid(loaded&&pair?loaded.base+pair.grid:null);
  const referenceGrid=useGrid(loaded&&reference?loaded.base+reference.grid:null);
  const previousPair=useMemo(()=>{
    if(!pair||pair.sensor!=="NISAR") return null;
    const duration=(value:VolcanoPair)=>Date.parse(`${value.end}T00:00:00Z`)-Date.parse(`${value.start}T00:00:00Z`);
    return study?.pairs.find(candidate=>candidate.sensor===pair.sensor&&candidate.collection===pair.collection&&
      candidate.track===pair.track&&candidate.polarization===pair.polarization&&candidate.direction===pair.direction&&
      candidate.look_direction===pair.look_direction&&Math.abs(candidate.wavelength_m-pair.wavelength_m)<1e-6&&
      candidate.end===pair.start&&duration(candidate)===duration(pair))??null;
  },[study,pair]);
  const previousGrid=useGrid(loaded&&previousPair&&layer==="coherence_change"?loaded.base+previousPair.grid:null);
  const phasePrimary=useDerivedOverlay(primaryGrid.grid,null,"phase_cycles",`phase:${pair?.id??"none"}`,study?.coherence_floor??0.3,layer==="phase_cycles");
  const phaseReference=useDerivedOverlay(referenceGrid.grid,null,"phase_cycles",`phase:${reference?.id??"none"}`,study?.coherence_floor??0.3,layer==="phase_cycles");
  const coherenceDelta=useDerivedOverlay(primaryGrid.grid,previousGrid.grid,"coherence_change",`delta:${pair?.id??"none"}:${previousPair?.id??"none"}`,study?.coherence_floor??0.3,layer==="coherence_change");
  const coherenceChange=useMemo(()=>coherenceChangeSummary(primaryGrid.grid,previousGrid.grid),[primaryGrid.grid,previousGrid.grid]);
  const audioSamples=useMemo(()=>{
    const grid=primaryGrid.grid;
    const pixel=point?probeVolcano(grid,point.lat,point.lon):null;
    if(!grid||!pixel) return [];
    const stride=Math.max(1,Math.floor(grid.width/48));
    const samples=[];
    for(let column=0;column<grid.width;column+=stride){
      const index=pixel.row*grid.width+column;
      const phase=grid.phase_radians[index];
      const coherence=grid.coherence[index];
      samples.push({value:phase,amplitude:coherence,disorder:coherence==null?null:1-coherence});
    }
    return samples;
  },[primaryGrid.grid,point]);
  const fieldVolumeData = useMemo(() => (study?.pairs ?? []).filter((item) => item.sensor === "NISAR").map((item) => ({
    id: item.id,
    label: item.label,
    value: Math.max(0, item.statistics.p95_cm - item.statistics.p05_cm),
    valueLabel: (item.statistics.p95_cm - item.statistics.p05_cm).toFixed(1) + " cm spread",
    context: item.statistics.valid_fraction,
  })), [study]);
  if(error) return <InvestigationWorkspace hazard="volcano" className="volcano-page volcano-case-workspace" caseName="HAYLI GUBBI · PUBLISHED STUDY" title="Explore volcanic ground motion" subtitle="Published phase evidence is unavailable for this browser session." rail={<p className="volcano-kicker">NISAR RADAR EVIDENCE · AFAR, ETHIOPIA</p>} map={<p className="deformation-case-state" role="status">{error}</p>} drawer={<a href="/operator-guide">Local processing instructions ↗</a>} footer={<span className="iw-footer-note">No result available · this does not mean no deformation occurred</span>} />;
  if(!loaded||!study||!pair) return <InvestigationWorkspace hazard="volcano" className="volcano-page volcano-case-workspace" caseName="HAYLI GUBBI · PUBLISHED STUDY" title="Explore volcanic ground motion" subtitle="Loading the published NISAR and Sentinel-1 evidence." rail={<p className="volcano-kicker">NISAR RADAR EVIDENCE · AFAR, ETHIOPIA</p>} map={<p className="deformation-case-state" role="status">Loading published deformation evidence…</p>} drawer={<p>Loading interval dates, quality details, and pixel inspection controls…</p>} footer={<span className="iw-footer-note">Official phase products · evidence will appear when loaded</span>} />;
  const comparison=study.comparisons.find(item=>item.nisar_id===pair.id&&item.sentinel_id===reference?.id);
  const opticalView=opticalViews.find(item=>item.id===opticalViewId)??opticalViews[1];
  const mapPanels=layer==="coherence_change"
    ? previousPair?[{item:pair,title:"Selected interval · coherence",image:loaded.base+pair.coherence_image,emptyMessage:"Selected pair coherence is unavailable."},{item:pair,title:`Coherence change · compared with ${date(previousPair.start)} – ${date(previousPair.end)}`,image:coherenceDelta.url,emptyMessage:coherenceDelta.error??"Loading the matched earlier NISAR pair and building the difference layer…"}]
      :[{item:pair,title:"Coherence change unavailable",image:null,emptyMessage:"No immediately preceding NISAR interval with matching track, direction, polarization, wavelength, and duration is published for this selection."}]
    : [pair,...(reference?[reference]:[])].map(item=>({item,title:`${item.label} · ${item.sensor}`,image:layer==="phase_cycles"?(item.id===pair.id?phasePrimary.url:phaseReference.url):loaded.base+item[layer],emptyMessage:layer==="phase_cycles"?(item.id===pair.id?phasePrimary.error:phaseReference.error)??"Loading phase samples and building the cyclic color layer…":"This radar layer is unavailable."}));
  function choosePoint(lat:number,lon:number) {setPoint({lat,lon});setLatInput(lat.toFixed(5));setLonInput(lon.toFixed(5));setCoordinateError(null);}
  function submitCoordinates(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const latitudeText=latInput.trim(),longitudeText=lonInput.trim();
    const latitude=Number(latitudeText),longitude=Number(longitudeText);
    if(!latitudeText||!longitudeText||!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude < -90||latitude > 90||longitude < -180||longitude > 180) {
      setCoordinateError("Enter a latitude from −90 to 90 and a longitude from −180 to 180.");
      return;
    }
    choosePoint(latitude,longitude);
    setFocus({lat:latitude,lon:longitude,zoom:13});
  }
  const deformationTabs = [
    { id: "explore", number: "01", label: "Explore", hint: "Choose an observation interval and map layer", anchorIds: ["hayli-guide-explore"], content: <div id="hayli-guide-explore" className="volcano-tab-panel deformation-explorer">
      <p className="hazard-tab-intro">Select a published NISAR repeat-pass interval and decide which phase, displacement, coherence, or quality layer to inspect.</p>
      <header className="deformation-heading"><div><h2 id="deformation-title">Explore the measured radar phase</h2><p>Official NISAR products · {study.method_version} · publication {study.publication_version}</p></div><a className="volcano-download-link" href={loaded.evidenceUrl} download>Download evidence</a></header>
      <p className="deformation-timeline-note">Eruption reported {date(study.event_date)}. Each interval is independently referenced; the timeline does not show cumulative motion. Selected interval: {pair.statistics.assessed_area_km2.toFixed(1)} km² screened.</p>
      <div className="deformation-toolbar"><label>Evidence view<select value={layer} onChange={event=>setLayer(event.target.value as Layer)}><option value="los_image">Line-of-sight displacement</option><option value="phase_cycles">Phase cycles · modulo 2π</option><option value="coherence_image">Coherence · selected pair</option><option value="coherence_change">Coherence change · vs previous matched NISAR pair</option><option value="assessed_image">Quality-screened coverage</option></select></label>{layer!=="coherence_change"?<label>Independent radar view<select value={sentinel} onChange={event=>setSentinel(event.target.value)}>{study.pairs.filter(item=>item.sensor==="Sentinel-1").map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>:<div className="deformation-baseline-label"><span>Matched baseline</span><strong>{previousPair?`${date(previousPair.start)} – ${date(previousPair.end)}`:"No adjacent pair available"}</strong></div>}<div className="deformation-region-buttons">{study.regions.map(region=><button type="button" key={region.name} onClick={()=>{choosePoint(region.lat,region.lon);setFocus({lat:region.lat,lon:region.lon,zoom:13});}}>{region.name}</button>)}</div></div>
      <p className="deformation-method-note">Current interval: {date(pair.start)}–{date(pair.end)} · {pair.sensor} {pair.collection} · {pair.polarization} · {pair.maturity}. The map displays processed study coverage only.</p>
      <FieldVolumeDisclosure
        kind="volcano"
        title="Deformation intervals in three dimensions"
        metricLabel="Apparent LOS 5th–95th percentile spread"
        contextLabel="Screened coverage"
        observations={fieldVolumeData}
        selectedId={pair.id}
        onSelectId={setSelected}
        note="The main columns show the published apparent LOS distribution spread for each independent interval; the companion columns show screened coverage. The volcanic cone is conceptual, not surveyed topography, and intervals are not cumulative motion."
      />
    </div> },
    { id: "check", number: "02", label: "Check it", hint: "Inspect pixels, comparison coverage, and evidence", anchorIds: ["hayli-guide-check"], content: <div id="hayli-guide-check" className="volcano-tab-panel deformation-explorer">
      <p className="hazard-tab-intro">Inspect a sample and compare the selected NISAR interval with Sentinel-1 where available. Coverage and uncertainty stay separate from interpretation.</p>
      <div className="radar-brief-row"><TriageBriefButton filename="hayli-gubbi-deformation-triage.json" title="Hayli Gubbi deformation evidence brief" brief={{ site: study.title, event_date: study.event_date, selected_interval: { sensor: pair.sensor, start: pair.start, end: pair.end, product: pair.collection, maturity: pair.maturity, wavelength_m: pair.wavelength_m, phase_sign: pair.phase_sign }, selected_pair: { screened_coverage_fraction: pair.statistics.valid_fraction, median_coherence: pair.statistics.median_coherence, assessed_area_km2: pair.statistics.assessed_area_km2, apparent_los_range_cm: [pair.statistics.p05_cm, pair.statistics.p95_cm], reference_patch_mad_cm: pair.statistics.reference_mad_cm }, independent_sentinel_1_pair: reference ? { start: reference.start, end: reference.end, wavelength_m: reference.wavelength_m, median_coherence: reference.statistics.median_coherence, screened_coverage_fraction: reference.statistics.valid_fraction } : "Not selected", comparison: comparison?.interpretation ?? "No matched comparison statement available.", interpretation: "Phase-derived LOS change is deformation evidence; the study does not predict eruptions or attribute every phase feature to the eruption.", unavailable: { operational_volcano_alert_level: "Not assigned.", eruption_forecast: "Not produced." }, limitations: study.limitations }}/><span>Evidence summary only · no alert level or forecast is issued.</span></div>
      <div className={`deformation-inspector${layer==="coherence_change"?" deformation-inspector--change":""}`}><form onSubmit={submitCoordinates} noValidate><h3>Inspect a map sample</h3><label>Latitude<input type="number" step="any" min="-90" max="90" required value={latInput} aria-invalid={Boolean(coordinateError)} aria-describedby={coordinateError ? "deformation-coordinate-error" : undefined} onChange={e=>{setLatInput(e.target.value);setCoordinateError(null);}}/></label><label>Longitude<input type="number" step="any" min="-180" max="180" required value={lonInput} aria-invalid={Boolean(coordinateError)} aria-describedby={coordinateError ? "deformation-coordinate-error" : undefined} onChange={e=>{setLonInput(e.target.value);setCoordinateError(null);}}/></label><button type="submit">Inspect coordinates</button>{coordinateError&&<p id="deformation-coordinate-error" className="deformation-coordinate-error" role="alert">{coordinateError}</p>}<p>Click either map to inspect the same location in both radar views.</p></form>{layer==="coherence_change"&&previousPair?<CoherenceChangePixel pair={pair} grid={primaryGrid.grid} baseline={previousGrid.grid} point={point}/>:<><Pixel pair={pair} grid={primaryGrid.grid} point={point}/>{reference&&<Pixel pair={reference} grid={referenceGrid.grid} point={point}/>}</>}</div>
      <RadarSonifier samples={audioSamples} label="Hear the phase transect" explanation="Click a point on the map first. Pitch follows unwrapped phase across that latitude; loudness follows coherence and roughness adds a small noise component. This is a sonified sample row, not an alert or deformation forecast." />
      {(primaryGrid.error||referenceGrid.error)&&<p role="alert">{primaryGrid.error||referenceGrid.error} Maps remain available; pixel values cannot be inspected until the data loads.</p>}
      <section className="deformation-comparison"><h3>What the independent view can tell us</h3><p>{comparison?`${percent(comparison.common_valid_fraction)} of the published rectangle is screened in both views. Sentinel-1 starts ${Math.abs(comparison.start_offset_days)} days ${comparison.start_offset_days<=0?"earlier":"later"} and ends ${Math.abs(comparison.end_offset_days)} days ${comparison.end_offset_days<=0?"earlier":"later"} than this NISAR interval. ${comparison.interpretation}`:"The selected NISAR interval differs from the event comparison. Sentinel-1 is shown for event context; no pair agreement assessment is available for this interval."}</p>{comparison?.status==="INCONCLUSIVE_COVERAGE"&&<p role="status">Coverage is below the 20% comparison floor; the comparison is inconclusive.</p>}<p>Localized phase structure near Erta Ale appears in both sensors, while the event NISAR interval has much less usable coverage around Hayli Gubbi. Timing, geometry, and remaining phase errors limit interpretation.</p><div className="deformation-table-scroll"><table><caption>Regional distributions of apparent LOS change · different sensor directions and time windows</caption><thead><tr><th>Region</th><th>NISAR assessed</th><th>NISAR 5–95% range</th><th>Sentinel-1 assessed</th><th>Sentinel-1 5–95% range</th></tr></thead><tbody>{pair.statistics.regions.map(region=>{const second=reference?.statistics.regions.find(r=>r.name===region.name);return <tr key={region.name}><th>{region.name}</th><td>{percent(region.valid_fraction)}</td><td>{cm(region.p05_cm)} to {cm(region.p95_cm)}</td><td>{second?percent(second.valid_fraction):"Unavailable"}</td><td>{second?`${cm(second.p05_cm)} to ${cm(second.p95_cm)}`:"Unavailable"}</td></tr>;})}</tbody></table></div><p>Coherence is not a confidence percentage. NISAR reference-patch dispersion: {pair.statistics.reference_mad_cm.toFixed(2)} cm MAD; not a per-pixel accuracy estimate. Event reports do not attribute every radar feature.</p></section>
    </div> },
    { id: "learn", number: "03", label: "Learn", hint: "Learn how to read phase, coherence, and sensor differences", anchorIds: ["hayli-guide-learn"], content: <div id="hayli-guide-learn" className="volcano-tab-panel deformation-explorer">
      <p className="hazard-tab-intro">Radar phase can reveal relative surface motion. It does not independently identify a cause or predict an eruption.</p>
      <p className="deformation-method-note">Apparent line-of-sight (LOS) change is relative to the cyan reference patch. Atmospheric, ionospheric, and tide corrections are not applied. Positive values point toward the satellite; these are candidates for ground deformation.</p>
      <aside className="deformation-band-comparison" aria-label="L-band and C-band comparison"><div><h3>Longer wavelength changes the phase scale; it does not guarantee coherence</h3><p>One full phase cycle represents half a wavelength of line-of-sight motion, assuming the phase is displacement. The longer L-band cycle is less densely wrapped for the same motion, but coherence also depends on surface change, geometry, time gap, and processing.</p></div><div className="deformation-band-comparison__metrics"><article><strong>NISAR · L-band</strong><span>{(pair.wavelength_m*100).toFixed(1)} cm wavelength</span><b>{(pair.wavelength_m*50).toFixed(1)} cm LOS per cycle</b><small>{percent(pair.statistics.valid_fraction)} screened · median coherence {pair.statistics.median_coherence.toFixed(3)}</small></article>{reference&&<article><strong>Sentinel-1 · C-band</strong><span>{(reference.wavelength_m*100).toFixed(1)} cm wavelength</span><b>{(reference.wavelength_m*50).toFixed(1)} cm LOS per cycle</b><small>{percent(reference.statistics.valid_fraction)} screened · median coherence {reference.statistics.median_coherence.toFixed(3)}</small></article>}</div><p className="deformation-band-comparison__finding">{reference?`For these selected products, Sentinel-1 median coherence (${reference.statistics.median_coherence.toFixed(3)}) is higher than NISAR’s (${pair.statistics.median_coherence.toFixed(3)}). Their time windows differ, so this is not a controlled band comparison.`:"Choose a Sentinel-1 pair to see its measured coherence and coverage."} The data do not establish a maximum detectable deformation gradient.</p><nav><a href="https://science.nasa.gov/mission/nisar/interferometry/" target="_blank" rel="noreferrer">NASA: reading InSAR phase cycles ↗</a><a href="https://hyp3-docs.asf.alaska.edu/guides/burst_insar_product_guide/" target="_blank" rel="noreferrer">ASF: Sentinel-1 wavelength and decorrelation ↗</a></nav></aside>
      <div className="volcano-curtain-picker"><div><h3>Why radar?</h3><p>Optical imagery records the plume and surface appearance. NISAR estimates line-of-sight surface motion from repeat-pass radar phase.</p></div><label>Optical event view<select value={opticalViewId} onChange={event=>setOpticalViewId(event.target.value)}>{opticalViews.map(view=><option key={view.id} value={view.id}>{view.sensor} · {date(view.date)} · {view.label}</option>)}</select></label></div>
      <SensorCurtain title="Optical event context and NISAR deformation" description="The optical frame shows the ash plume or volcanic surface. The NISAR layer is a phase-derived displacement product for the selected repeat-pass interval." left={{label:`${opticalView.sensor} · ${opticalView.label}`,date:date(opticalView.date),src:`/volcanoes/imagery/${opticalView.file}`,alt:opticalView.alt}} right={{label:`NISAR L2 GUNW · LOS change · ${pair.maturity}`,date:`${date(pair.start)} – ${date(pair.end)}`,src:loaded.base+pair.los_image,alt:`NISAR ${pair.maturity} geocoded unwrapped interferogram converted to apparent line-of-sight displacement for ${date(pair.start)} to ${date(pair.end)}.`}} alignment="context" aspectRatio="16 / 10" imageFit="contain" tone="earth" note={`The optical image was acquired ${date(opticalView.date)}. NISAR measures phase change across ${date(pair.start)} to ${date(pair.end)} (${percent(pair.statistics.valid_fraction)} screened). Sources are not co-registered and dates differ, so this is sensor context, not pixel agreement. Radar works through cloud and darkness; this case does not show it seeing through ash. Displacement uncertainty is not quantified.`} sourceHref="https://science.nasa.gov/earth/earth-observatory/hayli-gubbis-explosive-first-impression/" sourceLabel="NASA Earth Observatory imagery and acquisition notes" />
      {layer==="phase_cycles"&&<aside className="deformation-mode-note deformation-mode-note--phase"><div><h3>{pair.sensor}: one phase cycle ≈ {(pair.wavelength_m*50).toFixed(1)} cm LOS</h3><p>The cyclic view wraps unwrapped phase modulo 2π and masks samples below the coherence floor ({study.coherence_floor.toFixed(2)}) or outside the connected phase component. This is not automatically vertical uplift.</p></div><details open><summary>How to read the fringes</summary><p>Follow one hue through the full rainbow back to itself: one phase cycle. Atmospheric, ionospheric, orbit, terrain, and unwrapping errors also affect phase; this is not a magma-chamber model.</p></details></aside>}
      {layer==="coherence_change"&&<aside className="deformation-mode-note deformation-mode-note--coherence"><div><h3>Coherence change is a disturbance clue, not a damage verdict</h3><p>Colors show selected-pair coherence minus the immediately preceding matching NISAR pair. Low coherence can result from surface disturbance, vegetation, moisture, geometry, or noise.</p></div><div className="deformation-change-summary" aria-live="polite">{coherenceChange?<><strong>{coherenceChange.meanDelta>0?"+":""}{coherenceChange.meanDelta.toFixed(3)}</strong><span>mean change across {coherenceChange.count.toLocaleString()} common pixels</span><strong>{percent(coherenceChange.lowerFraction)}</strong><span>common pixels with lower coherence</span></>:<span>{previousPair?"Loading aligned coherence samples…":"No preceding matching interval is available."}</span>}</div></aside>}
      <details className="deformation-provenance"><summary>Inputs, quality screens, and processing provenance</summary><p>{study.boundary_source}. {study.reference_note}. Coherence floor: {study.coherence_floor}; only the connected phase component containing the reference patch is retained.</p>{[pair,...(reference?[reference]:[])].map(item=><div key={item.id}><strong>{item.sensor} · {item.collection}</strong><code>{item.granule_id}</code><p>{item.phase_sign} Wavelength: {item.wavelength_m.toFixed(6)} m. Native grid: {item.native_crs}, spacing {item.native_spacing.join(" × ")} {item.native_crs==="EPSG:4326"?"degrees":"m"}. {item.original_dates_verified?"Dates checked against original product metadata.":"Dates identified from source product name."}</p>{item.data_url&&<a href={item.data_url} target="_blank" rel="noreferrer">Original product · Earthdata login required</a>}</div>)}<ul>{study.limitations.map(item=><li key={item}>{item}</li>)}</ul><a href={loaded.base+"study.json"} download>Study manifest</a> · <a href={loaded.base+"checksums.json"} download>Artifact checksums</a></details>
    </div> },
  ];
  return <InvestigationWorkspace hazard="volcano" className="volcano-page volcano-case-workspace" caseName="HAYLI GUBBI · PUBLISHED STUDY" title="What moved beneath Erta Ale?" subtitle={`Official NISAR phase products · ${study.method_version} · publication ${study.publication_version}. Eruption report: ${date(study.event_date)}.`} rail={<>
    <p className="volcano-kicker">VOLCANIC GROUND DEFORMATION · AFAR, ETHIOPIA</p>
    <HazardWalkthrough guideTitle="HAYLI GUBBI CASE GUIDE" steps={[{ title: "Explore the selected interval", target: "hayli-guide-explore", explanation: "Choose among published repeat-pass NISAR intervals, then select displacement, phase cycles, coherence, coherence change, or screened coverage." }, { title: "Check pixels and the cross-sensor view", target: "hayli-guide-check", explanation: "Inspect a map sample and read Sentinel-1 overlap together with assessed coverage, temporal offsets, and reference-patch dispersion." }, { title: "Learn what phase can show", target: "hayli-guide-learn", explanation: "Phase-derived line-of-sight motion is not automatically vertical uplift or eruption attribution. Atmospheric and processing uncertainty remain." }]} />
    <Link className="volcano-case-link" href="/volcano/global">← Back to volcano map</Link>
    <Link className="volcano-case-link" href="/volcano/kilauea">Explore the Kīlauea · Episode 36 case ↗</Link>
    <div className="volcano-context-note"><strong>Selected NISAR interval</strong><p>{date(pair.start)} — {date(pair.end)}</p><p>{pair.statistics.assessed_area_km2.toFixed(1)} km² screened within the analysis rectangle.</p></div>
    <div className="volcano-context-note"><strong>Interpretation</strong><p>Phase-derived apparent LOS change · uncertainty remains visible. This is deformation evidence, not an eruption prediction.</p></div>
    <div className="volcano-context-note"><strong>Quality</strong><p>{percent(pair.statistics.valid_fraction)} screened coverage · coherence floor {study.coherence_floor.toFixed(2)}.</p></div>
  </>} map={<>
    <div className="deformation-map-hint"><button type="button" onClick={()=>setFocus({lat:(study.bbox[1]+study.bbox[3])/2,lon:(study.bbox[0]+study.bbox[2])/2,zoom:10,fullStudy:true})}>Show full study</button><span>Click either map to inspect the same location in both radar views.</span></div>
    <div className={`deformation-maps${layer==="coherence_change"?" deformation-maps--change":""}`}>
      {mapPanels.map((panel,index)=><article key={`${panel.item.id}-${panel.title}`} className="deformation-map-panel"><header><strong>{panel.title}</strong><span>{layer==="coherence_change"&&index===1&&previousPair?`${date(previousPair.start)} – ${date(previousPair.end)} → ${date(pair.start)} – ${date(pair.end)}`:`${date(panel.item.start)} — ${date(panel.item.end)}`}</span></header><div className="deformation-map"><Map bbox={study.bbox} referenceBbox={study.reference_bbox} imageUrl={panel.image} imageOpacity={layer === "los_image" ? 0.7 : 0.9} emptyMessage={panel.emptyMessage} point={point} focus={focus} onProbe={choosePoint} regions={study.regions}/></div><footer>{panel.item.direction.toLowerCase()} · {panel.item.look_direction.toLowerCase()} looking · {panel.item.polarization} · {panel.item.maturity}<a href={loaded.base+panel.item.los_download} download>Native LOS GeoTIFF</a></footer></article>)}
    </div>
  </>} drawer={<div className="deformation-explorer" aria-labelledby="deformation-title">
    <header className="deformation-heading"><div><h2 id="deformation-title">Explore the measured radar phase</h2><p>Official NISAR HH interferograms · {study.method_version} · publication {study.publication_version}</p></div><a className="volcano-download-link" href={loaded.evidenceUrl} download>Download the evidence package</a></header>
    <div className="radar-brief-row"><TriageBriefButton filename="hayli-gubbi-deformation-triage.json" title="Hayli Gubbi deformation evidence brief" brief={{ site: study.title, event_date: study.event_date, selected_interval: { sensor: pair.sensor, start: pair.start, end: pair.end, product: pair.collection, maturity: pair.maturity, wavelength_m: pair.wavelength_m, phase_sign: pair.phase_sign }, selected_pair: { screened_coverage_fraction: pair.statistics.valid_fraction, median_coherence: pair.statistics.median_coherence, assessed_area_km2: pair.statistics.assessed_area_km2, apparent_los_range_cm: [pair.statistics.p05_cm, pair.statistics.p95_cm], reference_patch_mad_cm: pair.statistics.reference_mad_cm }, independent_sentinel_1_pair: reference ? { start: reference.start, end: reference.end, wavelength_m: reference.wavelength_m, median_coherence: reference.statistics.median_coherence, screened_coverage_fraction: reference.statistics.valid_fraction } : "Not selected", comparison: comparison?.interpretation ?? "No matched comparison statement available.", interpretation: "Phase-derived LOS change is deformation evidence; the study does not predict eruptions or attribute every phase feature to the eruption.", unavailable: { operational_volcano_alert_level: "Not assigned.", eruption_forecast: "Not produced." }, limitations: study.limitations }}/><span>Evidence summary only · no volcano alert level or forecast is issued.</span></div>
    <p className="deformation-method-note">Apparent line-of-sight (LOS) change is relative to the cyan reference patch. Atmospheric, ionospheric, and tide corrections are not applied. Positive values point toward the satellite; these are candidates for ground deformation.</p>
    <aside className="deformation-band-comparison" aria-label="L-band and C-band comparison">
      <div><h3>Longer wavelength changes the phase scale; it does not guarantee coherence</h3><p>One full phase cycle represents half a wavelength of line-of-sight motion, assuming the phase is displacement. The longer L-band cycle is less densely wrapped for the same motion, but coherence also depends on surface change, geometry, time gap, and processing.</p></div>
      <div className="deformation-band-comparison__metrics"><article><strong>NISAR · L-band</strong><span>{(pair.wavelength_m * 100).toFixed(1)} cm wavelength</span><b>{(pair.wavelength_m * 50).toFixed(1)} cm LOS per cycle</b><small>{percent(pair.statistics.valid_fraction)} screened · median coherence {pair.statistics.median_coherence.toFixed(3)}</small></article>{reference && <article><strong>Sentinel-1 · C-band</strong><span>{(reference.wavelength_m * 100).toFixed(1)} cm wavelength</span><b>{(reference.wavelength_m * 50).toFixed(1)} cm LOS per cycle</b><small>{percent(reference.statistics.valid_fraction)} screened · median coherence {reference.statistics.median_coherence.toFixed(3)}</small></article>}</div>
      <p className="deformation-band-comparison__finding">{reference ? `For these selected products, Sentinel-1’s median coherence (${reference.statistics.median_coherence.toFixed(3)}) is higher than NISAR’s (${pair.statistics.median_coherence.toFixed(3)}). Their observation windows are ${date(pair.start)}–${date(pair.end)} and ${date(reference.start)}–${date(reference.end)}, so this is not a controlled band comparison. The data here do not support a claim that C-band decorrelated while L-band recovered.` : "Choose a Sentinel-1 pair to see its measured coherence and coverage; without it no band comparison is available."} The sample does not establish a maximum detectable deformation gradient.</p>
      <nav><a href="https://science.nasa.gov/mission/nisar/interferometry/" target="_blank" rel="noreferrer">NASA: reading InSAR phase cycles ↗</a><a href="https://hyp3-docs.asf.alaska.edu/guides/burst_insar_product_guide/" target="_blank" rel="noreferrer">ASF: Sentinel-1 wavelength and decorrelation ↗</a></nav>
    </aside>
    <div className="volcano-curtain-picker"><div><h3>Why radar?</h3><p>Optical imagery records the plume and surface appearance. NISAR estimates line-of-sight surface motion from repeat-pass radar phase.</p></div><label>Optical event view<select value={opticalViewId} onChange={event=>setOpticalViewId(event.target.value)}>{opticalViews.map(view=><option key={view.id} value={view.id}>{view.sensor} · {date(view.date)} · {view.label}</option>)}</select></label></div>
    <SensorCurtain
      title="Optical event context and NISAR deformation"
      description="The optical frame shows the ash plume or volcanic surface. The NISAR layer is a phase-derived displacement product for the selected repeat-pass interval."
      left={{label:`${opticalView.sensor} · ${opticalView.label}`,date:date(opticalView.date),src:`/volcanoes/imagery/${opticalView.file}`,alt:opticalView.alt}}
      right={{label:`NISAR L2 GUNW · LOS change · ${pair.maturity}`,date:`${date(pair.start)} – ${date(pair.end)}`,src:loaded.base+pair.los_image,alt:`NISAR ${pair.maturity} geocoded unwrapped interferogram converted to apparent line-of-sight displacement for ${date(pair.start)} to ${date(pair.end)}. The preview uses a fixed plus or minus ${study.display_limit_cm} cm color stretch; pale center colors indicate values near zero, transparent pixels are unassessed, and values beyond the range are clipped.`}}
      alignment="context"
      aspectRatio="16 / 10"
      imageFit="contain"
      tone="earth"
      note={`The optical image was acquired ${date(opticalView.date)}. NISAR measures phase change across ${date(pair.start)} to ${date(pair.end)} (${pair.statistics.valid_fraction==null?"coverage unavailable":percent(pair.statistics.valid_fraction)} screened). These sources are not co-registered and their dates differ, so the wipe is for sensor context, not pixel-by-pixel agreement. Radar works through cloud and darkness; this case does not show that it sees through ash. Displacement uncertainty is not quantified.`}
      sourceHref="https://science.nasa.gov/earth/earth-observatory/hayli-gubbis-explosive-first-impression/"
      sourceLabel="NASA Earth Observatory imagery and acquisition notes"
    />
    <div className="deformation-toolbar"><label>Evidence view<select value={layer} onChange={event=>setLayer(event.target.value as Layer)}><option value="los_image">Line-of-sight displacement</option><option value="phase_cycles">Phase cycles · modulo 2π</option><option value="coherence_image">Coherence · selected pair</option><option value="coherence_change">Coherence change · vs previous matched NISAR pair</option><option value="assessed_image">Quality-screened coverage</option></select></label>{layer!=="coherence_change"?<label>Independent radar view<select value={sentinel} onChange={event=>setSentinel(event.target.value)}>{study.pairs.filter(item=>item.sensor==="Sentinel-1").map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>:<div className="deformation-baseline-label"><span>Matched baseline</span><strong>{previousPair?`${date(previousPair.start)} – ${date(previousPair.end)}`:"No adjacent pair available"}</strong></div>}<div className="deformation-region-buttons">{study.regions.map(region=><button type="button" key={region.name} onClick={()=>{choosePoint(region.lat,region.lon);setFocus({lat:region.lat,lon:region.lon,zoom:13});}}>{region.name}</button>)}</div></div>
    {layer==="phase_cycles"&&<aside className="deformation-mode-note deformation-mode-note--phase"><div><h3>{pair.sensor}: 1 phase cycle ≈ {(pair.wavelength_m*50).toFixed(1)} cm LOS{reference?`; ${reference.sensor}: ≈${(reference.wavelength_m*50).toFixed(1)} cm LOS`:""}</h3><p>This cyclic view wraps the published unwrapped phase modulo 2π and masks samples below the study coherence floor ({study.coherence_floor.toFixed(2)}) or outside its connected phase component. The cycle length above is half that sensor’s wavelength, assuming the phase change is caused by surface displacement; it is not automatically vertical uplift.</p></div><details><summary>How to read the fringes</summary><p>Follow one hue through the full rainbow back to itself: that is one phase cycle. Atmospheric, ionospheric, orbit, terrain, and unwrapping errors can also affect phase. The map shows screened phase structure, not a magma-chamber model.</p></details></aside>}
    {layer==="coherence_change"&&<aside className="deformation-mode-note deformation-mode-note--coherence"><div><h3>Coherence change is a disturbance clue, not a damage verdict</h3><p>Colors show selected-pair coherence minus the immediately preceding NISAR pair. The comparison is available only for adjacent, matching NISAR acquisitions on the same grid. Low coherence can result from surface disturbance, vegetation, moisture, geometry, or noise.</p></div><div className="deformation-change-summary" aria-live="polite">{coherenceChange?<><strong>{coherenceChange.meanDelta>0?"+":""}{coherenceChange.meanDelta.toFixed(3)}</strong><span>mean coherence change across {coherenceChange.count.toLocaleString()} common pixels</span><strong>{percent(coherenceChange.lowerFraction)}</strong><span>common pixels with lower coherence</span></>:<span>{previousPair?"Loading aligned coherence samples…":"No preceding matching interval is available for this date."}</span>}</div></aside>}
    <div className="deformation-legend deformation-legend--drawer">{layer==="los_image"?<><span>Away · −{study.display_limit_cm} cm</span><i className="deformation-scale"/><span>+{study.display_limit_cm} cm · toward</span></>:layer==="phase_cycles"?<><span>−π</span><i className="deformation-scale deformation-scale--phase"/><span>+π / cycle repeats</span></>:layer==="coherence_image"?<><span>Low · 0</span><i className="deformation-scale deformation-scale--gray"/><span>1 · high</span></>:layer==="coherence_change"?<><span>Loss</span><i className="deformation-scale deformation-scale--change"/><span>Gain</span></>:<span>White: passed the quality screens</span>}<b>{layer==="los_image"?`Light center: near 0 cm · transparent: unassessed · clipped outside ±${study.display_limit_cm} cm`:"Transparent areas: unassessed"}</b></div>
    <div className={`deformation-inspector${layer==="coherence_change"?" deformation-inspector--change":""}`}><form onSubmit={submitCoordinates}><h3>Inspect a map sample</h3><label>Latitude<input type="number" step="any" min="-90" max="90" required value={latInput} onChange={e=>setLatInput(e.target.value)}/></label><label>Longitude<input type="number" step="any" min="-180" max="180" required value={lonInput} onChange={e=>setLonInput(e.target.value)}/></label><button type="submit">Inspect coordinates</button><p>Click either map to inspect the same location in both radar views.</p></form>{layer==="coherence_change"&&previousPair?<CoherenceChangePixel pair={pair} grid={primaryGrid.grid} baseline={previousGrid.grid} point={point}/>:<><Pixel pair={pair} grid={primaryGrid.grid} point={point}/>{reference&&<Pixel pair={reference} grid={referenceGrid.grid} point={point}/>}</>}</div>
    <RadarSonifier samples={audioSamples} label="Hear the phase transect" explanation="Click a point on the map first. Pitch follows unwrapped phase across that latitude; loudness follows coherence and roughness adds a small noise component. This is a sonified sample row, not an alert or deformation forecast." />
    {(primaryGrid.error||referenceGrid.error)&&<p role="alert">{primaryGrid.error||referenceGrid.error} Maps remain available; pixel values cannot be inspected until the data loads.</p>}
    <section className="deformation-comparison"><h3>What the independent view can tell us</h3><p>{comparison?`${percent(comparison.common_valid_fraction)} of the published rectangle is screened in both views. Sentinel-1 starts ${Math.abs(comparison.start_offset_days)} days ${comparison.start_offset_days<=0?"earlier":"later"} and ends ${Math.abs(comparison.end_offset_days)} days ${comparison.end_offset_days<=0?"earlier":"later"} than this NISAR interval. ${comparison.interpretation}`:"The selected NISAR interval differs from the event comparison. Sentinel-1 is shown for event context; no pair agreement assessment is available for this interval."}</p>{comparison?.status==="INCONCLUSIVE_COVERAGE"&&<p role="status">Coverage is below the 20% comparison floor; the comparison is inconclusive.</p>}
      <p>Read the regional ranges together with screened coverage. Localized phase structure near Erta Ale appears in both sensors, while the event NISAR interval has much less usable coverage around Hayli Gubbi. Opposite signs or different ranges may reflect viewing direction, timing, or remaining phase errors; they do not establish a detector error or an eruption mechanism.</p>
      <div className="deformation-table-scroll"><table><caption>Regional distributions of apparent LOS change · different sensor directions and time windows</caption><thead><tr><th>Region</th><th>NISAR assessed</th><th>NISAR 5–95% range</th><th>Sentinel-1 assessed</th><th>Sentinel-1 5–95% range</th></tr></thead><tbody>{pair.statistics.regions.map(region=>{const second=reference?.statistics.regions.find(r=>r.name===region.name);return <tr key={region.name}><th>{region.name}</th><td>{percent(region.valid_fraction)}</td><td>{cm(region.p05_cm)} to {cm(region.p95_cm)}</td><td>{second?percent(second.valid_fraction):"Unavailable"}</td><td>{second?`${cm(second.p05_cm)} to ${cm(second.p95_cm)}`:"Unavailable"}</td></tr>;})}</tbody></table></div>
      <p>Coherence helps screen phase quality; it is not a confidence percentage. NISAR reference-patch dispersion: {pair.statistics.reference_mad_cm.toFixed(2)} cm MAD. This is not a per-pixel accuracy estimate. Eruption reports establish event context; they do not attribute every radar feature to volcanic motion.</p>
    </section>
    <details className="deformation-provenance"><summary>Inputs, quality screens, and processing provenance</summary><p>{study.boundary_source}. {study.reference_note}. Coherence floor: {study.coherence_floor}; only the connected phase component containing the reference patch is retained.</p>{[pair,...(reference?[reference]:[])].map(item=><div key={item.id}><strong>{item.sensor} · {item.collection}</strong><code>{item.granule_id}</code><p>{item.phase_sign} Wavelength: {item.wavelength_m.toFixed(6)} m. Native grid: {item.native_crs}, spacing {item.native_spacing.join(" × ")} {item.native_crs==="EPSG:4326"?"degrees":"m"}. {item.original_dates_verified?"Dates checked against original product metadata.":"Dates identified from source product name."}</p>{item.data_url&&<a href={item.data_url} target="_blank" rel="noreferrer">Original product · Earthdata login required</a>}</div>)}<ul>{study.limitations.map(item=><li key={item}>{item}</li>)}</ul><a href={loaded.base+"study.json"} download>Study manifest</a> · <a href={loaded.base+"checksums.json"} download>Artifact checksums</a></details>
  </div>} drawerTabs={deformationTabs} drawerTabsPlacement="drawer" drawerPersistent={<div className="deformation-timeline" aria-label="NISAR observation intervals">{study.pairs.filter(item=>item.sensor==="NISAR").map(item=><button type="button" key={item.id} aria-pressed={item.id===pair.id} onClick={()=>setSelected(item.id)}><span>{item.label}</span><strong>{date(item.start)} — {date(item.end)}</strong><small>{percent(item.statistics.valid_fraction)} screened coverage</small></button>)}</div>} footer={<div className="deformation-legend">{layer==="los_image"?<><span>Away · −{study.display_limit_cm} cm</span><i className="deformation-scale"/><span>+{study.display_limit_cm} cm · toward</span></>:layer==="phase_cycles"?<><span>−π</span><i className="deformation-scale deformation-scale--phase"/><span>+π / cycle repeats</span></>:layer==="coherence_image"?<><span>Low · 0</span><i className="deformation-scale deformation-scale--gray"/><span>1 · high</span></>:layer==="coherence_change"?<><span>Loss</span><i className="deformation-scale deformation-scale--change"/><span>Gain</span></>:<span>White: passed the quality screens</span>}<b>{layer==="los_image"?`Light center: near 0 cm · transparent: unassessed · clipped outside ±${study.display_limit_cm} cm`:"Transparent areas: unassessed"}</b></div>} />;
}

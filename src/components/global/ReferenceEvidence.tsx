"use client";
import { publicClient } from "@/lib/app-mode";

import { useEffect, useState } from "react";
import SensorCurtain from "../shared/SensorCurtain";

type Metrics = { matching_pixels: number; radar_only_pixels: number; optical_only_pixels: number; precision: number | null; recall: number | null; f1: number | null };
type OpticalSupport = { support: string; native_hls_pixels_assessed: number; hls_pixel_area_km2: number; study_area_km2: number;
  common_clear_area_km2: number; common_clear_fraction: number; radar_candidate_area_km2: number;
  radar_candidate_area_in_hls_footprint_km2: number; candidate_assessed_area_km2: number; candidate_assessed_fraction: number | null; optical_new_water_area_km2: number;
  true_positive_area_km2: number; false_positive_area_km2: number; false_negative_area_km2: number;
  precision: number | null; recall: number | null; f1: number | null; intersection_over_union: number | null };
type Visuals = { images: Record<string, string>; width: number; height: number; bounds: number[][]; legend: { value: number; label: string; color: string }[]; rgb_display: string; display_note: string };
type RadarPreview = { run_id: string; date: string; layers: Record<string, { images: Record<string, string>; bounds: number[][]; width: number; height: number; scale_db: number[] }> };
type Evidence = Visuals & {
  run_id: string; baseline_date: string; event_date: string; created_at: string; reference_status?: string;
  baseline_method?: { baseline_method?: string; baseline_observation_dates?: string[]; baseline_observation_count?: number };
  comparison: { baseline: { nisar_observation_dates?: string[]; nisar_method?: string; hls_date: string; offset_days: number; scene: string }; event: { hls_date: string; offset_days: number; scene: string }; mndwi_threshold: number };
  coverage: { common_clear_fraction: number; common_clear_area_km2: number };
  metrics: Metrics; optical_support?: OpticalSupport; counts_reproduced: boolean;
  candidate_coverage: { total_pixels: number; compared_pixels: number; unassessed_pixels: number; compared_fraction: number | null };
  radar_only_categories: { key: string; pixels: number; area_km2: number; fraction_of_radar_only: number | null }[];
  detector_audit: { finding: string; existing_water_interpretation: string; quality_limitation: string };
  resampling_audit: { metrics: Metrics }; proximity_audit: { radius_m: number; radar_only_pixels_near_optical_change: number };
  alternate_date_check: { baseline_date: string; event_date: string; baseline_scene: string; event_scene: string; common_clear_fraction: number; metrics: Metrics; optical_support?: OpticalSupport; method: string; candidate_compared_fraction: number | null; already_water_pixels: number; visuals: Visuals } | null;
  patch_context: { id: string; area_km2: number; total_pixels: number; compared_pixels: number; clear_fraction: number; matching_new_water_pixels: number; water_on_both_optical_dates_pixels: number }[];
  limitations: string[];
};
const percentage = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const precisePercentage = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(value > 0 && value < 0.001 ? 4 : 1)}%`;
const categoryNames: Record<string, string> = { water_on_both_optical_dates: "Water on both optical dates", not_water_on_either_optical_date: "Not water on either optical date", optical_water_recession: "Water became non-water in HLS" };
const sameBounds = (a: number[][], b: number[][]) => a.length === b.length && a.every((row, i) => row.length === b[i]?.length && row.every((value, j) => Math.abs(value - (b[i]?.[j] ?? Number.NaN)) < 1e-6));

export default function ReferenceEvidence({ runId, refreshKey }: { runId: string; refreshKey: number }) {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState("");
  const [pairChoice, setPairChoice] = useState("primary");
  const [imageChoice, setImageChoice] = useState("rgb");
  const [mapChoice, setMapChoice] = useState("agreement");
  const [opacity, setOpacity] = useState(80);
  const [curtainChannel, setCurtainChannel] = useState("hh");
  const [radarRequest, setRadarRequest] = useState<{ runId: string; date: string; preview: RadarPreview | null; error: string }>({ runId: "", date: "", preview: null, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/wetland/reference-evidence?run=${runId}`, { signal: controller.signal })
      .then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.error || "Optical evidence unavailable."); return value as Evidence; })
      .then((value) => { setEvidence(value); setPairChoice("primary"); setError(""); })
      .catch((reason) => { if (!controller.signal.aborted) { setEvidence(null); setError(reason.message); } });
    return () => controller.abort();
  }, [runId, refreshKey]);
  const current = evidence?.run_id === runId ? evidence : null;
  const alternative = pairChoice === "alternate" ? current?.alternate_date_check : null;
  const radarDate = alternative?.event_date || current?.event_date;
  useEffect(() => {
    if (!radarDate) return;
    const controller = new AbortController();
    fetch(`/api/wetland/radar?run=${encodeURIComponent(runId)}&date=${encodeURIComponent(radarDate)}`, { signal: controller.signal })
      .then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.error || "Matching NISAR radar image unavailable."); return value as RadarPreview; })
      .then((preview) => setRadarRequest({ runId, date: radarDate, preview, error: "" }))
      .catch((reason: unknown) => { if (!controller.signal.aborted) setRadarRequest({ runId, date: radarDate, preview: null, error: reason instanceof Error ? reason.message : "Matching NISAR radar image unavailable." }); });
    return () => controller.abort();
  }, [runId, refreshKey, radarDate]);
  const comparisonUsable = current?.reference_status === "CROSS_SENSOR_CHECK";
  const visuals = alternative?.visuals || current;
  const metrics = alternative?.metrics || current?.metrics;
  const opticalSupport = alternative?.optical_support || current?.optical_support;
  const beforeDate = alternative?.baseline_date || current?.comparison.baseline.hls_date;
  const afterDate = alternative?.event_date || current?.comparison.event.hls_date;
  const afterScene = alternative?.event_scene || current?.comparison.event.scene;
  const opticalSensor = afterScene?.includes(".S30.") ? "Sentinel-2" : afterScene?.includes(".L30.") ? "Landsat" : "Landsat / Sentinel-2";
  const coverage = alternative?.optical_support?.common_clear_fraction ?? current?.optical_support?.common_clear_fraction ?? alternative?.common_clear_fraction ?? current?.coverage.common_clear_fraction;
  const candidateCoverage = alternative?.optical_support?.candidate_assessed_fraction ?? current?.optical_support?.candidate_assessed_fraction ?? alternative?.candidate_compared_fraction ?? current?.candidate_coverage.compared_fraction;
  const radarRequestMatches = radarRequest.runId === runId && radarRequest.date === radarDate;
  const radarPreview = radarRequestMatches ? radarRequest.preview : null;
  const radarError = radarRequestMatches ? radarRequest.error : "";
  const radarLayer = radarPreview?.run_id === runId && radarPreview.date === radarDate ? radarPreview.layers[curtainChannel] : null;
  const opticalOffsetDays = radarDate ? Math.round((Date.parse(`${afterDate}T00:00:00Z`) - Date.parse(`${radarDate}T00:00:00Z`)) / 86_400_000) : 0;
  const artifact = (name: string, download = false) => `/api/wetland/artifact?run=${runId}&file=${encodeURIComponent(name)}${download ? "&download=1" : ""}`;
  return <section className="nisar-tools-section nisar-reference-evidence" id="nisar-reference-evidence" aria-labelledby="nisar-reference-title">
    <div className="nisar-tools-heading"><div><p className="global-eyebrow">X-RAY COMPARISON · MEASURED INPUTS</p><h2 id="nisar-reference-title">What can optical see, and what does radar measure?</h2><p>Compare real HLS optical and NISAR previews from the selected study. Dates, valid coverage and disagreements stay visible; the two sensors measure different signals.</p></div><a className="nisar-download" href="#nisar-process">{publicClient ? "How evidence is published" : "Prepare or update evidence ↑"}</a></div>
    {error ? <p className="nisar-tool-hint">{error} {publicClient ? "Ask the operator to publish the optical evidence." : <>Select <strong>Prepare optical evidence</strong> in the processing panel.</>}</p> : !current || !visuals || !metrics ? <p role="status">Loading optical evidence…</p> : <>
      <div className="nisar-evidence-finding">{comparisonUsable ? <><strong>{current.radar_only_categories.find((item) => item.key === "water_on_both_optical_dates")?.fraction_of_radar_only === 1 ? "Assessed radar candidates were already water" : "Radar change needs independent interpretation"}</strong><p>{current.detector_audit.finding}</p><p>{current.radar_only_categories.find((item) => item.key === "water_on_both_optical_dates")?.pixels.toLocaleString()} primary-reference radar-only pixels were water on both optical dates. {current.detector_audit.existing_water_interpretation}</p></> : <><strong>Optical comparison inconclusive</strong><p>Only {percentage(current.optical_support?.common_clear_fraction ?? current.coverage.common_clear_fraction)} of the study mask was comparable. These images show where optical evidence was available, but the small overlap cannot support an agreement or accuracy score. Most radar candidates remain unassessed.</p></>}</div>
      <div className="nisar-evidence-controls">
        <label>Reference comparison<select value={pairChoice} onChange={(event) => setPairChoice(event.target.value)}><option value="primary">Published · {current.comparison.baseline.hls_date} → {current.comparison.event.hls_date}</option>{current.alternate_date_check && <option value="alternate">Closer-date audit · {current.alternate_date_check.baseline_date} → {current.alternate_date_check.event_date}</option>}</select></label>
        <div><p className="nisar-evidence-control-label">Optical panels</p><div className="nisar-channel-buttons" role="group" aria-label="Optical image display"><button type="button" aria-pressed={imageChoice === "rgb"} onClick={() => setImageChoice("rgb")}>True colour</button><button type="button" aria-pressed={imageChoice === "water"} onClick={() => setImageChoice("water")}>Water masks</button></div></div>
        <div><p className="nisar-evidence-control-label">Comparison map</p><div className="nisar-channel-buttons" role="group" aria-label="Reference comparison map"><button type="button" aria-pressed={mapChoice === "agreement"} onClick={() => setMapChoice("agreement")}>Agreement</button><button type="button" aria-pressed={mapChoice === "coverage"} onClick={() => setMapChoice("coverage")}>Clear coverage</button><button type="button" aria-pressed={mapChoice === "overlay"} onClick={() => setMapChoice("overlay")}>Radar on optical</button></div></div>
        <div><p className="nisar-evidence-control-label">Radar view in swipe</p><div className="nisar-channel-buttons" role="group" aria-label="NISAR polarization for the swipe"><button type="button" aria-pressed={curtainChannel === "hh"} onClick={() => setCurtainChannel("hh")}>HH · HHHH</button><button type="button" aria-pressed={curtainChannel === "hv"} onClick={() => setCurtainChannel("hv")}>HV · HVHV</button></div></div>
      </div>
      {radarError ? <p className="nisar-tool-hint" role="status">The optical comparison is available, but its matching radar preview could not be loaded: {radarError}</p>
        : !radarLayer ? <p className="nisar-tool-hint" role="status">Loading the matching NISAR image for {radarDate}…</p>
          : !sameBounds(visuals.bounds, radarLayer.bounds) ? <p className="nisar-tool-hint" role="status">The saved optical and radar previews do not share a verified map extent, so the aligned swipe is unavailable.</p>
            : <SensorCurtain
              title="Optical vs radar · same study footprint"
              description="Slide across a registered HLS optical image and NISAR backscatter preview. Clouds and QA exclusions remain visible; radar uses microwave measurements and does not depend on sunlight or a cloud-free view."
              left={{
                label: imageChoice === "rgb" ? `NASA HLS · ${opticalSensor} true colour` : `NASA HLS · ${opticalSensor} water + QA`,
                date: afterDate ?? "Date unavailable",
                src: artifact(visuals.images[`after_${imageChoice}`]),
                alt: imageChoice === "rgb" ? `NASA HLS true-colour image from ${afterDate}; clouds are visible and masked pixels are unassessed.` : `NASA HLS water-index screen from ${afterDate}; grey pixels are excluded by quality screening and remain unassessed.`,
              }}
              right={{
                label: `NISAR L2 GCOV · ${curtainChannel.toUpperCase()} after`,
                date: radarDate ?? current.event_date,
                src: artifact(radarLayer.images.after),
                alt: `NISAR ${curtainChannel.toUpperCase()} backscatter in decibels on ${current.event_date}; transparent pixels are invalid or unavailable. Amber outlines mark radar-change candidates.`,
              }}
              rightOverlaySrc={artifact(visuals.images.candidate_overlay)}
              rightOverlayAlt="Amber outlines show exploratory radar-change candidates; they are not confirmed flood boundaries."
              alignment="registered"
              imageFit="fill"
              aspectRatio={`${visuals.width} / ${visuals.height}`}
              tone="dark"
              note={`Optical image date: ${afterDate ?? "not recorded"}. NISAR observation date: ${radarDate ?? current.event_date}${opticalOffsetDays === 0 ? " (same day)" : ` (${Math.abs(opticalOffsetDays)} days ${opticalOffsetDays < 0 ? "before" : "after"} the optical image)`}. ${curtainChannel.toUpperCase()} backscatter display scale: ${radarLayer.scale_db[0]} to ${radarLayer.scale_db[1]} dB. Only ${precisePercentage(coverage)} of the study area had common clear optical and valid radar coverage for this pair; ${coverage != null && coverage < 0.2 ? "the check is inconclusive and the remaining area is unassessed." : "see the QA layer for excluded pixels."} Amber outlines are exploratory detector candidates, not independently confirmed flood boundaries.`}
            />}
      <div className="nisar-evidence-metrics" aria-label="Selected comparison summary"><div><strong>{percentage(coverage)}</strong><span>study area comparable</span></div><div><strong>{percentage(candidateCoverage)}</strong><span>{opticalSupport ? "candidate area assessed in HLS footprint" : "radar-grid candidate cells assessed"}</span></div><div><strong>{comparisonUsable ? metrics.matching_pixels.toLocaleString() : "—"}</strong><span>{comparisonUsable ? "matched radar-grid cells · legacy" : "comparison insufficient"}</span></div><div><strong>{comparisonUsable ? percentage(metrics.f1) : "—"}</strong><span>{comparisonUsable ? "legacy grid F1" : "F1 not reported"}</span></div></div>
      {opticalSupport ? <div className="nisar-evidence-finding"><strong>Native 30 m HLS comparison · area-weighted</strong><p>{opticalSupport.common_clear_area_km2.toFixed(2)} km² of clear, valid radar support was comparable ({percentage(opticalSupport.common_clear_fraction)} of the study area). {comparisonUsable ? `The area-weighted scores are TP ${opticalSupport.true_positive_area_km2.toFixed(4)} km², radar-only ${opticalSupport.false_positive_area_km2.toFixed(4)} km², and optical-only ${opticalSupport.false_negative_area_km2.toFixed(4)} km². Precision ${percentage(opticalSupport.precision)} · recall ${percentage(opticalSupport.recall)} · F1 ${percentage(opticalSupport.f1)}.` : "Coverage is below the required minimum, so precision, recall and F1 are not interpreted."}</p><p>{opticalSupport.support}. The radar-grid cell counts above are retained only to reproduce the earlier comparison.</p></div>
        : <p className="nisar-tool-hint">This saved evidence predates native 30 m area scoring. Rebuild optical evidence after updating the pipeline to calculate it; legacy radar-grid counts are not independent HLS samples.</p>}
      <p className="nisar-tool-hint">NISAR baseline: <strong>{(current.comparison.baseline.nisar_observation_dates ?? current.baseline_method?.baseline_observation_dates ?? [current.baseline_date]).join(", ")}</strong> → <strong>{current.event_date}</strong>. Optical dates: <strong>{beforeDate} → {afterDate}</strong>. {current.comparison.baseline.nisar_method ? `Radar baseline method: ${current.comparison.baseline.nisar_method}. ` : ""}{alternative ? "This closer-date audit is separate from the published maximum-coverage comparison." : `The later optical image is ${Math.abs(current.comparison.event.offset_days)} day(s) from the later radar image.`}</p>
      <div className="nisar-radar-grid">
        {(["before", "after"] as const).map((stage) => <figure key={stage}><figcaption><strong>Optical {stage}</strong><span>{stage === "before" ? beforeDate : afterDate}</span></figcaption><a href={artifact(visuals.images[`${stage}_${imageChoice}`])} target="_blank" rel="noreferrer" aria-label={`Open full optical ${stage} ${imageChoice === "rgb" ? "true colour" : "water mask"} image`}>
          {/* Scientific display artifacts share an exact extent and explicit scales. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artifact(visuals.images[`${stage}_${imageChoice}`])} width={visuals.width} height={visuals.height} alt={`Measured HLS ${imageChoice === "rgb" ? "true colour" : "MNDWI water mask"} for ${stage === "before" ? beforeDate : afterDate}. ${imageChoice === "water" ? "Turquoise is water; grey is excluded; dark is clear non-water." : "Clouds remain visible; excluded areas must be checked in the coverage map."}`} /></a></figure>)}
        <figure><figcaption><strong>{mapChoice === "overlay" ? "Radar candidates on optical" : mapChoice === "coverage" ? "Comparable area" : "Where results differ"}</strong><span>{mapChoice === "overlay" ? current.event_date : "Same study extent"}</span></figcaption><div className="nisar-reference-image-stack">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artifact(visuals.images[mapChoice === "overlay" ? "after_rgb" : mapChoice])} width={visuals.width} height={visuals.height} alt={mapChoice === "coverage" ? "Turquoise shows common clear coverage; grey shows unassessed area." : mapChoice === "agreement" ? "Agreement map: turquoise is matching change, amber radar-only, violet optical-only, dark neither, grey unassessed." : `Optical image for ${afterDate} underneath radar candidates from ${current.event_date}.`} />
          {mapChoice === "overlay" && <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="nisar-reference-overlay" src={artifact(visuals.images.candidate_overlay)} width={visuals.width} height={visuals.height} style={{ opacity: opacity/100 }} alt="Amber radar candidate overlay; these are exploratory changes, not confirmed floods." />
          </>}
        </div>{mapChoice === "overlay" && <label>Radar overlay opacity · {opacity}%<input type="range" min="0" max="100" step="5" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label>}<a className="nisar-download" href={artifact(visuals.images[mapChoice === "overlay" ? "candidate_overlay" : mapChoice])} target="_blank" rel="noreferrer">Open full comparison image ↗</a></figure>
      </div>
      <ul className="nisar-evidence-legend" aria-label="Evidence map legend">{(mapChoice === "coverage" ? [{ value: 1, label: "Common clear area", color: "#48dec6" }, { value: 2, label: "Unassessed area", color: "#7c8b9e" }] : mapChoice === "overlay" ? [{ value: 3, label: "All radar candidates · includes unassessed areas", color: "#ffb54c" }] : visuals.legend).map((item) => <li key={item.value}><span style={{ backgroundColor: item.color }} aria-hidden="true" />{item.label}</li>)}</ul>
      <p className="nisar-tool-hint">{imageChoice === "rgb" ? visuals.rgb_display : `Water masks use MNDWI > ${current.comparison.mndwi_threshold.toFixed(2)} after QA exclusion. Turquoise = water, dark = clear non-water, grey = excluded. Water on both dates is not evidence of new flooding.`} {visuals.display_note}</p>
      {comparisonUsable && <div className="nisar-evidence-audit-grid"><article><h3>Why the primary comparison disagrees</h3><div className="nisar-evidence-table-scroll"><table><thead><tr><th scope="col">Radar-only pixels in HLS</th><th scope="col">Pixels</th><th scope="col">Area</th></tr></thead><tbody>{current.radar_only_categories.map((item) => <tr key={item.key}><th scope="row">{categoryNames[item.key] || item.key}</th><td>{item.pixels.toLocaleString()}</td><td>{item.area_km2.toFixed(4)} km²</td></tr>)}</tbody></table></div><p>{current.candidate_coverage.unassessed_pixels.toLocaleString()} candidate pixels are unassessed by the primary reference. Their status remains unknown.</p></article>
        <article><h3>Checks on the disagreement</h3><ul><li>Rebuilt optical bands reproduce the published counts: <strong>{current.counts_reproduced ? "yes" : "no"}</strong>.</li><li>Nearest-neighbour MNDWI resampling: <strong>{current.resampling_audit.metrics.matching_pixels} matching pixels</strong>.</li><li>Radar-only pixels within {current.proximity_audit.radius_m} m of optical new water: <strong>{current.proximity_audit.radar_only_pixels_near_optical_change}</strong>. Proximity does not establish a registration error.</li>{current.alternate_date_check && <li>Closer {current.alternate_date_check.event_date} reference: <strong>{current.alternate_date_check.metrics.matching_pixels} matching pixels</strong> with {percentage(current.alternate_date_check.common_clear_fraction)} clear study coverage.</li>}</ul><p>{current.detector_audit.quality_limitation}</p></article></div>}
      {comparisonUsable && <details><summary>Candidate-by-candidate context · primary reference</summary><div className="nisar-evidence-table-scroll"><table><thead><tr><th scope="col">Candidate</th><th scope="col">Clear coverage</th><th scope="col">Matching new water</th><th scope="col">Already water</th></tr></thead><tbody>{current.patch_context.map((item) => <tr key={item.id}><th scope="row">{item.id.replace("wetland_patch_", "")}</th><td>{percentage(item.clear_fraction)}</td><td>{item.matching_new_water_pixels} pixels</td><td>{item.water_on_both_optical_dates_pixels} pixels</td></tr>)}</tbody></table></div></details>}
      <details><summary>Sources, methods and limits</summary><p>Before: {alternative?.baseline_scene || current.comparison.baseline.scene}</p><p>After: {alternative?.event_scene || current.comparison.event.scene}</p>{alternative && <p>{alternative.method}</p>}<ul>{current.limitations.map((item) => <li key={item}>{item}</li>)}</ul><p>Extent: {visuals.bounds.map((point) => point.map((n) => n.toFixed(5)).join(", ")).join(" → ")} (latitude, longitude).</p></details>
      <div className="nisar-tool-actions"><a className="nisar-download" href={artifact("reference_evidence.json", true)}>Download investigation</a>{!publicClient && <><a className="nisar-download" href={artifact(`${alternative ? "reference_alternate" : "reference"}_agreement.tif`, true)}>Download agreement GeoTIFF</a><a className="nisar-download" href={artifact(`${alternative ? "reference_alternate" : "reference"}_before_mndwi.tif`, true)}>Download before MNDWI</a><a className="nisar-download" href={artifact(`${alternative ? "reference_alternate" : "reference"}_after_mndwi.tif`, true)}>Download after MNDWI</a></>}</div>
      {publicClient && <p className="nisar-tool-hint">GeoTIFF rasters are part of the local study package and are not included in this web release; the PNG comparison images above are the published versions.</p>}
    </>}
  </section>;
}



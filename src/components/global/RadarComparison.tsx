"use client";
import { publicClient } from "@/lib/app-mode";
import { useEffect, useState } from "react";

type Preview = { run_id: string; date: string; baseline_date: string; baseline_scene: string; baseline_observation_dates?: string[];
  baseline_method?: { baseline_method?: string; baseline_observation_count?: number; baseline_observation_dates?: string[]; baseline_scene_names?: string[]; baseline_hh_temporal_mad_db?: number | null };
  event_scene: string; note: string;
  patches_file?: string; classification_file?: string;
  layers: Record<string, { images: Record<string, string>; scale_db: number[]; change_scale_db: number[]; source_rasters: Record<string, string>; bounds: number[][]; width: number; height: number }> };

export default function RadarComparison({ runId, date, refreshKey }: { runId: string; date: string; refreshKey: number }) {
  const [channel, setChannel] = useState("hh");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/wetland/radar?run=${runId}&date=${date}`, { signal: controller.signal })
      .then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.error || "Radar previews unavailable."); return value as Preview; })
      .then((value) => { setPreview(value); setError(""); })
      .catch((reason) => { if (!controller.signal.aborted) { setPreview(null); setError(reason.message); } });
    return () => controller.abort();
  }, [runId, date, refreshKey]);
  const current = preview?.run_id === runId && preview?.date === date ? preview : null;
  const layer = current?.layers[channel];
  const baselineDates = current?.baseline_observation_dates ?? [current?.baseline_date ?? "Baseline"];
  const baselineLabel = baselineDates.length > 1 ? `Median of ${baselineDates.length} observations · ${baselineDates[0]}–${baselineDates.at(-1)}` : baselineDates[0];
  const artifact = (file: string, download = false) => `/api/wetland/artifact?run=${runId}&file=${encodeURIComponent(file)}${download ? "&download=1" : ""}`;
  return <section className="nisar-tools-section" id="nisar-radar" aria-labelledby="nisar-radar-title">
    <div className="nisar-tools-heading"><div><p className="global-eyebrow">ACTUAL DETECTOR INPUTS</p><h2 id="nisar-radar-title">Baseline, after and radar change</h2><p>{baselineLabel} → {date} · measured NISAR GCOV power in dB</p></div>
      <div className="nisar-channel-buttons" role="group" aria-label="Radar polarization">{["hh", "hv"].map((pol) => <button type="button" key={pol} aria-pressed={channel === pol} onClick={() => setChannel(pol)}>{pol.toUpperCase()} · {pol === "hh" ? "HHHH" : "HVHV"}</button>)}</div></div>
    {error ? <p className="nisar-tool-error" role="alert">{error} {publicClient ? "Ask the operator to publish the missing radar previews." : "Use Prepare radar images in the processing panel to render this saved run."}</p> : !layer ? <p role="status">Loading radar evidence…</p> : <>
      <div className="nisar-radar-grid">{["before", "after", "change"].map((stage) => <figure key={stage}>
        <figcaption><strong>{stage === "change" ? "After − baseline" : stage === "before" ? "Baseline" : "After"}</strong><span>{stage === "before" ? baselineLabel : stage === "after" ? date : "Change in dB"}</span></figcaption>
        <a href={artifact(layer.images[stage])} target="_blank" rel="noreferrer" aria-label={`Open full ${channel.toUpperCase()} ${stage} image`}>
          {/* Local scientific PNGs preserve the exact shared geographic extent. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artifact(layer.images[stage])} width={layer.width} height={layer.height} alt={`Real NISAR ${channel.toUpperCase()} ${stage} for ${current?.baseline_date} to ${date}; transparent pixels are excluded.`} />
        </a>
        <div className={`nisar-radar-scale ${stage === "change" ? "nisar-radar-scale--change" : ""}`} aria-label={stage === "change" ? "Blue means lower return, red means higher return" : "Shared radar brightness scale"} />
        <div className="nisar-scale-labels"><span>{(stage === "change" ? layer.change_scale_db : layer.scale_db)[0]} dB</span><span>{stage === "change" ? "0" : "same scale"}</span><span>{(stage === "change" ? layer.change_scale_db : layer.scale_db)[1]} dB</span></div>
        {stage !== "change" && !publicClient && <a className="nisar-download" href={artifact(layer.source_rasters[stage], true)}>Download {stage} {channel.toUpperCase()} GeoTIFF</a>}
      </figure>)}</div>
      <p className="nisar-tool-hint">{current?.note} Blue change means a weaker return; red means a stronger return. These patterns alone do not prove flooding.</p>
      {publicClient && <p className="nisar-tool-hint">GeoTIFF rasters are part of the local study package and are not included in this web release; the PNG previews above and the GeoJSON download below are the published versions.</p>}
      <details className="nisar-scene-details"><summary>Input scenes and geographic extent</summary><p>Baseline method: {current?.baseline_method?.baseline_method === "PER_PIXEL_MEDIAN" ? "Per-pixel median of all earlier acquisitions" : "Single preceding acquisition"}.</p><p>Baseline dates: {baselineDates.join(", ")}</p><p>Baseline scenes: {(current?.baseline_method?.baseline_scene_names ?? [current?.baseline_scene]).filter(Boolean).join(", ") || "Not recorded"}</p><p>After scene: {current?.event_scene}</p><p>Extent: {layer.bounds.map((point) => point.map((n) => n.toFixed(5)).join(", ")).join(" → ")} (latitude, longitude)</p></details>
      <div className="nisar-tool-actions">{current?.patches_file && <a className="nisar-download" href={artifact(current.patches_file, true)}>Download candidate GeoJSON</a>}{current?.classification_file && !publicClient && <a className="nisar-download" href={artifact(current.classification_file, true)}>Download classification GeoTIFF</a>}<a className="nisar-download" href={artifact("case_study.json", true)}>Download case evidence</a></div>
    </>}
  </section>;
}

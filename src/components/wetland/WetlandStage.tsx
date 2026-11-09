"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Pane, Polygon, Tooltip, GeoJSON as LeafletGeoJSON, ImageOverlay, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useWetlandStore } from "@/lib/store";
import { MAP_CONFIG } from "@/lib/constants";
import { geometryContains, loadShowcaseRadar, type RadarPreview } from "@/lib/showcase";
import { fmtDate } from "@/lib/story";
import type { ProbeResult, WetlandGeometry, WetlandPatch } from "@/lib/types";

type LatLng = [number, number];
const ring = (r: number[][]): LatLng[] => r.map(([lng, lat]) => [lat, lng]);
function positions(p: WetlandPatch): LatLng[] | LatLng[][] | LatLng[][][] {
  if (!p.geometry) return [];
  return p.geometry.type === "Polygon" ? p.geometry.coordinates.map(ring) : p.geometry.coordinates.map((poly) => poly.map(ring));
}
function points(g: WetlandGeometry): LatLng[] {
  const out: LatLng[] = [];
  const visit = (v: unknown) => { if (!Array.isArray(v)) return; if (typeof v[0] === "number") out.push([v[1] as number, v[0] as number]); else v.forEach(visit); };
  visit(g.coordinates); return out;
}

/** Uncertainty is encoded in the map itself: solid = rules agree, light = partial, hatched = uncertain. */
function treatment(p: WetlandPatch) {
  if (p.evidence_state === "SUPPORTED") return { cls: "wx-patch wx-patch--strong", fill: 0.55, weight: 2, dash: undefined as string | undefined };
  if (p.evidence_state === "MODERATE") return { cls: "wx-patch wx-patch--moderate", fill: 0.28, weight: 1.5, dash: undefined };
  return { cls: "wx-patch wx-patch--uncertain", fill: 0.35, weight: 1.2, dash: "3 4" };
}

function FitView() {
  const map = useMap();
  const { patches, pulseData, siteBoundary, pipelineRunId } = useWetlandStore();
  const key = pipelineRunId ?? "none";
  const fitted = useRef<string | null>(null);

  // Fit only when the container has a real size (the grid layout can report 0 on first paint), once per case.
  const fit = React.useCallback(() => {
    if (fitted.current === key) return;
    const size = map.getSize(); if (size.x < 50 || size.y < 50) return;
    const { patches: ps, pulseData: pd, siteBoundary: sb } = useWetlandStore.getState();
    const pad = { paddingTopLeft: [24, 72] as [number, number], paddingBottomRight: [64, 24] as [number, number] };
    const b = pd?.site_bounds;
    if (b && b.length === 4 && b.every(Number.isFinite)) { map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { ...pad, maxZoom: 13, animate: false }); fitted.current = key; return; }
    const bpts = sb?.features.flatMap((f) => points(f.geometry)) ?? [];
    const pts = bpts.length ? bpts : ps.flatMap((p) => (p.geometry ? points(p.geometry) : [p.centroid]));
    if (pts.length) { map.fitBounds(pts, { ...pad, maxZoom: 13, animate: false }); fitted.current = key; }
  }, [map, key]);

  useEffect(() => {
    const ro = new ResizeObserver(() => { map.invalidateSize({ pan: false }); fit(); });
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map, fit]);
  useEffect(() => { map.invalidateSize({ pan: false }); fit(); }, [map, fit, patches, pulseData, siteBoundary]);
  return null;
}

function SplitClip({ position, paneName = "wxAfter" }: { position: number; paneName?: string }) {
  const map = useMap();
  const update = () => {
    const pane = map.getPane(paneName); if (!pane) return;
    const o = map.containerPointToLayerPoint([0, 0]); const s = map.getSize();
    const x = o.x + (s.x * position) / 100;
    pane.style.clipPath = `polygon(${x}px ${o.y}px, ${o.x + s.x}px ${o.y}px, ${o.x + s.x}px ${o.y + s.y}px, ${x}px ${o.y + s.y}px)`;
  };
  useMapEvents({ move: update, zoomend: update, resize: update });
  useEffect(update, [map, position, paneName]);
  return null;
}

function DetectiveClicks() {
  const probeActive = useWetlandStore((s) => s.probeActive);
  const setProbeResult = useWetlandStore((s) => s.setProbeResult);
  useMapEvents({
    async click(e) {
      if (!probeActive) return;
      const { lat, lng } = e.latlng; const s = useWetlandStore.getState();
      const date = s.pulseData?.dates[s.selectedDateIndex]?.date ?? "";
      if (s.dataTier === "LOCAL_RUN") {
        try {
          const res = await fetch(`/api/wetland/probe?lat=${lat}&lng=${lng}&date=${encodeURIComponent(date)}`);
          if (!res.ok) return;
          const data = await res.json() as ProbeResult;
          if (data.run_id === useWetlandStore.getState().pipelineRunId && data.acquisition_date === date) setProbeResult({ ...data, resolution: "PIXEL" });
        } catch { /* probe unavailable */ }
        return;
      }
      const hit = s.patches.find((p) => (p.geometry ? geometryContains(p.geometry, lng, lat) : false));
      setProbeResult({ lat, lng, hh_before: hit?.hh_before ?? null, hh_after: hit?.hh_after ?? null, hv_before: hit?.hv_before ?? null,
        hv_after: hit?.hv_after ?? null, delta_hh: hit?.delta_hh ?? null, delta_hv: hit?.delta_hv ?? null, valid: !!hit, acquisition_date: date,
        land_cover: hit ? "Region-average within a candidate polygon" : "Outside candidate regions — no detector result here (not 'unchanged')",
        classification: hit?.classification ?? "UNCERTAIN", data_source: "NISAR", resolution: "REGION", region_id: hit?.id ?? null });
    },
  });
  return null;
}

function RadarOverlay({ onPreviewUnavailable, onImageFailure, split }: {
  onPreviewUnavailable: (unavailable: boolean) => void;
  onImageFailure: (failed: boolean) => void;
  split: number;
}) {
  const { dataTier, pipelineRunId, pulseData, selectedDateIndex, radarChannel, radarOpacity, showcaseId, showcase, mapMode } = useWetlandStore();
  const date = pulseData?.dates[selectedDateIndex]?.date;
  const key = `${dataTier}:${pipelineRunId}:${showcaseId}:${date}`;
  const [loaded, setLoaded] = useState<{ key: string; preview: RadarPreview | null } | null>(null);
  const preview = loaded?.key === key ? loaded.preview : null;
  useEffect(() => {
    let live = true;
    onPreviewUnavailable(false);
    onImageFailure(false);
    if (!date) {
      onPreviewUnavailable(true);
      return () => { live = false; };
    }
    const load = dataTier === "SHOWCASE" ? loadShowcaseRadar(date, showcaseId, showcase?.manifest)
      : fetch(`/api/wetland/radar?run=${pipelineRunId}&date=${date}`).then((r) => r.ok ? r.json() as Promise<RadarPreview> : null)
        .then((v) => { if (v) for (const l of Object.values(v.layers)) l.images = Object.fromEntries(Object.entries(l.images).map(([k, f]) => [k, `/api/wetland/artifact?run=${pipelineRunId}&file=${encodeURIComponent(f)}`])); return v; }).catch(() => null);
    void load.then((v) => {
      if (!live) return;
      setLoaded({ key, preview: v });
      onPreviewUnavailable(!v);
      onImageFailure(false);
    });
    return () => { live = false; };
  }, [date, dataTier, pipelineRunId, showcaseId, showcase?.manifest, key, onPreviewUnavailable, onImageFailure]);
  const layer = preview?.layers[radarChannel];
  const beforeUrl = layer?.images.before;
  const afterUrl = layer?.images.after;
  const imageUrl = mapMode === "BEFORE" ? beforeUrl : mapMode === "AFTER" ? afterUrl : layer?.images.change;
  useEffect(() => {
    onImageFailure(false);
  }, [imageUrl, beforeUrl, afterUrl, onImageFailure]);
  if (!layer) return null;
  if (mapMode === "SPLIT") {
    if (!beforeUrl || !afterUrl) return null;
    return <>
      <Pane name="wxRadarBefore" style={{ zIndex: 380 }}>
        <ImageOverlay url={beforeUrl} bounds={layer.bounds as LatLngBoundsExpression} opacity={radarOpacity}
          eventHandlers={{ error: () => onImageFailure(true), load: () => onImageFailure(false) }} />
      </Pane>
      <Pane name="wxRadarAfter" style={{ zIndex: 381 }}>
        <ImageOverlay url={afterUrl} bounds={layer.bounds as LatLngBoundsExpression} opacity={radarOpacity}
          eventHandlers={{ error: () => onImageFailure(true), load: () => onImageFailure(false) }} />
      </Pane>
      <SplitClip position={split} paneName="wxRadarAfter" />
    </>;
  }
  if (!imageUrl) return null;
  return <Pane name="wxRadar" style={{ zIndex: 380 }}>
    <ImageOverlay
      url={imageUrl}
      bounds={layer.bounds as LatLngBoundsExpression}
      opacity={radarOpacity}
      eventHandlers={{
        error: () => onImageFailure(true),
        load: () => onImageFailure(false),
      }}
    />
  </Pane>;
}

function PatchLayer({ list, interactive, dim }: { list: WetlandPatch[]; interactive: boolean; dim: boolean }) {
  const { selectedPatch, setSelectedPatch, setDrawer, vegFilter, viewMode, pulseData, selectedDateIndex, probeActive } = useWetlandStore();
  const isPeak = pulseData?.dates[selectedDateIndex]?.date === pulseData?.peak.date;
  const shown = useMemo(() => (vegFilter === "ALL" ? list : list.filter((p) => p.classification === vegFilter)), [list, vegFilter]);
  // Hundreds of SVG regions must not each be a Tab stop. Keyboard users select regions from the investigation panel list instead.
  useEffect(() => { document.querySelectorAll(".wx-patch").forEach((el) => el.setAttribute("tabindex", "-1")); });
  const hue = (p: WetlandPatch) => viewMode === "DETECTION" ? (p.classification === "OPEN_WATER" ? "#F2A45A" : p.classification === "VEGETATED_INUNDATION" ? "#F7D2A6" : "#8996A0") : "#F2A45A";
  return <>{shown.map((p) => {
    const t = treatment(p); const sel = selectedPatch?.id === p.id; const color = sel ? "#F0F3F2" : hue(p);
    return <Polygon key={`${p.id}-${p.date}`} positions={positions(p)}
      className={`${t.cls}${isPeak && !dim ? " wx-patch--peak" : ""}`}
      pathOptions={{ color, weight: sel ? 3 : t.weight, fillColor: hue(p), fillOpacity: (dim && !sel ? 0.1 : t.fill), dashArray: t.dash }}
      interactive={interactive}
      eventHandlers={interactive ? { click: () => { if (!probeActive) { setSelectedPatch(p); setDrawer("EXPLORE"); } } } : undefined}>
      {interactive && <Tooltip sticky direction="top" className="wx-tip">{`Region ${p.id.replace(/^wetland_patch_/, "").slice(0, 6)}`} · {p.area_km2.toFixed(3)} km²</Tooltip>}
    </Polygon>;
  })}</>;
}

export default function WetlandStage() {
  const { patches, lock, viewMode, mapMode, selectedDateIndex, satelliteBasemap, siteBoundary, selectedPatch, pulseData, probeResult, probeActive } = useWetlandStore();
  const [split, setSplit] = useState(50);
  const [basemapReady, setBasemapReady] = useState(false);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [radarPreviewUnavailable, setRadarPreviewUnavailable] = useState(false);
  const [radarImageFailed, setRadarImageFailed] = useState(false);
  const handleRadarPreviewUnavailable = useCallback((unavailable: boolean) => setRadarPreviewUnavailable(unavailable), []);
  const handleRadarImageFailure = useCallback((failed: boolean) => setRadarImageFailed(failed), []);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  useEffect(() => {
    const move = (e: PointerEvent) => { if (!drag.current || !wrap.current) return; const r = wrap.current.getBoundingClientRect(); setSplit(Math.max(2, Math.min(98, ((e.clientX - r.left) / r.width) * 100))); };
    const up = () => { drag.current = false; };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);
  const dimOthers = viewMode === "EXPLAIN" && !!selectedPatch;
  const dates = pulseData?.dates ?? [];
  const isRadarSplit = viewMode === "RADAR" && mapMode === "SPLIT";
  return (
    <div className="wx-stage" ref={wrap}>
      <MapContainer center={MAP_CONFIG.center} zoom={11} minZoom={5} maxZoom={17} zoomControl={false} style={{ width: "100%", height: "100%" }}>
        <FitView />
        <ZoomControl position="bottomleft" />
        {satelliteBasemap && <TileLayer
          url={MAP_CONFIG.tileUrl}
          attribution={MAP_CONFIG.tileAttribution}
          eventHandlers={{
            tileload: () => { setBasemapReady(true); setBasemapFailed(false); },
            tileerror: () => { setBasemapFailed(true); },
          }}
        />}
        {viewMode === "RADAR" && <RadarOverlay
          onPreviewUnavailable={handleRadarPreviewUnavailable}
          onImageFailure={handleRadarImageFailure}
          split={split}
        />}
        {siteBoundary && <Pane name="wxBoundary" style={{ zIndex: 420 }}><LeafletGeoJSON data={siteBoundary} interactive={false} style={{ color: "#5AC8D8", weight: 1.5, opacity: 0.9, fillOpacity: 0, dashArray: "6 5" }} /></Pane>}
        {lock ? <>
          <Pane name="wxBefore" style={{ zIndex: 400 }}><PatchLayer list={lock.before} interactive={false} dim={false} /></Pane>
          <Pane name="wxAfter" style={{ zIndex: 401 }}><PatchLayer list={lock.after} interactive={false} dim={false} /></Pane>
          <SplitClip position={split} />
        </> : <Pane name="wxPatches" style={{ zIndex: 400 }}><PatchLayer list={patches} interactive dim={dimOthers} /></Pane>}
        <DetectiveClicks />
      </MapContainer>

      {satelliteBasemap && (!basemapReady || basemapFailed) && <div className={`wx-basemap-status${basemapFailed ? " is-error" : ""}`} role="status" aria-live="polite">
        {basemapFailed ? "Satellite imagery unavailable · radar layers remain visible" : "Loading satellite imagery…"}
      </div>}
      {viewMode === "RADAR" && radarPreviewUnavailable && (
        <div className="wx-radar-status is-error" role="status" aria-live="polite">
          Published radar preview unavailable for this date · candidate regions and study evidence remain available.
        </div>
      )}
      {viewMode === "RADAR" && radarImageFailed && (
        <div className="wx-radar-status is-error" role="status" aria-live="polite">
          Radar preview loaded but could not be drawn · try another date or layer. Candidate regions remain available.
        </div>
      )}

      {probeActive && probeResult && <div className="wx-crosshair-note" aria-hidden="true">{probeResult.lat.toFixed(4)}°, {probeResult.lng.toFixed(4)}°</div>}

      {(lock || isRadarSplit) && (
        <>
          <div className="wx-split" role="slider" tabIndex={0} aria-label={lock ? "Before and after divider" : "Radar baseline and after divider"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split)}
            style={{ left: `${split}%` }}
            onPointerDown={(e) => { drag.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
            onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); setSplit((v) => Math.max(2, v - 4)); } if (e.key === "ArrowRight") { e.preventDefault(); setSplit((v) => Math.min(98, v + 4)); } if (e.key === "Home") setSplit(2); if (e.key === "End") setSplit(98); }}>
            <span className="wx-split__grip" />
          </div>
          {lock ? <>
            <div className="wx-split-label wx-split-label--l"><small>Before · candidate regions</small>{fmtDate(dates[lock.beforeIndex]?.date ?? "", { month: "short", day: "numeric", year: "numeric" })}</div>
            <div className="wx-split-label wx-split-label--r"><small>After · candidate regions</small>{fmtDate(dates[lock.afterIndex]?.date ?? "", { month: "short", day: "numeric", year: "numeric" })}</div>
          </> : <>
            <div className="wx-split-label wx-split-label--l"><small>Before · baseline median</small>Earlier observations</div>
            <div className="wx-split-label wx-split-label--r"><small>After · selected acquisition</small>{fmtDate(dates[selectedDateIndex]?.date ?? "", { month: "short", day: "numeric", year: "numeric" })}</div>
          </>}
        </>
      )}
    </div>
  );
}

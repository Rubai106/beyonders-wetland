"use client";

// @refresh reset

import { useEffect, useRef, useState } from "react";
import {
  GeoJSON as LeafletGeoJSON,
  MapContainer,
  TileLayer,
  ZoomControl,
  CircleMarker,
  ImageOverlay,
  Popup,
  Polyline,
  useMap,
  useMapEvents,
  Rectangle,
} from "react-leaflet";
import type { Feature, FeatureCollection, Geometry, MultiPolygon } from "geojson";
import type { PathOptions } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MAP_CONFIG } from "@/lib/constants";
import type { ViewMode } from "@/lib/store";
import GlobalWorldBounds, { getGlobalWorldZoom, WORLD_BOUNDS } from "./GlobalWorldBounds";
import type { AreaBounds } from "./NisarProcessingPanel";
import type { OpticalRadarMapLayer } from "./useMapOpticalRadarComparison";

export type DetectionProperties = {
  id?: string;
  classification?: string;
  area_km2?: number;
  date?: string;
  pixel_count?: number;
  mean_delta_db?: number;
  delta_hh?: number;
  delta_hv?: number;
  hh_before?: number;
  hh_after?: number;
  hv_before?: number;
  hv_after?: number;
  valid_fraction?: number;
  valid_fraction_scope?: string;
  quality_status?: string;
  spatial_status?: string;
  temporal_status?: string;
  threshold_stability?: string;
  temporal_overlap_fraction?: number | null;
  evidence_state?: string;
  method_version?: string;
};

export type DetectionCollection = FeatureCollection<Geometry, DetectionProperties>;
export type BoundaryCollection = FeatureCollection<Geometry, Record<string, unknown>>;
export type CoverageProperties = {
  sceneId: string;
  orbitDirection: string;
  trackNumber: string;
  acquisitionStart: string | null;
  acquisitionEnd: string | null;
};
export type CoverageCollection = FeatureCollection<MultiPolygon, CoverageProperties>;
export type LocalRadarMapLayer = {
  imageUrl: string;
  bounds: [[number, number], [number, number]];
  channel: "hh" | "hv";
  stage: "before" | "after" | "change";
  date: string;
};

type OpticalRadarComparisonLayer = OpticalRadarMapLayer & { position: number };

function OpticalRadarLayers({ layer }: { layer: OpticalRadarComparisonLayer }) {
  const radarRef = useRef<L.ImageOverlay>(null);
  const candidateRef = useRef<L.ImageOverlay>(null);
  const [[south, west], [north, east]] = layer.bounds;
  const dividerLongitude = west + (east - west) * (layer.position / 100);

  useEffect(() => {
    const clip = `inset(0 0 0 ${layer.position}%)`;
    const radarImage = radarRef.current?.getElement();
    if (radarImage) radarImage.style.clipPath = clip;
    const candidates = candidateRef.current?.getElement();
    if (candidates) candidates.style.clipPath = clip;
  }, [layer.position, layer.radarImageUrl, layer.candidateOverlayUrl]);

  return <>
    <ImageOverlay key={`comparison-optical-${layer.radarDate}-${layer.channel}`} url={layer.opticalImageUrl} bounds={layer.bounds} opacity={1} zIndex={450} />
    <ImageOverlay ref={radarRef} key={`comparison-radar-${layer.radarDate}-${layer.channel}`} url={layer.radarImageUrl} bounds={layer.bounds} opacity={1} zIndex={451} />
    {layer.candidateOverlayUrl && <ImageOverlay ref={candidateRef} key={`comparison-candidates-${layer.radarDate}`} url={layer.candidateOverlayUrl} bounds={layer.bounds} opacity={1} zIndex={452} />}
    <Polyline positions={[[south, dividerLongitude], [north, dividerLongitude]]} pathOptions={{ color: "#f5ffff", weight: 2, opacity: 0.95, interactive: false }} />
    <CircleMarker center={[(south + north) / 2, dividerLongitude]} radius={9}
      pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#11515b", fillOpacity: 1, interactive: false }} />
  </>;
}

function MapScope({
  detections,
  boundary,
  focusStudyArea,
  focusSelectedCandidate,
  coordinateTarget,
  selectedCandidateId,
}: {
  detections: DetectionCollection;
  boundary: BoundaryCollection | null;
  focusStudyArea: boolean;
  focusSelectedCandidate: boolean;
  coordinateTarget: { latitude: number; longitude: number } | null;
  selectedCandidateId: string | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (coordinateTarget) {
      map.flyTo([coordinateTarget.latitude, coordinateTarget.longitude], Math.max(map.getZoom(), 8), { duration: 1.2 });
      return;
    }
    if (!focusStudyArea) {
      map.setView([0, 0], getGlobalWorldZoom(map), { animate: false });
      return;
    }
    const layer = L.featureGroup();
    if (boundary?.features.length) layer.addLayer(L.geoJSON(boundary));
    if (detections.features.length) layer.addLayer(L.geoJSON(detections));
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12, animate: false });
  }, [boundary, coordinateTarget, detections, focusStudyArea, map]);

  useEffect(() => {
    // A coordinate handoff is an explicit map target. Do not let the
    // default candidate selection immediately pan away from that pin.
    if (coordinateTarget || !focusSelectedCandidate || !selectedCandidateId) return;
    const selected = detections.features.find((feature) => feature.properties.id === selectedCandidateId);
    if (!selected) return;
    const bounds = L.geoJSON(selected).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [44, 44], maxZoom: 12, animate: false });
  }, [coordinateTarget, detections, focusSelectedCandidate, map, selectedCandidateId]);

  return null;
}

function detectionStyle(feature: Feature<Geometry, DetectionProperties> | undefined, selectedCandidateId: string | null, viewMode: ViewMode): PathOptions {
  const classification = feature?.properties?.classification;
  const classColor = classification === "OPEN_WATER" ? "#F2A45A"
    : classification === "VEGETATED_INUNDATION" ? "#F7D2A6" : "#8996A0";
  const color = viewMode === "DETECTION" ? classColor : "#F2A45A";
  const selected = !!selectedCandidateId && feature?.properties?.id === selectedCandidateId;
  const dim = viewMode === "EXPLAIN" && !!selectedCandidateId && !selected;
  const evidence = feature?.properties?.evidence_state;
  const evidenceClass = evidence === "SUPPORTED" ? "wx-patch--strong" : evidence === "MODERATE" ? "wx-patch--moderate" : "wx-patch--uncertain";
  const opacity = evidence === "SUPPORTED" ? 0.55 : evidence === "MODERATE" ? 0.28 : 0.35;
  return {
    className: `wx-patch ${evidenceClass}`,
    color: selected ? "#F0F3F2" : color,
    fillColor: viewMode === "DETECTION" ? classColor : "#F2A45A",
    weight: selected ? 3 : evidence === "SUPPORTED" ? 2 : evidence === "MODERATE" ? 1.5 : 1.2,
    opacity: selected ? 1 : 0.95,
    fillOpacity: selected ? 0.55 : dim ? 0.1 : opacity,
    dashArray: evidence === "SUPPORTED" || evidence === "MODERATE" ? undefined : "3 4",
  };
}

function AreaPicker({ drawing, bounds, onSelected }: { drawing: boolean; bounds: AreaBounds | null; onSelected: (bounds: AreaBounds) => void }) {
  const corner = useRef<L.LatLng | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const map = useMapEvents({ click(event) {
    if (!drawing) return;
    if (!corner.current) {
      corner.current = event.latlng;
      marker.current = L.circleMarker(event.latlng, { radius: 6, color: "#ffffff", fillColor: "#ffbf69", fillOpacity: 1 }).addTo(map);
    } else {
      const first = corner.current;
      const second = event.latlng;
      if (Math.abs(first.lng-second.lng) < 0.00001 || Math.abs(first.lat-second.lat) < 0.00001) return;
      onSelected([Math.min(first.lng, second.lng), Math.min(first.lat, second.lat), Math.max(first.lng, second.lng), Math.max(first.lat, second.lat)]);
      marker.current?.remove(); corner.current = null;
    }
  } });
  useEffect(() => {
    map.getContainer().style.cursor = drawing ? "crosshair" : "";
    corner.current = null;
    return () => { marker.current?.remove(); corner.current = null; map.getContainer().style.cursor = ""; };
  }, [drawing, map]);
  useEffect(() => {
    if (bounds && bounds[0] < bounds[2] && bounds[1] < bounds[3]) map.fitBounds([[bounds[1], bounds[0]], [bounds[3], bounds[2]]], { padding: [30, 30], maxZoom: 12, animate: false });
  }, [bounds, map]);
  return bounds && bounds[0] < bounds[2] && bounds[1] < bounds[3] ? <Rectangle bounds={[[bounds[1], bounds[0]], [bounds[3], bounds[2]]]} pathOptions={{ color: "#ffbf69", weight: 2, fillOpacity: 0.08, dashArray: "7 4" }} interactive={false} /> : null;
}

export default function GlobalNisarDetectionMap({
  detections,
  boundary,
  coverage,
  date,
  focusStudyArea,
  focusSelectedCandidate,
  coordinateTarget,
  onLayerReady,
  onLayerError,
  resultKey,
  areaBounds,
  areaDrawing,
  onAreaSelected,
  selectedCandidateId,
  onCandidateSelect,
  showCandidates,
  showBasemap,
  showFootprints,
  showNisarMosaic,
  localRadarLayer,
  comparisonLayer,
  onLocalRadarReady,
  onLocalRadarError,
  viewMode,
}: {
  detections: DetectionCollection;
  boundary: BoundaryCollection | null;
  coverage: CoverageCollection;
  date: string | null;
  focusStudyArea: boolean;
  focusSelectedCandidate: boolean;
  coordinateTarget: { latitude: number; longitude: number } | null;
  onLayerReady: () => void;
  onLayerError: () => void;
  resultKey: string;
  areaBounds: AreaBounds | null;
  areaDrawing: boolean;
  onAreaSelected: (bounds: AreaBounds) => void;
  selectedCandidateId: string | null;
  onCandidateSelect: (candidateId: string) => void;
  showCandidates: boolean;
  showBasemap: boolean;
  showFootprints: boolean;
  showNisarMosaic: boolean;
  localRadarLayer: LocalRadarMapLayer | null;
  comparisonLayer: OpticalRadarComparisonLayer | null;
  onLocalRadarReady: () => void;
  onLocalRadarError: () => void;
  viewMode: ViewMode;
}) {
  const [basemapReady, setBasemapReady] = useState(false);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const timePath = date ? `${date}/` : "";
  const nisarTileUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/NISAR_L2_Geocoded_Polarimetric_Covariance/default/${timePath}GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`;

  return (
    <>
    <svg className="wx-defs" width="0" height="0" aria-hidden="true"><defs><pattern id="wx-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(242,164,90,.10)" /><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(242,164,90,.8)" strokeWidth="1.4" /></pattern></defs></svg>
    <MapContainer
      center={[0, 0]}
      zoom={2}
      minZoom={0}
      maxZoom={12}
      zoomSnap={0.25}
      maxBounds={L.latLngBounds([-85.05112878, -180], [85.05112878, 180])}
      maxBoundsViscosity={1}
      zoomControl={false}
      style={{ width: "100%", height: "100%", backgroundColor: "#071a22" }}
    >
      {showBasemap && <TileLayer
        url={MAP_CONFIG.tileUrl}
        attribution={MAP_CONFIG.tileAttribution}
        bounds={WORLD_BOUNDS}
        noWrap
        eventHandlers={{
          tileload: () => { setBasemapReady(true); setBasemapFailed(false); },
          tileerror: () => { setBasemapFailed(true); },
        }}
      />}
      {showNisarMosaic && <TileLayer
        key={`nisar-${date ?? "latest"}`}
        url={nisarTileUrl}
        attribution="NASA NISAR L2 GCOV via NASA GIBS"
        opacity={0.92}
        bounds={WORLD_BOUNDS}
        noWrap
        eventHandlers={{ tileload: onLayerReady, tileerror: onLayerError }}
      />}
      <GlobalWorldBounds />
      {localRadarLayer && <ImageOverlay
        key={`${localRadarLayer.date}-${localRadarLayer.channel}-${localRadarLayer.stage}`}
        url={localRadarLayer.imageUrl}
        bounds={localRadarLayer.bounds}
        opacity={0.88}
        eventHandlers={{ load: onLocalRadarReady, error: onLocalRadarError }}
      />}
      {comparisonLayer && <OpticalRadarLayers layer={comparisonLayer} />}
      {showFootprints && coverage.features.length > 0 && (
        <LeafletGeoJSON
          key={`coverage-${coverage.features[0]?.properties.sceneId}-${coverage.features.length}`}
          data={coverage}
          interactive={false}
          style={(feature) => {
            const properties = feature?.properties as CoverageProperties | undefined;
            const color = properties?.orbitDirection === "Descending" ? "#F2A45A" : "#5AC8D8";
            return { color, fillColor: color, weight: 0.7, opacity: 0.42, fillOpacity: 0.015 };
          }}
        />
      )}
      <ZoomControl position="topright" />
      <MapScope detections={detections} boundary={boundary} focusStudyArea={focusStudyArea} focusSelectedCandidate={focusSelectedCandidate && showCandidates} coordinateTarget={coordinateTarget} selectedCandidateId={selectedCandidateId} />
      {coordinateTarget && <CircleMarker
        center={[coordinateTarget.latitude, coordinateTarget.longitude]}
        radius={7}
        pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#ffbf69", fillOpacity: 1 }}
      >
        <Popup>
          Map location<br />
          {coordinateTarget.latitude.toFixed(5)}°, {coordinateTarget.longitude.toFixed(5)}°
        </Popup>
      </CircleMarker>}
      <AreaPicker drawing={areaDrawing} bounds={areaBounds} onSelected={onAreaSelected} />
      {boundary?.features.length ? (
        <LeafletGeoJSON
          key={`boundary-${resultKey}`}
          data={boundary}
          style={{ color: "#5AC8D8", weight: 1.5, opacity: 0.9, fillOpacity: 0, dashArray: "6 5" }}
        />
      ) : null}
      {showCandidates && detections.features.length ? <LeafletGeoJSON
        key={`detections-${resultKey}`}
        data={detections}
        style={(feature) => detectionStyle(feature, selectedCandidateId, viewMode)}
        onEachFeature={(feature, layer) => {
          const id = feature.properties.id;
          const area = feature.properties.area_km2;
          if (id) layer.bindTooltip(`Region ${id.replace(/^wetland_patch_/, "").slice(0, 6)}${typeof area === "number" ? ` · ${area.toFixed(3)} km²` : ""}`, { sticky: true, className: "wx-tip" });
          layer.on("click", (event: L.LeafletMouseEvent) => {
            event.originalEvent.stopPropagation();
            if (feature.properties.id) onCandidateSelect(feature.properties.id);
          });
        }}
      /> : null}
    </MapContainer>
    {showBasemap && (!basemapReady || basemapFailed) && <div className={`wx-basemap-status${basemapFailed ? " is-error" : ""}`} role="status" aria-live="polite">
      {basemapFailed ? "Satellite imagery unavailable · radar and study overlays remain visible" : "Loading satellite imagery…"}
    </div>}
    </>
  );
}

"use client";

import { useState } from "react";
import { CircleMarker, ImageOverlay, MapContainer, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

const BBOX = [32.929876552028816, -24.580062736193145, 33.0300246947909, -24.479975719648824];
const BOUNDS: LatLngBoundsExpression = [[BBOX[1], BBOX[0]], [BBOX[3], BBOX[2]]];
const HH_AFTER = "/studies/releases/2026.10.29-chokwe/runs/ec8fa5ee15ae41d1aa89f930f2b47e36/radar_00_hh_after.png";

function PickPoint({ onPick }: { onPick: (point: { lat: number; lon: number }) => void }) {
  useMapEvents({ click: event => onPick({ lat: event.latlng.lat, lon: event.latlng.lng }) });
  return null;
}

export default function ChokwePixelMap({ point, onPick }: {
  point: { lat: number; lon: number } | null;
  onPick: (point: { lat: number; lon: number }) => void;
}) {
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [radarFailed, setRadarFailed] = useState(false);
  return <div className="chokwe-pixel-map">
    <MapContainer bounds={BOUNDS} minZoom={10} maxZoom={17} maxBounds={BOUNDS} maxBoundsViscosity={0.75} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles © Esri, USGS, NOAA"
        noWrap
        eventHandlers={{
          tileerror: () => setBasemapFailed(true),
          tileload: () => setBasemapFailed(false),
        }}
      />
      <ImageOverlay
        url={HH_AFTER}
        bounds={BOUNDS}
        opacity={0.74}
        eventHandlers={{
          error: () => setRadarFailed(true),
          load: () => setRadarFailed(false),
        }}
      />
      <PickPoint onPick={onPick} />
      {point && <CircleMarker center={[point.lat, point.lon]} radius={6} pathOptions={{ color: "#5ce1d2", fillOpacity: 0.5, weight: 2 }}><Tooltip>{point.lat.toFixed(5)}, {point.lon.toFixed(5)}</Tooltip></CircleMarker>}
    </MapContainer>
    {basemapFailed && <div className="chokwe-pixel-map__notice" role="status">Satellite background unavailable · the published NISAR overlay remains available.</div>}
    {radarFailed && <div className="chokwe-pixel-map__notice chokwe-pixel-map__notice--radar" role="status">The published NISAR image could not be drawn · try reloading this case. The basemap and pixel locator remain available.</div>}
  </div>;
}

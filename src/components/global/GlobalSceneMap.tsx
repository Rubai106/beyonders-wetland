"use client";

import { useCallback } from "react";
import {
  GeoJSON as LeafletGeoJSON,
  MapContainer,
  TileLayer,
  ZoomControl,
} from "react-leaflet";
import type { Feature, FeatureCollection, MultiPolygon } from "geojson";
import type { Layer, LeafletMouseEvent, PathOptions } from "leaflet";
import L from "leaflet";
import type { GlobalScene } from "./GlobalCoverageExplorer";
import "leaflet/dist/leaflet.css";
import GlobalWorldBounds, { WORLD_BOUNDS } from "./GlobalWorldBounds";

type SceneFeatureCollection = FeatureCollection<MultiPolygon, GlobalScene>;

export default function GlobalSceneMap({
  date,
  refreshKey,
  features,
  selectedSceneId,
  onSelect,
}: {
  date: string;
  refreshKey: number;
  features: SceneFeatureCollection;
  selectedSceneId: string | null;
  onSelect: (scene: GlobalScene) => void;
}) {
  const style = useCallback((feature?: Feature): PathOptions => {
    const scene = feature?.properties as GlobalScene | undefined;
    const selected = scene?.sceneId === selectedSceneId;
    const color = scene?.orbitDirection === "Ascending" ? "#37d9ee"
      : scene?.orbitDirection === "Descending" ? "#ffbf69" : "#c4b5fd";
    return {
      color: selected ? "#ffffff" : color,
      fillColor: color,
      weight: selected ? 2.5 : 0.8,
      opacity: selected ? 1 : 0.75,
      fillOpacity: selected ? 0.28 : 0.06,
    };
  }, [selectedSceneId]);

  const handleClick = useCallback((event: LeafletMouseEvent) => {
    const layer = event.target as Layer & { feature?: Feature<MultiPolygon, GlobalScene> };
    if (layer.feature?.properties) onSelect(layer.feature.properties);
  }, [onSelect]);

  return (
    <MapContainer
      center={[18, 0]}
      zoom={2}
      minZoom={0}
      maxZoom={12}
      zoomSnap={0.25}
      maxBounds={L.latLngBounds([-85.05112878, -180], [85.05112878, 180])}
      maxBoundsViscosity={1}
      zoomControl={false}
      style={{ width: "100%", height: "100%" }}
    >
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA"
        bounds={WORLD_BOUNDS}
        noWrap
      />
      <ZoomControl position="topright" />
      <GlobalWorldBounds />
      {features.features.length > 0 && (
        <LeafletGeoJSON
          key={`${date}-${refreshKey}`}
          data={features}
          style={style}
          eventHandlers={{ click: handleClick }}
        />
      )}
    </MapContainer>
  );
}

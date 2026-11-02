"use client";

import { useEffect } from "react";
import {
  ImageOverlay,
  MapContainer,
  ScaleControl,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { AgricultureAOI } from "@/lib/agriculture-study";

function FitStudyBounds({ bounds }: { bounds: LatLngBoundsExpression | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 12 });
  }, [bounds, map]);
  return null;
}

export default function AgricultureMap({
  aoi,
  displayBounds,
  previewUrl,
  satelliteBasemap,
  noStudy,
  layer,
}: {
  aoi: AgricultureAOI | null;
  displayBounds: AgricultureAOI | null;
  previewUrl: string | null;
  satelliteBasemap: boolean;
  noStudy: boolean;
  layer: "moisture" | "change" | "matched" | "crop" | "crop-common";
}) {
  const extent = displayBounds ?? aoi;
  const bounds: LatLngBoundsExpression | undefined = extent
    ? [[extent.south, extent.west], [extent.north, extent.east]]
    : undefined;
  const center: [number, number] = extent
    ? [(extent.south + extent.north) / 2, (extent.west + extent.east) / 2]
    : [12, 0];

  return (
    <div className="agri-map" aria-label="Interactive soil-moisture map">
      <MapContainer
        key={aoi ? [aoi.west, aoi.south, aoi.east, aoi.north].join(",") : "world"}
        center={center}
        zoom={aoi ? 8 : 2}
        minZoom={2}
        maxZoom={18}
        scrollWheelZoom
        worldCopyJump
        style={{ width: "100%", height: "100%" }}
      >
        {satelliteBasemap ? (
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles © Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
            maxZoom={18}
          />
        ) : (
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            subdomains="abcd"
            maxZoom={19}
          />
        )}
        <ScaleControl position="bottomleft" />
        <FitStudyBounds bounds={bounds} />
        {bounds && previewUrl && <ImageOverlay url={previewUrl} bounds={bounds} opacity={0.86} />}
      </MapContainer>
      {noStudy && (
        <div className="agri-map-empty" role="status">
          <span className="agri-map-empty__eyebrow">SME2 · PROVISIONAL</span>
          <strong>No published soil-moisture result</strong>
          <p>This map contains basemap context only. No observation or change layer is being implied.</p>
        </div>
      )}
      {aoi && previewUrl && <div className="agri-map-legend" aria-label="Map legend">
        {layer === "change" ? <>
          <span><i className="agri-map-legend__decrease" />Decrease</span>
          <span><i className="agri-map-legend__increase" />Increase</span>
        </> : layer === "matched" ? <>
          <span><i className="agri-map-legend__matched" />Same pixels · all dates</span>
          <span><i className="agri-map-legend__transparent" />Outside cohort</span>
        </> : layer === "crop" ? <>
          <span><i className="agri-map-legend__crop" />Mapped crop fraction · native SME2 cell</span>
          <span><i className="agri-map-legend__transparent" />Outside mask / insufficient source coverage</span>
        </> : layer === "crop-common" ? <>
          <span><i className="agri-map-legend__crop-common" />Crop area valid on every date</span>
          <span><i className="agri-map-legend__transparent" />Not in common crop cohort</span>
        </> : <>
          <span><i className="agri-map-legend__low" />Lower moisture</span>
          <span><i className="agri-map-legend__high" />Higher moisture</span>
          <span><i className="agri-map-legend__transparent" />Not assessed</span>
        </>}
      </div>}
    </div>
  );
}

"use client";

import { useEffect, useMemo } from "react";
import {
  ImageOverlay,
  MapContainer,
  Rectangle,
  ScaleControl,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { AgricultureAOI, AgricultureObservation, AgricultureStudy } from "@/lib/agriculture-study";

function FitStudyBounds({ bounds }: { bounds: LatLngBoundsExpression | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 12, animate: false });
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
  study,
  selectedObservation,
  onLayerChange,
}: {
  aoi: AgricultureAOI | null;
  displayBounds: AgricultureAOI | null;
  previewUrl: string | null;
  satelliteBasemap: boolean;
  noStudy: boolean;
  layer: "moisture" | "change" | "matched" | "crop" | "crop-common" | "crop-source";
  study: AgricultureStudy | null;
  selectedObservation: AgricultureObservation | null;
  onLayerChange: (layer: "moisture" | "change" | "matched") => void;
}) {
  const extent = displayBounds ?? aoi;
  const west = extent?.west ?? null;
  const south = extent?.south ?? null;
  const east = extent?.east ?? null;
  const north = extent?.north ?? null;
  const bounds = useMemo<LatLngBoundsExpression | undefined>(() =>
    west !== null && south !== null && east !== null && north !== null
      ? [[south, west], [north, east]]
      : undefined,
    [west, south, east, north],
  );
  const center: [number, number] = extent
    ? [(extent.south + extent.north) / 2, (extent.west + extent.east) / 2]
    : [12, 0];

  const trendPoints = useMemo(() => {
    const observations = study?.observations ?? [];
    if (observations.length === 0) return [];
    const values = observations.map((item) => item.median);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const span = high - low || 0.01;
    return observations.map((item, index) => ({
      date: item.date,
      x: observations.length === 1 ? 50 : (index / (observations.length - 1)) * 100,
      y: 34 - ((item.median - low) / span) * 27,
    }));
  }, [study]);
  const selectedTrendPoint = trendPoints.find((point) => point.date === selectedObservation?.date);

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
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
            className="agri-basemap-tile-layer"
            maxZoom={19}
          />
        )}
        <ScaleControl position="bottomleft" />
        <FitStudyBounds bounds={bounds} />
        {bounds && noStudy && <Rectangle
          bounds={bounds}
          pathOptions={{ color: "#57c7d0", weight: 2, dashArray: "7 6", fillColor: "#57c7d0", fillOpacity: 0.045 }}
        />}
        {bounds && previewUrl && <ImageOverlay url={previewUrl} bounds={bounds} opacity={0.86} />}
      </MapContainer>
      {study && selectedObservation && (
        <aside className="agri-map-readout" aria-label="Current soil-moisture observation summary">
          <div className="agri-map-readout__head">
            <div><span>FIELD OBSERVABILITY</span><strong>{new Date(selectedObservation.date + "T00:00:00Z").toLocaleDateString("en", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}</strong></div>
            <span className="agri-map-readout__tag">NISAR SME2</span>
          </div>
          <div className="agri-map-readout__signal">
            <div>
              <span className="agri-map-readout__label">MEDIAN SOIL MOISTURE</span>
              <strong>{selectedObservation.median.toFixed(3)}<small>m³/m³</small></strong>
              <span className="agri-map-readout__range">P05 {selectedObservation.p05.toFixed(3)} · P95 {selectedObservation.p95.toFixed(3)}</span>
            </div>
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Median soil moisture across the six acquisition dates">
              <polyline points={trendPoints.map((point) => point.x.toFixed(2) + "," + point.y.toFixed(2)).join(" ")} />
              {selectedTrendPoint && <circle cx={selectedTrendPoint.x} cy={selectedTrendPoint.y} r="2.8" />}
            </svg>
          </div>
          <div className="agri-map-readout__time"><span>{trendPoints[0]?.date ?? ""}</span><span>{trendPoints[trendPoints.length - 1]?.date ?? ""}</span></div>
          <div className="agri-map-readout__metrics">
            <div><strong>{(selectedObservation.valid_fraction * 100).toFixed(1)}%</strong><span>date-valid footprint</span><small>{selectedObservation.valid_pixels.toLocaleString()} / {selectedObservation.total_pixels.toLocaleString()} cells</small></div>
            <div><strong>{(study.matched_support.valid_fraction * 100).toFixed(1)}%</strong><span>same pixels · all dates</span><small>{study.matched_support.valid_pixels.toLocaleString()} fixed cells</small></div>
            <div><strong>{study.change_summary.median > 0 ? "+" : ""}{study.change_summary.median.toFixed(3)}</strong><span>latest − baseline</span><small>m³/m³ · {study.target_date}</small></div>
          </div>
          <div className="agri-map-readout__actions">
            <button type="button" aria-pressed={layer === "change"} onClick={() => onLayerChange("change")}>View change layer</button>
            <button type="button" aria-pressed={layer === "matched"} disabled={study.matched_support.observations.length === 0} onClick={() => onLayerChange("matched")}>Inspect same pixels</button>
          </div>
          <div className="agri-map-readout__foot">EXPLORATORY EVIDENCE · NOT A CROP-HEALTH CLASSIFICATION</div>
        </aside>
      )}
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
        </> : layer === "crop-source" ? <>
          <span><i className="agri-map-legend__crop-complete" />Source coverage meets floor</span>
          <span><i className="agri-map-legend__crop-partial" />Partial source coverage</span>
          <span><i className="agri-map-legend__crop-nodata" />No valid source coverage</span>
        </> : <>
          <span><i className="agri-map-legend__low" />Lower moisture</span>
          <span><i className="agri-map-legend__high" />Higher moisture</span>
          <span><i className="agri-map-legend__transparent" />Not assessed</span>
        </>}
      </div>}
    </div>
  );
}

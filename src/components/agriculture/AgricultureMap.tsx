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
import type { AgricultureAOI, AgricultureObservation, AgricultureStudy, AgricultureSummary } from "@/lib/agriculture-study";

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
  publicationError,
  study,
  selectedObservation,
  displayedSummary,
  trendObservations,
  onLayerChange,
}: {
  aoi: AgricultureAOI | null;
  displayBounds: AgricultureAOI | null;
  previewUrl: string | null;
  satelliteBasemap: boolean;
  noStudy: boolean;
  layer: "moisture" | "change" | "matched" | "crop" | "crop-common" | "crop-source";
  publicationError: string;
  study: AgricultureStudy | null;
  selectedObservation: AgricultureObservation | null;
  displayedSummary: AgricultureSummary | null;
  trendObservations: Array<AgricultureSummary & { date: string }>;
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
    if (trendObservations.length === 0 || layer === "change") return [];
    const values = trendObservations.map((item) => item.median);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const span = high - low || 0.01;
    return trendObservations.map((item, index) => ({
      date: item.date,
      median: item.median,
      x: trendObservations.length === 1 ? 50 : (index / (trendObservations.length - 1)) * 100,
      y: 34 - ((item.median - low) / span) * 27,
    }));
  }, [trendObservations, layer]);
  const selectedTrendPoint = trendPoints.find((point) => point.date === selectedObservation?.date);
  const readoutSummary = displayedSummary ?? selectedObservation;
  const changeLayerActive = layer === "change";
  const readoutDate = changeLayerActive ? study?.target_date : selectedObservation?.date;
  const readoutLabel = changeLayerActive ? "MEDIAN SOIL-MOISTURE CHANGE"
    : layer === "matched" ? "SAME-PIXEL MEDIAN SOIL MOISTURE"
    : "MEDIAN SOIL MOISTURE";
  const secondaryCoverage = layer === "matched" ? selectedObservation?.valid_fraction
    : changeLayerActive ? study?.target_summary.valid_fraction
    : study?.matched_support.valid_fraction;
  const secondaryCoverageLabel = layer === "matched" ? "date-valid footprint"
    : changeLayerActive ? "target-date footprint"
    : "same pixels · all dates";
  const contextMetric = changeLayerActive ? study?.target_summary.median : study?.change_summary.median;
  const contextMetricLabel = changeLayerActive ? "target-date soil moisture" : "latest − baseline";

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
      {study && selectedObservation && readoutSummary && (
        <aside className="agri-map-readout" aria-label="Current Agriculture map layer summary">
          <div className="agri-map-readout__head">
            <div><span>{changeLayerActive ? "TARGET-VERSUS-BASELINE CHANGE" : layer === "matched" ? "FIXED SPATIAL SUPPORT" : "FIELD OBSERVABILITY"}</span><strong>{readoutDate ? new Date(readoutDate + "T00:00:00Z").toLocaleDateString("en", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : ""}</strong></div>
            <span className="agri-map-readout__tag">{changeLayerActive ? "Latest − baseline" : layer === "matched" ? "Same pixels · all dates" : study.algorithm_label ?? "Root baseline product"}</span>
          </div>
          <div className="agri-map-readout__signal">
            <div>
              <span className="agri-map-readout__label">{readoutLabel}</span>
              <strong>{readoutSummary.median.toFixed(3)}<small>m³/m³</small></strong>
              <span className="agri-map-readout__range">P05 {readoutSummary.p05.toFixed(3)} · P95 {readoutSummary.p95.toFixed(3)}</span>
            </div>
            {changeLayerActive ? (
              <div className="agri-map-readout__change-pair">
                <span>BASELINE</span><strong>{study.baseline_dates.length} valid dates</strong>
                <span>TARGET</span><strong>{study.target_date}</strong>
              </div>
            ) : (
              <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={layer === "matched" ? "Same-pixel soil moisture across all acquisition dates" : "Date-valid soil moisture across all acquisition dates"}>
                <polyline points={trendPoints.map((point) => point.x.toFixed(2) + "," + point.y.toFixed(2)).join(" ")} />
                {selectedTrendPoint && <circle cx={selectedTrendPoint.x} cy={selectedTrendPoint.y} r="2.8" />}
              </svg>
            )}
          </div>
          {!changeLayerActive && <div className="agri-map-readout__time"><span>{trendPoints[0]?.date ?? ""}</span><span>{trendPoints[trendPoints.length - 1]?.date ?? ""}</span></div>}
          <div className="agri-map-readout__metrics">
            <div><strong>{(readoutSummary.valid_fraction * 100).toFixed(1)}%</strong><span>{changeLayerActive ? "change-layer footprint" : layer === "matched" ? "fixed-cohort footprint" : "date-valid footprint"}</span><small>{readoutSummary.valid_pixels.toLocaleString()} / {readoutSummary.total_pixels.toLocaleString()} cells</small></div>
            <div><strong>{((secondaryCoverage ?? 0) * 100).toFixed(1)}%</strong><span>{secondaryCoverageLabel}</span><small>{layer === "matched" ? selectedObservation.valid_pixels.toLocaleString() + " date-valid cells" : changeLayerActive ? study.target_summary.valid_pixels.toLocaleString() + " target-date cells" : study.matched_support.valid_pixels.toLocaleString() + " fixed cells"}</small></div>
            <div><strong>{(contextMetric ?? 0) > 0 ? "+" : ""}{(contextMetric ?? 0).toFixed(3)}</strong><span>{contextMetricLabel}</span><small>m³/m³ · {study.target_date}</small></div>
          </div>
          <div className="agri-map-readout__actions">
            <button type="button" aria-pressed={layer === "change"} onClick={() => onLayerChange("change")}>View change layer</button>
            <button type="button" aria-pressed={layer === "matched"} disabled={study.matched_support.observations.length === 0} onClick={() => onLayerChange("matched")}>Inspect same pixels</button>
          </div>
          <div className="agri-map-readout__foot">EXPLORATORY EVIDENCE · NOT A CROP-HEALTH CLASSIFICATION</div>
          {!study.crop_observability && <div className="agri-map-readout__availability">Crop overlays are unavailable: this release contains no independent crop-area mask.</div>}
        </aside>
      )}
      {publicationError && (
        <div className="agri-map-integrity" role="status">
          <span>PUBLICATION NOT VERIFIED</span>
          <strong>Measured layers are withheld</strong>
          <p>Open the publication status in the evidence drawer for the exact integrity error. No map values are being substituted.</p>
        </div>
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

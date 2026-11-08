"use client";
import { useEffect, useState } from "react";
import { CircleMarker, GeoJSON, ImageOverlay, MapContainer, Pane, Rectangle, TileLayer, Tooltip, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import GlobalWorldBounds, { WORLD_BOUNDS } from "@/components/global/GlobalWorldBounds";
import type { ForestCandidates, ForestCoverage } from "@/lib/forest-study";
export type ForestFocus = {
    lat: number;
    lon: number;
    zoom: number;
};
function Interactions({ focus, reportZoom, onPickPoint }: {
    focus: ForestFocus | null;
    reportZoom: (value: number) => void;
    onPickPoint?: (point: { lat: number; lon: number }) => void;
}) {
    const map = useMap();
    useEffect(() => {
        const container = map.getContainer();
        let frame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
        });
        observer.observe(container);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [map]);
    useMapEvents({
        zoomend: () => reportZoom(map.getZoom()),
        click: (event) => onPickPoint?.({ lat: event.latlng.lat, lon: event.latlng.lng }),
    });
    useEffect(() => { if (focus)
        map.setView([focus.lat, focus.lon], focus.zoom); }, [map, focus]);
    return null;
}
function bounds(b: number[]): LatLngBoundsExpression { return [[b[1], b[0]], [b[3], b[2]]]; }
export default function ForestMap({ focus, treeCover = false, imagery = false, mosaicDate = "", coverage = null, candidates = null, bbox, imageUrl, studyPublished = false, gladImageUrl, gladS2Alerts = false, gladConfirmedOnly = false, gladDateRange, globalView = false, probePoint = null, onPickPoint }: {
    focus?: ForestFocus | null;
    treeCover?: boolean;
    imagery?: boolean;
    mosaicDate?: string;
    coverage?: ForestCoverage | null;
    candidates?: ForestCandidates | null;
    bbox?: number[];
    imageUrl?: string;
    studyPublished?: boolean;
    gladImageUrl?: string;
    gladS2Alerts?: boolean;
    gladConfirmedOnly?: boolean;
    gladDateRange?: [string, string];
    globalView?: boolean;
    probePoint?: { lat: number; lon: number } | null;
    onPickPoint?: (point: { lat: number; lon: number }) => void;
}) {
    const [zoom, setZoom] = useState(2);
    const [failed, setFailed] = useState<Record<string, boolean>>({});
    const time = mosaicDate ? `${mosaicDate}/` : "";
    const nisar = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/NISAR_L2_Geocoded_Polarimetric_Covariance/default/${time}GoogleMapsCompatible_Level13/{z}/{y}/{x}.png`;
    // The advertised REST template currently rejects requests without SERVICE.
    // Use the verified WMTS KVP interface and its categorical map-layer ID.
    const tree = "https://wmts.terrascope.be/?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=esa-worldcover-map-10m-2021-v2_map&STYLE=default&FORMAT=image/png&TILEMATRIXSET=EPSG:3857&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&TIME=2021-01-01";
    const gladDateFilter = gladDateRange ? `&start_date=${encodeURIComponent(gladDateRange[0])}&end_date=${encodeURIComponent(gladDateRange[1])}` : "";
    const gladS2 = `https://tiles.globalforestwatch.org/umd_glad_sentinel2_alerts/latest/dynamic/{z}/{x}/{y}.png?confirmed_only=${gladConfirmedOnly}${gladDateFilter}`;
    const error = (key: string) => () => setFailed(p => ({ ...p, [key]: true }));
    const recover = (key: string) => () => setFailed(p => p[key] ? { ...p, [key]: false } : p);
    return <div className="forest-map-surface">
    <MapContainer center={bbox ? [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2] : [0, 0]} zoom={bbox ? 11 : 2} minZoom={0} maxZoom={17} zoomSnap={.25} maxBounds={WORLD_BOUNDS} maxBoundsViscosity={1} zoomControl={false} style={{ height: "100%", width: "100%" }}>
      {/* Zoom sits top-right: the title bar overlaps the top-left of the map frame. */}
      <ZoomControl position="topright" />
      <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles © Esri, USGS, NOAA" bounds={WORLD_BOUNDS} noWrap eventHandlers={{ tileerror: error("background"), tileload: recover("background") }}/>
      {(!bbox || globalView) && <GlobalWorldBounds />}
      <Interactions focus={focus ?? null} reportZoom={setZoom} onPickPoint={onPickPoint}/>
      {treeCover && <TileLayer url={tree} key="worldcover2021" minZoom={6} maxNativeZoom={14} opacity={.65} bounds={[[-60, -180], [83, 180]]} noWrap attribution="ESA WorldCover 2021 v200 / Terrascope · historical land cover" eventHandlers={{ tileerror: error("tree"), tileload: recover("tree") }}/>}
      {imagery && <TileLayer key={nisar} url={nisar} opacity={.85} maxNativeZoom={13} noWrap bounds={WORLD_BOUNDS} attribution="NASA NISAR GCOV / GIBS · imagery, not classified forest loss" eventHandlers={{ tileerror: error(nisar), tileload: recover(nisar) }}/>}
      {coverage?.features.length ? <GeoJSON key={JSON.stringify(coverage.features.map(f => f.properties.sceneId))} data={coverage} style={{ color: "#dfab45", weight: 1.3, fillOpacity: .04 }} onEachFeature={(feature, layer) => { const p = feature.properties; layer.bindTooltip(`${p.start?.slice(0, 10) ?? "Unknown date"} · ${p.product}`); }}/> : null}
      {bbox && <Rectangle bounds={bounds(bbox)} pathOptions={{ color: "#53cbb9", weight: 2, fill: false, dashArray: "6 4" }}><Tooltip>{studyPublished ? "Published analysis rectangle" : "Analysis rectangle · no published result available"}</Tooltip></Rectangle>}
      {imageUrl && bbox && <ImageOverlay key={imageUrl} url={imageUrl} bounds={bounds(bbox)} opacity={.9} eventHandlers={{ error: error(imageUrl), load: recover(imageUrl) }}/>}
      {gladS2Alerts && bbox && <Pane name="glad-s2-alerts" style={{ zIndex: 430, pointerEvents: "none" }}><TileLayer key={gladS2} url={gladS2} pane="glad-s2-alerts" opacity={.9} bounds={bounds(bbox)} noWrap attribution="GLAD-S2 · University of Maryland · tiles via Global Forest Watch" eventHandlers={{ tileerror: error("gladS2"), tileload: recover("gladS2") }}/></Pane>}
      {gladImageUrl && bbox && <ImageOverlay key={gladImageUrl} url={gladImageUrl} bounds={bounds(bbox)} opacity={.8} eventHandlers={{ error: error(gladImageUrl), load: recover(gladImageUrl) }}/>}
      {candidates && <Pane name="forest-candidates" style={{ zIndex: 440 }}><GeoJSON key={JSON.stringify(candidates)} data={candidates} style={{ color: "#ffb646", weight: 1, fillOpacity: .65 }}/></Pane>}
      {probePoint && bbox && probePoint.lon >= bbox[0] && probePoint.lon <= bbox[2] && probePoint.lat >= bbox[1] && probePoint.lat <= bbox[3] && <CircleMarker center={[probePoint.lat, probePoint.lon]} radius={6} pathOptions={{ color: "#5ce1d2", fillColor: "#5ce1d2", fillOpacity: .45, weight: 2 }}><Tooltip>Sampled radar pixel</Tooltip></CircleMarker>}
    </MapContainer>
    {(treeCover && zoom < 6 || failed.background || (treeCover && failed.tree) || (imagery && failed[nisar]) || (gladS2Alerts && failed.gladS2) || (imageUrl && failed[imageUrl]) || (gladImageUrl && failed[gladImageUrl])) && <div className="forest-map-notice" role="status">
      {treeCover && zoom < 6 && <p>Zoom in to level 6 to view historical WorldCover land cover. Green represents tree cover in 2021.</p>}
      {failed.background && <p>Satellite background tiles are unavailable. Published study layers remain available.</p>}
      {treeCover && failed.tree && <p>WorldCover context tiles could not load. This does not indicate absent forests.</p>}
      {imagery && failed[nisar] && <p>NISAR mosaic tiles are unavailable for this date or place. Try another date.</p>}
      {gladS2Alerts && failed.gladS2 && <p>Live GLAD-S2 alert tiles are unavailable right now. The official alert viewer remains available below.</p>}
      {imageUrl && failed[imageUrl] && <p>This published layer could not load. Choose another layer or reload.</p>}
      {gladImageUrl && failed[gladImageUrl] && <p>The published GLAD reference layer could not load. Other study evidence remains available.</p>}
    </div>}
  </div>;
}

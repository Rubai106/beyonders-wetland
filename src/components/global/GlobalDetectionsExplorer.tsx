"use client";

// @refresh reset
// Leaflet's map instance must remount when development refresh reruns effects.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import NisarProcessingPanel, { type AreaBounds } from "./NisarProcessingPanel";
import RadarComparison from "./RadarComparison";
import ReferenceEvidence from "./ReferenceEvidence";
import SavedDateCheck from "./SavedDateCheck";
import MozambiqueFloodCase from "./MozambiqueFloodCase";
import BandPenetrationExplainer from "../shared/BandPenetrationExplainer";
import CaseWalkthrough from "./CaseWalkthrough";
import CandidateEvidencePanel from "./CandidateEvidencePanel";
import InvestigationWorkspace from "@/components/layout/InvestigationWorkspace";
import { ModeSwitch } from "@/components/wetland/WetlandExperience";
import { Icon } from "@/components/wetland/icons";
import type { DataTier, ViewMode } from "@/lib/store";
import type { BoundaryCollection, CoverageCollection, DetectionCollection, LocalRadarMapLayer } from "./GlobalNisarDetectionMap";
import MapOpticalRadarComparison from "./MapOpticalRadarComparison";
import useMapOpticalRadarComparison from "./useMapOpticalRadarComparison";

const GlobalNisarDetectionMap = dynamic(() => import("./GlobalNisarDetectionMap"), {
  ssr: false,
  loading: () => <div className="global-map-loading">Loading NISAR map…</div>,
});

interface DetectionResponse {
  run_id: string;
  site_name?: string;
  site_bounds?: AreaBounds;
  boundary_source?: string | null;
  data_source: "NISAR" | "SIMULATED_DEMO" | "UNVERIFIED";
  status: "ready" | "no-real-nisar-run";
  product: string | null;
  product_maturity: string | null;
  reference_validated: boolean;
  cross_sensor_check_completed: boolean;
  reference_check_status: string;
  baseline_date: string | null;
  baseline_scene: string | null;
  selected_baseline?: { baseline_observation_count?: number; baseline_observation_dates?: string[]; baseline_scene_names?: string[] } | null;
  baseline_observation_dates?: string[] | null;
  selected_date: string | null;
  selected_scene: string | null;
  polarizations: string[];
  dates: string[];
  stats: { date: string; area_km2: number; patches: number } | null;
  detections: DetectionCollection;
  boundary: BoundaryCollection | null;
  case_study: CaseStudy | null;
  reference_validation: ReferenceValidation | null;
}

type ReferenceValidation = {
  status?: string;
  reason?: string | null;
  reference_product?: string;
  source_url?: string;
  comparison?: {
    baseline?: { nisar_date?: string; hls_date?: string; offset_days?: number; scene?: string; product?: string };
    event?: { nisar_date?: string; hls_date?: string; offset_days?: number; scene?: string; product?: string };
    hls_tile?: string;
    spatial_resolution_m?: number;
    mndwi_threshold?: number;
  };
  coverage?: { common_clear_fraction?: number; common_clear_area_km2?: number; minimum_clear_fraction_for_check?: number };
  metrics?: { precision?: number | null; recall?: number | null; f1?: number | null; intersection_over_union?: number | null };
  optical_support?: { support?: string; common_clear_fraction?: number; common_clear_area_km2?: number;
    candidate_assessed_fraction?: number | null;
    true_positive_area_km2?: number; false_positive_area_km2?: number; false_negative_area_km2?: number;
    precision?: number | null; recall?: number | null; f1?: number | null; intersection_over_union?: number | null };
  limitations?: string[];
  selection?: { evaluated_pairs?: number; available_pairs?: number; method?: string; date_tolerance_days?: number;
    catalog_searches?: { collection: string; records?: number; status: string }[] };
};

type CaseStudy = {
  title?: string;
  site?: string;
  baseline_date?: string;
  event_date?: string;
  baseline_scene?: string | null;
  baseline_scenes?: string[];
  event_scene?: string | null;
  input_origin?: string;
  source_run_id?: string | null;
  date_pair_selection?: { method?: string; screened_scenes?: number; candidate_pairs?: number } | null;
  polarizations?: string[];
  candidate_patches?: number;
  candidate_area_km2?: number;
  classes?: Record<string, { patches: number; area_km2: number; mean_delta_hh_db?: number | null; mean_delta_hv_db?: number | null }>;
  method?: { open_water_rule?: string; vegetated_inundation_rule?: string; threshold_db?: number; minimum_region_pixels?: number; minimum_valid_fraction?: number; validity_rule?: string;
    baseline_method?: { baseline_method?: string; baseline_observation_count?: number; baseline_observation_dates?: string[]; baseline_hh_temporal_mad_db?: number | null };
    gcov_quality?: { scenes?: { scene?: string; number_of_looks_median?: number | null }[]; number_of_looks_rule?: string; mask_rule?: string } };
  uncertainty?: { threshold_sensitivity?: { stability_verdict?: string; stable_range?: number[]; sensitivity_note?: string }; interpretation?: string };
  reference_validation?: ReferenceValidation;
  impact_context?: string;
  spatial_scope?: string;
};

interface CoverageResponse {
  date: string;
  product: string;
  totalHits: number;
  loadedFeatures: number;
  truncated: boolean;
  snapshotFallback?: boolean;
  features: CoverageCollection["features"];
  error?: string;
}

type RadarChannel = "hh" | "hv";
type RadarStage = "before" | "after" | "change";
type RadarPreviewResponse = {
  run_id: string;
  date: string;
  layers: Record<RadarChannel, {
    images: Record<RadarStage, string>;
    bounds: [[number, number], [number, number]];
    scale_db: number[];
    change_scale_db: number[];
  }>;
};
type RadarPreviewState =
  | { key: string; status: "ready"; preview: RadarPreviewResponse }
  | { key: string; status: "error"; error: string };

function GlobalRadarLayerControls({ dateLabel, channel, stage, disabled, showing, notice, onSelect }: {
  dateLabel: string;
  channel: RadarChannel;
  stage: RadarStage;
  disabled: boolean;
  showing: boolean;
  notice: string;
  onSelect: (channel: RadarChannel, stage: RadarStage) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const stageLabel = stage === "before" ? "Baseline" : stage === "after" ? "After" : "Change";
  const controlId = "global-wetland-radar-layer-options";
  return <div className="wx-radar-picker">
    <button type="button" className="wx-radar-trigger" aria-expanded={expanded} aria-controls={controlId}
      aria-label={`${expanded ? "Hide" : "Show"} HH and HV radar layer options; selected ${channel.toUpperCase()} ${stageLabel}`}
      onClick={() => setExpanded((open) => !open)}>
      {Icon.radar}<strong>{channel.toUpperCase()} · {stageLabel}</strong><span className="wx-radar-trigger__chevron" aria-hidden="true">{expanded ? "−" : "+"}</span>
    </button>
    {expanded && <section id={controlId} className="wx-radar" role="group" aria-label="Choose local HH or HV radar layer for the map">
      <div className="wx-radar__head"><strong>Local GCOV raster</strong><span className="wx-mono">{dateLabel || "Select a study date"}</span>
        <button type="button" aria-label="Minimize radar controls" title="Minimize radar controls" onClick={() => setExpanded(false)}>−</button>
      </div>
      <p className="wx-radar__now" aria-live="polite">{showing ? "Shown on map" : "Study layer"} · {channel.toUpperCase()} {stageLabel}</p>
      {(["hh", "hv"] as const).map((polarization) => <div key={polarization} className="wx-radar__row"><span className="wx-micro">{polarization.toUpperCase()}</span>{(["before", "after", "change"] as const).map((layerStage) => {
        const label = layerStage === "before" ? "Baseline" : layerStage === "after" ? "After" : "Change";
        return <button key={layerStage} type="button" disabled={disabled} aria-pressed={showing && channel === polarization && stage === layerStage}
          aria-label={`Show local ${polarization.toUpperCase()} ${label} raster on map`} title={`Show local ${polarization.toUpperCase()} ${label} raster on map`}
          onClick={() => onSelect(polarization, layerStage)}>{label}</button>;
      })}</div>)}
      {notice && <small role="status">{notice}</small>}
    </section>}
  </div>;
}

function emptyCollection(): DetectionCollection {
  return { type: "FeatureCollection", features: [] };
}

type CoordinateAxis = "latitude" | "longitude";

function parseCoordinate(value: string, axis: CoordinateAxis): number | null {
  const input = value.trim().toUpperCase();
  if (!input) return null;

  const hemisphere = input.match(/[NSEW]$/)?.[0];
  if (hemisphere && (axis === "latitude" ? !["N", "S"].includes(hemisphere) : !["E", "W"].includes(hemisphere))) return null;
  const magnitudeText = hemisphere ? input.slice(0, -1).trim() : input;
  const decimal = magnitudeText.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:[°º])?$/);
  if (decimal) {
    const number = Number(decimal[1]);
    if (!Number.isFinite(number)) return null;
    return hemisphere ? (hemisphere === "S" || hemisphere === "W" ? -1 : 1) * Math.abs(number) : number;
  }

  const parts = magnitudeText
    .replace(/[°º˚dD]/g, " ")
    .replace(/[′'’mM]/g, " ")
    .replace(/[″\"”sS]/g, " ")
    .replace(/:/g, " ")
    .trim()
    .split(/\s+/);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(part))) return null;

  const degrees = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = parts.length === 3 ? Number(parts[2]) : 0;
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds) || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;

  const sign = hemisphere
    ? hemisphere === "S" || hemisphere === "W" ? -1 : 1
    : degrees < 0 ? -1 : 1;
  return sign * (Math.abs(degrees) + minutes / 60 + seconds / 3600);
}

const DEFAULT_COVERAGE_DATE = "2026-10-01";

function displayObservationDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) return date;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(value);
}

/** The global page uses the same playback and real-date axis as the friend's wetland experience. */
function GlobalTimeMachine({ dates, activeDate, stats, loading, onSelect }: {
  dates: string[];
  activeDate: string;
  stats: DetectionResponse["stats"];
  loading: boolean;
  onSelect: (date: string) => void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState<0.5 | 1 | 2>(1);
  const activeIndex = Math.max(0, dates.indexOf(activeDate));

  useEffect(() => {
    if (!isPlaying || loading || dates.length < 2) return;
    const timer = window.setTimeout(() => {
      if (activeIndex >= dates.length - 1) {
        setIsPlaying(false);
        return;
      }
      onSelect(dates[activeIndex + 1]);
    }, 1700 / playSpeed);
    return () => window.clearTimeout(timer);
  }, [activeIndex, dates, isPlaying, loading, onSelect, playSpeed]);

  const points = dates.map((date, index) => {
    const time = Date.parse(`${date}T00:00:00Z`);
    const first = Date.parse(`${dates[0]}T00:00:00Z`);
    const last = Date.parse(`${dates[dates.length - 1]}T00:00:00Z`);
    const x = dates.length < 2 || last <= first ? 50 : 4 + ((time - first) / (last - first)) * 92;
    return { date, index, x };
  });
  const gaps = points.slice(1).map((point, index) => {
    const days = Math.round((Date.parse(`${point.date}T00:00:00Z`) - Date.parse(`${points[index].date}T00:00:00Z`)) / 86_400_000);
    return { from: points[index], to: point, days };
  }).filter((gap) => gap.days > 14);
  const previous = activeIndex > 0 ? dates[activeIndex - 1] : null;
  const next = activeIndex < dates.length - 1 ? dates[activeIndex + 1] : null;
  const pick = (date: string) => { setIsPlaying(false); onSelect(date); };

  return <>
    <div className="wx-timeline__controls">
      <button className="wx-play" type="button" aria-pressed={isPlaying} disabled={dates.length < 2} onClick={() => {
        if (isPlaying) { setIsPlaying(false); return; }
        if (activeIndex >= dates.length - 1 && dates.length) onSelect(dates[0]);
        setIsPlaying(true);
      }}>
        {isPlaying ? <>{Icon.pause}<span>Pause</span></> : dates.length > 1 && activeIndex >= dates.length - 1 ? <>{Icon.replay}<span>Replay</span></> : <>{Icon.play}<span>Play change</span></>}
      </button>
      <div className="wx-step" role="group" aria-label="Step through observations">
        <button type="button" disabled={!previous} aria-label="Previous observation" onClick={() => previous && pick(previous)}>{Icon.prev}</button>
        <button type="button" disabled={!next} aria-label="Next observation" onClick={() => next && pick(next)}>{Icon.next}</button>
      </div>
      <div className="wx-jumps" role="group" aria-label="Jump to an observation">
        {dates.length > 1 && <>
          <button type="button" onClick={() => pick(dates[0])}>First</button>
          <button type="button" onClick={() => pick(dates[dates.length - 1])}>Latest</button>
        </>}
      </div>
      <div className="wx-speed" role="group" aria-label="Playback speed">
        {([0.5, 1, 2] as const).map((speed) => <button key={speed} type="button" aria-pressed={playSpeed === speed} onClick={() => setPlaySpeed(speed)}>{speed}×</button>)}
      </div>
      <div className="wx-now" aria-live="polite">
        <strong>{activeDate ? displayObservationDate(activeDate) : "No processed date"}</strong>
        <span className="wx-mono">{stats && activeDate === stats.date ? `${stats.area_km2.toFixed(2)} km² flagged · ${stats.patches} regions` : loading ? "Loading selected observation…" : "Acquisition date · no per-date area summary"}</span>
      </div>
    </div>
    {dates.length ? <div className="wx-track wx-global-track" role="group" aria-label="Observations on their real date axis">
      <span className="wx-track__cap">Each dot is an acquired observation. Dashed spans mark gaps over 14 days.</span>
      <span className="wx-track__axis" aria-hidden="true" />
      {gaps.map((gap) => <div key={`${gap.from.date}-${gap.to.date}`} className="wx-gap" style={{ left: `${gap.from.x}%`, width: `${gap.to.x - gap.from.x}%` }}><span>{gap.days}-day gap</span></div>)}
      {points.map((point) => <button key={point.date} type="button" className={`wx-obs${point.date === activeDate ? " is-active" : ""}`} style={{ left: `${point.x}%` }} aria-current={point.date === activeDate} aria-label={`Select observation ${displayObservationDate(point.date)}`} title={point.date} onClick={() => pick(point.date)}>
        <i className="wx-obs__stem" style={{ height: `${point.date === activeDate ? 32 : 22}px` }} /><i className="wx-obs__dot" /><span className="wx-obs__date">{point.date.slice(5)}</span>
      </button>)}
    </div> : <p className="wx-global-timeline__empty">Choose a saved run under Explore to view its processed observations.</p>}
  </>;
}

export default function GlobalDetectionsExplorer({ initialLocation, initialRunId, initialAnchorId }: {
  initialLocation?: { latitude: string; longitude: string; site: string };
  initialRunId?: string;
  initialAnchorId?: string;
}) {
  const queryLatitude = initialLocation?.latitude ?? "";
  const queryLongitude = initialLocation?.longitude ?? "";
  const querySite = initialLocation?.site.trim() ?? "";
  const coordinateQueryKey = `${queryLatitude}|${queryLongitude}|${querySite}`;
  const parsedQueryLatitude = parseCoordinate(queryLatitude, "latitude");
  const parsedQueryLongitude = parseCoordinate(queryLongitude, "longitude");
  const queryCoordinateTarget = parsedQueryLatitude !== null && parsedQueryLongitude !== null &&
      parsedQueryLatitude >= -85.05112878 && parsedQueryLatitude <= 85.05112878 &&
      parsedQueryLongitude >= -180 && parsedQueryLongitude <= 180
    ? { latitude: parsedQueryLatitude, longitude: parsedQueryLongitude }
    : null;
  const [selectedRun, setSelectedRun] = useState(initialRunId ?? "");
  const [savedRuns, setSavedRuns] = useState<{ run_id: string; site_name: string; baseline_date: string; selected_date: string; completed_at: string }[]>([]);
  const pendingAreaRunId = useRef("");
  const [runsError, setRunsError] = useState("");
  const [areaBounds, setAreaBounds] = useState<AreaBounds | null>(null);
  const [areaBoundary, setAreaBoundary] = useState<BoundaryCollection | null>(null);
  const [areaDrawing, setAreaDrawing] = useState(false);
  const [coordinateDraft, setCoordinateDraft] = useState<{ key: string; latitude: string; longitude: string } | null>(null);
  const [coordinateError, setCoordinateError] = useState("");
  const [coordinateToolOpen, setCoordinateToolOpen] = useState(Boolean(queryLatitude || queryLongitude));
  const [manualCoordinateTarget, setManualCoordinateTarget] = useState<{ key: string; target: { latitude: number; longitude: number } | null } | null>(null);
  const [candidateDate, setCandidateDate] = useState("");
  const [mosaicDate, setMosaicDate] = useState("");
  const [coverageDate, setCoverageDate] = useState(DEFAULT_COVERAGE_DATE);
  const [mosaicStatus, setMosaicStatus] = useState<"loading" | "ready" | "error">("loading");
  const [focusStudyArea, setFocusStudyArea] = useState(false);
  const [mapMode, setMapMode] = useState<ViewMode>("MOTION");
  const [satelliteBasemap, setSatelliteBasemap] = useState(true);
  const [showFootprints, setShowFootprints] = useState(true);
  const [showNisarMosaic, setShowNisarMosaic] = useState(false);
  const [showLocalRadar, setShowLocalRadar] = useState(false);
  const [mapComparisonOpen, setMapComparisonOpen] = useState(false);
  const [comparisonSession, setComparisonSession] = useState(0);
  const [comparisonPosition, setComparisonPosition] = useState(50);
  const comparisonTriggerRef = useRef<HTMLButtonElement>(null);
  const [radarChannel, setRadarChannel] = useState<RadarChannel>("hh");
  const [radarStage, setRadarStage] = useState<RadarStage>("change");
  const [radarPreviewState, setRadarPreviewState] = useState<RadarPreviewState | null>(null);
  const [radarImageStatus, setRadarImageStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [data, setData] = useState<DetectionResponse | null>(null);
  const [candidateSelection, setCandidateSelection] = useState<{ runId: string; id: string | null } | null>(null);
  const [coverageData, setCoverageData] = useState<CoverageResponse | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageRefreshing, setCoverageRefreshing] = useState(false);
  const [coverageError, setCoverageError] = useState("");
  const [coverageRefreshKey, setCoverageRefreshKey] = useState(0);
  const [loading, setLoading] = useState(Boolean(initialRunId));
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const closeMapComparison = useCallback(() => {
    setMapComparisonOpen(false);
    window.requestAnimationFrame(() => comparisonTriggerRef.current?.focus());
  }, []);
  const coordinateLatitude = coordinateDraft?.key === coordinateQueryKey ? coordinateDraft.latitude : queryLatitude;
  const coordinateLongitude = coordinateDraft?.key === coordinateQueryKey ? coordinateDraft.longitude : queryLongitude;
  const coordinateTarget = manualCoordinateTarget?.key === coordinateQueryKey
    ? manualCoordinateTarget.target
    : queryCoordinateTarget;

  const loadFinishedRun = useCallback((runId: string) => {
    setSelectedRun(runId); setCandidateDate(""); setError(""); setLoading(true);
    setShowLocalRadar(false);
    setFocusStudyArea(true);
    setManualCoordinateTarget({ key: coordinateQueryKey, target: null });
    setRefreshKey((key) => key+1);
  }, [coordinateQueryKey]);
  const selectRun = useCallback((runId: string) => {
    setSelectedRun(runId);
    setShowLocalRadar(false);
    setCandidateDate("");
    setCandidateSelection(null);
    setError("");
    if (!runId) {
      // No run chosen: clear any previous run's detections in this same
      // event, so the explorer shows the honest empty state. The fetch
      // effect below skips entirely when no run is selected; it must not
      // set state itself (React 19 forbids setState directly in an effect).
      setData(null);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setFocusStudyArea(Boolean(runId));
    setAreaBounds(null);
    setAreaBoundary(null);
    setManualCoordinateTarget({ key: coordinateQueryKey, target: null });
  }, [coordinateQueryKey]);
  const selectObservation = useCallback((date: string) => {
    setError("");
    setLoading(true);
    setCandidateDate(date);
  }, []);
  const loadSavedAreaForProcessing = useCallback((runId: string) => {
    setAreaBounds(null); setAreaBoundary(null); setAreaDrawing(false);
    pendingAreaRunId.current = runId;
    loadFinishedRun(runId);
  }, [loadFinishedRun]);
  const applyArea = useCallback((bounds: AreaBounds, boundary: BoundaryCollection | null) => {
    setAreaBounds(bounds); setAreaBoundary(boundary); setAreaDrawing(false);
  }, []);
  const searchCoordinates = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const latitude = parseCoordinate(coordinateLatitude, "latitude");
    const longitude = parseCoordinate(coordinateLongitude, "longitude");
    if (latitude == null || longitude == null) {
      setCoordinateError("Enter decimal degrees or degrees and minutes (for example, 25°09′ N and 91°04′ E). Minutes and seconds must be below 60.");
      return;
    }
    if (latitude < -85.05112878 || latitude > 85.05112878 || longitude < -180 || longitude > 180) {
      setCoordinateError("Latitude must be within the map range (−85.0511 to 85.0511); longitude must be between −180 and 180.");
      return;
    }
    setCoordinateError("");
    setManualCoordinateTarget({ key: coordinateQueryKey, target: { latitude, longitude } });
    setFocusStudyArea(false);
  };

  const locateMozambiqueCase = () => {
    setCoordinateDraft({ key: coordinateQueryKey, latitude: "-24.533333", longitude: "32.983333" });
    setManualCoordinateTarget({ key: coordinateQueryKey, target: { latitude: -24.533333, longitude: 32.983333 } });
    setFocusStudyArea(false);
    document.getElementById("global-nisar-map")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  };

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/wetland/runs", { signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load saved results.");
      return result;
    }).then((result) => { setSavedRuns(result.runs); setRunsError(""); })
      .catch((reason) => { if (!controller.signal.aborted) setRunsError(reason.message); });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    // No run chosen means no detections: the explorer must not silently load
    // the latest completed run (Tanguar in public mode) and present it as the
    // initial state. Worldwide footprints are acquisitions, not detections,
    // until the user explicitly picks a saved study (or arrives via ?run=).
    // Clearing happens in selectRun, the event that changes the selection.
    if (!selectedRun) {
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (candidateDate) params.set("date", candidateDate);
    if (selectedRun) params.set("run", selectedRun);
    const query = params.size ? `?${params}` : "";

    fetch(`/api/wetland/nisar-detections${query}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as DetectionResponse & { error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load NISAR detections.");
        return result;
      })
      .then((result) => {
        if (pendingAreaRunId.current === result.run_id) {
          if (result.site_bounds) {
            setAreaBounds(result.site_bounds);
            setAreaBoundary(result.boundary);
            setAreaDrawing(false);
          }
          pendingAreaRunId.current = "";
        }
        setData(result);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        if (pendingAreaRunId.current === selectedRun) pendingAreaRunId.current = "";
        setData(null);
        setError(reason instanceof Error ? reason.message : "Could not load NISAR detections.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [candidateDate, selectedRun, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();

    const refreshCoverage = async () => {
      let snapshotReady = false;
      if (coverageDate === DEFAULT_COVERAGE_DATE) {
        try {
          const snapshotResponse = await fetch(
            `/api/wetland/global-coverage?date=${encodeURIComponent(coverageDate)}&snapshot=1`,
            { signal: controller.signal },
          );
          const snapshot = await snapshotResponse.json() as CoverageResponse;
          if (!snapshotResponse.ok) throw new Error(snapshot.error || "Could not load saved worldwide NISAR footprints.");
          if (controller.signal.aborted) return;
          setCoverageData(snapshot);
          setCoverageLoading(false);
          setCoverageRefreshing(true);
          snapshotReady = true;
        } catch (reason) {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          // Continue to the live catalog. Its response may still succeed even if
          // the optional saved snapshot is missing or unreadable.
        }
      }

      try {
        const response = await fetch(
          `/api/wetland/global-coverage?date=${encodeURIComponent(coverageDate)}&refresh=${coverageRefreshKey}`,
          { signal: controller.signal },
        );
        const result = await response.json() as CoverageResponse;
        if (!response.ok) throw new Error(result.error || "Could not load worldwide NISAR footprints.");
        if (controller.signal.aborted) return;
        setCoverageData(result);
        if (result.snapshotFallback) {
          setCoverageError("NASA CMR is unavailable; showing the saved coverage snapshot.");
        } else {
          setCoverageError("");
        }
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        if (snapshotReady) {
          setCoverageError("NASA CMR refresh failed; the saved coverage snapshot remains visible.");
        } else {
          setCoverageData(null);
          setCoverageError(reason instanceof Error ? reason.message : "Could not load worldwide NISAR footprints.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setCoverageLoading(false);
          setCoverageRefreshing(false);
        }
      }
    };

    void refreshCoverage();

    return () => controller.abort();
  }, [coverageDate, coverageRefreshKey]);

  const detections = data?.detections ?? emptyCollection();
  const coverage: CoverageCollection = { type: "FeatureCollection", features: coverageData?.features ?? [] };
  const isNisar = data?.data_source === "NISAR";
  const today = new Date().toISOString().slice(0, 10);
  const statusText = loading ? "Loading pipeline output…"
    : error ? "NISAR output unavailable"
      : isNisar ? "NISAR · provisional candidates"
        : data?.data_source === "SIMULATED_DEMO" ? "No real NISAR run loaded" : "NISAR run required";
  const statusClass = loading ? "global-source-pill--loading" : error ? "global-source-pill--error"
    : isNisar ? "global-source-pill--live" : "global-source-pill--snapshot";

  const firstCandidateId = data?.detections.features.find((feature) => feature.properties?.id)?.properties?.id ?? null;
  const currentCandidateSelection = data !== null && candidateSelection !== null && candidateSelection.runId === data.run_id
    ? candidateSelection
    : null;
  const evidenceCandidateId = currentCandidateSelection
    ? currentCandidateSelection.id === null || data?.detections.features.some((feature) => feature.properties?.id === currentCandidateSelection.id) === true
      ? currentCandidateSelection.id
      : firstCandidateId
    : firstCandidateId;
  // Keep the map uncluttered on first load. A candidate gets the white selection
  // outline and map zoom only after the user explicitly chooses it.
  const selectedCandidateId = currentCandidateSelection?.id && data?.detections.features.some((feature) => feature.properties?.id === currentCandidateSelection.id)
    ? currentCandidateSelection.id
    : null;
  const selectCandidate = (id: string | null) => {
    if (data) setCandidateSelection({ runId: data.run_id, id });
  };
  const handleMapModeChange = (mode: ViewMode) => {
    setMapMode(mode);
    setShowLocalRadar(false);
    // Match the study map: radar imagery is a separate view mode, while the
    // candidate overlay remains visible so users can compare the two layers.
    setShowNisarMosaic(mode === "RADAR");
    if (mode === "RADAR") setMosaicStatus("loading");
    if (mode === "RADAR") window.dispatchEvent(new CustomEvent("geonexsar:open-panel", { detail: "nisar-radar" }));
    if (mode === "EXPLAIN") window.dispatchEvent(new CustomEvent("geonexsar:open-panel", { detail: "nisar-case-story-title" }));
  };
  const handleLocalRadarSelection = (channel: RadarChannel, stage: RadarStage) => {
    setRadarChannel(channel);
    setRadarStage(stage);
    setMapMode("RADAR");
    setFocusStudyArea(true);
    setShowNisarMosaic(false);
    setShowLocalRadar(true);
    setRadarImageStatus("loading");
  };
  const returnToOverview = () => {
    setMapMode("MOTION");
    setShowNisarMosaic(false);
    setShowLocalRadar(false);
    setFocusStudyArea(false);
    setCandidateSelection(null);
    setAreaBounds(null);
    setAreaBoundary(null);
    setAreaDrawing(false);
    setCandidateDate("");
    setCoordinateError("");
    setManualCoordinateTarget({ key: coordinateQueryKey, target: null });
  };
  const questCandidates = [...detections.features]
    .filter((feature) => feature.properties?.id)
    .sort((a, b) => (b.properties.area_km2 ?? 0) - (a.properties.area_km2 ?? 0))
    .slice(0, 3);
  const dataTier: DataTier = isNisar ? "LOCAL_RUN" : "EMPTY";
  const headerCaseName = data?.site_name || data?.case_study?.site || (isNisar ? "Latest processed study" : "Global observations");
  const railCaseName = headerCaseName.replace(/\s+(?:event\s+)?study box$/i, "").replace(/\s+mapped boundary$/i, "");
  const caseControl = <select className="wx-casepick" aria-label="Choose a saved study run" value={selectedRun} onChange={(event) => selectRun(event.target.value)}>
    <option value="">No study selected</option>
    {savedRuns.map((run) => <option key={run.run_id} value={run.run_id}>{run.site_name} · {run.baseline_date} → {run.selected_date}</option>)}
  </select>;
  const questContent = questCandidates.length ? <div className="wx-quest__chips" aria-label="Largest candidates in this selected observation">
    {questCandidates.map((feature, index) => <button key={feature.properties.id} type="button" onClick={() => selectCandidate(feature.properties.id ?? null)} title="Select and inspect this candidate">
      <span>{index + 1}</span><span className="wx-mono">{(feature.properties.area_km2 ?? 0).toFixed(2)} km²</span>
    </button>)}
  </div> : <span className="global-quest-empty">{isNisar ? "No candidates for this observation" : <>No processed study selected — <Link className="global-data-link" href="/wetland">explore the featured Tanguar Haor case</Link> (7 real NISAR dates, 30 Jun → 22 Sep 2026; 24.48 km² of radar-change candidates at peak)</>}</span>;
  const processingPanel = <>
<NisarProcessingPanel bounds={areaBounds} boundary={areaBoundary} drawing={areaDrawing}
        onDraw={setAreaDrawing} onAreaChange={applyArea}
        savedAreas={savedRuns} onLoadSavedArea={loadSavedAreaForProcessing}
        loadedArea={isNisar && data?.boundary && data.baseline_date && data.case_study?.event_date ? {
          runId: data.run_id, name: data.site_name || data.case_study.site || "Study area", boundary: data.boundary,
          baselineDate: data.baseline_date, eventDate: data.case_study.event_date } : null}
        onRunReady={loadFinishedRun} />
  </>;
  const checkPanel = <>
      {(loading || !isNisar) && <div className="detection-note detection-note--static" role={loading ? "status" : "note"}>
        <strong>{loading ? "Loading study evidence…" : "Evidence tools need a saved NISAR study"}</strong>
        <span>{loading
          ? "Radar comparisons and independent-reference checks will appear when the selected study finishes loading."
          : "The Radar comparison, date-specific reference check, and optical evidence are still available here. Load a saved run from Explore to show its measured inputs."}</span>
        {!loading && <><Link className="global-data-link" href="#nisar-run-controls">Choose a saved study in Explore ↑</Link> or <Link className="global-data-link" href="/wetland">explore the featured Tanguar Haor case →</Link></>}
      </div>}
{isNisar && data?.selected_date && !loading && <RadarComparison runId={data.run_id} date={data.selected_date} refreshKey={refreshKey} />}
      {isNisar && data?.selected_date && !loading && <SavedDateCheck runId={data.run_id} date={data.selected_date} refreshKey={refreshKey} />}
{isNisar && data?.case_study && !loading && <ReferenceEvidence runId={data.run_id} refreshKey={refreshKey} />}
  </>;
  const learnPanel = <>
{isNisar && data?.case_study ? <section className="nisar-case-story" aria-labelledby="nisar-case-story-title">
        <div className="nisar-case-story__heading">
          <div><p className="global-eyebrow">FEATURED CASE · {data.case_study.site ?? "LOCAL STUDY AREA"}</p>
            <h2 id="nisar-case-story-title">{data.case_study.title ?? "NISAR change case"}</h2></div>
        <span className={`global-source-pill ${data.case_study.reference_validation?.status === "CROSS_SENSOR_CHECK" && (data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) !== 0 ? "global-source-pill--live" : "global-source-pill--snapshot"}`}>
            {data.case_study.reference_validation?.status === "CROSS_SENSOR_CHECK" ? (data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) === 0 ? "HLS check complete · no change overlap" : "HLS cross-sensor check complete"
              : data.case_study.reference_validation?.status === "UNAVAILABLE" ? "HLS data unavailable"
                : data.case_study.reference_validation?.status === "NOT_RUN" ? "HLS check not run" : "HLS check inconclusive"}
          </span>
        </div>
        <p className="nisar-case-story__lead">
          {data.case_study.candidate_patches
            ? `From ${data.case_study.baseline_date} to ${data.case_study.event_date}, the NISAR change rules flagged ${data.case_study.candidate_area_km2?.toFixed(2) ?? "0.00"} km² across ${data.case_study.candidate_patches} candidate region${data.case_study.candidate_patches === 1 ? "" : "s"} inside the ${data.case_study.site ?? "study area"} mask. These are places to investigate, not confirmed flood detections.`
            : `For the ${data.case_study.baseline_date} → ${data.case_study.event_date} pair, the detector produced no candidate regions inside its processed study mask. This does not establish that no flooding or surface change occurred.`}
        </p>
        <div className="nisar-case-story__grid">
          <article className="nisar-case-step">
            <span className="nisar-case-step__number">01 · OBSERVATIONS</span>
            <h3>Matched radar dates</h3>
            <p><strong>{data.case_study.method?.baseline_method?.baseline_observation_count && data.case_study.method.baseline_method.baseline_observation_count > 1 ? `Median baseline · ${data.case_study.method.baseline_method.baseline_observation_dates?.join(", ")}` : data.case_study.baseline_date}</strong> baseline<br /><strong>{data.case_study.event_date}</strong> comparison</p>
            <p className="nisar-case-step__detail">NISAR L2 GCOV provisional · {(data.case_study.polarizations ?? ["HHHH", "HVHV"]).join(" / ")}</p>
            {data.case_study.input_origin === "SAVED_NISAR_DB_SUBSETS" && <p className="nisar-case-step__detail">Measured radar subsets reused from saved run {data.case_study.source_run_id?.slice(0, 8)}. The original case remains in Saved analyses.</p>}
            {data.case_study.date_pair_selection && <p className="nisar-case-step__detail">Date selection screened {data.case_study.date_pair_selection.screened_scenes} optical scenes across {data.case_study.date_pair_selection.candidate_pairs} radar pairs. {data.case_study.date_pair_selection.method}</p>}
            <code tabIndex={0} title={`${(data.case_study.baseline_scenes ?? [data.case_study.baseline_scene]).filter(Boolean).join("\n")}\n${data.case_study.event_scene ?? ""}`}>{data.case_study.baseline_scenes?.length ? `${data.case_study.baseline_scenes.length} baseline scenes · ${data.case_study.baseline_scenes[0]}${data.case_study.baseline_scenes.length > 1 ? " …" : ""}` : data.case_study.baseline_scene ?? "Baseline scene not recorded"}<br />{data.case_study.event_scene ?? "Comparison scene not recorded"}</code>
          </article>
          <article className="nisar-case-step">
            <span className="nisar-case-step__number">02 · DETECTOR RESULT</span>
            <h3>{data.case_study.candidate_area_km2?.toFixed(2) ?? "0.00"} km² flagged by rules</h3>
            {Object.entries(data.case_study.classes ?? {}).length ? Object.entries(data.case_study.classes ?? {}).map(([name, summary]) => <p key={name}><strong>{name === "OPEN_WATER" ? "HH darkening candidate" : name === "VEGETATED_INUNDATION" ? "HH increase / HV stability candidate" : name.replaceAll("_", " ").toLowerCase()}</strong> · {summary.patches} regions · {summary.area_km2.toFixed(2)} km² · ΔHH {summary.mean_delta_hh_db?.toFixed(2) ?? "—"} dB</p>) : <p>No algorithmic candidate polygons were produced for this pair.</p>}
            <p className="nisar-case-step__detail">Rules run only within the configured study boundary, after HH/HV alignment and validity masking. HH darkening does not establish a dry-to-water transition or a flood.</p>
            {data.case_study.method?.baseline_method && <p className="nisar-case-step__detail">Baseline: {data.case_study.method.baseline_method.baseline_observation_count ?? 1} preceding observation(s) · {(data.case_study.method.baseline_method.baseline_observation_dates ?? []).join(", ")}. {data.case_study.method.baseline_method.baseline_hh_temporal_mad_db != null ? `Median HH temporal MAD ${data.case_study.method.baseline_method.baseline_hh_temporal_mad_db.toFixed(2)} dB.` : "Single-observation spread is not estimated."}</p>}
          </article>
          <article className="nisar-case-step">
            <span className="nisar-case-step__number">03 · INDEPENDENT SENSOR</span>
            <h3>{data.case_study.reference_validation?.reference_product ?? "HLS optical reference unavailable"}</h3>
            {data.case_study.reference_validation?.status === "CROSS_SENSOR_CHECK" ? <>
              <p>Clear overlap: <strong>{((data.case_study.reference_validation.optical_support?.common_clear_fraction ?? data.case_study.reference_validation.coverage?.common_clear_fraction ?? 0) * 100).toFixed(1)}%</strong> of the study mask</p>
              <p className="nisar-case-step__detail">{(data.case_study.reference_validation.optical_support?.common_clear_area_km2 ?? data.case_study.reference_validation.coverage?.common_clear_area_km2)?.toFixed(2) ?? "—"} km² could be compared. The remaining {(100 - (data.case_study.reference_validation.optical_support?.common_clear_fraction ?? data.case_study.reference_validation.coverage?.common_clear_fraction ?? 0) * 100).toFixed(1)}% is unassessed by this reference.</p>
              <p>{data.case_study.reference_validation.optical_support ? "Area-weighted precision" : "Legacy grid precision"} <strong>{(data.case_study.reference_validation.optical_support?.precision ?? data.case_study.reference_validation.metrics?.precision) == null ? "—" : `${((data.case_study.reference_validation.optical_support?.precision ?? data.case_study.reference_validation.metrics?.precision ?? 0) * 100).toFixed(1)}%`}</strong> · Recall <strong>{(data.case_study.reference_validation.optical_support?.recall ?? data.case_study.reference_validation.metrics?.recall) == null ? "—" : `${((data.case_study.reference_validation.optical_support?.recall ?? data.case_study.reference_validation.metrics?.recall ?? 0) * 100).toFixed(1)}%`}</strong> · F1 <strong>{(data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) == null ? "—" : `${((data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1 ?? 0) * 100).toFixed(1)}%`}</strong></p>
              {data.case_study.reference_validation.optical_support?.precision != null
                ? <p className="nisar-case-step__detail">Area-weighted on native HLS cells, {(data.case_study.reference_validation.optical_support.precision * 100).toFixed(1)}% of the assessed HH-darkening candidate area overlaps newly wet HLS support. This is satellite agreement, not confirmed flood accuracy.</p>
                : data.case_study.reference_validation.metrics?.precision != null && <p className="nisar-case-step__detail">Legacy radar-grid comparison: {(data.case_study.reference_validation.metrics.precision * 100).toFixed(1)}% of assessed radar candidate pixels overlap newly wet HLS pixels. This is satellite agreement, not confirmed flood accuracy.</p>}
              {(data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) === 0 && <p><strong>No overlapping change support.</strong> This comparison does not corroborate the candidates. Different acquisition dates, shoreline mixtures and radar effects require further investigation.</p>}
              <p className="nisar-case-step__detail">MNDWI &gt; {data.case_study.reference_validation.comparison?.mndwi_threshold?.toFixed(2) ?? "0.00"} on cloud-screened {data.case_study.reference_validation.comparison?.spatial_resolution_m ?? 30} m HLS cells. The separate score area-averages valid and candidate radar support to that native grid. Dates: {data.case_study.reference_validation.comparison?.baseline?.hls_date ?? "—"} → {data.case_study.reference_validation.comparison?.event?.hls_date ?? "—"}.</p>
            </> : <p>{data.case_study.reference_validation?.reason ?? "No independent reference result is available for this case."}</p>}
            {data.case_study.reference_validation?.selection && <p className="nisar-case-step__detail">{data.case_study.reference_validation.selection.evaluated_pairs} of {data.case_study.reference_validation.selection.available_pairs} date-matched pairs evaluated. {data.case_study.reference_validation.selection.method}</p>}
            {data.case_study.reference_validation?.selection?.catalog_searches && <p className="nisar-case-step__detail">Collections searched: {data.case_study.reference_validation.selection.catalog_searches.map((item) => `${item.collection}: ${item.status === "SEARCHED" ? `${item.records} records` : "unavailable"}`).join(" · ")}</p>}
            {data.case_study.reference_validation?.comparison && <p className="nisar-case-step__detail">Before reference: {data.case_study.reference_validation.comparison.baseline?.product || "S30"}, {data.case_study.reference_validation.comparison.baseline?.offset_days ?? "—"} days from radar. After reference: {data.case_study.reference_validation.comparison.event?.product || "S30"}, {data.case_study.reference_validation.comparison.event?.offset_days ?? "—"} days from radar.</p>}
            {data.case_study.reference_validation?.status !== "CROSS_SENSOR_CHECK" && data.case_study.reference_validation?.comparison && <p className="nisar-case-step__detail">Reference dates: {data.case_study.reference_validation.comparison.baseline?.hls_date} → {data.case_study.reference_validation.comparison.event?.hls_date}. Common clear coverage: {((data.case_study.reference_validation.coverage?.common_clear_fraction || 0)*100).toFixed(1)}%.</p>}
            <a href="#nisar-process">Retry the independent reference check ↑</a>
            <p><a href="#nisar-reference-evidence">Inspect optical images and the disagreement ↓</a></p>
            <p className="nisar-case-step__detail">Cross-sensor agreement is not field truth or a formal accuracy estimate; vegetated inundation is not checked.</p>
            <a className="detection-worldview-link" href={data.case_study.reference_validation?.source_url || "https://hls.gsfc.nasa.gov/data-products/"} target="_blank" rel="noreferrer">NASA HLS reference source ↗</a>
          </article>
          <article className="nisar-case-step">
            <span className="nisar-case-step__number">04 · UNCERTAINTY</span>
            <h3>{data.case_study.uncertainty?.threshold_sensitivity?.stability_verdict ?? "Threshold stability unavailable"}</h3>
            <p>{data.case_study.uncertainty?.threshold_sensitivity?.stable_range?.length ? `Candidate area was swept across ${data.case_study.uncertainty.threshold_sensitivity.stable_range[0].toFixed(1)}–${data.case_study.uncertainty.threshold_sensitivity.stable_range.at(-1)?.toFixed(1)} dB.` : data.case_study.uncertainty?.threshold_sensitivity?.sensitivity_note ?? "Threshold sensitivity was not computed."}</p>
            <p className="nisar-case-step__detail">{data.case_study.method?.validity_rule} GCOV is provisional; thresholds are exploratory and not field-calibrated.</p>
            {data.case_study.method?.gcov_quality && <>
              <p className="nisar-case-step__detail">numberOfLooks rule: {data.case_study.method.gcov_quality.number_of_looks_rule}. Averaging mask: {data.case_study.method.gcov_quality.mask_rule}.</p>
              {!!data.case_study.method.gcov_quality.scenes?.length && <p className="nisar-case-step__detail">Per-scene median numberOfLooks: {data.case_study.method.gcov_quality.scenes.map((item) => `${item.scene?.slice(-20) ?? "scene"} ${item.number_of_looks_median?.toFixed(1) ?? "—"}`).join(" · ")}.</p>}
            </>}
          </article>
        </div>
        <div className="nisar-case-story__impact"><strong>Why this matters</strong><p>{data.case_study.impact_context}</p></div>
        <p className="nisar-case-story__scope">{data.case_study.spatial_scope}</p>
      </section> : <section className="nisar-case-story nisar-case-story--empty" aria-labelledby="nisar-case-story-title">
        <div><p className="global-eyebrow">CASE STUDY · AWAITING REAL PIPELINE OUTPUT</p><h2 id="nisar-case-story-title">No real NISAR change case is loaded</h2>
          <p>Worldwide footprints mark acquisitions only. Run the real NISAR pipeline for the configured study boundary to create a before-and-after result and attempt the independent HLS Sentinel-2/Landsat cross-check. Until then, blank areas mean no detector result is available.</p>
          <Link className="global-data-link" href="/wetland?source=raster">Open the NISAR processing workspace <span>Run a real NISAR analysis ↗</span></Link></div>
      </section>}

      <MozambiqueFloodCase
        onLocate={locateMozambiqueCase}
        onOpenRun={() => {
          loadFinishedRun("ec8fa5ee15ae41d1aa89f930f2b47e36");
          window.dispatchEvent(new CustomEvent("geonexsar:open-panel", { detail: "nisar-run-controls" }));
        }}
      />

      <BandPenetrationExplainer variant="wetland" />
  </>;
  const observationDates = data?.dates ?? [];
  const activeObservationDate = candidateDate || data?.selected_date || '';
  const opticalRadarComparison = useMapOpticalRadarComparison({
    open: mapComparisonOpen,
    runId: isNisar && !loading ? data?.run_id ?? null : null,
    selectedDate: activeObservationDate || null,
    channel: radarChannel,
    refreshKey,
    session: comparisonSession,
  });
  const comparisonMapLayer = mapComparisonOpen && opticalRadarComparison.layer
    ? { ...opticalRadarComparison.layer, position: comparisonPosition }
    : null;
  const radarBaselineDates = data?.selected_baseline?.baseline_observation_dates?.length
    ? data.selected_baseline.baseline_observation_dates
    : data?.case_study?.method?.baseline_method?.baseline_observation_dates?.length
      ? data.case_study.method.baseline_method.baseline_observation_dates
      : data?.case_study?.baseline_date
        ? [data.case_study.baseline_date]
        : data?.baseline_observation_dates?.length
          ? data.baseline_observation_dates
          : data?.baseline_date ? [data.baseline_date] : [];
  const radarBaselineDateLabel = radarBaselineDates.length > 1
    ? `Median · ${radarBaselineDates[0]}–${radarBaselineDates[radarBaselineDates.length - 1]}`
    : radarBaselineDates[0] ?? "Baseline date unavailable";
  const radarStageDateLabel = radarStage === "before"
    ? radarBaselineDateLabel
    : radarStage === "change"
      ? `${radarBaselineDateLabel} → ${activeObservationDate || "Select a study date"}`
      : activeObservationDate || "Select a study date";
  const radarPreviewRunId = data?.data_source === "NISAR" ? data.run_id : "";
  const radarPreviewKey = radarPreviewRunId && activeObservationDate
    ? `${radarPreviewRunId}|${activeObservationDate}`
    : "";

  useEffect(() => {
    if (!radarPreviewKey) return;
    const controller = new AbortController();
    fetch(`/api/wetland/radar?run=${encodeURIComponent(radarPreviewRunId)}&date=${encodeURIComponent(activeObservationDate)}`, { signal: controller.signal })
      .then(async (response) => {
        const preview = await response.json() as RadarPreviewResponse & { error?: string };
        if (!response.ok) throw new Error(preview.error || "This date has no saved radar preview.");
        if (preview.run_id !== radarPreviewRunId || preview.date !== activeObservationDate) throw new Error("The radar preview does not match the selected study date.");
        return preview;
      })
      .then((preview) => {
        if (controller.signal.aborted) return;
        setRadarImageStatus("idle");
        setRadarPreviewState({ key: radarPreviewKey, status: "ready", preview });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setRadarPreviewState({
          key: radarPreviewKey,
          status: "error",
          error: reason instanceof Error ? reason.message : "Radar preview unavailable.",
        });
      });
    return () => controller.abort();
  }, [activeObservationDate, radarPreviewKey, radarPreviewRunId]);

  const matchingRadarPreviewState = radarPreviewState?.key === radarPreviewKey ? radarPreviewState : null;
  const radarPreviewStatus = !radarPreviewKey ? "idle" : matchingRadarPreviewState?.status ?? "loading";
  const radarPreviewError = matchingRadarPreviewState?.status === "error" ? matchingRadarPreviewState.error : "";
  const radarPreview = matchingRadarPreviewState?.status === "ready" ? matchingRadarPreviewState.preview : null;
  const radarPreviewMatches = Boolean(radarPreview);
  const selectedRadarLayer = radarPreviewMatches ? radarPreview?.layers[radarChannel] : null;
  const radarImageFile = selectedRadarLayer?.images[radarStage];
  const localRadarLayer: LocalRadarMapLayer | null = showLocalRadar && mapMode === "RADAR" && data?.run_id && selectedRadarLayer && radarImageFile
    ? {
      imageUrl: `/api/wetland/artifact?run=${encodeURIComponent(data.run_id)}&file=${encodeURIComponent(radarImageFile)}`,
      bounds: selectedRadarLayer.bounds,
      channel: radarChannel,
      stage: radarStage,
      date: activeObservationDate,
    }
    : null;
  const radarControlsDisabled = !isNisar || radarPreviewStatus !== "ready" || !radarPreviewMatches;
  const radarControlNotice = !isNisar
    ? "Load a processed real NISAR study from Explore to enable its HH/HV rasters."
    : radarPreviewStatus === "loading" ? "Loading the selected date’s saved HH/HV radar preview…"
      : radarPreviewStatus === "error" ? radarPreviewError
        : showLocalRadar && radarImageStatus === "loading" ? "Loading this local radar image on the map…"
          : showLocalRadar && radarImageStatus === "error" ? "The saved radar image could not be displayed. Try another date or reopen the study."
            : "";

  return (
      <InvestigationWorkspace hazard="wetland" initialAnchorId={initialAnchorId} className="wetland-global-workspace" caseName={headerCaseName} caseControl={caseControl} dataTier={dataTier} satelliteBasemap={satelliteBasemap} onToggleBasemap={() => setSatelliteBasemap((value) => !value)} onReturnToOverview={returnToOverview} title="Explore NISAR across the world" subtitle="Track observations through time, then inspect candidates only where a real study has been processed." questContent={questContent} mapToolbar={<div className="wx-map-controls" aria-label="Map view and HH/HV radar layers">
        <ModeSwitch value={mapMode} onChange={handleMapModeChange} />
        <GlobalRadarLayerControls dateLabel={radarStageDateLabel} channel={radarChannel} stage={radarStage} disabled={radarControlsDisabled}
          showing={Boolean(localRadarLayer && radarImageStatus === "ready")} notice={radarControlNotice} onSelect={handleLocalRadarSelection} />
        <button ref={comparisonTriggerRef} type="button" className="wx-radar-trigger wx-comparison-trigger" aria-label={`${mapComparisonOpen ? "Close" : "Open"} the optical versus radar comparison`}
          aria-controls="map-optical-radar-comparison" aria-expanded={mapComparisonOpen}
          title={`${mapComparisonOpen ? "Hide" : "Compare"} optical and radar images over the map`}
          onClick={() => {
            if (mapComparisonOpen) closeMapComparison();
            else { setComparisonSession((value) => value + 1); setComparisonPosition(50); setFocusStudyArea(true); setMapComparisonOpen(true); }
          }}>
          {Icon.compare}<span>Optical ↔ radar</span>
        </button>
      </div>} rail={<>
          <p className="wx-micro">WORLDWIDE OBSERVATIONS · NASA NISAR L2 GCOV</p>
          <h2 id="global-detections-title">{isNisar ? railCaseName : "Global NISAR coverage"}</h2>
          <p className="wx-sub">Browse global radar observations and local change candidates. A blank map area has no processed result.</p>
          <p className="wx-mono wx-meta">{data?.product ?? "NASA NISAR L2 GCOV"} · {coverageData?.loadedFeatures.toLocaleString() ?? "—"} scene footprints · {coverageDate}</p>
          <div className={`wx-obsbox${isNisar ? " is-peak" : ""}`} aria-live="polite">
            <p className="wx-micro">{isNisar ? "Selected observation" : "Worldwide coverage"}</p>
            <p className="wx-date">{activeObservationDate ? displayObservationDate(activeObservationDate) : "Latest available mosaic"}</p>
            <p className="wx-big"><strong>{loading ? "…" : isNisar ? (data?.stats?.patches ?? detections.features.length).toLocaleString() : "—"}</strong> regions</p>
            <p className="wx-bigcap">experimental radar-change candidates · processed areas only</p>
            <p className="wx-mono wx-count">{isNisar && data?.stats ? `${data.stats.area_km2.toFixed(2)} km² flagged` : "Worldwide footprints show acquisitions, not detections"}</p>
          </div>
          <p className="wx-read">Global false-colour backscatter gives radar context; it is not a flood classification. Local candidates are exploratory and do not confirm a flood.</p>
          <CaseWalkthrough hasRun={Boolean(isNisar && data?.case_study && !loading)} />
          <div className="global-status-row detection-status" aria-live="polite">
            <div className="global-status-meta">
              <span className={`global-source-pill ${localRadarLayer ? radarImageStatus === "error" ? "global-source-pill--error" : radarImageStatus === "loading" ? "global-source-pill--loading" : "global-source-pill--live" : showNisarMosaic ? mosaicStatus === "loading" ? "global-source-pill--loading" : mosaicStatus === "error" ? "global-source-pill--error" : "global-source-pill--live" : "global-source-pill--snapshot"}`}><i aria-hidden="true" />{localRadarLayer ? radarImageStatus === "error" ? "Local radar image unavailable" : radarImageStatus === "loading" ? `Loading local ${radarChannel.toUpperCase()} · ${radarStage}` : `Local ${radarChannel.toUpperCase()} · ${radarStage} · ${radarStageDateLabel}` : showNisarMosaic ? mosaicStatus === "loading" ? "Loading NISAR radar layer…" : mosaicStatus === "error" ? "NISAR radar layer unavailable" : "NASA GIBS · worldwide radar mosaic" : "Radar layer hidden · select Radar mode"}</span>
              {isNisar && data?.stats && <span className="nisar-area-stat"><strong>{data.stats.area_km2.toFixed(2)} km²</strong> mapped candidate area</span>}
              <span className={`global-source-pill ${statusClass}`}><i aria-hidden="true" />{statusText}</span>
              <span className={`global-source-pill ${coverageLoading || coverageRefreshing ? "global-source-pill--loading" : coverageError && !coverageData ? "global-source-pill--error" : coverageData?.snapshotFallback ? "global-source-pill--snapshot" : "global-source-pill--live"}`}><i aria-hidden="true" />{coverageLoading && !coverageData ? "Loading worldwide footprints…" : coverageRefreshing ? `Saved snapshot · ${coverageData?.loadedFeatures.toLocaleString() ?? 0} footprints · refreshing NASA CMR…` : coverageError && coverageData?.snapshotFallback ? `Saved snapshot · ${coverageData.loadedFeatures.toLocaleString()} footprints · NASA unavailable` : coverageError ? "Footprints unavailable" : coverageData?.snapshotFallback ? `NASA CMR snapshot · ${coverageData.loadedFeatures.toLocaleString()} footprints` : `${coverageData?.loadedFeatures.toLocaleString() ?? 0} NISAR footprints · ${coverageDate}`}</span>
              <button className="global-refresh" type="button" onClick={() => { setLoading(true); setError(""); setCoverageLoading(true); setCoverageRefreshing(Boolean(coverageData)); setCoverageError(""); setCoverageRefreshKey((value) => value + 1); setRefreshKey((value) => value + 1); }} disabled={loading}>Refresh results</button>
            </div>
          </div>
          <Link className="global-data-link" href="/wetland/global/scenes">Browse worldwide scene records ↗</Link>
        </>} map={<div className="global-map-panel">
          <div id="global-nisar-map" className="global-map-wrap" role="region" aria-label="Worldwide NISAR backscatter mosaic with processed candidate overlay">
            <GlobalNisarDetectionMap
              detections={detections}
              boundary={isNisar ? data?.boundary ?? null : null}
              coverage={coverage}
              date={mosaicDate || null}
              focusStudyArea={focusStudyArea}
              focusSelectedCandidate={Boolean(selectedCandidateId)}
              coordinateTarget={coordinateTarget}
              selectedCandidateId={selectedCandidateId}
              onCandidateSelect={selectCandidate}
              showCandidates={!mapComparisonOpen}
              showBasemap={satelliteBasemap}
              showFootprints={showFootprints}
              showNisarMosaic={showNisarMosaic && !mapComparisonOpen}
              localRadarLayer={mapComparisonOpen ? null : localRadarLayer}
              comparisonLayer={comparisonMapLayer}
              onLocalRadarReady={() => setRadarImageStatus("ready")}
              onLocalRadarError={() => setRadarImageStatus("error")}
              viewMode={mapMode}
              onLayerReady={() => setMosaicStatus("ready")}
              onLayerError={() => setMosaicStatus((current) => current === "ready" ? current : "error")}
              resultKey={`${data?.run_id}-${data?.selected_date}`}
              areaBounds={areaBounds}
              areaDrawing={areaDrawing}
              onAreaSelected={(bounds) => { setAreaBounds(bounds); setAreaBoundary(null); setAreaDrawing(false); setManualCoordinateTarget({ key: coordinateQueryKey, target: null }); }}
            />
            {areaDrawing && <div className="nisar-drawing-notice" role="status">Click two opposite corners to select your study area. <button type="button" onClick={() => setAreaDrawing(false)}>Cancel</button></div>}
            {!mapComparisonOpen && !loading && !isNisar && <div className="detection-map-badge" role="status">No detector result loaded · blank map areas are not classified</div>}
            {!mapComparisonOpen && !loading && isNisar && detections.features.length === 0 && <div className="detection-map-badge" role="status">No candidates inside the processed boundary for {data?.selected_date} · elsewhere: no result</div>}
            {error && <div className="detection-map-badge detection-map-badge--error" role="alert">Could not load detector output: {error}</div>}
            {showNisarMosaic && mosaicStatus === "error" && <div className="detection-map-badge detection-map-badge--error" role="alert">NASA has no mosaic tiles for this date, or the tile service is unreachable. Choose another date or open NASA Worldview.</div>}
            {localRadarLayer && radarImageStatus === "error" && <div className="detection-map-badge detection-map-badge--error" role="alert">The selected local HH/HV image could not be loaded. Check that its published preview artifact exists.</div>}
          </div>
          {mapComparisonOpen && <MapOpticalRadarComparison layer={opticalRadarComparison.layer} status={opticalRadarComparison.status}
            message={opticalRadarComparison.message} position={comparisonPosition} onPositionChange={setComparisonPosition} />}
          <div className="global-map-legend detection-legend" aria-label="Map legend">
            {showNisarMosaic && <span><i className="detection-legend-swatch detection-legend-swatch--backscatter" />NISAR GCOV false-colour radar mosaic</span>}
            {localRadarLayer && <span><i className="detection-legend-swatch" style={{ background: radarStage === "change" ? "linear-gradient(90deg, #2166AC, #F7F7F7, #B2182B)" : "linear-gradient(90deg, #161616, #f2f2f2)" }} />Local NISAR {radarChannel.toUpperCase()} · {radarStage === "before" ? "baseline" : radarStage} · {radarStageDateLabel}</span>}
            {showFootprints && <span><i className="detection-legend-swatch detection-legend-swatch--coverage" style={{ background: "linear-gradient(135deg, #5AC8D8 50%, #F2A45A 50%)" }} />Acquired scenes · {coverageDate} · cyan ascending / amber descending</span>}
            {mapMode === "DETECTION" ? <>
              <span><i className="detection-legend-swatch" style={{ background: "#F2A45A" }} />Open-water class · exploratory</span>
              <span><i className="detection-legend-swatch" style={{ background: "#F7D2A6" }} />Vegetated-inundation class · exploratory</span>
              <span><i className="detection-legend-swatch" style={{ background: "#8996A0" }} />Uncertain class</span>
              <span><i className="detection-legend-swatch" style={{ background: "repeating-linear-gradient(135deg, #F2A45A 0 2px, #8996A0 2px 4px)" }} />Lower-confidence or unverified evidence · dashed outline</span>
            </> : <>
              <span><i className="detection-legend-swatch" style={{ background: "#F2A45A", opacity: 0.85 }} />Rules agree</span>
              <span><i className="detection-legend-swatch" style={{ background: "#F2A45A", opacity: 0.45 }} />Partly agree</span>
              <span><i className="detection-legend-swatch" style={{ background: "repeating-linear-gradient(135deg, rgba(242,164,90,.9) 0 2px, transparent 2px 4px)" }} />Uncertain</span>
              <span><i className="detection-legend-swatch" style={{ background: "transparent", border: "1px solid #8996A0" }} />No candidate · not “unchanged”</span>
            </>}
            {selectedCandidateId && <span><i className="detection-legend-swatch" style={{ background: "#ffffff", border: "2px solid #ffffff" }} />Selected candidate · white outline</span>}
            <span><i className="detection-legend-swatch detection-legend-swatch--unprocessed" />Outside boundary · no result available</span>
            <span className="global-legend-note">Dashed outline · study boundary</span>
          </div>
        </div>} drawerTabs={[
          { id: "EXPLORE", number: "01", label: "Explore", hint: "Browse worldwide observations and local study results", anchorIds: ["nisar-run-controls", "nisar-process"], content: <>
          <aside className="global-scene-panel detection-info-panel" aria-label="Global mosaic and local detection controls">
          <div className="global-scene-panel__heading">
            <div><p className="global-eyebrow">GLOBAL SATELLITE OBSERVATIONS</p><h2>Worldwide NISAR mosaic</h2></div>
            <span className="global-live-mark"><i />NASA GIBS</span>
          </div>
          <p className="detection-panel-copy">The global layer is NASA’s false-color NISAR GCOV backscatter mosaic. It shows radar observations around the world; the colors are not flood or wetland classifications.</p>

          <details className="map-coordinate-disclosure" open={coordinateToolOpen} onToggle={(event) => setCoordinateToolOpen(event.currentTarget.open)}>
            <summary><span>Go to coordinates</span><small>Optional</small></summary>
            <form className="map-coordinate-form" onSubmit={searchCoordinates} noValidate>
            <div className="map-coordinate-fields">
              <div>
                <label htmlFor="map-coordinate-latitude">Latitude</label>
                <input id="map-coordinate-latitude" className="map-coordinate-input" type="text" inputMode="decimal" autoComplete="off" placeholder="25.1500 or 25°09′ N" value={coordinateLatitude} onChange={(event) => { setCoordinateDraft({ key: coordinateQueryKey, latitude: event.target.value, longitude: coordinateLongitude }); setCoordinateError(""); }} aria-invalid={Boolean(coordinateError)} aria-describedby={coordinateError ? "map-coordinate-help map-coordinate-error" : "map-coordinate-help"} />
              </div>
              <div>
                <label htmlFor="map-coordinate-longitude">Longitude</label>
                <input id="map-coordinate-longitude" className="map-coordinate-input" type="text" inputMode="decimal" autoComplete="off" placeholder="91.0667 or 91°04′ E" value={coordinateLongitude} onChange={(event) => { setCoordinateDraft({ key: coordinateQueryKey, latitude: coordinateLatitude, longitude: event.target.value }); setCoordinateError(""); }} aria-invalid={Boolean(coordinateError)} aria-describedby={coordinateError ? "map-coordinate-help map-coordinate-error" : "map-coordinate-help"} />
              </div>
            </div>
            <p className="map-coordinate-help" id="map-coordinate-help">Decimal or degrees/minutes/seconds · map latitude −85.0511 to 85.0511 · longitude −180 to 180</p>
            {coordinateError && <p className="map-coordinate-error" id="map-coordinate-error" role="alert">{coordinateError}</p>}
            <button className="map-coordinate-search-button" type="submit">Search map</button>
            {coordinateTarget && <p className="map-coordinate-result" role="status">{querySite ? `${querySite} · ` : ""}Map centered at {coordinateTarget.latitude.toFixed(5)}°, {coordinateTarget.longitude.toFixed(5)}°. A pin marks a point; choose an area boundary before searching for a study.</p>}
            </form>
          </details>

          <details className="map-layer-settings">
            <summary>
              <span>Map layers and dates</span>
              <small>{showNisarMosaic ? "Mosaic on" : "Mosaic off"} · {showFootprints ? "Footprints on" : "Footprints off"}</small>
            </summary>
            <div className="map-layer-settings__content">
              <p className="detection-panel-copy">Choose which observations sit beneath the study boundary and candidate regions.</p>
              <div className="detection-layer-toggles" role="group" aria-label="Map layers">
                <label><input type="checkbox" checked={showNisarMosaic} onChange={(event) => { setShowNisarMosaic(event.target.checked); if (event.target.checked) setMosaicStatus("loading"); }} />NASA NISAR false-colour radar mosaic</label>
                <label><input type="checkbox" checked={showFootprints} onChange={(event) => setShowFootprints(event.target.checked)} />Worldwide scene footprints</label>
              </div>

              <label className="detection-field-label" htmlFor="nisar-mosaic-date">Mosaic date (UTC)</label>
              <div className="detection-date-row">
                <input id="nisar-mosaic-date" className="detection-date-input" type="date" max={today} value={mosaicDate} onChange={(event) => { setMosaicStatus("loading"); setMosaicDate(event.target.value); }} />
                {mosaicDate && <button className="global-refresh" type="button" onClick={() => { setMosaicStatus("loading"); setMosaicDate(""); }}>Latest</button>}
              </div>
              <p className="detection-helper">Choose a date with available tiles, or leave blank to use the latest date published by NASA GIBS. The mosaic appears in Radar mode or when enabled above.</p>

              <label className="detection-field-label" htmlFor="nisar-coverage-date">Worldwide scene footprints (UTC)</label>
              <input id="nisar-coverage-date" className="detection-date-input" type="date" min="2026-06-17" max={today} value={coverageDate} onChange={(event) => { setCoverageLoading(true); setCoverageRefreshing(false); setCoverageData(null); setCoverageError(""); setCoverageDate(event.target.value); }} />
              <p className="detection-helper">{coverageRefreshing ? `Showing the saved ${coverageDate} footprint snapshot while NASA’s live catalog refreshes.` : coverageError ? coverageError : coverageLoading ? "Checking NASA’s global catalog…" : `${coverageData?.totalHits.toLocaleString() ?? 0} catalog records · ${coverageData?.loadedFeatures.toLocaleString() ?? 0} footprints shown.`} Each outline marks an acquired scene, not a flood detection.</p>
            </div>
          </details>

          <div className="detection-note detection-note--static">
            <strong>Backscatter is not a detection</strong>
            <span>Global false-color imagery provides SAR context. Flood or inundation candidates require a temporal classifier and can only be overlaid where this project has processed NISAR scenes.</span>
          </div>

          <details className="detection-note detection-note--radar-guide">
            <summary>How radar reveals different kinds of flooding</summary>
            <div className="detection-radar-guide__content">
              <p>NISAR sends microwave signals and measures what returns from the ground. It can observe through clouds and at night, and its L-band signal can help reveal water beneath vegetation.</p>
              <ul>
                <li><strong>Open water:</strong> often has a low, dark return in radar imagery.</li>
                <li><strong>Flooded vegetation:</strong> water among trees or marsh plants can create a different, sometimes stronger return than dry vegetation.</li>
              </ul>
              <p className="detection-radar-guide__caveat">These are common patterns, not a universal color key. The signal also depends on land cover, polarization, viewing geometry, and image processing. The global mosaic colors alone are not a flood classification.</p>
              <p><strong>Read this run:</strong> dates and radar layers appear under <em>Radar-change candidates</em>; its change rules show the detector method. The case study below reports the independent check and threshold sensitivity when they are available.</p>
              <a className="detection-radar-guide__case-link" href="#nisar-case-story-title">Go to this run’s reference and uncertainty details ↓</a>
              <div className="detection-radar-guide__sources" aria-label="Radar flood mapping sources">
                <a href="https://www.youtube.com/watch?v=2ZMW051InVY" target="_blank" rel="noopener noreferrer">JPL talk · NISAR for Flood Mapping ↗</a>
                <a href="https://svs.gsfc.nasa.gov/5661" target="_blank" rel="noopener noreferrer">NASA example · NISAR flood observations in Mozambique ↗</a>
                <p>The talk’s Hurricane Matthew example is from 2016, before NISAR’s <a href="https://science.nasa.gov/mission/nisar/mission-overview/" target="_blank" rel="noopener noreferrer">2025 launch</a>; it illustrates radar mapping, not a NISAR observation.</p>
              </div>
            </div>
          </details>

          <a className="global-data-link" href="#nisar-process">Process another place <span>Select an area, find a NISAR pair and follow its progress ↓</span></a>

          <div className="detection-local-results" id="nisar-run-controls">
            <div className="global-scene-panel__heading">
              <div><p className="global-eyebrow">DERIVED LAYER · LOCAL RUN</p><h2>{isNisar ? "Radar-change candidates" : "No real candidates loaded"}</h2></div>
              <span className={`global-live-mark ${isNisar ? "" : "detection-static-mark"}`}><i />{isNisar ? "NISAR run" : data?.data_source === "SIMULATED_DEMO" ? "Demo data" : "No run"}</span>
            </div>
              <label className="detection-field-label" htmlFor="nisar-saved-run">Saved study areas and runs</label>
              <select id="nisar-saved-run" className="detection-select" value={selectedRun} onChange={(event) => selectRun(event.target.value)}>
                <option value="">No study selected</option>
                {savedRuns.map((run) => <option key={run.run_id} value={run.run_id}>{run.site_name} · {run.baseline_date} → {run.selected_date} · {run.run_id.slice(0, 6)}</option>)}
              </select>
              {runsError && <p className="nisar-tool-error">{runsError}</p>}
            {isNisar ? <>
              <p className="detection-panel-copy">{detections.features.length} candidate regions · {data?.stats?.area_km2.toFixed(2) ?? "0.00"} km² · {data?.selected_date}. Results cover the processed study area only.</p>
              <label className="detection-field-label" htmlFor="nisar-candidate-date">Processed observation</label>
              <select id="nisar-candidate-date" className="detection-select" value={candidateDate || data?.selected_date || ""} onChange={(event) => selectObservation(event.target.value)}>
                {data?.dates.map((observationDate) => <option key={observationDate} value={observationDate}>{observationDate}</option>)}
              </select>
              <dl className="nisar-run-details">
                <div><dt>Product</dt><dd>{data?.product ?? "NISAR L2 GCOV"}</dd></div>
                <div><dt>{(data?.selected_baseline?.baseline_observation_count ?? 1) > 1 ? "Radar baseline dates" : "Date pair"}</dt><dd>{data?.selected_baseline?.baseline_observation_dates?.join(", ") ?? data?.baseline_date ?? "?"} → {data?.selected_date ?? "?"}</dd></div>
                <div><dt>Radar layers</dt><dd>{data?.polarizations.join(" · ") || "Not recorded"}</dd></div>
                <div><dt>Input scenes</dt><dd title={`${data?.selected_baseline?.baseline_scene_names?.join("\n") ?? data?.baseline_scene ?? ""}\n${data?.selected_scene ?? ""}`}>{data?.selected_baseline?.baseline_scene_names?.length ?? (data?.baseline_scene ? 1 : 0)} baseline scene(s) / {data?.selected_scene ? `${data.selected_scene.slice(0, 24)}…` : "Not recorded"}</dd></div>
                <div><dt>Optical cross-check</dt><dd>{data?.case_study?.reference_validation?.status === "CROSS_SENSOR_CHECK" ? (data.case_study.reference_validation.optical_support?.f1 ?? data.case_study.reference_validation.metrics?.f1) === 0 ? "Complete · no area overlap" : "Comparison complete" : data?.case_study?.reference_validation?.status?.replaceAll("_", " ").toLowerCase() ?? "Not available"}</dd></div>
              </dl>
              {data?.case_study?.method && <div className="detection-method-summary">
                <strong>Change rules · {data.case_study.method.threshold_db?.toFixed(1) ?? "—"} dB base cutoff</strong>
                <span>HH darkening rule · {data.case_study.method.open_water_rule}</span>
                <span>{data.case_study.method.vegetated_inundation_rule}</span>
              </div>}
              <div className="detection-scope-actions">
                <button className="global-refresh" type="button" onClick={() => setFocusStudyArea(true)} disabled={!data?.boundary}>Zoom to processed area</button>
                <button className="global-refresh" type="button" onClick={() => setFocusStudyArea(false)}>World view</button>
              </div>
              <p className="detection-helper">NISAR backscatter mosaic is global; derived candidate polygons are from run {data?.run_id.slice(0, 8)} only.</p>
              {data?.boundary_source && <p className="detection-helper">Study mask: {data.boundary_source}.</p>}
              {data?.run_id && data.selected_date && <CandidateEvidencePanel
                candidates={detections.features}
                selectedCandidateId={evidenceCandidateId}
                onCandidateSelect={selectCandidate}
                runId={data.run_id}
                selectedDate={data.selected_date}
                polarizations={data.polarizations}
                method={data.case_study?.method}
              />}
            </> : <>
              <p className="detection-panel-copy">The current pipeline run is marked <strong>{data?.data_source ?? "unavailable"}</strong>. Simulated polygons are hidden. The footprints and backscatter mosaic show observations only; no change result is loaded for the rest of the world.</p>
              <Link className="global-data-link" href="/wetland?source=raster">Open the NISAR processing workspace <span>Load or run the local study-area pipeline ↗</span></Link>
            </>}
          </div>

          <div className="detection-note">
            <strong>Map coverage</strong>
            <span>Scene footprints show acquisitions. The dashed outline shows the detector’s processed study mask. Blank land elsewhere means no detector result is available; it does not mean no change occurred.</span>
          </div>
          <Link className="global-data-link" href="/wetland/global/scenes">Inspect worldwide acquisition footprints <span>NASA CMR scene catalog ↗</span></Link>
          <a className="detection-worldview-link" href="https://worldview.earthdata.nasa.gov/?l=NISAR_L2_Geocoded_Polarimetric_Covariance" target="_blank" rel="noreferrer">Open this NISAR layer in NASA Worldview ↗</a>
        </aside>
        {processingPanel}
          </> },
          { id: "CHECK", number: "02", label: "Check it", hint: "Inspect radar inputs and independent optical evidence", anchorIds: ["nisar-radar", "nisar-reference-evidence"], content: checkPanel },
          { id: "LEARN", number: "03", label: "Learn", hint: "Read the case story and radar physics", anchorIds: ["nisar-case-story-title", "mozambique-case-title"], content: learnPanel },
        ]} drawer={null} drawerTabsPlacement="drawer" footer={<GlobalTimeMachine dates={observationDates} activeDate={activeObservationDate} stats={data?.stats ?? null} loading={loading} onSelect={selectObservation} />} />
  );
}

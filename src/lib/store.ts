/* ──────────────────────────────────────────────────────
   Beyonders Wetland Module — Zustand Store
   ────────────────────────────────────────────────────── */

import { create } from "zustand";
import { buildDemo, normalizeDateIndex } from "./demo-engine";
import { normalizeThreshold } from "./threshold";
import { datesWithPatches, listShowcaseCases, loadShowcaseBundle, loadShowcasePatches, SHOWCASE_ID, type ShowcaseBundle, type ShowcaseCaseSummary } from "./showcase";
import type {
  InundationClass,
  ProbeResult,
  SensitivityData,
  SiteBoundary,
  WetlandPatch,
  WetlandPulseData,
} from "./types";

export type MapMode = "BEFORE" | "AFTER" | "DIFFERENCE" | "SPLIT";
/** Which kind of data is on screen. Never blend these. */
export type DataTier = "EMPTY" | "SHOWCASE" | "LOCAL_RUN";
export type ViewMode = "MOTION" | "RADAR" | "DETECTION" | "EXPLAIN";
/** The three investigation tabs. One panel, three chapters — never nine floating tools. */
export type PanelTab = "NONE" | "EXPLORE" | "CHECK" | "LEARN";
export type RadarChannel = "hh" | "hv";
export type RadarStage = "before" | "after" | "change";
export interface ComparisonLock { beforeIndex: number; afterIndex: number; before: WetlandPatch[]; after: WetlandPatch[] }

interface WetlandStore {
  /* ── Experience state (map-first redesign) ────────── */
  /** Legacy dashboard compatibility; the active experience never enables demo data. */
  demoMode: boolean;
  resetDemo: () => void;
  setThreshold: (t: number) => void;
  dataTier: DataTier;
  showcase: ShowcaseBundle | null;
  showcaseChecked: boolean;
  /** Every packaged real case, newest first. */
  showcaseCases: ShowcaseCaseSummary[];
  /** Which packaged case is open. */
  showcaseId: string;
  initExperience: (preferLocalRun: boolean, caseId?: string | null) => Promise<void>;
  loadShowcase: (id?: string) => Promise<"LOADED" | "MISSING" | "STALE">;
  switchShowcase: (id: string) => Promise<void>;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  drawer: PanelTab;
  setDrawer: (d: PanelTab) => void;
  /** SAR Detective lives inside the Explore tab: probe any map point for its radar signal. */
  detectiveOn: boolean;
  setDetectiveOn: (on: boolean) => void;
  challengeOpen: boolean;
  setChallengeOpen: (open: boolean) => void;
  playSpeed: 0.5 | 1 | 2;
  setPlaySpeed: (s: 0.5 | 1 | 2) => void;
  radarChannel: RadarChannel;
  radarStage: RadarStage;
  setRadarLayer: (channel: RadarChannel, stage: RadarStage) => void;
  radarOpacity: number;
  setRadarOpacity: (o: number) => void;
  lock: ComparisonLock | null;
  lockComparison: (beforeIndex: number, afterIndex: number) => Promise<void>;
  clearLock: () => void;
  /** Clears selection, probe, lock, filters, drawers and challenge state. Does not reload the page. */
  returnToOverview: () => void;

  pipelineRunId: string | null;
  satelliteBasemap: boolean;
  setSatelliteBasemap: (active: boolean) => void;
  /* ── Date / Time ──────────────────────────────────── */
  selectedDateIndex: number;
  setSelectedDateIndex: (i: number) => void;

  /* ── Patch selection ──────────────────────────────── */
  selectedPatch: WetlandPatch | null;
  setSelectedPatch: (p: WetlandPatch | null) => void;

  /* ── Map mode ─────────────────────────────────────── */
  mapMode: MapMode;
  setMapMode: (m: MapMode) => void;

  /* ── Veg filter ───────────────────────────────────── */
  vegFilter: InundationClass | "ALL";
  setVegFilter: (v: InundationClass | "ALL") => void;

  /* ── Threshold ────────────────────────────────────── */
  threshold: number;

  /* ── SAR Probe ────────────────────────────────────── */
  probeActive: boolean;
  setProbeActive: (a: boolean) => void;
  probeResult: ProbeResult | null;
  setProbeResult: (r: ProbeResult | null) => void;

  /* ── Animation ────────────────────────────────────── */
  isPlaying: boolean;
  setIsPlaying: (p: boolean) => void;
  /* ── Dynamic Data ─────────────────────────────────── */
  patches: WetlandPatch[];
  pulseData: WetlandPulseData | null;
  sensitivityData: SensitivityData | null;
  siteBoundary: SiteBoundary | null;
  isLoadingData: boolean;
  dataError: string | null;
  fetchAllData: () => Promise<void>;
}

let pipelineRequestSequence = 0;
/** The opening timelapse plays once, on the first real showcase load. Never again unprompted. */
let showcaseAutoPlayed = false;

async function loadPatches(date: string, expectedRunId: string): Promise<WetlandPatch[]> {
  const response = await fetch(`/api/wetland/patches?date=${encodeURIComponent(date)}`);
  if (!response.ok) throw new Error("Pipeline regions could not be loaded for this date.");
  if (response.headers.get("x-pipeline-run-id") !== expectedRunId) {
    throw new Error("The pipeline run changed while loading dates. Reload the raster run.");
  }
  const patches = await response.json() as WetlandPatch[];
  if (!Array.isArray(patches) || patches.some((patch) => patch.run_id !== expectedRunId || patch.date !== date)) {
    throw new Error("Pipeline regions do not match the selected run and date.");
  }
  return patches;
}

export const useWetlandStore = create<WetlandStore>((set, get) => ({
  pipelineRunId: null,
  // Keep real surface context visible beneath radar overlays on first load.
  satelliteBasemap: true,
  setSatelliteBasemap: (satelliteBasemap) => set({ satelliteBasemap }),
  selectedDateIndex: 3, // start at peak
  setSelectedDateIndex: (i) => {
    const state = get();
    if (state.demoMode) {
      const selectedDateIndex = normalizeDateIndex(i);
      const data = buildDemo(selectedDateIndex, state.threshold, state.selectedPatch?.id);
      const selectedPatch = data.patches.find((patch) => patch.id === state.selectedPatch?.id) ?? null;
      set({ ...data, selectedDateIndex, selectedPatch, probeResult: null,
        sensitivityData: selectedPatch ? data.sensitivityData : buildDemo(selectedDateIndex, state.threshold).sensitivityData });
      return;
    }
    const dates = state.pulseData?.dates ?? [];
    const selectedDateIndex = Math.max(0, Math.min(dates.length - 1, Math.trunc(Number.isFinite(i) ? i : 0)));
    const date = dates[selectedDateIndex]?.date;
    if (!date || !state.pipelineRunId) return;
    // A legacy showcase may hold candidate regions for only some dates. Never show another date's regions as this date's.
    if (state.dataTier === "SHOWCASE" && state.showcase && !datesWithPatches(state.showcase).has(date)) return;
    const requestId = ++pipelineRequestSequence;
    const runId = state.pipelineRunId;
    set({ selectedDateIndex, selectedPatch: null, probeResult: null, isLoadingData: true, dataError: null, challengeOpen: false });
    const fetchPatches = state.dataTier === "SHOWCASE" && state.showcase
      ? loadShowcasePatches(state.showcase, date) : loadPatches(date, runId);
    void fetchPatches.then((patches) => {
      if (requestId !== pipelineRequestSequence || useWetlandStore.getState().pipelineRunId !== runId) return;
      set({ patches, isLoadingData: false });
    }).catch((error: unknown) => {
      if (requestId !== pipelineRequestSequence) return;
      set({ isLoadingData: false, dataError: error instanceof Error ? error.message : "Could not load date regions." });
    });
  },

  selectedPatch: null,
  setSelectedPatch: (p) => set({ selectedPatch: p }),

  mapMode: "DIFFERENCE",
  setMapMode: (mapMode) => set({
    mapMode,
    radarStage: mapMode === "BEFORE" ? "before" : mapMode === "AFTER" || mapMode === "SPLIT" ? "after" : "change",
    probeResult: null,
  }),

  vegFilter: "ALL",
  setVegFilter: (v) => {
    const selected = get().selectedPatch;
    if (selected && v !== "ALL" && selected.classification !== v) get().setSelectedPatch(null);
    set({ vegFilter: v });
  },

  threshold: 2.0,
  setThreshold: (value) => {
    const state = get();
    if (!state.demoMode) return;
    const threshold = normalizeThreshold(value);
    const data = buildDemo(state.selectedDateIndex, threshold, state.selectedPatch?.id);
    const selectedPatch = data.patches.find((patch) => patch.id === state.selectedPatch?.id) ?? null;
    set({ ...data, threshold, selectedPatch, probeResult: null,
      sensitivityData: selectedPatch ? data.sensitivityData : buildDemo(state.selectedDateIndex, threshold).sensitivityData });
  },
  probeActive: false,
  setProbeActive: (a) => set({ probeActive: a }),
  probeResult: null,
  setProbeResult: (r) => set({ probeResult: r }),

  isPlaying: false,
  setIsPlaying: (p) => set({ isPlaying: p }),

  demoMode: false,
  resetDemo: () => {
    pipelineRequestSequence++;
    set({ ...buildDemo(), demoMode: true, dataTier: "EMPTY", showcase: null, showcaseChecked: true,
      showcaseCases: [], showcaseId: SHOWCASE_ID, pipelineRunId: null, selectedDateIndex: 3, threshold: 2,
      selectedPatch: null, vegFilter: "ALL", mapMode: "DIFFERENCE", radarStage: "change", probeResult: null, probeActive: false,
      isPlaying: false, satelliteBasemap: true, siteBoundary: null, dataError: null, isLoadingData: false,
      lock: null, challengeOpen: false, drawer: "NONE", detectiveOn: false });
  },
  dataTier: "EMPTY",
  showcase: null,
  showcaseChecked: false,
  showcaseCases: [],
  showcaseId: SHOWCASE_ID,
  viewMode: "MOTION",
  setViewMode: (viewMode) => set({ viewMode, probeResult: null }),
  drawer: "NONE",
  setDrawer: (drawer) => set({ drawer, ...(drawer === "NONE" ? { probeActive: false, probeResult: null, detectiveOn: false } : {}) }),
  detectiveOn: false,
  setDetectiveOn: (on) => set(on
    ? { detectiveOn: true, probeActive: true, probeResult: null, selectedPatch: null }
    : { detectiveOn: false, probeActive: false, probeResult: null }),
  challengeOpen: false,
  setChallengeOpen: (challengeOpen) => set({ challengeOpen }),
  playSpeed: 1,
  setPlaySpeed: (playSpeed) => set({ playSpeed }),
  radarChannel: "hh",
  radarStage: "change",
  setRadarLayer: (radarChannel, radarStage) => set({ radarChannel, radarStage }),
  radarOpacity: 0.85,
  setRadarOpacity: (radarOpacity) => set({ radarOpacity }),
  lock: null,
  lockComparison: async (beforeIndex, afterIndex) => {
    const state = get();
    const dates = state.pulseData?.dates ?? [];
    if (!dates[beforeIndex] || !dates[afterIndex]) return;
    const fetchFor = async (index: number): Promise<WetlandPatch[]> => {
      if (state.dataTier === "SHOWCASE" && state.showcase) return loadShowcasePatches(state.showcase, dates[index].date);
      return loadPatches(dates[index].date, state.pipelineRunId ?? "");
    };
    try {
      const [before, after] = await Promise.all([fetchFor(beforeIndex), fetchFor(afterIndex)]);
      set({ lock: { beforeIndex, afterIndex, before, after }, isPlaying: false, dataError: null });
    } catch (error) {
      set({ dataError: error instanceof Error ? error.message : "Could not lock this comparison." });
    }
  },
  clearLock: () => set({ lock: null }),
  returnToOverview: () => {
    const state = get();
    const avail = state.dataTier === "SHOWCASE" && state.showcase ? datesWithPatches(state.showcase) : null;
    const target = avail && !avail.has(state.pulseData?.peak.date ?? "") ? state.showcase?.manifest.selected_date : state.pulseData?.peak.date;
    const peakIndex = Math.max(0, (state.pulseData?.dates ?? []).findIndex((d) => d.date === target));
    set({ selectedPatch: null, probeResult: null, probeActive: false, lock: null, vegFilter: "ALL", drawer: "NONE",
      challengeOpen: false, isPlaying: false, viewMode: "MOTION", mapMode: "DIFFERENCE", radarStage: "change", dataError: null });
    if (state.selectedDateIndex !== peakIndex) get().setSelectedDateIndex(peakIndex);
  },
  loadShowcase: async (id) => {
    const requestId = ++pipelineRequestSequence;
    set({ isLoadingData: true, dataError: null });
    try {
      const cases = await listShowcaseCases();
      if (requestId !== pipelineRequestSequence) return "STALE";
      const caseId = id ?? get().showcaseId ?? cases[0]?.id ?? SHOWCASE_ID;
      const bundle = await loadShowcaseBundle(caseId);
      if (requestId !== pipelineRequestSequence) return "STALE";
      if (!bundle) {
        set({ demoMode: false, dataTier: "EMPTY", showcase: null, showcaseChecked: true, showcaseCases: cases,
          showcaseId: caseId, patches: [], pulseData: null, sensitivityData: null, siteBoundary: null,
          pipelineRunId: null, selectedPatch: null, probeResult: null, isPlaying: false, isLoadingData: false,
          lock: null, challengeOpen: false, dataError: "The packaged real NISAR case is unavailable. No simulated data were substituted." });
        return "MISSING";
      }
      if (!bundle.pulse) {
        // Legacy run, metadata only: real acquisition dates + verified boundary, no derived results.
        set({ demoMode: false, dataTier: "SHOWCASE", showcase: bundle, showcaseChecked: true, showcaseCases: cases, showcaseId: caseId, pipelineRunId: bundle.manifest.run_id,
          patches: [], pulseData: null, sensitivityData: null, siteBoundary: bundle.boundary, selectedDateIndex: 0, selectedPatch: null,
          probeResult: null, isPlaying: false, isLoadingData: false, lock: null, challengeOpen: false, dataError: null, mapMode: "DIFFERENCE", radarStage: "change" });
        return "LOADED";
      }
      const available = datesWithPatches(bundle);
      const selected = bundle.manifest.selected_date ?? bundle.pulse.peak.date;
      const peakIndex = Math.max(0, bundle.pulse.dates.findIndex((d) => d.date === (available.has(selected) ? selected : bundle.pulse!.peak.date)));
      const autoPlay = !showcaseAutoPlayed; showcaseAutoPlayed = true;
      const startIndex = peakIndex;
      const patches = await loadShowcasePatches(bundle, bundle.pulse.dates[startIndex].date);
      if (requestId !== pipelineRequestSequence) return "STALE";
      set({ demoMode: false, dataTier: "SHOWCASE", showcase: bundle, showcaseChecked: true, showcaseCases: cases, showcaseId: caseId, pipelineRunId: bundle.manifest.run_id,
        patches, pulseData: bundle.pulse, sensitivityData: bundle.sensitivity, siteBoundary: bundle.boundary,
        selectedDateIndex: startIndex, selectedPatch: null, probeResult: null, isPlaying: autoPlay, isLoadingData: false,
        threshold: normalizeThreshold(Number((bundle.sensitivity as unknown as { base_threshold_db?: number } | null)?.base_threshold_db)),
        mapMode: "DIFFERENCE", radarStage: "change", lock: null, challengeOpen: false, dataError: null });
      return "LOADED";
    } catch (error) {
      if (requestId !== pipelineRequestSequence) return "STALE";
      set({ demoMode: false, dataTier: "EMPTY", showcase: null, showcaseChecked: true, patches: [], pulseData: null,
        sensitivityData: null, siteBoundary: null, pipelineRunId: null, selectedPatch: null, probeResult: null,
        isPlaying: false, isLoadingData: false, lock: null, challengeOpen: false,
        dataError: `${error instanceof Error ? error.message : "Case could not be loaded."} No simulated data were substituted.` });
      return "MISSING";
    }
  },
  switchShowcase: async (id) => {
    if (id === get().showcaseId && get().dataTier === "SHOWCASE") return;
    await get().loadShowcase(id);
  },
  initExperience: async (preferLocalRun, caseId) => {
    if (preferLocalRun) { await get().fetchAllData(); if (get().dataTier === "LOCAL_RUN") return; }
    const result = await get().loadShowcase(caseId ?? undefined);
    if (result === "MISSING" && get().dataTier !== "LOCAL_RUN") {
      set({ dataTier: "EMPTY", showcase: null, patches: [], pulseData: null, sensitivityData: null,
        siteBoundary: null, pipelineRunId: null, showcaseChecked: true });
    }
  },

  patches: [],
  pulseData: null,
  sensitivityData: null,
  siteBoundary: null,
  isLoadingData: false,
  dataError: null,
  fetchAllData: async () => {
    const requestId = ++pipelineRequestSequence;
    set({ isLoadingData: true, dataError: null });
    try {
      const [patchesRes, pulseRes, sensRes] = await Promise.all([
        fetch("/api/wetland/patches"),
        fetch("/api/wetland/pulse"),
        fetch("/api/wetland/sensitivity")
      ]);
      
      if (![patchesRes, pulseRes, sensRes].every((response) => response.ok)) {
        throw new Error("No usable completed local run was found. Open the packaged real case or process a new study area.");
      }
      const patches = await patchesRes.json();
      const pulseData = await pulseRes.json();
      const sensitivityData = await sensRes.json();
      if (requestId !== pipelineRequestSequence) return;
      const runId = pulseData.run_id as string | undefined;
      if (pulseData.data_source !== "NISAR") {
        throw new Error("The local pipeline output is not marked as real NISAR data. It was not loaded as a scientific result.");
      }
      let siteBoundary: SiteBoundary | null = null;
      if (pulseData.data_source === "NISAR") {
        const boundaryResponse = await fetch("/api/wetland/boundary");
        if (!boundaryResponse.ok) throw new Error("The real-data run is missing its wetland boundary file.");
        if (!runId || boundaryResponse.headers.get("x-pipeline-run-id") !== runId) {
          throw new Error("The pipeline run changed while loading its wetland boundary. Retry the request.");
        }
        siteBoundary = await boundaryResponse.json() as SiteBoundary;
        if (siteBoundary.type !== "FeatureCollection" || !Array.isArray(siteBoundary.features) || !siteBoundary.features.length ||
            siteBoundary.features.some((feature) => !feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type))) {
          throw new Error("The real-data wetland boundary is invalid.");
        }
      }
      if (requestId !== pipelineRequestSequence) return;
      if (!Array.isArray(patches) || !Array.isArray(pulseData.dates) || !pulseData.dates.length ||
          !Array.isArray(sensitivityData.thresholds) || !runId || pulseData.run_id !== sensitivityData.run_id ||
          patchesRes.headers.get("x-pipeline-run-id") !== runId ||
          patches.some((p) => p.run_id !== pulseData.run_id || p.date !== pulseData.peak.date)) {
        throw new Error("Pipeline outputs are inconsistent or changed during loading. Retry the request.");
      }
      if (!patches.every((patch: WetlandPatch) => patch.geometry && ["Polygon", "MultiPolygon"].includes(patch.geometry.type))) {
        throw new Error("The pipeline run does not include mapped region geometry. Regenerate the selected pipeline run.");
      }
      set({ demoMode: false, patches, pulseData, sensitivityData, siteBoundary, dataTier: "LOCAL_RUN", showcase: null, lock: null, pipelineRunId: runId, selectedPatch: null, probeResult: null, isPlaying: false, isLoadingData: false,
        selectedDateIndex: Math.max(0, pulseData.dates.findIndex((d: { date: string }) => d.date === pulseData.peak.date)),
        threshold: normalizeThreshold(Number(sensitivityData.base_threshold_db)),
        mapMode: get().mapMode === "BEFORE" || get().mapMode === "SPLIT" ? "AFTER" : get().mapMode });
    } catch (e) {
      if (requestId !== pipelineRequestSequence) return;
      console.error(e);
      set({ isLoadingData: false, dataError: e instanceof Error ? e.message : "Pipeline loading failed." });
    }
  },
}));

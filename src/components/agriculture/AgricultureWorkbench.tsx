"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import InvestigationWorkspace from "@/components/layout/InvestigationWorkspace";
import type { InvestigationDrawerTab } from "@/components/layout/InvestigationWorkspace";
import {
  buildAgricultureDateAxis,
  buildAgricultureSupportDrift,
  isAgricultureChecksumManifest,
  isAgricultureIndex,
  isAgricultureStudy,
  sha256Hex,
  type AgricultureAOI,
  type AgricultureChecksumManifest,
  type AgricultureObservation,
  type AgricultureStudy,
  type AgricultureSurfaceFlagId,
  type AgricultureCropObservability,
} from "@/lib/agriculture-study";
import type { AgricultureCatalogueResult } from "@/lib/agriculture-catalogue";
import EvidenceChainPanel from "@/components/shared/EvidenceChainPanel";
import { buildAgricultureEvidenceChain } from "@/lib/evidence-chain";
import HazardWalkthrough from "@/components/shared/HazardWalkthrough";
import TriageBriefButton from "@/components/shared/TriageBriefButton";
import "./agriculture.css";

const AgricultureMap = dynamic(() => import("./AgricultureMap"), {
  ssr: false,
  loading: () => <div className="agri-map-loading">Loading interactive map…</div>,
});

const MIN_DATE = "2026-01-01";
const MAX_DATE = new Date().toISOString().slice(0, 10);
// NISAR repeats the same orbit geometry every 12 days; >18 days is a visual extended-gap cue only.
const LONG_ACQUISITION_GAP_DAYS = 18;

type LoadState = "loading" | "not-published" | "ready" | "error";
type MapLayer = "moisture" | "change" | "matched" | "crop" | "crop-common" | "crop-source";
type SeriesSupportMode = "date-valid" | "same-pixels";
const SURFACE_FLAG_LABELS: Array<{ id: AgricultureSurfaceFlagId; label: string; detail: string }> = [
  { id: "static_water", label: "Static water body", detail: "Surface-water mask" },
  { id: "urban_area", label: "Urban area", detail: "Built-up surface mask" },
  { id: "precipitation", label: "Precipitation", detail: "Potentially unreliable during precipitation" },
  { id: "snow_or_ice", label: "Snow or ice", detail: "Snow/ice condition" },
  { id: "permanent_snow_or_ice", label: "Permanent snow or ice", detail: "Permanent snow/ice condition" },
  { id: "frozen_ground", label: "Frozen ground", detail: "Frozen-ground condition" },
  { id: "terrain", label: "Terrain", detail: "Terrain-related exclusion" },
  { id: "dense_vegetation", label: "Dense vegetation", detail: "Potentially unreliable over dense canopy" },
];

function formatPercent(value: number) {
  return (value * 100).toFixed(1) + "%";
}
function formatMoisture(value: number) {
  return value.toFixed(3) + " m³/m³";
}
function formatDifference(value: number) {
  return (value > 0 ? "+" : "") + value.toFixed(3) + " m³/m³";
}
function dateLabel(value: string) {
  return new Date(value + "T00:00:00Z").toLocaleDateString("en", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}
function shortDateLabel(value: string) {
  return new Date(value + "T00:00:00Z").toLocaleDateString("en", {
    day: "2-digit", month: "short", timeZone: "UTC",
  });
}
type AgricultureSearchValues = {
  west: string; south: string; east: string; north: string;
  start: string; end: string;
};
type CatalogueSearchStatus = "idle" | "searching" | "complete" | "error";

function validSearchForm(values: AgricultureSearchValues) {
  if (![values.west, values.south, values.east, values.north].every((item) => item.trim() !== "")) return false;
  const west = Number(values.west), south = Number(values.south);
  const east = Number(values.east), north = Number(values.north);
  const start = Date.parse(values.start + "T00:00:00Z");
  const end = Date.parse(values.end + "T00:00:00Z");
  return [west, south, east, north, start, end].every(Number.isFinite) &&
    west >= -180 && east <= 180 && west < east &&
    south >= -90 && north <= 90 && south < north &&
    east - west <= 2 && north - south <= 2 &&
    values.start >= MIN_DATE && values.start <= MAX_DATE &&
    values.end >= MIN_DATE && values.end <= MAX_DATE &&
    values.start <= values.end;
}
function csvCell(value: string | number) {
  return "\"" + String(value).replace(/"/g, "\"\"") + "\"";
}

export default function AgricultureWorkbench() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [study, setStudy] = useState<AgricultureStudy | null>(null);
  const [checksums, setChecksums] = useState<AgricultureChecksumManifest | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [layer, setLayer] = useState<MapLayer>("moisture");
  const [seriesSupportMode, setSeriesSupportMode] = useState<SeriesSupportMode>("date-valid");
  const [selectedFlagMask, setSelectedFlagMask] = useState<number | null>(null);
  const [showAllFlagCombinations, setShowAllFlagCombinations] = useState(false);
  const [previewState, setPreviewState] = useState<{ asset: string; url: string | null; error: string } | null>(null);
  const [satelliteBasemap, setSatelliteBasemap] = useState(false);
  const [west, setWest] = useState("91.3867");
  const [south, setSouth] = useState("24.3533");
  const [east, setEast] = useState("91.4467");
  const [north, setNorth] = useState("24.4133");
  const [start, setStart] = useState("2026-01-01");
  const [end, setEnd] = useState("2026-10-31");
  const [catalogueStatus, setCatalogueStatus] = useState<CatalogueSearchStatus>("idle");
  const [catalogueResult, setCatalogueResult] = useState<AgricultureCatalogueResult | null>(null);
  const [catalogueError, setCatalogueError] = useState("");
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    async function load() {
      try {
        const indexResponse = await fetch("/agriculture/current/index.json", { signal: controller.signal, cache: "no-store" });
        if (indexResponse.status === 404) {
          if (live) setLoadState("not-published");
          return;
        }
        if (!indexResponse.ok) throw new Error("Agriculture publication index returned HTTP " + indexResponse.status + ".");
        const indexBytes = await indexResponse.arrayBuffer();
        const indexValue: unknown = JSON.parse(new TextDecoder().decode(indexBytes));
        if (!isAgricultureIndex(indexValue)) throw new Error("Agriculture publication index is malformed or contains an unsafe asset path.");

        const checksResponse = await fetch("/agriculture/" + indexValue.checksums_url, { signal: controller.signal, cache: "no-store" });
        if (!checksResponse.ok) throw new Error("Checksum manifest unavailable (HTTP " + checksResponse.status + ").");
        const checksValue: unknown = await checksResponse.json();
        if (!isAgricultureChecksumManifest(checksValue)) throw new Error("The Agriculture checksum manifest is missing or invalid.");

        const studyResponse = await fetch("/agriculture/" + indexValue.study_url, { signal: controller.signal, cache: "no-store" });
        if (!studyResponse.ok) throw new Error("Published study unavailable (HTTP " + studyResponse.status + ").");
        const studyBytes = await studyResponse.arrayBuffer();
        const entry = checksValue.files["study.json"];
        if (!entry || studyBytes.byteLength !== entry.bytes || await sha256Hex(studyBytes) !== entry.sha256) {
          throw new Error("Study integrity check failed: byte count or SHA-256 did not match the publication manifest.");
        }
        const studyValue: unknown = JSON.parse(new TextDecoder().decode(studyBytes));
        if (!isAgricultureStudy(studyValue)) throw new Error("Published Agriculture study failed the SME2 schema and evidence-status checks.");
        if (!live) return;
        setStudy(studyValue);
        setChecksums(checksValue);
        setSelectedIndex(Math.max(0, studyValue.observations.length - 1));
        setLoadState("ready");
      } catch (error) {
        if (!live || (error instanceof DOMException && error.name === "AbortError")) return;
        setLoadError(error instanceof Error ? error.message : "Could not load the published Agriculture study.");
        setLoadState("error");
      }
    }
    void load();
    return () => { live = false; controller.abort(); };
  }, []);

  const selectedObservation: AgricultureObservation | null = study?.observations[selectedIndex] ?? null;
  const selectedMatchedObservation = study?.matched_support.observations[selectedIndex] ?? null;
  const cropObservability: AgricultureCropObservability | null = study?.crop_observability ?? null;
  const selectedCropObservation = cropObservability?.observations[selectedIndex] ?? null;
  const commonCropObservation = cropObservability?.common_support.observations[selectedIndex] ?? null;
  const activeCropObservation = layer === "crop-common" ? commonCropObservation : selectedCropObservation;
  const cropWeightedMoisture = activeCropObservation?.weighted_soil_moisture ?? null;
  const chartObservations = useMemo(() => {
    if (!study) return [];
    return seriesSupportMode === "same-pixels" && study.matched_support.observations.length
      ? study.matched_support.observations
      : study.observations;
  }, [study, seriesSupportMode]);
  const activeAsset = study
    ? layer === "change" ? study.change_preview
      : layer === "matched" ? selectedMatchedObservation?.preview ?? ""
      : layer === "crop" ? cropObservability?.preview ?? ""
      : layer === "crop-common" ? cropObservability?.common_support.preview ?? ""
      : layer === "crop-source" ? cropObservability?.source_coverage_preview ?? ""
      : selectedObservation?.preview ?? ""
    : "";

  useEffect(() => {
    if (!study || !checksums || !activeAsset) return;
    const checksumFiles = checksums.files;
    const controller = new AbortController();
    let live = true;
    let objectUrl: string | null = null;
    async function loadPreview() {
      try {
        const entry = checksumFiles[activeAsset];
        if (!entry) throw new Error("No checksum entry exists for " + activeAsset + ".");
        const response = await fetch("/agriculture/current/" + activeAsset, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Preview " + activeAsset + " returned HTTP " + response.status + ".");
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== entry.bytes || await sha256Hex(bytes) !== entry.sha256) {
          throw new Error("Preview integrity check failed for " + activeAsset + "; the image has been withheld.");
        }
        if (!live) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        setPreviewState({ asset: activeAsset, url: objectUrl, error: "" });
      } catch (error) {
        if (!live || (error instanceof DOMException && error.name === "AbortError")) return;
        setPreviewState({ asset: activeAsset, url: null, error: error instanceof Error ? error.message : "Preview unavailable." });
      }
    }
    void loadPreview();
    return () => {
      live = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [study, checksums, activeAsset]);

  const previewUrl = previewState?.asset === activeAsset ? previewState.url : null;
  const previewError = previewState?.asset === activeAsset ? previewState.error : "";

  const form = useMemo(() => ({ west, south, east, north, start, end }), [west, south, east, north, start, end]);
  const formValid = useMemo(() => validSearchForm(form), [form]);
  const chartRange = useMemo(() => {
    if (!chartObservations.length) return { min: 0, max: 1 };
    const lows = chartObservations.map((item) => item.p05);
    const highs = chartObservations.map((item) => item.p95);
    const min = Math.min(...lows), max = Math.max(...highs);
    return { min: min - (max - min || 0.02) * 0.12, max: max + (max - min || 0.02) * 0.12 };
  }, [chartObservations]);

  const chartDateAxis = useMemo(
    () => buildAgricultureDateAxis(chartObservations.map((item) => item.date)),
    [chartObservations],
  );
  const chartPoints = useMemo(() => chartObservations.flatMap((item, index) => {
    const dateAxisPoint = chartDateAxis[index];
    if (!dateAxisPoint || dateAxisPoint.date !== item.date) return [];
    const span = chartRange.max - chartRange.min;
    const y = (value: number) => 100 - ((value - chartRange.min) / span) * 100;
    return [{
      ...item,
      x: dateAxisPoint.position,
      medianY: y(item.median),
      lowY: y(item.p05),
      highY: y(item.p95),
      gapDays: dateAxisPoint.gap_days,
    }];
  }), [chartObservations, chartDateAxis, chartRange]);
  const chartDateTicks = useMemo(() => {
    if (chartObservations.length === 0) return [];
    const first = Date.parse(chartObservations[0].date + "T00:00:00Z");
    const last = Date.parse(chartObservations[chartObservations.length - 1].date + "T00:00:00Z");
    if (!Number.isFinite(first) || !Number.isFinite(last)) return [];
    const fractions = first === last ? [0.5] : [0, 0.5, 1];
    return fractions.map((fraction) => ({
      position: fraction * 100,
      date: new Date(first + (last - first) * fraction).toISOString().slice(0, 10),
    }));
  }, [chartObservations]);

  const supportDrift = useMemo(
    () => study ? buildAgricultureSupportDrift(study) : [],
    [study],
  );
  const supportDriftStats = useMemo(() => {
    if (!supportDrift.length) return null;
    const absoluteGaps = supportDrift.map((item) => Math.abs(item.gap_m3_m3)).sort((a, b) => a - b);
    const middle = Math.floor(absoluteGaps.length / 2);
    const medianAbsoluteGap = absoluteGaps.length % 2
      ? absoluteGaps[middle]
      : (absoluteGaps[middle - 1] + absoluteGaps[middle]) / 2;
    const firstGap = supportDrift[0].gap_m3_m3;
    const lastGap = supportDrift[supportDrift.length - 1].gap_m3_m3;
    const largest = supportDrift.reduce((best, item) =>
      Math.abs(item.gap_m3_m3) > Math.abs(best.gap_m3_m3) ? item : best,
    supportDrift[0]);
    return {
      medianAbsoluteGap,
      gapShift: lastGap - firstGap,
      firstGap,
      lastGap,
      largestGap: largest.gap_m3_m3,
      largestGapDate: largest.date,
    };
  }, [supportDrift]);
  const supportDriftPlot = useMemo(() => {
    if (!supportDrift.length) return null;
    const values = supportDrift.flatMap((item) => [item.date_valid_median, item.same_pixel_median]);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const padding = Math.max((rawMax - rawMin) * 0.16, 0.006);
    const min = Math.max(0.02, rawMin - padding);
    const max = Math.min(0.60, rawMax + padding);
    const range = max > min ? max - min : 0.02;
    const left = 42, right = 678, top = 18, bottom = 140;
    const dateAxis = buildAgricultureDateAxis(supportDrift.map((item) => item.date));
    if (dateAxis.length !== supportDrift.length) return null;
    const points = supportDrift.map((item, index) => {
      const x = left + (dateAxis[index].position / 100) * (right - left);
      const y = (value: number) => bottom - ((value - min) / range) * (bottom - top);
      return {
        ...item,
        x,
        dateValidY: y(item.date_valid_median),
        samePixelY: y(item.same_pixel_median),
        gapDays: dateAxis[index].gap_days,
      };
    });
    return {
      points,
      dateValidLine: points.map((item) => item.x + "," + item.dateValidY).join(" "),
      samePixelLine: points.map((item) => item.x + "," + item.samePixelY).join(" "),
      min,
      max,
    };
  }, [supportDrift]);

  const exportCsv = useCallback(() => {
    if (!study) return;
    const columns = [
      "date", "median_m3_m3", "p05_m3_m3", "p95_m3_m3", "date_valid_fraction",
      "date_valid_pixels", "total_pixels", "uncertainty_median", "same_pixel_median_m3_m3",
      "same_pixel_valid_fraction", "same_pixel_count", "support_composition_gap_m3_m3",
      "surface_flag_total_aoi_pixels", "surface_flag_encoded_pixels", "surface_flag_unflagged_pixels",
      "surface_flag_flagged_pixels", "surface_flag_fill_pixels", "surface_flag_invalid_pixels",
      "surface_flag_unsupported_encoding_pixels", "surface_flag_marginal_counts_json",
      "surface_flag_combinations_json",
      "crop_mask_source", "crop_mask_date", "crop_mask_threshold", "crop_mask_aoi_coverage_fraction",
      "crop_area_equivalent_pixels", "crop_valid_area_fraction", "crop_valid_area_equivalent_pixels",
      "crop_weighted_median_m3_m3", "crop_common_support_fraction", "crop_common_weighted_median_m3_m3",
      "release", "track", "direction", "frame", "bandwidth", "polarization", "frequency",
      "granule_name", "source_bytes", "source_sha256",
    ];
    const rows = study.observations.map((item, index) => {
      const matched = study.matched_support.observations[index];
      const crop = study.crop_observability;
      const cropDate = crop?.observations[index];
      const cropCommon = crop?.common_support.observations[index];
      const surface = item.surface_flag_diagnostics;
      return [
        item.date, item.median, item.p05, item.p95, item.valid_fraction, item.valid_pixels,
        item.total_pixels, item.uncertainty_median, matched?.median ?? "",
        matched?.valid_fraction ?? "", matched?.valid_pixels ?? "",
        matched ? item.median - matched.median : "",
        surface?.total_aoi_pixels ?? "", surface?.encoded_pixels ?? "",
        surface?.unflagged_pixels ?? "", surface?.flagged_pixels ?? "",
        surface?.fill_pixels ?? "", surface?.invalid_pixels ?? "",
        surface?.unsupported_encoding_pixels ?? "",
        surface ? JSON.stringify(surface.flags) : "",
        surface?.flag_combinations ? JSON.stringify(surface.flag_combinations) : "",
        crop?.source ?? "", crop?.source_date ?? "", crop?.probability_threshold ?? "",
        crop?.mask_coverage_fraction ?? "", crop?.crop_area_equivalent_pixels ?? "",
        cropDate?.valid_crop_area_fraction ?? "", cropDate?.valid_crop_area_equivalent_pixels ?? "",
        cropDate?.weighted_soil_moisture?.median ?? "",
        crop?.common_support.valid_crop_area_fraction ?? "",
        cropCommon?.weighted_soil_moisture?.median ?? "",
        item.release, item.track, item.direction, item.frame, item.bandwidth, item.polarization, item.frequency,
        item.granule_name ?? "", item.source_bytes ?? "", item.source_sha256 ?? "",
      ].map(csvCell).join(",");
    });
    const blob = new Blob([[columns.join(","), ...rows].join("\n"),], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "nisar-sme2-" + study.run_id + "-summary.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [study]);

  const searchAgricultureCatalogue = useCallback(async () => {
    if (!formValid) return;
    setCatalogueStatus("searching");
    setCatalogueError("");
    setCatalogueResult(null);
    setSelectedSeriesId(null);
    try {
      const response = await fetch("/api/agriculture/catalogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          west: Number(west), south: Number(south), east: Number(east), north: Number(north),
          startDate: start, endDate: end,
        }),
      });
      const payload = await response.json() as AgricultureCatalogueResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "NASA catalogue search failed.");
      if (!Array.isArray(payload.series) || typeof payload.catalogue_granules !== "number") {
        throw new Error("NASA returned a catalogue response that did not match the expected SME2 schema.");
      }
      setCatalogueResult(payload);
      setSelectedSeriesId(payload.recommended_series_id ?? payload.series[0]?.series_id ?? null);
      setCatalogueStatus("complete");
    } catch (error) {
      setCatalogueError(error instanceof Error ? error.message : "Could not search NASA's catalogue.");
      setCatalogueStatus("error");
    }
  }, [formValid, west, south, east, north, start, end]);

  const aoi: AgricultureAOI | null = study?.aoi ?? (formValid ? {
    west: Number(west), south: Number(south), east: Number(east), north: Number(north),
  } : null);
  const target = study?.observations[study.observations.length - 1] ?? null;
  const currentCoverage = study
    ? layer === "change" ? study.change_summary.valid_fraction
      : layer === "matched" ? selectedMatchedObservation?.valid_fraction ?? 0
      : layer === "crop" ? selectedCropObservation?.valid_crop_area_fraction ?? 0
      : layer === "crop-common" ? cropObservability?.common_support.valid_crop_area_fraction ?? 0
      : layer === "crop-source" ? cropObservability?.mask_coverage_fraction ?? 0
      : selectedObservation?.valid_fraction ?? 0
    : 0;
  const displayedSummary = study
    ? layer === "change" ? study.change_summary
      : layer === "matched" ? selectedMatchedObservation
      : selectedObservation
    : null;
  const cropLayerActive = layer === "crop" || layer === "crop-common";
  const displayedUncertainty = cropLayerActive
    ? cropWeightedMoisture?.uncertainty_median
    : displayedSummary?.uncertainty_median;
  const supportCompositionGap = selectedObservation && selectedMatchedObservation
    ? selectedObservation.median - selectedMatchedObservation.median
    : null;
  const surfaceDiagnostics = selectedObservation?.surface_flag_diagnostics ?? null;
  const flagCombinations = surfaceDiagnostics?.flag_combinations ?? null;
  const selectedFlagCombination = flagCombinations?.find((item) => item.mask === selectedFlagMask) ??
    flagCombinations?.[0] ?? null;
  const visibleFlagCombinations = flagCombinations
    ? showAllFlagCombinations ? flagCombinations : flagCombinations.slice(0, 8)
    : [];
  const selectedFlagLabels = selectedFlagCombination
    ? SURFACE_FLAG_LABELS.flatMap((flag, bit) =>
      (selectedFlagCombination.mask & (1 << bit)) !== 0 ? [flag] : [])
    : [];
  const flagCombinationMax = flagCombinations?.[0]?.pixels ?? 1;
  const noStudy = loadState === "not-published" || loadState === "loading";
  const statusText = loadState === "loading" ? "Checking published study" :
    loadState === "ready" ? "Checksum verified" :
    loadState === "not-published" ? "No local publication" : "Publication unavailable";

  const evidenceChain = buildAgricultureEvidenceChain(study);

  const drawerTabs: InvestigationDrawerTab[] = [
    {
      id: "explore", number: "01", label: "Explore", hint: "Inspect dates, map layers and summary statistics", anchorIds: ["agri-explore-intro"],
      content: (
        <div className="agri-drawer-panel" id="agri-explore-intro">
          <p className="agri-intro">Explore the measured SME2 soil-moisture series. The map and statistics below are loaded only from a checksum-verified published study.</p>
          {study ? <>
            <div className="agri-stat-grid">
              <div>
                <span>{layer === "crop-source" ? "Mean source-data coverage" : layer === "change" ? "Median moisture difference" : cropLayerActive ? "Crop-weighted SME2 median" : "Median soil moisture"}</span>
                <strong>{layer === "crop-source"
                  ? formatPercent(cropObservability?.mean_source_data_coverage_fraction ?? 0)
                  : layer === "change"
                    ? formatDifference(study.change_summary.median)
                    : cropLayerActive
                      ? cropWeightedMoisture ? formatMoisture(cropWeightedMoisture.median) : "NOT ASSESSED"
                      : formatMoisture(layer === "matched" ? selectedMatchedObservation?.median ?? 0 : selectedObservation?.median ?? 0)}</strong>
                <small>{layer === "crop-source" ? "Average valid mask-source fraction across AOI cells" : layer === "change" ? "Latest minus baseline median" : layer === "matched" ? "Same pixels across every date" : layer === "crop-common" ? "Fixed crop-area cohort" : layer === "crop" ? "Selected date · independent crop support" : selectedObservation ? dateLabel(selectedObservation.date) : ""}</small>
              </div>
              <div><span>{layer === "crop-source" ? "AOI cells above floor" : cropLayerActive ? "Valid mapped crop area" : "Valid coverage"}</span><strong>{formatPercent(currentCoverage)}</strong><small>{layer === "crop-source" ? "Native cells with at least the configured source coverage" : layer === "crop-common" ? "Common crop area · every date" : layer === "crop" ? "Selected-date crop area" : layer === "change" ? "Change-layer coverage" : layer === "matched" ? "Same pixels · all dates" : "Selected-date coverage"}</small></div>
              <div><span>{layer === "crop-source" ? "Within-cell coverage floor" : layer === "change" ? "Target-date uncertainty" : "Median uncertainty"}</span><strong>{layer === "crop-source" ? formatPercent(cropObservability?.minimum_cell_coverage ?? 0.8) : displayedUncertainty === undefined ? "—" : displayedUncertainty.toFixed(3)}</strong><small>{layer === "crop-source" ? "Cells below this are excluded from crop-area estimates" : layer === "change" ? "Not propagated into change" : cropLayerActive ? "Crop-area weighted product uncertainty" : "Product-reported"}</small></div>
            </div>
            <section className="agri-cohort-audit" aria-label="Same-pixel time-series comparability audit">
              <div className="agri-cohort-audit__head">
                <div><span className="agri-eyebrow">TIME-SERIES COMPARABILITY</span><strong>Same-pixel cohort</strong></div>
                <span className={"agri-cohort-status is-" + study.matched_support.status.toLowerCase().replaceAll("_", "-")}>{study.matched_support.status.replaceAll("_", " ")}</span>
              </div>
              <div className="agri-cohort-audit__metric">
                <strong>{formatPercent(study.matched_support.valid_fraction)}</strong>
                <span>{study.matched_support.valid_pixels.toLocaleString()} of {study.matched_support.total_pixels.toLocaleString()} AOI pixels valid on every date</span>
              </div>
              <div className="agri-cohort-audit__track" aria-hidden="true"><i style={{ width: formatPercent(study.matched_support.valid_fraction) }} /></div>
              {supportCompositionGap !== null
                ? <p>Selected-date support-composition gap: <strong>{formatDifference(supportCompositionGap)}</strong></p>
                : <p>No all-date common pixels are available, so a same-pixel median cannot be calculated.</p>}
              <small>This gap compares two spatial samples on the same date. It is not a measured soil-moisture change, accuracy score, or causal explanation. The cohort is fixed across the series; low coverage remains inconclusive.</small>
            </section>
            {surfaceDiagnostics ? (
              <section className="agri-observability" aria-labelledby="agri-observability-title">
                <div className="agri-observability__head">
                  <div>
                    <span className="agri-eyebrow">AGRICULTURAL OBSERVABILITY · STEP 1A</span>
                    <strong id="agri-observability-title">Why are some SME2 pixels not assessed?</strong>
                  </div>
                  <span className="agri-observability__date">{selectedObservation ? dateLabel(selectedObservation.date) : ""}</span>
                </div>
                <div className="agri-observability__stats">
                  <div>
                    <span>Surface-flag clear</span>
                    <strong>{formatPercent(surfaceDiagnostics.unflagged_pixels / surfaceDiagnostics.total_aoi_pixels)}</strong>
                    <small>{surfaceDiagnostics.unflagged_pixels.toLocaleString()} of {surfaceDiagnostics.total_aoi_pixels.toLocaleString()} AOI pixels</small>
                  </div>
                  <div>
                    <span>One or more surface flags</span>
                    <strong>{surfaceDiagnostics.flagged_pixels.toLocaleString()}</strong>
                    <small>Pixels with at least one documented surface flag</small>
                  </div>
                  <div>
                    <span>Not decodable</span>
                    <strong>{(surfaceDiagnostics.fill_pixels + surfaceDiagnostics.invalid_pixels + surfaceDiagnostics.unsupported_encoding_pixels).toLocaleString()}</strong>
                    <small>Fill, invalid or unsupported flag encodings</small>
                  </div>
                </div>
                <div className="agri-observability__rows">
                  {SURFACE_FLAG_LABELS.map((flag) => {
                    const count = surfaceDiagnostics.flags[flag.id];
                    const fraction = count / surfaceDiagnostics.total_aoi_pixels;
                    return (
                      <div className={"agri-observability__row" + (flag.id === "dense_vegetation" && count > 0 ? " is-canopy" : "")} key={flag.id}>
                        <div className="agri-observability__row-head">
                          <strong>{flag.label}</strong>
                          <span>{count.toLocaleString()} · {formatPercent(fraction)}</span>
                        </div>
                        <div className="agri-observability__track" aria-hidden="true">
                          <i style={{ width: formatPercent(fraction) }} />
                        </div>
                        <small>{flag.detail}</small>
                      </div>
                    );
                  })}
                </div>
                <section className="agri-flag-atlas" aria-labelledby="agri-flag-atlas-title">
                  <div className="agri-flag-atlas__head">
                    <div>
                      <span className="agri-eyebrow">STEP 1C · JOINT BITFIELD AUDIT</span>
                      <strong id="agri-flag-atlas-title">Which surface flags occur together?</strong>
                    </div>
                    {flagCombinations && <span>{flagCombinations.length} unique signatures</span>}
                  </div>
                  {flagCombinations === null ? (
                    <p className="agri-flag-atlas__empty">Exact flag combinations were not included in this older publication. Re-run the local analysis to record the joint bitfield signatures.</p>
                  ) : flagCombinations.length === 0 ? (
                    <p className="agri-flag-atlas__empty">No encoded non-zero surface-flag signatures were recorded for this AOI and date.</p>
                  ) : (
                    <>
                      <p className="agri-flag-atlas__intro">Each row is one exact eight-bit SME2 surfaceQualityFlag pattern. Unlike the marginal bars above, these rows are mutually exclusive and reconcile to the flagged-pixel total. Select a row to inspect its documented conditions.</p>
                      <div className="agri-flag-atlas__axis" aria-hidden="true">
                        <span>MASK</span>
                        <span className="agri-flag-atlas__axis-bits">
                          {["W", "U", "P", "S", "PS", "FG", "T", "DV"].map((label, bit) => (
                            <span key={bit} title={SURFACE_FLAG_LABELS[bit].label}>{label}</span>
                          ))}
                        </span>
                        <span>PIXELS / SHARE</span>
                      </div>
                      <div className="agri-flag-atlas__list" role="group" aria-label="Select an exact SME2 surface-flag combination">
                        {visibleFlagCombinations.map((item) => {
                          const active = selectedFlagCombination?.mask === item.mask;
                          const labels = SURFACE_FLAG_LABELS
                            .flatMap((flag, bit) => (item.mask & (1 << bit)) !== 0 ? [flag.label] : []);
                          const hex = "0x" + item.mask.toString(16).toUpperCase().padStart(2, "0");
                          return (
                            <button key={item.mask} type="button" className={active ? "is-active" : ""}
                              aria-pressed={active}
                              aria-label={hex + " · " + labels.join(", ") + " · " + item.pixels.toLocaleString() + " pixels"}
                              onClick={() => setSelectedFlagMask(item.mask)}>
                              <span className="agri-flag-atlas__mask">{hex}</span>
                              <span className="agri-flag-atlas__matrix" aria-hidden="true">
                                {SURFACE_FLAG_LABELS.map((_flag, bit) => (
                                  <i key={bit} className={(item.mask & (1 << bit)) !== 0 ? "is-on" : ""} />
                                ))}
                              </span>
                              <span className="agri-flag-atlas__count">
                                <strong>{item.pixels.toLocaleString()}</strong>
                                <small>{formatPercent(item.pixels / surfaceDiagnostics.encoded_pixels)}</small>
                              </span>
                              <span className="agri-flag-atlas__bar" aria-hidden="true">
                                <i style={{ width: formatPercent(item.pixels / flagCombinationMax) }} />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {flagCombinations.length > 8 && (
                        <button type="button" className="agri-flag-atlas__more"
                          aria-expanded={showAllFlagCombinations}
                          onClick={() => setShowAllFlagCombinations((value) => !value)}>
                          {showAllFlagCombinations ? "Show the 8 most frequent signatures" : "Show all " + flagCombinations.length + " signatures"}
                        </button>
                      )}
                      {selectedFlagCombination && (
                        <div className="agri-flag-atlas__detail" aria-live="polite">
                          <div className="agri-flag-atlas__detail-head">
                            <span>SELECTED BIT PATTERN</span>
                            <strong>{"0x" + selectedFlagCombination.mask.toString(16).toUpperCase().padStart(2, "0")}</strong>
                          </div>
                          <div className="agri-flag-atlas__detail-flags">
                            {selectedFlagLabels.map((flag) => (
                              <div key={flag.id}><strong>{flag.label}</strong><small>{flag.detail}</small></div>
                            ))}
                          </div>
                          <p><strong>{selectedFlagCombination.pixels.toLocaleString()} pixels</strong> · {formatPercent(selectedFlagCombination.pixels / surfaceDiagnostics.total_aoi_pixels)} of the AOI · {formatPercent(selectedFlagCombination.pixels / surfaceDiagnostics.encoded_pixels)} of encoded pixels.</p>
                        </div>
                      )}
                    </>
                  )}
                </section>
                <p className="agri-observability__note">
                  Marginal flag counts are <strong>not mutually exclusive</strong>: one pixel can carry several bits. The overlap atlas groups each encoded pixel into exactly one raw bit pattern, so its row counts sum to the flagged total. Neither view relaxes the current surfaceQualityFlag == 0 rule. A surface-flag-clear pixel can still fail retrieval, moisture, uncertainty or fill checks in the full SME2 quality screen.
                </p>
              </section>
            ) : (
              <section className="agri-observability agri-observability--empty" aria-label="Surface flag breakdown unavailable">
                <div className="agri-observability__head">
                  <div><span className="agri-eyebrow">AGRICULTURAL OBSERVABILITY · STEP 1A</span><strong>Surface-flag breakdown unavailable</strong></div>
                  <span className="agri-observability__date">NOT RECORDED</span>
                </div>
                <p className="agri-observability__note">This publication predates the per-bit surface-flag audit. Re-run the local analysis to record the documented exclusion reasons; no reason is inferred from missing values.</p>
              </section>
            )}
            {cropObservability ? (
              <section className="agri-crop-gate" aria-labelledby="agri-crop-gate-title">
                <div className="agri-crop-gate__head">
                  <div>
                    <span className="agri-eyebrow">AGRICULTURAL OBSERVABILITY · STEP 1B</span>
                    <strong id="agri-crop-gate-title">Independent crop-area gate</strong>
                    <small>Crop probability → SME2 native-cell area support → quality-valid crop area</small>
                  </div>
                  <span className={"agri-crop-gate__status is-" + cropObservability.common_support.status.toLowerCase().replaceAll("_", "-")}>
                    {cropObservability.common_support.status.replaceAll("_", " ")}
                  </span>
                </div>
                <div className="agri-crop-gate__stats">
                  <div><span>Source cells covered</span><strong>{formatPercent(cropObservability.mask_coverage_fraction)}</strong><small>{cropObservability.mask_covered_cells.toLocaleString()} / {cropObservability.aoi_native_cells.toLocaleString()} native cells</small></div>
                  <div><span>Mapped crop area</span><strong>{cropObservability.crop_area_equivalent_pixels.toFixed(1)}</strong><small>SME2-cell area equivalents · fractional edges retained</small></div>
                  <div><span>Common crop area</span><strong>{formatPercent(cropObservability.common_support.valid_crop_area_fraction)}</strong><small>{cropObservability.common_support.valid_crop_area_equivalent_pixels.toFixed(1)} of {cropObservability.crop_area_equivalent_pixels.toFixed(1)} crop-area equivalents</small></div>
                </div>
                <div className="agri-crop-gate__track" aria-label={"Crop mask coverage " + formatPercent(cropObservability.mask_coverage_fraction)}>
                  <i style={{ width: formatPercent(cropObservability.mask_coverage_fraction) }} />
                </div>
                <div className="agri-crop-gate__date-list" aria-label="Select a date to inspect quality-valid mapped crop area">
                  {cropObservability.observations.map((item, index) => {
                    const active = index === selectedIndex;
                    const status = item.status ?? "NOT ASSESSED";
                    return (
                      <button key={item.date} type="button" className={active ? "is-active" : ""} aria-pressed={active}
                        onClick={() => { setSelectedIndex(index); setLayer("crop"); }}>
                        <span className="agri-crop-gate__date">{dateLabel(item.date)}</span>
                        <span className="agri-crop-gate__row-status">{status.replaceAll("_", " ")}</span>
                        <strong>{formatPercent(item.valid_crop_area_fraction)}</strong>
                        <span className="agri-crop-gate__track"><i style={{ width: formatPercent(item.valid_crop_area_fraction) }} /></span>
                        <small>{item.valid_crop_area_equivalent_pixels.toFixed(1)} crop-area eq. px · {item.weighted_soil_moisture ? formatMoisture(item.weighted_soil_moisture.median) : "No valid crop moisture"}</small>
                      </button>
                    );
                  })}
                </div>
                <div className="agri-crop-gate__controls">
                  <button type="button" aria-pressed={layer === "crop"} onClick={() => setLayer("crop")} disabled={!cropObservability.preview}>View crop-area support</button>
                  <button type="button" aria-pressed={layer === "crop-common"} onClick={() => setLayer("crop-common")} disabled={!cropObservability.common_support.preview}>View all-date crop cohort</button>
                  <button type="button" aria-pressed={layer === "crop-source"} onClick={() => setLayer("crop-source")}>View mask quality</button>
                  <span>{layer === "crop-common" ? "Fixed all-date crop cohort" : layer === "crop" ? "Selected-date crop mask support" : layer === "crop-source" ? "Source-data coverage for each native SME2 cell" : "Select a date row or map layer to inspect the crop mask"}</span>
                </div>
                <dl className="agri-crop-gate__provenance">
                  <div><dt>Independent source</dt><dd>{cropObservability.source}</dd></div>
                  <div><dt>Source date</dt><dd>{cropObservability.source_date ? dateLabel(cropObservability.source_date) : "Not supplied"}</dd></div>
                  <div><dt>Probability threshold</dt><dd>{cropObservability.probability_threshold.toFixed(2)}</dd></div>
                  <div><dt>Within-cell source coverage floor</dt><dd>{formatPercent(cropObservability.minimum_cell_coverage)}</dd></div>
                  <div><dt>Source average coverage</dt><dd>{formatPercent(cropObservability.mean_source_data_coverage_fraction)}</dd></div>
                  <div><dt>Mask checksum</dt><dd><code>{cropObservability.source_sha256.slice(0, 18)}…</code></dd></div>
                </dl>
                <p className="agri-crop-gate__note">
                  Crop weights are the area share of source pixels meeting the selected probability threshold within each native SME2 cell. SME2 still measures the complete native cell, which may mix crop and non-crop land; area weighting does not isolate moisture inside cropped sub-pixels. This is not crop-species identification, a verified parcel boundary, root-zone moisture, or a crop-stress diagnosis. Per-date and fixed-cohort summaries preserve the existing strict SME2 quality screen; missing mask area is not labelled non-crop.
                </p>
              </section>
            ) : (
              <section className="agri-crop-gate agri-crop-gate--empty" aria-label="Independent crop mask not assessed">
                <div className="agri-crop-gate__head">
                  <div><span className="agri-eyebrow">AGRICULTURAL OBSERVABILITY · STEP 1B</span><strong>Independent crop-area gate</strong></div>
                  <span className="agri-crop-gate__status">NOT ASSESSED</span>
                </div>
                <p>No independent crop-probability mask was supplied for this study. The AOI is not assumed to be cropland. Add a buffered, fine-resolution probability/binary GeoTIFF in the Operator tab to calculate area-weighted crop support.</p>
              </section>
            )}
            {supportDriftPlot && supportDriftStats ? (
              <section className="agri-support-drift" aria-labelledby="agri-support-drift-title">
                <div className="agri-support-drift__head">
                  <div>
                    <span className="agri-eyebrow">SPATIAL SUPPORT SENSITIVITY</span>
                    <strong id="agri-support-drift-title">Does the valid footprint change the story?</strong>
                  </div>
                  <span className={"agri-support-drift__status is-" + study.matched_support.status.toLowerCase().replaceAll("_", "-")}>
                    {study.matched_support.status.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="agri-support-drift__intro">
                  Each date compares its own valid-pixel median with the median over one fixed cohort that passed quality screening on every date.
                </p>
                <div className="agri-support-drift__stats">
                  <div><span>Median |gap|</span><strong>{formatMoisture(supportDriftStats.medianAbsoluteGap)}</strong></div>
                  <div><span>Gap shift · first to last</span><strong>{formatDifference(supportDriftStats.gapShift)}</strong></div>
                  <div><span>Largest |gap|</span><strong>{formatMoisture(Math.abs(supportDriftStats.largestGap))}</strong><small>{dateLabel(supportDriftStats.largestGapDate)}</small></div>
                </div>
                <div className="agri-support-drift__plot">
                  <svg viewBox="0 0 720 178" role="img" aria-label={"Date-valid and fixed-cohort median soil moisture across " + supportDrift.length + " dates. Vertical connectors show the sample-composition gap."}>
                    <line x1="42" x2="678" y1="18" y2="18" className="agri-support-drift__grid" />
                    <line x1="42" x2="678" y1="79" y2="79" className="agri-support-drift__grid" />
                    <line x1="42" x2="678" y1="140" y2="140" className="agri-support-drift__grid" />
                    <text x="4" y="22" className="agri-support-drift__axis">{supportDriftPlot.max.toFixed(2)}</text>
                    <text x="4" y="144" className="agri-support-drift__axis">{supportDriftPlot.min.toFixed(2)}</text>
                    {supportDriftPlot.points.map((point) => (
                      <line
                        key={"gap-" + point.date}
                        x1={point.x}
                        x2={point.x}
                        y1={point.dateValidY}
                        y2={point.samePixelY}
                        className="agri-support-drift__connector"
                      />
                    ))}
                    {supportDriftPlot.points.slice(1).map((point, index) => {
                      const previous = supportDriftPlot.points[index];
                      const extendedGap = point.gapDays !== null && point.gapDays > LONG_ACQUISITION_GAP_DAYS;
                      const gapClass = extendedGap ? " is-extended-gap" : "";
                      return (
                        <g key={"series-" + point.date}>
                          <line x1={previous.x} y1={previous.dateValidY} x2={point.x} y2={point.dateValidY}
                            className={"agri-support-drift__line agri-support-drift__line--valid" + gapClass} />
                          <line x1={previous.x} y1={previous.samePixelY} x2={point.x} y2={point.samePixelY}
                            className={"agri-support-drift__line agri-support-drift__line--fixed" + gapClass} />
                        </g>
                      );
                    })}
                    {supportDriftPlot.points.map((point) => (
                      <g key={"point-" + point.date}>
                        <circle cx={point.x} cy={point.dateValidY} r="4" className="agri-support-drift__point agri-support-drift__point--valid" />
                        <circle cx={point.x} cy={point.samePixelY} r="4" className="agri-support-drift__point agri-support-drift__point--fixed" />
                      </g>
                    ))}
                    <text x="42" y="166" className="agri-support-drift__date">{dateLabel(supportDrift[0].date)}</text>
                    <text x="678" y="166" textAnchor="end" className="agri-support-drift__date">{dateLabel(supportDrift[supportDrift.length - 1].date)}</text>
                  </svg>
                </div>
                <div className="agri-support-drift__legend">
                  <span><i className="is-valid" />Date-valid footprint median</span>
                  <span><i className="is-fixed" />Fixed all-date cohort median</span>
                  <span><i className="is-gap" />Gap at each acquisition</span>
                  <span><i className="is-gap-extended" />Dashed segment · extended interval (&gt;{LONG_ACQUISITION_GAP_DAYS} days)</span>
                </div>
                <p className="agri-support-drift__note">
                  Gap = date-valid median − fixed-cohort median. A changing gap warns that different valid-pixel footprints may alter the apparent series. It is not another moisture measurement, a correction to the SME2 product, or evidence of crop stress. {study.matched_support.status === "INCONCLUSIVE_COVERAGE" ? "The fixed cohort is below the 20% AOI coverage floor, so this comparison remains inconclusive." : ""}
                </p>
              </section>
            ) : study.matched_support.valid_pixels === 0 ? (
              <section className="agri-support-drift agri-support-drift--empty" aria-label="Spatial support sensitivity unavailable">
                <div className="agri-support-drift__head">
                  <div><span className="agri-eyebrow">SPATIAL SUPPORT SENSITIVITY</span><strong>No shared native pixels across all dates</strong></div>
                  <span className="agri-support-drift__status is-no-common-pixels">NOT AVAILABLE</span>
                </div>
                <p className="agri-support-drift__note">A date-by-date gap cannot be calculated without a fixed cohort. The audit is not widened or interpolated to create one.</p>
              </section>
            ) : null}
            <div className="agri-reading">
              <span className="agri-eyebrow">CURRENT LAYER</span>
              <strong>{layer === "change" ? "Latest − baseline median"
                : layer === "matched" ? "Soil moisture · fixed pixel cohort"
                : layer === "crop" ? "Independent crop mask · native-cell fraction"
                : layer === "crop-common" ? "Crop area · fixed all-date cohort"
                : layer === "crop-source" ? "Mask quality · per-cell source coverage"
                : "Soil moisture · selected date"}</strong>
              <p>{layer === "change"
                ? "Difference between " + study.target_date + " and the pixel-wise median of " + study.baseline_count + " baseline dates. Positive and negative values are changes in the measured soil-moisture variable, not crop-health classifications. The displayed uncertainty remains the target-date product uncertainty; it is not propagated into this difference."
                : layer === "matched"
                  ? "The selected date is summarized only over native pixels that passed the SME2 quality screen on every date in this study. Pixels are neither interpolated nor substituted."
                  : layer === "crop"
                    ? "The overlay shows the area fraction of source pixels meeting the independent crop threshold inside each native SME2 cell. Cells with insufficient source coverage are transparent; no crop identity is inferred from the SME2 moisture measurements."
                    : layer === "crop-common"
                      ? "The overlay retains only mapped crop-area cells that passed the unchanged SME2 quality screen on every date. This is a strict comparability cohort, not a crop-health or representativeness guarantee."
                      : layer === "crop-source"
                        ? "Each native SME2 cell is coloured by the fraction of source-mask pixels with valid data. Green meets the configured within-cell coverage floor, amber is partial, and red indicates no valid source data. This is source-input quality, not crop classification."
                        : "The selected observation is " + (selectedObservation ? dateLabel(selectedObservation.date) : "not selected") + ". The estimate is displayed with its date-specific valid-pixel coverage and uncertainty."}</p>
            </div>
            {previewError && <p className="agri-alert" role="alert">{previewError}</p>}
            <button type="button" className="agri-secondary-button" onClick={exportCsv}>Export dated statistics · CSV</button>
          </> : <div className="agri-no-study">
            <strong>No published SME2 result yet</strong>
            <p>The workspace is ready, but no genuine, checksum-verified Agriculture study has been published here.</p>
            <div className="agri-empty-method">
              <span className="agri-eyebrow">NEW ANALYSIS MODE · READY FOR REAL DATA</span>
              <strong>Same-pixel time-series audit</strong>
              <p>Once a real compatible SME2 series is processed, compare each date&apos;s full valid footprint with one fixed cohort of pixels that passed the quality screen on every date.</p>
            </div>
            <small>No demo values or synthetic maps are shown while the real study is unpublished.</small>
          </div>}
        </div>
      ),
    },
    {
      id: "operator", number: "02", label: "Operator", hint: "Discover and select NISAR SME2 observations online",
      content: (
        <div className="agri-drawer-panel">
          <p className="agri-intro">Discover compatible NISAR SME2 observations directly from this website. Public catalogue discovery does not require Earthdata login, Python installation or terminal commands.</p>
          <div className="agri-form-section">
            <div className="agri-section-heading"><span className="agri-eyebrow">01 / STUDY AREA</span><span>WGS84 · decimal degrees · max 2°</span></div>
            <div className="agri-coordinate-grid">
              <label>West<input inputMode="decimal" value={west} onChange={(event) => setWest(event.target.value)} placeholder="e.g. 91.38" aria-label="AOI west longitude" /></label>
              <label>South<input inputMode="decimal" value={south} onChange={(event) => setSouth(event.target.value)} placeholder="e.g. 24.35" aria-label="AOI south latitude" /></label>
              <label>East<input inputMode="decimal" value={east} onChange={(event) => setEast(event.target.value)} placeholder="e.g. 91.44" aria-label="AOI east longitude" /></label>
              <label>North<input inputMode="decimal" value={north} onChange={(event) => setNorth(event.target.value)} placeholder="e.g. 24.41" aria-label="AOI north latitude" /></label>
            </div>
            <p className="agri-small-note">The current starting area is the documented Baniachong BRRI experimental-site vicinity. Adjust the rectangle or enter another WGS84 area.</p>
          </div>
          <div className="agri-form-section">
            <div className="agri-section-heading"><span className="agri-eyebrow">02 / TIME WINDOW</span><span>SME2 collection · maximum 366 days</span></div>
            <div className="agri-date-grid">
              <label>Start date<input type="date" min={MIN_DATE} max={MAX_DATE} value={start} onChange={(event) => setStart(event.target.value)} /></label>
              <label>End date<input type="date" min={MIN_DATE} max={MAX_DATE} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
            </div>
          </div>
          <div className={"agri-validation " + (formValid ? "is-valid" : "is-invalid")} role="status">
            <i aria-hidden="true" />{formValid ? "WGS84 area and date range are valid for catalogue discovery." : "Enter a valid non-crossing WGS84 rectangle and ordered dates."}
          </div>
          <button type="button" className="agri-primary-button" disabled={!formValid || catalogueStatus === "searching"} onClick={() => void searchAgricultureCatalogue()}>
            {catalogueStatus === "searching" ? "Searching NASA catalogue…" : "Discover SME2 observations"}
          </button>
          {catalogueStatus === "error" && <p className="agri-alert" role="alert">{catalogueError}</p>}
          {catalogueResult && <section className="agri-online-results" aria-label="NASA SME2 catalogue results">
            <div className="agri-online-results__header">
              <div><span className="agri-eyebrow">LIVE NASA CMR RESULT</span><strong>{catalogueResult.catalogue_granules.toLocaleString()} catalogue granules</strong></div>
              <span className={"agri-online-results__status " + (catalogueResult.status === "ELIGIBLE_FOR_OPERATOR_REVIEW" ? "is-ready" : "is-warning")}>
                {catalogueResult.status.replaceAll("_", " ")}
              </span>
            </div>
            <p>{catalogueResult.series.length} separate compatible time series were found. Different tracks and acquisition geometries are kept separate.</p>
            {catalogueResult.series.length === 0 ? (
              <div className="agri-online-empty">No supported SME2 series matched this AOI and date range. This is not evidence of zero soil moisture or no agriculture.</div>
            ) : (
              <div className="agri-online-series-list">
                {catalogueResult.series.map((series) => {
                  const active = selectedSeriesId === series.series_id;
                  return <button
                    type="button"
                    key={series.series_id}
                    className={"agri-online-series" + (active ? " is-selected" : "")}
                    aria-pressed={active}
                    onClick={() => setSelectedSeriesId(series.series_id)}
                  >
                    <div className="agri-online-series__top">
                      <strong>Track {series.signature.track} · Frame {series.signature.frame}</strong>
                      <span>{series.meets_preflight_gate ? "PRE-FLIGHT PASS" : "BELOW PRE-FLIGHT GATE"}</span>
                    </div>
                    <div className="agri-online-series__metrics">
                      <div><strong>{series.observation_count}</strong><small>acquisitions</small></div>
                      <div><strong>{series.span_days}d</strong><small>time span</small></div>
                      <div><strong>{series.median_revisit_days ?? "—"}d</strong><small>median revisit</small></div>
                      <div><strong>{series.maximum_gap_days ?? "—"}d</strong><small>largest gap</small></div>
                    </div>
                    <div className="agri-online-series__identity">
                      {series.signature.direction === "A" ? "Ascending" : "Descending"} · {series.signature.polarization} · {series.signature.bandwidth} · {series.signature.frequency} · {series.signature.release}
                      <span>Series {series.series_id}</span>
                    </div>
                    <div className="agri-online-series__dates">
                      {series.dates.map((date) => <span key={date}>{date.slice(5)}</span>)}
                    </div>
                  </button>;
                })}
              </div>
            )}
            {catalogueResult.interpretation_limits.map((note) => <small className="agri-online-results__note" key={note}>• {note}</small>)}
            {selectedSeriesId && catalogueResult.series.some((series) => series.series_id === selectedSeriesId) && <div className="agri-online-next">
              <span className="agri-eyebrow">NEXT · SECURE PROCESSING</span>
              <strong>Series selected: {selectedSeriesId}</strong>
              <p>Catalogue discovery now runs on the website. Downloading original HDF5 granules and producing a checksum-verified study will run through a hosted worker with NASA Earthdata authorization. That worker is the next integration; it will not require Python on your PC or expose your NASA password to this site.</p>
              <div className="agri-online-next__status"><i aria-hidden="true" />Hosted processing service not connected yet</div>
            </div>}
          </section>}
          <p className="agri-small-note">This online step reads public NASA catalogue metadata only. It does not download HDF5 files or claim that the returned pixels pass the SME2 quality screen. No local setup is needed for discovery.</p>
        </div>
      ),
    },
    {
      id: "evidence", number: "03", label: "Evidence", hint: "Review product maturity, quality flags, coverage and provenance", anchorIds: ["agri-evidence-intro"],
      content: (
        <div className="agri-drawer-panel" id="agri-evidence-intro">
          <p className="agri-intro">The workspace separates the product&apos;s observations, derived differences and contextual sources. SME2 PROVISIONAL is not a fully calibrated agricultural decision product.</p>
          {study ? <>
            <div className={"agri-verdict " + (study.evidence_status === "INCONCLUSIVE_COVERAGE" ? "is-inconclusive" : "")}>
              <span className="agri-eyebrow">EVIDENCE STATUS</span>
              <strong>{study.evidence_status === "INCONCLUSIVE_COVERAGE" ? "Inconclusive · coverage below 20%" : "Exploratory · not independently validated"}</strong>
              <p>Target coverage: {formatPercent(target?.valid_fraction ?? 0)} · change coverage: {formatPercent(study.change_summary.valid_fraction)} · fixed floor: 20%.</p>
            </div>
            <div className={"agri-verdict " + (study.matched_support.status === "COMPARABLE" ? "" : "is-inconclusive")}>
              <span className="agri-eyebrow">SAME-PIXEL SUPPORT</span>
              <strong>{study.matched_support.status.replaceAll("_", " ")}</strong>
              <p>{study.matched_support.valid_pixels.toLocaleString()} of {study.matched_support.total_pixels.toLocaleString()} AOI pixels ({formatPercent(study.matched_support.valid_fraction)}) remain valid on every date. This tests temporal sample consistency, not retrieval accuracy.</p>
            </div>
            <details className="agri-details" open>
              <summary>Quality and screening protocol</summary>
              <ul>
                <li>Soil moisture must be finite and within 0.02–0.60 m³/m³.</li>
                <li>Uncertainty must be finite and non-negative.</li>
                <li>retrievalQualityFlag bits 0–3 must all be set; anomaly bits 4–7 must be clear.</li>
                <li>surfaceQualityFlag must equal zero. This excludes water, urban, precipitation, snow/ice, frozen-ground, terrain and dense-vegetation flags; it can reduce coverage over crop areas. Fractional flags and NoData remain unassessed.</li>
                <li>All observations must share the same release and native grid; no resampling is performed.</li>
              </ul>
            </details>
            <details className="agri-details">
              <summary>Source and processing provenance</summary>
              <dl className="agri-provenance">
                <div><dt>Collection</dt><dd>{study.product}</dd></div>
                <div><dt>Maturity</dt><dd>{study.product_maturity}</dd></div>
                <div><dt>Release</dt><dd>{study.release}</dd></div>
                <div><dt>Track / frame</dt><dd>{study.track} / {study.frame}</dd></div>
                <div><dt>Direction / frequency</dt><dd>{study.direction} / {study.frequency}</dd></div>
                <div><dt>Baseline dates</dt><dd>{study.baseline_dates.map(dateLabel).join(", ")}</dd></div>
              </dl>
            </details>
            <details className="agri-details">
              <summary>Granule identity and source hashes</summary>
              <ul className="agri-granule-list">
                {study.observations.map((item) => <li key={item.date}>
                  <strong>{dateLabel(item.date)}</strong>
                  <span>{item.granule_name ?? "Granule filename not recorded"}</span>
                  <code>{item.source_sha256 ?? "Source digest not recorded"}</code>
                </li>)}
              </ul>
            </details>
          </> : <div className="agri-no-study"><strong>No study provenance loaded</strong><p>Source metadata and statistics will appear only after a real publication passes schema and checksum verification.</p></div>}
          {study?.crop_observability && (
            <div className="agri-verdict">
              <span className="agri-eyebrow">INDEPENDENT CROP OBSERVABILITY</span>
              <strong>{study.crop_observability.common_support.status.replaceAll("_", " ")}</strong>
              <p>{formatPercent(study.crop_observability.mask_coverage_fraction)} of AOI native cells have adequate mask coverage; {formatPercent(study.crop_observability.common_support.valid_crop_area_fraction)} of mapped crop area remains quality-valid across every SME2 date. Source: {study.crop_observability.source}. Threshold: {study.crop_observability.probability_threshold.toFixed(2)}.</p>
            </div>
          )}
          <details className="agri-details">
            <summary>Same-pixel comparability method</summary>
            <p className="agri-details-copy">The cohort is the intersection of every acquisition&apos;s existing SME2 quality-valid mask inside the AOI. Each date is re-summarized on that exact fixed set of native grid pixels. The audit does not resample, fill missing values, or imply that the smaller cohort represents the entire AOI.</p>
            <p className="agri-details-copy">A cohort below the fixed 20% AOI floor is shown as inconclusive. A zero-pixel intersection is shown as unavailable; it is not widened to produce a chart.</p>
          </details>
          <div className="agri-source-list">
            <strong>Official references</strong>
            <a href="https://nisar-docs.asf.alaska.edu/sme2/" target="_blank" rel="noreferrer">ASF NISAR SME2 guide ↗</a>
            <a href="https://nisar-docs.asf.alaska.edu/provisional-known-issues/" target="_blank" rel="noreferrer">PROVISIONAL product known issues ↗</a>
            <a href="https://earthaccess.readthedocs.io/en/latest/api/" target="_blank" rel="noreferrer">earthaccess API documentation ↗</a>
          </div>
          <p className="agri-small-note">Unsigned SHA-256 checksums protect against accidental changes relative to the published manifest. They are not digital signatures or proof of NASA authenticity.</p>
        </div>
      ),
    },
    {
      id: "check", number: "04", label: "Check it",
      hint: "Follow the soil-moisture measurement, reference status and uncertainty",
      anchorIds: ["agri-check-intro"],
      content: (
        <div className="agri-drawer-panel" id="agri-check-intro">
          <p className="agri-intro">Follow the complete chain from the native SME2 observations through the quality screen to independent reference availability. A missing reference is shown as missing, not as a negative result.</p>
          <EvidenceChainPanel chain={evidenceChain} />
          <div className="agri-evidence-download">
            <TriageBriefButton
              filename="agriculture-sme2-evidence-chain.json"
              title="Agriculture SME2 evidence brief"
              brief={{
                module: evidenceChain.module,
                study_id: evidenceChain.study_id,
                site_name: evidenceChain.site_name,
                modality: evidenceChain.modality,
                product: evidenceChain.product,
                product_maturity: evidenceChain.product_maturity,
                state: evidenceChain.state,
                conclusion: evidenceChain.conclusion,
                observations: evidenceChain.observations,
                method: evidenceChain.method,
                measurements: evidenceChain.measurements,
                references: evidenceChain.references,
                provenance: evidenceChain.provenance,
                uncertainty_and_limits: evidenceChain.uncertainty_and_limits,
                matched_support: study?.matched_support ?? null,
                crop_observability: study?.crop_observability ?? null,
              }}
            />
          </div>
        </div>
      ),
    },
    {
      id: "learn", number: "05", label: "Learn",
      hint: "Understand SME2 measurements, quality flags and interpretation limits",
      anchorIds: ["agri-learn-intro"],
      content: (
        <div className="agri-drawer-panel" id="agri-learn-intro">
          <p className="agri-intro">Learn how to read the SME2 soil-moisture product and what it can—and cannot—support. The product measures soil moisture, not crop health.</p>
          <div className="agri-reading">
            <span className="agri-eyebrow">WHAT IS MEASURED</span>
            <strong>Volumetric soil-moisture estimate · m³/m³</strong>
            <p>SME2 estimates the amount of water in the soil volume. This is a physical soil-moisture variable; it is not a direct measurement of plant stress, irrigation need, crop yield, or drought impact.</p>
          </div>
          <div className="agri-reading">
            <span className="agri-eyebrow">HOW THE CHANGE LAYER WORKS</span>
            <strong>Latest observation minus a multi-date baseline</strong>
            <p>The published workflow uses the first three unique compatible dates as its baseline and compares the latest date against their pixel-wise median. Positive and negative values indicate change in the measured soil-moisture estimate. The current uncertainty display is the target-date product uncertainty, not propagated uncertainty for the difference.</p>
          </div>
          <div className="agri-reading">
            <span className="agri-eyebrow">QUALITY IS NOT GROUND TRUTH</span>
            <strong>Flags control what is assessed</strong>
            <p>The conservative surface-quality screen accepts only zero-valued surface flags. It can exclude dense vegetation in crop areas. Excluded pixels are unassessed—not evidence of dry soil or healthy crops. A 20% coverage floor marks a study inconclusive when target or change coverage falls below it.</p>
          </div>
          <div className="agri-reading">
            <span className="agri-eyebrow">WHY SAME-PIXEL COMPARISON MATTERS</span>
            <strong>Separate moisture movement from changing spatial support</strong>
            <p>Date-specific medians can represent different sets of valid pixels as quality flags and acquisition gaps change. The same-pixel trajectory fixes the cohort to the intersection of all dates, so both trajectories can be compared. A difference between their medians is a sample-composition gap, not another moisture-change measurement. The matched cohort can become small or empty; when that happens, the app reports inconclusive or unavailable rather than filling gaps.</p>
          </div>
          <div className="agri-reading">
            <span className="agri-eyebrow">HOW TO READ THE SUPPORT-DRIFT PROFILE</span>
            <strong>Track the gap between two spatial samples</strong>
            <p>For each date, the profile compares the median across all pixels valid on that date with the median across the fixed pixels valid on every date. A changing gap is a warning that footprint composition may alter the apparent time series. It is a descriptive sensitivity check, not a validated correction or a new physical measurement. A fixed cohort below 20% of AOI pixels remains inconclusive.</p>
          </div>
          <div className="agri-reading">
            <span className="agri-eyebrow">WHAT VALIDATION WOULD NEED</span>
            <strong>Independent field or matched crop/soil observations</strong>
            <p>A stronger agricultural interpretation requires time-matched field soil-moisture readings or a suitable independent reference with known dates, spatial support, quality screening and labelled comparison samples. Without that, precision, recall and F1 must remain unavailable.</p>
          </div>
          <p className="agri-small-note">Do not interpret SME2 PROVISIONAL values as crop-stress alerts, drought classifications, yield forecasts, or operational irrigation advice.</p>
        </div>
      ),
    },
  ];

  return (
    <InvestigationWorkspace
      hazard="agriculture"
      className="agriculture-workspace"
      caseName="SME2 soil-moisture feasibility"
      title="Agriculture · soil moisture"
      subtitle="Explore dated NISAR SME2 PROVISIONAL estimates, quality flags and uncertainty without inferring crop health."
      questContent={<span className={"agri-status-pill " + (loadState === "ready" ? "is-ready" : loadState === "error" ? "is-error" : "")}><i aria-hidden="true" />{statusText}</span>}
      rail={<div className="agri-rail">
        <HazardWalkthrough
          guideTitle="AGRICULTURE CASE GUIDE"
          steps={[
            { title: "Inspect the SME2 measurements", target: "agri-explore-intro", explanation: "Select a dated observation, compare the soil-moisture layer with the latest-minus-baseline difference, and read its valid-pixel coverage." },
            { title: "Check evidence and provenance", target: "agri-check-intro", explanation: "Follow the product metadata, quality-screen rules, uncertainty, independent-reference status and what remains unassessed." },
            { title: "Understand the interpretation limits", target: "agri-learn-intro", explanation: "SME2 measures soil moisture. It is not a crop-health classifier; independent field observations are needed for stronger agricultural validation." },
          ]}
        />
        <span className="agri-eyebrow">MEASUREMENT WORKSPACE</span>
        <strong>{study ? study.study_id : "No study published"}</strong>
        <p>{study ? study.observations.length + " dated observations · " + study.release : "Configure an area and run the local SME2 workflow to publish a real result."}</p>
        <div className="agri-rail-divider" />
        <span className="agri-eyebrow">PRODUCT MATURITY</span>
        <strong className="agri-rail-maturity">NISAR L3 · PROVISIONAL</strong>
        <p>Exploratory soil-moisture evidence. Not crop classification.</p>
      </div>}
      map={<AgricultureMap aoi={aoi} displayBounds={study?.preview_bounds ?? null} previewUrl={previewUrl} satelliteBasemap={satelliteBasemap} noStudy={noStudy} layer={layer} />}
      mapToolbar={<div className="agri-map-toolbar" role="group" aria-label="Agriculture map layers">
        <button type="button" aria-pressed={layer === "moisture"} disabled={!study} onClick={() => { setLayer("moisture"); setSeriesSupportMode("date-valid"); }}>Soil moisture</button>
        <button type="button" aria-pressed={layer === "change"} disabled={!study} onClick={() => setLayer("change")}>Change</button>
        <button type="button" aria-pressed={layer === "matched"} disabled={!study || study.matched_support.observations.length === 0} onClick={() => { setLayer("matched"); setSeriesSupportMode("same-pixels"); }}>Same pixels</button>
        <button type="button" aria-pressed={layer === "crop"} disabled={!cropObservability?.preview} onClick={() => setLayer("crop")}>Crop area</button>
        <button type="button" aria-pressed={layer === "crop-common"} disabled={!cropObservability?.common_support.preview} onClick={() => setLayer("crop-common")}>Crop cohort</button>
        <button type="button" aria-pressed={layer === "crop-source"} disabled={!cropObservability?.source_coverage_preview} onClick={() => setLayer("crop-source")}>Mask QA</button>
        <span>{layer === "change" ? "Latest − baseline" : layer === "matched" ? "All dates · fixed cohort" : layer === "crop" ? "Independent crop-area mask" : layer === "crop-common" ? "Quality-valid crop area · all dates" : layer === "crop-source" ? "Independent mask source coverage" : selectedObservation ? dateLabel(selectedObservation.date) : "No layer loaded"}</span>
      </div>}
      drawerTabs={drawerTabs}
      drawerPersistent={<div className={"agri-drawer-status " + (loadState === "error" ? "is-error" : "")}><i aria-hidden="true" />{loadState === "error" ? loadError : loadState === "ready" ? "SHA-256 checked · " + (study?.evidence_status ?? "") : noStudy ? "No real Agriculture publication is bundled." : "No synthetic study is substituted."}</div>}
      drawer={<div className="agri-drawer-panel"><p>Choose Explore, Operator, Evidence, Check it or Learn.</p></div>}
      footer={<div className="agri-footer">
        <div className="agri-footer-head">
          <span className="agri-eyebrow">OBSERVATION TIMELINE</span>
          <span>{study ? (selectedIndex + 1) + " / " + study.observations.length + " · " + study.target_date + " target" : "No dated SME2 observations published"}</span>
        </div>
        {study ? <>
          <div className="agri-support-switch" role="group" aria-label="Choose the pixel support used for the soil-moisture time series">
            <button type="button" aria-pressed={seriesSupportMode === "date-valid"} onClick={() => { setSeriesSupportMode("date-valid"); if (layer === "matched") setLayer("moisture"); }}>
              <strong>Date-valid footprint</strong><span>Each date uses its own quality-valid pixels</span>
            </button>
            <button type="button" aria-pressed={seriesSupportMode === "same-pixels"} disabled={study.matched_support.observations.length === 0} onClick={() => { setSeriesSupportMode("same-pixels"); setLayer("matched"); }}>
              <strong>Same pixels across dates</strong><span>{formatPercent(study.matched_support.valid_fraction)} of AOI · {study.matched_support.status.replaceAll("_", " ")}</span>
            </button>
          </div>
          <div className="agri-date-rail" role="group" aria-label="Select an SME2 acquisition on the elapsed calendar-time axis">
            <svg className="agri-date-rail__track" viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true">
              {chartPoints.slice(1).map((point, index) => {
                const previous = chartPoints[index];
                const extendedGap = point.gapDays !== null && point.gapDays > LONG_ACQUISITION_GAP_DAYS;
                return <line key={point.date} x1={previous.x} y1="10" x2={point.x} y2="10"
                  className={extendedGap ? "is-extended-gap" : ""} />;
              })}
            </svg>
            {chartPoints.map((point, index) => (
              <button key={point.date} type="button"
                className={index === selectedIndex ? "is-active" : ""}
                style={{ left: point.x + "%" }}
                aria-pressed={index === selectedIndex}
                aria-label={"Select " + dateLabel(point.date) + "; " + formatMoisture(point.median) + "; " + formatPercent(point.valid_fraction) + " valid coverage" + (point.gapDays === null ? "; first acquisition" : "; " + point.gapDays + " days since previous acquisition")}
                title={point.gapDays === null ? "First acquisition" : point.gapDays + " days since previous acquisition"}
                onClick={() => { setSelectedIndex(index); if (layer === "change") setLayer(seriesSupportMode === "same-pixels" ? "matched" : "moisture"); }}>
                <span />
              </button>
            ))}
            <div className="agri-date-rail__axis" aria-hidden="true">
              {chartDateTicks.map((tick, index) => (
                <span key={tick.position}
                  className={chartDateTicks.length === 1 ? "is-center" : index === 0 ? "is-start" : index === chartDateTicks.length - 1 ? "is-end" : ""}
                  style={{ left: tick.position + "%" }}>{shortDateLabel(tick.date)}</span>
              ))}
            </div>
          </div>
          <div className="agri-chart" role="group" aria-label={"Median soil moisture with fifth to ninety-fifth percentile range using " + (seriesSupportMode === "same-pixels" ? "the same pixels across all dates" : "each date's quality-valid pixels") + "; the horizontal axis is proportional to elapsed calendar time; select a point to inspect a date"}>
            <div className="agri-chart-axis"><span>m³/m³</span><span>{chartRange.max.toFixed(2)}</span><span>{chartRange.min.toFixed(2)}</span></div>
            <div className="agri-chart-plot">
              <div className="agri-chart-grid agri-chart-grid--top" />
              <div className="agri-chart-grid agri-chart-grid--middle" />
              <div className="agri-chart-grid agri-chart-grid--bottom" />
              <svg className="agri-chart-series" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {chartPoints.slice(1).map((point, index) => {
                  const previous = chartPoints[index];
                  const extendedGap = point.gapDays !== null && point.gapDays > LONG_ACQUISITION_GAP_DAYS;
                  return <line key={point.date} x1={previous.x} y1={previous.medianY} x2={point.x} y2={point.medianY}
                    className={extendedGap ? "agri-chart-segment is-extended-gap" : "agri-chart-segment"} />;
                })}
              </svg>
              {chartPoints.map((point, index) => (
                <div key={point.date} className={"agri-chart-point " + (index === selectedIndex ? "is-active" : "")} style={{ left: point.x + "%", top: point.medianY + "%" }}>
                  <span className="agri-chart-range" style={{ height: Math.max(3, point.lowY - point.highY) + "%", top: (point.highY - point.medianY) + "%" }} />
                  <button type="button"
                    aria-label={"Select " + dateLabel(point.date) + "; median " + formatMoisture(point.median) + ", P05 " + formatMoisture(point.p05) + ", P95 " + formatMoisture(point.p95) + (point.gapDays === null ? "; first acquisition" : "; " + point.gapDays + " days since previous acquisition")}
                    aria-pressed={index === selectedIndex}
                    title={point.gapDays === null ? "First acquisition" : point.gapDays + " days since previous acquisition"}
                    onClick={() => { setSelectedIndex(index); setLayer(seriesSupportMode === "same-pixels" ? "matched" : "moisture"); }}><span /></button>
                </div>
              ))}
            </div>
            <div className="agri-chart-time-axis" aria-hidden="true">
              {chartDateTicks.map((tick, index) => (
                <span key={tick.position} className={chartDateTicks.length === 1 ? "is-center" : index === 0 ? "is-start" : index === chartDateTicks.length - 1 ? "is-end" : ""}
                  style={{ left: tick.position + "%" }}>{shortDateLabel(tick.date)}</span>
              ))}
            </div>
            <div className="agri-chart-legend">
              <span><i className="median" />{seriesSupportMode === "same-pixels" ? "Same-pixel median" : "Date-valid median"}</span>
              <span><i className="range" />P05–P95 range</span>
              <span><i className="extended-gap" />Extended gap (&gt;{LONG_ACQUISITION_GAP_DAYS} days)</span>
            </div>
          </div>
        </> : <div className="agri-footer-empty">Dated observations will appear here after genuine SME2 granules are processed and a checksum-verified study is published.</div>}
      </div>}
      satelliteBasemap={satelliteBasemap}
      onToggleBasemap={() => setSatelliteBasemap((value) => !value)}
    />
  );
}

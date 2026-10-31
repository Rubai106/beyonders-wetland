"use client";

import { useEffect, useState } from "react";

type OpticalEvidence = {
  run_id: string;
  baseline_date: string;
  event_date: string;
  comparison: {
    baseline: { hls_date: string; scene: string; offset_days?: number };
    event: { hls_date: string; scene: string; offset_days?: number };
  };
  coverage: { common_clear_fraction: number };
  optical_support?: { common_clear_fraction: number };
  images: Record<string, string>;
  width: number;
  height: number;
  bounds: number[][];
};

type RadarPreview = {
  run_id: string;
  date: string;
  layers: Record<string, {
    images: Record<string, string>;
    bounds: number[][];
    scale_db: number[];
  }>;
};

export type OpticalRadarMapLayer = {
  opticalImageUrl: string;
  radarImageUrl: string;
  candidateOverlayUrl?: string;
  bounds: [[number, number], [number, number]];
  hlsDate: string;
  radarDate: string;
  dateOffsetDays: number;
  opticalSensor: string;
  channel: "hh" | "hv";
  coverage: number | null;
  scaleDb: number[];
};

type Result = {
  key: string;
  status: "idle" | "loading" | "ready" | "error";
  message: string;
  layer: OpticalRadarMapLayer | null;
};

const sameBounds = (left: number[][], right: number[][]) => left.length === right.length
  && left.every((row, index) => row.length === right[index]?.length
    && row.every((value, coordinate) => Math.abs(value - (right[index]?.[coordinate] ?? Number.NaN)) < 1e-6));

const dayOffset = (hlsDate: string, nisarDate: string) => {
  const hlsTime = Date.parse(`${hlsDate}T00:00:00Z`);
  const nisarTime = Date.parse(`${nisarDate}T00:00:00Z`);
  return Number.isFinite(hlsTime) && Number.isFinite(nisarTime)
    ? Math.round((hlsTime - nisarTime) / 86_400_000)
    : 0;
};

export default function useMapOpticalRadarComparison({ open, runId, selectedDate, channel, refreshKey, session }: {
  open: boolean;
  runId: string | null;
  selectedDate: string | null;
  channel: "hh" | "hv";
  refreshKey: number;
  session: number;
}): Result {
  const key = open && runId && selectedDate ? `${session}|${runId}|${selectedDate}|${channel}|${refreshKey}` : "";
  const [result, setResult] = useState<Result>({ key: "", status: "idle", message: "", layer: null });

  useEffect(() => {
    if (!open || !runId || !selectedDate) return;

    const controller = new AbortController();
    const loadJson = async <T,>(url: string) => {
      const response = await fetch(url, { signal: controller.signal });
      const value = await response.json() as T & { error?: string };
      if (!response.ok) throw new Error(value.error || "The comparison imagery could not be loaded.");
      return value;
    };
    Promise.all([
      loadJson<OpticalEvidence>(`/api/wetland/reference-evidence?run=${encodeURIComponent(runId)}`),
      loadJson<RadarPreview>(`/api/wetland/radar?run=${encodeURIComponent(runId)}&date=${encodeURIComponent(selectedDate)}`),
    ]).then(([optical, radar]) => {
      if (optical.run_id !== runId || radar.run_id !== runId || radar.date !== selectedDate) throw new Error("The returned imagery does not match the selected study and date.");
      const radarLayer = radar.layers[channel];
      const isEventDate = selectedDate === optical.event_date;
      const isBaselineDate = selectedDate === optical.baseline_date;
      if (!isEventDate && !isBaselineDate) {
        throw new Error(`Optical imagery is available for the baseline (${optical.baseline_date}) and event (${optical.event_date}) only. Select one of those dates for a date-matched comparison.`);
      }
      const referenceSide = isEventDate ? optical.comparison.event : optical.comparison.baseline;
      const opticalImage = isEventDate ? optical.images.after_rgb : optical.images.before_rgb;
      if (!radarLayer || !opticalImage || !sameBounds(optical.bounds, radarLayer.bounds)) {
        throw new Error("These saved previews do not share a verified geographic extent, so an aligned map comparison is unavailable.");
      }
      const artifact = (file: string) => `/api/wetland/artifact?run=${encodeURIComponent(runId)}&file=${encodeURIComponent(file)}`;
      const opticalScene = referenceSide.scene;
      const opticalSensor = opticalScene.includes(".S30.") ? "Sentinel-2"
        : opticalScene.includes(".L30.") ? "Landsat" : "HLS optical";
      const layer: OpticalRadarMapLayer = {
        opticalImageUrl: artifact(opticalImage),
        radarImageUrl: artifact(radarLayer.images.after),
        candidateOverlayUrl: selectedDate === optical.event_date && optical.images.candidate_overlay ? artifact(optical.images.candidate_overlay) : undefined,
        bounds: optical.bounds as [[number, number], [number, number]],
        hlsDate: referenceSide.hls_date,
        radarDate: selectedDate,
        dateOffsetDays: referenceSide.offset_days ?? dayOffset(referenceSide.hls_date, selectedDate),
        opticalSensor,
        channel,
        coverage: optical.optical_support?.common_clear_fraction ?? optical.coverage?.common_clear_fraction ?? null,
        scaleDb: radarLayer.scale_db,
      };
      setResult({ key, status: "ready", message: "Optical and radar images are aligned on the map.", layer });
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setResult({ key, status: "error", message: reason instanceof Error ? reason.message : "The comparison imagery could not be loaded.", layer: null });
    });
    return () => controller.abort();
  }, [channel, key, open, runId, selectedDate]);

  if (!open) return { key: "", status: "idle", message: "", layer: null };
  if (!runId) return { key, status: "error", message: "Choose a saved, processed NISAR study to compare its optical and radar imagery.", layer: null };
  if (!selectedDate) return { key, status: "error", message: "Select a NISAR observation date before opening the comparison.", layer: null };
  return result.key === key ? result : {
    key,
    status: "loading",
    message: `Loading HLS and NISAR ${channel.toUpperCase()} imagery for ${selectedDate}…`,
    layer: null,
  };
}

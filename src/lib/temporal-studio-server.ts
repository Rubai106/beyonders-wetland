/* Temporal Studio — server-side loaders. Reads the published study files
   from public/ and builds the timeline models. Server components only:
   this module imports node:fs / node:path and must never be imported by a
   client component (see temporal-studio.ts for the client-safe helpers). */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  asNumber,
  asString,
  asStringArray,
  formatMetric,
  hlsAttemptDates,
  sumPatchAreas,
  type TemporalEntry,
  type TemporalStudy,
} from "./temporal-studio";

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function publicPath(...parts: string[]): string {
  return path.join(process.cwd(), "public", ...parts);
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

async function loadTanguar(): Promise<TemporalStudy | null> {
  const pulse = await readJson<{ dates?: { date: string; area_km2: number; patches: number; mean_delta_db: number }[]; peak?: { date: string; area_km2: number } }>(
    publicPath("showcase", "featured", "pulse.json"),
  );
  const reference = await readJson<{ validation?: { status?: string; selection?: { attempts?: unknown[] } } }>(
    publicPath("showcase", "featured", "reference.json"),
  );
  if (!pulse?.dates?.length) return null;
  const entries: TemporalEntry[] = pulse.dates.map((d) => ({
    date: d.date,
    metricValue: asNumber(d.area_km2),
    metricLabel: formatMetric(asNumber(d.area_km2), "km²"),
    patches: asNumber(d.patches) ?? undefined,
    secondary: `${d.patches} patches · mean Δ ${asNumber(d.mean_delta_db)?.toFixed(2) ?? "?"} dB`,
  }));
  const opticalDates = hlsAttemptDates(reference?.validation?.selection?.attempts).map((date) => ({
    date,
    label: "HLS optical scene evaluated",
  }));
  return {
    id: "tanguar-haor",
    name: "Tanguar Haor",
    domain: "wetland",
    href: "/wetland",
    metricName: "Radar-change candidate area",
    metricUnit: "km²",
    screeningRule: "HH darkening of at least 2.5 dB against the 18 June baseline, inside the mapped haor boundary.",
    referenceNote: "HLS optical comparison is inconclusive: common clear coverage is about 0.333% of the study area, below the 20% floor.",
    referenceStatus: "INCONCLUSIVE",
    entries,
    opticalDates,
  };
}

async function loadHakaluki(): Promise<TemporalStudy | null> {
  const catalog = await readJson<{ studies?: { site_name: string; path?: string; dates?: string[] }[] }>(
    publicPath("studies", "catalog.json"),
  );
  const hakaluki = catalog?.studies?.find((s) => s.site_name === "Hakaluki Haor");
  if (!hakaluki?.path) return null;
  const observations = await readJson<{ date: string }[]>(
    publicPath("studies", hakaluki.path, "observations.json"),
  );
  if (!observations?.length) return null;
  const evidence = await readJson<{ comparison?: { precision?: number; recall?: number; f1?: number }; coverage?: { common_clear_fraction?: number } }>(
    publicPath("studies", hakaluki.path, "date_checks", "2026-09-27", "evidence.json"),
  );
  const entries: TemporalEntry[] = [];
  for (let i = 0; i < observations.length; i += 1) {
    const obs = observations[i];
    const patches = await readJson<unknown>(
      publicPath("studies", hakaluki.path, `patches_0${i}_final.geojson`),
    );
    const { areaKm2, count } = sumPatchAreas(patches);
    const isCheckDate = obs.date === "2026-09-27";
    const precision = asNumber(evidence?.comparison?.precision);
    const recall = asNumber(evidence?.comparison?.recall);
    const f1 = asNumber(evidence?.comparison?.f1);
    entries.push({
      date: obs.date,
      metricValue: areaKm2 > 0 ? areaKm2 : null,
      metricLabel: areaKm2 > 0 ? formatMetric(areaKm2, "km²") : "Not published",
      patches: count > 0 ? count : undefined,
      secondary: count > 0 ? `${count} patches` : undefined,
      reference: isCheckDate && precision !== null && recall !== null && f1 !== null
        ? `HLS cross-sensor check: precision ${(precision * 100).toFixed(1)}%, recall ${(recall * 100).toFixed(1)}%, F1 ${(f1 * 100).toFixed(1)}% — weak agreement, not validation.`
        : undefined,
    });
  }
  return {
    id: "hakaluki-haor",
    name: "Hakaluki Haor",
    domain: "wetland",
    href: "/wetland",
    metricName: "Radar-change candidate area",
    metricUnit: "km²",
    screeningRule: "HH darkening of at least 2.5 dB against the 23 June baseline, inside the mapped haor boundary.",
    referenceNote: "27 Sep 2026 date check: weak agreement with the optical reference (precision 12.9%, recall 5.2%, F1 7.4%). The headline 23 Jun → 17 Jul pair is unassessable — only 9 cloud-free pixels overlap the wetland mask. Not a validated flood detector.",
    referenceStatus: "CROSS_SENSOR_CHECK",
    entries,
    opticalDates: [{ date: "2026-09-27", label: "HLS optical check (Landsat L30)" }],
  };
}

async function loadChokwe(): Promise<TemporalStudy | null> {
  const c = await readJson<Record<string, unknown>>(publicPath("studies", "releases", "2026.10.29-chokwe", "runs", "ec8fa5ee15ae41d1aa89f930f2b47e36", "case_study.json"));
  if (!c) return null;
  const baseline = asString(c.baseline_date);
  const event = asString(c.event_date);
  const area = asNumber(c.candidate_area_km2);
  const patches = asNumber(c.candidate_patches);
  if (!baseline || !event) return null;
  return {
    id: "chokwe",
    name: "Chókwè",
    domain: "wetland",
    href: "/wetland/global?story=chokwe",
    metricName: "Radar-change candidate area",
    metricUnit: "km²",
    screeningRule: "HH darkening against the 5 January baseline, inside the January event study box.",
    referenceNote: "Completed real processing (127 patches, 29.872 km²). The reference comparison is inconclusive — processing completed does not mean validated.",
    referenceStatus: "INCONCLUSIVE",
    entries: [
      { date: baseline, metricValue: 0, metricLabel: "0 km²", secondary: "Baseline — no change measured against itself" },
      {
        date: event,
        metricValue: area,
        metricLabel: formatMetric(area, "km²"),
        patches: patches ?? undefined,
        secondary: patches !== null ? `${patches} patches` : undefined,
      },
    ],
    opticalDates: [],
  };
}

async function loadRondonia(): Promise<TemporalStudy | null> {
  const study = await readJson<{
    frames?: { date: string; stats?: { candidate_area_km2?: number; patch_count?: number; median_hv_db?: number }; reference?: { status?: string; common_clear_fraction?: number; support_overlap_fraction?: number | null }; layers?: { candidates?: { image?: string } } }[];
    method_version?: string;
  }>(publicPath("forests", "rondonia", "2026.10.08-v1", "study.json"));
  if (!study?.frames?.length) return null;
  const entries: TemporalEntry[] = study.frames.map((f) => {
    const area = asNumber(f.stats?.candidate_area_km2);
    const patches = asNumber(f.stats?.patch_count);
    const hv = asNumber(f.stats?.median_hv_db);
    const ref = f.reference;
    const overlap = asNumber(ref?.support_overlap_fraction);
    return {
      date: f.date,
      metricValue: area,
      metricLabel: formatMetric(area, "km²"),
      patches: patches ?? undefined,
      secondary: [
        patches !== null ? `${patches} patch${patches === 1 ? "" : "es"}` : null,
        hv !== null ? `median HV ${hv.toFixed(1)} dB` : null,
      ].filter(Boolean).join(" · ") || undefined,
      reference: ref
        ? `Optical check: ${ref.status === "CROSS_SENSOR_CHECK" ? "cross-sensor check" : ref.status ?? "unknown"} · ${(asNumber(ref.common_clear_fraction) ?? 0) * 100}% common clear${overlap !== null ? ` · ${(overlap * 100).toFixed(1)}% candidate overlap with index decreases` : ""}.`
        : undefined,
      image: f.layers?.candidates?.image
        ? `/forests/rondonia/2026.10.08-v1/${f.layers.candidates.image}`
        : undefined,
    };
  });
  return {
    id: "rondonia",
    name: "Rondônia",
    domain: "forest",
    href: "/forest/rondonia",
    metricName: "Persistent radar-change candidates",
    metricUnit: "km²",
    screeningRule: "HV drop of at least 3 dB against the June–July median, persisting across two consecutive valid dates, inside 2021 tree cover.",
    referenceNote: "One 0.0128 km² radar candidate; an exploratory HLS index signal overlaps 71.1%. No labelled forest-loss reference or accuracy score exists.",
    referenceStatus: "CROSS_SENSOR_CHECK",
    entries,
    opticalDates: [],
  };
}

async function loadVolcano(id: string, dir: string, name: string, href: string): Promise<TemporalStudy | null> {
  const study = await readJson<{
    pairs?: { id: string; label?: string; start: string; end: string; sensor?: string; statistics?: { assessed_area_km2?: number; valid_fraction?: number; median_coherence?: number }; los_image?: string }[];
    coherence_floor?: number;
    event_date?: string;
  }>(publicPath("volcanoes", dir, "2026.10.30-v3", "study.json"));
  if (!study?.pairs?.length) return null;
  const floor = asNumber(study.coherence_floor);
  const entries: TemporalEntry[] = study.pairs.map((p) => {
    const area = asNumber(p.statistics?.assessed_area_km2);
    const valid = asNumber(p.statistics?.valid_fraction);
    const coh = asNumber(p.statistics?.median_coherence);
    return {
      date: p.end,
      intervalLabel: `${fmtDate(p.start)} → ${fmtDate(p.end)}`,
      metricValue: area,
      metricLabel: formatMetric(area, "km²"),
      secondary: [
        p.label ?? null,
        valid !== null ? `${(valid * 100).toFixed(1)}% screened` : null,
        coh !== null ? `median coherence ${coh.toFixed(3)}` : null,
      ].filter(Boolean).join(" · ") || undefined,
      image: p.los_image ? `/volcanoes/${dir}/2026.10.30-v3/${p.los_image}` : undefined,
    };
  });
  return {
    id,
    name,
    domain: "volcano",
    href,
    metricName: "Screened area",
    metricUnit: "km²",
    screeningRule: floor !== null
      ? `Coherence floor ${floor.toFixed(2)}; only the connected phase component containing the reference patch is retained. Atmospheric, ionospheric, and tide corrections are not applied.`
      : "Coherence-screened phase; only the connected phase component containing the reference patch is retained.",
    referenceNote: id === "hayli-gubbi"
      ? "Screened apparent line-of-sight phase candidates. Sentinel-1 is a separate comparison; signals are not causally attributed to the eruption."
      : "Reference patch stability is assumed and must be inspected; it is not surveyed ground truth. Context only.",
    referenceStatus: "EXPLORATORY",
    entries,
    opticalDates: [],
  };
}

async function loadNaogaon(): Promise<TemporalStudy | null> {
  const study = await readJson<{
    observations?: { date: string; median?: number; valid_pixels?: number; quality_exclusions?: unknown }[];
    quality_exclusions?: { excluded_dates?: string[] };
  }>(publicPath("agriculture", "current", "study.json"));
  if (!study?.observations?.length) return null;
  const entries: TemporalEntry[] = study.observations.map((o) => {
    const median = asNumber(o.median);
    const valid = asNumber(o.valid_pixels);
    return {
      date: o.date,
      metricValue: median,
      metricLabel: formatMetric(median, "m³/m³"),
      secondary: valid !== null ? `${valid.toLocaleString()} valid pixels` : undefined,
    };
  });
  const excluded = asStringArray(study.quality_exclusions?.excluded_dates);
  return {
    id: "naogaon",
    name: "Naogaon (SME2 soil moisture)",
    domain: "agriculture",
    href: "/agriculture",
    metricName: "Median soil moisture",
    metricUnit: "m³/m³",
    screeningRule: "SME2 retrieval quality flag 0 and surface quality flag 0 — the zero-clear gate. Soil moisture is never crop stress, drought, or yield.",
    referenceNote: "No independent reference: no crop mask, no IMERG rainfall context, no field validation.",
    referenceStatus: "NONE",
    entries,
    opticalDates: [],
    excludedNote: excluded.length > 0
      ? `${excluded.length} further date${excluded.length === 1 ? "" : "s"} excluded before publication (zero valid pixels).`
      : undefined,
  };
}

export async function loadTemporalStudies(): Promise<{ studies: TemporalStudy[]; missing: string[] }> {
  const studies: TemporalStudy[] = [];
  const missing: string[] = [];
  const loaders: [string, () => Promise<TemporalStudy | null>][] = [
    ["Tanguar Haor", loadTanguar],
    ["Hakaluki Haor", loadHakaluki],
    ["Chókwè", loadChokwe],
    ["Rondônia", loadRondonia],
    ["Hayli Gubbi", () => loadVolcano("hayli-gubbi", "hayli-gubbi", "Hayli Gubbi and Erta Ale", "/volcano/hayli-gubbi")],
    ["Kīlauea", () => loadVolcano("kilauea-episode-36", "kilauea-episode-36-2025", "Kīlauea, Episode 36", "/volcano/kilauea")],
    ["Naogaon", loadNaogaon],
  ];
  for (const [name, load] of loaders) {
    const study = await load();
    if (study) studies.push(study);
    else missing.push(name);
  }
  return { studies, missing };
}

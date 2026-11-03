import type { GlobeCaseMarker, GlobeHazard } from "@/components/landing/Globe3D";

type Bounds = [number, number, number, number];

const HAZARD_COLOR: Record<GlobeHazard, string> = {
  wetland: "#00eaff",
  forest: "#8bd98b",
  volcano: "#ff8370",
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
  return response.json() as Promise<T>;
}

function centerOf(bounds: Bounds | undefined) {
  if (!bounds || bounds.length !== 4 || bounds.some((value) => !Number.isFinite(value))) return null;
  const [west, south, east, north] = bounds;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west > east || south > north) return null;
  return { lat: (south + north) / 2, lng: (west + east) / 2 };
}

function shortSiteName(value: string) {
  return value.replace(/\s+(?:mapped boundary|event study box|study box)$/i, "");
}

async function loadWetlandMarkers(): Promise<GlobeCaseMarker[]> {
  const catalog = await readJson<{ studies?: Array<{
    run_id?: string;
    site_name?: string;
    hazard_type?: string;
    path?: string;
  }> }>("/studies/catalog.json");
  const studies = (catalog.studies ?? []).filter((study) =>
    study.hazard_type === "wetland_flood_change" && !!study.run_id && !!study.site_name && !!study.path &&
    !study.path.startsWith("/") && !study.path.split("/").includes(".."),
  );

  const results = await Promise.all(studies.map(async (study) => {
    try {
      const manifest = await readJson<{ site_bounds?: Bounds }>(`/studies/${study.path}/run_manifest.json`);
      const center = centerOf(manifest.site_bounds);
      if (!center || !study.run_id || !study.site_name) return null;
      const params = new URLSearchParams({
        run: study.run_id,
        latitude: center.lat.toFixed(5),
        longitude: center.lng.toFixed(5),
        site: study.site_name,
      });
      const publishedCaseHref: Record<string, string> = {
        "3b01cdb5674a44ea9c6c3d17ec8c07b8": "/wetland?case=featured",
        "d6e65a58802e4cf4907ddefa42a435d6": "/wetland?case=hakaluki",
        "ec8fa5ee15ae41d1aa89f930f2b47e36": "/wetland/global?story=chokwe",
      };
      return {
        id: `wetland:${study.run_id}`,
        hazard: "wetland" as const,
        ...center,
        label: shortSiteName(study.site_name),
        sub: "Wetland case · open",
        href: publishedCaseHref[study.run_id] ?? `/wetland/global?${params.toString()}#nisar-run-controls`,
        color: HAZARD_COLOR.wetland,
      } satisfies GlobeCaseMarker;
    } catch {
      return null;
    }
  }));
  return results.flatMap((marker) => marker ? [marker] : []);
}

async function loadForestMarkers(): Promise<GlobeCaseMarker[]> {
  const catalog = await readJson<{ studies?: Array<{
    id?: string;
    title?: string;
    bbox?: Bounds;
    path?: string;
  }> }>("/forests/catalog.json");
  return (catalog.studies ?? []).flatMap((study) => {
    const center = centerOf(study.bbox);
    if (!center || !study.id || !study.title || !study.path) return [];
    return [{
      id: `forest:${study.id}`,
      hazard: "forest" as const,
      ...center,
      label: study.id === "rondonia" ? "Rondônia" : shortSiteName(study.title),
      sub: "Forest case · open",
      href: study.path,
      color: HAZARD_COLOR.forest,
    } satisfies GlobeCaseMarker];
  });
}

async function loadVolcanoMarkers(): Promise<GlobeCaseMarker[]> {
  const catalog = await readJson<{ case_studies?: Array<{
    id?: string;
    name?: string;
    path?: string;
    publication?: { bbox?: Bounds };
  }> }>("/volcanoes/catalog.json");
  return (catalog.case_studies ?? []).flatMap((study) => {
    const center = centerOf(study.publication?.bbox);
    if (!center || !study.id || !study.name || !study.path) return [];
    return [{
      id: `volcano:${study.id}`,
      hazard: "volcano" as const,
      ...center,
      label: study.name.split(" and ")[0],
      sub: "Volcano case · open",
      href: study.path,
      color: HAZARD_COLOR.volcano,
    } satisfies GlobeCaseMarker];
  });
}

/** Load only published study locations; this never creates global detections. */
export async function listGlobeStudies(): Promise<GlobeCaseMarker[]> {
  const [wetlands, forests, volcanoes] = await Promise.all([
    loadWetlandMarkers().catch(() => []),
    loadForestMarkers().catch(() => []),
    loadVolcanoMarkers().catch(() => []),
  ]);
  return [...wetlands, ...forests, ...volcanoes];
}

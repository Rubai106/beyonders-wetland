import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const revalidate = 43_200;

const GVP_WFS = "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows";
const GVP_LAYER = "GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes";

type Properties = Record<string, unknown>;
type PointFeature = { type: "Feature"; geometry: { type: "Point"; coordinates: number[] } | null; properties: Properties };

export interface VolcanoRecord {
  id: string;
  name: string;
  country: string;
  region: string;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  gvpUrl: string | null;
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function field(properties: Properties, names: string[]): unknown {
  const wanted = new Set(names.map(normalized));
  const entry = Object.entries(properties).find(([key]) => wanted.has(normalized(key)));
  return entry?.[1];
}

function asString(value: unknown, fallback = "Unknown") {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function asNumber(value: unknown): number | null {
  if(value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function fallbackVolcanoes(): VolcanoRecord[] {
  return [
    { id: "221091", name: "Hayli Gubbi", country: "Ethiopia", region: "Afar", latitude: 13.51, longitude: 40.716, elevationM: 493, gvpUrl: "https://volcano.si.edu/volcano.cfm?vn=221091" },
    { id: "221080", name: "Erta Ale", country: "Ethiopia", region: "Afar", latitude: 13.60, longitude: 40.67, elevationM: 613, gvpUrl: "https://volcano.si.edu/volcano.cfm?vn=221080" },
  ];
}

function toVolcano(feature: PointFeature): VolcanoRecord | null {
  const properties = feature.properties ?? {};
  const [longitude, latitude] = feature.geometry?.coordinates ?? [];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const rawId = asString(field(properties, ["Volcano_Number", "Volcano Number", "VolcanoNumber", "Number"]), "");
  const id = rawId.replace(/\D/g, "");
  const name = asString(field(properties, ["Volcano_Name", "Volcano Name", "VolcanoName", "Name"]), "Unnamed volcano");
  return {
    id: id || name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    country: asString(field(properties, ["Country", "Countries"])),
    region: asString(field(properties, ["Region", "Volcanic_Region", "Volcanic Region"])),
    latitude,
    longitude,
    elevationM: asNumber(field(properties, ["Elevation", "Elevation_m", "Elevation (m)"])),
    gvpUrl: id ? `https://volcano.si.edu/volcano.cfm?vn=${id}` : null,
  };
}

export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "external");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  const url = new URL(GVP_WFS);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "1.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeName", GVP_LAYER);
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("maxFeatures", "1500");

  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Smithsonian catalog returned HTTP ${response.status}.`);
    const body = await response.json() as { features?: PointFeature[] };
    const volcanoes = (body.features ?? []).map(toVolcano).filter((item): item is VolcanoRecord => item !== null);
    if (volcanoes.length === 0) throw new Error("Smithsonian catalog returned no mapped volcanoes.");
    return NextResponse.json({
      source: "Smithsonian Global Volcanism Program · Volcanoes of the World v5.4.0",
      sourceUrl: "https://volcano.si.edu/database/webservices.cfm",
      fetchedAt: new Date().toISOString(),
      total: volcanoes.length,
      status: "LIVE",
      volcanoes,
    }, { headers: { "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=86400" } });
  } catch (error) {
    return NextResponse.json({
      source: "Smithsonian Global Volcanism Program · limited fallback",
      sourceUrl: "https://volcano.si.edu/database/webservices.cfm",
      fetchedAt: null,
      total: null,
      status: "FALLBACK",
      message: error instanceof Error ? error.message : "Smithsonian catalog is unavailable.",
      volcanoes: fallbackVolcanoes(),
    }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=900" } });
  }
}

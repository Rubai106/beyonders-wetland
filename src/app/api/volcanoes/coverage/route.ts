import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CMR = "https://cmr.earthdata.nasa.gov/search/granules.umm_json";
const PRODUCTS = ["NISAR_L2_GUNW_PROVISIONAL_V1", "NISAR_L2_GUNW_BETA_V1"];
const MAX_RESULTS_PER_PRODUCT = 500;

type RecordValue = Record<string, unknown>;
type CoverageFeature = {
  type: "Feature";
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
  properties: { sceneId: string; product: string; maturity: "PROVISIONAL" | "BETA"; start: string | null; end: string | null };
};

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function featureFrom(raw: unknown, product: string): CoverageFeature | null {
  const umm = record(record(raw)?.umm);
  if (!umm || typeof umm.GranuleUR !== "string") return null;
  const spatial = record(record(record(umm.SpatialExtent)?.HorizontalSpatialDomain)?.Geometry);
  const sourcePolygons = Array.isArray(spatial?.GPolygons) ? spatial.GPolygons : [];
  const coordinates: number[][][][] = [];
  for (const source of sourcePolygons) {
    const points = record(record(source)?.Boundary)?.Points;
    if (!Array.isArray(points)) continue;
    const ring = points.flatMap((point) => {
      const entry = record(point);
      const lon = entry?.Longitude;
      const lat = entry?.Latitude;
      return typeof lon === "number" && Number.isFinite(lon) && typeof lat === "number" && Number.isFinite(lat) ? [[lon, lat]] : [];
    });
    if (ring.length < 3) continue;
    if (ring[0][0] !== ring.at(-1)?.[0] || ring[0][1] !== ring.at(-1)?.[1]) ring.push([...ring[0]]);
    coordinates.push([ring]);
  }
  if (!coordinates.length) return null;
  const range = record(record(umm.TemporalExtent)?.RangeDateTime);
  return {
    type: "Feature",
    geometry: { type: "MultiPolygon", coordinates },
    properties: {
      sceneId: umm.GranuleUR,
      product,
      maturity: product.includes("BETA") ? "BETA" : "PROVISIONAL",
      start: typeof range?.BeginningDateTime === "string" ? range.BeginningDateTime : null,
      end: typeof range?.EndingDateTime === "string" ? range.EndingDateTime : null,
    },
  };
}

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "external");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const start = params.get("start");
  const end = params.get("end");
  if (!params.get("lat")?.trim() || !params.get("lon")?.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 ||
      !validDate(start) || !validDate(end) || start > end) {
    return NextResponse.json({ error: "Provide a volcano location and a valid start/end date range." }, { status: 400 });
  }

  const bbox = [Math.max(-180, lon - 0.45), Math.max(-90, lat - 0.45), Math.min(180, lon + 0.45), Math.min(90, lat + 0.45)].join(",");
  const features: CoverageFeature[] = [];
  const totals: Record<string, number | null> = {};
  try {
    for (const product of PRODUCTS) {
      const url = new URL(CMR);
      url.searchParams.set("short_name", product);
      url.searchParams.set("bounding_box", bbox);
      url.searchParams.set("temporal", `${start}T00:00:00Z,${end}T23:59:59.999Z`);
      url.searchParams.set("page_size", String(MAX_RESULTS_PER_PRODUCT));
      url.searchParams.set("page_num", "1");
      const response = await fetch(url, { headers: { Accept: "application/vnd.nasa.cmr.umm_results+json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`NASA CMR returned HTTP ${response.status}.`);
      const hitHeader = response.headers.get("CMR-Hits");
      const hits = hitHeader===null ? NaN : Number(hitHeader);
      totals[product] = Number.isFinite(hits) ? hits : null;
      const body = await response.json() as { items?: unknown[] };
      features.push(...(body.items ?? []).map((item) => featureFrom(item, product)).filter((item): item is CoverageFeature => item !== null));
    }
    return NextResponse.json({
      status: features.length ? "FOOTPRINTS_FOUND" : "NO_RESULT_AVAILABLE",
      source: "NASA CMR · NISAR L2 GUNW",
      productHits: totals,
      truncated: Object.values(totals).some((hits) => hits !== null && hits > MAX_RESULTS_PER_PRODUCT),
      features,
    }, { headers: { "Cache-Control": "public, max-age=180, stale-while-revalidate=600" } });
  } catch (error) {
    console.error("NISAR volcano coverage lookup failed:", error);
    return NextResponse.json({ error: "NASA's interferogram catalog could not be reached. The volcano inventory is still available." }, { status: 502 });
  }
}

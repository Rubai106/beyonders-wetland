import globalCoverageSnapshot from "../../../../../data/global-catalog/nisar-l2-gcov-2026-10-01.json";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.umm_json";
const PRODUCT = "NISAR_L2_GCOV_PROVISIONAL_V1";
const PAGE_SIZE = 2000;
const MAX_PAGES = 3;
const SNAPSHOT_DATE = "2026-10-01";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function safeNasaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname.endsWith(".nasa.gov") || url.hostname.endsWith(".asf.alaska.edu"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function stringAttribute(umm: JsonRecord, soughtNames: string[]): string | null {
  const attrs = Array.isArray(umm.AdditionalAttributes) ? umm.AdditionalAttributes : [];
  const match = attrs.map(record).find((item) => {
    const name = typeof item?.Name === "string" ? item.Name.toLowerCase() : "";
    return soughtNames.some((sought) => name === sought.toLowerCase());
  });
  if (!match) return null;
  const values = Array.isArray(match.Values) ? match.Values : [match.Value];
  const value = values.find((item) => typeof item === "string" || typeof item === "number");
  return value === undefined || value === null ? null : String(value);
}

function sceneGeometry(umm: JsonRecord): { type: "MultiPolygon"; coordinates: number[][][][] } | null {
  const spatial = record(umm.SpatialExtent);
  const horizontal = record(spatial?.HorizontalSpatialDomain);
  const geometry = record(horizontal?.Geometry);
  const polygons = Array.isArray(geometry?.GPolygons) ? geometry.GPolygons : [];
  const coordinates: number[][][][] = [];

  for (const rawPolygon of polygons) {
    const polygon = record(rawPolygon);
    const boundary = record(polygon?.Boundary);
    const points = Array.isArray(boundary?.Points) ? boundary.Points : [];
    const ring: number[][] = [];
    for (const rawPoint of points) {
      const point = record(rawPoint);
      const lon = point?.Longitude;
      const lat = point?.Latitude;
      if (typeof lon === "number" && Number.isFinite(lon) && lon >= -180 && lon <= 180 &&
        typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90) {
        ring.push([lon, lat]);
      }
    }
    if (ring.length < 3) continue;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
    if (ring.length >= 4) coordinates.push([ring]);
  }

  return coordinates.length ? { type: "MultiPolygon", coordinates } : null;
}

function sceneFeature(raw: unknown) {
  const item = record(raw);
  const umm = record(item?.umm);
  if (!umm) return null;
  const geometry = sceneGeometry(umm);
  const granuleId = typeof umm.GranuleUR === "string" ? umm.GranuleUR : null;
  if (!geometry || !granuleId) return null;

  const temporalExtent = record(umm.TemporalExtent);
  const range = record(temporalExtent?.RangeDateTime);
  const relatedUrls = Array.isArray(umm.RelatedUrls) ? umm.RelatedUrls.map(record).filter(Boolean) : [];
  const browse = relatedUrls.map((link) => ({
    url: safeNasaUrl(link?.URL),
    description: typeof link?.Description === "string" ? link.Description : "",
    type: typeof link?.Type === "string" ? link.Type : "",
  })).filter((link) => link.url);
  const browseUrl = browse.find((link) => /LATLON_thumbnail\.png/i.test(link.url || ""))?.url ??
    browse.find((link) => link.type === "GET RELATED VISUALIZATION")?.url ?? null;
  const dataUrl = browse.find((link) => link.type === "GET DATA" && /\.h5(?:$|\?)/i.test(link.url || ""))?.url ?? null;
  const granuleTokens = granuleId.split("_");
  const nameDirection = granuleTokens[6] === "A" ? "Ascending" : granuleTokens[6] === "D" ? "Descending" : null;

  return {
    type: "Feature" as const,
    geometry,
    properties: {
      sceneId: granuleId,
      acquisitionStart: typeof range?.BeginningDateTime === "string" ? range.BeginningDateTime : null,
      acquisitionEnd: typeof range?.EndingDateTime === "string" ? range.EndingDateTime : null,
      orbitDirection: stringAttribute(umm, ["OrbitDirection", "Orbit Direction"]) ?? nameDirection ?? "Unknown",
      trackNumber: stringAttribute(umm, ["TrackNumber", "Track Number", "RelativeOrbitNumber"]) ?? granuleTokens[5] ?? "Unknown",
      browseUrl,
      dataUrl,
      product: PRODUCT,
    },
  };
}

export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "external");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  const date = request.nextUrl.searchParams.get("date") ?? "";
  const forceRefresh = Number(request.nextUrl.searchParams.get("refresh") ?? 0) > 0;
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.valueOf()) ||
    parsedDate.toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ error: "Choose a valid UTC date in YYYY-MM-DD format." }, { status: 400 });
  }
  if (date > new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ error: "Future dates are not available in the NASA catalog." }, { status: 400 });
  }
  if (date === SNAPSHOT_DATE && request.nextUrl.searchParams.get("snapshot") === "1") {
    return NextResponse.json({ ...globalCoverageSnapshot, snapshotFallback: true }, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=900" },
    });
  }

  const features: ReturnType<typeof sceneFeature>[] = [];
  let totalHits = 0;
  let recordsFetched = 0;
  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = new URL(CMR_URL);
      url.searchParams.set("short_name", PRODUCT);
      url.searchParams.set("bounding_box", "-180,-89.9,180,89.9");
      url.searchParams.set("temporal", `${date}T00:00:00Z,${date}T23:59:59.999Z`);
      url.searchParams.set("page_size", String(PAGE_SIZE));
      url.searchParams.set("page_num", String(page));

      const response = await fetch(url, {
        headers: { Accept: "application/vnd.nasa.cmr.umm_results+json" },
        ...(forceRefresh ? { cache: "no-store" as const } : { next: { revalidate: 300 } }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`NASA CMR returned HTTP ${response.status}.`);
      const hits = Number(response.headers.get("CMR-Hits"));
      if (page === 1 && Number.isFinite(hits)) totalHits = hits;
      const body = await response.json() as { items?: unknown[] };
      const items = Array.isArray(body.items) ? body.items : [];
      recordsFetched += items.length;
      features.push(...items.map(sceneFeature).filter((feature): feature is NonNullable<typeof feature> => feature !== null));
      if (items.length < PAGE_SIZE || (totalHits > 0 && page * PAGE_SIZE >= totalHits)) break;
    }

    return NextResponse.json({
      source: "NASA CMR · NISAR L2 GCOV PROVISIONAL",
      product: PRODUCT,
      date,
      totalHits,
      loadedFeatures: features.length,
      truncated: totalHits > recordsFetched,
      features,
    }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=900" } });
  } catch (error) {
    if (date === SNAPSHOT_DATE) {
      return NextResponse.json({ ...globalCoverageSnapshot, snapshotFallback: true });
    }
    console.error("Global NISAR catalog request failed:", error);
    return NextResponse.json({ error: "NASA's public scene catalog could not be reached. Try again in a moment." }, { status: 502 });
  }
}

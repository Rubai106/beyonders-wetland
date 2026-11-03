import { NextRequest, NextResponse } from "next/server";
import {
  groupAgricultureSME2Series,
  type AgricultureCMRGranule,
  type AgricultureCatalogueResult,
} from "@/lib/agriculture-catalogue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COLLECTION = "NISAR_L3_SME2_PROVISIONAL_V1";
const PAGE_SIZE = 2000;
const MINIMUM_OBSERVATIONS = 6;
const MINIMUM_SPAN_DAYS = 60;

type SearchBody = {
  west: number;
  south: number;
  east: number;
  north: number;
  startDate: string;
  endDate: string;
};

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^20\\d{2}-\\d{2}-\\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateBody(value: unknown): SearchBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const west = Number(input.west), south = Number(input.south);
  const east = Number(input.east), north = Number(input.north);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null;
  if (east - west > 2 || north - south > 2) return null;
  if (!isIsoDate(input.startDate) || !isIsoDate(input.endDate) || input.startDate > input.endDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (input.endDate > today) return null;
  const span = (Date.parse(input.endDate) - Date.parse(input.startDate)) / 86_400_000;
  if (span > 366) return null;
  return { west, south, east, north, startDate: input.startDate, endDate: input.endDate };
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.get("host")) {
        return NextResponse.json({ error: "Cross-origin catalogue searches are not allowed." }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    }
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 4096) {
    return NextResponse.json({ error: "The catalogue-search request is too large." }, { status: 413 });
  }

  let body: unknown;
  try { body = JSON.parse(text); } catch {
    return NextResponse.json({ error: "The catalogue-search request is not valid JSON." }, { status: 400 });
  }
  const input = validateBody(body);
  if (!input) {
    return NextResponse.json({
      error: "Enter a valid WGS84 rectangle (no more than 2° across) and an ordered date range of at most 366 days, ending today or earlier.",
    }, { status: 400 });
  }

  const query = new URLSearchParams({
    short_name: COLLECTION,
    temporal: input.startDate + "T00:00:00Z," + input.endDate + "T23:59:59Z",
    bounding_box: [input.west, input.south, input.east, input.north].join(","),
    page_size: String(PAGE_SIZE),
    sort_key: "-start_date",
  });

  try {
    const response = await fetch("https://cmr.earthdata.nasa.gov/search/granules.json?" + query.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "GeoNexSAR-Agriculture/1.0",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      return NextResponse.json({
        error: "NASA CMR catalogue is currently unavailable (HTTP " + response.status + "). Please retry later.",
        retryable: response.status === 429 || response.status >= 500,
      }, { status: 502 });
    }

    const payload = await response.json() as { feed?: { entry?: AgricultureCMRGranule[] } };
    const entries = Array.isArray(payload.feed?.entry) ? payload.feed!.entry! : [];
    const hitsHeader = response.headers.get("CMR-Hits");
    const parsedHits = hitsHeader === null ? null : Number(hitsHeader);
    const catalogueHits = parsedHits !== null && Number.isSafeInteger(parsedHits) && parsedHits >= 0
      ? parsedHits
      : null;

    if ((catalogueHits !== null && catalogueHits > entries.length) ||
        (catalogueHits === null && entries.length >= PAGE_SIZE)) {
      return NextResponse.json({
        error: "NASA CMR returned a truncated catalogue page. Narrow the area or date range; no incomplete time series was used.",
        retryable: false,
      }, { status: 422 });
    }

    const series = groupAgricultureSME2Series(entries, MINIMUM_OBSERVATIONS, MINIMUM_SPAN_DAYS);
    const eligible = series.filter((item) => item.meets_preflight_gate);
    const result: AgricultureCatalogueResult = {
      schema_version: 1,
      collection: COLLECTION,
      date_range: { start: input.startDate, end: input.endDate },
      aoi: { west: input.west, south: input.south, east: input.east, north: input.north },
      catalogue_granules: catalogueHits ?? entries.length,
      preflight_gate: {
        minimum_unique_acquisitions: MINIMUM_OBSERVATIONS,
        minimum_temporal_span_days: MINIMUM_SPAN_DAYS,
        meaning: "Catalogue feasibility only. This does not establish HDF5 integrity, valid SME2 pixel coverage, crop identity or scientific validation.",
      },
      series,
      recommended_series_id: eligible[0]?.series_id ?? null,
      status: eligible.length ? "ELIGIBLE_FOR_OPERATOR_REVIEW" : series.length ? "INSUFFICIENT_TEMPORAL_COVERAGE" : "NO_COMPATIBLE_SERIES",
      interpretation_limits: [
        "CMR scene-footprint intersection is not a count of valid SME2 pixels inside the AOI.",
        "The catalogue does not establish crop identity, field boundaries, soil-moisture values, uncertainty or quality-flag acceptance.",
        "Different tracks, frames, directions, bandwidths, polarisations, frequencies and releases are kept in separate series.",
        "A catalogue match is not a validated Agriculture study.",
      ],
    };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json({
      error: timedOut ? "NASA CMR did not respond within 45 seconds. Please retry." : "Could not contact NASA CMR. Check the connection and retry.",
      retryable: true,
    }, { status: 504 });
  }
}

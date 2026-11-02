export interface CmrGranule {
  conceptId: string | null;
  granuleUr: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  cloudCover: number | null;
  metadataUrl: string | null;
  dataUrl: string | null;
  browseUrl: string | null;
  spatialBounds: [number, number, number, number] | null;
}
export interface CmrUmmSearchResult { totalHits: number | null; granules: CmrGranule[]; }
type UnknownRecord = Record<string, unknown>;
function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}
function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function safeHttpsUrl(value: unknown): string | null {
  const raw = textValue(value);
  if (!raw) return null;
  try { const url = new URL(raw); return url.protocol === "https:" ? url.toString() : null; }
  catch { return null; }
}
function numberValue(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}
function temporalRange(umm: UnknownRecord): { start: string | null; end: string | null } {
  const temporal = record(umm.TemporalExtent);
  if (!temporal) return { start: null, end: null };
  const single = textValue(temporal.SingleDateTime);
  const raw = temporal.RangeDateTime;
  const range = Array.isArray(raw) ? record(raw[0]) : record(raw);
  return { start: textValue(range?.BeginningDateTime) ?? single, end: textValue(range?.EndingDateTime) ?? single };
}
function spatialBounds(umm: UnknownRecord): [number, number, number, number] | null {
  const extent = record(umm.SpatialExtent);
  const horizontal = record(extent?.HorizontalSpatialDomain);
  const geometry = record(horizontal?.Geometry);
  const raw = geometry?.BoundingRectangles;
  const rectangle = Array.isArray(raw) ? record(raw[0]) : record(raw);
  if (!rectangle) return null;
  const west = numberValue(rectangle.WestBoundingCoordinate);
  const south = numberValue(rectangle.SouthBoundingCoordinate);
  const east = numberValue(rectangle.EastBoundingCoordinate);
  const north = numberValue(rectangle.NorthBoundingCoordinate);
  return west === null || south === null || east === null || north === null ? null : [west, south, east, north];
}
function relatedUrl(umm: UnknownRecord, predicate: (type: string, description: string) => boolean): string | null {
  const related = Array.isArray(umm.RelatedUrls) ? umm.RelatedUrls : [];
  for (const item of related) {
    const entry = record(item);
    if (!entry) continue;
    const type = textValue(entry.Type) ?? "";
    const description = textValue(entry.Description) ?? "";
    const url = safeHttpsUrl(entry.URL);
    if (url && predicate(type.toUpperCase(), description.toUpperCase())) return url;
  }
  return null;
}
function normalizeGranule(item: unknown): CmrGranule | null {
  const result = record(item), meta = record(result?.meta), umm = record(result?.umm);
  if (!umm) return null;
  const conceptId = textValue(meta?.["concept-id"]);
  const dataGranule = record(umm.DataGranule);
  const granuleUr = textValue(umm.GranuleUR) ?? textValue(dataGranule?.ProducerGranuleId);
  if (!conceptId && !granuleUr) return null;
  const temporal = temporalRange(umm), cloud = numberValue(umm.CloudCover);
  return {
    conceptId, granuleUr, timeStart: temporal.start, timeEnd: temporal.end,
    cloudCover: cloud !== null && cloud >= 0 && cloud <= 100 ? cloud : null,
    metadataUrl: conceptId && /^[A-Za-z0-9._-]+$/.test(conceptId)
      ? `https://cmr.earthdata.nasa.gov/search/concepts/${encodeURIComponent(conceptId)}` : null,
    dataUrl: relatedUrl(umm, (type) => type.includes("GET DATA")),
    browseUrl: relatedUrl(umm, (type, description) => type.includes("VISUAL") || type.includes("BROWSE") || description.includes("BROWSE")),
    spatialBounds: spatialBounds(umm),
  };
}
/** Convert a normal CMR granule-search URL to the versioned UMM JSON response format. */
export function buildCmrUmmSearchUrl(queryUrl: string): string | null {
  try {
    const url = new URL(queryUrl);
    if (url.origin !== "https://cmr.earthdata.nasa.gov" || !url.pathname.endsWith("/granules.json")) return null;
    url.pathname = url.pathname.slice(0, -".json".length) + ".umm_json_v1_18_6";
    return url.toString();
  } catch { return null; }
}
/** Parse CMR UMM-JSON conservatively; malformed records are omitted, never fabricated. */
export function parseCmrUmmResponse(payload: unknown): CmrUmmSearchResult {
  const root = record(payload);
  if (!root) return { totalHits: null, granules: [] };
  const rawItems = Array.isArray(root.items) ? root.items : [];
  const granules = rawItems.map(normalizeGranule).filter((item): item is CmrGranule => item !== null);
  const hits = numberValue(root.hits);
  return { totalHits: hits !== null && hits >= 0 ? Math.floor(hits) : null, granules };
}

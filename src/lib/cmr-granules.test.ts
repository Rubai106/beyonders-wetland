import assert from "node:assert/strict";
import test from "node:test";
import { buildCmrUmmSearchUrl, parseCmrUmmResponse } from "./cmr-granules";

test("builds a versioned UMM JSON URL while preserving exact CMR query filters", () => {
  const url = buildCmrUmmSearchUrl("https://cmr.earthdata.nasa.gov/search/granules.json?short_name=OPERA_L3_DSWX-HLS_V1&version=1.0&temporal%5B%5D=2026-08-29T00%3A00%3A00Z%2C2026-08-29T23%3A59%3A59Z");
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/search/granules.umm_json_v1_18_6");
  assert.equal(parsed.searchParams.get("short_name"), "OPERA_L3_DSWX-HLS_V1");
  assert.equal(parsed.searchParams.get("version"), "1.0");
  assert.match(parsed.searchParams.get("temporal[]") ?? "", /2026-08-29T00:00:00Z/);
});
test("rejects non-CMR URLs and unrelated CMR endpoints", () => {
  assert.equal(buildCmrUmmSearchUrl("https://example.com/search/granules.json"), null);
  assert.equal(buildCmrUmmSearchUrl("https://cmr.earthdata.nasa.gov/search/collections.json"), null);
  assert.equal(buildCmrUmmSearchUrl("not a URL"), null);
});
test("normalizes granule identity, temporal range, cloud cover, safe links and bounds", () => {
  const result = parseCmrUmmResponse({ hits: 7, items: [{
    meta: { "concept-id": "G123-POCLOUD" },
    umm: {
      GranuleUR: "OPERA_DSWX_TEST_GRANULE",
      TemporalExtent: { RangeDateTime: { BeginningDateTime: "2026-08-29T10:00:00Z", EndingDateTime: "2026-08-29T10:05:00Z" } },
      CloudCover: 12,
      SpatialExtent: { HorizontalSpatialDomain: { Geometry: { BoundingRectangles: [{
        WestBoundingCoordinate: 89, SouthBoundingCoordinate: 24, EastBoundingCoordinate: 90, NorthBoundingCoordinate: 25,
      }] } } },
      RelatedUrls: [
        { URL: "http://unsafe.example/file", Type: "GET DATA", Description: "Insecure access" },
        { URL: "https://data.example/file.h5", Type: "GET DATA", Description: "Direct download" },
        { URL: "https://data.example/browse.png", Type: "GET RELATED VISUALIZATION", Description: "Browse image" },
      ],
    },
  }] });
  assert.equal(result.totalHits, 7);
  assert.equal(result.granules.length, 1);
  assert.equal(result.granules[0].conceptId, "G123-POCLOUD");
  assert.equal(result.granules[0].granuleUr, "OPERA_DSWX_TEST_GRANULE");
  assert.equal(result.granules[0].timeStart, "2026-08-29T10:00:00Z");
  assert.equal(result.granules[0].timeEnd, "2026-08-29T10:05:00Z");
  assert.equal(result.granules[0].cloudCover, 12);
  assert.deepEqual(result.granules[0].spatialBounds, [89, 24, 90, 25]);
  assert.equal(result.granules[0].metadataUrl, "https://cmr.earthdata.nasa.gov/search/concepts/G123-POCLOUD");
  assert.equal(result.granules[0].dataUrl, "https://data.example/file.h5");
  assert.equal(result.granules[0].browseUrl, "https://data.example/browse.png");
});
test("supports single acquisition time and does not invent missing optional metadata", () => {
  const result = parseCmrUmmResponse({ items: [{
    meta: { "concept-id": "G456-POCLOUD" },
    umm: { TemporalExtent: { SingleDateTime: "2026-08-29T10:20:00Z" }, RelatedUrls: [{ URL: "javascript:alert(1)", Type: "GET DATA" }] },
  }] });
  assert.equal(result.totalHits, null);
  assert.equal(result.granules.length, 1);
  assert.equal(result.granules[0].timeStart, "2026-08-29T10:20:00Z");
  assert.equal(result.granules[0].timeEnd, "2026-08-29T10:20:00Z");
  assert.equal(result.granules[0].cloudCover, null);
  assert.equal(result.granules[0].dataUrl, null);
  assert.equal(result.granules[0].spatialBounds, null);
});
test("malformed payloads and unidentified granules yield an empty list", () => {
  assert.deepEqual(parseCmrUmmResponse(null), { totalHits: null, granules: [] });
  const result = parseCmrUmmResponse({ hits: 2, items: [{ umm: {} }, { meta: {}, umm: { GranuleUR: "", DataGranule: {} } }] });
  assert.equal(result.totalHits, 2);
  assert.deepEqual(result.granules, []);
});

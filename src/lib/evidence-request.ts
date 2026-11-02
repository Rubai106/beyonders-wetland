import type { WetlandPatch, WetlandGeometry } from "./types";
import type { ScatteringHypothesisId } from "./scattering-hypothesis";

export type TemporalWindowDays = 0 | 1 | 3 | 7 | 14;

export interface EvidenceArchiveCollection {
  shortName: string;
  version: string;
  title: string;
  sensor: string;
  nominalResolution: string;
  role: string;
  limitation: string;
}

export interface EvidenceArchiveSearch extends EvidenceArchiveCollection {
  queryUrl: string;
  spatialFilter: "polygon" | "bounding_box" | "point";
  temporalStartUtc: string;
  temporalEndUtc: string;
}

export interface EvidenceRequest {
  schemaVersion: "beyonders.evidence-request/1.1";
  requestId: string;
  createdBy: "Beyonders";
  module: "wetland";
  hypothesis: {
    id: ScatteringHypothesisId;
    title: string;
    question: string;
  };
  candidate: {
    id: string;
    observationDate: string;
    areaKm2: number;
    detectorClass: WetlandPatch["classification"];
    centroid: { latitude: number; longitude: number } | null;
    geometry: WetlandGeometry | null;
  };
  temporalSearch: {
    referenceDate: string;
    toleranceDays: TemporalWindowDays;
    startUtc: string;
    endUtc: string;
    interpretation: string;
  } | null;
  spatialSearch: {
    method: "candidate-polygon" | "candidate-bounding-box" | "candidate-centroid-only" | "unavailable";
    label: string;
    boundingBox: [number, number, number, number] | null;
    polygonParts: string[] | null;
    holesIgnored: boolean;
    point: [number, number] | null;
    interpretation: string;
  };
  archiveSearches: EvidenceArchiveSearch[];
  evidenceThatCouldSupport: string[];
  evidenceThatCouldChallenge: string[];
  minimumReviewProtocol: string[];
  guardrails: string[];
  warnings: string[];
}

interface HypothesisRequestProfile {
  title: string;
  question: string;
  collections: EvidenceArchiveCollection[];
  evidenceThatCouldSupport: string[];
  evidenceThatCouldChallenge: string[];
  minimumReviewProtocol: string[];
  guardrails: string[];
}

const DSWX_HLS: EvidenceArchiveCollection = {
  shortName: "OPERA_L3_DSWX-HLS_V1",
  version: "1.0",
  title: "OPERA Dynamic Surface Water Extent from Harmonized Landsat Sentinel-2",
  sensor: "Landsat 8/9 and Sentinel-2 optical",
  nominalResolution: "30 m",
  role: "Independent optical water-extent context",
  limitation: "Optical observations can be unavailable under clouds and may not reveal water beneath a closed canopy. This is a reference product, not field truth.",
};

const DSWX_S1: EvidenceArchiveCollection = {
  shortName: "OPERA_L3_DSWX-S1_V1",
  version: "1.0",
  title: "OPERA Dynamic Surface Water Extent from Sentinel-1",
  sensor: "Sentinel-1 SAR",
  nominalResolution: "30 m",
  role: "Cross-sensor SAR water and inundated-vegetation context",
  limitation: "This is another radar-derived product, not an independent field observation. Retain its layover, shadow, HAND and quality masks.",
};

const HLSS30_VI: EvidenceArchiveCollection = {
  shortName: "HLSS30_VI",
  version: "2.0",
  title: "HLS Sentinel-2 Vegetation Indices Daily Global",
  sensor: "Sentinel-2 MSI optical",
  nominalResolution: "30 m",
  role: "Optical vegetation-condition context",
  limitation: "Vegetation indices can reveal canopy/greenness changes, but cannot measure surface roughness or prove inundation beneath vegetation.",
};

const HLSL30_VI: EvidenceArchiveCollection = {
  shortName: "HLSL30_VI",
  version: "2.0",
  title: "HLS Landsat Vegetation Indices Daily Global",
  sensor: "Landsat OLI optical",
  nominalResolution: "30 m",
  role: "Independent optical vegetation-condition context",
  limitation: "Vegetation indices do not directly measure surface roughness and may be limited by cloud, shadow and mixed pixels.",
};

const SMAP_L4: EvidenceArchiveCollection = {
  shortName: "SPL4SMGP",
  version: "008",
  title: "SMAP L4 Global 3-hourly Surface and Root Zone Soil Moisture Geophysical Data",
  sensor: "SMAP L-band radiometer and land-model assimilation",
  nominalResolution: "9 km",
  role: "Coarse-scale soil-moisture context",
  limitation: "A 9 km grid cell may mix many land-cover and hydrologic conditions. It is not candidate-pixel validation for small regions.",
};

const NISAR_SME2: EvidenceArchiveCollection = {
  shortName: "NISAR_L3_SME2_PROVISIONAL_V1",
  version: "1",
  title: "NISAR Provisional Soil Moisture",
  sensor: "NISAR L-band",
  nominalResolution: "Collection-specific; inspect granule metadata",
  role: "Same-mission cross-product soil-moisture context",
  limitation: "This is from the same NISAR mission and is provisional; it is not an independent sensor or field validation.",
};

const PROFILES: Record<ScatteringHypothesisId, HypothesisRequestProfile> = {
  "open-water": {
    title: "Open-water surface scattering",
    question: "Was exposed surface water present within this radar-change candidate at a temporally comparable observation?",
    collections: [DSWX_HLS, DSWX_S1],
    evidenceThatCouldSupport: [
      "A valid, time-matched optical water observation intersects the candidate footprint.",
      "Positive and negative reference samples cover both the candidate and nearby comparable non-water areas.",
      "Water classification remains after cloud, shadow, terrain and product-quality masks are applied.",
    ],
    evidenceThatCouldChallenge: [
      "A clear, quality-valid observation maps the candidate as non-water while nearby water is detected.",
      "Independent labels consistently identify the candidate as non-water at a comparable acquisition time.",
      "The apparent agreement disappears when acquisition-date offsets or masked pixels are accounted for.",
    ],
    minimumReviewProtocol: [
      "Record acquisition date and time offset for every reference granule.",
      "Report valid reference coverage inside the candidate separately from coverage in the surrounding search box.",
      "Keep cloud, shadow, layover, water and no-data classes separate; no-data is not a negative label.",
      "Retain positive and negative reference samples for any later accuracy assessment.",
    ],
    guardrails: [
      "A matching DSWx granule is contextual evidence, not field confirmation.",
      "Do not call a candidate correct solely because a product footprint overlaps its bounding box.",
    ],
  },
  "flooded-vegetation": {
    title: "Flooded-vegetation double bounce",
    question: "Is there independent evidence of water beneath or within vegetation at this candidate and observation time?",
    collections: [DSWX_S1, HLSS30_VI],
    evidenceThatCouldSupport: [
      "A cross-sensor inundated-vegetation observation or a time-matched field label intersects the candidate.",
      "Vegetation context confirms that the candidate includes suitable upright vegetation rather than only open water.",
      "Repeated compatible radar observations show a physically plausible response over more than one acquisition.",
    ],
    evidenceThatCouldChallenge: [
      "High-quality independent observations show vegetation without surface or under-canopy water at a comparable time.",
      "The candidate is not vegetated in suitable land-cover or field observations.",
      "The radar response is transient or inconsistent across compatible repeat acquisitions.",
    ],
    minimumReviewProtocol: [
      "Keep water evidence and vegetation evidence as separate observations.",
      "Record whether the reference can observe beneath the canopy or only its optical surface.",
      "Do not equate a vegetation-index change with inundation or double-bounce confirmation.",
      "Record orbit, polarization, acquisition date and product maturity for repeat SAR comparisons.",
    ],
    guardrails: [
      "Optical vegetation indices cannot by themselves confirm water beneath a canopy.",
      "Sentinel-1 DSWx is cross-sensor radar context, not an independent field observation.",
    ],
  },
  "soil-moisture": {
    title: "Soil-moisture variation",
    question: "Did soil moisture change at a spatial and temporal support that can meaningfully be compared with this candidate?",
    collections: [SMAP_L4, NISAR_SME2],
    evidenceThatCouldSupport: [
      "Time-matched in-situ measurements or a suitable soil-moisture product show a change over the candidate's support.",
      "The soil-moisture observation's grid size and uncertainty are compatible with the comparison being claimed.",
      "The measured moisture change has a documented temporal relationship to the NISAR acquisition.",
    ],
    evidenceThatCouldChallenge: [
      "Representative field measurements show no meaningful soil-moisture change at the candidate during the relevant interval.",
      "The independent measurement changes in the opposite direction after its uncertainty and spatial support are considered.",
      "The only available soil-moisture signal is from a much larger mixed pixel and cannot resolve the candidate.",
    ],
    minimumReviewProtocol: [
      "Prefer field measurements with documented depth, location, method and acquisition time.",
      "Report product grid size next to candidate area; do not downscale a coarse product and describe it as a local observation.",
      "Retain retrieval quality flags and uncertainty.",
      "Identify same-mission products separately from independent sensor or field evidence.",
    ],
    guardrails: [
      "SMAP L4 9 km data are broad context and may be far coarser than an individual candidate.",
      "NISAR SME2 is same-mission provisional context, not independent sensor validation.",
      "A backscatter difference is not itself a soil-moisture retrieval.",
    ],
  },
  "vegetation-surface": {
    title: "Vegetation, roughness or intercepted water",
    question: "Did vegetation state or another surface condition change in a way that could explain the observed radar response?",
    collections: [HLSS30_VI, HLSL30_VI],
    evidenceThatCouldSupport: [
      "Time-matched optical observations show a vegetation-condition or land-cover change over the candidate.",
      "Field notes document a change in surface roughness, canopy condition, wind damage or intercepted water.",
      "Weather observations provide relevant acquisition-time context and are not mistaken for direct surface measurements.",
    ],
    evidenceThatCouldChallenge: [
      "Clear, comparable optical observations show no detectable vegetation-condition change over the candidate.",
      "Field observations show stable surface structure and roughness across the relevant interval.",
      "The candidate response persists across repeat acquisitions despite stable independent surface-condition evidence.",
    ],
    minimumReviewProtocol: [
      "Record optical cloud, shadow and valid-pixel coverage for both dates.",
      "Separate vegetation indices from direct roughness measurements.",
      "Attach weather observations with station/grid location and time offset.",
      "Do not infer roughness stability from an unchanged vegetation index alone.",
    ],
    guardrails: [
      "HLS vegetation indices are context, not a direct roughness measurement.",
      "Absence of optical change does not rule out wind, soil roughness or intercepted-water effects.",
    ],
  },
};

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function isoSecond(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function utcDateRange(dateOnly: string, toleranceDays: TemporalWindowDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  const parsed = new Date(dateOnly + "T00:00:00.000Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateOnly) return null;
  const start = addUtcDays(parsed, -toleranceDays);
  const lastDay = addUtcDays(parsed, toleranceDays);
  const end = new Date(lastDay.getTime() + 86_399_000);
  return { startUtc: isoSecond(start), endUtc: isoSecond(end) };
}

function candidateBounds(geometry: WetlandGeometry | undefined): [number, number, number, number] | null {
  if (!geometry) return null;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const points: number[][] = [];
  for (const polygon of polygons) {
    const outerRing = polygon[0] ?? [];
    for (const point of outerRing) {
      const [longitude, latitude] = point;
      if (Number.isFinite(longitude) && Number.isFinite(latitude)
        && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90) {
        points.push([longitude, latitude]);
      }
    }
  }
  if (points.length < 3) return null;
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  const bounds: [number, number, number, number] = [
    Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes),
  ];
  if (!(bounds[0] < bounds[2] && bounds[1] < bounds[3])) return null;
  return bounds;
}

function candidatePolygonParts(geometry: WetlandGeometry | undefined): { parts: string[]; holesIgnored: boolean } | null {
  if (!geometry) return null;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const parts: string[] = [];
  let holesIgnored = false;
  for (const polygon of polygons) {
    const points: [number, number][] = [];
    for (const point of polygon[0] ?? []) {
      const [longitude, latitude] = point;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
        || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
      const previous = points[points.length - 1];
      if (!previous || previous[0] !== longitude || previous[1] !== latitude) points.push([longitude, latitude]);
    }
    if (points.length > 1 && points[0][0] === points[points.length - 1][0]
      && points[0][1] === points[points.length - 1][1]) points.pop();
    if (points.length < 3) return null;
    let area = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i], b = points[(i + 1) % points.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (Math.abs(area) < 1e-12) return null;
    if (area < 0) points.reverse();
    const closed = [...points, points[0]];
    parts.push(closed.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(","));
    if (polygon.length > 1) holesIgnored = true;
  }
  if (!parts.length || parts.join("").length > 3_000) return null;
  return { parts, holesIgnored };
}

function candidateSpatialSearch(patch: WetlandPatch): EvidenceRequest["spatialSearch"] {
  const bounds = candidateBounds(patch.geometry);
  const polygon = candidatePolygonParts(patch.geometry);
  if (polygon) return {
    method: "candidate-polygon",
    label: polygon.parts.length === 1 ? "Candidate polygon" : `Candidate polygons (${polygon.parts.length} parts)`,
    boundingBox: bounds,
    polygonParts: polygon.parts,
    holesIgnored: polygon.holesIgnored,
    point: null,
    interpretation: "CMR searches the candidate's outer polygon ring or multipart outer rings. Returned granule footprints are metadata matches only; this is not pixel-level valid coverage. Interior holes, if present, are not subtracted from the search geometry.",
  };
  if (bounds) return {
    method: "candidate-bounding-box",
    label: "Candidate bounding-box extent",
    boundingBox: bounds,
    polygonParts: null,
    holesIgnored: false,
    point: null,
    interpretation: "The candidate polygon was unavailable or too complex for a compact CMR polygon query, so its bounding box is used. This discovery envelope can include pixels outside the candidate and gaps between multipart regions.",
  };
  const [latitude, longitude] = patch.centroid;
  if (Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) return {
    method: "candidate-centroid-only",
    label: "Candidate centroid only",
    boundingBox: null,
    polygonParts: null,
    holesIgnored: false,
    point: [longitude, latitude],
    interpretation: "Candidate geometry is unavailable or unsuitable for an archive query. This point search finds granules covering the centroid; it does not represent the full candidate footprint.",
  };
  return {
    method: "unavailable",
    label: "Spatial filter unavailable",
    boundingBox: null,
    polygonParts: null,
    holesIgnored: false,
    point: null,
    interpretation: "No valid candidate geometry or centroid is available, so no spatial archive query can be created.",
  };
}

function cmrGranuleUrl(
  collection: EvidenceArchiveCollection,
  temporal: { startUtc: string; endUtc: string },
  spatial: EvidenceRequest["spatialSearch"],
): string | null {
  const url = new URL("https://cmr.earthdata.nasa.gov/search/granules.json");
  url.searchParams.set("short_name", collection.shortName);
  url.searchParams.set("version", collection.version);
  url.searchParams.append("temporal[]", temporal.startUtc + "," + temporal.endUtc);
  if (spatial.method === "candidate-polygon" && spatial.polygonParts?.length) {
    if (spatial.polygonParts.length === 1) url.searchParams.set("polygon", spatial.polygonParts[0]);
    else {
      url.searchParams.set("options[polygon][or]", "true");
      for (const polygon of spatial.polygonParts) url.searchParams.append("polygon[]", polygon);
    }
  } else if (spatial.method === "candidate-bounding-box" && spatial.boundingBox) {
    url.searchParams.set("bounding_box", spatial.boundingBox.map((n) => n.toFixed(6)).join(","));
  } else if (spatial.method === "candidate-centroid-only" && spatial.point) {
    url.searchParams.set("point", spatial.point.map((n) => n.toFixed(6)).join(","));
  } else return null;
  url.searchParams.set("page_size", "20");
  url.searchParams.append("sort_key[]", "-start_date");
  return url.toString();
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "candidate";
}

const ALLOWED_WINDOWS: TemporalWindowDays[] = [0, 1, 3, 7, 14];

/**
 * Convert one selected physical hypothesis into a reproducible evidence request.
 * CMR links are built from verified collection short-name/version identifiers;
 * they open a search but do not assert that any matching granule exists.
 */
export function buildEvidenceRequest(
  patch: WetlandPatch,
  hypothesisId: ScatteringHypothesisId,
  toleranceDays: TemporalWindowDays = 0,
): EvidenceRequest {
  const windowDays = ALLOWED_WINDOWS.includes(toleranceDays) ? toleranceDays : 0;
  const profile = PROFILES[hypothesisId];
  const temporal = utcDateRange(patch.date, windowDays);
  const spatialSearch = candidateSpatialSearch(patch);
  const centroid = Number.isFinite(patch.centroid[0]) && Number.isFinite(patch.centroid[1])
    ? { latitude: patch.centroid[0], longitude: patch.centroid[1] }
    : null;
  const archiveSearches: EvidenceArchiveSearch[] = [];
  const warnings: string[] = [];

  if (!temporal) {
    warnings.push("The candidate date is not a valid YYYY-MM-DD value; archive searches were not generated.");
  }
  if (spatialSearch.method === "unavailable") {
    warnings.push("No valid candidate geometry or centroid is available; archive searches were not generated.");
  }
  if (temporal && spatialSearch.method !== "unavailable") {
    for (const collection of profile.collections) {
      const queryUrl = cmrGranuleUrl(collection, temporal, spatialSearch);
      if (queryUrl) archiveSearches.push({ ...collection, queryUrl, spatialFilter: spatialSearch.method === "candidate-polygon" ? "polygon" : spatialSearch.method === "candidate-bounding-box" ? "bounding_box" : "point",
        temporalStartUtc: temporal.startUtc, temporalEndUtc: temporal.endUtc });
    }
  }
  if (spatialSearch.method === "candidate-polygon" && spatialSearch.holesIgnored) {
    warnings.push("CMR polygon discovery uses outer rings only; interior holes are not subtracted from the query.");
  } else if (spatialSearch.method === "candidate-bounding-box") {
    warnings.push("CMR uses the candidate bounding box for discovery, not exact pixel-level geometry intersection.");
  } else if (spatialSearch.method === "candidate-centroid-only") {
    warnings.push("Centroid-only discovery may omit granules that intersect other parts of the candidate.");
  }
  warnings.push("Archive links perform discovery only. Inspect granule metadata, valid coverage, masks, quality, acquisition offset and access before using any result.");
  warnings.push("A granule footprint match is not a validation result, and missing granules or masked pixels are not negative evidence.");

  const requestId = [
    "BW", safeId(patch.id), patch.date, hypothesisId,
  ].join("-");

  return {
    schemaVersion: "beyonders.evidence-request/1.1",
    requestId,
    createdBy: "Beyonders",
    module: "wetland",
    hypothesis: { id: hypothesisId, title: profile.title, question: profile.question },
    candidate: {
      id: patch.id,
      observationDate: patch.date,
      areaKm2: patch.area_km2,
      detectorClass: patch.classification,
      centroid,
      geometry: patch.geometry ?? null,
    },
    temporalSearch: temporal ? {
      referenceDate: patch.date,
      toleranceDays: windowDays,
      startUtc: temporal.startUtc,
      endUtc: temporal.endUtc,
      interpretation: "Archive discovery window only. The analyst must judge whether each granule is scientifically time-comparable; this window is not a validation threshold.",
    } : null,
    spatialSearch,
    archiveSearches,
    evidenceThatCouldSupport: [...profile.evidenceThatCouldSupport],
    evidenceThatCouldChallenge: [...profile.evidenceThatCouldChallenge],
    minimumReviewProtocol: [...profile.minimumReviewProtocol],
    guardrails: [...profile.guardrails],
    warnings,
  };
}

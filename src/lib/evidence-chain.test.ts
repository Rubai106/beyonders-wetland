import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgricultureEvidenceChain,
  buildForestEvidenceChain,
  buildVolcanoEvidenceChain,
  buildWetlandEvidenceChain,
} from "./evidence-chain";
import type { AgricultureStudy } from "./agriculture-study";
import type { ForestStudy } from "./forest-study";
import type { VolcanoStudy } from "./volcano-study";

const agricultureStudy = (): AgricultureStudy => {
  const summary = {
    valid_fraction: 0.8,
    valid_pixels: 80,
    total_pixels: 100,
    median: 0.24,
    p05: 0.16,
    p95: 0.32,
    uncertainty_median: 0.04,
  };
  const observations = ["2026-06-20", "2026-06-25", "2026-06-28", "2026-07-01"].map((date) => ({
    date,
    preview: "previews/moisture.png",
    release: "P05023",
    track: "034",
    direction: "A" as const,
    frame: "120",
    bandwidth: "20MHz",
    polarization: "HH+HV",
    frequency: "A",
    ...summary,
  }));
  return {
    schema_version: 1,
    study_id: "agriculture-pilot",
    run_id: "agriculture-pilot-01",
    product: "NISAR_L3_SME2_PROVISIONAL_V1",
    product_maturity: "PROVISIONAL",
    release: "P05023",
    track: "034",
    direction: "A",
    frame: "120",
    bandwidth: "20MHz",
    polarization: "HH+HV",
    frequency: "A",
    aoi: { west: 90, south: 24, east: 91, north: 25 },
    preview_bounds: { west: 90.1, south: 24.1, east: 90.9, north: 24.9 },
    date_range: { start: "2026-06-17", end: "2026-07-01" },
    coverage_floor: 0.2,
    baseline_count: 3,
    baseline_dates: ["2026-06-20", "2026-06-25", "2026-06-28"],
    target_date: "2026-07-01",
    observations,
    change_preview: "previews/change.png",
    change_summary: { ...summary, median: -0.03, p05: -0.12, p95: 0.08 },
    evidence_status: "EXPLORATORY",
    sources: [{ title: "ASF SME2 guide", url: "https://nisar-docs.asf.alaska.edu/sme2/" }],
  };
};

test("Agriculture chain preserves SME2 units and does not invent independent validation", () => {
  const chain = buildAgricultureEvidenceChain(agricultureStudy());
  assert.equal(chain.modality, "SME2_SOIL_MOISTURE");
  assert.equal(chain.product_maturity, "PROVISIONAL");
  assert.equal(chain.state, "EXPLORATORY");
  assert.equal(chain.site_name, "Analyst-defined WGS84 AOI");
  assert.match(chain.provenance.boundary_source ?? "", /90, 24, 91, 25/);
  assert.equal(chain.measurements.find((item) => item.id === "change-soil-moisture-median")?.unit, "m³/m³");
  assert.equal(chain.references[0].status, "NOT_RECORDED");
  assert.equal(chain.references[0].f1, null);
  assert.match(chain.conclusion, /not crop-stress/i);
  assert.match(chain.uncertainty_and_limits.join(" "), /not propagated/i);
});

test("unpublished Agriculture workspace is explicit and has no fabricated observations", () => {
  const chain = buildAgricultureEvidenceChain(null);
  assert.equal(chain.state, "NOT_PUBLISHED");
  assert.equal(chain.observations.length, 0);
  assert.equal(chain.references[0].status, "NOT_RECORDED");
});

const forestStudy = {
  schema_version: 1,
  id: "rondonia",
  title: "Rondônia forest case",
  run_id: "forest-run",
  publication_version: "2026.10.30-v1",
  method_version: "forest-hv-persistence-1.0.0",
  bbox: [-62.75, -10.4, -62.55, -10.2],
  boundary_source: "Analyst-defined rectangle",
  baseline_dates: ["2026-06-25", "2026-07-07", "2026-07-19"],
  processing_status: "COMPLETE",
  scientific_interpretation: "Unverified persistent radar-change candidates.",
  reference_availability: "AVAILABLE",
  native_crs: "EPSG:32620",
  native_shape: [100, 100],
  pixel_area_km2: 0.0001,
  inputs: [{
    date: "2026-09-29",
    granule_id: "NISAR-GCOV-EXAMPLE",
    maturity: "PROVISIONAL",
    collection: "NISAR_L2_GCOV",
    compatibility: [],
  }],
  layers: {},
  frames: [{
    date: "2026-09-29",
    candidates_geojson: "candidates.geojson",
    layers: {},
    reference: {
      status: "AVAILABLE",
      source: "NASA HLS",
      before_date: "2026-09-17",
      after_date: "2026-10-02",
      common_clear_fraction: 0.9745,
      candidate_assessed_area_km2: 0.0128,
      candidate_supported_area_km2: 0.0091,
      support_overlap_fraction: 0.711,
      metric_note: "Exploratory joint NDVI/NBR decrease signature.",
    },
    stats: {
      candidate_area_km2: 0.0128,
      candidate_pixels: 128,
      patch_count: 1,
      assessed_area_km2: 20,
      eligible_area_km2: 22,
      study_area_km2: 30,
      valid_area_km2: 20,
      median_hh_db: -12,
      median_hv_db: -18,
    },
  }],
  limitations: ["No labelled forest-loss reference."],
  sources: { hls: "https://hls.gsfc.nasa.gov/" },
} as unknown as ForestStudy;

test("Forest chain records optical support without converting it into accuracy", () => {
  const chain = buildForestEvidenceChain(forestStudy);
  assert.equal(chain.modality, "GCOV_BACKSCATTER");
  assert.equal(chain.references[0].status, "EXPLORATORY_SUPPORT");
  assert.equal(chain.references[0].f1, null);
  assert.equal(chain.measurements.find((item) => item.id === "forest-optical-support")?.value, 0.711);
  assert.match(chain.conclusion, /unverified/i);
});

const volcanoStudy = {
  schema_version: 1,
  id: "hayli-gubbi",
  title: "Hayli Gubbi / Erta Ale",
  publication_version: "2026.10.30-v3",
  method_version: "gunw-relative-los-1.0.1",
  run_completion: "COMPLETE",
  scientific_interpretation: "Phase-derived LOS candidates.",
  event_date: "2025-11-23",
  reference_availability: "AVAILABLE",
  bbox: [40.55, 13.4, 40.85, 13.75],
  reference_bbox: [40.58, 13.64, 40.61, 13.67],
  boundary_source: "Analyst-defined study rectangle",
  reference_note: "Assumed-stable patch",
  coherence_floor: 0.3,
  display_limit_cm: 5,
  default_pair_id: "nisar-event",
  regions: [],
  pairs: [
    {
      id: "nisar-event",
      sensor: "NISAR",
      start: "2025-11-22",
      end: "2025-12-04",
      label: "NISAR event interval",
      granule_id: "NISAR-GUNW-EXAMPLE",
      cmr_concept_id: null,
      collection: "NISAR_L2_GUNW",
      maturity: "BETA",
      polarization: "HH",
      direction: "ASCENDING",
      look_direction: "LEFT",
      track: "172",
      wavelength_m: 0.243932,
      native_crs: "EPSG:32637",
      native_spacing: [80, 80],
      original_dates_verified: true,
      data_url: null,
      phase_sign: "Reference-subtracted phase",
      grid: "nisar-grid",
      los_image: "los.png",
      coherence_image: "coherence.png",
      assessed_image: "assessed.png",
      los_download: "los.tif",
      statistics: {
        valid_fraction: 0.56,
        valid_pixels: 56,
        total_pixels: 100,
        median_coherence: 0.62,
        assessed_area_km2: 20,
        analysis_area_km2: 30,
        p05_cm: -2.5,
        p95_cm: 3.1,
        reference_mad_cm: 0.5,
        reference_component: 1,
        reference_pixels: 100,
        regions: [],
        uncertainty_note: "Reference dispersion is not displacement accuracy.",
      },
    },
    {
      id: "sentinel-event",
      sensor: "Sentinel-1",
      start: "2025-11-19",
      end: "2025-11-25",
      label: "Sentinel-1 event context",
      granule_id: "ARIA-GUNW-EXAMPLE",
      cmr_concept_id: null,
      collection: "ARIA_GUNW",
      maturity: "PROVISIONAL",
      polarization: "VV",
      direction: "ASCENDING",
      look_direction: "RIGHT",
      track: "014",
      wavelength_m: 0.055466,
      native_crs: "EPSG:4326",
      native_spacing: [0.000833, 0.000833],
      original_dates_verified: true,
      data_url: null,
      phase_sign: "ARIA phase convention",
      grid: "sentinel-grid",
      los_image: "sentinel-los.png",
      coherence_image: "sentinel-coherence.png",
      assessed_image: "sentinel-assessed.png",
      los_download: "sentinel-los.tif",
      statistics: {
        valid_fraction: 0.7,
        valid_pixels: 70,
        total_pixels: 100,
        median_coherence: 0.7,
        assessed_area_km2: 20,
        analysis_area_km2: 30,
        p05_cm: -1,
        p95_cm: 1,
        reference_mad_cm: 0.4,
        reference_component: 1,
        reference_pixels: 100,
        regions: [],
        uncertainty_note: "Independent sensor context.",
      },
    },
  ],
  comparisons: [{
    nisar_id: "nisar-event",
    sentinel_id: "sentinel-event",
    status: "COMPARABLE",
    common_valid_fraction: 0.4,
    common_valid_pixels: 40,
    start_offset_days: 3,
    end_offset_days: 9,
    interpretation: "Complementary cross-sensor phase context.",
  }],
  limitations: ["No causal attribution."],
} as unknown as VolcanoStudy;

test("Volcano chain labels Sentinel-1 as cross-sensor context, not ground truth", () => {
  const chain = buildVolcanoEvidenceChain(volcanoStudy);
  assert.equal(chain.modality, "GUNW_PHASE");
  assert.equal(chain.references[0].status, "CROSS_SENSOR_CONTEXT");
  assert.equal(chain.references[0].precision, null);
  assert.equal(chain.measurements.find((item) => item.id === "volcano-reference-mad")?.unit, "cm MAD");
  assert.match(chain.conclusion, /does not establish eruption causation/i);
});

test("Wetland chain suppresses interpretation when common-clear coverage is below 20 percent", () => {
  const chain = buildWetlandEvidenceChain({
    run_id: "chokwe-run",
    site_name: "Chókwè",
    data_source: "NISAR",
    product: "NISAR_L2_GCOV",
    product_maturity: "BETA",
    baseline_date: "2026-01-05",
    baseline_observation_dates: ["2026-01-05"],
    selected_date: "2026-01-17",
    polarizations: ["HH"],
    dates: ["2026-01-05", "2026-01-17"],
    reference_check_status: "INCONCLUSIVE_COVERAGE",
    case_study: {
      title: "Chókwè event case",
      site: "Chókwè",
      baseline_date: "2026-01-05",
      event_date: "2026-01-17",
      candidate_patches: 127,
      candidate_area_km2: 29.87,
      method: { open_water_rule: "HH darkening screen", threshold_db: -2.5 },
    },
    reference_validation: {
      status: "INCONCLUSIVE_COVERAGE",
      reference_product: "NASA HLS",
      comparison: {
        baseline: { nisar_date: "2026-01-05", hls_date: "2026-01-07", offset_days: 2 },
        event: { nisar_date: "2026-01-17", hls_date: "2026-01-22", offset_days: 5 },
      },
      coverage: { common_clear_fraction: 0.0126 },
      optical_support: { common_clear_fraction: 0.0126, candidate_assessed_fraction: 0 },
      reason: "Only 1.26% common-clear coverage; candidates remain unassessed.",
      limitations: ["No candidate area was assessed by HLS."],
    },
  });
  assert.equal(chain.state, "INCONCLUSIVE");
  assert.equal(chain.references[0].status, "INCONCLUSIVE");
  assert.equal(chain.references[0].candidate_assessed_fraction, 0);
  assert.equal(chain.references[0].f1, null);
  assert.match(chain.conclusion, /not automatically confirmed flood boundaries/i);
});

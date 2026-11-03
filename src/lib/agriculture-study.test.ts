import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgricultureDateAxis,
  buildAgricultureRainfallSeries,
  buildAgricultureSupportDrift,
  isAgricultureChecksumManifest,
  isAgricultureIndex,
  isAgricultureStudy,
  safeRelativeAssetPath,
  sha256Hex,
} from "./agriculture-study";

const summary = {
  valid_fraction: 0.8, valid_pixels: 80, total_pixels: 100,
  median: 0.24, p05: 0.16, p95: 0.32, uncertainty_median: 0.04,
};
const observation = (date: string) => ({
  date, preview: "previews/moisture-2026-06-20.png",
  release: "P05023", track: "034", direction: "A" as const,
  frame: "120", bandwidth: "20MHz", polarization: "HH+HV", frequency: "A",
  ...summary,
});
const matchedSummary = {
  valid_fraction: 0.6, valid_pixels: 60, total_pixels: 100,
  median: 0.23, p05: 0.15, p95: 0.31, uncertainty_median: 0.04,
};
const matchedObservation = (date: string) => ({
  date, preview: "previews/matched-moisture-" + date + ".png", ...matchedSummary,
});
const study = {
  schema_version: 2, study_id: "test-study", run_id: "test-run",
  product: "NISAR_L3_SME2_PROVISIONAL_V1", product_maturity: "PROVISIONAL",
  release: "P05023", track: "034", direction: "A", frame: "120",
  bandwidth: "20MHz", polarization: "HH+HV", frequency: "A",
  aoi: { west: 90, south: 24, east: 91, north: 25 },
  preview_bounds: { west: 90.1, south: 24.1, east: 90.9, north: 24.9 },
  date_range: { start: "2026-06-17", end: "2026-07-01" }, coverage_floor: 0.2,
  baseline_count: 3, baseline_dates: ["2026-06-20", "2026-06-25", "2026-06-28"],
  target_date: "2026-07-01",
  observations: ["2026-06-20", "2026-06-25", "2026-06-28", "2026-07-01"].map(observation),
  change_preview: "previews/change-latest-minus-baseline.png",
  change_summary: summary,
  matched_support: {
    method: "ALL_DATE_VALID_PIXEL_INTERSECTION",
    status: "COMPARABLE",
    valid_fraction: 0.6, valid_pixels: 60, total_pixels: 100,
    observations: ["2026-06-20", "2026-06-25", "2026-06-28", "2026-07-01"].map(matchedObservation),
  },
  evidence_status: "EXPLORATORY",
  sources: [{ title: "ASF NISAR SME2 Guide", url: "https://nisar-docs.asf.alaska.edu/sme2/" }],
};

test("accepts a structurally valid exploratory study", () => assert.equal(isAgricultureStudy(study), true));

test("validates the per-date SME2 surface-flag observability audit", () => {
  const changed = structuredClone(study);
  changed.observations[0].surface_flag_diagnostics = {
    method: "NISAR_SME2_SURFACE_QUALITY_FLAG_BITS",
    total_aoi_pixels: 100,
    encoded_pixels: 95,
    unflagged_pixels: 70,
    flagged_pixels: 25,
    fill_pixels: 3,
    invalid_pixels: 1,
    unsupported_encoding_pixels: 1,
    flags: {
      static_water: 2, urban_area: 3, precipitation: 12, snow_or_ice: 0,
      permanent_snow_or_ice: 0, frozen_ground: 1, terrain: 1, dense_vegetation: 11,
    },
    flag_combinations: [
      { mask: 4, pixels: 8 },
      { mask: 128, pixels: 7 },
      { mask: 132, pixels: 4 },
      { mask: 2, pixels: 2 },
      { mask: 1, pixels: 1 },
      { mask: 3, pixels: 1 },
      { mask: 32, pixels: 1 },
      { mask: 64, pixels: 1 },
    ],
  };
  assert.equal(isAgricultureStudy(changed), true);

  const inconsistent = structuredClone(changed);
  inconsistent.observations[0].surface_flag_diagnostics.flags.dense_vegetation = 96;
  assert.equal(isAgricultureStudy(inconsistent), false);

  const wrongCombinationTotal = structuredClone(changed);
  wrongCombinationTotal.observations[0].surface_flag_diagnostics.flag_combinations[0].pixels = 7;
  assert.equal(isAgricultureStudy(wrongCombinationTotal), false);

  const wrongMarginal = structuredClone(changed);
  wrongMarginal.observations[0].surface_flag_diagnostics.flags.precipitation = 11;
  assert.equal(isAgricultureStudy(wrongMarginal), false);

  const unordered = structuredClone(changed);
  unordered.observations[0].surface_flag_diagnostics.flag_combinations.reverse();
  assert.equal(isAgricultureStudy(unordered), false);
});

test("validates an independently sourced, area-weighted crop-support audit", () => {
  const changed = structuredClone(study);
  const dates = changed.observations.map((item) => item.date);
  const totalCropArea = 45;
  const commonArea = 30;
  const cropSummary = (date: string, validArea: number, validCells: number) => ({
    date,
    valid_crop_area_equivalent_pixels: validArea,
    total_crop_area_equivalent_pixels: totalCropArea,
    valid_crop_area_fraction: validArea / totalCropArea,
    valid_native_cells: validCells,
    weighted_soil_moisture: {
      median: 0.24, p05: 0.18, p95: 0.31, uncertainty_median: 0.03,
    },
  });
  changed.crop_observability = {
    method: "AREA_WEIGHTED_INDEPENDENT_CROP_MASK_TO_SME2_NATIVE_GRID_V1",
    source: "Dynamic World V1 · crops probability",
    source_date: "2026-06-19",
    source_filename: "crop-probability.tif",
    source_sha256: "b".repeat(64),
    source_bytes: 4096,
    source_crs: "EPSG:4326",
    source_cell_area_m2: 100,
    target_cell_area_m2: 40000,
    probability_threshold: 0.5,
    minimum_cell_coverage: 0.8,
    aoi_native_cells: 100,
    mask_covered_cells: 90,
    mask_coverage_fraction: 0.9,
    mean_source_data_coverage_fraction: 0.95,
    crop_supported_cells: 60,
    crop_area_equivalent_pixels: totalCropArea,
    weighted_statistic: "AREA_WEIGHTED_EMPIRICAL_CDF_LEFT_CONTINUOUS_V1",
    observations: dates.map((date) => ({
      ...cropSummary(date, 40, 55), status: "COMPARABLE" as const,
    })),
    common_support: {
      method: "ALL_DATE_VALID_CROP_AREA_INTERSECTION",
      status: "COMPARABLE",
      valid_crop_area_equivalent_pixels: commonArea,
      total_crop_area_equivalent_pixels: totalCropArea,
      valid_crop_area_fraction: commonArea / totalCropArea,
      valid_native_cells: 42,
      observations: dates.map((date) => cropSummary(date, commonArea, 42)),
      preview: "previews/crop-common-support.png",
    },
    preview: "previews/crop-support.png",
    source_coverage_preview: "previews/crop-source-coverage.png",
  };
  assert.equal(isAgricultureStudy(changed), true);

  const wrongArea = structuredClone(changed);
  wrongArea.crop_observability.observations[0].valid_crop_area_fraction = 0.99;
  assert.equal(isAgricultureStudy(wrongArea), false);

  const falseStatus = structuredClone(changed);
  falseStatus.crop_observability.common_support.status = "COMPARABLE";
  falseStatus.crop_observability.common_support.valid_crop_area_fraction = 0.1;
  falseStatus.crop_observability.common_support.valid_crop_area_equivalent_pixels = 4.5;
  falseStatus.crop_observability.common_support.observations.forEach((item) => {
    item.valid_crop_area_equivalent_pixels = 4.5;
    item.valid_crop_area_fraction = 0.1;
  });
  assert.equal(isAgricultureStudy(falseStatus), false);
});

test("does not mistake an under-covered mask with zero mapped crop area for a no-crop finding", () => {
  const changed = structuredClone(study);
  const dates = changed.observations.map((item) => item.date);
  const cropSummary = (date: string) => ({
    date,
    valid_crop_area_equivalent_pixels: 0,
    total_crop_area_equivalent_pixels: 0,
    valid_crop_area_fraction: 0,
    valid_native_cells: 0,
    weighted_soil_moisture: null,
    status: "INSUFFICIENT_MASK_COVERAGE" as const,
  });
  changed.crop_observability = {
    method: "AREA_WEIGHTED_INDEPENDENT_CROP_MASK_TO_SME2_NATIVE_GRID_V1",
    source: "Independent crop-mask test fixture",
    source_date: null,
    source_filename: "mostly-missing.tif",
    source_sha256: "c".repeat(64),
    source_bytes: 1024,
    source_crs: "EPSG:4326",
    source_cell_area_m2: 100,
    target_cell_area_m2: 40000,
    probability_threshold: 0.5,
    minimum_cell_coverage: 0.8,
    aoi_native_cells: 100,
    mask_covered_cells: 10,
    mask_coverage_fraction: 0.1,
    mean_source_data_coverage_fraction: 0.1,
    crop_supported_cells: 0,
    crop_area_equivalent_pixels: 0,
    weighted_statistic: "AREA_WEIGHTED_EMPIRICAL_CDF_LEFT_CONTINUOUS_V1",
    observations: dates.map(cropSummary),
    common_support: {
      method: "ALL_DATE_VALID_CROP_AREA_INTERSECTION",
      status: "INSUFFICIENT_MASK_COVERAGE",
      valid_crop_area_equivalent_pixels: 0,
      total_crop_area_equivalent_pixels: 0,
      valid_crop_area_fraction: 0,
      valid_native_cells: 0,
      observations: [],
      preview: null,
    },
    preview: null,
    source_coverage_preview: "previews/crop-source-coverage.png",
  };
  assert.equal(isAgricultureStudy(changed), true);
});

test("keeps historical Agriculture studies valid when crop observability is absent", () => {
  assert.equal(isAgricultureStudy(study), true);
});

test("builds a date-by-date support-composition gap over a fixed pixel cohort", () => {
  const changed = structuredClone(study);
  changed.observations.forEach((item, index) => {
    item.median = [0.20, 0.25, 0.30, 0.35][index];
  });
  changed.matched_support.observations.forEach((item, index) => {
    item.median = [0.20, 0.21, 0.22, 0.23][index];
  });

  const profile = buildAgricultureSupportDrift(changed);
  assert.deepEqual(profile.map((item) => item.date), changed.observations.map((item) => item.date));
  assert.deepEqual(profile.map((item) => Number(item.gap_m3_m3.toFixed(3))), [0, 0.04, 0.08, 0.12]);
  assert.deepEqual(profile.map((item) => item.same_pixel_fraction), [0.6, 0.6, 0.6, 0.6]);
});

test("does not create a support-drift profile when the all-date cohort is empty", () => {
  const changed = structuredClone(study);
  changed.matched_support = {
    method: "ALL_DATE_VALID_PIXEL_INTERSECTION",
    status: "NO_COMMON_PIXELS",
    valid_fraction: 0,
    valid_pixels: 0,
    total_pixels: 100,
    observations: [],
  };
  assert.deepEqual(buildAgricultureSupportDrift(changed), []);
});

test("fails closed when date-valid and fixed-cohort dates are misaligned", () => {
  const changed = structuredClone(study);
  changed.matched_support.observations[2].date = "2026-06-27";
  assert.deepEqual(buildAgricultureSupportDrift(changed), []);
});

test("accepts a zero-common-pixel audit without inventing matched observations", () => {
  const changed = structuredClone(study);
  changed.matched_support = {
    method: "ALL_DATE_VALID_PIXEL_INTERSECTION",
    status: "NO_COMMON_PIXELS",
    valid_fraction: 0, valid_pixels: 0, total_pixels: 100,
    observations: [],
  };
  assert.equal(isAgricultureStudy(changed), true);
});

test("accepts a non-empty matched cohort below the fixed coverage floor as inconclusive", () => {
  const changed = structuredClone(study);
  const lowSummary = {
    valid_fraction: 0.01, valid_pixels: 1, total_pixels: 100,
    median: 0.23, p05: 0.23, p95: 0.23, uncertainty_median: 0.04,
  };
  changed.matched_support = {
    method: "ALL_DATE_VALID_PIXEL_INTERSECTION",
    status: "INCONCLUSIVE_COVERAGE",
    valid_fraction: 0.01, valid_pixels: 1, total_pixels: 100,
    observations: ["2026-06-20", "2026-06-25", "2026-06-28", "2026-07-01"].map((date) => ({
      date, preview: "previews/matched-moisture-" + date + ".png", ...lowSummary,
    })),
  };
  assert.equal(isAgricultureStudy(changed), true);
});

test("rejects matched observations that do not follow the study dates", () => {
  const changed = structuredClone(study);
  changed.matched_support.observations[1].date = "2026-06-24";
  assert.equal(isAgricultureStudy(changed), false);
});

test("rejects a matched observation with inconsistent cohort pixel counts", () => {
  const changed = structuredClone(study);
  changed.matched_support.observations[1].valid_pixels = 59;
  changed.matched_support.observations[1].valid_fraction = 0.59;
  assert.equal(isAgricultureStudy(changed), false);
});

test("rejects a matched-support status that hides inadequate coverage", () => {
  const changed = structuredClone(study);
  changed.matched_support.status = "COMPARABLE";
  changed.matched_support.valid_fraction = 0.1;
  changed.matched_support.valid_pixels = 10;
  changed.matched_support.observations.forEach((item) => {
    item.valid_fraction = 0.1;
    item.valid_pixels = 10;
  });
  assert.equal(isAgricultureStudy(changed), false);
});
test("rejects mixed release observations", () => {
  const bad = structuredClone(study);
  bad.observations[2].release = "P05024";
  assert.equal(isAgricultureStudy(bad), false);
});
test("rejects unsorted or duplicate dates", () => {
  const bad = structuredClone(study);
  bad.observations[1].date = bad.observations[0].date;
  assert.equal(isAgricultureStudy(bad), false);
});
test("rejects weaker-than-policy coverage floor", () => {
  assert.equal(isAgricultureStudy({ ...study, coverage_floor: 0.1 }), false);
});
test("requires baseline dates to match the first observations", () => {
  assert.equal(isAgricultureStudy({ ...study, baseline_dates: ["2026-06-25", "2026-06-20", "2026-06-28"] }), false);
});
test("rejects invalid and traversing asset paths", () => {
  assert.equal(safeRelativeAssetPath("../secret.png", "previews/"), false);
  assert.equal(safeRelativeAssetPath("previews/../secret.png", "previews/"), false);
  assert.equal(safeRelativeAssetPath("previews/good.png", "previews/"), true);
});
test("validates the published index contract", () => {
  assert.equal(isAgricultureIndex({ schema_version: 1, study_url: "current/study.json", checksums_url: "current/web-checksums.json", published_at: "2026-10-31T00:00:00Z" }), true);
  assert.equal(isAgricultureIndex({ schema_version: 1, study_url: "../study.json", checksums_url: "current/web-checksums.json", published_at: "2026-10-31" }), false);
});
test("requires a study checksum and valid preview entries", () => {
  const hash = "a".repeat(64);
  assert.equal(isAgricultureChecksumManifest({ schema_version: 1, files: { "study.json": { bytes: 20, sha256: hash }, "previews/a.png": { bytes: 10, sha256: hash } } }), true);
  assert.equal(isAgricultureChecksumManifest({ schema_version: 1, files: { "previews/a.png": { bytes: 10, sha256: hash } } }), false);
});
test("SHA-256 helper returns a lowercase hexadecimal digest", async () => {
  const digest = await sha256Hex(new TextEncoder().encode("abc").buffer);
  assert.equal(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});


test("accepts negative and positive soil-moisture differences", () => {
  const changed = structuredClone(study);
  changed.change_summary = {
    valid_fraction: 0.8, valid_pixels: 80, total_pixels: 100,
    median: -0.03, p05: -0.12, p95: 0.08, uncertainty_median: 0.02,
  };
  assert.equal(isAgricultureStudy(changed), true);
});

test("positions irregular SME2 acquisitions by actual elapsed calendar time", () => {
  const axis = buildAgricultureDateAxis([
    "2026-06-20", "2026-07-02", "2026-07-26", "2026-08-07",
  ]);
  assert.deepEqual(axis.map((item) => item.date), [
    "2026-06-20", "2026-07-02", "2026-07-26", "2026-08-07",
  ]);
  assert.deepEqual(axis.map((item) => item.position), [0, 25, 75, 100]);
  assert.deepEqual(axis.map((item) => item.gap_days), [null, 12, 24, 12]);
});

test("rejects invalid, duplicate and out-of-order acquisition dates for chart positioning", () => {
  assert.deepEqual(buildAgricultureDateAxis([]), []);
  assert.deepEqual(buildAgricultureDateAxis(["2026-02-30"]), []);
  assert.deepEqual(buildAgricultureDateAxis(["2026-06-20", "2026-06-20"]), []);
  assert.deepEqual(buildAgricultureDateAxis(["2026-07-02", "2026-06-20"]), []);
});

test("centres a single acquisition on the elapsed-time axis", () => {
  assert.deepEqual(buildAgricultureDateAxis(["2026-06-20"]), [
    { date: "2026-06-20", position: 50, gap_days: null },
  ]);
});


test("validates IMERG daily rainfall context against exact SME2 dates and complete UTC windows", () => {
  const changed = structuredClone(study);
  const dates = changed.observations.map((item) => item.date);
  const windows = (scale: number) => ({
    "1d": { rainfall_mm: 4 * scale, valid_days: 1, expected_days: 1, spatial_coverage_fraction: 1, mean_half_hourly_samples: 48 },
    "3d": { rainfall_mm: 12 * scale, valid_days: 3, expected_days: 3, spatial_coverage_fraction: 1, mean_half_hourly_samples: 48 },
    "7d": { rainfall_mm: 28 * scale, valid_days: 7, expected_days: 7, spatial_coverage_fraction: 1, mean_half_hourly_samples: 48 },
    "12d": { rainfall_mm: 48 * scale, valid_days: 12, expected_days: 12, spatial_coverage_fraction: 1, mean_half_hourly_samples: 48 },
  });
  changed.rainfall_context = {
    method: "GPM_IMERG_FINAL_DAILY_AOI_MEAN_V1",
    product: "GPM_3IMERGDF_V07", resolution_degrees: 0.1, units: "mm",
    time_basis: "UTC_COMPLETE_DAYS_BEFORE_ACQUISITION",
    source: "NASA GPM IMERG Final daily precipitation",
    source_doi: "10.5067/GPM/IMERGDF/DAY/07",
    source_sha256: "d".repeat(64), source_bytes: 8192,
    granules: [{ date: dates[0], concept_id: "G123-PROV", filename: "GPM_3IMERGDF_20260619.nc4", bytes: 8192, sha256: "c".repeat(64) }],
    aoi_grid_cells: 4, spatial_coverage_floor: 0.9,
    observations: dates.map((date, index) => ({ date, windows: windows(index + 1) })),
  };
  assert.equal(isAgricultureStudy(changed), true);
  const plot = buildAgricultureRainfallSeries(changed, "3d");
  assert.equal(plot.length, dates.length);
  assert.deepEqual(plot.map((item) => item.position), [0, 45.45454545454545, 72.72727272727273, 100]);
  assert.deepEqual(plot.map((item) => item.rainfall_mm), [12, 24, 36, 48]);
});

test("keeps incomplete IMERG windows visibly missing instead of treating them as zero rainfall", () => {
  const changed = structuredClone(study);
  const dates = changed.observations.map((item) => item.date);
  const windows = () => ({
    "1d": { rainfall_mm: null, valid_days: 0, expected_days: 1, spatial_coverage_fraction: 0, mean_half_hourly_samples: null },
    "3d": { rainfall_mm: null, valid_days: 2, expected_days: 3, spatial_coverage_fraction: 0, mean_half_hourly_samples: null },
    "7d": { rainfall_mm: 28, valid_days: 7, expected_days: 7, spatial_coverage_fraction: 1, mean_half_hourly_samples: 48 },
    "12d": { rainfall_mm: 48, valid_days: 12, expected_days: 12, spatial_coverage_fraction: 1, mean_half_hourly_samples: 48 },
  });
  changed.rainfall_context = {
    method: "GPM_IMERG_FINAL_DAILY_AOI_MEAN_V1",
    product: "GPM_3IMERGDF_V07", resolution_degrees: 0.1, units: "mm",
    time_basis: "UTC_COMPLETE_DAYS_BEFORE_ACQUISITION",
    source: "NASA GPM IMERG Final daily precipitation",
    source_doi: "10.5067/GPM/IMERGDF/DAY/07",
    source_sha256: "e".repeat(64), source_bytes: 8192,
    granules: [{ date: dates[0], concept_id: "G123-PROV", filename: "GPM_3IMERGDF_20260619.nc4", bytes: 8192, sha256: "c".repeat(64) }],
    aoi_grid_cells: 4, spatial_coverage_floor: 0.9,
    observations: dates.map((date) => ({ date, windows: windows() })),
  };
  assert.equal(isAgricultureStudy(changed), true);
  assert.deepEqual(buildAgricultureRainfallSeries(changed, "1d").map((item) => item.rainfall_mm), [null, null, null, null]);
  assert.deepEqual(buildAgricultureRainfallSeries(changed, "3d").map((item) => item.rainfall_mm), [null, null, null, null]);
  assert.deepEqual(buildAgricultureRainfallSeries(changed, "7d").map((item) => item.rainfall_mm), [28, 28, 28, 28]);
});

test("rejects mismatched IMERG dates, incomplete windows with numeric totals and invalid provenance", () => {
  const changed = structuredClone(study);
  const dates = changed.observations.map((item) => item.date);
  const complete = () => ({
    "1d": { rainfall_mm: 1, valid_days: 1, expected_days: 1, spatial_coverage_fraction: 1, mean_half_hourly_samples: 48 },
    "3d": { rainfall_mm: 3, valid_days: 3, expected_days: 3, spatial_coverage_fraction: 1, mean_half_hourly_samples: 48 },
    "7d": { rainfall_mm: 7, valid_days: 7, expected_days: 7, spatial_coverage_fraction: 1, mean_half_hourly_samples: 48 },
    "12d": { rainfall_mm: 12, valid_days: 12, expected_days: 12, spatial_coverage_fraction: 1, mean_half_hourly_samples: 48 },
  });
  changed.rainfall_context = {
    method: "GPM_IMERG_FINAL_DAILY_AOI_MEAN_V1",
    product: "GPM_3IMERGDF_V07", resolution_degrees: 0.1, units: "mm",
    time_basis: "UTC_COMPLETE_DAYS_BEFORE_ACQUISITION",
    source: "NASA GPM IMERG Final daily precipitation",
    source_doi: "10.5067/GPM/IMERGDF/DAY/07",
    source_sha256: "f".repeat(64), source_bytes: 8192,
    granules: [{ date: dates[0], concept_id: "G123-PROV", filename: "GPM_3IMERGDF_20260619.nc4", bytes: 8192, sha256: "c".repeat(64) }],
    aoi_grid_cells: 4, spatial_coverage_floor: 0.9,
    observations: dates.map((date) => ({ date, windows: complete() })),
  };
  assert.equal(isAgricultureStudy(changed), true);
  const wrongDate = structuredClone(changed);
  wrongDate.rainfall_context.observations[1].date = "2026-06-24";
  assert.equal(isAgricultureStudy(wrongDate), false);
  const partialNumeric = structuredClone(changed);
  partialNumeric.rainfall_context.observations[0].windows["3d"].valid_days = 2;
  assert.equal(isAgricultureStudy(partialNumeric), false);
  const wrongResolution = structuredClone(changed);
  wrongResolution.rainfall_context.resolution_degrees = 0.001;
  assert.equal(isAgricultureStudy(wrongResolution), false);
});

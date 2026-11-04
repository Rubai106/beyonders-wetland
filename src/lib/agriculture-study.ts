export type AgricultureStatus = "EXPLORATORY" | "INCONCLUSIVE_COVERAGE";

export interface AgricultureAOI {
  west: number; south: number; east: number; north: number;
}

export interface AgricultureSummary {
  valid_fraction: number;
  valid_pixels: number;
  total_pixels: number;
  median: number;
  p05: number;
  p95: number;
  uncertainty_median: number;
}

export type AgricultureSurfaceFlagId =
  | "static_water" | "urban_area" | "precipitation" | "snow_or_ice"
  | "permanent_snow_or_ice" | "frozen_ground" | "terrain" | "dense_vegetation";

export interface AgricultureSurfaceFlagCombination {
  /** Exact eight-bit surfaceQualityFlag value; each AOI pixel belongs to one combination. */
  mask: number;
  pixels: number;
}

export interface AgricultureSurfaceFlagDiagnostics {
  method: "NISAR_SME2_SURFACE_QUALITY_FLAG_BITS";
  total_aoi_pixels: number;
  encoded_pixels: number;
  unflagged_pixels: number;
  flagged_pixels: number;
  fill_pixels: number;
  invalid_pixels: number;
  unsupported_encoding_pixels: number;
  flags: Record<AgricultureSurfaceFlagId, number>;
  /** Optional for compatibility with earlier schema-v2 publications. */
  flag_combinations?: AgricultureSurfaceFlagCombination[];
}

export interface AgricultureObservation extends AgricultureSummary {
  surface_flag_diagnostics?: AgricultureSurfaceFlagDiagnostics;
  date: string;
  preview: string;
  release: string;
  track: string;
  direction: "A" | "D";
  frame: string;
  bandwidth: string;
  polarization: string;
  frequency: string;
  source_sha256?: string;
  source_bytes?: number;
  granule_name?: string;
}

export interface AgricultureMatchedObservation extends AgricultureSummary {
  date: string;
  preview: string;
}

export interface AgricultureMatchedSupport {
  method: "ALL_DATE_VALID_PIXEL_INTERSECTION";
  status: "COMPARABLE" | "INCONCLUSIVE_COVERAGE" | "NO_COMMON_PIXELS";
  valid_fraction: number;
  valid_pixels: number;
  total_pixels: number;
  observations: AgricultureMatchedObservation[];
}

export type AgricultureCropSupportStatus =
  | "COMPARABLE" | "INCONCLUSIVE_COVERAGE" | "NO_COMMON_CROP_SUPPORT"
  | "NO_CROP_SUPPORT" | "INSUFFICIENT_MASK_COVERAGE" | "NO_VALID_CROP_SUPPORT";

export interface AgricultureCropWeightedMoisture {
  median: number;
  p05: number;
  p95: number;
  uncertainty_median: number;
}

export interface AgricultureCropSupportObservation {
  date: string;
  valid_crop_area_equivalent_pixels: number;
  total_crop_area_equivalent_pixels: number;
  valid_crop_area_fraction: number;
  valid_native_cells: number;
  weighted_soil_moisture: AgricultureCropWeightedMoisture | null;
  status?: AgricultureCropSupportStatus;
}

export interface AgricultureCropCommonSupport {
  method: "ALL_DATE_VALID_CROP_AREA_INTERSECTION";
  status: Exclude<AgricultureCropSupportStatus, "NO_VALID_CROP_SUPPORT">;
  valid_crop_area_equivalent_pixels: number;
  total_crop_area_equivalent_pixels: number;
  valid_crop_area_fraction: number;
  valid_native_cells: number;
  observations: AgricultureCropSupportObservation[];
  preview: string | null;
}

export interface AgricultureCropSourceTemporalCoverage {
  dataset: "GOOGLE/DYNAMICWORLD/V1";
  band: "crops";
  sme2_series_id: string;
  requested_window: { start: string; end: string };
  acquisition_dates: string[];
  unique_acquisition_dates: number;
  maximum_gap_between_acquisition_dates_days: number | null;
  minimum_valid_dates_per_pixel: number;
  valid_probability_fraction: number;
  latest_scene_recency: {
    days_from_latest_scene_to_requested_end: number;
    cue_days: 18;
    status: "RECENT_WITHIN_18_DAY_WINDOW" | "STALE_MORE_THAN_18_DAYS_BEFORE_WINDOW_END";
  };
  manifest_sha256: string;
  probability_sha256: string;
  observation_count_sha256: string;
  validation_sha256: string;
}

export interface AgricultureCropObservability {
  method: "AREA_WEIGHTED_INDEPENDENT_CROP_MASK_TO_SME2_NATIVE_GRID_V1";
  source: string;
  source_date: string | null;
  source_filename: string;
  source_sha256: string;
  source_bytes: number;
  source_crs: string;
  source_cell_area_m2: number;
  target_cell_area_m2: number;
  probability_threshold: number;
  minimum_cell_coverage: number;
  aoi_native_cells: number;
  mask_covered_cells: number;
  mask_coverage_fraction: number;
  mean_source_data_coverage_fraction: number;
  crop_supported_cells: number;
  crop_area_equivalent_pixels: number;
  weighted_statistic: "AREA_WEIGHTED_EMPIRICAL_CDF_LEFT_CONTINUOUS_V1";
  /** Optional for older/manual masks; validated Dynamic World sources retain their temporal audit. */
  source_temporal_coverage?: AgricultureCropSourceTemporalCoverage;
  observations: AgricultureCropSupportObservation[];
  common_support: AgricultureCropCommonSupport;
  preview: string | null;
  source_coverage_preview: string;
}

export type AgricultureRainfallWindow = "1d" | "3d" | "7d" | "12d";

export interface AgricultureRainfallWindowValue {
  /** Sum of daily IMERG mm/day estimates over the window, in mm; null means incomplete. */
  rainfall_mm: number | null;
  valid_days: number;
  expected_days: number;
  /** Minimum AOI-overlap area fraction with usable daily retrievals across this window. */
  spatial_coverage_fraction: number;
  /** Area-weighted mean number of valid half-hourly inputs per daily grid cell. */
  mean_half_hourly_samples: number | null;
}

export interface AgricultureRainfallGranule {
  date: string;
  concept_id: string;
  filename: string;
  bytes: number;
  sha256: string;
}

export interface AgricultureRainfallObservation {
  /** SME2 acquisition calendar date; rainfall windows use complete UTC days before this date. */
  date: string;
  windows: Record<AgricultureRainfallWindow, AgricultureRainfallWindowValue>;
}

export interface AgricultureRainfallContext {
  method: "GPM_IMERG_FINAL_DAILY_AOI_MEAN_V1";
  product: "GPM_3IMERGDF_V07";
  resolution_degrees: 0.1;
  units: "mm";
  time_basis: "UTC_COMPLETE_DAYS_BEFORE_ACQUISITION";
  source: string;
  source_doi: string;
  source_sha256: string;
  source_bytes: number;
  granules: AgricultureRainfallGranule[];
  aoi_grid_cells: number;
  spatial_coverage_floor: 0.9;
  observations: AgricultureRainfallObservation[];
}

export interface AgricultureSupportDriftPoint {
  date: string;
  date_valid_median: number;
  same_pixel_median: number;
  gap_m3_m3: number;
  date_valid_fraction: number;
  same_pixel_fraction: number;
}

export interface AgricultureQualityExclusion {
  date: string;
  granule_name: string;
  reason: "NO_VALID_PIXELS_AFTER_SELECTED_ALGORITHM_QUALITY_SCREEN";
  valid_pixels: 0;
  total_pixels: number;
  retrieval_interpretation: "root-zero-clear" | "candidate-zero-clear";
}

export interface AgricultureStudy {
  schema_version: 2;
  /** Explicit algorithm provenance; absent only in older schema-v2 publications. */
  algorithm?: "BASELINE" | "DSG";
  algorithm_label?: string;
  quality_exclusions?: AgricultureQualityExclusion[];
  study_id: string;
  run_id: string;
  product: "NISAR_L3_SME2_PROVISIONAL_V1";
  product_maturity: "PROVISIONAL";
  release: string;
  track: string;
  direction: "A" | "D";
  frame: string;
  bandwidth: string;
  polarization: string;
  frequency: string;
  aoi: AgricultureAOI;
  preview_bounds: AgricultureAOI;
  date_range: { start: string; end: string };
  coverage_floor: 0.2;
  baseline_count: number;
  baseline_dates: string[];
  target_date: string;
  observations: AgricultureObservation[];
  change_preview: string;
  change_summary: AgricultureSummary;
  matched_support: AgricultureMatchedSupport;
  crop_observability?: AgricultureCropObservability;
  rainfall_context?: AgricultureRainfallContext;
  evidence_status: AgricultureStatus;
  sources: { title: string; url: string }[];
}

export interface AgricultureChecksumEntry {
  bytes: number;
  sha256: string;
}

export interface AgricultureChecksumManifest {
  schema_version: 1;
  files: Record<string, AgricultureChecksumEntry>;
}

export interface AgricultureIndex {
  schema_version: 1;
  study_url: string;
  checksums_url: string;
  published_at: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function finiteRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function isoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export function safeRelativeAssetPath(value: unknown, prefix: string): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 240) return false;
  if (value.startsWith("/") || value.includes("\\") || value.includes("?") || value.includes("#")) return false;
  if (value.split("/").some((part) => part === "" || part === "." || part === "..")) return false;
  return value.startsWith(prefix);
}

function validAOI(value: unknown): value is AgricultureAOI {
  if (!isRecord(value)) return false;
  const { west, south, east, north } = value;
  return finiteRange(west, -180, 180) && finiteRange(east, -180, 180) &&
    finiteRange(south, -90, 90) && finiteRange(north, -90, 90) &&
    west < east && south < north;
}

function validSummary(value: unknown, moisture = true): value is AgricultureSummary {
  if (!isRecord(value)) return false;
  const low = moisture ? 0.02 : -0.6;
  const high = moisture ? 0.6 : 0.6;
  return finiteRange(value.valid_fraction, 0, 1) &&
    Number.isInteger(value.valid_pixels) && Number(value.valid_pixels) >= 0 &&
    Number.isInteger(value.total_pixels) && Number(value.total_pixels) > 0 &&
    Number(value.valid_pixels) <= Number(value.total_pixels) &&
    finiteRange(value.median, low, high) &&
    finiteRange(value.p05, low, high) &&
    finiteRange(value.p95, low, high) &&
    Number(value.p05) <= Number(value.median) && Number(value.median) <= Number(value.p95) &&
    finiteRange(value.uncertainty_median, 0, 0.6) &&
    Math.abs(Number(value.valid_fraction) - Number(value.valid_pixels) / Number(value.total_pixels)) < 0.000001;
}

function validSurfaceFlagDiagnostics(value: unknown, expectedTotal: number): value is AgricultureSurfaceFlagDiagnostics {
  if (!isRecord(value) || value.method !== "NISAR_SME2_SURFACE_QUALITY_FLAG_BITS") return false;
  const flags = value.flags;
  if (!isRecord(flags)) return false;

  const fields = [
    "total_aoi_pixels", "encoded_pixels", "unflagged_pixels", "flagged_pixels",
    "fill_pixels", "invalid_pixels", "unsupported_encoding_pixels",
  ] as const;
  if (!fields.every((field) => Number.isInteger(value[field]) && Number(value[field]) >= 0)) return false;
  const total = Number(value.total_aoi_pixels);
  const encoded = Number(value.encoded_pixels);
  const unflagged = Number(value.unflagged_pixels);
  const flagged = Number(value.flagged_pixels);
  if (total !== expectedTotal || total <= 0 || unflagged + flagged !== encoded ||
      encoded + Number(value.fill_pixels) + Number(value.invalid_pixels) +
        Number(value.unsupported_encoding_pixels) !== total) return false;

  const ids: AgricultureSurfaceFlagId[] = [
    "static_water", "urban_area", "precipitation", "snow_or_ice",
    "permanent_snow_or_ice", "frozen_ground", "terrain", "dense_vegetation",
  ];
  if (!ids.every((id) => Number.isInteger(flags[id]) &&
      Number(flags[id]) >= 0 && Number(flags[id]) <= encoded)) return false;

  // Newer publications include exact, mutually exclusive bit-pattern counts.
  // Keep this optional so existing schema-v2 studies remain readable.
  if (value.flag_combinations !== undefined) {
    if (!Array.isArray(value.flag_combinations)) return false;
    const seen = new Set<number>();
    const combinedBitCounts = ids.map(() => 0);
    let totalCombinationPixels = 0;
    let previousPixels = Number.POSITIVE_INFINITY;
    let previousMask = -1;
    for (const item of value.flag_combinations) {
      if (!isRecord(item) || !Number.isInteger(item.mask) ||
          !Number.isInteger(item.pixels)) return false;
      const mask = Number(item.mask);
      const pixels = Number(item.pixels);
      if (mask < 1 || mask > 255 || pixels < 1 || pixels > flagged || seen.has(mask)) return false;
      if (pixels > previousPixels || (pixels === previousPixels && mask <= previousMask)) return false;
      seen.add(mask);
      totalCombinationPixels += pixels;
      for (let bit = 0; bit < ids.length; bit += 1) {
        if ((mask & (1 << bit)) !== 0) combinedBitCounts[bit] += pixels;
      }
      previousPixels = pixels;
      previousMask = mask;
    }
    if (totalCombinationPixels !== flagged ||
        !ids.every((id, bit) => combinedBitCounts[bit] === Number(flags[id]))) return false;
  }
  return true;
}

function validCropWeightedMoisture(value: unknown): value is AgricultureCropWeightedMoisture {
  if (!isRecord(value)) return false;
  return finiteRange(value.median, 0.02, 0.6) &&
    finiteRange(value.p05, 0.02, 0.6) &&
    finiteRange(value.p95, 0.02, 0.6) &&
    Number(value.p05) <= Number(value.median) &&
    Number(value.median) <= Number(value.p95) &&
    finiteRange(value.uncertainty_median, 0, 0.6);
}

function validCropSupportObservation(
  value: unknown,
  expectedDate: unknown,
  totalCropArea: number,
  maximumNativeCells: number,
  allowStatus: boolean,
): value is AgricultureCropSupportObservation {
  if (!isRecord(value)) return false;
  const validArea = value.valid_crop_area_equivalent_pixels;
  const totalArea = value.total_crop_area_equivalent_pixels;
  const fraction = value.valid_crop_area_fraction;
  const cells = value.valid_native_cells;
  const moisture = value.weighted_soil_moisture;
  return isoDay(value.date) && value.date === expectedDate &&
    finiteRange(validArea, 0, totalCropArea + 0.000001) &&
    finiteRange(totalArea, 0, totalCropArea + 0.000001) &&
    Math.abs(Number(totalArea) - totalCropArea) < 0.00001 &&
    finiteRange(fraction, 0, 1) &&
    Math.abs(Number(fraction) - (totalCropArea > 0 ? Number(validArea) / totalCropArea : 0)) < 0.00001 &&
    Number.isInteger(cells) && Number(cells) >= 0 && Number(cells) <= maximumNativeCells &&
    (moisture === null ? Number(validArea) === 0 : Number(validArea) > 0 && validCropWeightedMoisture(moisture)) &&
    (!allowStatus || (typeof value.status === "string" &&
      ["COMPARABLE", "INCONCLUSIVE_COVERAGE", "NO_CROP_SUPPORT", "INSUFFICIENT_MASK_COVERAGE", "NO_VALID_CROP_SUPPORT"].includes(value.status)));
}

function validCropSourceTemporalCoverage(
  value: unknown,
  expectedProbabilitySha256: string,
): value is AgricultureCropSourceTemporalCoverage {
  if (!isRecord(value) || value.dataset !== "GOOGLE/DYNAMICWORLD/V1" || value.band !== "crops") return false;
  const window = isRecord(value.requested_window) ? value.requested_window : null;
  const windowStart = window?.start;
  const windowEnd = window?.end;
  const dates = Array.isArray(value.acquisition_dates) ? value.acquisition_dates : null;
  const recency = isRecord(value.latest_scene_recency) ? value.latest_scene_recency : null;
  if (!window || !isoDay(windowStart) || !isoDay(windowEnd) || windowStart > windowEnd ||
      !dates || dates.length < 1 || !dates.every(isoDay) ||
      Number(value.unique_acquisition_dates) !== dates.length ||
      !Number.isInteger(value.unique_acquisition_dates) ||
      !Number.isInteger(value.minimum_valid_dates_per_pixel) ||
      Number(value.minimum_valid_dates_per_pixel) < 1 ||
      Number(value.minimum_valid_dates_per_pixel) > dates.length ||
      !finiteRange(value.valid_probability_fraction, Number.MIN_VALUE, 1) ||
      typeof value.sme2_series_id !== "string" || !/^[a-f0-9]{12}$/.test(value.sme2_series_id) ||
      !recency || !Number.isInteger(recency.days_from_latest_scene_to_requested_end) ||
      Number(recency.days_from_latest_scene_to_requested_end) < 0 || recency.cue_days !== 18 ||
      !["RECENT_WITHIN_18_DAY_WINDOW", "STALE_MORE_THAN_18_DAYS_BEFORE_WINDOW_END"].includes(String(recency.status)) ||
      !isSha256(value.manifest_sha256) || !isSha256(value.probability_sha256) ||
      !isSha256(value.observation_count_sha256) || !isSha256(value.validation_sha256) ||
      value.probability_sha256 !== expectedProbabilitySha256) return false;

  if (new Set(dates).size !== dates.length ||
      dates.some((item, index) => index > 0 && dates[index - 1] >= item) ||
      dates.some((item) => item < windowStart || item > windowEnd)) return false;
  const expectedMaximumGap = dates.length < 2 ? null : Math.max(
    ...dates.slice(1).map((item, index) =>
      (Date.parse(item + "T00:00:00Z") - Date.parse(dates[index] + "T00:00:00Z")) / 86_400_000),
  );
  if (value.maximum_gap_between_acquisition_dates_days !== expectedMaximumGap) return false;
  const latestGap = (Date.parse(windowEnd + "T00:00:00Z") -
    Date.parse(dates[dates.length - 1] + "T00:00:00Z")) / 86_400_000;
  const expectedRecency = latestGap <= 18
    ? "RECENT_WITHIN_18_DAY_WINDOW"
    : "STALE_MORE_THAN_18_DAYS_BEFORE_WINDOW_END";
  return recency.days_from_latest_scene_to_requested_end === latestGap &&
    recency.status === expectedRecency;
}

function validCropObservability(value: unknown, expectedDates: unknown[]): value is AgricultureCropObservability {
  if (!isRecord(value) || value.method !== "AREA_WEIGHTED_INDEPENDENT_CROP_MASK_TO_SME2_NATIVE_GRID_V1") return false;
  const common = isRecord(value.common_support) ? value.common_support : null;
  const observations = Array.isArray(value.observations) ? value.observations : null;
  const commonObservations = common && Array.isArray(common.observations) ? common.observations : null;
  const nonnegativeIntegerFields = [
    "source_bytes", "aoi_native_cells", "mask_covered_cells", "crop_supported_cells",
  ] as const;
  if (!nonnegativeIntegerFields.every((field) =>
    Number.isInteger(value[field]) && Number(value[field]) >= (field === "aoi_native_cells" ? 1 : 0)) ||
      Number(value.source_bytes) <= 0) return false;
  const aoiCells = Number(value.aoi_native_cells);
  const coveredCells = Number(value.mask_covered_cells);
  const cropCells = Number(value.crop_supported_cells);
  const totalCropArea = value.crop_area_equivalent_pixels;
  if (typeof value.source !== "string" || value.source.trim().length < 1 || value.source.length > 180 ||
      (value.source_date !== null && !isoDay(value.source_date)) ||
      typeof value.source_filename !== "string" || !value.source_filename ||
      value.source_filename.includes("/") || value.source_filename.includes("\\") ||
      !isSha256(value.source_sha256) || typeof value.source_crs !== "string" || !value.source_crs ||
      !finiteRange(value.source_cell_area_m2, Number.MIN_VALUE, Number.MAX_VALUE) ||
      !finiteRange(value.target_cell_area_m2, Number.MIN_VALUE, Number.MAX_VALUE) ||
      !finiteRange(value.probability_threshold, 0, 1) ||
      !finiteRange(value.minimum_cell_coverage, 0.5, 1) ||
      coveredCells > aoiCells || cropCells > coveredCells ||
      !finiteRange(value.mask_coverage_fraction, 0, 1) ||
      Math.abs(Number(value.mask_coverage_fraction) - coveredCells / aoiCells) >= 0.00001 ||
      !finiteRange(value.mean_source_data_coverage_fraction, 0, 1) ||
      !finiteRange(totalCropArea, 0, coveredCells + 0.00001) ||
      value.weighted_statistic !== "AREA_WEIGHTED_EMPIRICAL_CDF_LEFT_CONTINUOUS_V1" ||
      !observations || observations.length !== expectedDates.length ||
      !observations.every((item, index) =>
        validCropSupportObservation(item, expectedDates[index], Number(totalCropArea), cropCells, true)) ||
      !common || common.method !== "ALL_DATE_VALID_CROP_AREA_INTERSECTION" ||
      !["COMPARABLE", "INCONCLUSIVE_COVERAGE", "NO_COMMON_CROP_SUPPORT", "NO_CROP_SUPPORT", "INSUFFICIENT_MASK_COVERAGE"].includes(String(common.status)) ||
      !finiteRange(common.valid_crop_area_equivalent_pixels, 0, Number(totalCropArea) + 0.000001) ||
      !finiteRange(common.total_crop_area_equivalent_pixels, 0, Number(totalCropArea) + 0.000001) ||
      Math.abs(Number(common.total_crop_area_equivalent_pixels) - Number(totalCropArea)) >= 0.00001 ||
      !finiteRange(common.valid_crop_area_fraction, 0, 1) ||
      Math.abs(Number(common.valid_crop_area_fraction) -
        (Number(totalCropArea) > 0 ? Number(common.valid_crop_area_equivalent_pixels) / Number(totalCropArea) : 0)) >= 0.00001 ||
      !Number.isInteger(common.valid_native_cells) || Number(common.valid_native_cells) < 0 ||
      Number(common.valid_native_cells) > cropCells ||
      !commonObservations ||
      (common.preview !== null && !safeRelativeAssetPath(common.preview, "previews/")) ||
      (value.preview !== null && !safeRelativeAssetPath(value.preview, "previews/")) ||
      !safeRelativeAssetPath(value.source_coverage_preview, "previews/") ||
      (value.source_temporal_coverage !== undefined &&
        !validCropSourceTemporalCoverage(value.source_temporal_coverage, String(value.source_sha256)))) return false;

  const commonArea = Number(common.valid_crop_area_equivalent_pixels);
  const expectedStatus = Number(value.mask_coverage_fraction) < 0.2 ? "INSUFFICIENT_MASK_COVERAGE" :
    Number(totalCropArea) <= 0 ? "NO_CROP_SUPPORT" :
    commonArea <= 0 ? "NO_COMMON_CROP_SUPPORT" :
    Number(common.valid_crop_area_fraction) < 0.2 ? "INCONCLUSIVE_COVERAGE" : "COMPARABLE";
  if (common.status !== expectedStatus) return false;
  if (commonArea <= 0) {
    if (commonObservations.length !== 0 || common.preview !== null) return false;
  } else {
    if (commonObservations.length !== expectedDates.length || common.preview === null ||
        !commonObservations.every((item, index) =>
          validCropSupportObservation(item, expectedDates[index], Number(totalCropArea), cropCells, false) &&
          Math.abs(item.valid_crop_area_equivalent_pixels - commonArea) < 0.00001)) return false;
  }

  for (let index = 0; index < observations.length; index += 1) {
    const item = observations[index];
    if (!validCropSupportObservation(item, expectedDates[index], Number(totalCropArea), cropCells, true)) return false;
    const expectedStatus = Number(value.mask_coverage_fraction) < 0.2 ? "INSUFFICIENT_MASK_COVERAGE" :
      Number(totalCropArea) <= 0 ? "NO_CROP_SUPPORT" :
      item.valid_crop_area_equivalent_pixels <= 0 ? "NO_VALID_CROP_SUPPORT" :
      item.valid_crop_area_fraction < 0.2 ? "INCONCLUSIVE_COVERAGE" : "COMPARABLE";
    if (item.status !== expectedStatus) return false;
  }
  if (Number(totalCropArea) <= 0 && value.preview !== null) return false;
  if (Number(totalCropArea) > 0 && value.preview === null) return false;
  return true;
}

function validQualityExclusions(
  value: unknown,
  algorithm: "BASELINE" | "DSG",
  observations: AgricultureObservation[],
  dateRange: { start: string; end: string },
): value is AgricultureQualityExclusion[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  const seenGranules = new Set<string>();
  const observedDates = new Set(observations.map((item) => item.date));
  const expectedTotalPixels = observations[0]?.total_pixels;
  let previous = "";
  return value.every((item) => {
    if (!isRecord(item) || !isoDay(item.date) || typeof item.granule_name !== "string" ||
        !/^NISAR_L3_PR_SME2_.*\.h5$/i.test(item.granule_name) ||
        item.reason !== "NO_VALID_PIXELS_AFTER_SELECTED_ALGORITHM_QUALITY_SCREEN" ||
        item.valid_pixels !== 0 || !Number.isInteger(item.total_pixels) ||
        Number(item.total_pixels) <= 0 || Number(item.total_pixels) !== expectedTotalPixels ||
        seen.has(item.date) || seenGranules.has(item.granule_name) || observedDates.has(item.date) ||
        item.date < dateRange.start || item.date > dateRange.end ||
        (algorithm === "DSG" && item.retrieval_interpretation !== "candidate-zero-clear") ||
        (algorithm === "BASELINE" && item.retrieval_interpretation !== "root-zero-clear") ||
        item.date <= previous) return false;
    seen.add(item.date);
    seenGranules.add(item.granule_name);
    previous = item.date;
    return true;
  });
}

function validObservation(value: unknown): value is AgricultureObservation {
  if (!isRecord(value)) return false;
  return (value.surface_flag_diagnostics === undefined ||
      validSurfaceFlagDiagnostics(value.surface_flag_diagnostics, Number(value.total_pixels))) &&
    isoDay(value.date) && safeRelativeAssetPath(value.preview, "previews/") &&
    typeof value.release === "string" && /^P\d{5}$/.test(value.release) &&
    Number(value.release.slice(1)) >= 5023 &&
    typeof value.track === "string" && value.track.length > 0 &&
    (value.direction === "A" || value.direction === "D") &&
    typeof value.frame === "string" && typeof value.bandwidth === "string" &&
    typeof value.polarization === "string" && typeof value.frequency === "string" &&
    (value.source_sha256 === undefined || isSha256(value.source_sha256)) &&
    (value.source_bytes === undefined || (Number.isInteger(value.source_bytes) && Number(value.source_bytes) > 0)) &&
    (value.granule_name === undefined || (typeof value.granule_name === "string" && value.granule_name.length > 0)) &&
    validSummary(value);
}

function validMatchedObservation(value: unknown): value is AgricultureMatchedObservation {
  if (!isRecord(value)) return false;
  return isoDay(value.date) && safeRelativeAssetPath(value.preview, "previews/") && validSummary(value);
}

function validRainfallContext(value: unknown, expectedDates: string[]): value is AgricultureRainfallContext {
  if (!isRecord(value) || value.method !== "GPM_IMERG_FINAL_DAILY_AOI_MEAN_V1" ||
      value.product !== "GPM_3IMERGDF_V07" || value.resolution_degrees !== 0.1 ||
      value.units !== "mm" || value.time_basis !== "UTC_COMPLETE_DAYS_BEFORE_ACQUISITION" ||
      typeof value.source !== "string" || value.source.length < 1 || value.source.length > 240 ||
      value.source_doi !== "10.5067/GPM/IMERGDF/DAY/07" || !isSha256(value.source_sha256) ||
      !Number.isInteger(value.source_bytes) || Number(value.source_bytes) <= 0 ||
      value.spatial_coverage_floor !== 0.9 ||
      !Number.isInteger(value.aoi_grid_cells) || Number(value.aoi_grid_cells) < 1 ||
      !Array.isArray(value.granules) || value.granules.length < 1 ||
      !value.granules.every((item) => isRecord(item) && isoDay(item.date) &&
        typeof item.concept_id === "string" && item.concept_id.length > 0 &&
        typeof item.filename === "string" && !item.filename.includes("/") &&
        !item.filename.includes(String.fromCharCode(92)) && /\.(nc4?|hdf5?)$/i.test(item.filename) &&
        Number.isInteger(item.bytes) && Number(item.bytes) > 0 && isSha256(item.sha256)) ||
      new Set(value.granules.map((item: Record<string, unknown>) => item.date)).size !== value.granules.length ||
      Number(value.source_bytes) !== value.granules.reduce((sum: number, item: Record<string, unknown>) => sum + Number(item.bytes), 0) ||
      !Array.isArray(value.observations) || value.observations.length !== expectedDates.length) return false;
  const requiredGranuleDates = new Set<string>();
  for (const acquisitionDate of expectedDates) {
    const acquisitionTimestamp = Date.parse(acquisitionDate + "T00:00:00Z");
    for (let offset = 1; offset <= 12; offset += 1) {
      requiredGranuleDates.add(new Date(acquisitionTimestamp - offset * 86_400_000).toISOString().slice(0, 10));
    }
  }
  if (!value.granules.every((item: Record<string, unknown>) =>
    typeof item.date === "string" && requiredGranuleDates.has(item.date))) return false;
  const windows: AgricultureRainfallWindow[] = ["1d", "3d", "7d", "12d"];
  return value.observations.every((item, index) => {
    if (!isRecord(item) || item.date !== expectedDates[index] || !isRecord(item.windows)) return false;
    const rainfallWindows = item.windows;
    return windows.every((window) => {
      const entry = rainfallWindows[window];
      const expected = Number(window.slice(0, -1));
      if (!isRecord(entry) || entry.expected_days !== expected ||
          !Number.isInteger(entry.valid_days) || Number(entry.valid_days) < 0 ||
          Number(entry.valid_days) > expected ||
          !finiteRange(entry.spatial_coverage_fraction, 0, 1) ||
          (entry.mean_half_hourly_samples !== null &&
            !finiteRange(entry.mean_half_hourly_samples, 1, 48))) return false;
      if (entry.valid_days !== expected) return entry.rainfall_mm === null &&
        entry.mean_half_hourly_samples === null;
      return finiteRange(entry.rainfall_mm, 0, 120000) &&
        entry.spatial_coverage_fraction >= Number(value.spatial_coverage_floor) &&
        entry.mean_half_hourly_samples !== null;
    });
  });
}

export function isAgricultureStudy(value: unknown): value is AgricultureStudy {
  if (!isRecord(value)) return false;
  const observations = Array.isArray(value.observations) ? value.observations : null;
  const lastObservation = observations?.[observations.length - 1];
  const matchedSupport = isRecord(value.matched_support) ? value.matched_support : null;
  const matchedObservations = matchedSupport && Array.isArray(matchedSupport.observations)
    ? matchedSupport.observations : null;
  if (value.schema_version !== 2 ||
      typeof value.study_id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.study_id) ||
      typeof value.run_id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(value.run_id) ||
      value.product !== "NISAR_L3_SME2_PROVISIONAL_V1" || value.product_maturity !== "PROVISIONAL" ||
      (value.algorithm !== undefined && value.algorithm !== "BASELINE" && value.algorithm !== "DSG") ||
      (value.algorithm_label !== undefined && typeof value.algorithm_label !== "string") ||
      typeof value.release !== "string" || !/^P\d{5}$/.test(value.release) ||
      Number(value.release.slice(1)) < 5023 ||
      typeof value.track !== "string" || !value.track ||
      (value.direction !== "A" && value.direction !== "D") ||
      typeof value.frame !== "string" || typeof value.bandwidth !== "string" ||
      typeof value.polarization !== "string" || typeof value.frequency !== "string" ||
      !validAOI(value.aoi) || !validAOI(value.preview_bounds) || !isRecord(value.date_range) ||
      !isoDay(value.date_range.start) || !isoDay(value.date_range.end) ||
      value.date_range.start > value.date_range.end || value.coverage_floor !== 0.2 ||
      !Number.isInteger(value.baseline_count) || Number(value.baseline_count) < 3 ||
      !Array.isArray(value.baseline_dates) || !value.baseline_dates.every(isoDay) ||
      !observations || observations.length < Number(value.baseline_count) + 1 ||
      !observations.every(validObservation) || !isRecord(lastObservation) || !isoDay(lastObservation.date) ||
      !isoDay(value.target_date) || value.target_date !== lastObservation.date ||
      Number(value.baseline_count) !== value.baseline_dates.length ||
      !validSummary(value.change_summary, false) ||
      !safeRelativeAssetPath(value.change_preview, "previews/") ||
      !matchedSupport ||
      matchedSupport.method !== "ALL_DATE_VALID_PIXEL_INTERSECTION" ||
      !["COMPARABLE", "INCONCLUSIVE_COVERAGE", "NO_COMMON_PIXELS"].includes(String(matchedSupport.status)) ||
      !finiteRange(matchedSupport.valid_fraction, 0, 1) ||
      !Number.isInteger(matchedSupport.valid_pixels) || Number(matchedSupport.valid_pixels) < 0 ||
      !Number.isInteger(matchedSupport.total_pixels) || Number(matchedSupport.total_pixels) <= 0 ||
      Number(matchedSupport.valid_pixels) > Number(matchedSupport.total_pixels) ||
      Math.abs(Number(matchedSupport.valid_fraction) - Number(matchedSupport.valid_pixels) / Number(matchedSupport.total_pixels)) >= 0.000001 ||
      !matchedObservations ||
      !matchedObservations.every(validMatchedObservation) ||
      !Array.isArray(value.sources) || !value.sources.every((item) => isRecord(item) &&
        typeof item.title === "string" && typeof item.url === "string" && item.url.startsWith("https://"))) return false;

  const study = value as unknown as AgricultureStudy;
  const dates = study.observations.map((item) => item.date);
  const algorithm = study.algorithm ?? "BASELINE";
  const expectedAlgorithmLabel = algorithm === "DSG" ? "DSG algorithm candidate" : "Root baseline product";
  if ((study.algorithm_label !== undefined && study.algorithm_label !== expectedAlgorithmLabel) ||
      (algorithm === "DSG" && (
        study.algorithm_label !== expectedAlgorithmLabel ||
        study.quality_exclusions === undefined ||
        !validQualityExclusions(study.quality_exclusions, algorithm, study.observations, study.date_range)
      )) ||
      (study.quality_exclusions !== undefined &&
        !validQualityExclusions(study.quality_exclusions, algorithm, study.observations, study.date_range))) return false;
  if (study.crop_observability !== undefined &&
      !validCropObservability(study.crop_observability, dates)) return false;
  if (study.rainfall_context !== undefined &&
      !validRainfallContext(study.rainfall_context, dates)) return false;
  const matched = study.matched_support;
  const matchedStatus = matched.valid_pixels === 0 ? "NO_COMMON_PIXELS" :
    matched.valid_fraction < study.coverage_floor ? "INCONCLUSIVE_COVERAGE" : "COMPARABLE";
  if (matched.status !== matchedStatus) return false;
  if (matched.valid_pixels === 0) {
    if (matched.observations.length !== 0) return false;
  } else {
    if (matched.observations.length !== study.observations.length) return false;
    if (!matched.observations.every((item, index) =>
      item.date === study.observations[index].date &&
      item.valid_pixels === matched.valid_pixels &&
      item.total_pixels === matched.total_pixels &&
      Math.abs(item.valid_fraction - matched.valid_fraction) < 0.000001
    )) return false;
  }
  if (new Set(dates).size !== dates.length || dates.some((date, index) => index > 0 && dates[index - 1] >= date)) return false;
  if (JSON.stringify(dates.slice(0, study.baseline_count)) !== JSON.stringify(study.baseline_dates)) return false;
  if (study.observations.some((item) => item.release !== study.release ||
      item.track !== study.track || item.direction !== study.direction ||
      item.frame !== study.frame || item.bandwidth !== study.bandwidth ||
      item.polarization !== study.polarization || item.frequency !== study.frequency)) return false;

  const target = study.observations[study.observations.length - 1];
  const expectedStatus = target.valid_fraction < study.coverage_floor ||
    study.change_summary.valid_fraction < study.coverage_floor ? "INCONCLUSIVE_COVERAGE" : "EXPLORATORY";
  return study.evidence_status === expectedStatus;
}

/**
 * Place acquisition dates on a true elapsed-time axis.
 *
 * position is a 0..100 percentage over the first-to-last acquisition span;
 * gap_days is the elapsed calendar-day interval from the preceding acquisition.
 * Invalid, duplicate or out-of-order dates fail closed.
 */
export interface AgricultureDateAxisPoint {
  date: string;
  position: number;
  gap_days: number | null;
}

export function buildAgricultureDateAxis(dates: string[]): AgricultureDateAxisPoint[] {
  if (!Array.isArray(dates) || dates.length === 0) return [];
  const timestamps = dates.map((date) =>
    isoDay(date) ? Date.parse(date + "T00:00:00Z") : Number.NaN,
  );
  if (timestamps.some((value) => !Number.isFinite(value)) ||
      timestamps.some((value, index) => index > 0 && value <= timestamps[index - 1])) return [];

  const start = timestamps[0];
  const duration = timestamps[timestamps.length - 1] - start;
  return dates.map((date, index) => ({
    date,
    position: duration === 0 ? 50 : ((timestamps[index] - start) / duration) * 100,
    gap_days: index === 0 ? null : (timestamps[index] - timestamps[index - 1]) / 86_400_000,
  }));
}

/**
 * Build a date-by-date spatial-support audit.
 *
 * A positive gap means the median over that date's valid footprint is higher
 * than the median over the fixed all-date cohort. The gap is a comparison of
 * two spatial samples, not a third sensor measurement or a moisture-change
 * estimate. Return no profile when the fixed cohort is unavailable or the
 * date alignment is inconsistent.
 */
export function buildAgricultureSupportDrift(study: AgricultureStudy): AgricultureSupportDriftPoint[] {
  const matched = study.matched_support;
  if (matched.valid_pixels <= 0 || matched.observations.length !== study.observations.length) return [];

  const aligned = study.observations.every((observation, index) => {
    const cohortObservation = matched.observations[index];
    return cohortObservation?.date === observation.date &&
      observation.total_pixels === matched.total_pixels &&
      cohortObservation.total_pixels === matched.total_pixels &&
      cohortObservation.valid_pixels === matched.valid_pixels;
  });
  if (!aligned) return [];

  return study.observations.map((observation, index) => {
    const cohortObservation = matched.observations[index];
    return {
      date: observation.date,
      date_valid_median: observation.median,
      same_pixel_median: cohortObservation.median,
      gap_m3_m3: observation.median - cohortObservation.median,
      date_valid_fraction: observation.valid_fraction,
      same_pixel_fraction: cohortObservation.valid_fraction,
    };
  });
}

export interface AgricultureRainfallPlotPoint {
  date: string;
  position: number;
  rainfall_mm: number | null;
  valid_days: number;
  expected_days: number;
  spatial_coverage_fraction: number;
  mean_half_hourly_samples: number | null;
}

/** Align only complete, date-matched daily IMERG windows to the real SME2 elapsed-time axis. */
export function buildAgricultureRainfallSeries(
  study: AgricultureStudy,
  window: AgricultureRainfallWindow,
): AgricultureRainfallPlotPoint[] {
  const context = study.rainfall_context;
  if (!context || context.observations.length !== study.observations.length) return [];
  const axis = buildAgricultureDateAxis(study.observations.map((item) => item.date));
  if (axis.length !== context.observations.length) return [];
  return axis.map((point, index) => {
    const rainfall = context.observations[index];
    if (rainfall.date !== point.date) return null;
    const sample = rainfall.windows[window];
    return {
      date: point.date,
      position: point.position,
      rainfall_mm: sample.valid_days === sample.expected_days ? sample.rainfall_mm : null,
      valid_days: sample.valid_days,
      expected_days: sample.expected_days,
      spatial_coverage_fraction: sample.spatial_coverage_fraction,
      mean_half_hourly_samples: sample.mean_half_hourly_samples,
    };
  }).filter((point): point is AgricultureRainfallPlotPoint => point !== null);
}

export function isAgricultureIndex(value: unknown): value is AgricultureIndex {
  if (!isRecord(value) || value.schema_version !== 1 ||
      !safeRelativeAssetPath(value.study_url, "current/") ||
      !safeRelativeAssetPath(value.checksums_url, "current/") ||
      typeof value.published_at !== "string" || !Number.isFinite(Date.parse(value.published_at))) {
    return false;
  }
  // Accept the original flat publication for backwards compatibility, while
  // preferring immutable, run-scoped directories for all newly published studies.
  if (value.study_url === "current/study.json" &&
      value.checksums_url === "current/web-checksums.json") return true;
  const release = /^current\/releases\/([a-z0-9][a-z0-9-]{0,39})\/study\.json$/.exec(value.study_url);
  return release !== null &&
    value.checksums_url === "current/releases/" + release[1] + "/web-checksums.json";
}

export function isAgricultureChecksumManifest(value: unknown): value is AgricultureChecksumManifest {
  if (!isRecord(value) || value.schema_version !== 1 || !isRecord(value.files)) return false;
  const entries = Object.entries(value.files);
  if (!entries.some(([path]) => path === "study.json")) return false;
  return entries.every(([path, item]) => {
    if (!/^(study\.json|previews\/[a-z0-9][a-z0-9._-]*\.png)$/.test(path) || !isRecord(item)) return false;
    return Number.isInteger(item.bytes) && Number(item.bytes) > 0 && isSha256(item.sha256);
  });
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

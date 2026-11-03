import type { AgricultureStudy } from "./agriculture-study";
import type { ForestFrame, ForestStudy } from "./forest-study";
import type { VolcanoPair, VolcanoStudy } from "./volcano-study";

export type EvidenceModule = "wetland" | "agriculture" | "forest" | "volcano";
export type EvidenceModality = "GCOV_BACKSCATTER" | "SME2_SOIL_MOISTURE" | "GUNW_PHASE";
export type EvidenceChainState = "NOT_PUBLISHED" | "EXPLORATORY" | "INCONCLUSIVE";
export type EvidenceReferenceState =
  | "NOT_RECORDED"
  | "NOT_ASSESSED"
  | "INCONCLUSIVE"
  | "ASSESSED_COMPARISON"
  | "EXPLORATORY_SUPPORT"
  | "WEAK_AGREEMENT"
  | "CONTEXT_ONLY"
  | "CROSS_SENSOR_CONTEXT";
export type EvidenceReferenceRole =
  | "independent_observation"
  | "cross_sensor_context"
  | "event_context"
  | "historical_context";

export interface EvidenceObservation {
  sensor: string;
  product: string;
  start_date: string | null;
  end_date: string | null;
  maturity: string | null;
  release: string | null;
  polarization: string | null;
  track: string | null;
  frame: string | null;
  direction: string | null;
  wavelength_m: number | null;
  source_id: string | null;
}

export interface EvidenceSignal {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  interpretation: string;
}

export interface EvidenceReference {
  id: string;
  role: EvidenceReferenceRole;
  source: string;
  source_url: string | null;
  raw_status: string | null;
  status: EvidenceReferenceState;
  observation_dates: string[];
  temporal_offsets_days: number[];
  common_coverage_fraction: number | null;
  candidate_assessed_fraction: number | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  summary: string;
  limitations: string[];
}

export interface EvidenceChain {
  schema_version: 1;
  module: EvidenceModule;
  study_id: string | null;
  study_title: string;
  site_name: string;
  modality: EvidenceModality;
  product: string;
  product_maturity: string | null;
  state: EvidenceChainState;
  conclusion: string;
  observations: EvidenceObservation[];
  method: {
    id: string | null;
    summary: string;
    screening_rules: string[];
    minimum_coverage_fraction: number | null;
  };
  measurements: EvidenceSignal[];
  references: EvidenceReference[];
  provenance: {
    run_id: string | null;
    publication_version: string | null;
    boundary_source: string | null;
    source_urls: string[];
    artifacts: string[];
  };
  uncertainty_and_limits: string[];
}

const notRecordedReference = (
  id: string,
  source: string,
  summary: string,
  role: EvidenceReferenceRole = "independent_observation",
): EvidenceReference => ({
  id,
  role,
  source,
  source_url: null,
  raw_status: null,
  status: "NOT_RECORDED",
  observation_dates: [],
  temporal_offsets_days: [],
  common_coverage_fraction: null,
  candidate_assessed_fraction: null,
  precision: null,
  recall: null,
  f1: null,
  summary,
  limitations: [],
});

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentOrNull(value: number | null | undefined): number | null {
  const number = finiteOrNull(value);
  return number === null ? null : Math.min(1, Math.max(0, number));
}

function sourceUrls(values: Record<string, string> | undefined): string[] {
  if (!values) return [];
  return Object.values(values).filter((value) => /^https?:\/\//i.test(value));
}

export interface WetlandEvidenceInput {
  run_id: string;
  site_name?: string;
  data_source: string;
  product: string | null;
  product_maturity: string | null;
  baseline_date: string | null;
  baseline_observation_dates?: string[] | null;
  selected_date: string | null;
  polarizations: string[];
  dates: string[];
  reference_check_status: string;
  reference_validation?: {
    status?: string;
    reason?: string | null;
    reference_product?: string;
    source_url?: string;
    comparison?: {
      baseline?: { nisar_date?: string; hls_date?: string; offset_days?: number };
      event?: { nisar_date?: string; hls_date?: string; offset_days?: number };
    };
    coverage?: { common_clear_fraction?: number };
    metrics?: { precision?: number | null; recall?: number | null; f1?: number | null };
    optical_support?: {
      common_clear_fraction?: number;
      candidate_assessed_fraction?: number | null;
      precision?: number | null;
      recall?: number | null;
      f1?: number | null;
      support?: string;
    };
    limitations?: string[];
  } | null;
  case_study?: {
    title?: string;
    site?: string;
    baseline_date?: string;
    event_date?: string;
    candidate_patches?: number;
    candidate_area_km2?: number;
    method?: {
      open_water_rule?: string;
      vegetated_inundation_rule?: string;
      threshold_db?: number;
      minimum_region_pixels?: number;
      minimum_valid_fraction?: number;
      validity_rule?: string;
      baseline_method?: { baseline_method?: string };
    };
    uncertainty?: {
      threshold_sensitivity?: { sensitivity_note?: string };
      interpretation?: string;
    };
    impact_context?: string;
    spatial_scope?: string;
  } | null;
}

function wetlandReference(input: WetlandEvidenceInput): EvidenceReference {
  const reference = input.reference_validation;
  if (!reference) {
    return {
      ...notRecordedReference(
        "wetland-independent-reference",
        "Independent optical reference",
        "No independent reference assessment is recorded for the selected run.",
      ),
      raw_status: input.reference_check_status || null,
      status: input.reference_check_status ? "NOT_ASSESSED" : "NOT_RECORDED",
    };
  }

  const commonCoverage = percentOrNull(
    reference.optical_support?.common_clear_fraction ?? reference.coverage?.common_clear_fraction,
  );
  const candidateCoverage = percentOrNull(reference.optical_support?.candidate_assessed_fraction);
  const rawStatus = reference.status ?? input.reference_check_status ?? null;
  const status: EvidenceReferenceState = /INCONCLUSIVE/i.test(rawStatus ?? "")
    ? "INCONCLUSIVE"
    : commonCoverage !== null && commonCoverage < 0.2
      ? "INCONCLUSIVE"
      : reference.metrics?.f1 != null || reference.optical_support?.f1 != null
        ? "ASSESSED_COMPARISON"
        : "NOT_ASSESSED";
  const dates = [
    reference.comparison?.baseline?.hls_date,
    reference.comparison?.event?.hls_date,
  ].filter((value): value is string => Boolean(value));
  const offsets = [
    reference.comparison?.baseline?.offset_days,
    reference.comparison?.event?.offset_days,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    id: "wetland-optical-reference",
    role: "independent_observation",
    source: reference.reference_product ?? "NASA HLS optical comparison",
    source_url: reference.source_url ?? null,
    raw_status: rawStatus,
    status,
    observation_dates: dates,
    temporal_offsets_days: offsets,
    common_coverage_fraction: commonCoverage,
    candidate_assessed_fraction: candidateCoverage,
    precision: finiteOrNull(reference.optical_support?.precision ?? reference.metrics?.precision),
    recall: finiteOrNull(reference.optical_support?.recall ?? reference.metrics?.recall),
    f1: finiteOrNull(reference.optical_support?.f1 ?? reference.metrics?.f1),
    summary: reference.reason ?? reference.optical_support?.support ??
      "Cross-sensor comparison is available; interpret it with its date offsets and assessed coverage.",
    limitations: [...(reference.limitations ?? [])],
  };
}

export function buildWetlandEvidenceChain(input: WetlandEvidenceInput): EvidenceChain {
  const study = input.case_study;
  const reference = wetlandReference(input);
  const rules = [
    study?.method?.open_water_rule,
    study?.method?.vegetated_inundation_rule,
    study?.method?.validity_rule,
  ].filter((value): value is string => Boolean(value));
  if (study?.method?.threshold_db !== undefined) {
    rules.push("Backscatter threshold: " + study.method.threshold_db + " dB.");
  }
  const noStudy = input.data_source !== "NISAR";
  return {
    schema_version: 1,
    module: "wetland",
    study_id: input.run_id || null,
    study_title: study?.title ?? "Wetland radar-change investigation",
    site_name: study?.site ?? input.site_name ?? "Site not recorded",
    modality: "GCOV_BACKSCATTER",
    product: input.product ?? "NISAR GCOV product not recorded",
    product_maturity: input.product_maturity,
    state: noStudy ? "NOT_PUBLISHED" : reference.status === "INCONCLUSIVE" ? "INCONCLUSIVE" : "EXPLORATORY",
    conclusion: study
      ? "The wetland detector reports radar-change candidates. Candidate areas require date-aware independent interpretation; they are not automatically confirmed flood boundaries."
      : "No case-study result is attached to this selected run. Do not infer no change from missing results.",
    observations: input.dates.map((date) => ({
      sensor: "NISAR",
      product: input.product ?? "GCOV",
      start_date: date,
      end_date: date,
      maturity: input.product_maturity,
      release: null,
      polarization: input.polarizations.join(", ") || null,
      track: null,
      frame: null,
      direction: null,
      wavelength_m: null,
      source_id: null,
    })),
    method: {
      id: study?.method?.baseline_method?.baseline_method ?? null,
      summary: "GCOV backscatter screening over a selected baseline and observation date.",
      screening_rules: rules,
      minimum_coverage_fraction: finiteOrNull(study?.method?.minimum_valid_fraction),
    },
    measurements: [
      {
        id: "candidate-area",
        label: "Radar-change candidate area",
        value: finiteOrNull(study?.candidate_area_km2),
        unit: "km²",
        interpretation: "Detector output area; not a confirmed inundation area.",
      },
      {
        id: "candidate-count",
        label: "Candidate regions",
        value: finiteOrNull(study?.candidate_patches),
        unit: "regions",
        interpretation: "Count of radar-screened regions in the case-study package.",
      },
      {
        id: "reference-clear-coverage",
        label: "Common-clear optical coverage",
        value: reference.common_coverage_fraction,
        unit: "fraction",
        interpretation: "Fraction of study area available for comparison; the remainder is unassessed.",
      },
    ],
    references: [reference],
    provenance: {
      run_id: input.run_id || null,
      publication_version: null,
      boundary_source: study?.spatial_scope ?? null,
      source_urls: reference.source_url ? [reference.source_url] : [],
      artifacts: [],
    },
    uncertainty_and_limits: [
      ...(study?.uncertainty?.threshold_sensitivity?.sensitivity_note ? [study.uncertainty.threshold_sensitivity.sensitivity_note] : []),
      ...(study?.uncertainty?.interpretation ? [study.uncertainty.interpretation] : []),
      ...(study?.impact_context ? [study.impact_context] : []),
      "Optical coverage and temporal offsets must be considered before interpreting candidate agreement.",
    ],
  };
}

export function buildAgricultureEvidenceChain(study: AgricultureStudy | null): EvidenceChain {
  if (!study) {
    return {
      schema_version: 1,
      module: "agriculture",
      study_id: null,
      study_title: "Agriculture soil-moisture feasibility",
      site_name: "No published study",
      modality: "SME2_SOIL_MOISTURE",
      product: "NISAR L3 SME2",
      product_maturity: "PROVISIONAL",
      state: "NOT_PUBLISHED",
      conclusion: "No genuine SME2 study is published. The workspace is an operator-ready feasibility tool, not a live crop-condition service.",
      observations: [],
      method: { id: null, summary: "No published analysis is available.", screening_rules: [], minimum_coverage_fraction: 0.2 },
      measurements: [],
      references: [notRecordedReference(
        "agriculture-field-reference",
        "Independent field or crop-condition reference",
        "No independent crop/soil reference is recorded because no Agriculture study has been published.",
      )],
      provenance: { run_id: null, publication_version: null, boundary_source: null, source_urls: [], artifacts: [] },
      uncertainty_and_limits: [
        "Do not infer crop stress, drought, yield loss, or crop health from the absence of a published result.",
        "SME2 PROVISIONAL data are not a fully calibrated agricultural decision product.",
      ],
    };
  }

  const target = study.observations[study.observations.length - 1] ?? null;
  const state = study.evidence_status === "INCONCLUSIVE_COVERAGE" ? "INCONCLUSIVE" : "EXPLORATORY";
  return {
    schema_version: 1,
    module: "agriculture",
    study_id: study.study_id,
    study_title: "SME2 soil-moisture feasibility",
    site_name: "Analyst-defined WGS84 AOI",
    modality: "SME2_SOIL_MOISTURE",
    product: study.product,
    product_maturity: study.product_maturity,
    state,
    conclusion: "Measured NISAR SME2 soil-moisture estimates and a latest-minus-baseline difference are shown. They are not crop-stress, drought, yield, or crop-health classifications.",
    observations: study.observations.map((item) => ({
      sensor: "NISAR",
      product: study.product,
      start_date: item.date,
      end_date: item.date,
      maturity: study.product_maturity,
      release: item.release,
      polarization: item.polarization,
      track: item.track,
      frame: item.frame,
      direction: item.direction,
      wavelength_m: null,
      source_id: item.granule_name ?? null,
    })),
    method: {
      id: "nisar-sme2-quality-screen",
      summary: "Native-grid SME2 time series. The baseline is the first three unique dates; the target is the latest date. No resampling is performed.",
      screening_rules: [
        "Soil moisture must be finite and within 0.02–0.60 m³/m³.",
        "Uncertainty must be finite and non-negative.",
        "NASA/JPL D-107677 Rev C defines retrievalQualityFlag = 0 as clear and non-zero as anomaly for both root and algorithm-candidate SME2 layers.",
        "surfaceQualityFlag must equal zero; this conservative rule can exclude dense vegetation over crop areas.",
        "All observations must share the same release and native grid.",
      ],
      minimum_coverage_fraction: study.coverage_floor,
    },
    measurements: [
      {
        id: "target-soil-moisture-median",
        label: "Target-date median soil moisture",
        value: finiteOrNull(target?.median),
        unit: "m³/m³",
        interpretation: "Product-reported soil-moisture estimate for the latest observation.",
      },
      {
        id: "target-valid-coverage",
        label: "Target-date valid coverage",
        value: percentOrNull(target?.valid_fraction),
        unit: "fraction",
        interpretation: "Valid target pixels divided by all pixels in the analyst-defined AOI.",
      },
      {
        id: "change-soil-moisture-median",
        label: "Latest minus baseline median",
        value: finiteOrNull(study.change_summary.median),
        unit: "m³/m³",
        interpretation: "Measured soil-moisture-variable difference, not a crop-health classification.",
      },
      {
        id: "change-valid-coverage",
        label: "Change valid coverage",
        value: percentOrNull(study.change_summary.valid_fraction),
        unit: "fraction",
        interpretation: "Pixels valid for the target and baseline comparison divided by all AOI pixels.",
      },
      {
        id: "target-uncertainty-median",
        label: "Target-date median uncertainty",
        value: finiteOrNull(target?.uncertainty_median),
        unit: "m³/m³",
        interpretation: "Product-reported target-date uncertainty; it is not propagated into the difference estimate.",
      },
    ],
    references: [notRecordedReference(
      "agriculture-field-reference",
      "Independent field or crop-condition reference",
      "The published SME2 schema does not record a matched field soil-moisture dataset or labelled crop-condition reference. Reference negatives and accuracy metrics are therefore unavailable.",
    )],
    provenance: {
      run_id: study.run_id,
      publication_version: null,
      boundary_source: `WGS84 bounds [${study.aoi.west}, ${study.aoi.south}, ${study.aoi.east}, ${study.aoi.north}]`,
      source_urls: study.sources.map((source) => source.url),
      artifacts: study.observations.map((item) => item.preview).concat(study.change_preview),
    },
    uncertainty_and_limits: [
      "SME2 is PROVISIONAL, not a fully calibrated agricultural decision product.",
      "The change-summary uncertainty field reports target-date uncertainty; it is not propagated uncertainty for the target-minus-baseline difference.",
      "The surface-quality screen can reduce coverage in dense crop vegetation; excluded pixels remain unassessed.",
      "No independently labelled crop/soil reference is available for precision, recall, or F1.",
    ],
  };
}

function forestReference(frame: ForestFrame): EvidenceReference {
  const reference = frame.reference;
  const commonCoverage = percentOrNull(reference.common_clear_fraction);
  let status: EvidenceReferenceState = "NOT_ASSESSED";
  if (/INCONCLUSIVE/i.test(reference.status)) status = "INCONCLUSIVE";
  else if (commonCoverage !== null && commonCoverage < 0.2) status = "INCONCLUSIVE";
  else if (finiteOrNull(reference.candidate_supported_area_km2) !== null &&
    Number(reference.candidate_supported_area_km2) > 0) status = "EXPLORATORY_SUPPORT";
  else if (commonCoverage !== null) status = "ASSESSED_COMPARISON";
  return {
    id: "forest-optical-reference",
    role: "independent_observation",
    source: reference.source ?? "NASA HLS optical comparison",
    source_url: null,
    raw_status: reference.status,
    status,
    observation_dates: [reference.before_date, reference.after_date].filter((value): value is string => Boolean(value)),
    temporal_offsets_days: [reference.before_offset_days, reference.after_offset_days]
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    common_coverage_fraction: commonCoverage,
    candidate_assessed_fraction: reference.candidate_assessed_area_km2 != null && frame.stats.candidate_area_km2 > 0
      ? percentOrNull(reference.candidate_assessed_area_km2 / frame.stats.candidate_area_km2)
      : null,
    precision: null,
    recall: null,
    f1: null,
    summary: reference.reason ?? reference.metric_note ?? reference.support_rule ?? "Optical comparison is exploratory context, not a forest-loss reference classification.",
    limitations: [
      "No labelled negative forest-loss reference is available; precision, recall and F1 are not reported.",
      "Optical index decreases can have multiple causes and do not establish permanent forest loss.",
    ],
  };
}

export function buildForestEvidenceChain(study: ForestStudy, frame?: ForestFrame): EvidenceChain {
  const selectedFrame = frame ?? study.frames[study.frames.length - 1];
  const reference = selectedFrame ? forestReference(selectedFrame) : notRecordedReference(
    "forest-optical-reference",
    "NASA HLS optical comparison",
    "No observation frame is selected for reference assessment.",
  );
  const inputs = study.inputs.map((item) => ({
    sensor: "NISAR",
    product: item.collection,
    start_date: item.date,
    end_date: item.date,
    maturity: item.maturity,
    release: null,
    polarization: null,
    track: null,
    frame: null,
    direction: null,
    wavelength_m: null,
    source_id: item.granule_id,
  }));
  return {
    schema_version: 1,
    module: "forest",
    study_id: study.id,
    study_title: study.title,
    site_name: study.title,
    modality: "GCOV_BACKSCATTER",
    product: inputs[0]?.product ?? "NISAR L2 GCOV",
    product_maturity: inputs[0]?.maturity ?? null,
    state: "EXPLORATORY",
    conclusion: study.scientific_interpretation || "Persistent radar-change candidates are not confirmed forest loss.",
    observations: inputs,
    method: {
      id: study.method_version,
      summary: "Temporal HV backscatter persistence screen within historical 2021 tree cover.",
      screening_rules: [
        "Use the median HV dB baseline and temporal median absolute deviation from baseline dates.",
        "Require a decrease of at least 3 dB on two consecutive valid later dates.",
        "Retain only patches of at least 1 hectare.",
        "Historical tree-cover eligibility is not proof that the pixel remained forest in 2026.",
      ],
      minimum_coverage_fraction: 0.2,
    },
    measurements: selectedFrame ? [
      { id: "forest-candidate-area", label: "Radar-change candidate area", value: finiteOrNull(selectedFrame.stats.candidate_area_km2), unit: "km²", interpretation: "Persistent radar-change candidate area, not a deforestation estimate." },
      { id: "forest-assessed-area", label: "Assessed persistence area", value: finiteOrNull(selectedFrame.stats.assessed_area_km2), unit: "km²", interpretation: "Area with the required valid temporal observations." },
      { id: "forest-hh-median", label: "Median HH backscatter", value: finiteOrNull(selectedFrame.stats.median_hh_db), unit: "dB", interpretation: "Scene-level radar backscatter summary." },
      { id: "forest-hv-median", label: "Median HV backscatter", value: finiteOrNull(selectedFrame.stats.median_hv_db), unit: "dB", interpretation: "Scene-level radar backscatter summary." },
      { id: "forest-optical-support", label: "Candidate overlap with optical support", value: percentOrNull(selectedFrame.reference.support_overlap_fraction), unit: "fraction", interpretation: "Exploratory NDVI/NBR direction support, not accuracy." },
    ] : [],
    references: [reference],
    provenance: {
      run_id: study.run_id,
      publication_version: study.publication_version,
      boundary_source: study.boundary_source,
      source_urls: sourceUrls(study.sources),
      artifacts: selectedFrame ? [selectedFrame.candidates_geojson, ...Object.values(selectedFrame.layers).map((layer) => layer.image)] : [],
    },
    uncertainty_and_limits: [
      ...study.limitations,
      "Backscatter depends on moisture, vegetation structure, season, acquisition geometry and speckle.",
      "The 2021 tree-cover layer is historical eligibility context, not a 2026 forest-loss reference.",
    ],
  };
}

export function buildVolcanoEvidenceChain(study: VolcanoStudy, selectedPair?: VolcanoPair): EvidenceChain {
  const pair = selectedPair ?? study.pairs.find((item) => item.id === study.default_pair_id) ?? study.pairs[0];
  const comparisons = pair
    ? study.comparisons.filter((item) => item.nisar_id === pair.id || item.sentinel_id === pair.id)
    : [];
  const references: EvidenceReference[] = comparisons.map((comparison) => {
    const sentinelPair = study.pairs.find((item) => item.id === comparison.sentinel_id);
    return {
      id: "volcano-cross-sensor-" + comparison.sentinel_id,
      role: "cross_sensor_context",
      source: sentinelPair ? sentinelPair.sensor + " · " + sentinelPair.collection : "Sentinel-1 comparison",
      source_url: null,
      raw_status: comparison.status,
      status: /INCONCLUSIVE/i.test(comparison.status) ? "INCONCLUSIVE" : "CROSS_SENSOR_CONTEXT",
      observation_dates: sentinelPair ? [sentinelPair.start, sentinelPair.end] : [],
      temporal_offsets_days: [comparison.start_offset_days, comparison.end_offset_days],
      common_coverage_fraction: percentOrNull(comparison.common_valid_fraction),
      candidate_assessed_fraction: null,
      precision: null,
      recall: null,
      f1: null,
      summary: comparison.interpretation,
      limitations: [
        "Different sensors, dates, wavelengths and viewing geometries make this complementary context, not deformation ground truth.",
        "A common-valid coverage threshold makes the comparison assessable; it does not validate causation.",
      ],
    };
  });
  if (!references.length) references.push(notRecordedReference(
    "volcano-cross-sensor-reference",
    "Sentinel-1 ARIA GUNW comparison",
    "No matched Sentinel-1 comparison is recorded for the selected NISAR pair.",
    "cross_sensor_context",
  ));

  return {
    schema_version: 1,
    module: "volcano",
    study_id: study.id,
    study_title: study.title,
    site_name: study.title,
    modality: "GUNW_PHASE",
    product: pair?.collection ?? "NISAR L2 GUNW",
    product_maturity: pair?.maturity ?? null,
    state: pair && pair.statistics.valid_fraction < 0.2 ? "INCONCLUSIVE" : "EXPLORATORY",
    conclusion: "The product shows screened phase-derived apparent line-of-sight candidates. It does not establish eruption causation, vertical uplift, magma depth, or an eruption forecast.",
    observations: study.pairs.map((item) => ({
      sensor: item.sensor,
      product: item.collection,
      start_date: item.start,
      end_date: item.end,
      maturity: item.maturity,
      release: null,
      polarization: item.polarization,
      track: item.track,
      frame: null,
      direction: item.direction,
      wavelength_m: finiteOrNull(item.wavelength_m),
      source_id: item.granule_id,
    })),
    method: {
      id: study.method_version,
      summary: "Reference-subtracted unwrapped interferometric phase converted to apparent line-of-sight displacement.",
      screening_rules: [
        "Require coherence at or above the study coherence floor.",
        "Retain valid connected phase components and the analyst-defined geographic study rectangle.",
        "Subtract the median phase of an assumed-stable reference patch.",
        "Convert phase to LOS displacement using the product wavelength and documented phase sign.",
      ],
      minimum_coverage_fraction: 0.2,
    },
    measurements: pair ? [
      { id: "volcano-los-p05", label: "Apparent LOS fifth percentile", value: finiteOrNull(pair.statistics.p05_cm), unit: "cm", interpretation: "Phase-derived apparent LOS candidate; not vertical motion." },
      { id: "volcano-los-p95", label: "Apparent LOS ninety-fifth percentile", value: finiteOrNull(pair.statistics.p95_cm), unit: "cm", interpretation: "Phase-derived apparent LOS candidate; not vertical motion." },
      { id: "volcano-screened-coverage", label: "Screened coverage", value: percentOrNull(pair.statistics.valid_fraction), unit: "fraction", interpretation: "Fraction passing phase/coherence/quality screens." },
      { id: "volcano-median-coherence", label: "Median coherence", value: finiteOrNull(pair.statistics.median_coherence), unit: "ratio", interpretation: "Phase quality indicator; not a confidence percentage." },
      { id: "volcano-reference-mad", label: "Reference-patch dispersion", value: finiteOrNull(pair.statistics.reference_mad_cm), unit: "cm MAD", interpretation: "Spatial dispersion within the assumed reference patch, not displacement accuracy." },
    ] : [],
    references,
    provenance: {
      run_id: null,
      publication_version: study.publication_version,
      boundary_source: study.boundary_source,
      source_urls: [],
      artifacts: pair ? [pair.los_image, pair.coherence_image, pair.assessed_image, pair.los_download] : [],
    },
    uncertainty_and_limits: [
      ...study.limitations,
      "The reference patch is assumed stable, not independently surveyed.",
      "Atmospheric, ionospheric, orbit, DEM and unwrapping corrections are not applied unless explicitly documented in the study.",
    ],
  };
}

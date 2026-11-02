import type { WetlandPatch } from "./types";

export type ScatteringHypothesisId =
  | "open-water"
  | "flooded-vegetation"
  | "soil-moisture"
  | "vegetation-surface";

export type ScatteringHypothesisStatus =
  | "DETECTOR_SIGNATURE_SELECTED"
  | "NOT_SELECTED_BY_DETECTOR"
  | "NOT_DISTINGUISHED";

export interface ScatteringHypothesis {
  id: ScatteringHypothesisId;
  title: string;
  status: ScatteringHypothesisStatus;
  statusLabel: string;
  mechanism: string;
  candidateReadout: string;
  discriminatingEvidence: string[];
  limitation: string;
}

export interface ScatteringMeasurement {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  interpretation: string;
}

export interface ScatteringHypothesisAssessment {
  candidateId: string;
  observationDate: string;
  detectorClass: WetlandPatch["classification"];
  detectorClassLabel: string;
  measurements: ScatteringMeasurement[];
  baselineObservationCount: number | null;
  hypotheses: ScatteringHypothesis[];
  guardrails: string[];
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function classLabel(classification: WetlandPatch["classification"]): string {
  switch (classification) {
    case "OPEN_WATER":
      return "Open-water response candidate";
    case "VEGETATED_INUNDATION":
      return "Vegetated-inundation response candidate";
    default:
      return "Uncertain radar-change candidate";
  }
}

function selectedStatus(selected: boolean): ScatteringHypothesisStatus {
  return selected ? "DETECTOR_SIGNATURE_SELECTED" : "NOT_SELECTED_BY_DETECTOR";
}

/**
 * Build a candidate-level explanation ledger from the existing WetlandPatch.
 * It deliberately does not classify the physical cause or calculate probabilities.
 * Only the detector's already-recorded class selects one of the two inundation
 * response signatures; the other mechanisms remain unresolved without independent data.
 */
export function buildScatteringHypothesisAssessment(
  patch: WetlandPatch,
): ScatteringHypothesisAssessment {
  const deltaHH = finiteOrNull(patch.delta_hh);
  const deltaHV = finiteOrNull(patch.delta_hv);
  const validFraction = finiteOrNull(patch.valid_fraction);
  const vegetatedFraction = finiteOrNull(patch.vegetated_fraction);
  const baselineCount = Number.isInteger(patch.baseline_observation_count)
    ? patch.baseline_observation_count ?? null
    : null;

  const measurements: ScatteringMeasurement[] = [
    {
      id: "hh-change",
      label: "HH backscatter change",
      value: deltaHH,
      unit: "dB",
      interpretation: "Recorded change for this candidate; not a unique indicator of water.",
    },
    {
      id: "hv-change",
      label: "HV backscatter change",
      value: deltaHV,
      unit: "dB",
      interpretation: "Recorded cross-polarized change; canopy and volume scattering can contribute.",
    },
    {
      id: "valid-fraction",
      label: "Valid-data fraction",
      value: validFraction,
      unit: "fraction",
      interpretation: "Share of this candidate with valid data according to the existing pipeline.",
    },
    {
      id: "vegetated-fraction",
      label: "Recorded vegetated fraction",
      value: vegetatedFraction,
      unit: "fraction",
      interpretation: "Existing pipeline context only; it does not prove inundated vegetation.",
    },
    {
      id: "previous-date-overlap",
      label: "Previous-date candidate overlap",
      value: finiteOrNull(patch.temporal_overlap_fraction),
      unit: "fraction",
      interpretation: "Spatial overlap with a prior flagged candidate, not evidence of the physical cause.",
    },
  ];

  const openWaterSelected = patch.classification === "OPEN_WATER";
  const vegetatedInundationSelected = patch.classification === "VEGETATED_INUNDATION";
  const hhText = deltaHH === null ? "HH change is not recorded" : "HH change is " + deltaHH.toFixed(2) + " dB";
  const hvText = deltaHV === null ? "HV change is not recorded" : "HV change is " + deltaHV.toFixed(2) + " dB";

  const hypotheses: ScatteringHypothesis[] = [
    {
      id: "open-water",
      title: "Open-water surface scattering",
      status: selectedStatus(openWaterSelected),
      statusLabel: openWaterSelected ? "Selected detector signature" : "Not selected · not ruled out",
      mechanism: "Relatively smooth, exposed water can reflect radar energy away from a side-looking sensor and produce a darker return. Wind, surface roughness, vegetation, incidence angle and water conditions can change this response.",
      candidateReadout: openWaterSelected
        ? "The existing detector assigned this candidate to its OPEN_WATER response class. " + hhText + "; " + hvText + ". This records the selected radar signature, not a verified water observation."
        : "The existing detector did not assign this candidate to its OPEN_WATER response class. That does not rule out water; this view does not independently test every possible water-scattering condition.",
      discriminatingEvidence: [
        "A spatially registered water reference acquired close to the NISAR observation date.",
        "Both positive and negative reference labels covering the candidate and surrounding study area.",
        "Reference coverage, cloud or quality masks, and acquisition-date offsets reported separately.",
      ],
      limitation: "HH darkening alone cannot distinguish newly inundated water from other causes of reduced backscatter.",
    },
    {
      id: "flooded-vegetation",
      title: "Flooded-vegetation double bounce",
      status: selectedStatus(vegetatedInundationSelected),
      statusLabel: vegetatedInundationSelected ? "Selected detector signature" : "Not selected · not ruled out",
      mechanism: "At L-band, energy can penetrate some vegetation and interact with both a water surface and upright stems or trunks. This double-bounce contribution can increase co-polarized HH return, but its strength depends on canopy structure, density, geometry and surface conditions.",
      candidateReadout: vegetatedInundationSelected
        ? "The existing detector assigned this candidate to its VEGETATED_INUNDATION response class. " + hhText + "; " + hvText + ". This is a detector-selected signature, not confirmation of flooded vegetation."
        : "The existing detector did not assign this candidate to its VEGETATED_INUNDATION response class. That does not establish that vegetation is absent or that flooding beneath vegetation did not occur.",
      discriminatingEvidence: [
        "Time-matched evidence of vegetation structure and the presence or absence of water beneath the canopy.",
        "Suitable independent reference observations with known dates and spatial support.",
        "Repeated, compatible polarimetric observations to examine whether the response persists beyond one pair.",
      ],
      limitation: "A higher HH response is not unique to flooded vegetation; vegetation structure and other surface-volume interactions can also raise backscatter.",
    },
    {
      id: "soil-moisture",
      title: "Soil-moisture variation",
      status: "NOT_DISTINGUISHED",
      statusLabel: "Cannot distinguish with this pair",
      mechanism: "Changes in soil dielectric properties can change radar backscatter. The response depends on vegetation cover, roughness, wavelength and polarization; HH and HV alone do not isolate soil-moisture effects from inundation or other surface changes.",
      candidateReadout: "No independent soil-moisture measurement is attached to this candidate. The recorded HH/HV pair therefore cannot confirm or exclude soil-moisture variation as a contributor.",
      discriminatingEvidence: [
        "Time-matched field soil-moisture measurements or an independent soil-moisture product.",
        "Spatial and temporal support matched to the candidate pixels.",
        "Quality flags and retrieval uncertainty retained for the independent measurement.",
      ],
      limitation: "A backscatter change is not a soil-moisture retrieval, and the candidate's class does not provide a soil-moisture diagnosis.",
    },
    {
      id: "vegetation-surface",
      title: "Vegetation, roughness or intercepted water",
      status: "NOT_DISTINGUISHED",
      statusLabel: "Cannot distinguish with this pair",
      mechanism: "Canopy water content, seasonal vegetation changes, wind-driven canopy movement, surface roughness and water intercepted on leaves can all alter the return. Their effects depend on acquisition timing, wavelength, polarization and vegetation structure.",
      candidateReadout: "The available HH/HV change and recorded vegetated-fraction context do not separate these effects. The vegetated-fraction field is contextual metadata, not proof of a specific surface process.",
      discriminatingEvidence: [
        "Temporally matched optical or field observations of vegetation condition and land cover.",
        "Acquisition-time weather or surface-condition context where relevant.",
        "Additional compatible SAR observations to test whether the candidate response is persistent or transient.",
      ],
      limitation: "This candidate-level pair does not contain enough information to attribute the change to vegetation, roughness, wind or intercepted water individually.",
    },
  ];

  const guardrails = [
    "A selected detector class is a response label, not a confirmed physical cause.",
    "A hypothesis not selected by the detector is not ruled out.",
    "No probability, confidence score, precision or accuracy value is calculated here.",
  ];
  if (baselineCount !== null && baselineCount <= 1) {
    guardrails.push("Only one baseline observation is recorded; baseline temporal variability cannot be estimated from multiple dates.");
  }
  if (validFraction !== null && validFraction < 1) {
    guardrails.push("Some candidate pixels are not valid in the recorded data; unassessed pixels must not be treated as negative evidence.");
  }

  return {
    candidateId: patch.id,
    observationDate: patch.date,
    detectorClass: patch.classification,
    detectorClassLabel: classLabel(patch.classification),
    measurements,
    baselineObservationCount: baselineCount,
    hypotheses,
    guardrails,
  };
}

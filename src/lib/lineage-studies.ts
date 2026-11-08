/* Lineage study loader (server only).
 *
 * Reads the published manifests in public/ and builds one EvidenceChain per
 * published study with the existing builders in ./evidence-chain. Versions
 * are resolved through each study's index.json / catalog entry, never
 * hard-coded. A study that cannot be read is reported in `unavailable`
 * with its reason — never silently dropped, never replaced with invented
 * values.
 *
 * Two honest enrichments happen here, both from the same manifests:
 * - Wetland observation nodes get their granule IDs from observations.json
 *   (the chain builder only carries dates; the scene_name is the granule).
 * - Hakaluki gets a second reference node for its 27 Sep 2026 date check,
 *   because the headline pair (23 Jun → 17 Jul) is unassessable while the
 *   date check is the only assessed comparison. The "weak agreement" label
 *   is the documented assessment in docs/evidence-report.md, not a new
 *   classification.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildAgricultureEvidenceChain,
  buildForestEvidenceChain,
  buildVolcanoEvidenceChain,
  buildWetlandEvidenceChain,
} from "./evidence-chain";
import type {
  EvidenceChain,
  EvidenceReference,
  WetlandEvidenceInput,
} from "./evidence-chain";
import type { AgricultureStudy } from "./agriculture-study";
import type { ForestStudy } from "./forest-study";
import type { VolcanoStudy } from "./volcano-study";

export interface LineageUnavailable {
  id: string;
  reason: string;
}

export interface LineageChains {
  chains: EvidenceChain[];
  unavailable: LineageUnavailable[];
}

function publicPath(...parts: string[]): string {
  return path.join(process.cwd(), "public", ...parts);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

type JsonRecord = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Optional-field variants: the builder's input type uses `?: string` / `?: number`, so null must become undefined. */
function optString(value: unknown): string | undefined {
  return asString(value) ?? undefined;
}

function optNumber(value: unknown): number | undefined {
  return asNumber(value) ?? undefined;
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

interface CatalogStudy {
  run_id: string;
  site_name: string;
  dates: string[];
  path: string;
}

async function loadWetlandChain(catalogEntry: CatalogStudy): Promise<EvidenceChain> {
  const parts = catalogEntry.path.split("/");
  const caseStudy = await readJson<JsonRecord>(publicPath("studies", ...parts, "case_study.json"));
  if (!caseStudy) throw new Error("case_study.json could not be read at " + catalogEntry.path);
  const observations = await readJson<JsonRecord[]>(publicPath("studies", ...parts, "observations.json"));
  const method = asRecord(caseStudy.method);
  const baselineMethod = asRecord(method?.baseline_method);
  const uncertainty = asRecord(caseStudy.uncertainty);
  const thresholdSensitivity = asRecord(uncertainty?.threshold_sensitivity);
  const input: WetlandEvidenceInput = {
    run_id: asString(caseStudy.source_run_id) ?? catalogEntry.run_id,
    site_name: asString(caseStudy.site) ?? catalogEntry.site_name,
    data_source: asString(caseStudy.data_source) ?? "NISAR",
    product: asString(caseStudy.product),
    product_maturity: asString(caseStudy.product_maturity),
    baseline_date: asString(caseStudy.baseline_date),
    selected_date: asString(caseStudy.event_date),
    polarizations: asStringArray(caseStudy.polarizations),
    dates: observations
      ? observations.map((item) => asString(item.date)).filter((item): item is string => item !== null)
      : catalogEntry.dates,
    reference_check_status: asString(asRecord(caseStudy.reference_validation)?.status) ?? "NOT_RECORDED",
    reference_validation: (caseStudy.reference_validation ?? null) as WetlandEvidenceInput["reference_validation"],
    case_study: {
      title: optString(caseStudy.title),
      site: optString(caseStudy.site),
      baseline_date: optString(caseStudy.baseline_date),
      event_date: optString(caseStudy.event_date),
      candidate_patches: optNumber(caseStudy.candidate_patches),
      candidate_area_km2: optNumber(caseStudy.candidate_area_km2),
      method: method
        ? {
            open_water_rule: optString(method.open_water_rule),
            vegetated_inundation_rule: optString(method.vegetated_inundation_rule),
            threshold_db: optNumber(method.threshold_db),
            minimum_region_pixels: optNumber(method.minimum_region_pixels),
            validity_rule: optString(method.validity_rule),
            baseline_method: baselineMethod
              ? { baseline_method: optString(baselineMethod.baseline_method) }
              : undefined,
          }
        : undefined,
      uncertainty: uncertainty
        ? {
            threshold_sensitivity: thresholdSensitivity
              ? { sensitivity_note: optString(thresholdSensitivity.sensitivity_note) }
              : undefined,
            interpretation: optString(uncertainty.interpretation),
          }
        : undefined,
      impact_context: optString(caseStudy.impact_context),
      spatial_scope: optString(caseStudy.spatial_scope),
    },
  };
  const chain = buildWetlandEvidenceChain(input);

  // Attach granule IDs from observations.json (scene_name), matched by date.
  if (observations) {
    const granules = new Map<string, string>();
    for (const item of observations) {
      const date = asString(item.date);
      const scene = asString(item.scene_name);
      if (date && scene) granules.set(date, scene);
    }
    chain.observations.forEach((observation) => {
      if (observation.start_date) {
        const granule = granules.get(observation.start_date);
        if (granule) observation.source_id = granule;
      }
    });
  }

  // Hakaluki: the headline pair is unassessable, but the 27 Sep 2026 date
  // check is an assessed comparison. Show both, labelled as what they are.
  if (catalogEntry.site_name === "Hakaluki Haor") {
    const dateCheck = await readJson<JsonRecord>(
      publicPath("studies", ...parts, "date_checks", "2026-09-27", "evidence.json"),
    );
    if (dateCheck) {
      const optical = asRecord(dateCheck.optical_support);
      const comparison = asRecord(dateCheck.comparison);
      const baseline = asRecord(comparison?.baseline);
      const event = asRecord(comparison?.event);
      const precision = asNumber(optical?.precision);
      const recall = asNumber(optical?.recall);
      const f1 = asNumber(optical?.f1);
      const reference: EvidenceReference = {
        id: "hakaluki-date-check-2026-09-27",
        role: "independent_observation",
        source: "NASA HLS optical comparison — 27 Sep 2026 date check",
        source_url: null,
        raw_status: asString(dateCheck.reference_status),
        status: "WEAK_AGREEMENT",
        observation_dates: [asString(baseline?.hls_date), asString(event?.hls_date)].filter(
          (item): item is string => item !== null,
        ),
        temporal_offsets_days: [asNumber(baseline?.offset_days), asNumber(event?.offset_days)].filter(
          (item): item is number => item !== null,
        ),
        common_coverage_fraction: asNumber(optical?.common_clear_fraction),
        candidate_assessed_fraction: asNumber(optical?.candidate_assessed_fraction),
        precision,
        recall,
        f1,
        summary:
          precision !== null && recall !== null && f1 !== null
            ? `27 Sep 2026 date check: weak agreement with the optical reference (precision ${(precision * 100).toFixed(1)}%, recall ${(recall * 100).toFixed(1)}%, F1 ${(f1 * 100).toFixed(1)}%). The headline 23 Jun → 17 Jul pair remains unassessable.`
            : "27 Sep 2026 date check: assessed comparison; metrics not recorded in the evidence file.",
        limitations: [
          asString(dateCheck.limitations) ??
            "Satellite agreement is not field validation.",
          "HLS dates differ from NISAR dates by the offsets shown; water can change between acquisitions.",
        ],
      };
      chain.references.push(reference);
    }
  }
  return chain;
}

async function loadStudyFromIndex(indexParts: string[]): Promise<JsonRecord> {
  const index = await readJson<JsonRecord>(publicPath(...indexParts, "index.json"));
  const studyUrl = asString(index?.study_url);
  if (!studyUrl) throw new Error("index.json has no study_url at " + indexParts.join("/"));
  const study = await readJson<JsonRecord>(publicPath(...studyUrl.replace(/^\//, "").split("/")));
  if (!study) throw new Error("study.json could not be read at " + studyUrl);
  return study;
}

export async function loadLineageChains(): Promise<LineageChains> {
  const chains: EvidenceChain[] = [];
  const unavailable: LineageUnavailable[] = [];
  const attempt = async (id: string, load: () => Promise<EvidenceChain>) => {
    try {
      chains.push(await load());
    } catch (error) {
      unavailable.push({ id, reason: error instanceof Error ? error.message : String(error) });
    }
  };

  const catalog = await readJson<{ studies?: CatalogStudy[] }>(publicPath("studies", "catalog.json"));
  const wetlandRuns = (catalog?.studies ?? []).filter((study) => study.site_name !== undefined);
  const bySite = new Map(wetlandRuns.map((study) => [study.site_name, study]));
  // The featured Tanguar case is the same run as the catalog's Tanguar entry;
  // the catalog run carries the full case study, so it is the source here.
  for (const site of ["Tanguar Haor mapped boundary", "Hakaluki Haor", "Chokwe event study box"]) {
    const entry = bySite.get(site);
    if (!entry) {
      unavailable.push({ id: site, reason: "No catalog entry for this site in public/studies/catalog.json" });
      continue;
    }
    await attempt(site, () => loadWetlandChain(entry));
  }

  await attempt("Rondônia", async () => {
    const study = await loadStudyFromIndex(["forests", "rondonia"]);
    return buildForestEvidenceChain(study as unknown as ForestStudy);
  });
  await attempt("Hayli Gubbi / Erta Ale", async () => {
    const study = await loadStudyFromIndex(["volcanoes", "hayli-gubbi"]);
    return buildVolcanoEvidenceChain(study as unknown as VolcanoStudy);
  });
  await attempt("Kīlauea", async () => {
    const study = await loadStudyFromIndex(["volcanoes", "kilauea-episode-36-2025"]);
    return buildVolcanoEvidenceChain(study as unknown as VolcanoStudy);
  });
  await attempt("Naogaon", async () => {
    const study = await readJson<AgricultureStudy>(publicPath("agriculture", "current", "study.json"));
    if (!study) throw new Error("public/agriculture/current/study.json could not be read");
    return buildAgricultureEvidenceChain(study);
  });

  return { chains, unavailable };
}

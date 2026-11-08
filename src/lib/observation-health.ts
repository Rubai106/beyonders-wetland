/* Platform-wide observation health — computed from the published manifests
   in public/, never from invented values. A study that is missing from disk
   is reported as missing, not as zero. */
import { promises as fs } from "node:fs";
import path from "node:path";

export type MaturityStage =
  | "catalogue"
  | "observations"
  | "processing"
  | "exploratory"
  | "quality_screened"
  | "reference"
  | "validation"
  | "reproducible";

export const MATURITY_STAGES: { id: MaturityStage; label: string; meaning: string }[] = [
  { id: "catalogue", label: "Catalogue available", meaning: "The NASA catalogue lists compatible observations for this study." },
  { id: "observations", label: "Observations acquired", meaning: "Real acquisition dates were retrieved and are recorded in the manifest." },
  { id: "processing", label: "Processing completed", meaning: "A processing run finished and produced derived artifacts." },
  { id: "exploratory", label: "Exploratory result generated", meaning: "A radar-change or measurement result exists. It is exploratory until validated." },
  { id: "quality_screened", label: "Quality-screened result", meaning: "Invalid, fill, and low-quality pixels were screened out by a documented rule." },
  { id: "reference", label: "Independent reference available", meaning: "An independent dataset (optical, another sensor, or a catalogue) exists for comparison." },
  { id: "validation", label: "Validation complete", meaning: "The comparison with the independent reference produced a conclusive assessment." },
  { id: "reproducible", label: "Scientifically reproducible", meaning: "Run ID, method, and checksums are published so the result can be re-derived." },
];

export type IntegrityState = "NOT_PUBLISHED" | "PUBLISHED_NOT_VERIFIED" | "VERIFIED";

/** Distinct observation states — never conflated (see docs/OBSERVABILITY_ARCHITECTURE.md). */
export type ObservationState =
  | "NO_OBSERVATIONS"
  | "NO_COMPATIBLE_OBSERVATIONS"
  | "NO_VALID_PIXELS"
  | "ZERO_DETECTIONS"
  | "PROCESSING_FAILURE"
  | "INCONCLUSIVE_VALIDATION"
  | "SERVICE_UNAVAILABLE"
  | "PUBLISHED_EXPLORATORY";

export const OBSERVATION_STATES: { id: ObservationState; label: string; meaning: string }[] = [
  { id: "NO_OBSERVATIONS", label: "No observations", meaning: "The catalogue returned nothing for this place and time." },
  { id: "NO_COMPATIBLE_OBSERVATIONS", label: "No compatible observations", meaning: "Scenes exist but none match the required product, geometry, or dates." },
  { id: "NO_VALID_PIXELS", label: "No valid pixels", meaning: "Observations exist but every pixel failed the quality screen." },
  { id: "ZERO_DETECTIONS", label: "Zero detections", meaning: "Valid pixels were processed and no candidate passed the detector." },
  { id: "PROCESSING_FAILURE", label: "Processing failure", meaning: "A run started and failed. The last successful publication is untouched." },
  { id: "INCONCLUSIVE_VALIDATION", label: "Inconclusive validation", meaning: "A result exists but the independent comparison could not confirm or reject it." },
  { id: "SERVICE_UNAVAILABLE", label: "Service unavailable", meaning: "An external service (CMR, GIBS, tiles) could not be reached. Nothing is claimed about the data." },
  { id: "PUBLISHED_EXPLORATORY", label: "Published exploratory result", meaning: "A result is published with its evidence status, limits, and checksums visible." },
];

export interface StudyHealth {
  id: string;
  domain: "wetland" | "forest" | "volcano" | "agriculture";
  name: string;
  href: string;
  state: ObservationState;
  /** Stages reached, in ladder order. */
  stages: MaturityStage[];
  product: string;
  productMaturity: string;
  observationDates: string[];
  evidenceStatus: string;
  /** What the independent comparison actually concluded, in plain words. */
  validationNote: string;
  /** What is still missing before the next maturity stage. */
  nextStep: string;
  checksumsPresent: boolean;
  /** Integrity of the published digests. A declaration is NOT proof of
      verification: PUBLISHED_NOT_VERIFIED means digests are published but
      have not been re-hashed in this session. VERIFIED requires a
      verification record produced by hashing the files. */
  integrity: IntegrityState;
  /** Declared SHA-256 digests (path → digest), when published. */
  digests: Record<string, string> | null;
  publishedAt: string | null;
  runId: string | null;
}

export interface DomainHealth {
  domain: StudyHealth["domain"];
  label: string;
  studies: StudyHealth[];
}

export interface PlatformHealth {
  generatedAt: string;
  domains: DomainHealth[];
  /** Manifests that were expected but could not be read. */
  missing: string[];
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function publicPath(...parts: string[]): string {
  return path.join(process.cwd(), "public", ...parts);
}

export async function buildPlatformHealth(): Promise<PlatformHealth> {
  const missing: string[] = [];
  const domains: DomainHealth[] = [];

  // ── Wetlands ──
  const wetland: StudyHealth[] = [];
  const tanguar = await readJson<Record<string, unknown>>(publicPath("showcase", "featured", "manifest.json"));
  if (tanguar) {
    wetland.push({
      id: "tanguar-haor",
      domain: "wetland",
      name: "Tanguar Haor",
      href: "/wetland",
      state: "INCONCLUSIVE_VALIDATION",
      stages: ["catalogue", "observations", "processing", "exploratory", "quality_screened", "reference", "reproducible"],
      product: String(tanguar.product ?? "NISAR_L2_GCOV_PROVISIONAL_V1"),
      productMaturity: String(tanguar.product_maturity ?? "PROVISIONAL"),
      observationDates: (tanguar.observation_dates as string[]) ?? [],
      evidenceStatus: "INCONCLUSIVE",
      validationNote: "HLS optical comparison is inconclusive: common clear coverage is about 0.333% of the study area, below the 20% floor.",
      nextStep: "A conclusive independent reference (more clear optical coverage or field evidence) is needed before validation can complete.",
      checksumsPresent: typeof tanguar.files_sha256 === "object" && tanguar.files_sha256 !== null,
      integrity: "PUBLISHED_NOT_VERIFIED",
      digests:
        typeof tanguar.files_sha256 === "object" && tanguar.files_sha256 !== null
          ? (tanguar.files_sha256 as Record<string, string>)
          : null,
      publishedAt: typeof tanguar.exported_at === "string" ? tanguar.exported_at : null,
      runId: typeof tanguar.run_id === "string" ? tanguar.run_id : null,
    });
  } else missing.push("public/showcase/featured/manifest.json");
  const hakalukiCatalog = await readJson<{ studies?: { run_id: string; site_name: string; dates: string[]; evidence_status: string; published_at: string; path?: string }[] }>(publicPath("studies", "catalog.json"));
  const hakaluki = hakalukiCatalog?.studies?.find((s) => s.site_name === "Hakaluki Haor");
  // Hakaluki has no standalone checksums file, but its publication record
  // carries a per-artifact SHA-256 map. Verified 2026-11-08: 81/81
  // recorded digests match the files on disk (see
  // docs/PHASE3_SCIENTIFIC_VERIFICATION.md §1). The two files outside
  // that map are evidence_card.json and publication.json itself.
  // The digests below are the DECLARED map; integrity stays
  // PUBLISHED_NOT_VERIFIED because this builder does not re-hash the files
  // (the evidence-quality loader does, and reports the verified count).
  let hakalukiChecksums = false;
  let hakalukiDigests: Record<string, string> | null = null;
  if (hakaluki?.path) {
    const publication = await readJson<{ artifacts?: Record<string, { sha256?: unknown; bytes?: unknown }> }>(
      publicPath("studies", hakaluki.path, "publication.json"),
    );
    const entries = Object.entries(publication?.artifacts ?? {});
    hakalukiChecksums = entries.length > 0 && entries.every(([, a]) => typeof a.sha256 === "string");
    if (hakalukiChecksums) {
      hakalukiDigests = Object.fromEntries(entries.map(([k, a]) => [k, a.sha256 as string]));
    }
  }
  if (hakaluki) {
    wetland.push({
      id: "hakaluki-haor",
      domain: "wetland",
      name: "Hakaluki Haor",
      href: "/wetland",
      state: "INCONCLUSIVE_VALIDATION",
      stages: ["catalogue", "observations", "processing", "exploratory", "quality_screened", "reference", "reproducible"],
      product: "NISAR_L2_GCOV_PROVISIONAL_V1",
      productMaturity: "PROVISIONAL",
      observationDates: hakaluki.dates ?? [],
      evidenceStatus: hakaluki.evidence_status ?? "INCONCLUSIVE",
      validationNote: "27 Sep 2026 date check: weak agreement with the optical reference (precision 12.9%, recall 5.2%, F1 7.4%). The headline 23 Jun → 17 Jul pair is unassessable — only 9 cloud-free pixels overlap the wetland mask. Not a validated flood detector.",
      nextStep: "A stronger independent reference is needed before validation can complete.",
      checksumsPresent: hakalukiChecksums,
      integrity: "PUBLISHED_NOT_VERIFIED",
      digests: hakalukiDigests,
      publishedAt: hakaluki.published_at ?? null,
      runId: hakaluki.run_id ?? null,
    });
  } else missing.push("public/studies/catalog.json (Hakaluki Haor)");
  // Chókwè (Phase 4): a completed real processing run that was missing from
  // observability even though it is a published investigation. Same
  // publication-record fingerprint check as Hakaluki — verified 2026-11-08:
  // 24/24 recorded digests match the files on disk.
  const chokwe = hakalukiCatalog?.studies?.find((s) => s.site_name === "Chokwe event study box");
  let chokweChecksums = false;
  let chokweDigests: Record<string, string> | null = null;
  let chokweCase: Record<string, unknown> | null = null;
  if (chokwe?.path) {
    const publication = await readJson<{ artifacts?: Record<string, { sha256?: unknown; bytes?: unknown }> }>(
      publicPath("studies", chokwe.path, "publication.json"),
    );
    const entries = Object.entries(publication?.artifacts ?? {});
    chokweChecksums = entries.length > 0 && entries.every(([, a]) => typeof a.sha256 === "string");
    if (chokweChecksums) {
      chokweDigests = Object.fromEntries(entries.map(([k, a]) => [k, a.sha256 as string]));
    }
    chokweCase = await readJson<Record<string, unknown>>(publicPath("studies", chokwe.path, "case_study.json"));
  }
  if (chokwe) {
    wetland.push({
      id: "chokwe",
      domain: "wetland",
      name: "Chókwè",
      href: "/wetland/global?story=chokwe",
      state: "INCONCLUSIVE_VALIDATION",
      stages: ["catalogue", "observations", "processing", "exploratory", "quality_screened", "reference", "reproducible"],
      product: String(chokweCase?.product ?? "NISAR_L2_GCOV_BETA_V1"),
      productMaturity: String(chokweCase?.product_maturity ?? "BETA"),
      observationDates: chokwe.dates ?? [],
      evidenceStatus: "INCONCLUSIVE",
      validationNote: "Completed real processing (127 patches, 29.872 km²). The reference comparison is inconclusive — processing completed does not mean validated.",
      nextStep: "A conclusive independent reference is needed before validation can complete.",
      checksumsPresent: chokweChecksums,
      integrity: "PUBLISHED_NOT_VERIFIED",
      digests: chokweDigests,
      publishedAt: null,
      runId: chokwe.run_id ?? null,
    });
  } else missing.push("public/studies/catalog.json (Chokwe event study box)");
  domains.push({ domain: "wetland", label: "Wetlands", studies: wetland });

  // ── Forests ──
  const forest: StudyHealth[] = [];
  const rondoniaIndex = await readJson<Record<string, unknown>>(publicPath("forests", "rondonia", "index.json"));
  if (rondoniaIndex) {
    const study = await readJson<{ observation_dates?: string[]; evidence_status?: string; run_id?: string }>(
      publicPath("forests", "rondonia", "2026.10.08-v1", "study.json"),
    );
    const archiveDigest = typeof rondoniaIndex.archive_sha256 === "string" ? rondoniaIndex.archive_sha256 : null;
    const nativeDigest = typeof rondoniaIndex.native_archive_sha256 === "string" ? rondoniaIndex.native_archive_sha256 : null;
    forest.push({
      id: "rondonia",
      domain: "forest",
      name: "Rondônia",
      href: "/forest/rondonia",
      state: "PUBLISHED_EXPLORATORY",
      stages: ["catalogue", "observations", "processing", "exploratory", "quality_screened", "reference", "reproducible"],
      product: "NISAR_L2_GCOV_PROVISIONAL_V1",
      productMaturity: "PROVISIONAL",
      observationDates: study?.observation_dates ?? [],
      evidenceStatus: "EXPLORATORY",
      validationNote: "One 0.0128 km² radar candidate; an exploratory HLS index signal overlaps 71.1%. No labelled forest-loss reference or accuracy score exists.",
      nextStep: "A labelled forest-loss reference is needed before validation can complete.",
      checksumsPresent: archiveDigest !== null && nativeDigest !== null,
      integrity: "PUBLISHED_NOT_VERIFIED",
      digests:
        archiveDigest !== null && nativeDigest !== null
          ? { archive_sha256: archiveDigest, native_archive_sha256: nativeDigest }
          : null,
      publishedAt: null,
      runId: typeof study?.run_id === "string" ? study.run_id : null,
    });
  } else missing.push("public/forests/rondonia/index.json");
  domains.push({ domain: "forest", label: "Forests", studies: forest });

  // ── Volcanoes ──
  const volcano: StudyHealth[] = [];
  const volcanoCatalog = await readJson<{ case_studies?: { id: string; name: string; evidence_status?: string }[] }>(publicPath("volcanoes", "catalog.json"));
  const hayli = volcanoCatalog?.case_studies?.find((c) => c.id === "hayli-gubbi-2025");
  if (hayli) {
    volcano.push({
      id: "hayli-gubbi",
      domain: "volcano",
      name: "Hayli Gubbi and Erta Ale",
      href: "/volcano/hayli-gubbi",
      state: "PUBLISHED_EXPLORATORY",
      // No "reproducible" stage: the published study.json carries no run
      // ID, and no per-artifact digest map is published (method_source_sha256
      // and config_sha256 are provenance hashes of the method and config,
      // not digests of the published artifacts).
      stages: ["catalogue", "observations", "processing", "exploratory", "quality_screened", "reference"],
      product: "NISAR_L2_GUNW_BETA",
      productMaturity: "BETA",
      observationDates: [],
      evidenceStatus: "EXPLORATORY",
      validationNote: "Screened apparent line-of-sight phase candidates. Sentinel-1 is a separate comparison; signals are not causally attributed to the eruption.",
      nextStep: "Independent geodetic observations and atmospheric corrections are needed before validation can complete.",
      checksumsPresent: false,
      integrity: "NOT_PUBLISHED",
      digests: null,
      publishedAt: null,
      runId: null,
    });
  } else missing.push("public/volcanoes/catalog.json (hayli-gubbi-2025)");
  const kilauea = volcanoCatalog?.case_studies?.find((c) => c.id === "kilauea-episode-36-2025");
  if (kilauea) {
    volcano.push({
      id: "kilauea-episode-36",
      domain: "volcano",
      name: "Kīlauea, Episode 36",
      href: "/volcano/kilauea",
      state: "PUBLISHED_EXPLORATORY",
      // No "reproducible" stage: no run ID and no per-artifact digest map
      // is published (see Hayli Gubbi above).
      stages: ["catalogue", "observations", "processing", "exploratory", "quality_screened", "reference"],
      product: "NISAR_L2_GUNW_BETA",
      productMaturity: "BETA",
      observationDates: [],
      evidenceStatus: "EXPLORATORY",
      validationNote: "Reference patch stability is assumed and must be inspected; it is not surveyed ground truth. Context only.",
      nextStep: "A surveyed reference and independent geodetic comparison are needed before validation can complete.",
      checksumsPresent: false,
      integrity: "NOT_PUBLISHED",
      digests: null,
      publishedAt: null,
      runId: null,
    });
  }
  domains.push({ domain: "volcano", label: "Volcanoes", studies: volcano });

  // ── Agriculture ──
  const agriculture: StudyHealth[] = [];
  const agri = await readJson<{
    study_id: string;
    run_id?: string;
    evidence_status: string;
    release: string;
    observations: { date: string; source_sha256?: string }[];
  }>(publicPath("agriculture", "current", "study.json"));
  const agriIndex = await readJson<{ published_at: string }>(publicPath("agriculture", "current", "index.json"));
  if (agri) {
    // Digests are the per-observation source SHA-256 values declared in
    // study.json — one per acquisition date, not a hardcoded true.
    const agriDigests = Object.fromEntries(
      agri.observations.filter((o) => typeof o.source_sha256 === "string").map((o) => [o.date, o.source_sha256 as string]),
    );
    const agriChecksums =
      agri.observations.length > 0 && agri.observations.every((o) => typeof o.source_sha256 === "string");
    agriculture.push({
      id: agri.study_id,
      domain: "agriculture",
      name: "Naogaon (SME2 soil moisture)",
      href: "/agriculture",
      state: "PUBLISHED_EXPLORATORY",
      stages: ["catalogue", "observations", "processing", "exploratory", "quality_screened", "reproducible"],
      product: "NISAR_L3_SME2_PROVISIONAL_V1",
      productMaturity: "PROVISIONAL",
      observationDates: agri.observations.map((o) => o.date),
      evidenceStatus: agri.evidence_status ?? "EXPLORATORY",
      validationNote: "No independent reference: no crop mask, no IMERG rainfall context, no field validation. Four dates were excluded for zero valid pixels.",
      nextStep: "An independent reference (crop mask, rainfall context, or field measurements) is needed before validation can complete.",
      checksumsPresent: agriChecksums,
      integrity: "PUBLISHED_NOT_VERIFIED",
      digests: agriChecksums ? agriDigests : null,
      publishedAt: agriIndex?.published_at ?? null,
      runId: typeof agri.run_id === "string" ? agri.run_id : agri.study_id,
    });
  } else missing.push("public/agriculture/current/study.json");
  domains.push({ domain: "agriculture", label: "Agriculture", studies: agriculture });

  return { generatedAt: new Date().toISOString(), domains, missing };
}

/* Reproducible Investigation Capsule — pure builder.
 *
 * A capsule is a portable, structured evidence package for one published
 * study: geometry, source identifiers, processing version, configuration,
 * quality report, derived outputs, reference evidence, checksums, validation
 * status, and limitations — as JSON a reader can download, archive, and
 * re-check without the website.
 *
 * Honesty rules, enforced by the builder and pinned by tests:
 * - Nothing is promised that the package cannot do. Re-deriving a result
 *   needs the source granules (NASA Earthdata authentication) and the
 *   pipeline version named in the capsule; the capsule itself only proves
 *   the published artifacts are what they claim to be.
 * - A missing section is listed as missing, never filled with a placeholder.
 * - Validation status is copied from the study's own assessment, never upgraded.
 */

import type { QualityFigure } from "./evidence-quality";

export interface CapsuleReference {
  label: string;
  status: string;
  summary: string;
  sourceUrl?: string | null;
}

export interface CapsuleInput {
  studyId: string;
  studyName: string;
  domain: "wetland" | "forest" | "volcano" | "agriculture";
  href: string;
  product: string;
  productMaturity: string;
  runId: string | null;
  publishedAt: string | null;
  observationDates: string[];
  stagesReached: string[];
  stagesTotal: number;
  validationNote: string;
  nextStep: string;
  checksumsPresent: boolean;
  quality: QualityFigure[];
  references: CapsuleReference[];
  limitations: string[];
  method?: string | null;
  siteBounds?: [number, number, number, number] | null;
}

export interface InvestigationCapsule {
  capsuleVersion: 1;
  generatedAt: string;
  study: {
    id: string;
    name: string;
    domain: CapsuleInput["domain"];
    href: string;
    product: string;
    productMaturity: string;
    runId: string | null;
    publishedAt: string | null;
    observationDates: string[];
    siteBounds: [number, number, number, number] | null;
    method: string | null;
  };
  maturity: { stagesReached: string[]; stagesTotal: number };
  quality: QualityFigure[];
  references: CapsuleReference[];
  validation: { note: string; nextStep: string };
  limitations: string[];
  integrity: { checksumsPublished: boolean; verification: string };
  reproducibility: {
    status: "verifiable" | "partial" | "not-verifiable";
    requires: string[];
    note: string;
  };
}

const REPRODUCIBILITY_REQUIRES = [
  "Access to the source granules named in the study manifest (NASA Earthdata authentication)",
  "The pipeline/method version named in the study manifest",
  "The quality-screening rule documented in the study (e.g. the SME2 zero-clear rule for Naogaon)",
];

export function buildCapsule(input: CapsuleInput): InvestigationCapsule {
  const hasRun = input.runId !== null && input.runId.length > 0;
  const hasDates = input.observationDates.length > 0;
  const status: InvestigationCapsule["reproducibility"]["status"] =
    input.checksumsPresent && hasRun && hasDates
      ? "verifiable"
      : input.checksumsPresent || hasRun
        ? "partial"
        : "not-verifiable";
  return {
    capsuleVersion: 1,
    generatedAt: new Date().toISOString(),
    study: {
      id: input.studyId,
      name: input.studyName,
      domain: input.domain,
      href: input.href,
      product: input.product,
      productMaturity: input.productMaturity,
      runId: input.runId,
      publishedAt: input.publishedAt,
      observationDates: [...input.observationDates],
      siteBounds: input.siteBounds ?? null,
      method: input.method ?? null,
    },
    maturity: { stagesReached: [...input.stagesReached], stagesTotal: input.stagesTotal },
    quality: input.quality,
    references: input.references,
    validation: { note: input.validationNote, nextStep: input.nextStep },
    limitations: [...input.limitations],
    integrity: {
      checksumsPublished: input.checksumsPresent,
      verification: input.checksumsPresent
        ? "SHA-256 digests are published for this study's artifacts; re-hash the files and compare."
        : "No checksums are published for this study, so the artifacts in this capsule cannot be independently verified from the capsule alone.",
    },
    reproducibility: {
      status,
      requires: REPRODUCIBILITY_REQUIRES,
      note:
        status === "verifiable"
          ? "This capsule lets a reader verify the published artifacts and re-derive the result with the listed requirements. It does not reproduce the result on its own."
          : status === "partial"
            ? "Part of the reproduction trail is missing (see integrity and run ID above). The capsule records what exists; it does not fill the gap."
            : "The reproduction trail is not published for this study. The capsule records the result and its limits; it cannot support independent re-derivation.",
    },
  };
}

/** Download filename for a study capsule, e.g. `beyonders-capsule-tanguar-haor.json`. */
export function capsuleFilename(studyId: string): string {
  const safe = studyId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `beyonders-capsule-${safe || "study"}.json`;
}

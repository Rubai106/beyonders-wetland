/* Reproducible Investigation Capsule download.
 *
 * GET /api/capsule/<study-id> — returns one study's capsule as a JSON
 * download. The capsule is built from the same published manifests as
 * /observability (buildPlatformHealth) plus the evidence-quality figures
 * and the lineage chain's references, so a downloaded capsule can never
 * claim more than the website shows.
 *
 * Unknown study id -> 404 with the list of available ids. A study with no
 * lineage chain still gets a capsule; its references section is empty and
 * the capsule says so, instead of inventing references.
 */
import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildPlatformHealth, MATURITY_STAGES } from "@/lib/observation-health";
import { studyQuality } from "@/lib/evidence-quality";
import { buildCapsule, capsuleFilename } from "@/lib/investigation-capsule";
import type { CapsuleReference } from "@/lib/investigation-capsule";
import { loadLineageChains } from "@/lib/lineage-studies";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ study: string }> },
) {
  const limit = checkRateLimit(request, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  const { study: studyId } = await params;

  const health = await buildPlatformHealth();
  const study = health.domains.flatMap((d) => d.studies).find((s) => s.id === studyId);
  if (!study) {
    const available = health.domains.flatMap((d) => d.studies.map((s) => s.id));
    return NextResponse.json(
      { error: `Unknown study: ${studyId}`, available },
      { status: 404 },
    );
  }

  const quality = studyQuality(studyId);
  const { chains } = await loadLineageChains();
  const chain = chains.find((c) => {
    const haystack = normalize(`${c.study_title} ${c.site_name} ${c.study_id ?? ""}`);
    return haystack.includes(normalize(study.name.replace(/ \(SME2 soil moisture\)$/, "")));
  });
  const references: CapsuleReference[] = (chain?.references ?? []).map((r) => ({
    label: r.source,
    status: r.status,
    summary: r.summary,
    sourceUrl: r.source_url,
  }));
  const limitations = Array.from(
    new Set([
      ...(chain?.references ?? []).flatMap((r) => r.limitations),
      `Validation is not complete: ${study.nextStep}`,
    ]),
  );

  let siteBounds: [number, number, number, number] | null = null;
  if (studyId === "tanguar-haor") {
    try {
      const index = JSON.parse(
        await fs.readFile(path.join(process.cwd(), "public", "showcase", "index.json"), "utf-8"),
      ) as { cases?: { id?: string; site_bounds?: [number, number, number, number] }[] };
      siteBounds = index.cases?.find((c) => c.id === "featured")?.site_bounds ?? null;
    } catch {
      siteBounds = null;
    }
  }

  const capsule = buildCapsule({
    studyId: study.id,
    studyName: study.name,
    domain: study.domain,
    href: study.href,
    product: study.product,
    productMaturity: study.productMaturity,
    runId: study.runId,
    publishedAt: study.publishedAt,
    observationDates: study.observationDates,
    stagesReached: study.stages,
    stagesTotal: MATURITY_STAGES.length,
    validationNote: study.validationNote,
    nextStep: study.nextStep,
    checksumsPresent: study.checksumsPresent,
    quality: quality?.figures ?? [],
    references,
    limitations,
    method: chain?.method.id ?? null,
    siteBounds,
  });

  return new NextResponse(JSON.stringify(capsule, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${capsuleFilename(study.id)}"`,
      "cache-control": "no-store",
    },
  });
}

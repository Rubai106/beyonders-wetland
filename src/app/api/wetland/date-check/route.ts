import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { pipelineRun, readPipelineOutput, PipelineOutputError } from "@/lib/pipeline-output";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  try {
    const run = pipelineRun(request.nextUrl.searchParams.get("run"));
    if (run.manifest.data_source !== "NISAR") throw new PipelineOutputError("Choose a real NISAR run.", 400);
    const date = request.nextUrl.searchParams.get("date") || "";
    const observations = readPipelineOutput("observations.json", run) as { date: string }[];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !observations.some((item) => item.date === date)) {
      throw new PipelineOutputError("Choose a processed observation date.", 400);
    }
    const folder = path.join(run.folder, "date_checks", date);
    const referencePath = path.join(folder, "reference_validation.json");
    const hasDateReference = fs.existsSync(referencePath);
    const sourceReferencePath = hasDateReference ? referencePath : path.join(run.folder, "reference_validation.json");
    if (!fs.existsSync(sourceReferencePath)) return NextResponse.json({ available: false, date }, { headers: { "Cache-Control": "no-store" } });
    const reference = JSON.parse(fs.readFileSync(sourceReferencePath, "utf8")) as Record<string, unknown>;
    const referenceEventDate = (reference.comparison as { event?: { nisar_date?: string } } | null)?.event?.nisar_date;
    if (!hasDateReference && referenceEventDate !== date) {
      return NextResponse.json({ available: false, date, reason: "No independent HLS check is saved for this observation date." }, { headers: { "Cache-Control": "no-store" } });
    }
    const evidencePath = path.join(folder, "evidence.json");
    const evidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, "utf8")) as Record<string, unknown> : null;
    const validEvidence = evidence?.run_id === run.manifest.run_id && evidence?.event_date === date &&
      evidence?.counts_reproduced === true && JSON.stringify(evidence?.comparison) === JSON.stringify(reference.comparison);
    const visuals = validEvidence ? evidence?.visuals as { images?: Record<string, string> } | undefined : undefined;
    const images = visuals?.images || {};
    let candidateCoverage = validEvidence ? evidence?.candidate_coverage ?? null : null;
    let patchContext = validEvidence ? evidence?.patch_context ?? null : null;
    if ((!patchContext || !candidateCoverage) && referenceEventDate === date) {
      try {
        const primaryEvidence = readPipelineOutput("reference_evidence.json", run) as Record<string, unknown>;
        if (primaryEvidence.run_id === run.manifest.run_id && primaryEvidence.event_date === date && primaryEvidence.counts_reproduced === true &&
            JSON.stringify(primaryEvidence.comparison) === JSON.stringify(reference.comparison)) {
          candidateCoverage ??= primaryEvidence.candidate_coverage ?? null;
          patchContext ??= primaryEvidence.patch_context ?? null;
        }
      } catch {
        // A saved date comparison remains usable when the primary evidence package is absent.
      }
    }
    const file = request.nextUrl.searchParams.get("file");
    if (file) {
      if (!/^reference_[a-z_]+\.png$/.test(file) || !Object.values(images).includes(file)) {
        throw new PipelineOutputError("That date-check image is unavailable.", 404);
      }
      const target = path.join(folder, file);
      if (!fs.existsSync(target)) throw new PipelineOutputError("Date-check image is missing.", 404);
      return new NextResponse(fs.readFileSync(target), { headers: {
        "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      } });
    }
    return NextResponse.json({
      available: true, date, status: reference.status, reason: reference.reason ?? null,
      comparison: reference.comparison ?? null, coverage: reference.coverage ?? null,
      optical_support: reference.optical_support ?? null,
      candidate_coverage: candidateCoverage,
      patch_context: patchContext,
      radar_only_categories: validEvidence ? evidence?.radar_only_categories : null,
      images: validEvidence ? images : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Date check unavailable." },
      { status: error instanceof PipelineOutputError ? error.status : 500 });
  }
}

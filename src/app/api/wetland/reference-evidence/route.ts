import { NextRequest, NextResponse } from "next/server";
import { pipelineRun, PipelineOutputError } from "@/lib/pipeline-output";
import { referenceEvidence } from "@/lib/reference-evidence";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  try {
    const run = pipelineRun(request.nextUrl.searchParams.get("run"));
    if (run.manifest.data_source !== "NISAR") throw new PipelineOutputError("Choose a real NISAR run.", 400);
    return NextResponse.json(referenceEvidence(run), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reference evidence unavailable." },
      { status: error instanceof PipelineOutputError ? error.status : 500 });
  }
}

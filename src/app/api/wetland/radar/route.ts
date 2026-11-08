import { NextRequest, NextResponse } from "next/server";
import { pipelineRun, PipelineOutputError, readPipelineOutput } from "@/lib/pipeline-output";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  try {
    const run = pipelineRun(request.nextUrl.searchParams.get("run"));
    if (run.manifest.data_source !== "NISAR") throw new PipelineOutputError("Choose a real NISAR result.", 400);
    const observations = readPipelineOutput("observations.json", run) as { date: string }[];
    const date = request.nextUrl.searchParams.get("date") || String(run.manifest.selected_date);
    const index = observations.findIndex((item) => item.date === date);
    if (index < 0) throw new PipelineOutputError("No processed radar layers for that date.", 400);
    const preview = readPipelineOutput(`radar_preview_${String(index).padStart(2, "0")}.json`, run);
    return NextResponse.json(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Radar images unavailable." },
      { status: error instanceof PipelineOutputError ? error.status : 500 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { PipelineOutputError, pipelineRun, readPipelineOutput } from "@/lib/pipeline-output";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  try {
    const run = pipelineRun();
    const sensitivity = readPipelineOutput("sensitivity_results.json", run) as Record<string, unknown>;
    if (!Array.isArray(sensitivity.thresholds) || !Array.isArray(sensitivity.stable_range)) throw new Error("Invalid sensitivity.");
    const dataSource = run.manifest.data_source === "SIMULATED_DEMO" ? "SIMULATED_DEMO" : run.manifest.data_source === "NISAR" ? "NISAR" : "UNVERIFIED";
    return NextResponse.json({ ...sensitivity, run_id: run.manifest.run_id,
      data_source: dataSource });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PipelineOutputError ? error.message : "Invalid pipeline sensitivity output." },
      { status: error instanceof PipelineOutputError ? error.status : 500 });
  }
}

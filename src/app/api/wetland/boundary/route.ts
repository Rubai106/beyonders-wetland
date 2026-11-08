import { NextResponse, type NextRequest } from "next/server";
import { PipelineOutputError, pipelineRun, readPipelineOutput } from "@/lib/pipeline-output";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  try {
    const run = pipelineRun();
    if (run.manifest.data_source !== "NISAR") {
      throw new PipelineOutputError("The current pipeline run has no observed wetland boundary.", 404);
    }
    const boundary = readPipelineOutput("site_boundary.geojson", run) as { type?: unknown; features?: unknown };
    if (boundary.type !== "FeatureCollection" || !Array.isArray(boundary.features) || !boundary.features.length) {
      throw new Error("Invalid wetland boundary file.");
    }
    return NextResponse.json(boundary, { headers: { "x-pipeline-run-id": String(run.manifest.run_id) } });
  } catch (error) {
    const status = error instanceof PipelineOutputError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid pipeline boundary output." }, { status });
  }
}

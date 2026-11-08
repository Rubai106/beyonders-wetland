import { NextResponse, type NextRequest } from "next/server";
import { PipelineOutputError, pipelineRun, readPipelineOutput } from "@/lib/pipeline-output";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  try {
    const run = pipelineRun();
    const pulse = readPipelineOutput("wetland_pulse.json", run) as Record<string, unknown>;
    if (!Array.isArray(pulse.dates) || typeof pulse.wetland_area_km2 !== "number" || pulse.wetland_area_km2 <= 0) throw new Error("Invalid pulse.");
    const dataSource = run.manifest.data_source === "SIMULATED_DEMO" ? "SIMULATED_DEMO" : run.manifest.data_source === "NISAR" ? "NISAR" : "UNVERIFIED";
    return NextResponse.json({ ...pulse, run_id: run.manifest.run_id,
      data_source: dataSource, product: run.manifest.product,
      product_maturity: run.manifest.product_maturity, reference_validated: run.manifest.reference_validated,
      cross_sensor_check_completed: run.manifest.cross_sensor_check_completed === true,
      reference_check_status: run.manifest.reference_check_status ?? "NOT_RUN",
      baseline_date: run.manifest.baseline_date, quality_mask_method: run.manifest.quality_mask_method,
      site_bounds: run.manifest.site_bounds, wetland_boundary_source: run.manifest.wetland_boundary_source });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PipelineOutputError ? error.message : "Invalid pipeline pulse output." },
      { status: error instanceof PipelineOutputError ? error.status : 500 });
  }
}

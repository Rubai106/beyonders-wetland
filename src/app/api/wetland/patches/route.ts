import { NextRequest, NextResponse } from "next/server";
import { PipelineOutputError, pipelineRun, readPipelineOutput } from "@/lib/pipeline-output";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const limit = checkRateLimit(req, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  try {
    const run = pipelineRun();
    let filename = "patches_final.geojson";
    const date = req.nextUrl.searchParams.get("date");
    if (date !== null) {
      const observations = readPipelineOutput("observations.json", run) as { date: string; patches_file: string }[];
      const observation = observations.find((item) => item.date === date);
      if (!observation) return NextResponse.json({ error: "Date is not present in the completed run." }, { status: 400 });
      filename = observation.patches_file;
    }
    const output = readPipelineOutput(filename, run) as { features?: unknown };
    if (!Array.isArray(output.features)) throw new Error("Missing feature array.");
    const patches = output.features.map((feature: unknown) => {
      if (!feature || typeof feature !== "object") throw new Error("Invalid feature.");
      const geoFeature = feature as { properties?: unknown; geometry?: unknown };
      const properties = geoFeature.properties;
      if (!properties || typeof properties !== "object") throw new Error("Missing properties.");
      const geometry = geoFeature.geometry as { type?: unknown; coordinates?: unknown } | null;
      if (!geometry || !["Polygon", "MultiPolygon"].includes(String(geometry.type)) || !Array.isArray(geometry.coordinates)) {
        throw new Error("Missing region geometry.");
      }
      const patch = properties as Record<string, unknown>;
      const centroid = patch.centroid;
      if (!Array.isArray(centroid) || centroid.length !== 2 ||
          !centroid.every((n) => typeof n === "number" && Number.isFinite(n)) ||
          Math.abs(centroid[0]) > 90 || Math.abs(centroid[1]) > 180) throw new Error("Invalid WGS84 centroid.");
      for (const key of ["area_km2", "mean_delta_db", "median_delta_db", "valid_fraction", "vegetated_fraction",
                         "hh_before", "hh_after", "hv_before", "hv_after", "delta_hh", "delta_hv"]) {
        if (typeof patch[key] !== "number" || !Number.isFinite(patch[key])) throw new Error("Missing numeric patch statistics.");
      }
      if (typeof patch.id !== "string" || typeof patch.date !== "string" ||
          !["OPEN_WATER", "VEGETATED_INUNDATION", "UNCERTAIN"].includes(String(patch.classification))) throw new Error("Invalid patch identity or class.");
      const dataSource = run.manifest.data_source === "SIMULATED_DEMO" ? "SIMULATED_DEMO" : run.manifest.data_source === "NISAR" ? "NISAR" : "UNVERIFIED";
      return { ...patch, centroid, geometry, run_id: run.manifest.run_id, data_source: dataSource };
    });
    return NextResponse.json(patches, { headers: { "x-pipeline-run-id": String(run.manifest.run_id) } });
  } catch (error) {
    const status = error instanceof PipelineOutputError ? error.status : 500;
    return NextResponse.json({ error: error instanceof PipelineOutputError ? error.message : "Invalid pipeline patch output." }, { status });
  }
}

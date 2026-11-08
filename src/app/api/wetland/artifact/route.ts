import { publicViewer } from "@/lib/app-mode";
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { pipelineRun, readPipelineOutput, PipelineOutputError } from "@/lib/pipeline-output";
import { referenceEvidence } from "@/lib/reference-evidence";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  try {
    const run = pipelineRun(request.nextUrl.searchParams.get("run"));
    if (run.manifest.data_source !== "NISAR") throw new PipelineOutputError("Choose a real NISAR run.", 400);
    const file = request.nextUrl.searchParams.get("file") || "";
    if (!/^[a-zA-Z0-9_]+\.(png|tif|json|geojson)$/.test(file)) throw new PipelineOutputError("Invalid artifact filename.", 400);
    if (publicViewer()) {
      const publication = readPipelineOutput("publication.json", run) as { downloads?: Record<string, string> };
      const external = publication.downloads?.[file];
      if (external) return NextResponse.redirect(external);
      const target = path.join(run.folder, file);
      if (!fs.existsSync(target)) throw new PipelineOutputError("This source artifact is available only in the local study; an operator can publish it as a release download.", 404);
      return NextResponse.redirect(new URL(`/studies/releases/${run.manifest.publication_version}/runs/${run.manifest.run_id}/${file}`, request.url));
    }
    const observations = readPipelineOutput("observations.json", run) as { patches_file: string; classification_file: string; rasters: Record<string, string> }[];
    const allowed = new Set(["case_study.json", "reference_validation.json", "site_boundary.geojson", "wetland_pulse.json"]);
    if (file.startsWith("reference_") && file !== "reference_validation.json") {
      const evidence = referenceEvidence(run);
      evidence.artifacts.filter((name) => /^reference_[a-z_]+\.(png|tif|json)$/.test(name)).forEach((name) => allowed.add(name));
    }
    observations.forEach((item, index) => {
      allowed.add(item.patches_file); allowed.add(item.classification_file);
      Object.values(item.rasters).forEach((name) => allowed.add(name));
      for (const channel of ["hh", "hv"]) for (const stage of ["before", "after", "change"]) allowed.add(`radar_${String(index).padStart(2, "0")}_${channel}_${stage}.png`);
    });
    if (!allowed.has(file)) throw new PipelineOutputError("That file is not a published result artifact.", 404);
    const target = path.join(run.folder, file);
    if (!fs.existsSync(target)) throw new PipelineOutputError("That artifact has not been generated.", 404);
    const type = file.endsWith(".png") ? "image/png" : file.endsWith(".tif") ? "image/tiff" : "application/json";
    const download = request.nextUrl.searchParams.has("download") || file.endsWith(".tif");
    return new NextResponse(fs.readFileSync(target), { headers: {
      "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      ...(download ? { "Content-Disposition": `attachment; filename="${file}"` } : {}),
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Artifact unavailable." },
      { status: error instanceof PipelineOutputError ? error.status : 500 });
  }
}

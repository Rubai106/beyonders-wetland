import { publicViewer } from "@/lib/app-mode";
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { PipelineOutputError, pipelineRun, readPipelineOutput } from "@/lib/pipeline-output";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

const execFileAsync = promisify(execFile);

export async function GET(req: NextRequest) {
  const limit = checkRateLimit(req, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  if (publicViewer()) return NextResponse.json({ error: "Exact raster probing is available in the local operator application." }, { status: 403 });
  const latStr = req.nextUrl.searchParams.get("lat")?.trim();
  const lngStr = req.nextUrl.searchParams.get("lng")?.trim();
  const date = req.nextUrl.searchParams.get("date");
  const lat = Number(latStr), lng = Number(lngStr);
  if (!latStr || !lngStr || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "Invalid lat/lng parameters." }, { status: 400 });
  }
  try {
    const run = pipelineRun(req.nextUrl.searchParams.get("run"));
    if (date !== null) {
      const observations = readPipelineOutput("observations.json", run) as { date: string }[];
      if (!observations.some((item) => item.date === date)) return NextResponse.json({ error: "Date is not present in the completed run." }, { status: 400 });
    }
    const bundledVenv = path.join(process.cwd(), "pipeline", "venv", process.platform === "win32" ? "Scripts" : "bin",
                                   process.platform === "win32" ? "python.exe" : "python");
    const python = process.env.PYTHON_EXECUTABLE || (fs.existsSync(bundledVenv) ? bundledVenv : process.platform === "win32" ? "python" : "python3");
    const args = [path.join(process.cwd(), "pipeline", "probe_pixel.py"), "--lat", String(lat), "--lng", String(lng),
                  "--run-id", String(run.manifest.run_id), ...(date !== null ? ["--date", date] : [])];
    const { stdout } = await execFileAsync(python, args, { cwd: process.cwd(), timeout: 15000, maxBuffer: 65536 });
    return NextResponse.json(JSON.parse(stdout.trim()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof PipelineOutputError ? error.message : "Raster probe failed; check the pipeline run and Python environment." },
      { status: error instanceof PipelineOutputError ? error.status : 500 });
  }
}

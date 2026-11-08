import { publicViewer } from "@/lib/app-mode";
import { pythonRuntime } from "@/lib/python-runtime";
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const jobs = path.join(process.cwd(), "pipeline", "output", "jobs");
const activePath = path.join(jobs, "active.json");
const idPattern = /^[a-f0-9]{32}$/;
const python = publicViewer() ? "" : pythonRuntime();
const loginCommand = python ? `& "${python}" -c "import earthaccess; earthaccess.login(persist=True)"` : "";
type Job = { id: string; status: string; action: string; stage?: string; pid?: number; error?: string; result?: unknown };

function localOrigin(request: NextRequest) {
  try {
    const origin = new URL(request.headers.get("origin") || "");
    return origin.host === request.headers.get("host") && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  } catch { return false; }
}

function readJob(id: string): Job {
  if (!idPattern.test(id)) throw new Error("Invalid processing job.");
  const job = JSON.parse(fs.readFileSync(path.join(jobs, `${id}.json`), "utf8")) as Job;
  if (["QUEUED", "RUNNING"].includes(job.status) && job.pid) {
    try { process.kill(job.pid, 0); } catch {
      job.status = "FAILED"; job.error = "The local processing worker stopped. Start a new search or run.";
      fs.writeFileSync(path.join(jobs, `${id}.json`), JSON.stringify(job));
      const pipelineLock = path.join(process.cwd(), "pipeline", "output", ".run.lock");
      try { if (JSON.parse(fs.readFileSync(pipelineLock, "utf8")).pid === job.pid) fs.unlinkSync(pipelineLock); } catch { /* Another CLI run or no lock. */ }
      try { if (JSON.parse(fs.readFileSync(activePath, "utf8")).id === id) fs.unlinkSync(activePath); } catch { /* Already released. */ }
    }
  }
  return job;
}

export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  if (publicViewer()) return NextResponse.json({ mode: "public", job: null, message: "Processing is managed by local operators." });
  try {
    const id = request.nextUrl.searchParams.get("id") || (fs.existsSync(activePath) ? JSON.parse(fs.readFileSync(activePath, "utf8")).id : "");
    const job = id ? readJob(id) : null;
    let areaRequest = null;
    if (job && ["search", "run"].includes(job.action)) {
      const saved = JSON.parse(fs.readFileSync(path.join(jobs, `${id}_request.json`), "utf8"));
      areaRequest = { siteName: saved.siteName, bbox: saved.bbox, boundary: saved.boundary ?? null,
        startDate: saved.startDate, endDate: saved.endDate, sceneNames: saved.sceneNames };
    }
    return NextResponse.json({ job, areaRequest, loginCommand }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "That processing job could not be loaded.", loginCommand }, { status: 404 });
  }
}

export async function POST(request: NextRequest) {
  const limit = checkRateLimit(request, "job");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  if (publicViewer()) return NextResponse.json({ error: "Public viewer: processing is available only to local operators." }, { status: 403 });
  if (!localOrigin(request)) return NextResponse.json({ error: "Start processing from the local application page." }, { status: 403 });
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 1_000_000) return NextResponse.json({ error: "Use a boundary GeoJSON smaller than 1 MB." }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || !["search", "run", "reference", "preview", "evidence"].includes(String(body.action))) return NextResponse.json({ error: "Choose a supported processing action." }, { status: 400 });
  const id = randomUUID().replaceAll("-", "");
  fs.mkdirSync(jobs, { recursive: true });
  if (fs.existsSync(activePath)) {
    try {
      const active = JSON.parse(fs.readFileSync(activePath, "utf8"));
      const job = readJob(active.id);
      if (["QUEUED", "RUNNING"].includes(job.status)) return NextResponse.json({ error: "Another job is running. Its progress is shown below.", job }, { status: 409 });
      fs.unlinkSync(activePath);
    } catch { if (fs.existsSync(activePath)) fs.unlinkSync(activePath); }
  }
  if (path.isAbsolute(python) && !fs.existsSync(python)) return NextResponse.json({ error: "The local pipeline Python environment is missing." }, { status: 503 });
  let log: number | undefined;
  try {
    fs.writeFileSync(activePath, JSON.stringify({ id }), { flag: "wx" });
    fs.writeFileSync(path.join(jobs, `${id}_request.json`), JSON.stringify(body));
    const job: Job = { id, action: String(body.action), status: "QUEUED", stage: "Starting local processor" };
    fs.writeFileSync(path.join(jobs, `${id}.json`), JSON.stringify(job));
    log = fs.openSync(path.join(jobs, `${id}.log`), "a");
    const child = spawn(python, ["pipeline/web_job.py", id], {
      cwd: process.cwd(), windowsHide: true, detached: true, stdio: ["ignore", log, log],
    });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    job.pid = child.pid;
    // The worker owns its status file once it starts; don't overwrite its progress.
    const initial = JSON.parse(fs.readFileSync(path.join(jobs, `${id}.json`), "utf8"));
    if (initial.status === "QUEUED") fs.writeFileSync(path.join(jobs, `${id}.json`), JSON.stringify(job));
    child.unref();
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    if (fs.existsSync(activePath)) {
      try { if (JSON.parse(fs.readFileSync(activePath, "utf8")).id === id) fs.unlinkSync(activePath); } catch { /* Preserve another worker's lock. */ }
    }
    const code = (error as NodeJS.ErrnoException).code;
    return NextResponse.json({ error: code === "EEXIST" ? "Another job just started. Try again when it finishes." : "Could not start the local processor." }, { status: code === "EEXIST" ? 409 : 500 });
  } finally { if (log !== undefined) fs.closeSync(log); }
}

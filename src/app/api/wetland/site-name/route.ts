import { publicViewer } from "@/lib/app-mode";
import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

const DEFAULT_SITE_NAME = "Hakaluki Haor";
const CONFIG_PATH = path.join(process.cwd(), "pipeline", "config.yaml");
const OUTPUT_DIRECTORY = path.join(process.cwd(), "pipeline", "output");
const OVERRIDE_PATH = path.join(OUTPUT_DIRECTORY, "site_name_override.json");

function isLocalSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;

  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host === host && ["localhost", "127.0.0.1", "[::1]"].includes(parsedOrigin.hostname);
  } catch {
    return false;
  }
}

function validateSiteName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 80 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

async function readConfiguredSiteName() {
  try {
    const lines = (await readFile(CONFIG_PATH, "utf8")).split(/\r?\n/);
    const siteIndex = lines.findIndex((line) => /^site:\s*$/.test(line));
    const nameLine = siteIndex < 0 ? undefined : lines.slice(siteIndex + 1).find((line) => /^\s+name:\s*/.test(line));
    const match = nameLine?.match(/^\s+name:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/);
    return match?.[1] ?? match?.[2] ?? match?.[3] ?? DEFAULT_SITE_NAME;
  } catch {
    return DEFAULT_SITE_NAME;
  }
}

async function readSavedSiteName(configuredName: string) {
  try {
    const content = await readFile(OVERRIDE_PATH, "utf8");
    const saved = JSON.parse(content) as { site_name?: unknown };
    return validateSiteName(saved.site_name) ? saved.site_name.trim() : configuredName;
  } catch {
    return configuredName;
  }
}

export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  if (publicViewer()) return NextResponse.json({ siteName: "Published study", configuredSiteName: "Published study", mode: "public" });
  const configuredSiteName = await readConfiguredSiteName();
  return NextResponse.json(
    { siteName: await readSavedSiteName(configuredSiteName), configuredSiteName },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const limit = checkRateLimit(request, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  if (publicViewer()) return NextResponse.json({ error: "Public study settings are read-only." }, { status: 403 });
  if (!isLocalSameOrigin(request)) {
    return NextResponse.json({ error: "Save this setting from the local application page." }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2048) {
    return NextResponse.json({ error: "Study-area name request is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const siteName = (body as { siteName?: unknown } | null)?.siteName;
  if (!validateSiteName(siteName)) {
    return NextResponse.json({ error: "Enter a 2–80 character name without line breaks or control characters." }, { status: 400 });
  }

  const normalizedName = siteName.trim();
  const temporaryPath = path.join(OUTPUT_DIRECTORY, `.site-name-${randomUUID()}.tmp`);
  try {
    await mkdir(OUTPUT_DIRECTORY, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify({ site_name: normalizedName, updated_at: new Date().toISOString() }, null, 2)}\n`, "utf8");
    await rename(temporaryPath, OVERRIDE_PATH);
    return NextResponse.json({ siteName: normalizedName, saved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    return NextResponse.json({ error: "Could not save the name for the next pipeline run." }, { status: 500 });
  }
}

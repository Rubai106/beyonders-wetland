import { NextRequest, NextResponse } from "next/server";
import {
  buildDynamicWorldArtifactDiscoveryResult,
  buildDynamicWorldArtifactOptions,
  DYNAMIC_WORLD_WORKFLOW_PATH,
} from "@/lib/agriculture-dynamic-world-artifact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REPOSITORY = "Rubai106/beyonders-wetland";
const API_ROOT = "https://api.github.com/repos/" + REPOSITORY;
const WORKFLOW_DISPATCH_EVENT = "workflow_dispatch";
const MAX_RUNS_TO_INSPECT = 10;

type GitHubWorkflowRuns = { workflow_runs?: unknown[] };
type GitHubArtifacts = { artifacts?: unknown[] };

function jsonError(message: string, status: number, retryable: boolean) {
  return NextResponse.json(
    { error: message, retryable },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Beyonders-Agriculture-Artifact-Discovery/1.0",
  };
}

async function fetchArtifactList(runId: number): Promise<[string, unknown[]]> {
  const response = await fetch(
    API_ROOT + "/actions/runs/" + runId + "/artifacts?per_page=20",
    {
      headers: githubHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) return [String(runId), []];
  const payload = await response.json() as GitHubArtifacts;
  return [String(runId), Array.isArray(payload.artifacts) ? payload.artifacts : []];
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.get("host")) {
        return jsonError("Cross-origin artifact discovery is not allowed.", 403, false);
      }
    } catch {
      return jsonError("Invalid request origin.", 403, false);
    }
  }

  try {
    const response = await fetch(
      API_ROOT + "/actions/runs?branch=master&event=" + WORKFLOW_DISPATCH_EVENT + "&per_page=100",
      {
        headers: githubHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        return jsonError(
          "GitHub is rate-limiting public Actions metadata. Retry shortly or enter a run ID manually.",
          503,
          true,
        );
      }
      return jsonError(
        "GitHub Actions run metadata is unavailable (HTTP " + response.status + ").",
        502,
        response.status >= 500,
      );
    }

    const payload = await response.json() as GitHubWorkflowRuns;
    const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
    const matchingRuns = runs.filter((run) => {
      if (!run || typeof run !== "object" || Array.isArray(run)) return false;
      const item = run as Record<string, unknown>;
      return item.path === DYNAMIC_WORLD_WORKFLOW_PATH &&
        item.event === WORKFLOW_DISPATCH_EVENT &&
        item.head_branch === "master" &&
        item.status === "completed" &&
        item.conclusion === "success" &&
        item.repository !== null && typeof item.repository === "object" &&
        (item.repository as Record<string, unknown>).full_name === REPOSITORY &&
        item.head_repository !== null && typeof item.head_repository === "object" &&
        (item.head_repository as Record<string, unknown>).full_name === REPOSITORY;
    }).slice(0, MAX_RUNS_TO_INSPECT);

    const artifactPairs = await Promise.all(
      matchingRuns.map((run) => {
        const id = (run as Record<string, unknown>).id;
        return typeof id === "number" && Number.isSafeInteger(id) && id > 0
          ? fetchArtifactList(id).catch(() => [String(id), []] as [string, unknown[]])
          : Promise.resolve(["invalid", []] as [string, unknown[]]);
      }),
    );
    const artifactsByRunId = Object.fromEntries(artifactPairs);
    const artifacts = buildDynamicWorldArtifactOptions(matchingRuns, artifactsByRunId);
    const result = buildDynamicWorldArtifactDiscoveryResult(artifacts);

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-Dynamic-World-Workflow": DYNAMIC_WORLD_WORKFLOW_PATH,
      },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return jsonError(
      timedOut
        ? "GitHub Actions metadata lookup timed out. Retry, or enter a run ID manually."
        : "Could not read public GitHub Actions metadata. Retry, or enter a run ID manually.",
      504,
      true,
    );
  }
}

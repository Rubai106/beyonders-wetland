export const DYNAMIC_WORLD_WORKFLOW_PATH = ".github/workflows/agriculture-dynamic-world.yml";
export const DYNAMIC_WORLD_ARTIFACT_PREFIX = "agriculture-dynamic-world-crop-evidence-";
export const DYNAMIC_WORLD_REPOSITORY = "Rubai106/beyonders-wetland";

export interface DynamicWorldArtifactOption {
  run_id: number;
  run_number: number;
  created_at: string;
  run_url: string;
  head_sha: string;
  artifact_id: number;
  artifact_name: string;
  artifact_size_bytes: number;
  expires_at: string;
}

export interface DynamicWorldArtifactDiscoveryResult {
  schema_version: 1;
  checked_at: string;
  status: "AVAILABLE" | "NO_SUCCESSFUL_ARTIFACT";
  artifacts: DynamicWorldArtifactOption[];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20 || value.length > 40) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && value.includes("T") && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function isOption(value: unknown): value is DynamicWorldArtifactOption {
  if (!isRecord(value) ||
      !isPositiveSafeInteger(value.run_id) ||
      !isPositiveSafeInteger(value.run_number) ||
      !isIsoTimestamp(value.created_at) ||
      !isIsoTimestamp(value.expires_at) ||
      typeof value.head_sha !== "string" || !/^[a-f0-9]{40}$/i.test(value.head_sha) ||
      !isPositiveSafeInteger(value.artifact_id) ||
      value.artifact_name !== DYNAMIC_WORLD_ARTIFACT_PREFIX + value.run_id ||
      !isPositiveSafeInteger(value.artifact_size_bytes)) return false;

  return value.run_url ===
    "https://github.com/" + DYNAMIC_WORLD_REPOSITORY + "/actions/runs/" + value.run_id;
}

/** Runtime guard for the small, public metadata response consumed by the Operator panel. */
export function isDynamicWorldArtifactDiscoveryResult(
  value: unknown,
): value is DynamicWorldArtifactDiscoveryResult {
  if (!isRecord(value) || value.schema_version !== 1 ||
      !isIsoTimestamp(value.checked_at) ||
      !Array.isArray(value.artifacts) || value.artifacts.length > 10 ||
      !value.artifacts.every(isOption)) return false;

  const artifacts = value.artifacts as DynamicWorldArtifactOption[];
  if (new Set(artifacts.map((item) => item.run_id)).size !== artifacts.length) return false;
  if (value.status !== (artifacts.length > 0 ? "AVAILABLE" : "NO_SUCCESSFUL_ARTIFACT")) return false;

  return artifacts.every((item, index) => index === 0 ||
    Date.parse(artifacts[index - 1].created_at) >= Date.parse(item.created_at));
}

/**
 * Build a safe list from untrusted public GitHub Actions API responses.
 * Only completed, successful, master-branch workflow_dispatch runs from this
 * exact workflow/repository can contribute an unexpired, correctly named
 * artifact created by that same run.
 */
export function buildDynamicWorldArtifactOptions(
  workflowRuns: unknown[],
  artifactsByRunId: Record<string, unknown[]>,
  now = Date.now(),
): DynamicWorldArtifactOption[] {
  const output: DynamicWorldArtifactOption[] = [];
  const seen = new Set<number>();

  for (const run of workflowRuns) {
    if (!isRecord(run) ||
        !isPositiveSafeInteger(run.id) ||
        !isPositiveSafeInteger(run.run_number) ||
        run.path !== DYNAMIC_WORLD_WORKFLOW_PATH ||
        run.event !== "workflow_dispatch" ||
        run.head_branch !== "master" ||
        run.status !== "completed" ||
        run.conclusion !== "success" ||
        !isRecord(run.repository) ||
        run.repository.full_name !== DYNAMIC_WORLD_REPOSITORY ||
        !isRecord(run.head_repository) ||
        run.head_repository.full_name !== DYNAMIC_WORLD_REPOSITORY ||
        typeof run.head_sha !== "string" ||
        !/^[a-f0-9]{40}$/i.test(run.head_sha) ||
        !isIsoTimestamp(run.created_at) ||
        run.html_url !== "https://github.com/" + DYNAMIC_WORLD_REPOSITORY + "/actions/runs/" + run.id ||
        seen.has(run.id)) continue;

    const artifacts = artifactsByRunId[String(run.id)];
    if (!Array.isArray(artifacts)) continue;

    const artifact = artifacts.find((candidate) => {
      if (!isRecord(candidate) ||
          !isPositiveSafeInteger(candidate.id) ||
          candidate.name !== DYNAMIC_WORLD_ARTIFACT_PREFIX + run.id ||
          candidate.expired !== false ||
          !isPositiveSafeInteger(candidate.size_in_bytes) ||
          !isIsoTimestamp(candidate.created_at) ||
          !isIsoTimestamp(candidate.expires_at) ||
          Date.parse(candidate.expires_at) <= now ||
          !isRecord(candidate.workflow_run) ||
          candidate.workflow_run.id !== run.id) return false;
      return true;
    });
    if (!isRecord(artifact)) continue;

    output.push({
      run_id: run.id,
      run_number: run.run_number,
      created_at: run.created_at,
      run_url: run.html_url as string,
      head_sha: run.head_sha,
      artifact_id: artifact.id as number,
      artifact_name: artifact.name as string,
      artifact_size_bytes: artifact.size_in_bytes as number,
      expires_at: artifact.expires_at as string,
    });
    seen.add(run.id);
  }

  return output.sort((left, right) =>
    right.created_at.localeCompare(left.created_at) ||
    right.run_id - left.run_id
  ).slice(0, 10);
}

export function buildDynamicWorldArtifactDiscoveryResult(
  artifacts: DynamicWorldArtifactOption[],
  checkedAt = new Date().toISOString(),
): DynamicWorldArtifactDiscoveryResult {
  return {
    schema_version: 1,
    checked_at: checkedAt,
    status: artifacts.length > 0 ? "AVAILABLE" : "NO_SUCCESSFUL_ARTIFACT",
    artifacts,
  };
}

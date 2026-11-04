import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDynamicWorldArtifactDiscoveryResult,
  buildDynamicWorldArtifactOptions,
  DYNAMIC_WORLD_ARTIFACT_PREFIX,
  DYNAMIC_WORLD_WORKFLOW_PATH,
  isDynamicWorldArtifactDiscoveryResult,
} from "./agriculture-dynamic-world-artifact";

const repo = "Rubai106/beyonders-wetland";
const sha = "a".repeat(40);
const now = Date.parse("2026-11-04T12:00:00.000Z");

function run(id: number, created = "2026-11-04T10:00:00.000Z") {
  return {
    id,
    run_number: id % 100000,
    path: DYNAMIC_WORLD_WORKFLOW_PATH,
    event: "workflow_dispatch",
    head_branch: "master",
    status: "completed",
    conclusion: "success",
    head_sha: sha,
    created_at: created,
    html_url: `https://github.com/${repo}/actions/runs/${id}`,
    repository: { full_name: repo },
    head_repository: { full_name: repo },
  };
}

function artifact(id: number, options: Record<string, unknown> = {}) {
  return {
    id: id + 1000,
    name: DYNAMIC_WORLD_ARTIFACT_PREFIX + id,
    size_in_bytes: 1024,
    expired: false,
    created_at: "2026-11-04T10:05:00.000Z",
    expires_at: "2026-12-04T10:05:00.000Z",
    workflow_run: { id },
    ...options,
  };
}

test("lists only successful master Dynamic World workflow_dispatch artifacts", () => {
  const runs = [
    run(101, "2026-11-04T11:00:00.000Z"),
    { ...run(102), event: "push" },
    { ...run(103), path: ".github/workflows/agriculture-cloud.yml" },
    { ...run(104), head_branch: "rubai-dev" },
    { ...run(105), conclusion: "failure" },
    { ...run(106), status: "in_progress" },
    { ...run(107), head_repository: { full_name: "someone/fork" } },
  ];
  const options = buildDynamicWorldArtifactOptions(runs, {
    "101": [artifact(101)],
    "102": [artifact(102)],
    "103": [artifact(103)],
    "104": [artifact(104)],
    "105": [artifact(105)],
    "106": [artifact(106)],
    "107": [artifact(107)],
  }, now);

  assert.equal(options.length, 1);
  assert.equal(options[0].run_id, 101);
  assert.equal(options[0].artifact_id, 1101);
  assert.equal(options[0].artifact_name, DYNAMIC_WORLD_ARTIFACT_PREFIX + "101");
});

test("rejects expired, zero-byte, wrongly named and foreign-run artifacts", () => {
  const options = buildDynamicWorldArtifactOptions([run(201)], {
    "201": [
      artifact(201, { id: 1, expired: true }),
      artifact(201, { id: 2, size_in_bytes: 0 }),
      artifact(201, { id: 3, name: "unrelated-artifact" }),
      artifact(201, { id: 4, workflow_run: { id: 999 } }),
      artifact(201, { id: 5, expires_at: "2026-11-04T11:59:00.000Z" }),
    ],
  }, now);
  assert.deepEqual(options, []);
});

test("requires exact artifact name to bind to its run ID", () => {
  const options = buildDynamicWorldArtifactOptions([run(301)], {
    "301": [artifact(301, { name: DYNAMIC_WORLD_ARTIFACT_PREFIX + "302" })],
  }, now);
  assert.deepEqual(options, []);
});

test("sorts most recent runs first and limits results to ten", () => {
  const runs = Array.from({ length: 12 }, (_, index) => {
    const id = 400 + index;
    const hour = String(index).padStart(2, "0");
    return run(id, `2026-11-04T${hour}:00:00.000Z`);
  });
  const artifacts = Object.fromEntries(runs.map((item) => [
    String(item.id),
    [artifact(item.id)],
  ]));
  const options = buildDynamicWorldArtifactOptions(runs, artifacts, now);
  assert.equal(options.length, 10);
  assert.equal(options[0].run_id, 411);
  assert.equal(options[9].run_id, 402);
});

test("deduplicates repeated run records", () => {
  const options = buildDynamicWorldArtifactOptions(
    [run(501), run(501)],
    { "501": [artifact(501)] },
    now,
  );
  assert.equal(options.length, 1);
});

test("builds and validates the empty discovery state without inventing a run", () => {
  const result = buildDynamicWorldArtifactDiscoveryResult([], "2026-11-04T12:00:00.000Z");
  assert.equal(result.status, "NO_SUCCESSFUL_ARTIFACT");
  assert.equal(result.artifacts.length, 0);
  assert.equal(isDynamicWorldArtifactDiscoveryResult(result), true);
});

test("accepts a validated option list and rejects unsafe URLs, names and status", () => {
  const options = buildDynamicWorldArtifactOptions([run(601)], {
    "601": [artifact(601)],
  }, now);
  const valid = buildDynamicWorldArtifactDiscoveryResult(options, "2026-11-04T12:00:00.000Z");
  assert.equal(isDynamicWorldArtifactDiscoveryResult(valid), true);

  const badUrl = structuredClone(valid);
  badUrl.artifacts[0].run_url = "https://example.com/steal";
  assert.equal(isDynamicWorldArtifactDiscoveryResult(badUrl), false);

  const badName = structuredClone(valid);
  badName.artifacts[0].artifact_name = "some-other-file";
  assert.equal(isDynamicWorldArtifactDiscoveryResult(badName), false);

  const badStatus = structuredClone(valid);
  badStatus.status = "NO_SUCCESSFUL_ARTIFACT";
  assert.equal(isDynamicWorldArtifactDiscoveryResult(badStatus), false);
});

test("rejects duplicate IDs, malformed timestamps and descending sort violations", () => {
  const options = buildDynamicWorldArtifactOptions(
    [run(701, "2026-11-04T11:00:00.000Z"), run(702, "2026-11-04T10:00:00.000Z")],
    { "701": [artifact(701)], "702": [artifact(702)] },
    now,
  );
  const valid = buildDynamicWorldArtifactDiscoveryResult(options, "2026-11-04T12:00:00.000Z");
  assert.equal(isDynamicWorldArtifactDiscoveryResult(valid), true);

  const duplicate = structuredClone(valid);
  duplicate.artifacts[1].run_id = duplicate.artifacts[0].run_id;
  assert.equal(isDynamicWorldArtifactDiscoveryResult(duplicate), false);

  const malformedDate = structuredClone(valid);
  malformedDate.artifacts[0].created_at = "yesterday";
  assert.equal(isDynamicWorldArtifactDiscoveryResult(malformedDate), false);

  const wrongOrder = structuredClone(valid);
  wrongOrder.artifacts.reverse();
  assert.equal(isDynamicWorldArtifactDiscoveryResult(wrongOrder), false);
});

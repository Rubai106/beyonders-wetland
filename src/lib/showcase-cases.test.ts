// Run: npm test   (node's built-in runner; no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { assertShowcaseCandidateCount, listShowcaseCases, loadShowcaseBundle, loadShowcaseRadar, loadVerifiedShowcaseImageUrl, ShowcaseIntegrityError, verifyShowcasePayloadHash } from "./showcase.ts";

function stubFetch(handler: (url: string) => { ok: boolean; body: unknown }) {
  (globalThis as Record<string, unknown>).fetch = async (url: string) => {
    const r = handler(String(url));
    return { ok: r.ok, json: async () => r.body };
  };
}

test("listShowcaseCases reads the exported case index", async () => {
  stubFetch((url) => url.endsWith("/showcase/index.json")
    ? { ok: true, body: { version: 1, cases: [{ id: "tanguar", site_display_name: "Tanguar Haor", site_bounds: [91, 25, 91.1, 25.2] }] } }
    : { ok: false, body: null });
  const cases = await listShowcaseCases();
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, "tanguar");
  assert.equal(cases[0].site_display_name, "Tanguar Haor");
});

test("listShowcaseCases falls back to the single featured case without an index", async () => {
  stubFetch((url) => url.endsWith("/showcase/featured/manifest.json")
    ? { ok: true, body: { showcase_version: 1, run_id: "abc", label: "L", site_name: "Tanguar Haor", exported_at: "x" } }
    : { ok: false, body: null });
  const cases = await listShowcaseCases();
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, "featured");
});

test("listShowcaseCases returns [] when nothing was exported", async () => {
  stubFetch(() => ({ ok: false, body: null }));
  assert.deepEqual(await listShowcaseCases(), []);
});

test("candidate file count matches the recorded pulse count", () => {
  assert.doesNotThrow(() => assertShowcaseCandidateCount("2026-08-29", Array.from({ length: 295 }, (_, i) => i), 295));
});

test("candidate file mismatch is an explicit error instead of a zero-detection result", () => {
  assert.throws(() => assertShowcaseCandidateCount("2026-08-29", [], 295), /records 295/);
});

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function installWebCrypto(): void {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  }
}

test("SHA-256 payload verification accepts matching bytes and rejects corruption", async () => {
  installWebCrypto();
  const bytes = new TextEncoder().encode('{"authentic":true}');
  await assert.doesNotReject(() => verifyShowcasePayloadHash("pulse.json", bytes.buffer, sha256('{"authentic":true}')));
  await assert.rejects(
    () => verifyShowcasePayloadHash("pulse.json", bytes.buffer, sha256('{"authentic":false}')),
    (error: unknown) => error instanceof ShowcaseIntegrityError && /SHA-256 mismatch/.test(error.message),
  );
});

test("checksum-enabled showcase verifies essential JSON/GeoJSON assets during load", async () => {
  installWebCrypto();
  const id = "checksum-valid-test";
  const payloads: Record<string, string> = {
    "pulse.json": JSON.stringify({ dates: [{ date: "2026-01-01", area_km2: 0, patches: 0 }], peak: { date: "2026-01-01", area_km2: 0 } }),
    "boundary.geojson": JSON.stringify({ type: "FeatureCollection", features: [] }),
    "sensitivity.json": JSON.stringify({}),
    "observations.json": JSON.stringify([]),
    "reference.json": JSON.stringify({ available: false }),
  };
  const hashes = Object.fromEntries(Object.entries(payloads).map(([path, value]) => [path, sha256(value)]));
  const manifest = { showcase_version: 1, run_id: "d".repeat(32), case_id: id, label: "test", site_name: "test", exported_at: "2026-01-01",
    observation_dates: ["2026-01-01"], radar_dates: [], has_reference: false, limitations: [], source: "test", files_sha256: hashes };
  (globalThis as Record<string, unknown>).fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/manifest.json")) return { ok: true, json: async () => manifest } as Response;
    const path = url.split(`/showcase/${id}/`)[1];
    const payload = payloads[path];
    return payload === undefined ? { ok: false, arrayBuffer: async () => new ArrayBuffer(0) } as Response
      : { ok: true, arrayBuffer: async () => new TextEncoder().encode(payload).buffer } as Response;
  };
  const bundle = await loadShowcaseBundle(id);
  assert.ok(bundle);
  assert.equal(bundle.pulse?.dates.length, 1);
  assert.equal(bundle.observations.length, 0);
});

test("checksum-enabled showcase fails closed when an essential payload is corrupt", async () => {
  installWebCrypto();
  const id = "checksum-corrupt-test";
  const payloads: Record<string, string> = {
    "pulse.json": JSON.stringify({ dates: [{ date: "2026-01-01", area_km2: 0, patches: 0 }], peak: { date: "2026-01-01", area_km2: 0 } }),
    "boundary.geojson": JSON.stringify({ type: "FeatureCollection", features: [] }),
    "sensitivity.json": JSON.stringify({}),
    "observations.json": JSON.stringify([]),
    "reference.json": JSON.stringify({ available: false }),
  };
  const hashes = Object.fromEntries(Object.entries(payloads).map(([path, value]) => [path, sha256(value)]));
  hashes["pulse.json"] = "0".repeat(64);
  const manifest = { showcase_version: 1, run_id: "e".repeat(32), case_id: id, label: "test", site_name: "test", exported_at: "2026-01-01",
    observation_dates: ["2026-01-01"], radar_dates: [], has_reference: false, limitations: [], source: "test", files_sha256: hashes };
  (globalThis as Record<string, unknown>).fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/manifest.json")) return { ok: true, json: async () => manifest } as Response;
    const path = url.split(`/showcase/${id}/`)[1];
    const payload = payloads[path];
    return payload === undefined ? { ok: false, arrayBuffer: async () => new ArrayBuffer(0) } as Response
      : { ok: true, arrayBuffer: async () => new TextEncoder().encode(payload).buffer } as Response;
  };
  await assert.rejects(() => loadShowcaseBundle(id), (error: unknown) => error instanceof ShowcaseIntegrityError && /SHA-256 mismatch/.test(error.message));
});

test("radar preview fails closed when a displayed PNG does not match its manifest hash", async () => {
  installWebCrypto();
  const id = "checksum-radar-corrupt-test";
  const date = "2026-01-01";
  const preview = JSON.stringify({ run_id: "f".repeat(32), date, layers: {
    hh: { images: { before: "radar/test.png" }, scale_db: [0, 1], change_scale_db: [-1, 1], bounds: [[0, 0], [1, 1]], width: 1, height: 1 },
  } });
  const manifest = { showcase_version: 1, run_id: "f".repeat(32), case_id: id, label: "test", site_name: "test", exported_at: "2026-01-01",
    observation_dates: [date], radar_dates: [date], has_reference: false, limitations: [], source: "test",
    files_sha256: { [`radar/preview_${date}.json`]: sha256(preview), "radar/test.png": "0".repeat(64) } };
  (globalThis as Record<string, unknown>).fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/manifest.json")) return { ok: true, json: async () => manifest } as Response;
    const path = url.split(`/showcase/${id}/`)[1];
    const payload = path === `radar/preview_${date}.json` ? preview : path === "radar/test.png" ? "not-a-real-png" : null;
    return payload === null ? { ok: false, arrayBuffer: async () => new ArrayBuffer(0) } as Response
      : { ok: true, arrayBuffer: async () => new TextEncoder().encode(payload).buffer } as Response;
  };
  await assert.rejects(() => loadShowcaseRadar(date, id), (error: unknown) => error instanceof ShowcaseIntegrityError && /SHA-256 mismatch/.test(error.message));
  await assert.rejects(() => loadVerifiedShowcaseImageUrl("radar/test.png", id, manifest), (error: unknown) => error instanceof ShowcaseIntegrityError && /SHA-256 mismatch/.test(error.message));
});

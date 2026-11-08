// Run: npm test   (node's built-in runner; no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { __clearRateLimitBucketsForTests, checkRateLimit, type RateLimitRequest } from "./rate-limit.ts";

function requestFor(path: string, ip = "203.0.113.7"): RateLimitRequest {
  return {
    headers: { get: (name: string) => (name.toLowerCase() === "x-forwarded-for" ? ip : null) },
    nextUrl: { pathname: path },
  };
}

test("allows requests under the general tier limit", () => {
  __clearRateLimitBucketsForTests();
  for (let i = 0; i < 120; i += 1) {
    assert.equal(checkRateLimit(requestFor("/api/wetland/pulse"), "general").allowed, true);
  }
});

test("blocks the 121st general request with a retry-after", () => {
  __clearRateLimitBucketsForTests();
  for (let i = 0; i < 120; i += 1) checkRateLimit(requestFor("/api/wetland/pulse"), "general");
  const result = checkRateLimit(requestFor("/api/wetland/pulse"), "general");
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.ok(result.retryAfterSeconds > 0);
});

test("limits job starts to 5 per minute", () => {
  __clearRateLimitBucketsForTests();
  for (let i = 0; i < 5; i += 1) {
    assert.equal(checkRateLimit(requestFor("/api/wetland/processing"), "job").allowed, true);
  }
  assert.equal(checkRateLimit(requestFor("/api/wetland/processing"), "job").allowed, false);
});

test("limits external-proxy routes to 30 per minute", () => {
  __clearRateLimitBucketsForTests();
  for (let i = 0; i < 30; i += 1) {
    assert.equal(checkRateLimit(requestFor("/api/volcanoes/catalog"), "external").allowed, true);
  }
  assert.equal(checkRateLimit(requestFor("/api/volcanoes/catalog"), "external").allowed, false);
});

test("keeps buckets separate per route and per client", () => {
  __clearRateLimitBucketsForTests();
  for (let i = 0; i < 120; i += 1) checkRateLimit(requestFor("/api/wetland/pulse", "203.0.113.7"), "general");
  assert.equal(checkRateLimit(requestFor("/api/wetland/radar", "203.0.113.7"), "general").allowed, true);
  assert.equal(checkRateLimit(requestFor("/api/wetland/pulse", "198.51.100.9"), "general").allowed, true);
});

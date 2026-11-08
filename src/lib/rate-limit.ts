// In-process per-client rate limiting for the API routes.
//
// Why this exists: several routes proxy NASA CMR, the Smithsonian GVP service,
// or Nominatim, and one starts local pipeline jobs. Without a limit, a loop in
// the UI (or a curious visitor) can hammer those services and get the demo's
// IP throttled, or queue up expensive jobs. The limits are generous for a
// human using the explorers — they only bite on runaway automation.
//
// Why in-process and per-route: this is a single-server demo deployment, not
// a distributed service. The bucket key is client IP + route path, so one
// busy route cannot starve the others and the browser test suites (which
// share one IP) stay well under the general tier.
//
// Deliberately free of any `next/server` import so the unit tests can run
// under the plain node:test runner: the request is typed structurally
// (NextRequest satisfies it) and the 429 reply is a plain web Response,
// which route handlers may return directly.
//
// /api/wetland/geocode keeps its own stricter 1.1s global throttle
// (Nominatim's usage policy) and is not routed through this helper.

export type RateLimitTier = "external" | "job" | "general";

const TIERS: Record<RateLimitTier, { windowMs: number; max: number }> = {
  // Routes that call an external service on every request.
  external: { windowMs: 60_000, max: 30 },
  // Routes that start a local pipeline job.
  job: { windowMs: 60_000, max: 5 },
  // Cheap local reads (manifests, local data, computed previews).
  general: { windowMs: 60_000, max: 120 },
};

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

export type RateLimitRequest = {
  headers: { get(name: string): string | null };
  nextUrl: { pathname: string };
};

function clientIp(request: RateLimitRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function checkRateLimit(
  request: RateLimitRequest,
  tier: RateLimitTier,
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const { windowMs, max } = TIERS[tier];
  const key = `${clientIp(request)}:${request.nextUrl.pathname}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (bucket.count < max) {
    bucket.count += 1;
    return { allowed: true };
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
  return { allowed: false, retryAfterSeconds };
}

export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSeconds) },
  });
}

/** Test-only escape hatch: clear all buckets between test cases. */
export function __clearRateLimitBucketsForTests(): void {
  buckets.clear();
}

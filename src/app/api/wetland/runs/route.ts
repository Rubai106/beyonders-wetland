import { NextResponse, type NextRequest } from "next/server";
import { completedNisarRuns } from "@/lib/pipeline-output";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  return NextResponse.json({ runs: completedNisarRuns() }, { headers: { "Cache-Control": "no-store" } });
}

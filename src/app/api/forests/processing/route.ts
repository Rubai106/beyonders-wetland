import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
export async function POST(request: NextRequest) {
  const limit = checkRateLimit(request, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    return NextResponse.json({ error: "Forest processing is operator-only. Run the documented local Python workflow; this endpoint cannot start jobs." }, { status: 403 });
}

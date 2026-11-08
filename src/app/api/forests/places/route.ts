import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
export const runtime = "nodejs";
const cache = new Map<string, {
    expires: number;
    places: {
        name: string;
        latitude: number;
        longitude: number;
    }[];
}>();
let lastRequest = 0;
export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "external");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (query.length < 3 || query.length > 120)
        return NextResponse.json({ error: "Enter a place name between 3 and 120 characters." }, { status: 400 });
    const cached = cache.get(query.toLowerCase());
    if (cached && cached.expires > Date.now())
        return NextResponse.json({ places: cached.places, source: "OpenStreetMap Nominatim" });
    if (Date.now() - lastRequest < 1000)
        return NextResponse.json({ error: "Please wait a second before searching another place." }, { status: 429 });
    lastRequest = Date.now();
    try {
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.search = new URLSearchParams({ q: query, format: "jsonv2", limit: "5" }).toString();
        const response = await fetch(url, { headers: { "User-Agent": "Beyonders/1.0 (NISAR Earth observation viewer)", Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
        if (!response.ok)
            throw new Error("Place service unavailable");
        const body = await response.json() as {
            display_name: string;
            lat: string;
            lon: string;
        }[];
        const places = body.map(p => ({ name: p.display_name, latitude: Number(p.lat), longitude: Number(p.lon) })).filter(p => Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 85.05112878 && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180);
        if (cache.size > 100)
            cache.clear();
        cache.set(query.toLowerCase(), { places, expires: Date.now() + 3600000 });
        return NextResponse.json({ places, source: "OpenStreetMap Nominatim" }, { headers: { "Cache-Control": "public, max-age=3600" } });
    }
    catch {
        return NextResponse.json({ error: "Place search is unavailable. Use map coordinates or a saved study." }, { status: 502 });
    }
}

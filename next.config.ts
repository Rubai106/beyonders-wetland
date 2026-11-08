import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Redirect build artifacts when OneDrive or another synced folder blocks writes to .next.
  distDir: process.env.BEYONDERS_NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "assets.science.nasa.gov", pathname: "/dynamicimage/assets/science/esd/eo/images/iotd/2025/**" }],
  },
  // Security headers. CSP allowlist is built from the hosts the app actually
  // uses at runtime: ArcGIS + Carto basemaps, GIBS NISAR tiles, Global Forest
  // Watch GLAD tiles, Terrascope WorldCover WMTS, NASA science assets, and
  // CMR for catalogue searches. 'unsafe-inline' stays for scripts/styles:
  // Next.js hydration and Leaflet need it; external scripts are still blocked.
  // Verify after any new external host is added (see docs/PLATFORM_QA_REPORT.md).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https://server.arcgisonline.com https://tile.openstreetmap.org https://gibs.earthdata.nasa.gov https://tiles.globalforestwatch.org https://*.basemaps.cartocdn.com https://wmts.terrascope.be https://assets.science.nasa.gov",
              "connect-src 'self' https://cmr.earthdata.nasa.gov https://nominatim.openstreetmap.org",
              "font-src 'self' https://fonts.gstatic.com",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
  env: { NEXT_PUBLIC_BEYONDERS_MODE: process.env.VERCEL === "1" || process.env.BEYONDERS_MODE === "public" || process.env.NEXT_PUBLIC_BEYONDERS_MODE === "public" ? "public" : "local" },
  outputFileTracingExcludes: { "/*": ["./pipeline/**/*", "./artifacts/**/*", "./**/*.mp4"] },
  // The project is opened at 127.0.0.1 in the in-app browser during development.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;

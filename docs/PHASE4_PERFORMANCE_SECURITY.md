# PHASE 4 PERFORMANCE & SECURITY

Date: 2026-11-08.

## Security — rechecked

- **CSP / headers**: enforcing CSP + security headers live in `next.config.ts`
  (`headers()`), ported to master as a surgical hunk (see port manifest §D).
  Allowlist: ArcGIS, GIBS, GLAD, Carto, Terrascope, NASA assets, Google Fonts,
  CMR, Nominatim. `script-src 'self' 'unsafe-inline'` remains because Next.js
  hydration and Leaflet need it; external scripts are still blocked. Zero CSP
  violations when browser-verified in Phase 1. No new external host was added
  in Phase 4, so the allowlist is unchanged.
- **Rate limiting**: 22/22 API routes covered (see Functional QA §1).
- **Path validation**: the capsule route takes only a study id, looks it up in
  the health list, and never builds a filesystem path from user input. Unknown
  ids 404. No credential exposure: the route reads only published manifests.
- **Earthdata auth**: unchanged — no credential fields added to the frontend,
  no public processing endpoint added. Private processing files are not
  published (tracing excludes `pipeline/**/*`, `artifacts/**/*`, `**/*.mp4`).
- **Dependencies**: no new dependencies added in Phase 4. No `npm audit` run
  (npm wrapper blocked by the environment); run it on the healthy machine
  during the port.

## Performance — review, no regressions introduced

- Phase 4 additions are small and cheap: two pure data libs (no I/O at import),
  one API route that reads already-published manifests, and one server-rendered
  section on `/observability`. No new client JS weight of note (Quality
  Explorer is server-rendered HTML; the capsule is a download link).
- Existing posture (unchanged): showcase files are checksum-verified before
  use (fail-closed); large GeoJSON/raster previews are not loaded eagerly;
  the lineage graph is pure SVG with a fixed layout (no force simulation).
- Not measured in Phase 4 (blocked): `npm run build` output sizes, route
  load times, browser memory, map render performance. These need the healthy
  machine + browser. Do not claim performance numbers that were not measured.

## What still needs a healthy machine

- `npm run build` (production bundle + size report).
- `npm audit` / dependency vulnerability review.
- Live-network tile check under the enforcing CSP.
- Browser console/network error sweep across all routes.

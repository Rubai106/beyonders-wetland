# Architecture

## Runtime boundaries

- **Public viewer:** Next.js application and read-only routes; reads versioned packages under `public/studies/releases/<version>/runs/<run-id>/`. Vercel deployments set public mode and exclude the Python pipeline and video artifacts.
- **Local operator app:** same Next.js UI in local mode; Node worker starts one Python job, reads local saved runs and caches. Python uses `PYTHON_EXECUTABLE`, a bundled venv, or system Python fallback. Earthdata credentials remain in private user configuration.
- **Science pipeline:** NASA CMR discovery → compatible NISAR scenes → spatial extraction/quality masks → HH/HV time series → candidate polygons → HLS independent comparison → saved run directory.
- **Publisher:** validates a complete real run, strips machine paths, records checksums, creates a display-only simplified GeoJSON derivative, a source-artifact ZIP and evidence card, then writes a read-only catalog. The local analysis and original source rasters remain untouched.
- **External services:** NASA CMR, ASF/Earthdata science files, NASA GIBS, HLS, and optional GitHub Release downloads. External failures should leave cached/publication data visible and explain stale/unavailable service state.
- **Volcano section:** a separate browser module uses the Smithsonian GVP WFS volcano directory and read-only NASA CMR GUNW coverage searches. A local CLI crops official NISAR/ARIA interferograms, screens/references phase and converts to apparent LOS candidates. Immutable packages under `public/volcanoes/hayli-gubbi/VERSION` supply paired maps, a display-grid pixel inspector and downloadable source evidence. No Python or Earthdata access is required to view a published case; no public volcano processing endpoint exists.

## Public data flow

Forests are a third independent module (`/forest/global`, `/forest/rondonia`).
The global map uses historical ESA WorldCover/Terrascope, NASA GIBS imagery,
read-only CMR GCOV footprints and published candidate polygons. Explicit place
search uses cached Nominatim requests; coordinate search works without it.
The local forest CLI reuses GCOV subset/quality handling but has its own
persistence detector and HLS NDVI/NBR comparison. Public artifacts live in
`public/forests`; native source subsets stay in ignored operator storage and
can be distributed as explicit GitHub Release assets. Forest processing POSTs
always return 403. No forest UI accesses private pipeline paths.

Builds explicitly use Webpack. Turbopack's local file tracing attempted to hash
a large private source archive in this checkout and failed with Windows error
1450 despite tracing exclusions; the Webpack build honors the exclusions.

`complete local run → validate → versioned package + SHA-256 manifest → public catalog → read-only API/UI`

The public APIs use a bounded run ID and published catalog entry, not user-provided paths. Public process/settings/pixel-probe endpoints fail closed before reading local pipeline files. Full-resolution rasters and downloads belong in explicitly released assets, not deployment bundles.

## Mode configuration

Local default: `BEYONDERS_MODE=local`, `NEXT_PUBLIC_BEYONDERS_MODE=local`. Public deploy: both set to `public`; Vercel's `VERCEL=1` also forces server-side public mode. Client controls use the public build flag. Never deploy with local mode accidentally enabled.


## Agriculture / SME2 module

Agriculture is a fourth independent workspace at /agriculture. It reads only the published display package under public/agriculture/current and verifies the study manifest and active preview against its byte-count/SHA-256 manifest before display. Online catalogue discovery is provided by the same-origin read-only endpoint /api/agriculture/catalogue: it queries public NASA CMR metadata, validates the WGS84/date request, groups only compatible SME2 granules by full product identity, and returns a download-compatible series ID plus actual acquisition dates. This discovery works in public mode and requires no local Python environment or Earthdata credentials. It does not download granules or assert pixel validity. The Python pipeline/agriculture_sme2.py remains the scientific processing implementation; the intended website workflow will invoke it through a separately deployed, authenticated hosted worker, persist job state and private raw inputs outside the Next.js deployment, and publish only a checksum-verified display package. That hosted worker and Earthdata authorization callback are not yet connected; do not enable a public download/process action until those are deployed. Original HDF5 granules and native GeoTIFFs must remain in private operator storage. The 20% coverage floor and PROVISIONAL product-maturity limits are part of the evidence contract; no crop-stress or drought classification is claimed.

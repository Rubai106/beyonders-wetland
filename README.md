# GEONEXSER — Earth in Motion

GEONEXSER is an evidence-first Earth-observation investigation platform built with NASA–ISRO NISAR data. It helps analysts inspect radar observations, examine candidate changes, compare independent datasets, and trace every result to its source.

The current prototype includes four distinct measurement workspaces: wetlands and forests (NISAR L2 GCOV backscatter), volcanoes (NISAR L2 GUNW phase/coherence), and agriculture (NISAR L3 SME2 soil-moisture estimates). These are not interchangeable detectors. Published results are exploratory candidates unless explicitly supported by the case evidence; no worldwide hazard classification or operational alert is claimed.

## Run locally

- Install Node.js 20.9.0 or newer and Python 3.13; see [installation](docs/operator-guide.md).
- In the repository, run `npm ci`, create `pipeline/venv`, and install `pipeline/requirements.txt`.
- Start `npm run dev -- --port 3015` and open `http://localhost:3015/wetland/global`.
- Wetlands: the map-first experience is at `/wetland`; global discovery and processing are at `/wetland/global`.
- Forests: global discovery is at `/forest/global`; the published Rondônia study is at `/forest/rondonia`. Its seven-date PROVISIONAL GCOV series and HLS/GLAD context remain exploratory, unverified radar-change evidence. Reproduce a saved native run with `python pipeline/forest_pipeline.py verify-run --run RUN_ID`; see [Forest method](docs/forest-method.md) and the [operator workflow](docs/forest-operator-guide.md).
- Volcanoes: global discovery is at `/volcano/global`; the published cases are `/volcano/hayli-gubbi` and `/volcano/kilauea`. Interpret official GUNW phase products as relative apparent line-of-sight candidates, not confirmed volcanic deformation or forecasts.
- Agriculture / SME2: `/agriculture` serves the checksum-verified Naogaon study `agri-41647231453`, an exploratory NISAR L3 SME2 PROVISIONAL DSG series with six valid dates (12 August–23 October 2026) and four documented quality exclusions. It is not field-validated and has no independent crop mask or published IMERG rainfall context. NASA CMR discovery and secure cloud-processing handoff are available in the browser; Earthdata credentials remain in the `EARTH_DATA` repository secret. See [Agriculture method](docs/agriculture-method.md) and [release/QA status](docs/agriculture-release.md).

## Publishing

Publish only reviewed, checksum-verified study packages. See [deployment and recovery](docs/deployment.md). Keep credentials, downloaded granules, native processing outputs and logs out of Git.

## Scientific evidence and limitations

See the [evidence report](docs/evidence-report.md), [scientific method](docs/scientific-method.md), [data specification](docs/data-specification.md), and [project plan](docs/project-plan.md). The Chókwè evidence is particularly important: the HLS comparison is inconclusive; temporally close and later independent radar products provide positive-only algorithm agreement/spatial support, not field validation or an accuracy score. The original published candidate package remains unchanged.

## Regression checks

- `npm test` — deterministic TypeScript unit/regression suite.
- `npm run lint` — ESLint.
- `npm run build` — production build (Webpack).
- `npx tsc --noEmit` — TypeScript check.
- Production-browser checks are listed in [the operator guide](docs/operator-guide.md).

GitHub Actions runs the project QA workflow on pushes to `master` and pull requests targeting `master`.

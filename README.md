# Beyonders — Earth in Motion

A NISAR Earth-change explorer with separate **Wetlands**, **Forests**, **Volcanoes** and **Agriculture** workspaces. Each module has its own product, method and evidence limits. Published candidates are not automatically validated environmental events; worldwide imagery and acquisition footprints show observations and coverage, not global detections.

## Run locally

- Install Node.js 20.9.0 or newer and Python 3.13; see [installation](docs/operator-guide.md).
- In the repository, run `npm ci`, create `pipeline/venv`, and install `pipeline/requirements.txt`.
- Start `npm run dev -- --port 3015` and open `http://localhost:3015/wetland/global`.
- Wetlands: the map-first Time Machine is at `/wetland`; global discovery and processing are at `/wetland/global`.
- Forests: global discovery is at `/forest/global`; the published Rondônia study is at `/forest/rondonia`. Its seven-date PROVISIONAL GCOV series and HLS/GLAD context remain exploratory, unverified radar-change evidence. Reproduce a saved native run with `python pipeline/forest_pipeline.py verify-run --run RUN_ID`; see [Forest method](docs/forest-method.md) and the [operator workflow](docs/forest-operator-guide.md).
- Volcanoes: global discovery is at `/volcano/global`; the published cases are `/volcano/hayli-gubbi` and `/volcano/kilauea`. Interpret their official GUNW phase products as relative apparent line-of-sight candidates, not confirmed volcanic deformation or forecasts.
- Agriculture / SME2: `/agriculture` serves the checksum-verified Naogaon study `agri-41647231453`, an exploratory NISAR L3 SME2 PROVISIONAL DSG series with six valid dates (12 August–23 October 2026) and four documented quality exclusions. It is not field-validated and has no independent crop mask or published IMERG rainfall context. NASA CMR catalogue discovery and the secure cloud-processing handoff are available in the browser; the GitHub Actions worker now runs from `master`, while Earthdata credentials remain in the `EARTH_DATA` repository secret. See the [Agriculture method](docs/agriculture-method.md) and [release/QA status](docs/agriculture-release.md).

Wetland/Forest/Volcano processing remains operator-managed. Agriculture catalogue discovery is available on the website, while authenticated SME2 processing is controlled through the GitHub Actions workflow on `master` and its `EARTH_DATA` repository secret. The browser never receives Earthdata credentials. Keep credentials, downloaded granules, native processing outputs and logs out of Git.

## Publish the public viewer

Publish only reviewed, checksum-verified study packages. For the wetland workflow, prepare a release with `python pipeline/publish_study.py RUN_ID --version YYYY.MM.DD`; see [deployment and recovery](docs/deployment.md). Agriculture has a separate preview-only publishing workflow and separate release gates in [Agriculture release status](docs/agriculture-release.md).

Do not commit raw satellite files, virtual environments, credentials, private operator outputs, recordings or processing logs.

## Documentation

- [Project plan and release gates](docs/project-plan.md)
- [NASA Space Apps challenge coverage](docs/challenge-coverage.md)
- [Competition demo runbook](docs/competition-demo-runbook.md) · timed presentation, navigation, evidence claims and contingency plan
- [Architecture](docs/architecture.md)
- [Scientific method and limitations](docs/scientific-method.md)
- [Evidence inventory](docs/evidence-report.md) · [machine-readable checks](docs/evidence-inventory.json)
- [Data and publication formats](docs/data-specification.md)
- [Operator guide](docs/operator-guide.md)
- [Deployment, publishing and recovery](docs/deployment.md)
- [User guide and roadmap](docs/user-guide.md)
- [Agriculture / SME2 method](docs/agriculture-method.md) · [release gates](docs/agriculture-release.md)
- [Forest method](docs/forest-method.md) · [operator workflow](docs/forest-operator-guide.md)
- [Volcano method and evidence](docs/volcano-method.md) · [release report](docs/volcano-release.md)

Catalog availability can change, so verify NASA CMR before each new study. Chókwè is processed separately from the PROVISIONAL time series using its matching January 5–17 NISAR BETA pair. Its HLS optical check is inconclusive; a later UNOSAT Sentinel-1 overlay provides positive spatial support only, not an accuracy assessment.


## Regression checks

- Use Node.js 20.9.0 or newer for the Next.js application (`npm run dev`, `npm run build`, and `npm run start`).
- Run the deterministic unit/regression suite with `npm test` (alias: `npm run test:unit`).
- Run `npm run lint` before publishing changes.
- Run the production-browser checks against a built public viewer at `http://127.0.0.1:3140`:
  - `python tests/e2e/explore_smoke.py http://127.0.0.1:3140` — landing globe, global NISAR map, coordinates, layers, scene catalogue and mobile layout.
  - `python tests/e2e/multi_case_module_smoke.py http://127.0.0.1:3140` — cross-workspace navigation, published case interactions, accessibility and responsive layouts.
  - `python tests/e2e/chokwe_deep_link_smoke.py http://127.0.0.1:3140` — Chókwè deep-link and evidence navigation.
  - `python tests/e2e/scattering_hypothesis_smoke.py http://127.0.0.1:3140` — scattering hypothesis exploration and evidence boundaries.
  - `python tests/e2e/agriculture_evidence_chain_smoke.py http://127.0.0.1:3140` — Agriculture publication integrity and evidence-chain behaviour.

GitHub Actions runs Python and TypeScript regression tests, lint, the public production build, type checking and all five production-browser checks on pushes to `master` and pull requests targeting `master`.

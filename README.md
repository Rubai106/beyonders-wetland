# Beyonders — Earth in Motion

A NISAR Earth-change explorer with separate **Wetlands**, **Forests**, **Volcanoes** and **Agriculture** workspaces. Each module has its own product, method and evidence limits. Published candidates are not automatically validated environmental events; worldwide imagery and acquisition footprints show observations and coverage, not global detections.

## Run locally

- Install Node.js 20.9.0 or newer and Python 3.13; see [installation](docs/operator-guide.md).
- In the repository, run `npm ci`, create `pipeline/venv`, and install `pipeline/requirements.txt`.
- Start `npm run dev -- --port 3015` and open `http://localhost:3015/wetland/global`.
- Wetlands: the map-first Time Machine is at `/wetland`; global discovery and processing are at `/wetland/global`.
- Forests: global discovery is at `/forest/global`; the published Rondônia study is at `/forest/rondonia`. Its seven-date PROVISIONAL GCOV series and HLS/GLAD context remain exploratory, unverified radar-change evidence. Reproduce a saved native run with `python pipeline/forest_pipeline.py verify-run --run RUN_ID`; see [Forest method](docs/forest-method.md) and the [operator workflow](docs/forest-operator-guide.md).
- Volcanoes: global discovery is at `/volcano/global`; the published cases are `/volcano/hayli-gubbi` and `/volcano/kilauea`. Interpret their official GUNW phase products as relative apparent line-of-sight candidates, not confirmed volcanic deformation or forecasts.
- Agriculture / SME2: open `/agriculture` for the soil-moisture measurement workspace and online NASA CMR catalogue discovery. The website can search and compare compatible SME2 series without local Python; it still shows an honest no-publication state because no genuine SME2 PROVISIONAL study has passed granule and quality checks. The authenticated hosted processing worker is not yet connected. Follow the [Agriculture method and operator workflow](docs/agriculture-method.md); do not publish a study until the actual HDF5 hierarchy, grid, release, fill values and quality flags have been checked.

Wetland/Forest/Volcano processing remains operator-managed. Agriculture catalogue discovery is available on the website; its hosted download/processing worker is still being integrated. NASA Earthdata credentials must never be entered into an application form or committed to the repository. Keep credentials, downloaded granules, native processing outputs and logs out of Git.

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
- The production-browser suite is `python tests/e2e/multi_case_module_smoke.py http://127.0.0.1:3140`; it checks published evidence when present and explicitly checks the honest no-publication or integrity-error state when no study is available.

GitHub Actions runs lint, unit tests, the production build, and the production-browser suite on pushes and pull requests to `master` and `Rubai-dev`.

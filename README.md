# Beyonders — Earth in Motion

A NISAR Earth-change explorer with separate **Wetlands**, **Volcanoes** and **Forests** sections. Wetland and forest polygons are local analysis outputs and remain unverified candidates. The worldwide volcano map shows Smithsonian inventory locations and NISAR interferogram coverage; it does not classify eruptions or claim global deformation detections.

## Run locally

- Install Node.js 20 or newer and Python 3.13; see [installation](docs/operator-guide.md).
- In the repository, run `npm ci`, create `pipeline/venv`, and install `pipeline/requirements.txt`.
- Start `npm run dev -- --port 3015` and open `http://localhost:3015/wetland/global`.
- Fake-data experience: `/wetland`. Real saved studies: `/wetland?source=raster`.
- Volcano directory: `/volcano/global`; published Hayli Gubbi/Erta Ale case: `/volcano/hayli-gubbi`.
- Forest explorer: `/forest/global`; real Rondônia NISAR study: `/forest/rondonia`.
- Agriculture / SME2 workspace: `/agriculture`. It has a truthful no-publication state until genuine SME2 PROVISIONAL granules are processed locally; see [Agriculture method](docs/agriculture-method.md). The study reads seven PROVISIONAL GCOV observations, checks HLS coverage/change evidence, and publishes one small unverified radar-change candidate. Run `python pipeline/forest_pipeline.py verify-run --run RUN_ID` to reproduce its saved classifications offline. [Forest method](docs/forest-method.md) · [operator workflow](docs/forest-operator-guide.md).
- The volcano case contains three real NISAR HH BETA GUNW intervals, independent ascending/descending Sentinel-1 phase views, timeline, coordinate/pixel inspector and evidence export. Interpret these as relative apparent LOS candidates; atmospheric corrections and measurement accuracy are not established.
- New study searches and processing run on the local computer. Earthdata login is entered in the terminal, never in the web form.

## Publish the public viewer

Publish only reviewed study packages. Prepare first: `python pipeline/publish_study.py RUN_ID --version YYYY.MM.DD`. See [deployment and recovery](docs/deployment.md). Do not commit raw satellite files, virtual environments, credentials, recordings, or processing logs.

## Documentation

- [Project plan and release gates](docs/project-plan.md)
- [NASA Space Apps challenge coverage](docs/challenge-coverage.md)
- [Architecture](docs/architecture.md)
- [Scientific method and limitations](docs/scientific-method.md)
- [Evidence inventory](docs/evidence-report.md) · [machine-readable checks](docs/evidence-inventory.json)
- [Data and publication formats](docs/data-specification.md)
- [Operator guide](docs/operator-guide.md)
- [Deployment, publishing, recovery](docs/deployment.md)
- [User guide and roadmap](docs/user-guide.md)
- [Volcano method, data provenance, and limitations](docs/volcano-method.md)
- [Volcano release and acceptance report](docs/volcano-release.md)
- [Chókwè catalog investigation](docs/chokwe-catalog-check.json)

Catalog availability may change; verify NASA CMR before another study. Chókwè is processed separately from the PROVISIONAL time series using its matching January 5–17 NISAR BETA pair. Its HLS optical check is inconclusive; a later UNOSAT Sentinel-1 overlay provides positive spatial support but not an accuracy assessment.

# Agriculture / SME2 release and QA status

## Implementation

- /agriculture uses the shared InvestigationWorkspace shell and appears in the phenomena registry and topic navigation.
- Interactive map supports pan/zoom, satellite/dark basemap switching, verified moisture/change previews and date-linked layer switching.
- Timeline buttons and keyboard-focusable chart points select the current observation.
- Explore, Operator and Evidence drawers expose statistics, local command generation, product maturity, quality protocol and provenance.
- CSV export includes per-date summary fields and source granule hashes when present.
- Browser publication loading is fail-closed: missing index gives an honest empty state; malformed schema, missing checksum entries, byte mismatch or SHA-256 mismatch withholds the study or image.
- Agriculture processing is isolated in pipeline/agriculture_sme2.py; it does not modify the Wetland, Forest or Volcano processing paths.

## Review work completed on Rubai-dev

The latest review tightened private-output handling and the first SME2 ingestion gates:

- `pipeline/output/agriculture/` is now ignored by Git so downloaded granules, receipts, native rasters and local processing outputs remain operator-only.
- The HDF5 reader resolves the primary baseline moisture layers from the root SME2 grid group. It rejects a candidate-only hierarchy instead of mistaking an algorithm-candidate layer for the baseline.
- The reader supports the documented root/ancillary location variation for `surfaceQualityFlag`, requires the root projection to resolve to EPSG:6933, checks volumetric moisture units, and parses standardized granule identity fields before grouping acquisitions.
- Regression fixtures cover duplicate candidate dataset names, both surface-flag locations, EPSG:6933, old releases, metadata conflicts, and units.

These are source/test changes only. They have **not been executed in this connected session**; no real SME2 file was downloaded or examined. The exact layout, metadata attributes, fill values and flag encodings must still be confirmed on a real PROVISIONAL granule before this pipeline is considered pilot-ready.

## Current ingestion-review changes

The current `Rubai-dev` review has committed the following guardrails:

- Private Agriculture downloads and native outputs under `pipeline/output/agriculture/` are excluded from Git.
- The analyzer selects the primary baseline soil-moisture layers from the SME2 root grid and rejects files that contain only similarly named algorithm-candidate layers.
- The release-dependent `surfaceQualityFlag` path is resolved from the root grid or ancillary-data group.
- The root projection must explicitly identify EASE-Grid 2.0 (EPSG:6933); soil-moisture units and standardized filename identity are checked before processing.
- Regression fixtures cover candidate-name collisions, the supported surface-flag locations, filename/release mismatches, unit strings and projection metadata.

The NASA/JPL specification describes the primary soil-moisture and uncertainty layers at the root SME2 grid, separately lists algorithm-candidate layers, identifies the EPSG:6933 grid, and defines retrieval/surface flags. The current zero-only surface screen is intentionally strict and can exclude dense-vegetation pixels. That can lower coverage in crop areas and must be displayed as a limitation rather than treated as evidence of no soil moisture.

## Scientific boundaries

- Product: NISAR_L3_SME2_PROVISIONAL_V1, PROVISIONAL maturity.
- No real Agriculture case is bundled or published by this integration.
- No live Earthdata-authenticated data run has been performed.
- No accuracy, crop-stress, drought, irrigation, crop-type, field-boundary or yield claims are supported.
- The 20% AOI coverage gate is fixed. Low target/change coverage is inconclusive.
- Synthetic HDF5 data are test-only and never written to public assets.

## QA execution status

The source and tests have been committed to Rubai-dev. This connected session cannot run the repository's local Node/Python environment, so the following remain NOT RUN HERE and must not be represented as passing:

| Check | Status |
|---|---|
| Agriculture Python unit suite | NOT RUN HERE |
| Python syntax compilation | NOT RUN HERE |
| Agriculture TypeScript schema tests | NOT RUN HERE |
| Project ESLint | NOT RUN HERE |
| Whole-project TypeScript check | NOT RUN HERE |
| Next.js production build | NOT RUN HERE |
| Agriculture browser tests at desktop/mobile sizes | NOT RUN HERE |
| Existing Wetland/Explore browser regression suites | NOT RUN HERE |
| Live NASA CMR and Earthdata granule download | NOT RUN — Earthdata credentials required |
| Real SME2 HDF5 metadata/fill/flag verification | NOT RUN |

## Release gate

Do not publish an Agriculture study until a real compatible SME2 series is downloaded and the operator confirms the actual granule hierarchy, grid mapping, coordinate vectors, fill attributes, release and quality-flag values. Run the full project regression suites before merging Rubai-dev into the upstream repository.

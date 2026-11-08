# Beyonders — Feature Differentiation

Compared against the products investigators actually use. The comparison
below is based on the products' documented purposes (NASA Worldview:
near-real-time global imagery browsing with a timeline; Copernicus
Browser: the ESA portal for searching, viewing, and downloading Sentinel
imagery, with compare/timelapse/indices; ASF Vertex: the Alaska Satellite
Facility's SAR data search and download, including Sentinel-1 and NISAR).
It is not a hands-on audit of those products, and no weakness below is
invented — where a product does something well, it says so.

## The core claim, stated honestly

Beyonders does not compete with these tools at browsing or downloading
imagery. It competes at the **investigation workflow**: one place where an
observation becomes a measured result, the result is screened by a
documented rule, the screening is checked against an independent
reference, the whole chain is inspectable, and the limitations are stated
in the same view as the result. That workflow is fragmented across the
other tools (search in one, download in another, analysis in a desktop
tool, validation nowhere).

No global-uniqueness claim is made: "no other tool does X" would require
an exhaustive survey that was not done.

## Matrix

| Capability | Worldview | Copernicus Browser | ASF Vertex | Beyonders |
|---|---|---|---|---|
| Browse global satellite imagery by date | Yes — 1,200+ layers, near-real-time, animated timeline | Yes — Sentinel archive, timelapse | Limited (search-focused, not a viewer) | Yes — GIBS tiles + 3D globe with published study markers |
| Search and download raw scenes | Snapshots; data via Earthdata Login | Yes — full products, GeoTIFF | Yes — the reference SAR archive | Yes — CMR search, Earthdata download (authenticated) |
| Process NISAR GCOV/GUNW/SME2 into derived measurements | No | No | No (delivery only) | Yes — 4 domain pipelines with documented methods |
| Quality-screen derived results by a stated rule | No | No | No | Yes — per-study screening rules, coverage floors, fill handling |
| Independent-reference comparison with honest status | No | Side-by-side visual compare only | No | Yes — HLS / Sentinel-1 / WorldCover checks with INCONCLUSIVE as a first-class state |
| Evidence lineage: trace a result to its granules | No | No | No (granule IDs exist, but no lineage view) | **Yes — `/lineage` (Phase 2)** |
| Scientific maturity per study (8 stages) | No | No | No | **Yes — `/observability` + maturity matrix (Phase 2)** |
| Competing-hypothesis workspace for one signal | No | No | No | Yes — scattering hypotheses per candidate (4 mechanisms, "not distinguished" as a status) |
| Evidence-aware reporting (exports with provenance + limits) | No | Image/GeoTIFF export | No | Yes — JSON/CSV/GeoJSON/HTML investigation reports |
| Before/after comparison | Timeline animation | Side-by-side compare | No | Yes — wipe, split-screen, flicker, zoom, scene inspector (Chókwè) |
| Observation coverage intelligence (what exists before you process) | No | Coverage shown per search | Search results show availability | Partial — global explorers check CMR/GIBS live and report unavailability; no pre-flight viability score |
| Reproducible investigation capsule | No | No | No | Partial — evidence.zip + checksums + run manifests; independent reproduction still needs Earthdata access, stated as such |

## What is genuinely distinctive

1. **Evidence Lineage Explorer** — no compared product offers a
   click-through graph from a displayed measurement back to its granules
   with per-node inspectable evidence. (Phase 2.)
2. **Maturity ladder as a product surface** — validation state is a
   first-class, always-visible property of every study, including the
   empty validation column. Competitors show data; Beyonders shows how
   far the data has been earned.
3. **Inconclusive as a designed state** — Tanguar and Hakaluki are
   presented as real exploratory investigations with named, quantified
   reasons for inconclusiveness (0.333% / 9 pixels), not hidden or
   softened. This is a product decision, not a data accident.

## What is an integration advantage, not a novelty

- One workflow across four domains sharing the same evidence language
  (stages, states, lineage) while keeping distinct algorithms.
- Map-led entry (globe + pin + real coverage check) into processing,
  instead of search-then-download-then-process across three tools.
- The homepage's real-data hydrograph and published-investigations strip:
  the product's own evidence is the demo, not a canned tour.

## What is experimental or unsupported

- **Temporal Investigation Studio** (synchronized map + timeline + charts
  workspace): the per-domain workbenches have the pieces; a single
  synchronized studio across all views is not built. Do not claim it.
- **Observation Coverage Intelligence** as a scored pre-flight check: not
  built; the live availability checks are the honest subset.
- **Reproducible Investigation Capsule**: packaging exists (evidence.zip,
  checksums, manifests); a one-click portable capsule with reproduction
  instructions is partial.
- Any claim that Beyonders "validates" a result: no study has reached
  validation. The product validates *workflow*, not findings.

# Beyonders — Earth in Motion
## Competition demo runbook

**Purpose:** Give the team a repeatable, evidence-first demonstration of the NISAR workflow. This is an internal rehearsal plan, not an official NASA submission format or time limit. Re-check the current Space Apps participant and judging guides before the event.

## Core message

**Beyonders turns NISAR observations into inspectable Earth-change investigations—not automatic declarations that a hazard occurred.**

NISAR radar can observe through cloud and darkness, but a change in radar return can have more than one physical cause. The product therefore keeps the observation, screening rule, candidate map, independent comparisons, coverage and uncertainty visible together.

The Chókwè, Mozambique case is the featured event investigation because it combines a real NISAR before/after pair with independent event context and follow-up mapping. It is **not** a validated flood-detection result: the local candidates remain unverified.

## Suggested four-minute live demo

### 0:00–0:25 — Introduce the problem

Open the homepage at `/`.

Say:

> NISAR gives us a new way to observe Earth's surface, day and night and through cloud. But radar is not a label: a changed signal can have several causes. Beyonders helps people inspect what the satellite measured, what our rules flagged, what other evidence supports or challenges, and what is still unknown.

Show the four workspaces briefly. Point out that each has its own measurement type and evidence maturity.

### 0:25–1:10 — Open the featured Chókwè investigation

Use the homepage **Inspect the Chókwè event case** link, or open:

`/wetland/global?story=chokwe`

The link should open the **Learn** tab at the Chókwè section.

Explain the measured inputs:

- NISAR L2 GCOV **BETA**, same-track ascending observations on 5 and 17 January 2026 (track 114, frame 165).
- The exploratory screen flags HH backscatter decreases of at least 2.5 dB against a one-date baseline.
- It flagged **127 radar-darkening candidate regions**, covering **29.87 km²** inside a **112.14 km² analyst-drawn study box**.
- These are radar-change candidates, not a flood map. The one-date baseline does not estimate temporal variability.

Show the NASA before/after imagery and the locally processed HH baseline/change views. Make clear that the local detector and NASA's published false-colour browse image are different products/views.

### 1:10–2:20 — Show how independent evidence changes the interpretation

Walk through the reference evidence in this order:

1. **HLS optical comparison:** 7–22 January. Only **1.26%** of the study box had common-clear coverage, and **none of the local candidate area was assessed**. This check is inconclusive; it neither confirms nor disproves the candidates.
2. **CIMA regional map:** Copernicus Sentinel-1/2 flood context updated 16 January, one day before the NISAR event observation. It supports the regional event but is not pixel-registered reference labels for the local study box.
3. **UNOSAT follow-up:** preliminary Sentinel-1 water extents on 23 and 24 January overlap **88.2%** and **89.1%** of the NISAR candidate area, respectively. These dates are six and seven days after the NISAR event observation. They provide later positive spatial support, not same-date truth, negative labels, field validation, or an accuracy score.

Close this section with the correct conclusion:

> Independent sources support the regional January flood event and provide follow-up spatial corroboration. They do not validate every local radar candidate. The detector result remains unverified.

### 2:20–3:20 — Inspect the actual processed run

In the Chókwè section, select **Open the processed Chókwè run**.

Use the opened workspace to show the study boundary, the selected observation, radar layers, and candidate inspection. Explain that the derived candidate polygons belong only to this processed study area and run. The global radar mosaic and worldwide scene footprints are observation context, not a worldwide change classification.

Where time permits, select one candidate and show the nearest-pixel HH/HV inspection. State that a pixel sample helps explain the radar response; it is not field truth.

### 3:20–4:00 — Prove the workflow generalises without conflating measurements

Open one supporting example:

- **Rondônia forest** (`/forest/rondonia`): a small NISAR GCOV radar-change candidate with exploratory HLS vegetation-index context. The optical signal is not a labelled forest-loss reference; no accuracy score is available.
- **Hayli Gubbi volcano** (`/volcano/hayli-gubbi`): official NISAR GUNW phase/coherence observations and separate Sentinel-1 comparisons. Apparent line-of-sight signal is not causal attribution or an eruption forecast.

End with the product proposition:

> One investigation workflow; different radar measurements; explicit evidence limits. The next step is more temporally matched independent references and field-reviewed labels—not stronger claims from the same data.

## Navigation quick reference

| Purpose | Route | Demo guidance |
|---|---|---|
| Homepage and module maturity | `/` | Start here; use the featured Chókwè link |
| Featured Chókwè case, opened at its story | `/wetland/global?story=chokwe` | Best primary entry point |
| Tanguar Haor wetland study | `/wetland` | Supporting wetland example; keep its optical check described as inconclusive |
| Global wetland observation and candidate workspace | `/wetland/global` | Candidates exist only for processed runs; blank areas are not no-change results |
| Worldwide NISAR scene footprints | `/wetland/global/scenes` | Acquisitions only; not global flood detections |
| Rondônia forest study | `/forest/rondonia` | Exploratory radar/optical comparison, not validated forest-loss classification |
| Hayli Gubbi volcano study | `/volcano/hayli-gubbi` | Phase/coherence investigation, not forecast or causal attribution |
| Agriculture / SME2 workspace | `/agriculture` | Genuine local SME2 study published: Naogaon `agri-41647231453` (6 valid dates, 12 Aug–23 Oct 2026, matched-pixel cohort of 1,336). Exploratory soil-moisture evidence only; do not present it as a crop-stress or drought result |

## Claims we can defend

- “The NISAR screen flagged 127 radar-darkening candidate regions over the stated Chókwè study box.”
- “The Chókwè local result is based on a NISAR L2 GCOV BETA pair and an exploratory HH threshold.”
- “The HLS comparison assessed none of the candidate area and is inconclusive.”
- “CIMA supplies near-date regional event context; UNOSAT supplies later preliminary positive spatial support.”
- “The local Chókwè candidates remain unverified; no accuracy score is claimed.”
- “Worldwide scene footprints show where observations were acquired, not where environmental change was detected.”

## Claims to avoid

- “NISAR achieved 88.2% or 89.1% flood-detection accuracy.” Those figures are later positive spatial overlap, not accuracy.
- “All 127 candidates are flooded” or “Beyonders produced a validated flood map.”
- “The CIMA regional map is a pixel-level reference for the Chókwè analysis box.”
- “The HLS check confirms the Chókwè candidates.”
- “The globe is a worldwide map of detected floods, forest loss or volcanic activity.”
- “The forest result is validated deforestation,” “the volcano result predicts an eruption,” or “Agriculture detects crop stress/drought.”

## Demo readiness checklist

### Before the presentation

- Deploy from the exact reviewed `master` commit; verify the deployment reports the expected commit and contains the Chókwè deep link. (`master` is the canonical delivery branch since 2026-11-08; do not deploy from `Rubai-dev`.)
- Open the homepage and every route in the quick-reference table on the actual demo device.
- Test the Chókwè deep link in a fresh browser tab. Confirm the Learn tab opens and the Chókwè heading is visible.
- Test **Open the processed Chókwè run**, candidate inspection, evidence images and source links.
- Check desktop and mobile layouts, browser console, map tiles, image loading and external reference links.
- Prepare local screenshots or a screen recording of the same reviewed build as a contingency. Label them as prepared backup material, not live data.
- Keep Earthdata credentials and local operator secrets out of the browser, screen recording, repository and slides.
- Verify citations and reuse/licensing terms for NASA, CIMA, UNOSAT, HLS, map tiles, basemaps, and every other third-party asset used in the submission.
- Confirm the team's event registration, roster and Local Event details. Follow the final participant guide on pre-event work and submission requirements.

### If a live service is unavailable

- Do not imply that a failed catalog request means no NISAR observation exists.
- Use only already published, checksum-verified case material that is present in the reviewed build.
- State when a view is a saved snapshot, a static evidence asset, or a locally processed result.
- If the Chókwè run cannot load, show the static case story and evidence comparisons; do not invent or manually redraw a candidate layer.
- If the map tiles fail, continue with the recorded dates, source imagery and evidence text rather than claiming the map is live.

## Questions judges may ask

**How do you know the Chókwè candidates are floods?**

We do not claim that they are all confirmed floods. NASA imagery and independent regional/follow-up mapping support the January event, but the local HLS check had only 1.26% common-clear coverage and assessed none of the candidate area. CIMA is not pixel-registered to the box, and UNOSAT is a preliminary positive-only reference six to seven days later. Therefore candidate-level accuracy is not established.

**Why use radar if optical imagery exists?**

Radar is complementary: it can acquire observations at night and through cloud, and its response to surface structure and dielectric properties differs from optical reflectance. It still needs physical interpretation and independent checks.

**Can the platform detect change anywhere on Earth?**

The platform can inspect worldwide NISAR acquisition coverage and lets an analyst define a study area. A change result is shown only where a real study has been processed and published. It does not classify the whole globe.

**What would make the science stronger?**

More closely timed independent observations, spatially matched reference labels with both positive and negative examples, field review, repeated studies across locations/seasons, and documented uncertainty and reproducible processing.

**Why are the modules different?**

Wetland and forest examples use NISAR L2 GCOV backscatter; the volcano example uses interferometric phase/coherence products; Agriculture is a separate SME2 soil-moisture workspace. Those measurements answer different questions and should not be presented as interchangeable.

## Final submission reminder

This runbook describes the current project and proposed rehearsal only. It does not override NASA's official challenge statement, the current participant Terms & Conditions, or the final 2026 participant and judging guides. Re-check the official materials when the final guides are published, and accurately distinguish pre-existing prototype work from work completed during the event.

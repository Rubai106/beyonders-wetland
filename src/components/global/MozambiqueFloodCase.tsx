"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useState } from "react";
import RadarPixelPhysicsInspector from "@/components/shared/RadarPixelPhysicsInspector";
import TriageBriefButton from "@/components/shared/TriageBriefButton";
import OpticalCoverageComparison from "@/components/shared/OpticalCoverageComparison";

const ChokwePixelMap = dynamic(() => import("./ChokwePixelMap"), { ssr: false, loading: () => <div className="chokwe-pixel-map">Loading the sampled NISAR map…</div> });

const NASA_CASE_URL = "https://svs.gsfc.nasa.gov/5661";
const UNOSAT_REFERENCE_URL = "https://unosat.org/products/4232";
const UNOSAT_SHP_URL = "https://unosat.org/static/unosat_filesystem/4232/FL20251231MOZ_SHP.zip";
const CIMA_REFERENCE_URL = "https://www.cimafoundation.org/en/news/mozambique-heavy-rainfall-in-the-south-cooperation-and-monitoring-to-manage-flood-risk/";
const CHOKWE_RUN_ID = "ec8fa5ee15ae41d1aa89f930f2b47e36";
const CHOKWE_RELEASE = `/studies/releases/2026.10.29-chokwe/runs/${CHOKWE_RUN_ID}`;

const images = [
  {
    date: "5 January 2026",
    label: "Before the flood comparison",
    sourceName: "NASA",
    sourcePage: NASA_CASE_URL,
    imagePath: "/evidence/mozambique/Pre_Chokwe.png",
    alt: "NASA NISAR false-color L-band radar image over Chókwè, Mozambique, acquired 5 January 2026",
    width: 1920,
    height: 1080,
  },
  {
    date: "17 January 2026",
    label: "During the flood",
    sourceName: "NASA",
    sourcePage: NASA_CASE_URL,
    imagePath: "/evidence/mozambique/Post_Chokwe.png",
    alt: "NASA NISAR false-color L-band radar image over Chókwè, Mozambique, acquired 17 January 2026",
    width: 1920,
    height: 1080,
  },
  {
    date: "5 January 2026",
    label: "Project HH baseline · NISAR L2 GCOV BETA",
    sourceName: "Beyonders",
    sourcePage: "#mozambique-case-title",
    imagePath: `${CHOKWE_RELEASE}/radar_00_hh_before.png`,
    alt: "Locally processed NISAR HH backscatter baseline over the Chókwè study box, 5 January 2026",
    width: 699,
    height: 768,
    local: true,
  },
  {
    date: "17 January 2026",
    label: "Project HH change · after minus before",
    sourceName: "Beyonders",
    sourcePage: "#mozambique-case-title",
    imagePath: `${CHOKWE_RELEASE}/radar_00_hh_change.png`,
    alt: "Locally processed NISAR HH backscatter change from 5 to 17 January 2026 over the Chókwè study box",
    width: 699,
    height: 768,
    local: true,
    note: "Blue indicates lower HH return (−10 to +10 dB display scale); darkening is a candidate signal, not proof of floodwater.",
  },
  {
    date: "16 January 2026",
    label: "Independent Sentinel-1/2 flood map · CIMA",
    sourceName: "CIMA",
    sourcePage: CIMA_REFERENCE_URL,
    imagePath: "/evidence/mozambique/cima_flood_2026-01-16.avif",
    alt: "CIMA map of southern Mozambique flooding from Copernicus Sentinel-1 and Sentinel-2, updated 16 January 2026; cyan shows flooded areas, blue permanent water, and black no data",
    width: 1024,
    height: 678,
    reference: true,
  },
];

export default function MozambiqueFloodCase({ onLocate, onOpenRun }: { onLocate: () => void; onOpenRun: () => void }) {
  const [samplePoint, setSamplePoint] = useState<{ lat: number; lon: number } | null>(null);
  return (
    <section className="mozambique-case" aria-labelledby="mozambique-case-title">
      <div className="mozambique-case__heading">
        <div>
          <p className="global-eyebrow">FEATURED EVENT INVESTIGATION · CHÓKWÈ, MOZAMBIQUE</p>
          <h2 id="mozambique-case-title">Chókwè: independent maps support the flood event</h2>
        </div>
        <span className="mozambique-case__verdict"><i aria-hidden="true" /> Follow-up support · accuracy unverified</span>
      </div>

      <div className="mozambique-case__body">
        <div className="mozambique-case__story">
          <p className="mozambique-case__lead">
            NASA’s published imagery documents the January flood. We also processed the same 5 and 17 January NISAR BETA pair: the exploratory HH rule flagged 127 radar-darkening regions covering 29.87 km² inside a 112.14 km² analyst-drawn box. These are candidates, not a flood map.
          </p>

          <dl className="mozambique-case__facts">
            <div>
              <dt>Local NISAR run · L2 GCOV BETA</dt>
              <dd>5 Jan → 17 Jan · HH/HV · HH decrease ≤ −2.5 dB · one-date baseline</dd>
            </div>
            <div>
              <dt>Independent optical check · HLS Sentinel-2</dt>
              <dd>7 Jan → 22 Jan · 2/5 days from NISAR · 1.26% common-clear area</dd>
            </div>
            <div>
              <dt>Near-date independent map · CIMA Sentinel-1/2</dt>
              <dd>16 Jan · one day before the NISAR event scene · regional map, not a pixel reference for this box</dd>
            </div>
            <div>
              <dt>Follow-up positive support · UNOSAT Sentinel-1</dt>
              <dd>23 Jan: 88.2% overlap · 24 Jan: 89.1% · 6/7 days after NISAR</dd>
            </div>
          </dl>

          <p className="mozambique-case__reference-copy">
            The HLS optical comparison remains inconclusive: only 1.41 km² of the 112.14 km² study box had common-clear coverage, below the 20% assessment floor, and none of the radar candidates was assessed. Independent event evidence is available, but answers a different question. CIMA’s Copernicus Sentinel-1/2 map updated 16 January, one day before NISAR, documents regional flooding; it is not registered as pixel labels for this study box. UNOSAT’s later Sentinel-1 water extents overlap 26.35 km² (88.2%) and 26.63 km² (89.1%) of candidates on 23 and 24 January, with all candidates inside its analysis extent. That is positive follow-up spatial support, not same-date truth: the product is 6–7 days later, preliminary, and not field-validated, with no assessed negative labels. The case supports the flood event regionally; the detector’s individual candidates remain unverified.
          </p>

          <details className="mozambique-case__method">
            <summary>Scene IDs, method, and interpretation limits</summary>
            <code>NISAR_L2_PR_GCOV_009_114_A_165_4005_DHDH_A_20260105T034232_20260105T034253_X05010_N_P_J_001</code>
            <code>NISAR_L2_PR_GCOV_010_114_A_165_4005_DHDH_A_20260117T034232_20260117T034254_X05010_N_P_J_001</code>
            <p>These are same-track ascending observations (track 114, frame 165). The local screen compares HH power in dB and flags a decrease of at least 2.5 dB; only one acquisition forms the baseline, so temporal variability is not estimated. Product maturity is BETA. The HH change preview is a display resampled to Web Mercator; the reported 29.87 km² is measured on the native analysis grid. Backscatter can also change with soil moisture, roughness, vegetation, and land use.</p>
            <p>NASA’s separate browse visualization assigns HH to red, HV to green, and the HH/HV ratio to blue. It is useful event context, not the local detector input or an independent pixel reference.</p>
          </details>
          <p className="mozambique-case__image-note"><a href={UNOSAT_SHP_URL} target="_blank" rel="noopener noreferrer">Download the UNOSAT Sentinel-1 GIS layers (ZIP) ↗</a> · Overlay report: <a href="/evidence/chokwe-unosat-overlap.json">JSON</a></p>

          <button className="mozambique-case__locate" type="button" onClick={onOpenRun}>
            Open the processed Chókwè run
          </button>
          <button className="mozambique-case__locate" type="button" onClick={onLocate}>
            Locate Chókwè on the world map
          </button>
          <p className="mozambique-case__map-note">The map pin marks the town center for context; it is not a flood boundary.</p>
        </div>

        <div className="mozambique-case__images" role="group" aria-label="NASA before-and-during-flood images and CIMA independent flood map">
          {images.map((image) => (
            <figure className={`mozambique-case__image${image.reference ? " mozambique-case__image--reference" : ""}`} key={image.imagePath}>
              <figcaption><span>{image.label}</span><time>{image.date}</time></figcaption>
              <a className="mozambique-case__image-link" href={image.imagePath} target="_blank" rel="noopener noreferrer" aria-label={`Open full-size ${image.sourceName} image: ${image.label}`}>
                <Image src={image.imagePath} alt={image.alt} width={image.width} height={image.height} sizes="(max-width: 700px) 100vw, 50vw" unoptimized={image.imagePath.endsWith(".avif")} />
              </a>
              {image.note && <p className="mozambique-case__image-note">{image.note}</p>}
              <a className="mozambique-case__attribution" href={image.sourcePage} target={image.local ? undefined : "_blank"} rel={image.local ? undefined : "noopener noreferrer"}>{image.local ? "Beyonders processed output · see run details ↗" : image.sourceName === "CIMA" ? "CIMA Sentinel-1/2 map ↗" : "NASA NISAR source image ↗"}</a>
            </figure>
          ))}
        </div>
      </div>

      <OpticalCoverageComparison />
      <section className="mozambique-case__native" aria-labelledby="chokwe-native-title">
        <div className="mozambique-case__native-heading">
          <div>
            <p className="global-eyebrow">FOLLOW-UP · NATIVE GRID · 10 NOV 2026</p>
            <h3 id="chokwe-native-title">A second satellite product provides positive spatial support</h3>
          </div>
          <span>Not field validation</span>
        </div>
        <p className="mozambique-case__native-intro">
          A separate recovery reprocessed the pinned 5 and 17 January NISAR L2 GCOV BETA scenes, then compared the new 10 m native NISAR grid with Copernicus Global Flood Monitoring (GFM) NRT v4.1.0. The selected GFM scene was acquired 23 minutes 45 seconds before the NISAR event scene. GFM layers and their validity masks were sampled onto the NISAR grid; the NISAR rasters were not resampled.
        </p>
        <div className="mozambique-case__native-grid">
          <div>
            <strong>39.4%</strong>
            <span>eligible open-water candidates with positive GFM flood support</span>
            <small>57,997 of 147,151 pixels</small>
          </div>
          <div>
            <strong>5.80 km²</strong>
            <span>native-grid positive overlap</span>
            <small>Of 14.72 km² eligible candidates</small>
          </div>
          <div>
            <strong>88.6%</strong>
            <span>native AOI with common-valid GFM data</span>
            <small>993,517 of 1,121,391 pixels</small>
          </div>
        </div>
        <p className="mozambique-case__native-note">
          The recovery produced 29.8718 km² of open-water radar-change candidates. GFM exclusion, reference-water and no-common-data masks reduce the comparison denominator to 14.7151 km². The remaining 89,154 eligible candidate pixels were not mapped as flood by this GFM scene; they are not treated as false alarms or ground-truth negatives.
        </p>
        <details className="mozambique-case__native-method">
          <summary>Method, provenance, and limits</summary>
          <p>Published source run: <code>ec8fa5ee15ae41d1aa89f930f2b47e36</code>. Separate reprocessing run: <code>6cbe03836ada44b09188b9aee2b94bc3</code>. The follow-up does not replace or rewrite the original published candidate layer.</p>
          <p>The GFM flood-extent, likelihood, exclusion and reference-water layers were each sampled with nearest-neighbour alignment onto the 10 m NISAR grid. A pixel counted as common-valid only when all four sampled GFM layers were valid. Permanent/seasonal reference water and excluded pixels were kept out of the eligible denominator.</p>
          <p>This is positive-only spatial support between two satellite algorithms. It is not field validation and does not provide precision, recall, F1 or accuracy. The original HLS optical comparison remains inconclusive. This follow-up is reprocessing, not restoration of the original missing TIFF bytes, and it does not upgrade the original published Chókwè result.</p>
        </details>
        <nav className="mozambique-case__native-links" aria-label="Native Chókwè follow-up evidence files">
          <a href="/evidence/chokwe-native-recovery-2026-11-10.json">Recovery provenance summary JSON ↗</a>
          <a href="/evidence/chokwe-native-gfm-comparison-2026-11-10.json">Native-grid GFM comparison JSON ↗</a>
        </nav>
      </section>
      <section className="chokwe-physics" aria-label="Interactive Chókwè radar pixel inspection">
        <div><h3>Inspect the NISAR signal</h3><p>Click the HH event map or enter coordinates. The readout samples published L-band HH/HV pixels at the nearest preview-grid cell.</p></div>
        <ChokwePixelMap point={samplePoint} onPick={setSamplePoint}/>
        <RadarPixelPhysicsInspector mode="wetland" dataUrl="/physics/chokwe/2026.10.29-v1/pixel-grid.json" point={samplePoint} onPointChange={setSamplePoint}/>
      </section>

      <div className="mozambique-case__evidence">
        <div>
          <strong>What the evidence supports</strong>
          <p>CIMA’s independent Copernicus Sentinel-1/2 flood map is dated one day before the NISAR event observation, and UNOSAT’s later Sentinel-1 water extents overlap 88.2% and 89.1% of the NISAR candidate pixels on 23 and 24 January. These sources support the regional flood event and provide follow-up spatial corroboration.</p>
        </div>
        <div className="mozambique-case__limits">
          <strong>What it does not establish</strong>
          <p>The HLS check assessed none of the local candidate area and had just 1.26% common-clear coverage. CIMA’s regional map is not pixel-registered to the analysis box. UNOSAT is a preliminary, unvalidated map dated 6–7 days later and supplies no negative reference labels. Regional agreement cannot validate each local candidate or produce an accuracy score; keep the detector result unverified.</p>
        </div>
        <nav className="mozambique-case__sources" aria-label="Sources for the Mozambique case">
          <a href={NASA_CASE_URL} target="_blank" rel="noopener noreferrer">NASA NISAR case ↗</a>
          <a href={UNOSAT_REFERENCE_URL} target="_blank" rel="noopener noreferrer">UNOSAT map and data ↗</a>
          <a href={UNOSAT_SHP_URL} target="_blank" rel="noopener noreferrer">UNOSAT GIS download ↗</a>
          <a href={CIMA_REFERENCE_URL} target="_blank" rel="noopener noreferrer">CIMA Sentinel-1/2 report ↗</a>
        </nav>
        <div className="radar-brief-row"><TriageBriefButton filename="chokwe-flood-evidence-triage.json" title="Chókwè flood-candidate triage brief" brief={{ site: "Chókwè, Mozambique", nisar_input_dates: ["2026-01-05", "2026-01-17"], product: "NISAR L2 GCOV BETA", method: "One-date HH backscatter decrease ≤ −2.5 dB", candidate_patches: 127, candidate_area_km2: 29.8718, analysis_box_area_km2: 112.1391, hls_common_clear_fraction: 0.012554942923565465, hls_candidate_assessed_fraction: 0, near_date_cima_context: { date: "2026-01-16", sensor: "Copernicus Sentinel-1/2", offset_days_from_nisar_event: -1, status: "REGIONAL_EVENT_CONTEXT_ONLY_NOT_PIXEL_REGISTERED_REFERENCE", source: CIMA_REFERENCE_URL }, unosat_follow_up: [{ date: "2026-01-23", positive_overlap_fraction: 0.8822 }, { date: "2026-01-24", positive_overlap_fraction: 0.8914 }], native_grid_follow_up: { recovery_run_id: "6cbe03836ada44b09188b9aee2b94bc3", recovery_type: "Reprocessing of the pinned NISAR pair; not restoration of original TIFF bytes", gfm_item: "ENSEMBLE_FLOOD_20260117T031847_VV_AF020M_E066N021T3", gfm_nrt_version: "4.1.0", gfm_minutes_from_nisar_event: -23.75, native_grid: { crs: "EPSG:32736", pixel_size_m: 10, dimensions: [1014, 1108] }, common_valid_gfm_fraction: 0.8859684088779025, native_open_water_candidate_pixels: 298718, native_open_water_candidate_area_km2: 29.8718, eligible_candidate_pixels_after_gfm_masks: 147151, eligible_candidate_area_km2: 14.7151, gfm_positive_overlap_pixels: 57997, gfm_positive_overlap_area_km2: 5.7997, positive_support_fraction: 0.3941325577128256, eligible_candidates_not_mapped_as_gfm_flood: 89154, accuracy_metrics: { precision: null, recall: null, f1: null, accuracy: null }, report: "/evidence/chokwe-native-gfm-comparison-2026-11-10.json", recovery_provenance_summary: "/evidence/chokwe-native-recovery-2026-11-10.json" }, interpretation: "The regional January flood event is supported by independent mapping; local NISAR radar-darkening candidates remain unverified, with later positive spatial support from preliminary UNOSAT Sentinel-1 water extent.", unavailable: { population_or_road_exposure: "Not assessed.", field_verified_flood_extent: "Unavailable.", operational_warning: "Not issued." }, limitations: ["HLS comparison is inconclusive: only 1.26% common-clear coverage and no candidates assessed.", "CIMA's 16 January regional map is not pixel-registered to the local study box.", "UNOSAT dates are 6–7 days later, preliminary, unvalidated, and contain no reference-negative labels.", "Candidate overlap is not an accuracy score; not every radar candidate is confirmed as floodwater."] }}/><span>No population exposure or operational flood warning is inferred.</span></div>
      </div>
    </section>
  );
}

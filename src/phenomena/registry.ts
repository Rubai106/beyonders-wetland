/* GeoNexSAR phenomena registry — separate, evidence-labelled Earth-change modules. */
export type PhenomenonStatus = "AVAILABLE" | "PLANNED";
export type PhenomenonId = "wetland" | "forest" | "volcano" | "agriculture";
export interface PhenomenonBriefing {
  lede: string;
  radarSees: { title: string; text: string }[];
  needs: string[];
}
export interface Phenomenon {
  id: PhenomenonId;
  name: string;
  tagline: string;
  /** Current evidence maturity shown on the landing page. */
  evidenceSummary: string;
  status: PhenomenonStatus;
  href?: string;
  caseHref: string;
  caseLabel: string;
  featureHighlights: readonly string[];
  /** Every module exposes the same five capabilities. */
  contract: readonly ["time", "change", "evidence", "investigation", "uncertainty"];
  /** Optional science context for a module introduction. */
  briefing?: PhenomenonBriefing;
}
const CONTRACT = ["time", "change", "evidence", "investigation", "uncertainty"] as const;
export const PHENOMENA: Phenomenon[] = [
  {
    id: "wetland", name: "Wetlands", tagline: "Water moves.",
    evidenceSummary: "Tanguar and Hakaluki have seven-date NISAR PROVISIONAL series; HLS checks are inconclusive at both sites. Chókwè is a separate two-scene BETA event study, and its candidates remain unverified.",
    status: "AVAILABLE", href: "/wetland/global",
    caseHref: "/wetland", caseLabel: "Open the Tanguar Haor study",
    featureHighlights: [
      "NISAR HH/HV views with a date-by-date pulse timeline",
      "Candidate evidence, region search, and threshold sensitivity",
      "Optical cross-checks with clear-coverage and uncertainty shown",
    ],
    contract: CONTRACT,
  },
  {
    id: "agriculture", name: "Agriculture", tagline: "Soil moisture changes.",
    evidenceSummary: "A genuine six-date NISAR SME2 PROVISIONAL series is published, with 57.9% valid target-date coverage and a 21.3% fixed all-date pixel cohort. It is exploratory soil-moisture evidence, not crop-stress validation.",
    status: "AVAILABLE", href: "/agriculture",
    caseHref: "/agriculture", caseLabel: "Open the SME2 soil-moisture workspace",
    featureHighlights: [
      "NISAR SME2 PROVISIONAL soil-moisture observations",
      "Dated moisture layers, uncertainty ranges, and baseline comparison",
      "Traceable granules, quality flags, coverage gates, and provenance",
    ],
    contract: CONTRACT,
    briefing: {
      lede: "The Agriculture workspace explores the NISAR Level-3 SME2 soilMoisture variable as an exploratory measurement series. It does not classify crops or diagnose agricultural stress.",
      radarSees: [
        { title: "Soil-moisture estimates", text: "SME2 provides a gridded estimate of near-surface soil moisture with uncertainty and retrieval-quality information. Product maturity and quality flags remain visible." },
        { title: "Changes through time", text: "A later observation can be compared with the median of an explicitly selected baseline series, but moisture differences can have several causes." },
        { title: "Coverage before interpretation", text: "Only pixels that pass the retrieval and surface-quality screen count as assessed. Low coverage remains inconclusive rather than being filled or hidden." },
      ],
      needs: [
        "A compatible set of genuine SME2 PROVISIONAL granules and Earthdata authentication",
        "Consistent native grid, product release, track, direction, frame and frequency",
        "Field or independent agricultural references before making crop-related claims",
        "Documented limits: this workflow does not detect crop stress, drought, irrigation need, crop type, field boundaries or yield impacts",
      ],
    },
  },
  {
    id: "forest", name: "Forests", tagline: "Vegetation changes.",
    evidenceSummary: "Rondônia has one 0.0128 km² radar candidate; an exploratory HLS index signal overlaps 71.1%. No labelled forest-loss reference or accuracy score is available.",
    status: "AVAILABLE", href: "/forest/global",
    caseHref: "/forest/rondonia", caseLabel: "Open the Rondônia study",
    featureHighlights: [
      "WorldCover 2021 context beside worldwide NISAR coverage",
      "Rondônia HH/HV time series, HLS evidence, and GLAD-S2 alerts",
      "Map-layer comparison, pixel inspector, and evidence downloads",
    ],
    contract: CONTRACT,
    briefing: {
      lede: "The Rondônia study uses NISAR L-band backscatter to screen persistent radar changes within historical tree cover, then compares candidates with available optical evidence.",
      radarSees: [
        { title: "Canopy loss", text: "Cleared or burned forest changes how L-band backscatter returns. A sustained drop in volume scattering between passes is the core deforestation signal." },
        { title: "Degradation, not just clear-cuts", text: "Selective logging and fire damage alter canopy structure before any optical satellite sees a hole. Polarimetry (HH/HV) is sensitive to exactly this structural change." },
        { title: "Regrowth", text: "The same time series run forward shows recovery: backscatter climbing back as secondary forest rebuilds structure, season after season." },
      ],
      needs: [
        "More locations and dates with independently reviewed forest-change references",
        "Better temporal matching between optical evidence and NISAR acquisitions",
        "Careful separation of seasonal vegetation changes from persistent disturbance",
        "Documented limits: radar change alone does not prove clearing, fire, or biomass loss",
      ],
    },
  },
  {
    id: "volcano", name: "Volcanoes", tagline: "The surface transforms.",
    evidenceSummary: "Hayli Gubbi shows screened apparent line-of-sight phase candidates. Sentinel-1 is a separate comparison; the measured signals are not causally attributed to the eruption.",
    status: "AVAILABLE", href: "/volcano/global",
    caseHref: "/volcano/hayli-gubbi", caseLabel: "Open the Hayli Gubbi study",
    featureHighlights: [
      "NISAR line-of-sight motion, phase fringes, and coherence change",
      "Selected intervals compared with independent Sentinel-1 products",
      "Coordinate inspection, source data, quality masks, and uncertainty",
    ],
    contract: CONTRACT,
    briefing: {
      lede: "The Hayli Gubbi study explores official NISAR interferometric phase and coherence products alongside Sentinel-1 observations and eruption context.",
      radarSees: [
        { title: "Ground deformation", text: "Magma moving underground inflates or deflates the edifice. InSAR phase differences between passes map that motion across the whole volcano, day and night, through ash and cloud." },
        { title: "New lava and deposits", text: "Fresh lava flows and pyroclastic deposits radically change surface roughness — a strong amplitude-change signal, the same family of detection the wetland module already runs." },
        { title: "Crater and flank change", text: "Dome growth, collapse scars, and flank instability all reshape the surface between observations. Each becomes a dated, mapped change event." },
      ],
      needs: [
        "More processed volcanoes and dates before making broader claims",
        "Additional independent geodetic observations for deformation validation",
        "Atmospheric, ionospheric, orbit, and terrain-error correction before stronger attribution",
        "Documented limits: a phase feature is not automatically volcanic motion or an eruption forecast",
      ],
    },
  },
];

export function getPhenomenon(id: PhenomenonId): Phenomenon | undefined {
  return PHENOMENA.find((p) => p.id === id);
}

import { NextRequest, NextResponse } from "next/server";
import { PipelineOutputError, pipelineRun, readPipelineOutput } from "@/lib/pipeline-output";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

type PulseDate = { date: string; area_km2: number; patches: number };
type Observation = { date: string; patches_file: string; scene_name?: string | null;
  baseline_method?: { baseline_observation_count?: number; baseline_observation_dates?: string[]; baseline_scene_names?: string[] } };

export async function GET(request: NextRequest) {
  const limit = checkRateLimit(request, "general");
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  try {
    const run = pipelineRun(request.nextUrl.searchParams.get("run"));
    const dataSource = run.manifest.data_source === "NISAR" ? "NISAR"
      : run.manifest.data_source === "SIMULATED_DEMO" ? "SIMULATED_DEMO" : "UNVERIFIED";

    if (dataSource !== "NISAR") {
      return NextResponse.json({
        run_id: run.manifest.run_id,
        data_source: dataSource,
        status: "no-real-nisar-run",
        product: null,
        product_maturity: null,
        reference_validated: false,
        cross_sensor_check_completed: false,
        reference_check_status: "NOT_RUN",
        baseline_date: null,
        selected_date: null,
        baseline_scene: null,
        selected_scene: null,
        polarizations: [],
        dates: [],
        stats: null,
        detections: { type: "FeatureCollection", features: [] },
        boundary: null,
        case_study: null,
        reference_validation: null,
      });
    }

    const pulse = readPipelineOutput("wetland_pulse.json", run) as { dates?: PulseDate[] };
    const observations = readPipelineOutput("observations.json", run) as Observation[];
    if (!Array.isArray(pulse.dates) || !Array.isArray(observations)) throw new Error("Invalid NISAR observation index.");

    const availableDates = observations.map((item) => item.date)
      .filter((date): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date));
    const requestedDate = request.nextUrl.searchParams.get("date");
    const selectedDate = requestedDate || (typeof run.manifest.selected_date === "string" ? run.manifest.selected_date : availableDates.at(-1));
    const observation = observations.find((item) => item.date === selectedDate);
    if (!observation) {
      return NextResponse.json({ error: "That date is not in the completed NISAR run.", dates: availableDates }, { status: 400 });
    }

    const output = readPipelineOutput(observation.patches_file, run) as { type?: unknown; features?: unknown[] };
    if (output.type !== "FeatureCollection" || !Array.isArray(output.features)) throw new Error("Invalid NISAR detection output.");
    const boundary = readPipelineOutput("site_boundary.geojson", run) as { type?: unknown; features?: unknown[] };
    if (boundary.type !== "FeatureCollection" || !Array.isArray(boundary.features)) throw new Error("Invalid NISAR study boundary.");
    const caseStudy = readPipelineOutput("case_study.json", run) as Record<string, unknown>;
    try {
      const config = readPipelineOutput("processing_config.json", run) as { processing?: { minimum_valid_fraction?: unknown } };
      const minimumValidFraction = config.processing?.minimum_valid_fraction;
      const method = caseStudy.method as Record<string, unknown> | undefined;
      if (typeof minimumValidFraction === "number" && Number.isFinite(minimumValidFraction) && method && method.minimum_valid_fraction == null) {
        caseStudy.method = { ...method, minimum_valid_fraction: minimumValidFraction };
      }
    } catch {
      // Older public study packages may omit the operator processing configuration.
    }
    const referenceValidation = readPipelineOutput("reference_validation.json", run) as Record<string, unknown>;

    const stats = pulse.dates.find((item) => item.date === selectedDate) ?? null;
    return NextResponse.json({
      run_id: run.manifest.run_id,
      data_source: "NISAR",
      site_name: run.manifest.site_name ?? "Study area",
      site_bounds: run.manifest.site_bounds ?? null,
      boundary_source: run.manifest.wetland_boundary_source ?? null,
      status: "ready",
      product: run.manifest.product ?? null,
      product_maturity: run.manifest.product_maturity ?? "PROVISIONAL",
      reference_validated: false,
      cross_sensor_check_completed: run.manifest.cross_sensor_check_completed === true,
      reference_check_status: run.manifest.reference_check_status ?? "NOT_RUN",
      baseline_date: run.manifest.baseline_date ?? null,
      baseline_observation_dates: run.manifest.baseline_observation_dates ?? null,
      selected_date: selectedDate,
      baseline_scene: run.manifest.baseline_scene ?? null,
      selected_baseline: observation.baseline_method ?? null,
      selected_scene: observation.scene_name ?? null,
      polarizations: Array.isArray(run.manifest.polarizations) ? run.manifest.polarizations : ["HHHH", "HVHV"],
      dates: availableDates,
      stats,
      detections: { type: "FeatureCollection", features: output.features },
      boundary,
      case_study: caseStudy,
      reference_validation: referenceValidation,
    });
  } catch (error) {
    const status = error instanceof PipelineOutputError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load NISAR detections." }, { status });
  }
}

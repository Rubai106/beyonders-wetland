import type { Metadata } from "next";
import Link from "next/link";
import { buildPlatformHealth, type StudyHealth } from "@/lib/observation-health";
import { loadStudyQuality } from "@/lib/evidence-quality-server";
import type { StudyQuality } from "@/lib/evidence-quality";
import "./investigations.css";

export const metadata: Metadata = {
  title: "Investigations · GeoNexSAR",
  description:
    "Every published GeoNexSAR investigation in one directory — domain, product, acquisition window, and evidence status, with nothing validated that is not.",
};

export const dynamic = "force-dynamic";

const DOMAIN_LABEL: Record<StudyHealth["domain"], string> = {
  wetland: "Wetlands",
  forest: "Forests",
  volcano: "Volcanoes",
  agriculture: "Agriculture",
};

/** The one figure that says what the study actually measured. */
function headlineFigure(quality: StudyQuality | undefined): string | null {
  if (!quality) return null;
  const pick = quality.figures.find((f) =>
    ["Radar candidate", "Soil-moisture change", "Optical support overlap", "Interferogram pairs", "Interferogram pair"].includes(f.label),
  );
  return pick ? `${pick.label}: ${pick.valueText}` : null;
}

function windowText(study: StudyHealth): string {
  if (study.observationDates.length > 1) {
    return `${study.observationDates[0]} → ${study.observationDates[study.observationDates.length - 1]} (${study.observationDates.length} dates)`;
  }
  if (study.observationDates.length === 1) return study.observationDates[0];
  return "Interval dates on the case page";
}

export default async function InvestigationsPage() {
  const health = await buildPlatformHealth();
  const { studies: quality, missing } = await loadStudyQuality();
  const qualityById = new Map(quality.map((q) => [q.studyId, q]));
  const studies = health.domains.flatMap((d) => d.studies);

  return (
    <main className="inv-page">
      <header className="inv-head">
        <p className="inv-eyebrow">Investigations · all published cases</p>
        <h1>Choose an investigation.</h1>
        <p>
          Seven published studies across four domains. Each one opens the same
          workspace: the observation, the change the algorithm flagged, the
          independent reference, and what is still missing. No study here is
          validated.
        </p>
        {missing.length > 0 && (
          <p className="inv-missing" role="status">
            Quality figures could not be read for: {missing.join(", ")}. Those
            studies are listed without a headline figure, not as zero.
          </p>
        )}
      </header>

      <section className="inv-worldwide" aria-label="Worldwide observation">
        <h2>Start from the planet</h2>
        <p>
          Worldwide footprints are satellite <strong>acquisitions</strong>, not
          detections. Processed results exist only inside the published cases below.
        </p>
        <div className="inv-worldwide__links">
          <Link href="/wetland/global">Wetlands worldwide →</Link>
          <Link href="/forest/global">Forests worldwide →</Link>
          <Link href="/volcano/global">Volcanoes worldwide →</Link>
        </div>
        <p className="inv-note">Agriculture has no worldwide explorer — the Naogaon soil-moisture workspace is the entry point.</p>
      </section>

      <section className="inv-list" aria-label="Published investigations">
        {studies.map((study) => {
          const figure = headlineFigure(qualityById.get(study.id));
          return (
            <article key={study.id} className="inv-card">
              <header>
                <p className="inv-domain">{DOMAIN_LABEL[study.domain]}</p>
                <h2>
                  <Link href={study.href}>{study.name}</Link>
                </h2>
                <p className="inv-product">
                  {study.product} · {study.productMaturity}
                </p>
              </header>
              <dl className="inv-facts">
                <div>
                  <dt>Acquisition window</dt>
                  <dd>{windowText(study)}</dd>
                </div>
                <div>
                  <dt>Evidence status</dt>
                  <dd>
                    {study.evidenceStatus} — {study.state.replaceAll("_", " ")}
                  </dd>
                </div>
                {figure && (
                  <div>
                    <dt>Measured</dt>
                    <dd>{figure}</dd>
                  </div>
                )}
              </dl>
              <p className="inv-validation">{study.validationNote}</p>
              <p className="inv-open">
                <Link href={study.href}>Open investigation →</Link>
              </p>
            </article>
          );
        })}
      </section>

      <section className="inv-tools" aria-label="Advanced analysis">
        <h2>Advanced analysis</h2>
        <p>
          The tools below work on the same published evidence. They are not in
          the primary navigation because they are second steps, not destinations.
        </p>
        <div className="inv-tools__links">
          <Link href="/lineage">Evidence lineage</Link>
          <Link href="/temporal">Temporal Studio</Link>
          <Link href="/hypotheses">Hypothesis &amp; Falsification Lab</Link>
          <Link href="/compare">Compare studies</Link>
          <Link href="/observability">Evidence &amp; observation health</Link>
        </div>
      </section>
    </main>
  );
}

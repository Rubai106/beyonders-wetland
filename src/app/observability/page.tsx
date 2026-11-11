import type { Metadata } from "next";

/* Platform observation health — a server-rendered view computed from the
   published manifests in public/. No values are invented: a missing manifest
   is reported as missing, and live services are labelled "not checked here". */
import Link from "next/link";
import { buildPlatformHealth, MATURITY_STAGES, OBSERVATION_STATES } from "@/lib/observation-health";
import type { StudyHealth } from "@/lib/observation-health";
import { qualityBarWidth } from "@/lib/evidence-quality";
import { loadStudyQuality } from "@/lib/evidence-quality-server";
import "./observability.css";

export const metadata: Metadata = {
  title: "Observation health & evidence maturity | GEONEXSER",
  description:
    "A source-backed view of what each GEONEXSER study has observed, processed, published, and independently assessed.",
};

export const dynamic = "force-dynamic";
const MATURITY_MATRIX_LABELS: Record<(typeof MATURITY_STAGES)[number]["id"], string> = {
  catalogue: "Catalogue",
  observations: "Acquired",
  processing: "Processed",
  exploratory: "Exploratory",
  quality_screened: "Quality-screened",
  reference: "Reference",
  validation: "Validated",
  reproducible: "Reproducible",
};


/** Honest checksum wording: a published declaration is not proof that the
    files were re-hashed and matched in this session. */
function integrityLabel(study: StudyHealth): string {
  if (study.integrity === "VERIFIED") return "Published and verified";
  if (study.integrity === "PUBLISHED_NOT_VERIFIED") {
    const count = Object.keys(study.digests ?? {}).length;
    return count > 0
      ? `Published (${count} digests declared) — not verified in this session`
      : "Published — not verified in this session";
  }
  return "Not published for this study";
}

function MaturityLadder({ stages }: { stages: StudyHealth["stages"] }) {
  return (
    <ol className="obs-ladder" aria-label="Evidence maturity">
      {MATURITY_STAGES.map((stage) => {
        const reached = stages.includes(stage.id);
        return (
          <li key={stage.id} className={reached ? "is-reached" : "is-missing"} title={stage.meaning}>
            <span aria-hidden="true">{reached ? "●" : "○"}</span>
            <span>{stage.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function MaturityMatrix({ domains }: { domains: { domain: string; label: string; studies: StudyHealth[] }[] }) {
  const studies = domains.flatMap((d) => d.studies);
  const maxObservations = Math.max(1, ...studies.map((s) => s.observationDates.length));
  return (
    <section className="obs-matrix-wrap" aria-label="Evidence maturity matrix">
      <h2>Readiness at a glance</h2>
      <p>
        Each row is one published study; each column is one maturity stage. A filled
        dot means the study reached that stage. No study has reached validation —
        that column is empty for everyone, and that is honest, not a gap in the chart.
      </p>
      <div className="obs-matrix-scroll" role="region" aria-label="Evidence maturity table" tabIndex={0}>
        <table className="obs-matrix">
          <thead>
            <tr>
              <th scope="col">Study</th>
              {MATURITY_STAGES.map((stage) => (
                <th key={stage.id} scope="col" title={stage.meaning} aria-label={stage.label}>
                  {MATURITY_MATRIX_LABELS[stage.id]}
                </th>
              ))}
              <th scope="col">Observations</th>
              <th scope="col">Reached</th>
            </tr>
          </thead>
          <tbody>
            {studies.map((study) => (
              <tr key={study.id}>
                <th scope="row">
                  <Link href={study.href}>{study.name}</Link>
                  <span>{study.productMaturity}</span>
                </th>
                {MATURITY_STAGES.map((stage) => {
                  const reached = study.stages.includes(stage.id);
                  return (
                    <td key={stage.id} className={reached ? "is-reached" : "is-missing"} title={stage.meaning}>
                      <span aria-hidden="true">{reached ? "●" : "○"}</span>
                      <span className="obs-matrix__sr">{reached ? "reached" : "not reached"}</span>
                    </td>
                  );
                })}
                <td className="obs-matrix__count">
                  <span className="obs-matrix__track">
                    <span
                      className="obs-matrix__bar"
                      style={{ width: `${Math.max(6, (study.observationDates.length / maxObservations) * 100)}%` }}
                    />
                  </span>
                  <span>{study.observationDates.length} date{study.observationDates.length === 1 ? "" : "s"}</span>
                </td>
                <td className="obs-matrix__reached">
                  {study.stages.length}/{MATURITY_STAGES.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

async function QualityExplorer() {
  // Figures are derived from the published files on every load (with
  // per-figure provenance), not read from a hardcoded table — so a study
  // version change can never silently serve stale numbers.
  const { studies, missing } = await loadStudyQuality();
  return (
    <section className="obs-quality" aria-label="Evidence quality explorer">
      <h2>How much was actually covered?</h2>
      <p>
        Coverage, screening, and reference agreement for each published study — one
        honest number per fact, with its denominator and its source file. A computed
        zero is shown as a zero with its denominator, never as missing data. A
        missing figure is labelled “not recorded”, never shown as zero.
      </p>
      {missing.length > 0 && (
        <p className="obs-empty">
          Could not read the publication files for: {missing.join(", ")}. Those
          studies are reported as missing, not as zero.
        </p>
      )}
      {studies.map((study) => (
        <article key={study.studyId} className="obs-quality__study">
          <h3>{study.studyName}</h3>
          <ul>
            {study.figures.map((figure) => (
              <li key={figure.label} className="obs-quality__figure">
                <div className="obs-quality__head">
                  <strong>{figure.label}</strong>
                  <span className="obs-quality__status">
                    {figure.status === "recorded" ? "Recorded" : figure.status === "inconclusive" ? "Inconclusive" : "Not recorded"}
                  </span>
                </div>
                <p className="obs-quality__value">{figure.valueText}</p>
                {figure.fraction !== null && (
                  <div className="obs-quality__bar" role="img" aria-label={`${figure.label}: ${figure.valueText}`}>
                    <span style={{ width: qualityBarWidth(figure.fraction) }} />
                  </div>
                )}
                <p className="obs-quality__meaning">{figure.meaning}</p>
                <p className="obs-quality__source">Source: <code>{figure.source}</code></p>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

function StudyCard({ study }: { study: StudyHealth }) {
  return (
    <article className="obs-study">
      <header>
        <h3>
          <Link href={study.href}>{study.name}</Link>
        </h3>
        <p className="obs-state">
          <strong>{study.state.replaceAll("_", " ")}</strong> · {study.evidenceStatus}
        </p>
      </header>
      <dl className="obs-facts">
        <div><dt>Product</dt><dd>{study.product}</dd></div>
        <div><dt>Maturity</dt><dd>{study.productMaturity}</dd></div>
        <div><dt>Observations</dt><dd>{study.observationDates.length ? `${study.observationDates.length} date${study.observationDates.length === 1 ? "" : "s"} (${study.observationDates[0]} → ${study.observationDates[study.observationDates.length - 1]})` : "Dates not recorded in the manifest"}</dd></div>
        <div><dt>Checksums</dt><dd>{integrityLabel(study)}</dd></div>
        {study.runId && <div><dt>Run ID</dt><dd><code>{study.runId}</code></dd></div>}
        {study.publishedAt && <div><dt>Published</dt><dd>{study.publishedAt.slice(0, 10)}</dd></div>}
      </dl>
      <MaturityLadder stages={study.stages} />
      <p className="obs-note"><strong>Validation:</strong> {study.validationNote}</p>
      <p className="obs-note"><strong>Next step:</strong> {study.nextStep}</p>
      <p className="obs-capsule">
        <a href={`/api/capsule/${study.id}`} download>Download investigation capsule (JSON)</a>
        {" "}— the portable evidence package for this study: provenance, quality, references, checksums, and limits.
      </p>
    </article>
  );
}

export default async function ObservabilityPage() {
  const health = await buildPlatformHealth();
  const totalStudies = health.domains.reduce((n, d) => n + d.studies.length, 0);
  return (
    <main className="obs-page">
      <header className="obs-hero">
        <p className="obs-eyebrow">GEONEXSER · PLATFORM HEALTH</p>
        <h1>Observation health</h1>
        <p className="obs-lede">
          What GEONEXSER has actually observed, processed, and published — and what it has not.
          Every entry below is read from the published manifests on this site. A missing study is
          reported as missing, never as zero. Availability and evidence maturity are separate things:
          a dataset can exist without being validated, and a validation can be inconclusive without
          the observations being wrong.
        </p>
        <p className="obs-meta">
          {totalStudies} published studies across {health.domains.length} domains · generated {health.generatedAt.slice(0, 19).replace("T", " ")} UTC
        </p>
      </header>

      {health.missing.length > 0 && (
        <section className="obs-missing" aria-label="Missing manifests">
          <h2>Missing manifests</h2>
          <p>These expected publications could not be read. They are reported as missing, not as empty results.</p>
          <ul>{health.missing.map((m) => <li key={m}><code>{m}</code></li>)}</ul>
        </section>
      )}

      <MaturityMatrix domains={health.domains} />

      <QualityExplorer />

      {health.domains.map((domain) => (
        <section key={domain.domain} className="obs-domain" aria-label={`${domain.label} observation health`}>
          <h2>{domain.label}</h2>
          {domain.studies.length === 0 ? (
            <p className="obs-empty">No published studies for this domain. This is not evidence of zero change — it means nothing has been processed and published yet.</p>
          ) : (
            <div className="obs-studies">{domain.studies.map((s) => <StudyCard key={s.id} study={s} />)}</div>
          )}
        </section>
      ))}

      <section className="obs-states" aria-label="What each state means">
        <h2>What each state means</h2>
        <p>These are different conditions. GEONEXSER never equates them.</p>
        <dl>
          {OBSERVATION_STATES.map((s) => (
            <div key={s.id}><dt>{s.label}</dt><dd>{s.meaning}</dd></div>
          ))}
        </dl>
      </section>

      <section className="obs-services" aria-label="Live service availability">
        <h2>Live services</h2>
        <p>
          This page does not check live services — it reports what is published. NASA CMR, NASA GIBS,
          and map tiles are checked live inside the explorers that use them
          (<Link href="/wetland/global">wetland worldwide</Link>,{" "}
          <Link href="/forest/global">forest worldwide</Link>,{" "}
          <Link href="/volcano/global">volcano worldwide</Link>). When a service is unreachable there,
          the explorer says so instead of showing stale data as current.
        </p>
      </section>

      <section className="obs-services" aria-label="Evidence lineage">
        <h2>Trace the evidence</h2>
        <p>
          The <Link href="/lineage">Evidence Lineage Explorer</Link> turns each
          study above into a traceable graph: pick a measurement and follow it
          backward through the method, the quality screen, the real
          acquisitions, the independent reference, and the run that published
          it. Every node opens the evidence it claims.
        </p>
      </section>
    </main>
  );
}

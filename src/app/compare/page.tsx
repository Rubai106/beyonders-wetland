import type { Metadata } from "next";
import Link from "next/link";
import { buildPlatformHealth, type StudyHealth } from "@/lib/observation-health";
import { loadTemporalStudies } from "@/lib/temporal-studio-server";
import { peakEntry, type TemporalStudy } from "@/lib/temporal-studio";
import "./compare.css";

export const metadata: Metadata = {
  title: "Compare studies · GeoNexSAR",
  description:
    "Two published studies, side by side — evidence tables first, imagery second. Every value comes from the published files.",
};

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

interface Row {
  label: string;
  a: string;
  b: string;
}

function rowsFor(a: TemporalStudy, aHealth: StudyHealth | undefined, b: TemporalStudy, bHealth: StudyHealth | undefined): Row[] {
  const peakA = peakEntry(a.entries);
  const peakB = peakEntry(b.entries);
  const span = (s: TemporalStudy) =>
    s.entries.length > 1
      ? `${s.entries.length} dates, ${fmtDate(s.entries[0].date)} – ${fmtDate(s.entries[s.entries.length - 1].date)}`
      : s.entries.length === 1
        ? `1 date, ${fmtDate(s.entries[0].date)}`
        : "No published dates";
  return [
    { label: "Domain", a: a.domain, b: b.domain },
    { label: "Product", a: aHealth?.product ?? "Not published", b: bHealth?.product ?? "Not published" },
    { label: "Product maturity", a: aHealth?.productMaturity ?? "Not published", b: bHealth?.productMaturity ?? "Not published" },
    { label: "Observation dates", a: span(a), b: span(b) },
    {
      label: "Headline metric",
      a: peakA ? `${peakA.metricLabel} on ${fmtDate(peakA.date)}` : "Not published",
      b: peakB ? `${peakB.metricLabel} on ${fmtDate(peakB.date)}` : "Not published",
    },
    { label: "What the metric is", a: a.metricName, b: b.metricName },
    { label: "Screening rule", a: a.screeningRule, b: b.screeningRule },
    { label: "Reference outcome", a: a.referenceNote, b: b.referenceNote },
    {
      label: "Validation state",
      a: aHealth ? `${aHealth.state} — ${aHealth.validationNote}` : "Not published",
      b: bHealth ? `${bHealth.state} — ${bHealth.validationNote}` : "Not published",
    },
    {
      label: "Maturity stages reached",
      a: aHealth?.stages.join(" → ") ?? "Not published",
      b: bHealth?.stages.join(" → ") ?? "Not published",
    },
    { label: "Run", a: aHealth?.runId ?? "Not published", b: bHealth?.runId ?? "Not published" },
    {
      label: "Checksums published",
      a: aHealth ? (aHealth.checksumsPresent ? "Yes" : "No") : "Not published",
      b: bHealth ? (bHealth.checksumsPresent ? "Yes" : "No") : "Not published",
    },
    { label: "Still missing", a: aHealth?.nextStep ?? "Not published", b: bHealth?.nextStep ?? "Not published" },
  ];
}

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const params = await searchParams;
  const { studies, missing } = await loadTemporalStudies();
  const health = await buildPlatformHealth();
  const healthById = new Map(health.domains.flatMap((d) => d.studies).map((s) => [s.id, s]));
  if (studies.length < 2) {
    return (
      <main className="compare-page">
        <p role="status">At least two published studies are needed to compare.</p>
      </main>
    );
  }
  const pick = (id: string | undefined, fallback: string) =>
    studies.find((s) => s.id === id) ?? studies.find((s) => s.id === fallback) ?? studies[0];
  const a = pick(params.a, "tanguar-haor");
  const b = pick(params.b, "hakaluki-haor");
  const rows = rowsFor(a, healthById.get(a.id), b, healthById.get(b.id));
  const differing = rows.filter((r) => r.a !== r.b).map((r) => r.label);
  const imagesFor = (s: TemporalStudy) =>
    s.entries.filter((e) => e.image).map((e) => ({ date: e.date, image: e.image as string, label: e.metricLabel }));

  return (
    <main className="compare-page">
      <header className="compare-head">
        <p className="compare-eyebrow">Compare studies · evidence first</p>
        <h1>Two studies, same evidence table.</h1>
        <p>
          The table comes first and the pictures come second — that is the point. Two studies can
          look similar on a map and differ completely in what their evidence actually supports.
          Every value below is read from the published files.
        </p>
        {missing.length > 0 && (
          <p className="compare-missing" role="status">
            Not loaded from disk: {missing.join(", ")}. They are reported as missing, not as zero.
          </p>
        )}
      </header>

      <form className="compare-picker" method="get" action="/compare">
        <label>
          Study A
          <select name="a" defaultValue={a.id}>
            {studies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.domain})
              </option>
            ))}
          </select>
        </label>
        <label>
          Study B
          <select name="b" defaultValue={b.id}>
            {studies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.domain})
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Compare</button>
      </form>

      {differing.length > 0 && (
        <p className="compare-diff" role="status">
          Where they differ: {differing.join(" · ")}.
        </p>
      )}

      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col">Evidence</th>
              <th scope="col">
                <Link href={a.href}>{a.name}</Link>
              </th>
              <th scope="col">
                <Link href={b.href}>{b.name}</Link>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={r.a !== r.b ? "is-different" : ""}>
                <th scope="row">{r.label}</th>
                <td>{r.a}</td>
                <td>{r.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="compare-images" aria-label="Published imagery">
        <h2>Imagery, second</h2>
        <p>
          The published images for each study, for the dates that have them. A study with no image
          here has no published image for its dates — not a missing picture.
        </p>
        <div className="compare-images__grid">
          {([a, b] as const).map((s) => {
            const images = imagesFor(s);
            return (
              <div key={s.id} className="compare-images__col">
                <h3>{s.name}</h3>
                {images.length === 0 ? (
                  <p className="compare-note">No published image for this study&apos;s dates.</p>
                ) : (
                  images.map((img) => (
                    <figure key={img.date}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.image} alt={`Published image for ${s.name} on ${fmtDate(img.date)}`} loading="lazy" />
                      <figcaption>
                        {fmtDate(img.date)} · {img.label}
                      </figcaption>
                    </figure>
                  ))
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

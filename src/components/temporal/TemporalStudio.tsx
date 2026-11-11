"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  formatMetric,
  peakEntry,
  timelinePositions,
  type TemporalEntry,
  type TemporalStudy,
} from "@/lib/temporal-studio";

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function fmtShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function peakIndex(entries: readonly TemporalEntry[]): number {
  const peak = peakEntry(entries);
  if (!peak) return 0;
  const i = entries.indexOf(peak);
  return i >= 0 ? i : 0;
}

function temporalUnit(study: TemporalStudy): { singular: string; plural: string } {
  // Volcano entries represent independently processed before/after pairs,
  // not unique acquisition dates. Keep the displayed denominator explicit.
  return study.domain === "volcano"
    ? { singular: "comparison interval", plural: "comparison intervals" }
    : { singular: "observation date", plural: "observation dates" };
}

/** SVG area chart of the metric over its published dates or intervals. */
function MetricChart({ entries, selected, unitLabel }: { entries: readonly TemporalEntry[]; selected: number; unitLabel: string }) {
  const W = 720;
  const H = 220;
  const PAD_X = 44;
  const PAD_TOP = 16;
  const BASE_Y = 188;
  const values = entries.map((e) => e.metricValue);
  const max = Math.max(0, ...values.filter((v): v is number => v !== null));
  // A recorded zero is a value, not missing data: it plots on the baseline.
  // Only a missing metric (null) leaves a gap. An all-zero series uses a
  // unit scale so the baseline dots still render instead of vanishing.
  const scaleMax = max > 0 ? max : 1;
  const hasRecordedValue = values.some((v) => v !== null);
  const positions = timelinePositions(entries);
  const point = (i: number): { x: number; y: number } | null => {
    const v = values[i];
    if (v === null) return null;
    return { x: PAD_X + positions[i] * (W - PAD_X - 16), y: BASE_Y - (v / scaleMax) * (BASE_Y - PAD_TOP - 24) };
  };
  // Consecutive non-null runs, so the line breaks honestly at missing dates.
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  entries.forEach((_, i) => {
    const p = point(i);
    if (p) run.push(p);
    else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length > 0) runs.push(run);
  const areaPath = runs
    .map((r) => {
      if (r.length < 2) return "";
      const line = r.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      return `${line} L${r[r.length - 1].x.toFixed(1)},${BASE_Y} L${r[0].x.toFixed(1)},${BASE_Y} Z`;
    })
    .join(" ");
  const linePath = runs
    .map((r) => r.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "))
    .join(" ");
  const selectedPoint = point(selected);
  const first = entries[0];
  const last = entries[entries.length - 1];
  return (
    <svg
      className="temporal-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Metric over time for ${entries.length} ${unitLabel}, peaking at ${peakEntry(entries)?.metricLabel ?? "no published value"}`}
    >
      <line x1={PAD_X} y1={BASE_Y} x2={W - 16} y2={BASE_Y} className="temporal-chart__axis" />
      <text x={8} y={BASE_Y + 4} className="temporal-chart__tick">0</text>
      <text x={8} y={PAD_TOP + 20} className="temporal-chart__tick">{max > 0 ? formatMetric(max, "") : hasRecordedValue ? "0" : "—"}</text>
      <path d={areaPath} className="temporal-chart__area" />
      <path d={linePath} className="temporal-chart__line" fill="none" />
      {entries.map((e, i) => {
        const p = point(i);
        if (!p) return null;
        return <circle key={e.date} cx={p.x} cy={p.y} r={i === selected ? 6 : 3.5} className={i === selected ? "temporal-chart__dot is-selected" : "temporal-chart__dot"} />;
      })}
      {selectedPoint && <circle cx={selectedPoint.x} cy={selectedPoint.y} r={10} className="temporal-chart__halo" />}
      {first && <text x={PAD_X} y={H - 6} className="temporal-chart__date">{fmtShort(first.date)}</text>}
      {last && <text x={W - 16} y={H - 6} textAnchor="end" className="temporal-chart__date">{fmtShort(last.date)}</text>}
    </svg>
  );
}

export default function TemporalStudio({ studies }: { studies: TemporalStudy[] }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get("study");
  const [studyId, setStudyId] = useState(() =>
    studies.some((s) => s.id === requested) ? (requested as string) : studies[0]?.id ?? "",
  );
  const study = studies.find((s) => s.id === studyId) ?? studies[0];
  const [index, setIndex] = useState(() => (study ? peakIndex(study.entries) : 0));
  const [series, setSeries] = useState<"per-date" | "matched">("per-date");
  // Naogaon has two honest views of the same dates: per-date valid pixels
  // (coverage changes) and the fixed same-pixel cohort (comparable change).
  // Memoised on its own so the positions memo below has a stable input.
  const activeEntries = useMemo(
    () => (series === "matched" && study?.matchedEntries?.length ? study.matchedEntries : study?.entries ?? []),
    [series, study],
  );
  const safeIndex = Math.min(index, Math.max(0, activeEntries.length - 1));

  const positions = useMemo(() => timelinePositions(activeEntries), [activeEntries]);
  const entry = activeEntries[safeIndex];
  const peak = peakEntry(activeEntries);

  const pickStudy = (id: string) => {
    const next = studies.find((s) => s.id === id);
    setStudyId(id);
    setSeries("per-date");
    // Reset the scrubber to the new study's peak in the same event —
    // no effect sync needed.
    if (next) setIndex(peakIndex(next.entries));
    const params = new URLSearchParams(searchParams.toString());
    params.set("study", id);
    window.history.pushState(null, "", `?${params.toString()}`);
  };

  if (!study || !entry) {
    return <p className="temporal-empty" role="status">No published study timeline is available.</p>;
  }

  const unit = temporalUnit(study);
  const activeUnitLabel = activeEntries.length === 1 ? unit.singular : unit.plural;
  const spanStart = activeEntries[0]?.date;
  const spanEnd = activeEntries[activeEntries.length - 1]?.date;
  const spanMs =
    spanStart && spanEnd
      ? new Date(`${spanEnd}T00:00:00Z`).getTime() - new Date(`${spanStart}T00:00:00Z`).getTime()
      : 0;

  return (
    <div className="temporal-studio">
      <div className="temporal-picker" role="group" aria-label="Choose a study">
        {studies.map((s) => {
          const sPeak = peakEntry(s.entries);
          return (
            <button
              key={s.id}
              type="button"
              className={s.id === study.id ? "temporal-picker__card is-active" : "temporal-picker__card"}
              aria-pressed={s.id === study.id}
              onClick={() => pickStudy(s.id)}
            >
              <span className="temporal-picker__domain">{s.domain}</span>
              <strong>{s.name}</strong>
              <span>
                {s.entries.length} {temporalUnit(s).singular === "comparison interval"
  ? (s.entries.length === 1 ? "comparison interval" : "comparison intervals")
  : (s.entries.length === 1 ? "observation date" : "observation dates")}
                {sPeak ? ` · peak ${sPeak.metricLabel}` : ""}
              </span>
            </button>
          );
        })}
      </div>

      <section className="temporal-panel" aria-label={`${study.name} timeline`}>
        <div className="temporal-panel__head">
          <div>
            <p className="temporal-micro">
              {study.domain} · {activeEntries.length} {activeUnitLabel}
              {spanStart && spanEnd ? ` · ${fmtShort(spanStart)} – ${fmtShort(spanEnd)}` : ""}
            </p>
            <h2>{study.name}</h2>
            <p className="temporal-rule">
              <strong>Screening rule:</strong> {study.screeningRule}
            </p>
          </div>
          <Link className="temporal-case-link" href={study.href}>
            Open the {study.name} case →
          </Link>
        </div>

        {study.matchedEntries?.length ? (
          <div className="temporal-series" role="group" aria-label="Soil-moisture series">
            <button type="button" aria-pressed={series === "per-date"} onClick={() => setSeries("per-date")}>
              Per-date valid pixels
            </button>
            <button type="button" aria-pressed={series === "matched"} onClick={() => setSeries("matched")}>
              Same-pixel cohort (1,336 pixels)
            </button>
            <p className="temporal-note">
              {series === "matched"
                ? study.matchedNote
                : "Per-date medians use every valid pixel on that date — coverage changes between dates, so the medians are not strictly comparable."}
            </p>
          </div>
        ) : null}

        <MetricChart entries={activeEntries} selected={safeIndex} unitLabel={unit.plural} />

        <div className="temporal-track" role="group" aria-label={unit.plural}>
          {activeEntries.map((e, i) => (
            <button
              key={e.date}
              type="button"
              className={i === safeIndex ? "temporal-track__node is-selected" : "temporal-track__node"}
              style={{ left: `${(positions[i] ?? 0) * 100}%` }}
              aria-label={`${fmtDate(e.date)}: ${e.metricLabel}${i === safeIndex ? " (selected)" : ""}`}
              aria-pressed={i === safeIndex}
              onClick={() => setIndex(i)}
            >
              <span className="temporal-track__dot" />
              <span className="temporal-track__label">{fmtShort(e.date)}</span>
            </button>
          ))}
          <span className="temporal-track__line" aria-hidden="true" />
        </div>

        <div className="temporal-scrub">
          <button type="button" onClick={() => setIndex((v) => Math.max(0, v - 1))} disabled={safeIndex === 0} aria-label={`Previous ${unit.singular}`}>
            ← Earlier
          </button>
          <input
            type="range"
            min={0}
            max={activeEntries.length - 1}
            step={1}
            value={safeIndex}
            onChange={(e) => setIndex(Number(e.target.value))}
            aria-label={`${unit.singular[0].toUpperCase() + unit.singular.slice(1)} ${safeIndex + 1} of ${activeEntries.length}: ${fmtDate(entry.date)}`}
          />
          <button
            type="button"
            onClick={() => setIndex((v) => Math.min(activeEntries.length - 1, v + 1))}
            disabled={safeIndex === activeEntries.length - 1}
            aria-label={`Next ${unit.singular}`}
          >
            Later →
          </button>
        </div>

        <div className="temporal-detail">
          <div className="temporal-detail__metric">
            <p className="temporal-micro">{entry.intervalLabel ?? fmtDate(entry.date)}</p>
            <p className="temporal-big">
              <strong>{entry.metricLabel}</strong>
            </p>
            <p className="temporal-metric-name">{study.metricName}</p>
            {entry.secondary && <p className="temporal-secondary">{entry.secondary}</p>}
            {entry.patches !== undefined && <p className="temporal-secondary">{entry.patches} patches</p>}
            {peak && entry.date === peak.date && <p className="temporal-peak">Peak of this study</p>}
          </div>
          <div className="temporal-detail__evidence">
            <p>
              <strong>Reference:</strong> {entry.reference ?? study.referenceNote}
            </p>
            {study.excludedNote && <p className="temporal-note">{study.excludedNote}</p>}
            {entry.image && (
              <figure className="temporal-figure">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={entry.image} alt={`Published image for ${study.name} on ${fmtDate(entry.date)}`} loading="lazy" />
                <figcaption>Published image for this date — not a simulation.</figcaption>
              </figure>
            )}
          </div>
        </div>

        <div className="temporal-optical">
          <p className="temporal-micro">Independent optical track · same calendar</p>
          {study.opticalDates.length > 0 ? (
            <div className="temporal-optical__track" aria-label="Optical reference dates">
              {study.opticalDates.map((o) => {
                const t = new Date(`${o.date}T00:00:00Z`).getTime();
                const start = spanStart ? new Date(`${spanStart}T00:00:00Z`).getTime() : t;
                const pos = spanMs > 0 ? Math.min(1, Math.max(0, (t - start) / spanMs)) : 0.5;
                return (
                  <span key={`${o.date}-${o.label}`} className="temporal-optical__dot" style={{ left: `${pos * 100}%` }} title={`${fmtDate(o.date)} — ${o.label}`}>
                    <span className="temporal-optical__label">{fmtShort(o.date)}</span>
                  </span>
                );
              })}
              <span className="temporal-track__line" aria-hidden="true" />
            </div>
          ) : (
            <p className="temporal-note">No independent optical dates are published for this study — the radar track stands on its own, and the reference state above says so.</p>
          )}
        </div>
      </section>
    </div>
  );
}

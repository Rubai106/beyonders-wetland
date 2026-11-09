"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWetlandStore } from "@/lib/store";
import { datesWithPatches, showcaseUrl, type ShowcaseReference } from "@/lib/showcase";
import { downloadFile, patchesCSV } from "@/lib/real-export";
import { challenge, changeStory, daysBetween, evidenceStack, fmtDate, fmtDateLong, interpret, interpretationOfClass, opticalLabel, opticalState, regionLabel, summarizeEvidence, temporalOverlapContext, regionNavigationContext, regionDistributionContext, buildRegionEvidenceBrief, type StackStatus } from "@/lib/story";
import { KindTag, Section, TierBadge, ToolFrame, type Kind } from "./ui";
import FieldVolumeDisclosure from "@/components/shared/FieldVolumeDisclosure";
import ScatteringHypothesisPanel from "@/components/shared/ScatteringHypothesisPanel";

const STATUS_WORD: Record<StackStatus, string> = { PASS: "Passed", PARTIAL: "Partial", FAIL: "Not shown", UNAVAILABLE: "Unavailable" };
const pct1 = (v: number | null | undefined) => (v == null ? "n/a" : v > 0 && v * 100 < 0.1 ? "<0.1%" : `${(v * 100).toFixed(1)}%`);

/* ── Evidence stack: which evidence exists. A test outcome, never a confidence score. ── */
export function EvidenceStack() {
  const { selectedPatch: p, dataTier, pulseData } = useWetlandStore();
  if (!p) return null;
  const rows = evidenceStack(p, opticalState(dataTier, pulseData));
  return (
    <ul className="wx-stack" aria-label="Evidence for this region">
      {rows.map((r) => (
        <li key={r.key} data-status={r.status}>
          <div className="wx-stack__head"><span>{r.label}</span><span className="wx-stack__state"><KindTag kind={r.kind as Kind} />{STATUS_WORD[r.status]}</span></div>
          <div className="wx-stack__bar" aria-hidden="true"><i style={{ width: r.status === "UNAVAILABLE" ? "0%" : r.magnitude != null ? `${Math.max(6, r.magnitude * 100)}%` : r.status === "PASS" ? "100%" : r.status === "PARTIAL" ? "50%" : "8%" }} /></div>
          <small>{r.detail}</small>
        </li>
      ))}
      <li className="wx-stack__note">Radar bars show the size of the measured change on a ±10 dB scale. The other bars show whether a test passed. None of them is a probability.</li>
    </ul>
  );
}

/* ── Evidence overview: counts and groups, never a combined score. ── */
function EvidenceOverview() {
  const { selectedPatch: patch, dataTier, pulseData } = useWetlandStore();
  if (!patch) return null;
  const summary = summarizeEvidence(evidenceStack(patch, opticalState(dataTier, pulseData)));
  const groups = [
    { key: "PASS", label: "Passed checks", rows: summary.passed },
    { key: "PARTIAL", label: "Partial checks", rows: summary.partial },
    { key: "FAIL", label: "Failed checks", rows: summary.failed },
    { key: "UNAVAILABLE", label: "Not assessed", rows: summary.unavailable },
  ] as const;
  return (
    <div className="wx-evidence-overview" data-passed={summary.passed.length}
      data-partial={summary.partial.length} data-failed={summary.failed.length}
      data-unavailable={summary.unavailable.length}
      aria-label="Evidence grouped by recorded check status">
      <div className="wx-evidence-overview__counts" aria-label="Evidence check counts">
        {groups.map((group) => (
          <div className="wx-evidence-overview__count" data-status={group.key} key={group.key}>
            <strong>{group.rows.length}</strong><span>{group.label}</span>
          </div>
        ))}
      </div>
      <div className="wx-evidence-overview__groups">
        {groups.filter((group) => group.rows.length > 0).map((group) => (
          <section key={group.key} data-status={group.key}>
            <h4>{group.label}</h4>
            <ul>
              {group.rows.map((row) => <li key={row.key}>
                <strong>{row.label}</strong><small>{row.detail}</small>
              </li>)}
            </ul>
          </section>
        ))}
      </div>
      <p className="wx-evidence-overview__note">These are counts of recorded checks, not a probability, confidence score, or proof of flooding. The unavailable group includes evidence that was not collected, such as field observations.</p>
    </div>
  );
}

/* ── Dated temporal-overlap evidence ── */
function RegionTemporalEvidence({ patch, pulse }: { patch: NonNullable<ReturnType<typeof useWetlandStore.getState>["selectedPatch"]>; pulse: ReturnType<typeof useWetlandStore.getState>["pulseData"] }) {
  const context = temporalOverlapContext(patch, pulse);
  const overlap = context.overlapFraction;
  const statusLabel = context.status === "PASS" ? "Meets 50% criterion"
    : context.status === "PARTIAL" ? "Below 50% criterion"
      : context.status === "FAIL" ? "Temporal check failed" : "Not assessed";
  const classLabel = patch.classification === "OPEN_WATER" ? "open-water" : patch.classification === "VEGETATED_INUNDATION" ? "vegetated-inundation" : "uncertain";
  return (
    <div className="wx-temporal-evidence" data-status={context.status}
      data-current-date={patch.date} data-previous-date={context.previousDate ?? ""}
      data-overlap-fraction={overlap == null ? "" : String(overlap)}
      data-threshold-percent={context.thresholdFraction * 100}>
      {context.previousDate && overlap != null ? <>
        <div className="wx-temporal-evidence__head">
          <div><span className="wx-micro">PRECEDING ACQUISITION</span><strong>{fmtDateLong(context.previousDate)}</strong></div>
          <span className="wx-temporal-evidence__status" data-status={context.status}>{statusLabel}</span>
        </div>
        <div className="wx-temporal-evidence__summary">
          <strong>{pct1(overlap)}</strong>
          <span>same-class pixel overlap</span>
        </div>
        <div className="wx-temporal-evidence__meter" role="meter"
          aria-label="Share of this region also flagged with the same class on the preceding acquisition"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={overlap * 100}
          aria-valuetext={`${pct1(overlap)} same-class pixel overlap`}>
          <span style={{ width: `${overlap * 100}%` }} />
          <i aria-hidden="true" />
        </div>
        <div className="wx-temporal-evidence__scale"><span>0%</span><span>50% pipeline threshold</span><span>100%</span></div>
        <p>{pct1(overlap)} of the pixels inside this {classLabel} candidate on {fmtDateLong(patch.date)} were also assigned the same class on the previous processed acquisition{context.intervalDays != null ? ` (${context.intervalDays} days earlier)` : ""}.</p>
        <p className="wx-temporal-evidence__note">This is directional pixel overlap, not a persistent region match. Candidate IDs include the acquisition date, so regions are regenerated per observation. No values are interpolated between acquisition dates.</p>
      </> : <>
        <span className="wx-micro">{context.dateInSeries ? "FIRST PROCESSED ACQUISITION" : "DATE NOT IN LOADED SERIES"}</span>
        <strong>{context.previousDate ? "Previous-date overlap was not recorded" : "No preceding acquisition to compare"}</strong>
        <p>{context.dateInSeries ? "This is the earliest observation in the loaded series. The detector has no earlier class grid for a same-class overlap check." : "This candidate date is not present in the loaded acquisition timeline, so a previous-date comparison cannot be resolved."}</p>
      </>}
    </div>
  );
}

/* ── Why this region? ── */
export function InvestigationDrawer() {
  const { selectedPatch: p, dataTier, pulseData, challengeOpen, setChallengeOpen, showcase, patches, setSelectedPatch, vegFilter,
    selectedDateIndex, viewMode, mapMode, showcaseId } = useWetlandStore();
  const [shareMessage, setShareMessage] = useState("");
  const [shareFallback, setShareFallback] = useState("");
  const largest = useMemo(() => [...patches].sort((a, b) => b.area_km2 - a.area_km2 || a.id.localeCompare(b.id)).slice(0, 8), [patches]);
  if (!p) return (
    <ToolFrame title="Why this region?" lede="Click a candidate region on the map to see what the radar measured there and which checks it passed."
      limitation="A candidate region is a possible change that needs interpretation. It is not a confirmed flood.">
      <p className="wx-empty">Hover a region to see its name and area. Click it to investigate. Press Esc to return to the overview.</p>
      {largest.length > 0 && <div><p className="wx-micro">Or choose one of the largest regions</p>
        <ul className="wx-regions">{largest.map((r) => <li key={r.id}><button type="button" onClick={() => setSelectedPatch(r)}><span>{regionLabel(r.id)}</span><span className="wx-mono">{r.area_km2.toFixed(3)} km²</span></button></li>)}</ul></div>}
    </ToolFrame>
  );
  // Capture the non-null selection before defining callbacks that use it.
  const selectedRegion = p;
  const regionNav = regionNavigationContext(patches, selectedRegion.id, vegFilter);
  const regionDistribution = regionDistributionContext(patches, p.id, vegFilter);
  const optical = opticalState(dataTier, pulseData);
  const it = interpret(p, optical);
  const ev = showcase?.reference.evidence;
  const ch = challenge(p, optical, { baselineMad: p.baseline_hh_temporal_mad_db, baselineCount: p.baseline_observation_count, referenceLimitations: ev?.limitations,
    opticalReason: showcase?.reference.validation ? String((showcase.reference.validation as { reason?: string }).reason ?? "") || undefined : undefined });
  function exportRegionBrief() {
    const brief = buildRegionEvidenceBrief(selectedRegion, pulseData, dataTier, optical, regionDistribution, vegFilter);
    downloadFile(
      `beyonders-${selectedRegion.date}-${selectedRegion.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-evidence.json`,
      JSON.stringify(brief, null, 2),
      "application/json;charset=utf-8",
    );
  }
  async function copyRegionLink() {
    const params = new URLSearchParams({
      date: String(selectedDateIndex),
      filter: vegFilter,
      mode: viewMode,
      mapMode,
      region: selectedRegion.id,
    });
    if (dataTier === "SHOWCASE") params.set("case", showcaseId);
    if (dataTier === "LOCAL_RUN") params.set("source", "raster");
    const url = `${window.location.origin}/wetland?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareFallback("");
      setShareMessage("Direct link copied. It restores this acquisition and candidate when the same data are available.");
    } catch {
      setShareFallback(url);
      setShareMessage("Clipboard access is unavailable. Copy the link below.");
    }
  }
  return (
    <ToolFrame title="Why this region?" lede={`${regionLabel(p.id)} was flagged on ${fmtDateLong(p.date)}. Here is the evidence behind it, and what it cannot tell us.`}
      limitation="Radar change does not by itself prove flooding. The same signal can come from other changes at the surface."
      action={<button className="wx-btn wx-btn--primary" onClick={() => setChallengeOpen(!challengeOpen)} aria-expanded={challengeOpen}>{challengeOpen ? "Hide the challenge" : "Challenge this detection"}</button>}>
      <nav className="wx-region-nav" aria-label="Candidate region navigation"
        data-region-id={p.id} data-acquisition-date={p.date} data-class-filter={vegFilter}
        data-view-mode={viewMode} data-map-mode={mapMode}
        data-position={regionNav.currentIndex >= 0 ? regionNav.currentIndex + 1 : 0} data-total={regionNav.total}>
        <button type="button" disabled={!regionNav.previous}
          aria-label={regionNav.previous ? `Previous region: ${regionLabel(regionNav.previous.id)}` : "Previous region"}
          onClick={() => { if (regionNav.previous) setSelectedPatch(regionNav.previous); }}>Previous</button>
        <p aria-live="polite"><strong>{regionNav.currentIndex >= 0 ? `${regionNav.currentIndex + 1} of ${regionNav.total}` : "Not in this filter"}</strong><span>Largest area first</span></p>
        <button type="button" disabled={!regionNav.next}
          aria-label={regionNav.next ? `Next region: ${regionLabel(regionNav.next.id)}` : "Next region"}
          onClick={() => { if (regionNav.next) setSelectedPatch(regionNav.next); }}>Next</button>
      </nav>
      <dl className="wx-facts">
        <div><dt>Area</dt><dd>{p.area_km2.toFixed(4)} km²</dd></div>
        <div><dt>Class</dt><dd>{p.interpretation_label ?? interpretationOfClass(p.classification)}</dd></div>
        <div><dt>Centroid</dt><dd className="wx-mono">{p.centroid[0].toFixed(4)}°N {p.centroid[1].toFixed(4)}°E</dd></div>
      </dl>
      <section className="wx-region-context" aria-label="Same-acquisition candidate context"
        data-region-id={p.id} data-total={regionDistribution.total}
        data-area-rank={regionDistribution.areaRank ?? ""}
        data-delta-rank={regionDistribution.deltaHhRank ?? ""}>
        <div className="wx-region-context__head">
          <strong>Compared with this observation</strong>
          <span>{regionDistribution.total} candidates{vegFilter === "ALL" ? "" : " · current class"}</span>
        </div>
        {regionDistribution.areaRank != null && regionDistribution.deltaHhRank != null ? (
          <div className="wx-region-context__grid">
            <div><span>Area position</span><strong>{regionDistribution.areaRank} of {regionDistribution.total}</strong></div>
            <div><span>Median candidate area</span><strong>{regionDistribution.medianAreaKm2?.toFixed(3) ?? "n/a"} km²</strong></div>
            <div><span>|ΔHH| position</span><strong>{regionDistribution.deltaHhRank} of {regionDistribution.total}</strong></div>
            <div><span>Median |ΔHH|</span><strong>{regionDistribution.medianAbsDeltaHhDb?.toFixed(2) ?? "n/a"} dB</strong></div>
          </div>
        ) : <p className="wx-region-context__note">This candidate is outside the active class filter, so no cohort position is shown.</p>}
        <p className="wx-region-context__note">Positions and medians describe only the currently loaded acquisition and class filter. They are descriptive comparisons, not detection confidence, flood severity, or validation.</p>
        <div className="wx-region-context__export">
          <button type="button" className="wx-btn" onClick={exportRegionBrief}>Download this region&apos;s evidence brief</button>
          <button type="button" className="wx-btn" onClick={() => void copyRegionLink()}>Copy direct region link</button>
          <span>JSON export · or share the selected view</span>
        </div>
        {shareMessage && <p className="wx-region-context__share-message" role="status">{shareMessage}</p>}
        {shareFallback && <label className="wx-share-fallback">Direct region link<input readOnly value={shareFallback} onFocus={(event) => event.currentTarget.select()} /></label>}
      </section>
      <div className="wx-interp"><span className="wx-micro">Interpretation</span><strong>{it.headline}</strong><p>{it.note}</p></div>
      <Section eyebrow="Evidence" title="What do we actually know?">
        <EvidenceOverview />
        <details className="wx-raw wx-evidence-details">
          <summary>See individual evidence checks</summary>
          <EvidenceStack />
        </details>
      </Section>
      <Section eyebrow="Across acquisitions" title="Preceding-observation overlap"><RegionTemporalEvidence patch={p} pulse={pulseData} /></Section>
      <Section eyebrow="Provenance" title="How this result was built">
        <ol className="wx-flow">
          <li><KindTag kind="observed" /><span>NISAR L2 GCOV HH and HV power, acquired {p.date}</span><span className="wx-mono">HH {p.hh_before.toFixed(1)} → {p.hh_after.toFixed(1)} dB · HV {p.hv_before.toFixed(1)} → {p.hv_after.toFixed(1)} dB</span></li>
          <li><KindTag kind="derived" /><span>Change after minus before, averaged over {p.pixel_count?.toLocaleString() ?? "the region's"} pixels</span><span className="wx-mono">ΔHH {p.delta_hh.toFixed(1)} dB · ΔHV {p.delta_hv.toFixed(1)} dB</span></li>
          <li><KindTag kind="context" /><span>{opticalLabel(optical, showcase?.reference)}</span><span>Reference study mask. It is not an official wetland boundary.</span></li>
          <li><KindTag kind="candidate" /><span>{interpretationOfClass(p.classification)}</span><span>Other scattering explanations remain possible.</span></li>
        </ol>
      </Section>
      {challengeOpen && (
        <section className="wx-challenge" aria-label="Challenge this detection">
          <p className="wx-micro">What could we be missing?</p><h3>Can we trust this change?</h3>
          <ul className="wx-checks">{ch.items.map((i) => <li key={i.text} data-tone={i.tone}><i className="wx-dot" aria-hidden="true" /><div><strong>{i.text}</strong>{i.detail && <small>{i.detail}</small>}</div></li>)}</ul>
          <p className="wx-micro">Other explanations that remain plausible</p>
          <ul className="wx-plain">{ch.alternatives.map((a) => <li key={a}>{a}</li>)}</ul>
          <ScatteringHypothesisPanel key={p.id} patch={p} />
          <dl className="wx-status">
            <div><dt>Status</dt><dd>{ch.status}</dd></div><div><dt>Interpretation</dt><dd>{ch.interpretation}</dd></div>
            <div><dt>Independent support</dt><dd>{ch.independent}</dd></div><div><dt>Validation</dt><dd>{ch.validation}</dd></div><div><dt>Recommendation</dt><dd>{ch.recommendation}</dd></div>
          </dl>
        </section>
      )}
    </ToolFrame>
  );
}

/* ── SAR Detective ── */
export function DetectiveDrawer() {
  const { probeResult: r, probeActive, dataTier, selectedPatch, setProbeResult } = useWetlandStore();
  const lede = "Click anywhere on the map to read the radar signal at that place.";
  const note = dataTier === "LOCAL_RUN" ? "This tier samples one measured raster cell."
    : "This static showcase ships region-level values only. A sample reports the region average of the candidate under the cursor, not a single pixel.";
  if (!r) return <ToolFrame title="SAR Detective" lede={lede} limitation="Radar change does not by itself prove flooding."><p className="wx-empty">{probeActive ? "Click the map to take a sample." : "Choose SAR Detective, then click the map."}</p><p className="wx-note">{note}</p></ToolFrame>;
  const v = (n: number | null) => (n == null ? "n/a" : n.toFixed(1));
  const dark = (r.delta_hh ?? 0) <= -1; const bright = (r.delta_hh ?? 0) >= 1;
  return (
    <ToolFrame title="SAR Detective" lede={lede}
      limitation={`Radar change does not by itself prove flooding. ${r.resolution === "REGION" ? "These are region averages, not a single pixel." : "This is one raster cell."}`}
      action={<button className="wx-btn" onClick={() => setProbeResult(null)}>Clear sample</button>}>
      <dl className="wx-facts"><div><dt>Location</dt><dd className="wx-mono">{Math.abs(r.lat).toFixed(4)}° {r.lat >= 0 ? "N" : "S"}, {Math.abs(r.lng).toFixed(4)}° {r.lng >= 0 ? "E" : "W"}</dd></div>
        <div><dt>Date</dt><dd className="wx-mono">{r.acquisition_date}</dd></div><div><dt>Resolution</dt><dd>{r.resolution === "REGION" ? `Region average${r.region_id ? ` · ${regionLabel(r.region_id)}` : ""}` : "Single raster cell"}</dd></div></dl>
      {r.valid ? <>
        {(["HH", "HV"] as const).map((c) => { const b = c === "HH" ? r.hh_before : r.hv_before; const a = c === "HH" ? r.hh_after : r.hv_after; const d = c === "HH" ? r.delta_hh : r.delta_hv;
          return <table key={c} className="wx-sig"><caption>NISAR {c}</caption><tbody>
            <tr><th scope="row">Before <KindTag kind="observed" /></th><td className="wx-mono">{v(b)} dB</td></tr>
            <tr><th scope="row">After <KindTag kind="observed" /></th><td className="wx-mono">{v(a)} dB</td></tr>
            <tr className="is-delta"><th scope="row">Change <KindTag kind="derived" /></th><td className="wx-mono">{d != null && d > 0 ? "+" : ""}{v(d)} dB</td></tr></tbody></table>; })}
        <dl className="wx-facts">
          <div><dt>Previous-date overlap</dt><dd>{selectedPatch?.id === r.region_id && selectedPatch?.temporal_overlap_fraction != null ? `${Math.round(selectedPatch.temporal_overlap_fraction * 100)}% of this region was flagged before` : "Select the region to see its tests"}</dd></div>
          <div><dt>Reading</dt><dd>{dark ? "HH-darkening candidate" : bright ? "HH-increase candidate" : "No clear HH change here"}</dd></div></dl>
      </> : <p className="wx-note">No detector result at this location. That means no candidate here. It does not mean the surface is unchanged.</p>}
    </ToolFrame>
  );
}

/* ── Wetland pulse: restore the area-over-time view in the current drawer UI. ── */
function WetlandPulseChart() {
  const { pulseData, selectedDateIndex, setSelectedDateIndex, setIsPlaying, dataTier, showcase } = useWetlandStore();
  const available = useMemo(() => dataTier === "SHOWCASE" && showcase ? datesWithPatches(showcase) : null, [dataTier, showcase]);
  const points = useMemo(() => {
    const dates = pulseData?.dates ?? [];
    if (!dates.length) return [];
    const first = Date.parse(`${dates[0].date}T00:00:00Z`);
    const last = Date.parse(`${dates[dates.length - 1].date}T00:00:00Z`);
    const maxArea = Math.max(0.01, ...dates.filter((item) => !available || available.has(item.date)).map((item) => item.area_km2));
    // A compact viewBox keeps all seven dates legible inside the narrow desktop drawer.
    const left = 48; const right = 364; const top = 38; const bottom = 168;
    const span = Math.max(last - first, 1);
    return dates.map((item, index) => {
      const time = Date.parse(`${item.date}T00:00:00Z`);
      const hasResult = !available || available.has(item.date);
      return {
        ...item,
        index,
        hasResult,
        x: dates.length === 1 ? (left + right) / 2 : left + ((time - first) / span) * (right - left),
        y: hasResult ? bottom - (Math.max(0, item.area_km2) / maxArea) * (bottom - top) : bottom,
      };
    });
  }, [pulseData, available]);

  const fmtArea = (value: number) => `${value.toFixed(value >= 10 ? 0 : 1)} km²`;
  const fieldVolumeData = useMemo(() => points.map((point) => ({
    id: point.date,
    label: fmtDate(point.date, { month: "short", day: "numeric" }),
    value: point.area_km2,
    valueLabel: fmtArea(point.area_km2),
    context: point.fraction,
    available: point.hasResult,
  })), [points]);

  if (!pulseData || !points.length) return null;

  const top = 38; const bottom = 168;
  const maxArea = Math.max(0.01, ...points.filter((point) => point.hasResult).map((point) => point.area_km2));
  const markers = [
    { date: pulseData.onset, label: "Onset", className: "is-onset" },
    { date: pulseData.peak.date, label: "Peak", className: "is-peak" },
    { date: pulseData.recession_start, label: "Recession", className: "is-recession" },
  ].flatMap((marker) => {
    if (!marker.date) return [];
    const point = points.find((item) => item.date === marker.date);
    return point ? [{ ...marker, x: point.x }] : [];
  });
  const active = points[Math.min(Math.max(selectedDateIndex, 0), points.length - 1)];

  function selectPoint(index: number, hasResult: boolean) {
    if (!hasResult) return;
    setIsPlaying(false);
    setSelectedDateIndex(index);
  }

  return (
    <ToolFrame title="Wetland pulse" lede="Candidate area across the case’s actual NISAR acquisition dates. Select a bar to synchronize the map and timeline."
      limitation="Bars show recorded candidate area only on acquired dates. No values are interpolated between observations, and candidate area is not confirmed flood extent.">
      <div className="wx-pulse-chart">
        <div className="wx-pulse-chart__summary" aria-live="polite">
          <span className="wx-micro">Selected observation</span>
          <strong>{fmtDate(active.date, { month: "short", day: "numeric", year: "numeric" })}</strong>
          <span className="wx-mono">{active.hasResult ? `${fmtArea(active.area_km2)} · ${active.patches} regions` : "Acquired · result not exported"}</span>
        </div>
        <div className="wx-pulse-chart__scroll">
          <svg className="wx-pulse-chart__svg" viewBox="0 0 390 218" role="group" aria-label={`Discrete wetland candidate-area chart for ${points.length} NISAR acquisition dates`}>
            <text className="wx-pulse-chart__axis-label" x="8" y="16">km²</text>
            {[0, 0.5, 1].map((fraction) => {
              const y = bottom - fraction * (bottom - top);
              return <g key={fraction}>
                <line className="wx-pulse-chart__grid" x1="48" x2="364" y1={y} y2={y} />
                <text className="wx-pulse-chart__tick" x="42" y={y + 4} textAnchor="end">{(maxArea * fraction).toFixed(maxArea >= 10 ? 0 : 1)}</text>
              </g>;
            })}
            {markers.map((marker, markerIndex) => <g key={marker.label} className={`wx-pulse-chart__marker ${marker.className}`}>
              <line x1={marker.x} x2={marker.x} y1={top} y2={bottom} />
              <text x={marker.x} y={markerIndex % 2 === 0 ? 16 : 28} textAnchor="middle">{marker.label}</text>
            </g>)}
            <line className="wx-pulse-chart__baseline" x1="48" x2="364" y1={bottom} y2={bottom} />
            {points.map((point) => {
              const selected = point.index === selectedDateIndex;
              const barTop = point.hasResult ? point.y : bottom - 5;
              const barHeight = point.hasResult ? Math.max(2, bottom - point.y) : 5;
              const label = point.hasResult
                ? `${fmtDate(point.date, { month: "long", day: "numeric", year: "numeric" })}: ${point.area_km2.toFixed(2)} square kilometres in ${point.patches} candidate regions`
                : `${fmtDate(point.date, { month: "long", day: "numeric", year: "numeric" })}: acquired, but no candidate-region result was exported`;
              return <g key={point.date} className={`wx-pulse-chart__bar${selected ? " is-selected" : ""}${point.hasResult ? "" : " is-unassessed"}`}>
                <rect className="wx-pulse-chart__hit" x={point.x - 12} y={top} width="24" height={bottom - top} role="button"
                  tabIndex={point.hasResult ? 0 : -1} aria-disabled={!point.hasResult} aria-pressed={selected && point.hasResult}
                  aria-label={label} onClick={() => selectPoint(point.index, point.hasResult)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectPoint(point.index, point.hasResult); } }}>
                  <title>{label}</title>
                </rect>
                <rect className="wx-pulse-chart__column" x={point.x - 7} y={barTop} width="14" height={barHeight} rx="2" aria-hidden="true" />
                {selected && point.hasResult && <circle className="wx-pulse-chart__selection" cx={point.x} cy={point.y} r="7" aria-hidden="true" />}
                <text className={`wx-pulse-chart__date${selected ? " is-selected" : ""}`} x={point.x} y="190" textAnchor="middle">{fmtDate(point.date, { month: "short", day: "numeric" })}</text>
              </g>;
            })}
          </svg>
        </div>
        <div className="wx-pulse-chart__legend" aria-label="Chart legend">
          <span><i className="is-area" />Candidate area</span>
          <span><i className="is-onset" />Onset</span>
          <span><i className="is-peak" />Peak</span>
          <span><i className="is-recession" />Recession</span>
        </div>
        <p className="wx-caption">{pulseData.product ?? "NISAR L2 GCOV"} · provisional · {points.length} acquisitions. Click a bar or focus it and press Enter to inspect its date on the map.</p>
      </div>
      <FieldVolumeDisclosure
        kind="wetland"
        title="Wetland pulse in three dimensions"
        metricLabel="Recorded candidate area"
        contextLabel="Study-area share"
        observations={fieldVolumeData}
        selectedId={active.date}
        onSelectId={(id) => {
          const point = points.find((item) => item.date === id);
          if (point) selectPoint(point.index, point.hasResult);
        }}
        note="Columns use actual exported NISAR candidate area by acquisition date. The water surface is conceptual, not a measured elevation model or a confirmed flood extent."
      />
    </ToolFrame>
  );
}

/* ── Does it survive? Stored sensitivity sweep ── */
export function SensitivityDrawer() {
  const { sensitivityData: s, dataTier, threshold } = useWetlandStore();
  const [picked, setPicked] = useState<number | null>(null);
  if (!s) return <ToolFrame title="Does it survive?" lede="Would the flagged area change if the detection cutoff were stricter or looser?" limitation="No sensitivity sweep is stored for this case."><p className="wx-empty">Not available.</p></ToolFrame>;
  const base = (s as unknown as { base_threshold_db?: number }).base_threshold_db ?? threshold;
  const rows = s.thresholds; const max = Math.max(...rows.map((t) => t.area_km2), 0.0001);
  const baseRow = rows.find((t) => Math.abs(t.delta_db - base) < 0.01);
  const lo = rows.reduce((a, b) => (b.area_km2 < a.area_km2 ? b : a)); const hi = rows.reduce((a, b) => (b.area_km2 > a.area_km2 ? b : a));
  const cur = picked ?? base; const curRow = rows.find((t) => Math.abs(t.delta_db - cur) < 0.01);
  const stable = s.stability_verdict === "STABLE";
  const source = `Stored sensitivity sweep from ${dataTier === "SHOWCASE" ? "the packaged real case" : "the saved local NISAR run"}. Selecting a row only highlights the recorded comparison; it does not rerun the detector or change the mapped candidates at ${base.toFixed(1)} dB.`;
  return (
    <ToolFrame title="Does it survive?" lede="Would the flagged area change if the detection cutoff were stricter or looser? These are the cutoffs that were actually tested."
      limitation="A rule that is stable across cutoffs is not necessarily accurate. Stability says nothing about whether the flagged area is water."
      >
      <p className="wx-note">{source}</p>
      <div className={`wx-verdict wx-verdict--${stable ? "stable" : "sensitive"}`}>
        <span className="wx-micro">Stored verdict</span><strong>{stable ? "Stable" : "Sensitive to the cutoff"}</strong>
        <p>Flagged area ranges from <b>{lo.area_km2.toFixed(1)} km²</b> at {lo.delta_db.toFixed(1)} dB to <b>{hi.area_km2.toFixed(1)} km²</b> at {hi.delta_db.toFixed(1)} dB{s.stable_range?.length ? `. It stays within the pipeline stable band only between ${s.stable_range[0].toFixed(1)} and ${s.stable_range[s.stable_range.length - 1].toFixed(1)} dB` : ""}.</p>
      </div>
      <ul className="wx-bars" aria-label="Flagged area at each tested cutoff">
        {rows.map((t) => { const isBase = Math.abs(t.delta_db - base) < 0.01; const sel = Math.abs(t.delta_db - cur) < 0.01;
          return <li key={t.delta_db} className={`${sel ? "is-current" : ""}${isBase ? " is-base" : ""}`}>
            <button type="button" onClick={() => setPicked(t.delta_db)} aria-pressed={sel} aria-label={`${t.delta_db.toFixed(1)} dB: ${t.area_km2.toFixed(1)} square kilometres in ${t.patches} regions${isBase ? ", the cutoff used for the map" : ""}`}>
              <span className="wx-mono">{t.delta_db.toFixed(1)} dB{isBase ? " ●" : ""}</span><div><i style={{ width: `${(t.area_km2 / max) * 100}%` }} /></div><em className="wx-mono">{t.area_km2.toFixed(1)} km² · {t.patches}</em></button></li>; })}
      </ul>
      <p className="wx-caption">● is the cutoff used for the map ({base.toFixed(1)} dB){baseRow ? `: ${baseRow.area_km2.toFixed(2)} km² in ${baseRow.patches} regions` : ""}. Numbers on the right are area and region count.</p>
      {curRow && baseRow && curRow !== baseRow && <p className="wx-readout">At {curRow.delta_db.toFixed(1)} dB the area is {Math.abs((curRow.area_km2 / baseRow.area_km2 - 1) * 100).toFixed(0)}% {curRow.area_km2 > baseRow.area_km2 ? "larger" : "smaller"} than at the cutoff used for the map.</p>}
    </ToolFrame>
  );
}

/* ── What happened? ── */
export function StoryDrawer() {
  const { pulseData, dataTier, showcase, selectedDateIndex } = useWetlandStore();
  if (!pulseData?.dates.length) return null;

  const dates = pulseData.dates;
  const activeIndex = Math.min(Math.max(Math.trunc(selectedDateIndex), 0), dates.length - 1);
  const active = dates[activeIndex];
  const previous = activeIndex > 0 ? dates[activeIndex - 1] : null;
  const availableDates = dataTier === "SHOWCASE" && showcase ? datesWithPatches(showcase) : null;
  const hasResult = !availableDates || availableDates.has(active.date);
  const previousHasResult = Boolean(previous && (!availableDates || availableDates.has(previous.date)));
  const areaDelta = previous && previousHasResult && hasResult ? active.area_km2 - previous.area_km2 : null;
  const regionDelta = previous && previousHasResult && hasResult ? active.patches - previous.patches : null;
  const gapDays = previous && previousHasResult ? daysBetween(previous.date, active.date) : null;
  const signedArea = areaDelta == null ? null : `${areaDelta > 0 ? "+" : areaDelta < 0 ? "−" : ""}${Math.abs(areaDelta).toFixed(2)} km²`;
  const signedRegions = regionDelta == null ? null : `${regionDelta > 0 ? "+" : regionDelta < 0 ? "−" : ""}${Math.abs(regionDelta)}`;
  const paras = changeStory(pulseData, dataTier, opticalState(dataTier, pulseData), showcase?.reference);

  return (
    <ToolFrame title="What happened?" lede="A plain-language summary written only from the measurements loaded in this case." limitation="This text names no causes and is not a flood report.">
      <section className="wx-story-snapshot" aria-label="Selected observation context">
        <header className="wx-story-snapshot__header">
          <div>
            <p className="wx-micro">Selected acquisition</p>
            <strong>{fmtDateLong(active.date)}</strong>
          </div>
          {active.date === pulseData.peak.date && <span className="wx-story-snapshot__badge">Peak in this series</span>}
        </header>
        {hasResult ? (
          <>
            <dl className="wx-story-snapshot__metrics">
              <div className="wx-story-snapshot__metric">
                <dt>Candidate area</dt>
                <dd>{active.area_km2.toFixed(2)} km²</dd>
              </div>
              <div className="wx-story-snapshot__metric">
                <dt>Candidate regions</dt>
                <dd>{active.patches.toLocaleString()}</dd>
              </div>
              <div className="wx-story-snapshot__metric">
                <dt>Mapped-boundary share</dt>
                <dd>{(active.fraction * 100).toFixed(1)}%</dd>
              </div>
            </dl>
            {signedArea != null && signedRegions != null && previous ? (
              <div className="wx-story-snapshot__comparison">
                <p className="wx-micro">Change from {fmtDateLong(previous.date)}</p>
                <div className="wx-story-snapshot__delta">
                  <strong>{signedArea}</strong>
                  <span>{signedRegions} candidate regions</span>
                </div>
                <p className="wx-story-snapshot__note">
                  {gapDays} days between acquisitions. This is a difference between two recorded snapshots, not a daily rate.
                </p>
              </div>
            ) : previous ? (
              <p className="wx-story-snapshot__note">The preceding acquisition has no exported candidate result, so a date-to-date difference is not available.</p>
            ) : (
              <p className="wx-story-snapshot__note">This is the first acquisition in the loaded series; no earlier observation is available for comparison.</p>
            )}
          </>
        ) : (
          <p className="wx-story-snapshot__note">This acquisition is recorded, but no candidate-region result was exported for this date.</p>
        )}
      </section>
      <div className="wx-prose">{paras.map((t, i) => <p key={i}>{t}</p>)}</div>
    </ToolFrame>
  );
}

/* ── Data chain ── */
type ChainCtx = { product?: string; frequency?: string; dates: string[]; mask?: string | null; baseline?: string; threshold?: number; optical: string };
const CHAIN: { kind: Kind; title: string; plain: string; tech: (c: ChainCtx) => string }[] = [
  { kind: "observed", title: "NASA NISAR source", plain: "An L-band radar satellite images the same ground repeatedly, through cloud and at night.", tech: (c) => `Product ${c.product ?? "NISAR L2 GCOV"} · ${c.frequency ?? "L-band"}` },
  { kind: "observed", title: "Acquisition metadata", plain: "Each scene has an acquisition date and a footprint. These dates are the timeline's dots.", tech: (c) => c.dates.length ? `${c.dates.length} processed acquisitions: ${c.dates.map((d) => d.slice(5)).join(", ")}` : "Dates recorded per run" },
  { kind: "observed", title: "Quality filtering", plain: "Pixels with missing or invalid data in any channel are left out before anything is compared.", tech: (c) => c.mask ?? "Finite positive HH and HV power; GCOV number-of-looks above zero" },
  { kind: "derived", title: "Derived signal", plain: "The after scene minus a baseline, in dB, for HH and HV.", tech: (c) => c.baseline ?? "Per-pixel median of earlier observations" },
  { kind: "candidate", title: "Candidate regions", plain: "Connected pixels that pass the change rules become regions with an area and statistics.", tech: (c) => c.threshold != null ? `Base cutoff ${c.threshold.toFixed(1)} dB · minimum region size applies` : "Rule-based; cutoff recorded with the run" },
  { kind: "context", title: "Independent evidence", plain: "Optical satellite data (HLS) are compared only where both dates are clear. This is context, not ground truth.", tech: (c) => c.optical },
];
export function ChainDrawer() {
  const [open, setOpen] = useState<number | null>(null);
  const { showcase, pulseData, dataTier, sensitivityData, selectedPatch } = useWetlandStore();
  const m = showcase?.manifest;
  const ctx: ChainCtx = { product: m?.product, frequency: m?.frequency, dates: pulseData?.dates.map((d) => d.date) ?? [], mask: m?.quality_mask_method,
    baseline: selectedPatch?.baseline_observation_dates ? `Per-pixel median of ${selectedPatch.baseline_observation_dates.length} earlier observations (${selectedPatch.baseline_observation_dates.join(", ")})` : m?.baseline_method ? m.baseline_method.replaceAll("_", " ").toLowerCase() : undefined,
    threshold: (sensitivityData as unknown as { base_threshold_db?: number } | null)?.base_threshold_db, optical: opticalLabel(opticalState(dataTier, pulseData), showcase?.reference) };
  return (
    <ToolFrame title="Data chain" lede="From NASA's radar to a candidate region, in six steps. Open a step for its technical detail."
      limitation="Every step is automated except the last decision: what the evidence supports is up to the person reading it.">
      <ol className="wx-chain">
        {CHAIN.map((c, i) => (
          <li key={c.title}><button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}><span className="wx-chain__n wx-mono">{i + 1}</span><span><KindTag kind={c.kind} /> <strong>{c.title}</strong><small>{c.plain}</small></span></button>
            {open === i && <p className="wx-mono wx-chain__tech">{c.tech(ctx)}</p>}</li>))}
      </ol>
    </ToolFrame>
  );
}

/* ── Why radar? ── */
export function WhyRadarDrawer() {
  return (
    <ToolFrame title="Why radar?" lede="NISAR radar can collect surface measurements through cloud and at night, which is useful in monsoon wetlands."
      limitation="This is a method explanation, not a report about today's local cloud cover. A change in radar signal can have several causes, so every candidate still needs scrutiny.">
      <dl className="wx-why">
        <div><dt>Optical imagery</dt><dd>Visible and infrared observations can be obscured by cloud. GeoNexSAR only uses an optical comparison when a suitable clear reference is available.</dd></div>
        <div><dt>NISAR L-band radar</dt><dd>Radar measurements do not depend on visible light and can be collected through cloud, but the signal is affected by surface roughness, moisture, vegetation and viewing geometry.</dd></div>
        <div><dt>Vegetation</dt><dd>L-band waves can interact with stems, trunks and water among plants. A radar signature is evidence to investigate, not proof of inundation beneath vegetation.</dd></div>
      </dl>
    </ToolFrame>
  );
}

/* ── Lock comparison ── */
export function CompareDrawer() {
  const { pulseData, lock, lockComparison, clearLock, selectedDateIndex, radarOpacity, setRadarOpacity, showcase, dataTier } = useWetlandStore();
  const dates = useMemo(() => pulseData?.dates ?? [], [pulseData]);
  const usable = useMemo(() => (dataTier === "SHOWCASE" && showcase ? new Set(showcase.observations.filter((o) => o.patches_file).map((o) => o.date)) : null), [dataTier, showcase]);
  const [b, setB] = useState(0); const [a, setA] = useState(Math.max(0, selectedDateIndex));
  if (dates.length < 2) return <ToolFrame title="Lock comparison" lede="Lock two observations to compare them on the same map." limitation="At least two dates are needed."><p className="wx-empty">Not available.</p></ToolFrame>;
  const opt = (d: { date: string }, i: number) => <option key={d.date} value={i} disabled={!!usable && !usable.has(d.date)}>{fmtDate(d.date, { month: "short", day: "numeric", year: "numeric" })}</option>;
  return (
    <ToolFrame title="Lock comparison" lede="Pick two real observations. The map splits so you can drag between them on the same geographic extent."
      limitation="Both sides show the stored candidate regions for those dates. Nothing is interpolated between acquisitions."
      action={lock ? <button className="wx-btn" onClick={clearLock}>Reset comparison</button> : <button className="wx-btn wx-btn--primary" disabled={a === b} onClick={() => void lockComparison(b, a)}>Lock these two dates</button>}>
      <div className="wx-form">
        <label>Before<select value={b} onChange={(e) => setB(Number(e.target.value))}>{dates.map(opt)}</select></label>
        <label>After<select value={a} onChange={(e) => setA(Number(e.target.value))}>{dates.map(opt)}</select></label>
      </div>
      {lock && <p className="wx-note">Locked: <b>{fmtDate(dates[lock.beforeIndex].date)}</b> (left) and <b>{fmtDate(dates[lock.afterIndex].date)}</b> (right), both showing candidate regions. Drag the divider or use the arrow keys on it.</p>}
      <label className="wx-slider">Radar layer opacity <b className="wx-mono">{Math.round(radarOpacity * 100)}%</b><input type="range" min={0.2} max={1} step={0.05} value={radarOpacity} onChange={(e) => setRadarOpacity(Number(e.target.value))} /></label>
      <p className="wx-caption">Opacity applies to radar layers in the Radar view.</p>
    </ToolFrame>
  );
}

/* ── Independent check ── */
const IMG_LABEL: Record<string, string> = {
  reference_before_rgb: "Optical, before", reference_before_water: "Optical water, before", reference_after_rgb: "Optical, after", reference_after_water: "Optical water, after",
  reference_agreement: "Radar vs optical", reference_coverage: "Shared clear area", reference_candidate_overlay: "Radar candidates on optical",
};
export function OpticalDrawer() {
  const { dataTier, showcase, pipelineRunId, pulseData } = useWetlandStore();
  const [local, setLocal] = useState<{ id: string; ref: ShowcaseReference | null } | null>(null);
  useEffect(() => {
    if (dataTier !== "LOCAL_RUN" || !pipelineRunId) return;
    let live = true;
    fetch(`/api/wetland/reference-evidence?run=${pipelineRunId}`).then((r) => (r.ok ? r.json() : null))
      .then((evidence) => { if (live) setLocal({ id: pipelineRunId, ref: evidence ? { available: true, evidence } : { available: false } }); })
      .catch(() => { if (live) setLocal({ id: pipelineRunId, ref: { available: false } }); });
    return () => { live = false; };
  }, [dataTier, pipelineRunId]);
  const state = opticalState(dataTier, pulseData);
  const ref = dataTier === "SHOWCASE" ? showcase?.reference : local?.id === pipelineRunId ? local.ref : null;
  const ev = ref?.evidence; const m = ev?.metrics; const cov = ev?.coverage as { common_clear_fraction?: number; common_clear_area_km2?: number; minimum_clear_fraction_for_check?: number } | undefined;
  const reason = (ref?.validation as { reason?: string } | undefined)?.reason;
  const need = cov?.minimum_clear_fraction_for_check ?? 0.2; const have = cov?.common_clear_fraction ?? 0;
  const inconclusive = state === "INCONCLUSIVE" || (ev?.reference_status ?? "") === "INCONCLUSIVE";
  const cmp = ev?.comparison as { baseline?: { hls_date?: string; nisar_date?: string }; event?: { hls_date?: string; nisar_date?: string } } | undefined;
  return (
    <ToolFrame title="Independent check" lede="Does a different kind of satellite agree? Optical imagery (HLS) is compared with the radar candidates, but only where both optical dates were clear."
      limitation="Optical agreement is context, not field truth. It cannot validate flooded vegetation, and low overlap can mean water was already present on both optical dates.">
      {!ev && <p className="wx-empty">{dataTier === "LOCAL_RUN" && !local ? "Loading the saved comparison…" : "No optical comparison was saved with this run. A missing check is not disagreement."}</p>}
      {ev && <>
        <div className={`wx-callout ${inconclusive ? "wx-callout--warn" : ""}`}>
          <span className="wx-micro">Result</span>
          <strong>{inconclusive ? "Inconclusive: not enough shared clear sky to judge" : "Comparison completed"}</strong>
          {inconclusive && <p>This is not a failed detection and not a zero score. The optical images simply cannot assess almost all of the study area{reason ? `: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : "."}</p>}
        </div>
        <div className="wx-cover" role="img" aria-label={`Shared clear area ${pct1(have)} of the study area; at least ${pct1(need)} is needed`}>
          <div className="wx-cover__bar"><i style={{ width: `${Math.max(0.6, Math.min(100, have * 100))}%` }} /><b style={{ left: `${Math.min(100, need * 100)}%` }} /></div>
          <div className="wx-cover__legend"><span><KindTag kind="context">Assessed</KindTag> <span className="wx-mono">{pct1(have)}{cov?.common_clear_area_km2 != null ? ` · ${cov.common_clear_area_km2.toFixed(2)} km²` : ""}</span></span><span><KindTag kind="unassessed" /> <span className="wx-mono">{pct1(1 - have)}</span></span><span className="wx-mono">needed ≥ {pct1(need)}</span></div>
        </div>
        {cmp?.baseline?.hls_date && <dl className="wx-facts"><div><dt>Optical dates</dt><dd className="wx-mono">{cmp.baseline.hls_date} → {cmp.event?.hls_date}</dd></div><div><dt>Radar dates</dt><dd className="wx-mono">{cmp.baseline.nisar_date} → {cmp.event?.nisar_date}</dd></div></dl>}
        {m && (inconclusive
          ? <details className="wx-raw"><summary>Raw comparison numbers (not meaningful at this coverage)</summary>
              <p className="wx-mono">agree {m.matching_pixels.toLocaleString()} · radar only {m.radar_only_pixels.toLocaleString()} · optical only {m.optical_only_pixels.toLocaleString()}<br />precision {pct1(m.precision)} · recall {pct1(m.recall)} · F1 {pct1(m.f1)}</p>
              <p className="wx-caption">With so few comparable pixels these scores describe the sampling gap, not detector accuracy.</p></details>
          : <dl className="wx-facts"><div><dt>Satellite agreement</dt><dd className="wx-mono">precision {pct1(m.precision)} · recall {pct1(m.recall)} · F1 {pct1(m.f1)}</dd></div></dl>)}
        {ev.showcase_images && Object.keys(ev.showcase_images).length > 0 && <div className="wx-optical-imgs">
          {Object.entries(ev.showcase_images).map(([name, path]) => { const key = name.replace(/\.png$/, "");
            return (// eslint-disable-next-line @next/next/no-img-element
              <figure key={name}><img loading="lazy" src={showcaseUrl(path)} alt={IMG_LABEL[key] ?? key.replaceAll("_", " ")} /><figcaption>{IMG_LABEL[key] ?? key}</figcaption></figure>); })}
        </div>}
        {ev.limitations && ev.limitations.length > 0 && <details className="wx-raw"><summary>Recorded limitations</summary><ul className="wx-plain">{ev.limitations.map((l) => <li key={l}>{l}</li>)}</ul></details>}
      </>}
    </ToolFrame>
  );
}

/* ── Provenance ── */
export function AboutDrawer() {
  const { dataTier, showcase, pulseData, loadShowcase } = useWetlandStore();
  const m = showcase?.manifest;
  return (
    <ToolFrame title="Provenance" lede="Where this data came from, what is measured, what is calculated, and what is missing."
      limitation="The NISAR input is provisional, there is no field truth, and the boundary is a mapped polygon, not a legal wetland extent."
      action={<button className="wx-btn wx-btn--primary" onClick={() => void loadShowcase()}>Reload the real showcase</button>}>
      <TierBadge tier={dataTier} completeness={m?.completeness} />
      {dataTier === "SHOWCASE" && m && <>
        <Section eyebrow="Observed" title="NISAR acquisitions"><p>{m.product} ({m.product_maturity ?? "provisional"}) over {m.site_display_name ?? m.site_name.replace(/ mapped boundary$/i, "")}. {m.observation_dates.length} processed dates, {fmtDate(m.observation_dates[0])} to {fmtDate(m.observation_dates[m.observation_dates.length - 1], { month: "short", day: "numeric", year: "numeric" })}.</p></Section>
        <Section eyebrow="Derived" title="Calculated by the pipeline"><p>Change against {m.baseline_method === "PER_PIXEL_MEDIAN" && m.baseline_observation_dates ? `a per-pixel median of ${m.baseline_observation_dates.length} earlier observations` : `the baseline of ${m.baseline_date}`}. Candidate regions follow rule-based cutoffs.</p></Section>
        <Section eyebrow="Context" title="Boundary and independent data"><p>{m.wetland_boundary_source ?? "Boundary source not recorded"}.</p></Section>
        <details className="wx-raw"><summary>Technical details</summary><dl className="wx-facts wx-mono">
          <div><dt>Run</dt><dd>{m.run_id}</dd></div><div><dt>Frequency</dt><dd>{m.frequency ?? "n/a"}</dd></div><div><dt>Quality mask</dt><dd>{m.quality_mask_method ?? "n/a"}</dd></div>
          <div><dt>Source</dt><dd>{m.source}</dd></div><div><dt>Exported</dt><dd>{m.exported_at.slice(0, 10)}</dd></div></dl></details>
        {m.limitations.length > 0 && <details className="wx-raw"><summary>Limitations recorded with this export</summary><ul className="wx-plain">{m.limitations.map((l) => <li key={l}>{l}</li>)}</ul></details>}
        {m.legacy && <div className="wx-legacy"><p className="wx-note"><b>Legacy run: {m.completeness === "METADATA_ONLY" ? "acquisition dates and boundary only" : "partial export"}.</b> {m.legacy.note}</p>
          <p className="wx-micro">Not in this export</p><ul className="wx-plain">{m.legacy.skipped.map((x) => <li key={x.artifact}><b>{x.artifact}</b>: {x.reason}</li>)}</ul></div>}
      </>}
      {dataTier === "LOCAL_RUN" && <p className="wx-note">A saved pipeline run read from this machine ({pulseData?.site}). Provisional NISAR product; not validated.</p>}
    </ToolFrame>
  );
}

/* ══════════════════════════════════════════════════════════
   The three tabs — one panel, three chapters.
   Each composes the focused drawers above; no content is lost,
   but the visitor never faces nine floating tools again.
   ══════════════════════════════════════════════════════════ */

function PanelHead({ n, title, lede }: { n: string; title: string; lede: string }) {
  return (
    <div className="wx-panelhead">
      <p className="wx-micro"><span className="wx-panelhead__n">{n}</span> · Investigation</p>
      <h2>{title}</h2>
      <p className="wx-lede">{lede}</p>
    </div>
  );
}

/** Searchable, sortable region register with transparent exports and reproducible links. */
function RegionRegister() {
  const { patches, selectedPatch, setSelectedPatch, pulseData, selectedDateIndex, dataTier, showcaseId, vegFilter, setVegFilter, viewMode, mapMode, setDrawer, threshold, sensitivityData } = useWetlandStore();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"area" | "delta" | "id">("area");
  const [visibleLimit, setVisibleLimit] = useState(100);
  const [format, setFormat] = useState<"csv" | "geojson" | "json">("csv");
  const [message, setMessage] = useState("");
  const [shareFallback, setShareFallback] = useState("");
  const date = pulseData?.dates[Math.min(selectedDateIndex, Math.max(0, pulseData.dates.length - 1))]?.date ?? null;
  const rows = useMemo(() => patches
    .filter((p) => vegFilter === "ALL" || p.classification === vegFilter)
    .filter((p) => `${p.id} ${regionLabel(p.id)} ${p.classification} ${p.interpretation_label ?? ""}`.toLowerCase().includes(query.toLowerCase().trim()))
    .sort((a, b) => {
      if (sort === "area") return b.area_km2 - a.area_km2 || a.id.localeCompare(b.id);
      if (sort === "delta") return Math.abs(b.delta_hh) - Math.abs(a.delta_hh) || a.id.localeCompare(b.id);
      return a.id.localeCompare(b.id);
    }),
  [patches, vegFilter, query, sort]);
  const visibleRows = rows.slice(0, visibleLimit);
  const hasActiveFilters = query.trim().length > 0 || vegFilter !== "ALL";

  function resetRegister() {
    setQuery("");
    setVegFilter("ALL");
    setSort("area");
    setVisibleLimit(100);
  }

  function exportRows() {
    const source = "NISAR";
    const name = `geonexsar-${dataTier === "LOCAL_RUN" ? "local-run" : "showcase"}-${date ?? "current"}`;
    const runId = useWetlandStore.getState().pipelineRunId;
    const limitations = [
      "Candidate regions are algorithmic radar-change detections, not confirmed flooding.",
      "NISAR product maturity is provisional.",
      "Independent reference comparisons are contextual evidence, not field truth.",
    ];
    if (format === "csv") {
      downloadFile(`${name}-regions.csv`, patchesCSV(rows, threshold, source), "text/csv;charset=utf-8");
    } else if (format === "geojson") {
      const content = {
        type: "FeatureCollection",
        data_source: source,
        run_id: runId,
        product: pulseData?.product ?? "NISAR L2 GCOV",
        product_maturity: pulseData?.product_maturity ?? "PROVISIONAL",
        site: pulseData?.site,
        date,
        limitations,
        features: rows.filter((p) => p.geometry).map((p) => ({ type: "Feature", geometry: p.geometry, properties: { ...p } })),
      };
      downloadFile(`${name}-regions.geojson`, JSON.stringify(content, null, 2), "application/geo+json");
    } else {
      downloadFile(`${name}-investigation.json`, JSON.stringify({ schema_version: 1, product: pulseData?.product ?? "NISAR L2 GCOV", data_source: source, data_tier: dataTier,
        site: pulseData?.site, date, threshold_db: threshold, class_filter: vegFilter, map_mode: mapMode, view_mode: viewMode,
        selected_region: selectedPatch?.id ?? null, regions: rows, pulse: pulseData, sensitivity: sensitivityData, run_id: runId,
        reference_status: pulseData?.reference_check_status ?? "NOT_RUN", limitations }, null, 2), "application/json");
    }
    setMessage(`Exported ${rows.length} observed-data candidate regions as ${format.toUpperCase()}.`);
  }

  async function shareView() {
    const params = new URLSearchParams({ date: String(selectedDateIndex), filter: vegFilter, mode: viewMode, mapMode, ...(selectedPatch ? { region: selectedPatch.id } : {}) });
    if (dataTier === "SHOWCASE") params.set("case", showcaseId);
    if (dataTier === "LOCAL_RUN") params.set("source", "raster");
    const url = `${window.location.origin}/wetland?${params.toString()}`;
    try { await navigator.clipboard.writeText(url); setMessage(dataTier === "LOCAL_RUN" ? "Local-run view link copied. The same saved run must exist on the computer that opens it." : "Shareable real-showcase view link copied."); }
    catch { setShareFallback(url); setMessage("Clipboard unavailable. Select and copy the share link below."); }
  }

  if (!pulseData || !patches.length) return <ToolFrame title="Region register" lede="Search and export the candidate regions for the selected observation." limitation="Some legacy cases include acquisition metadata but no derived region files."><p className="wx-empty">No region geometries were exported for the selected observation.</p></ToolFrame>;
  return <ToolFrame title="Region register" lede={`${rows.length} of ${patches.length} regions · ${date ?? "selected observation"}. Search, sort, choose a region, then export the current filtered result.`}
    limitation="Exports preserve real-data provenance and scientific limitations. A candidate is not a confirmed flood.">
    <div className="wx-region-register">
    <div className="wx-region-tools">
      <label>Search regions<input value={query} onChange={(e) => { setQuery(e.target.value); setVisibleLimit(100); }} placeholder="Region ID or class…" aria-label="Search candidate regions" /></label>
      <label>Sort by<select value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); setVisibleLimit(100); }} aria-label="Sort regions"><option value="area">Largest area</option><option value="delta">Strongest |ΔHH|</option><option value="id">Region ID</option></select></label>
      <label>Class filter<select value={vegFilter} onChange={(e) => { setVegFilter(e.target.value as typeof vegFilter); setVisibleLimit(100); }} aria-label="Filter candidate class"><option value="ALL">All classes</option><option value="OPEN_WATER">HH-darkening</option><option value="VEGETATED_INUNDATION">Vegetation-related</option><option value="UNCERTAIN">Uncertain</option></select></label>
    </div>
    <div className="wx-region-summary">
      <span role="status" aria-live="polite">Showing {visibleRows.length} of {rows.length} matching regions</span>
      {hasActiveFilters && <button type="button" onClick={resetRegister}>Clear search and filters</button>}
    </div>
    {rows.length > 0 ? (
      <>
        <div className="wx-region-table-wrap"><table className="wx-region-table"><thead><tr><th scope="col">Region</th><th scope="col">Area</th><th scope="col">ΔHH</th><th scope="col">Class</th></tr></thead>
          <tbody>{visibleRows.map((p) => <tr key={p.id} className={selectedPatch?.id === p.id ? "is-selected" : ""}>
            <td><button type="button" onClick={() => { setSelectedPatch(p); setDrawer("EXPLORE"); }} aria-pressed={selectedPatch?.id === p.id}>{regionLabel(p.id)}</button></td>
            <td className="wx-mono">{p.area_km2.toFixed(3)}</td><td className="wx-mono">{p.delta_hh > 0 ? "+" : ""}{p.delta_hh.toFixed(1)} dB</td><td>{p.classification === "OPEN_WATER" ? "HH-darkening" : p.classification === "VEGETATED_INUNDATION" ? "Vegetation" : "Uncertain"}</td>
          </tr>)}</tbody></table></div>
        <ul className="wx-region-cards" aria-label="Candidate regions">
          {visibleRows.map((p) => (
            <li key={p.id} data-region-id={p.id} className={selectedPatch?.id === p.id ? "wx-region-card is-selected" : "wx-region-card"}>
              <button type="button" className="wx-region-card__select" onClick={() => { setSelectedPatch(p); setDrawer("EXPLORE"); }} aria-pressed={selectedPatch?.id === p.id}>
                <span>{regionLabel(p.id)}</span><strong>{p.area_km2.toFixed(3)} km²</strong>
              </button>
              <div className="wx-region-card__meta">
                <div><span>ΔHH</span><strong>{p.delta_hh > 0 ? "+" : ""}{p.delta_hh.toFixed(1)} dB</strong></div>
                <div><span>Class</span><strong>{p.classification === "OPEN_WATER" ? "HH-darkening" : p.classification === "VEGETATED_INUNDATION" ? "Vegetation" : "Uncertain"}</strong></div>
              </div>
            </li>
          ))}
        </ul>
        {visibleRows.length < rows.length && <div className="wx-region-pagination">
          <span>{rows.length - visibleRows.length} more regions in this result</span>
          <button type="button" className="wx-btn" onClick={() => setVisibleLimit((current) => Math.min(current + 100, rows.length))}>
            Show next {Math.min(100, rows.length - visibleRows.length)} regions
          </button>
        </div>}
      </>
    ) : (
      <div className="wx-region-empty" role="status">
        <strong>No candidate regions match those criteria.</strong>
        <p>Try a different region ID or class, or clear the current search and filters.</p>
      </div>
    )}
    <div className="wx-region-export"><label>Export format<select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}><option value="csv">CSV · spreadsheet</option><option value="geojson">GeoJSON · map data</option><option value="json">JSON · reproducible snapshot</option></select></label>
      <button type="button" className="wx-btn wx-btn--primary" onClick={exportRows}>Export {rows.length} regions</button><button type="button" className="wx-btn" onClick={() => void shareView()}>Copy share link</button>
    </div>
    {message && <p className="wx-note" role="status">{message}</p>}
    {shareFallback && <label className="wx-share-fallback">Share link<input readOnly value={shareFallback} onFocus={(e) => e.currentTarget.select()} /></label>}
    </div>
  </ToolFrame>;
}

/** 01 · Explore — touch the data. */
export function ExplorePanel() {
  const { detectiveOn, setDetectiveOn } = useWetlandStore();
  return (
    <div className="wx-panel">
      <PanelHead n="01" title="Explore" lede="Select a candidate region to inspect its radar measurements and limitations, or use SAR Detective to sample a point on the map." />
      <button type="button" className={`wx-detective${detectiveOn ? " is-on" : ""}`} aria-pressed={detectiveOn}
        onClick={() => setDetectiveOn(!detectiveOn)}>
        <span className="wx-micro">{detectiveOn ? "● Detective active — click anywhere on the map" : "SAR Detective"}</span>
        <strong>{detectiveOn ? "Tap again to switch off" : "Read the radar signal at any point"}</strong>
      </button>
      {detectiveOn ? <DetectiveDrawer /> : <InvestigationDrawer />}
      <WetlandPulseChart />
      <RegionRegister />
      <StoryDrawer />
      <CompareDrawer />
    </div>
  );
}

/** 02 · Check it — stress-test the detection. */
export function CheckPanel() {
  return (
    <div className="wx-panel">
      <PanelHead n="02" title="Check it" lede="Don't take the map's word for it. Stress-test the detection against stricter cutoffs, then see whether a second satellite agrees." />
      <SensitivityDrawer />
      <OpticalDrawer />
    </div>
  );
}

/** 03 · Learn — how a radar pulse becomes a glowing region. */
export function LearnPanel() {
  return (
    <div className="wx-panel">
      <PanelHead n="03" title="Learn" lede="How a radar pulse becomes a glowing region — and what radar sees that cameras can't." />
      <ChainDrawer />
      <WhyRadarDrawer />
      <AboutDrawer />
      <Link className="wx-global-analysis-link" href="/wetland/global#nisar-process">
        <span className="wx-micro">Next investigation</span>
        <strong>Analyse another real location →</strong>
        <small>Check the NASA catalogue before starting a new study.</small>
      </Link>
    </div>
  );
}

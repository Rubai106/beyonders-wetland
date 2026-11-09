"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useWetlandStore, type MapMode, type PanelTab, type ViewMode } from "@/lib/store";
import { fmtDate, opticalState } from "@/lib/story";
import { datesWithPatches, loadShowcaseRadar, nextAvailableIndex, type RadarPreview } from "@/lib/showcase";
import TimeMachine from "./TimeMachine";
import { Icon } from "./icons";
import { TierBadge } from "./ui";
import { CheckPanel, ExplorePanel, LearnPanel } from "./Drawers";
import "./experience.css";

const WetlandStage = dynamic(() => import("./WetlandStage"), { ssr: false, loading: () => <div className="wx-stage wx-stage--loading">Loading map…</div> });

const MODES: { id: ViewMode; label: string; icon: React.ReactNode; purpose: string }[] = [
  { id: "MOTION", label: "Motion", icon: Icon.motion, purpose: "Watch candidate change evolve across the real observations." },
  { id: "RADAR", label: "Radar", icon: Icon.radar, purpose: "See the radar imagery NISAR recorded, before the rules were applied." },
  { id: "DETECTION", label: "Detection", icon: Icon.detection, purpose: "See where the rules flagged candidates, by class." },
];

const MAP_MODES: { id: MapMode; label: string; purpose: string }[] = [
  { id: "BEFORE", label: "Before", purpose: "Show the per-pixel median baseline before this acquisition." },
  { id: "AFTER", label: "After", purpose: "Show backscatter from the selected acquisition." },
  { id: "DIFFERENCE", label: "Diff", purpose: "Show after-minus-before radar backscatter change." },
  { id: "SPLIT", label: "Split", purpose: "Compare the baseline and selected acquisition side by side." },
];

const TABS: { id: Exclude<PanelTab, "NONE">; n: string; label: string; hint: string }[] = [
  { id: "EXPLORE", n: "01", label: "Explore", hint: "Touch the data — regions, detective, story" },
  { id: "CHECK", n: "02", label: "Check it", hint: "Stress-test the detection" },
  { id: "LEARN", n: "03", label: "Learn", hint: "How radar becomes a glowing region" },
];

function Hatch() {
  return <svg className="wx-defs" width="0" height="0" aria-hidden="true"><defs><pattern id="wx-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(242,164,90,.10)" /><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(242,164,90,.8)" strokeWidth="1.4" /></pattern></defs></svg>;
}

/** "Tanguar Haor mapped boundary" -> "Tanguar Haor". The suffix describes the mask, not the place. */
export const caseTitle = (name: string) => name.replace(/\s*·.*$/, "").replace(/\s+mapped boundary$/i, "");

export function ModeSwitch({ value, onChange }: { value?: ViewMode; onChange?: (mode: ViewMode) => void } = {}) {
  const store = useWetlandStore();
  const viewMode = value ?? store.viewMode;
  const setViewMode = onChange ?? store.setViewMode;
  return (
    <div className="wx-modebar">
      <div className="wx-modes" role="radiogroup" aria-label="Map view" aria-orientation="horizontal">
        {MODES.map((m, i) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={viewMode === m.id}
            tabIndex={viewMode === m.id ? 0 : -1}
            onClick={() => setViewMode(m.id)}
            onKeyDown={(event) => {
              let nextIndex: number;
              switch (event.key) {
                case "ArrowRight":
                  nextIndex = (i + 1) % MODES.length;
                  break;
                case "ArrowLeft":
                  nextIndex = (i - 1 + MODES.length) % MODES.length;
                  break;
                case "Home":
                  nextIndex = 0;
                  break;
                case "End":
                  nextIndex = MODES.length - 1;
                  break;
                default:
                  return;
              }
              event.preventDefault();
              const nextMode = MODES[nextIndex];
              setViewMode(nextMode.id);
              (event.currentTarget.parentElement?.querySelector(`[data-mode="${nextMode.id}"]`) as HTMLButtonElement | null)?.focus();
            }}
            data-mode={m.id}
            title={m.purpose}
            aria-label={`${m.label}: ${m.purpose}`}
          >{m.icon}<span>{m.label}</span></button>
        ))}
      </div>
    </div>
  );
}

export function MapModeSwitch() {
  const { mapMode, setMapMode, setViewMode } = useWetlandStore();
  return (
    <div className="wx-mapmodebar">
      <span className="wx-mapmodebar__label">Raster</span>
      <div className="wx-mapmodes" role="radiogroup" aria-label="Radar raster comparison" aria-orientation="horizontal">
        {MAP_MODES.map((mode, index) => (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={mapMode === mode.id}
            tabIndex={mapMode === mode.id ? 0 : -1}
            data-map-mode={mode.id}
            title={mode.purpose}
            aria-label={`${mode.label}: ${mode.purpose}`}
            onClick={() => {
              setMapMode(mode.id);
              setViewMode("RADAR");
            }}
            onKeyDown={(event) => {
              let nextIndex: number;
              switch (event.key) {
                case "ArrowRight": nextIndex = (index + 1) % MAP_MODES.length; break;
                case "ArrowLeft": nextIndex = (index - 1 + MAP_MODES.length) % MAP_MODES.length; break;
                case "Home": nextIndex = 0; break;
                case "End": nextIndex = MAP_MODES.length - 1; break;
                default: return;
              }
              event.preventDefault();
              const nextMode = MAP_MODES[nextIndex];
              setMapMode(nextMode.id);
              setViewMode("RADAR");
              (event.currentTarget.parentElement?.querySelector(`[data-map-mode="${nextMode.id}"]`) as HTMLButtonElement | null)?.focus();
            }}
          >{mode.label}</button>
        ))}
      </div>
    </div>
  );
}

function ContextRail() {
  const { pulseData, selectedDateIndex, dataTier, showcase, selectedPatch, lock } = useWetlandStore();
  if (!pulseData) return null;
  const d = pulseData.dates; const cur = d[Math.min(selectedDateIndex, d.length - 1)];
  const isPeak = cur.date === pulseData.peak.date;
  const optical = opticalState(dataTier, pulseData);
  const name = caseTitle(pulseData.site);
  const note = optical === "INCONCLUSIVE" ? "The independent optical check was inconclusive, so nothing here has been corroborated."
    : optical === "SUPPORT_LIMITED" ? "An optical comparison covered only part of the area." : "No independent check has been run.";
  return (
    <aside className="wx-rail" aria-label="Study area and selected observation">
      <p className="wx-micro">Real NISAR observation · L-band radar</p>
      <h1>{name}</h1>
      <p className="wx-sub">{/hakaluki|tanguar/i.test(name) ? "Sunamganj, Bangladesh · " : ""}monsoon 2026, seen from orbit</p>
      <p className="wx-mono wx-meta">NISAR L2 GCOV · provisional · {d.length} processed comparison dates · {fmtDate(d[0].date)} – {fmtDate(d[d.length - 1].date, { month: "short", day: "numeric", year: "numeric" })}</p>
      <div className={`wx-obsbox${isPeak ? " is-peak" : ""}`} aria-live="polite">
        <p className="wx-micro">{isPeak ? "Peak observation" : "Selected observation"}</p>
        <p className="wx-date">{fmtDate(cur.date, { month: "long", day: "numeric", year: "numeric" })}</p>
        <p className="wx-big"><strong>{cur.area_km2.toFixed(2)}</strong> km²</p>
        <p className="wx-bigcap">of radar-change candidates flagged by the detection rules</p>
        <p className="wx-mono wx-count">{cur.patches.toLocaleString()} regions</p>
      </div>
      <p className="wx-read">
        <>On {fmtDate(cur.date, { month: "long", day: "numeric" })}, the radar return shifted across <b>{cur.patches.toLocaleString()} regions</b>. They are candidates for investigation, not confirmed floods. {note}</>
      </p>
      {lock && <p className="wx-read wx-read--lock">Comparing {fmtDate(d[lock.beforeIndex].date)} against {fmtDate(d[lock.afterIndex].date)} — drag the divider.</p>}
      {!selectedPatch && <div className="wx-hint"><span className="wx-micro">Start here</span><p>Press <b>Play change</b> and watch the monsoon unfold — or click any glowing region to interrogate it.</p></div>}
      <p className="wx-src">{showcase ? <>Source: {showcase.manifest.product ?? "NISAR L2 GCOV"}, provisional.</> : `${pulseData.product ?? "NISAR L2 GCOV"}, provisional.`}</p>
      <Link className="wx-rail-link" href="/wetland/global">See worldwide NISAR coverage →</Link>
    </aside>
  );
}

function RadarControls() {
  const { radarChannel, setRadarLayer, dataTier, pulseData, selectedDateIndex, showcase, showcaseId, mapMode } = useWetlandStore();
  const [expanded, setExpanded] = useState(false);
  const date = pulseData?.dates[selectedDateIndex]?.date;
  const [loaded, setLoaded] = useState<{ date: string; preview: RadarPreview | null } | null>(null);
  useEffect(() => {
    let live = true;
    if (date && dataTier === "SHOWCASE") void loadShowcaseRadar(date, showcaseId, showcase?.manifest).then((p) => { if (live) setLoaded({ date, preview: p }); });
    return () => { live = false; };
  }, [date, dataTier, showcaseId, showcase?.manifest]);
  const preview = loaded && loaded.date === date ? loaded.preview : null;
  const noPreview = dataTier === "SHOWCASE" && !!date && !(showcase?.manifest.radar_dates ?? []).includes(date);
  const scale = mapMode === "SPLIT" ? null : mapMode === "DIFFERENCE" ? [-10, 10] : preview?.layers[radarChannel]?.scale_db;
  const channelStage = mapMode === "BEFORE" ? "before" : mapMode === "AFTER" || mapMode === "SPLIT" ? "after" : "change";
  const stageWord = mapMode === "BEFORE" ? "Baseline" : mapMode === "AFTER" ? "After" : mapMode === "SPLIT" ? "Split" : "Difference";
  const stageDescription = mapMode === "BEFORE"
    ? "Baseline is the per-pixel median of earlier observations."
    : mapMode === "AFTER"
      ? "After shows backscatter from the selected acquisition."
      : mapMode === "SPLIT"
        ? "Split compares the baseline median with the selected acquisition."
        : "Difference is selected-acquisition backscatter minus the baseline.";
  return (
    <div className="wx-radar-picker">
      <button type="button" className="wx-radar-trigger" aria-expanded={expanded} aria-controls="wetland-radar-layer-options"
        aria-label={`${expanded ? "Hide" : "Show"} HH and HV radar polarization options; selected ${radarChannel.toUpperCase()} ${stageWord}`}
        onClick={() => setExpanded((open) => !open)}>
        {Icon.radar}<span>Polarization</span><strong>{radarChannel.toUpperCase()} · {stageWord}</strong><span className="wx-radar-trigger__chevron" aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && <div id="wetland-radar-layer-options" className="wx-radar" role="group" aria-label="Choose HH or HV radar polarization">
        <div className="wx-radar__head"><strong>Local GCOV raster</strong><span className="wx-mono">{date || "No observation date"}</span><button type="button" aria-label="Close radar polarization options" onClick={() => setExpanded(false)}>{Icon.close}</button></div>
        <div className="wx-radar__row" role="group" aria-label="Radar polarization">
          <span className="wx-micro">POL</span>
          {(["hh", "hv"] as const).map((channel) =>
            <button key={channel} type="button" data-channel={channel.toUpperCase()} aria-pressed={radarChannel === channel}
              aria-label={`Show ${channel.toUpperCase()} polarization`}
              onClick={() => { setRadarLayer(channel, channelStage); setExpanded(false); }}>{channel.toUpperCase()}</button>)}
        </div>
        {scale && <div className="wx-ramp"><i className={mapMode === "DIFFERENCE" ? "is-div" : "is-gray"} /><span className="wx-mono">{scale[0]} dB</span><span className="wx-mono">{scale[1]} dB</span></div>}
        {noPreview && <p className="wx-radar__notice" role="status">No radar raster preview was exported for {date}. The selected comparison mode is kept, but only candidate outlines can be shown for this date.</p>}
        <small>{stageDescription} {preview?.baseline_observation_dates && mapMode !== "AFTER" ? `Baseline uses the per-pixel median of ${preview.baseline_observation_dates.length} earlier observations.` : ""} {mapMode === "DIFFERENCE" ? "Blue: weaker return. Red: stronger return. Transparent: no valid data." : "Grey: backscatter power. Transparent: no valid data."}</small>
      </div>}
    </div>
  );
}

/** Legacy run whose derived results could not be verified: only real boundary + acquisition dates. */
function AcquisitionsOnly() {
  const showcase = useWetlandStore((x) => x.showcase);
  if (!showcase) return null;
  const m = showcase.manifest; const dates = m.observation_dates;
  const t0 = Date.parse(`${dates[0]}T00:00:00Z`); const span = Math.max(Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) - t0, 1);
  return (
    <>
      <aside className="wx-rail" aria-label="Study area">
        <p className="wx-micro">Study area</p><h1>{caseTitle(m.site_display_name ?? m.site_name)}</h1><p className="wx-sub">Sunamganj, Bangladesh · mapped haor boundary</p>
        <p className="wx-mono wx-meta">NISAR L-band · {dates.length} processed dates · {fmtDate(dates[0])} – {fmtDate(dates[dates.length - 1], { month: "short", day: "numeric", year: "numeric" })}</p>
        <div className="wx-obsbox"><p className="wx-micro">Acquisitions only</p><p className="wx-big"><strong>{dates.length}</strong> NISAR observations</p><p className="wx-bigcap">Real acquisition dates recorded for this run</p></div>
        <p className="wx-read"><b>Derived change results are not included in this export.</b> The boundary and dates are real. Open 03 · Learn for what is missing and why. Nothing is interpolated.</p>
      </aside>
      <section className="wx-acq" aria-label="Real NISAR acquisition dates">
        <div className="wx-track" role="list"><div className="wx-track__axis" />
          {dates.map((d, i) => { const x = 4 + ((Date.parse(`${d}T00:00:00Z`) - t0) / span) * 92; const gap = i > 0 ? (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${dates[i - 1]}T00:00:00Z`)) / 86400000 : 0;
            return <div key={d} role="listitem" className="wx-obs is-off" style={{ left: `${x}%` }} title="Acquired by NISAR; results not exported"><i className="wx-obs__dot" /><span className="wx-obs__date">{fmtDate(d)}</span>{gap > 14 ? <span className="wx-obs__phase">{Math.round(gap)}d gap</span> : null}</div>; })}
        </div>
      </section>
    </>
  );
}

export default function WetlandExperience({ preferLocalRun, initialCaseId }: { preferLocalRun: boolean; initialCaseId: string | null }) {
  const s = useWetlandStore();
  const router = useRouter();
  const { dataTier, drawer, setDrawer, returnToOverview, isLoadingData, dataError, satelliteBasemap, setSatelliteBasemap, pulseData, showcaseChecked, probeActive } = s;

  const [shareUrlInitialized, setShareUrlInitialized] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      await useWetlandStore.getState().initExperience(preferLocalRun, initialCaseId);
      if (!active) return;
      const params = new URLSearchParams(window.location.search);
      const latest = useWetlandStore.getState();
      const dateIndex = params.get("date");
      if (dateIndex != null && /^\d+$/.test(dateIndex)) latest.setSelectedDateIndex(Number(dateIndex));
      const filter = params.get("filter");
      if (["ALL", "OPEN_WATER", "VEGETATED_INUNDATION", "UNCERTAIN"].includes(filter || "")) latest.setVegFilter(filter as "ALL" | "OPEN_WATER" | "VEGETATED_INUNDATION" | "UNCERTAIN");
      const mode = params.get("mode");
      if (["MOTION", "RADAR", "DETECTION"].includes(mode || "")) latest.setViewMode(mode as ViewMode);
      // Threshold values in share links are informational; this client never re-runs the detector.
      const mapMode = params.get("mapMode");
      if (["BEFORE", "AFTER", "DIFFERENCE", "SPLIT"].includes(mapMode || "")) latest.setMapMode(mapMode as "BEFORE" | "AFTER" | "DIFFERENCE" | "SPLIT");
      // A shared URL represents a deliberate snapshot. Do not let the initial
      // showcase autoplay immediately move away from its selected date/region.
      if (params.has("date") || params.has("region") || params.has("mapMode") || params.has("mode") || params.has("filter")) {
        latest.setIsPlaying(false);
      }
      // Region restoration must wait until the URL's date/filter choices have been applied.
      // setSelectedDateIndex starts the corresponding asynchronous candidate load.
      setShareUrlInitialized(true);
    })();
    setSatelliteBasemap(true);
    return () => { active = false; };
  }, [preferLocalRun, initialCaseId, setSatelliteBasemap]);

  // Candidate geometries may arrive after the share URL's date has been selected.
  // Reapply the region once that date's real patch list is present.
  const patches = s.patches;
  const selectedPatchId = s.selectedPatch?.id;
  const selectedDateIndex = s.selectedDateIndex;
  const setSelectedPatch = s.setSelectedPatch;
  const pulseDates = pulseData?.dates;
  // Consume the URL's region request once it has been restored. Subsequent
  // user selections and drawer closes must not be overridden by the old URL.
  const regionRestoreHandled = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !shareUrlInitialized || isLoadingData || regionRestoreHandled.current) return;
    const region = new URLSearchParams(window.location.search).get("region");
    if (!region) return;
    const match = patches.find((patch) => patch.id === region && patch.date === pulseDates?.[selectedDateIndex]?.date);
    if (!match) return;
    regionRestoreHandled.current = true;
    if (selectedPatchId !== region) setSelectedPatch(match);
    setDrawer("EXPLORE");
  }, [patches, selectedPatchId, selectedDateIndex, pulseDates, isLoadingData, shareUrlInitialized, setSelectedPatch, setDrawer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement; if (/INPUT|SELECT|TEXTAREA/.test(t.tagName) || t.getAttribute("role") === "slider" || t.getAttribute("role") === "radio") return;
      const st = useWetlandStore.getState(); const n = st.pulseData?.dates.length ?? 0;
      if (e.key === " " && t.tagName !== "BUTTON") { e.preventDefault(); if (n) st.setIsPlaying(!st.isPlaying); }
      const avail = st.dataTier === "SHOWCASE" && st.showcase ? datesWithPatches(st.showcase) : null; const dates = st.pulseData?.dates ?? [];
      if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && n && t.tagName !== "BUTTON") { const to = nextAvailableIndex(dates, avail, st.selectedDateIndex, e.key === "ArrowRight" ? 1 : -1); if (to >= 0) { st.setIsPlaying(false); st.setSelectedDateIndex(to); } }
      if (e.key === "Escape") { if (st.drawer !== "NONE") st.setDrawer("NONE"); else st.returnToOverview(); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  const acquisitionsOnly = dataTier === "SHOWCASE" && !pulseData && !!s.showcase;
  const tabs = TABS.filter((t) => !acquisitionsOnly || t.id === "LEARN");
  const activeTab: PanelTab = acquisitionsOnly && drawer !== "NONE" ? "LEARN" : drawer;
  const title = pulseData ? caseTitle(pulseData.site) : s.showcase ? caseTitle(s.showcase.manifest.site_display_name ?? s.showcase.manifest.site_name) : "";
  const cur = pulseData?.dates[Math.min(s.selectedDateIndex, (pulseData?.dates.length ?? 1) - 1)];
  const booting = !showcaseChecked && !pulseData;
  const emptyState = showcaseChecked && dataTier === "EMPTY";

  return (
    <div className="wx-root wx-root--drawer-tabs" data-tier={dataTier} data-detective={probeActive ? "true" : "false"} data-drawer={activeTab !== "NONE" ? "open" : "closed"} data-map-mode={s.mapMode} data-selected-region-id={s.selectedPatch?.id ?? ""}>
      <Hatch />
      <header className="wx-mast">
        <span className="wx-case"><span className="wx-micro">Case</span>
          {dataTier === "SHOWCASE" && s.showcaseCases.length > 1 ? (
            <select className="wx-casepick" value={s.showcaseId} onChange={(e) => {
              if (e.target.value === "chokwe") router.push("/wetland/global?story=chokwe");
              else void s.switchShowcase(e.target.value);
            }} aria-label="Choose a real wetland investigation">
              {s.showcaseCases.map((c) => <option key={c.id} value={c.id}>{c.site_display_name.replace(/\s*mapped boundary$/i, "")}</option>)}
              <option value="chokwe">Chókwè · January 2026 event</option>
            </select>
          ) : <span className="wx-case__title">{title || (showcaseChecked ? "No real case loaded" : "Loading real observations…")}</span>}
          {cur ? <span className="wx-mono wx-case__date" title={`Observation date: ${cur.date}`}>{fmtDate(cur.date, { month: "short", day: "numeric" })}</span> : null}</span>
        <TierBadge tier={dataTier} completeness={s.showcase?.manifest.completeness} />
        <nav className="wx-nav" aria-label="Workspace controls">
          {/* Domain navigation lives in the single global primary nav. */}
          <button type="button" onClick={() => setSatelliteBasemap(!satelliteBasemap)} aria-pressed={satelliteBasemap} aria-label="Satellite basemap" title="Toggle the satellite basemap">{Icon.layers}<span>Basemap</span></button>
          <button type="button" onClick={returnToOverview} title="Clear selection, comparison and filters (Esc)">Return<span className="wx-nav__long"> to overview</span></button>
        </nav>
      </header>

      {emptyState ? (
        <main className="wx-empty-state" aria-labelledby="wx-empty-title">
          <p className="wx-micro">REAL DATA ONLY · NO FALLBACK SIMULATION</p>
          <h1 id="wx-empty-title">No real case is available to load.</h1>
          <p>The packaged NISAR showcase could not be opened, and no valid local run is loaded. GeoNexSAR will not invent regions, measurements, or dates to fill the map.</p>
          {dataError && <p className="wx-empty-state__error" role="alert">{dataError}</p>}
          <div className="wx-empty-state__actions">
            <button type="button" className="wx-btn wx-btn--primary" onClick={() => void s.loadShowcase()}>Retry featured case</button>
            <Link className="wx-btn" href="/wetland/global">Explore real NISAR coverage</Link>
            <Link className="wx-btn" href="/wetland/global#process">Analyse another location</Link>
          </div>
          <p className="wx-empty-state__foot">Satellite coverage is not a detection. Candidate results appear only when a compatible real-data run has completed and its outputs have loaded.</p>
        </main>
      ) : <>

      {acquisitionsOnly ? <AcquisitionsOnly /> : <ContextRail />}

      <main className="wx-map" aria-label="Map">
        <WetlandStage />
        {booting && <div className="wx-boot" role="status" aria-label="Loading observations"><div className="wx-boot__sweep" /><p className="wx-micro">Acquiring signal</p><p>NISAR L-band · Tanguar Haor</p></div>}
        {!acquisitionsOnly && <div className="wx-map-controls" aria-label="Map view and radar layers">
          <ModeSwitch />
          <MapModeSwitch />
          <RadarControls />
        </div>}
        {!acquisitionsOnly && <div className="wx-legend" aria-label="Map legend">
          <span><i className="lg lg--strong" />Rules agree</span><span><i className="lg lg--moderate" />Partly agree</span><span><i className="lg lg--uncertain" />Uncertain</span>
          <span><i className="lg lg--none" />No candidate (not &ldquo;unchanged&rdquo;)</span>
        </div>}
        {activeTab === "NONE" && <button type="button" className="wx-drawer-reopen" onClick={() => setDrawer(tabs[0]?.id ?? "EXPLORE")} aria-expanded={false} aria-controls="wetland-investigation-drawer">
          Open {tabs[0]?.label ?? "Explore"}
        </button>}
        {(isLoadingData || !showcaseChecked) && !booting && <div className="wx-toast" role="status">Loading observations…</div>}
        {dataError && <div className="wx-toast wx-toast--err" role="alert">{dataError}</div>}
      </main>

      {activeTab !== "NONE" && (
        <aside id="wetland-investigation-drawer" className="wx-drawer" aria-label={tabs.find((t) => t.id === activeTab)?.label ?? "Investigation"}>
          <div className="wx-drawer__bar wx-drawer__bar--tabs">
            <nav className={`wx-drawer__tabs${tabs.length === 1 ? " wx-drawer__tabs--single" : ""}`} role="tablist" aria-label="Wetland investigation sections">
              {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={activeTab === t.id} title={t.hint} onClick={() => setDrawer(t.id)}>{t.label}</button>)}
            </nav>
            <button onClick={() => { if (activeTab === "EXPLORE") s.setSelectedPatch(null); setDrawer("NONE"); }} aria-label="Close panel">{Icon.close}</button>
          </div>
          <div className="wx-drawer__body">
            {activeTab === "EXPLORE" && <ExplorePanel />}
            {activeTab === "CHECK" && <CheckPanel />}
            {activeTab === "LEARN" && <LearnPanel />}
          </div>
        </aside>
      )}

      {!acquisitionsOnly && <TimeMachine />}
      </>}
    </div>
  );
}

"use client";

/* GeoNexSAR landing: a 3D mission briefing. The globe is the hero —
   drag it, drop a pin anywhere on Earth, open the real Tanguar case. */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PHENOMENA } from "@/phenomena/registry";
import type { GlobeCaseMarker, GlobeHazard, GlobePin } from "@/components/landing/Globe3D";
import { listGlobeStudies } from "@/lib/globe-studies";
import type { WetlandPulseData } from "@/lib/types";
import "./landing.css";

function isGlobeHazard(id: (typeof PHENOMENA)[number]["id"]): id is GlobeHazard {
  return id === "wetland" || id === "forest" || id === "volcano";
}

// Agriculture has its own SME2 workspace, but no globe case-marker layer.
const GLOBE_PHENOMENA = PHENOMENA.filter(
  (phenomenon): phenomenon is (typeof PHENOMENA)[number] & { id: GlobeHazard } => isGlobeHazard(phenomenon.id),
);

const Globe3D = dynamic(() => import("@/components/landing/Globe3D"), {
  ssr: false,
  loading: () => <div className="globe-loading" aria-label="Loading 3D globe"><span className="radar-sweep" /></div>,
});

/* — Scroll reveal — */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); } }),
      { threshold: 0.18 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useReveal<HTMLDivElement>();
  return <div ref={ref} className={`rv ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

/* — Animated counter — */
function CountUp({ to, decimals = 0, suffix = "" }: { to: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [val, setVal] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0; let started = false;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting || started) return;
      started = true;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setVal(to);
        io.disconnect();
        return;
      }
      const t0 = performance.now(); const dur = 1400;
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        setVal(to * e);
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      io.disconnect();
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to]);
  return <span ref={ref}>{val.toFixed(decimals)}{suffix}</span>;
}

/* — 3D tilt card — */
function Tilt({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref} className={`tilt ${className}`}
      onMouseMove={(e) => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const el = ref.current; if (!el) return;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `perspective(900px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg) translateY(-4px)`;
      }}
      onMouseLeave={() => { if (ref.current) ref.current.style.transform = ""; }}
    >{children}</div>
  );
}

/* — Mini hydrograph: the shape of the real monsoon pulse.
   Values come from the exported showcase pulse (public/showcase/featured/pulse.json),
   never from hardcoded numbers. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
function Hydrograph() {
  const [pulse, setPulse] = useState<WetlandPulseData | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/showcase/featured/pulse.json", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`pulse.json: ${r.status}`); return r.json(); })
      .then((data: WetlandPulseData) => {
        if (!live) return;
        if (!Array.isArray(data.dates) || !data.dates.length) throw new Error("pulse.json has no dates");
        setPulse(data);
        const peakIdx = Math.max(0, data.dates.findIndex((d) => d.date === data.peak?.date));
        setActive(peakIdx);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  const entries = pulse?.dates ?? [];
  useEffect(() => {
    if (!playing || !entries.length) return;
    const id = setInterval(() => setActive((a) => (a + 1) % entries.length), 700);
    return () => clearInterval(id);
  }, [playing, entries.length]);
  if (failed || (pulse && !entries.length)) {
    return (
      <div className="hydro">
        <p className="hydro-note">The showcase pulse could not be loaded, so no chart is shown rather than invented values.</p>
      </div>
    );
  }
  if (!pulse) {
    return (
      <div className="hydro" aria-label="Loading showcase pulse">
        <div className="hydro-bars" aria-hidden="true" />
        <p className="hydro-note">Loading the real Tanguar Haor pulse…</p>
      </div>
    );
  }
  const max = Math.max(...entries.map((d) => d.area_km2));
  const peakIdx = Math.max(0, entries.findIndex((d) => d.date === pulse.peak?.date));
  const cur = entries[Math.min(active, entries.length - 1)];
  return (
    <div className="hydro">
      <div className="hydro-bars" role="img" aria-label={`Radar-derived radar-change candidate area across ${entries.length} 2026 observations of Tanguar Haor, peaking ${shortDate(entries[peakIdx].date)}`}>
        {entries.map((d, i) => (
          <button key={d.date} type="button" className={`hydro-bar${i === active ? " is-active" : ""}${i === peakIdx ? " is-peak" : ""}`}
            style={{ height: `${(d.area_km2 / max) * 100}%` }}
            onClick={() => { setActive(i); setPlaying(false); }}
            aria-label={`${shortDate(d.date)}: ${d.area_km2.toFixed(1)} square kilometres`}>
            <span className="hydro-val">{d.area_km2.toFixed(1)}</span>
          </button>
        ))}
      </div>
      <div className="hydro-meta">
        <div><strong>{shortDate(cur.date)} 2026</strong><span>radar-change candidate area</span></div>
        <div className="hydro-num"><CountUp to={cur.area_km2} decimals={1} /><em> km²</em></div>
        <button type="button" className="g3-btn g3-btn--ghost" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause the pulse" : "Play the pulse"}</button>
      </div>
      <p className="hydro-note">Real NISAR-derived values from the Tanguar Haor showcase. A candidate region is not a confirmed flood — <Link href="/wetland">challenge it</Link>.</p>
    </div>
  );
}

const PRESET_PINS: Array<{ name: string; blurb: string; lat: number; lng: number }> = [
  { name: "Amazon floodplain", blurb: "The largest wetland system on Earth.", lat: -2.6, lng: -62.1 },
  { name: "Mekong Delta", blurb: "Nine dragons, one restless delta.", lat: 10.2, lng: 105.4 },
  { name: "Okavango Delta", blurb: "A river that never reaches the sea.", lat: -19.3, lng: 23.1 },
];

function centerOfStudyLocations(markers: GlobeCaseMarker[]): GlobePin | null {
  if (!markers.length) return null;
  const latitudes = markers.map((marker) => marker.lat);
  const longitudes = markers.map((marker) => marker.lng);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  if (maxLng - minLng <= 180) {
    // Frame the whole cluster between the left-side headline and right-side
    // controls. A small westward bias keeps the westernmost case in view.
    return { lat: (minLat + maxLat) / 2, lng: minLng + (maxLng - minLng) * 0.2 };
  }

  const sum = markers.reduce((total, marker) => {
    const lat = (marker.lat * Math.PI) / 180;
    const lng = (marker.lng * Math.PI) / 180;
    const cosLat = Math.cos(lat);
    return {
      x: total.x + cosLat * Math.cos(lng),
      y: total.y + Math.sin(lat),
      z: total.z + cosLat * Math.sin(lng),
    };
  }, { x: 0, y: 0, z: 0 });
  const horizontal = Math.hypot(sum.x, sum.z);
  if (horizontal < 1e-8 && Math.abs(sum.y) < 1e-8) return { lat: markers[0].lat, lng: markers[0].lng };
  return {
    lat: (Math.atan2(sum.y, horizontal) * 180) / Math.PI,
    lng: (Math.atan2(sum.z, sum.x) * 180) / Math.PI,
  };
}

export default function Home() {
  const router = useRouter();
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState<GlobePin | null>(null);
  const [pinLatitude, setPinLatitude] = useState("");
  const [pinLongitude, setPinLongitude] = useState("");
  const [pinError, setPinError] = useState("");
  const [hover, setHover] = useState<GlobePin | null>(null);
  const [caseMarkers, setCaseMarkers] = useState<GlobeCaseMarker[]>([]);
  const [selectedHazard, setSelectedHazard] = useState<GlobeHazard>("wetland");
  const [focusedCaseId, setFocusedCaseId] = useState<string | null>(null);
  const [caseMarkersLoaded, setCaseMarkersLoaded] = useState(false);
  const [observationCount, setObservationCount] = useState<number | null>(null);
  const [peakCandidateArea, setPeakCandidateArea] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void listGlobeStudies().then((studies) => {
      if (live) setCaseMarkers(studies);
    }).finally(() => {
      if (live) setCaseMarkersLoaded(true);
    });
    fetch("/showcase/featured/pulse.json", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("Featured pulse unavailable"); return response.json(); })
      .then((pulse: WetlandPulseData) => {
        const peak = pulse.dates?.find((point) => point.date === pulse.peak?.date);
        if (live && Array.isArray(pulse.dates) && pulse.dates.length) setObservationCount(pulse.dates.length);
        if (live && peak && Number.isFinite(peak.area_km2)) setPeakCandidateArea(peak.area_km2);
      })
      .catch(() => { if (live) setPeakCandidateArea(null); });
    return () => { live = false; };
  }, []);

  function submitPinCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const latitudeText = pinLatitude.trim();
    const longitudeText = pinLongitude.trim();
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (
      !latitudeText || !longitudeText ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    ) {
      setPinError("Enter a latitude from −90 to 90 and a longitude from −180 to 180.");
      return;
    }
    setPin({ lat: latitude, lng: longitude });
    setPinError("");
  }

  const selectedCaseMarkers = caseMarkers.filter((marker) => marker.hazard === selectedHazard);
  const focusedCase = selectedCaseMarkers.find((marker) => marker.id === focusedCaseId);
  const focusLocation = focusedCase ?? centerOfStudyLocations(selectedCaseMarkers);

  const fmt = (p: GlobePin | null) => p
    ? `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? "N" : "S"} ${Math.abs(p.lng).toFixed(2)}°${p.lng >= 0 ? "E" : "W"}`
    : "— —";

  return (
    <main className="g3">
      {/* ══════════ HERO ══════════ */}
      <section className="g3-hero" aria-label="Interactive globe">
        <Globe3D
          pinMode={pinMode}
          pin={pin}
          caseMarkers={selectedCaseMarkers}
          focusLocation={focusLocation}
          onPin={(lat, lng) => {
            setPin({ lat, lng });
            setPinLatitude(lat.toFixed(5));
            setPinLongitude(lng.toFixed(5));
            setPinError("");
          }}
          onCaseClick={(id) => {
            const selected = selectedCaseMarkers.find((marker) => marker.id === id);
            if (selected) router.push(selected.href);
          }}
          onHoverCoord={(lat, lng) => setHover(lat == null || lng == null ? null : { lat, lng })}
        />

        <header className="g3-top">
          <span className="g3-brand"><em>GeoNexSAR</em> · mission control</span>
          <nav aria-label="Primary">
            <Link href="/wetland">Wetlands</Link>
            <Link href="/forest/rondonia">Forests</Link>
            <Link href="/volcano/hayli-gubbi">Volcanoes</Link>
            <Link href="/agriculture">Agriculture</Link>
            <Link href="/wetland/global">NISAR worldwide</Link>
          </nav>
          <details className="g3-mobile-nav">
            <summary>Explore <span aria-hidden="true">⌄</span></summary>
            <nav aria-label="Mobile primary">
              <Link href="/wetland">Wetlands</Link>
              <Link href="/forest/rondonia">Forests</Link>
              <Link href="/volcano/hayli-gubbi">Volcanoes</Link>
              <Link href="/agriculture">Agriculture</Link>
              <Link href="/wetland/global">NISAR worldwide</Link>
            </nav>
          </details>
        </header>

        <section className="g3-map-filter" aria-label="Choose the study type shown on the globe">
          <p className="g3-map-filter__eyebrow">Globe focus · published studies</p>
          <div className="g3-map-filter__choices" role="group" aria-label="Filter study locations by topic">
            {GLOBE_PHENOMENA.map((phenomenon) => {
              const count = caseMarkers.filter((marker) => marker.hazard === phenomenon.id).length;
              return (
                <button
                  key={phenomenon.id}
                  type="button"
                  className={`g3-map-filter__choice${selectedHazard === phenomenon.id ? " is-active" : ""}`}
                  data-hazard={phenomenon.id}
                  aria-pressed={selectedHazard === phenomenon.id}
                  onClick={() => { setSelectedHazard(phenomenon.id); setFocusedCaseId(null); }}
                >
                  <span>{phenomenon.name}</span>
                  <strong>{caseMarkersLoaded ? count : "…"}</strong>
                </button>
              );
            })}
          </div>
          <p className="g3-map-filter__status" role="status">
            {!caseMarkersLoaded
              ? "Loading published study locations…"
              : selectedCaseMarkers.length
                ? `${selectedCaseMarkers.length} ${selectedHazard} study ${selectedCaseMarkers.length === 1 ? "location" : "locations"} · click a marker to open the case`
                : `No published ${selectedHazard} study location is available.`}
          </p>
          {caseMarkersLoaded && selectedCaseMarkers.length > 0 && (
            <details className="g3-map-filter__locations">
              <summary>View all {selectedCaseMarkers.length} study locations</summary>
              <div className="g3-map-filter__location-list">
                {selectedCaseMarkers.map((marker) => (
                  <button
                    key={marker.id}
                    type="button"
                    className="g3-map-filter__location"
                    aria-pressed={focusedCaseId === marker.id}
                    onClick={() => setFocusedCaseId((current) => current === marker.id ? null : marker.id)}
                  >
                    <span>{marker.label}</span>
                    <small>{focusedCaseId === marker.id ? "Reset view" : "Center globe"}</small>
                  </button>
                ))}
              </div>
            </details>
          )}
          <p className="g3-map-filter__note">Use the location list to center a case. Rotate the globe by dragging or with the arrow keys. Markers show study sites, not detections.</p>
        </section>

        <div className="g3-title">
          <p className="g3-eyebrow">NISAR · L-band radar · surface-change candidates</p>
          <h1>Watch Earth<br /><span>breathe.</span></h1>
          <p className="g3-lede">NISAR is a NASA–ISRO radar satellite that watches Earth&rsquo;s surface breathe — through cloud, through darkness. Spin the planet. Open a case measured for real, or drop a pin to check NISAR observation coverage and start a real study.</p>
          <div className="g3-ctas">
            <Link href="/wetland/global?story=chokwe" className="g3-btn g3-btn--primary">Inspect the Chókwè event case</Link>
            <Link href="/wetland" className="g3-btn g3-btn--ghost">Open the Tanguar Haor case</Link>
            <Link href="/wetland?case=hakaluki" className="g3-btn g3-btn--ghost">Open the Hakaluki Haor case</Link>
            <button
              type="button"
              className={`g3-btn${pinMode ? " g3-btn--armed" : ""}`}
              aria-pressed={pinMode}
              onClick={() => {
                const nextMode = !pinMode;
                setPinMode(nextMode);
                setPin(null);
                setPinError("");
                if (!nextMode) {
                  setPinLatitude("");
                  setPinLongitude("");
                }
              }}
            >
              {pinMode ? "Cancel pin mode" : "Drop a pin anywhere"}
            </button>
            <Link href="#g3-phen" className="g3-btn g3-btn--ghost g3-btn--features">Explore all study features ↓</Link>
          </div>
        </div>

        {pinMode && (
          <div className="g3-pinbar">
            <span className="g3-pinbar-dot" aria-hidden="true" />
            <p><strong>Choose a study location.</strong> Select a point on the globe, or enter coordinates below. The pin is a proposed search area—not a detection.</p>
            <form className="g3-pinbar__form" onSubmit={submitPinCoordinates}>
              <label>
                Latitude
                <input
                  type="number"
                  name="latitude"
                  min="-90"
                  max="90"
                  step="any"
                  required
                  value={pinLatitude}
                  onChange={(event) => { setPinLatitude(event.target.value); setPinError(""); }}
                  aria-invalid={Boolean(pinError)}
                  aria-describedby={pinError ? "g3-pin-error" : undefined}
                  placeholder="e.g. 23.8103"
                />
              </label>
              <label>
                Longitude
                <input
                  type="number"
                  name="longitude"
                  min="-180"
                  max="180"
                  step="any"
                  required
                  value={pinLongitude}
                  onChange={(event) => { setPinLongitude(event.target.value); setPinError(""); }}
                  aria-invalid={Boolean(pinError)}
                  aria-describedby={pinError ? "g3-pin-error" : undefined}
                  placeholder="e.g. 90.4125"
                />
              </label>
              <button type="submit" className="g3-btn g3-btn--primary g3-btn--sm">Use coordinates</button>
              {pinError && <span id="g3-pin-error" className="g3-pinbar__error" role="alert">{pinError}</span>}
            </form>
            {pin && <Link className="g3-btn g3-btn--primary g3-btn--sm" href={`/wetland/global?latitude=${pin.lat.toFixed(5)}&longitude=${pin.lng.toFixed(5)}&analyze=1&site=${encodeURIComponent("Pinned study area")}`}>Check real observations at {fmt(pin)} →</Link>}
          </div>
        )}

        <div className="g3-coord" aria-hidden="true"><span>CURSOR</span><strong>{fmt(hover)}</strong></div>

        <div className="g3-ticker" aria-label="Mission telemetry">
          <div><strong>{observationCount == null ? "—" : <CountUp to={observationCount} />}</strong><span>featured-case comparison dates</span></div>
          <div><strong>{peakCandidateArea == null ? "—" : <CountUp to={peakCandidateArea} decimals={1} />}</strong><span>km² peak radar-change candidate area</span></div>
          <div><strong>HH·HV</strong><span>dual polarization</span></div>
          <div><strong>{caseMarkersLoaded ? <CountUp to={selectedCaseMarkers.length} /> : "—"}</strong><span>published {selectedHazard} locations</span></div>
          <div className="g3-scrollcue"><span />scroll</div>
        </div>
      </section>

      {/* ══════════ CHAPTERS ══════════ */}
      <section className="g3-chapters" aria-label="How it works">
        <Reveal className="g3-chapter">
          <p className="g3-eyebrow">01 · The satellite</p>
          <h2>A radar that never blinks.</h2>
          <p>NISAR sweeps the planet with L-band and S-band synthetic aperture radar. Clouds mean nothing to it; night means nothing to it. Every 12 days it re-draws the map of Earth&rsquo;s surface — and we turn those echoes into moving water you can watch.</p>
          <div className="g3-facts">
            <div><strong><CountUp to={12} /></strong><span>day revisit</span></div>
            <div><strong>L+S</strong><span>radar bands</span></div>
            <div><strong><CountUp to={242} /></strong><span>km swath</span></div>
          </div>
        </Reveal>

        <Reveal className="g3-chapter">
          <p className="g3-eyebrow">02 · The signal</p>
          <h2>Water has a fingerprint.</h2>
          <p>Radar returns can change as surface conditions change, but a change signal alone does not establish flooding. This chart shows the radar-derived candidate-area series for the featured Tanguar Haor observations in 2026. Press play to inspect each date.</p>
          <Hydrograph />
        </Reveal>

        <Reveal className="g3-chapter">
          <p className="g3-eyebrow">03 · The evidence</p>
          <h2>A candidate is not a confirmed flood.</h2>
          <p>Every glowing region on our map passed a rule — and every rule can be wrong. So the case file is built for doubt: change the cutoff and watch regions vanish, cross-check against an independent optical satellite, read exactly what was measured versus calculated.</p>
          <div className="g3-cards3">
            <div><strong>Observed</strong><p>What the radar actually recorded.</p></div>
            <div><strong>Derived</strong><p>What our rules calculated from it.</p></div>
            <div><strong>Uncertain</strong><p>What nobody can claim — stated plainly.</p></div>
          </div>
          <Link href="/wetland" className="g3-btn g3-btn--primary">Interrogate the case →</Link>
        </Reveal>
      </section>

      {/* ══════════ ANYWHERE ══════════ */}
      <section className="g3-anywhere" aria-labelledby="g3-anywhere-t">
        <Reveal>
          <p className="g3-eyebrow">Anywhere on Earth</p>
          <h2 id="g3-anywhere-t">One planet. Infinite wetlands.</h2>
          <p className="g3-lede2">The published Wetlands collection includes seven-date NISAR PROVISIONAL series for Tanguar Haor and Hakaluki Haor, plus a separate January 2026 two-scene BETA event study for Chókwè. These are different releases and are not combined into one timeline. Choose another location to inspect real NISAR coverage; a map pin is a proposed study area, not a detection or a claim that data exist there.</p>
        </Reveal>
        <div className="g3-presets">
          {PRESET_PINS.map((p, i) => (
            <Reveal key={p.name} delay={i * 90}>
              <Tilt className="g3-preset">
                <p className="g3-eyebrow">{fmt(p).replace(" ", " · ")}</p>
                <h3>{p.name}</h3>
                <p>{p.blurb}</p>
                <Link href={`/wetland/global?latitude=${p.lat}&longitude=${p.lng}&analyze=1&site=${encodeURIComponent(p.name)}`}>Check real NISAR coverage →</Link>
              </Tilt>
            </Reveal>
          ))}
        </div>
        <Reveal><p className="g3-fine">Only observed acquisitions and processed real-data results are shown. A location without valid processed outputs has no detection overlay.</p></Reveal>
      </section>

      {/* ══════════ PHENOMENA ══════════ */}
      <section id="g3-phen" className="g3-phen" aria-labelledby="g3-phen-t">
        <Reveal>
          <p className="g3-eyebrow">Earth Change · phenomena</p>
          <h2 id="g3-phen-t">Choose a study. Explore the evidence.</h2>
          <p className="g3-phen-intro">Each module keeps its map, study tools, and evidence together. Browse global observation context or open the featured case.</p>
        </Reveal>
        <div className="g3-phen-grid">
          {PHENOMENA.map((p, i) => (
            <Reveal key={p.id} delay={i * 90}>
              <Tilt className={`g3-phen-card${p.status === "AVAILABLE" ? " is-live" : ""}`}>
                <p className="g3-eyebrow">{p.status === "AVAILABLE" ? "Workspace available" : "In development"}</p>
                <h3>{p.name}</h3>
                <p className="g3-tagline">{p.tagline}</p>
                <ul className="g3-phen-features" aria-label={`${p.name} features`}>
                  {p.featureHighlights.map((feature) => <li key={feature}>{feature}</li>)}
                </ul>
                <p className="g3-phen-evidence">
                  <strong>Current evidence state</strong>
                  {p.evidenceSummary}
                </p>
                <div className="g3-phen-actions">
                  <Link className="g3-btn g3-btn--primary g3-btn--sm" href={p.caseHref}>{p.caseLabel} →</Link>
                  {p.href && <Link className="g3-phen-browse" href={p.href}>Browse global map</Link>}
                </div>
              </Tilt>
            </Reveal>
          ))}
        </div>
      </section>

      <footer className="g3-foot">
        <p><strong>GeoNexSAR</strong></p>
        <p>GeoNexSAR shows observed data and derived results with provenance. A radar-change candidate is never presented as a confirmed flood.</p>
        <nav aria-label="Footer"><Link href="/wetland">Wetlands</Link><Link href="/forest/rondonia">Forests</Link><Link href="/volcano/hayli-gubbi">Volcanoes</Link><Link href="/agriculture">Agriculture</Link><Link href="/wetland/global">NISAR worldwide</Link></nav>
      </footer>
    </main>
  );
}

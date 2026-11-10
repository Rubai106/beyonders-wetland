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
        raf = requestAnimationFrame(() => setVal(to));
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
  const hydroRef = useRef<HTMLDivElement | null>(null);
  // Auto-play the pulse while the chart is on screen (paused otherwise), so
  // every value cycles into view — previously only the peak value ever showed
  // because playback started paused. Reduced-motion users keep the peak value.
  useEffect(() => {
    const el = hydroRef.current;
    if (!el || !pulse) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setPlaying(entry.isIntersecting);
    }, { threshold: 0.4 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pulse]);
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
    const id = setInterval(() => setActive((a) => (a + 1) % entries.length), 1400);
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
    <div className="hydro" ref={hydroRef}>
      <div className="hydro-bars" role="group" aria-label={`Choose one of ${entries.length} Tanguar Haor radar-change candidate observations; peak on ${shortDate(entries[peakIdx].date)}`}>
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
        <div className="hydro-num"><span data-testid="hydro-current-value">{cur.area_km2.toFixed(1)}</span><em> km²</em></div>
        <button type="button" className="g3-btn g3-btn--ghost" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause the pulse" : "Play the pulse"}</button>
      </div>
      <p className="hydro-note">Real NISAR-derived values from the Tanguar Haor showcase. A candidate region is not a confirmed flood — <Link href="/wetland">challenge it</Link>.</p>
    </div>
  );
}

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

        {/* Primary navigation lives in the shared HazardNavigation bar above
            the hero — this page no longer carries its own second nav. */}

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
          <Link href="/agriculture" className="g3-map-filter__agriculture-link">Agriculture has its own soil-moisture workspace →</Link>
        </section>

        <div className="g3-title">
          <p className="g3-eyebrow">BEYONDERS · EARTH OBSERVATION INVESTIGATIONS</p>
          <h1>Earth change,<br /><span>under scrutiny.</span></h1>
          <p className="g3-lede">Explore real NISAR observations across wetlands, forests, volcanoes and soil moisture. Inspect what the satellite recorded, challenge candidate changes, and trace every claim to its source.</p>
          <div className="g3-ctas">
            <Link href="/wetland/global" className="g3-btn g3-btn--primary">Explore observations</Link>
            <Link href="/investigations" className="g3-btn g3-btn--ghost">Published investigations</Link>
            {!pinMode && (
              <button
                type="button"
                className="g3-btn"
                onClick={() => {
                  setPinMode(true);
                  setPin(null);
                  setPinError("");
                  setPinLatitude("");
                  setPinLongitude("");
                }}
              >
                Drop a pin anywhere
              </button>
            )}
          </div>
          <p className="g3-featured-case">
            START WITH A REAL CASE · <Link href="/wetland/global?story=chokwe">Chókwè, Mozambique — inspect the evidence</Link>
          </p>
        </div>

        {pinMode && (
          <div className="g3-pinbar">
            <span className="g3-pinbar-dot" aria-hidden="true" />
            <p><strong>Choose a study location.</strong> Select a point on the globe, or enter coordinates below. The pin is a proposed search area—not a detection.</p>
            <button
              type="button"
              className="g3-btn g3-btn--ghost g3-btn--sm"
              onClick={() => {
                setPinMode(false);
                setPin(null);
                setPinError("");
                setPinLatitude("");
                setPinLongitude("");
              }}
            >Cancel location selection</button>
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

        <div className="g3-ticker" aria-label="Tanguar Haor observation summary">
          <div><strong>{observationCount == null ? "—" : <CountUp to={observationCount} />}</strong><span>Tanguar comparison dates</span></div>
          <div><strong>{peakCandidateArea == null ? "—" : <CountUp to={peakCandidateArea} decimals={1} />}</strong><span>km² peak radar-change candidate area</span></div>
          <div className="g3-scrollcue"><span />Explore the evidence</div>
        </div>
      </section>

      {/* One real temporal example, followed by the four actual workspaces. */}
      <section className="g3-featured" aria-labelledby="g3-featured-title">
        <Reveal className="g3-featured__copy g3-chapter">
          <p className="g3-eyebrow">A REAL RADAR SERIES · BANGLADESH</p>
          <h2 id="g3-featured-title">Follow one signal through time.</h2>
          <p>
            Tanguar Haor has a seven-date NISAR L2 GCOV comparison series. Explore how the
            radar-change candidate area varies between observations, then open the case to inspect
            the map, thresholds, optical coverage and limitations.
          </p>
          <Link href="/wetland" className="g3-btn g3-btn--primary">Open the Tanguar investigation</Link>
          <p className="g3-featured__caveat">Candidate area is a screening measurement, not a confirmed flood extent.</p>
        </Reveal>
        <div className="g3-featured__chart" aria-label="Tanguar Haor radar candidate-area time series">
          <Hydrograph />
        </div>
      </section>

      <section id="g3-domains" className="g3-domains" aria-labelledby="g3-domains-title">
        <div className="g3-domains__heading">
          <div>
            <p className="g3-eyebrow">FOUR SCIENTIFIC WORKSPACES</p>
            <h2 id="g3-domains-title">Different signals. One evidence-first approach.</h2>
          </div>
          <Link href="/investigations" className="g3-domains__all">All published investigations →</Link>
        </div>
        <div className="g3-domain-grid">
          {PHENOMENA.map((p, i) => (
            <Reveal key={p.id} delay={i * 60}>
              <article className="g3-domain-card" data-domain={p.id}>
                <p className="g3-domain-card__eyebrow">0{i + 1} · {p.name.toUpperCase()}</p>
                <h3>{p.tagline}</h3>
                <p className="g3-domain-card__evidence">{p.evidenceSummary}</p>
                <div className="g3-domain-card__actions">
                  <Link href={p.caseHref}>{p.caseLabel} ↗</Link>
                  {p.href && p.href !== p.caseHref && <Link href={p.href} className="g3-domain-card__secondary">Global coverage</Link>}
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <footer className="g3-foot">
        <p><strong>GeoNexSAR · built by BEYONDERS</strong></p>
        <p>Observed data, derived measurements and uncertainty remain distinct. Every candidate is open to challenge.</p>
        <nav aria-label="Footer">
          <Link href="/wetland">Wetlands</Link><Link href="/forest/rondonia">Forests</Link>
          <Link href="/volcano/hayli-gubbi">Volcanoes</Link><Link href="/agriculture">Agriculture</Link>
          <Link href="/investigations">Investigations</Link><Link href="/lineage">Evidence lineage</Link>
        </nav>
      </footer>
    </main>
  );
}

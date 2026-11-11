"use client";

/* GEONEXSER landing: a 3D mission briefing focused on inspectable NISAR evidence. */

/* GEONEXSER landing: a 3D mission briefing. The globe is the hero —
   drag it, drop a pin anywhere on Earth, open the real Tanguar case. */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PHENOMENA } from "@/phenomena/registry";
import type { GlobeCaseMarker, GlobeHazard, GlobePin } from "@/components/landing/Globe3D";
import { listGlobeStudies } from "@/lib/globe-studies";
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
  useEffect(() => {
    let live = true;
    void listGlobeStudies().then((studies) => {
      if (live) setCaseMarkers(studies);
    }).finally(() => {
      if (live) setCaseMarkersLoaded(true);
    });
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
          <p className="g3-map-filter__note">Markers show published study locations, not global detections.</p>
          <Link href="/agriculture" className="g3-map-filter__agriculture-link">Agriculture has its own soil-moisture workspace →</Link>
        </section>

        <div className="g3-title">
          <p className="g3-eyebrow">NISAR EARTH-OBSERVATION INVESTIGATIONS</p>
          <h1>See what radar sees.<br /><span>Challenge what it means.</span></h1>
          <p className="g3-lede">GEONEXSER turns NASA–ISRO NISAR observations into inspectable Earth-change investigations. Follow the signal, test competing explanations, and see exactly where the evidence stops.</p>
          <div className="g3-ctas">
            <Link href="/wetland/global?story=chokwe" className="g3-btn g3-btn--primary">Open the Chókwè investigation <span aria-hidden="true">↗</span></Link>
            <Link href="/wetland/global" className="g3-btn g3-btn--ghost">Explore NISAR coverage</Link>
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
            FEATURED CASE · CHÓKWÈ, MOZAMBIQUE · NISAR L2 GCOV BETA · 5–17 JAN 2026
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

      </section>

      <section className="g3-case-spotlight" aria-labelledby="g3-case-title">
        <div className="g3-case-spotlight__intro">
          <p className="g3-eyebrow">FEATURED INVESTIGATION <span aria-hidden="true">/</span> MOZAMBIQUE</p>
          <div className="g3-case-spotlight__status"><span aria-hidden="true" /> EXPLORATORY · CANDIDATES UNVERIFIED</div>
          <h2 id="g3-case-title">A flood event, examined from more than one orbit.</h2>
          <p>In Chókwè, GEONEXSER compares a real NISAR before/after pair with independent satellite evidence. The goal is not to force a verdict — it is to show what aligns, what disagrees, and what remains unknown.</p>
          <div className="g3-case-spotlight__meta">5 → 17 JAN 2026 <span>·</span> L2 GCOV BETA <span>·</span> 112.14 KM² STUDY AREA</div>
          <Link href="/wetland/global?story=chokwe" className="g3-btn g3-btn--primary">Explore the evidence <span aria-hidden="true">↗</span></Link>
        </div>
        <div className="g3-case-spotlight__evidence">
          <div className="g3-case-spotlight__metrics" aria-label="Chókwè investigation measurements">
            <article className="g3-case-spotlight__metric">
              <strong>127</strong>
              <span>radar-darkening candidate regions</span>
            </article>
            <article className="g3-case-spotlight__metric">
              <strong>29.87 <small>km²</small></strong>
              <span>candidate area inside the analyst-defined study box</span>
            </article>
            <article className="g3-case-spotlight__metric g3-case-spotlight__metric--support">
              <strong>39.4<small>%</small></strong>
              <span>eligible OPEN_WATER pixels with positive GFM support</span>
            </article>
          </div>
          <div className="g3-case-spotlight__limit">
            <span className="g3-case-spotlight__limit-mark" aria-hidden="true">!</span>
            <p><strong>Evidence boundary.</strong> The HLS comparison had only 1.26% common-clear coverage and assessed none of the candidate area. The 39.4% figure is positive-only agreement between satellite algorithms — <strong>not accuracy or field validation.</strong></p>
          </div>
        </div>
      </section>

      <section id="g3-domains" className="g3-domains" aria-labelledby="g3-domains-title">
        <div className="g3-domains__heading">
          <div>
            <p className="g3-eyebrow">FOUR MEASUREMENT WORKSPACES</p>
            <h2 id="g3-domains-title">Different radar products. One evidence-first approach.</h2>
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
        <p><strong>GEONEXSER</strong></p>
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

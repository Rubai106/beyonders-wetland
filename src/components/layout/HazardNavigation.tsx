"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// Keep the global navigation intentionally small. Four distinct measurement
// workspaces remain available, while supporting analysis tools stay grouped.
const DOMAINS = [
  { id: "wetland", label: "Wetlands", href: "/wetland", match: (p: string) => p.startsWith("/wetland") },
  { id: "forest", label: "Forests", href: "/forest/rondonia", match: (p: string) => p.startsWith("/forest") },
  { id: "volcano", label: "Volcanoes", href: "/volcano/hayli-gubbi", match: (p: string) => p.startsWith("/volcano") },
  { id: "agriculture", label: "Agriculture", href: "/agriculture", match: (p: string) => p.startsWith("/agriculture") },
];

const MORE_LINKS = [
  { href: "/investigations", label: "Case studies" },
  { href: "/observability", label: "Evidence status" },
  { href: "/lineage", label: "Provenance" },
  { href: "/compare", label: "Compare studies" },
  { href: "/hypotheses", label: "Alternative explanations" },
  { href: "/temporal", label: "Timelines" },
  { href: "/operator-guide", label: "How it works" },
];

function closeDetails(el: HTMLDetailsElement | null) {
  if (el) el.open = false;
}

export default function HazardNavigation() {
  const pathname = usePathname();
  const moreRef = useRef<HTMLDetailsElement>(null);
  const mobileRef = useRef<HTMLDetailsElement>(null);
  const moreActive = MORE_LINKS.some((l) => pathname === l.href);

  // Client-side navigation does not remount the layout, so an open <details>
  // menu would otherwise stay open after one of its links is followed.
  useEffect(() => {
    closeDetails(moreRef.current);
    closeDetails(mobileRef.current);
  }, [pathname]);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      for (const ref of [moreRef, mobileRef]) {
        const el = ref.current;
        if (el && el.open && target && !el.contains(target)) el.open = false;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeDetails(moreRef.current);
      closeDetails(mobileRef.current);
    };
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <nav className="hazard-nav" aria-label="Primary">
      <Link className="hazard-nav__brand" href="/" aria-label="GEONEXSER home">
        GEONEXSER
      </Link>
      <div className="hazard-nav__links">
        {DOMAINS.map((d) => (
          <Link key={d.id} href={d.href} aria-current={d.match(pathname) ? "page" : undefined}>
            {d.label}
          </Link>
        ))}
        <details
          ref={moreRef}
          className="hazard-nav__more"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) closeDetails(moreRef.current);
          }}
        >
          <summary aria-current={moreActive ? "page" : undefined}>More</summary>
          <div className="hazard-nav__more-panel">
            {MORE_LINKS.map((l) => (
              <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
                {l.label}
              </Link>
            ))}
          </div>
        </details>
      </div>
      <details
        ref={mobileRef}
        className="hazard-nav__mobile g3-mobile-nav"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) closeDetails(mobileRef.current);
        }}
      >
        <summary>Explore <span aria-hidden="true">⌄</span></summary>
        <nav aria-label="Compact navigation">
          {DOMAINS.map((d) => <Link key={d.id} href={d.href}>{d.label}</Link>)}
          {MORE_LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        </nav>
      </details>
    </nav>
  );
}

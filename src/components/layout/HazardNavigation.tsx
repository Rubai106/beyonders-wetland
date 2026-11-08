"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* Single primary navigation for the whole platform (brief §3.1): five
   destinations at most. The four scientific domains ARE the primary
   destinations — they stay visible and one tap away on every page, with one
   destination per label (the same hrefs the workspace mastheads use).
   Everything else — the investigation directory, evidence, method, and the
   four advanced analysis tools — lives under More, so it stops competing
   with the primary routes. Deep links to every tool keep working. */
const DOMAINS = [
  { id: "wetland", label: "Wetlands", href: "/wetland", match: (p: string) => p.startsWith("/wetland") },
  { id: "forest", label: "Forests", href: "/forest/rondonia", match: (p: string) => p.startsWith("/forest") },
  { id: "volcano", label: "Volcanoes", href: "/volcano/hayli-gubbi", match: (p: string) => p.startsWith("/volcano") },
  { id: "agriculture", label: "Agriculture", href: "/agriculture", match: (p: string) => p.startsWith("/agriculture") },
];

const MORE_LINKS = [
  { href: "/investigations", label: "Investigations" },
  { href: "/observability", label: "Evidence" },
  { href: "/operator-guide", label: "Method" },
  { href: "/lineage", label: "Evidence lineage" },
  { href: "/temporal", label: "Temporal Studio" },
  { href: "/hypotheses", label: "Hypothesis & Falsification Lab" },
  { href: "/compare", label: "Compare studies" },
];

export default function HazardNavigation() {
  const pathname = usePathname();
  const moreActive = MORE_LINKS.some((l) => pathname === l.href || (l.href === "/investigations" && pathname === "/investigations"));
  return (
    <nav className="hazard-nav" aria-label="Primary">
      <Link className="hazard-nav__brand" href="/" aria-label="GeoNexSAR home">
        GeoNexSAR
      </Link>
      <div className="hazard-nav__links">
        {DOMAINS.map((d) => (
          <Link key={d.id} href={d.href} aria-current={d.match(pathname) ? "page" : undefined}>
            {d.label}
          </Link>
        ))}
        <details className="hazard-nav__more">
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
      {/* Compact mobile navigation: the desktop row is hidden at phone width
          and this details menu takes over. The g3-mobile-nav class is the
          shared hook the browser tests use for the compact menu. */}
      <details className="hazard-nav__mobile g3-mobile-nav">
        <summary>
          Explore <span aria-hidden="true">⌄</span>
        </summary>
        <nav aria-label="Mobile primary">
          {DOMAINS.map((d) => (
            <Link key={d.id} href={d.href} aria-current={d.match(pathname) ? "page" : undefined}>
              {d.label}
            </Link>
          ))}
          {MORE_LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
      </details>
    </nav>
  );
}

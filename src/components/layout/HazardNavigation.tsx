"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

export default function HazardNavigation() {
  const pathname = usePathname();
  const moreActive = MORE_LINKS.some((l) => pathname === l.href);
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
      <details className="hazard-nav__mobile g3-mobile-nav">
        <summary>Explore <span aria-hidden="true">⌄</span></summary>
        <nav aria-label="Compact navigation">
          {DOMAINS.map((d) => <Link key={d.id} href={d.href}>{d.label}</Link>)}
          {MORE_LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        </nav>
      </details>
    </nav>
  );
}

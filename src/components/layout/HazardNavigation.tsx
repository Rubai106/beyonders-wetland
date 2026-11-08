"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function HazardNavigation() {
  const pathname = usePathname();
  // The landing page and hazard workspaces provide their own navigation.
  if (pathname === "/" || pathname.startsWith("/wetland") || pathname.startsWith("/forest") || pathname.startsWith("/volcano") || pathname.startsWith("/agriculture")) return null;

  const wetlandActive = pathname.startsWith("/wetland") || pathname === "/";
  const volcanoActive = pathname.startsWith("/volcano");
  const forestActive = pathname.startsWith("/forest");

  return (
    <nav className="hazard-nav" aria-label="Earth change topics">
      <Link className="hazard-nav__brand" href="/" aria-label="GeoNexSAR home">GeoNexSAR</Link>
      <div className="hazard-nav__links">
        <Link href="/wetland/global" aria-current={wetlandActive ? "page" : undefined}>
          Wetlands
        </Link>
        <Link href="/volcano/global" aria-current={volcanoActive ? "page" : undefined}>
          Volcanoes
        </Link>
        <Link href="/forest/global" aria-current={forestActive ? "page" : undefined}>
          Forests
        </Link>
        <Link href="/agriculture">Agriculture</Link>
        <Link href="/observability" aria-current={pathname === "/observability" ? "page" : undefined}>
          Observation health
        </Link>
        <Link href="/lineage" aria-current={pathname === "/lineage" ? "page" : undefined}>
          Evidence lineage
        </Link>
        <Link href="/temporal" aria-current={pathname === "/temporal" ? "page" : undefined}>
          Temporal Studio
        </Link>
        <Link href="/hypotheses" aria-current={pathname === "/hypotheses" ? "page" : undefined}>
          Hypothesis Workspace
        </Link>
        <Link href="/compare" aria-current={pathname === "/compare" ? "page" : undefined}>
          Compare studies
        </Link>
      </div>
      <span className="hazard-nav__mission">NISAR · mission control</span>
    </nav>
  );
}

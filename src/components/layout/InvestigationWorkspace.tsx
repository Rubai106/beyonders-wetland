"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { DataTier } from "@/lib/store";
import { findDrawerTabForAnchor } from "@/lib/workspace-navigation";
import { Icon } from "../wetland/icons";
import { TierBadge } from "../wetland/ui";

type Hazard = "wetland" | "volcano" | "forest" | "agriculture";

const sections: Array<{ id: Hazard; label: string; href: string }> = [
  { id: "wetland", label: "Wetlands", href: "/wetland" },
  { id: "agriculture", label: "Agriculture", href: "/agriculture" },
  { id: "forest", label: "Forests", href: "/forest/rondonia" },
  { id: "volcano", label: "Volcanoes", href: "/volcano/hayli-gubbi" },
];

const sourceLabel: Record<Hazard, string> = {
  wetland: "NASA NISAR · L-band",
  forest: "NASA NISAR · L-band",
  volcano: "NASA NISAR · phase",
  agriculture: "NASA NISAR · SME2 soil moisture",
};

export type InvestigationDrawerTab = {
  id: string;
  number: string;
  label: string;
  hint: string;
  anchorIds?: string[];
  content: ReactNode;
};

export default function InvestigationWorkspace({
  hazard,
  className = "",
  caseName,
  title,
  subtitle,
  questContent,
  rail,
  map,
  mapToolbar,
  drawer,
  drawerTabs,
  initialAnchorId,
  drawerTabsPlacement = "map",
  drawerPersistent,
  footer,
  caseControl,
  dataTier,
  completeness,
  satelliteBasemap = true,
  onToggleBasemap,
  onReturnToOverview,
}: {
  hazard: Hazard;
  className?: string;
  caseName: string;
  title: string;
  subtitle: string;
  questContent?: ReactNode;
  rail: ReactNode;
  map: ReactNode;
  mapToolbar?: ReactNode;
  drawer: ReactNode;
  drawerTabs?: InvestigationDrawerTab[];
  initialAnchorId?: string;
  drawerTabsPlacement?: "map" | "drawer";
  drawerPersistent?: ReactNode;
  footer: ReactNode;
  caseControl?: ReactNode;
  dataTier?: DataTier;
  completeness?: string;
  satelliteBasemap?: boolean;
  onToggleBasemap?: () => void;
  onReturnToOverview?: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(true);
  const initialAnchorTab = findDrawerTabForAnchor(drawerTabs, initialAnchorId);
  const [activeTab, setActiveTab] = useState(initialAnchorTab?.id ?? drawerTabs?.[0]?.id ?? "");
  const pendingAnchor = useRef<string | null>(initialAnchorTab ? initialAnchorId ?? null : null);
  const anchorObserver = useRef<MutationObserver | null>(null);
  const anchorFrame = useRef<number | null>(null);
  const documentFlow = className.includes("volcano-case-workspace") || className.includes("detection-page-workspace");
  const selectedTab = drawerTabs?.find((tab) => tab.id === activeTab) ?? drawerTabs?.[0];
  const tabsInDrawer = Boolean(drawerTabs?.length && drawerTabsPlacement === "drawer");

  const stopAnchorWait = useCallback(() => {
    if (anchorFrame.current !== null) window.cancelAnimationFrame(anchorFrame.current);
    anchorFrame.current = null;
    anchorObserver.current?.disconnect();
    anchorObserver.current = null;
  }, []);
  const scrollToPendingAnchor = useCallback((targetId: string) => {
    stopAnchorWait();
    const reveal = () => {
      if (pendingAnchor.current !== targetId) return true;
      const target = document.getElementById(targetId);
      if (!target) return false;
      pendingAnchor.current = null;
      stopAnchorWait();
      target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: targetId === "nisar-optical-radar-curtain" ? "start" : "center" });
      target.classList.add("case-walkthrough-highlight");
      window.setTimeout(() => target.classList.remove("case-walkthrough-highlight"), 1800);
      return true;
    };

    anchorFrame.current = window.requestAnimationFrame(() => {
      if (reveal()) return;
      const container = document.querySelector(".wx-drawer__body") ?? document.body;
      const observer = new MutationObserver(reveal);
      anchorObserver.current = observer;
      observer.observe(container, { childList: true, subtree: true });
      reveal();
    });
  }, [stopAnchorWait]);
  const clearPendingAnchor = useCallback(() => {
    pendingAnchor.current = null;
    stopAnchorWait();
  }, [stopAnchorWait]);

  function openAnchor(targetId: string) {
    const tab = findDrawerTabForAnchor(drawerTabs, targetId);
    if (!tab) return false;
    clearPendingAnchor();
    pendingAnchor.current = targetId;
    if (drawerOpen && selectedTab?.id === tab.id) {
      scrollToPendingAnchor(targetId);
      return true;
    }
    setActiveTab(tab.id);
    setDrawerOpen(true);
    return true;
  }


  useEffect(() => {
    const targetId = pendingAnchor.current;
    if (!drawerOpen || !targetId || !selectedTab?.anchorIds?.includes(targetId)) return;
    scrollToPendingAnchor(targetId);
    return stopAnchorWait;
  }, [activeTab, drawerOpen, selectedTab, scrollToPendingAnchor, stopAnchorWait]);

  useEffect(() => {
    function handleOpenPanel(event: Event) {
      const targetId = (event as CustomEvent<string>).detail;
      if (typeof targetId === "string") openAnchor(targetId);
    }
    window.addEventListener("geonexsar:open-panel", handleOpenPanel);
    return () => window.removeEventListener("geonexsar:open-panel", handleOpenPanel);
  });

  function handleFragmentLink(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    const targetId = anchor?.getAttribute("href")?.slice(1);
    if (targetId && openAnchor(decodeURIComponent(targetId))) event.preventDefault();
  }

  return (
    <div
      className={`wx-root wx-hazard-shell${documentFlow ? " wx-root--document" : ""}${tabsInDrawer ? " wx-root--drawer-tabs" : ""} ${className}`}
      data-hazard={hazard}
      data-drawer={drawerOpen ? "open" : "closed"}
      onClickCapture={handleFragmentLink}
    >
      <header className="wx-mast">
        <Link href="/" className="wx-brand" aria-label="GeoNexSAR home">
          GeoNexSAR
        </Link>
        <span className="wx-case">
          <span className="wx-micro">Case</span>
          {caseControl ?? <span className="wx-case__title">{caseName}</span>}
        </span>
        {dataTier ? <TierBadge tier={dataTier} completeness={completeness} /> : <span className="wx-tier wx-tier--real" aria-label={sourceLabel[hazard]}>
          <i aria-hidden="true" />
          <span className="wx-tier__full">{sourceLabel[hazard]}</span>
          <span className="wx-tier__short">NISAR</span>
        </span>}
        <nav className="wx-nav" aria-label="Earth change topics">
          <Link href="/wetland" aria-current={hazard === "wetland" ? "page" : undefined} aria-label="Open the published wetland investigations" title="Tanguar Haor and Hakaluki Haor studies"><span>Wetlands</span></Link>
          {sections.map((section) => (
            section.id !== "wetland" && <Link key={section.id} href={section.href} aria-current={hazard === section.id ? "page" : undefined}>{section.label}</Link>
          ))}
          {onToggleBasemap && <button type="button" onClick={onToggleBasemap} aria-pressed={satelliteBasemap} aria-label="Satellite basemap" title="Toggle the satellite basemap">{Icon.layers}<span>Basemap</span></button>}
          {onReturnToOverview && <button type="button" onClick={onReturnToOverview} title="Clear selection and return to the world view">Return<span className="wx-nav__long"> to overview</span></button>}
        </nav>
      </header>

      <section className="wx-quest" aria-label="Current investigation">
        <span className="wx-micro">Field assignment</span>
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {questContent}
      </section>

      <aside className="wx-rail" aria-label="Study context">
        {rail}
      </aside>

      <main className="wx-map" aria-label={`${title} map`}>
        <div className="wx-hazard-map">{map}</div>
        {mapToolbar}
        {!tabsInDrawer && <div className="wx-tabs" role={drawerTabs ? "tablist" : "group"} aria-label={drawerTabs ? "Investigation" : "Map controls"}>
          {drawerTabs?.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className="wx-tab"
              aria-selected={drawerOpen && selectedTab?.id === tab.id}
              aria-label={`${tab.label}: ${tab.hint}`}
              title={tab.hint}
              onClick={() => {
                clearPendingAnchor();
                if (drawerOpen && selectedTab?.id === tab.id) setDrawerOpen(false);
                else { setActiveTab(tab.id); setDrawerOpen(true); }
              }}
            >
              <span className="wx-tab__n">{tab.number}</span>
              <span>{tab.label}</span>
            </button>
          )) ?? (
            <button
              type="button"
              className="wx-tab"
              aria-expanded={drawerOpen}
              onClick={() => { clearPendingAnchor(); setDrawerOpen((open) => !open); }}
            >
              <span className="wx-tab__n">01</span>
              <span>{drawerOpen ? "Hide controls" : "Explore"}</span>
            </button>
          )}
        </div>}
        {tabsInDrawer && !drawerOpen && <button type="button" className="wx-drawer-reopen" onClick={() => setDrawerOpen(true)}>Open {selectedTab?.label ?? "Explore"}</button>}
      </main>

      {drawerOpen && (
        <aside className="wx-drawer" aria-label="Study controls and evidence">
          <div className={`wx-drawer__bar${tabsInDrawer ? " wx-drawer__bar--tabs" : ""}`}>
            {tabsInDrawer ? <nav className="wx-drawer__tabs" role="tablist" aria-label="Investigation sections">
              {drawerTabs?.map((tab) => <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selectedTab?.id === tab.id}
                aria-label={`${tab.label}: ${tab.hint}`}
                title={tab.hint}
                onClick={() => { clearPendingAnchor(); setActiveTab(tab.id); }}
              >{tab.label}</button>)}
            </nav> : <span className="wx-micro">{selectedTab?.label ?? "Investigation"}</span>}
            <button
              type="button"
              onClick={() => { clearPendingAnchor(); setDrawerOpen(false); }}
              aria-label="Close controls"
            >
              ×
            </button>
          </div>
          {drawerPersistent && <div className="wx-drawer__persistent">{drawerPersistent}</div>}
          <div className="wx-drawer__body">{selectedTab?.content ?? drawer}</div>
        </aside>
      )}

      <footer className="wx-timeline wx-hazard-footer">{footer}</footer>
    </div>
  );
}

import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "@/styles/atlas.css";
import "@/components/wetland/experience.css";
import "@/styles/hazard-workspace.css";
import "@/components/agriculture/agriculture.css";
import "@/components/shared/field-volume-scene.css";
import "@/styles/platform-visual-refresh.css";
import "@/styles/case-dossier-dark.css";
import HazardNavigation from "@/components/layout/HazardNavigation";

export const metadata: Metadata = {
  title: "GEONEXSER — Earth-change investigations with NISAR",
  description: "Inspect NASA–ISRO NISAR observations, examine change candidates, compare independent evidence, and trace every result to its source.",
  keywords: ["NISAR", "Earth observation", "SAR", "radar", "wetlands", "forests", "volcanoes", "soil moisture", "NASA Space Apps"],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><HazardNavigation />{children}</body></html>;
}

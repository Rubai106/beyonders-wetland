import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "@/styles/atlas.css";
import "@/components/wetland/experience.css";
import "@/styles/hazard-workspace.css";
import "@/components/agriculture/agriculture.css";
import HazardNavigation from "@/components/layout/HazardNavigation";

export const metadata: Metadata = {
  title: "GeoNexSAR — Watch Earth's surface change with NISAR radar",
  description:
    "GeoNexSAR turns NASA–ISRO NISAR radar into an interactive investigation: explore real processed cases, interrogate the evidence, and challenge every result.",
  keywords: [
    "NISAR",
    "wetland",
    "volcano",
    "forest",
    "SAR",
    "radar",
    "inundation",
    "NASA",
    "Space Apps",
    "Beyonders",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <HazardNavigation />
        {children}
      </body>
    </html>
  );
}

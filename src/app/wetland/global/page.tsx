"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import GlobalDetectionsExplorer from "@/components/global/GlobalDetectionsExplorer";

function GlobalDetectionsPageContent() {
  const params = useSearchParams();
  return <GlobalDetectionsExplorer initialLocation={{
    latitude: params.get("latitude") ?? "",
    longitude: params.get("longitude") ?? "",
    site: params.get("site") ?? "",
  }} initialRunId={params.get("run") ?? ""} initialAnchorId={params.get("story") === "chokwe" ? "mozambique-case-title" : undefined} />
}

export default function GlobalDetectionsPage() {
  return <Suspense fallback={<main className="global-coverage-page"><p role="status">Loading the worldwide map…</p></main>}>
    <GlobalDetectionsPageContent />
  </Suspense>;
}

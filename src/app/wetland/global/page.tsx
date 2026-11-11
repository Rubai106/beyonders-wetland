"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import GlobalDetectionsExplorer from "@/components/global/GlobalDetectionsExplorer";
import { CHOKWE_RUN_ID } from "@/lib/chokwe-study";

function GlobalDetectionsPageContent() {
  const params = useSearchParams();
  const story = params.get("story");
  const initialRunId = params.get("run") ?? (story === "chokwe" ? CHOKWE_RUN_ID : "");
  return <GlobalDetectionsExplorer initialLocation={{
    latitude: params.get("latitude") ?? "",
    longitude: params.get("longitude") ?? "",
    site: params.get("site") ?? "",
  }} initialRunId={initialRunId} initialAnchorId={story === "chokwe" ? "mozambique-case-title" : undefined} />
}

export default function GlobalDetectionsPage() {
  return <Suspense fallback={<main className="global-coverage-page"><p role="status">Loading the worldwide map…</p></main>}>
    <GlobalDetectionsPageContent />
  </Suspense>;
}

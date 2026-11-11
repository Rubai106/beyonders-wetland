import type { Metadata } from "next";
import { Suspense } from "react";
import { loadTemporalStudies } from "@/lib/temporal-studio-server";
import TemporalStudio from "@/components/temporal/TemporalStudio";
import "./temporal.css";

export const metadata: Metadata = {
  title: "Temporal Studio · GEONEXSER",
  description:
    "One evidence-synced timeline per published study: the real metric for every observation date, the screening rule, and what the independent reference said.",
};

export default async function TemporalPage() {
  const { studies, missing } = await loadTemporalStudies();
  return (
    <main className="temporal-page">
      <header className="temporal-head">
        <p className="temporal-eyebrow">Temporal Studio · evidence, over time</p>
        <h1>Watch each study change, date by date.</h1>
        <p>
          Every point on these timelines is a real published observation — the metric the study
          actually measured, the rule that screened it, and what the independent reference said
          about it. Nothing here is simulated or interpolated.
        </p>
        {missing.length > 0 && (
          <p className="temporal-missing" role="status">
            Not loaded from disk: {missing.join(", ")}. They are reported as missing, not as zero.
          </p>
        )}
      </header>
      <Suspense fallback={<p role="status">Loading study timelines…</p>}>
        <TemporalStudio studies={studies} />
      </Suspense>
    </main>
  );
}

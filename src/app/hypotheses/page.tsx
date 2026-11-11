import type { Metadata } from "next";
import HypothesisWorkspace from "@/components/hypotheses/HypothesisWorkspace";
import "./hypotheses.css";

export const metadata: Metadata = {
  title: "Hypothesis & Falsification Lab · GEONEXSER",
  description:
    "Competing explanations for each published study, weighed against the same evidence — with the single observation that would kill each one.",
};

export default function HypothesesPage() {
  return (
    <main className="hypo-page">
      <header className="hypo-head">
        <p className="hypo-eyebrow">Hypothesis &amp; Falsification Lab · argue with the evidence</p>
        <h1>What else could this be?</h1>
        <p>
          Every study on this platform has more than one explanation. Here they compete on the same
          evidence: each piece of evidence is rated against each explanation, and the explanations
          are ordered by fewest contradictions. That ordering is a comparative presentation, not a
          verdict and not a probability — no explanation wins here. Every hypothesis carries the
          observation that would kill it, because an explanation that cannot be killed is not an
          explanation.
        </p>
        <p>
          Nothing here is settled. No study on this platform is validated, and this workspace does
          not validate them — it shows exactly where the evidence disagrees.
        </p>
      </header>
      <HypothesisWorkspace />
    </main>
  );
}

/* Evidence Lineage Explorer — server-rendered from the published manifests.
   Every chain is built from a real study file; a study that cannot be read
   is reported as unavailable, never as an empty graph. */
import Link from "next/link";
import EvidenceLineageExplorer from "@/components/shared/EvidenceLineageExplorer";
import { loadLineageChains } from "@/lib/lineage-studies";
import "./lineage.css";

export const dynamic = "force-dynamic";

export default async function LineagePage() {
  const { chains, unavailable } = await loadLineageChains();
  return (
    <main className="lineage-page">
      <header className="lineage-hero">
        <p className="lineage-eyebrow">GEONEXSER · EVIDENCE LINEAGE</p>
        <h1>Trace a result back to its source</h1>
        <p className="lineage-lede">
          Pick a study, pick a measurement, and follow it backward: the method
          that derived it, the quality screen that filtered it, the real
          acquisitions behind it, the independent reference that checked it,
          and the run that published it. Every node opens the evidence it
          claims — nothing here is a decorative connection.
        </p>
        <p className="lineage-meta">
          {chains.length} published studies · built from the manifests on this
          site · <Link href="/observability">observation health</Link>
        </p>
      </header>
      <EvidenceLineageExplorer chains={chains} unavailable={unavailable} />
    </main>
  );
}

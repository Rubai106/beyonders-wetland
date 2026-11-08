"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  diagnosticEvidence,
  HYPOTHESIS_STUDIES,
  rankHypotheses,
  type AchRating,
  type RatingMap,
} from "@/lib/hypotheses";

const STORAGE_KEY = "beyonders-hypotheses-v1";

const RATING_LABEL: Record<AchRating, string> = {
  consistent: "Consistent",
  inconsistent: "Inconsistent",
  neutral: "Neutral",
};

const RATING_MARK: Record<AchRating, string> = {
  consistent: "✓",
  inconsistent: "✕",
  neutral: "·",
};

const NEXT_RATING: Record<AchRating, AchRating> = {
  consistent: "inconsistent",
  inconsistent: "neutral",
  neutral: "consistent",
};

function loadStored(): RatingMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as RatingMap;
  } catch {
    return {};
  }
}

/* localStorage-backed store, read through useSyncExternalStore so the
   persisted ratings hydrate without a setState-in-effect. */
const EMPTY: RatingMap = {};
let cachedOverrides: RatingMap | null = null;
const overrideListeners = new Set<() => void>();
function readOverrides(): RatingMap {
  if (cachedOverrides === null) cachedOverrides = loadStored();
  return cachedOverrides;
}
function subscribeOverrides(cb: () => void): () => void {
  overrideListeners.add(cb);
  const onStorage = () => {
    cachedOverrides = null;
    cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    overrideListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
function writeOverrides(next: RatingMap) {
  cachedOverrides = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or full storage: ratings still work for this visit.
  }
  overrideListeners.forEach((cb) => cb());
}

export default function HypothesisWorkspace() {
  const [studyId, setStudyId] = useState(HYPOTHESIS_STUDIES[0]?.studyId ?? "");
  const overrides = useSyncExternalStore(subscribeOverrides, readOverrides, () => EMPTY);

  const study = HYPOTHESIS_STUDIES.find((s) => s.studyId === studyId) ?? HYPOTHESIS_STUDIES[0];
  if (!study) return <p role="status">No hypotheses are published yet.</p>;

  const ranked = rankHypotheses(study, overrides);
  const diagnostic = new Set(diagnosticEvidence(study, overrides).map((e) => e.id));
  const effective = (evidenceId: string, hypothesisId: string): { rating: AchRating; mine: boolean } => {
    const mine = overrides[study.studyId]?.[evidenceId]?.[hypothesisId];
    if (mine) return { rating: mine, mine: true };
    return { rating: study.assessments[evidenceId]?.[hypothesisId] ?? "neutral", mine: false };
  };

  const cycle = (evidenceId: string, hypothesisId: string) => {
    const current = effective(evidenceId, hypothesisId).rating;
    const next = NEXT_RATING[current];
    const nextMap: RatingMap = JSON.parse(JSON.stringify(overrides));
    nextMap[study.studyId] = nextMap[study.studyId] ?? {};
    nextMap[study.studyId][evidenceId] = nextMap[study.studyId][evidenceId] ?? {};
    // Back to the seeded rating means clearing the override.
    const seeded = study.assessments[evidenceId]?.[hypothesisId] ?? "neutral";
    if (next === seeded) delete nextMap[study.studyId][evidenceId][hypothesisId];
    else nextMap[study.studyId][evidenceId][hypothesisId] = next;
    writeOverrides(nextMap);
  };

  const resetStudy = () => {
    const nextMap: RatingMap = JSON.parse(JSON.stringify(overrides));
    delete nextMap[study.studyId];
    writeOverrides(nextMap);
  };

  return (
    <div className="hypo-workspace">
      <div className="hypo-picker" role="group" aria-label="Choose a study">
        {HYPOTHESIS_STUDIES.map((s) => (
          <button
            key={s.studyId}
            type="button"
            className={s.studyId === study.studyId ? "hypo-picker__card is-active" : "hypo-picker__card"}
            aria-pressed={s.studyId === study.studyId}
            onClick={() => setStudyId(s.studyId)}
          >
            <span className="hypo-picker__domain">{s.domain}</span>
            <strong>{s.studyName}</strong>
            <span>
              {s.hypotheses.length} explanations · {s.evidence.length} pieces of evidence
            </span>
          </button>
        ))}
      </div>

      <section className="hypo-panel" aria-label={`${study.studyName} hypotheses`}>
        <div className="hypo-panel__head">
          <div>
            <p className="hypo-micro">{study.domain} · Analysis of Competing Hypotheses</p>
            <h2>{study.studyName}</h2>
            <p className="hypo-intro">
              Rate each piece of evidence against each explanation. The explanation with the fewest
              contradictions ranks first — agreement alone does not win. Tap any cell to change it;
              your ratings are saved in this browser only.
            </p>
          </div>
          <Link className="hypo-case-link" href={study.href}>
            Open the {study.studyName} case →
          </Link>
        </div>

        <div className="hypo-ranking" aria-label="Ranking">
          {ranked.map((r, i) => (
            <article key={r.hypothesis.id} className={i === 0 ? "hypo-rank is-first" : "hypo-rank"}>
              <p className="hypo-rank__place">{i === 0 ? "Strongest" : `#${i + 1}`}</p>
              <p className="hypo-rank__statement">{r.hypothesis.statement}</p>
              <p className="hypo-rank__score">
                {r.inconsistent} contradiction{r.inconsistent === 1 ? "" : "s"} · {r.consistent} fit{r.consistent === 1 ? "" : "s"}
              </p>
              <p className="hypo-rank__claim">
                <strong>Claim:</strong> {r.hypothesis.claim}
              </p>
              <p className="hypo-rank__falsifier">
                <strong>Would kill it:</strong> {r.hypothesis.falsifier}
              </p>
            </article>
          ))}
        </div>

        <div className="hypo-matrix-wrap">
          <table className="hypo-matrix">
            <thead>
              <tr>
                <th scope="col">Evidence</th>
                {study.hypotheses.map((h) => (
                  <th key={h.id} scope="col">
                    {h.statement}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {study.evidence.map((e) => (
                <tr key={e.id} className={diagnostic.has(e.id) ? "is-diagnostic" : ""}>
                  <th scope="row">
                    <span>{e.text}</span>
                    <small>Source: {e.source}</small>
                    {diagnostic.has(e.id) && <small className="hypo-diagnostic">Diagnostic — explanations disagree here</small>}
                  </th>
                  {study.hypotheses.map((h) => {
                    const { rating, mine } = effective(e.id, h.id);
                    return (
                      <td key={h.id}>
                        <button
                          type="button"
                          className={`hypo-cell is-${rating}${mine ? " is-mine" : ""}`}
                          aria-label={`${e.text} — ${h.statement}: ${RATING_LABEL[rating]}${mine ? " (your rating)" : " (platform assessment)"}. Activate to change.`}
                          onClick={() => cycle(e.id, h.id)}
                        >
                          <span aria-hidden="true">{RATING_MARK[rating]}</span>
                          <span className="hypo-cell__label">{RATING_LABEL[rating]}</span>
                          {mine && <span className="hypo-cell__mine">yours</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hypo-foot">
          <p className="hypo-note">
            The platform&apos;s starting ratings come from the published evidence. Your changes never
            leave this browser.
          </p>
          <button type="button" className="hypo-reset" onClick={resetStudy}>
            Reset my ratings for this study
          </button>
          <Link className="hypo-temporal-link" href={`/temporal?study=${study.studyId}`}>
            See this study on the timeline →
          </Link>
        </div>
      </section>
    </div>
  );
}

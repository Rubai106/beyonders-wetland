"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type HazardWalkthroughStep = {
  title: string;
  target: string;
  explanation: string;
};

export default function HazardWalkthrough({
  guideTitle,
  steps,
}: {
  guideTitle: string;
  steps: HazardWalkthroughStep[];
}) {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const launchRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const currentStepIndex = Math.min(stepIndex, Math.max(0, steps.length - 1));
  const current = steps[currentStepIndex];
  const currentTarget = current?.target;

  useEffect(() => {
    if (open) headingRef.current?.focus();
    else if (wasOpen.current) launchRef.current?.focus();
    wasOpen.current = open;
  }, [open, stepIndex]);

  useEffect(() => {
    if (!open || !currentTarget) return;
    window.dispatchEvent(new CustomEvent("geonexsar:open-panel", { detail: currentTarget }));
  }, [currentTarget, open]);

  function move(direction: -1 | 1) {
    if (direction === 1 && currentStepIndex === steps.length - 1) {
      setOpen(false);
      return;
    }
    setStepIndex(Math.max(0, Math.min(steps.length - 1, currentStepIndex + direction)));
  }

  if (!steps.length) return null;

  return <>
    <section className="case-walkthrough-launch hazard-walkthrough-launch" aria-label={`${guideTitle} walkthrough`}>
      <div><strong>New to this map?</strong><p>Follow the map, evidence, and method in three short steps.</p></div>
      <button ref={launchRef} type="button" onClick={() => { setStepIndex(0); setOpen(true); }}>Start walkthrough</button>
    </section>
    {open && current && typeof document !== "undefined" && createPortal(
      <aside className="case-walkthrough" aria-labelledby="hazard-walkthrough-title" aria-live="polite">
        <div className="case-walkthrough__topline"><span>{guideTitle}</span><button type="button" className="case-walkthrough__close" onClick={() => setOpen(false)} aria-label="Close walkthrough">×</button></div>
        <div className="case-walkthrough__progress" role="progressbar" aria-label="Walkthrough progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={currentStepIndex + 1}>{steps.map((step, index) => <span key={step.title} className={index <= currentStepIndex ? "is-complete" : ""}/>)}</div>
        <p className="case-walkthrough__count">Step {currentStepIndex + 1} of {steps.length}</p>
        <h2 ref={headingRef} tabIndex={-1} id="hazard-walkthrough-title">{current.title}</h2>
        <p className="case-walkthrough__copy">{current.explanation}</p>
        <div className="case-walkthrough__actions"><button type="button" className="case-walkthrough__secondary" onClick={() => move(-1)} disabled={currentStepIndex === 0}>Back</button><button type="button" onClick={() => move(1)}>{currentStepIndex === steps.length - 1 ? "Finish" : "Next section"}</button></div>
      </aside>,
      document.body,
    )}
  </>;
}

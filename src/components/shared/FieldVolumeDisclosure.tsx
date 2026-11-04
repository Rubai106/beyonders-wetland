"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { FieldVolumeSceneProps } from "./FieldVolumeScene";

const FieldVolumeScene = dynamic(() => import("./FieldVolumeScene"), {
  ssr: false,
  loading: () => <div className="field-volume-disclosure__loading" role="status">Preparing the interactive 3D view…</div>,
});

export default function FieldVolumeDisclosure(props: FieldVolumeSceneProps) {
  const [open, setOpen] = useState(false);
  const id = "field-volume-" + props.kind;
  return (
    <section className={"field-volume-disclosure field-volume-disclosure--" + props.kind} aria-labelledby={id + "-title"}>
      <div className="field-volume-disclosure__head">
        <div>
          <span className="field-volume-disclosure__eyebrow">SPATIAL DATA VIEW · OPTIONAL 3D</span>
          <strong id={id + "-title"}>{props.title}</strong>
          <p>{props.metricLabel} across the real observation dates</p>
        </div>
        <button type="button" aria-expanded={open} aria-controls={id + "-panel"} onClick={() => setOpen(value => !value)}>
          {open ? "Close 3D view" : "Explore in 3D"} <span aria-hidden="true">{open ? "−" : "+"}</span>
        </button>
      </div>
      {open && <div id={id + "-panel"} className="field-volume-disclosure__panel"><FieldVolumeScene {...props} /></div>}
    </section>
  );
}

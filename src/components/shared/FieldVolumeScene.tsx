"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import "./field-volume-scene.css";

export type FieldVolumeKind = "wetland" | "forest" | "volcano" | "agriculture";
export type FieldVolumeDatum = {
  id: string; label: string; value: number; valueLabel: string;
  context?: number; contextLabel?: string; available?: boolean;
};
export type FieldVolumeSceneProps = {
  kind: FieldVolumeKind; title: string; metricLabel: string; contextLabel: string;
  observations: FieldVolumeDatum[]; selectedId: string; onSelectId?: (id: string) => void; note: string;
};

const PALETTES: Record<FieldVolumeKind, { accent: number; deep: number; glow: number; ground: number; water: number; label: string }> = {
  wetland: { accent: 0x59d6ce, deep: 0x0c3136, glow: 0x79e4dd, ground: 0x18363a, water: 0x1a7277, label: "WETLAND HYDROLOGY" },
  forest: { accent: 0x88c58c, deep: 0x152b22, glow: 0xb2df9c, ground: 0x24392e, water: 0x47644b, label: "FOREST PERSISTENCE" },
  volcano: { accent: 0xe7a16c, deep: 0x33231f, glow: 0xffc38b, ground: 0x332c29, water: 0x715046, label: "RADAR DEFORMATION" },
  agriculture: { accent: 0xb4c48a, deep: 0x27352a, glow: 0xd1db9e, ground: 0x3a3a29, water: 0x74805a, label: "SOIL MOISTURE" },
};

function disposeTree(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}

function mat(color: number, roughness = 0.78, metalness = 0.04) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function cylinder(parent: THREE.Group, radiusTop: number, radiusBottom: number, height: number, color: number, x: number, y: number, z: number, radialSegments = 8) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments), mat(color));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addLandscape(group: THREE.Group, kind: FieldVolumeKind, palette: (typeof PALETTES)[FieldVolumeKind]) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 3.2, 48, 24), mat(palette.ground, 0.94));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.16;
  group.add(ground);
  const grid = new THREE.GridHelper(7.2, 24, palette.accent, palette.deep);
  grid.position.y = -0.145;
  (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach((item) => {
    item.transparent = true;
    item.opacity = 0.16;
  });
  group.add(grid);

  if (kind === "wetland") {
    const geometry = new THREE.PlaneGeometry(7.1, 1.3, 90, 20);
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i);
      positions.setZ(i, Math.sin(x * 1.6 + y * 2.2) * 0.075 + Math.cos(x * 0.8 - y * 3.1) * 0.028);
    }
    geometry.computeVertexNormals();
    const water = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: palette.water, roughness: 0.32, metalness: 0.2, transparent: true, opacity: 0.84 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.04, 0.38);
    group.add(water);
    const island = new THREE.Mesh(new THREE.SphereGeometry(0.53, 24, 12), mat(0x756849));
    island.scale.set(1.8, 0.2, 0.64);
    island.position.set(-1.7, -0.04, 0.25);
    group.add(island);
    for (let i = 0; i < 15; i++) {
      const x = -3 + (i % 8) * 0.78;
      const z = (i % 2 ? 1 : -1) * (0.7 + (i % 3) * 0.13);
      cylinder(group, 0.012, 0.022, 0.32 + (i % 4) * 0.07, i % 3 ? 0x91aa7c : 0xc1ae77, x, 0.05, z, 5);
    }
  } else if (kind === "forest") {
    for (let i = 0; i < 20; i++) {
      const x = -3.2 + (i % 7) * 1.02;
      const z = (Math.floor(i / 7) - 1) * 0.72;
      const height = 0.42 + ((i * 13) % 7) * 0.055;
      cylinder(group, 0.026, 0.046, 0.24, 0x8a6849, x, -0.01, z, 6);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.18 + (i % 3) * 0.025, height, 7), mat(i % 4 === 0 ? 0x6d9a69 : 0x477a59));
      crown.position.set(x, 0.2 + height * 0.47, z);
      crown.rotation.y = i * 0.41;
      group.add(crown);
      const crown2 = new THREE.Mesh(new THREE.ConeGeometry(0.12, height * 0.62, 7), mat(0x6f9a68));
      crown2.position.set(x, 0.38 + height * 0.34, z);
      group.add(crown2);
    }
  } else if (kind === "volcano") {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.12, 1.45, 48, 4), mat(0x53413a, 0.98));
    cone.position.set(-2, 0.55, 0.1);
    cone.rotation.z = -0.08;
    group.add(cone);
    const crater = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.055, 10, 44), mat(0xb97957));
    crater.rotation.x = Math.PI / 2;
    crater.position.set(-2, 1.23, 0.1);
    group.add(crater);
    const lava = new THREE.Mesh(new THREE.CircleGeometry(0.21, 36), new THREE.MeshBasicMaterial({ color: 0xb45e3c, transparent: true, opacity: 0.74 }));
    lava.rotation.x = -Math.PI / 2;
    lava.position.set(-2, 1.225, 0.1);
    group.add(lava);
    for (let i = 0; i < 7; i++) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(1.42 + i * 0.18, 0.006, 5, 100, Math.PI * 0.72), new THREE.MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.32 - i * 0.025 }));
      arc.rotation.x = Math.PI / 2;
      arc.rotation.z = i * 0.26;
      arc.position.set(-2, 0.1 + i * 0.07, 0.1);
      group.add(arc);
    }
  } else {
    for (let row = 0; row < 8; row++) {
      const z = -1.35 + row * 0.37;
      const points: THREE.Vector3[] = [];
      for (let step = 0; step <= 70; step++) {
        const x = -3.6 + step * 0.103;
        const curve = Math.sin(step * 0.065 + row * 0.6) * 0.055;
        points.push(new THREE.Vector3(x, -0.055 + curve, z + curve * 0.35));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: row % 2 ? 0x8b8a58 : 0x6e8658, transparent: true, opacity: 0.9 })));
    }
    for (let i = 0; i < 6; i++) {
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.04), mat(0x9eaa6f));
      stem.position.set(-2.8 + i * 0.96, 0.02, -0.96 + (i % 2) * 0.35);
      group.add(stem);
    }
  }
}

export default function FieldVolumeScene({
  kind, title, metricLabel, contextLabel, observations, selectedId, onSelectId, note,
}: FieldVolumeSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const callbacksRef = useRef({ selectedId, onSelectId });
  const [webglAvailable, setWebglAvailable] = useState(true);
  const palette = PALETTES[kind];
  const selected = observations.find((item) => item.id === selectedId) ?? observations[observations.length - 1];

  useEffect(() => {
    callbacksRef.current = { selectedId, onSelectId };
    sceneRef.current?.traverse((object) => {
      if (!object.userData.datumId) return;
      const mesh = object as THREE.Mesh;
      const isSelected = object.userData.datumId === selectedId;
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      materials.forEach((item) => {
        if (item instanceof THREE.MeshStandardMaterial) {
          item.emissiveIntensity = isSelected ? 0.38 : 0.08;
          item.opacity = object.userData.available === false ? 0.3 : 1;
          item.transparent = object.userData.available === false;
        }
      });
    });
  }, [selectedId, onSelectId]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !observations.length) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      const fallbackFrame = requestAnimationFrame(() => setWebglAvailable(false));
      return () => cancelAnimationFrame(fallbackFrame);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.className = "field-volume-canvas";
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", title + ". A rotatable conceptual 3D scene shows measured observations as selectable columns. Use arrow keys to inspect dates.");
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#091116");
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    camera.position.set(0.2, 3.5, 8.3);
    camera.lookAt(0, 0.45, 0);
    sceneRef.current = scene;

    scene.add(new THREE.HemisphereLight(0xe9f3f6, palette.deep, 2.05));
    const keyLight = new THREE.DirectionalLight(0xffead1, 2.4);
    keyLight.position.set(3.8, 7, 5);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(palette.glow, 15, 13);
    rimLight.position.set(-3.3, 3, -2.6);
    scene.add(rimLight);

    const world = new THREE.Group();
    scene.add(world);
    addLandscape(world, kind, palette);
    const chart = new THREE.Group();
    world.add(chart);
    const slotWidth = Math.min(0.72, 5.8 / Math.max(1, observations.length));
    const valid = observations.filter((item) => item.available !== false);
    const maximum = Math.max(0.000001, ...valid.map((item) => item.value));
    const minimum = Math.min(0, ...valid.map((item) => item.value));
    const range = Math.max(0.000001, maximum - minimum);
    const targets: THREE.Mesh[] = [];

    observations.forEach((datum, index) => {
      const x = (index - (observations.length - 1) / 2) * slotWidth;
      const isSelected = datum.id === callbacksRef.current.selectedId;
      const isAvailable = datum.available !== false;
      const normalized = isAvailable ? Math.max(0, (datum.value - minimum) / range) : 0;
      const height = isAvailable ? (datum.value === 0 ? 0.035 : 0.11 + normalized * 1.25) : 0.035;
      const main = new THREE.Mesh(new THREE.BoxGeometry(0.26, height, 0.34), mat(palette.accent, 0.48, 0.18));
      main.position.set(x, -0.12 + height / 2, -0.25);
      main.material.emissive = new THREE.Color(palette.accent);
      main.material.emissiveIntensity = isSelected ? 0.38 : 0.08;
      main.userData.datumId = datum.id;
      main.userData.available = isAvailable;
      chart.add(main);
      targets.push(main);

      if (datum.context !== undefined) {
        const contextHeight = Math.max(0.035, Math.min(1, datum.context) * 0.9);
        const context = new THREE.Mesh(new THREE.BoxGeometry(0.11, contextHeight, 0.22), mat(0x5c9da7, 0.58, 0.12));
        context.position.set(x + 0.2, -0.12 + contextHeight / 2, 0.02);
        context.userData.datumId = datum.id;
        context.userData.available = isAvailable;
        chart.add(context);
        targets.push(context);
      }
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.025, 24), new THREE.MeshStandardMaterial({
        color: isSelected ? palette.accent : 0x53636a, roughness: 0.82,
        emissive: palette.accent, emissiveIntensity: isSelected ? 0.16 : 0,
      }));
      foot.position.set(x, -0.12, -0.22);
      chart.add(foot);
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const drag = { active: false, moved: 0, x: 0, y: 0, velocity: 0 };
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = true, frame = 0, last = 0, disposed = false;

    const resize = () => {
      const width = mount.clientWidth || 1, height = mount.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    const intersection = new IntersectionObserver((entries) => { visible = Boolean(entries[0]?.isIntersecting); });
    intersection.observe(mount);
    const pick = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(targets, false)[0];
      const id = hit?.object.userData.datumId;
      if (typeof id === "string") {
        const datum = observations.find((item) => item.id === id);
        if (datum?.available !== false) callbacksRef.current.onSelectId?.(id);
      }
    };
    const pointerDown = (event: PointerEvent) => {
      drag.active = true; drag.moved = 0; drag.x = event.clientX; drag.y = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!drag.active) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      world.rotation.y += dx * 0.006;
      world.rotation.x = THREE.MathUtils.clamp(world.rotation.x + dy * 0.003, -0.48, 0.25);
      drag.velocity = dx * 0.0008;
      drag.x = event.clientX; drag.y = event.clientY;
    };
    const pointerUp = (event: PointerEvent) => {
      if (!drag.active) return;
      const shouldPick = drag.moved < 7;
      drag.active = false;
      if (shouldPick) pick(event);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      camera.position.z = THREE.MathUtils.clamp(camera.position.z + event.deltaY * 0.006, 5.4, 11);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const index = observations.findIndex((item) => item.id === callbacksRef.current.selectedId);
        const direction = event.key === "ArrowRight" ? 1 : -1;
        for (let step = 1; step <= observations.length; step++) {
          const next = (index + direction * step + observations.length) % observations.length;
          if (observations[next].available !== false) { callbacksRef.current.onSelectId?.(observations[next].id); break; }
        }
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const candidates = observations.filter((item) => item.available !== false);
        const datum = event.key === "Home" ? candidates[0] : candidates[candidates.length - 1];
        if (datum) callbacksRef.current.onSelectId?.(datum.id);
      }
    };
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("keydown", keydown);

    const animate = (time: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      if (!visible || document.hidden || time - last < 32) return;
      const delta = last ? Math.min(0.05, (time - last) / 1000) : 0;
      last = time;
      if (!reduceMotion && !drag.active && drag.moved === 0) {
        world.rotation.y += delta * 0.035 + drag.velocity;
        drag.velocity *= 0.94;
      }
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("keydown", keydown);
      disposeTree(scene);
      renderer.dispose();
      canvas.remove();
      sceneRef.current = null;
    };
  }, [kind, observations, title, palette]);

  return (
    <div className="field-volume-scene">
      <div className="field-volume-scene__stage">
        <div ref={mountRef} className="field-volume-scene__canvas" data-kind={kind}>
          {!webglAvailable && <div className="field-volume-scene__fallback" role="status">WebGL is unavailable. Use the real observation list below.</div>}
        </div>
        <div className="field-volume-scene__readout">
          <span>{PALETTES[kind].label}</span>
          <strong>{selected?.valueLabel ?? "No observation selected"}</strong>
          <small>{selected?.label ?? "No date"} · {metricLabel}</small>
          {selected?.context !== undefined && <small>{contextLabel}: {(selected.context * 100).toFixed(1)}%</small>}
        </div>
        <div className="field-volume-scene__compass" aria-hidden="true"><i />N</div>
      </div>
      <div className="field-volume-scene__footer">
        <span>Interactive measured series</span>
        <span>Drag to rotate · scroll to zoom · select a column</span>
      </div>
      <div className="field-volume-scene__dates" aria-label="Select an observation date">
        {observations.map((datum) => (
          <button key={datum.id} type="button" className={datum.id === selectedId ? "is-active" : ""}
            aria-pressed={datum.id === selectedId} disabled={datum.available === false}
            onClick={() => onSelectId?.(datum.id)}>
            <span>{datum.label}</span><strong>{datum.valueLabel}</strong>
          </button>
        ))}
      </div>
      <p className="field-volume-scene__note">{note}</p>
    </div>
  );
}

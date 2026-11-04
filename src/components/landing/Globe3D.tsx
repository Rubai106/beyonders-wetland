"use client";

/* A hand-rolled three.js globe: night-lights Earth, atmosphere glow, starfield,
   an orbiting NISAR satellite, pulsing real-case markers, and drop-a-pin-anywhere.
   No OrbitControls — custom spin-with-inertia feels like handling a planet. */

import { useEffect, useRef } from "react";
import * as THREE from "three";

export interface GlobePin { lat: number; lng: number }
export type GlobeHazard = "wetland" | "forest" | "volcano";
export interface GlobeCaseMarker {
  id: string;
  hazard: GlobeHazard;
  lat: number;
  lng: number;
  label: string;
  sub: string;
  href: string;
  color: string;
}

interface Globe3DProps {
  pinMode: boolean;
  pin: GlobePin | null;
  caseMarkers: GlobeCaseMarker[];
  focusLocation: GlobePin | null;
  onPin: (lat: number, lng: number) => void;
  onCaseClick: (id: string) => void;
  onHoverCoord: (lat: number | null, lng: number | null) => void;
}

const R = 1;

export function latLngToVec3(lat: number, lng: number, r: number): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lng + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

function vec3ToLatLng(v: THREE.Vector3): GlobePin {
  const r = v.length() || 1;
  const lat = 90 - (Math.acos(THREE.MathUtils.clamp(v.y / r, -1, 1)) * 180) / Math.PI;
  const theta = Math.atan2(v.z, -v.x);
  let lng = (theta * 180) / Math.PI - 180;
  if (lng < -180) lng += 360;
  if (lng > 180) lng -= 360;
  return { lat, lng };
}

function makeGlowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  // White alpha texture keeps each marker's material tint vivid.
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.82)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.2)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

interface MarkerObj { id: string; group: THREE.Group; pulse: THREE.Sprite; labelOffsetX: number }

function distanceKm(a: GlobePin, b: GlobePin) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const latA = toRadians(a.lat);
  const latB = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export default function Globe3D({ pinMode, pin, caseMarkers, focusLocation, onPin, onCaseClick, onHoverCoord }: Globe3DProps) {
  const focusLatitude = focusLocation?.lat;
  const focusLongitude = focusLocation?.lng;
  const mountRef = useRef<HTMLDivElement>(null);
  const labelPinRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef(new Map<string, HTMLElement | null>());
  const markerLayerRef = useRef<THREE.Group | null>(null);
  const globeGroupRef = useRef<THREE.Group | null>(null);
  const viewControlsRef = useRef<{
    rotate: (horizontal: number, vertical: number) => void;
    zoom: (amount: number) => void;
  } | null>(null);
  const glowTexRef = useRef<THREE.Texture | null>(null);
  const markerObjs = useRef<MarkerObj[]>([]);
  const hitMeshes = useRef<THREE.Mesh[]>([]);
  const stateRef = useRef({ pinMode, pin, onPin, onCaseClick, onHoverCoord });
  // Keep the latest props reachable from three.js event handlers without re-creating the scene.
  useEffect(() => { stateRef.current = { pinMode, pin, onPin, onCaseClick, onHoverCoord }; });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      mount.innerHTML = "<p class='globe-fallback'>3D unavailable in this browser — the mission continues below.</p>";
      return;
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0.25, reduceMotion ? 2.75 : 5.6);

    const globeGroup = new THREE.Group();
    globeGroupRef.current = globeGroup;
    scene.add(globeGroup);
    // Start spun so Bangladesh faces the camera; intro flight brings it closer.
    globeGroup.rotation.y = Math.PI / 2 - THREE.MathUtils.degToRad(91.04 + 180);
    globeGroup.rotation.x = 0.16;

    // — Earth —
    const texLoader = new THREE.TextureLoader();
    const earthTex = texLoader.load("/globe/earth-night.jpg");
    if ("colorSpace" in earthTex) (earthTex as unknown as { colorSpace: unknown }).colorSpace = THREE.SRGBColorSpace;
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(R, 96, 96),
      new THREE.MeshBasicMaterial({ map: earthTex }),
    );
    globeGroup.add(earth);

    // — Faint graticule shell for the instrument feel —
    const grat = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.003, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0xffb35c, wireframe: true, transparent: true, opacity: 0.045 }),
    );
    globeGroup.add(grat);

    // — Atmosphere: fresnel glow shell —
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.16, 64, 64),
      new THREE.ShaderMaterial({
        vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vN; void main(){ float f = pow(1.0 - abs(vN.z), 2.6); gl_FragColor = vec4(1.0, 0.62, 0.25, 1.0) * f * 0.85; }`,
        blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false,
      }),
    );
    scene.add(atmo);

    // — Starfield —
    {
      const n = 1400;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(30 + Math.random() * 40);
        pos.set([v.x, v.y, v.z], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8fa3c7, size: 0.055, transparent: true, opacity: 0.7, sizeAttenuation: true })));
    }

    const glowTex = makeGlowTexture();
    glowTexRef.current = glowTex;

    // — Real-case markers live here, one per packaged case —
    const markerLayer = new THREE.Group();
    markerLayerRef.current = markerLayer;
    globeGroup.add(markerLayer);

    // — Dropped pin marker —
    const pinGroup = new THREE.Group();
    const pinSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x7dd3fc, transparent: true, depthWrite: false }));
    pinSprite.scale.setScalar(0.13);
    const pinDot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 12), new THREE.MeshBasicMaterial({ color: 0xbfe9ff }));
    pinGroup.add(pinSprite, pinDot);
    pinGroup.visible = false;
    globeGroup.add(pinGroup);

    // — NISAR satellite: bright mote on an inclined orbit + fading trail —
    const sat = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfff3d6 }));
    const satGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe9b8, transparent: true, opacity: 0.9, depthWrite: false }));
    satGlow.scale.setScalar(0.09);
    sat.add(satGlow);
    sat.position.set(0, 0, 1.42);
    scene.add(sat);
    const TRAIL = 90;
    const trailPos = new Float32Array(TRAIL * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.35 }));
    trail.frustumCulled = false;
    scene.add(trail);
    const trailPts: THREE.Vector3[] = [];

    // — Interaction: drag-to-spin with inertia, wheel zoom, click vs drag —
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let dragging = false, moved = 0, lastX = 0, lastY = 0, velX = 0, velY = 0, lastInteract = 0, introT = reduceMotion ? 1 : 0;
    let lastFrameAt = 0;
    viewControlsRef.current = {
      rotate: (horizontal, vertical) => {
        velX = 0;
        velY = 0;
        globeGroup.rotation.y += horizontal * 0.12;
        globeGroup.rotation.x = THREE.MathUtils.clamp(globeGroup.rotation.x + vertical * 0.12, -0.85, 0.85);
        lastInteract = performance.now();
      },
      zoom: (amount) => {
        camera.position.z = THREE.MathUtils.clamp(camera.position.z + amount, 1.85, 5.2);
        lastInteract = performance.now();
      },
    };
    let hoverCheck = false, hoverX = 0, hoverY = 0;
    const el = renderer.domElement;
    el.tabIndex = 0;
    el.setAttribute(
      "aria-label",
      "Interactive 3D Earth. Use the arrow keys or on-screen movement controls to rotate the globe, and plus or minus or the on-screen controls to zoom. Use the study location list to center a published case.",
    );
    el.style.cursor = "grab";
    el.style.display = "block";

    const setNdc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };

    el.addEventListener("pointerdown", (e) => {
      dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; velX = velY = 0;
      lastInteract = performance.now();
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    });
    el.addEventListener("pointermove", (e) => {
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        globeGroup.rotation.y += dx * 0.005;
        globeGroup.rotation.x = THREE.MathUtils.clamp(globeGroup.rotation.x + dy * 0.003, -0.85, 0.85);
        velX = dx * 0.005; velY = dy * 0.003;
        lastX = e.clientX; lastY = e.clientY;
        lastInteract = performance.now();
      } else { hoverCheck = true; hoverX = e.clientX; hoverY = e.clientY; }
    });
    const endDrag = () => { dragging = false; el.style.cursor = stateRef.current.pinMode ? "crosshair" : "grab"; };
    el.addEventListener("pointerup", (e) => {
      const wasClick = dragging && moved < 6;
      endDrag();
      if (!wasClick) return;
      setNdc(e);
      ray.setFromCamera(ndc, camera);
      // Case markers first (fat hit targets).
      const markerHit = ray.intersectObjects(hitMeshes.current, false)[0];
      if (markerHit) { stateRef.current.onCaseClick(markerHit.object.userData.caseId as string); return; }
      if (!stateRef.current.pinMode) return;
      const hit = ray.intersectObject(earth, false)[0];
      if (hit) {
        const local = globeGroup.worldToLocal(hit.point.clone());
        const { lat, lng } = vec3ToLatLng(local);
        stateRef.current.onPin(lat, lng);
        lastInteract = performance.now();
      }
    });
    el.addEventListener("pointercancel", endDrag);
    el.addEventListener("pointerleave", () => { stateRef.current.onHoverCoord(null, null); });
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      camera.position.z = THREE.MathUtils.clamp(camera.position.z + e.deltaY * 0.0022, 1.85, 5.2);
      lastInteract = performance.now();
    }, { passive: false });
    const handleKeyDown = (event: KeyboardEvent) => {
      const step = event.shiftKey ? 0.28 : 0.12;
      let handled = true;
      switch (event.key) {
        case "ArrowLeft":
          globeGroup.rotation.y += step;
          break;
        case "ArrowRight":
          globeGroup.rotation.y -= step;
          break;
        case "ArrowUp":
          globeGroup.rotation.x = THREE.MathUtils.clamp(globeGroup.rotation.x + step, -0.85, 0.85);
          break;
        case "ArrowDown":
          globeGroup.rotation.x = THREE.MathUtils.clamp(globeGroup.rotation.x - step, -0.85, 0.85);
          break;
        case "+":
        case "=":
          camera.position.z = THREE.MathUtils.clamp(camera.position.z - 0.2, 1.85, 5.2);
          break;
        case "-":
        case "_":
          camera.position.z = THREE.MathUtils.clamp(camera.position.z + 0.2, 1.85, 5.2);
          break;
        default:
          handled = false;
      }
      if (!handled) return;
      event.preventDefault();
      velX = 0;
      velY = 0;
      lastInteract = performance.now();
    };
    el.addEventListener("keydown", handleKeyDown);

    const resize = () => {
      const w = mount.clientWidth || 1, h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const labelPin = labelPinRef.current;
    const projV = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    const placeLabel = (obj: THREE.Object3D, div: HTMLElement | null, visible: boolean, offsetX = 0) => {
      if (!div) return;
      obj.getWorldPosition(projV);
      camDir.copy(camera.position).normalize();
      const facing = projV.clone().normalize().dot(camDir);
      if (!visible || facing < 0.12) { div.style.opacity = "0"; div.style.pointerEvents = "none"; return; }
      const p = projV.clone().project(camera);
      const w = mount.clientWidth, h = mount.clientHeight;
      div.style.opacity = "1";
      div.style.pointerEvents = visible ? "auto" : "none";
      div.style.transform = `translate(${(p.x * 0.5 + 0.5) * w + offsetX}px, ${(-p.y * 0.5 + 0.5) * h}px) translate(-50%,-135%)`;
    };

    let raf = 0;
    const timer = new THREE.Timer();
    timer.connect(document);
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      if (reduceMotion && now - lastFrameAt < 1000 / 24) return;
      lastFrameAt = now;
      timer.update();
      const t = timer.getElapsed();

      // Reduced-motion mode renders a steady globe. Users can still rotate and
      // zoom it directly with the keyboard or pointer.
      if (!reduceMotion && introT < 1) {
        introT = Math.min(1, introT + 0.008);
        const e = 1 - Math.pow(1 - introT, 3);
        camera.position.z = 5.6 - e * (5.6 - 2.75);
      }
      if (!dragging && !reduceMotion) {
        globeGroup.rotation.y += velX;
        globeGroup.rotation.x = THREE.MathUtils.clamp(globeGroup.rotation.x + velY, -0.85, 0.85);
        velX *= 0.94;
        velY *= 0.94;
        if (markerObjs.current.length === 0 && now - lastInteract > 3000) {
          globeGroup.rotation.y += 0.0011;
        }
      }
      if (!reduceMotion) {
        markerObjs.current.forEach((mo, i) => {
          const s = 0.13 + Math.sin(t * 2.6 + i * 1.7) * 0.025;
          mo.pulse.scale.setScalar(s);
          (mo.pulse.material as THREE.SpriteMaterial).opacity = 0.78 + Math.sin(t * 2.6 + i * 1.7) * 0.17;
        });
        const orbR = 1.42, w = (t * 2 * Math.PI) / 14;
        const inc = 0.62;
        sat.position.set(
          orbR * Math.cos(w),
          orbR * Math.sin(w) * Math.sin(inc),
          orbR * Math.sin(w) * Math.cos(inc),
        );
        trailPts.unshift(sat.position.clone());
        if (trailPts.length > TRAIL) trailPts.pop();
        for (let i = 0; i < TRAIL; i++) {
          const p = trailPts[Math.min(i, trailPts.length - 1)] ?? sat.position;
          trailPos.set([p.x, p.y, p.z], i * 3);
        }
        trailGeo.attributes.position.needsUpdate = true;
      }

      // Hover coordinate readout.
      if (hoverCheck && !dragging) {
        hoverCheck = false;
        const r = el.getBoundingClientRect();
        ndc.set(((hoverX - r.left) / r.width) * 2 - 1, -((hoverY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObject(earth, false)[0];
        if (hit) {
          const { lat, lng } = vec3ToLatLng(globeGroup.worldToLocal(hit.point.clone()));
          stateRef.current.onHoverCoord(lat, lng);
        } else stateRef.current.onHoverCoord(null, null);
      }

      // Pin marker follows prop.
      const p = stateRef.current.pin;
      if (p) {
        pinGroup.visible = true;
        pinGroup.position.copy(latLngToVec3(p.lat, p.lng, R * 1.012));
      } else pinGroup.visible = false;

      for (const mo of markerObjs.current) placeLabel(mo.group, labelRefs.current.get(mo.id) ?? null, true, mo.labelOffsetX);
      placeLabel(pinGroup, labelPin, !!p);

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("keydown", handleKeyDown);
      viewControlsRef.current = null;
      timer.dispose();
      ro.disconnect();
      markerLayerRef.current = null;
      globeGroupRef.current = null;
      glowTexRef.current = null;
      markerObjs.current = [];
      hitMeshes.current = [];
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      earthTex.dispose();
      glowTex.dispose();
      renderer.dispose();
      mount.removeChild(el);
    };
  }, []);

  // Face the first study in the active category toward the camera when the
  // user switches the globe filter. The globe remains freely draggable.
  useEffect(() => {
    const group = globeGroupRef.current;
    if (!group || focusLatitude == null || focusLongitude == null) return;
    group.rotation.y = -Math.PI / 2 - THREE.MathUtils.degToRad(focusLongitude);
    group.rotation.x = THREE.MathUtils.degToRad(focusLatitude);
  }, [focusLatitude, focusLongitude]);

  // (Re)build one pulsing marker per real case.
  useEffect(() => {
    const layer = markerLayerRef.current;
    const glowTex = glowTexRef.current;
    if (!layer || !glowTex) return;
    for (const child of [...layer.children]) {
      child.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      layer.remove(child);
    }
    markerObjs.current = [];
    hitMeshes.current = [];
    for (const m of caseMarkers) {
      const group = new THREE.Group();
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: m.color, transparent: true, opacity: 0.28, depthWrite: false }));
      halo.scale.setScalar(0.24);
      const pulse = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: m.color, transparent: true, opacity: 0.9, depthWrite: false }));
      pulse.scale.setScalar(0.13);
      // Keep a crisp center so close published sites remain distinguishable
      // when their soft halos overlap at globe scale.
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 12, 12),
        new THREE.MeshBasicMaterial({ color: m.color, toneMapped: false }),
      );
      const center = new THREE.Mesh(
        new THREE.SphereGeometry(0.007, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xe8fdff, toneMapped: false }),
      );
      group.add(halo, pulse, core, center);
      // Invisible fat hit-target so the marker is easy to tap.
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.caseId = m.id;
      group.add(hit);

      const nearby = caseMarkers
        .filter((candidate) => candidate.hazard === m.hazard && distanceKm(m, candidate) < 160)
        .sort((a, b) => a.id.localeCompare(b.id));
      const nearbyIndex = nearby.findIndex((candidate) => candidate.id === m.id);
      const visualOffset = nearby.length > 1 ? (nearbyIndex - (nearby.length - 1) / 2) * 0.05 : 0;
      const truePosition = latLngToVec3(m.lat, m.lng, R * 1.012);
      const latitude = THREE.MathUtils.degToRad(m.lat);
      const longitude = THREE.MathUtils.degToRad(m.lng);
      const east = new THREE.Vector3(-Math.cos(latitude) * Math.sin(longitude), 0, -Math.cos(latitude) * Math.cos(longitude)).normalize();
      const displayPosition = truePosition.clone().addScaledVector(east, visualOffset).setLength(R * 1.012);
      if (visualOffset !== 0) {
        const tetherGeometry = new THREE.BufferGeometry().setFromPoints([truePosition, displayPosition]);
        const tether = new THREE.Line(
          tetherGeometry,
          new THREE.LineBasicMaterial({ color: m.color, transparent: true, opacity: 0.8, depthWrite: false }),
        );
        layer.add(tether);
      }
      group.position.copy(displayPosition);
      layer.add(group);
      const labelOffsetX = nearby.length > 1 ? (nearbyIndex - (nearby.length - 1) / 2) * 150 : 0;
      markerObjs.current.push({ id: m.id, group, pulse, labelOffsetX });
      hitMeshes.current.push(hit);
    }
  }, [caseMarkers]);

  return (
    <div ref={mountRef} className="globe-mount" aria-label="Interactive 3D globe of Earth">
      {caseMarkers.map((m) => (
        <button
          key={m.id}
          ref={(d) => { labelRefs.current.set(m.id, d); }}
          type="button"
          className="globe-tag globe-tag--case"
          data-hazard={m.hazard}
          aria-label={`Open ${m.label} ${m.hazard} study`}
          onClick={() => onCaseClick(m.id)}
        >
          <strong>{m.label}</strong>
          <span>{m.sub}</span>
        </button>
      ))}
      <div ref={labelPinRef} className="globe-tag globe-tag--pin">
        <strong>{pin ? `${Math.abs(pin.lat).toFixed(2)}°${pin.lat >= 0 ? "N" : "S"} ${Math.abs(pin.lng).toFixed(2)}°${pin.lng >= 0 ? "E" : "W"}` : ""}</strong>
        <span>selected study location</span>
      </div>
      <div className="g3-globe-controls" role="group" aria-label="Globe movement controls">
        <button type="button" aria-label="Rotate globe left" title="Rotate left" onClick={() => viewControlsRef.current?.rotate(-1, 0)}>←</button>
        <button type="button" aria-label="Tilt globe up" title="Tilt up" onClick={() => viewControlsRef.current?.rotate(0, 1)}>↑</button>
        <button type="button" aria-label="Rotate globe right" title="Rotate right" onClick={() => viewControlsRef.current?.rotate(1, 0)}>→</button>
        <button type="button" aria-label="Tilt globe down" title="Tilt down" onClick={() => viewControlsRef.current?.rotate(0, -1)}>↓</button>
        <button type="button" aria-label="Zoom globe out" title="Zoom out" onClick={() => viewControlsRef.current?.zoom(0.2)}>−</button>
        <button type="button" aria-label="Zoom globe in" title="Zoom in" onClick={() => viewControlsRef.current?.zoom(-0.2)}>+</button>
      </div>
    </div>
  );
}

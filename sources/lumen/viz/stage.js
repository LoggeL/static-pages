// LUMEN stage visualiser: hall, stage, truss, towers, risers, placeholder figures, audience, haze,
// camera presets, picking. Draws only from the engine frame (viz.render(frame, dt)).

import * as THREE from "../vendor/three.module.min.js";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { getType, clamp } from "../core/fixtures.js";
import { createFixtureObject } from "./fixtures3d.js";

export const CAMERAS = [
  { id: "foh", name: "FOH" }, { id: "front", name: "Front" }, { id: "top", name: "Draufsicht" },
  { id: "side", name: "Seite" }, { id: "drums", name: "Drums" }, { id: "free", name: "Frei" },
];
const VIEWS = {
  foh: { pos: [0, 5.4, 21.5], target: [0, 4.6, 0], fov: 44 },
  front: { pos: [1.2, 2.3, 9.8], target: [0, 4.6, -1], fov: 60 },
  top: { pos: [0, 22, 6.5], target: [0, 1.2, 0.6], fov: 48 },
  side: { pos: [-16.5, 3.2, 2.5], target: [0.5, 4.6, -0.6], fov: 50 },
  drums: { pos: [5.2, 3.4, 3.6], target: [-1.8, 2.4, -1.6], fov: 54 },
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _m = new THREE.Matrix4(), _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

const PARTICLE_VS = /* glsl */ `
uniform float time, size, pr;
attribute float seed;
varying float vA;
void main() {
  vec3 p = position + vec3(sin(time * 0.07 + seed * 6.3) * 0.8, mod(time * 0.05 + seed * 3.0, 1.0) * 1.2 - 0.6, cos(time * 0.05 + seed * 4.1) * 0.8);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = size * pr * (0.6 + seed) / -mv.z;
  vA = 0.5 + 0.5 * sin(time * 0.6 + seed * 20.0);
  gl_Position = projectionMatrix * mv;
}`;
const PARTICLE_FS = /* glsl */ `
uniform vec3 color;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  gl_FragColor = vec4(color * vA * smoothstep(0.5, 0.0, r), 1.0);
}`;
const STAR_FS = /* glsl */ `
uniform vec3 color;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  gl_FragColor = vec4(color * (0.25 + 0.75 * vA * vA) * smoothstep(0.5, 0.1, r), 1.0);
}`;

export function createViz(container, state) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const canvas = renderer.domElement;
  canvas.className = "viz-canvas";
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block", outline: "none" });
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.prepend(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020305);
  scene.fog = new THREE.FogExp2(0x04050a, 0.016);
  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 240);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minDistance = 1.5;
  controls.maxDistance = 70;
  controls.maxPolarAngle = Math.PI * 0.52;

  // ≤ 4 global lights: ambient, front fill, back/rim, flash
  const hemi = new THREE.HemisphereLight(0x29364d, 0x060606, 0.5);
  const front = new THREE.SpotLight(0xffffff, 0, 0, 0.62, 0.8, 1.6);
  front.position.set(0, 10, 7.5);
  front.target.position.set(0, 1.2, -0.8);
  const back = new THREE.SpotLight(0xffffff, 0, 0, 1.0, 1, 1.6);
  back.position.set(0, 10.5, -4.2);
  back.target.position.set(0, 0.5, 4);
  const flash = new THREE.PointLight(0xffffff, 0, 0, 1.4);
  flash.position.set(0, 8.4, 2.5);
  scene.add(hemi, front, front.target, back, back.target, flash);

  const venueRoot = new THREE.Group(), fixRoot = new THREE.Group(), labelRoot = new THREE.Group();
  scene.add(venueRoot, fixRoot, labelRoot);
  const objs = new Map();
  let proxies = [];
  let venue = null, planes = [], audience = null, particles = null, stars = null;
  let beams = state.ui.beams !== false, labelsOn = !!state.ui.labels, hazeUi = state.ui.haze ?? 0.55, quality = state.ui.quality || "hoch";
  let hazeLevel = 0.5, wall = 0, tween = null, lastFrame = null;

  /* ------------------------------------------------------------------ venue */
  const M = {
    floor: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.9, side: THREE.BackSide }),
    wall: new THREE.MeshStandardMaterial({ color: 0x060709, roughness: 1, side: THREE.BackSide }),
    deck: new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.3, metalness: 0.15 }),
    skirt: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1 }),
    riser: new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.5, metalness: 0.2 }),
    truss: new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.32, metalness: 0.85 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.75, metalness: 0.2 }),
    backdrop: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.95 }),
    shell: new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.35, metalness: 0.5 }),
    head: new THREE.MeshStandardMaterial({ color: 0x575c66, roughness: 0.4, metalness: 0.2 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xb8bec8, roughness: 0.2, metalness: 1 }),
    brass: new THREE.MeshStandardMaterial({ color: 0x9a7a3c, roughness: 0.3, metalness: 1 }),
    figure: new THREE.MeshStandardMaterial({ color: 0x6a6f78, roughness: 0.8, flatShading: true }),
    crowd: new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.9, flatShading: true }),
    tape: new THREE.MeshBasicMaterial({ color: 0x3a3a3a }),
    exit: new THREE.MeshBasicMaterial({ color: 0x1bd36a }),
    screen: new THREE.MeshBasicMaterial({ color: 0x28406a }),
  };
  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 24),
    tube: new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
  };

  function buildVenue(v) {
    for (const c of [...venueRoot.children]) {
      c.removeFromParent();
      c.traverse((o) => { if (o.geometry && !Object.values(G).includes(o.geometry)) o.geometry.dispose(); });
    }
    venue = v;
    const add = (geo, mat, sx, sy, sz, x, y, z, parent = venueRoot) => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const { hall, stage: st } = v;
    const zc = (hall.zFront + hall.zBack) / 2, hd = hall.zFront - hall.zBack;
    // hall: box seen from the inside, floor separately
    const hallBox = new THREE.Mesh(G.box, [M.wall, M.wall, M.wall, M.floor, M.wall, M.wall]);
    hallBox.scale.set(hall.w, hall.h, hd);
    hallBox.position.set(0, hall.h / 2, zc);
    venueRoot.add(hallBox);
    for (const s of [-1, 1]) for (const z of [8, 20]) add(G.box, M.exit, 0.04, 0.18, 0.5, s * (hall.w / 2 - 0.03), 3.2, z);

    // stage
    const sd = st.z1 - st.z0, sz = (st.z0 + st.z1) / 2;
    add(G.box, M.deck, st.w, 0.04, sd, 0, st.h - 0.02, sz);
    add(G.box, M.skirt, st.w, st.h - 0.04, sd, 0, (st.h - 0.04) / 2, sz);
    add(G.box, M.tape, st.w, 0.005, 0.05, 0, st.h + 0.002, st.z1 - 0.06);
    // crowd barrier
    const bz = (v.audience?.z0 ?? 6) - 0.9;
    add(G.box, M.black, st.w + 4, 1.1, 0.06, 0, 0.55, bz);
    add(G.box, M.black, st.w + 4, 0.04, 0.8, 0, 0.02, bz - 0.4);
    // backdrop + starcloth
    const bw = st.w + 4;
    add(G.box, M.backdrop, bw, v.backdrop.h, 0.05, 0, v.backdrop.h / 2, v.backdrop.z - 0.03);
    {
      const n = 900, pos = new Float32Array(n * 3), seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * (bw - 0.6);
        pos[i * 3 + 1] = st.h + 0.6 + Math.random() * (v.backdrop.h - st.h - 1);
        pos[i * 3 + 2] = v.backdrop.z + 0.01;
        seed[i] = Math.random();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
      stars = new THREE.Points(g, new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, size: { value: 0 }, pr: { value: 1 }, color: { value: new THREE.Color(0.9, 0.8, 0.65) } },
        vertexShader: PARTICLE_VS.replace("vec3 p = position + vec3(", "vec3 p = position + 0.0 * vec3("),
        fragmentShader: STAR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      stars.material.uniforms.size.value = 26;
      stars.frustumCulled = false;
      venueRoot.add(stars);
    }

    // truss (instanced tubes)
    const mats = [];
    const tube = (x0, y0, z0, x1, y1, z1, r) => {
      _a.set(x0, y0, z0); _b.set(x1, y1, z1);
      const len = _a.distanceTo(_b);
      _n.subVectors(_b, _a).normalize();
      _q.setFromUnitVectors(UP, _n);
      mats.push(new THREE.Matrix4().compose(_a.add(_b).multiplyScalar(0.5), _q, _s.set(r, len, r)));
    };
    const S = 0.4, hs = S / 2, CH = 0.024, LA = 0.011;
    const trussX = (x0, x1, y, z) => {
      for (const dy of [-hs, hs]) for (const dz of [-hs, hs]) tube(x0, y + dy, z + dz, x1, y + dy, z + dz, CH);
      const n = Math.round((x1 - x0) / S);
      for (let i = 0; i < n; i++) {
        const a = x0 + i * S, b = a + S, f = i % 2 ? 1 : -1;
        tube(a, y - hs, z - hs * f, b, y - hs, z + hs * f, LA);
        tube(a, y + hs, z - hs * f, b, y + hs, z + hs * f, LA);
        tube(a, y - hs * f, z - hs, b, y + hs * f, z - hs, LA);
        tube(a, y - hs * f, z + hs, b, y + hs * f, z + hs, LA);
      }
      for (const x of [x0, x1]) for (const dz of [-hs, hs]) tube(x, y - hs, z + dz, x, y + hs, z + dz, CH);
    };
    const trussY = (x, z, y0, y1) => {
      for (const dx of [-hs, hs]) for (const dz of [-hs, hs]) tube(x + dx, y0, z + dz, x + dx, y1, z + dz, CH);
      const n = Math.round((y1 - y0) / S);
      for (let i = 0; i < n; i++) {
        const a = y0 + i * S, b = a + S, f = i % 2 ? 1 : -1;
        tube(x - hs, a, z - hs * f, x - hs, b, z + hs * f, LA);
        tube(x + hs, a, z - hs * f, x + hs, b, z + hs * f, LA);
        tube(x - hs * f, a, z - hs, x + hs * f, b, z - hs, LA);
        tube(x - hs * f, a, z + hs, x + hs * f, b, z + hs, LA);
      }
    };
    for (const t of v.trusses) {
      trussX(t.x0, t.x1, t.y, t.z);
      for (const x of [t.x0 + 1.2, -2.4, 2.4, t.x1 - 1.2]) {
        add(G.box, M.black, 0.26, 0.34, 0.26, x, t.y + hs + 0.45, t.z);
        tube(x, t.y + hs + 0.62, t.z, x, hall.h, t.z, 0.008);
      }
    }
    for (const tw of v.towers) {
      trussY(tw.x, tw.z, 0, tw.h);
      add(G.box, M.black, 1.2, 0.08, 1.2, tw.x, 0.04, tw.z);
      add(G.box, M.black, 0.55, 0.06, 0.55, tw.x, tw.h + 0.03, tw.z);
    }
    const inst = new THREE.InstancedMesh(G.tube, M.truss, mats.length);
    mats.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    venueRoot.add(inst);

    // PA hangs left/right
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * (st.w / 2 + 2.2), 9.6, st.z1 - 0.6);
      g.rotation.y = -s * 0.18;
      let y = 0, ang = 0;
      for (let i = 0; i < 9; i++) {
        const box = add(G.box, M.black, 1.25, 0.34, 0.75, 0, y, 0, g);
        box.rotation.x = ang;
        y -= 0.34 * Math.cos(ang);
        ang += 0.025 + i * 0.012;
      }
      add(G.box, M.black, 1.4, 0.06, 0.9, 0, 0.22, 0, g);
      venueRoot.add(g);
    }

    // drum risers with abstract kits + seated placeholder figures
    for (const r of v.risers) {
      const top = st.h + r.h;
      add(G.box, M.riser, r.w, r.h, r.d, r.x, st.h + r.h / 2, r.z);
      add(G.box, M.tape, r.w, 0.006, 0.04, r.x, top + 0.003, r.z + r.d / 2 - 0.03);
      const kit = new THREE.Group();
      kit.position.set(r.x, top, r.z);
      venueRoot.add(kit);
      const drum = (rad, hgt, x, y, z, rx = 0) => {
        const d = add(G.cyl, M.shell, rad, hgt, rad, x, y, z, kit);
        d.rotation.x = rx;
        const head = add(G.cyl, M.head, rad * 1.01, 0.008, rad * 1.01, 0, 0.5, 0, d);
        head.scale.set(1.01, 0.008 / hgt, 1.01);
        return d;
      };
      const stand = (x, z, h) => add(G.cyl, M.chrome, 0.012, h, 0.012, x, h / 2, z, kit);
      const cym = (rad, x, y, z, tilt) => { stand(x, z, y); add(G.cyl, M.brass, rad, 0.008, rad, x, y, z, kit).rotation.z = tilt; };
      drum(0.29, 0.42, 0, 0.3, 0.45, Math.PI / 2);
      drum(0.17, 0.14, 0.38, 0.62, 0.3, 0.12);
      drum(0.13, 0.18, -0.16, 0.86, 0.38, 0.35);
      drum(0.15, 0.2, 0.18, 0.86, 0.4, 0.35);
      drum(0.21, 0.36, -0.5, 0.4, 0.18);
      cym(0.24, -0.62, 1.22, 0.62, 0.2);
      cym(0.26, 0.66, 1.32, 0.56, -0.2);
      cym(0.17, 0.62, 0.92, 0.12, 0.05);
      add(G.cyl, M.black, 0.17, 0.48, 0.17, 0, 0.24, -0.38, kit);
      figure(kit, 0, 0.48, -0.38, true);
    }
    // keys + mic + standing figure
    if (v.keys) {
      const k = new THREE.Group();
      k.position.set(v.keys.x, st.h, v.keys.z);
      venueRoot.add(k);
      for (const s of [-1, 1]) add(G.box, M.chrome, 0.03, 1.05, 0.03, 0, 0.45, 0, k).rotation.z = s * 0.62;
      add(G.box, M.black, 1.25, 0.09, 0.36, 0, 0.92, 0, k);
      add(G.box, M.head, 1.12, 0.012, 0.15, 0, 0.97, 0.06, k);
      add(G.cyl, M.black, 0.16, 0.015, 0.16, 0.72, 0.008, 0.45, k);
      add(G.cyl, M.chrome, 0.012, 1.45, 0.012, 0.72, 0.73, 0.45, k);
      const boom = add(G.cyl, M.chrome, 0.01, 0.55, 0.01, 0.6, 1.5, 0.35, k);
      boom.rotation.set(-0.6, 0, 0.9);
      add(G.cyl, M.black, 0.022, 0.13, 0.022, 0.42, 1.58, 0.2, k).rotation.x = 1.2;
      figure(k, 0.15, 0, -0.5, false);
      // floor monitors
      for (const x of [-4.5, 0, 4.5]) {
        const m = add(G.box, M.black, 0.75, 0.32, 0.5, x, 0.17, st.z1 - k.position.z - 0.45, k);
        m.rotation.x = -0.45;
      }
    }

    // audience silhouettes (instanced, animated in render)
    {
      const A = v.audience || { z0: 6, z1: 24, rows: 14 };
      const people = [];
      const xmax = hall.w / 2 - 1.2;
      for (let row = 0; row < A.rows; row++) {
        const z = A.z0 + ((A.z1 - A.z0) * row) / Math.max(1, A.rows - 1);
        const gap = 0.52 + row * 0.03;
        for (let x = -xmax; x <= xmax; x += gap * (0.8 + Math.random() * 0.5)) {
          if (Math.abs(x) < 2.8 && z > 16.5 && z < 21.5) continue;
          if (Math.random() < 0.06 + row * 0.012) continue;
          people.push({ x: x + (Math.random() - 0.5) * 0.2, z: z + (Math.random() - 0.5) * 0.5, s: 0.88 + Math.random() * 0.22,
            ph: Math.random(), arms: Math.random() < 0.28, jump: 0.5 + Math.random() * 0.8, rot: (Math.random() - 0.5) * 0.6 });
        }
      }
      const bodyG = new THREE.CapsuleGeometry(0.19, 0.78, 2, 6).translate(0, 0.62, 0);
      const headG = new THREE.IcosahedronGeometry(0.115, 0).translate(0, 1.27, 0);
      const armG = new THREE.CapsuleGeometry(0.045, 0.6, 2, 4);
      const mk = (g, n) => { const im = new THREE.InstancedMesh(g, M.crowd, n); im.frustumCulled = false; venueRoot.add(im); return im; };
      const arms = people.filter((p) => p.arms).length * 2;
      audience = { people, body: mk(bodyG, people.length), head: mk(headG, people.length), arm: mk(armG, Math.max(1, arms)) };
      audience.arm.count = arms;
      animateAudience(0, 0);
    }
    // FOH
    add(G.box, M.black, 4.2, 0.3, 2.6, 0, 0.15, 19);
    add(G.box, M.black, 3.2, 0.8, 1.0, 0, 0.7, 19.2);
    for (const x of [-0.9, 0.2, 1.0]) add(G.box, M.screen, 0.5, 0.3, 0.02, x, 1.3, 18.68).rotation.x = -0.35;

    // haze particles
    {
      const n = 1400, pos = new Float32Array(n * 3), seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * (st.w + 6);
        pos[i * 3 + 1] = 1.4 + Math.random() * 9;
        pos[i * 3 + 2] = st.z0 + Math.random() * (st.z1 - st.z0 + 7);
        seed[i] = Math.random();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
      particles = new THREE.Points(g, new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, size: { value: 34 }, pr: { value: 1 }, color: { value: new THREE.Color(0, 0, 0) } },
        vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      particles.frustumCulled = false;
      venueRoot.add(particles);
    }

    // surfaces for beam truncation / floor spots
    const rect = (axis, val, n, a0, a1, b0, b1, spot = true) => ({ axis, val, n: new THREE.Vector3(...n), a0, a1, b0, b1, spot });
    planes = [
      rect("y", st.h, [0, 1, 0], -st.w / 2, st.w / 2, st.z0, st.z1),
      rect("y", 0, [0, 1, 0], -hall.w / 2, hall.w / 2, hall.zBack, hall.zFront),
      rect("z", v.backdrop.z, [0, 0, 1], -bw / 2, bw / 2, 0, v.backdrop.h),
      rect("y", hall.h, [0, -1, 0], -hall.w / 2, hall.w / 2, hall.zBack, hall.zFront, false),
      rect("z", hall.zFront, [0, 0, -1], -hall.w / 2, hall.w / 2, 0, hall.h, false),
      rect("x", -hall.w / 2, [1, 0, 0], hall.zBack, hall.zFront, 0, hall.h, false),
      rect("x", hall.w / 2, [-1, 0, 0], hall.zBack, hall.zFront, 0, hall.h, false),
      ...v.risers.map((r) => rect("y", st.h + r.h, [0, 1, 0], r.x - r.w / 2, r.x + r.w / 2, r.z - r.d / 2, r.z + r.d / 2)),
    ];
  }

  function figure(parent, x, y, z, seated) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    const cap = (r, l, px, py, pz, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 2, 6), M.figure);
      m.position.set(px, py, pz);
      m.rotation.set(rx, 0, rz);
      g.add(m);
    };
    const hip = seated ? 0.06 : 0.92;
    if (seated) {
      for (const s of [-1, 1]) { cap(0.075, 0.32, s * 0.12, 0.02, 0.2, Math.PI / 2); cap(0.065, 0.36, s * 0.13, -0.24, 0.38); }
    } else for (const s of [-1, 1]) cap(0.08, 0.72, s * 0.11, 0.46, 0);
    cap(0.17, 0.42, 0, hip + 0.34, 0);
    for (const s of [-1, 1]) cap(0.055, 0.5, s * 0.25, hip + 0.4, 0.14, -0.7, s * 0.15);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), M.figure);
    head.position.set(0, hip + 0.86, 0);
    g.add(head);
  }

  const _o3 = new THREE.Object3D();
  function animateAudience(beat, energy) {
    if (!audience) return;
    const { people, body, head, arm } = audience;
    let ai = 0;
    const e = clamp((energy - 0.35) * 1.8);
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const ph = (beat + p.ph * 0.25) % 1;
      const dy = e * p.jump * 0.16 * Math.pow(Math.max(0, Math.sin(ph * Math.PI)), 2);
      _o3.position.set(p.x, dy, p.z);
      _o3.rotation.set(0, p.rot, 0);
      _o3.scale.setScalar(p.s);
      _o3.updateMatrix();
      body.setMatrixAt(i, _o3.matrix);
      head.setMatrixAt(i, _o3.matrix);
      if (p.arms) {
        for (const s of [-1, 1]) {
          _o3.position.set(p.x + s * 0.2 * p.s, dy + 1.38 * p.s, p.z);
          _o3.rotation.set(0, p.rot, s * (-0.35 - e * 0.25 * Math.sin(ph * Math.PI)));
          _o3.updateMatrix();
          arm.setMatrixAt(ai++, _o3.matrix);
        }
      }
    }
    body.instanceMatrix.needsUpdate = head.instanceMatrix.needsUpdate = arm.instanceMatrix.needsUpdate = true;
  }

  // nearest surface hit along a ray (origin, unit dir) within max metres
  const hitRes = { d: 0, n: new THREE.Vector3(), spot: false };
  const AX = { x: 0, y: 1, z: 2 };
  function hit(o, d, max) {
    let best = max, bp = null;
    const oa = [o.x, o.y, o.z], da = [d.x, d.y, d.z];
    for (const p of planes) {
      const i = AX[p.axis], dd = da[i];
      if (Math.abs(dd) < 1e-5) continue;
      const t = (p.val - oa[i]) / dd;
      if (t < 0.05 || t >= best) continue;
      if (p.n.getComponent(i) * dd > 0) continue; // only front faces
      const ia = i === 0 ? 2 : 0, ib = i === 1 ? 2 : 1;
      const a = oa[ia] + da[ia] * t, b = oa[ib] + da[ib] * t;
      if (a < p.a0 || a > p.a1 || b < p.b0 || b > p.b1) continue;
      best = t; bp = p;
    }
    if (!bp) return null;
    hitRes.d = best;
    hitRes.n.copy(bp.n);
    hitRes.spot = bp.spot;
    return hitRes;
  }

  /* ------------------------------------------------------------------ fixtures + labels */
  function buildFixtures() {
    for (const o of objs.values()) o.dispose();
    objs.clear();
    for (const c of [...labelRoot.children]) { c.removeFromParent(); c.material.map.dispose(); c.material.dispose(); }
    for (const f of state.show.fixtures) {
      const def = getType(f.type);
      if (!def) continue;
      const o = createFixtureObject(f, def);
      fixRoot.add(o.object);
      objs.set(f.id, o);
    }
    proxies = [...objs.values()].map((o) => o.proxy);
    applySelection(state.programmer.selection);
    if (labelsOn) buildLabels();
  }
  function buildLabels() {
    if (labelRoot.children.length) return;
    for (const o of objs.values()) {
      const cv = document.createElement("canvas");
      cv.width = 96; cv.height = 40;
      const g = cv.getContext("2d");
      g.fillStyle = "rgba(11,13,16,.82)";
      g.beginPath(); g.roundRect(2, 4, 92, 32, 6); g.fill();
      g.fillStyle = "#e6edf5";
      g.font = "600 22px ui-monospace, Menlo, monospace";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(String(o.fixture.fid), 48, 21);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false, toneMapped: false, fog: false }));
      s.scale.set(0.048, 0.02, 1);
      const p = o.fixture.pos;
      s.position.set(p[0], p[1] + (o.fixture.mount === "hang" ? -0.85 : 0.75), p[2]);
      s.renderOrder = 1000;
      labelRoot.add(s);
    }
  }
  function applySelection(ids) {
    const set = new Set(ids || []);
    for (const [id, o] of objs) o.setSelected(set.has(id));
  }

  /* ------------------------------------------------------------------ camera */
  function setCamera(id, animate = true) {
    const v = VIEWS[id];
    if (!v) return; // "free": keep the current view
    const to = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target), fov: v.fov };
    if (!animate) {
      tween = null;
      camera.position.copy(to.pos);
      controls.target.copy(to.target);
      camera.fov = to.fov;
      camera.updateProjectionMatrix();
      controls.update();
      return;
    }
    tween = { from: { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov }, to, k: 0, dur: 1.1 };
  }
  function stepTween(dt) {
    if (!tween) return;
    tween.k = Math.min(1, tween.k + dt / tween.dur);
    const e = ease(tween.k), { from, to } = tween;
    camera.position.lerpVectors(from.pos, to.pos, e);
    controls.target.lerpVectors(from.target, to.target, e);
    camera.fov = from.fov + (to.fov - from.fov) * e;
    camera.updateProjectionMatrix();
    if (tween.k >= 1) tween = null;
  }

  /* ------------------------------------------------------------------ input: orbit vs. click-pick */
  let down = null, dragged = false, userOrbit = false;
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, id: e.pointerId }; dragged = false; });
  canvas.addEventListener("pointermove", (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) dragged = true;
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!down) return;
    const click = !dragged && e.button === 0;
    down = null;
    if (!click) return;
    const id = pick(e.clientX, e.clientY);
    if (id) state.select([id], e.shiftKey ? "toggle" : "set");
    else if (!e.shiftKey) state.clearSelection();
  });
  canvas.addEventListener("wheel", () => { dragged = true; }, { passive: true });
  controls.addEventListener("start", () => { userOrbit = true; });
  controls.addEventListener("end", () => { userOrbit = false; });
  controls.addEventListener("change", () => {
    if (!userOrbit || !dragged) return;
    tween = null;
    if (state.ui.camera !== "free") state.setUI("camera", "free");
  });

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(proxies, false);
    return hits.length ? hits[0].object.userData.fixtureId : null;
  }

  /* ------------------------------------------------------------------ sizing / quality */
  function applyQuality() {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "hoch" ? 1.5 : 1));
    if (particles) particles.visible = quality !== "niedrig";
    resize();
  }
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  ro?.observe(container);
  window.addEventListener("resize", resize);

  /* ------------------------------------------------------------------ state wiring */
  state.on("show:changed", ({ scope } = {}) => {
    if (scope === "all" || !scope) { buildVenue(state.show.venue); buildFixtures(); }
    else if (scope === "patch") buildFixtures();
  });
  state.on("selection:changed", ({ ids }) => applySelection(ids));
  state.on("ui:changed", ({ key, value }) => {
    if (key === "camera") setCamera(value);
    else if (key === "beams") beams = !!value;
    else if (key === "labels") { labelsOn = !!value; if (labelsOn) buildLabels(); labelRoot.visible = labelsOn; }
    else if (key === "haze") hazeUi = +value || 0;
    else if (key === "quality") { quality = value; applyQuality(); }
  });

  /* ------------------------------------------------------------------ render */
  const opts = { haze: 1, beams: true, spots: true, time: 0, cam: camera.position, hit };
  let lastT = null;
  function render(frame, dt) {
    if (dt === undefined || !(dt >= 0)) {
      const now = performance.now() / 1000;
      dt = lastT === null ? 1 / 60 : now - lastT;
      lastT = now;
    }
    dt = Math.min(dt, 0.1);
    wall += dt;
    stepTween(dt);
    controls.update();
    frame = frame || lastFrame;
    lastFrame = frame;
    const t = frame?.t ?? 0;
    const attrs = frame?.attrs || {};

    // global light + haze from the frame
    let fr = 0, fg = 0, fb = 0, br = 0, bgc = 0, bb = 0, fl = 0, hz = 0, hazers = 0;
    for (const [id, o] of objs) {
      const a = attrs[id], d = o.def;
      if (!a) continue;
      if (d.caps.haze) { hz = Math.max(hz, a.dim); hazers++; continue; }
      if (!d.beam || d.caps.laser) continue;
      const open = !(a.strobe > 0) || ((t * a.strobe) % 1) < 0.3;
      const lv = open ? a.dim * d.beam.power : 0;
      if (lv <= 0.001) continue;
      if (d.category === "strobe" || d.category === "blinder") { fl += lv * (d.category === "strobe" ? 1 : 0.8); continue; }
      const w = a.w || 0;
      let r = Math.min(1, a.r + w), g = Math.min(1, a.g + w), b = Math.min(1, a.b + w);
      if (a.pixels) {
        r = g = b = 0;
        for (const p of a.pixels) { r += p.r * p.dim / 8; g += p.g * p.dim / 8; b += p.b * p.dim / 8; }
      }
      if (o.fixture.pos[2] > 2.5) { fr += r * lv; fg += g * lv; fb += b * lv; }
      else { br += r * lv; bgc += g * lv; bb += b * lv; }
    }
    if (!hazers) hz = 0.5;
    hazeLevel += (hz - hazeLevel) * Math.min(1, dt * 0.35);
    const hazeEff = clamp(hazeUi * (0.45 + 0.9 * hazeLevel), 0, 1.4);
    const mf = Math.max(fr, fg, fb, 1e-4), mb = Math.max(br, bgc, bb, 1e-4);
    front.color.setRGB(fr / mf, fg / mf, fb / mf);
    front.intensity = Math.sqrt(Math.min(mf, 6)) * 70;
    back.color.setRGB(br / mb, bgc / mb, bb / mb);
    back.intensity = Math.sqrt(Math.min(mb, 8)) * 55;
    flash.intensity = Math.sqrt(Math.min(fl, 8)) * 30;
    scene.fog.density = 0.008 + 0.012 * hazeEff;

    opts.haze = hazeEff;
    opts.beams = beams;
    opts.time = wall;
    camera.updateMatrixWorld();
    for (const [id, o] of objs) o.update(attrs[id], t, opts);

    if (particles) {
      const u = particles.material.uniforms;
      const sum = (mf + mb) || 1;
      u.color.value.setRGB((fr + br) / sum, (fg + bgc) / sum, (fb + bb) / sum).multiplyScalar(0.05 * hazeEff * Math.min(1, (mf + mb) * 0.25 + 0.15));
      u.time.value = wall;
      u.pr.value = renderer.getPixelRatio();
    }
    if (stars) { stars.material.uniforms.time.value = wall; stars.material.uniforms.pr.value = renderer.getPixelRatio(); }
    animateAudience(frame?.beat ?? 0, frame?.env?.rms ?? 0);
    renderer.render(scene, camera);
  }

  /* ------------------------------------------------------------------ init */
  buildVenue(state.show.venue);
  buildFixtures();
  labelRoot.visible = labelsOn;
  applyQuality();
  setCamera(VIEWS[state.ui.camera] ? state.ui.camera : "foh", false);

  return {
    renderer, scene, camera, controls, objects: objs,
    render, setCamera, resize, pick,
    dispose() {
      ro?.disconnect();
      window.removeEventListener("resize", resize);
      for (const o of objs.values()) o.dispose();
      controls.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

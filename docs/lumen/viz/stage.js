// LUMEN stage visualiser: hall, stage, truss, towers, drum riser, band placeholders (drummer, frontman, piano), audience, haze,
// camera presets, picking. Draws only from the engine frame (viz.render(frame, dt)).

import * as THREE from "../vendor/three.module.min.js";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { getType, clamp, beamDirection } from "../core/fixtures.js";
import { createFixtureObject, FXU, VIZU, GLSL_OUT } from "./fixtures3d.js";
import { bandSpots } from "../core/state.js";

export const CAMERAS = [
  { id: "foh", name: "FOH" }, { id: "front", name: "Front" }, { id: "top", name: "Draufsicht" },
  { id: "side", name: "Seite" }, { id: "drums", name: "Drums" }, { id: "free", name: "Frei" },
  { id: "auto", name: "Show" },
];
const VIEWS = {
  foh: { pos: [0, 5.4, 21.5], target: [0, 4.6, 0], fov: 44 },
  front: { pos: [1.2, 2.3, 9.8], target: [0, 4.6, -1], fov: 60 },
  top: { pos: [0, 22, 6.5], target: [0, 1.2, 0.6], fov: 48 },
  side: { pos: [-16.5, 3.2, 2.5], target: [0.5, 4.6, -0.6], fov: 50 },
  drums: { pos: [3.0, 7.0, 0.9], target: [-0.2, 3.3, -1.8], fov: 42, orbit: 0.02 }, // high: the frontman stays below frame
};
// Show-camera shots (also valid as cue.camera, like the VIEWS ids). drift: pos/target velocity in m/s,
// orbit: rad/s around the target's vertical axis.
export const SHOTS = {
  ...VIEWS,
  wide: { pos: [0, 7.6, 27.5], target: [0, 4.4, 0], fov: 46, drift: [0, -0.12, -0.35] },
  crowd: { pos: [-2.6, 2.35, 13.5], target: [0, 5.6, 0], fov: 58, drift: [0.22, 0, -0.06] },
  crowdR: { pos: [3.4, 2.5, 16], target: [-0.5, 5.2, 0], fov: 52, drift: [-0.2, 0.02, -0.1] },
  pit: { pos: [0.4, 1.6, 5.3], target: [0, 7.3, -2], fov: 74, drift: [-0.18, 0, 0] }, // tilted up: floor fixtures stay below frame
  singer: { pos: [1.5, 3.0, 7.0], target: [0, 2.7, 2.0], fov: 30, drift: [-0.05, 0, -0.05], follow: true }, // follows the frontman
  piano: { pos: [2.2, 2.9, 4.6], target: [3.1, 2.1, 0.45], fov: 40, drift: [0.04, 0, -0.04] },
  sideL: { pos: [-9.6, 4.4, 6.2], target: [0.5, 4.6, -0.8], fov: 56, drift: [0, 0, -0.22] },
  sideR: { pos: [9.6, 4.4, 6.2], target: [-0.5, 4.6, -0.8], fov: 56, drift: [0, 0, -0.22] },
  back: { pos: [0, 5.2, -4.2], target: [0, 3.6, 14], fov: 72, drift: [0.12, 0, 0] },
  crane: { pos: [0, 12.5, 15], target: [0, 2.4, 0.5], fov: 54, drift: [0, -0.18, -0.25] },
  orbit: { pos: [0, 5.5, 17], target: [0, 4.2, 0], fov: 50, orbit: 0.07 },
};
// old shot names (two drum risers) → current shots
export const SHOT_ALIASES = { drumsL: "drums", drumsR: "drums" };
// shot pools by section energy (mean rms of the section): bars per cut + candidates ("piano" only by cue)
const POOLS = [
  { max: 0.38, bars: 8, shots: ["wide", "crane", "orbit", "foh", "singer", "crowd"] },
  { max: 0.8, bars: 4, shots: ["foh", "crowd", "sideL", "drums", "crane", "sideR", "singer", "crowdR"] },
  { max: 9, bars: 2, shots: ["crowd", "pit", "drums", "back", "sideR", "wide", "singer", "crowdR", "sideL", "crane", "drums", "back"] },
];

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
${GLSL_OUT}
void main() {
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  gl_FragColor = vec4(outc(color * vA * smoothstep(0.5, 0.0, r)), 1.0);
}`;
const STAR_VS = /* glsl */ `
uniform float time, size, pr, kick;
attribute float seed;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float sp = step(0.86, fract(seed * 37.0 + floor(time * 7.0) * 0.618)) * kick;
  vA = (0.5 + 0.5 * sin(time * (0.5 + seed * 2.2) + seed * 20.0)) * 0.8 + sp * 0.6;
  gl_PointSize = min(size * pr * (0.6 + seed) * (1.0 + sp * 1.6) / -mv.z, 12.0 * pr);
  gl_Position = projectionMatrix * mv;
}`;
const STAR_FS = /* glsl */ `
uniform vec3 color;
varying float vA;
${GLSL_OUT}
void main() {
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  // ≤ 0.85 display → linear ≤ 0.7: never crosses the bloom threshold (sub-pixel HDR dots bloom into boxes)
  gl_FragColor = vec4(outc(min(color * (0.25 + 0.75 * vA * vA) * smoothstep(0.5, 0.1, r), vec3(uLin > 0.5 ? 0.85 : 1.0))), 1.0);
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
  // strobe / blinder white-out + vignette (DOM overlays: cost nothing, work with and without bloom)
  const overlay = (css) => { const d = document.createElement("div"); Object.assign(d.style, { position: "absolute", inset: "0", pointerEvents: "none", ...css }); return d; };
  const vignette = overlay({ background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,.42) 100%)" });
  const flashEl = overlay({ background: "radial-gradient(ellipse 80% 70% at 50% 32%, #fff 0%, rgba(255,250,240,.55) 40%, rgba(255,245,230,.08) 100%)", opacity: "0", mixBlendMode: "screen" });
  canvas.after(vignette, flashEl);

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
  const flash = new THREE.PointLight(0xffffff, 0, 16, 1.4);
  flash.position.set(0, 8.4, 2.5);
  // audience light: blinders, strobes and every beam aimed into the crowd
  const crowdL = new THREE.SpotLight(0xffffff, 0, 0, 0.78, 0.7, 1.2);
  crowdL.position.set(0, 9, 4.2);
  crowdL.target.position.set(0, 1, 15);
  scene.add(hemi, front, front.target, back, back.target, flash, crowdL, crowdL.target);

  const venueRoot = new THREE.Group(), fixRoot = new THREE.Group(), labelRoot = new THREE.Group();
  scene.add(venueRoot, fixRoot, labelRoot);
  const objs = new Map();
  let proxies = [];
  let venue = null, planes = [], audience = null, particles = null, stars = null, band = null;
  let beams = state.ui.beams !== false, labelsOn = !!state.ui.labels, hazeUi = state.ui.haze ?? 0.55, quality = state.ui.quality || "hoch";
  let bloomOn = state.ui.bloom !== false, flashOn = state.ui.flash !== false;
  // white-out level: smoothed strobe light (never the shutter phase), ≤ 3 sharp rises per second
  const wo = { s: 0, last: -1, pk: 0 };
  let hazeLevel = 0.5, wall = 0, tween = null, lastFrame = null;

  // LED fascia panel: dot grid with a soft top-to-bottom falloff, so a white fascia reads as LED, not as a lit slab
  function ledTexture() {
    const cv = document.createElement("canvas");
    cv.width = 64; cv.height = 128;
    const g = cv.getContext("2d");
    g.fillStyle = "#1c1c1c";
    g.fillRect(0, 0, 64, 128);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) {
      const cx = x * 8 + 4, cy = y * 8 + 4, k = 1 - 0.35 * (y / 15), rg = g.createRadialGradient(cx, cy, 0, cx, cy, 3.6);
      rg.addColorStop(0, `rgba(255,255,255,${k})`); rg.addColorStop(0.55, `rgba(255,255,255,${0.75 * k})`); rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg;
      g.fillRect(x * 8, y * 8, 8, 8);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /* ------------------------------------------------------------------ bloom post-processing (lazy, optional) */
  let post = null;
  const PP = "../vendor/postprocessing/";
  Promise.all(["EffectComposer", "RenderPass", "UnrealBloomPass", "OutputPass"].map((n) => import(`${PP}${n}.js`)))
    .then(([{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }]) => {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
      const composer = new EffectComposer(renderer, rt);
      composer.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 1.05);
      // firefly clamp on the bloom input: a few-pixel HDR highlight cannot blow up into a square halo
      const hp = bloom.materialHighPassFilter;
      hp.fragmentShader = hp.fragmentShader.replace("vec4 texel = texture2D( tDiffuse, vUv );", "vec4 texel = min( texture2D( tDiffuse, vUv ), vec4( 4.0 ) );");
      hp.needsUpdate = true;
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      post = { composer, bloom };
      resize();
      prewarm();
    })
    .catch((e) => console.warn("[lumen] bloom unavailable", e));
  const usePost = () => !!post && bloomOn && quality !== "niedrig";

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
    // satin, not mirror: a mirror-chrome hoop reflects the back / flash light as a few-pixel HDR spot that blooms into a square
    chrome: new THREE.MeshStandardMaterial({ color: 0xb8bec8, roughness: 0.5, metalness: 1 }),
    brass: new THREE.MeshStandardMaterial({ color: 0x9a7a3c, roughness: 0.55, metalness: 1 }),
    figure: new THREE.MeshStandardMaterial({ color: 0x6a6f78, roughness: 0.8, flatShading: true }),
    piano: new THREE.MeshStandardMaterial({ color: 0x34363e, roughness: 0.24, metalness: 0.2 }),
    keys: new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.45 }),
    rug: new THREE.MeshStandardMaterial({ color: 0x241619, roughness: 1 }),
    fasciaL: new THREE.MeshBasicMaterial({ color: 0x030303, map: ledTexture() }), // LED fascia halves, colour set per frame
    fasciaR: null,
    figDrum: null, figFront: null, // own copies of the figure material: beams that hit them glow (emissive)
    crowd: new THREE.MeshStandardMaterial({ color: 0x1a1c21, roughness: 0.8, flatShading: true }),
    tape: new THREE.MeshBasicMaterial({ color: 0x3a3a3a }),
    exit: new THREE.MeshBasicMaterial({ color: 0x1bd36a }),
    screen: new THREE.MeshBasicMaterial({ color: 0x28406a }),
  };
  M.fasciaR = M.fasciaL.clone();
  M.figDrum = M.figure.clone();
  M.figFront = M.figure.clone();
  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 24),
    tube: new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
    ring: new THREE.CylinderGeometry(1, 1, 1, 24, 1, true),
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
      const n = 1500, pos = new Float32Array(n * 3), seed = new Float32Array(n);
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
        uniforms: { time: { value: 0 }, size: { value: 0 }, pr: { value: 1 }, kick: { value: 0 }, color: { value: new THREE.Color(0.9, 0.8, 0.65) }, uLin: VIZU.uLin },
        vertexShader: STAR_VS,
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

    // band: one drum riser (LED fascia, kit, seated drummer), frontman at the mic, grand piano stage left
    buildBand(v, add);

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
        uniforms: { time: { value: 0 }, size: { value: 34 }, pr: { value: 1 }, color: { value: new THREE.Color(0, 0, 0) }, uLin: VIZU.uLin },
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
      ...(v.risers || []).flatMap((r) => [
        rect("y", st.h + r.h, [0, 1, 0], r.x - r.w / 2, r.x + r.w / 2, r.z - r.d / 2, r.z + r.d / 2),
        rect("z", r.z + r.d / 2, [0, 0, 1], r.x - r.w / 2, r.x + r.w / 2, st.h, st.h + r.h), // fascia
      ]),
    ];
  }

  /* ------------------------------------------------------------------ band: riser + kit + drummer, mic, piano, frontman */
  // Generic low-poly placeholders only. The frontman walks between mic and piano (cue.performer, frame.performer*).
  function buildBand(v, add) {
    const st = v.stage, B = bandSpots(v);
    band = { B, fascia: [], drummer: null, singer: null, pianist: null };
    for (const r of v.risers || []) {
      const top = st.h + r.h, fz = r.z + r.d / 2;
      add(G.box, M.riser, r.w, r.h, r.d, r.x, st.h + r.h / 2, r.z);
      add(G.box, M.tape, r.w, 0.006, 0.04, r.x, top + 0.003, fz - 0.03);
      add(G.box, M.black, r.w + 0.04, 0.06, 0.04, r.x, top - 0.03, fz + 0.01); // top lip
      // LED fascia: 8 panels, left / right half follow the fascia group's fixtures on that side
      const n = 8, pw = (r.w - 0.12) / n;
      for (let i = 0; i < n; i++) {
        const x = r.x - r.w / 2 + 0.06 + pw * (i + 0.5);
        add(G.box, x < r.x ? M.fasciaL : M.fasciaR, pw - 0.035, r.h - 0.2, 0.02, x, st.h + (r.h - 0.06) / 2, fz + 0.012);
      }
      if (r.fascia) band.fascia.push({ group: r.fascia, x: r.x });
      // stairs on the stage-right side, upstage end
      for (let k = 1; k <= 3; k++) add(G.box, M.riser, 0.32, (r.h * k) / 4, 0.9, r.x - r.w / 2 - 0.16 - (3 - k) * 0.32, st.h + (r.h * k) / 8, r.z - r.d / 2 + 0.55);
      if (r.kit && r === B.riser) buildKit(add, B);
    }
    // mic stand + standing frontman (walks to the piano and back)
    {
      const m = new THREE.Group();
      m.position.set(B.mic.x, st.h, B.mic.z);
      venueRoot.add(m);
      add(G.cyl, M.black, 0.15, 0.02, 0.15, 0, 0.01, 0, m);
      const pole = add(G.cyl, M.chrome, 0.011, 1.5, 0.011, 0, 0.75, -0.04, m);
      pole.rotation.x = -0.05;
      add(G.cyl, M.black, 0.024, 0.16, 0.024, 0, 1.55, -0.12, m).rotation.x = -1.1; // mic
      band.singer = person(M.figFront);
      venueRoot.add(band.singer.g);
      // floor wedges for the singer
      for (const s of [-1, 1]) add(G.box, M.black, 0.62, 0.3, 0.46, B.mic.x + s * 0.55, st.h + 0.16, st.z1 - 0.75).rotation.x = -0.45;
    }
    // grand piano (local +x = player looks, +z = player's right = treble side, lid opens to the audience)
    {
      const p = new THREE.Group();
      p.position.set(B.piano.x, st.h, B.piano.z);
      p.rotation.y = (-B.piano.yaw * Math.PI) / 180;
      venueRoot.add(p);
      const outline = [[0.12, -0.74], [1.78, -0.74], [1.86, -0.62], [1.82, -0.42], [1.6, -0.18], [1.3, 0.12], [1.02, 0.45], [0.76, 0.68], [0.5, 0.76], [0.12, 0.76]];
      const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
      const slab = (h) => new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2);
      const body = new THREE.Mesh(slab(0.3), M.piano);
      body.position.y = 0.66;
      const lid = new THREE.Mesh(slab(0.025), M.piano);
      const hinge = new THREE.Group(); // hinge along the bass side (z = -0.74)
      hinge.position.set(0, 0.97, -0.74);
      hinge.rotation.x = -0.42;
      lid.position.z = 0.74;
      hinge.add(lid);
      p.add(body, hinge);
      add(G.cyl, M.chrome, 0.009, 0.5, 0.009, 0.85, 1.22, 0.5, p); // lid prop
      for (const [x, z] of [[0.3, -0.62], [0.3, 0.62], [1.62, -0.52]]) add(G.cyl, M.piano, 0.045, 0.66, 0.045, x, 0.33, z, p);
      add(G.box, M.piano, 0.16, 0.2, 0.06, 0.32, 0.12, 0, p); // pedal lyre
      add(G.box, M.piano, 0.34, 0.1, 1.56, -0.03, 0.64, 0, p); // key bed
      add(G.box, M.keys, 0.15, 0.03, 1.4, -0.11, 0.705, 0, p); // white keys
      add(G.box, M.black, 0.08, 0.035, 1.4, -0.0, 0.72, 0, p); // black keys
      add(G.box, M.piano, 0.08, 0.14, 1.56, 0.06, 0.78, 0, p); // fallboard
      add(G.box, M.piano, 0.3, 0.28, 0.06, -0.03, 0.62, -0.78, p); // cheeks
      add(G.box, M.piano, 0.3, 0.28, 0.06, -0.03, 0.62, 0.78, p);
      // bench
      add(G.box, M.piano, 0.36, 0.06, 0.8, -0.62, 0.47, 0, p);
      for (const [x, z] of [[-0.76, -0.34], [-0.76, 0.34], [-0.48, -0.34], [-0.48, 0.34]]) add(G.box, M.piano, 0.04, 0.45, 0.04, x, 0.225, z, p);
      // seated pianist (hidden until he sits down)
      const sp = new THREE.Group();
      sp.position.set(-0.6, 0.5, 0);
      sp.rotation.y = Math.PI / 2;
      p.add(sp);
      band.pianist = figure(sp, 0, 0, 0, true, -0.92, M.figFront);
      band.pianist.g.visible = false;
    }
  }

  function buildKit(add, B) {
    const kit = new THREE.Group();
    kit.position.set(B.kit.x, B.kit.y, B.kit.z);
    venueRoot.add(kit);
    add(G.box, M.rug, 2.6, 0.012, 2.2, 0, 0.006, -0.05, kit);
    const drum = (rad, hgt, x, y, z, rx = 0) => {
      const d = add(G.cyl, M.shell, rad, hgt, rad, x, y, z, kit);
      d.rotation.x = rx;
      for (const s of [-1, 1]) add(G.cyl, M.head, 1.01, 0.01 / hgt, 1.01, 0, s * 0.5, 0, d);
      add(G.ring, M.chrome, 1.02, 0.04 / hgt, 1.02, 0, 0.47, 0, d); // hoop (open ring)
      return d;
    };
    const stand = (x, z, h) => {
      add(G.cyl, M.chrome, 0.012, h, 0.012, x, h / 2, z, kit);
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI * 2) / 3 + 0.4, leg = add(G.cyl, M.chrome, 0.008, 0.36, 0.008, x + Math.sin(a) * 0.12, 0.14, z + Math.cos(a) * 0.12, kit);
        leg.rotation.set(Math.cos(a) * 0.75, 0, -Math.sin(a) * 0.75);
      }
    };
    const cym = (rad, x, y, z, rx, rz) => {
      stand(x, z, y);
      const c = add(G.cyl, M.brass, rad, 0.01, rad, x, y + 0.01, z, kit);
      c.rotation.set(rx, 0, rz);
      add(G.cyl, M.brass, 0.05 / rad, 3, 0.05 / rad, 0, 1.5, 0, c); // bell
    };
    drum(0.3, 0.46, 0, 0.31, 0.3, Math.PI / 2); // kick (front head to the audience)
    add(G.box, M.black, 0.1, 0.06, 0.24, 0, 0.03, -0.04, kit); // pedal
    drum(0.18, 0.15, 0.3, 0.64, -0.06, -0.14); // snare
    stand(0.3, -0.06, 0.56);
    drum(0.14, 0.2, 0.17, 0.9, 0.3, -0.42); // rack toms on the kick
    drum(0.16, 0.22, -0.2, 0.92, 0.31, -0.42);
    add(G.cyl, M.chrome, 0.016, 0.26, 0.016, 0, 0.72, 0.3, kit);
    const ft = drum(0.22, 0.38, -0.58, 0.44, -0.04); // floor tom
    for (const [dx, dz] of [[-0.2, -0.12], [0.18, -0.14], [0, 0.22]]) add(G.cyl, M.chrome, 0.009, 0.3, 0.009, ft.position.x + dx, 0.15, ft.position.z + dz, kit);
    // hi-hat (two cymbals), crash left / right, ride
    stand(0.66, -0.12, 0.92);
    add(G.cyl, M.brass, 0.18, 0.012, 0.18, 0.66, 0.92, -0.12, kit);
    add(G.cyl, M.brass, 0.18, 0.012, 0.18, 0.66, 0.945, -0.12, kit);
    cym(0.25, 0.74, 1.36, 0.42, -0.3, -0.2);
    cym(0.27, -0.6, 1.44, 0.48, -0.3, 0.22);
    cym(0.31, -0.88, 1.08, 0.04, -0.15, 0.28);
    // throne + drummer
    add(G.cyl, M.chrome, 0.02, 0.46, 0.02, 0, 0.23, -0.42, kit);
    add(G.cyl, M.black, 0.19, 0.08, 0.19, 0, 0.46, -0.42, kit);
    band.drummer = figure(kit, 0, 0.5, -0.42, true, -0.8, M.figDrum);
  }

  // seated placeholder: thighs forward (+z), arms on shoulder pivots (rotation.x < 0 = forward)
  function figure(parent, x, y, z, seated, arm = -0.7, mat = M.figure) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    const cap = (r, l, px, py, pz, rx = 0, rz = 0, to = g) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 2, 6), mat);
      m.position.set(px, py, pz);
      m.rotation.set(rx, 0, rz);
      to.add(m);
      return m;
    };
    const hip = seated ? 0.06 : 0.92;
    if (seated) {
      for (const s of [-1, 1]) { cap(0.075, 0.34, s * 0.12, 0.02, 0.2, Math.PI / 2); cap(0.065, 0.36, s * 0.13, -0.24, 0.4); }
    } else for (const s of [-1, 1]) cap(0.08, 0.72, s * 0.11, 0.46, 0);
    cap(0.17, 0.42, 0, hip + 0.34, 0);
    const arms = [-1, 1].map((s) => {
      const p = new THREE.Group();
      p.position.set(s * 0.24, hip + 0.62, 0.02);
      p.rotation.set(arm, 0, s * 0.12);
      g.add(p);
      cap(0.055, 0.5, 0, -0.3, 0, 0, 0, p);
      return p;
    });
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), mat);
    head.position.set(0, hip + 0.86, 0);
    g.add(head);
    return { g, arms, head, arm };
  }

  // standing frontman: legs on hip pivots and arms on shoulder pivots (walk cycle), positioned per frame
  function person(mat = M.figure) {
    const g = new THREE.Group();
    const cap = (r, l, px, py, pz, to) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 2, 6), mat);
      m.position.set(px, py, pz);
      to.add(m);
      return m;
    };
    const piv = (x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); g.add(p); return p; };
    const legs = [-1, 1].map((s) => { const p = piv(s * 0.11, 0.92); cap(0.08, 0.7, 0, -0.45, 0, p); return p; });
    cap(0.17, 0.42, 0, 1.26, 0, g);
    // arms: upper arm on the shoulder pivot, forearm on an elbow pivot (rotation.x < 0 = forward / up)
    const arms = [-1, 1].map((s) => {
      const p = piv(s * 0.24, 1.54), e = new THREE.Group();
      p.rotation.order = "YXZ"; // swing forward first, then turn inward
      p.rotation.z = s * 0.1;
      cap(0.055, 0.2, 0, -0.16, 0, p);
      e.position.y = -0.32;
      p.add(e);
      cap(0.05, 0.2, 0, -0.15, 0, e);
      p.userData.elbow = e;
      return p;
    });
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), mat);
    head.position.set(0, 1.78, 0);
    g.add(head);
    return { g, legs, arms, head };
  }

  // frontman at song time: place from frame.performer* (deterministic: scrubbing shows the same walk)
  const WALK = 1.3; // m/s
  const lerpAng = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
  const fm = { x: 0, y: 0, z: 0, seated: false };
  function frontmanAt(frame) {
    const B = band?.B;
    if (!B) return fm;
    const spot = (p) => (p === "piano" ? B.pianoWalk : B.singer);
    const to = frame?.performer === "piano" ? "piano" : "mic", from = frame?.performerFrom === "piano" ? "piano" : "mic";
    const t = frame?.t ?? 0, a = spot(from), b = spot(to);
    const dx = b.x - a.x, dz = b.z - a.z, dist = Math.hypot(dx, dz);
    const start = (frame?.performerTime ?? 0) + (from === "piano" ? 0.35 : 0), W = dist / WALK;
    const p = from === to || !W ? 1 : clamp((t - start) / W);
    const pe = p * p * (3 - 2 * p);
    fm.x = a.x + dx * pe; fm.z = a.z + dz * pe;
    fm.p = p; fm.moving = p > 0 && p < 1;
    fm.dist = dist * pe;
    fm.dir = Math.atan2(dx, dz);
    fm.seated = (to === "piano" && t >= start + W + 0.25) || (from === "piano" && to !== "piano" && t < start);
    fm.yaw = to === "piano" && p >= 1 ? fm.dir : lerpAng(lerpAng(0, fm.dir, smooth01(p / 0.15)), 0, smooth01((p - 0.82) / 0.18));
    // head position (camera follow): standing head vs. seated at the bench
    fm.y = B.SH + (fm.seated ? 1.42 : 1.78);
    if (fm.seated) { fm.x = B.bench.x; fm.z = B.bench.z; }
    return fm;
  }
  const smooth01 = (k) => { k = clamp(k); return k * k * (3 - 2 * k); };
  function animateBand(frame) {
    if (!band) return;
    const f = frontmanAt(frame), s = band.singer;
    if (s) {
      s.g.visible = !f.seated;
      s.g.position.set(f.x, band.B.SH, f.z);
      s.g.rotation.y = f.yaw;
      const sw = f.moving ? Math.sin((f.dist / 0.7) * Math.PI) * 0.5 * Math.min(1, Math.sin(f.p * Math.PI) * 3) : 0;
      s.legs[0].rotation.x = sw; s.legs[1].rotation.x = -sw;
      const atMic = !f.moving && f.p >= 1 && frame?.performer !== "piano";
      s.arms[0].rotation.x = -sw * 0.8 - (atMic ? 0.15 : 0);
      s.arms[0].userData.elbow.rotation.x = -0.25;
      // one hand up at the mic, the other relaxed
      s.arms[1].rotation.set(sw * 0.8 - (atMic ? 0.5 : 0), atMic ? -0.5 : 0, 0.1);
      s.arms[1].userData.elbow.rotation.x = atMic ? -1.9 : -0.25;
      s.g.position.y += f.moving ? Math.abs(Math.sin((f.dist / 0.7) * Math.PI)) * 0.03 : 0;
    }
    if (band.pianist) band.pianist.g.visible = f.seated;
    // drummer: sticks up between hits, down on the onset; rests when the drums stop
    const d = band.drummer;
    if (d) {
      const e = clamp(((frame?.env?.rms ?? 0) - 0.12) * 2.2), on = clamp(frame?.onset ?? 0), b = frame?.beat ?? 0;
      d.arms[0].rotation.x = d.arm - e * 0.55 * (1 - on);
      d.arms[1].rotation.x = d.arm - e * 0.3 * (1 + Math.cos(b * Math.PI * 2)) * (1 - on * 0.5);
    }
    if (band.pianist) {
      const pa = band.pianist, k = Math.sin((frame?.beat ?? 0) * Math.PI * 0.5) * 0.06;
      pa.arms[0].rotation.x = pa.arm + k; pa.arms[1].rotation.x = pa.arm - k;
    }
  }
  // LED fascia: mean colour of the fascia group's fixtures on each half of the riser
  const _fc = [[0, 0, 0, 0], [0, 0, 0, 0]];
  function fasciaGlow(attrs, openOf) {
    if (!band?.fascia.length) return;
    for (const c of _fc) c.fill(0);
    for (const fz of band.fascia) {
      const grp = state.show.groups.find((g) => g.id === fz.group);
      for (const id of grp?.fixtures || [fz.group]) {
        const o = objs.get(id), a = attrs[id];
        if (!o || !a) continue;
        const lv = openOf.get(id) === false ? 0 : a.dim, w = a.w || 0, c = _fc[o.fixture.pos[0] < fz.x ? 0 : 1];
        c[0] += Math.min(1, a.r + w) * lv; c[1] += Math.min(1, a.g + w) * lv; c[2] += Math.min(1, a.b + w) * lv; c[3]++;
      }
    }
    // saturated colours drive the LEDs harder than white (a white fascia must not out-shine the frontman in front of it)
    [M.fasciaL, M.fasciaR].forEach((m, i) => {
      const c = _fc[i], n = c[3] || 1, r = c[0] / n, g = c[1] / n, b = c[2] / n, mx = Math.max(r, g, b);
      const k = 0.5 + 0.45 * (mx > 1e-3 ? (mx - Math.min(r, g, b)) / mx : 0);
      m.color.setRGB(0.03 + r * k, 0.03 + g * k, 0.034 + b * k);
    });
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

  // beams that land on a band member light him up (key light, follow spot, riser PARs): emissive on his material
  const _fl = [0, 0, 0];
  function lightAt(attrs, x, y, z) {
    _fl[0] = _fl[1] = _fl[2] = 0;
    for (const [id, o] of objs) {
      const a = attrs[id], d = o.def;
      if (!a || !d.beam || d.caps.laser || d.caps.pixels || d.category === "strobe" || d.category === "blinder" || !(a.dim > 0.01) || openOf.get(id) === false) continue;
      const p = o.fixture.pos, vx = x - p[0], vy = y - p[1], vz = z - p[2], len = Math.hypot(vx, vy, vz) || 1;
      const v = beamDirection(o.fixture, a.pan, a.tilt);
      const c = (v[0] * vx + v[1] * vy + v[2] * vz) / len;
      const c0 = Math.cos((((d.caps.zoom ? a.zoom : d.beam.angle) * 0.5 + 4) * Math.PI) / 180); // cone + body size
      if (c < c0) continue;
      const k = a.dim * d.beam.power * Math.min(1, ((c - c0) / (1 - c0)) * 4) * Math.min(1, 30 / (len * len)), w = a.w || 0;
      _fl[0] += Math.min(1, a.r + w) * k; _fl[1] += Math.min(1, a.g + w * 0.94) * k; _fl[2] += Math.min(1, a.b + w * 0.86) * k;
    }
    return _fl;
  }
  function lightBand(attrs) {
    if (!band) return;
    const B = band.B, glow = (m, l) => { const s = 0.22 / Math.max(1, Math.max(l[0], l[1], l[2]) / 1.6); m.emissive.setRGB(l[0] * s, l[1] * s, l[2] * s); };
    if (band.drummer) glow(M.figDrum, lightAt(attrs, B.drummer.x, B.top + 1.1, B.drummer.z));
    glow(M.figFront, lightAt(attrs, fm.x, fm.y - 0.45, fm.z));
    const pc = B.piano.at(0.7, 0), l = lightAt(attrs, pc.x, B.SH + 0.9, pc.z); // lacquer sheen under the piano spot
    M.piano.emissive.setRGB(l[0] * 0.035, l[1] * 0.035, l[2] * 0.035);
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
    if (id === "auto") { auto.on = true; auto.shot = null; auto.key = ""; auto.blend = animate ? 0 : 1; tween = null; return; }
    auto.on = false;
    const v = SHOTS[SHOT_ALIASES[id] || id];
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

  /* ------------------------------------------------------------------ show camera ("auto") */
  // Deterministic in song time: blocks start at markers and at cues with a `camera` field. A cue with a
  // shot name holds that shot until the next block; markers / camera:"auto" cycle shots from an energy pool.
  const auto = { on: false, shot: null, key: "", blend: 1, from: null, shake: 0, flPrev: 0, blocks: null };
  const _cp = new THREE.Vector3(), _ct = new THREE.Vector3();
  function camBlocks() {
    if (auto.blocks) return auto.blocks;
    const cams = (state.show.cues || []).filter((c) => c.camera).map((c) => ({ time: c.time + (c.delay || 0), shot: c.camera === "auto" ? null : c.camera }));
    // a marker within 0.25 s of a camera cue does not start its own block (the cue wins)
    const ev = (state.show.markers || []).filter((m) => !cams.some((c) => Math.abs(c.time - m.time) < 0.25)).map((m) => ({ time: m.time, shot: null }));
    ev.push(...cams);
    ev.sort((a, b) => a.time - b.time);
    if (!ev.length || ev[0].time > 0.05) ev.unshift({ time: 0, shot: null });
    const env = state.analysis?.env, hop = env?.hop || 0.1, rms = env?.rms;
    const dur = state.show.audio?.duration || 200;
    ev.forEach((b, i) => {
      const end = ev[i + 1]?.time ?? dur;
      let e = 0.5;
      if (rms?.length) {
        let sum = 0, n = 0;
        for (let k = Math.floor(b.time / hop); k < Math.min(rms.length, Math.ceil(end / hop)); k++) { sum += rms[k]; n++; }
        if (n) e = sum / n;
      }
      b.pool = POOLS.find((p) => e <= p.max) || POOLS[POOLS.length - 1];
      b.beat0 = Math.round(state.beatAt(b.time));
    });
    return (auto.blocks = ev);
  }
  function autoShot(t) {
    const bl = camBlocks();
    let i = 0;
    for (let k = 0; k < bl.length; k++) if (bl[k].time <= t + 1e-3) i = k; else break;
    const b = bl[i];
    const fixed = b.shot && (SHOT_ALIASES[b.shot] || b.shot);
    if (fixed && SHOTS[fixed]) return { key: `${i}|f`, name: fixed, t0: b.time };
    const len = b.pool.bars * (state.show.audio?.beatsPerBar || 4);
    const n = Math.max(0, Math.floor((state.beatAt(t) - b.beat0 + 1e-3) / len));
    const pool = b.pool.shots;
    const name = pool[(i * 5 + n * 3 + (n >> 2)) % pool.length];
    return { key: `${i}|${n}`, name, t0: n ? state.timeAtBeat(b.beat0 + n * len) : b.time };
  }
  function stepAuto(t, dt, impact, sdt) {
    const s = autoShot(t);
    if (s.key !== auto.key) {
      if (auto.shot && auto.blend >= 1) auto.blend = 1; // hard cut while running
      else auto.from = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
      auto.key = s.key;
      auto.shot = SHOTS[s.name];
    }
    const sh = auto.shot, el = clamp(t - s.t0, 0, 60);
    _cp.fromArray(sh.pos);
    _ct.fromArray(sh.target);
    if (sh.drift) _cp.x += sh.drift[0] * el, _cp.y += sh.drift[1] * el, _cp.z += sh.drift[2] * el;
    if (sh.orbit) {
      const a = sh.orbit * el, dx = _cp.x - _ct.x, dz = _cp.z - _ct.z;
      _cp.x = _ct.x + dx * Math.cos(a) - dz * Math.sin(a);
      _cp.z = _ct.z + dx * Math.sin(a) + dz * Math.cos(a);
    }
    if (sh.follow && band) {
      // keep the frontman in frame: shift by his head offset from the mic spot
      const B = band.B, ox = fm.x - B.singer.x, oy = fm.y - (B.SH + 1.78), oz = fm.z - B.singer.z;
      _cp.x += ox; _cp.y += oy; _cp.z += oz; _ct.x += ox; _ct.y += oy; _ct.z += oz;
    }
    let fov = sh.fov;
    // shake + zoom punch on big flashes
    auto.shake = Math.max(auto.shake * Math.exp(-sdt * 6), clamp(impact));
    const k = auto.shake, w = t;
    if (k > 0.002) {
      _cp.x += Math.sin(w * 47.3) * 0.05 * k; _cp.y += Math.sin(w * 53.9 + 1) * 0.04 * k;
      _ct.x += Math.sin(w * 41.1 + 2) * 0.09 * k; _ct.y += Math.sin(w * 37.7 + 3) * 0.08 * k;
      fov -= 2.2 * k;
    }
    if (auto.blend < 1 && auto.from) {
      auto.blend = Math.min(1, auto.blend + dt / 1.1);
      const e = ease(auto.blend);
      _cp.lerpVectors(auto.from.pos, _cp, e);
      _ct.lerpVectors(auto.from.target, _ct, e);
      fov = auto.from.fov + (fov - auto.from.fov) * e;
    } else auto.blend = 1;
    camera.position.copy(_cp);
    controls.target.copy(_ct);
    camera.lookAt(_ct);
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
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
    if (post) {
      // HDR target (no MSAA: half-float MSAA breaks on ANGLE/Metal); bloom mips start at half of it
      post.composer.setPixelRatio(renderer.getPixelRatio());
      post.composer.setSize(w, h);
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  ro?.observe(container);
  window.addEventListener("resize", resize);

  /* ------------------------------------------------------------------ state wiring */
  // rebuild only what changed: undo / redo restore with scope "all", a cue rename must not rebuild the whole rig
  const sig = { venue: "", fix: "" };
  const sigOf = () => ({ venue: JSON.stringify(state.show.venue), fix: JSON.stringify(state.show.fixtures) });
  state.on("show:changed", ({ scope } = {}) => {
    auto.blocks = null;
    if (scope !== "all" && scope && scope !== "patch") return;
    const n = sigOf(), venueNew = n.venue !== sig.venue, fixNew = scope === "patch" || n.fix !== sig.fix;
    Object.assign(sig, n);
    if (venueNew) buildVenue(state.show.venue);
    if (venueNew || fixNew) { buildFixtures(); prewarm(); }
  });
  state.on("selection:changed", ({ ids }) => applySelection(ids));
  state.on("ui:changed", ({ key, value }) => {
    if (key === "camera") setCamera(value);
    else if (key === "beams") beams = !!value;
    else if (key === "labels") { labelsOn = !!value; if (labelsOn) buildLabels(); labelRoot.visible = labelsOn; }
    else if (key === "haze") hazeUi = +value || 0;
    else if (key === "quality") { quality = value; applyQuality(); }
    else if (key === "bloom") bloomOn = value !== false;
    else if (key === "flash") flashOn = value !== false;
  });

  /* ------------------------------------------------------------------ strobe shutters */
  // Integrated phase per fixture (rate changes never jump the phase); a flash starts the moment the
  // strobe switches on and every flash is shown for at least one rendered frame (no aliasing at 25 Hz).
  const shut = new Map();
  function shutter(id, rate, sdt) {
    if (!(rate > 0)) { shut.delete(id); return true; }
    let s = shut.get(id);
    if (!s) shut.set(id, (s = { ph: 0, fresh: true }));
    s.ph += rate * sdt;
    let fire = s.fresh;
    s.fresh = false;
    if (s.ph >= 1) { s.ph -= Math.floor(s.ph); fire = true; }
    return fire || s.ph < Math.min(0.3, 0.045 * rate);
  }

  /* ------------------------------------------------------------------ render */
  const opts = { haze: 1, beams: true, spots: true, time: 0, dt: 0, cam: camera.position, hit, gain: 1, glowGain: 1, spotGain: 1, fxGain: 1, pxWorld: 0.0015, tint: new THREE.Color() };
  const openOf = new Map();
  let lastT = null, lastSong = null;
  const _dir = new THREE.Vector3();
  function render(frame, dt) {
    if (dt === undefined || !(dt >= 0)) {
      const now = performance.now() / 1000;
      dt = lastT === null ? 1 / 60 : now - lastT;
      lastT = now;
    }
    dt = Math.min(dt, 0.1);
    wall += dt;
    frame = frame || lastFrame;
    lastFrame = frame;
    const t = frame?.t ?? 0;
    const attrs = frame?.attrs || {};
    const sdt = lastSong === null ? 0 : clamp(t - lastSong, 0, 0.1);
    lastSong = t;
    const pp = usePost();

    // global light + haze from the frame
    let fr = 0, fg = 0, fb = 0, br = 0, bgc = 0, bb = 0, fl = 0, hz = 0, hazers = 0;
    let str = 0, strA = 0, nStr = 0, bl = 0, cr = 0, cg = 0, cb = 0;
    for (const [id, o] of objs) {
      const a = attrs[id], d = o.def;
      if (!a) continue;
      if (d.caps.haze) { hz = Math.max(hz, a.dim); hazers++; continue; }
      const open = shutter(id, a.strobe, sdt);
      openOf.set(id, open);
      if (!d.beam || d.caps.laser) continue;
      const lv = open ? a.dim * d.beam.power : 0;
      // mean strobe output over the shutter cycle (flash fraction ×2 for perceived brightness)
      if (d.category === "strobe") { nStr++; strA += a.dim * d.beam.power * (a.strobe > 0 ? Math.min(1, 0.09 * a.strobe, 0.6) : 1); }
      if (lv <= 0.001) continue;
      if (d.category === "strobe" || d.category === "blinder") {
        const s = d.category === "strobe";
        fl += lv * (s ? 1 : 0.8);
        if (s) { str += lv; cr += lv * 0.8; cg += lv * 0.8; cb += lv * 0.85; }
        else { bl += lv; cr += lv * 1.3; cg += lv * 0.75; cb += lv * 0.35; }
        continue;
      }
      const w = a.w || 0;
      let r = Math.min(1, a.r + w), g = Math.min(1, a.g + w), b = Math.min(1, a.b + w);
      if (a.pixels) {
        r = g = b = 0;
        for (const p of a.pixels) { r += p.r * p.dim / 8; g += p.g * p.dim / 8; b += p.b * p.dim / 8; }
      }
      if (o.fixture.pos[2] > 2.5) { fr += r * lv; fg += g * lv; fb += b * lv; }
      else { br += r * lv; bgc += g * lv; bb += b * lv; }
      // beams aimed into the crowd light the audience
      if (d.caps.pantilt || d.category === "led") {
        const v = beamDirection(o.fixture, a.pan, a.tilt);
        if (v[1] < -0.05 && v[2] > 0.15) {
          const k = (1.5 - o.fixture.pos[1]) / v[1], z = o.fixture.pos[2] + v[2] * k;
          if (z > 5 && z < 26) { const q = lv * 0.45; cr += r * q; cg += g * q; cb += b * q; }
        }
      }
    }
    if (!hazers) hz = 0.5;
    hazeLevel += (hz - hazeLevel) * Math.min(1, dt * 0.35);
    const hazeEff = clamp(hazeUi * (0.45 + 0.9 * hazeLevel), 0, 1.4);
    const mf = Math.max(fr, fg, fb, 1e-4), mb = Math.max(br, bgc, bb, 1e-4);
    const strN = nStr ? str / nStr : 0;
    // overlay / hemi / bloom pulse: smoothed level; a sharp rise only if the last one is ≥ 0.34 s ago, else 0.3 s easing
    const strT = flashOn && nStr ? strA / nStr : 0;
    if (strT > wo.s + 0.15 && wall - wo.last >= 0.34) { wo.pk = strT - wo.s; wo.s = strT; wo.last = wall; }
    else wo.s += (strT - wo.s) * (1 - Math.exp(-dt / (wall - wo.last < 0.34 || strT > wo.s ? 0.3 : 0.12)));
    const strS = wo.s;
    front.color.setRGB(fr / mf, fg / mf, fb / mf);
    front.intensity = Math.sqrt(Math.min(mf, 6)) * 70;
    back.color.setRGB(br / mb, bgc / mb, bb / mb);
    back.intensity = Math.sqrt(Math.min(mb, 8)) * 55;
    hemi.intensity = 0.5 + 0.8 * strS;
    scene.fog.density = 0.008 + 0.012 * hazeEff;
    const mc = Math.max(cr, cg, cb, 1e-4);
    crowdL.color.setRGB(cr / mc, cg / mc, cb / mc);
    crowdL.intensity = Math.sqrt(Math.min(mc, 10)) * 120;

    // camera: tween / show camera / orbit controls
    // frame.shake only counts while the song runs (paused on a hit: no endless jitter)
    const impact = sdt > 0 ? Math.max(Math.max(0, fl - auto.flPrev) * 0.35, frame?.shake || 0) : 0;
    auto.flPrev = fl;
    animateBand(frame);
    if (auto.on) stepAuto(t, dt, impact, sdt);
    else { stepTween(dt); controls.update(); }

    opts.haze = hazeEff;
    opts.beams = beams;
    opts.time = wall;
    opts.dt = dt;
    VIZU.uLin.value = pp ? 1 : 0;
    opts.gain = 1;
    opts.glowGain = pp ? 0.5 : 1;
    opts.spotGain = pp ? 0.8 : 1; // bloom adds its own glow: overlapping pools on the glossy deck saturate instead of blooming
    opts.fxGain = 1;
    opts.tint.setRGB((fr + br) / (mf + mb), (fg + bgc) / (mf + mb), (fb + bb) / (mf + mb)).multiplyScalar(Math.min(1, (mf + mb) * 0.3));
    const H = canvas.clientHeight || 600, tanH = Math.tan((camera.fov * Math.PI) / 360);
    opts.pxWorld = (2 * tanH) / H;
    FXU.uTime.value = wall;
    FXU.uPx.value = (canvas.height || H) / (2 * tanH);
    camera.updateMatrixWorld();
    let xr = 0, xg = 0, xb = 0;
    for (const [id, o] of objs) {
      o.update(attrs[id], t, opts, openOf.get(id));
      const L = o.light;
      if (L && (L[0] || L[1] || L[2])) { xr += L[0]; xg += L[1]; xb += L[2]; }
    }
    fasciaGlow(attrs, openOf);
    lightBand(attrs);
    // flash light: strobe hits (white, transient part only), flames / sparks (warm); the steady strobe chase and blinder
    // level stay out (they fed a constant stage-wide fill that flattened the picture); finite range, fades before the riser
    const woT = wo.last >= 0 ? wo.pk * Math.exp(-Math.max(0, wall - wo.last) / 0.08) : 0;
    const hitK = woT * 3;
    const fR = hitK + bl * 0.1 + xr, fG = hitK + bl * 0.065 + xg, fB = hitK * 1.02 + bl * 0.04 + xb, fM = Math.max(fR, fG, fB, 1e-4);
    flash.color.setRGB(fR / fM, fG / fM, fB / fM);
    flash.intensity = Math.sqrt(Math.min(fM, 4)) * 18;

    // white-out: strobes blast the whole picture, blinders too when the camera stands in the audience
    const inCrowd = camera.position.z > 5 ? 1 : 0.35;
    const woL = flashOn ? clamp(Math.min(strS * 0.2, 0.06) + woT * 0.4 + Math.min(bl / 6, 1) * 0.05 * inCrowd, 0, 0.32) : 0;
    flashEl.style.opacity = woL > 0.004 ? woL.toFixed(3) : "0";

    if (particles) {
      const u = particles.material.uniforms;
      const sum = (mf + mb) || 1;
      u.color.value.setRGB((fr + br) / sum, (fg + bgc) / sum, (fb + bb) / sum).multiplyScalar(0.05 * hazeEff * Math.min(1, (mf + mb) * 0.25 + 0.15) * (1 + 3 * strS));
      u.time.value = wall;
      u.pr.value = renderer.getPixelRatio();
    }
    if (stars) {
      // reactive starcloth: twinkles with the hi-hats, sparkles on drum hits, tinted by the back light
      const u = stars.material.uniforms, env = frame?.env;
      // gated by the stage light: a blackout shows no stars
      const lvl = (0.22 + 0.55 * (env?.high ?? 0) + 0.25 * Math.min(1, mb * 0.25)) * clamp((mf + mb + fl) * 2 - 0.01);
      const tint = Math.min(0.65, mb * 0.2);
      u.color.value.setRGB(0.9 + (br / mb - 0.9) * tint, 0.8 + (bgc / mb - 0.8) * tint, 0.65 + (bb / mb - 0.65) * tint).multiplyScalar(lvl * (pp ? 0.8 : 1));
      u.kick.value = clamp((frame?.onset ?? 0) * 1.3);
      u.time.value = wall;
      u.pr.value = renderer.getPixelRatio();
    }
    animateAudience(frame?.beat ?? 0, frame?.env?.rms ?? 0);
    if (pp) {
      post.bloom.strength = 0.55 + 0.25 * strS + 0.3 * woT; // the hit punches through the glow, not only the overlay
      post.composer.render(dt);
    } else renderer.render(scene, camera);
  }

  // compile every material up front (hidden FX/laser objects included), so first use (flames at 140.5) does not stall a frame
  function prewarm() {
    try {
      renderer.compile(scene, camera);
      if (post) {
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(post.composer.readBuffer);
        renderer.compile(scene, camera);
        renderer.setRenderTarget(prev);
      }
    } catch (e) { /* optional */ }
  }

  /* ------------------------------------------------------------------ init */
  Object.assign(sig, sigOf());
  buildVenue(state.show.venue);
  buildFixtures();
  labelRoot.visible = labelsOn;
  applyQuality();
  prewarm();
  setCamera(VIEWS[state.ui.camera] || state.ui.camera === "auto" ? state.ui.camera : "foh", false);

  return {
    renderer, scene, camera, controls, objects: objs,
    render, setCamera, resize, pick,
    shots: Object.keys(SHOTS),
    shotAt: (t) => autoShot(t).name, // show-camera shot at song time t (deterministic)
    frontman: (frame) => ({ ...frontmanAt(frame || lastFrame) }), // debug: frontman place at a frame
    get bloom() { return usePost(); },
    dispose() {
      ro?.disconnect();
      window.removeEventListener("resize", resize);
      for (const o of objs.values()) o.dispose();
      controls.dispose();
      post?.composer.dispose();
      renderer.dispose();
      canvas.remove();
      vignette.remove();
      flashEl.remove();
    },
  };
}

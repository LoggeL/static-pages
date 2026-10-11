// LUMEN 3D fixtures: bodies (base / yoke = pan / head = tilt), additive volumetric cones,
// floor spots (ray-plane), lens glow, LED pixels, strobe/blinder flashes and laser fans.

import * as THREE from "../vendor/three.module.min.js";
import { DEG, clamp, baseBasis, FX_FIRE } from "../core/fixtures.js";

const SEL_COLOR = 0x3ec5ff;
const TAU = Math.PI * 2;
const _m = new THREE.Matrix4(), _mr = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3();
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ shaders */
// uLin = 1 when rendering into the linear HDR bloom target: these additive shaders were tuned as display
// values, so there they are run through inverse sRGB + inverse ACES (three's RRT/ODT fit, exposure 1.15)
// → OutputPass gives back the same picture; values above 1 become real HDR and bloom.
export const VIZU = { uLin: { value: 0 } };
export const GLSL_OUT = /* glsl */ `
uniform float uLin;
vec3 outc(vec3 c) {
  if (uLin < 0.5) return c;
  vec3 y = pow(clamp(c, 0.0, 0.96), vec3(2.2));
  vec3 a = 0.983729 * y - 1.0, b = 0.432951 * y - 0.0245786, k = 0.238081 * y + 0.000090537;
  vec3 x = (-b - sqrt(max(b * b - 4.0 * a * k, 0.0))) / (2.0 * a);
  return max(x - 0.00325, 0.0) * 0.5217 + max(c - 0.96, 0.0) * 1.5;
}`;
const GLSL_COMMON = /* glsl */ `${GLSL_OUT}
float hash1(float n) { return fract(sin(n) * 43758.5453); }
float noise3(vec3 x) {
  vec3 p = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  float n = p.x + p.y * 57.0 + 113.0 * p.z;
  return mix(mix(mix(hash1(n), hash1(n + 1.0), f.x), mix(hash1(n + 57.0), hash1(n + 58.0), f.x), f.y),
             mix(mix(hash1(n + 113.0), hash1(n + 114.0), f.x), mix(hash1(n + 170.0), hash1(n + 171.0), f.x), f.y), f.z);
}
// gobo seen on the beam shell: a = angle around the axis, y = 0..1 along the beam, rim = 1 at the silhouette
float goboShell(float g, float a, float y, float rim) {
  if (g < 0.5) return 1.0;
  if (g < 1.5) return smoothstep(0.55, 0.92, cos(a * 12.0)) * 2.2;
  if (g < 2.5) return pow(0.5 + 0.5 * cos(a * 6.0), 3.0) * 2.4;
  if (g < 3.5) return pow(rim, 0.7) * 2.0;
  if (g < 4.5) return step(0.5, hash1(floor((a + 3.1416) * 2.6))) * 2.0;
  if (g < 5.5) return pow(0.5 + 0.5 * cos(a * 5.0), 8.0) * 3.5;
  if (g < 6.5) return pow(0.5 + 0.5 * sin(a * 7.0 + y * 16.0), 2.0) * 2.0;
  return (0.5 + 0.5 * cos(a * 10.0)) * (0.55 + 0.45 * cos(y * 46.0)) * 1.9;
}
// gobo projected onto a surface, p in the unit disc
float goboDisc(float g, vec2 p) {
  float r = length(p), a = atan(p.y, p.x);
  if (g < 0.5) return 1.0;
  if (g < 1.5) return smoothstep(0.3, 0.18, length(fract(p * 2.6) - 0.5)) * 2.4;
  if (g < 2.5) return pow(0.5 + 0.5 * cos(a * 6.0), 3.0) * 2.4 * smoothstep(0.05, 0.2, r);
  if (g < 3.5) return smoothstep(0.16, 0.06, abs(r - 0.68)) * 2.4;
  if (g < 4.5) return step(0.5, hash1(floor((a + 3.1416) * 2.6))) * step(0.15, r) * 2.0;
  if (g < 5.5) return (pow(0.5 + 0.5 * cos(a * 5.0), 8.0) + smoothstep(0.25, 0.0, r)) * 3.0;
  if (g < 6.5) return pow(0.5 + 0.5 * sin(r * 20.0 + 2.0 * sin(a * 3.0)), 2.0) * 2.0;
  vec2 q = abs(fract(p * 2.2) - 0.5);
  return step(0.36, max(q.x, q.y)) * 2.6;
}`;

const BEAM_VS = /* glsl */ `
uniform float r0, r1, len;
varying float vY;
varying vec3 vN, vV, vW, vIC;
varying vec2 vXZ;
void main() {
  float y = position.y;
  #ifdef USE_INSTANCING_COLOR
    vIC = instanceColor;
  #else
    vIC = vec3(1.0);
  #endif
  float r = mix(r0, r1, y);
  vec4 lp = vec4(position.x * r, y * len, position.z * r, 1.0);
  vec3 n = vec3(position.x, -(r1 - r0) / max(len, 1e-3), position.z);
  #ifdef USE_INSTANCING
    lp = instanceMatrix * lp;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 mv = modelViewMatrix * lp;
  vN = normalize(normalMatrix * n);
  vV = -mv.xyz;
  vW = (modelMatrix * lp).xyz;
  vY = y;
  vXZ = position.xz;
  gl_Position = projectionMatrix * mv;
}`;

const BEAM_FS = /* glsl */ `
uniform vec3 color;
uniform float intensity, haze, time, gobo, goboRot, frost, facing, len, edgePow;
varying float vY;
varying vec3 vN, vV, vW, vIC;
varying vec2 vXZ;
${GLSL_COMMON}
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float edge = max(pow(ndv, mix(edgePow, 0.8, frost)), facing * 0.7);
  float fall = pow(1.0 - vY, 1.5) * (0.55 + 0.9 * exp(-vY * len * 0.22)) * smoothstep(0.0, 0.015, vY);
  vec3 q = vW * 0.55 + vec3(time * 0.05, -time * 0.09, time * 0.04);
  float n = noise3(q) * 0.62 + noise3(q * 2.7 + 7.0) * 0.38;
  float hz = 0.35 + 1.1 * n;
  float a = atan(vXZ.x, vXZ.y) + goboRot;
  float pat = mix(goboShell(gobo, a, vY, 1.0 - ndv), 1.0, frost * 0.8);
  float v = intensity * haze * edge * fall * hz * pat;
  gl_FragColor = vec4(outc(color * vIC * v), 1.0);
}`;

const SPOT_VS = /* glsl */ `
varying vec2 vP;
void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SPOT_FS = /* glsl */ `
uniform vec3 color;
uniform float intensity, soft, gobo, goboRot, frost;
varying vec2 vP;
${GLSL_COMMON}
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float c = cos(goboRot), s = sin(goboRot);
  vec2 p = mat2(c, -s, s, c) * vP;
  float e = smoothstep(1.0, 1.0 - soft, r);
  float pat = mix(goboDisc(gobo, p), 1.0, frost * 0.85);
  float hot = 0.55 + 0.45 * (1.0 - r * r);
  gl_FragColor = vec4(outc(color * intensity * e * pat * hot), 1.0);
}`;

const SHEET_FS = /* glsl */ `
uniform vec3 color;
uniform float intensity, haze, time, fan, len;
varying vec2 vP;
${GLSL_COMMON}
void main() {
  float a = atan(vP.x, vP.y);
  float r = length(vP);
  if (abs(a) > fan * 0.5 || r > 1.0) discard;
  float n = noise3(vec3(vP * len * 0.4, time * 0.3));
  float v = intensity * haze * pow(1.0 - r, 1.3) * (0.3 + 0.9 * n) * smoothstep(fan * 0.5, fan * 0.42, abs(a));
  gl_FragColor = vec4(outc(color * v), 1.0);
}`;

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

export function createBeamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(1, 1, 1) }, intensity: { value: 0 }, haze: { value: 1 }, time: { value: 0 },
      r0: { value: 0.05 }, r1: { value: 1 }, len: { value: 10 }, gobo: { value: 0 }, goboRot: { value: 0 },
      frost: { value: 0 }, facing: { value: 0 }, edgePow: { value: 1.6 }, uLin: VIZU.uLin,
    },
    vertexShader: BEAM_VS, fragmentShader: BEAM_FS, side: THREE.DoubleSide, ...additive,
  });
}

function createSpotMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(1, 1, 1) }, intensity: { value: 0 }, soft: { value: 0.2 },
      gobo: { value: 0 }, goboRot: { value: 0 }, frost: { value: 0 }, uLin: VIZU.uLin,
    },
    vertexShader: SPOT_VS, fragmentShader: SPOT_FS, polygonOffset: true, polygonOffsetFactor: -2, ...additive,
  });
}

function createSheetMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0, 1, 0) }, intensity: { value: 0 }, haze: { value: 1 }, time: { value: 0 }, fan: { value: 0.7 }, len: { value: 30 }, uLin: VIZU.uLin },
    vertexShader: SPOT_VS, fragmentShader: SHEET_FS, side: THREE.DoubleSide, ...additive,
  });
}

/* ------------------------------------------------------------------ stage FX particles */
// Pooled GPU particles: CPU only writes birth time + power into a ring buffer on emission,
// the vertex shader integrates the motion. uPx = pixels per metre at 1 m distance.
export const FXU = { uTime: { value: 0 }, uPx: { value: 800 } };
const FX_VS = {
  spark: /* glsl */ `
float life = bp.y > 0.0 ? sqrt(2.0 * 9.81 * bp.y) / 9.81 * (1.15 + 0.6 * rnd.z) : 0.0;
float v = sqrt(2.0 * 9.81 * bp.y) * (0.82 + 0.3 * rnd.x);
float an = rnd.y * 6.2832, sp = 0.06 + 0.14 * rnd.z * rnd.z;
vec3 p = vec3(cos(an) * sp * v * age, v * age - 4.905 * age * age, sin(an) * sp * v * age);
p.y = max(p.y, -0.02);
float px = 0.022 * (0.7 + 0.6 * rnd.x) * (1.0 + 0.8 * (1.0 - smoothstep(0.0, 0.3, age))); // fat young sparks: the fountain base reads as a core`,
  co2: /* glsl */ `
float life = 1.5 + 0.5 * rnd.z;
float v = 15.0 * bp.y * (0.85 + 0.3 * rnd.x), k = 2.5;
float rise = v * (1.0 - exp(-k * age)) / k;
float an = rnd.y * 6.2832, sp = (0.12 + 0.9 * age) * (0.3 + 0.7 * rnd.z);
vec3 p = vec3(cos(an) * sp, rise, sin(an) * sp + 0.35 * rise * 0.18);
float px = (0.35 + 2.4 * age) * (0.7 + 0.6 * rnd.x);`,
  flame: /* glsl */ `
float life = 0.55 + 0.45 * rnd.z;
float v = 7.0 * bp.y * (0.85 + 0.3 * rnd.x);
float an = rnd.y * 6.2832, sp = (0.1 + 0.95 * age) * (0.25 + 0.75 * rnd.z);
vec3 p = vec3(cos(an) * sp + sin(age * 9.0 + rnd.x * 6.0) * 0.18 * age, v * age + 1.6 * age * age, sin(an) * sp);
float px = (0.32 + 1.5 * age) * (0.75 + 0.5 * rnd.x);`,
};
const FX_FS = {
  // vertical streak (sparks fly mostly up/down), deep gold; young near sparks are HDR so their cores bloom
  spark: /* glsl */ `
vec2 q = gl_PointCoord - 0.5;
float rs = length(vec2(q.x * 2.2, q.y));
float tw = 0.45 + 0.55 * step(0.35, fract(sin(floor(uTime * 28.0) + vR * 91.7) * 4375.5));
vec3 c = mix(vec3(1.0, 0.78, 0.4), vec3(1.0, 0.42, 0.1), smoothstep(0.1, 0.9, vT));
// HDR core only on sprites big enough to bloom cleanly: a few-px HDR point turns into a square halo in the bloom mips
c *= 1.0 + (uLin > 0.5 ? 2.6 * smoothstep(4.0, 12.0, vPs) : 0.5) * (1.0 - smoothstep(0.0, 0.4, vT));
float a = smoothstep(0.5, 0.05, rs) * (1.0 - vT * vT) * tw * 0.95;`,
  co2: /* glsl */ `
vec3 c = uTint;
float a = exp(-r * r * 10.0) * pow(1.0 - vT, 1.6) * smoothstep(0.0, 0.08, vT) * 0.16 * (0.75 + 0.5 * vR);`,
  flame: /* glsl */ `
vec3 c = mix(vec3(1.0, 0.82, 0.45), vec3(1.0, 0.36, 0.04), smoothstep(0.04, 0.3, vT));
c = mix(c, vec3(0.4, 0.05, 0.01), smoothstep(0.4, 0.85, vT));
float a = exp(-r * r * 11.0) * pow(1.0 - vT, 1.5) * smoothstep(0.0, 0.04, vT) * 0.75 * (0.6 + 0.8 * vR);`,
};
function createFxMaterial(kind) {
  return new THREE.ShaderMaterial({
    uniforms: { ...FXU, ...VIZU, uGain: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: /* glsl */ `
uniform float uTime, uPx;
attribute vec2 bp;
attribute vec3 rnd;
varying float vT, vR, vPs;
void main() {
  float age = uTime - bp.x;
  ${FX_VS[kind]}
  if (bp.y <= 0.0 || age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vT = age / life; vR = rnd.x;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(px * uPx / max(-mv.z, 0.1), ${kind === "spark" ? "3.0" : "1.5"}, 256.0);
  vPs = gl_PointSize;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
uniform float uTime, uGain;
uniform vec3 uTint;
varying float vT, vR, vPs;${GLSL_OUT}
void main() {
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  ${FX_FS[kind]}
  gl_FragColor = vec4(outc(c * a * uGain), 1.0);
}`,
    ...additive,
  });
}
const FX_CFG = { spark: { n: 3600, rate: 1800 }, co2: { n: 900, rate: 420 }, flame: { n: 700, rate: 480 } };

/* ------------------------------------------------------------------ shared resources */
let R = null;
function shared() {
  if (R) return R;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  [[0, 1], [0.08, 0.85], [0.2, 0.36], [0.45, 0.1], [0.7, 0.03], [1, 0]].forEach(([o, a]) => grd.addColorStop(o, `rgba(255,255,255,${a})`));
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  // anamorphic lens streak: thin horizontal line, soft ends
  const cs = document.createElement("canvas");
  cs.width = 256; cs.height = 32;
  const gs = cs.getContext("2d"), img = gs.createImageData(256, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 256; x++) {
    const u = (x - 127.5) / 128, v = (y - 15.5) / 16;
    const a = Math.exp(-v * v * 30) * Math.pow(1 - u * u, 2.2) * (0.35 + 0.65 * Math.exp(-u * u * 18)) + Math.exp(-(u * u * 40 + v * v * 8)) * 0.6;
    const i = (y * 256 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(Math.min(1, a) * 255);
  }
  gs.putImageData(img, 0, 0);
  R = {
    glowTex: new THREE.CanvasTexture(cv),
    streakTex: new THREE.CanvasTexture(cs),
    body: new THREE.MeshStandardMaterial({ color: 0x24272d, roughness: 0.45, metalness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.55, metalness: 0.4 }),
    proxy: new THREE.MeshBasicMaterial({ visible: false }),
    outline: new THREE.LineBasicMaterial({ color: SEL_COLOR, depthTest: false, transparent: true, opacity: 0.95 }),
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 18),
    cone: new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0),
    thin: new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0),
    lens: new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2),
    disc: new THREE.PlaneGeometry(2, 2),
    sheet: new THREE.PlaneGeometry(2, 1).translate(0, 0.5, 0),
  };
  return R;
}

/* ------------------------------------------------------------------ fixture object */
// fixture: patch entry, def: FIXTURE_TYPES entry. update(attrs, t, opts) with
// opts = {haze, beams, spots, time, cam:Vector3, hit(origin, dir, max) → {d, n:Vector3, spot} | null}
export function createFixtureObject(fixture, def) {
  const S = shared();
  const own = []; // per-object materials/geometries to dispose
  const mat = (m) => (own.push(m), m);
  const root = new THREE.Group();
  root.name = fixture.id;
  const rig = new THREE.Group();
  rig.position.fromArray(fixture.pos);
  const B = baseBasis(fixture);
  _m.makeBasis(_x.fromArray(B.x), _y.fromArray(B.y), _z.fromArray(B.z));
  rig.quaternion.setFromRotationMatrix(_m);
  root.add(rig);
  const pan = new THREE.Group(), tilt = new THREE.Group();
  rig.add(pan);
  pan.add(tilt);

  const part = (parent, geo, material, sx, sy, sz, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, material);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const glow = (parent, x, y, z) => {
    const s = new THREE.Sprite(mat(new THREE.SpriteMaterial({ map: S.glowTex, color: 0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false })));
    s.position.set(x, y, z);
    s.visible = false;
    parent.add(s);
    return s;
  };
  const streak = (parent, x, y, z) => {
    const s = new THREE.Sprite(mat(new THREE.SpriteMaterial({ map: S.streakTex, color: 0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false })));
    s.position.set(x, y, z);
    s.visible = false;
    s.renderOrder = 2;
    parent.add(s);
    return s;
  };
  const lens = (parent, r, x, y, z) => {
    const m = new THREE.Mesh(S.lens, mat(new THREE.MeshBasicMaterial({ color: 0x050607 })));
    m.scale.setScalar(r);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const cone = (parent, x, y, z) => {
    const m = new THREE.Mesh(S.cone, mat(createBeamMaterial()));
    m.position.set(x, y, z);
    m.frustumCulled = false;
    m.visible = false;
    parent.add(m);
    return m;
  };
  const spot = () => {
    const m = new THREE.Mesh(S.disc, mat(createSpotMaterial()));
    m.matrixAutoUpdate = false;
    m.frustumCulled = false;
    m.visible = false;
    m.renderOrder = 1;
    root.add(m);
    return m;
  };

  const [w, h, d] = def.size;
  const hang = fixture.mount === "hang";
  const body = def.body;
  const E = { cones: [], spots: [], lensY: 0, lensR: def.beam?.lens || 0.05 }; // main emitter
  let pivot = h * 0.45;

  if (hang) part(rig, S.box, S.dark, 0.07, 0.14, 0.07, 0, -0.05, 0); // clamp to the truss

  if (def.category === "mover") {
    const lensR = E.lensR;
    const headR = body === "wash" ? Math.max(w * 0.4, lensR * 1.15) : body === "beam" ? w * 0.3 : w * 0.36;
    const headL = body === "wash" ? h * 0.42 : body === "beam" ? h * 0.6 : h * 0.55;
    const armX = headR + 0.045;
    const baseH = h * 0.2;
    part(rig, S.box, S.body, armX * 2 + 0.08, baseH, d * 0.85, 0, baseH / 2, 0);
    part(rig, S.box, S.dark, armX * 1.2, 0.02, d * 0.6, 0, baseH + 0.005, 0.0);
    pan.position.y = baseH;
    part(pan, S.box, S.body, armX * 2 + 0.05, 0.05, d * 0.32, 0, 0.03, 0);
    pivot = h * 0.42;
    for (const s of [-1, 1]) part(pan, S.box, S.body, 0.05, pivot + 0.04, d * 0.3, s * armX, (pivot + 0.04) / 2 + 0.03, 0);
    tilt.position.y = pivot;
    const top = headL * 0.6;
    if (body === "spot") {
      part(tilt, S.box, S.body, headR * 1.7, headL * 0.7, headR * 1.7, 0, top - headL * 0.45, 0);
      part(tilt, S.cyl, S.body, headR * 0.82, headL * 0.32, headR * 0.82, 0, top - headL * 0.16, 0);
    } else if (body === "wash") {
      part(tilt, S.cyl, S.body, headR, headL, headR, 0, top - headL / 2, 0);
      part(tilt, S.cyl, S.dark, headR * 1.03, 0.03, headR * 1.03, 0, top - 0.012, 0);
    } else {
      part(tilt, S.box, S.body, headR * 1.6, headL, headR * 1.5, 0, top - headL / 2, 0);
      part(tilt, S.cyl, S.dark, lensR * 1.6, 0.04, lensR * 1.6, 0, top - 0.015, 0);
    }
    E.lensY = top + 0.004;
  } else if (body === "par") {
    pivot = 0.13;
    part(rig, S.box, S.dark, 0.3, 0.02, 0.2, 0, 0.01, 0);
    for (const s of [-1, 1]) part(rig, S.box, S.dark, 0.02, pivot, 0.04, s * 0.15, pivot / 2, 0);
    tilt.position.y = pivot;
    part(tilt, S.cyl, S.body, 0.125, 0.22, 0.125, 0, 0.0, 0);
    part(tilt, S.box, S.dark, 0.2, 0.06, 0.2, 0, -0.12, 0);
    E.lensY = 0.112;
    E.lensR = 0.105;
  } else if (body === "bar") {
    pivot = 0.07;
    for (const s of [-1, 1]) part(rig, S.box, S.dark, 0.03, pivot, 0.1, s * 0.4, pivot / 2, 0);
    tilt.position.y = pivot;
    part(tilt, S.box, S.body, w, h, d, 0, 0, 0);
  } else if (body === "strobe") {
    pivot = 0.16;
    for (const s of [-1, 1]) part(rig, S.box, S.dark, 0.03, pivot, 0.05, s * 0.3, pivot / 2, 0);
    tilt.position.y = pivot;
    part(tilt, S.box, S.body, w, 0.14, d, 0, -0.02, 0);
    E.lensY = 0.052;
    E.lensR = 0.2;
  } else if (body === "blinder2" || body === "blinder4") {
    pivot = 0.2;
    for (const s of [-1, 1]) part(rig, S.box, S.dark, 0.03, pivot, 0.05, s * (w / 2 + 0.03), pivot / 2, 0);
    tilt.position.y = pivot;
    part(tilt, S.box, S.body, w, 0.16, h, 0, -0.03, 0);
    E.lensY = 0.052;
    E.lensR = 0.25;
  } else if (body === "laser") {
    pivot = 0.12;
    part(rig, S.box, S.dark, 0.26, 0.02, 0.3, 0, 0.01, 0);
    tilt.position.y = pivot;
    part(tilt, S.box, S.body, w, 0.36, h, 0, -0.08, 0);
    part(tilt, S.box, S.dark, 0.08, 0.02, 0.08, 0, 0.105, 0);
    E.lensY = 0.118;
    E.lensR = 0.02;
  } else if (body === "spark" || body === "co2" || body === "flame") {
    part(rig, S.box, S.dark, w, h * 0.7, d, 0, h * 0.35, 0);
    if (body === "co2") part(rig, S.cyl, S.body, 0.05, h * 0.5, 0.05, 0, h * 0.95, 0);
    else part(rig, S.cyl, S.body, body === "flame" ? 0.07 : 0.045, h * 0.3, body === "flame" ? 0.07 : 0.045, 0, h * 0.85, 0);
  } else if (body === "hazer") {
    part(rig, S.box, S.body, w, h, d, 0, h / 2, 0);
    part(rig, S.cyl, S.dark, 0.05, 0.12, 0.05, 0, h * 0.62, d / 2 + 0.05).rotation.x = Math.PI / 2;
  }

  // emitters
  let pixels = null, cells = null, laser = null, hazeLed = null, fx = null;
  if (def.category === "mover" || body === "par") {
    E.lens = lens(tilt, E.lensR, 0, E.lensY, 0);
    E.glow = glow(tilt, 0, E.lensY + 0.03, 0);
    const n = def.caps.prisms ? 3 : 1;
    for (let i = 0; i < n; i++) { E.cones.push(cone(tilt, 0, E.lensY, 0)); E.spots.push(spot()); }
    E.cones[0].material.uniforms.edgePow.value = body === "beam" ? 1.1 : body === "wash" || body === "par" ? 1.9 : 1.5;
  } else if (body === "bar") {
    pixels = [];
    for (let i = 0; i < def.caps.pixels; i++) {
      const x = (i - (def.caps.pixels - 1) / 2) * (w / def.caps.pixels);
      const c = cone(tilt, x, h / 2 + 0.002, 0);
      c.material.uniforms.edgePow.value = 2.2;
      pixels.push({ lens: lens(tilt, 0.04, x, h / 2 + 0.002, 0), glow: glow(tilt, x, h / 2 + 0.03, 0), cone: c });
    }
  } else if (body === "strobe") {
    E.panel = part(tilt, S.box, mat(new THREE.MeshBasicMaterial({ color: 0x0a0a0a })), w * 0.86, 0.01, d * 0.6, 0, 0.051, 0);
    E.glow = glow(tilt, 0, 0.12, 0);
    E.streak = streak(tilt, 0, 0.14, 0);
    E.cones.push(cone(tilt, 0, 0.05, 0));
    E.cones[0].material.uniforms.edgePow.value = 2.6;
  } else if (body === "blinder2" || body === "blinder4") {
    const n = def.caps.cells || 4;
    cells = [];
    for (let i = 0; i < n; i++) {
      const cx = (i % 2 - 0.5) * 0.31, cz = n > 2 ? (Math.floor(i / 2) - 0.5) * 0.31 : 0;
      part(tilt, S.cyl, S.dark, 0.135, 0.02, 0.135, cx, 0.05, cz);
      cells.push({ lens: lens(tilt, 0.11, cx, 0.062, cz), glow: glow(tilt, cx, 0.1, cz) });
    }
    E.streak = streak(tilt, 0, 0.14, 0);
    E.cones.push(cone(tilt, 0, 0.05, 0));
    E.cones[0].material.uniforms.edgePow.value = 2.4;
  } else if (body === "laser") {
    const spin = new THREE.Group();
    spin.position.y = E.lensY;
    tilt.add(spin);
    const lines = new THREE.InstancedMesh(S.thin, mat(createBeamMaterial()), 32);
    lines.frustumCulled = false;
    lines.material.uniforms.edgePow.value = 0.9;
    for (let i = 0; i < 32; i++) { lines.setMatrixAt(i, _m.identity()); lines.setColorAt(i, new THREE.Color(1, 1, 1)); }
    lines.count = 0;
    const sheet = new THREE.Mesh(S.sheet, mat(createSheetMaterial()));
    sheet.frustumCulled = false;
    sheet.visible = false;
    const shell = new THREE.Mesh(S.cone, mat(createBeamMaterial())); // tunnel wall
    shell.frustumCulled = false;
    shell.visible = false;
    shell.material.uniforms.edgePow.value = 4;
    spin.add(lines, sheet, shell);
    laser = { spin, lines, sheet, shell, key: "" };
    E.lens = lens(tilt, 0.025, 0, E.lensY, 0);
    E.glow = glow(tilt, 0, E.lensY + 0.02, 0);
  } else if (def.caps.fx) {
    const cfg = FX_CFG[def.caps.fx];
    const g = new THREE.BufferGeometry();
    const bp = new THREE.BufferAttribute(new Float32Array(cfg.n * 2), 2).setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cfg.n; i++) bp.array[i * 2] = -1e4;
    const rnd = new Float32Array(cfg.n * 3);
    for (let i = 0; i < rnd.length; i++) rnd[i] = Math.random();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(cfg.n * 3), 3));
    g.setAttribute("bp", bp);
    g.setAttribute("rnd", new THREE.BufferAttribute(rnd, 3));
    own.push(g);
    const pts = new THREE.Points(g, mat(createFxMaterial(def.caps.fx)));
    pts.frustumCulled = false;
    pts.position.y = h;
    pts.renderOrder = 3;
    rig.add(pts);
    fx = { kind: def.caps.fx, cfg, pts, bp, head: 0, acc: 0, until: -1, was: false, level: 0 };
    E.glow = glow(rig, 0, h + 0.15, 0);
  } else if (body === "hazer") {
    hazeLed = part(rig, S.box, mat(new THREE.MeshBasicMaterial({ color: 0x0a1a0a })), 0.04, 0.02, 0.01, w * 0.3, h * 0.8, d / 2 + 0.005);
  }

  // picking proxy + selection outline (in base space, independent of pan/tilt)
  const pw = Math.max(w, 0.32) * 1.15, ph = Math.max(h, 0.3) * 1.15, pd = Math.max(d, 0.32) * 1.15;
  const proxy = part(rig, S.box, S.proxy, pw, ph, pd, 0, ph / 2 - 0.04, 0);
  proxy.userData.fixtureId = fixture.id;
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(pw, ph, pd));
  own.push(edges);
  const outline = new THREE.LineSegments(edges, S.outline);
  outline.position.y = ph / 2 - 0.04;
  outline.renderOrder = 999;
  outline.visible = false;
  rig.add(outline);

  /* -------------------------------------------------------------- update */
  const beam = def.beam;
  const light = [0, 0, 0]; // FX light this frame (stage adds it to the flash light)
  function setGlow(g, r, gg, b, amt, size) {
    g.visible = amt > 0.004;
    if (!g.visible) return;
    g.material.color.setRGB(r * amt, gg * amt, b * amt);
    g.scale.setScalar(size);
  }
  function setStreak(s, r, gg, b, amt, len) {
    s.visible = amt > 0.004;
    if (!s.visible) return;
    s.material.color.setRGB(r * amt, gg * amt, b * amt);
    s.scale.set(len, len * 0.07, 1);
  }
  // facing: how much the camera looks into the beam (0..1), from origin _o and unit direction _d
  function facingOf(cam, half) {
    _c.subVectors(cam, _o).normalize();
    const f = _c.dot(_d);
    return { f, inCone: smooth(Math.cos(Math.min(half * 1.6 + 0.05, 1.5)), Math.cos(half * 0.35), f) };
  }
  function originDir(m) {
    const e = m.matrixWorld.elements;
    _o.set(e[12], e[13], e[14]);
    _d.set(e[4], e[5], e[6]).normalize();
  }
  const _col = new THREE.Color();
  function setLine(i, th, phi, k) {
    _m.makeRotationZ(-th);
    if (phi) _m.premultiply(_mr.makeRotationY(phi));
    laser.lines.setMatrixAt(i, _m);
    laser.lines.setColorAt(i, _col.setScalar(k));
  }

  // shut: shutter state from the stage's strobe integrator (true = open); falls back to the time rule
  function update(a, t, opts, shut) {
    if (!a) return;
    const open = shut ?? (!(a.strobe > 0) || ((t * a.strobe) % 1) < 0.3);
    const lvl = open ? clamp(a.dim) : 0;
    const wv = a.w || 0;
    const cr = Math.min(1, a.r + wv), cg = Math.min(1, a.g + wv * 0.94), cb = Math.min(1, a.b + wv * 0.86);
    const haze = opts.haze ?? 1, showBeams = opts.beams !== false, G = opts.gain ?? 1, GG = opts.glowGain ?? 1;
    pan.rotation.y = a.pan * DEG;
    tilt.rotation.x = (a.tilt + (laser ? a.lzTilt : 0)) * DEG;

    if (def.category === "mover" || body === "par") {
      let angle = def.caps.zoom ? a.zoom : beam.angle;
      if (body === "spot") angle *= 0.35 + 0.65 * a.iris;
      angle += a.frost * (body === "beam" ? 9 : 6);
      const half = angle * 0.5 * DEG;
      const nP = a.prism > 0 ? 3 : 1;
      const off = Math.max(angle * 0.9, 4) * DEG, phase = t * a.prismRot * TAU;
      for (let k = 0; k < E.cones.length; k++) {
        const c = E.cones[k];
        if (a.prism === 1) c.rotation.set(off, phase + (k * TAU) / 3, 0, "YXZ");
        else if (a.prism === 2) c.rotation.set((k - 1) * off, phase, 0, "YXZ");
        else c.rotation.set(0, 0, 0);
      }
      rig.updateMatrixWorld(true);
      const narrow = clamp(14 / angle, 0.7, 3.2);
      const goboRot = t * a.goboSpin * TAU;
      let face = 0;
      for (let k = 0; k < E.cones.length; k++) {
        const c = E.cones[k], sp = E.spots[k];
        if (k >= nP || lvl < 0.002) { c.visible = false; sp.visible = false; continue; }
        originDir(c);
        const fc = facingOf(opts.cam, half);
        face = Math.max(face, fc.inCone);
        const hit = opts.hit ? opts.hit(_o, _d, beam.length) : null;
        const len = hit ? Math.min(beam.length, hit.d) : beam.length;
        const u = c.material.uniforms;
        u.r0.value = E.lensR * 0.85;
        u.r1.value = u.r0.value + len * Math.tan(half);
        u.len.value = len;
        u.color.value.setRGB(cr, cg, cb);
        u.intensity.value = lvl * beam.power * narrow * (nP > 1 ? 0.5 : 1) * 0.42 * G;
        u.haze.value = haze;
        u.time.value = opts.time || 0;
        u.gobo.value = a.gobo;
        u.goboRot.value = goboRot;
        u.frost.value = a.frost;
        u.facing.value = fc.inCone;
        c.visible = showBeams && haze > 0.01;
        // floor / wall spot
        if (hit && hit.spot && opts.spots !== false) {
          const n = hit.n, cosI = Math.abs(_d.dot(n));
          const r = u.r0.value + hit.d * Math.tan(half);
          const major = r / Math.max(cosI, 0.22);
          _x.copy(_d).addScaledVector(n, -_d.dot(n));
          if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0).addScaledVector(n, -n.x);
          _x.normalize();
          _y.crossVectors(n, _x);
          _p.copy(_o).addScaledVector(_d, hit.d).addScaledVector(n, 0.012 + k * 0.004);
          sp.matrix.makeBasis(_x.multiplyScalar(major), _y.multiplyScalar(r), n).setPosition(_p);
          const su = sp.material.uniforms;
          su.color.value.setRGB(cr, cg, cb);
          su.intensity.value = lvl * beam.power * clamp(1.1 / (r * r + 0.35), 0.22, 1.6) * smooth(0.04, 0.3, cosI) * (nP > 1 ? 0.6 : 1) * (n.y > 0.5 ? 1 : 0.45) * (opts.spotGain ?? 1);
          su.soft.value = clamp((body === "wash" || body === "par" ? 0.55 : body === "beam" ? 0.35 : 0.14) + a.frost * 0.6 + (1 - a.focus) * 0.1, 0.05, 0.95);
          su.gobo.value = a.gobo;
          su.goboRot.value = goboRot;
          su.frost.value = a.frost;
          sp.visible = true;
        } else sp.visible = false;
      }
      // lens + glow (main axis)
      _d.set(0, 1, 0).applyQuaternion(tilt.getWorldQuaternion(_q));
      tilt.localToWorld(_o.set(0, E.lensY, 0));
      const fc = facingOf(opts.cam, half);
      const front = fc.f > -0.05 ? 1 : 0;
      const hot = lvl * front;
      E.lens.material.color.setRGB(0.02 + cr * hot * (2 + 6 * fc.inCone), 0.02 + cg * hot * (2 + 6 * fc.inCone), 0.022 + cb * hot * (2 + 6 * fc.inCone));
      const amt = hot * (0.25 + 0.9 * Math.pow(Math.max(fc.f, 0), 5) + 2.2 * face) * (body === "par" ? 0.7 : 1) * GG;
      setGlow(E.glow, cr, cg, cb, amt, E.lensR * (6 + 22 * face) * (0.6 + 0.4 * lvl));
    } else if (body === "bar") {
      rig.updateMatrixWorld(true);
      originDir(pixels[0].cone);
      const fc = facingOf(opts.cam, 15 * DEG);
      const front = fc.f > -0.05 ? 1 : 0;
      for (let i = 0; i < pixels.length; i++) {
        const px = pixels[i], p = a.pixels?.[i];
        const pr = p ? p.r : cr, pg = p ? p.g : cg, pb = p ? p.b : cb;
        const l = lvl * (p ? p.dim : 1);
        px.lens.material.color.setRGB(0.02 + pr * l * front * 4, 0.02 + pg * l * front * 4, 0.02 + pb * l * front * 4);
        setGlow(px.glow, pr, pg, pb, l * front * (0.35 + 1.4 * fc.inCone) * GG, 0.32 + 0.5 * fc.inCone);
        const u = px.cone.material.uniforms;
        u.r0.value = 0.035;
        u.len.value = beam.length;
        u.r1.value = 0.035 + beam.length * Math.tan(beam.angle * 0.5 * DEG);
        u.color.value.setRGB(pr, pg, pb);
        u.intensity.value = l * beam.power * 0.5 * G;
        u.haze.value = haze;
        u.time.value = opts.time || 0;
        u.facing.value = fc.inCone * 0.3;
        px.cone.visible = showBeams && l > 0.002 && haze > 0.01;
      }
    } else if (body === "strobe") {
      rig.updateMatrixWorld(true);
      originDir(E.cones[0]);
      const fc = facingOf(opts.cam, 55 * DEG);
      const v = lvl * (a.strobe > 0 ? 1 : 0.8);
      const k = 0.03 + v * 14;
      E.panel.material.color.setRGB(k, k, k * 1.05);
      const fw = Math.max(fc.f, 0);
      setGlow(E.glow, 1, 1, 1.05, v * (0.6 + 1.2 * fw) * GG, 1.2 + 2.6 * v);
      setStreak(E.streak, 0.85, 0.92, 1.05, v * (0.3 + 0.9 * fw) * GG, 3 + 5 * v);
      const u = E.cones[0].material.uniforms;
      u.r0.value = 0.22;
      u.len.value = beam.length;
      u.r1.value = 0.22 + beam.length * Math.tan(beam.angle * 0.5 * DEG);
      u.color.value.setRGB(1, 1, 1);
      u.intensity.value = v * 0.35 * G;
      u.haze.value = haze;
      u.time.value = opts.time || 0;
      E.cones[0].visible = showBeams && v > 0.002;
    } else if (cells) {
      rig.updateMatrixWorld(true);
      originDir(E.cones[0]);
      const fc = facingOf(opts.cam, 30 * DEG);
      // tungsten: deeper orange when dimmed
      const tr = 1, tg = 0.38 + 0.36 * lvl, tb = 0.1 + 0.32 * lvl;
      const front = fc.f > -0.05 ? 1 : 0;
      const fw = Math.max(fc.f, 0);
      for (const c of cells) {
        const k = 0.02 + lvl * front * 7;
        c.lens.material.color.setRGB(tr * k, tg * k, tb * k);
        setGlow(c.glow, tr, tg, tb, lvl * front * (0.5 + 1.3 * fw) * GG, 0.5 + 1.6 * lvl);
      }
      // anamorphic glare when looking into the blinder
      setStreak(E.streak, tr, tg * 0.95, tb * 0.9, lvl * lvl * front * (0.15 + 1.1 * fw * fw) * GG, 2.5 + 7 * lvl * (0.4 + 0.6 * fw));
      const u = E.cones[0].material.uniforms;
      u.r0.value = 0.3;
      u.len.value = beam.length;
      u.r1.value = 0.3 + beam.length * Math.tan(beam.angle * 0.5 * DEG);
      u.color.value.setRGB(tr, tg, tb);
      u.intensity.value = lvl * beam.power * 0.14 * G;
      u.haze.value = haze;
      u.time.value = opts.time || 0;
      u.facing.value = fc.inCone * 0.5;
      E.cones[0].visible = showBeams && lvl > 0.002;
    } else if (laser) {
      const pat = a.lzPattern, nb = Math.max(1, Math.round(a.lzBeams));
      const count = lvl < 0.002 ? 0 : pat === 0 ? 1 : pat === 2 ? Math.min(nb, 4) : nb;
      const fan = a.lzFan * DEG;
      laser.spin.rotation.y = pat === 4 ? 0 : t * a.lzSpeed * Math.PI * 0.5;
      rig.updateMatrixWorld(true);
      _o.setFromMatrixPosition(laser.spin.matrixWorld);
      _d.set(0, 1, 0).applyQuaternion(laser.spin.getWorldQuaternion(_q));
      const hit = opts.hit ? opts.hit(_o, _d, beam.length) : null;
      const len = hit ? Math.min(beam.length, hit.d) : beam.length;
      if (pat === 4) {
        // scan: leading line sweeps across the fan, trailing lines fade out (persistence sheet)
        const rate = Math.abs(a.lzSpeed) > 0.01 ? Math.abs(a.lzSpeed) : 1, tau = 0.45 / (rate * Math.max(count, 2));
        for (let i = 0; i < count; i++) setLine(i, fan * 0.5 * Math.sin(TAU * rate * (t - i * tau)), 0, Math.pow(1 - i / count, 1.6));
        laser.key = "";
        laser.lines.instanceMatrix.needsUpdate = true;
        if (laser.lines.instanceColor) laser.lines.instanceColor.needsUpdate = true;
      } else {
        const key = `${pat}|${count}|${a.lzFan}`;
        if (key !== laser.key) {
          laser.key = key;
          for (let i = 0; i < count; i++) {
            if (pat === 3) setLine(i, fan * 0.5, (i / count) * TAU, 1);
            else setLine(i, count === 1 ? 0 : (i / (count - 1) - 0.5) * fan, 0, 1);
          }
          laser.lines.instanceMatrix.needsUpdate = true;
          if (laser.lines.instanceColor) laser.lines.instanceColor.needsUpdate = true;
        }
      }
      laser.lines.count = count;
      laser.lines.visible = showBeams && count > 0;
      // keep lines ≥ ~1.3 px wide at any camera distance
      const dist = Math.max(1, _c.subVectors(opts.cam, _o).length());
      const pw = opts.pxWorld || 0.0015;
      const u = laser.lines.material.uniforms;
      u.r0.value = Math.max(0.01, dist * pw * 0.65);
      u.r1.value = u.r0.value + len * Math.max(0.0011, pw * 0.5);
      u.len.value = len;
      u.color.value.setRGB(cr, cg, cb);
      u.intensity.value = lvl * (pat === 2 ? 1.1 : pat === 3 ? 1.6 : 2.2) * G;
      u.haze.value = Math.max(haze, 0.45);
      u.time.value = opts.time || 0;
      const su = laser.sheet.material.uniforms;
      laser.sheet.visible = showBeams && lvl > 0.002 && (pat === 2 || pat === 4);
      laser.sheet.scale.set(len, len, 1);
      su.color.value.setRGB(cr, cg, cb);
      su.intensity.value = lvl * (pat === 4 ? 0.07 : 0.2) * G;
      su.haze.value = haze;
      su.time.value = opts.time || 0;
      su.fan.value = Math.max(fan, 0.01);
      su.len.value = len;
      const sh = laser.shell, shu = sh.material.uniforms;
      sh.visible = showBeams && lvl > 0.002 && pat === 3 && fan > 0.02;
      if (sh.visible) {
        shu.r0.value = 0.01;
        shu.r1.value = 0.01 + len * Math.tan(Math.min(fan * 0.5, 1.4));
        shu.len.value = len;
        shu.color.value.setRGB(cr, cg, cb);
        shu.intensity.value = lvl * 0.1 * G;
        shu.haze.value = haze;
        shu.time.value = opts.time || 0;
      }
      const k = lvl * 6;
      E.lens.material.color.setRGB(0.02 + cr * k, 0.02 + cg * k, 0.02 + cb * k);
      setGlow(E.glow, cr, cg, cb, lvl * 1.4 * GG, 0.35);
    } else if (fx) {
      updateFx(a, opts);
    } else if (hazeLed) {
      hazeLed.material.color.setRGB(0.04, 0.1 + a.dim * 1.5, 0.04);
    }
  }

  // FX: emit into the ring buffer while firing; flames fire a burst of ≥ 0.7 s per rising edge
  function updateFx(a, opts) {
    const now = opts.time || 0, dt = Math.min(opts.dt ?? 1 / 60, 0.1);
    const on = a.dim > FX_FIRE && opts.fxOn !== false;
    if (fx.kind === "flame" && on && !fx.was) fx.until = now + 0.7;
    fx.was = on;
    const firing = on || (fx.kind === "flame" && now < fx.until);
    const power = fx.kind === "spark" ? 0.6 + 4.6 * clamp(a.dim) : 0.55 + 0.45 * clamp(a.dim);
    fx.level += ((firing ? 1 : 0) - fx.level) * Math.min(1, dt * (firing ? 25 : 6));
    if (firing) {
      fx.acc += fx.cfg.rate * dt * (fx.kind === "spark" ? 0.6 + 0.4 * clamp(a.dim) : 1);
      let n = Math.min(Math.floor(fx.acc), fx.cfg.n);
      fx.acc -= n;
      const arr = fx.bp.array, N = fx.cfg.n, start = fx.head;
      for (let i = 0; i < n; i++) {
        const j = (fx.head + i) % N;
        arr[j * 2] = now - Math.random() * dt;
        arr[j * 2 + 1] = power;
      }
      fx.head = (fx.head + n) % N;
      if (n) {
        fx.bp.clearUpdateRanges();
        if (start + n <= N) fx.bp.addUpdateRange(start * 2, n * 2);
        else { fx.bp.addUpdateRange(start * 2, (N - start) * 2); fx.bp.addUpdateRange(0, (start + n - N) * 2); }
        fx.bp.needsUpdate = true;
      }
    } else fx.acc = 0;
    const m = fx.pts.material.uniforms;
    m.uGain.value = opts.fxGain ?? 1;
    if (fx.kind === "co2") {
      const tint = opts.tint;
      m.uTint.value.setRGB(0.85, 0.9, 1).multiplyScalar(0.55);
      if (tint) m.uTint.value.r += tint.r * 0.6, m.uTint.value.g += tint.g * 0.6, m.uTint.value.b += tint.b * 0.6;
    }
    const L = fx.level;
    if (fx.kind === "flame") { light[0] = 0.6 * L; light[1] = 0.25 * L; light[2] = 0.06 * L; setGlow(E.glow, 1, 0.55, 0.15, L * 0.8, 1.6); }
    else if (fx.kind === "spark") { light[0] = 0.14 * L; light[1] = 0.1 * L; light[2] = 0.05 * L; setGlow(E.glow, 1, 0.8, 0.5, L * 0.9, 0.6); }
    else { light[0] = light[1] = light[2] = 0.05 * L; E.glow.visible = false; }
  }

  return {
    object: root,
    proxy,
    fixture,
    def,
    update,
    light,
    setSelected(on) { outline.visible = !!on; },
    dispose() {
      root.removeFromParent();
      for (const o of own) o.dispose();
    },
  };
}

// StemStage – 3D-Bühne (three.js, alles prozedural)
// Vertrag: constructor(containerEl, engine), setSong(song), onMemberClick(cb), highlight(id|null), dispose()
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ */
/* Konstanten & Helfer                                                 */
/* ------------------------------------------------------------------ */
const TAU = Math.PI * 2;
const INSTRUMENTS = ['vocals', 'guitar', 'bass', 'drums', 'piano', 'other'];
const DEFAULT_COLORS = {
  vocals: '#ff3d8b', guitar: '#ffb020', bass: '#3dd6ff',
  drums: '#7cff4d', piano: '#b26bff', other: '#ff7a45',
};
const DEFAULT_LABELS = {
  vocals: 'Gesang', guitar: 'Gitarre', bass: 'E-Bass',
  drums: 'Schlagzeug', piano: 'Keyboard', other: 'Sonstiges',
};
const SKINS = ['#ffd5b5', '#e9b48c', '#c98a5e', '#8d5a3b', '#f6c9a6', '#a8704a'];
const HAIRS = ['#2a1a12', '#e3b85c', '#6b2f1a', '#16151f', '#ff6fb5', '#5a3a22', '#7fd8ff'];
const PANTS = ['#232842', '#2b2233', '#1d2a2e', '#302a24', '#1f1f2b', '#2a2f45'];
const HAIR_STYLES = {
  vocals: ['quiff', 'long', 'afro'],
  guitar: ['beanie', 'long'],
  bass: ['cap', 'afro'],
  drums: ['spiky'],
  piano: ['bun', 'quiff'],
  other: ['headphones'],
};
const MAX_LIGHTS = 6;
const RISER_H = 0.62;
const STAGE_FRONT_Z = 2.8;
const GROUND_Y = -0.9;

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const frac = (v) => v - Math.floor(v);

function normInstrument(i) {
  const s = String(i || '').toLowerCase();
  if (INSTRUMENTS.includes(s)) return s;
  if (/voc|voice|sing|gesang/.test(s)) return 'vocals';
  if (/drum|perc|schlag/.test(s)) return 'drums';
  if (/bass/.test(s)) return 'bass';
  if (/guit|gitar/.test(s)) return 'guitar';
  if (/piano|key|synth|klav/.test(s)) return 'piano';
  return 'other';
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function radialTexture(stops, size = 128) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function grayOf(c) {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const v = Math.min(0.5, l * 0.6 + 0.012);
  return new THREE.Color(v * 0.92, v * 0.95, v * 1.08);
}

/* ------------------------------------------------------------------ */
/* Shader                                                              */
/* ------------------------------------------------------------------ */
const WALL_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const WALL_FRAG = /* glsl */`
uniform float uTime;
uniform float uBeat;
uniform float uEnergy;
uniform float uPlaying;
uniform float uCount;
uniform vec3 uColors[6];
uniform float uLevels[6];
uniform vec2 uGrid;
varying vec2 vUv;

vec3 paletteAt(float x){
  vec3 c = vec3(0.0); float ws = 0.0;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uCount) break;
    float d = x - (float(i) + 0.5);
    float w = exp(-d * d * 1.6);
    c += uColors[i] * w; ws += w;
  }
  return c / max(ws, 1e-4);
}

void main(){
  vec2 g = vUv * uGrid;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 p = (cell + 0.5) / uGrid;
  float d = length(f);
  float fw = fwidth(g.x);
  float dotM = 1.0 - smoothstep(0.30 - fw * 0.8, 0.30 + fw * 0.8, d);
  dotM = mix(dotM, 0.30, clamp(fw * 1.6 - 0.45, 0.0, 1.0));

  float t = uTime;
  float cnt = max(uCount, 1.0);
  // Hintergrund: weiche Wellen + Beat-Ringe
  float w1 = sin(p.x * 8.0 + t * 0.8 + sin(p.y * 5.0 + t * 0.6) * 1.7) * 0.5 + 0.5;
  float r = length((p - vec2(0.5, 0.42)) * vec2(2.6, 1.0));
  float ring = sin(r * 16.0 - uBeat * 6.2831853) * 0.5 + 0.5;
  ring = pow(ring, 3.0);
  float bg = mix(w1 * 0.6, ring, 0.55 * uPlaying);
  vec3 col = paletteAt(p.x * cnt + 0.5 * sin(p.y * 3.0 + t * 0.35));
  vec3 c = col * (0.035 + 0.16 * bg * (0.35 + uEnergy));

  // VU-Balken pro Stem, gespiegelt um die Mitte
  float gi = floor(p.x * cnt);
  float local = fract(p.x * cnt);
  float lvl = 0.0; vec3 bc = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    if (float(i) == gi) { lvl = uLevels[i]; bc = uColors[i]; }
  }
  float colMask = step(0.30, local) * step(local, 0.70);
  float cy = 0.5;
  float h = lvl * 0.36 + 0.008;
  float dy = abs(p.y - cy);
  float bar = colMask * step(dy, h);
  float tip = smoothstep(h - 0.06, h, dy);
  c += bc * bar * (0.35 + 0.9 * tip) * (0.4 + 0.6 * uPlaying);

  // Beat-Blitz
  float flash = pow(1.0 - fract(uBeat), 6.0) * uPlaying * uEnergy;
  c += col * flash * 0.22;

  gl_FragColor = vec4(c * dotM * 1.5, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const CONE_VERT = /* glsl */`
varying float vH;
varying vec3 vN;
varying vec3 vV;
void main(){
  vH = position.z;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const CONE_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uIntensity;
varying float vH;
varying vec3 vN;
varying vec3 vV;
void main(){
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.8);
  float fade = mix(1.0, 0.18, vH) * smoothstep(0.0, 0.05, vH);
  gl_FragColor = vec4(uColor * uIntensity * edge * fade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const CROWD_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vW;
varying vec3 vCol;
void main(){
  mat4 im = mat4(1.0);
  #ifdef USE_INSTANCING
    im = instanceMatrix;
  #endif
  vec4 wp = modelMatrix * im * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix * im) * normal);
  vW = wp.xyz;
  vCol = vec3(0.05);
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const CROWD_FRAG = /* glsl */`
uniform vec3 uRim;
uniform vec3 uRim2;
uniform float uEnergy;
varying vec3 vN;
varying vec3 vW;
varying vec3 vCol;
void main(){
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vN);
  float rim = smoothstep(0.55, 0.97, 1.0 - clamp(abs(dot(N, V)), 0.0, 1.0));
  float up = clamp(N.y, 0.0, 1.0);
  float side = smoothstep(-6.0, 6.0, vW.x);
  vec3 rc = mix(uRim, uRim2, side);
  vec3 c = vCol + rc * rim * (0.22 + 0.7 * uEnergy) + rc * up * 0.012 * (0.4 + uEnergy);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ------------------------------------------------------------------ */
/* Stage3D                                                             */
/* ------------------------------------------------------------------ */
export class Stage3D {
  constructor(containerEl, engine) {
    this.container = containerEl;
    this.engine = engine || null;
    this._disposed = false;
    this._members = [];
    this._clickCbs = new Set();
    this._hoverId = null;
    this._highlightId = null;
    this._shared = new Set();
    this._song = null;
    this._time = 0;
    this._beat = 0;
    this._idleBeat = 0;
    this._energy = 0;
    this._playingF = 0;
    this._userAz = 0; this._userEl = 0;
    this._camAz = 0; this._camEl = 0;
    this._ptr = null;
    this._mouse = new THREE.Vector2();
    this._mouseInside = false;
    this._hoverDirty = false;
    this._raycaster = new THREE.Raycaster();
    this._tmpV = new THREE.Vector3();
    this._dummy = new THREE.Object3D();
    this._camBase = { dist: 11, el: 0.34, ty: 1.0, tz: 0.2 };
    this._raf = 0;
    this._rimA = new THREE.Color('#b04dff');
    this._rimB = new THREE.Color('#2fd5ff');
    this._rimBase = new THREE.Color('#7a3dff');

    const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    this._isTouch = coarse || (navigator.maxTouchPoints || 0) > 0;
    this._lowPower = this._isTouch || window.innerWidth <= 900;

    this._initRenderer();
    this._initShared();
    this._initScene();
    this._buildStage();
    this._buildCrowd();
    this._initInput();
    this._resize();

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(containerEl);
    } else {
      window.addEventListener('resize', this._onWinResize);
    }
    document.addEventListener('visibilitychange', this._onVisibility);

    if (!this._lowPower) this._initBloom();

    const song = this._eng('song');
    if (song && Array.isArray(song.stems)) this.setSong(song);

    this._last = performance.now();
    if (!document.hidden) this._raf = requestAnimationFrame(this._loop);
  }

  /* ------------------------- öffentliche API ------------------------- */

  setSong(song) {
    if (this._disposed) return;
    this._clearMembers();
    this._song = song && Array.isArray(song.stems) ? song : null;
    if (!this._song) { this._syncWallColors(); return; }
    const stems = this._song.stems.filter(Boolean);
    const slots = this._layout(stems);
    stems.forEach((stem, i) => {
      try {
        const m = this._buildMember(stem, i, slots[i]);
        this._members.push(m);
      } catch (err) {
        console.error('[Stage3D] Musiker konnte nicht gebaut werden', stem, err);
      }
    });
    // Punktlichter zuweisen
    this._pLights.forEach((L, i) => {
      const m = this._members[i];
      if (m) {
        L.color.copy(m.color).lerp(new THREE.Color(0xffffff), 0.45);
        L.position.set(m.slot.x * 0.95, m.slot.y + 2.0, m.slot.z + 1.2);
      } else {
        L.intensity = 0;
      }
    });
    this._syncWallColors();
    this._hoverDirty = true;
  }

  onMemberClick(cb) {
    if (typeof cb !== 'function') return () => {};
    this._clickCbs.add(cb);
    return () => this._clickCbs.delete(cb);
  }

  highlight(stemId) {
    this._highlightId = stemId == null ? null : String(stemId);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._ro?.disconnect();
    window.removeEventListener('resize', this._onWinResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._onPointerDown);
    c.removeEventListener('pointermove', this._onPointerMove);
    c.removeEventListener('pointerup', this._onPointerUp);
    c.removeEventListener('pointercancel', this._onPointerCancel);
    c.removeEventListener('pointerleave', this._onPointerLeave);
    this._clearMembers();
    this.scene.traverse((o) => this._disposeNode(o, true));
    for (const r of this._shared) r.dispose?.();
    this._shared.clear();
    this._envRT?.dispose();
    try { this._bloom?.dispose?.(); this._composer?.dispose?.(); } catch (_) { /* egal */ }
    this._composer = null;
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch (_) { /* egal */ }
    c.remove();
    this._clickCbs.clear();
    this._members = [];
  }

  /* ------------------------- Engine-Zugriff ------------------------- */

  _eng(prop) {
    try { return this.engine ? this.engine[prop] : undefined; } catch (_) { return undefined; }
  }
  _level(id) {
    try {
      const v = this.engine && typeof this.engine.getLevel === 'function' ? this.engine.getLevel(id) : 0;
      return Number.isFinite(v) ? clamp(v, 0, 1) : 0;
    } catch (_) { return 0; }
  }
  _audible(id) {
    try {
      return this.engine && typeof this.engine.isAudible === 'function' ? !!this.engine.isAudible(id) : true;
    } catch (_) { return true; }
  }

  /* ------------------------- Setup ------------------------- */

  _initRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.setClearColor(0x05040a, 1);
    const c = r.domElement;
    Object.assign(c.style, {
      display: 'block', width: '100%', height: '100%',
      touchAction: 'pan-y', outline: 'none', userSelect: 'none',
      webkitTapHighlightColor: 'transparent',
    });
    c.setAttribute('aria-label', '3D-Bühne: Musiker antippen, um Instrumente stumm zu schalten');
    this.container.appendChild(c);
    this.renderer = r;
    this.canvas = c;
  }

  _sh(res) { this._shared.add(res); return res; }

  _initShared() {
    const S = (r) => this._sh(r);
    const cylZ = new THREE.CylinderGeometry(1, 1, 1, 24); cylZ.rotateX(Math.PI / 2);
    const cone = new THREE.ConeGeometry(1, 1, 32, 1, true);
    cone.translate(0, -0.5, 0); cone.rotateX(-Math.PI / 2);
    const laser = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    laser.translate(0, 0.5, 0); laser.rotateX(Math.PI / 2);
    const floorPlane = new THREE.PlaneGeometry(1, 1); floorPlane.rotateX(-Math.PI / 2);
    const ring = new THREE.RingGeometry(0.82, 1, 48); ring.rotateX(-Math.PI / 2);
    this.G = {
      sphere: S(new THREE.SphereGeometry(1, 22, 14)),
      sphereLo: S(new THREE.SphereGeometry(1, 12, 8)),
      cyl: S(new THREE.CylinderGeometry(1, 1, 1, 24)),
      cylLo: S(new THREE.CylinderGeometry(1, 1, 1, 8)),
      cylZ: S(cylZ),
      box: S(new THREE.BoxGeometry(1, 1, 1)),
      cone: S(cone),
      spike: S(new THREE.ConeGeometry(1, 1, 8)),
      laser: S(laser),
      floorPlane: S(floorPlane),
      ring: S(ring),
      thigh: S(new THREE.CapsuleGeometry(0.088, 0.16, 6, 14)),
      shin: S(new THREE.CapsuleGeometry(0.08, 0.13, 6, 14)),
      chest: S(new THREE.CapsuleGeometry(0.25, 0.28, 10, 24)),
      upperArm: S(new THREE.CapsuleGeometry(0.068, 0.14, 6, 12)),
      foreArm: S(new THREE.CapsuleGeometry(0.06, 0.12, 6, 12)),
      hairCap: S(new THREE.SphereGeometry(0.318, 24, 12, 0, TAU, 0, Math.PI * 0.56)),
      hatCap: S(new THREE.SphereGeometry(0.335, 24, 12, 0, TAU, 0, Math.PI * 0.5)),
      smile: S(new THREE.TorusGeometry(0.05, 0.013, 6, 14, Math.PI)),
      torus: S(new THREE.TorusGeometry(1, 0.08, 8, 32)),
      hpBand: S(new THREE.TorusGeometry(0.335, 0.028, 6, 24, Math.PI)),
      hoop: S(new THREE.TorusGeometry(1, 0.06, 6, 28)),
    };
    this._rboxCache = new Map();

    this.T = {
      glow: S(radialTexture([[0, 'rgba(255,255,255,1)'], [0.22, 'rgba(255,255,255,0.55)'], [0.55, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']])),
      pool: S(radialTexture([[0, 'rgba(255,255,255,0.95)'], [0.45, 'rgba(255,255,255,0.4)'], [0.8, 'rgba(255,255,255,0.08)'], [1, 'rgba(255,255,255,0)']])),
      shadow: S(radialTexture([[0, 'rgba(0,0,0,0.85)'], [0.55, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']])),
      zzz: S(this._makeZzzTexture()),
    };

    this.M = {
      chrome: S(new THREE.MeshStandardMaterial({ color: 0xd8dae6, metalness: 0.95, roughness: 0.22 })),
      darkMetal: S(new THREE.MeshStandardMaterial({ color: 0x2a2a34, metalness: 0.7, roughness: 0.4 })),
      truss: S(new THREE.MeshStandardMaterial({ color: 0x9da0b4, metalness: 0.85, roughness: 0.35 })),
      gold: S(new THREE.MeshStandardMaterial({ color: 0xe2b24a, metalness: 0.95, roughness: 0.28 })),
      eye: S(new THREE.MeshStandardMaterial({ color: 0x0b0a12, roughness: 0.15, metalness: 0.1 })),
      eyeHi: S(new THREE.MeshBasicMaterial({ color: 0xffffff })),
      rubber: S(new THREE.MeshStandardMaterial({ color: 0x15141b, roughness: 0.8 })),
      white: S(new THREE.MeshStandardMaterial({ color: 0xf1eee8, roughness: 0.45 })),
      black: S(new THREE.MeshStandardMaterial({ color: 0x0d0c12, roughness: 0.35 })),
      cab: S(new THREE.MeshStandardMaterial({ color: 0x17151e, roughness: 0.55, metalness: 0.15 })),
      grill: S(new THREE.MeshStandardMaterial({ color: 0x24212c, roughness: 0.95 })),
      shadow: S(new THREE.MeshBasicMaterial({ map: this.T.shadow, transparent: true, depthWrite: false, toneMapped: false })),
      hitbox: S(new THREE.MeshBasicMaterial({ visible: false })),
    };
    this._coneBase = this._sh(new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uIntensity: { value: 0.5 } },
      vertexShader: CONE_VERT, fragmentShader: CONE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
  }

  _rbox(w, h, d, r = 0.04, seg = 3) {
    const key = `${w}|${h}|${d}|${r}|${seg}`;
    let g = this._rboxCache.get(key);
    if (!g) {
      g = this._sh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) - 1e-4));
      this._rboxCache.set(key, g);
    }
    return g;
  }

  _makeEnvScene() {
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x030206);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const add = (hex, k, p, s) => {
      const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) }));
      m.position.set(...p); m.scale.set(...s); sc.add(m);
    };
    add(0x9c8cff, 0.35, [0, 9, 1], [10, 0.3, 4]);
    add(0xff3d8b, 1.6, [-8, 2, -1], [0.3, 3, 7]);
    add(0x3dd6ff, 1.6, [8, 2, -1], [0.3, 3, 7]);
    add(0xb26bff, 2.4, [0, 3, -9], [14, 2.5, 0.3]);
    add(0xffc890, 1.1, [0, 3, 10], [9, 3, 0.3]);
    return sc;
  }

  _initScene() {
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x06050c);
    s.fog = new THREE.FogExp2(0x0a0716, 0.028);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 90);

    // Umgebungs-Reflexionen (prozedural, einmalig)
    try {
      const pm = new THREE.PMREMGenerator(this.renderer);
      const envScene = this._makeEnvScene();
      this._envRT = pm.fromScene(envScene, 0.04);
      s.environment = this._envRT.texture;
      s.environmentIntensity = 0.75;
      envScene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
      pm.dispose();
    } catch (err) { console.warn('[Stage3D] Env-Map fehlgeschlagen', err); }

    s.add(new THREE.HemisphereLight(0x6f62ff, 0x0c0616, 0.45));
    const key = new THREE.DirectionalLight(0xffeedd, 1.25);
    key.position.set(1.5, 7, 9);
    s.add(key);
    const rim = new THREE.DirectionalLight(0xb04dff, 2.4);
    rim.position.set(-3, 5, -7);
    s.add(rim);
    this._rimLight = rim;

    this._pLights = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const L = new THREE.PointLight(0xffffff, 0, 4.2, 1.2);
      L.position.set(0, -20, 0);
      s.add(L);
      this._pLights.push(L);
    }
  }

  _floorTexture() {
    const c = makeCanvas(512, 512);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1a1826';
    ctx.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 64) {
      for (let x = 0; x < 512; x += 128) {
        const off = (y / 64) % 2 ? 64 : 0;
        const v = 22 + Math.floor(Math.random() * 8);
        ctx.fillStyle = `rgb(${v},${v - 2},${v + 12})`;
        ctx.fillRect(((x + off) % 512), y + 1, 126, 62);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    for (let y = 0; y <= 512; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(5, 3);
    t.anisotropy = 4;
    return t;
  }

  _buildStage() {
    const S = this.scene;
    const G = this.G;
    const add = (geo, mat, p, sc, parent = S) => {
      const m = new THREE.Mesh(geo, mat);
      if (p) m.position.set(...p);
      if (sc) (typeof sc === 'number' ? m.scale.setScalar(sc) : m.scale.set(...sc));
      parent.add(m);
      return m;
    };

    // Bühnenboden (glänzend)
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x8a86a0, map: this._floorTexture(), roughness: 0.36, metalness: 0.4 });
    add(G.box, floorMat, [0, -0.45, -0.45], [11.6, 0.9, 6.5]);
    // Publikumsboden
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x0b0912, roughness: 0.7, metalness: 0.2 });
    add(G.floorPlane, groundMat, [0, GROUND_Y, 11], [60, 1, 18]);
    add(G.floorPlane, groundMat, [0, GROUND_Y - 0.01, -6], [60, 1, 20]);

    // LED-Streifen
    this._strips = [];
    const strip = (p, s) => {
      const m = add(G.box, new THREE.MeshBasicMaterial({ color: 0xff3d8b }), p, s);
      this._strips.push(m);
      return m;
    };
    strip([0, -0.04, STAGE_FRONT_Z - 0.02], [11.6, 0.06, 0.06]);
    strip([0, -0.82, STAGE_FRONT_Z - 0.02], [11.6, 0.04, 0.04]);

    // Rückwand + LED-Raster
    add(this._rbox(13.2, 6.0, 0.3, 0.08), this.M.cab, [0, 2.7, -3.95]);
    this._wallMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uBeat: { value: 0 }, uEnergy: { value: 0 }, uPlaying: { value: 0 },
        uCount: { value: 5 }, uGrid: { value: new THREE.Vector2(104, 44) },
        uColors: { value: Array.from({ length: 6 }, (_, i) => new THREE.Color(Object.values(DEFAULT_COLORS)[i])) },
        uLevels: { value: new Array(6).fill(0) },
      },
      vertexShader: WALL_VERT, fragmentShader: WALL_FRAG,
    });
    add(new THREE.PlaneGeometry(12.4, 5.25), this._wallMat, [0, 2.75, -3.78]);
    // Säulen-LEDs an den Wandseiten
    strip([-6.45, 2.7, -3.78], [0.06, 5.6, 0.06]);
    strip([6.45, 2.7, -3.78], [0.06, 5.6, 0.06]);

    // Drum-Podest
    const riserMat = new THREE.MeshStandardMaterial({ color: 0x23202e, roughness: 0.25, metalness: 0.45 });
    add(this._rbox(4.0, RISER_H, 2.1, 0.05), riserMat, [0, RISER_H / 2, -2.35]);
    strip([0, RISER_H - 0.04, -1.29], [4.0, 0.04, 0.04]);

    // Traversen
    const segs = [];
    const T = (a, b, s = 0.34) => this._trussSegments(new THREE.Vector3(...a), new THREE.Vector3(...b), s, segs);
    const fy = 4.75, by = 5.1, fz = 2.3, bz = -3.3, tx = 6.25;
    T([-tx, fy, fz], [tx, fy, fz]);
    T([-tx, by, bz], [tx, by, bz]);
    T([-tx, GROUND_Y, fz], [-tx, fy, fz]);
    T([tx, GROUND_Y, fz], [tx, fy, fz]);
    T([-tx, 0, bz], [-tx, by, bz]);
    T([tx, 0, bz], [tx, by, bz]);
    T([-tx, fy, fz], [-tx, by, bz]);
    T([tx, fy, fz], [tx, by, bz]);
    const trussMesh = new THREE.InstancedMesh(G.cylLo, this.M.truss, segs.length);
    segs.forEach((mat, i) => trussMesh.setMatrixAt(i, mat));
    trussMesh.instanceMatrix.needsUpdate = true;
    S.add(trussMesh);
    this._trussFront = { y: fy, z: fz };

    // PA-Türme
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(sx * 5.25, 0, 1.3);
      g.rotation.y = -sx * 0.25;
      S.add(g);
      add(this._rbox(0.95, 1.7, 0.75, 0.05), this.M.cab, [0, 0.85, 0], null, g);
      for (const [y, r] of [[1.32, 0.28], [0.72, 0.36], [0.22, 0.14]]) {
        add(G.cylZ, this.M.grill, [0, y, 0.38], [r, r, 0.02], g);
        add(G.sphereLo, this.M.darkMetal, [0, y, 0.38], [r * 0.32, r * 0.32, r * 0.18], g);
      }
      const led = add(G.sphereLo, new THREE.MeshBasicMaterial({ color: 0x3dd6ff }), [0.36, 1.62, 0.38], 0.025, g);
      this._strips.push(led);
      this._bakeTree(g, new Set());
    }
    // Monitorboxen
    for (const sx of [-1.6, 1.6]) {
      const w = add(this._rbox(0.7, 0.32, 0.45, 0.04), this.M.cab, [sx, 0.16, 2.25]);
      w.rotation.x = -0.45;
      add(G.box, this.M.grill, [0, 0.0, 0.226], [0.6, 0.24, 0.01], w);
    }

    // Moving Heads + Strahlen an der hinteren Traverse
    this._beams = [];
    const nb = 6;
    for (let i = 0; i < nb; i++) {
      const x = lerp(-5.0, 5.0, i / (nb - 1));
      const g = new THREE.Group();
      g.position.set(x, by - 0.32, bz + 0.05);
      S.add(g);
      add(this._rbox(0.3, 0.22, 0.3, 0.04), this.M.darkMetal, [0, 0.1, 0], null, g);
      const head = new THREE.Group();
      g.add(head);
      add(G.cylZ, this.M.darkMetal, [0, 0, 0], [0.13, 0.13, 0.28], head);
      const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      add(G.cylZ, lensMat, [0, 0, 0.145], [0.1, 0.1, 0.01], head);
      const coneMat = this._coneBase.clone();
      const cone = new THREE.Mesh(G.cone, coneMat);
      cone.scale.set(0.8, 0.8, 5.6);
      cone.renderOrder = 2;
      head.add(cone);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.T.glow, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      glow.position.set(0, 0, 0.18); glow.scale.setScalar(0.9);
      head.add(glow);
      this._beams.push({ g, head, cone, coneMat, lensMat, glow, i, x });
    }

    // Laser
    this._lasers = [];
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x57ff9a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(G.laser, mat);
      const sx = i < 2 ? -1 : 1;
      m.position.set(sx * 5.9, 5.0 - (i % 2) * 0.4, -3.6);
      m.scale.set(0.012, 0.012, 13);
      m.renderOrder = 3;
      S.add(m);
      this._lasers.push({ m, mat, sx, i });
    }
  }

  _trussSegments(a, b, size, out) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    const ref = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(dir, ref).normalize();
    const v = new THREE.Vector3().crossVectors(dir, u).normalize();
    const h = size / 2;
    const corners = [[h, h], [-h, h], [-h, -h], [h, -h]].map(([cu, cv]) => u.clone().multiplyScalar(cu).add(v.clone().multiplyScalar(cv)));
    const up = new THREE.Vector3(0, 1, 0);
    const seg = (p1, p2, r) => {
      const d = new THREE.Vector3().subVectors(p2, p1);
      const l = d.length();
      const q = new THREE.Quaternion().setFromUnitVectors(up, d.normalize());
      const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
      out.push(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(r, l, r)));
    };
    for (const c of corners) seg(a.clone().add(c), b.clone().add(c), 0.028);
    const n = Math.max(2, Math.round(len / 0.5));
    for (let k = 0; k < 4; k++) {
      const c1 = corners[k], c2 = corners[(k + 1) % 4];
      for (let i = 0; i < n; i++) {
        const t1 = i / n, t2 = (i + 1) / n;
        const p1 = a.clone().lerp(b, t1).add(i % 2 ? c1 : c2);
        const p2 = a.clone().lerp(b, t2).add(i % 2 ? c2 : c1);
        seg(p1, p2, 0.014);
      }
    }
  }

  _buildCrowd() {
    const N = this._lowPower ? 84 : 120;
    const body = new THREE.CapsuleGeometry(0.21, 0.5, 4, 10); body.translate(0, 0.5, 0);
    const head = new THREE.SphereGeometry(0.16, 12, 9); head.translate(0, 1.07, 0);
    const bodyGeo = this._sh(mergeGeometries([body, head]));
    body.dispose(); head.dispose();
    const armGeo = this._sh(new THREE.CapsuleGeometry(0.05, 0.38, 3, 6)); armGeo.translate(0, 0.24, 0);

    const mat = this._crowdMat = new THREE.ShaderMaterial({
      uniforms: { uRim: { value: this._rimA.clone() }, uRim2: { value: this._rimB.clone() }, uEnergy: { value: 0 } },
      vertexShader: CROWD_VERT, fragmentShader: CROWD_FRAG,
    });
    const people = [];
    let z = 3.35, row = 0;
    while (people.length < N) {
      const halfW = 5.2 + (z - 3.3) * 0.9;
      const spacing = this._lowPower ? 0.62 : 0.5;
      const count = Math.floor((halfW * 2) / spacing);
      for (let i = 0; i < count && people.length < N; i++) {
        const x = -halfW + (i + 0.5) * spacing + (row % 2 ? spacing * 0.5 : 0) + (Math.random() - 0.5) * 0.25;
        people.push({
          x, z: z + (Math.random() - 0.5) * 0.3,
          s: 0.86 + Math.random() * 0.26,
          off: (Math.random() - 0.5) * 0.12,
          amp: 0.12 + Math.random() * 0.2,
          seed: Math.random(),
          thr: 0.3 + Math.random() * 1.0,
          raise: 0,
          phone: Math.random() < 0.16,
          rot: (Math.random() - 0.5) * 0.4,
        });
      }
      z += 0.55; row++;
    }
    const mesh = new THREE.InstancedMesh(bodyGeo, mat, people.length);
    const arms = new THREE.InstancedMesh(armGeo, mat, people.length * 2);
    const col = new THREE.Color();
    people.forEach((p, i) => {
      col.setHSL(0.68 + Math.random() * 0.15, 0.4, 0.5).multiplyScalar(0.006 + Math.random() * 0.012);
      mesh.setColorAt(i, col);
      arms.setColorAt(i * 2, col);
      arms.setColorAt(i * 2 + 1, col);
    });
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    arms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; arms.frustumCulled = false;
    this.scene.add(mesh, arms);

    // Handy-Lichter
    const pGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(people.length * 3);
    const pc = new Float32Array(people.length * 3);
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pc, 3).setUsage(THREE.DynamicDrawUsage));
    const pMat = new THREE.PointsMaterial({ size: 0.42, map: this.T.glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const points = new THREE.Points(pGeo, pMat);
    points.frustumCulled = false;
    points.renderOrder = 4;
    this.scene.add(points);
    this._crowd = { people, mesh, arms, points, pos, pc };
  }

  _initInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', this._onPointerDown);
    c.addEventListener('pointermove', this._onPointerMove);
    c.addEventListener('pointerup', this._onPointerUp);
    c.addEventListener('pointercancel', this._onPointerCancel);
    c.addEventListener('pointerleave', this._onPointerLeave);
  }

  async _initBloom() {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/postprocessing/OutputPass.js'),
      ]);
      if (this._disposed) return;
      const size = this.renderer.getSize(new THREE.Vector2());
      const pr = this.renderer.getPixelRatio();
      const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x * pr), Math.max(1, size.y * pr), { type: THREE.HalfFloatType, samples: 4 });
      const comp = new EffectComposer(this.renderer, rt);
      comp.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(Math.max(1, size.x), Math.max(1, size.y)), 0.5, 0.45, 0.86);
      comp.addPass(bloom);
      comp.addPass(new OutputPass());
      comp.setPixelRatio(pr);
      comp.setSize(Math.max(1, size.x), Math.max(1, size.y));
      this._composer = comp;
      this._bloom = bloom;
    } catch (err) {
      console.warn('[Stage3D] Bloom nicht verfügbar – fahre ohne fort.', err);
    }
  }

  /* ------------------------- Layout ------------------------- */

  _layout(stems) {
    const slots = new Array(stems.length);
    const drums = [], vocals = [], rest = [];
    stems.forEach((s, i) => {
      const inst = normInstrument(s.instrument);
      (inst === 'drums' ? drums : inst === 'vocals' ? vocals : rest).push(i);
    });
    // Podest hinten-mittig
    drums.forEach((idx, k) => {
      const x = (k - (drums.length - 1) / 2) * 1.75 + (drums.length === 1 ? 0.35 : 0);
      slots[idx] = { x, y: RISER_H, z: -2.15 };
    });
    // vorne mittig
    const front = vocals.slice();
    if (!front.length && rest.length) front.push(rest.shift());
    const fs = front.length > 2 ? 1.15 : 1.3;
    front.forEach((idx, k) => {
      const x = (k - (front.length - 1) / 2) * fs - (front.length === 1 && drums.length === 1 ? 0.3 : 0);
      slots[idx] = { x, y: 0, z: 1.0 - Math.abs(x) * 0.15 };
    });
    // Seiten im Halbkreis
    const frontHalf = ((front.length - 1) / 2) * fs;
    const left = [], right = [];
    rest.forEach((idx, k) => (k % 2 === 0 ? left : right).push(idx));
    const R = 3.4, zc = -1.5;
    const place = (arr, sign) => {
      const n = arr.length;
      const a0 = Math.max(0.68, Math.asin(Math.min(0.97, (frontHalf + 1.45) / R)));
      const a1 = 1.45;
      arr.forEach((idx, k) => {
        const a = n === 1 ? Math.min(a1, a0 + 0.1) : lerp(a0, a1, k / (n - 1));
        const r = R + k * 0.3;
        slots[idx] = { x: sign * r * Math.sin(a), y: 0, z: zc + r * Math.cos(a) };
      });
    };
    place(left, -1);
    place(right, 1);
    for (const s of slots) {
      if (!s) continue;
      const dx = -s.x * 0.75, dz = 9 - s.z;
      s.rot = Math.atan2(dx, dz);
    }
    return slots;
  }

  /* ------------------------- Musiker bauen ------------------------- */

  _buildMember(stem, index, slot) {
    const G = this.G, M = this.M;
    const inst = normInstrument(stem.instrument);
    const color = new THREE.Color(stem.color || DEFAULT_COLORS[inst]);
    const id = String(stem.id ?? `${inst}-${index}`);
    let h = 0; for (const ch of id + inst) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const variant = (h + index) >>> 0;

    const m = {
      id, stem, inst, color, index, slot,
      mats: [], pulses: [], seed: (h % 1000) / 1000,
      peak: 0.05, norm: 0, energy: 0, mute: 0, hover: 0,
      popT: 10, popAmp: 0, audible: true, audibleInit: false,
      ringT: 10, blinkT: 1.5 + Math.random() * 3, blink: 1,
      _am: -1, _ah: -1, props: {}, seated: inst === 'drums',
    };
    const mat = (c, o = {}) => {
      const base = new THREE.Color(c);
      const mm = new THREE.MeshStandardMaterial({
        color: base.clone(), roughness: o.rough ?? 0.55, metalness: o.metal ?? 0,
        emissive: o.emissive ? new THREE.Color(o.emissive) : new THREE.Color(0x000000),
        emissiveIntensity: o.ei ?? 0, side: o.side ?? THREE.FrontSide,
      });
      const entry = { mat: mm, base, gray: grayOf(base), ei: o.ei ?? 0, glow: !!o.glow, pulse: o.pulse || 0 };
      m.mats.push(entry);
      if (entry.pulse) m.pulses.push(entry);
      return mm;
    };
    const add = (geo, mt, parent, p, s, r) => {
      const mesh = new THREE.Mesh(geo, mt);
      if (p) mesh.position.set(p[0], p[1], p[2]);
      if (s != null) (typeof s === 'number' ? mesh.scale.setScalar(s) : mesh.scale.set(s[0], s[1], s[2]));
      if (r) mesh.rotation.set(r[0], r[1], r[2]);
      parent.add(mesh);
      return mesh;
    };
    m.add = add; m.mat = mat;

    const root = new THREE.Group();
    root.position.set(slot.x, slot.y, slot.z);
    root.rotation.y = slot.rot;
    this.scene.add(root);
    m.root = root;
    const body = new THREE.Group();
    root.add(body);
    m.body = body;
    const figure = new THREE.Group();
    body.add(figure);
    m.figure = figure;

    const skinMat = mat(SKINS[variant % SKINS.length], { rough: 0.6 });
    const shirtMat = mat(color, { rough: 0.5, emissive: color, ei: 0.1, glow: true });
    const pantsMat = mat(PANTS[(variant >> 2) % PANTS.length], { rough: 0.75 });
    const shoeMat = mat(variant % 2 ? '#f2f2f6' : '#1b1a22', { rough: 0.45 });
    const hairMat = mat(HAIRS[(variant >> 3) % HAIRS.length], { rough: 0.6, side: THREE.DoubleSide });
    m.shirtMat = shirtMat;

    // Beine
    const legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.12, 0.59, 0);
      figure.add(hip);
      add(G.thigh, pantsMat, hip, [0, -0.12, 0]);
      const knee = new THREE.Group();
      knee.position.set(0, -0.27, 0);
      hip.add(knee);
      add(G.shin, pantsMat, knee, [0, -0.1, 0]);
      add(G.sphere, shoeMat, knee, [0, -0.25, 0.045], [0.11, 0.075, 0.17]);
      legs.push({ hip, knee });
    }
    // Rumpf
    const torso = new THREE.Group();
    torso.position.set(0, 0.59, 0);
    figure.add(torso);
    add(G.sphere, pantsMat, torso, [0, 0.04, 0], [0.255, 0.16, 0.235]);
    add(G.chest, shirtMat, torso, [0, 0.36, 0]);
    // Shirt-Detail: Gürtel + Badge
    add(G.torus, M.rubber, torso, [0, 0.1, 0], [0.252, 0.252, 0.32], [Math.PI / 2, 0, 0]);
    const badgeMat = mat('#ffffff', { rough: 0.4, emissive: '#ffffff', ei: 0.15 });
    add(G.sphereLo, badgeMat, torso, [0.1, 0.48, 0.225], [0.05, 0.05, 0.02]);
    add(G.cyl, skinMat, torso, [0, 0.76, 0], [0.09, 0.08, 0.09]);

    // Kopf
    const head = new THREE.Group();
    head.position.set(0, 0.76, 0);
    torso.add(head);
    add(G.sphere, skinMat, head, [0, 0.3, 0], 0.3);
    add(G.sphereLo, skinMat, head, [0.295, 0.28, 0], [0.06, 0.08, 0.05]);
    add(G.sphereLo, skinMat, head, [-0.295, 0.28, 0], [0.06, 0.08, 0.05]);
    const eyes = [];
    for (const side of [-1, 1]) {
      const eg = new THREE.Group();
      eg.position.set(side * 0.105, 0.32, 0.258);
      head.add(eg);
      add(G.sphere, M.eye, eg, [0, 0, 0], [0.046, 0.06, 0.03]);
      add(G.sphereLo, M.eyeHi, eg, [0.016, 0.022, 0.026], 0.014);
      eyes.push(eg);
    }
    const blushMat = mat('#ff7f9e', { rough: 0.8, emissive: '#ff7f9e', ei: 0.1 });
    add(G.sphereLo, blushMat, head, [0.175, 0.23, 0.235], [0.05, 0.028, 0.02], [0, 0.6, 0]);
    add(G.sphereLo, blushMat, head, [-0.175, 0.23, 0.235], [0.05, 0.028, 0.02], [0, -0.6, 0]);
    const mouthMat = mat('#4a1424', { rough: 0.6 });
    const smile = add(G.smile, mouthMat, head, [0, 0.205, 0.285], 1, [0.25, 0, Math.PI]);
    const mouth = add(G.sphere, mouthMat, head, [0, 0.18, 0.282], [0.055, 0.04, 0.02]);
    mouth.visible = inst === 'vocals';
    smile.visible = inst !== 'vocals';
    m.mouth = mouth;

    const styles = HAIR_STYLES[inst];
    this._buildHair(m, head, styles[variant % styles.length], hairMat, color);

    // Arme
    const arms = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(side * 0.31, 0.6, 0);
      torso.add(sh);
      add(G.sphere, shirtMat, sh, [0, 0, 0], 0.088);
      add(G.upperArm, shirtMat, sh, [0, -0.12, 0]);
      const el = new THREE.Group();
      el.position.set(0, -0.26, 0);
      sh.add(el);
      add(G.foreArm, skinMat, el, [0, -0.1, 0]);
      add(G.sphere, skinMat, el, [0, -0.22, 0], 0.074);
      arms.push({ sh, el, side });
    }
    m.rig = { torso, head, eyes, legL: legs[1], legR: legs[0], armL: arms[1], armR: arms[0] };

    // Instrument
    switch (inst) {
      case 'vocals': this._buildMic(m); break;
      case 'guitar': this._buildGuitar(m, false); this._buildAmp(m, false); break;
      case 'bass': this._buildGuitar(m, true); this._buildAmp(m, true); break;
      case 'drums': this._buildDrums(m); break;
      case 'piano': this._buildKeys(m); break;
      default: this._buildDJ(m); break;
    }

    // Statische Teile pro Gelenk zusammenfassen → deutlich weniger Draw-Calls
    const P = m.props;
    const animated = new Set([
      body, figure, torso, head, ...eyes, mouth,
      ...legs.flatMap((l) => [l.hip, l.knee]), ...arms.flatMap((a) => [a.sh, a.el]),
      P.guitar, P.kick, P.crash, P.ride, P.hihat, ...(P.platters || []),
    ].filter(Boolean));
    this._bakeTree(root, animated);

    // Blob-Schatten
    const shadow = new THREE.Mesh(G.floorPlane, M.shadow);
    shadow.position.y = 0.012;
    shadow.scale.set(m.seated ? 1.9 : 1.25, 1, m.seated ? 1.8 : 1.1);
    shadow.renderOrder = 1;
    root.add(shadow);

    // Lichtkegel-Pool am Boden
    const poolMat = new THREE.MeshBasicMaterial({ map: this.T.pool, color: color.clone(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const pool = new THREE.Mesh(G.floorPlane, poolMat);
    pool.position.y = 0.018;
    pool.scale.set(2.4, 1, 2.4);
    pool.renderOrder = 1;
    root.add(pool);
    m.pool = pool; m.poolMat = poolMat;

    // Pop-Ring
    const ringMat = new THREE.MeshBasicMaterial({ color: color.clone(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const ring = new THREE.Mesh(G.ring, ringMat);
    ring.position.y = 0.03;
    ring.renderOrder = 2;
    root.add(ring);
    m.ring = ring; m.ringMat = ringMat;

    // Namensschild
    const headTop = m.seated ? 1.62 : 2.02;
    m.headTop = headTop;
    const tagTex = this._makeLabelTexture(stem.label || DEFAULT_LABELS[inst], color);
    const tagMat = new THREE.SpriteMaterial({ map: tagTex.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const tag = new THREE.Sprite(tagMat);
    tag.center.set(0.5, 0);
    tag.position.set(0, headTop + 0.22, 0);
    tag.renderOrder = 20;
    m.tagBase = new THREE.Vector2(tagTex.aspect * 0.36, 0.36);
    tag.scale.set(m.tagBase.x, m.tagBase.y, 1);
    root.add(tag);
    m.tag = tag;

    // Zzz
    const zMat = new THREE.SpriteMaterial({ map: this.T.zzz, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
    const zzz = new THREE.Sprite(zMat);
    zzz.position.set(0.42, headTop - 0.05, 0.1);
    zzz.scale.setScalar(0.55);
    zzz.renderOrder = 19;
    root.add(zzz);
    m.zzz = zzz; m.zzzMat = zMat;

    // Hitbox (großzügig, unsichtbar)
    const hb = new THREE.Mesh(new THREE.CapsuleGeometry(m.seated ? 0.95 : 0.62, m.seated ? 0.5 : 1.0, 4, 10), M.hitbox);
    hb.position.set(0, m.seated ? 0.95 : 1.05, m.seated ? 0.35 : 0.1);
    hb.userData.memberId = id;
    root.add(hb);
    m.hitbox = hb;

    // Scheinwerfer an der vorderen Traverse
    this._buildFixture(m);
    return m;
  }

  _bakeTree(rootNode, animated) {
    rootNode.updateMatrixWorld(true);
    const roots = [rootNode, ...animated].filter((r) => r && !r.isMesh);
    const tmp = new THREE.Matrix4();
    for (const br of roots) {
      const inv = br.matrixWorld.clone().invert();
      const buckets = new Map();
      const collect = (o) => {
        for (const c of o.children) {
          if (animated.has(c) || !c.visible) continue;
          if (c.isMesh) {
            if (c.isInstancedMesh || c.children.length || c.userData.noBake || c.material === this.M.hitbox) continue;
            if (!buckets.has(c.material)) buckets.set(c.material, []);
            buckets.get(c.material).push({ mesh: c, mx: tmp.multiplyMatrices(inv, c.matrixWorld).clone() });
          } else if (!c.isSprite && c.children.length) {
            collect(c);
          }
        }
      };
      collect(br);
      for (const [mat, list] of buckets) {
        if (list.length < 2) continue;
        const geos = list.map(({ mesh, mx }) => {
          const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
          for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
          g.morphAttributes = {};
          g.clearGroups();
          g.applyMatrix4(mx);
          return g;
        });
        let merged = null;
        try { merged = mergeGeometries(geos, false); } catch (_) { merged = null; }
        geos.forEach((g) => g.dispose());
        if (!merged) continue;
        for (const { mesh } of list) mesh.removeFromParent();
        br.add(new THREE.Mesh(merged, mat));
      }
    }
  }

  _buildHair(m, head, style, hairMat, color) {
    const G = this.G, add = m.add, mat = m.mat;
    const accent = mat(color, { rough: 0.5, emissive: color, ei: 0.08, glow: true, side: THREE.DoubleSide });
    const cap = () => add(G.hairCap, hairMat, head, [0, 0.31, -0.012], 1, [-0.32, 0, 0]);
    switch (style) {
      case 'quiff':
        cap();
        add(G.sphere, hairMat, head, [0.04, 0.6, 0.12], [0.2, 0.11, 0.16], [0.5, 0, -0.3]);
        add(G.sphere, hairMat, head, [-0.08, 0.58, 0.04], [0.17, 0.1, 0.17], [0.3, 0, 0.2]);
        break;
      case 'long':
        cap();
        add(G.chest, hairMat, head, [0, 0.16, -0.1], [1.12, 0.5, 0.75]);
        add(G.sphere, hairMat, head, [0, 0.53, 0.12], [0.24, 0.07, 0.17], [0.4, 0, 0]);
        break;
      case 'afro':
        add(G.sphere, hairMat, head, [0, 0.42, -0.06], [0.42, 0.38, 0.4]);
        break;
      case 'beanie': {
        cap();
        const knit = mat(new THREE.Color(color).multiplyScalar(0.55), { rough: 0.9, side: THREE.DoubleSide });
        add(G.hatCap, knit, head, [0, 0.4, -0.02], [1, 1.05, 1], [-0.22, 0, 0]);
        add(G.torus, accent, head, [0, 0.42, -0.01], [0.33, 0.33, 0.7], [Math.PI / 2 - 0.22, 0, 0]);
        add(G.sphere, mat('#ffffff', { rough: 0.9 }), head, [0, 0.76, -0.09], 0.075);
        break;
      }
      case 'cap': {
        cap();
        add(G.hatCap, accent, head, [0, 0.33, 0], [1, 0.9, 1], [-0.1, 0, 0]);
        add(G.cyl, accent, head, [0, 0.39, -0.33], [0.2, 0.02, 0.16], [0.18, 0, 0]);
        add(G.sphereLo, accent, head, [0, 0.63, 0], 0.035);
        break;
      }
      case 'spiky': {
        cap();
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU;
          const r = 0.17;
          const s = add(G.spike, hairMat, head, [Math.sin(a) * r, 0.56, Math.cos(a) * r - 0.03], [0.08, 0.22, 0.08]);
          s.rotation.set(Math.cos(a) * 0.7, 0, -Math.sin(a) * 0.7);
        }
        add(G.spike, hairMat, head, [0, 0.66, -0.02], [0.09, 0.22, 0.09]);
        add(G.torus, accent, head, [0, 0.42, 0], [0.315, 0.315, 0.5], [Math.PI / 2 - 0.12, 0, 0]);
        break;
      }
      case 'bun': {
        cap();
        add(G.sphere, hairMat, head, [0, 0.66, -0.1], 0.12);
        const gl = mat('#16151c', { rough: 0.3 });
        for (const s of [-1, 1]) add(G.torus, gl, head, [s * 0.105, 0.32, 0.29], [0.072, 0.072, 0.4]);
        add(G.box, gl, head, [0, 0.33, 0.3], [0.06, 0.014, 0.014]);
        break;
      }
      case 'headphones': {
        cap();
        add(G.hpBand, this.M.black, head, [0, 0.3, 0], 1, [0, 0, 0]);
        for (const s of [-1, 1]) {
          add(G.cyl, this.M.black, head, [s * 0.32, 0.29, 0], [0.11, 0.06, 0.11], [0, 0, Math.PI / 2]);
          add(G.cyl, accent, head, [s * 0.355, 0.29, 0], [0.085, 0.02, 0.085], [0, 0, Math.PI / 2]);
        }
        break;
      }
      default: cap();
    }
  }

  _buildMic(m) {
    const G = this.G, M = this.M, add = m.add;
    const stand = new THREE.Group();
    stand.position.set(0, 0, 0.5);
    m.root.add(stand);
    add(G.cyl, M.darkMetal, stand, [0, 0.015, 0], [0.2, 0.03, 0.2]);
    add(G.cyl, M.chrome, stand, [0, 0.68, 0], [0.016, 1.34, 0.016]);
    const mic = new THREE.Group();
    mic.position.set(0, 1.36, 0);
    mic.rotation.x = -0.65;
    stand.add(mic);
    add(G.cyl, M.black, mic, [0, 0.05, 0], [0.026, 0.16, 0.026]);
    add(G.sphere, M.chrome, mic, [0, 0.15, 0], 0.052);
    const ledMat = m.mat(m.color, { emissive: m.color, ei: 1.2, pulse: 1 });
    add(G.cyl, ledMat, mic, [0, 0.105, 0], [0.032, 0.012, 0.032]);
    m.props.mic = mic;
  }

  _buildGuitar(m, isBass) {
    const G = this.G, M = this.M, add = m.add, mat = m.mat;
    const g = new THREE.Group();
    const bodyCol = isBass ? new THREE.Color(m.color).lerp(new THREE.Color('#ffffff'), 0.15) : m.color;
    const bodyMat = mat(bodyCol, { rough: 0.22, metal: 0.15, emissive: m.color, ei: 0.05, glow: true });
    const neckMat = mat('#8a5a32', { rough: 0.6 });
    const fbMat = mat('#2b1b12', { rough: 0.7 });
    const neckLen = isBass ? 0.88 : 0.62;
    // Korpus (zwei Rundungen + Hörner)
    add(G.cylZ, bodyMat, g, [0, 0, 0], [0.2, 0.2, 0.075]);
    add(G.cylZ, bodyMat, g, [0.16, isBass ? 0.0 : 0.02, 0], [0.15, 0.15, 0.075]);
    add(G.cylZ, bodyMat, g, [0.25, 0.11, 0], [0.055, 0.055, 0.075]);
    add(G.cylZ, bodyMat, g, [0.25, -0.1, 0], [0.05, 0.05, 0.075]);
    add(G.cylZ, M.white, g, [0.03, -0.05, 0.04], [0.12, 0.12, 0.008]);
    add(G.box, M.black, g, [0.0, 0, 0.046], [0.04, isBass ? 0.1 : 0.11, 0.012]);
    if (!isBass) add(G.box, M.black, g, [0.09, 0, 0.046], [0.04, 0.11, 0.012]);
    add(G.box, M.chrome, g, [-0.11, 0, 0.044], [0.04, 0.1, 0.012]);
    // Hals
    add(G.box, neckMat, g, [0.25 + neckLen / 2, 0, 0], [neckLen, 0.06, 0.035]);
    add(G.box, fbMat, g, [0.25 + neckLen / 2, 0, 0.02], [neckLen, 0.056, 0.008]);
    const hs = add(G.box, mat(isBass ? '#111018' : bodyCol, { rough: 0.3 }), g, [0.25 + neckLen + 0.07, 0, 0], [0.16, isBass ? 0.08 : 0.09, 0.03]);
    for (let i = 0; i < 4; i++) add(G.sphereLo, M.chrome, hs, [-0.35 + i * 0.22, 0.6, 0.6], [0.08, 0.15, 0.4]);
    // Saiten
    const nStr = isBass ? 4 : 6;
    const strLen = neckLen + 0.36;
    for (let i = 0; i < nStr; i++) {
      const y = (i - (nStr - 1) / 2) * (isBass ? 0.013 : 0.0085);
      add(G.box, M.chrome, g, [-0.11 + strLen / 2, y, 0.052], [strLen, 0.0035, 0.0035]);
    }
    // LED-Inlay
    const ledMat = mat(m.color, { emissive: m.color, ei: 1.2, pulse: 1 });
    for (let i = 1; i <= 5; i++) add(G.cylZ, ledMat, g, [0.25 + neckLen * i / 6, 0, 0.026], [0.009, 0.009, 0.004]);
    g.position.set(-0.05, isBass ? 0.12 : 0.18, 0.31);
    g.rotation.set(0, 0, isBass ? 0.42 : 0.5);
    m.rig.torso.add(g);
    // Gurt
    add(G.torus, mat('#1a1620', { rough: 0.8 }), m.rig.torso, [0, 0.38, 0], [0.3, 0.42, 0.3], [0.15, 0, 0.75]);
    m.props.guitar = g;
  }

  _buildAmp(m, isBass) {
    const G = this.G, M = this.M, add = m.add;
    const amp = new THREE.Group();
    amp.position.set(isBass ? 0.15 : -0.15, 0, -0.85);
    m.root.add(amp);
    const h = isBass ? 1.05 : 0.65;
    add(this._rbox(0.8, h, 0.42, 0.04), M.cab, amp, [0, h / 2, 0]);
    if (isBass) {
      for (const [x, y] of [[-0.18, 0.28], [0.18, 0.28], [-0.18, 0.7], [0.18, 0.7]]) {
        add(G.cylZ, M.grill, amp, [x, y, 0.212], [0.15, 0.15, 0.01]);
        add(G.sphereLo, M.darkMetal, amp, [x, y, 0.215], [0.05, 0.05, 0.02]);
      }
    } else {
      add(G.box, M.grill, amp, [0, 0.27, 0.212], [0.68, 0.38, 0.01]);
      add(G.box, M.gold, amp, [0, 0.55, 0.212], [0.68, 0.012, 0.01]);
      for (let i = 0; i < 5; i++) add(G.cylZ, M.chrome, amp, [-0.25 + i * 0.1, 0.59, 0.215], [0.018, 0.018, 0.02]);
    }
    const logo = m.mat(m.color, { emissive: m.color, ei: 1.3, pulse: 1 });
    add(G.box, logo, amp, [0.24, h - 0.08, 0.214], [0.16, 0.035, 0.01]);
  }

  _buildDrums(m) {
    const G = this.G, M = this.M, add = m.add, mat = m.mat;
    const kit = new THREE.Group();
    m.root.add(kit);
    const shellMat = mat(m.color, { rough: 0.25, metal: 0.3, emissive: m.color, ei: 0.08, glow: true });
    const headMat = mat('#f4f1ea', { rough: 0.6 });
    // Hocker
    add(G.cyl, M.rubber, kit, [0, 0.36, -0.02], [0.2, 0.07, 0.2]);
    add(G.cyl, M.chrome, kit, [0, 0.17, -0.02], [0.025, 0.34, 0.025]);
    // Bassdrum
    const bd = new THREE.Group();
    bd.position.set(0, 0.34, 0.78);
    kit.add(bd);
    add(G.cylZ, shellMat, bd, [0, 0, 0], [0.34, 0.34, 0.32]);
    add(G.cylZ, M.black, bd, [0, 0, 0.162], [0.32, 0.32, 0.005]);
    add(G.hoop, M.chrome, bd, [0, 0, 0.163], [0.345, 0.345, 0.5]);
    add(G.hoop, M.chrome, bd, [0, 0, -0.163], [0.345, 0.345, 0.5]);
    const logo = mat(m.color, { emissive: m.color, ei: 1.5, pulse: 1 });
    add(G.hoop, logo, bd, [0, 0, 0.168], [0.2, 0.2, 0.5]);
    add(G.cylZ, logo, bd, [0, 0, 0.166], [0.07, 0.07, 0.004]);
    m.props.kick = bd;
    // Toms
    const tom = (x, y, z, r, hgt, tilt) => {
      const t = new THREE.Group();
      t.position.set(x, y, z);
      t.rotation.set(tilt, 0, -x * 0.5);
      kit.add(t);
      add(G.cyl, shellMat, t, [0, 0, 0], [r, hgt, r]);
      add(G.cyl, headMat, t, [0, hgt / 2 + 0.003, 0], [r * 0.97, 0.006, r * 0.97]);
      add(G.hoop, M.chrome, t, [0, hgt / 2, 0], [r * 1.02, r * 1.02, 0.5], [Math.PI / 2, 0, 0]);
      return t;
    };
    tom(-0.15, 0.8, 0.62, 0.12, 0.12, -0.45);
    tom(0.17, 0.8, 0.62, 0.13, 0.13, -0.45);
    tom(0.48, 0.47, 0.38, 0.18, 0.3, -0.1);
    // Snare (Chrom)
    const sn = new THREE.Group();
    sn.position.set(-0.34, 0.58, 0.42);
    sn.rotation.x = -0.12;
    kit.add(sn);
    add(G.cyl, M.chrome, sn, [0, 0, 0], [0.16, 0.11, 0.16]);
    add(G.cyl, headMat, sn, [0, 0.058, 0], [0.155, 0.006, 0.155]);
    add(G.cyl, M.chrome, kit, [-0.34, 0.27, 0.42], [0.012, 0.55, 0.012]);
    // Hi-Hat
    add(G.cyl, M.chrome, kit, [-0.62, 0.44, 0.32], [0.012, 0.88, 0.012]);
    const hh = new THREE.Group();
    hh.position.set(-0.62, 0.86, 0.32);
    kit.add(hh);
    add(G.cyl, M.gold, hh, [0, 0, 0], [0.17, 0.008, 0.17]);
    add(G.cyl, M.gold, hh, [0, 0.03, 0], [0.17, 0.008, 0.17]);
    m.props.hihat = hh;
    // Becken
    const cym = (x, z, y, r) => {
      add(G.cyl, M.chrome, kit, [x, y / 2, z], [0.012, y, 0.012]);
      const c = new THREE.Group();
      c.position.set(x, y, z);
      kit.add(c);
      add(G.cyl, M.gold, c, [0, 0, 0], [r, 0.008, r]);
      add(G.sphereLo, M.gold, c, [0, 0.01, 0], [0.03, 0.02, 0.03]);
      return c;
    };
    m.props.crash = cym(-0.62, 0.78, 1.22, 0.24);
    m.props.ride = cym(0.7, 0.72, 1.08, 0.27);
    m.props.crash.rotation.set(0.35, 0, 0.25);
    m.props.ride.rotation.set(0.3, 0, -0.25);
    m.props.crashBase = m.props.crash.rotation.clone();
    m.props.rideBase = m.props.ride.rotation.clone();
    // Sticks
    const stickMat = mat('#e8c890', { rough: 0.6 });
    for (const arm of [m.rig.armL, m.rig.armR]) {
      add(G.cyl, stickMat, arm.el, [0, -0.37, -0.08], [0.013, 0.42, 0.013], [0.5, 0, 0]);
    }
    // Drummer sitzt tiefer
    m.figure.position.y = -0.2;
  }

  _buildKeys(m) {
    const G = this.G, M = this.M, add = m.add, mat = m.mat;
    const k = new THREE.Group();
    k.position.set(0, 0, 0.5);
    m.root.add(k);
    for (const s of [-1, 1]) add(G.box, M.darkMetal, k, [s * 0.32, 0.45, 0], [0.04, 1.02, 0.04], [0, 0, s * 0.55]);
    add(G.box, M.darkMetal, k, [0, 0.45, 0], [0.7, 0.03, 0.03]);
    add(this._rbox(1.2, 0.09, 0.36, 0.03), mat('#1d1b26', { rough: 0.35, metal: 0.3 }), k, [0, 0.92, 0]);
    const accent = mat(m.color, { rough: 0.3, emissive: m.color, ei: 0.25, glow: true });
    for (const s of [-1, 1]) add(this._rbox(0.06, 0.12, 0.38, 0.02), accent, k, [s * 0.6, 0.93, 0]);
    add(G.box, M.white, k, [0, 0.975, -0.06], [1.08, 0.025, 0.17]);
    const pattern = [1, 1, 0, 1, 1, 1, 0];
    const nW = 21;
    for (let i = 0; i < nW - 1; i++) {
      if (!pattern[i % 7]) continue;
      const x = -0.54 + (i + 1) * (1.08 / nW);
      add(G.box, M.black, k, [x, 0.993, -0.03], [0.026, 0.022, 0.1]);
    }
    for (let i = 1; i < nW; i++) add(G.box, M.grill, k, [-0.54 + i * (1.08 / nW), 0.988, -0.065], [0.003, 0.002, 0.16]);
    const screen = mat(m.color, { emissive: m.color, ei: 1.3, pulse: 1 });
    add(G.box, screen, k, [-0.25, 0.97, 0.1], [0.3, 0.01, 0.08]);
    for (let i = 0; i < 6; i++) add(G.cyl, M.chrome, k, [0.05 + i * 0.07, 0.975, 0.1], [0.018, 0.02, 0.018]);
  }

  _buildDJ(m) {
    const G = this.G, M = this.M, add = m.add, mat = m.mat;
    const d = new THREE.Group();
    d.position.set(0, 0, 0.55);
    m.root.add(d);
    add(this._rbox(1.4, 0.07, 0.56, 0.03), M.cab, d, [0, 0.9, 0]);
    add(this._rbox(1.4, 0.86, 0.05, 0.02), M.cab, d, [0, 0.43, 0.25]);
    const stripe = mat(m.color, { emissive: m.color, ei: 1.4, pulse: 1 });
    add(G.box, stripe, d, [0, 0.62, 0.278], [1.3, 0.025, 0.01]);
    add(G.box, stripe, d, [0, 0.32, 0.278], [1.3, 0.025, 0.01]);
    const plats = [];
    for (const s of [-1, 1]) {
      add(this._rbox(0.44, 0.05, 0.4, 0.02), mat('#3a3946', { rough: 0.4, metal: 0.4 }), d, [s * 0.4, 0.955, 0]);
      const p = new THREE.Group();
      p.position.set(s * 0.4, 0.985, 0);
      d.add(p);
      add(G.cyl, M.black, p, [0, 0, 0], [0.16, 0.012, 0.16]);
      add(G.cyl, mat(m.color, { emissive: m.color, ei: 0.4 }), p, [0, 0.007, 0], [0.055, 0.004, 0.055]);
      add(G.box, M.white, p, [0.09, 0.009, 0], [0.04, 0.002, 0.01]);
      add(G.box, M.chrome, d, [s * 0.4 + 0.15, 1.0, -0.05], [0.012, 0.012, 0.22], [0, 0.3, 0]);
      plats.push(p);
    }
    add(this._rbox(0.24, 0.06, 0.34, 0.02), mat('#22212b', { rough: 0.4 }), d, [0, 0.96, 0]);
    for (let i = 0; i < 3; i++) add(G.box, stripe, d, [-0.06 + i * 0.06, 0.995, 0.05], [0.02, 0.01, 0.1]);
    m.props.platters = plats;
  }

  _buildFixture(m) {
    const G = this.G, M = this.M;
    const grp = new THREE.Group();
    this.scene.add(grp);
    const fx = new THREE.Vector3(m.slot.x * 1.05, this._trussFront.y - 0.36, this._trussFront.z);
    const target = new THREE.Vector3(m.slot.x, m.slot.y, m.slot.z);
    const yoke = new THREE.Mesh(G.box, M.darkMetal);
    yoke.position.copy(fx).add(new THREE.Vector3(0, 0.2, 0));
    yoke.scale.set(0.05, 0.25, 0.05);
    grp.add(yoke);
    const head = new THREE.Group();
    head.position.copy(fx);
    head.lookAt(target);
    grp.add(head);
    const housing = new THREE.Mesh(G.cylZ, M.darkMetal);
    housing.scale.set(0.15, 0.15, 0.34);
    head.add(housing);
    const lensMat = new THREE.MeshBasicMaterial({ color: m.color.clone() });
    const lens = new THREE.Mesh(G.cylZ, lensMat);
    lens.position.z = 0.175;
    lens.scale.set(0.12, 0.12, 0.01);
    head.add(lens);
    const glowMat = new THREE.SpriteMaterial({ map: this.T.glow, color: m.color.clone(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
    const glow = new THREE.Sprite(glowMat);
    glow.position.z = 0.22;
    glow.scale.setScalar(1.1);
    head.add(glow);
    const coneMat = this._coneBase.clone();
    coneMat.uniforms.uColor.value = m.color.clone();
    const cone = new THREE.Mesh(G.cone, coneMat);
    cone.position.copy(fx);
    cone.lookAt(target);
    const dist = fx.distanceTo(target);
    cone.scale.set(1.05, 1.05, dist);
    cone.renderOrder = 2;
    grp.add(cone);
    m.fixture = { grp, head, cone, coneMat, lensMat, glow, glowMat, fx, target, dist };
  }

  _makeLabelTexture(text, color) {
    const W = 512, H = 128;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    const font = '700 50px "Outfit", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif';
    ctx.font = font;
    let label = String(text || '');
    while (ctx.measureText(label).width > 360 && label.length > 3) label = label.slice(0, -2) + '…';
    const tw = ctx.measureText(label).width;
    const pad = 26, dot = 26;
    const w = Math.min(W - 8, tw + pad * 2 + dot + 14);
    const h = 84;
    const x = (W - w) / 2, y = (H - h) / 2;
    ctx.clearRect(0, 0, W, H);
    roundRectPath(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = 'rgba(14,11,26,0.78)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#' + color.getHexString();
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x + pad + dot / 2, H / 2, dot / 2, 0, TAU);
    ctx.fillStyle = '#' + color.getHexString();
    ctx.shadowColor = '#' + color.getHexString();
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.font = font;
    ctx.fillText(label, x + pad + dot + 14, H / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    // Sprite auf genutzte Breite trimmen über UV
    const u0 = x / W, u1 = (x + w) / W;
    tex.repeat.set(u1 - u0, 1);
    tex.offset.set(u0, 0);
    return { tex, aspect: w / H };
  }

  _makeZzzTexture() {
    const c = makeCanvas(256, 256);
    const ctx = c.getContext('2d');
    const zs = [[70, 190, 64], [130, 128, 50], [180, 72, 38]];
    ctx.lineJoin = 'round';
    for (const [x, y, s] of zs) {
      ctx.font = `900 ${s * 1.6}px "Outfit", "Inter", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(20,16,40,0.9)';
      ctx.strokeText('Z', x, y);
      ctx.fillStyle = '#cfd8ff';
      ctx.shadowColor = '#7a8cff';
      ctx.shadowBlur = 18;
      ctx.fillText('Z', x, y);
      ctx.shadowBlur = 0;
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* ------------------------- Aufräumen ------------------------- */

  _disposeNode(o, all) {
    if (o.geometry && (all || !this._shared.has(o.geometry))) {
      if (!this._shared.has(o.geometry)) o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const mt of mats) {
      if (this._shared.has(mt)) continue;
      for (const k in mt) {
        const v = mt[k];
        if (v && v.isTexture && !this._shared.has(v)) v.dispose();
      }
      mt.dispose();
    }
  }

  _clearMembers() {
    for (const m of this._members) {
      m.root.removeFromParent();
      m.fixture?.grp.removeFromParent();
      m.root.traverse((o) => this._disposeNode(o, false));
      m.fixture?.grp.traverse((o) => this._disposeNode(o, false));
    }
    this._members = [];
    this._hoverId = null;
    if (this.canvas) this.canvas.style.cursor = '';
  }

  /* ------------------------- Events ------------------------- */

  _onWinResize = () => this._resize();

  _onVisibility = () => {
    if (this._disposed) return;
    if (document.hidden) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    } else if (!this._raf) {
      this._last = performance.now();
      this._raf = requestAnimationFrame(this._loop);
    }
  };

  _setMouse(e) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    this._mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return true;
  }

  _onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this._ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), drag: false, type: e.pointerType };
    if (e.pointerType === 'mouse') { try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* egal */ } }
  };

  _onPointerMove = (e) => {
    const p = this._ptr;
    if (p && p.id === e.pointerId) {
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (!p.drag && Math.hypot(dx, dy) > 8) {
        p.drag = true;
        if (e.pointerType !== 'mouse') { try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* egal */ } }
      }
      if (p.drag) {
        const w = Math.max(200, this.canvas.clientWidth);
        this._userAz = clamp(this._userAz - ((e.clientX - p.lx) / w) * 2.2, -0.75, 0.75);
        this._userEl = clamp(this._userEl + ((e.clientY - p.ly) / w) * 1.2, -0.18, 0.38);
        this.canvas.style.cursor = 'grabbing';
      }
      p.lx = e.clientX; p.ly = e.clientY;
      return;
    }
    if (e.pointerType === 'mouse') {
      this._mouseInside = this._setMouse(e);
      this._hoverDirty = true;
    }
  };

  _onPointerUp = (e) => {
    const p = this._ptr;
    if (!p || p.id !== e.pointerId) return;
    this._ptr = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) { /* egal */ }
    if (!p.drag && performance.now() - p.t < 800 && this._setMouse(e)) {
      const id = this._pick();
      if (id != null) {
        const m = this._members.find((x) => x.id === id);
        if (m) { m.hover = 1; }
        for (const cb of [...this._clickCbs]) {
          try { cb(id); } catch (err) { console.error('[Stage3D] onMemberClick-Callback', err); }
        }
      }
    }
    if (e.pointerType === 'mouse') { this._mouseInside = this._setMouse(e); this._hoverDirty = true; }
  };

  _onPointerCancel = (e) => {
    if (this._ptr && this._ptr.id === e.pointerId) this._ptr = null;
  };

  _onPointerLeave = (e) => {
    if (e.pointerType === 'mouse' && !this._ptr) {
      this._mouseInside = false;
      this._hoverDirty = true;
    }
  };

  _pick() {
    if (!this._members.length) return null;
    this._raycaster.setFromCamera(this._mouse, this.camera);
    // 1. präzise: sichtbare Geometrie
    const roots = this._members.map((m) => m.root);
    const hits = this._raycaster.intersectObjects(roots, true);
    for (const h of hits) {
      if (h.object.isSprite) continue;
      let o = h.object;
      while (o && !o.userData.memberId) {
        const m = this._members.find((x) => x.root === o);
        if (m) return m.id;
        o = o.parent;
      }
      if (o?.userData.memberId) return o.userData.memberId;
    }
    // 2. großzügig: Hitboxen
    const hb = this._raycaster.intersectObjects(this._members.map((m) => m.hitbox), false);
    return hb.length ? hb[0].object.userData.memberId : null;
  }

  _updateHover() {
    this._hoverDirty = false;
    if (this._ptr && this._ptr.drag) return;
    const id = this._mouseInside ? this._pick() : null;
    if (id !== this._hoverId) {
      this._hoverId = id;
      this.canvas.style.cursor = id ? 'pointer' : '';
    }
  }

  /* ------------------------- Resize / Kamera ------------------------- */

  _resize() {
    if (this._disposed) return;
    const w = Math.max(1, Math.floor(this.container.clientWidth));
    const h = Math.max(1, Math.floor(this.container.clientHeight));
    if (w === this._w && h === this._h) return;
    this._w = w; this._h = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this._composer?.setPixelRatio(this.renderer.getPixelRatio());
    this._composer?.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Rahmung: alle Musiker (≈ ±4.4 Einheiten) müssen in die Breite passen
    const portrait = aspect < 1;
    const fov = portrait ? 46 : 40;
    this.camera.fov = fov;
    const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const halfW = portrait ? 3.75 : 5.6, halfH = 3.0;
    const dW = halfW / (tanV * aspect);
    const dH = halfH / tanV;
    const dist = clamp(Math.max(dW, dH, 8.5), 8.5, 24);
    this._camBase.dist = dist;
    this._uiScale = clamp(dist / 10, 1, 1.9);
    this._camBase.el = portrait ? 0.46 : 0.38;
    this._camBase.ty = portrait ? 1.45 : 1.15;
    this._camBase.tz = portrait ? 0.9 : 0.2;
    this.scene.fog.density = 0.028 * (11 / dist);
    this.camera.updateProjectionMatrix();
    this._mouseInside = false;
  }

  _updateCamera(dt) {
    const t = this._time;
    const B = this._camBase;
    this._camAz = damp(this._camAz, this._userAz, 6, dt);
    this._camEl = damp(this._camEl, this._userEl, 6, dt);
    const az = this._camAz + Math.sin(t * 0.11) * 0.07 + Math.sin(t * 0.047) * 0.04;
    const el = B.el + this._camEl + Math.sin(t * 0.083) * 0.02;
    const kick = Math.pow(1 - frac(this._beat), 8) * this._energy * this._playingF;
    const dist = B.dist * (1 + Math.sin(t * 0.06) * 0.015) - this._energy * 0.25 - kick * 0.08;
    const cy = B.ty, cz = B.tz;
    this.camera.position.set(Math.sin(az) * Math.cos(el) * dist, cy + Math.sin(el) * dist, cz + Math.cos(az) * Math.cos(el) * dist);
    this.camera.lookAt(0, cy, cz);
  }

  /* ------------------------- Loop ------------------------- */

  _loop = (now) => {
    if (this._disposed) return;
    this._raf = requestAnimationFrame(this._loop);
    if (document.hidden) return;
    const dt = clamp((now - this._last) / 1000, 0, 0.05);
    this._last = now;
    this._time += dt;
    try {
      this._update(dt);
      if (this._w > 1 && this._h > 1) {
        if (this._composer) this._composer.render(dt);
        else this.renderer.render(this.scene, this.camera);
      }
    } catch (err) {
      if (!this._errLogged) { console.error('[Stage3D] Frame-Fehler', err); this._errLogged = true; }
    }
  };

  _update(dt) {
    const playing = !!this._eng('isPlaying');
    const song = this._eng('song');
    if (!this._song && song && Array.isArray(song.stems) && song !== this._lastAutoSong) {
      this._lastAutoSong = song;
      this.setSong(song);
    }
    const bpm = clamp(+(song && song.bpm) || +(this._song && this._song.bpm) || 120, 40, 240);
    if (playing) {
      const ct = +this._eng('currentTime') || 0;
      this._beat = ct * bpm / 60;
    }
    this._idleBeat += dt * 0.5;
    this._playingF = damp(this._playingF, playing ? 1 : 0, 3, dt);

    let eSum = 0;
    const rim = this._tmpRim || (this._tmpRim = new THREE.Color());
    rim.setRGB(0, 0, 0);
    let rimW = 0;
    for (const m of this._members) {
      this._updateMember(m, dt, playing);
      const w = m.norm * (1 - m.mute);
      eSum += w;
      rim.r += m.color.r * (w + 0.05); rim.g += m.color.g * (w + 0.05); rim.b += m.color.b * (w + 0.05);
      rimW += w + 0.05;
    }
    const n = this._members.length;
    const target = playing && n ? clamp(eSum / Math.max(1.5, n * 0.75)) : 0;
    this._energy = damp(this._energy, target, target > this._energy ? 5 : 1.5, dt);
    if (rimW > 0) {
      rim.multiplyScalar(1 / rimW);
      this._rimA.lerp(rim, 1 - Math.exp(-2 * dt));
    }

    this._updateCrowd(dt);
    this._updateFx(dt);
    this._updateCamera(dt);
    if (this._hoverDirty) this._updateHover();
  }

  _pop(m, on) {
    m.popT = 0;
    m.popAmp = 0.24;
    m.ringT = 0;
    m.ringMat.color.copy(on ? m.color : new THREE.Color('#8890a8'));
  }

  _updateMember(m, dt, playing) {
    const raw = this._level(m.id);
    const audible = this._audible(m.id);
    m.peak = Math.max(raw, m.peak * Math.exp(-dt * 0.3), 0.03);
    const n = clamp(raw / m.peak);
    m.norm = damp(m.norm, playing ? n : 0, 14, dt);
    if (m.audibleInit && audible !== m.audible) this._pop(m, audible);
    m.audible = audible;
    m.audibleInit = true;
    m.mute = damp(m.mute, audible ? 0 : 1, 7, dt);
    const active = playing && audible;
    m.energy = damp(m.energy, active ? (raw > 0.004 ? 0.35 + 0.65 * m.norm : 0.15) : 0, 5, dt);
    const hov = this._hoverId === m.id || this._highlightId === m.id ? 1 : 0;
    m.hover = damp(m.hover, hov, 10, dt);
    m.popT += dt;
    m.ringT += dt;

    this._pose(m, dt, playing);
    this._applyLook(m, dt);
    this._updateMemberFx(m, dt, playing);
  }

  _pose(m, dt, playing) {
    const R = m.rig;
    const e = m.energy;
    const b = playing ? this._beat : this._beat + this._idleBeat * 0.0;
    const bp = frac(b);
    const t = this._time + m.seed * 10;
    const on = Math.pow(1 - bp, 3);
    const halfSin = Math.abs(Math.sin(Math.PI * b));
    const idle = 1 - e;
    const breath = Math.sin(t * 1.9);
    const { torso, head, armL, armR, legL, legR } = R;

    // Reset
    m.body.position.set(0, 0, 0);
    m.body.rotation.set(0, 0, 0);
    torso.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    for (const a of [armL, armR]) { a.sh.rotation.set(-0.08, 0, a.side * 0.12); a.el.rotation.set(-0.25, 0, 0); }

    // Beine
    if (m.seated) {
      for (const L of [legL, legR]) { L.hip.rotation.set(-1.45, 0, 0); L.knee.rotation.set(1.45, 0, 0); }
      legR.knee.rotation.x = 1.45 - on * 0.25 * e; // Bassdrum-Fuß
    } else {
      const k = e * (0.18 + 0.22 * on);
      for (const L of [legL, legR]) { L.hip.rotation.set(-k, 0, 0); L.knee.rotation.set(k * 2, 0, 0); }
      legL.hip.rotation.z = 0.04; legR.hip.rotation.z = -0.04;
      m.body.position.y = e * (0.07 * halfSin - 0.05 * k);
    }

    // gemeinsames Grooven
    torso.rotation.x = 0.03 + e * 0.1 * on;
    head.rotation.x = -0.04 + e * 0.32 * on;
    torso.rotation.z = Math.sin(t * 0.9) * 0.025 * idle;
    head.rotation.z = Math.sin(t * 0.7 + 1) * 0.04 * idle;
    head.rotation.y = Math.sin(t * 0.5) * 0.12 * idle;

    const swing = Math.sin(b * Math.PI);
    switch (m.inst) {
      case 'vocals': {
        armR.sh.rotation.set(-1.2, 0, 0.62);
        armR.el.rotation.set(-1.25, 0, 0);
        const lift = e * (0.75 + 0.25 * Math.sin(b * Math.PI * 0.5));
        armL.sh.rotation.set(-0.15 - 1.7 * lift, 0, 0.15 + 0.5 * lift + swing * 0.25 * e);
        armL.el.rotation.set(-0.3 - 0.3 * lift, 0, 0);
        torso.rotation.z += swing * 0.09 * e;
        m.body.rotation.y = swing * 0.12 * e;
        head.rotation.x = -0.12 + e * 0.15 * on;
        const open = clamp(m.norm * 1.4) * (1 - m.mute) * (playing ? 1 : 0);
        m.mouth.scale.set(0.05, 0.012 + 0.05 * open, 0.02);
        break;
      }
      case 'guitar':
      case 'bass': {
        const bass = m.inst === 'bass';
        const strum = Math.sin(b * TAU * (bass ? 1 : 2)) * (bass ? 0.18 : 0.38) * e;
        armR.sh.rotation.set(-0.55, 0, 0.42);
        armR.el.rotation.set(-1.05 + strum, 0, 0.1);
        armL.sh.rotation.set(-0.95, 0, 0.55);
        armL.el.rotation.set(-0.55 + Math.sin(b * Math.PI * 0.5) * 0.08 * e, 0, bass ? 0.1 : 0.0);
        head.rotation.x = -0.05 + e * (bass ? 0.3 : 0.5) * on;
        torso.rotation.x += e * 0.06 * on;
        m.body.rotation.y = Math.sin(b * Math.PI * 0.25) * 0.18 * e;
        if (m.props.guitar) m.props.guitar.rotation.z = (bass ? 0.42 : 0.5) + on * 0.05 * e;
        break;
      }
      case 'drums': {
        const hitR = Math.pow(1 - frac(b * 2), 4);
        const hitL = Math.pow(1 - frac(b + 0.5), 4);
        armR.sh.rotation.set(-0.55 - 0.12 * e * (1 - hitR), 0, -0.3);
        armR.el.rotation.set(-0.85 - 0.75 * e * (1 - hitR), 0, 0.15);
        armL.sh.rotation.set(-0.5 - 0.12 * e * (1 - hitL), 0, 0.32);
        armL.el.rotation.set(-0.8 - 0.75 * e * (1 - hitL), 0, -0.15);
        torso.rotation.x = 0.12 + on * 0.06 * e;
        head.rotation.x = -0.05 + e * 0.35 * on;
        m.body.position.y = on * 0.02 * e;
        const crash = Math.pow(1 - frac(b / 4), 5) * e;
        const P = m.props;
        P.crash.rotation.x = P.crashBase.x + Math.sin(t * 18) * 0.22 * crash;
        P.ride.rotation.x = P.rideBase.x + Math.sin(t * 15) * 0.05 * e;
        P.hihat.position.y = 0.86 + hitR * 0.01 * e;
        const k = 1 + on * 0.05 * e;
        P.kick.scale.set(k, k, 1);
        break;
      }
      case 'piano': {
        const tapL = Math.sin(b * TAU * 2 + 1.3) * 0.12 * e;
        const tapR = Math.sin(b * TAU * 2) * 0.12 * e;
        const slide = Math.sin(b * Math.PI * 0.5) * 0.18 * e;
        armL.sh.rotation.set(-0.85, slide, 0.08);
        armL.el.rotation.set(-0.7 + tapL, 0, 0);
        armR.sh.rotation.set(-0.85, slide, -0.08);
        armR.el.rotation.set(-0.7 + tapR, 0, 0);
        torso.rotation.z += swing * 0.07 * e;
        torso.rotation.x += 0.08;
        head.rotation.x = 0.05 + e * 0.28 * on;
        break;
      }
      default: {
        // DJ
        const scratch = Math.sin(b * TAU * 2) * 0.35 * e;
        armR.sh.rotation.set(-0.9, scratch * 0.4, -0.05);
        armR.el.rotation.set(-0.6, 0, scratch);
        const pump = e * (0.7 + 0.3 * on);
        armL.sh.rotation.set(-0.2 - 2.5 * pump, 0, 0.2 + 0.25 * pump);
        armL.el.rotation.set(-0.3 - 0.5 * pump * (1 - on), 0, 0);
        m.body.position.y += e * 0.05 * halfSin;
        head.rotation.x = -0.05 + e * 0.38 * on;
        if (m.props.platters) {
          const sp = (playing && m.audible ? 3.5 : 0) * dt;
          m.props.platters[0].rotation.y += sp + scratch * 0.1;
          m.props.platters[1].rotation.y += sp;
        }
      }
    }

    // Pausiert/idle: Atmen
    if (!playing || e < 0.05) {
      torso.scale.set(1 + breath * 0.012, 1 + breath * 0.018, 1 + breath * 0.012);
    } else {
      torso.scale.set(1, 1, 1);
    }

    // Stumm: zusammensacken
    const mm = smooth(0, 1, m.mute);
    if (mm > 0.001) {
      const slump = m.seated ? 0.45 : 0.32;
      torso.rotation.x = lerp(torso.rotation.x, slump, mm);
      torso.rotation.z = lerp(torso.rotation.z, 0.05, mm);
      head.rotation.x = lerp(head.rotation.x, 0.5, mm);
      head.rotation.z = lerp(head.rotation.z, 0.22 * (m.index % 2 ? 1 : -1), mm);
      head.rotation.y = lerp(head.rotation.y, 0, mm);
      m.body.rotation.y = lerp(m.body.rotation.y, 0, mm);
      m.body.position.y = lerp(m.body.position.y, m.seated ? -0.03 : -0.05, mm);
      if (!m.seated) {
        for (const L of [legL, legR]) { L.hip.rotation.x = lerp(L.hip.rotation.x, -0.12, mm); L.knee.rotation.x = lerp(L.knee.rotation.x, 0.24, mm); }
      }
      const f = mm * 0.7;
      for (const a of [armL, armR]) {
        a.sh.rotation.x = lerp(a.sh.rotation.x, m.seated ? -0.4 : -0.05, f);
        a.sh.rotation.y = lerp(a.sh.rotation.y, 0, f);
        a.sh.rotation.z = lerp(a.sh.rotation.z, a.side * 0.06, f);
        a.el.rotation.x = lerp(a.el.rotation.x, m.seated ? -0.6 : -0.15, f);
        a.el.rotation.z = lerp(a.el.rotation.z, 0, f);
      }
    }

    // Pop / Squash
    const p = m.popAmp * Math.exp(-m.popT * 7) * Math.cos(m.popT * 24);
    const hs = 1 + m.hover * 0.04;
    m.body.scale.set(hs * (1 + p * 0.5), hs * (1 - p), hs * (1 + p * 0.5));

    // Augen: blinzeln / schlafen
    m.blinkT -= dt;
    if (m.blinkT <= 0) { m.blinkT = 2 + Math.random() * 4; m.blinkStart = this._time; }
    let blink = 1;
    if (m.blinkStart != null) {
      const bt = this._time - m.blinkStart;
      if (bt < 0.16) blink = 0.15 + 0.85 * Math.abs(bt / 0.08 - 1);
    }
    const eyeY = Math.min(blink, 1 - 0.88 * mm);
    for (const eg of R.eyes) eg.scale.y = eyeY;
  }

  _applyLook(m) {
    const mute = m.mute, hov = m.hover;
    const pulse = m.norm * (1 - mute);
    if (Math.abs(mute - m._am) > 0.002 || Math.abs(hov - m._ah) > 0.002) {
      m._am = mute; m._ah = hov;
      for (const en of m.mats) {
        en.mat.color.copy(en.base).lerp(en.gray, mute);
        if (!en.pulse) en.mat.emissiveIntensity = en.ei * (1 - mute) + (en.glow ? hov * 0.45 : 0);
      }
    }
    for (const en of m.pulses) {
      en.mat.emissiveIntensity = en.ei * (1 - mute) * (0.45 + 0.9 * pulse) + 0.03;
    }
  }

  _updateMemberFx(m, dt, playing) {
    const t = this._time;
    const us = this._uiScale || 1;
    const live = 1 - m.mute;
    const lvl = playing ? 0.55 + 0.75 * m.norm : 0.6;
    const inten = live * lvl + m.hover * 0.45;
    const F = m.fixture;
    F.coneMat.uniforms.uIntensity.value = inten * (this._lowPower ? 0.26 : 0.2);
    F.glowMat.opacity = clamp(0.15 + inten * 0.85);
    F.lensMat.color.copy(m.color).multiplyScalar(0.25 + inten);
    m.poolMat.opacity = clamp(inten * 0.32);
    m.pool.scale.setScalar(2.2 + m.norm * 0.4 * live);
    const L = this._pLights[m.index];
    if (L) L.intensity = inten * 3.2;

    // Zzz
    const z = smooth(0.35, 1, m.mute);
    m.zzzMat.opacity = z;
    m.zzz.visible = z > 0.01;
    m.zzz.position.y = m.headTop - 0.02 + Math.sin(t * 1.6 + m.seed * 5) * 0.06;
    m.zzz.position.x = 0.42 + Math.sin(t * 0.9) * 0.03;
    const zs = (0.5 + Math.sin(t * 2.2) * 0.04) * us;
    m.zzz.scale.set(zs, zs, 1);
    m.zzzMat.rotation = Math.sin(t * 1.2) * 0.12;

    // Namensschild
    const ts = (1 + m.hover * 0.15) * us;
    m.tag.scale.set(m.tagBase.x * ts, m.tagBase.y * ts, 1);
    m.tag.material.opacity = 0.65 + 0.35 * Math.max(live, m.hover);
    m.tag.position.y = m.headTop + 0.2 + (m.inst === 'drums' ? 0 : m.body.position.y * 0.6);

    // Pop-Ring
    if (m.ringT < 0.9) {
      const k = m.ringT / 0.9;
      m.ring.visible = true;
      m.ring.scale.setScalar(0.6 + k * 1.8);
      m.ringMat.opacity = (1 - k) * (1 - k) * 0.9;
    } else {
      m.ring.visible = false;
    }
  }

  _updateCrowd(dt) {
    const C = this._crowd;
    if (!C) return;
    const e = this._energy * this._playingF;
    const b = this._beat;
    const t = this._time;
    const D = this._dummy;
    const ppl = C.people;
    for (let i = 0; i < ppl.length; i++) {
      const p = ppl[i];
      const ph = b + p.off;
      const hop = e * p.amp * Math.pow(Math.abs(Math.sin(Math.PI * ph)), 1.5);
      p.raise = damp(p.raise, e > p.thr ? 1 : 0, 2.5, dt);
      const sway = Math.sin(t * 0.8 + p.seed * 6.28) * 0.05 * (1 - e * 0.6) + Math.sin(ph * Math.PI) * 0.06 * e;
      const y = GROUND_Y + hop;
      D.position.set(p.x, y, p.z);
      D.rotation.set(0, p.rot, sway);
      D.scale.setScalar(p.s);
      D.updateMatrix();
      C.mesh.setMatrixAt(i, D.matrix);
      for (let s = 0; s < 2; s++) {
        const side = s === 0 ? -1 : 1;
        const wave = Math.sin(ph * Math.PI + side + p.seed * 3) * 0.25;
        const a = -side * lerp(2.85, 0.28 + wave * p.raise, p.raise);
        const sx = p.x + Math.cos(p.rot) * side * 0.19 * p.s;
        const sz = p.z - Math.sin(p.rot) * side * 0.19 * p.s;
        const sy = y + 0.82 * p.s;
        D.position.set(sx, sy, sz);
        D.rotation.set(0, p.rot, a + sway);
        D.scale.setScalar(p.s);
        D.updateMatrix();
        C.arms.setMatrixAt(i * 2 + s, D.matrix);
        if (side === 1) {
          const j = i * 3;
          if (p.phone && p.raise > 0.2) {
            const L = 0.5 * p.s;
            C.pos[j] = sx - Math.sin(a + sway) * L;
            C.pos[j + 1] = sy + Math.cos(a + sway) * L;
            C.pos[j + 2] = sz;
            const tw = (0.6 + 0.4 * Math.sin(t * 3 + p.seed * 20)) * smooth(0.2, 0.8, p.raise);
            C.pc[j] = 0.75 * tw; C.pc[j + 1] = 0.85 * tw; C.pc[j + 2] = 1.0 * tw;
          } else {
            C.pos[j + 1] = -50;
            C.pc[j] = C.pc[j + 1] = C.pc[j + 2] = 0;
          }
        }
      }
    }
    C.mesh.instanceMatrix.needsUpdate = true;
    C.arms.instanceMatrix.needsUpdate = true;
    C.points.geometry.attributes.position.needsUpdate = true;
    C.points.geometry.attributes.color.needsUpdate = true;
    const u = this._crowdMat.uniforms;
    u.uEnergy.value = e;
    u.uRim.value.copy(this._rimA);
    u.uRim2.value.copy(this._rimB);
  }

  _syncWallColors() {
    const u = this._wallMat.uniforms;
    const ms = this._members;
    const defaults = Object.values(DEFAULT_COLORS);
    const n = ms.length ? Math.min(6, ms.length) : 5;
    for (let i = 0; i < 6; i++) {
      u.uColors.value[i].copy(ms[i] ? ms[i].color : new THREE.Color(defaults[i % defaults.length]));
    }
    u.uCount.value = n;
  }

  _updateFx(dt) {
    const t = this._time;
    const e = this._energy;
    const pf = this._playingF;
    const b = this._beat;
    const on = Math.pow(1 - frac(b), 4) * pf;

    // LED-Wand
    const u = this._wallMat.uniforms;
    u.uTime.value = t;
    u.uBeat.value = pf > 0.01 ? b : t * 0.4;
    u.uEnergy.value = e;
    u.uPlaying.value = pf;
    for (let i = 0; i < 6; i++) {
      const m = this._members[i];
      const target = m ? m.norm * (1 - m.mute * 0.9) * pf + 0.04 * (1 - m.mute) : 0;
      u.uLevels.value[i] = damp(u.uLevels.value[i], target, 14, dt);
    }

    // LED-Streifen: Farbe wandert durch die Palette
    const ms = this._members;
    const cycle = this._stripCol || (this._stripCol = new THREE.Color());
    if (ms.length) {
      const pos = (pf > 0.01 ? b * 0.25 : t * 0.15) % ms.length;
      const i0 = Math.floor(pos), i1 = (i0 + 1) % ms.length;
      cycle.copy(ms[i0].color).lerp(ms[i1].color, smooth(0, 1, pos - i0));
    } else {
      cycle.setHSL((t * 0.03) % 1, 0.9, 0.55);
    }
    const sk = 0.6 + 0.6 * e + 1.2 * on * e;
    for (const s of this._strips) s.material.color.copy(cycle).multiplyScalar(sk);

    // Rim-Licht färbt sich mit der Band
    this._rimLight.color.copy(this._rimA).lerp(this._rimBase, 0.55);
    this._rimLight.intensity = 1.3 + e * 1.2;

    // Moving Heads
    const palette = ms.length ? ms.map((m) => m.color) : [new THREE.Color('#b26bff'), new THREE.Color('#3dd6ff')];
    for (const B of this._beams) {
      const k = B.i;
      const ph = t * (0.35 + e * 0.25) + k * 0.9;
      B.head.rotation.set(0.95 + Math.sin(ph) * 0.28, Math.sin(ph * 0.7 + k) * 0.6, 0);
      const col = palette[k % palette.length];
      const inten = 0.05 + e * 0.32 + on * e * 0.25;
      B.coneMat.uniforms.uColor.value.copy(col);
      B.coneMat.uniforms.uIntensity.value = inten * (this._lowPower ? 0.9 : 0.75);
      B.lensMat.color.copy(col).multiplyScalar(0.4 + inten * 3);
      B.glow.material.color.copy(col);
      B.glow.material.opacity = clamp(0.2 + inten * 2);
    }

    // Laser (nur mit Energie)
    for (const L of this._lasers) {
      const a = t * 0.7 + L.i * 1.7;
      const vis = smooth(0.25, 0.6, e) * pf;
      L.mat.opacity = vis * (0.35 + 0.65 * on);
      L.m.visible = L.mat.opacity > 0.01;
      if (L.m.visible) {
        this._tmpV.set(-L.sx * 1.5 + Math.sin(a) * 6, 3.2 + Math.sin(a * 1.3) * 1.4, 7);
        L.m.lookAt(this._tmpV);
        const col = palette[(L.i + 1) % palette.length];
        L.mat.color.copy(col).multiplyScalar(1.2);
      }
    }
  }
}

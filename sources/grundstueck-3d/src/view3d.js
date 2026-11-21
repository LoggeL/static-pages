// 3D-Ansicht (eigener Chunk, erst auf Wunsch geladen): three, OrbitControls, Spark, Picker.
// Gerendert wird nur bei Bedarf (Kamerabewegung, Spark meldet fertige Sortierung, Overlay-Änderung).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { Picker } from './picker.js';
import { INT, MB } from './format.js';

const FOV = 60;

// Kontextverlust: eigener Fehlertyp, damit die App ihn von einem Abbruch durch den Nutzer unterscheidet
export function contextLostError() {
  const e = new Error('Die 3D-Ansicht wurde vom Gerät beendet (WebGL-Kontext verloren, vermutlich zu wenig Grafikspeicher).');
  e.name = 'ContextLostError';
  return e;
}

// Freigabe: three hängt je Renderer beim ersten Gebrauch einen 'dispose'-Listener an jede Textur,
// Geometrie und jedes Material (WebGLTextures, WebGLGeometries, WebGLObjects, WebGLRenderer …). Spark
// hält modulweite Objekte (leere Texturen, FullScreenQuad-Geometrie aus Pass.js), die nie freigegeben
// werden: Deren Listener hielten jeden alten Renderer samt Canvas und WebGL-Kontext am Leben. Deshalb
// merkt sich jede View3D die 'dispose'-Listener, die während ihrer Lebenszeit angehängt werden (nur
// three-Renderer-Interna tun das), und hängt sie in dispose() ab. Ein späterer Renderer lädt die
// Objekte dann neu hoch.
const trackers = new Set();
const origAddListener = THREE.EventDispatcher.prototype.addEventListener;
THREE.EventDispatcher.prototype.addEventListener = function addEventListener(type, listener) {
  if (type === 'dispose') for (const t of trackers) t.push([this, listener]);
  return origAddListener.call(this, type, listener);
};

// Signal, das abbricht, sobald eines der beiden abbricht (AbortSignal.any fehlt in Safari < 17.4)
function eitherSignal(a, b) {
  if (!a) return b;
  const ac = new AbortController();
  for (const s of [a, b]) {
    if (s.aborted) { ac.abort(s.reason); break; }
    s.addEventListener('abort', () => ac.abort(s.reason), { once: true, signal: ac.signal });
  }
  return ac.signal;
}

function sparkParams(r) {
  const { maxStdDev, minAlpha, minPixelRadius, maxPixelRadius, clipXY, minSortIntervalMs } = r;
  return { maxStdDev, minAlpha, minPixelRadius, maxPixelRadius, clipXY, minSortIntervalMs };
}

// Hintergrund: senkrechter Farbverlauf (Himmel -> Dunst)
function skyTexture(stops) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  stops.forEach((col, i) => grad.addColorStop(i / (stops.length - 1), col));
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class View3D {
  // Lädt Renderer und Splat; bei Fehler oder Abbruch wird alles Angelegte wieder freigegeben.
  // Der Canvas bleibt bis activate() unsichtbar und ohne Eingaben: Während des Downloads
  // bleibt die 2D-Karte darunter sichtbar und bedienbar.
  static async create(opts) {
    const v = new View3D(opts);
    try {
      v.init(opts);
      await v.loadMesh(opts.tier, opts.signal, opts.onProgress);
      if (v.lost) throw contextLostError();
    } catch (err) {
      v.dispose();
      throw err;
    }
    return v;
  }

  constructor({ host, cfg, base, tier, hooks, stats, view2d }) {
    this.kind = '3d';
    Object.assign(this, { host, cfg, base, hooks, stats });
    this.tier = tier;
    this.active = false;
    // Größe 0 (Fenster/Tab ausgeblendet, #app display:none) ist ein normaler Zustand: nicht rendern,
    // Canvas und Kamera behalten, beim nächsten echten Layout (ResizeObserver) weiter.
    this.sized = false;
    this.zero = true;
    this.view2d = view2d; // 2D-Ausschnitt beim Öffnen: gilt, solange 3D noch nie eine Größe hatte
    this.disposeListeners = []; // siehe trackers oben
    trackers.add(this.disposeListeners);
    // Kontextverlust bricht jedes laufende Laden ab (Download, Entpacken) – auch vor activate()
    this.lossAc = new AbortController();
    this.lossP = new Promise((_, reject) => { this.lossAc.signal.addEventListener('abort', () => reject(contextLostError()), { once: true }); });
    this.lossP.catch(() => {}); // wird nur über Promise.race in loadMesh ausgewertet
    this.ac = new AbortController();
  }

  init({ host, before, cfg, tier, initial }) {
    const sig = { signal: this.ac.signal };
    const canvas = document.createElement('canvas');
    canvas.id = 'view';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '3D-Ansicht des Grundstücks');
    canvas.style.visibility = 'hidden';
    this.canvas = canvas;
    // Kontext zuerst am noch nicht eingehängten Canvas anlegen: Schlägt das fehl, bleibt nichts im DOM.
    // Die Wahl gilt für die Lebensdauer des Kontexts.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: tier.id === 'max' || tier.id === 'hoch' ? 'high-performance' : 'default' });
    host.insertBefore(canvas, before);
    this.scene = new THREE.Scene();
    const bg = cfg.background ?? ['#141c25', '#0e1319', '#0a0d11'];
    this.scene.background = Array.isArray(bg) ? skyTexture(bg) : new THREE.Color(bg);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 400);
    this.spark = this.makeSpark(tier);
    this.camera.position.fromArray(initial.position);
    const c = new OrbitControls(this.camera, canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.zoomToCursor = true;
    c.minDistance = 0.2;
    const ext = cfg.map.extent, st = cfg.map.start;
    c.maxDistance = Math.max(60, 1.5 * Math.hypot(ext[1] - ext[0], ext[3] - ext[2]));
    c.maxPolarAngle = Math.PI * 0.52;
    c.rotateSpeed = 0.7;
    c.target.fromArray(initial.target);
    this.controls = c;
    this.sceneRadius = 0.5 * Math.hypot(st[1] - st[0], st[3] - st[2]);
    this.home3 = { position: new THREE.Vector3().fromArray(cfg.view.position), target: new THREE.Vector3().fromArray(cfg.view.target) };
    this.raycaster = new THREE.Raycaster();
    this.keys = new Set();
    this.tween = null;
    this.raf = 0;
    this.needs = true;
    this.overlayNeeds = true;
    this.lastT = performance.now();
    this.centerDepth = null;
    this.picker = null;
    this.pickPromise = null;
    this.inMotion = false;
    this.lastCam = new Float64Array(32);
    this.camPos = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();

    const self = this;
    const M = new Float64Array(16);
    this.proj = {
      w: 1, h: 1, near: 0.05 * 1.01, margin: 48, topDown: false, M,
      toClip(p, out) {
        const x = p[0], y = p[1], z = p[2];
        out[0] = M[0] * x + M[4] * y + M[8] * z + M[12];
        out[1] = M[1] * x + M[5] * y + M[9] * z + M[13];
        out[2] = M[2] * x + M[6] * y + M[10] * z + M[14];
        out[3] = M[3] * x + M[7] * y + M[11] * z + M[15];
        return out;
      },
      labelDist(p) { const q = self.camera.position; return Math.hypot(p[0] - q.x, p[1] - q.y, p[2] - q.z); },
    };
    this.sampler = {
      kind: 'surface',
      title: 'Höhenprofil (Oberfläche von oben)',
      sampleMany: async (pts, topY) => {
        await this.pickReady();
        const down = new THREE.Vector3(0, -1, 0);
        const res = await this.picker.pickMany(pts.map(([x, z]) => [new THREE.Ray(new THREE.Vector3(x, topY, z), down)]));
        return res.map((h) => (h ? { y: h.point.y, q: 2 } : null));
      },
    };

    c.addEventListener('change', () => this.requestRender());
    c.addEventListener('start', () => { this.tween = null; this.setMotion(true); this.requestRender(); });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.disposed) return; // eigener forceContextLoss() in dispose()
      console.error(`webglcontextlost (Stufe ${this.tier.id}, ${this.active ? 'aktiv' : 'beim Laden'})`);
      cancelAnimationFrame(this.raf); this.raf = 0;
      this.lost = true;
      this.lossAc.abort(); // laufendes Laden (create/setTier) scheitert mit ContextLostError
      // Noch nicht aktiv: create() wirft, die App zeigt den Ladefehler. Aktiv: die App meldet es selbst.
      if (this.active) this.hooks.onContextLost(this);
    }, sig);
    this.attachInput(sig);
    document.addEventListener('visibilitychange', () => {
      this.keys.clear();
      if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; this.tween = null; } else this.requestRender();
    }, sig);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize(); // bei Größe 0: wartet auf den ResizeObserver

    window.__viewer = {
      THREE, view: this, scene: this.scene, camera: this.camera, controls: this.controls, renderer: this.renderer,
      get spark() { return self.spark; }, get mesh() { return self.mesh; }, get picker() { return self.picker; },
      requestRender: () => this.requestRender(), pickAt: (x, y, multi) => this.pickAt(x, y, { multi }),
    };
  }

  makeSpark(tier) {
    const spark = new SparkRenderer({ renderer: this.renderer, onDirty: () => this.requestRender(), enableLod: false, ...sparkParams(tier.render) });
    this.scene.add(spark);
    return spark;
  }

  // ---------------------------------------------------------------- Laden
  async loadMesh(tier, signal, onProgress) {
    if (this.lost) throw contextLostError();
    try {
      await this.loadMeshInner(tier, eitherSignal(signal, this.lossAc.signal), onProgress);
    } catch (err) {
      // Abbruch durch den Kontextverlust ist kein Nutzerabbruch: als Kontextverlust melden
      if (this.lost && err.name !== 'ContextLostError') throw contextLostError();
      throw err;
    }
  }
  async loadMeshInner(tier, signal, onProgress) {
    const url = `${this.base}scene/${tier.file}?v=${tier.hash}`;
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error(`${tier.file}: HTTP ${r.status}`);
    // Server mit SPA-Rückfall liefern für fehlende Dateien index.html mit 200
    if (/text\/html/i.test(r.headers.get('content-type') ?? '')) {
      r.body?.cancel();
      throw new Error(`${tier.file}: Der Server lieferte eine HTML-Seite statt der Modelldatei (Datei fehlt?)`);
    }
    let bytes = new Uint8Array(tier.bytes);
    let got = 0;
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > tier.bytes) {
        reader.cancel();
        throw new Error(`Datei ${tier.file} unvollständig oder abweichend: mehr als ${MB(tier.bytes)} MB`);
      }
      bytes.set(value, got);
      got += value.length;
      onProgress?.('download', got, tier.bytes);
    }
    if (got !== tier.bytes) throw new Error(`Datei ${tier.file} unvollständig oder abweichend: ${MB(got)} statt ${MB(tier.bytes)} MB`);
    onProgress?.('decode');
    // Spark behält das Options-Objekt (Closure des Generators): die Dateibytes danach dort lösen,
    // sonst bleiben sie für die ganze 3D-Sitzung im Speicher.
    const meshOpts = { fileBytes: bytes, fileType: 'pcsogszip', extSplats: tier.ext, editable: false, raycastable: false };
    bytes = null;
    const mesh = new SplatMesh(meshOpts);
    mesh.maxSh = tier.render.maxSh; // vor dem ersten Rendern
    const t = this.cfg.transform;
    mesh.quaternion.fromArray(t.quaternion);
    mesh.position.fromArray(t.position);
    mesh.scale.setScalar(t.scale);
    // Erst nach bestandenen Prüfungen wird das Modell this.mesh: Ein abgebrochenes oder falsches
    // Modell darf nie unter der Bezeichnung der vorherigen Stufe stehen bleiben.
    this.scene.add(mesh);
    let n;
    try {
      try {
        await Promise.race([mesh.initialized, this.lossP]);
      } finally {
        meshOpts.fileBytes = null;
      }
      if (this.lost) throw contextLostError();
      if (signal?.aborted) throw new DOMException('3D-Laden abgebrochen', 'AbortError');
      const src = mesh.extSplats ?? mesh.packedSplats;
      n = src?.numSplats;
      if (n !== tier.count) throw new Error(`${tier.file}: ${n} Splats geladen, scene.json erwartet ${tier.count}`);
      if (this.disposed) throw new DOMException('3D-Ansicht wurde während des Ladens freigegeben', 'AbortError');
    } catch (err) {
      if (this.scene) this.scene.remove(mesh);
      mesh.dispose();
      throw err;
    }
    this.mesh = mesh;
    this.tier = tier;
    this.applyTier(tier);
    this.hooks.setStatus(`3D · ${tier.label} · ${INT.format(n)} Splats`);
    this.requestRender();
  }

  applyTier(tier) {
    const r = tier.render;
    this.tier = tier;
    this.inMotion = false;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, r.pixelRatio));
    if (this.sized) this.renderer.setSize(this.proj.w, this.proj.h, false);
    Object.assign(this.spark, sparkParams(r));
    this.mesh.maxSh = r.maxSh;
    this.mesh.updateGenerator(); // nach Änderung von maxSh nötig (SplatMesh.d.ts)
    this.requestRender();
  }

  sameFile(a, b) { return a.file === b.file && a.ext === b.ext; }

  // Stufenwechsel. Andere Datei: Speicher zuerst freigeben, dann laden (Spitzenspeicher).
  async setTier(tier, { signal, onProgress } = {}) {
    if (this.lost) throw contextLostError();
    if (this.mesh && this.sameFile(this.tier, tier)) { this.applyTier(tier); this.hooks.setStatus(`3D · ${tier.label} · ${INT.format(tier.count)} Splats`); return false; }
    this.releaseMesh();
    this.scene.remove(this.spark);
    this.spark.dispose(); // Accumulatoren, orderingTexture und Readback-Puffer wachsen nur
    this.spark = this.makeSpark(tier);
    await this.loadMesh(tier, signal, onProgress);
    return true;
  }
  releaseMesh() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); this.mesh = null; }
    if (this.picker) { this.picker.dispose(); this.picker = null; this.pickPromise = null; this.hooks.onPickState('idle'); }
    this.centerDepth = null;
  }

  // ---------------------------------------------------------------- Picking
  pickReady() {
    if (!this.mesh) return Promise.reject(new Error('Kein Modell geladen'));
    if (!this.pickPromise) {
      this.picker = new Picker();
      const p = this.cfg.picking;
      if (p?.tau !== undefined) this.picker.tau = p.tau;
      if (p?.minOpacity !== undefined) this.picker.minOpacity = p.minOpacity;
      this.hooks.onPickState('preparing');
      const picker = this.picker;
      this.pickPromise = picker.ensure(this.mesh, this.tier.count).then(() => {
        if (picker !== this.picker) return;
        this.hooks.onPickState('ready');
        this.scheduleCenterDepth();
      }, (err) => {
        if (picker === this.picker && !this.disposed) { console.error(err); this.hooks.onPickState('failed', err); }
        throw err;
      });
    }
    return this.pickPromise;
  }
  raysAt(clientX, clientY, multi) {
    const r = this.canvas.getBoundingClientRect();
    const offsets = multi ? [[0, 0], [1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]] : [[0, 0]];
    this.camera.updateMatrixWorld();
    return offsets.map(([ox, oy]) => {
      const ndc = new THREE.Vector2(((clientX + ox - r.left) / r.width) * 2 - 1, -((clientY + oy - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      return this.raycaster.ray.clone();
    });
  }
  async pickAt(clientX, clientY, { multi = true } = {}) {
    await this.pickReady();
    const picker = this.picker;
    if (this.disposed || !picker) throw new Error('Messen abgebrochen (3D geschlossen oder Qualität gewechselt)');
    const hit = await picker.pick(this.raysAt(clientX, clientY, multi));
    if (!hit) return { error: 'An dieser Stelle ist keine Oberfläche erkennbar.' };
    return { point: [hit.point.x, hit.point.y, hit.point.z], src: 's', spread: hit.spread, scatter: hit.scatter, opacity: hit.opacity, dist: hit.point.distanceTo(this.camera.position) };
  }
  // Doppelklick im Werkzeug „Bewegen“: Drehpunkt auf die Stelle
  async doubleAt(clientX, clientY) {
    const hit = await this.pickAt(clientX, clientY);
    if (hit.error) return;
    const t = new THREE.Vector3().fromArray(hit.point);
    const cam = this.camera.position;
    // Drehpunkt nicht höher legen, als es die Neigungsgrenze der Kamera zulässt
    const h = Math.hypot(cam.x - t.x, cam.z - t.z);
    const maxY = cam.y + h * Math.tan(this.controls.maxPolarAngle - Math.PI / 2);
    if (t.y > maxY) t.y = maxY;
    this.animateTo(cam.clone(), t, 350);
  }

  // ---------------------------------------------------------------- Maßstab
  // Die Maßstabsleiste gilt für die Oberfläche in der Bildmitte. Deren Abstand wird gemessen,
  // sobald die Kamera kurz stillsteht und der Picker bereit ist; solange gilt der Abstand zum Drehpunkt.
  metersPerPixel() {
    const d = this.centerDepth ?? this.camera.position.distanceTo(this.controls.target);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / this.proj.h;
  }
  scheduleCenterDepth() {
    if (!this.picker?.ready || this.raf || this.disposed || this.zero || this.lost) return;
    const gen = (this.depthGen = (this.depthGen || 0) + 1);
    const r = this.canvas.getBoundingClientRect();
    this.picker.pick(this.raysAt(r.left + r.width / 2, r.top + r.height / 2, false)).then((hit) => {
      if (gen !== this.depthGen || this.disposed) return;
      this.centerDepth = hit ? -hit.point.clone().applyMatrix4(this.camera.matrixWorldInverse).z : null;
      this.hooks.onScaleChanged();
    }, (err) => { if (!this.disposed) { console.error(err); this.hooks.onPickState('failed', err); } });
  }

  // ---------------------------------------------------------------- Kamera
  getViewState() {
    if (!this.sized) return { ...this.view2d }; // nie sichtbar gewesen: Kamera unverändert aus 2D
    const d = this.camera.position.distanceTo(this.controls.target);
    return { cx: this.controls.target.x, cz: this.controls.target.z, mpp: (d * 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / this.proj.h };
  }
  animateTo(position, target, ms = 650) {
    this.tween = { t0: performance.now(), ms, p0: this.camera.position.clone(), p1: position.clone(), q0: this.controls.target.clone(), q1: target.clone() };
    this.setMotion(true);
    this.requestRender();
  }
  focusOn(points) {
    const box = new THREE.Box3();
    points.forEach((p) => box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2])));
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(0.6, box.getSize(new THREE.Vector3()).length());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < 0.45) { dir.y = 0.45; dir.normalize(); }
    this.animateTo(c.clone().addScaledVector(dir, r * 1.6 + 0.8), c);
  }
  home() { this.animateTo(this.home3.position, this.home3.target); }
  goTop() {
    const t = this.controls.target.clone();
    const cam = this.camera.position;
    const d = Math.max(cam.distanceTo(t), this.sceneRadius * 1.6);
    const back = cam.clone().sub(t).setY(0);
    if (back.lengthSq() < 1e-6) back.set(0, 0, 1);
    back.normalize().multiplyScalar(d * 0.002); // minimaler Versatz hält die Blickrichtung stabil
    this.animateTo(t.clone().add(new THREE.Vector3(0, d, 0)).add(back), t);
  }
  // Pick-Worker ohne wartenden Aufrufer vorbereiten (Werkzeugwahl, Hover). Ein Fehler wird bereits
  // in pickReady() über hooks.onPickState('failed') sichtbar gemeldet und hier nicht erneut geworfen.
  warmPicker() { if (this.mesh) this.pickReady().then(null, () => {}); }
  keyDown(code) { if (!this.keys.has(code)) { this.keys.add(code); this.setMotion(true); this.requestRender(); } }
  keyUp(code) { this.keys.delete(code); }
  clearKeys() { this.keys.clear(); }
  moveByKeys(dt) {
    const k = this.keys;
    if (!k.size) return false;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const u = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    if (!f && !s && !u) return false;
    const cam = this.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const fast = k.has('ShiftLeft') || k.has('ShiftRight');
    const speed = Math.max(1.2, cam.position.distanceTo(this.controls.target) * 0.6) * (fast ? 3 : 1);
    const delta = fwd.multiplyScalar(f).add(right.multiplyScalar(s)).add(new THREE.Vector3(0, u, 0)).multiplyScalar(speed * dt);
    cam.position.add(delta);
    this.controls.target.add(delta);
    this.tween = null;
    return true;
  }

  // ---------------------------------------------------------------- Rendern
  requestRender() { this.needs = true; this.schedule(); }
  requestOverlay() { this.overlayNeeds = true; this.schedule(); }
  setLayersChanged() { this.requestOverlay(); }
  schedule() {
    if (this.raf || document.hidden || this.disposed || this.lost || this.zero) return;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
  frame(now) {
    this.raf = 0;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    let active = this.moveByKeys(dt);
    if (this.tween) {
      const tw = this.tween;
      const u = Math.min(1, (now - tw.t0) / tw.ms);
      const s = u * u * (3 - 2 * u);
      this.camera.position.lerpVectors(tw.p0, tw.p1, s);
      this.controls.target.lerpVectors(tw.q0, tw.q1, s);
      if (u >= 1) this.tween = null;
      active = true;
    }
    // Die Dämpfung verschiebt die Kamera noch sekundenlang um 1e-11 m und weniger, ohne dass update()
    // true liefert. Spark erzeugt bei SH-Stufen (maxSh > 0) für jede Änderung der Blickrichtung die Splats
    // neu und sortiert, meldet onDirty, der nächste Frame ruft wieder update() … Unterhalb der
    // Toleranz von cameraChanged() wird die Kamera deshalb auf den Stand vor update() zurückgesetzt.
    const cam = this.camera;
    this.camPos.copy(cam.position); this.camQuat.copy(cam.quaternion);
    if (this.controls.update()) active = true; // true, solange sich etwas ändert (auch Dämpfung)
    const moved = this.cameraChanged();
    if (!moved) { cam.position.copy(this.camPos); cam.quaternion.copy(this.camQuat); cam.updateMatrixWorld(); }
    if (moved) this.centerDepth = null;
    if (this.needs || active || moved) {
      this.needs = false;
      this.camera.updateMatrixWorld();
      this.updateProj();
      this.renderer.render(this.scene, this.camera);
      this.stats.renders++;
    }
    if ((moved || this.overlayNeeds) && this.active) { this.overlayNeeds = false; this.hooks.onFrame(moved); }
    if (active || this.keys.size || this.tween) { if (!this.raf) { this.raf = requestAnimationFrame((t) => this.frame(t)); } }
    else this.scheduleIdle();
  }
  // 200 ms nach dem letzten aktiven Frame: volle Auflösung, Tiefe der Bildmitte
  scheduleIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.raf || this.disposed) return;
      this.setMotion(false);
      this.scheduleCenterDepth();
    }, 200);
  }
  // Während Bewegung geringere Auflösung (nur wenn die Stufe das vorsieht)
  setMotion(on) {
    const r = this.tier.render;
    if (on === this.inMotion || !(r.motionPixelRatio < r.pixelRatio) || !this.mesh) return;
    this.inMotion = on;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, on ? r.motionPixelRatio : r.pixelRatio));
    if (this.sized) this.renderer.setSize(this.proj.w, this.proj.h, false);
    if (!on) this.requestRender();
  }
  updateProj() {
    const a = this.camera.projectionMatrix.elements, b = this.camera.matrixWorldInverse.elements, M = this.proj.M;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        M[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
      }
    }
    this.proj.near = this.camera.near * 1.01;
  }
  // Vergleich mit kleiner Toleranz: das Ausschwingen der Dämpfung löst sonst sekundenlang
  // Neuzeichnungen aus, ohne dass sich sichtbar etwas ändert.
  cameraChanged() {
    this.camera.updateMatrixWorld();
    const a = this.camera.matrixWorld.elements, b = this.camera.projectionMatrix.elements, L = this.lastCam;
    let changed = false;
    for (let i = 0; i < 16 && !changed; i++) {
      changed = Math.abs(L[i] - a[i]) > 1e-6 * Math.max(1, Math.abs(a[i])) || L[16 + i] !== b[i];
    }
    if (changed) { L.set(a, 0); L.set(b, 16); }
    return changed;
  }
  resize() {
    if (this.disposed) return;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) {
      if (!this.zero) { this.zero = true; cancelAnimationFrame(this.raf); this.raf = 0; this.keys.clear(); }
      return;
    }
    this.zero = false;
    this.sized = true;
    const r = this.tier.render;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.inMotion ? r.motionPixelRatio : r.pixelRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.proj.w = w; this.proj.h = h;
    if (this.active) this.hooks.onResize?.(w, h);
    this.requestRender();
    this.requestOverlay();
  }

  // Nach erfolgreichem Laden (und map2d.suspend()): Canvas zeigen, Overlay übernehmen
  activate() {
    if (this.disposed) throw new Error('3D-Ansicht ist bereits freigegeben');
    this.active = true;
    this.canvas.style.visibility = '';
    this.resize();
  }

  // ---------------------------------------------------------------- Eingaben
  attachInput(sig) {
    const canvas = this.canvas;
    const pointers = new Map();
    let gestureMulti = false;
    let lastClick = { t: 0, x: 0, y: 0 };
    canvas.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button });
      if (pointers.size > 1) gestureMulti = true;
      this.tween = null;
    }, sig);
    const endPointer = (e, cancelled) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      const multi = gestureMulti;
      if (pointers.size === 0) gestureMulti = false;
      if (!p || cancelled || multi || p.button !== 0) return;
      const now = performance.now();
      const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      const touch = e.pointerType !== 'mouse';
      // Finger zittern stärker und tippen langsamer als eine Maus
      if (moved > (touch ? 12 : 6) || now - p.t > (touch ? 1500 : 700)) return;
      // Der zweite Klick eines Doppelklicks setzt keinen weiteren Punkt
      const dbl = now - lastClick.t < 400 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 8;
      lastClick = { t: now, x: e.clientX, y: e.clientY };
      if (dbl) return;
      this.hooks.onTap(e.clientX, e.clientY, touch, e.altKey);
    };
    canvas.addEventListener('pointerup', (e) => endPointer(e, false), sig);
    canvas.addEventListener('pointercancel', (e) => endPointer(e, true), sig);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), sig);
    canvas.addEventListener('dblclick', (e) => this.hooks.onDouble(e.clientX, e.clientY), sig);
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      this.hooks.onHover(e.clientX, e.clientY, e.altKey);
    }, sig);
    canvas.addEventListener('pointerleave', () => this.hooks.onLeave(), sig);
  }

  // ---------------------------------------------------------------- Freigabe
  // Reihenfolge nach Spezifikation; jeder Fehler wird gemeldet, die übrigen Schritte laufen weiter.
  dispose() {
    if (this.disposed) return [];
    this.disposed = true;
    const errors = [];
    const step = (name, fn) => { try { fn(); } catch (err) { console.error(`3D-Freigabe, Schritt „${name}“:`, err); errors.push(`${name}: ${err.message}`); } };
    // Auch für eine nur teilweise angelegte Ansicht (Fehler in init()): fehlende Teile überspringen.
    step('Bildschleife', () => { cancelAnimationFrame(this.raf); this.raf = 0; clearTimeout(this.idleTimer); });
    step('Steuerung', () => this.controls?.dispose());
    step('Modell', () => { if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); this.mesh = null; } });
    step('Spark', () => { if (this.spark) { this.scene.remove(this.spark); this.spark.dispose(); } });
    step('Szene', () => { if (this.scene) { this.scene.background?.dispose?.(); this.scene.clear(); } });
    step('Picker', () => { this.picker?.dispose(); this.picker = null; });
    step('Renderer', () => this.renderer?.dispose());
    step('Kontext', () => { if (this.renderer && !this.lost) this.renderer.forceContextLoss(); });
    // nach renderer.dispose(): Listener dieses Renderers an modulweiten Objekten abhängen (siehe trackers)
    step('Renderer-Listener', () => {
      trackers.delete(this.disposeListeners);
      for (const [target, listener] of this.disposeListeners) target.removeEventListener('dispose', listener);
      this.disposeListeners.length = 0;
    });
    step('Canvas', () => this.canvas?.remove());
    step('Listener', () => { this.ac.abort(); this.ro?.disconnect(); });
    step('Referenzen', () => {
      if (window.__viewer?.view === this) delete window.__viewer;
      this.spark = null; this.renderer = null; this.scene = null; this.controls = null; this.canvas = null;
    });
    return errors;
  }
}

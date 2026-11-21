import * as THREE from 'three';

// Hauptthread-Seite des Pickers. Der Worker wird erst beim ersten Messbedarf gestartet
// (ensure); die Splat-Daten werden in Scheiben gelesen, damit kein langer Task entsteht.

const SLICE_MAX = 65536;    // höchstens so viele Splats je Scheibe
const SLICE_MS = 10;        // und höchstens so lange am Stück (Prüfung alle 1024 Splats)

const chan = new MessageChannel();
const waiting = [];
chan.port1.onmessage = () => waiting.shift()?.();
const yieldToMain = () => new Promise((r) => { waiting.push(r); chan.port2.postMessage(0); });

export class Picker {
  constructor() {
    this.pending = new Map();
    this.nextId = 1;
    this.ready = false;
    this.failed = null;
    this.worker = null;
    this.initPromise = null;
    this.count = 0;
    this.tau = 0.35;        // Deckkraft-Schwelle der Oberfläche
    this.minOpacity = 0.15; // darunter: keine Oberfläche
    this.stats = null;      // { sliceMaxMs, slices, readMs, grid }
    this._inv = new THREE.Matrix4();
  }

  ensure(mesh, expectedCount) {
    if (!this.initPromise) this.initPromise = this.init(mesh, expectedCount);
    return this.initPromise;
  }

  fail(err) {
    if (!this.failed) this.failed = err;
    this.ready = false;
    for (const p of this.pending.values()) p.reject(this.failed);
    this.pending.clear();
  }

  async init(mesh, expectedCount) {
    this.mesh = mesh;
    const src = mesh.extSplats ?? mesh.packedSplats;
    if (!src) throw new Error('Splat-Daten fehlen (weder extSplats noch packedSplats)');
    const n = src.numSplats;
    if (n !== expectedCount) throw new Error(`${n} Splats im Modell, scene.json erwartet ${expectedCount}`);
    const worker = new Worker(new URL('./pick-worker.js', import.meta.url), { type: 'module' });
    this.worker = worker;
    let readyResolve;
    const ready = new Promise((res, rej) => { readyResolve = res; this._readyReject = rej; });
    // Fällt der Worker schon während des Einlesens aus, wird `ready` verworfen, bevor init()
    // darauf wartet. Der Fehler geht trotzdem nicht verloren: fail() setzt this.failed, und die
    // Einleseschleife wirft ihn (bzw. `await ready` unten). Der leere Handler verhindert nur die
    // doppelte Meldung als „unhandled rejection“.
    ready.catch(() => {});
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { this.ready = true; this.count = m.n; this.gridInfo = m; readyResolve(m); }
      else if (m.type === 'hit') { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); p.resolve(m.hits); } }
      else if (m.type === 'error') {
        const err = new Error(`Mess-Worker: ${m.message}`);
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); p.reject(err); } else { this.fail(err); this._readyReject(err); }
      }
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      const err = new Error(`Mess-Worker ausgefallen${e?.message ? `: ${e.message}` : ' (Skript nicht ladbar)'}`);
      this.fail(err);
      this._readyReject(err);
    };
    worker.onmessageerror = () => {
      const err = new Error('Mess-Worker: Nachricht nicht lesbar');
      this.fail(err);
      this._readyReject(err);
    };

    const C = new Float32Array(3 * n), S = new Float32Array(3 * n);
    const Q = new Float32Array(4 * n), A = new Float32Array(n);
    const t0 = performance.now();
    let sliceMax = 0, slices = 0;
    let bad = 0, firstBad = -1; // Splats mit NaN/∞: kein Ersatzwert, sondern laute Meldung unten
    for (let i = 0; i < n;) {
      const ts = performance.now();
      const end = Math.min(n, i + SLICE_MAX);
      for (; i < end; i++) {
        // getSplat liefert ein geteiltes Objekt (keine Allokation je Splat)
        const s = src.getSplat(i);
        const c = s.center, sc = s.scales, q = s.quaternion;
        const i3 = 3 * i, i4 = 4 * i;
        C[i3] = c.x; C[i3 + 1] = c.y; C[i3 + 2] = c.z;
        S[i3] = sc.x; S[i3 + 1] = sc.y; S[i3 + 2] = sc.z;
        Q[i4] = q.x; Q[i4 + 1] = q.y; Q[i4 + 2] = q.z; Q[i4 + 3] = q.w;
        A[i] = s.opacity;
        // eine Summe genügt: NaN und ±∞ setzen sich durch (∞ − ∞ ergibt NaN)
        if (!Number.isFinite(c.x + c.y + c.z + sc.x + sc.y + sc.z + q.x + q.y + q.z + q.w + s.opacity)) { if (bad++ === 0) firstBad = i; }
        if ((i & 1023) === 1023 && performance.now() - ts > SLICE_MS) { i++; break; }
      }
      sliceMax = Math.max(sliceMax, performance.now() - ts);
      slices++;
      if (this.failed) throw this.failed;
      await yieldToMain();
      if (this.disposed) throw this.failed;
    }
    if (bad) {
      throw new Error(`${bad.toLocaleString('de-DE')} Splats mit ungültigen Werten (NaN oder ∞ in Lage, Größe, Drehung oder Deckkraft, erster Index ${firstBad}) – Modelldatei prüfen`);
    }
    this.stats = { sliceMaxMs: Math.round(sliceMax * 10) / 10, slices, readMs: Math.round(performance.now() - t0) };
    worker.postMessage({ type: 'init', C, S, Q, A }, [C.buffer, S.buffer, Q.buffer, A.buffer]);
    const info = await ready;
    this.stats.grid = info;
    if (info.n !== expectedCount) throw new Error(`Mess-Worker meldet ${info.n} Splats, erwartet ${expectedCount}`);
    return info;
  }

  request(msg) {
    if (this.failed) return Promise.reject(this.failed);
    if (!this.ready) return Promise.reject(new Error('Messwerkzeug ist noch nicht bereit'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id, tau: this.tau, amin: this.minOpacity });
    });
  }

  local(rays) {
    const mesh = this.mesh;
    mesh.updateMatrixWorld(true);
    this._inv.copy(mesh.matrixWorld).invert();
    const scale = mesh.getWorldScale(new THREE.Vector3()).x;
    const o = rays[0].origin.clone().applyMatrix4(this._inv);
    const dirs = rays.map((r) => { const d = r.direction.clone().transformDirection(this._inv); return [d.x, d.y, d.z]; });
    return { o, dirs, scale, matrixWorld: mesh.matrixWorld.clone() };
  }

  // Strahlen mit gemeinsamem Ursprung in Weltkoordinaten (THREE.Ray[]), rays[0] = Mitte.
  // Ergebnis: { point (Welt), spread, scatter (Weltmeter), opacity, conf } oder null.
  async pick(rays, linear = false) {
    const L = this.local(rays);
    // Nahgrenze 5 cm in Weltmetern, umgerechnet in lokale Einheiten
    const hits = await this.request({ type: linear ? 'pick-linear' : 'pick', o: [L.o.x, L.o.y, L.o.z], dirs: L.dirs, near: 0.05 / L.scale });
    return this.combine(hits, L);
  }

  // Viele Einzelstrahlen in einer Nachricht (Höhenprofil)
  async pickMany(raysList) {
    const Ls = raysList.map((rays) => this.local(rays));
    const hits = await this.request({ type: 'pick-batch', rays: Ls.map((L) => ({ o: [L.o.x, L.o.y, L.o.z], dirs: L.dirs })), near: 0.05 / Ls[0].scale });
    return hits.map((h, i) => this.combine(h, Ls[i]));
  }

  combine(hits, { o, dirs, scale, matrixWorld }) {
    const valid = hits.filter(Boolean);
    if (!valid.length) return null;
    // Der mittlere Strahl bestimmt den Punkt (genau die angeklickte Stelle, auch bei
    // dünnen Pfosten). Die Nachbarstrahlen liefern nur die Verlässlichkeit; fehlt der
    // mittlere Treffer, hilft ihr Median über kleine Lücken hinweg.
    const center = hits[0];
    const ts = valid.map((h) => h.t).sort((a, b) => a - b);
    let t;
    if (center) t = center.t;
    else if (valid.length >= Math.ceil(hits.length / 2)) t = ts[Math.floor((ts.length - 1) / 2)];
    else return null;
    const len = Math.hypot(...dirs[0]);
    const point = new THREE.Vector3(o.x + dirs[0][0] / len * t, o.y + dirs[0][1] / len * t, o.z + dirs[0][2] / len * t).applyMatrix4(matrixWorld);
    // Ein ungültiger Treffer ist ein Fehler (Worker oder Matrix), nie „keine Oberfläche“
    if (!Number.isFinite(point.x + point.y + point.z)) {
      const badMatrix = matrixWorld.elements.some((x) => !Number.isFinite(x));
      throw new Error(`Punktbestimmung ergab keinen endlichen Punkt (t=${t}${badMatrix ? ', Modellmatrix enthält NaN/∞' : ''})`);
    }
    return {
      point,
      spread: center && center.spread != null ? center.spread * scale : null,
      scatter: valid.length > 1 ? (ts[ts.length - 1] - ts[0]) * scale : 0,
      opacity: (center || valid[0]).opacity,
      conf: !center || center.conf === 'weak' ? 'weak' : 'ok',
    };
  }

  dispose() {
    this.disposed = true;
    const err = new Error('Messen abgebrochen (3D geschlossen oder Qualität gewechselt)');
    this.fail(err);
    // Wartet init() gerade auf die Antwort des Workers, muss `ready` verworfen werden –
    // sonst hängt jeder Aufrufer (und die Klick-Warteschlange der App) für immer.
    this._readyReject?.(err);
    this.worker?.terminate();
    this.worker = null;
    this.mesh = null;
  }
}

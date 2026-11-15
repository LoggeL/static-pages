import * as THREE from 'three';

// Hauptthread-Seite des Pickers: kopiert die Splat-Daten einmalig in einen
// Web Worker und beantwortet danach Klickstrahlen (siehe pick-worker.js).
export class Picker {
  constructor() {
    this.pending = new Map();
    this.nextId = 1;
    this.ready = false;
    this.failed = null;
    this.count = 0;
    this.tau = 0.35;        // Deckkraft-Schwelle der Oberfläche
    this.minOpacity = 0.15; // darunter: keine Oberfläche
    this._readyResolve = null;
    this._readyReject = null;
    this._inv = new THREE.Matrix4();
    this.worker = new Worker(new URL('./pick-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') {
        this.ready = true;
        this.count = m.n;
        this._readyResolve?.();
      } else if (m.type === 'hit') {
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); p(m.hits); }
      }
    };
    // Fällt der Worker aus, dürfen weder Ladebildschirm noch Klick-Warteschlange hängen bleiben.
    this.worker.onerror = this.worker.onmessageerror = (e) => {
      this.failed = new Error(`Mess-Worker ausgefallen${e?.message ? `: ${e.message}` : ''}`);
      this.ready = false;
      this._readyReject?.(this.failed);
      for (const p of this.pending.values()) p(null);
      this.pending.clear();
    };
  }

  // Splat-Parameter aus dem geladenen Mesh lesen. Liefert nebenbei robuste
  // Szenengrenzen (lokal), falls die Szenenbeschreibung keine Ansicht vorgibt.
  async init(mesh) {
    if (this.failed) throw this.failed;
    this.mesh = mesh;
    const n = mesh.extSplats ? mesh.extSplats.numSplats : mesh.packedSplats?.numSplats ?? mesh.numSplats;
    const C = new Float32Array(3 * n), S = new Float32Array(3 * n);
    const Q = new Float32Array(4 * n), A = new Float32Array(n), RMAX = new Float32Array(n);
    const step = Math.max(1, Math.floor(n / 20000));
    const sx = [], sy = [], sz = [];
    mesh.forEachSplat((i, c, s, q, opacity) => {
      if (i >= n) return;
      const i3 = 3 * i, i4 = 4 * i;
      C[i3] = c.x; C[i3 + 1] = c.y; C[i3 + 2] = c.z;
      S[i3] = s.x; S[i3 + 1] = s.y; S[i3 + 2] = s.z;
      Q[i4] = q.x; Q[i4 + 1] = q.y; Q[i4 + 2] = q.z; Q[i4 + 3] = q.w;
      A[i] = Number.isFinite(opacity) ? opacity : 0;
      RMAX[i] = Math.max(s.x, s.y, s.z);
      if (i % step === 0 && opacity > 0.3 && Number.isFinite(c.x + c.y + c.z)) { sx.push(c.x); sy.push(c.y); sz.push(c.z); }
    });
    const pct = (arr, p) => {
      if (!arr.length) return 0;
      const a = Float64Array.from(arr).sort();
      return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
    };
    this.localBounds = {
      min: [pct(sx, 0.03), pct(sy, 0.03), pct(sz, 0.03)],
      max: [pct(sx, 0.97), pct(sy, 0.97), pct(sz, 0.97)],
    };
    const done = new Promise((res, rej) => { this._readyResolve = res; this._readyReject = rej; });
    this.worker.postMessage({ type: 'init', C, S, Q, A, RMAX },
      [C.buffer, S.buffer, Q.buffer, A.buffer, RMAX.buffer]);
    await done;
    return n;
  }

  // rays: THREE.Ray[] in Weltkoordinaten, gemeinsamer Ursprung, rays[0] = Mitte.
  // Ergebnis: { point (Welt), spread, scatter (jeweils Weltmeter), opacity, conf } oder null.
  //   spread  = Tiefenunschärfe entlang des Strahls (Bewuchs, Lücken)
  //   scatter = Tiefenunterschied der Nachbarstrahlen (flacher Blickwinkel, Kanten)
  async pick(rays) {
    if (!this.ready || this.failed || !rays.length) return null;
    const mesh = this.mesh;
    mesh.updateMatrixWorld(true);
    this._inv.copy(mesh.matrixWorld).invert();
    const scale = mesh.getWorldScale(new THREE.Vector3()).x || 1;
    // Eigene Kopien: zwischen Anfrage und Antwort können weitere Picks starten.
    const o = rays[0].origin.clone().applyMatrix4(this._inv);
    const dirs = rays.map((r) => {
      const d = r.direction.clone().transformDirection(this._inv);
      return [d.x, d.y, d.z];
    });
    const matrixWorld = mesh.matrixWorld.clone();
    let minDot = 1;
    for (let i = 1; i < dirs.length; i++) {
      const dot = dirs[0][0] * dirs[i][0] + dirs[0][1] * dirs[i][1] + dirs[0][2] * dirs[i][2];
      if (dot < minDot) minDot = dot;
    }
    const tanTheta = minDot >= 1 ? 0 : Math.tan(Math.acos(Math.min(1, minDot))) * 1.05;
    const id = this.nextId++;
    const hits = await new Promise((res) => {
      this.pending.set(id, res);
      // Nahgrenze 5 cm in Weltmetern, umgerechnet in lokale Einheiten
      this.worker.postMessage({ type: 'pick', id, o: [o.x, o.y, o.z], dirs, tau: this.tau, amin: this.minOpacity, tanTheta, near: 0.05 / scale });
    });
    if (!hits) return null;
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
    const spread = center ? center.spread : null;
    const point = new THREE.Vector3(o.x + dirs[0][0] * t, o.y + dirs[0][1] * t, o.z + dirs[0][2] * t).applyMatrix4(matrixWorld);
    if (!Number.isFinite(point.x + point.y + point.z)) return null;
    return {
      point,
      spread: spread == null ? null : spread * scale,
      scatter: valid.length > 1 ? (ts[ts.length - 1] - ts[0]) * scale : 0,
      opacity: (center || valid[0]).opacity,
      conf: !center || center.conf === 'weak' ? 'weak' : 'ok',
    };
  }
}

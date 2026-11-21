// Leichte 2D-Karte: Orthofoto als <img>-Kacheln mit CSS-Transform, kein Canvas, kein WebGL.
// Kamera { cx, cz, mpp }: Kartenmitte in Weltmetern und Meter je CSS-Pixel.
// Bildschirm: sx = w/2 + (x - cx)/mpp, sy = h/2 + (z - cz)/mpp (z nach unten wie im Orthofoto).
// Gezeichnet wird nur bei Bedarf (rAF läuft nur während Geste, Trägheit, Animation oder dirty).
// Größe 0 (Tab/Fenster beim Laden ausgeblendet, #map display:none) ist ein normaler Zustand: Alles
// Layoutabhängige wartet auf die erste echte Größe (ResizeObserver), erst dann gilt der Startausschnitt.
// Während einer Geste bewegt nur der Compositor Kachel-, Overlay- und Label-Ebene (CSS-Transform auf
// eigenen Ebenen); das SVG wird erst nach der Geste neu aufgebaut, währenddessen höchstens gedrosselt.

const MAX_IMGS = 48;
const TAN30 = Math.tan(Math.PI / 6);
const PAD = { top: 64, bottom: 96, side: 12 };
// Neuaufbau während einer Geste: frühestens nach GESTURE_REBUILD_MS seit dem letzten Aufbau (nur wenn
// der CSS-Versatz die vorgezeichnete Fläche verlässt), und bei stillstehendem Finger nach
// HOLD_REBUILD_MS ohne Bewegung – mindestens 3 Bildabstände, sonst baut ein langsames Gerät
// (Software-Rendering) zwischen zwei Bewegungen jedes Mal neu auf.
// Beide Wartezeiten wachsen mit der Dauer der Bilder nach einem Aufbau (buildCost): Bei Software-
// Rendering kostet das Rastern des neuen Overlays 0,3–1 s, und in dieser Zeit kommen auch keine
// Bewegungsereignisse an. Feste Zeiten lösten dann Aufbau auf Aufbau aus (Stocken in Serie).
const GESTURE_REBUILD_MS = 400;
const BUILD_COST_FACTOR = 4;  // Neuaufbau in der Geste frühestens nach 4 × buildCost
const HOLD_COST_FACTOR = 2;   // stillstehender Finger: mindestens 2 × buildCost ohne Bewegung
const HOLD_REBUILD_MS = 250;

export class MapView2D {
  // ground: Promise des Bodenmodells (lädt parallel zur ersten Kachel). Fehler meldet die App.
  constructor({ host, tilesEl, cfg, base, ground, hooks, stats }) {
    this.kind = '2d';
    Object.assign(this, { host, tilesEl, cfg, base, hooks, stats });
    this.groundP = ground;
    this.ground = null;
    ground.then((g) => { this.ground = g; }, () => {}); // Ablehnung zeigt app.js als Vollbild-Fehler
    this.map = cfg.map;
    this.image = cfg.map.image;
    this.cam = { cx: 0, cz: 0, mpp: 0.05 };
    this.w = 0; this.h = 0;
    this.sized = false;       // gab es schon eine echte Größe (> 0)? vorher kein Ausschnitt, kein Aufbau
    this.zero = true;         // Host hat gerade Größe 0 (ausgeblendet): nichts zeichnen
    this.pendingFit = null;   // focusOn/home vor der ersten Größe: beim ersten Layout anwenden
    this.dirty = true;
    this.raf = 0;
    this.moved = false;       // hat der Nutzer den Ausschnitt verändert?
    this.gesture = false;
    this.built = null;        // Kamera beim letzten Overlay-Aufbau
    this.tiles = new Map();   // key → { el, level, ok, used }
    this.useGen = 0;
    this.listed = this.image.levels.map((L) => new Set(L.tiles.map(([x, y]) => `${x},${y}`)));
    this.coarse = this.image.levels.length - 1;
    this.coarseReady = false;
    this.pointers = new Map();
    this.lastTap = { t: 0, x: 0, y: 0 };
    this.tween = null;
    this.inertia = null;
    this.idleTimer = 0;
    this.lastMoveT = 0;
    this.frameDt = 16;        // geglätteter Bildabstand während Gesten (ms)
    this.lastFrameT = 0;
    this.lastBuildT = 0;
    this.buildCost = 50;      // Dauer der drei Bilder nach einem Aufbau während einer Bewegung (ms), steigt schnell, fällt langsam
    this.layerEls = [tilesEl, ...(hooks.gestureLayers?.() ?? [])];
    const self = this;
    this.proj = {
      w: 1, h: 1, near: 0, margin: 0, topDown: true,
      toClip(p, out) {
        const c = self.cam;
        out[0] = (p[0] - c.cx) / (c.mpp * this.w / 2);
        out[1] = -(p[2] - c.cz) / (c.mpp * this.h / 2);
        out[2] = 0; out[3] = 1;
        return out;
      },
      // gleichwertiger 3D-Kameraabstand (60° Bildwinkel): die Label-Schwellen (45–90 m) bleiben sinnvoll
      labelDist() { return (self.cam.mpp * this.h) / (2 * TAN30); },
    };
    this.sampler = {
      kind: 'ground',
      title: 'Geländeprofil (Bodenmodell, 0,5-m-Raster)',
      sampleMany: async (pts) => {
        const g = this.ground ?? await this.groundP;
        return pts.map(([x, z]) => { const r = g.sample(x, z); return r.error ? null : r; });
      },
    };
    this.frame = this.frame.bind(this);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.attach();
    this.resize(); // bei Größe 0: wartet auf den ResizeObserver
    this.ensureTile(this.coarse, 0, 0);
  }

  // ---------------------------------------------------------------- Schnittstelle
  pickReady() { return Promise.resolve(); }
  async pickAt(clientX, clientY) {
    const [x, z] = this.toWorld(clientX, clientY);
    const g = this.ground ?? await this.groundP;
    const r = g.sample(x, z);
    if (r.error) return { error: 'Hier gibt es keine Bodenhöhe – auf einen Planpunkt einrasten oder innerhalb der Karte messen.', hint: true };
    return { point: [x, r.y, z], src: r.q === 2 ? 'g' : 'e', q: r.q };
  }
  metersPerPixel() { return this.cam.mpp; }
  getViewState() { return { ...this.cam }; }
  setViewState(s) {
    this.cam = { ...s };
    if (this.sized) this.cam = this.clampCam(this.cam); // ohne Größe beim ersten Layout (resize)
    this.requestRender();
  }
  requestRender() { this.dirty = true; this.schedule(); }
  requestOverlay() { this.requestRender(); }
  setLayersChanged() { this.requestRender(); }
  screenRect() { return this.host.getBoundingClientRect(); }
  visibleRect() {
    const { cx, cz, mpp } = this.cam;
    return { mpp, x0: cx - (this.w / 2) * mpp, x1: cx + (this.w / 2) * mpp, z0: cz - (this.h / 2) * mpp, z1: cz + (this.h / 2) * mpp };
  }

  toWorld(clientX, clientY) {
    const r = this.host.getBoundingClientRect();
    const { cx, cz, mpp } = this.cam;
    return [cx + (clientX - r.left - this.w / 2) * mpp, cz + (clientY - r.top - this.h / 2) * mpp];
  }

  zoomLimits() {
    const [x0, x1, z0, z1] = this.map.extent;
    return [this.map.min_mpp, (Math.max(x1 - x0, z1 - z0) * 1.2) / Math.min(this.w, this.h)];
  }
  clampCam(c) {
    const [lo, hi] = this.zoomLimits();
    c.mpp = Math.min(hi, Math.max(lo, c.mpp));
    const [x0, x1, z0, z1] = this.map.extent;
    c.cx = Math.min(x1, Math.max(x0, c.cx));
    c.cz = Math.min(z1, Math.max(z0, c.cz));
    return c;
  }

  // Rechteck [x0,x1,z0,z1] in den freien Bereich zwischen Kopfzeile und Werkzeugleiste einpassen
  // (Ränder liefert die App aus dem Layout, z. B. Platz für die Hinweisleiste auf Handys)
  fitCam([x0, x1, z0, z1]) {
    if (!this.sized) throw new Error('fitCam vor der ersten Kartengröße (Aufrufer muss auf resize warten)');
    const pad = { ...PAD, ...this.hooks.fitPad?.() };
    const aw = Math.max(40, this.w - 2 * pad.side), ah = Math.max(40, this.h - pad.top - pad.bottom);
    const mpp = Math.max((x1 - x0) / aw, (z1 - z0) / ah);
    const syc = (pad.top + this.h - pad.bottom) / 2;
    return this.clampCam({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 - (syc - this.h / 2) * mpp, mpp });
  }
  animateTo(c, ms = 320) {
    this.inertia = null;
    this.tween = { t0: performance.now(), ms, a: { ...this.cam }, b: c };
    this.schedule();
  }
  home(animate = true) {
    if (!this.sized || this.zero) { this.moved = false; this.pendingFit = null; return; } // Startausschnitt folgt beim nächsten Layout
    const c = this.fitCam(this.map.start);
    if (animate) this.animateTo(c); else { this.cam = c; this.requestRender(); }
  }
  focusOn(points) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of points) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
    const r = Math.max(1.5, 0.3 * Math.max(x1 - x0, z1 - z0));
    this.moved = true;
    const rect = [x0 - r, x1 + r, z0 - r, z1 + r];
    if (!this.sized || this.zero) { this.pendingFit = rect; return; }
    this.animateTo(this.fitCam(rect));
  }
  panBy(fx, fy) {
    this.moved = true;
    this.animateTo(this.clampCam({ ...this.cam, cx: this.cam.cx + fx * this.w * this.cam.mpp, cz: this.cam.cz + fy * this.w * this.cam.mpp }), 200);
  }
  zoomBy(factor, sx = this.w / 2, sy = this.h / 2) {
    this.moved = true;
    const c = this.zoomedCam(this.cam, factor, sx, sy);
    this.animateTo(c, 200);
  }
  doubleAt(clientX, clientY) {
    const r = this.host.getBoundingClientRect();
    this.zoomBy(0.5, clientX - r.left, clientY - r.top);
  }
  // Zoom um den Bildschirmpunkt (sx, sy): der Weltpunkt darunter bleibt stehen
  zoomedCam(cam, factor, sx, sy) {
    const wx = cam.cx + (sx - this.w / 2) * cam.mpp, wz = cam.cz + (sy - this.h / 2) * cam.mpp;
    const [lo, hi] = this.zoomLimits();
    const mpp = Math.min(hi, Math.max(lo, cam.mpp * factor));
    return this.clampCam({ cx: wx - (sx - this.w / 2) * mpp, cz: wz - (sy - this.h / 2) * mpp, mpp });
  }

  resize() {
    // In 3D ist #map ausgeblendet (clientWidth 0): dann nichts messen und vor allem nicht
    // hooks.onResize aufrufen – das Overlay gehört in dieser Zeit der 3D-Ansicht.
    if (this.suspended) return;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) {
      // Ausgeblendet (Hintergrund-Tab beim Laden, eingeklapptes Fenster, display:none): Größe,
      // Ausschnitt und Overlay bleiben, bis wieder eine echte Größe kommt.
      if (!this.zero) { this.zero = true; cancelAnimationFrame(this.raf); this.raf = 0; this.endGestureLayers(); }
      return;
    }
    const wasZero = this.zero;
    this.zero = false;
    const same = w === this.w && h === this.h;
    if (same && !wasZero) return;
    this.sized = true;
    if (!same) {
      this.w = w; this.h = h;
      Object.assign(this.proj, { w, h, margin: 0.5 * Math.max(w, h) });
      this.hooks.onResize?.(w, h);
    }
    if (this.pendingFit) { this.cam = this.fitCam(this.pendingFit); this.pendingFit = null; }
    else if (!this.moved) this.cam = this.fitCam(this.map.start);
    else this.cam = this.clampCam(this.cam);
    this.built = null;
    this.tileKey = null;
    this.requestRender();
  }

  // ---------------------------------------------------------------- Zeichnen
  schedule() {
    if (!this.raf && !document.hidden && !this.suspended && !this.zero) this.raf = requestAnimationFrame(this.frame);
  }
  frame(now) {
    this.raf = 0;
    this.stats.frames2d++;
    if (this.gesture && this.lastFrameT) this.frameDt = 0.8 * this.frameDt + 0.2 * Math.min(1000, now - this.lastFrameT);
    this.lastFrameT = now;
    let active = false;
    if (this.tween) {
      const tw = this.tween;
      const u = Math.min(1, (now - tw.t0) / tw.ms);
      const s = u * u * (3 - 2 * u);
      this.cam = {
        cx: tw.a.cx + (tw.b.cx - tw.a.cx) * s, cz: tw.a.cz + (tw.b.cz - tw.a.cz) * s,
        mpp: Math.exp(Math.log(tw.a.mpp) + (Math.log(tw.b.mpp) - Math.log(tw.a.mpp)) * s),
      };
      if (u >= 1) this.tween = null; else active = true;
    }
    if (this.inertia) {
      const iv = this.inertia;
      const dt = Math.min(50, now - iv.t);
      iv.t = now;
      this.cam = this.clampCam({ ...this.cam, cx: this.cam.cx - iv.vx * dt * this.cam.mpp, cz: this.cam.cz - iv.vy * dt * this.cam.mpp });
      const decay = Math.exp(-dt / 180);
      iv.vx *= decay; iv.vy *= decay;
      if (Math.hypot(iv.vx, iv.vy) < 0.02) this.inertia = null; else active = true;
    }
    this.applyTiles();
    const moving = this.gesture || active;
    if (moving) this.startGestureLayers(); // auch Trägheit, Mausrad und Animationen (H, +/−, Pfeiltasten)
    const b = this.built;
    const changed = !b || b.cx !== this.cam.cx || b.cz !== this.cam.cz || b.mpp !== this.cam.mpp;
    // Während Geste/Trägheit/Animation nur den CSS-Versatz der fertigen Ebenen ändern (Compositor).
    // Neu aufgebaut wird erst danach; während der Geste nur, wenn der Versatz die vorgezeichnete Fläche
    // verlässt, und dann höchstens alle GESTURE_REBUILD_MS (Linien/Schrift sind dazwischen kurz
    // mitskaliert und werden beim Aufbau korrigiert).
    const throttled = now - this.lastBuildT < Math.max(GESTURE_REBUILD_MS, BUILD_COST_FACTOR * this.buildCost);
    if (moving && b && !this.forceBuild && (this.withinCssRange() || throttled)) {
      const s = b.mpp / this.cam.mpp;
      const tx = (this.w / 2) * (1 - s) + (b.cx - this.cam.cx) / this.cam.mpp;
      const ty = (this.h / 2) * (1 - s) + (b.cz - this.cam.cz) / this.cam.mpp;
      this.hooks.setOverlayTransform(`matrix(${s},0,0,${s},${tx},${ty})`);
      this.cssShifted = true;
      // Inhalt geändert (Messung, Ebene): nach der Drosselzeit neu aufbauen, nicht in jedem Bild
      if (this.dirty && !throttled) this.build(now);
      else if (this.dirty) active = true;
      else if (!this.withinCssRange()) active = true; // nach Ablauf der Drosselung aufbauen
    } else if (this.dirty || changed || this.forceBuild) {
      this.build(now);
    }
    if (active) this.schedule();
    else if (!this.gesture && this.cssShifted) { this.forceBuild = true; this.schedule(); }
    else if (!moving) this.endGestureLayers(); // fertig aufgebaut: Ebenen wieder freigeben
  }
  withinCssRange() {
    const b = this.built;
    const s = b.mpp / this.cam.mpp;
    if (s < 0.5 || s > 2) return false; // darüber hinaus wirken Linien und Schrift zu stark verzerrt
    return Math.abs(b.cx - this.cam.cx) / this.cam.mpp <= 0.4 * this.w && Math.abs(b.cz - this.cam.cz) / this.cam.mpp <= 0.4 * this.h;
  }
  build(now = performance.now()) {
    // Während einer Bewegung messen, wie lange die drei Bilder nach dem Aufbau dauern: Das Rastern des
    // neuen Overlays läuft nicht im Hauptthread und hält erst das zweite oder dritte Bild auf.
    if (this.gesture || this.inertia || this.tween) {
      let n = 0;
      const probe = (t) => {
        if (++n < 3) { requestAnimationFrame(probe); return; }
        this.buildCost = Math.max(Math.min(3000, t - now), 0.75 * this.buildCost);
      };
      requestAnimationFrame(probe);
    }
    this.dirty = false;
    this.forceBuild = false;
    this.lastBuildT = now;
    if (this.cssShifted) { this.hooks.setOverlayTransform(''); this.cssShifted = false; }
    this.built = { ...this.cam };
    this.hooks.onFrame();
    if (this.coarseReady && !this.stats.firstMap) {
      this.stats.firstMap = performance.now();
      this.hooks.onFirstMap();
      if (this.tilesPending) { this.tilesPending = false; this.updateTiles(); }
    }
  }

  // ---------------------------------------------------------------- Kacheln
  applyTiles() {
    const { cx, cz, mpp } = this.cam;
    const b = this.image.bounds;
    const s = this.image.res / mpp;
    this.tilesEl.style.transform = `matrix(${s},0,0,${s},${this.w / 2 + (b[0] - cx) / mpp},${this.h / 2 + (b[2] - cz) / mpp})`;
    const key = `${cx},${cz},${mpp},${this.w},${this.h}`;
    if (key !== this.tileKey) { this.tileKey = key; this.updateTiles(); }
  }
  targetLevel() {
    let dpr = Math.min(devicePixelRatio || 1, 2);
    if (navigator.connection?.saveData) dpr = 1;
    const lim = (1.25 * this.cam.mpp) / dpr;
    let best = 0;
    this.image.levels.forEach((L, i) => { if (this.image.res * L.f <= lim) best = i; });
    return best;
  }
  updateTiles() {
    const im = this.image;
    const li = this.targetLevel();
    const L = im.levels[li];
    const gen = ++this.useGen;
    const base = this.ensureTile(this.coarse, 0, 0);
    base.used = gen;
    // Feinere Kacheln erst nach dem ersten Kartenbild anfragen (build() holt das nach);
    // schlägt die gröbste Kachel fehl, gibt es kein erstes Kartenbild – dann sofort weiter.
    if (!this.stats.firstMap && !base.failed) {
      this.tilesPending = true;
      base.ready.then(() => { if (base.failed && this.tilesPending) { this.tilesPending = false; this.updateTiles(); } });
      return;
    }
    const need = [];
    if (li !== this.coarse) {
      const { x0, x1, z0, z1 } = this.visibleRect();
      const tw = im.res * L.f * im.tile; // Kachelbreite in m
      const b = im.bounds;
      const tx0 = Math.max(0, Math.floor((x0 - b[0]) / tw) - 1), tx1 = Math.floor((x1 - b[0]) / tw) + 1;
      const ty0 = Math.max(0, Math.floor((z0 - b[2]) / tw) - 1), ty1 = Math.floor((z1 - b[2]) / tw) + 1;
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (!this.listed[li].has(`${tx},${ty}`)) continue; // nicht gelistet: absichtlich leer, nie anfragen
          const t = this.ensureTile(li, tx, ty);
          t.used = gen;
          need.push(t);
        }
      }
    }
    // alte Kacheln anderer Stufen erst entfernen, wenn die neuen dekodiert sind
    Promise.all(need.map((t) => t.ready)).then(() => {
      if (gen !== this.useGen) return;
      for (const [k, t] of this.tiles) {
        if (t.level !== li && t.level !== this.coarse) { t.el.remove(); this.tiles.delete(k); }
      }
      this.evict();
    });
    this.evict();
  }
  evict() {
    if (this.tiles.size <= MAX_IMGS) return;
    const old = [...this.tiles.entries()].filter(([, t]) => t.level !== this.coarse && t.used !== this.useGen).sort((a, b) => a[1].used - b[1].used);
    for (const [k, t] of old) {
      if (this.tiles.size <= MAX_IMGS) break;
      t.el.remove(); this.tiles.delete(k);
    }
  }
  ensureTile(li, tx, ty) {
    const im = this.image;
    const L = im.levels[li];
    const key = `t${L.f}_${tx}_${ty}`;
    let t = this.tiles.get(key);
    if (t) return t;
    const f = L.f;
    const pw = Math.min(im.tile + im.overlap, L.size[0] - tx * im.tile);
    const ph = Math.min(im.tile + im.overlap, L.size[1] - ty * im.tile);
    const el = document.createElement('img');
    el.decoding = 'async';
    el.draggable = false;
    el.alt = '';
    el.className = 'tile';
    Object.assign(el.style, { left: `${tx * im.tile * f}px`, top: `${ty * im.tile * f}px`, width: `${pw * f}px`, height: `${ph * f}px`, zIndex: String(im.levels.length - li) });
    const url = `${this.base}scene/${im.dir}${key}.webp?v=${im.version}`;
    t = { el, level: li, used: this.useGen, ok: false };
    t.ready = new Promise((resolve) => {
      const failTile = (cause) => {
        if (t.failed) return;
        t.failed = true;
        console.error(`Kartenkachel ${key} konnte nicht geladen werden: ${url}`, cause);
        this.hooks.toast(`Kartenkachel ${key} konnte nicht geladen werden.`, 6000, true);
        // rot schraffierte Fläche statt Bild, kein Neuversuch, kein Ersatzbild
        const div = document.createElement('div');
        div.className = 'tile tile-error';
        div.style.cssText = el.style.cssText;
        el.replaceWith(div);
        t.el = div;
        resolve();
      };
      el.onerror = () => failTile(new Error('HTTP-Fehler oder ungültiges Bild'));
      el.src = url;
      el.decode().then(() => {
        t.ok = true;
        if (li === this.coarse && !this.coarseReady) { this.coarseReady = true; this.requestRender(); }
        resolve();
      }, (err) => failTile(err));
    });
    this.tilesEl.appendChild(el);
    this.tiles.set(key, t);
    return t;
  }

  // ---------------------------------------------------------------- Gesten
  attach() {
    this.ac = new AbortController();
    const o = { signal: this.ac.signal };
    const h = this.host;
    h.addEventListener('pointerdown', (e) => this.onDown(e), o);
    h.addEventListener('pointermove', (e) => this.onMove(e), o);
    h.addEventListener('pointerup', (e) => this.onUp(e, false), o);
    h.addEventListener('pointercancel', (e) => this.onUp(e, true), o);
    h.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !this.pointers.size) this.hooks.onLeave(); }, o);
    h.addEventListener('wheel', (e) => this.onWheel(e), { ...o, passive: false });
    h.addEventListener('contextmenu', (e) => e.preventDefault(), o);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; this.tween = null; this.inertia = null; }
      else this.requestRender();
    }, o);
  }
  // Kacheln, SVG-Overlay und Labels bekommen für die Dauer der Geste eigene Compositor-Ebenen:
  // Verschieben/Zoomen ist dann nur eine Transformation, kein Neuzeichnen des SVG je Bild.
  startGestureLayers() {
    if (this.layered) return;
    this.layered = true;
    for (const el of this.layerEls) el.style.willChange = 'transform';
  }
  endGestureLayers() {
    if (!this.layered) return;
    this.layered = false;
    for (const el of this.layerEls) el.style.willChange = '';
  }
  startGesture() {
    if (this.gesture) return;
    this.gesture = true;
    this.moved = true;
    this.tween = null;
    this.inertia = null;
    this.lastFrameT = 0;
    this.startGestureLayers();
  }
  endGesture() {
    this.gesture = false;
    this.forceBuild = true;
    this.schedule();
  }
  // Finger steht still: einmal scharf neu aufbauen. Die Wartezeit wächst mit dem Bildabstand, damit
  // ein langsames Gerät nicht zwischen zwei Bewegungsereignissen jedes Mal neu aufbaut.
  idleRebuild() {
    clearTimeout(this.idleTimer);
    this.lastMoveT = performance.now();
    const hold = () => Math.max(HOLD_REBUILD_MS, 3 * this.frameDt, HOLD_COST_FACTOR * this.buildCost);
    const wait = hold();
    const check = () => {
      const quiet = performance.now() - this.lastMoveT;
      const need = hold();
      if (quiet < need) { this.idleTimer = setTimeout(check, need - quiet); return; }
      if (this.gesture) { this.forceBuild = true; this.schedule(); }
    };
    this.idleTimer = setTimeout(check, wait);
  }
  onDown(e) {
    this.host.setPointerCapture?.(e.pointerId);
    const now = performance.now();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: now, button: e.button, type: e.pointerType, moved: 0 });
    this.tween = null; this.inertia = null;
    if (this.pointers.size === 2) {
      this.multi = true;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, cam: { ...this.cam } };
    }
    this.vel = [];
  }
  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && !e.buttons) this.hooks.onHover(e.clientX, e.clientY, e.altKey);
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.x0, e.clientY - p.y0));
    const thr = p.type === 'mouse' ? 3 : 6;
    if (!this.gesture && p.moved < thr && this.pointers.size === 1) return;
    this.startGesture();
    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const r = this.host.getBoundingClientRect();
      const pc = this.pinch;
      // Weltpunkt unter dem Anfangsmittelpunkt folgt dem aktuellen Mittelpunkt
      const wx = pc.cam.cx + (pc.cx - r.left - this.w / 2) * pc.cam.mpp, wz = pc.cam.cz + (pc.cy - r.top - this.h / 2) * pc.cam.mpp;
      const [lo, hi] = this.zoomLimits();
      const mpp = Math.min(hi, Math.max(lo, pc.cam.mpp * (pc.d / Math.max(1, d))));
      this.cam = this.clampCam({ cx: wx - (mx - r.left - this.w / 2) * mpp, cz: wz - (my - r.top - this.h / 2) * mpp, mpp });
    } else if (this.pointers.size === 1 && !this.multi) {
      this.cam = this.clampCam({ ...this.cam, cx: this.cam.cx - dx * this.cam.mpp, cz: this.cam.cz - dy * this.cam.mpp });
      const now = performance.now();
      this.vel.push([now, dx, dy]);
      while (this.vel.length && now - this.vel[0][0] > 80) this.vel.shift();
    }
    this.idleRebuild();
    this.schedule();
  }
  onUp(e, cancelled) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p) return;
    const multi = this.multi;
    if (this.pointers.size === 0) this.multi = false;
    if (this.pointers.size < 2) this.pinch = null;
    if (this.gesture && this.pointers.size === 0) {
      // Trägheit nach schnellem Wischen
      const now = performance.now();
      const v = this.vel.filter((s) => now - s[0] < 80);
      if (!multi && !cancelled && v.length >= 2) {
        const dt = Math.max(16, now - v[0][0]);
        const vx = v.reduce((s, x) => s + x[1], 0) / dt, vy = v.reduce((s, x) => s + x[2], 0) / dt;
        if (Math.hypot(vx, vy) > 0.3) this.inertia = { vx, vy, t: now };
      }
      this.endGesture();
      return;
    }
    if (this.gesture || cancelled || multi || p.button !== 0) return;
    const now = performance.now();
    const touch = p.type !== 'mouse';
    // Finger zittern stärker und tippen langsamer als eine Maus
    if (p.moved > (touch ? 12 : 6) || now - p.t > (touch ? 1500 : 700)) return;
    const dbl = now - this.lastTap.t < 400 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < (touch ? 30 : 8);
    this.lastTap = { t: dbl ? 0 : now, x: e.clientX, y: e.clientY };
    if (dbl) { this.hooks.onDouble(e.clientX, e.clientY); return; }
    this.hooks.onTap(e.clientX, e.clientY, touch, e.altKey);
  }
  onWheel(e) {
    e.preventDefault();
    let k = e.ctrlKey ? 0.01 : 0.0015;
    if (e.deltaMode === 1) k *= 16; else if (e.deltaMode === 2) k *= this.h;
    const r = this.host.getBoundingClientRect();
    this.moved = true;
    this.tween = null; this.inertia = null;
    this.cam = this.zoomedCam(this.cam, Math.exp(e.deltaY * k), e.clientX - r.left, e.clientY - r.top);
    this.wheeling = true;
    this.gesture = true;
    clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => { this.wheeling = false; if (!this.pointers.size) this.endGesture(); }, 150);
    this.schedule();
  }

  // ---------------------------------------------------------------- Lebenszyklus
  // In 3D: alle Kacheln außer der gröbsten entladen, Listener abhängen
  suspend() {
    this.suspended = true;
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.ac.abort();
    this.pointers.clear(); this.gesture = false; this.tween = null; this.inertia = null;
    for (const [k, t] of this.tiles) if (t.level !== this.coarse) { t.el.remove(); this.tiles.delete(k); }
    this.tileKey = null;
    this.ro.disconnect();
    this.host.hidden = true;
  }
  resume() {
    this.suspended = false;
    this.host.hidden = false;
    this.ro.observe(this.host);
    this.attach();
    this.w = 0; this.resize();
    this.built = null;
    this.requestRender();
  }
  dispose() {
    this.suspend();
    this.ro.disconnect();
    for (const t of this.tiles.values()) t.el.remove();
    this.tiles.clear();
  }
}

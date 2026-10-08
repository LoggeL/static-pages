/*!
 * Lumen FX · Effekt-Modul der „Lumen Edition"
 * Vanilla JS, keine Abhängigkeiten. Initialisiert sich selbst.
 *
 *   canvas.threads[data-mode="hero"]     Lichtfäden, gekoppelt an --p des nächsten [data-scroll]
 *   canvas.threads[data-mode="ambient"]  ruhige Ellipsen-Orbits aus Lichtlinien
 *   [data-decode]                        KI-Decode der Textknoten (ohne .cap), einmalig
 *   .motes                               feiner Goldstaub, ein Canvas pro Container
 *
 * Optionale Attribute:
 *   data-tone="light|dark"   (an Canvas, .motes oder einem Vorfahren) erzwingt die Mischart.
 *                            Ohne Angabe wird die Helligkeit des Hintergrundbildes der Stage
 *                            gemessen (bzw. die Hintergrundfarbe der Vorfahren).
 *   data-count="44"          Anzahl Fäden / Partikel überschreiben.
 *
 * API: window.LumenFX = { config, refresh(), decode(el), pause(), resume(), version }
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.LumenFX && window.LumenFX.version) return;

  /* ------------------------------------------------------------------ *
   *  Feintuning
   * ------------------------------------------------------------------ */
  var CFG = {
    DPR_MAX: 1.5,

    hero: {
      COUNT_MIN: 30,          // Fäden auf schmalen Viewports
      COUNT_MAX: 54,          // Fäden ab ~1500px Breite
      SEGMENTS: 96,           // Stützpunkte pro Faden
      LINE_MIN: 0.45,         // Linienstärke (CSS px)
      LINE_MAX: 1.15,
      ALPHA_IDLE: 0.30,       // Gesamtdeckkraft bei p = 0 („kaum sichtbar")
      INTRO_MS: 3200,         // Einzeichnen nach dem Laden
      INTRO_REVEAL: 0.46,     // so weit (0..1 der Breite) zeichnen sie sich ohne Scroll ein
      REVEAL_FULL_P: 0.40,    // ab diesem p sind die Fäden vollständig gezeichnet
      REVEAL_STAGGER: 0.22,   // Versatz zwischen den Fäden beim Einzeichnen
      BUNDLE_START: 0.06,     // ab hier bündeln sie sich …
      BUNDLE_END: 0.62,       // … bis hier zum Strom
      FADE_START: 0.78,       // Ausblenden
      FADE_END: 0.93,
      SPREAD_LOOSE: 0.34,     // halbe Fächerhöhe (Anteil der Höhe) im losen Zustand
      SPREAD_TIGHT: 0.026,    // halbe Strombreite an der Taille
      SPREAD_FAN: 0.10,       // Auffächern an den Enden im gebündelten Zustand
      STRAY_SHARE: 0.14,      // Anteil „loser Strähnen“, die sich nur halb in den Strom fügen
      WAIST_U: 0.58,          // x-Position der Taille (0..1)
      CENTER_LOOSE: 0.46,     // Mittellinie lose (Anteil der Höhe)
      CENTER_L: 0.30,         // Mittellinie gebündelt, links (Haarhöhe der Figur)
      CENTER_R: 0.56,         // … rechts
      RIBBON: 0.028,          // gemeinsame Bandwelle
      WAVE_LOOSE: 0.055,      // Eigenwelle je Faden, lose
      WAVE_TIGHT: 0.012,      // … gebündelt
      FLOW_SPEED: 0.20,       // Fließgeschwindigkeit
      P_EASE: 6,              // Glättung des Scroll-Fortschritts (1/s)
      MOUSE_RX: 190,          // Einflussradius horizontal (px)
      MOUSE_RY: 110,          // … vertikal
      MOUSE_PUSH: 30,         // max. Ausweichen (px)
      MOUSE_EASE: 5,          // Nachziehen des Cursors (1/s)
      GLINTS: 7,              // gleichzeitige Glanzpunkte
      GLINT_MIN_S: 4.5,       // Laufzeit eines Glanzpunkts
      GLINT_MAX_S: 8.5,
      PEARL_SHARE: 0.2,       // Anteil Perlmutt-Fäden
      SHADOW: 0.26            // Schattenstärke auf hellem Grund (0 = aus)
    },

    ambient: {
      ORBITS: 7,
      CX: 0.80,               // Zentrum (Anteil Breite/Höhe)
      CY: 0.22,
      RADIUS: 0.36,           // Basisradius (Anteil von min(W,H)·…)
      SPIN: 0.022,            // Rotationsgeschwindigkeit der Ellipsen (rad/s)
      COMET: 0.16,            // Umlaufgeschwindigkeit der Lichtköpfe (rad/s)
      LINE_ALPHA: 0.16,
      HALO: 0.07
    },

    motes: {
      MIN: 40,
      MAX: 70,
      AREA_PER: 16000,        // px² pro Partikel
      RISE: [2.5, 9],         // Steiggeschwindigkeit (px/s)
      DRIFT: 5,               // seitliches Treiben (px/s)
      SIZE: [0.7, 1.3],       // Radius (CSS px) → 1–2 px Kern
      BOKEH_SHARE: 0.12,      // Anteil unscharfer Vordergrund-Partikel (Tiefe)
      BOKEH_SIZE: [5, 11],    // deren Durchmesser (px)
      TWINKLE: [0.25, 1.1],   // Hz
      BEAM: true,             // Lichtkegel moduliert die Sichtbarkeit (Staub im Sonnenstrahl)
      PEARL_SHARE: 0.07
    },

    decode: {
      MIN_S: 0.9,
      MAX_S: 1.4,
      PER_CHAR_S: 0.055,
      HOT_S: 0.24,            // so lange flackert ein Zeichen vor dem Auflösen
      FLICKER_S: 0.055,
      GLYPHS: '▪▫·–/\\|01ABCDEF',
      THRESHOLD: 0.25,
      ROOT_MARGIN: '0px 0px -8% 0px'
    }
  };

  /* ------------------------------------------------------------------ *
   *  Helfer
   * ------------------------------------------------------------------ */
  var TAU = Math.PI * 2;
  var GOLD = [201, 164, 106], CHAMP = [232, 213, 176], BRONZE = [150, 112, 60],
      PEARL1 = [215, 224, 226], PEARL2 = [234, 215, 221], IVORY = [243, 240, 234];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }
  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + clamp(a, 0, 1).toFixed(3) + ')'; }
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function intAttr(el, name) { var v = parseInt(el.getAttribute(name), 10); return isFinite(v) && v > 0 ? v : 0; }

  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduced = !!(mq && mq.matches);
  var hasIO = 'IntersectionObserver' in window;
  var hasRO = 'ResizeObserver' in window;

  function getDpr() { return Math.min(window.devicePixelRatio || 1, CFG.DPR_MAX); }

  function readP(el) {
    if (!el) return 0;
    var v = parseFloat(getComputedStyle(el).getPropertyValue('--p'));
    return isFinite(v) ? clamp(v, 0, 1) : 0;
  }

  /* Helligkeit des Untergrunds bestimmen: data-tone > Stage-Bild > Hintergrundfarbe. */
  var lumCanvas = null;
  function imageLuminance(img) {
    try {
      if (!img || !img.complete || !img.naturalWidth) return -1;
      if (!lumCanvas) { lumCanvas = document.createElement('canvas'); lumCanvas.width = 24; lumCanvas.height = 16; }
      var c = lumCanvas.getContext('2d', { willReadFrequently: true });
      c.clearRect(0, 0, 24, 16);
      c.drawImage(img, 0, 0, 24, 16);
      var d = c.getImageData(0, 0, 24, 16).data, sum = 0;
      for (var i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      return sum / (d.length / 4);
    } catch (e) { return -1; }
  }
  function colorLuminance(str) {
    var m = /rgba?\(([^)]+)\)/.exec(str || '');
    if (!m) return -1;
    var p = m[1].split(/[ ,\/]+/).map(parseFloat);
    if (p.length > 3 && p[3] < 0.5) return -1;
    return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
  }
  function findStageImage(el) {
    var n = el.parentElement, depth = 0;
    while (n && depth < 3) {
      var img = n.querySelector('img');
      if (img) return img;
      n = n.parentElement; depth++;
    }
    return null;
  }
  /* callback(isDark) – sofort und ggf. erneut, wenn das Bild nachlädt */
  function detectTone(el, cb, noImage) {
    var forced = el.closest ? el.closest('[data-tone]') : null;
    if (forced) { cb(forced.getAttribute('data-tone') === 'dark'); return; }
    var img = noImage ? null : findStageImage(el);
    if (img) {
      var L = imageLuminance(img);
      if (L >= 0) { cb(L < 0.42); return; }
      cb(false); // bis das Bild da ist: heller Grund ist der vorsichtigere Fall
      img.addEventListener('load', function () { var l = imageLuminance(img); if (l >= 0) cb(l < 0.42); }, { once: true });
      return;
    }
    var n = el;
    while (n && n.nodeType === 1) {
      var l2 = colorLuminance(getComputedStyle(n).backgroundColor);
      if (l2 >= 0) { cb(l2 < 0.42); return; }
      n = n.parentElement;
    }
    cb(false);
  }

  /* Glow-Sprite (für Glanzpunkte, Orbits, Staub) */
  function makeSprite(core, glow, dark) {
    var s = document.createElement('canvas'), N = 64;
    s.width = s.height = N;
    var c = s.getContext('2d'), g = c.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    if (dark) {
      g.addColorStop(0, rgba(core, 1));
      g.addColorStop(0.12, rgba(core, 0.92));
      g.addColorStop(0.2, rgba(glow, 0.5));
      g.addColorStop(0.45, rgba(glow, 0.12));
      g.addColorStop(1, rgba(glow, 0));
    } else {
      // heller Grund: heller Kern mit hauchfeinem Bronze-Rand – liest sich auf hellem wie mittlerem Grund
      g.addColorStop(0, rgba(core, 1));
      g.addColorStop(0.09, rgba(core, 0.95));
      g.addColorStop(0.14, rgba(glow, 0.5));
      g.addColorStop(0.24, rgba(glow, 0.14));
      g.addColorStop(0.5, rgba(glow, 0.02));
      g.addColorStop(1, rgba(glow, 0));
    }
    c.fillStyle = g;
    c.fillRect(0, 0, N, N);
    return s;
  }
  function makeDisc(col) {
    var s = document.createElement('canvas'), N = 64;
    s.width = s.height = N;
    var c = s.getContext('2d'), g = c.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    g.addColorStop(0, rgba(col, 0.75));
    g.addColorStop(0.6, rgba(col, 0.6));
    g.addColorStop(0.85, rgba(col, 0.25));
    g.addColorStop(1, rgba(col, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, N, N);
    return s;
  }
  var SPRITES = null;
  function sprites() {
    if (!SPRITES) {
      SPRITES = {
        goldDark: makeSprite([255, 244, 222], GOLD, true),
        pearlDark: makeSprite([250, 252, 252], PEARL1, true),
        goldLight: makeSprite([255, 238, 200], [150, 108, 50], false),
        pearlLight: makeSprite([246, 248, 248], [110, 104, 100], false),
        glint: makeSprite([255, 252, 244], CHAMP, true),
        bokehDark: makeDisc(CHAMP),
        bokehLight: makeDisc([170, 132, 74])
      };
    }
    return SPRITES;
  }

  /* ------------------------------------------------------------------ *
   *  Gemeinsamer Loop, Sichtbarkeit, Resize, Maus
   * ------------------------------------------------------------------ */
  var actors = [];
  var rafId = 0, lastTs = 0, paused = false;
  var pointer = { x: -1e5, y: -1e5, active: false };

  function tick(ts) {
    rafId = 0;
    if (paused) return;
    var t = ts / 1000;
    var dt = lastTs ? clamp(t - lastTs, 0, 0.05) : 0.016;
    lastTs = t;
    var running = false;
    for (var i = 0; i < actors.length; i++) {
      var a = actors[i];
      if (a.dead) continue;
      if (a.visible && a.animated && a.ready()) {
        try { a.frame(t, dt); } catch (e) { a.dead = true; if (window.console) console.warn('[LumenFX]', e); }
        running = true;
      }
    }
    if (actors.some(function (a) { return a.dead; })) actors = actors.filter(function (a) { return !a.dead; });
    if (running) rafId = requestAnimationFrame(tick);
    else lastTs = 0;
  }
  function wake() {
    if (!rafId && !paused) rafId = requestAnimationFrame(tick);
  }

  var visIO = hasIO ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var a = e.target.__lfx;
      if (!a) return;
      a.visible = e.isIntersecting;
      if (a.visible) { if (!a.animated) a.renderStatic(); else wake(); }
    });
  }, { rootMargin: '120px 0px' }) : null;

  var ro = hasRO ? new ResizeObserver(function (entries) {
    entries.forEach(function (e) { var a = e.target.__lfx; if (a) a.resize(); });
  }) : null;
  window.addEventListener('resize', function () {
    if (ro) return;
    actors.forEach(function (a) { if (a.resize) a.resize(); });
  }, { passive: true });

  window.addEventListener('pointermove', function (e) {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
  }, { passive: true });
  document.addEventListener('pointerleave', function () { pointer.active = false; });
  window.addEventListener('blur', function () { pointer.active = false; });

  /* statische Varianten (reduced motion): Hero folgt dem Scroll ohne Zeitanimation */
  var staticScrollQueued = false;
  window.addEventListener('scroll', function () {
    if (!reduced || staticScrollQueued) return;
    staticScrollQueued = true;
    requestAnimationFrame(function () {
      staticScrollQueued = false;
      actors.forEach(function (a) { if (a.kind === 'hero' && a.visible) a.renderStatic(); });
    });
  }, { passive: true });

  function register(a, observeEl) {
    observeEl.__lfx = a;
    actors.push(a);
    a.animated = !reduced;
    a.visible = !visIO;
    if (visIO) visIO.observe(observeEl);
    if (ro) ro.observe(observeEl);
    a.resize();
    if (!visIO) wake();
  }

  /* Canvas-Grundgerüst */
  function CanvasActor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = 0; this.H = 0; this.dpr = 1;
    this.visible = false; this.animated = true; this.dead = false;
  }
  CanvasActor.prototype.ready = function () { return this.W > 2 && this.H > 2 && !!this.ctx; };
  CanvasActor.prototype.fit = function () {
    var r = this.c.getBoundingClientRect();
    var W = Math.round(r.width), H = Math.round(r.height), dpr = getDpr();
    if (W === this.W && H === this.H && dpr === this.dpr) return false;
    this.W = W; this.H = H; this.dpr = dpr;
    this.c.width = Math.max(1, Math.round(W * dpr));
    this.c.height = Math.max(1, Math.round(H * dpr));
    return true;
  };
  CanvasActor.prototype.resize = function () {
    if (this.fit()) this.rebuild();
    if (!this.animated && this.visible) this.renderStatic();
    else if (this.visible) wake();
  };
  CanvasActor.prototype.rebuild = function () {};
  CanvasActor.prototype.renderStatic = function () {};
  CanvasActor.prototype.begin = function () {
    var ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.W, this.H);
    return ctx;
  };

  /* ------------------------------------------------------------------ *
   *  1 · Hero-Lichtfäden
   * ------------------------------------------------------------------ */
  function Hero(canvas) {
    CanvasActor.call(this, canvas);
    var self = this;
    this.kind = 'hero';
    this.scrollEl = canvas.closest ? canvas.closest('[data-scroll]') : null;
    this.p = readP(this.scrollEl);
    this.dark = false;
    this.flow = 0; this.tStart = -1;
    this.mx = -1e5; this.my = -1e5; this.mInf = 0;
    this.threads = []; this.glints = [];
    this.rand = rng(0x51A7E);
    detectTone(canvas, function (d) { self.dark = d; if (!self.animated && self.visible) self.renderStatic(); });
  }
  Hero.prototype = Object.create(CanvasActor.prototype);

  Hero.prototype.rebuild = function () {
    var C = CFG.hero;
    var n = intAttr(this.c, 'data-count') ||
      Math.round(clamp(lerp(C.COUNT_MIN, C.COUNT_MAX, (this.W - 480) / 1020), C.COUNT_MIN, C.COUNT_MAX));
    if (this.threads.length === n) return;
    var r = rng(7331), S = C.SEGMENTS, th = [];
    for (var i = 0; i < n; i++) {
      var o = ((i + 0.5) / n) * 2 - 1 + (r() - 0.5) * (1.8 / n);
      th.push({
        o: o,
        k1: 0.45 + r() * 0.55, k2: 1.2 + r() * 1.1,
        s1: 0.7 + r() * 0.6, s2: 0.4 + r() * 0.6,
        ph1: r() * TAU, ph2: r() * TAU, tw: r() * TAU,
        amp: 0.45 + r() * 0.8,
        free: r() < C.STRAY_SHARE ? 0.5 + r() * 0.2 : 1,
        w: lerp(C.LINE_MIN, C.LINE_MAX, Math.pow(r(), 1.8)),
        a: 0.3 + 0.7 * Math.pow(r(), 0.7),
        pearl: r() < C.PEARL_SHARE,
        pearl2: r() < 0.5,
        d: r() * C.REVEAL_STAGGER,
        rev: 0,
        y: new Float32Array(S + 1)
      });
    }
    this.threads = th;
    this.glints = [];
    for (var g = 0; g < C.GLINTS; g++) this.glints.push(this.newGlint(true));
  };

  Hero.prototype.newGlint = function (scatter) {
    var C = CFG.hero, r = this.rand;
    return {
      i: Math.floor(r() * this.threads.length),
      u: scatter ? r() : 0,
      dur: lerp(C.GLINT_MIN_S, C.GLINT_MAX_S, r()),
      wait: scatter ? 0 : r() * 2.5
    };
  };

  Hero.prototype.frame = function (t, dt) {
    var C = CFG.hero;
    if (this.tStart < 0) this.tStart = t;
    var pT = readP(this.scrollEl);
    this.p += (pT - this.p) * (1 - Math.exp(-dt * C.P_EASE));
    if (Math.abs(pT - this.p) < 1e-4) this.p = pT;
    this.flow += dt;

    // Maus (relativ zum Canvas, sanft nachgezogen)
    var rect = this.c.getBoundingClientRect();
    var inside = pointer.active && pointer.x >= rect.left && pointer.x <= rect.right &&
                 pointer.y >= rect.top && pointer.y <= rect.bottom;
    var k = 1 - Math.exp(-dt * C.MOUSE_EASE);
    if (inside) {
      var tx = pointer.x - rect.left, ty = pointer.y - rect.top;
      if (this.mInf < 0.01) { this.mx = tx; this.my = ty; }
      this.mx += (tx - this.mx) * k; this.my += (ty - this.my) * k;
    }
    this.mInf += ((inside ? 1 : 0) - this.mInf) * k * 0.6;

    for (var g = 0; g < this.glints.length; g++) {
      var gl = this.glints[g];
      if (gl.wait > 0) { gl.wait -= dt; continue; }
      gl.u += dt / gl.dur;
      if (gl.u >= 1) this.glints[g] = this.newGlint(false);
    }

    var intro = easeOut(clamp((t - this.tStart) * 1000 / C.INTRO_MS, 0, 1));
    this.render(intro, true);
  };

  Hero.prototype.renderStatic = function () {
    if (!this.ready()) return;
    if (!this.threads.length) this.rebuild();
    this.p = readP(this.scrollEl);
    this.mInf = 0;
    this.render(1, false);
  };

  Hero.prototype.compute = function (bundle) {
    var C = CFG.hero, S = C.SEGMENTS, W = this.W, H = this.H;
    var t = this.flow * C.FLOW_SPEED, mInf = this.mInf, mx = this.mx, my = this.my;
    var RX2 = 2 * C.MOUSE_RX * C.MOUSE_RX, RY2 = 2 * C.MOUSE_RY * C.MOUSE_RY;
    // Hochformat: Amplituden an der Breite statt an der Höhe bemessen, sonst wird der Strom zu steil
    var A = Math.min(H, W * 0.75);
    var waveA = A * lerp(C.WAVE_LOOSE, C.WAVE_TIGHT, bundle);
    // pro Stützstelle gemeinsame Werte vorberechnen
    if (!this._yc || this._yc.length !== S + 1) {
      this._yc = new Float32Array(S + 1); this._lo = new Float32Array(S + 1); this._ti = new Float32Array(S + 1);
      this._cl = new Float32Array(S + 1); this._cb = new Float32Array(S + 1);
    }
    var ycs = this._yc, los = this._lo, tis = this._ti, cls = this._cl, cbs = this._cb;
    for (var s = 0; s <= S; s++) {
      var u = s / S;
      var loose = H * C.SPREAD_LOOSE * (0.8 + 0.2 * Math.sin(u * Math.PI));
      var du = u - C.WAIST_U;
      var prof = Math.pow(Math.abs(du) / (du < 0 ? C.WAIST_U : 1 - C.WAIST_U), 1.5) * (du < 0 ? 1 : 0.7);
      var tight = A * (C.SPREAD_TIGHT + C.SPREAD_FAN * prof);
      los[s] = loose; tis[s] = tight;
      // gebündelt: sanfte S-Kurve von der Haarhöhe nach rechts unten
      var sCurve = u * u * (3 - 2 * u);
      cls[s] = H * C.CENTER_LOOSE;
      cbs[s] = H * lerp(C.CENTER_L, C.CENTER_R, sCurve);
      ycs[s] = A * C.RIBBON * Math.sin(u * TAU * 0.7 - t * 0.8 + 0.4);
    }
    for (var i = 0; i < this.threads.length; i++) {
      var th = this.threads[i], Y = th.y, b = bundle * th.free;
      for (s = 0; s <= S; s++) {
        u = s / S;
        var twist = 0.74 + 0.26 * Math.cos(u * TAU * 0.85 - t * 0.55 + th.tw);
        var wave = waveA * th.amp * (0.65 * Math.sin(u * TAU * th.k1 - t * th.s1 * 2 + th.ph1) +
                                     0.35 * Math.sin(u * TAU * th.k2 + t * th.s2 + th.ph2));
        var y = lerp(cls[s], cbs[s], b) + ycs[s] + th.o * lerp(los[s], tis[s], b) * twist + wave;
        if (mInf > 0.002) {
          var dx = u * W - mx, dy = y - my;
          var f = Math.exp(-dx * dx / RX2 - dy * dy / RY2);
          y += dy / (Math.abs(dy) + 22) * C.MOUSE_PUSH * f * mInf;
        }
        Y[s] = y;
      }
    }
  };

  Hero.prototype.threadColor = function (th, u) {
    if (this.dark) {
      return th.pearl ? mix(CHAMP, th.pearl2 ? PEARL2 : PEARL1, smooth(0.1, 0.9, u)) : mix(GOLD, CHAMP, u * 0.85);
    }
    // heller Grund: tieferes Gold, Perlmutt nur als kühlerer Champagnerton
    return th.pearl ? mix(GOLD, mix(PEARL1, [150, 160, 168], 0.5), smooth(0.2, 1, u) * 0.7)
                    : mix(BRONZE, GOLD, smooth(0, 0.9, u));
  };

  /* linearer Gradient entlang x: Einblenden links, Spitze rechts */
  Hero.prototype.grad = function (ctx, th, rev, alpha, colorFn) {
    var W = this.W, g = ctx.createLinearGradient(0, 0, W, 0);
    var tip = Math.min(0.09, rev * 0.5), head = Math.min(0.06, rev * 0.3);
    var pts = [0, head], q;
    for (q = 0.2; q < rev - tip; q += 0.2) if (q > head) pts.push(q);
    pts.push(Math.max(rev - tip, head));
    for (var i = 0; i < pts.length; i++) {
      var u = pts[i];
      var a = i === 0 ? 0 : alpha;
      g.addColorStop(clamp(u, 0, 1), rgba(colorFn(th, u), a));
    }
    g.addColorStop(clamp(rev, 0, 1), rgba(colorFn(th, rev), 0));
    return g;
  };

  function tracePath(ctx, Y, S, W, sEnd, oy) {
    var last = Math.floor(sEnd), fr = sEnd - last;
    ctx.beginPath();
    ctx.moveTo(0, Y[0] + oy);
    // Mittelpunkt-Quadratik für weiche Kurven
    for (var s = 1; s < last; s++) {
      var x0 = (s / S) * W, x1 = ((s + 1) / S) * W;
      ctx.quadraticCurveTo(x0, Y[s] + oy, (x0 + x1) / 2, (Y[s] + Y[s + 1]) / 2 + oy);
    }
    if (last >= 1) ctx.lineTo((last / S) * W, Y[last] + oy);
    if (fr > 0 && last < S) ctx.lineTo(((last + fr) / S) * W, lerp(Y[last], Y[last + 1], fr) + oy);
  }

  Hero.prototype.render = function (intro, animated) {
    var C = CFG.hero, ctx = this.begin(), W = this.W, H = this.H, S = C.SEGMENTS, p = this.p;
    if (!this.threads.length) return;
    var bundle = smooth(C.BUNDLE_START, C.BUNDLE_END, p);
    var vis = lerp(C.ALPHA_IDLE, 1, smooth(0.02, 0.34, p)) * (1 - smooth(C.FADE_START, C.FADE_END, p)) *
              (0.35 + 0.65 * intro);
    if (vis < 0.004) return;
    var R = animated ? Math.max(intro * C.INTRO_REVEAL, smooth(0, C.REVEAL_FULL_P, p)) : 1;
    var dark = this.dark;
    this.compute(bundle);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var self = this, colorFn = function (th, u) { return self.threadColor(th, u); };
    var shadowFn = function () { return [40, 28, 14]; };

    // Pass 1: hauchfeiner Schatten (nur heller Grund)
    if (!dark && C.SHADOW > 0) {
      ctx.globalCompositeOperation = 'multiply';
      for (var i = 0; i < this.threads.length; i++) {
        var th = this.threads[i];
        th.rev = clamp(R * (1 + C.REVEAL_STAGGER) - th.d, 0, 1);
        if (th.rev < 0.004) continue;
        tracePath(ctx, th.y, S, W, th.rev * S, 1.4);
        ctx.lineWidth = th.w + 1.6;
        ctx.strokeStyle = this.grad(ctx, th, th.rev, C.SHADOW * vis * th.a * 0.55, shadowFn);
        ctx.stroke();
      }
    }

    // Pass 2: Fäden
    ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    for (i = 0; i < this.threads.length; i++) {
      th = this.threads[i];
      th.rev = clamp(R * (1 + C.REVEAL_STAGGER) - th.d, 0, 1);
      if (th.rev < 0.004) continue;
      tracePath(ctx, th.y, S, W, th.rev * S, 0);
      ctx.lineWidth = th.w;
      ctx.strokeStyle = this.grad(ctx, th, th.rev, vis * th.a * (dark ? 0.75 : 0.9), colorFn);
      ctx.stroke();
    }

    // Pass 3: wandernde Glanzpunkte
    if (!animated) return;
    var sp = sprites();
    for (var g = 0; g < this.glints.length; g++) {
      var gl = this.glints[g];
      if (gl.wait > 0) continue;
      th = this.threads[gl.i];
      if (!th || th.rev < 0.05) continue;
      var uu = gl.u * th.rev, sPos = uu * S, s0 = Math.floor(sPos), f = sPos - s0;
      if (s0 >= S) continue;
      var x = uu * W, y = lerp(th.y[s0], th.y[Math.min(S, s0 + 1)], f);
      var ga = vis * Math.sin(Math.PI * gl.u) * (0.55 + 0.45 * th.a);
      // leuchtender Schweif auf dem Faden
      var tailS = Math.max(0, sPos - S * 0.07);
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      ctx.beginPath();
      ctx.moveTo((tailS / S) * W, lerp(th.y[Math.floor(tailS)], th.y[Math.min(S, Math.floor(tailS) + 1)], tailS % 1));
      for (var s = Math.floor(tailS) + 1; s <= s0; s++) ctx.lineTo((s / S) * W, th.y[s]);
      ctx.lineTo(x, y);
      var tg = ctx.createLinearGradient((tailS / S) * W, 0, x, 0);
      tg.addColorStop(0, rgba(dark ? CHAMP : IVORY, 0));
      tg.addColorStop(1, rgba(dark ? [255, 248, 232] : [255, 252, 246], ga * 0.95));
      ctx.lineWidth = th.w + 0.6;
      ctx.strokeStyle = tg;
      ctx.stroke();
      // Glanzpunkt
      ctx.globalCompositeOperation = dark ? 'lighter' : 'screen';
      var size = 22 + 10 * th.a;
      ctx.globalAlpha = clamp(ga, 0, 1);
      ctx.drawImage(sp.glint, x - size / 2, y - size / 2, size, size);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  /* ------------------------------------------------------------------ *
   *  2 · Ambient-Orbits (Kontakt)
   * ------------------------------------------------------------------ */
  function Ambient(canvas) {
    CanvasActor.call(this, canvas);
    var self = this;
    this.kind = 'ambient';
    this.time = 0;
    this.dark = true;
    var r = rng(0xA11B), A = CFG.ambient, n = intAttr(canvas, 'data-count') || A.ORBITS;
    this.orbits = [];
    for (var i = 0; i < n; i++) {
      var k = i / Math.max(1, n - 1);
      this.orbits.push({
        rx: 0.42 + k * 0.62 + (r() - 0.5) * 0.05,
        ry: 0.16 + r() * 0.3,
        rot: -0.5 + r() * 1.0,
        spin: A.SPIN * (0.5 + r()) * (i % 2 ? -1 : 1),
        ph: r() * TAU,
        cw: A.COMET * (0.6 + r() * 0.8) * (r() < 0.3 ? -1 : 1),
        len: 0.7 + r() * 0.9,
        a: 0.55 + r() * 0.45,
        pearl: i === 2 || i === n - 2
      });
    }
    detectTone(canvas, function (d) { self.dark = d; if (!self.animated && self.visible) self.renderStatic(); }, true);
  }
  Ambient.prototype = Object.create(CanvasActor.prototype);
  Ambient.prototype.frame = function (t, dt) { this.time += dt; this.render(true); };
  Ambient.prototype.renderStatic = function () { if (this.ready()) this.render(false); };
  Ambient.prototype.render = function (animated) {
    var A = CFG.ambient, ctx = this.begin(), W = this.W, H = this.H, t = this.time, dark = this.dark;
    var cx = W * A.CX, cy = H * A.CY, R = Math.max(150, Math.min(W * 0.5, H * 0.9) * A.RADIUS * 1.6);
    var sp = sprites();
    ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';

    // sehr weicher Halo
    var hg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
    hg.addColorStop(0, rgba(GOLD, A.HALO));
    hg.addColorStop(0.45, rgba(GOLD, A.HALO * 0.35));
    hg.addColorStop(1, rgba(GOLD, 0));
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, W, H);

    ctx.lineCap = 'round';
    for (var i = 0; i < this.orbits.length; i++) {
      var o = this.orbits[i], rx = o.rx * R, ry = o.ry * R * (0.9 + 0.1 * Math.sin(t * 0.07 + o.ph));
      var rot = o.rot + t * o.spin;
      var col = o.pearl ? (i % 2 ? PEARL2 : PEARL1) : (i % 3 === 0 ? CHAMP : GOLD);
      if (!dark) col = o.pearl ? [150, 140, 136] : BRONZE;
      // Grundlinie
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, rot, 0, TAU);
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = rgba(col, A.LINE_ALPHA * o.a);
      ctx.stroke();
      // Lichtkopf mit Schweif
      var head = o.ph + t * o.cw, dir = o.cw >= 0 ? 1 : -1, SEG = 22;
      for (var j = 0; j < SEG; j++) {
        var a0 = head - dir * o.len * (j + 1) / SEG, a1 = head - dir * o.len * j / SEG;
        var fall = Math.pow(1 - j / SEG, 2.2);
        ctx.beginPath();
        if (dir > 0) ctx.ellipse(cx, cy, rx, ry, rot, a0, a1);
        else ctx.ellipse(cx, cy, rx, ry, rot, a1, a0);
        ctx.lineWidth = 0.6 + 0.8 * fall;
        ctx.strokeStyle = rgba(j < 2 && dark ? [255, 246, 228] : col, o.a * fall * 0.85);
        ctx.stroke();
      }
      var hx = cx + rx * Math.cos(head) * Math.cos(rot) - ry * Math.sin(head) * Math.sin(rot);
      var hy = cy + rx * Math.cos(head) * Math.sin(rot) + ry * Math.sin(head) * Math.cos(rot);
      ctx.globalAlpha = o.a * 0.9;
      var s = 16;
      ctx.drawImage(dark ? (o.pearl ? sp.pearlDark : sp.goldDark) : sp.goldLight, hx - s / 2, hy - s / 2, s, s);
      ctx.globalAlpha = 1;
    }
    // Mittelpunkt: ein ruhiger Lichtkern
    ctx.globalAlpha = 0.5 + (animated ? 0.15 * Math.sin(t * 0.6) : 0);
    ctx.drawImage(dark ? sp.goldDark : sp.goldLight, cx - 7, cy - 7, 14, 14);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  /* ------------------------------------------------------------------ *
   *  3 · Goldstaub (.motes)
   * ------------------------------------------------------------------ */
  function Motes(box) {
    var canvas = document.createElement('canvas');
    canvas.className = 'lfx-motes';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
    box.appendChild(canvas);
    CanvasActor.call(this, canvas);
    var self = this;
    this.box = box;
    this.kind = 'motes';
    this.time = 0;
    this.dark = false;
    this.parts = [];
    this.seed = 0x5EED ^ (actors.length * 977);
    detectTone(box, function (d) { self.dark = d; if (!self.animated && self.visible) self.renderStatic(); });
  }
  Motes.prototype = Object.create(CanvasActor.prototype);
  Motes.prototype.rebuild = function () {
    var M = CFG.motes, W = this.W, H = this.H, r = rng(this.seed);
    var n = intAttr(this.box, 'data-count') || Math.round(clamp(W * H / M.AREA_PER, M.MIN, M.MAX));
    var old = this.parts, parts = [];
    for (var i = 0; i < n; i++) {
      var depth = r();
      parts.push({
        x: old[i] ? old[i].x * W : r() * W,   // bei Resize relativ halten
        y: old[i] ? old[i].y * H : r() * H,
        rise: lerp(M.RISE[0], M.RISE[1], r()) * (0.5 + depth * 0.7),
        drift: (r() - 0.5) * M.DRIFT,
        sway: 2 + r() * 6, swf: 0.05 + r() * 0.15,
        r: lerp(M.SIZE[0], M.SIZE[1], Math.pow(r(), 1.5)) * (0.75 + depth * 0.45),
        a: 0.5 + r() * 0.5,
        bokeh: r() < M.BOKEH_SHARE ? lerp(M.BOKEH_SIZE[0], M.BOKEH_SIZE[1], r()) : 0,
        tw: lerp(M.TWINKLE[0], M.TWINKLE[1], r()),
        ph: r() * TAU,
        pearl: r() < M.PEARL_SHARE
      });
    }
    // Positionen als Pixel speichern
    this.parts = parts;
    this._norm = false;
  };
  Motes.prototype.resize = function () {
    // vor dem Neuaufbau Positionen normalisieren, damit nichts springt
    var W0 = this.W, H0 = this.H;
    if (W0 && H0) this.parts.forEach(function (q) { q.x /= W0; q.y /= H0; });
    var changed = this.fit();
    if (changed || !this.parts.length) this.rebuild();
    else { var W = this.W, H = this.H; this.parts.forEach(function (q) { q.x *= W; q.y *= H; }); }
    if (!this.animated && this.visible) this.renderStatic();
    else if (this.visible) wake();
  };
  Motes.prototype.frame = function (t, dt) {
    this.time += dt;
    var W = this.W, H = this.H, pad = 6, T = this.time;
    for (var i = 0; i < this.parts.length; i++) {
      var q = this.parts[i];
      q.y -= q.rise * dt;
      q.x += (q.drift + Math.sin(T * q.swf * TAU + q.ph) * q.sway * 0.4) * dt;
      if (q.y < -pad) { q.y = H + pad; q.x = Math.random() * W; }
      if (q.x < -pad) q.x = W + pad; else if (q.x > W + pad) q.x = -pad;
    }
    this.render(true);
  };
  Motes.prototype.renderStatic = function () { if (this.ready()) this.render(false); };
  Motes.prototype.render = function (animated) {
    var M = CFG.motes, ctx = this.begin(), W = this.W, H = this.H, T = this.time, dark = this.dark;
    var sp = sprites();
    ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    // Lichtkegel: Linie von (0.28W, 0) nach (0.72W, H)
    var bx0 = W * 0.28, bx1 = W * 0.72, bw = Math.max(W, H) * 0.22;
    var lx = bx1 - bx0, ly = H, ll = Math.sqrt(lx * lx + ly * ly) || 1;
    for (var i = 0; i < this.parts.length; i++) {
      var q = this.parts[i];
      var tw = animated ? 0.5 + 0.5 * Math.sin(T * q.tw * TAU + q.ph) : 0.5 + 0.5 * Math.sin(q.ph);
      tw = 0.35 + 0.65 * tw * tw;
      var beam = 1;
      if (M.BEAM) {
        var d = ((q.x - bx0) * ly - q.y * lx) / ll;
        beam = 0.4 + 0.6 * Math.exp(-d * d / (2 * bw * bw));
      }
      var a = q.a * tw * beam;
      if (a < 0.02) continue;
      if (q.bokeh) {
        // unscharfer Staub nahe der „Kamera": weiche Scheibe, sehr leise
        ctx.globalAlpha = clamp(a * (dark ? 0.22 : 0.3), 0, 1);
        ctx.drawImage(dark ? sp.bokehDark : sp.bokehLight, q.x - q.bokeh / 2, q.y - q.bokeh / 2, q.bokeh, q.bokeh);
        continue;
      }
      var size = q.r * (dark ? 18 : 24);
      ctx.globalAlpha = clamp(dark ? a : 0.35 + 0.75 * a, 0, 1);
      ctx.drawImage(dark ? (q.pearl ? sp.pearlDark : sp.goldDark) : (q.pearl ? sp.pearlLight : sp.goldLight),
                    q.x - size / 2, q.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  /* ------------------------------------------------------------------ *
   *  4 · KI-Decode
   * ------------------------------------------------------------------ */
  var styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    var css =
      '.lfx-c{position:relative}' +
      '.lfx-c.lfx-g{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}' +
      '.lfx-c.lfx-g::after{content:attr(data-g);position:absolute;left:-.5em;right:-.5em;top:0;bottom:0;' +
        'display:flex;align-items:center;justify-content:center;pointer-events:none;' +
        'font-family:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-style:normal;font-weight:400;' +
        'font-size:.5em;letter-spacing:0;text-transform:none;line-height:1;' +
        'color:rgba(201,164,106,.5);-webkit-text-fill-color:rgba(201,164,106,.5)}' +
      '.lfx-c.lfx-hot::after{color:rgba(201,164,106,.88);-webkit-text-fill-color:rgba(201,164,106,.88)}' +
      '.lfx-c.lfx-in{animation:lfx-in .55s cubic-bezier(.2,.7,.2,1) both}' +
      '@keyframes lfx-in{from{color:#c9a46a;-webkit-text-fill-color:#c9a46a;opacity:.55;filter:blur(1.5px)}}' +
      '[data-decode].lfx-fade{opacity:0;transition:opacity .9s ease}' +
      '[data-decode].lfx-fade.lfx-shown{opacity:1}';
    var st = document.createElement('style');
    st.setAttribute('data-lumen-fx', '');
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function Decoder(el) {
    this.el = el;
    this.kind = 'decode';
    this.visible = false; this.animated = true; this.dead = false;
    this.started = false;
    this.parts = [];   // [wrapper, originalTextNode]
    this.spans = [];
    el.__lfxDecode = this;
  }
  Decoder.prototype.ready = function () { return this.started; };
  Decoder.prototype.resize = function () {};
  Decoder.prototype.renderStatic = function () {};
  Decoder.prototype.glyph = function () {
    var G = CFG.decode.GLYPHS;
    return G.charAt(Math.floor(Math.random() * G.length));
  };
  Decoder.prototype.prepare = function () {
    var el = this.el;
    var full = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!full) return false;
    if (!el.hasAttribute('aria-label')) { el.setAttribute('aria-label', full); this.setLabel = true; }
    if (reduced) { el.classList.add('lfx-fade'); return true; }

    var nodes = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!/\S/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        for (var p = n.parentNode; p && p !== el; p = p.parentNode) {
          if (p.nodeType === 1 && (p.classList.contains('cap') || p.hasAttribute('data-decode-skip') ||
              /^(SCRIPT|STYLE|SVG)$/i.test(p.nodeName))) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    var self = this;
    nodes.forEach(function (node) {
      var wrap = document.createElement('span');
      wrap.className = 'lfx-d';
      var chars = Array.from(node.nodeValue), buf = '';
      chars.forEach(function (ch) {
        if (/\s/.test(ch)) { buf += ch; return; }
        if (buf) { wrap.appendChild(document.createTextNode(buf)); buf = ''; }
        var s = document.createElement('span');
        s.className = 'lfx-c lfx-g';
        s.textContent = ch;
        s.setAttribute('data-g', self.glyph());
        wrap.appendChild(s);
        self.spans.push(s);
      });
      if (buf) wrap.appendChild(document.createTextNode(buf));
      node.parentNode.replaceChild(wrap, node);
      self.parts.push([wrap, node]);
    });
    return this.spans.length > 0;
  };
  Decoder.prototype.start = function () {
    if (this.started) return;
    var el = this.el, C = CFG.decode;
    if (reduced || !this.spans.length) {
      el.classList.add('lfx-shown');
      var self = this;
      setTimeout(function () { self.finish(); }, 1000);
      this.dead = true;
      return;
    }
    this.prevMinH = el.style.minHeight;
    this.hadStyle = el.hasAttribute('style');
    el.style.minHeight = el.getBoundingClientRect().height + 'px';
    var n = this.spans.length, D = clamp(n * C.PER_CHAR_S, C.MIN_S, C.MAX_S);
    this.D = D;
    this.at = []; this.last = []; this.state = [];
    for (var i = 0; i < n; i++) {
      this.at.push((n > 1 ? i / (n - 1) : 0) * (D - C.HOT_S * 0.5) * 0.9 + Math.random() * 0.1 * D + C.HOT_S * 0.5);
      this.last.push(0);
      this.state.push(0);
    }
    this.t0 = -1;
    this.done = 0;
    this.started = true;
    this.visible = true;
    actors.push(this);
    wake();
  };
  Decoder.prototype.frame = function (t) {
    var C = CFG.decode;
    if (this.t0 < 0) this.t0 = t;
    var e = t - this.t0;
    for (var i = 0; i < this.spans.length; i++) {
      var st = this.state[i];
      if (st === 2) continue;
      var s = this.spans[i], at = this.at[i];
      if (e >= at) {
        s.classList.remove('lfx-g', 'lfx-hot');
        s.removeAttribute('data-g');
        s.classList.add('lfx-in');
        this.state[i] = 2; this.done++;
      } else if (e >= at - C.HOT_S) {
        if (st !== 1) { s.classList.add('lfx-hot'); this.state[i] = 1; }
        if (t - this.last[i] > C.FLICKER_S) { s.setAttribute('data-g', this.glyph()); this.last[i] = t; }
      } else if (t - this.last[i] > 0.18 && Math.random() < 0.25) {
        s.setAttribute('data-g', this.glyph()); this.last[i] = t;
      }
    }
    if (this.done >= this.spans.length && e > this.D + 0.7) {
      this.finish();
      this.dead = true;
    }
  };
  Decoder.prototype.finish = function () {
    var el = this.el;
    for (var i = 0; i < this.parts.length; i++) {
      var w = this.parts[i][0], node = this.parts[i][1];
      if (w.parentNode) w.parentNode.replaceChild(node, w);
    }
    this.parts = []; this.spans = [];
    if (this.prevMinH !== undefined) {
      el.style.minHeight = this.prevMinH;
      if (!this.hadStyle && !el.getAttribute('style')) el.removeAttribute('style');
    }
    el.classList.remove('lfx-fade', 'lfx-shown');
    if (this.setLabel) el.removeAttribute('aria-label');
    el.classList.add('is-decoded');
    try { el.dispatchEvent(new CustomEvent('lumen:decoded', { bubbles: true })); } catch (e) { /* alt */ }
  };

  var decodeIO = hasIO ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      decodeIO.unobserve(e.target);
      var d = e.target.__lfxDecode;
      if (d) d.start();
    });
  }, { threshold: CFG.decode.THRESHOLD, rootMargin: CFG.decode.ROOT_MARGIN }) : null;

  function setupDecode(el) {
    if (el.__lfxDecode || !decodeIO) return; // ohne IO: Text bleibt unverändert
    injectStyle();
    var d = new Decoder(el);
    if (!d.prepare()) { el.__lfxDecode = null; return; }
    decodeIO.observe(el);
  }

  /* ------------------------------------------------------------------ *
   *  Init / API
   * ------------------------------------------------------------------ */
  function scan(root) {
    root = root || document;
    var q = function (sel) { return root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll(sel)) : []; };
    q('canvas.threads[data-mode="hero"]').forEach(function (c) { if (!c.__lfx && c.getContext) register(new Hero(c), c); });
    q('canvas.threads[data-mode="ambient"]').forEach(function (c) { if (!c.__lfx && c.getContext) register(new Ambient(c), c); });
    q('.motes').forEach(function (b) { if (!b.__lfx) { var m = new Motes(b); b.__lfx = m; m.c.__lfx = m; register(m, b); } });
    q('[data-decode]').forEach(setupDecode);
  }

  function init() {
    try { scan(document); } catch (e) { if (window.console) console.warn('[LumenFX]', e); }
  }

  if (mq) {
    var onMq = function () {
      reduced = mq.matches;
      actors.forEach(function (a) {
        if (a.kind === 'decode') return;
        a.animated = !reduced;
        if (reduced && a.visible) a.renderStatic();
      });
      wake();
    };
    if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(); });

  window.LumenFX = {
    version: '1.0.0',
    config: CFG,
    refresh: function (root) { scan(root || document); wake(); },
    decode: function (el) {
      if (!el) return;
      setupDecode(el);
      if (el.__lfxDecode) { if (decodeIO) decodeIO.unobserve(el); el.__lfxDecode.start(); }
    },
    pause: function () { paused = true; if (rafId) cancelAnimationFrame(rafId); rafId = 0; },
    resume: function () { paused = false; lastTs = 0; wake(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

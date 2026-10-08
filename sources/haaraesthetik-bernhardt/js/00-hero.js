/* ==========================================================
   00 · Hero „Quelle der Entspannung“
   Intro (lumen:loaded): Die Skizze zeichnet sich ein, dann fließt die
   Pastellfarbe von der Quelle aus über Strahl, Becken und Bild (WebGL,
   Ankunftszeit-Karte + Noise-Ränder + Aquarellkante). Cursor/Touch malt mit.
   Wasser: Strahl-Schimmer, Wellen, Tropfen-Ringe, Cursor-Ringe auf der Fläche.
   Scroll (--p): Kamerafahrt zur Quelle, Skizzen- und Farbebene trennen sich
   leicht, Leitmotiv erscheint, am Ende Elfenbein ins erste Kapitel.
   Fallback ohne WebGL: CSS-Maske. Reduzierte Bewegung: fertiges Bild.
   ========================================================== */
(() => {
  const L = window.LUMEN;
  const sec = document.getElementById('hero');
  if (!L || !sec) return;
  const q = s => sec.querySelector(s);
  const qa = s => [...sec.querySelectorAll(s)];
  const { clamp, lerp } = L;

  const stage = q('.hr-stage'), canvas = q('.hr-gl'), brand = q('.hr-brand'), wm = q('.hr-wm');
  const hint = q('.hr-hint'), cue = q('.hr-cue'), veil = q('.hr-veil'), wash = q('.hr-wash');
  const imgSk = q('.hr-img-sketch'), imgCo = q('.hr-img-color');
  const statement = q('.hr-statement'), stRule = q('.hr-st-rule'), stCta = q('.hr-st-cta');

  const STATIC = L.reduce;
  if (STATIC) return;            // CSS zeigt das fertige, farbige Bild
  sec.classList.add('hr-anim');

  /* ---------- Szenen-Daten (Bild-Koordinaten 0..1) ---------- */
  const SCENES = {
    desk: {
      iw: 2000, ih: 1333,
      sketch: ['img/brunnen/sketch-s.webp', 'img/brunnen/sketch.webp'],
      color: ['img/brunnen/color-s.webp', 'img/brunnen/color.webp'],
      map: 'img/brunnen/map.png',
      align: [0.68, 0.6],          // Cover-Ausschnitt
      source: [0.755, 0.455],      // Austritt des Strahls
      impact: [0.742, 0.752],      // Strahl trifft das Wasser
      target: [0.70, 0.74],        // Kamerafahrt: dieser Bildpunkt …
      tScreen: [0.72, 0.60],       // … wandert hierher (Anteil Viewport)
      zoom: 1.24,
      squash: 3.4,                 // Perspektive der Wasserfläche (Ellipsen)
      wall: [0.47, 0.385],         // rechte Kante der Wand (x), Wortmarke oben (y)
    },
    mob: {
      iw: 1024, ih: 1536,
      sketch: ['img/brunnen/sketch-m-s.webp', 'img/brunnen/sketch-m.webp'],
      color: ['img/brunnen/color-m-s.webp', 'img/brunnen/color-m.webp'],
      map: 'img/brunnen/map-m.png',
      align: [0.5, 0.5],
      source: [0.5, 0.628],
      impact: [0.5, 0.734],
      target: [0.5, 0.79],
      tScreen: [0.5, 0.66],
      zoom: 1.2,
      squash: 2.3,
      wall: [1, 0],
    },
  };
  const CFG = {
    DRAW: [0.0, 1.5],      // Skizze zeichnet sich ein (s)
    FLOOD: [1.05, 5.4],    // Farbe fließt (s)
    INK_AT: 1.5,           // Wortmarke wird eingetuscht (s)
    ZOOM_END: 0.78,
    ST_FROM: 0.26, ST_TO: 0.6,
    VEIL_FROM: 0.82,
    DPR: 1.5,
  };

  /* ---------- Easing ---------- */
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = s => ((ax * s + bx) * s + cx) * s, Y = s => ((ay * s + by) * s + cy) * s;
    return t => {
      if (t <= 0) return 0; if (t >= 1) return 1;
      let lo = 0, hi = 1, s = t;
      for (let i = 0; i < 22; i++) { s = (lo + hi) / 2; if (X(s) < t) lo = s; else hi = s; }
      return Y(s);
    };
  }
  const eOut = bezier(0.19, 1, 0.22, 1);
  const eIO = bezier(0.62, 0.02, 0.28, 1);
  const eSoft = bezier(0.33, 0, 0.2, 1);
  const eFlood = bezier(0.55, 0.05, 0.45, 0.95);
  const seg = (v, a, b) => clamp((v - a) / (b - a));

  /* ---------- Statement in Wörter teilen ---------- */
  const stWords = [];
  qa('[data-hr-split]').forEach(el => {
    const label = el.textContent.replace(/\s+/g, ' ').trim();
    el.setAttribute('aria-label', label);
    el.innerHTML = el.innerHTML.split(/<br\s*\/?>/i).map(line => line.replace(/<[^>]+>/g, '').trim().split(/\s+/)
      .map(w => `<span class="hr-w" aria-hidden="true"><span>${w}</span></span>`).join(' ')).join('<br>');
    el.querySelectorAll('.hr-w > span').forEach(s => stWords.push(s));
  });

  /* ---------- Geometrie ---------- */
  const G = { W: 0, H: 0, mob: false, S: SCENES.desk };
  const isMob = () => innerWidth <= 899;

  function cam(p, mx, my, intro) {
    // Bildlage in CSS-px: {x, y, w, h}
    const { W, H, S } = G;
    const k0 = Math.max(W / S.iw, H / S.ih) * 1.03;            // 3 % Reserve für Maus-Parallaxe
    const z = eIO(seg(p, 0, CFG.ZOOM_END));
    const zoom = lerp(1, S.zoom, z) * (1 + 0.035 * (1 - intro));
    const k = k0 * zoom, w = S.iw * k, h = S.ih * k;
    const bx = (W - S.iw * k0) * S.align[0], by = (H - S.ih * k0) * S.align[1];
    const sx = lerp(bx + S.target[0] * S.iw * k0, S.tScreen[0] * W, z);
    const sy = lerp(by + S.target[1] * S.ih * k0, S.tScreen[1] * H, z);
    let x = sx - S.target[0] * w - mx * 14, y = sy - S.target[1] * h - my * 9;
    x = clamp(x, W - w, 0); y = clamp(y, H - h, 0);
    return { x, y, w, h };
  }

  function layout() {
    const W = stage.clientWidth || L.vw, H = stage.clientHeight || L.vh;
    const mob = isMob();
    const changed = mob !== G.mob || !G.W;
    G.W = W; G.H = H; G.mob = mob; G.S = mob ? SCENES.mob : SCENES.desk;
    const S = G.S;
    // Wortmarke: auf der Wand (Desktop) bzw. oben im Himmel (Mobil)
    const c = cam(0, 0, 0, 1);
    let fs, top;
    if (mob) {
      fs = measureFit(W - 40);
      top = Math.max(76, Math.min(H * 0.11, 104));
    } else {
      const wallR = c.x + S.wall[0] * c.w;
      const room = Math.min(wallR - 32 - (W >= 1200 ? 56 : 32), W * 0.52);
      fs = Math.min(measureFit(room), H * 0.19, 168);
      top = clamp(c.y + S.wall[1] * c.h, 112, H - fs * 1.9 - 120);
    }
    stage.style.setProperty('--wm-fs', `${fs.toFixed(1)}px`);
    stage.style.setProperty('--brand-y', `${top.toFixed(1)}px`);
    // Fallback-Maskenmittelpunkt in % der Bühne
    stage.style.setProperty('--sx', `${((c.x + S.source[0] * c.w) / W * 100).toFixed(1)}%`);
    stage.style.setProperty('--sy', `${((c.y + S.source[1] * c.h) / H * 100).toFixed(1)}%`);
    if (gl) sizeCanvas();
    if (changed && gl) loadScene();
    G.dirty = true;
  }
  let fitW = 0;
  function measureFit(room) {
    // Breite von „Haarästhetik“ bei 100px messen und auf room skalieren
    if (!fitW || !G.fontsOk) {
      const prev = wm.style.fontSize, pd = wm.style.display;
      wm.style.fontSize = '100px'; wm.style.display = 'inline-block';
      fitW = wm.getBoundingClientRect().width || 520;
      wm.style.fontSize = prev; wm.style.display = pd;
    }
    return clamp(room / fitW * 100, 44, 220);
  }

  /* ---------- WebGL ---------- */
  let gl = null, prog = null, U = {}, tex = {}, scene = null, glReady = false;
  const brush = document.createElement('canvas');
  const bctx = brush.getContext('2d');
  let brushDirty = false;
  const mapCanvas = document.createElement('canvas');
  let mapData = null, mapW = 0, mapH = 0;

  const VS = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }`;
  const FS = `
precision highp float;
uniform sampler2D uSk, uCo, uMap, uBr;
uniform vec2 uRes, uOrg, uSize, uSepC, uImp;
uniform float uTime, uDraw, uFlood, uSep, uSquash, uAsp, uDpr;
uniform vec4 uRip[12];
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * vn(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 uv = (px - uOrg) / uSize;
  vec4 mp = texture2D(uMap, uv);
  float surf = mp.g, strm = mp.b;
  float t = uTime;
  vec2 d = vec2(0.);
  float hl = 0., glint = 0.;
  if (surf > .004) {
    vec2 qv = uv * vec2(1., uSquash * uAsp);
    vec2 nq = qv * vec2(70., 34.);
    d += (vec2(vn(nq + vec2(t * .45, t * .2)), vn(nq * 1.3 + vec2(5.2 - t * .3, 1.7 + t * .35))) - .5) * vec2(.0018, .0024) * surf;
    for (int i = 0; i < 12; i++) {
      vec4 r = uRip[i];
      float age = t - r.z;
      if (r.w <= 0. || age < 0. || age > 4.5) continue;
      vec2 dv = (uv - r.xy) * vec2(1., uSquash * uAsp);
      float rr = length(dv);
      float front = age * .055;
      float ring = exp(-pow((rr - front) / (.010 + age * .006), 2.));
      float w = sin((rr - front) * 520.) * ring * exp(-age * 1.05) * r.w;
      d += dv / (rr + 1e-4) * w * .005 * vec2(1., 1. / (uAsp * uSquash));
      hl += w;
    }
    vec2 cq = uv * vec2(190., 190. * uSquash * uAsp);
    float c1 = vn(cq + vec2(t * .35, -t * .2)), c2 = vn(cq * 1.37 - vec2(t * .28, t * .31));
    float near = exp(-pow(length((uv - uImp) * vec2(1., uSquash * uAsp)) / .16, 2.));
    glint = pow(clamp(1. - abs(c1 - c2) * 3.2, 0., 1.), 8.) * surf * (.35 + .65 * near);
  }
  if (strm > .004) {
    d.x += (sin(uv.y * 900. - t * 22.) * .6 + sin(uv.y * 370. - t * 13.) * .4) * .00022 * strm;
    float s = vn(vec2(uv.x * 300., uv.y * 9. - t * 4.2)) * vn(vec2(uv.x * 140. + 3., uv.y * 5. - t * 3.1));
    hl += pow(s, 3.) * 3.2 * strm;
  }
  vec2 u2 = uv + d;
  vec2 skUv = u2 + (u2 - uSepC) * uSep * -.011 + vec2(0., uSep * .003);
  vec3 sk = texture2D(uSk, skUv).rgb;
  vec3 co = texture2D(uCo, u2).rgb;
  vec3 paper = vec3(.953, .941, .918);
  // Skizze zeichnet sich ein
  // dunkle Konturen zuerst, Schraffuren und Töne danach (wie beim Zeichnen)
  float dark = clamp((dot(paper, vec3(.333)) - dot(sk, vec3(.333))) * 3.2, 0., 1.);
  float thr = .55 * (1. - dark) + fbm(uv * vec2(3.2, 2.2) + 7.) * .5 - .04;
  float dm = smoothstep(thr - .07, thr + .07, uDraw * 1.12);
  vec3 skc = mix(paper, sk, dm);
  // Farbe fließt: Ankunftszeit + Noise-Rand
  float n2 = fbm(uv * vec2(7.5, 5.) + 3.1);
  float n3 = fbm(uv * vec2(26., 18.) - 1.7);
  float a = mp.r + (n2 - .5) * .13 + (n3 - .5) * .035;
  float dd = uFlood - a;
  float m = smoothstep(0., .03, dd);
  float rim = smoothstep(-.003, .004, dd) * (1. - smoothstep(.004, .045, dd));
  float wet = smoothstep(0., .02, dd) * (1. - smoothstep(.02, .22, dd));
  float b = texture2D(uBr, uv).r;
  float bb = b + (n2 - .5) * .45 + (n3 - .5) * .2;
  float bm = smoothstep(.22, .42, bb);
  float brim = smoothstep(.16, .24, bb) * (1. - smoothstep(.26, .5, bb));
  m = max(m, bm); rim = max(rim * (1. - bm), brim * (1. - m));
  // Skizzenlinien bleiben unter der Farbe sichtbar (wie ein kolorierter Entwurf)
  vec3 coL = co * mix(vec3(1.), sk / paper, .18 * uSep);
  vec3 col = mix(skc, coL, m);
  col = mix(col, co * mix(vec3(1.), co, .7) * 1.04, rim * .3);
  col = mix(col, col * .985 + .02, wet * .55);
  // Wasser: Licht
  col += vec3(1., .98, .94) * hl * .075 * max(m, .35);
  col += vec3(1., .95, .82) * glint * .22 * max(m, .25);
  gl_FragColor = vec4(col, 1.);
}`;

  function initGL() {
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    } catch (e) { gl = null; }
    if (!gl) return false;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('hero shader', gl.getShaderInfoLog(s)); return null; } return s; };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) { gl = null; return false; }
    prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl = null; return false; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ['uSk', 'uCo', 'uMap', 'uBr', 'uRes', 'uOrg', 'uSize', 'uSepC', 'uImp', 'uTime', 'uDraw', 'uFlood', 'uSep', 'uSquash', 'uAsp', 'uDpr', 'uRip']
      .forEach(n => (U[n] = gl.getUniformLocation(prog, n === 'uRip' ? 'uRip[0]' : n)));
    ['sk', 'co', 'map', 'br'].forEach((k, i) => {
      const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([243, 240, 234, 255]));
      tex[k] = t;
    });
    gl.uniform1i(U.uSk, 0); gl.uniform1i(U.uCo, 1); gl.uniform1i(U.uMap, 2); gl.uniform1i(U.uBr, 3);
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); toFallback(); }, false);
    return true;
  }

  function sizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, CFG.DPR);
    G.dpr = dpr;
    const w = Math.round(G.W * dpr), h = Math.round(G.H * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (gl) gl.viewport(0, 0, w, h);
  }

  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
  let sceneToken = 0;
  async function loadScene() {
    const S = G.S, token = ++sceneToken;
    const big = G.mob ? 1 : (G.W * G.dpr > 1150 ? 1 : 0);
    try {
      const [sk, co, mp] = await Promise.all([loadImg(S.sketch[big]), loadImg(S.color[big]), loadImg(S.map)]);
      if (token !== sceneToken || !gl) return;
      const up = (unit, t, img) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); };
      up(0, tex.sk, sk); up(1, tex.co, co); up(2, tex.map, mp);
      // Kartendaten für Treffer-Tests (Wasser unter dem Cursor?)
      mapW = mp.naturalWidth; mapH = mp.naturalHeight;
      mapCanvas.width = mapW; mapCanvas.height = mapH;
      const mc = mapCanvas.getContext('2d', { willReadFrequently: true });
      mc.drawImage(mp, 0, 0); mapData = mc.getImageData(0, 0, mapW, mapH).data;
      // Pinsel-Maske im Bildraum
      brush.width = G.mob ? 170 : 256; brush.height = Math.round(brush.width * S.ih / S.iw);
      bctx.fillStyle = '#000'; bctx.fillRect(0, 0, brush.width, brush.height);
      brushDirty = true;
      scene = S; glReady = true;
      sec.classList.add('hr-gl-on');
      ready();
    } catch (e) { if (token === sceneToken) toFallback(); }
  }

  function toFallback() {
    glReady = false; gl = null;
    sec.classList.remove('hr-gl-on');
    sec.classList.add('hr-fb');
    ready();
  }

  /* ---------- Wasser: Ringe ---------- */
  const rip = new Float32Array(48);
  let ripI = 0;
  function addRipple(x, y, amp) {
    const o = (ripI++ % 12) * 4;
    rip[o] = x; rip[o + 1] = y; rip[o + 2] = clock(); rip[o + 3] = amp;
  }
  function waterAt(u, v) {
    if (!mapData || u < 0 || v < 0 || u > 1 || v > 1) return 0;
    const i = (Math.min(mapH - 1, Math.floor(v * mapH)) * mapW + Math.min(mapW - 1, Math.floor(u * mapW))) * 4;
    return Math.max(mapData[i + 1], mapData[i + 2] * 0.6) / 255;
  }

  /* ---------- Pinsel ---------- */
  function stamp(u, v, r, a) {
    const bw = brush.width, bh = brush.height;
    const x = u * bw, y = v * bh, rad = r * bw;
    const g = bctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.55, `rgba(255,255,255,${a * 0.55})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    bctx.fillStyle = g; bctx.beginPath(); bctx.arc(x, y, rad, 0, Math.PI * 2); bctx.fill();
    brushDirty = true;
  }

  /* ---------- Zeit / Intro ---------- */
  const T0 = performance.now();
  const clock = () => (performance.now() - T0) / 1000;
  let introAt = 0, loadedOk = false, assetsOk = false, inked = false, done = false;
  function ready() { assetsOk = true; tryStart(); }
  function onLoaded() { loadedOk = true; tryStart(); }
  function tryStart() {
    if (introAt || !loadedOk || !assetsOk) return;
    introAt = clock();
    sec.classList.add('is-in', 'cue-on');
  }
  if (L.loaded) onLoaded(); else document.addEventListener('lumen:loaded', onLoaded, { once: true });
  setTimeout(() => { loadedOk = true; assetsOk = true; tryStart(); }, 6000);   // Sicherheitsnetz

  /* ---------- Pointer ---------- */
  let lastPt = null, lastRip = 0;
  function pointer(e) {
    if (!introAt) return;
    const r = stage.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (sx < 0 || sy < 0 || sx > r.width || sy > r.height) return;
    const c = G.cam;
    if (!c) return;
    const u = (sx - c.x) / c.w, v = (sy - c.y) / c.h;
    const now = clock();
    const dist = lastPt ? Math.hypot(sx - lastPt.x, sy - lastPt.y) : 99;
    if (glReady && floodK < 1.02) {
      // Pinselstrich entlang der Bewegung, mit ein paar Spritzern
      const steps = lastPt && dist < 160 ? Math.ceil(dist / 9) : 1;
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const ux = lastPt && dist < 160 ? lerp(lastPt.u, u, k) : u, vy = lastPt && dist < 160 ? lerp(lastPt.v, v, k) : v;
        stamp(ux, vy, G.mob ? 0.075 : 0.05, 0.22);
      }
      if (Math.random() < 0.25) stamp(u + (Math.random() - 0.5) * 0.06, v + (Math.random() - 0.5) * 0.06, 0.012 + Math.random() * 0.012, 0.6);
    }
    if (glReady && waterAt(u, v) > 0.4 && (dist > 14 || e.type === 'pointerdown') && now - lastRip > 0.09) {
      addRipple(u, v, e.type === 'pointerdown' ? 1 : clamp(0.35 + dist / 90, 0.35, 0.9));
      lastRip = now;
    }
    lastPt = { x: sx, y: sy, u, v };
  }
  stage.addEventListener('pointermove', pointer, { passive: true });
  stage.addEventListener('pointerdown', pointer, { passive: true });
  stage.addEventListener('pointerleave', () => (lastPt = null), { passive: true });

  /* ---------- Render ---------- */
  const m = { x: 0, y: 0 };
  let floodK = 0, nextDrop = 0, lastFallback = '';
  function render(p, now) {
    const it = introAt ? now - introAt : -1;
    const intro = it < 0 ? 0 : eOut(seg(it, 0, 3.2));
    // Fortschritte: Skizze, Farbe (Scrollen beschleunigt das Ausmalen)
    const draw = it < 0 ? 0 : eSoft(seg(it, CFG.DRAW[0], CFG.DRAW[1]));
    const fl = it < 0 ? 0 : eFlood(seg(it, CFG.FLOOD[0], CFG.FLOOD[1]));
    floodK = Math.max(floodK, fl * 1.12, seg(p, 0.02, 0.22) * 1.12);
    if (!inked && it >= CFG.INK_AT) { inked = true; sec.classList.add('is-inked'); }
    if (!done && floodK >= 1.1) { done = true; sec.classList.add('is-done'); }

    m.x = lerp(m.x, L.fine ? L.mouse.nx : 0, 0.05);
    m.y = lerp(m.y, L.fine ? L.mouse.ny : 0, 0.05);
    const c = cam(p, m.x, m.y, intro);
    G.cam = c;
    const S = G.S;

    if (glReady && gl) {
      // automatische Tropfen am Aufprallpunkt und vereinzelt auf der Fläche
      if (now > nextDrop && it > CFG.FLOOD[0] + 0.4) {
        const far = Math.random() < 0.28;
        if (far) {
          for (let k = 0; k < 6; k++) {
            const u = S.impact[0] + (Math.random() - 0.5) * (G.mob ? 0.8 : 0.5), v = S.impact[1] + (Math.random() - 0.1) * (G.mob ? 0.12 : 0.18);
            if (waterAt(u, v) > 0.6) { addRipple(u, v, 0.32); break; }
          }
        } else addRipple(S.impact[0] + (Math.random() - 0.5) * 0.012, S.impact[1] + (Math.random() - 0.5) * 0.004, 0.5 + Math.random() * 0.3);
        nextDrop = now + 0.55 + Math.random() * 0.9;
      }
      if (brushDirty) {
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tex.br);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, brush);
        brushDirty = false;
      }
      const sep = Math.sin(Math.PI * seg(p, 0.04, 0.9));
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uDpr, canvas.width / G.W);
      gl.uniform2f(U.uOrg, c.x, c.y);
      gl.uniform2f(U.uSize, c.w, c.h);
      gl.uniform2f(U.uSepC, S.target[0], S.target[1]);
      gl.uniform2f(U.uImp, S.impact[0], S.impact[1]);
      gl.uniform1f(U.uTime, now);
      gl.uniform1f(U.uDraw, draw);
      gl.uniform1f(U.uFlood, floodK);
      gl.uniform1f(U.uSep, sep);
      gl.uniform1f(U.uSquash, S.squash);
      gl.uniform1f(U.uAsp, S.ih / S.iw);
      gl.uniform4fv(U.uRip, rip);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      // CSS-Fallback: Bildlage + wachsende Maske
      const key = `${c.x.toFixed(1)},${c.y.toFixed(1)},${c.w.toFixed(1)}`;
      if (key !== lastFallback) {
        lastFallback = key;
        const tr = `translate3d(${c.x.toFixed(1)}px,${c.y.toFixed(1)}px,0) scale(${(c.w / G.W).toFixed(4)},${(c.h / G.H).toFixed(4)})`;
        imgSk.style.transform = imgCo.style.transform = tr;
      }
      stage.style.setProperty('--sx', `${((c.x + S.source[0] * c.w) / G.W * 100).toFixed(1)}%`);
      stage.style.setProperty('--sy', `${((c.y + S.source[1] * c.h) / G.H * 100).toFixed(1)}%`);
      stage.style.setProperty('--r', (floodK * 100).toFixed(1));
    }

    // --- Wortmarke & Hinweise
    const bo = 1 - eSoft(seg(p, 0.02, 0.2));
    brand.style.opacity = bo.toFixed(3);
    brand.style.transform = `translate3d(${(-m.x * 6).toFixed(2)}px,${(-eIO(seg(p, 0, 0.24)) * G.H * 0.12).toFixed(1)}px,0)`;
    const ho = 1 - eSoft(seg(p, 0.005, 0.06));
    hint.style.opacity = ho.toFixed(3);
    hint.style.visibility = p > 0.07 ? 'hidden' : '';
    cue.style.visibility = p > 0.07 ? 'hidden' : '';
    wash.style.setProperty('--wash2', eSoft(seg(p, 0.22, 0.42)).toFixed(3));

    // --- Statement
    const n = stWords.length, span = CFG.ST_TO - CFG.ST_FROM;
    for (let i = 0; i < n; i++) {
      const a = CFG.ST_FROM + (i / n) * span * 0.72;
      const k = eOut(seg(p, a, a + span * 0.34));
      const v = ((1 - k) * 110).toFixed(2);
      if (stWords[i]._v !== v) { stWords[i]._v = v; stWords[i].style.transform = `translate3d(0,${v}%,0)`; }
    }
    stRule.style.transform = `scaleX(${eOut(seg(p, CFG.ST_TO - 0.06, CFG.ST_TO + 0.08)).toFixed(3)})`;
    stCta.style.opacity = seg(p, CFG.ST_TO - 0.02, CFG.ST_TO + 0.08).toFixed(3);
    // nach dem Pin: Statement blendet beim Hinausscrollen aus (kollidiert nicht mit dem Header)
    const past = Math.max(0, G.H - sec.getBoundingClientRect().bottom);
    statement.style.opacity = (1 - eSoft(seg(past, G.H * 0.08, G.H * 0.42))).toFixed(3);
    if (!G.mob) statement.style.transform = `translate3d(0,${(-eIO(seg(p, 0.7, 1)) * G.H * 0.05).toFixed(1)}px,0)`;

    // --- Elfenbein-Übergang (Veil 200 % hoch, deckend ab 34 %)
    const vv = eIO(seg(p, CFG.VEIL_FROM, 1));
    veil.style.transform = `translate3d(0,${lerp(G.H * 1.01, -G.H * 0.7, vv).toFixed(1)}px,0)`;
  }

  /* ---------- Start ---------- */
  G.fontsOk = false;
  const useGL = initGL();
  layout();
  if (useGL) { /* layout() lädt die Szene */ }
  else {
    sec.classList.add('hr-fb');
    const imgs = [imgSk, imgCo].map(i => (i.complete ? Promise.resolve() : new Promise(r => { i.onload = i.onerror = r; })));
    Promise.race([Promise.all(imgs), new Promise(r => setTimeout(r, 2500))]).then(ready);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { G.fontsOk = true; fitW = 0; layout(); G.fontsOk = true; });
  L.onResize(() => { fitW = 0; layout(); });

  L.onFrame(() => {
    const r = sec.getBoundingClientRect();
    if (r.bottom < -40 || r.top > (G.H || L.vh) + 40) return;   // unsichtbar: Pause
    const p = clamp(-r.top / Math.max(1, r.height - G.H));
    render(p, clock());
  });
})();

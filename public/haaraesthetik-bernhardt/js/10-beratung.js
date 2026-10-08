/* ==========================================================
   Kapitel I · 09:00 · Ankommen – Scan, Protokoll, Längen-Lineal (Haar-Morph)
   ========================================================== */
(() => {
  const L = window.LUMEN;
  const sec = document.getElementById('beratung');
  if (!L || !sec) return;
  const $ = (s, r = sec) => r.querySelector(s);
  const $$ = (s, r = sec) => [...r.querySelectorAll(s)];

  const LENS = ['kurz', 'mittel', 'lang', 'aufwendig'];
  const DEF = {
    kurz: 'bis einschließlich Ohr',
    mittel: 'über Ohr bis einschließlich Kinn',
    lang: 'über Kinn bis einschließlich Schulter',
    aufwendig: 'über Schulterlänge bzw. sehr dichtes Haar',
  };
  const mqDesk = matchMedia('(min-width: 900px)');
  // Mobil: kein Glyphen-Decode in den Protokollzeilen – der schnelle Clip-Reveal reicht und bleibt nie halb stehen
  if (!mqDesk.matches) $$('.be-row [data-decode]').forEach(el => el.removeAttribute('data-decode'));

  /* ---------------- Scan-Bogen & Protokoll ---------------- */
  const split = $('.be-split');
  const arch = $('.be-arch');
  const rows = $$('.be-row');
  const capNo = $('[data-be-no]'), capTxt = $('[data-be-cap]');
  let activeRow = -1, scanNow = -1;

  function setRowWidths() { rows.forEach(r => r.style.setProperty('--rw', `${r.offsetWidth}px`)); }
  setRowWidths();
  L.onResize(setRowWidths);

  function setActive(i) {
    if (i === activeRow) return;
    activeRow = i;
    rows.forEach((r, k) => r.classList.toggle('is-active', k === i));
    if (i < 0) return;
    capNo.textContent = String(i + 1).padStart(2, '0');
    capTxt.classList.add('swap');
    clearTimeout(setActive._t);
    setActive._t = setTimeout(() => { capTxt.textContent = rows[i].dataset.cap; capTxt.classList.remove('swap'); }, 220);
  }

  /* ---------------- Längen-Lineal: Haar-Morph ----------------
     Gekapselte Komponente (Quelle: haarlaenge.html). Vier Fotos derselben Frau werden
     per WebGL-Shader (Strähnen-Kante + Lichtsaum) ineinander gemorpht; ohne WebGL
     übernimmt ein CSS-Masken-Wipe. Eingerastete Länge → L.setLength(len, 'lineal'). */
  function initHairMorph(root) {
    const ROMAN = ['I', 'II', 'III', 'IV'];
    const ZONES = [[0.24, 0.49], [0.41, 0.58], [0.45, 1.0]]; // Änderungsbereich je Übergang (Bildhöhe)
    const P = { soft: .05, amp: .038, rim: .16, disp: .004, fq: 160 };
    const VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}';
    const FS = `precision highp float;varying vec2 uv;
uniform sampler2D A,B;uniform float t,y0,y1,soft,amp,rim,disp,fq;
float h(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 q){vec2 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);
 return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float lum(vec3 c){return dot(c,vec3(.299,.587,.114));}
void main(){
 float st=n(vec2(uv.x*fq,uv.y*.8))*.45+n(vec2(uv.x*fq*.31+5.,uv.y*.5))*.35+n(vec2(uv.x*7.,1.3))*.2;
 float F=mix(y0-soft-amp,y1+soft+amp,t);
 float edge=F+(st-.5)*2.*amp;
 float w=1.-smoothstep(edge-soft,edge+soft,uv.y);
 w*=smoothstep(0.,.06,t);w=mix(w,1.,smoothstep(.92,1.,t));
 w=mix(w,t,.12);
 float band=clamp(w*(1.-w)*4.,0.,1.);
 float d=disp*band*sin(3.14159*t);
 vec3 a=texture2D(A,uv+vec2(0.,d*.4)).rgb;
 vec3 b=texture2D(B,uv-vec2(0.,d)).rgb;
 vec3 c=mix(a,b,w);
 float hb=1.-smoothstep(.30,.46,lum(b)),ha=1.-smoothstep(.30,.46,lum(a));
 float line=exp(-pow((uv.y-edge)/(soft*.55),2.));
 c+=vec3(.95,.80,.55)*line*hb*(1.-ha)*rim*sin(3.14159*t);
 gl_FragColor=vec4(c,1.);}`;

    const src = root.dataset.src || 'img/laenge/';
    const fig = $('[data-hl-fig]', root), arch = $('.hl-arch', root);
    const layers = $$('.hl-layer', root), canvas = $('.hl-gl', root), gauge = $('.hl-gauge', root);
    const tape = $('.hl-tape', root), thumb = $('.hl-thumb', root), marks = $$('.hl-mark', root);
    const nameBox = $('.hl-name'), defEl = $('[data-hl-def]'), idxEl = $('[data-hl-idx]'), live = $('[data-hl-live]');
    const MY = marks.map(m => parseFloat(m.style.getPropertyValue('--my')) / 100);

    let value = Math.max(0, LENS.indexOf(L.length));
    let shown = -1, gl = null, tw = null, dirty = true, dragging = false, keyTimer = 0, touchStart = null;

    const valToY = v => { const i = Math.min(2, Math.floor(v)); return L.lerp(MY[i], MY[i + 1], v - i); };
    const yToVal = y => {
      if (y <= MY[0]) return 0;
      for (let i = 0; i < 3; i++) if (y <= MY[i + 1]) return i + (y - MY[i]) / (MY[i + 1] - MY[i]);
      return 3;
    };
    const easeIO = x => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    // Desktop: volle Auflösung, mobil die -s-Varianten
    const pickSrc = i => `${src}${LENS[i]}${L.vw >= 900 ? '' : '-s'}.webp`;
    layers.forEach((img, i) => { const s = pickSrc(i); if (img.getAttribute('src') !== s) img.setAttribute('src', s); });

    /* WebGL */
    function setupGL() {
      const g = canvas.getContext('webgl', { premultipliedAlpha: false, antialias: false });
      if (!g) return null;
      const sh = (type, code) => { const o = g.createShader(type); g.shaderSource(o, code); g.compileShader(o); if (!g.getShaderParameter(o, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(o)); return o; };
      let pr;
      try {
        pr = g.createProgram();
        g.attachShader(pr, sh(g.VERTEX_SHADER, VS)); g.attachShader(pr, sh(g.FRAGMENT_SHADER, FS)); g.linkProgram(pr);
        if (!g.getProgramParameter(pr, g.LINK_STATUS)) return null;
      } catch (err) { return null; }
      g.useProgram(pr);
      g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
      const loc = g.getAttribLocation(pr, 'p'); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
      const U = {}; ['A', 'B', 't', 'y0', 'y1', 'soft', 'amp', 'rim', 'disp', 'fq'].forEach(k => { U[k] = g.getUniformLocation(pr, k); });
      g.uniform1i(U.A, 0); g.uniform1i(U.B, 1);
      return { g, U, tex: [], ready: false };
    }
    function loadTextures() {
      const g = gl.g; let n = 0;
      LENS.forEach((_, i) => {
        const im = new Image(); im.decoding = 'async';
        im.onload = () => {
          if (!gl) return;
          const tx = g.createTexture(); g.bindTexture(g.TEXTURE_2D, tx);
          g.texImage2D(g.TEXTURE_2D, 0, g.RGB, g.RGB, g.UNSIGNED_BYTE, im);
          [g.TEXTURE_WRAP_S, g.TEXTURE_WRAP_T].forEach(pp => g.texParameteri(g.TEXTURE_2D, pp, g.CLAMP_TO_EDGE));
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
          gl.tex[i] = tx;
          if (++n === 4) { gl.ready = true; dirty = true; requestAnimationFrame(() => root.classList.add('is-gl')); }
        };
        im.onerror = () => { gl = null; root.classList.remove('is-gl'); dirty = true; };
        im.src = pickSrc(i);
      });
    }
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; root.classList.remove('is-gl'); dirty = true; });
    // Texturen erst laden, wenn das Instrument in die Nähe kommt
    const io = new IntersectionObserver(es => {
      if (!es.some(e => e.isIntersecting)) return;
      io.disconnect();
      gl = setupGL();
      if (gl) loadTextures();
    }, { rootMargin: '600px 0px' });
    io.observe(root);

    /* Rendern */
    function render() {
      const i = Math.min(2, Math.floor(value)), t = value - i, z = ZONES[i];
      const y = valToY(value);
      root.style.setProperty('--ty', `${(y * tape.clientHeight).toFixed(1)}px`);
      gauge.style.setProperty('--gy', `${(y * arch.clientHeight).toFixed(1)}px`);
      if (gl && gl.ready) {
        const { g, U } = gl, dpr = Math.min(devicePixelRatio || 1, 2);
        const w = Math.round(arch.clientWidth * dpr), hh = Math.round(arch.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; g.viewport(0, 0, w, hh); }
        g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, gl.tex[i]);
        g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, gl.tex[i + 1]);
        g.uniform1f(U.t, t); g.uniform1f(U.y0, z[0]); g.uniform1f(U.y1, z[1]);
        g.uniform1f(U.soft, P.soft * (i === 2 ? 1.4 : 1)); g.uniform1f(U.amp, P.amp * (i === 2 ? 1.5 : 1));
        g.uniform1f(U.rim, L.reduce ? 0 : P.rim); g.uniform1f(U.disp, L.reduce ? 0 : P.disp); g.uniform1f(U.fq, P.fq);
        g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      } else {
        // Fallback: Wachstums-Wipe per CSS-Maske + leichtes Crossfade
        const soft = i === 2 ? .09 : .065, F = (z[0] - soft) + (z[1] - z[0] + 2 * soft) * t, on = t > .001;
        layers.forEach((l, k) => {
          l.classList.toggle('is-base', k === i);
          l.classList.toggle('is-top', on && k === i + 1);
          if (!on || k !== i + 1) l.style.opacity = '';
        });
        if (on) {
          const top = layers[i + 1];
          top.style.setProperty('--f', `${(F * 100).toFixed(2)}%`);
          top.style.setProperty('--s', `${(soft * 100).toFixed(2)}%`);
          top.style.setProperty('--x', (.12 * t).toFixed(3));
          top.style.opacity = t > .92 ? 1 : Math.min(1, t / .08);
        }
      }
      const near = Math.round(value);
      marks.forEach((m, k) => m.classList.toggle('is-on', k === near));
      thumb.setAttribute('aria-valuenow', value.toFixed(2));
      thumb.setAttribute('aria-valuetext', Math.abs(value - near) < .02 ? `${LENS[near]} – ${DEF[LENS[near]]}` : `zwischen ${LENS[i]} und ${LENS[i + 1]}`);
      setName(near);
    }

    function setName(k) {
      if (k === shown) return;
      const dir = shown < 0 ? 0 : (k > shown ? 1 : -1);
      const old = nameBox.querySelector('span:not(.out-up):not(.out-down)');
      const s = document.createElement('span'); s.textContent = LENS[k];
      $$('.out-up,.out-down', nameBox).forEach(o => o.remove());
      if (dir && !L.reduce) {
        s.className = dir > 0 ? 'pre-up' : 'pre-down';
        nameBox.appendChild(s); void s.offsetWidth; s.className = '';
        if (old) { old.className = dir > 0 ? 'out-up' : 'out-down'; setTimeout(() => old.remove(), 850); }
      } else { nameBox.textContent = ''; nameBox.appendChild(s); }
      defEl.textContent = DEF[LENS[k]];
      if (idxEl) idxEl.textContent = `${ROMAN[k]} / IV`;
      fig.setAttribute('aria-label', `Porträt einer Frau mit Haarlänge ${LENS[k]}: ${DEF[LENS[k]]}`);
      shown = k;
    }

    /* Animation & Einrasten */
    function animateTo(target, dur) {
      target = L.clamp(target, 0, 3);
      if (L.reduce || Math.abs(target - value) < 1e-3) { tw = null; value = target; dirty = true; settle(); return; }
      tw = { from: value, to: target, t0: performance.now(), d: dur || 420 + Math.abs(target - value) * 380 };
    }
    function settle() {
      const k = Math.round(value);
      if (Math.abs(value - k) > .001) return;
      root.classList.remove('is-active');
      if (live) live.textContent = `Länge ${LENS[k]}: ${DEF[LENS[k]]}.`;
      L.setLength(LENS[k], 'lineal'); // no-op, wenn bereits gesetzt
    }
    const used = () => root.classList.add('was-used', 'is-active');

    /* Ziehen: Regler stufenlos (Maus/Touch/Stift); Tap auf das Band springt */
    const yFrom = e => { const r = tape.getBoundingClientRect(); return L.clamp((e.clientY - r.top) / r.height, 0, 1); };
    tape.addEventListener('pointerdown', e => {
      if (e.button !== 0 || (e.target.closest('.hl-mark button'))) return;
      if (e.target !== thumb && e.pointerType !== 'mouse') { touchStart = { x: e.clientX, y: e.clientY }; return; } // Touch aufs Band: Scrollen erlauben
      e.preventDefault(); used(); tw = null;
      dragging = true; root.classList.add('is-drag');
      try { tape.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (e.target !== thumb) animateTo(yToVal(yFrom(e)), 260);
      thumb.focus({ preventScroll: true });
    });
    tape.addEventListener('pointermove', e => { if (!dragging) return; tw = null; value = yToVal(yFrom(e)); dirty = true; });
    const end = e => {
      if (touchStart && e && e.type === 'pointerup' && Math.hypot(e.clientX - touchStart.x, e.clientY - touchStart.y) < 8) { used(); animateTo(Math.round(yToVal(yFrom(e)))); }
      touchStart = null;
      if (!dragging) return;
      dragging = false; root.classList.remove('is-drag');
      animateTo(Math.round(value), 520);
    };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => tape.addEventListener(ev, end));

    marks.forEach(m => m.querySelector('button').addEventListener('click', () => { used(); animateTo(+m.dataset.v); }));

    // Tastatur: Pfeile springen zur nächsten Marke, Shift+Pfeil stufenlos (rastet nach kurzer Pause ein)
    thumb.addEventListener('keydown', e => {
      const k = e.key, base = tw ? Math.round(value) : value;
      const down = k === 'ArrowDown' || k === 'ArrowRight', up = k === 'ArrowUp' || k === 'ArrowLeft';
      if (e.shiftKey && (down || up)) {
        e.preventDefault(); used(); tw = null;
        value = L.clamp(value + (down ? .1 : -.1), 0, 3); dirty = true;
        clearTimeout(keyTimer); keyTimer = setTimeout(() => animateTo(Math.round(value), 480), 900);
        return;
      }
      let next = null;
      if (down || k === 'PageDown') next = Math.floor(base + 1e-3) + 1;
      else if (up || k === 'PageUp') next = Math.ceil(base - 1e-3) - 1;
      else if (k === 'Home') next = 0; else if (k === 'End') next = 3;
      if (next === null) return;
      e.preventDefault(); used(); clearTimeout(keyTimer);
      animateTo(next);
    });

    // Wechsel aus dem Dock (oder anderen Kapiteln) → animiert mitmorphen
    document.addEventListener('lumen:length', e => {
      if (e.detail && e.detail.source === 'lineal') return;
      const i = LENS.indexOf(L.length);
      if (i < 0 || dragging) return;
      root.classList.add('is-active');
      animateTo(i);
    });
    L.onResize(() => { dirty = true; });

    render(); dirty = false;
    return () => {
      if (tw) {
        const x = L.clamp((performance.now() - tw.t0) / tw.d, 0, 1);
        value = tw.from + (tw.to - tw.from) * easeIO(x); dirty = true;
        if (x >= 1) { tw = null; value = Math.round(value * 1000) / 1000; dirty = true; render(); dirty = false; settle(); return; }
      }
      if (!dirty) return;
      const r = root.getBoundingClientRect();
      if (r.bottom < -100 || r.top > L.vh + 100) return; // unsichtbar: später zeichnen
      render(); dirty = false;
    };
  }
  const hlRoot = $('.hl-morph');
  const hlFrame = hlRoot ? initHairMorph(hlRoot) : null;

  /* ---------------- Frame ---------------- */
  L.onFrame(() => {
    if (hlFrame) hlFrame();
    const r = sec.getBoundingClientRect();
    if (r.bottom < -50 || r.top > L.vh + 50) return;

    // Scan-Linie
    let scan;
    if (L.reduce) scan = 1;
    else if (mqDesk.matches) scan = L.clamp(L.progress(split) * 1.12);
    else { const t = L.through(arch); scan = L.smooth(t, 0.22, 0.68); }
    if (Math.abs(scan - scanNow) > 0.0005) { scanNow = scan; arch.style.setProperty('--scan', scan.toFixed(4)); }

    // aktive Protokollzeile
    const sr = split.getBoundingClientRect();
    if (sr.bottom > 0 && sr.top < L.vh) {
      let best = -1, bd = 1e9;
      const mid = L.vh * 0.5;
      rows.forEach((row, i) => { const rr = row.getBoundingClientRect(); const d = Math.abs(rr.top + rr.height / 2 - mid); if (d < bd && rr.top < L.vh * 0.85) { bd = d; best = i; } });
      setActive(best < 0 ? 0 : best);
    }

  });
})();

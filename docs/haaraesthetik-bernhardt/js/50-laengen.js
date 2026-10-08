/* ==========================================================
   Kapitel V · 15:00 · Länge (Great Lengths)
   „Unsichtbar verbunden": Lupe mit Röntgenblick über dem Bild.
   - Lupe folgt der Maus mit Trägheit, ist auf Touch ziehbar,
     per Tap/Klick auf das Bild oder per Pfeiltasten bewegbar.
   - Beim ersten Erscheinen fährt sie eine kleine Einladungsbahn.
   - Hotspots zeigen ihre Aussage, sobald die Lupe darüberfährt.
   - Zähler „Bondings im Blick" aus den gemessenen Bonding-Punkten.
   ========================================================== */
(() => {
  const L = window.LUMEN;
  const root = document.getElementById('laengen');
  if (!L || !root) return;
  const $ = s => root.querySelector(s);
  const $$ = s => [...root.querySelectorAll(s)];

  const frame = $('.gl-frame'), lens = $('.gl-lens'), tag = $('.gl-tag'), view = $('.gl-view'), bImg = $('.gl-b'), aImg = $('.gl-a');
  const hotsWrap = $('.gl-hots'), hots = $$('.gl-hot'), tip = $('.gl-tip'), ticks = $('.gl-ticks');
  const listItems = $$('.gl-list li'), listBtns = $$('.gl-list button');
  const elCount = $('[data-gl-count]'), elFound = $('[data-gl-found]'), pips = $$('.gl-pips i');
  const tN = $('[data-gl-tn]'), tT = $('[data-gl-tt]'), tS = $('[data-gl-ts]');
  if (!frame || !lens || !bImg) return;

  const IW = 1536, IH = 1024, Z = 1.25;
  /* Bonding-Punkte, gemessen in Bild B (Anteile von Breite/Höhe) */
  const BONDS = [[.3092,.037],[.5874,.0467],[.5592,.056],[.3307,.0646],[.5281,.0715],[.3599,.0738],[.3883,.0765],[.4247,.0783],[.465,.0786],[.4993,.0786],[.2754,.1851],[.3006,.1954],[.5749,.2096],[.6088,.2111],[.3364,.2137],[.5412,.2223],[.377,.2271],[.4189,.233],[.5021,.2335],[.4634,.2375],[.2276,.3372],[.2546,.3464],[.2876,.362],[.3325,.3811],[.3679,.3987],[.5232,.4052],[.4445,.4058],[.4064,.4086],[.4821,.4091],[.2042,.5161],[.2343,.5188],[.2643,.5445],[.3044,.5639],[.3457,.573],[.4914,.5732],[.4396,.5781],[.3877,.5803],[.2677,.6808],[.2898,.7251],[.248,.728],[.3279,.7342],[.4709,.7387],[.378,.7408],[.4287,.7443]];
  const REST = { u: .395, v: .395 };
  /* Einladungsbahn (Bildkoordinaten), endet an der Ruhestelle */
  const TOUR = [[.25, .66], [.33, .52], [.47, .56], [.56, .40], [.52, .25], [.43, .30], [REST.u, REST.v]];
  const TOUR_MS = 5200;

  const DATA = listBtns.map(b => ({
    n: b.querySelector('.gl-ln').textContent,
    t: b.querySelector('.gl-lt').innerHTML,
    s: b.querySelector('.gl-ls').textContent,
  }));
  const HS = hots.map(h => ({ el: h, u: +h.dataset.u, v: +h.dataset.v, i: +h.dataset.i, x: 0, y: 0, vis: true }));

  /* Lünette: Teilstriche */
  if (ticks) {
    let s = '';
    for (let k = 0; k < 72; k++) {
      const a = k / 72 * Math.PI * 2, big = k % 6 === 0;
      const r0 = 46.2, r1 = big ? 49.8 : 48.2;
      s += `<line${big ? ' class="b"' : ''} x1="${(50 + Math.cos(a) * r0).toFixed(2)}" y1="${(50 + Math.sin(a) * r0).toFixed(2)}" x2="${(50 + Math.cos(a) * r1).toFixed(2)}" y2="${(50 + Math.sin(a) * r1).toFixed(2)}"/>`;
    }
    ticks.innerHTML = s;
  }

  /* ---------- Geometrie ---------- */
  let fw = 0, fh = 0, R = 0, dw = 0, dh = 0, ox = 0, oy = 0, archRy = 0, mobile = false;
  function layout() {
    fw = frame.offsetWidth; fh = frame.offsetHeight; R = lens.offsetWidth / 2;
    mobile = fw < 700 || L.vw < 900;
    const fx = mobile ? .42 : .5;
    const s = Math.max(fw / IW, fh / IH);
    dw = IW * s; dh = IH * s; ox = (fw - dw) * fx; oy = (fh - dh) * .5;
    aImg && aImg.style.setProperty('--fx', `${fx * 100}%`);
    bImg.style.width = `${dw * Z}px`; bImg.style.height = `${dh * Z}px`;
    archRy = fh * (mobile ? .24 : .30);
    HS.forEach((h, k) => {
      h.x = ox + h.u * dw; h.y = oy + h.v * dh;
      h.vis = h.x > 14 && h.x < fw - 14 && h.y > archTop(h.x) + 14 && h.y < fh - 14;
      h.el.hidden = !h.vis;
      h.el.style.setProperty('--x', `${h.x}px`); h.el.style.setProperty('--y', `${h.y}px`); h.el.style.setProperty('--k', k);
    });
    render(true);
  }
  /* obere Bogenkante (Ellipse) an Stelle x */
  function archTop(x) {
    const rx = fw / 2, dx = (x - rx) / rx;
    return archRy * (1 - Math.sqrt(Math.max(0, 1 - dx * dx)));
  }
  const toPx = (u, v) => ({ x: ox + u * dw, y: oy + v * dh });
  const toUV = (x, y) => ({ u: (x - ox) / dw, v: (y - oy) / dh });
  /* Lupenmitte im Bild halten */
  function clampUV(p) {
    let { x, y } = toPx(p.u, p.v);
    const m = R * (mobile ? 1.02 : .7);
    x = L.clamp(x, m, fw - m);
    y = L.clamp(y, archTop(x) + R * .55, fh - R * .45);
    return toUV(x, y);
  }

  /* ---------- Zustand ---------- */
  const cur = { u: TOUR[0][0], v: TOUR[0][1] }, tgt = { ...cur };
  let mode = 'idle';           // idle | tour | mouse | drag
  let ease = .12, visible = false, live = false, tourT0 = 0, toured = false;
  let pinned = -1, active = -2, lastCount = -1, dirty = true;
  const seen = new Set();
  if (L.reduce) { cur.u = tgt.u = REST.u; cur.v = tgt.v = REST.v; }

  const setTarget = (u, v, e) => { const c = clampUV({ u, v }); tgt.u = c.u; tgt.v = c.v; if (e) ease = e; dirty = true; };

  /* Catmull-Rom durch die Tour-Punkte */
  function tourAt(t) {
    const n = TOUR.length - 1, f = t * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
    const p0 = TOUR[Math.max(0, i - 1)], p1 = TOUR[i], p2 = TOUR[i + 1], p3 = TOUR[Math.min(n, i + 2)];
    const cr = (a, b, c, d) => .5 * ((2 * b) + (-a + c) * k + (2 * a - 5 * b + 4 * c - d) * k * k + (-a + 3 * b - 3 * c + d) * k * k * k);
    return { u: cr(p0[0], p1[0], p2[0], p3[0]), v: cr(p0[1], p1[1], p2[1], p3[1]) };
  }

  /* ---------- Darstellung ---------- */
  function render(force) {
    if (!fw) return;
    const { x, y } = toPx(cur.u, cur.v);
    lens.style.transform = `translate3d(${(x - R).toFixed(2)}px, ${(y - R).toFixed(2)}px, 0)`;
    bImg.style.transform = `translate3d(${(R - (x - ox) * Z).toFixed(2)}px, ${(R - (y - oy) * Z).toFixed(2)}px, 0)`;
    const up = y + R + (mobile ? 56 : 70) > fh;
    if (up !== lens._up) { lens._up = up; lens.classList.toggle('tag-up', up); }
    if (tag) { /* Etikett im Bild halten */
      const tw = tag.offsetWidth / 2, pad = 10;
      const dx = Math.min(0, fw - pad - (x + tw)) + Math.max(0, pad - (x - tw));
      if (Math.abs(dx - (tag._dx || 0)) > .5) { tag._dx = dx; tag.style.setProperty('--tdx', `${dx.toFixed(1)}px`); }
    }
    if (ticks) ticks.style.transform = `rotate(${(cur.u * 140 + cur.v * 60).toFixed(2)}deg)`;

    /* Bondings im Blick */
    const rr = R / Z;
    let c = 0;
    for (const b of BONDS) { const dx = (b[0] - cur.u) * dw, dy = (b[1] - cur.v) * dh; if (dx * dx + dy * dy < rr * rr) c++; }
    if (c !== lastCount && elCount) { lastCount = c; elCount.textContent = String(c).padStart(2, '0'); }

    /* nächster Hotspot unter der Lupe */
    let best = -1, bd = (R * .78) ** 2;
    for (const h of HS) { if (!h.vis) continue; const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d < bd) { bd = d; best = h.i; } }
    if (best < 0 && pinned >= 0) best = pinned;
    if (live && (best !== active || force)) setActive(best);
    if (active >= 0 && !mobile) placeTip(x, y);
  }

  function setActive(i) {
    active = i;
    HS.forEach(h => h.el.classList.toggle('is-active', h.i === i));
    listItems.forEach((li, k) => li.classList.toggle('is-active', k === i));
    if (i < 0) { tip && tip.classList.remove('is-on'); return; }
    if (!seen.has(i) && mode !== 'tour') {
      seen.add(i);
      HS[i] && HS[i].el.classList.add('is-seen');
      if (elFound) elFound.textContent = seen.size;
      pips.forEach((p, k) => p.classList.toggle('on', k < seen.size));
    }
    if (tip && DATA[i]) {
      tN.textContent = DATA[i].n; tT.innerHTML = DATA[i].t; tS.textContent = DATA[i].s;
      tip.classList.add('is-on');
    }
  }
  /* Karte neben der Lupe, auf der Seite mit mehr Platz */
  function placeTip(x, y) {
    if (!tip) return;
    const w = tip.offsetWidth, h = tip.offsetHeight, gap = 34;
    const right = x + R + gap + w < fw - 8;
    const tx = right ? x + R + gap : x - R - gap - w;
    const ty = L.clamp(y - h / 2, archTop(right ? tx + w : tx) + 8, fh - h - 12);
    tip.style.setProperty('--tx', `${tx.toFixed(1)}px`);
    tip.style.setProperty('--ty', `${ty.toFixed(1)}px`);
  }

  /* ---------- Loop ---------- */
  L.onFrame(now => {
    if (!visible && !dirty) return;
    if (mode === 'tour') {
      const t = L.clamp((now - tourT0) / TOUR_MS);
      const e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const p = clampUV(tourAt(e));
      tgt.u = p.u; tgt.v = p.v; ease = .2;
      if (t >= 1) { mode = 'idle'; requestAnimationFrame(() => { active = -2; dirty = true; }); }
    }
    const k = L.reduce ? 1 : ease;
    const du = tgt.u - cur.u, dv = tgt.v - cur.v;
    if (Math.abs(du) > 1e-5 || Math.abs(dv) > 1e-5 || dirty) {
      cur.u += du * k; cur.v += dv * k;
      dirty = false;
      render();
    }
  });

  /* ---------- Sichtbarkeit / Intro ---------- */
  const io = new IntersectionObserver(es => es.forEach(en => {
    visible = en.isIntersecting;
    if (visible && !live && en.intersectionRatio > .45) start();
  }), { threshold: [0, .45, .7] });
  io.observe(frame);
  function start() {
    live = true;
    frame.classList.add('is-ready');
    hotsWrap && hotsWrap.classList.add('is-ready');
    lens.classList.add('is-live');
    render(true);
    if (L.reduce) { setTarget(REST.u, REST.v, 1); return; }
    setTimeout(() => {
      if (mode !== 'idle' || toured) return;
      toured = true; mode = 'tour'; tourT0 = performance.now();
    }, 700);
  }

  /* ---------- Maus ---------- */
  const local = e => { const r = frame.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  frame.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || mode === 'drag' || !live) return;
    const p = local(e), uv = toUV(p.x, p.y);
    mode = 'mouse'; toured = true; pinned = -1;
    setTarget(uv.u, uv.v, .11);
  });
  frame.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && mode === 'mouse') mode = 'idle'; });

  /* ---------- Touch: Lupe ziehen, Bild antippen ---------- */
  let grab = null;
  lens.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'mouse') return; // Maus steuert per Bewegung
    const p = local(e), c = toPx(cur.u, cur.v);
    grab = { id: e.pointerId, dx: c.x - p.x, dy: c.y - p.y };
    lens.setPointerCapture(e.pointerId);
    mode = 'drag'; toured = true; pinned = -1;
    e.preventDefault();
  });
  lens.addEventListener('pointermove', e => {
    if (!grab || e.pointerId !== grab.id) return;
    const p = local(e), uv = toUV(p.x + grab.dx, p.y + grab.dy);
    setTarget(uv.u, uv.v, .35);
  });
  const endGrab = e => { if (grab && e.pointerId === grab.id) { grab = null; mode = 'idle'; } };
  lens.addEventListener('pointerup', endGrab);
  lens.addEventListener('pointercancel', endGrab);

  /* Tippen aufs Bild (nicht Lupe/Hotspot) setzt die Lupe dorthin */
  let tap = null;
  frame.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' && !e.target.closest('.gl-lens, .gl-hot')) tap = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  frame.addEventListener('pointerup', e => {
    if (!tap || e.pointerType === 'mouse') return;
    const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y), dt = performance.now() - tap.t;
    tap = null;
    if (moved > 10 || dt > 500 || !live) return;
    const p = local(e), uv = toUV(p.x, p.y);
    mode = 'idle'; toured = true; pinned = -1;
    setTarget(uv.u, uv.v, .1);
  });

  /* ---------- Hotspots & Liste ---------- */
  function goTo(i) {
    const h = HS[i]; if (!h) return;
    mode = 'idle'; toured = true; pinned = i;
    setTarget(h.u, h.v, .09);
  }
  hots.forEach(h => {
    h.addEventListener('click', () => goTo(+h.dataset.i));
    h.addEventListener('focus', () => goTo(+h.dataset.i));
    h.addEventListener('mouseenter', () => { pinned = +h.dataset.i; dirty = true; });
  });
  listBtns.forEach(b => b.addEventListener('click', () => goTo(+b.dataset.i)));

  /* ---------- Tastatur ---------- */
  lens.addEventListener('keydown', e => {
    const step = e.shiftKey ? .08 : .03;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    mode = 'idle'; toured = true; pinned = -1;
    setTarget(tgt.u + d[0], tgt.v + d[1], .16);
  });

  /* ---------- Start ---------- */
  layout();
  L.onResize(layout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  if ('ResizeObserver' in window) new ResizeObserver(layout).observe(frame);
})();

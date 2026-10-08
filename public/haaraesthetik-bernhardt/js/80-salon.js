/* VIII · Blaue Stunde · Salon – „Rundgang nach Feierabend“ (Desktop: horizontale, gepinnte Spur · Mobil: vertikale Abfolge) */
(() => {
  const L = window.LUMEN;
  const sec = document.getElementById('salon');
  if (!L || !sec) return;
  const { clamp, lerp, smooth } = L;

  const pin = sec.querySelector('.sl-pin');
  const sticky = sec.querySelector('.sl-sticky');
  const track = sec.querySelector('.sl-track');
  const allPanels = [...track.querySelectorAll('.sl-panel')];
  const panels = allPanels.filter(p => p.dataset.label);
  const stepsEl = sec.querySelector('.sl-steps');
  const curEl = sec.querySelector('.sl-cur');
  const labEl = sec.querySelector('.sl-lab');
  const totEl = sec.querySelector('.sl-tot');
  const pad = n => String(n).padStart(2, '0');
  // Mobil: kein horizontaler Pin – Panels stehen untereinander (CSS), Effekte pro Panel (hier)
  const mqV = matchMedia('(max-width: 860px)');
  let vertical = mqV.matches;

  /* ---------- Fortschritts-Schritte ---------- */
  totEl.textContent = pad(panels.length);
  stepsEl.innerHTML = panels.map((p, i) => `<li><button type="button" data-i="${i}"><span>${pad(i + 1)}</span>${p.dataset.label}</button></li>`).join('');
  const stepLis = [...stepsEl.children];
  stepsEl.addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(+b.dataset.i); });

  /* ---------- Zitat: Wörter einzeln, damit sie im Vorbeiziehen aufleuchten ---------- */
  const words = [];
  sec.querySelectorAll('.sl-q .sl-l1, .sl-q .sl-l2').forEach(line => {
    const parts = line.textContent.split(/\s+/).filter(Boolean);
    line.textContent = '';
    parts.forEach((w, i) => {
      const s = document.createElement('span');
      s.className = 'qw' + (/^art/.test(w) ? ' pearl-w' : '');
      s.textContent = w;
      line.appendChild(s);
      if (i < parts.length - 1) line.appendChild(document.createTextNode(' '));
      words.push(s);
    });
  });

  /* ---------- Zahlen ---------- */
  const nums = [...sec.querySelectorAll('.sl-n[data-count]')].map(el => ({ el, to: +el.dataset.count, from: +(el.dataset.from || 0) }));
  let countT0 = -1;
  if (!L.reduce) nums.forEach(n => (n.el.textContent = n.from));

  /* ---------- Vermessen ---------- */
  const K = () => (L.vw < 861 ? 0.82 : 0.62); // vertikale Scroll-Pixel pro horizontalem Pixel
  let dist = 0, vSpan = 0, lastW = 0, offs = [], stickyH = 0;
  function measure() {
    lastW = innerWidth;
    if (vertical) { pin.style.height = ''; track.style.transform = ''; dist = 0; vSpan = 0; return; }
    const prev = track.style.transform;
    track.style.transform = 'none';
    const tr = track.getBoundingClientRect();
    offs = allPanels.map(el => ({ el, left: el.offsetLeft, w: el.offsetWidth }));
    words.forEach(w => { const r = w.getBoundingClientRect(); w._x = r.left - tr.left + r.width / 2; });
    arches.forEach(a => { const r = a.getBoundingClientRect(); a._x = r.left - tr.left + r.width / 2; });
    dist = Math.max(0, Math.ceil(track.scrollWidth - sticky.clientWidth));
    stickyH = sticky.offsetHeight;
    vSpan = Math.round(dist * K());
    pin.style.height = `${stickyH + vSpan}px`;
    track.style.transform = prev;
  }
  const arches = [...sec.querySelectorAll('.sl-a')];

  function pinTopAbs() { return pin.getBoundingClientRect().top + (L.lenis ? L.lenis.scroll : scrollY); }
  function go(i, immediate) {
    const o = offs[allPanels.indexOf(panels[i])];
    if (!o || !dist) return;
    const target = clamp((o.left - (i ? L.vw * 0.04 : 0)) / dist);
    const y = Math.round(pinTopAbs() + target * vSpan) + 1;
    if (L.lenis) L.lenis.scrollTo(y, immediate ? { immediate: true, force: true } : { duration: 1.6, easing: t => 1 - Math.pow(1 - t, 4) });
    else scrollTo({ top: y, behavior: immediate || L.reduce ? 'auto' : 'smooth' });
  }

  /* Tastatur: Fokus in einem Panel außerhalb des Bildes → dorthin scrollen */
  sticky.addEventListener('focusin', e => {
    if (vertical) return;
    sticky.scrollLeft = 0;
    const pnl = e.target.closest('.sl-panel');
    const i = panels.indexOf(pnl);
    if (i < 0) return;
    const o = offs[allPanels.indexOf(pnl)];
    const sx = o.left + curX;
    if (sx < 0 || sx + Math.min(o.w, L.vw) > L.vw) go(i, true);
  });

  /* ---------- Layered Parallax (falls Ebenen vorhanden) ---------- */
  const scene = sec.querySelector('.sl-scene');
  const flat = sec.querySelector('.sl-flat');
  let layers = null; // [{el, depth, scale}]
  const LAYER_BASE = 'img/layers/salon/';
  function tryLayers() {
    const small = L.vw <= 900;
    Promise.resolve({ ok: true }) /* Ebenen fertig, siehe img/layers/README.md */
      .then(r => {
        if (!r.ok) throw 0;
        const pick = name => `${LAYER_BASE}${name}${small ? '-s' : ''}.webp`;
        const defs = [
          // Tiefen laut README (bg 0.1 · mid 0.35 · fg 1.0), relativ zum Interieur gerechnet
          { name: 'bg', k: -0.14, m: -10, my: -6, scale: 1.24 }, // Landschaft: nur durchs Glas sichtbar, zieht nach
          { name: 'mid', k: 0, m: 4, my: 3, scale: 1.08 },        // Interieur mit transparenter Glasfront
          { name: 'fg', k: 0.05, m: 16, my: 9, scale: 1.14 },     // vorderster Stuhl: eilt voraus (begrenzt)
        ];
        return Promise.all(defs.map(d => new Promise((res, rej) => {
          const img = new Image();
          img.className = `sl-layer sl-layer-${d.name}`;
          img.alt = ''; img.decoding = 'async';
          img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => res({ ...d, el: img }));
          img.onerror = rej;
          img.src = pick(d.name);
        })));
      })
      .then(ls => {
        ls.forEach(l => { l.el.setAttribute('aria-hidden', 'true'); scene.appendChild(l.el); });
        layers = ls;
        sec.dataset.layers = 'on';
        requestAnimationFrame(() => scene.classList.add('has-layers'));
      })
      .catch(() => { /* kein Problem: flaches Bild mit normaler Parallax */ });
  }
  // erst laden, wenn der Salon in Reichweite kommt
  const near = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { near.disconnect(); tryLayers(); } }, { rootMargin: '150% 0px' });
  near.observe(sec);

  /* ---------- Frame ---------- */
  let curX = 0, active = -1, mx = 0, my = 0;
  function setActive(i) {
    if (i === active) return;
    active = i;
    stepLis.forEach((li, k) => li.classList.toggle('on', k === i));
    curEl.textContent = pad(i + 1);
    labEl.textContent = panels[i].dataset.label;
  }
  setActive(0);

  L.onFrame((t) => {
    const r = pin.getBoundingClientRect();
    if (r.bottom < -40 || r.top > L.vh + 40) return;
    if (vertical) { mobileFrame(t); return; }
    const p = clamp(-r.top / Math.max(1, r.height - stickyH));
    curX = -p * dist;
    track.style.transform = `translate3d(${curX.toFixed(1)}px,0,0)`;
    sticky.style.setProperty('--slp', p.toFixed(4));
    const vw = L.vw;

    // aktives Panel
    let ai = 0;
    panels.forEach((pn, i) => { const o = offs[allPanels.indexOf(pn)]; if (o && o.left + curX < vw * 0.42) ai = i; });
    setActive(ai);

    // Raum-Parallax (horizontal + Annäherung)
    const room = offs[0];
    if (room && room.left + curX > -room.w) {
      const sx = room.left + curX;            // 0 … -Breite
      const approach = clamp(r.top / L.vh);   // 1 beim Hereinkommen, 0 gepinnt
      if (L.fine && !L.reduce) { mx = lerp(mx, L.mouse.nx, 0.06); my = lerp(my, L.mouse.ny, 0.06); }
      if (layers) {
        const w = scene.offsetWidth || 1, h = scene.offsetHeight || 1;
        for (const l of layers) {
          const ox = w * (l.scale - 1) / 2, oy = h * (l.scale - 1) / 2;
          const dx = L.reduce ? 0 : clamp(sx * l.k + mx * l.m * 2, -ox, ox);
          const dy = L.reduce ? 0 : clamp(approach * 70 * (l.k + 0.2) + my * l.my * 2, -oy, oy);
          l.el.style.transform = `translate3d(${dx.toFixed(1)}px,${dy.toFixed(1)}px,0) scale(${l.scale})`;
        }
      } else if (!L.reduce) {
        const w = flat.offsetWidth || 1;
        const fx = clamp(-sx * 0.1 + mx * 18, -w * 0.08, w * 0.08);
        flat.style.setProperty('--fx', `${fx.toFixed(1)}px`);
        flat.style.setProperty('--fy', `${(approach * 50 + my * 10).toFixed(1)}px`);
      }
    }

    // Zahlen zählen hoch, sobald das Panel ins Bild fährt
    const np = offs[allPanels.indexOf(sec.querySelector('.sl-nums'))];
    if (np && countT0 < 0 && np.left + curX < vw * 0.72 && p > 0) {
      countT0 = t;
      if (L.reduce) nums.forEach(n => (n.el.textContent = n.to));
    }
    if (countT0 >= 0 && !L.reduce) {
      const k = clamp((t - countT0) / 1900);
      if (k <= 1 && !nums.done) {
        nums.forEach((n, i) => {
          const e = 1 - Math.pow(1 - clamp((t - countT0 - i * 120) / 1700), 4);
          n.el.textContent = Math.round(lerp(n.from, n.to, e));
        });
        if (k === 1 && t - countT0 > 2300) nums.done = true;
      }
    }

    // Zitat: Wörter leuchten auf, wenn sie die Bildmitte erreichen
    for (const w of words) {
      const sx = w._x + curX;
      if (sx > vw * 1.2 || sx < -vw * 0.4) continue;
      const o = L.reduce ? 1 : 0.14 + 0.86 * smooth(sx, vw * 0.9, vw * 0.45);
      const s = o.toFixed(3);
      if (w._o !== s) { w._o = s; w.style.setProperty('--o', s); }
    }

    // Touch: der Bogen in der Bildmitte füllt sich mit Licht
    if (!L.fine) {
      for (const a of arches) {
        const sx = a._x + curX;
        const on = Math.abs(sx - vw / 2) < vw * 0.2;
        if (a._on !== on) { a._on = on; a.classList.toggle('lit', on); }
      }
    }
  });

  /* ---------- Mobil: vertikale Abfolge ---------- */
  const room = sec.querySelector('.sl-window');
  const numsPanel = sec.querySelector('.sl-nums');
  const quote = sec.querySelector('.sl-quote');
  const archRow = sec.querySelector('.sl-arches');
  const swipeN = sec.querySelector('.sl-swipe-n');
  const MRV = ['.sl-time', '.sl-nums .sl-k', '.sl-num', '.sl-mono', '.sl-bio-b', '.sl-quote .sl-k', '.sl-q footer', '.sl-team-head', '.sl-swipe', '.sl-join-k', '.sl-card', '.sl-end'];
  let numsSeen = false;
  const mio = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('is-in');
    mio.unobserve(e.target);
  }), { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  const nio = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { numsSeen = true; nio.disconnect(); } }, { threshold: 0.35 });
  function setupVertical() {
    if (L.reduce) return;
    sec.querySelectorAll(MRV.join(',')).forEach(el => {
      if (el.classList.contains('is-in')) return;
      el.classList.add('sl-mrv');
      // gestaffelt innerhalb eines Panels
      const sib = [...el.parentElement.children].filter(x => x.matches(MRV.join(',')));
      el.style.setProperty('--md', `${Math.min(sib.indexOf(el), 4) * 0.09}s`);
      mio.observe(el);
    });
    nio.observe(numsPanel);
  }
  function teardownVertical() {
    sec.querySelectorAll('.sl-mrv').forEach(el => el.classList.add('is-in'));
    words.forEach(w => { w._o = null; });
    arches.forEach(a => { a._on = false; a.classList.remove('lit'); });
  }
  // Team-Bögen: der vorn eingerastete Bogen leuchtet, Zähler zeigt die Position
  let litIdx = -1;
  function syncArches() {
    if (!vertical || !archRow) return;
    const max = archRow.scrollWidth - archRow.clientWidth;
    const x0 = archRow.getBoundingClientRect().left + parseFloat(getComputedStyle(archRow).paddingLeft || 0);
    let best = 0, bd = 1e9;
    arches.forEach((a, i) => { const d = Math.abs(a.getBoundingClientRect().left - x0); if (d < bd) { bd = d; best = i; } });
    if (archRow.scrollLeft >= max - 4 && max > 0) best = arches.length - 1;
    if (best === litIdx) return;
    litIdx = best;
    arches.forEach((a, i) => { const on = i === best; a._on = on; a.classList.toggle('lit', on); });
    if (swipeN) swipeN.textContent = pad(best + 1);
  }
  if (archRow) archRow.addEventListener('scroll', syncArches, { passive: true });

  function mobileFrame(t) {
    const vh = L.vh;
    // Raum: sanfte vertikale Parallax im Bogenfenster
    if (room && !L.reduce) {
      const rr = room.getBoundingClientRect();
      if (rr.bottom > 0 && rr.top < vh) {
        const k = 0.5 - clamp((vh - rr.top) / (rr.height + vh));
        if (layers) {
          const h = scene.offsetHeight || 1;
          for (const l of layers) { const oy = h * (l.scale - 1) / 2; l.el.style.transform = `translate3d(0,${clamp(k * 90 * (l.k + 0.35), -oy, oy).toFixed(1)}px,0) scale(${l.scale})`; }
        } else { flat.style.setProperty('--fx', '0px'); flat.style.setProperty('--fy', `${(k * 60).toFixed(1)}px`); }
      }
    }
    // Zahlen zählen hoch, sobald das Panel im Bild ist
    if (numsSeen && countT0 < 0) { countT0 = t; if (L.reduce) nums.forEach(n => (n.el.textContent = n.to)); }
    if (countT0 >= 0 && !L.reduce && !nums.done) {
      nums.forEach((n, i) => {
        const e = 1 - Math.pow(1 - clamp((t - countT0 - i * 160) / 1700), 4);
        n.el.textContent = Math.round(lerp(n.from, n.to, e));
      });
      if (t - countT0 > 2400) nums.done = true;
    }
    // Zitat: Wörter leuchten auf, wenn sie zur Bildmitte aufsteigen
    const qr = quote.getBoundingClientRect();
    if (qr.bottom > 0 && qr.top < vh) {
      for (const w of words) {
        const y = w.getBoundingClientRect().top;
        const s = (L.reduce ? 1 : 0.16 + 0.84 * smooth(y, vh * 0.86, vh * 0.52)).toFixed(3);
        if (w._o !== s) { w._o = s; w.style.setProperty('--o', s); }
      }
    }
    if (litIdx < 0) syncArches();
  }

  function onMode() {
    const v = mqV.matches;
    if (v === vertical) return;
    vertical = v;
    if (vertical) { setupVertical(); litIdx = -1; } else teardownVertical();
    measure();
  }
  if (mqV.addEventListener) mqV.addEventListener('change', onMode); else mqV.addListener(onMode);
  if (vertical) setupVertical();

  /* ---------- Start & Resize ---------- */
  measure();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  addEventListener('load', measure);
  L.onResize(() => { if (L.fine || innerWidth !== lastW) measure(); });
})();

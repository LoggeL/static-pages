/* Kapitel VI · 16:30 · Hochzeit – Goldene Stunde, Editorial */
(() => {
  const L = window.LUMEN;
  const sec = document.getElementById('hochzeit');
  if (!L || !sec) return;
  const $ = (s, r = sec) => r.querySelector(s);
  const $$ = (s, r = sec) => [...r.querySelectorAll(s)];
  const reduce = L.reduce;
  if (reduce) sec.classList.add('hz-reduce');

  /* ================= Eröffnung ================= */
  const open = $('.hz-open'), stage = $('.hz-stage'), scene = $('.hz-scene');
  const copy = $('.hz-copy'), timeplane = $('.hz-timeplane');
  // Tiefe d: 0 = Horizont (Weinberge), 1 = Braut. Uhrzeit liegt dazwischen.
  let planes = [{ el: $('.hz-flat'), d: 0.35, s: 1 }, { el: timeplane, d: 0.5, s: 1 }];

  new IntersectionObserver((es, o) => es.forEach(e => { if (e.isIntersecting) { sec.classList.add('hz-on'); o.disconnect(); } }), { threshold: 0.35 }).observe(stage);

  // Tiefen/Überskalierung laut img/layers/README.md: bg = Weinberge, mid = Kapelle, fg = Braut
  const DEPTH = { bg: [0.12, 1.1], mid: [0.4, 1.06], fg: [0.9, 1] };
  function loadLayers(scene) {
    const base = `img/layers/${scene}/`, suf = L.vw <= 900 ? '-s' : '';
    return Promise.resolve({ ok: true }) /* Ebenen fertig, siehe img/layers/README.md */.then(r => {
      if (!r.ok) throw new Error('keine Ebenen');
      return Promise.all(['bg', 'mid', 'fg'].map(n => new Promise((res, rej) => {
        const i = new Image(); i.decoding = 'async'; i.alt = ''; i.src = base + n + suf + '.webp';
        i.onload = () => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()).then(() => res([n, i]));
        i.onerror = rej;
      })));
    });
  }
  let asked = false;
  const lio = new IntersectionObserver(es => {
    if (asked || !es.some(e => e.isIntersecting)) return;
    asked = true; lio.disconnect();
    loadLayers('hochzeit').then(list => {
      const stack = list.map(([n, img]) => {
        const w = document.createElement('div');
        w.className = `hz-l is-stack hz-l-${n}`; w.setAttribute('aria-hidden', 'true');
        w.appendChild(img); scene.appendChild(w);
        return { el: w, d: DEPTH[n][0], s: DEPTH[n][1] };
      });
      planes = [...stack, { el: timeplane, d: 0.5, s: 1 }];
      // Ausklang: dieselbe Kapelle, aber leer – nur Landschaft und Innenraum, die Braut ist gegangen
      const dw = $('.hz-dusk-win'), night = $('.hz-dusk-night');
      list.filter(([n]) => n !== 'fg').forEach(([n, img]) => {
        const c = img.cloneNode(); c.className = `hz-dl hz-dl-${n}`; c.alt = ''; c.setAttribute('aria-hidden', 'true');
        dw.insertBefore(c, night);
      });
      requestAnimationFrame(() => dw.classList.add('has-layers'));
      requestAnimationFrame(() => scene.classList.add('has-layers'));
    }).catch(() => { /* Fallback: flaches Bild */ });
  }, { rootMargin: '150% 0px' });
  lio.observe(sec);

  let openVis = false;
  new IntersectionObserver(es => es.forEach(e => (openVis = e.isIntersecting)), { rootMargin: '5% 0px' }).observe(open);
  let mx = 0, my = 0;

  /* ================= Editorial-Liste ================= */
  const list = $('.hz-list'), rows = $$('.hz-row'), wrap = $('.hz-list-wrap');
  const peek = $('.hz-peek'), peekImgs = $$('.hz-peek img'), peekN = $('.hz-peek-n');
  rows.forEach((row, i) => {
    const s = row.style;
    const vars = ['--fx', '--fy', '--z'].map(k => [k, s.getPropertyValue(k)]);
    vars.forEach(([k, v]) => { peekImgs[i] && peekImgs[i].style.setProperty(k, v); const im = $('.hz-d-img img', row); im && im.style.setProperty(k, v); });
  });
  const hoverMode = () => L.fine && L.vw >= 900;
  let active = -1;
  function setActive(i) {
    if (i === active) return;
    active = i;
    rows.forEach((r, k) => {
      const on = k === i;
      r.classList.toggle('open', on);
      $('.hz-btn', r).setAttribute('aria-expanded', String(on));
    });
    list.classList.toggle('has-active', i > -1);
    peekImgs.forEach((im, k) => im.classList.toggle('on', k === i));
    if (i > -1) peekN.textContent = String(i + 1).padStart(2, '0');
    peek.classList.toggle('show', i > -1 && hoverMode());
  }
  rows.forEach((row, i) => {
    const btn = $('.hz-btn', row);
    // echte Mausbewegung statt mouseenter: verhindert Kaskaden, wenn sich Zeilen beim Aufklappen verschieben
    row.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && hoverMode() && active !== i) setActive(i); });
    btn.addEventListener('click', () => {
      if (hoverMode()) { setActive(i); return; }       // Desktop: Hover regelt, Klick bestätigt
      setActive(active === i ? -1 : i);                // Touch: Akkordeon
    });
    btn.addEventListener('focus', () => {
      if (!hoverMode() || btn.matches(':hover')) return;
      setActive(i);
      const rr = row.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      seeded = false;
    });
  });
  list.addEventListener('mouseleave', () => { if (hoverMode()) setActive(-1); });
  list.addEventListener('focusout', e => { if (hoverMode() && !list.contains(e.relatedTarget)) setActive(-1); });

  let px = 0, py = 0, tx = 0, ty = 0, rot = 0, listVis = false, seeded = false;
  new IntersectionObserver(es => es.forEach(e => (listVis = e.isIntersecting))).observe(list);

  /* ================= Ausklang ================= */
  const dusk = $('.hz-dusk-win'), sun = $('[data-hz-sun]'), glow = $('[data-hz-glow]');
  let duskVis = false, lastSun = '';
  new IntersectionObserver(es => es.forEach(e => (duskVis = e.isIntersecting))).observe(dusk);

  /* ================= Frame ================= */
  L.onFrame(() => {
    if (openVis) {
      const p = L.progress(open);
      if (!reduce) {
        mx = L.lerp(mx, L.fine ? L.mouse.nx : 0, 0.05);
        my = L.lerp(my, L.fine ? L.mouse.ny : 0, 0.05);
      }
      const vh = L.vh;
      for (const pl of planes) {
        const d = pl.d;
        const s = pl.s * (reduce ? 1 : 1 + p * (0.03 + d * 0.11));
        // Braut (Kleid endet am unteren Bildrand) nur so weit heben, wie Rand + Zoom erlauben
        const y = reduce ? 0 : -p * vh * Math.min(0.02 + d * 0.09, 0.075);
        const x = -mx * (8 + d * 34);
        const yy = y - my * (4 + d * 16);
        pl.el.style.transform = `translate3d(${x.toFixed(2)}px, ${yy.toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
      }
      if (!reduce) {
        copy.style.transform = `translate3d(0, ${(-p * vh * 0.12).toFixed(1)}px, 0)`;
        copy.style.opacity = (1 - L.smooth(p, 0.42, 0.62)).toFixed(3);
      }
    }
    if (duskVis) {
      const t = L.through(dusk);
      dusk.style.setProperty('--night', (0.12 + 0.8 * L.smooth(t, 0.25, 0.85)).toFixed(3));
      if (!reduce) dusk.style.setProperty('--dy', `${((0.5 - t) * L.vh * 0.12).toFixed(1)}px`);
      // Sonnenstand statt Uhrzeit: die Sonne sinkt mit dem Scrollen hinter den Horizont
      if (sun) {
        const a = (L.reduce ? 18 : 46 - 62 * L.smooth(t, 0.12, 0.78)) * Math.PI / 180;
        const cx = (120 + 96 * Math.cos(a)).toFixed(1), cy = (96 - 96 * Math.sin(a)).toFixed(1);
        const k = cx + cy;
        if (k !== lastSun) { lastSun = k; sun.setAttribute('cx', cx); sun.setAttribute('cy', cy); glow.setAttribute('cx', cx); glow.setAttribute('cy', cy); }
      }
    }
    if (listVis && active > -1 && hoverMode()) {
      const wr = wrap.getBoundingClientRect();
      const hover = list.matches(':hover');
      // Vorschau im freien Raum rechts neben der aufgeklappten Beschreibung verankern (überdeckt keinen Text), Maus nur als leichte Parallax
      const dp = $('.hz-d p', rows[active]);
      if (dp) {
        const pr = dp.getBoundingClientRect();
        const ax = Math.min(pr.right - wr.left + L.vw * 0.05, wr.width - peek.offsetWidth - 60);
        const ay = pr.top - wr.top - 6;
        const mx = hover ? L.clamp((L.mouse.x - wr.left - ax) * 0.04, -18, 18) : 0;
        const my = hover ? L.clamp((L.mouse.y - wr.top - ay) * 0.03, -10, 10) : 0;
        tx = ax + mx; ty = ay + my;
      }
      if (!seeded || reduce) { px = tx; py = ty; seeded = true; }
      const k = 0.11;
      const dx = (tx - px) * k;
      px += dx; py += (ty - py) * k;
      rot = L.lerp(rot, L.clamp(dx * 0.35, -8, 8), 0.12);
      peek.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg)`;
    } else if (active < 0) seeded = false;
  });
})();

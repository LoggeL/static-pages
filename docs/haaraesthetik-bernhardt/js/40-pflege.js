/* ==========================================================
   Kapitel IV · Mittagsruhe · Pflege · Hårtræt
   Stacking-Cards über Kaustik-Bühne, Haartester-Scan.
   ========================================================== */
(() => {
  const L = window.LUMEN;
  const sec = document.getElementById('pflege');
  if (!L || !sec) return;
  const $ = (s, r = sec) => r.querySelector(s);
  const $$ = (s, r = sec) => [...r.querySelectorAll(s)];

  const stage = $('.pf-stage'), bgImg = $('.pf-bg img'), veil = $('.pf-veil');
  const brand = $('.pf-brand-in'), brandBox = $('.pf-brand');
  const cards = $$('.pf-card');
  const shades = cards.map(c => c.querySelector('.pf-c-shade'));
  const frames = cards.map(c => c.querySelector('.pf-frame'));
  // Maus-Tilt ±3° (nur Desktop mit Maus)
  const tiltOn = L.fine && !L.reduce;
  const tilt = cards.map(() => ({ x: 0, y: 0, tx: 0, ty: 0 }));
  if (tiltOn) cards.forEach((c, i) => {
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect();
      tilt[i].ty = ((e.clientX - r.left) / r.width - 0.5) * 6;
      tilt[i].tx = -((e.clientY - r.top) / r.height - 0.5) * 6;
    }, { passive: true });
    c.addEventListener('pointerleave', () => { tilt[i].tx = 0; tilt[i].ty = 0; });
  });
  let tops = [];
  const measure = () => { tops = cards.map(c => parseFloat(getComputedStyle(c).top) || 0); };
  measure();
  L.onResize && L.onResize(measure);

  // Karte „on“, sobald sie oben anliegt (für Zeichnen der SVGs)


  /* ---------- Haartester: Bild als cover-Rahmen, Linse, Scan ---------- */
  const scan = $('.pf-scan'), tframe = $('.pf-tframe'), lens = $('.pf-lens'), lensImg = lens && lens.querySelector('img');
  const ZOOM = 2.4, FOCUS_X = 0.26, FOCUS_Y = 0.5;
  let geo = null;
  function layoutScan() {
    if (!scan) return;
    const W = scan.clientWidth, H = scan.clientHeight, ar = 1.5;
    let fw = W, fh = W / ar;
    if (fh < H) { fh = H; fw = H * ar; }
    const fl = L.clamp(W / 2 - fw * FOCUS_X, W - fw, 0), ft = L.clamp(H / 2 - fh * FOCUS_Y, H - fh, 0);
    tframe.style.setProperty('--fw', `${fw}px`); tframe.style.setProperty('--fh', `${fh}px`);
    tframe.style.setProperty('--fl', `${fl}px`); tframe.style.setProperty('--ft', `${ft}px`);
    const ls = Math.round(L.clamp(W * 0.22, 112, 196));
    lens.style.setProperty('--ls', `${ls}px`);
    lens.style.setProperty('--lw', `${fw * ZOOM}px`);
    geo = { W, H, fw, fh, fl, ft, ls };
  }
  // Linse auf Bildpunkt (u, v in 0..1 des Bildes) setzen
  function lensAt(u, v) {
    if (!geo) return;
    const { fw, fh, fl, ft, ls } = geo;
    const x = fl + u * fw, y = ft + v * fh;
    lens.style.setProperty('--lx', `${(x - ls / 2).toFixed(1)}px`);
    lens.style.setProperty('--ly', `${(y - ls / 2).toFixed(1)}px`);
    lens.style.setProperty('--ix', `${(-(u * fw * ZOOM) + ls / 2).toFixed(1)}px`);
    lens.style.setProperty('--iy', `${(-(v * fh * ZOOM) + ls / 2).toFixed(1)}px`);
  }
  // Pfad der Linse beim Scrollen: die Strähne hinab
  const PATH = [[0.30, 0.20], [0.255, 0.42], [0.265, 0.62], [0.31, 0.84]];
  const along = t => {
    const n = PATH.length - 1, k = Math.min(n - 1, Math.floor(t * n)), f = t * n - k;
    return [L.lerp(PATH[k][0], PATH[k + 1][0], f), L.lerp(PATH[k][1], PATH[k + 1][1], f)];
  };
  let hover = null, cur = [PATH[0][0], PATH[0][1]];
  if (scan) {
    layoutScan();
    L.onResize && L.onResize(layoutScan);
    if (lensImg) lensImg.addEventListener('load', layoutScan);
    if (L.fine) {
      scan.addEventListener('pointermove', e => {
        if (!geo) return;
        const r = scan.getBoundingClientRect();
        hover = [L.clamp((e.clientX - r.left - geo.fl) / geo.fw, 0.02, 0.98), L.clamp((e.clientY - r.top - geo.ft) / geo.fh, 0.03, 0.97)];
      }, { passive: true });
      scan.addEventListener('pointerleave', () => { hover = null; });
    }
    lensAt(cur[0], cur[1]);
  }

  let visStage = false, visScan = false;
  const scanField = scan;
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.target === stage) visStage = e.isIntersecting; else visScan = e.isIntersecting;
  }), { rootMargin: '10% 0px' });
  io.observe(stage); scanField && io.observe(scanField);

  const last = { s: [], o: [] };
  let lastScan = -1;
  L.onFrame(() => {
    if (visStage) {
      const sr = stage.getBoundingClientRect();
      const p = L.clamp(-sr.top / Math.max(1, sr.height - L.vh));
      if (!L.reduce) bgImg.style.transform = `scale(${(1.12 - 0.1 * p).toFixed(4)})`;
      // Marke: leichtes Davonschweben, Schleier hellt sich für die Karten auf
      const br = brandBox.getBoundingClientRect();
      const bp = L.clamp(-br.top / L.vh);
      if (!L.reduce) {
        brand.style.transform = `translate3d(0, ${(bp * -L.vh * 0.18).toFixed(1)}px, 0) scale(${(1 - bp * 0.06).toFixed(4)})`;
        brand.style.opacity = (1 - L.smooth(bp, 0.25, 0.85)).toFixed(3);
      }
      veil.style.setProperty('--veil', (1 - 0.45 * L.smooth(bp, 0.2, 1)).toFixed(3));
      // Stapel: jede ankommende Karte drückt die vorherigen kleiner und dunkler
      const k = cards.map((c, i) => {
        if (i === 0) return 0;
        const r = c.getBoundingClientRect();
        return L.clamp(1 - (r.top - tops[i]) / (L.vh * 0.75));
      });
      for (let i = 0; i < cards.length; i++) {
        let sum = 0;
        for (let j = i + 1; j < cards.length; j++) sum += k[j];
        const s = (1 - sum * 0.045).toFixed(4);
        const o = Math.min(0.5, sum * 0.26).toFixed(3);
        const t = tilt[i];
        t.x = L.lerp(t.x, sum > 0.05 ? 0 : t.tx, 0.08); t.y = L.lerp(t.y, sum > 0.05 ? 0 : t.ty, 0.08);
        const key = `${s}|${t.x.toFixed(2)}|${t.y.toFixed(2)}`;
        if (last.s[i] !== key) {
          last.s[i] = key;
          cards[i].style.transform = tiltOn ? `perspective(1800px) rotateX(${t.x.toFixed(2)}deg) rotateY(${t.y.toFixed(2)}deg) scale(${s})` : `scale(${s})`;
        }
        if (last.o[i] !== o) { last.o[i] = o; shades[i].style.opacity = o; }
        const r = cards[i].getBoundingClientRect();
        // angedockt → Licht-Sweep und Bogen einmal auslösen
        if (!cards[i].classList.contains('on') && r.top <= tops[i] + 6 && r.bottom > 0) cards[i].classList.add('on');
        // Parallax im Bildfeld
        if (!L.reduce && frames[i]) {
          if (r.bottom > 0 && r.top < L.vh) {
            const py = ((r.top + r.height / 2) / L.vh - 0.5) * -46;
            frames[i].style.setProperty('--py', `${py.toFixed(1)}px`);
          }
        }
      }
    }
    if (visScan && scan && geo) {
      const target = hover || along(L.smooth(L.through(scan), 0.15, 0.75));
      const k = L.reduce ? 1 : 0.12;
      cur[0] = L.lerp(cur[0], target[0], k); cur[1] = L.lerp(cur[1], target[1], k);
      lensAt(cur[0], cur[1]);
    }
  });
})();

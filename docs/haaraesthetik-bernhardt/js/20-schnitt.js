/* ==========================================================
   Kapitel II · 10:30 · Schnitt – diagonaler Bildschnitt & Menükarte
   ========================================================== */
(() => {
  const L = window.LUMEN;
  const sec = document.getElementById('schnitt');
  if (!L || !sec) return;
  const $ = (s, r = sec) => r.querySelector(s);
  const $$ = (s, r = sec) => [...r.querySelectorAll(s)];

  const DEF = {
    kurz: 'bis einschließlich Ohr',
    mittel: 'über Ohr bis einschließlich Kinn',
    lang: 'über Kinn bis einschließlich Schulter',
    aufwendig: 'über Schulterlänge bzw. sehr dichtes Haar',
  };

  /* ---------------- Der Schnitt ---------------- */
  const pin = $('.sc-pin');
  const stage = $('.sc-stage');
  const halfA = $('.sc-a'), halfB = $('.sc-b');
  const blade = $('.sc-blade');
  const gap = $('.sc-gap');
  let geo = null, lastP = -1;

  function layout() {
    const W = stage.clientWidth, H = stage.clientHeight;
    const Wp = halfA.offsetWidth || W * 1.48, Hp = halfA.offsetHeight || H * 1.48;
    const angDeg = parseFloat(getComputedStyle(stage).getPropertyValue('--ang')) || -14;
    const a = Math.abs(angDeg) * Math.PI / 180;
    const yAt = x => Hp / 2 - (x - Wp / 2) * Math.tan(a);
    const y0 = yAt(0), y1 = yAt(Wp);
    halfA.style.clipPath = `polygon(0px 0px, ${Wp}px 0px, ${Wp}px ${y1}px, 0px ${y0}px)`;
    halfB.style.clipPath = `polygon(0px ${y0}px, ${Wp}px ${y1}px, ${Wp}px ${Hp}px, 0px ${Hp}px)`;
    const mobile = W < 641;
    const gMax = mobile ? L.clamp(H * 0.44, 300, 380) : L.clamp(H * 0.46, 320, 440);
    geo = { nx: Math.sin(a), ny: Math.cos(a), gMax };
    lastP = -1;
  }
  layout();
  L.onResize(layout);

  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function render(p) {
    const draw = L.smooth(p, 0.0, 0.17);
    const open = ease(L.clamp((p - 0.15) / 0.5));
    const g = open * geo.gMax / 2;
    const dx = geo.nx * g, dy = geo.ny * g;
    halfA.style.transform = `translate3d(${-dx}px, ${-dy}px, 0)`;
    halfB.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    const zoom = (1.1 - 0.06 * p).toFixed(4);
    halfA.style.setProperty('--zoom', zoom);
    halfB.style.setProperty('--zoom', zoom);
    const glow = L.smooth(open, 0.02, 0.22).toFixed(3);
    halfA.style.setProperty('--glow', glow);
    halfB.style.setProperty('--glow', glow);
    stage.style.setProperty('--draw', draw.toFixed(4));
    stage.style.setProperty('--bo', (p > 0.001 ? 1 - L.smooth(open, 0.1, 0.45) : 0).toFixed(3));
    stage.style.setProperty('--t', L.smooth(p, 0.4, 0.68).toFixed(3));
  }

  L.onFrame(() => {
    const r = pin.getBoundingClientRect();
    if (r.bottom < -20 || r.top > L.vh + 20) return;
    let p = L.reduce ? 0.85 : L.clamp(-r.top / Math.max(1, r.height - L.vh));
    if (Math.abs(p - lastP) < 0.0004) return;
    lastP = p;
    render(p);
  });

  /* ---------------- Menükarte ---------------- */
  const card = $('.sc-card');
  const tg = $('.sc-toggle');
  const tBtns = $$('.sc-toggle button');
  const tThumb = $('.sc-toggle-thumb');
  const pairs = $$('[data-pair]');
  const foehnLabel = $('[data-sc-foehn-label]');
  const lenV = $('[data-sc-len]'), lenD = $('[data-sc-def]'), lenWrap = $('.sc-len-v');
  let foehn = 0;

  function placeThumb() {
    const b = tBtns[foehn];
    if (!b || !tThumb) return;
    tThumb.style.width = `${b.offsetWidth}px`;
    tThumb.style.transform = `translateX(${b.offsetLeft}px)`;
  }
  function checkNa() { card.classList.toggle('has-na', !!card.querySelector('.price.is-na')); }

  function setFoehn(v, focus) {
    v = v ? 1 : 0;
    if (v === foehn) return;
    foehn = v;
    tBtns.forEach((b, i) => { b.setAttribute('aria-checked', String(i === v)); b.tabIndex = i === v ? 0 : -1; });
    if (focus) tBtns[v].focus();
    placeThumb();
    pairs.forEach(el => {
      el.dataset.price = el.dataset.pair.split('|')[v];
      const it = el.closest('.sc-item');
      if (it && !L.reduce) { it.classList.remove('flip'); void it.offsetWidth; it.classList.add('flip'); setTimeout(() => it.classList.remove('flip'), 1400); }
    });
    if (foehnLabel) foehnLabel.textContent = v ? 'mit Föhnen' : 'ohne Föhnen';
    L.renderPrices(true);
    checkNa();
  }
  tBtns.forEach((b, i) => b.addEventListener('click', () => setFoehn(i)));
  tg && tg.addEventListener('keydown', e => {
    if (['ArrowLeft', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setFoehn(0, true); }
    else if (['ArrowRight', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setFoehn(1, true); }
  });
  placeThumb();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeThumb);
  L.onResize(placeThumb);

  function syncLen(anim) {
    const len = L.length;
    lenV.textContent = len;
    lenD.textContent = DEF[len] || '';
    if (anim && !L.reduce) { lenWrap.classList.remove('swap'); void lenWrap.offsetWidth; lenWrap.classList.add('swap'); }
    checkNa();
  }
  syncLen(false);
  document.addEventListener('lumen:length', () => syncLen(true));
  // Core rendert die Preise beim Start; danach „nicht angeboten“ prüfen
  setTimeout(checkNa, 50);
})();

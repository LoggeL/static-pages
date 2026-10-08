/* ==========================================================
   LUMEN · Core (core.js) – gemeinsame Engine für alle Kapitel.
   API: window.LUMEN (siehe CONTRACT.md)
   ========================================================== */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (v, a, b) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const store = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} } };

  const L = window.LUMEN = {
    $, $$, clamp, lerp, smooth, reduce, fine,
    vw: innerWidth, vh: innerHeight, y: 0, vel: 0, time: 480, mouse: { x: innerWidth / 2, y: innerHeight / 2, nx: 0, ny: 0 },
    lenis: null,
    length: 'mittel',
    LENGTHS: ['kurz', 'mittel', 'lang', 'aufwendig'],
  };

  /* ---------- Preise (Preisliste 09/2026). Array = [kurz, mittel, lang, aufwendig], null = nicht angeboten ---------- */
  L.PRICES = {
    'erstgespraech': 29, 'analyse': 45, 'gl-beratung': 45, 'braut-beratung': 90,
    'kurzhaar': 43, 'fade': 30, 'kurzhaar-rasur': 63,
    'schnitt': [45, 57, 66, 90], 'schnitt-foehn': [59, 75, 90, 105],
    'heisse-schere': [null, 57, 66, 75], 'heisse-schere-foehn': [null, 75, 90, 105],
    'kinder': [30, 45, 60, null], 'styling': [30, 45, 60, 90],
    'rasur': 30, 'nassrasur': 45,
    'brauen-formen': 14, 'brauen-faerben': 14, 'wimpern-faerben': 14, 'augen-paket': 35,
    'ansatz': 66, 'komplettfarbe': [78, 98, 118, 138], 'glossing': [null, 48, 70, 90],
    'highlights-teil': [null, 70, 88, 105], 'highlights-komplett': [null, 120, 140, 160],
    'balayage': [null, 285, 320, 380],
    'umformung-teil': [45, 60, null, null], 'umformung-komplett': [68, 83, 90, null],
    'pflegeritual': 15,
  };
  L.price = (key, len = L.length) => {
    const v = L.PRICES[key];
    if (v == null) return null;
    return Array.isArray(v) ? v[L.LENGTHS.indexOf(len)] : v;
  };
  L.fmt = n => (n == null ? '–' : `${n} €`);
  function renderPrices(animate) {
    $$('[data-price]').forEach(el => {
      const n = L.price(el.dataset.price, el.dataset.len || L.length);
      const txt = L.fmt(n);
      let num = el.querySelector('.p-num');
      if (!num) { el.classList.add('price'); el.innerHTML = '<span class="p-num"></span>'; num = el.querySelector('.p-num'); }
      if (num.textContent === txt) return;
      el.classList.toggle('is-na', n == null);
      el.title = n == null ? 'Für diese Haarlänge nicht angeboten' : '';
      if (animate && !reduce) { el.classList.remove('roll'); void el.offsetWidth; el.classList.add('roll'); setTimeout(() => (num.textContent = txt), 200); }
      else num.textContent = txt;
    });
  }
  L.renderPrices = renderPrices;
  L.setLength = (len, src) => {
    if (!L.LENGTHS.includes(len) || len === L.length) return;
    L.length = len;
    store.set('lumen-len', len);
    syncDockLen();
    renderPrices(true);
    document.dispatchEvent(new CustomEvent('lumen:length', { detail: { length: len, source: src } }));
  };
  const savedLen = store.get('lumen-len');
  if (savedLen && L.LENGTHS.includes(savedLen)) L.length = savedLen;

  /* ---------- Frame-Loop ---------- */
  const frameFns = [];
  L.onFrame = fn => frameFns.push(fn);
  L.progress = el => { const r = el.getBoundingClientRect(); return clamp(-r.top / Math.max(1, r.height - L.vh)); };
  /* sichtbarer Fortschritt: 0 wenn Oberkante unten im Viewport, 1 wenn Unterkante oben */
  L.through = el => { const r = el.getBoundingClientRect(); return clamp((L.vh - r.top) / (r.height + L.vh)); };

  /* ---------- Lenis ---------- */
  if (!reduce && window.Lenis) {
    L.lenis = new Lenis({ lerp: 0.09, smoothWheel: true, wheelMultiplier: 0.95 });
    document.documentElement.classList.add('lenis');
  }
  L.scrollTo = (target, opts = {}) => {
    const el = typeof target === 'string' ? (target === '#top' ? 0 : $(target)) : target;
    if (el === null || el === undefined) return;
    if (L.lenis) L.lenis.scrollTo(el, { duration: 1.8, easing: t => 1 - Math.pow(1 - t, 4), ...opts });
    else if (el === 0) scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    else el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.getAttribute('href') === '#') return;
    e.preventDefault();
    closeMenu();
    L.scrollTo(a.getAttribute('href'));
  });

  /* ---------- Reveal ---------- */
  function splitWords(el) {
    if (el.dataset.split) return;
    el.dataset.split = '1';
    let i = 0;
    const walk = node => {
      [...node.childNodes].forEach(n => {
        if (n.nodeType === 3) {
          const parts = n.textContent.split(/(\s+)/);
          const frag = document.createDocumentFragment();
          parts.forEach(p => {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span'); w.className = 'w';
            const s = document.createElement('span'); s.textContent = p; s.style.setProperty('--i', i++);
            w.appendChild(s); frag.appendChild(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && !n.classList.contains('w')) {
          if (n.matches('.cap, .pearl, br')) {
            if (n.tagName !== 'BR') { const w = document.createElement('span'); w.className = 'w'; n.replaceWith(w); const s = document.createElement('span'); s.style.setProperty('--i', i++); s.appendChild(n); w.appendChild(s); }
          } else walk(n);
        }
      });
    };
    walk(el);
  }
  L.splitWords = splitWords;
  const reveal = el => { el.classList.add('in'); el.dispatchEvent(new CustomEvent('lumen:in', { bubbles: false })); };
  const io = new IntersectionObserver(entries => entries.forEach(en => {
    if (!en.isIntersecting) return;
    const t = en.target;
    if (t._clipKids) { t._clipKids.forEach(reveal); t._clipKids = null; }
    if (t._selfReveal !== false) reveal(t);
    io.unobserve(t);
  }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  L.observe = el => io.observe(el);
  function initReveal(root = document) {
    $$('[data-words]', root).forEach(splitWords);
    $$('.rv, .rv-fade, [data-words], [data-in]', root).forEach(el => io.observe(el));
    // .rv-clip ist komplett weggeclippt → IO meldet es nie als sichtbar. Darum das Elternelement beobachten.
    $$('.rv-clip:not(.in)', root).forEach(el => {
      const host = el.parentElement || el;
      if (!host._clipKids) {
        host._clipKids = [];
        if (!host.matches('.rv, .rv-fade, [data-words], [data-in]')) host._selfReveal = false;
        io.observe(host);
      }
      host._clipKids.push(el);
    });
  }
  L.initReveal = initReveal;

  /* ---------- Kapitel & Tageszeit ---------- */
  const chapters = $$('section.chapter[data-time]');
  const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const fmtTime = m => { m = Math.round(m); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  L.fmtTime = fmtTime;
  chapters.forEach(c => (c._min = toMin(c.dataset.time)));
  // Sichtbar werden keine Uhrzeiten gezeigt (könnten als Termine/Dauern missverstanden werden) – nur das Licht.
  const LIGHTS = { beratung: 'Morgenlicht', schnitt: 'Klares Licht', farbe: 'Zenit', pflege: 'Mittagsruhe', laengen: 'Lange Schatten', hochzeit: 'Goldene Stunde', bart: 'Streiflicht', salon: 'Blaue Stunde', kontakt: 'Nacht' };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  chapters.forEach((c, i) => { c._light = c.dataset.light || LIGHTS[c.id] || c.dataset.title; c._num = ROMAN[i] || String(i + 1); });
  L.LIGHTS = LIGHTS;
  L.lightOf = c => (c && c._light) || 'Erstes Licht';
  // Farbstopps über den Tag [Minute, bg, fg]
  const STOPS = [
    [480, '#efede7', '#1a1816'], [540, '#eeece6', '#1a1816'], [630, '#f1eee8', '#1a1816'],
    [720, '#f5f1e9', '#1a1816'], [810, '#f2ebdf', '#1a1816'], [900, '#efe3d0', '#1a1816'],
    [990, '#e8d2ad', '#1d1814'], [1035, '#c9a57a', '#1d1814'], [1050, '#2b241d', '#f1e9dc'],
    [1080, '#1a1714', '#f3f0ea'], [1200, '#0e0d0c', '#f3f0ea'],
  ];
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',')})`; };
  function colorAt(m) {
    let i = 0; while (i < STOPS.length - 2 && m > STOPS[i + 1][0]) i++;
    const [m0, b0, f0] = STOPS[i], [m1, b1, f1] = STOPS[i + 1];
    const t = clamp((m - m0) / (m1 - m0));
    const bg = mix(b0, b1, t);
    const lum = hex(b0).map((v, k) => lerp(v, hex(b1)[k], t)).reduce((s, v, k) => s + v * [0.299, 0.587, 0.114][k], 0) / 255;
    const dark = lum < 0.5;
    return { bg, fg: dark ? '#f3f0ea' : '#1a1816', dark, lum };
  }
  function timeFromScroll() {
    const mid = L.vh * 0.55;
    if (!chapters.length) return 480;
    const tops = chapters.map(c => c.getBoundingClientRect().top);
    if (tops[0] > mid) {
      const heroP = clamp(1 - (tops[0] - mid) / (L.vh * 2.2));
      return lerp(480, chapters[0]._min, heroP);
    }
    for (let i = 0; i < chapters.length; i++) {
      const next = chapters[i + 1];
      if (!next || tops[i + 1] > mid) {
        if (!next) return chapters[i]._min;
        const span = tops[i + 1] - tops[i];
        const t = clamp((mid - tops[i]) / Math.max(1, span));
        return lerp(chapters[i]._min, next._min, t);
      }
    }
    return chapters[chapters.length - 1]._min;
  }
  L.chapters = chapters;
  L.activeChapter = null;

  /* ---------- Dock ---------- */
  const dock = $('.dock'), dTime = $('[data-dock-time]'), dLabel = $('[data-dock-label]'), dDot = $('.ds-dot');
  const lenBtns = $$('.dock-len button'), thumb = $('.dl-thumb');
  function syncDockLen() {
    lenBtns.forEach(b => b.setAttribute('aria-checked', String(b.dataset.len === L.length)));
    const b = lenBtns.find(x => x.dataset.len === L.length);
    if (b && thumb) { thumb.style.width = `${b.offsetWidth}px`; thumb.style.transform = `translateX(${b.offsetLeft}px)`; }
  }
  lenBtns.forEach(b => b.addEventListener('click', () => L.setLength(b.dataset.len, 'dock')));

  /* ---------- Menü ---------- */
  const menu = $('.menu'), menuBtn = $('.hdr-menu'), mList = $('[data-menu-list]'), mPrev = $('.menu-preview img');
  if (mList) {
    mList.innerHTML = chapters.map((c, i) => `<li style="--i:${i}"><a href="#${c.id}" data-img="${c.dataset.img || ''}"><span class="m-time">${c._num}</span><span class="m-title">${c.dataset.title}</span><span class="m-sub t-mono">${[c._light, c.dataset.sub].filter((v, k, x) => v && x.indexOf(v) === k && v !== c.dataset.title).join(' · ')}</span></a></li>`).join('');
    $$('a', mList).forEach(a => a.addEventListener('mouseenter', () => { if (a.dataset.img && mPrev) { mPrev.style.opacity = 0; setTimeout(() => { mPrev.src = a.dataset.img; mPrev.style.opacity = 1; }, 160); } }));
  }
  function openMenu() { document.documentElement.classList.add('menu-open'); menu.setAttribute('aria-hidden', 'false'); menuBtn.setAttribute('aria-expanded', 'true'); menuBtn.querySelector('span').textContent = 'Schließen'; L.lenis && L.lenis.stop(); }
  function closeMenu() { if (!document.documentElement.classList.contains('menu-open')) return; document.documentElement.classList.remove('menu-open'); menu.setAttribute('aria-hidden', 'true'); menuBtn.setAttribute('aria-expanded', 'false'); menuBtn.querySelector('span').textContent = 'Menü'; L.lenis && L.lenis.start(); }
  menuBtn && menuBtn.addEventListener('click', () => (document.documentElement.classList.contains('menu-open') ? closeMenu() : openMenu()));
  addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

  /* ---------- Cursor ---------- */
  const cur = $('.cursor'), cLabel = $('.c-label');
  let rx = L.mouse.x, ry = L.mouse.y;
  if (fine && !reduce) document.documentElement.classList.add('has-cursor');
  addEventListener('pointermove', e => {
    L.mouse.x = e.clientX; L.mouse.y = e.clientY;
    L.mouse.nx = e.clientX / L.vw - 0.5; L.mouse.ny = e.clientY / L.vh - 0.5;
    const t = e.target.closest && e.target.closest('[data-cursor]');
    if (t) { cLabel.textContent = t.dataset.cursor; cur.classList.add('label'); } else cur.classList.remove('label');
  }, { passive: true });

  /* ---------- Öffnungsstatus (Europe/Berlin) ---------- */
  const HOURS = { 2: [540, 1080], 3: [540, 1080], 4: [540, 1080], 5: [540, 1080], 6: [540, 840] };
  L.HOURS = HOURS;
  const DN = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  L.berlinNow = () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
    return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), min: (+p.hour % 24) * 60 + +p.minute };
  };
  function updateStatus() {
    const { day, min } = L.berlinNow();
    let open = false, text = '', next = null;
    if (HOURS[day] && min >= HOURS[day][0] && min < HOURS[day][1]) { open = true; text = `Geöffnet bis ${fmtTime(HOURS[day][1])}`; }
    else for (let k = 0; k < 8; k++) {
      const d = (day + k) % 7;
      if (HOURS[d] && (k > 0 || min < HOURS[d][0])) { next = { day: d, k, min: HOURS[d][0] }; text = `Geschlossen · öffnet ${k === 0 ? 'heute' : k === 1 ? 'morgen' : DN[d]} ${fmtTime(HOURS[d][0])}`; break; }
    }
    L.status = { open, text, next, day, min };
    document.documentElement.classList.toggle('is-open', open);
    $$('[data-status]').forEach(el => { const s = el.querySelector('span') || el; s.textContent = text; });
    document.dispatchEvent(new CustomEvent('lumen:status', { detail: L.status }));
  }
  updateStatus(); setInterval(updateStatus, 60000);

  /* ---------- Resize ---------- */
  const resizeFns = [];
  L.onResize = fn => resizeFns.push(fn);
  addEventListener('resize', () => { L.vw = innerWidth; L.vh = innerHeight; syncDockLen(); resizeFns.forEach(f => f()); });

  /* ---------- Haupt-Loop ---------- */
  const scrollEls = () => $$('[data-scroll]');
  let sEls = [];
  let lastY = scrollY, lastBg = '';
  const root = document.documentElement.style;
  const meta = $('meta[name="theme-color"]');
  function frame(t) {
    L.y = L.lenis ? L.lenis.scroll : scrollY;
    L.vel = L.vel * 0.82 + (L.y - lastY) * 0.18; lastY = L.y;
    for (const el of sEls) {
      const r = el.getBoundingClientRect();
      const p = clamp(-r.top / Math.max(1, r.height - L.vh));
      if (el._p !== p) { el._p = p; el.style.setProperty('--p', p.toFixed(4)); }
    }
    // Tageszeit → Farben & Dock
    const m = timeFromScroll();
    L.time = m;
    const c = colorAt(m);
    if (c.bg !== lastBg) {
      lastBg = c.bg;
      root.setProperty('--bg', c.bg); root.setProperty('--fg', c.fg);
      root.setProperty('--fg-dim', c.dark ? 'rgba(243,240,234,.62)' : '#6f685e');
      root.setProperty('--line', c.dark ? 'rgba(243,240,234,.16)' : 'rgba(26,24,22,.14)');
      root.setProperty('--accent', c.dark ? '#e8d5b0' : '#9a7640');
      root.setProperty('--card', c.dark ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.55)');
      root.setProperty('--is-dark', c.dark ? 1 : 0);
      document.documentElement.classList.toggle('on-dark', c.dark);
      document.documentElement.style.colorScheme = c.dark ? 'dark' : 'light';
      meta && meta.setAttribute('content', c.bg);
    }
    if (dTime) {
      let act = null;
      chapters.forEach(ch => { if (ch.getBoundingClientRect().top < L.vh * 0.55) act = ch; });
      if (act !== L.activeChapter || !dTime.textContent) {
        L.activeChapter = act;
        dTime.textContent = L.lightOf(act);
        dLabel.textContent = act ? `${act._num} · ${act.dataset.title}` : 'Quelle der Entspannung';
        document.dispatchEvent(new CustomEvent('lumen:chapter', { detail: act }));
      }
      // Sonne auf Bogen 06:00–21:00
      const sp = clamp((m - 360) / (1260 - 360));
      const a = Math.PI * (1 - sp);
      dDot.setAttribute('cx', (32 + Math.cos(a) * 28).toFixed(2));
      dDot.setAttribute('cy', (32 - Math.sin(a) * 28).toFixed(2));
      dock.style.setProperty('--dock-in', document.documentElement.classList.contains('loaded') ? smooth(L.y, L.vh * 0.3, L.vh * 0.9) : 0);
    }
    // Cursor
    if (cur && fine) {
      rx = lerp(rx, L.mouse.x, 0.18); ry = lerp(ry, L.mouse.y, 0.18);
      cur.style.setProperty('--dx', `${L.mouse.x}px`); cur.style.setProperty('--dy', `${L.mouse.y}px`);
      cur.style.setProperty('--rx', `${rx}px`); cur.style.setProperty('--ry', `${ry}px`);
    }
    for (const fn of frameFns) fn(t, L);
    requestAnimationFrame(frame);
  }

  /* ---------- Preloader ---------- */
  function preload(done) {
    const pl = $('.preloader');
    if (!pl || reduce || store.get('lumen-seen')) { document.documentElement.classList.add('no-preload'); done(); return; }
    store.set('lumen-seen', '1');
    L.lenis && L.lenis.stop();
    const tEl = $('[data-pl-time]'), sun = $('.pl-sun'), hz = $('.pl-horizon');
    const t0 = performance.now(), dur = 2300;
    const step = now => {
      const k = clamp((now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      const a = Math.PI * (1 - e * 0.5);
      sun.setAttribute('cx', (100 + Math.cos(a) * 90).toFixed(1));
      sun.setAttribute('cy', (100 - Math.sin(a) * 90).toFixed(1));
      hz.style.setProperty('--pl', e.toFixed(3));
      if (k < 1) requestAnimationFrame(step);
      else setTimeout(() => { L.lenis && L.lenis.start(); done(); }, 250);
    };
    requestAnimationFrame(step);
  }

  /* ---------- Start (nach allen Kapitel-Skripten) ---------- */
  function start() {
    initReveal();
    renderPrices(false);
    sEls = scrollEls();
    syncDockLen();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncDockLen);
    if (L.lenis) { const raf = t => { L.lenis.raf(t); requestAnimationFrame(raf); }; requestAnimationFrame(raf); }
    requestAnimationFrame(frame);
    preload(() => {
      document.documentElement.classList.add('loaded');
      document.dispatchEvent(new CustomEvent('lumen:loaded'));
      L.loaded = true;
    });
  }
  L.refresh = () => { sEls = scrollEls(); initReveal(); renderPrices(false); };
  // Kapitel-Skripte laufen nach core.js; Start erst danach.
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(start, 0);
  else document.addEventListener('DOMContentLoaded', start);
})();

/* ==========================================================
   Kapitel III · Zenit · Farbe
   Strähnen-Spektrum (Canvas-Haar), Farbberater (lokale
   Keyword-Engine), Preis-Skala Coloration.
   ========================================================== */
(() => {
  const L = window.LUMEN;
  const sec = document.getElementById('farbe');
  if (!L || !sec) return;
  const $ = (s, r = sec) => r.querySelector(s);
  const $$ = (s, r = sec) => [...r.querySelectorAll(s)];
  const mqMobile = matchMedia('(max-width: 759px)');
  const isMobile = () => mqMobile.matches;

  /* ---------------- Strähnen-Daten ---------------- */
  const STRANDS = [
    { name: 'Kupfer', tone: '#bf6232', ink: '#a24f27', label: '#fbf3ea', pal: { root: '#4a1906', mid: '#8f3a17', light: '#cf7140', hl: '#ffc89e' } },
    { name: 'Rosé', tone: '#dcaa9d', ink: '#a8695c', label: '#2a1d18', pal: { root: '#9d685c', mid: '#c99284', light: '#ebc3b8', hl: '#fff3ee' } },
    { name: 'Platin', tone: '#e6dcc6', ink: '#94804f', label: '#1a1816', pal: { root: '#a99872', mid: '#d9cdb3', light: '#f2ecdf', hl: '#ffffff' } },
    { name: 'Aschbraun', tone: '#7d6f62', ink: '#6b5d4f', label: '#f6f1e8', pal: { root: '#261f1a', mid: '#4f453d', light: '#7f7366', hl: '#d9cfc2' } },
    { name: 'Espresso', tone: '#4b3427', ink: '#5a3f2f', label: '#f6efe6', pal: { root: '#0f0806', mid: '#25170f', light: '#3f2b1f', hl: '#b08a6c' } },
  ];
  const spec = $('.fa-spec');
  const strands = $$('.fa-st');
  const dots = $$('.fa-dots i');
  const cursor = document.querySelector('.cursor');
  let active = -1;
  let inSec = false;

  strands.forEach((el, k) => el.style.setProperty('--k', k));

  function tintCursor() {
    if (!cursor) return;
    if (inSec && active >= 0) {
      cursor.style.setProperty('--gold', STRANDS[active].tone);
      cursor.style.setProperty('--ink', STRANDS[active].label);
    } else {
      cursor.style.removeProperty('--gold');
      cursor.style.removeProperty('--ink');
    }
  }
  sec.addEventListener('pointerenter', () => { inSec = true; tintCursor(); });
  sec.addEventListener('pointerleave', () => { inSec = false; tintCursor(); });

  function setActive(i) {
    if (i === active || !STRANDS[i]) return;
    active = i;
    strands.forEach((el, k) => {
      el.classList.toggle('is-open', k === i);
      const b = el.querySelector('.fa-hit');
      b && b.setAttribute('aria-expanded', String(k === i));
    });
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
    sec.style.setProperty('--fa-tone', STRANDS[i].tone);
    sec.style.setProperty('--fa-ink', STRANDS[i].ink);
    tintCursor();
  }

  function centerOn(i, smooth = true) {
    const el = strands[i];
    if (!el) return;
    const left = el.offsetLeft - (spec.clientWidth - el.offsetWidth) / 2;
    spec.scrollTo({ left, behavior: smooth && !L.reduce ? 'smooth' : 'auto' });
  }

  strands.forEach((el, i) => {
    el.addEventListener('mouseenter', () => { if (!isMobile()) setActive(i); });
    const hit = el.querySelector('.fa-hit');
    hit.addEventListener('click', () => {
      setActive(i);
      if (isMobile()) centerOn(i);
    });
    hit.addEventListener('focus', () => { setActive(i); if (isMobile()) centerOn(i); });
    // Glanzlicht folgt der Maus
    const sheen = el.querySelector('.fa-sheen');
    el.addEventListener('pointermove', e => {
      if (L.reduce || !sheen) return;
      const r = el.getBoundingClientRect();
      sheen.style.transform = `translateY(${(e.clientY - r.top - r.height * 0.22).toFixed(1)}px)`;
    }, { passive: true });
  });

  // Mobil: aktive Strähne = die zentrierte
  let scrollRaf = 0;
  spec.addEventListener('scroll', () => {
    if (!isMobile() || scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const mid = spec.scrollLeft + spec.clientWidth / 2;
      let best = 0, bd = Infinity;
      strands.forEach((el, k) => { const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid); if (d < bd) { bd = d; best = k; } });
      setActive(best);
    });
  }, { passive: true });

  // Markierungen im Panorama
  $$('.fa-mk').forEach(m => m.addEventListener('click', () => {
    const i = +m.dataset.go;
    setActive(i);
    L.scrollTo($('.fa-spec-wrap'), { offset: -40 });
    if (isMobile()) setTimeout(() => centerOn(i), 400);
  }));

  setActive(2);

  /* ---------------- Haar malen (Canvas) ---------------- */
  const rng = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

  function paint(cv, pal, w, h, seed) {
    const dpr = Math.min(1.75, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const R = rng(seed);
    // Grundverlauf: Ansatz dunkler, Längen heller, Spitzen ausfransend
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, pal.root); g.addColorStop(0.16, pal.mid); g.addColorStop(0.55, pal.light);
    g.addColorStop(0.8, pal.mid); g.addColorStop(0.9, rgba(pal.mid, 0.6)); g.addColorStop(1, rgba(pal.mid, 0));
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    // Strömung: gemeinsame Wellen, damit benachbarte Haare zusammen fließen (Locks)
    const W = [0, 1, 2].map(() => ({ k: 0.004 + R() * 0.006, q: 0.004 + R() * 0.01, p: R() * 6.28, a: 0.5 + R() }));
    const flow = (x0, y) => {
      const f = y / h, amp = 3 + 26 * Math.pow(f, 1.6);
      let s = 0; for (const v of W) s += Math.sin(y * v.k + x0 * v.q + v.p) * v.a;
      return x0 + s * amp * 0.5 + f * f * (x0 - w / 2) * 0.05;
    };
    const fiber = (x0, len, steps = 26) => {
      c.beginPath();
      for (let s = 0; s <= steps; s++) { const y = (s / steps) * len; const x = flow(x0, y); s ? c.lineTo(x, y) : c.moveTo(x, y); }
    };
    c.lineCap = 'round'; c.lineJoin = 'round';
    // 1) Tiefe: breite, dunkle Strähnen-Schatten
    for (let i = 0, n = Math.round(w / 9); i < n; i++) {
      fiber(R() * w * 1.1 - w * 0.05, h * (0.75 + R() * 0.2));
      c.strokeStyle = rgba(pal.root, 0.1 + R() * 0.16); c.lineWidth = 3 + R() * 7; c.stroke();
    }
    // 2) feine Haare
    const cols = [pal.root, pal.mid, pal.mid, pal.light, pal.light, pal.hl];
    for (let i = 0, n = Math.round(w * 2.4); i < n; i++) {
      fiber(R() * w * 1.1 - w * 0.05, h * (0.82 + R() * 0.19));
      const col = cols[(R() * cols.length) | 0];
      c.strokeStyle = rgba(col, (col === pal.hl ? 0.06 : 0.12) + R() * 0.3);
      c.lineWidth = 0.35 + R() * 1.05; c.stroke();
    }
    // 3) Glanzband (anisotrop), zwei Höhen
    c.globalCompositeOperation = 'screen';
    const bands = [[0.2, 0.3, 0.42, 0.8], [0.56, 0.63, 0.71, 0.4]];
    for (const [a, m, b, k] of bands) {
      const sg = c.createLinearGradient(0, 0, 0, h);
      sg.addColorStop(0, rgba(pal.hl, 0)); sg.addColorStop(a, rgba(pal.hl, 0));
      sg.addColorStop(m, rgba(pal.hl, k)); sg.addColorStop(b, rgba(pal.hl, 0)); sg.addColorStop(1, rgba(pal.hl, 0));
      c.strokeStyle = sg;
      for (let i = 0, n = Math.round(w * 0.9); i < n; i++) {
        fiber(R() * w * 1.1 - w * 0.05, h * 0.9, 22);
        c.globalAlpha = 0.08 + R() * 0.35; c.lineWidth = 0.4 + R() * 1.2; c.stroke();
      }
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    // 4) Schatten unter der Messingstange
    const tg = c.createLinearGradient(0, 0, 0, h * 0.08);
    tg.addColorStop(0, 'rgba(10,6,3,.45)'); tg.addColorStop(1, 'rgba(10,6,3,0)');
    c.fillStyle = tg; c.fillRect(0, 0, w, h * 0.08);
  }

  let lastKey = '';
  function paintAll() {
    if (!spec.clientWidth) return;
    const mob = isMobile();
    const avail = spec.clientWidth - 16;
    const w = mob ? strands[0].clientWidth : Math.ceil(avail * 4.2 / 8.2 + 12);
    const h = Math.ceil(strands[0].querySelector('.fa-hair').clientHeight);
    const key = `${w}x${h}`;
    if (key === lastKey) return;
    lastKey = key;
    strands.forEach((el, i) => {
      const cv = el.querySelector('canvas');
      const go = () => paint(cv, STRANDS[i].pal, w, h, 1009 + i * 7919);
      (window.requestIdleCallback ? cb => requestIdleCallback(cb, { timeout: 400 }) : cb => setTimeout(cb, 30 * i))(go);
    });
  }
  let rT;
  L.onResize && L.onResize(() => { clearTimeout(rT); rT = setTimeout(paintAll, 220); });
  mqMobile.addEventListener && mqMobile.addEventListener('change', () => { lastKey = ''; paintAll(); setTimeout(() => centerOn(active, false), 50); });

  // erst malen, wenn das Spektrum in die Nähe kommt
  const ioPaint = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { paintAll(); if (isMobile()) centerOn(active, false); ioPaint.disconnect(); }
  }), { rootMargin: '120% 0px' });
  ioPaint.observe(spec);

  /* ---------------- Frame: Sway + Panorama-Parallax ---------------- */
  const canvases = strands.map(s => s.querySelector('canvas'));
  const pano = $('.fa-pano'), panoIn = $('.fa-pano-in');
  let visSpec = false, visPano = false;
  const ioVis = new IntersectionObserver(es => es.forEach(e => {
    if (e.target === spec) visSpec = e.isIntersecting; else visPano = e.isIntersecting;
  }));
  ioVis.observe(spec); pano && ioVis.observe(pano);
  let lmx = L.mouse.x, mv = 0, sk = 0, lastSk = 99;
  L.onFrame(() => {
    if (visPano && pano && !L.reduce) {
      const t = L.through(pano);
      panoIn.style.transform = `translate3d(0, ${((t - 0.5) * -pano.offsetHeight * 0.14).toFixed(1)}px, 0)`;
    }
    if (!visSpec || L.reduce) return;
    // Haar wiegt mit der Mausbewegung und der Scroll-Geschwindigkeit
    const dx = L.mouse.x - lmx; lmx = L.mouse.x;
    mv = mv * 0.9 + dx * 0.1;
    const target = L.clamp(mv * 0.22 + L.vel * 0.02, -2.6, 2.6);
    sk = L.lerp(sk, target, 0.06);
    if (Math.abs(sk - lastSk) < 0.002) return;
    lastSk = sk;
    canvases.forEach((cv, k) => { cv.style.transform = `translateX(-50%) skewX(${(-sk * (0.8 + k * 0.08)).toFixed(3)}deg)`; });
  });

  /* ---------------- Farbberater ---------------- */
  const form = $('.fb-form'), input = $('#fb-in'), out = $('.fb-out'), live = $('[data-fb-live]');
  const NAMES = {
    'ansatz': 'Ansatzfarbe', 'komplettfarbe': 'Komplettfarbe', 'glossing': 'Color Glossing',
    'highlights-teil': 'Highlights · Teil', 'highlights-komplett': 'Highlights · komplett', 'balayage': 'Balayage',
    'umformung-teil': 'Umformung · Teil', 'umformung-komplett': 'Umformung · komplett', 'erstgespraech': 'Erstgespräch',
  };
  const SW = {
    'ansatz': 'sw-ansatz', 'komplettfarbe': 'sw-komplett', 'glossing': 'sw-gloss', 'highlights-teil': 'sw-hl-teil',
    'highlights-komplett': 'sw-hl', 'balayage': 'sw-balayage', 'umformung-teil': 'sw-um-teil', 'umformung-komplett': 'sw-um', 'erstgespraech': 'sw-erst',
  };
  const LEN_DEF = {
    kurz: 'bis einschließlich Ohr', mittel: 'über Ohr bis einschließlich Kinn',
    lang: 'über Kinn bis einschließlich Schulter', aufwendig: 'über Schulterlänge bzw. sehr dichtes Haar',
  };
  // „=“ am Anfang: nur am Wortanfang suchen; sonst überall (deutsche Komposita)
  const RULES = [
    { id: 'grau', label: 'Ansatz · Abdeckung', strand: -1,
      kw: ['grau', 'ansatz', 'abdeck', 'nachwuchs', '=weiss', 'weisse haare'],
      text: 'Graue Ansätze decken wir mit einer Ansatzfarbe ab, gedacht für bis zu 3 cm Nachwuchs. So bleibt deine Farbe gleichmäßig, ohne alles neu zu färben.',
      recs: [['ansatz', 'bis 3 cm Nachwuchs']] },
    { id: 'blond', label: 'Hell · kühl', strand: 2,
      kw: ['blond', '=hell', 'platin', '=kuhl', '=kalt', 'silber', 'aufhell', 'champagner', 'skandinav', '=eis', 'perlmutt'],
      text: 'Für helles, kühles Blond setzen wir Highlights, rundum oder als frei gemalte Balayage. Den kühlen Ton verfeinert danach ein Color Glossing.',
      recs: [['highlights-komplett', 'rundum gesetzt'], ['balayage', 'frei gemalter Verlauf'], ['glossing', 'für den kühlen Ton']] },
    { id: 'kupfer', label: 'Warm · Kupfer', strand: 0,
      kw: ['kupfer', '=rot', 'rotlich', '=warm', 'herbst', 'tizian', 'ingwer', '=fuchs', 'auburn', '=zimt', 'orange'],
      text: 'Kupfer und warme Rottöne entstehen als Komplettfarbe, gleichmäßig vom Ansatz bis in die Spitzen. So leuchtet der Ton überall gleich.',
      recs: [['komplettfarbe', 'vom Ansatz bis in die Spitzen']] },
    { id: 'glanz', label: 'Glanz · Frische', strand: 1,
      kw: ['glanz', 'frisch', 'auffrisch', 'refresh', '=strahl', 'stumpf', '=matt', 'gloss', 'rose', 'pastell'],
      text: 'Mehr Glanz und einen frischen, klaren Ton bringt ein Color Glossing. Ideal, wenn deine Farbe nur wieder leuchten soll.',
      recs: [['glossing', 'Glanz und Ton']] },
    { id: 'natur', label: 'Natürlich · sonnig', strand: -1,
      kw: ['natur', 'sonne', 'sunkiss', 'strahn', 'sommer', 'balayage', 'verlauf', 'ombre', 'babylight', 'highlight', 'reflex'],
      text: 'Sonnengeküsste, natürliche Reflexe malen wir als Balayage frei ins Haar. Oder wir setzen gezielte Highlights genau dort, wo das Licht fallen soll.',
      recs: [['balayage', 'frei gemalter Verlauf'], ['highlights-teil', 'gezielt, partiell']] },
    { id: 'dunkel', label: 'Dunkel · satt', strand: 4,
      kw: ['dunkel', 'brunett', 'braun', 'schoko', 'espresso', 'kaffee', 'mokka', 'schwarz', 'kastanie', '=nuss', 'aschbraun'],
      text: 'Satte, dunkle Töne von Brünett bis Espresso erzielen wir mit einer Komplettfarbe. Später hält eine Ansatzfarbe den Ton frisch.',
      recs: [['komplettfarbe', 'durchgehend satt'], ['ansatz', 'zum Auffrischen, bis 3 cm']] },
    { id: 'locken', label: 'Struktur · Volumen', strand: -1,
      kw: ['=lock', 'well', 'volum', 'sprungkraft', 'krause', 'umform', 'dauerwell', 'schwung'],
      text: 'Wellen, Locken und mehr Volumen schenkt eine Umformung, partiell für gezielten Schwung oder komplett für das ganze Haar.',
      recs: [['umformung-teil', 'partiell'], ['umformung-komplett', 'rundum']] },
  ];
  const FALLBACK = {
    id: 'none', label: 'noch offen', strand: -1,
    text: 'Dafür möchte ich nicht raten. Am klarsten wird es in einem Erstgespräch: Wir sehen dein Haar im echten Licht und planen gemeinsam.',
    recs: [['erstgespraech', 'persönlich, im Salon']],
  };
  const norm = s => ` ${s.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss').replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u').replace(/[^a-z0-9 ]+/g, ' ')} `;
  function analyse(q) {
    const t = norm(q);
    const hits = RULES.map((r, order) => {
      let score = 0, first = Infinity;
      r.kw.forEach(k => {
        const pre = k[0] === '=';
        const needle = pre ? ` ${k.slice(1)}` : k;
        const pos = t.indexOf(needle);
        if (pos >= 0) { score++; first = Math.min(first, pos); }
      });
      return { r, score, first, order };
    }).filter(h => h.score > 0).sort((a, b) => b.score - a.score || a.first - b.first);
    return hits.slice(0, 2).map(h => h.r);
  }

  let token = 0, last = null;
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wait = ms => new Promise(r => setTimeout(r, L.reduce ? 0 : ms));

  function recRows(recs) {
    return recs.map(([key, note], k) => `<li data-key="${key}" style="--k:${k}"><i class="fp-sw ${SW[key] || ''}" aria-hidden="true"></i><span class="fb-rn">${NAMES[key]}<small data-note="${esc(note)}">${esc(note)}</small></span><span class="fb-rp" data-price="${key}"></span></li>`).join('');
  }
  function updateLen() {
    if (!last) return;
    const len = L.length;
    $$('.fb-recs li', out).forEach(li => {
      const na = L.price(li.dataset.key, len) == null;
      li.classList.toggle('na', na);
      const sm = li.querySelector('small');
      sm.textContent = na ? 'für diese Länge nicht angeboten' : sm.dataset.note;
    });
    const lb = $('.fb-len', out);
    if (lb) lb.innerHTML = `Preise für Haarlänge <b>${len}</b> · ${LEN_DEF[len]}`;
    out.classList.remove('flash'); void out.offsetWidth; out.classList.add('flash');
  }

  async function answer(q) {
    q = q.trim();
    if (!q) return;
    const my = ++token;
    const rules = analyse(q);
    const list = rules.length ? rules : [FALLBACK];
    const text = list.map(r => r.text).join(' ');
    const seen = new Set();
    const recs = list.flatMap(r => r.recs).filter(([k]) => (seen.has(k) ? false : seen.add(k))).slice(0, 4);
    last = { q, list, recs };
    const strand = list.find(r => r.strand >= 0);
    if (strand) { setActive(strand.strand); if (isMobile()) centerOn(strand.strand, false); }

    out.classList.remove('done', 'flash');
    out.innerHTML = `
      <p class="fb-echo"><span>Wunsch</span><b>„${esc(q)}“</b></p>
      <ol class="fb-steps t-mono"><li>Wunsch gelesen</li><li>Erkannt: <b>${list.map(r => r.label).join(' + ')}</b></li><li>Technik gewählt</li></ol>
      <p class="fb-text" aria-hidden="true"><span></span><i class="fb-caret"></i></p>
      <ul class="fb-recs">${recRows(recs)}</ul>
      <p class="fb-len"></p>
      <p class="fb-cta">Das ist eine Orientierung, keine Diagnose. Genau wird es im persönlichen Gespräch: <a href="https://kmkx.mitdenkt.io/" target="_blank" rel="noopener" data-cursor="Buchen">Termin online buchen ↗</a></p>`;
    L.renderPrices();
    updateLen();
    out.classList.remove('flash');
    // Screenreader: einmal komplett
    const recTxt = recs.map(([k]) => `${NAMES[k]}: ${L.fmt(L.price(k))}`).join(', ');
    live.textContent = `${text} Empfehlung: ${recTxt}. Preise für Haarlänge ${L.length}. Für eine genaue Empfehlung bitte einen persönlichen Termin vereinbaren.`;

    const steps = $$('.fb-steps li', out);
    for (let i = 0; i < steps.length; i++) { if (my !== token) return; steps[i].classList.add('on'); await wait(260); }
    const span = $('.fb-text span', out);
    if (L.reduce) span.textContent = text;
    else {
      for (let i = 0; i < text.length; i += 2) {
        if (my !== token) return;
        span.textContent = text.slice(0, i + 2);
        await wait(16);
      }
    }
    if (my !== token) return;
    out.classList.add('done');
    setTimeout(() => { const c = $('.fb-caret', out); c && c.remove(); }, 1600);
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const q = input.value.trim() || (input.placeholder || '').replace(/[…\s]+$/, '');
    if (!q || q.startsWith('Beschreibe')) return;
    if (!input.value.trim()) input.value = q;
    answer(q);
  });
  $$('.fb-chips .chip').forEach(ch => ch.addEventListener('click', () => { input.value = ch.dataset.q; answer(ch.dataset.q); }));

  // Platzhalter tippt zyklisch Beispiele
  const EX = ['kühles Blond, aber natürlich …', 'graue Ansätze abdecken …', 'mehr Glanz für dunkles Haar …', 'warmes Kupfer für den Herbst …', 'sonnengeküsste Strähnen …', 'Locken mit mehr Volumen …'];
  let visFb = false;
  new IntersectionObserver(es => es.forEach(e => (visFb = e.isIntersecting)), { rootMargin: '100px 0px' }).observe(form);
  if (L.reduce) input.placeholder = EX[0];
  else {
    let ei = 0;
    const loop = async () => {
      for (;;) {
        if (!visFb || input.value || document.activeElement === input) { await wait(700); continue; }
        const s = EX[ei++ % EX.length];
        for (let i = 1; i <= s.length; i++) { if (input.value) break; input.placeholder = s.slice(0, i); await wait(42 + Math.random() * 40); }
        await wait(1800);
        for (let i = s.length; i >= 0; i--) { if (input.value) break; input.placeholder = s.slice(0, i); await wait(16); }
        await wait(380);
      }
    };
    loop();
  }

  /* ---------------- Preis-Skala & Längenschalter ---------------- */
  const MAX = 380;
  const segBtns = $$('[data-fa-len]');
  const def = $('[data-fa-def]');
  function syncPrices() {
    const len = L.length;
    segBtns.forEach(b => b.setAttribute('aria-checked', String(b.dataset.faLen === len)));
    if (def) def.textContent = LEN_DEF[len];
    $$('.fp-list li').forEach(li => {
      const p = L.price(li.dataset.key, len);
      li.classList.toggle('na', p == null);
      li.querySelector('.fp-bar i').style.setProperty('--s', p == null ? 0 : (p / MAX).toFixed(3));
    });
  }
  segBtns.forEach(b => b.addEventListener('click', () => L.setLength(b.dataset.faLen, 'farbe')));
  // Balken erst beim Sichtbarwerden ausfahren
  const list = $('.fp-list');
  let barsIn = false;
  new IntersectionObserver((es, o) => es.forEach(e => { if (e.isIntersecting) { barsIn = true; syncPrices(); o.disconnect(); } }), { threshold: 0.2 }).observe(list);
  if (def) def.textContent = LEN_DEF[L.length];
  segBtns.forEach(b => b.setAttribute('aria-checked', String(b.dataset.faLen === L.length)));

  document.addEventListener('lumen:length', () => { if (barsIn) syncPrices(); else { segBtns.forEach(b => b.setAttribute('aria-checked', String(b.dataset.faLen === L.length))); if (def) def.textContent = LEN_DEF[L.length]; } updateLen(); });

  window.LUMEN_FARBE = { setActive, answer, analyse };
})();

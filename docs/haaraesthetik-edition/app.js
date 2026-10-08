/* Haarästhetik · Die Chroma Edition – Effekte */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (v, a, b) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  let vw = innerWidth, vh = innerHeight;

  /* ---------- Kapitel-Index (Hero-Box + Sidebar) ---------- */
  const chapters = $$('[data-chapter]');
  $$('[data-index]').forEach(list => {
    list.innerHTML = chapters.map((c, i) =>
      `<li style="animation-delay:${0.9 + i * 0.06}s"><a href="#${c.id}"><span>${c.dataset.chapter}</span><span class="num">${c.dataset.num}</span></a></li>`).join('');
  });
  const sideLinks = $$('.side-index a');

  /* ---------- Lenis Smooth Scroll ---------- */
  let lenis = null;
  if (!reduce && window.Lenis) {
    lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 1, smoothWheel: true });
    document.documentElement.classList.add('lenis');
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const t = a.getAttribute('href') === '#top' ? 0 : $(a.getAttribute('href'));
    if (t === null) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(t, { duration: 1.6 });
    else (t === 0 ? scrollTo({ top: 0, behavior: 'smooth' }) : t.scrollIntoView({ behavior: 'smooth' }));
  });

  /* ---------- Sparkles in den Intros ---------- */
  $$('.sparkles').forEach(box => {
    let h = '';
    for (let i = 0; i < 16; i++) {
      const s = 6 + Math.random() * 18;
      h += `<i style="left:${Math.random() * 100}%;top:${Math.random() * 70}%;--s:${s}px;--d:${2.4 + Math.random() * 3}s;--dl:${-Math.random() * 5}s;--o:${0.4 + Math.random() * 0.6}"></i>`;
    }
    box.innerHTML = h;
  });

  /* ---------- Gerissene Kante (digital) ---------- */
  function buildTear(svg, seed) {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const W = 1000, H = 60;
    let x = 0, pts = [];
    while (x < W) {
      const y = 18 + rnd() * 30 - (rnd() < 0.12 ? 14 : 0);
      pts.push([x, y]);
      x += 4 + rnd() * 18;
    }
    pts.push([W, 30]);
    const line = pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
    let shards = '';
    for (let i = 0; i < 26; i++) {
      const sx = rnd() * W, sy = 2 + rnd() * 22, sw = 2 + rnd() * 9, sh = 1.5 + rnd() * 4;
      shards += `<rect x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${sw.toFixed(1)}" height="${sh.toFixed(1)}" opacity="${(0.4 + rnd() * 0.6).toFixed(2)}"/>`;
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML = `<g class="shards">${shards}</g><polygon class="fill" points="0,${H + 1} ${line} ${W},${H + 1}"/><polyline class="edge" vector-effect="non-scaling-stroke" points="${line}"/>`;
  }
  $$('.tear').forEach((svg, i) => buildTear(svg, i + 3));

  /* ---------- Reveal mit Stagger ---------- */
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      io.unobserve(en.target);
      en.target.dispatchEvent(new CustomEvent('reveal'));
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
  $$('.reveal').forEach(el => {
    const sib = [...el.parentElement.children].filter(c => c.classList.contains('reveal'));
    el.style.setProperty('--rd', `${Math.min(sib.indexOf(el), 6) * 0.08}s`);
    io.observe(el);
  });

  /* ---------- Zähler ---------- */
  $$('[data-count]').forEach(el => {
    const host = el.closest('.reveal') || el;
    host.addEventListener('reveal', () => {
      const to = +el.dataset.count, from = +(el.dataset.from || 0), t0 = performance.now(), dur = 1600;
      const step = now => {
        const k = clamp((now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
        el.textContent = Math.round(from + (to - from) * e);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, { once: true });
  });

  /* ---------- Preisliste mit Föhn-Schalter ---------- */
  const LEN = ['kurz', 'mittel', 'lang', 'aufwendig'];
  function renderLen(mode) {
    $$('.len').forEach(ul => {
      const vals = ul.dataset[mode].split(',');
      ul.innerHTML = vals.map((v, i) => `<li class="${v === '–' ? 'na' : ''}"><small>${LEN[i]}</small><b>${v === '–' ? '–' : v + ' €'}</b></li>`).join('');
    });
  }
  renderLen('ohne');
  const tog = $('.toggle');
  tog && tog.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.classList.contains('on')) return;
    $$('button', tog).forEach(x => x.classList.toggle('on', x === b));
    tog.classList.toggle('mit', b.dataset.mode === 'mit');
    $$('.len').forEach(ul => ul.classList.add('flip'));
    setTimeout(() => { renderLen(b.dataset.mode); $$('.len').forEach(ul => { ul.classList.add('flip'); requestAnimationFrame(() => requestAnimationFrame(() => ul.classList.remove('flip'))); }); }, 220);
  });

  /* ---------- Cloud Cards: Maus-Parallax ---------- */
  const cloud = $('[data-cloud]');
  if (cloud) {
    const cards = $$('.cloud-card', cloud);
    cards.forEach((c, i) => { if (c.classList.contains('float')) { c.style.opacity = 0; c.style.setProperty('--sc', 0.82); c.style.transitionDelay = `${0.2 + i * 0.09}s`; } });
    cloud.addEventListener('reveal', () => cards.forEach(c => { c.style.opacity = 1; c.style.setProperty('--sc', 1); setTimeout(() => (c.style.transitionDelay = '0s'), 1400); }));
    cloud.addEventListener('pointermove', e => {
      const r = cloud.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
      cards.forEach(c => {
        const d = +c.dataset.depth;
        c.style.setProperty('--mx', `${nx * d * -38}px`);
        c.style.setProperty('--my', `${ny * d * -30}px`);
      });
    });
    cloud.addEventListener('pointerleave', () => cards.forEach(c => { c.style.setProperty('--mx', '0px'); c.style.setProperty('--my', '0px'); }));
  }

  /* ---------- Tilt ---------- */
  $$('.tilt').forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 10}deg`);
      el.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - 0.5) * -10}deg`);
    });
    el.addEventListener('pointerleave', () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
  });

  /* ---------- Team-Marquee ---------- */
  const mq = $('.mq-track');
  if (mq) {
    const names = ['Christian', 'Yvo', 'Tatjana', 'Walled', 'Hendrik', 'Hamza', 'Lucien', 'Nero'];
    const one = names.map(n => `<span>${n}</span><span class="star">✦</span>`).join('');
    mq.innerHTML = one + one;
  }

  /* ---------- 3D-Wortwolke (Farbe) ---------- */
  const TAGS = [
    ['/balayage', 'mittel 285 € · lang 320 € · aufwendig 380 €'],
    ['/ansatzfarbe', 'bis 3 cm Nachwuchs · 66 €'],
    ['/komplettfarbe', 'kurz 78 € · mittel 98 € · lang 118 € · aufwendig 138 €'],
    ['/color-glossing', 'mittel 48 € · lang 70 € · aufwendig 90 €'],
    ['/highlights-teil', 'mittel 70 € · lang 88 € · aufwendig 105 €'],
    ['/highlights-komplett', 'mittel 120 € · lang 140 € · aufwendig 160 €'],
    ['/umformung', 'Teil 45–60 € · komplett 68–90 €'],
    ['/kupfer', 'warm und leuchtend: per Komplettfarbe oder Balayage'],
    ['/platin', 'kühl und hell: Highlights plus Glossing, im Gespräch planen'],
    ['/rosé', 'zarter Schimmer: Color Glossing ab 48 €'],
    ['/aschbraun', 'matt und edel: Komplettfarbe ab 78 €'],
    ['/glanz', 'Color Glossing frischt Ton und Glanz auf, ab 48 €'],
    ['/grau-kaschieren', 'Ansatzfarbe alle paar Wochen: 66 €'],
    ['/face-framing', 'Highlights Teilbehandlung ab 70 €'],
    ['/pflegeritual', 'individuell angepasst · 15 €'],
    ['/haaranalyse', 'digitaler Haartester · 45 €'],
    ['/heiße-schere', 'mittel 57 € · lang 66 € · aufwendig 75 €'],
    ['/brautlook', 'Braut-Beratung · 90 €'],
    ['/extensions', 'Great Lengths Beratung · 45 €'],
    ['/erstgespräch', 'für Neukunden · 29 €'],
  ];
  const tc = $('[data-tagcloud]');
  let tagTick = null;
  if (tc) {
    const stage = $('.tc-stage', tc), ptext = $('.prompt-text', tc);
    const n = TAGS.length, ga = Math.PI * (3 - Math.sqrt(5));
    const items = TAGS.map(([t, info], i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = t;
      stage.appendChild(b);
      const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
      const it = { el: b, x: Math.cos(th) * r, y, z: Math.sin(th) * r, t, info };
      b.addEventListener('click', () => select(it));
      return it;
    });
    let typing = 0;
    function select(it) {
      items.forEach(o => o.el.classList.toggle('sel', o === it));
      const full = `<b>${it.t}</b> → ${it.info}`;
      const plain = `${it.t} → ${it.info}`;
      const id = ++typing; let k = 0;
      const step = () => {
        if (id !== typing) return;
        k += 2;
        const shown = plain.slice(0, k);
        ptext.innerHTML = (k >= it.t.length ? `<b>${it.t}</b>${shown.slice(it.t.length)}` : `<b>${shown}</b>`) + '<span class="caret"></span>';
        if (k < plain.length) setTimeout(step, 18); else ptext.innerHTML = full;
      };
      step();
    }
    let ax = 0.35, ay = 0, tx = 0, ty = 0;
    tc.addEventListener('pointermove', e => {
      const r = tc.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 0.9;
      ty = ((e.clientY - r.top) / r.height - 0.5) * 0.6;
    });
    tc.addEventListener('pointerleave', () => { tx = 0; ty = 0; });
    let visible = false;
    new IntersectionObserver(([en]) => (visible = en.isIntersecting)).observe(tc);
    tagTick = (vel) => {
      if (!visible) return;
      const R = Math.min(tc.clientWidth * 0.42, 300), F = 700, sx2 = tc.clientWidth < 700 ? 0.62 : 1.35;
      ay += 0.0022 + tx * 0.012 + clamp(vel, -40, 40) * 0.0004;
      ax += (0.35 + ty - ax) * 0.03;
      const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
      for (const it of items) {
        const x1 = it.x * cy - it.z * sy, z1 = it.x * sy + it.z * cy;
        const y2 = it.y * cx - z1 * sx, z2 = it.y * sx + z1 * cx;
        const s = F / (F - z2 * R);
        const depth = (z2 + 1) / 2;
        it.el.style.transform = `translate(-50%,-50%) translate(${(x1 * R * s * sx2).toFixed(1)}px,${(y2 * R * s * 0.82).toFixed(1)}px) scale(${(0.45 + depth * 0.75).toFixed(3)})`;
        it.el.style.opacity = (0.18 + depth * 0.82).toFixed(2);
        it.el.style.zIndex = Math.round(depth * 100);
        it.el.style.filter = depth < 0.35 ? `blur(${((0.35 - depth) * 5).toFixed(1)}px)` : 'none';
      }
    };
    setTimeout(() => select(items[0]), 800);
  }

  /* ---------- Partikel-Portal (Canvas) ---------- */
  function Portal(canvas, opts) {
    const ctx = canvas.getContext('2d');
    const N = opts.n || 1200, P = [];
    const cols = ['255,255,255', '214,200,255', '182,156,255', '140,90,255'];
    for (let i = 0; i < N; i++) {
      const g = (Math.random() + Math.random() + Math.random()) / 3 - 0.5;
      P.push({ a: Math.random() * Math.PI * 2, r: 1 + g * 0.5, sp: (0.4 + Math.random()) * 0.0035 * (Math.random() < 0.85 ? 1 : -1), s: Math.random() < 0.06 ? 2.2 : 0.6 + Math.random() * 1.1, c: cols[(Math.random() * cols.length) | 0], tw: Math.random() * 6.28, out: Math.random() < 0.05 });
    }
    let W = 0, H = 0, dpr = Math.min(devicePixelRatio || 1, 1.5), on = false;
    const size = () => { const r = canvas.getBoundingClientRect(); W = r.width; H = r.height; canvas.width = W * dpr; canvas.height = H * dpr; };
    size(); addEventListener('resize', size);
    new IntersectionObserver(([en]) => (on = en.isIntersecting)).observe(canvas);
    this.draw = (t, strength, grow) => {
      if (!on) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (strength <= 0.01) return;
      const [cxr, cyr] = opts.center();
      const cx = W * cxr, cy = H * cyr;
      const R = Math.min(W, H) * (opts.r || 0.2) * grow;
      ctx.globalCompositeOperation = 'lighter';
      // weicher Kern
      const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.5);
      g.addColorStop(0, `rgba(182,156,255,${0.10 * strength})`);
      g.addColorStop(0.55, `rgba(113,38,255,${0.12 * strength})`);
      g.addColorStop(1, 'rgba(113,38,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.5, 0, 6.283); ctx.fill();
      for (const p of P) {
        p.a += p.sp;
        if (p.out) { p.r += 0.004; if (p.r > 2.2) p.r = 0.9; }
        const wob = 1 + Math.sin(p.a * 3 + t * 0.0012) * 0.04;
        const rr = R * p.r * wob;
        const x = cx + Math.cos(p.a) * rr, y = cy + Math.sin(p.a) * rr * (opts.tilt || 0.92);
        const al = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.004 + p.tw))) * strength * (p.out ? clamp(2.2 - p.r) : 1);
        ctx.fillStyle = `rgba(${p.c},${al.toFixed(3)})`;
        ctx.fillRect(x, y, p.s, p.s);
      }
      ctx.globalCompositeOperation = 'source-over';
    };
  }
  const heroPortal = $('.hero .portal') && new Portal($('.hero .portal'), { n: 1500, r: 0.21, center: () => [vw >= 900 ? 0.66 : 0.5, 0.5] });
  const contactPortal = $('.portal-2') && new Portal($('.portal-2'), { n: 1000, r: 0.3, tilt: 0.35, center: () => [vw >= 900 ? 0.78 : 0.6, 0.32] });

  /* ---------- Öffnungsstatus (Europe/Berlin) ---------- */
  function openStatus() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map(p => [p.type, p.value]));
    const d = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    const m = (+parts.hour % 24) * 60 + +parts.minute;
    const H = { 2: [540, 1080], 3: [540, 1080], 4: [540, 1080], 5: [540, 1080], 6: [540, 840] };
    const DN = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const fmt = x => `${String(x / 60 | 0).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
    let open = false, txt;
    if (H[d] && m >= H[d][0] && m < H[d][1]) { open = true; txt = `Geöffnet bis ${fmt(H[d][1])} Uhr`; }
    else {
      for (let k = 0; k < 8; k++) {
        const dd = (d + k) % 7;
        if (H[dd] && (k > 0 || m < H[dd][0])) { txt = `Geschlossen · öffnet ${k === 0 ? 'heute' : k === 1 ? 'morgen' : DN[dd]} ${fmt(H[dd][0])}`; break; }
      }
    }
    document.body.classList.toggle('is-open', open);
    $$('[data-open-status]').forEach(el => { el.classList.toggle('is-open', open); $('span', el).textContent = vw < 1200 && el.classList.contains('status') ? (open ? 'Geöffnet' : 'Geschlossen') : txt; });
    $$('[data-hours] li').forEach(li => li.classList.toggle('today', +li.dataset.d === d));
  }
  openStatus(); setInterval(openStatus, 60000);

  /* ---------- Scroll-Engine ---------- */
  const topbar = $('.topbar'), sidebar = $('.sidebar');
  const scrollEls = $$('[data-scroll]');
  const panels = $$('.panel');
  const hero = $('.hero'), heroBox = $('.hero-box');
  const rail = $('.htrack-rail');
  let lastY = scrollY, vel = 0;

  function measure() {
    vw = innerWidth; vh = innerHeight;
    if (rail) {
      const host = rail.closest('.htrack');
      const dist = Math.max(0, rail.scrollWidth - vw + 40);
      host.style.setProperty('--dist', `${dist}px`);
      host.style.height = `${vh + dist * 1.15 + vh * 0.2}px`;
    }
  }
  measure();
  addEventListener('resize', () => { measure(); openStatus(); });

  function onFrame(t) {
    const y = lenis ? lenis.scroll : scrollY;
    vel = vel * 0.85 + (y - lastY) * 0.15; lastY = y;

    for (const el of scrollEls) {
      const r = el.getBoundingClientRect();
      const span = Math.max(1, r.height - vh);
      el.style.setProperty('--p', clamp(-r.top / span).toFixed(4));
      el._p = clamp(-r.top / span);
    }

    // Hero → Sidebar-Morph
    const hp = hero._p || 0;
    const boxOut = smooth(hp, 0.04, 0.38);
    heroBox.style.setProperty('--bo', (1 - boxOut).toFixed(3));
    heroBox.style.setProperty('--bs', (1 - boxOut * 0.18).toFixed(3));
    heroBox.style.setProperty('--bx', `${(-boxOut * vw * 0.18).toFixed(1)}px`);
    heroBox.style.setProperty('--by', `${(-boxOut * vh * 0.22).toFixed(1)}px`);
    heroBox.style.pointerEvents = boxOut > 0.5 ? 'none' : '';
    const sideO = smooth(hp, 0.28, 0.5);
    sidebar.style.setProperty('--side-o', sideO.toFixed(3));
    sidebar.classList.toggle('live', sideO > 0.5);

    // Portal
    if (heroPortal) heroPortal.draw(t, smooth(hp, 0.02, 0.3) * (1 - smooth(hp, 0.85, 1)), 0.55 + smooth(hp, 0, 0.7) * 0.75);
    if (contactPortal) contactPortal.draw(t, 0.8, 1);

    // Header & Sidebar: helle Flächen erkennen
    let topOnPaper = false, sideOnPaper = false;
    for (const p of panels) {
      const r = p.getBoundingClientRect();
      if (r.top < 24 && r.bottom > 24) topOnPaper = true;
      if (r.top < vh - 120 && r.bottom > vh - 120) sideOnPaper = true;
    }
    topbar.classList.toggle('scrolled', y > 40);
    topbar.classList.toggle('on-paper', topOnPaper);
    sidebar.classList.toggle('on-paper', sideOnPaper);

    // Aktives Kapitel
    let act = -1;
    chapters.forEach((c, i) => { if (c.getBoundingClientRect().top < vh * 0.5) act = i; });
    sideLinks.forEach((a, i) => a.classList.toggle('active', i === act));

    if (tagTick) tagTick(vel);
    requestAnimationFrame(onFrame);
  }

  if (lenis) {
    const raf = time => { lenis.raf(time); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(onFrame);
})();

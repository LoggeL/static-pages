/* IX · Nacht – „Wir sehen uns morgen“ (dynamische Headline + 24h-Uhr) */
(() => {
  const L = window.LUMEN;
  const sec = document.getElementById('kontakt');
  if (!L || !sec) return;

  const HOURS = L.HOURS || { 2: [540, 1080], 3: [540, 1080], 4: [540, 1080], 5: [540, 1080], 6: [540, 840] };
  const fmt = L.fmtTime;
  const DAY = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const DS = ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'];
  const ORDER = [1, 2, 3, 4, 5, 6, 0]; // innen Montag … außen Sonntag
  const NS = 'http://www.w3.org/2000/svg';

  /* ---------- Dynamische Headline ---------- */
  const h = sec.querySelector('.kt-h');
  const stEl = sec.querySelector('[data-kt-status]');
  const dot = sec.querySelector('.kt-status .status-dot');
  function headline(s) {
    // ohne Uhrzeit (Kundenwunsch) – die genauen Zeiten stehen in der Öffnungszeiten-Liste
    if (s.open) return 'Wir sind <span class="pearl">jetzt</span> für dich da.';
    const n = s.next;
    if (!n) return 'Wir sehen uns <span class="pearl">bald</span>.';
    const when = n.k === 0 ? 'heute' : n.k === 1 ? 'morgen' : `am ${DAY[n.day]}`;
    return `Wir sehen uns <span class="pearl">${when}</span>.`;
  }
  // Wortweises Einblenden über den Core: Inhalt jetzt setzen, data-words splittet beim Start
  let lastHtml = '';
  function setHeadline(s, animate) {
    const html = headline(s);
    if (html === lastHtml) return;
    const first = !lastHtml;
    lastHtml = html;
    const apply = () => {
      h.innerHTML = html;
      if (!first) { delete h.dataset.split; L.splitWords(h); h.classList.add('in'); }
    };
    if (first || !animate || L.reduce) { apply(); return; }
    h.classList.add('swap');
    setTimeout(() => { apply(); requestAnimationFrame(() => h.classList.remove('swap')); }, 650);
  }
  h.setAttribute('data-words', '');
  h.style.transition = 'opacity .6s var(--ease), filter .6s var(--ease)';
  function syncStatus(s, animate) {
    if (!s) return;
    setHeadline(s, animate);
    if (stEl) stEl.textContent = s.text;
    if (dot) dot.classList.toggle('open', !!s.open);
  }
  syncStatus(L.status, false);
  document.addEventListener('lumen:status', e => syncStatus(e.detail, true));
  const css = document.createElement('style');
  css.textContent = '#kontakt .kt-h.swap{opacity:0;filter:blur(8px)}';
  document.head.appendChild(css);

  /* ---------- Öffnungszeiten-Liste ---------- */
  const lis = [...sec.querySelectorAll('.kt-days li')];
  lis.forEach(li => { const d = +li.dataset.day; li.classList.toggle('closed', !HOURS[d]); });
  function markToday(day) {
    lis.forEach(li => {
      const on = +li.dataset.day === day;
      li.classList.toggle('today', on);
      let tag = li.querySelector('.kt-today-tag');
      if (on && !tag) { tag = document.createElement('em'); tag.className = 'kt-today-tag'; tag.textContent = 'Heute'; li.querySelector('.kt-d').appendChild(tag); }
      if (!on && tag) tag.remove();
      if (on) li.setAttribute('aria-current', 'date'); else li.removeAttribute('aria-current');
    });
  }

  /* ---------- 24h-Zifferblatt ---------- */
  const svg = sec.querySelector('.kt-dial');
  const C = 400, R0 = 146, STEP = 27;
  const radius = i => R0 + i * STEP;
  const pt = (r, m) => { const a = (m / 1440) * Math.PI * 2 - Math.PI / 2; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const arc = (r, a, b) => {
    const [x0, y0] = pt(r, a), [x1, y1] = pt(r, b);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${b - a > 720 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const el = (tag, attrs = {}, parent = svg) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); parent.appendChild(n); return n; };

  const defs = el('defs');
  const g = el('linearGradient', { id: 'kdPearl', gradientUnits: 'userSpaceOnUse', x1: 120, y1: 160, x2: 700, y2: 640 }, defs);
  [['0', '#f1e2c4'], ['.35', '#d7e0e2'], ['.65', '#ead7dd'], ['1', '#e8d5b0']].forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, g));
  const f = el('filter', { id: 'kdGlow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
  el('feGaussianBlur', { stdDeviation: 3.2, result: 'b' }, f);
  const fm = el('feMerge', {}, f); el('feMergeNode', { in: 'b' }, fm); el('feMergeNode', { in: 'SourceGraphic' }, fm);

  el('circle', { class: 'kd-face', cx: C, cy: C, r: 392 });
  // Stunden-Ticks & Ziffern
  for (let hh = 0; hh < 24; hh++) {
    const major = hh % 3 === 0;
    const [x0, y0] = pt(major ? 334 : 338, hh * 60), [x1, y1] = pt(348, hh * 60);
    el('line', { class: `kd-tick${major ? ' major' : ''}`, x1: x0.toFixed(1), y1: y0.toFixed(1), x2: x1.toFixed(1), y2: y1.toFixed(1) });
    // statt Stundenziffern: Tageszeiten als Worte an den vier Hauptachsen
    if (hh % 6 === 0) {
      const side = hh % 12 !== 0;
      const [tx, ty] = pt(side ? 358 : 372, hh * 60);
      const anchor = hh === 6 ? 'start' : hh === 18 ? 'end' : 'middle';
      const t = el('text', { class: `kd-hl${hh === 12 ? ' key' : ''}`, x: tx.toFixed(1), y: ty.toFixed(1), 'text-anchor': anchor, 'dominant-baseline': 'central' });
      t.textContent = { 0: 'Nacht', 6: 'Morgen', 12: 'Mittag', 18: 'Abend' }[hh];
    }
  }
  // halbe Stunden als Punkte
  for (let m = 30; m < 1440; m += 60) { const [x, y] = pt(343, m); el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 0.8, fill: 'rgba(243,240,234,.25)' }); }

  // 7 Ringe
  const rings = {};
  ORDER.forEach((d, i) => {
    const r = radius(i);
    const grp = el('g', { class: 'kd-ring', 'data-day': d });
    el('path', { class: 'kd-base', d: arc(r, 34, 1406) }, grp);
    if (HOURS[d]) {
      const p = el('path', { class: 'kd-arc', d: arc(r, HOURS[d][0], HOURS[d][1]), pathLength: 1 }, grp);
      p.style.setProperty('--k', i);
    }
    const lb = el('text', { class: 'kd-day', x: C, y: C - r }, grp);
    lb.textContent = DS[d];
    rings[d] = grp;
  });

  // Mitte: aktuelle Berliner Tageszeit als Wort (keine Ziffern)
  const cTop = el('text', { class: 'kd-sub st', x: C, y: C - 52 });
  const cNow = el('text', { class: 'kd-now', x: C, y: C + 22 });
  const cDay = el('text', { class: 'kd-sub', x: C, y: C + 56 });

  // Zeiger
  const hand = el('g', { class: 'kd-hand' });
  el('line', { class: 'kd-tail', x1: C, y1: C - 104, x2: C, y2: C - 128 }, hand);
  el('line', { x1: C, y1: C - 130, x2: C, y2: C - 356 }, hand);
  el('circle', { class: 'kd-tip', cx: C, cy: C - 360, r: 3.2 }, hand);
  const cross = el('circle', { class: 'kd-cross', cx: C, cy: C - R0, r: 5 }, hand);
  const halo = el('circle', { class: 'kd-halo', cx: C, cy: C - R0, r: 7 }, hand);

  let lastDay = -1, lastDeg = null;
  function tick() {
    const now = L.berlinNow();
    const { day, min } = now;
    if (day !== lastDay) {
      lastDay = day;
      Object.keys(rings).forEach(k => rings[k].classList.toggle('today', +k === day));
      const r = radius(ORDER.indexOf(day));
      cross.setAttribute('cy', C - r); halo.setAttribute('cy', C - r);
      markToday(day);
      cDay.textContent = `Berlin · ${DAY[day]}`;
    }
    let deg = (min / 1440) * 360;
    // ohne Rückwärts-Rundlauf über Mitternacht
    if (lastDeg !== null && deg < lastDeg - 180) deg += 360 * Math.ceil((lastDeg - deg) / 360);
    lastDeg = deg;
    hand.style.transform = `rotate(${deg}deg)`;
    cNow.textContent = min < 330 ? 'Nacht' : min < 660 ? 'Morgen' : min < 840 ? 'Mittag' : min < 1050 ? 'Nachmittag' : min < 1260 ? 'Abend' : 'Nacht';
    const open = HOURS[day] && min >= HOURS[day][0] && min < HOURS[day][1];
    cTop.textContent = open ? 'Geöffnet · jetzt' : 'Geschlossen · jetzt';
    svg.setAttribute('data-now', `${day}:${min}`);
  }
  // Einzeichnen: Zeiger kommt von 0 Uhr, wenn die Uhr erscheint
  const clock = sec.querySelector('.kt-clock');
  if (!L.reduce) {
    hand.style.transform = 'rotate(0deg)';
    hand.style.transition = 'none';
    lastDeg = 0;
    const firstTick = () => { hand.style.transition = 'transform 2.4s cubic-bezier(.19,1,.22,1) .4s'; tick(); setTimeout(() => (hand.style.transition = ''), 3000); };
    clock.addEventListener('lumen:in', firstTick, { once: true });
    // Werte (Tag, Liste) sofort korrekt setzen, nur der Zeiger wartet
    const keep = hand.style.transform;
    tick(); hand.style.transform = keep; lastDeg = 0;
  } else tick();
  // minütlich, an der Minutengrenze ausgerichtet
  const toNextMin = 60000 - (Date.now() % 60000) + 50;
  setTimeout(() => { tick(); setInterval(tick, 60000); }, toNextMin);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

  /* ---------- Signatur „Haarästhetik“ hebt sich am Seitenende ---------- */
  const sign = sec.querySelector('.kt-sign span');
  const foot = sec.querySelector('.kt-foot');
  if (sign && foot && !L.reduce) {
    L.onFrame(() => {
      const r = foot.getBoundingClientRect();
      if (r.top > L.vh || r.bottom < 0) return;
      const k = L.clamp((L.vh - r.top) / r.height);
      sign.style.setProperty('--sy', `${(46 - 30 * k).toFixed(2)}%`);
    });
  }

  window.LUMEN_KONTAKT = { tick };
})();

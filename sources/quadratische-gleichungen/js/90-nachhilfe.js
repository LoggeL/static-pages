/* Kapitel 90 · Für die Nachhilfe
   Widgets: nh-plot, nh-check, nh-plan (60/90 + Stunden-Timer), nh-puzzle (Quadrat-Puzzle),
   nh-riddle (Mal-Plus-Rätsel), nh-blitz (Methoden-Blitz), nh-ampel (Selbsteinschätzung),
   nh-diagsheet und nh-solpage (Druckblätter, aus den vorhandenen Aufgaben gebaut).
   Dazu Druckmodi über [data-nh-print] (Attribut an #nachhilfe, nur in @media print wirksam). */
(function () {
  'use strict';
  var QG = window.QG;
  if (!QG) return;

  var SEC = 'nachhilfe';
  var MINUS = '−';
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function sec() { return document.getElementById(SEC); }
  function esc(s) { return QG.esc(s); }
  function fmt(x) { return QG.fmt(x); }
  function nz(a, b) { var v; do { v = QG.rand(a, b); } while (v === 0); return v; }

  /* =====================================================================
     Drucken: Modus setzen, dann drucken. Das Attribut wirkt nur im Druck-CSS.
     ===================================================================== */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-nh-print], [data-qg-print]');
    if (!b) return;
    var s = sec();
    if (!s) return;
    if (b.hasAttribute('data-qg-print')) { s.removeAttribute('data-nh-print'); return; } // Core-Druckknopf = alles
    s.setAttribute('data-nh-print', b.getAttribute('data-nh-print') || 'all');
    setTimeout(function () { window.print(); }, 60);
  });

  /* =====================================================================
     Koordinatensysteme
     ===================================================================== */
  function sq(x) { return x * x; }
  var PLOTS = {
    diag: { xmin: -5, xmax: 3, ymin: -5, ymax: 6, label: 'Parabel y = x² + 2x − 3',
      fns: [{ f: function (x) { return x * x + 2 * x - 3; }, color: 'blue' }] },
    a4: { xmin: -3, xmax: 5, ymin: -5, ymax: 6, label: 'Parabel y = x² − 2x − 3',
      fns: [{ f: function (x) { return x * x - 2 * x - 3; }, color: 'blue' }] },
    a10: { xmin: -3, xmax: 4, ymin: -2, ymax: 8, label: 'Normalparabel y = x² und Gerade y = x + 2',
      fns: [{ f: sq, color: 'blue' }, { f: function (x) { return x + 2; }, color: 'orange' }] },
    e3: { xmin: -1, xmax: 5, ymin: -2, ymax: 6, label: 'Parabel y = x² − 4x + 3',
      fns: [{ f: function (x) { return x * x - 4 * x + 3; }, color: 'blue' }] },
    heft3: { xmin: -3, xmax: 3, ymin: -1, ymax: 6, label: 'Normalparabel y = x² und Gerade y = −x + 2 mit Schnittpunkten (−2 | 4) und (1 | 1)',
      fns: [{ f: sq, color: 'blue' }, { f: function (x) { return -x + 2; }, color: 'orange' }],
      lines: [{ x1: -2, y1: 0, x2: -2, y2: 4, dash: true }, { x1: 1, y1: 0, x2: 1, y2: 1, dash: true }],
      points: [{ x: -2, y: 4, label: '(−2 | 4)', pos: 'ne', color: 'red' }, { x: 1, y: 1, label: '(1 | 1)', pos: 'e', color: 'red' }] },
    h6: { xmin: -4, xmax: 4, ymin: -1, ymax: 10, yscale: 0.6, ystep: 2, label: 'Normalparabel y = x² und Gerade y = −x + 6 mit Schnittpunkten (−3 | 9) und (2 | 4)',
      fns: [{ f: sq, color: 'blue' }, { f: function (x) { return -x + 6; }, color: 'orange' }],
      lines: [{ x1: -3, y1: 0, x2: -3, y2: 9, dash: true }, { x1: 2, y1: 0, x2: 2, y2: 4, dash: true }],
      points: [{ x: -3, y: 9, label: '(−3 | 9)', pos: 'e', color: 'red' }, { x: 2, y: 4, label: '(2 | 4)', pos: 'e', color: 'red' }] },
    schablone: { xmin: -4, xmax: 4, ymin: -1, ymax: 10, yscale: 0.55, ystep: 2, label: 'Normalparabel mit den Punkten für die Schablone',
      fns: [{ f: sq, color: 'blue' }],
      points: [-3, -2, -1, 0, 1, 2, 3].map(function (x) { return { x: x, y: x * x, color: 'orange' }; }) }
  };

  function drawPlot(el, key) {
    var c = PLOTS[key];
    if (!c) return null;
    el.classList.add('qg-plot-wrap');
    var o = { grid: true };
    Object.keys(c).forEach(function (k) { o[k] = c[k]; });
    return QG.plot(el, o);
  }
  QG.widget('nh-plot', function (el) { drawPlot(el, el.getAttribute('data-plot')); });

  /** Kopie für Druckblätter: IDs entfernen, Widgets neu zeichnen statt Core-Init. */
  function fixClone(root) {
    $$('[id]', root).forEach(function (e) { e.removeAttribute('id'); });
    var ws = $$('[data-widget]', root);
    if (root.hasAttribute && root.hasAttribute('data-widget')) ws.unshift(root);
    ws.forEach(function (w) {
      var kind = w.getAttribute('data-widget');
      w.removeAttribute('data-widget');
      w._qgWidget = true;
      if (kind === 'nh-plot') {
        var old = w.querySelector(':scope > svg');
        if (old) old.remove();
        drawPlot(w, w.getAttribute('data-plot'));
      }
    });
    return root;
  }

  /* Kurze Inline-Formeln nicht mitten im Term umbrechen */
  function noWrapShort(root) {
    $$('.m', root).forEach(function (m) {
      if (m.closest('.calc, .mblock')) return;
      if (m.textContent.replace(/\s+/g, ' ').trim().length <= 24) m.classList.add('nh-nw');
    });
  }
  QG.ready(function () { var s = sec(); if (s) noWrapShort(s); });

  /* =====================================================================
     Checkliste (gespeichert)
     ===================================================================== */
  QG.widget('nh-check', function (el) {
    var KEY = 'nh:check';
    var state = QG.store.get(KEY, {}) || {};
    var boxes = $$('input[type="checkbox"][data-k]', el);
    var count = $('.nh-check-count', el);
    var bar = $('.nh-check-bar > span', el);
    function upd() {
      var n = boxes.filter(function (b) { return b.checked; }).length;
      count.textContent = n + ' von ' + boxes.length + ' sicher';
      bar.style.width = (boxes.length ? 100 * n / boxes.length : 0) + '%';
      el.classList.toggle('all-done', n === boxes.length);
      return n;
    }
    boxes.forEach(function (b) {
      b.checked = !!state[b.getAttribute('data-k')];
      b.addEventListener('change', function () {
        state[b.getAttribute('data-k')] = b.checked;
        QG.store.set(KEY, state);
        if (upd() === boxes.length && b.checked) {
          QG.toast('Alles abgehakt – bereit für die HÜ!', { type: 'ok' });
          QG.celebrate(el);
        }
      });
    });
    var reset = $('.nh-check-reset', el);
    if (reset) reset.addEventListener('click', function () {
      boxes.forEach(function (b) { b.checked = false; });
      state = {};
      QG.store.set(KEY, state);
      upd();
      QG.toast('Checkliste zurückgesetzt');
    });
    upd();
  });

  /* =====================================================================
     Stundenplan: 60/90 Minuten + Stunden-Timer
     ===================================================================== */
  QG.widget('nh-plan', function (el) {
    var s = sec();
    var phases = $$('.nh-phase', s);
    var segBtns = $$('.nh-seg button', el);
    var dur = QG.store.get('nh:dur', 90) === 60 ? 60 : 90;
    var T = QG.store.get('nh:timer', null);
    if (!T || typeof T.acc !== 'number') T = { acc: 0, start: null };
    // Uralte, vergessene Timer (> 4 h) nicht wieder aufnehmen
    if (T.start && Date.now() - T.start > 4 * 3600 * 1000) T = { acc: 0, start: null };
    var clock = $('.nh-timer-clock', el), phaseTxt = $('.nh-timer-phase', el), bar = $('.nh-timer-bar > span', el);
    var go = $('.nh-timer-go', el), reset = $('.nh-timer-reset', el), expand = $('.nh-expand', el);
    var tick = null, lastIdx = null;
    var idleText = phaseTxt.textContent;

    function mins(ph) { return parseInt(ph.getAttribute(dur === 60 ? 'data-m60' : 'data-m90'), 10) || 0; }
    function schedule() {
      var t = 0;
      return phases.map(function (ph) { var m = mins(ph); var r = { el: ph, from: t, to: t + m, m: m }; t += m; return r; })
        .filter(function (p) { return p.m > 0; });
    }
    function title(ph) { var h3 = $('h3', ph); return h3 ? h3.textContent.trim() : ''; }
    function fmtT(ms) {
      var sec0 = Math.max(0, Math.floor(ms / 1000));
      var m = Math.floor(sec0 / 60), ss = sec0 % 60;
      return m + ':' + (ss < 10 ? '0' : '') + ss;
    }
    function elapsed() { return T.acc + (T.start ? Date.now() - T.start : 0); }
    function save() { QG.store.set('nh:timer', T); }

    function layout() {
      s.setAttribute('data-nh-dur', String(dur));
      segBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dur') === String(dur) ? 'true' : 'false'); });
      var sch = schedule();
      phases.forEach(function (ph) { ph.classList.toggle('nh-skip', mins(ph) === 0); });
      var num = 0, hasPause = false;
      sch.forEach(function (p) {
        $('.nh-ph-range', p.el).textContent = 'Min. ' + p.from + '–' + p.to;
        $('.nh-ph-len', p.el).textContent = p.m + ' Min.';
        if (p.el.classList.contains('nh-phase-pause')) hasPause = true;
        else $('.nh-ph-num', p.el).textContent = String(++num);
      });
      var total = sch.length ? sch[sch.length - 1].to : 0;
      $('.nh-plan-total', el).textContent = total + ' Minuten';
      $('.nh-plan-count', el).textContent = num + ' Phasen' + (hasPause ? ' + Pause' : '');
      var pd = $('.nh-print-dur', el);
      if (pd) pd.textContent = ' · Variante für ' + total + ' Minuten';
      lastIdx = null;
      render();
    }

    function render() {
      var ms = elapsed();
      var sch = schedule();
      var total = sch.length ? sch[sch.length - 1].to : 0;
      var min = ms / 60000;
      var idx = -1;
      if (ms > 0) {
        idx = sch.length;
        for (var i = 0; i < sch.length; i++) if (min < sch[i].to) { idx = i; break; }
      }
      clock.textContent = fmtT(ms) + ' / ' + total + ':00';
      bar.style.width = (total ? Math.min(100, 100 * min / total) : 0) + '%';
      phases.forEach(function (ph) { ph.classList.remove('is-now', 'is-past'); });
      if (idx === -1) {
        phaseTxt.textContent = idleText;
      } else if (idx >= sch.length) {
        sch.forEach(function (p) { p.el.classList.add('is-past'); });
        phaseTxt.innerHTML = '<b>Zeit ist um.</b> Gut gemacht – jetzt noch die Hausaufgabe mitgeben.';
      } else {
        var p = sch[idx];
        p.el.classList.add('is-now');
        for (var j = 0; j < idx; j++) sch[j].el.classList.add('is-past');
        phaseTxt.innerHTML = '<b>' + esc(title(p.el)) + '</b> · noch ' + fmtT(p.to * 60000 - ms);
      }
      if (T.start && lastIdx !== null && idx !== lastIdx) {
        if (idx >= sch.length) QG.toast('⏱ Die Stunde ist um.', { ms: 5000 });
        else if (idx >= 0) QG.toast('⏱ Nächste Phase: ' + title(sch[idx].el), { ms: 5000 });
        if (navigator.vibrate) { try { navigator.vibrate(180); } catch (e) { /* egal */ } }
      }
      lastIdx = idx;
      go.textContent = T.start ? '⏸ Pause' : (ms > 0 ? '▶ Weiter' : '▶ Stunde starten');
      reset.hidden = ms === 0;
      el.classList.toggle('is-running', !!T.start);
    }

    function startTick() { if (!tick) tick = setInterval(render, 1000); }
    function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

    go.addEventListener('click', function () {
      if (T.start) { T.acc += Date.now() - T.start; T.start = null; stopTick(); }
      else {
        T.start = Date.now(); startTick();
        var now = phases.filter(function (ph) { return ph.classList.contains('is-now'); })[0];
        if (!now && T.acc === 0) QG.toast('Los geht’s: ' + title(schedule()[0].el));
      }
      save();
      render();
    });
    reset.addEventListener('click', function () {
      T = { acc: 0, start: null };
      stopTick(); save(); lastIdx = null; render();
    });
    segBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        dur = b.getAttribute('data-dur') === '60' ? 60 : 90;
        QG.store.set('nh:dur', dur);
        layout();
      });
    });
    function allDetails() { return $$('.nh-phase:not(.nh-skip) > details.more', s); }
    function updExpand() {
      var open = allDetails().every(function (d) { return d.open; });
      expand.textContent = open ? 'Alle Phasen zuklappen' : 'Alle Phasen aufklappen';
      expand.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    expand.addEventListener('click', function () {
      var ds = allDetails();
      var open = ds.every(function (d) { return d.open; });
      ds.forEach(function (d) { d.open = !open; });
      updExpand();
    });
    $$('.nh-phase > details.more', s).forEach(function (d) { d.addEventListener('toggle', updExpand); });

    layout();
    updExpand();
    if (T.start) startTick();
  });

  /* =====================================================================
     Quadrat-Puzzle (quadratische Ergänzung)
     ===================================================================== */
  QG.widget('nh-puzzle', function (el) {
    var P = [2, 4, 6, 8, 10];
    var p = 6, step = 1;
    el.innerHTML =
      '<div class="nh-pz-ctrl">' +
        '<div class="nh-pz-p" role="group" aria-label="Zahl vor dem x wählen">' +
          '<span class="nh-pz-pre" aria-hidden="true"><var>x</var>² +</span>' +
          P.map(function (v) { return '<button type="button" data-p="' + v + '" aria-pressed="false" aria-label="x² + ' + v + 'x">' + v + '<var>x</var></button>'; }).join('') +
        '</div>' +
        '<div class="nh-pz-steps" role="group" aria-label="Schritt wählen">' +
          ['Streifen', 'halbieren', 'ergänzen'].map(function (t, i) { return '<button type="button" data-s="' + (i + 1) + '" aria-pressed="false"><b>' + (i + 1) + '</b> ' + t + '</button>'; }).join('') +
        '</div>' +
      '</div>' +
      '<div class="nh-pz-stage"></div>' +
      '<p class="nh-pz-cap" aria-live="polite"></p>' +
      '<div class="btn-row nh-pz-nav"><button type="button" class="btn primary nh-pz-next">Nächster Schritt</button></div>';
    var stage = $('.nh-pz-stage', el), cap = $('.nh-pz-cap', el), next = $('.nh-pz-next', el);

    function T(x, y, txt, cls, rot) {
      return '<text x="' + x + '" y="' + y + '"' + (cls ? ' class="' + cls + '"' : '') +
        (rot ? ' transform="rotate(-90 ' + x + ' ' + y + ')"' : '') + '>' + txt + '</text>';
    }
    function R(x, y, w, h, cls) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" class="' + cls + '"/>'; }
    var X = '<tspan class="it">x</tspan>';
    function cx(k) { return (k === 1 ? '' : k) + X; } // „3x“, bei 1 nur „x“

    function render() {
      var S = 150, u = 16, half = p / 2, h = half * u, full = p * u, gap = 16;
      var ox = 34, oy = 30, W = 34 + 150 + 16 + 160 + 12, H = 30 + 150 + 80 + 14;
      var g = '';
      // x²
      g += R(ox, oy, S, S, 'sq') + T(ox + S / 2, oy + S / 2, X + '²', 'big');
      g += T(ox + S / 2, oy - 13, X, 'dim') + T(ox - 14, oy + S / 2, X, 'dim');
      if (step === 1) {
        var sx = ox + S + gap;
        g += R(sx, oy, full, S, 'st') + T(sx + full / 2, oy + S / 2, cx(p), full < 40 ? 'small' : '', full < 40);
        g += T(sx + full / 2, oy - 13, String(p), 'dim');
      } else {
        g += R(ox + S, oy, h, S, 'st') + T(ox + S + h / 2, oy + S / 2, cx(half), h < 40 ? 'small' : '', h < 40);
        g += R(ox, oy + S, S, h, 'st') + T(ox + S / 2, oy + S + h / 2, cx(half), h < 22 ? 'small' : '');
        g += T(ox + S + h / 2, oy - 13, String(half), 'dim') + T(ox - 14, oy + S + h / 2, String(half), 'dim');
        if (step === 2) {
          g += R(ox + S, oy + S, h, h, 'gap') + T(ox + S + h / 2, oy + S + h / 2, '?', h < 22 ? 'small q' : 'q');
        } else {
          g += R(ox + S, oy + S, h, h, 'cn') + T(ox + S + h / 2, oy + S + h / 2, String(half * half), h < 22 ? 'small cnt' : 'cnt');
          // Rahmen um das große Quadrat
          g += '<rect x="' + (ox - 4) + '" y="' + (oy - 4) + '" width="' + (S + h + 8) + '" height="' + (S + h + 8) + '" rx="6" class="frame"/>';
        }
      }
      stage.innerHTML = '<svg class="nh-pz-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Flächenmodell zur quadratischen Ergänzung von x² + ' + p + 'x, Schritt ' + step + ' von 3">' + g + '</svg>';

      var hp = fmt(half), hq = fmt(half * half);
      var hx = half === 1 ? 'x' : hp + 'x';
      var txt;
      if (step === 1) txt = '<span class="m">x² + ' + p + 'x</span>: ein Quadrat <span class="m">x²</span> und ein Streifen <span class="m">' + p + 'x</span> (Breite ' + p + ').';
      else if (step === 2) txt = 'Streifen halbieren: zweimal <span class="m">' + hx + '</span>, an zwei Seiten angelegt. Es fehlt eine Ecke!';
      else txt = 'Ecke ergänzen: <span class="m">' + hp + ' · ' + hp + ' = ' + hq + '</span>. Jetzt ist es ein Quadrat: <span class="m">x² + ' + p + 'x + ' + hq + ' = (x + ' + hp + ')²</span>';
      cap.innerHTML = txt;
      QG.math(cap);
      noWrapShort(cap);
      $$('.nh-pz-p button', el).forEach(function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-p') === p)); });
      $$('.nh-pz-steps button', el).forEach(function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-s') === step)); });
      next.textContent = step < 3 ? 'Nächster Schritt' : 'Von vorn';
    }
    $$('.nh-pz-p button', el).forEach(function (b) {
      b.addEventListener('click', function () { p = +b.getAttribute('data-p'); render(); });
    });
    $$('.nh-pz-steps button', el).forEach(function (b) {
      b.addEventListener('click', function () { step = +b.getAttribute('data-s'); render(); });
    });
    next.addEventListener('click', function () { step = step < 3 ? step + 1 : 1; render(); });
    render();
  });

  /* =====================================================================
     Mal-Plus-Rätsel (Kopfrechen-Warm-up)
     ===================================================================== */
  function factorHtml(m) { return '(x ' + (m < 0 ? MINUS + ' ' : '+ ') + Math.abs(m) + ')'; }
  function setHtml(vals) {
    var v = vals.slice().sort(function (a, b) { return a - b; }).filter(function (x, i, a) { return i === 0 || x !== a[i - 1]; });
    return 'L = {' + v.map(fmt).join('; ') + '}';
  }

  QG.widget('nh-riddle', function (el) {
    var neg = QG.store.get('nh:rneg', true) !== false;
    var cur = null;
    el.innerHTML =
      '<div class="nh-rd-card">' +
        '<p class="nh-rd-ask">Gesucht: zwei ganze Zahlen</p>' +
        '<div class="nh-rd-nums">' +
          '<div class="nh-rd-box"><span class="nh-rd-lbl">mal</span><span class="nh-rd-val nh-rd-prod"></span></div>' +
          '<div class="nh-rd-box"><span class="nh-rd-lbl">plus</span><span class="nh-rd-val nh-rd-sum"></span></div>' +
        '</div>' +
        '<div class="nh-rd-res" aria-live="polite"></div>' +
      '</div>' +
      '<div class="btn-row nh-rd-btns">' +
        '<button type="button" class="btn primary nh-rd-show">Auflösen</button>' +
        '<button type="button" class="btn nh-rd-next">Neues Rätsel</button>' +
        '<label class="nh-rd-neg"><input type="checkbox"> mit negativen Zahlen</label>' +
      '</div>';
    var prod = $('.nh-rd-prod', el), sum = $('.nh-rd-sum', el), res = $('.nh-rd-res', el);
    var show = $('.nh-rd-show', el), nextB = $('.nh-rd-next', el), cb = $('.nh-rd-neg input', el);
    cb.checked = neg;
    function next() {
      var m, n, guard = 0;
      do {
        if (neg) { m = nz(-9, 9); n = nz(-9, 9); } else { m = QG.rand(1, 9); n = QG.rand(1, 9); }
      } while ((m + n === 0 || (cur && cur.m * cur.n === m * n && cur.m + cur.n === m + n)) && ++guard < 60);
      cur = { m: m, n: n };
      prod.textContent = fmt(m * n);
      sum.textContent = fmt(m + n);
      res.innerHTML = '';
      show.hidden = false;
    }
    function reveal() {
      var a = Math.min(cur.m, cur.n), b = Math.max(cur.m, cur.n);
      var fac = a === b ? factorHtml(a) + '²' : factorHtml(a) + factorHtml(b);
      res.innerHTML =
        '<p class="nh-rd-pair"><b>' + fmt(a) + '</b> und <b>' + fmt(b) + '</b></p>' +
        '<p class="m">' + QG.poly(1, a + b, a * b) + ' = 0</p>' +
        '<p class="m">' + fac + ' = 0</p>' +
        '<p class="m nh-rd-l">' + setHtml([-a, -b]) + '</p>';
      QG.math(res);
      show.hidden = true;
      nextB.focus({ preventScroll: true });
    }
    show.addEventListener('click', reveal);
    nextB.addEventListener('click', next);
    cb.addEventListener('change', function () { neg = cb.checked; QG.store.set('nh:rneg', neg); next(); });
    next();
  });

  /* =====================================================================
     Methoden-Blitz
     ===================================================================== */
  var METHODS = [
    { k: 'wurzel', name: 'Wurzel ziehen' },
    { k: 'aus', name: '<var>x</var> ausklammern' },
    { k: 'binom', name: 'Binomische Formel' },
    { k: 'vieta', name: 'Produkt-Summen-Trick' },
    { k: 'erg', name: 'Quadratische Ergänzung' }
  ];
  function M(html) { return '<span class="m nh-nw">' + html + '</span>'; }
  var XT = '<span class="nh-nw"><var>x</var>-Term</span>';
  function mName(k) { return METHODS.filter(function (m) { return m.k === k; })[0].name; }

  function genBlitz(type) {
    var e = { k: type, alt: {} };
    if (type === 'wurzel') {
      var k = QG.rand(2, 9), v = QG.rand(0, 5);
      if (v === 5) {
        e.eq = QG.poly(1, 0, k * k) + ' = 0';
        e.L = 'L = { }';
        e.why = 'Kein ' + XT + ' → <var>x</var>² allein stellen: ' + M('<var>x</var>² = ' + MINUS + k * k) + '. Ein Quadrat ist nie negativ, also keine Lösung.';
      } else {
        var a = v >= 3 ? QG.rand(2, 4) : 1;
        e.eq = v === 0 ? '<var>x</var>² = ' + k * k : QG.poly(a, 0, -a * k * k) + ' = 0';
        e.L = setHtml([-k, k]);
        e.why = 'Kein ' + XT + ' → ' + (a > 1 ? 'durch ' + a + ' teilen, ' : '') + M('<var>x</var>² = ' + k * k) + ' → ' + M('<var>x</var> = ±' + k) + '.';
        e.alt.binom = 'Geht auch mit der 3. binomischen Formel – Wurzel ziehen ist aber schneller.';
      }
      e.alt.erg = 'Geht zwar, aber hier gibt es nichts zu ergänzen. Wurzel ziehen ist der direkte Weg.';
    } else if (type === 'aus') {
      var b = nz(-9, 9), a2 = QG.rand(0, 3) === 0 ? QG.rand(2, 4) : 1;
      e.eq = QG.poly(a2, a2 * b, 0) + ' = 0';
      e.L = setHtml([0, -b]);
      e.why = 'Keine Zahl ohne <var>x</var> → ' + (a2 > 1 ? a2 : '') + '<var>x</var> ausklammern: ' + M((a2 > 1 ? a2 : '') + '<var>x</var> · ' + factorHtml(b).replace(/x/g, '<var>x</var>') + ' = 0') + '.';
      e.alt.erg = 'Geht auch, ist aber ein Umweg. Ohne Zahlterm ist Ausklammern in einer Zeile erledigt.';
    } else if (type === 'binom') {
      var kk = nz(-8, 8);
      e.eq = QG.poly(1, 2 * kk, kk * kk) + ' = 0';
      e.L = setHtml([-kk]);
      e.why = 'Erster und letzter Summand sind Quadrate (<var>x</var>² und ' + kk * kk + ' = ' + Math.abs(kk) + '²), in der Mitte steht ' +
        M((kk < 0 ? MINUS : '') + '2 · <var>x</var> · ' + Math.abs(kk)) + ' → ' + M(factorHtml(kk).replace(/x/g, '<var>x</var>') + '² = 0') + '.';
      e.alt.vieta = 'Klappt auch: Das Rätsel ergibt zweimal dieselbe Zahl. Die binomische Formel sieht man aber schneller.';
      e.alt.erg = 'Geht, aber die Gleichung ist schon fertig ergänzt – das ist eine binomische Formel.';
    } else if (type === 'vieta') {
      var r, s2, guard = 0;
      do { r = nz(-9, 9); s2 = nz(-9, 9); } while ((r === s2 || r === -s2 || Math.abs(r * s2) > 40) && ++guard < 80);
      e.eq = QG.poly(1, -(r + s2), r * s2) + ' = 0';
      e.L = setHtml([r, s2]);
      var m1 = -r, m2 = -s2;
      e.why = 'Mal ' + fmt(m1 * m2) + ', plus ' + fmt(m1 + m2) + ' → ' + fmt(Math.min(m1, m2)) + ' und ' + fmt(Math.max(m1, m2)) + '. Also ' +
        M((factorHtml(Math.min(m1, m2)) + factorHtml(Math.max(m1, m2))).replace(/x/g, '<var>x</var>') + ' = 0') + '.';
      e.alt.erg = 'Geht auch – die Ergänzung klappt immer. Der Produkt-Summen-Trick ist hier aber schneller.';
    } else {
      var h = nz(-4, 4), d = QG.pick([2, 3, 5, 6, 7, 8, 10, 11, -1, -2, -3]);
      var q = h * h - d;
      e.eq = QG.poly(1, 2 * h, q) + ' = 0';
      if (d < 0) e.L = 'L = { }';
      else {
        var c = fmt(-h);
        e.L = 'L = {' + c + ' ' + MINUS + ' √' + d + '; ' + c + ' + √' + d + '}';
      }
      e.why = 'Keine zwei ganzen Zahlen passen für den Produkt-Summen-Trick → ergänzen: ' + M(factorHtml(h).replace(/x/g, '<var>x</var>') + '² = ' + fmt(d)) +
        (d < 0 ? '. Ein Quadrat ist nie negativ → keine Lösung.' : '.');
    }
    return e;
  }

  QG.widget('nh-blitz', function (el) {
    var score = 0, total = 0, cur = null, lastType = null, answered = false;
    el.innerHTML =
      '<div class="nh-blitz-card">' +
        '<p class="nh-blitz-score" aria-live="polite">Welcher Weg ist hier am bequemsten?</p>' +
        '<p class="m nh-blitz-eq"></p>' +
      '</div>' +
      '<div class="nh-blitz-opts" role="group" aria-label="Weg auswählen">' +
        METHODS.map(function (m) { return '<button type="button" data-k="' + m.k + '">' + m.name + '</button>'; }).join('') +
      '</div>' +
      '<div class="feedback nh-blitz-fb" aria-live="polite"></div>' +
      '<div class="btn-row nh-blitz-nav"><button type="button" class="btn primary nh-blitz-next" hidden>Nächste Karte</button></div>';
    var eq = $('.nh-blitz-eq', el), fb = $('.nh-blitz-fb', el), sc = $('.nh-blitz-score', el), nextB = $('.nh-blitz-next', el);
    var btns = $$('.nh-blitz-opts button', el);

    function next() {
      var types = ['wurzel', 'aus', 'binom', 'vieta', 'erg', 'vieta', 'erg'];
      var t;
      do { t = QG.pick(types); } while (t === lastType);
      lastType = t;
      cur = genBlitz(t);
      eq.innerHTML = cur.eq;
      fb.innerHTML = '';
      answered = false;
      btns.forEach(function (b) { b.disabled = false; b.className = ''; });
      nextB.hidden = true;
    }
    function answer(b) {
      if (answered) return;
      answered = true;
      total++;
      var k = b.getAttribute('data-k');
      var type, msg;
      if (k === cur.k) { score++; type = 'ok'; msg = '<b>Genau.</b> ' + cur.why; b.className = 'is-ok'; }
      else if (cur.alt[k]) { score++; type = 'info'; msg = cur.alt[k] + ' <b>Am schnellsten: ' + mName(cur.k) + '.</b> ' + cur.why; b.className = 'is-alt'; }
      else {
        type = 'bad'; msg = '<b>Besser: ' + mName(cur.k) + '.</b> ' + cur.why; b.className = 'is-bad';
      }
      btns.forEach(function (x) {
        x.disabled = true;
        if (x.getAttribute('data-k') === cur.k && x !== b) x.className = 'is-ok';
      });
      fb.innerHTML = '<div class="fb ' + type + '"><span>' + msg + '<span class="fb-nudge">Lösung: <span class="m nh-nw">' + cur.L + '</span></span></span></div>';
      QG.math(fb);
      sc.textContent = score + ' von ' + total + ' passend gewählt';
      nextB.hidden = false;
      nextB.focus({ preventScroll: true });
    }
    btns.forEach(function (b) { b.addEventListener('click', function () { answer(b); }); });
    nextB.addEventListener('click', next);
    next();
  });

  /* =====================================================================
     Ampel-Selbsteinschätzung
     ===================================================================== */
  QG.widget('nh-ampel', function (el) {
    var KEY = 'nh:ampel';
    var st = QG.store.get(KEY, {}) || {};
    var LV = [['g', 'sicher'], ['y', 'geht so'], ['r', 'unsicher']];
    var rows = $$('.nh-amp-row', el);
    var adv = $('.nh-amp-advice', el);
    rows.forEach(function (row) {
      var k = row.getAttribute('data-key');
      var name = $('.nh-amp-name', row).textContent.replace(/^\W+/, '').trim();
      var wrap = QG.h('div', { class: 'nh-amp-btns', role: 'group', 'aria-label': 'Wie sicher bei ' + name + '?' });
      LV.forEach(function (lv) {
        var b = QG.h('button', { type: 'button', class: 'nh-amp nh-amp-' + lv[0], 'aria-pressed': 'false' },
          '<span class="nh-amp-dot" aria-hidden="true"></span><span>' + lv[1] + '</span>');
        b.addEventListener('click', function () {
          st[k] = st[k] === lv[0] ? null : lv[0];
          QG.store.set(KEY, st);
          update();
        });
        wrap.appendChild(b);
      });
      row.appendChild(wrap);
    });
    function update() {
      rows.forEach(function (row) {
        $$('.nh-amp', row).forEach(function (b, i) { b.setAttribute('aria-pressed', st[row.getAttribute('data-key')] === LV[i][0] ? 'true' : 'false'); });
      });
      var by = function (c) { return rows.filter(function (r) { return st[r.getAttribute('data-key')] === c; }); };
      var red = by('r'), yel = by('y');
      var any = rows.some(function (r) { return st[r.getAttribute('data-key')]; });
      var focus = red.length ? red : yel;
      if (!any) adv.innerHTML = '';
      else if (!focus.length) adv.innerHTML = '<b>Alles grün – stark!</b> Bis zur HÜ reichen täglich 10 Minuten im Trainingsraum und eine Probe-HÜ.';
      else adv.innerHTML = '<b>Schwerpunkt bis zur HÜ:</b> ' + focus.map(function (r) { return esc(r.getAttribute('data-ha')); }).join('<br>');
    }
    update();
  });

  /* =====================================================================
     Druckblätter: Diagnose-Blatt und Lösungsblatt
     ===================================================================== */
  QG.widget('nh-diagsheet', function (el) {
    var list = $('.nh-diagsheet-list', el);
    if (!list || list.children.length) return;
    $$('#nh-diagnose .nh-dq').forEach(function (q) {
      var item = QG.h('div', { class: 'nh-ds-item' });
      item.appendChild(fixClone(q.cloneNode(true)));
      item.appendChild(QG.h('div', { class: 'nh-space s1', 'aria-hidden': 'true' }));
      list.appendChild(item);
    });
  });

  QG.widget('nh-solpage', function (el) {
    var list = $('.nh-sol-list', el);
    if (!list || list.children.length) return;
    $$('#' + SEC + ' .nh-sheet .tasks').forEach(function (tl) {
      var grp = QG.h('section', { class: 'nh-sol-group' }, '<h3>' + esc(tl.getAttribute('data-nh-title') || '') + '</h3>');
      $$(':scope > .task', tl).forEach(function (t, i) {
        var sol = $(':scope > details.solution > div', t);
        if (!sol) return;
        var item = QG.h('div', { class: 'nh-sol-item' });
        var head = QG.h('p', { class: 'nh-sol-q' }, '<b>' + (i + 1) + '.</b> ');
        var q = $('.task-q', t);
        if (q) {
          var qc = fixClone(q.cloneNode(true));
          $$('.no-print', qc).forEach(function (n) { n.remove(); });
          while (qc.firstChild) head.appendChild(qc.firstChild);
        }
        item.appendChild(head);
        item.appendChild(fixClone(sol.cloneNode(true)));
        grp.appendChild(item);
      });
      list.appendChild(grp);
    });
  });
})();

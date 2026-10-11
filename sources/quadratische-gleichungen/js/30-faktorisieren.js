/* Kapitel 30 · Faktorisieren – Widgets
   fakt-null   : Nullprodukt-Explorer (x per Schieberegler, Faktoren leuchten bei 0)
   fakt-wurzel : x² = k mit Schieberegler und Normalparabel (0/1/2 Lösungen)
   fakt-vieta  : Zahlenpaar-Finder für x² + px + q = 0 (Produkt-Summen-Trick) */
(function () {
  'use strict';
  var QG = window.QG;
  if (!QG || !QG.widget) return;

  var MINUS = '−';
  var uid = 0;

  /** "x − 2" bzw. "x + 5" als HTML für den Faktor (x − r) */
  function factorFromRoot(r) {
    return '<var>x</var> ' + (r >= 0 ? MINUS + ' ' + QG.fmt(r) : '+ ' + QG.fmt(-r));
  }
  /** "x + u" als HTML (u ≠ 0) */
  function xPlus(u) {
    return '<var>x</var> ' + (u < 0 ? MINUS + ' ' + QG.fmt(-u) : '+ ' + QG.fmt(u));
  }
  /** Zahl in Klammern, wenn negativ: (−3) */
  function par(n) { return n < 0 ? '(' + QG.fmt(n) + ')' : QG.fmt(n); }
  /** Ganze Zahl aus Eingabe (akzeptiert −, –, +) oder null */
  function parseIntInput(s) {
    var t = String(s == null ? '' : s).replace(/[−–‒—]/g, '-').replace(/\s+/g, '').replace(/^\+/, '');
    if (!/^-?\d{1,4}$/.test(t)) return null;
    var v = parseInt(t, 10);
    return v === 0 ? 0 : v; // −0 vermeiden
  }
  function setL(values) {
    var v = values.slice().sort(function (a, b) { return a - b; });
    var out = [];
    v.forEach(function (x) { if (!out.length || Math.abs(out[out.length - 1] - x) > 1e-9) out.push(x); });
    return 'L = {' + out.map(function (x) { return QG.fmt(x); }).join(';\u00a0') + '}';
  }
  function bindSteppers(root, apply) {
    Array.prototype.forEach.call(root.querySelectorAll('.fk-step'), function (b) {
      b.addEventListener('click', function () { apply(b); });
    });
  }

  /** Kurze Inline-Formeln (≤ 24 Zeichen) nicht mitten im Term umbrechen. */
  function noWrapShort(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.m'), function (m) {
      if (m.closest('.calc, .mblock, button') || m.classList.contains('fk-nw-done')) return;
      m.classList.add('fk-nw-done');
      if (m.textContent.replace(/\s+/g, ' ').trim().length <= 24) m.classList.add('fk-nw');
    });
  }
  QG.ready(function () {
    var sec = document.getElementById('faktorisieren');
    if (sec) noWrapShort(sec);
  });

  /* =====================================================================
     Nullprodukt-Explorer
     ===================================================================== */
  QG.widget('fakt-null', function (el) {
    var r1 = parseFloat(el.getAttribute('data-a') || '2');
    var r2 = parseFloat(el.getAttribute('data-b') || '-5');
    var lo = Math.floor(Math.min(r1, r2)) - 2;
    var hi = Math.ceil(Math.max(r1, r2)) + 3;
    var x = 0;
    var found = {};
    var celebrated = false;
    var id = 'fk-null-' + (++uid);

    el.innerHTML =
      '<p class="fk-w-title">Probier es aus</p>' +
      '<p class="fk-w-sub">Verschieb <span class="m">x</span>. Bei welchen Werten wird das Produkt 0? Finde beide!</p>' +
      '<div class="fk-null-eq">' +
        '<div class="fk-f" data-i="1"><span class="fk-f-term m">(' + factorFromRoot(r1) + ')</span><span class="fk-f-val"></span></div>' +
        '<span class="fk-op" aria-hidden="true">·</span>' +
        '<div class="fk-f" data-i="2"><span class="fk-f-term m">(' + factorFromRoot(r2) + ')</span><span class="fk-f-val"></span></div>' +
        '<span class="fk-op" aria-hidden="true">=</span>' +
        '<div class="fk-f fk-prod"><span class="fk-f-term">Produkt</span><span class="fk-f-val"></span></div>' +
      '</div>' +
      '<div class="fk-slider">' +
        '<button type="button" class="fk-step" data-d="-0.5" aria-label="x um 0,5 verkleinern">−</button>' +
        '<span class="fk-range"><input type="range" id="' + id + '" min="' + lo + '" max="' + hi + '" step="0.5" value="' + x + '" aria-label="Wert für x"></span>' +
        '<button type="button" class="fk-step" data-d="0.5" aria-label="x um 0,5 vergrößern">+</button>' +
      '</div>' +
      '<p class="fk-xval"><span class="m">x = <b class="fk-x"></b></span></p>' +
      '<p class="fk-null-msg" aria-live="polite"></p>' +
      '<div class="fk-found"><span class="fk-found-l">Gefunden:</span><span class="fk-chip" data-r="1">?</span><span class="fk-chip" data-r="2">?</span></div>' +
      '<p class="fk-null-done" hidden></p>';

    var range = el.querySelector('input[type="range"]');
    var f1 = el.querySelector('.fk-f[data-i="1"]');
    var f2 = el.querySelector('.fk-f[data-i="2"]');
    var fp = el.querySelector('.fk-prod');
    var xOut = el.querySelector('.fk-x');
    var msg = el.querySelector('.fk-null-msg');
    var done = el.querySelector('.fk-null-done');
    var chips = { 1: el.querySelector('.fk-chip[data-r="1"]'), 2: el.querySelector('.fk-chip[data-r="2"]') };
    // gefundene Nullstellen in der Reihenfolge ihres Auffindens anzeigen
    var order = [];

    function render() {
      var a = x - r1, b = x - r2, p = a * b;
      f1.querySelector('.fk-f-val').textContent = QG.fmt(a);
      f2.querySelector('.fk-f-val').textContent = QG.fmt(b);
      fp.querySelector('.fk-f-val').textContent = QG.fmt(p);
      var z1 = Math.abs(a) < 1e-9, z2 = Math.abs(b) < 1e-9;
      f1.classList.toggle('is-zero', z1);
      f2.classList.toggle('is-zero', z2);
      fp.classList.toggle('is-zero', z1 || z2);
      xOut.textContent = QG.fmt(x);
      msg.classList.toggle('is-zero', z1 || z2);
      if (z1 || z2) {
        msg.innerHTML = 'Der ' + (z1 ? '1.' : '2.') + ' Faktor ist 0 – also ist das ganze Produkt 0!';
        var key = z1 ? 1 : 2;
        if (!found[key]) {
          found[key] = true;
          order.push(key);
          order.forEach(function (k, i) {
            var c = chips[i + 1];
            c.innerHTML = '<span class="m"><var>x</var> = ' + QG.fmt(k === 1 ? r1 : r2) + '</span> ✓';
            c.classList.add('is-found');
          });
        }
      } else {
        msg.innerHTML = 'Keiner der beiden Faktoren ist 0 – deshalb ist auch das Produkt nicht 0.';
      }
      if (found[1] && found[2] && !celebrated) {
        celebrated = true;
        done.hidden = false;
        done.innerHTML = 'Stark – beide gefunden! Genau das sagt der Satz vom Nullprodukt: <span class="m">(' + factorFromRoot(r1) + ')(' + factorFromRoot(r2) + ') = 0</span> hat die Lösungsmenge <span class="m">' + setL([r1, r2]) + '</span>.';
        QG.math(done);
        QG.celebrate(done);
      }
    }
    function setX(v) {
      x = Math.max(lo, Math.min(hi, Math.round(v * 2) / 2));
      range.value = String(x);
      render();
    }
    range.addEventListener('input', function () { setX(parseFloat(range.value)); });
    bindSteppers(el, function (b) { setX(x + parseFloat(b.getAttribute('data-d'))); });
    render();
  });

  /* =====================================================================
     x² = k  (Wurzel ziehen, 0/1/2 Lösungen)
     ===================================================================== */
  QG.widget('fakt-wurzel', function (el) {
    var k = parseInt(el.getAttribute('data-k') || '9', 10);
    var KMIN = -4, KMAX = 16;
    var id = 'fk-wurzel-' + (++uid);
    el.innerHTML =
      '<p class="fk-w-title">Wie viele Lösungen hat <span class="m">x² = k</span>?</p>' +
      '<p class="fk-w-sub">Die Lösungen sind die Stellen, an denen die Normalparabel <span class="m">y = x²</span> die Höhe <span class="m">k</span> erreicht. Verschieb <span class="m">k</span>.</p>' +
      '<div class="fk-slider">' +
        '<button type="button" class="fk-step" data-d="-1" aria-label="k um 1 verkleinern">−</button>' +
        '<span class="fk-range"><input type="range" id="' + id + '" min="' + KMIN + '" max="' + KMAX + '" step="1" value="' + k + '" aria-label="Wert für k"></span>' +
        '<button type="button" class="fk-step" data-d="1" aria-label="k um 1 vergrößern">+</button>' +
      '</div>' +
      '<p class="fk-kval"><span class="m">k = <b class="fk-k"></b></span></p>' +
      '<div class="fk-plot qg-plot-wrap"></div>' +
      '<div class="fk-w-out" aria-live="polite"></div>';
    var range = el.querySelector('input[type="range"]');
    var kOut = el.querySelector('.fk-k');
    var out = el.querySelector('.fk-w-out');
    var host = el.querySelector('.fk-plot');
    var base = {
      xmin: -6, xmax: 6, ymin: -5, ymax: 17, yscale: 0.5, grid: true,
      label: 'Normalparabel y = x² und waagrechte Gerade y = k'
    };
    var plot = null;

    function opts() {
      var pts = [], lines = [{ y: k, color: 'violet', dash: true, width: 2.5 }];
      if (k > 0) {
        var s = Math.sqrt(k), exact = Math.abs(s - Math.round(s)) < 1e-9;
        lines.push({ x1: -s, y1: 0, x2: -s, y2: k, color: 'green', dash: '3 4' });
        lines.push({ x1: s, y1: 0, x2: s, y2: k, color: 'green', dash: '3 4' });
        pts.push({ x: -s, y: k, color: 'violet', label: 'x₁ ' + (exact ? '= −' : '≈ −') + QG.fmt(s), pos: 'sw' });
        pts.push({ x: s, y: k, color: 'violet', label: 'x₂ ' + (exact ? '= ' : '≈ ') + QG.fmt(s), pos: 'se' });
        pts.push({ x: -s, y: 0, color: 'green', r: 4.5 });
        pts.push({ x: s, y: 0, color: 'green', r: 4.5 });
      } else if (k === 0) {
        pts.push({ x: 0, y: 0, color: 'violet', label: 'x = 0', pos: 'n' });
      }
      return Object.assign({}, base, {
        fns: [{ f: function (x) { return x * x; }, color: 'green', label: 'y = x²', labelAt: -3.9, labelPos: 'w' }],
        lines: lines,
        points: pts,
        texts: [{ x: 5.9, y: k, text: 'y = ' + QG.fmt(k), color: 'violet', pos: k >= 15 ? 'sw' : 'nw' }]
      });
    }

    function render() {
      kOut.textContent = QG.fmt(k);
      if (!plot) plot = QG.plot(host, opts());
      else plot.update(opts());
      var eq, note;
      if (k > 0) {
        var s = Math.sqrt(k), exact = Math.abs(s - Math.round(s)) < 1e-9;
        if (exact) {
          eq = 'x² = ' + QG.fmt(k) + ' &nbsp;⇒&nbsp; x = ±' + QG.fmt(s) + ' &nbsp;⇒&nbsp; ' + setL([-s, s]);
        } else {
          eq = 'x² = ' + QG.fmt(k) + ' &nbsp;⇒&nbsp; x = ±√' + k + ' ≈ ±' + QG.fmt(s) + ' &nbsp;⇒&nbsp; L = {−√' + k + '; √' + k + '}';
        }
        note = '<b>Zwei Schnittpunkte → zwei Lösungen.</b> Die zweite Lösung ist immer die Gegenzahl der ersten.';
      } else if (k === 0) {
        eq = 'x² = 0 &nbsp;⇒&nbsp; x = 0 &nbsp;⇒&nbsp; L = {0}';
        note = '<b>Ein Berührpunkt → eine Lösung.</b> Die Gerade berührt die Parabel nur im Scheitelpunkt.';
      } else {
        eq = 'x² = ' + QG.fmt(k) + ' &nbsp;⇒&nbsp; L = { }';
        note = '<b>Kein Schnittpunkt → keine Lösung.</b> Die Normalparabel kommt nie unter die <span class="m">x</span>-Achse: Ein Quadrat ist nie negativ.';
      }
      out.innerHTML = '<p class="fk-w-eq m">' + eq + '</p><p class="fk-w-note">' + note + '</p>';
      QG.math(out);
      noWrapShort(out);
    }
    function setK(v) {
      k = Math.max(KMIN, Math.min(KMAX, Math.round(v)));
      range.value = String(k);
      render();
    }
    range.addEventListener('input', function () { setK(parseFloat(range.value)); });
    bindSteppers(el, function (b) { setK(k + parseFloat(b.getAttribute('data-d'))); });
    render();
  });

  /* =====================================================================
     Zahlenpaar-Finder (Produkt-Summen-Trick / Satz von Vieta)
     ===================================================================== */
  QG.widget('fakt-vieta', function (el) {
    var P = parseIntInput(el.getAttribute('data-p'));
    var Q = parseIntInput(el.getAttribute('data-q'));
    if (P == null) P = 5;
    if (Q == null) Q = 6;
    var PMAX = 99, QMAX = 999;
    var n = ++uid;
    var presets = [[5, 6], [-1, -12], [2, -15], [-10, 25], [0, -49], [4, -3]];

    function field(name) {
      var fid = 'fk-v-' + name + '-' + n;
      return '<div class="fk-v-field">' +
        '<label for="' + fid + '" class="m">' + name + ' =</label>' +
        '<button type="button" class="fk-step" data-n="' + name + '" data-d="-1" aria-label="' + name + ' um 1 verkleinern">−</button>' +
        '<input id="' + fid + '" class="fk-v-in" data-n="' + name + '" type="text" inputmode="numeric" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done">' +
        '<button type="button" class="fk-step" data-n="' + name + '" data-d="1" aria-label="' + name + ' um 1 vergrößern">+</button>' +
        '<button type="button" class="fk-step" data-n="' + name + '" data-flip="1" aria-label="Vorzeichen von ' + name + ' wechseln" title="Vorzeichen wechseln">±</button>' +
      '</div>';
    }

    el.innerHTML =
      '<p class="fk-w-title">Zahlenpaar-Finder</p>' +
      '<p class="fk-w-sub">Für <span class="m">x² + px + q = 0</span>: Gesucht sind <span class="m">u</span> und <span class="m">v</span> mit <span class="m">u · v = q</span> und <span class="m">u + v = p</span>.</p>' +
      '<div class="fk-v-eq m"></div>' +
      '<div class="fk-v-inputs">' + field('p') + field('q') + '</div>' +
      '<div class="fk-v-presets" role="group" aria-label="Beispiele laden"><span class="fk-v-presets-l">Beispiele:</span>' +
        presets.map(function (pq, i) {
          return '<button type="button" class="btn fk-v-preset" data-i="' + i + '"><span class="fk-pre-t">' + QG.poly(1, pq[0], pq[1]) + '</span></button>';
        }).join('') +
      '</div>' +
      '<div class="fk-v-out" aria-live="polite"></div>';

    var eqEl = el.querySelector('.fk-v-eq');
    var out = el.querySelector('.fk-v-out');
    var inP = el.querySelector('.fk-v-in[data-n="p"]');
    var inQ = el.querySelector('.fk-v-in[data-n="q"]');

    function showInputs() {
      inP.value = QG.fmt(P);
      inQ.value = QG.fmt(Q);
      inP.classList.remove('is-bad');
      inQ.classList.remove('is-bad');
    }

    function pairs(q) {
      var a = Math.abs(q), res = [];
      for (var d = 1; d * d <= a; d++) {
        if (a % d === 0) {
          res.push([d, q / d]);
          // bei q < 0 und d² = |q| wäre (−d, d) nur dasselbe Paar vertauscht
          if (!(q < 0 && d * d === a)) res.push([-d, -q / d]);
        }
      }
      return res;
    }

    function signHint(p, q) {
      if (q > 0) {
        if (p > 0) return '<span class="m">q</span> ist positiv → gleiche Vorzeichen. <span class="m">p</span> ist positiv → beide Zahlen positiv.';
        if (p < 0) return '<span class="m">q</span> ist positiv → gleiche Vorzeichen. <span class="m">p</span> ist negativ → beide Zahlen negativ.';
        return '<span class="m">q</span> ist positiv → gleiche Vorzeichen. Dann kann die Summe aber nie 0 sein.';
      }
      if (p > 0) return '<span class="m">q</span> ist negativ → verschiedene Vorzeichen. <span class="m">p</span> ist positiv → die betragsgrößere Zahl ist positiv.';
      if (p < 0) return '<span class="m">q</span> ist negativ → verschiedene Vorzeichen. <span class="m">p</span> ist negativ → die betragsgrößere Zahl ist negativ.';
      return '<span class="m">q</span> ist negativ → verschiedene Vorzeichen. <span class="m">p = 0</span> → beide Zahlen gleich groß.';
    }

    function render() {
      eqEl.innerHTML = QG.poly(1, P, Q) + ' = 0';
      var html = '';
      if (Q === 0) {
        var sols = P === 0 ? [0] : [0, -P];
        html =
          '<div class="fk-v-res ok">' +
          '<p><b><span class="m">q = 0</span>: Das Zahlglied fehlt.</b> Hier ist <a href="#fakt-a">Werkzeug A</a> am schnellsten – <span class="m">x</span> ausklammern:</p>' +
          '<div class="calc">' +
            (P === 0
              ? '<div class="row"><span class="l">x²</span><span class="r">= 0</span><span class="op">|&#8288;&nbsp;Wurzel ziehen</span></div>' +
                '<div class="row result"><span class="l">x</span><span class="r">= 0</span></div>'
              : '<div class="row"><span class="l">' + QG.poly(1, P, 0) + '</span><span class="r">= 0</span><span class="op">|&#8288;&nbsp;x ausklammern</span></div>' +
                '<div class="row"><span class="l">x · (' + xPlus(P) + ')</span><span class="r">= 0</span><span class="op">|&#8288;&nbsp;Satz vom Nullprodukt</span></div>' +
                '<div class="row"><span class="fk-sol">x1 = 0 &nbsp;oder&nbsp; x2 = ' + QG.fmt(-P) + '</span></div>') +
          '</div>' +
          '<p class="fk-L"><span class="m">' + setL(sols) + '</span></p>' +
          '</div>';
        out.innerHTML = html;
        QG.math(eqEl); QG.math(out);
        return;
      }

      var list = pairs(Q);
      var match = null;
      var rows = list.map(function (pr) {
        var u = pr[0], v = pr[1], s = u + v, ok = s === P;
        if (ok && !match) match = pr;
        return '<tr' + (ok ? ' class="is-match"' : '') + '>' +
          '<td class="num">' + QG.fmt(u) + '</td>' +
          '<td class="num">' + QG.fmt(v) + '</td>' +
          '<td class="num">' + QG.fmt(u * v) + '</td>' +
          '<td class="num">' + QG.fmt(s) + '</td>' +
          '<td class="c ' + (ok ? 'fk-v-ok' : 'fk-v-no') + '">' + (ok ? '✓ passt' : '–') + '</td>' +
          '</tr>';
      }).join('');

      html += '<p class="fk-v-goal"><span class="m">u · v = ' + QG.fmt(Q) + '</span> &nbsp;und&nbsp; <span class="m">u + v = ' + QG.fmt(P) + '</span></p>';
      html += '<p class="fk-v-hint">' + signHint(P, Q) + '</p>';
      html += '<div class="table-wrap"><table class="nice fk-vt">' +
        '<caption class="sr-only">Alle ganzzahligen Paare mit Produkt ' + QG.fmt(Q) + '</caption>' +
        '<thead><tr><th class="num" scope="col"><span class="m">u</span></th><th class="num" scope="col"><span class="m">v</span></th>' +
        '<th class="num" scope="col"><span class="m">u · v</span></th><th class="num" scope="col"><span class="m">u + v</span></th><th class="c" scope="col">passt?</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';

      if (match) {
        var u = match[0], v = match[1];
        var same = u === v;
        html += '<div class="fk-v-res ok">' +
          '<p><b>Gefunden:</b> <span class="m">u = ' + QG.fmt(u) + '</span> und <span class="m">v = ' + QG.fmt(v) + '</span>, denn <span class="m">' + par(u) + ' · ' + par(v) + ' = ' + QG.fmt(Q) + '</span> und <span class="m">' + par(u) + ' + ' + par(v) + ' = ' + QG.fmt(P) + '</span>.</p>' +
          '<div class="calc">' +
            '<div class="row"><span class="l">' + QG.poly(1, P, Q) + '</span><span class="r">= 0</span><span class="op">|&#8288;&nbsp;u = ' + QG.fmt(u) + ', v = ' + QG.fmt(v) + '</span></div>' +
            (same
              ? '<div class="row"><span class="l">(' + xPlus(u) + ')²</span><span class="r">= 0</span><span class="op">|&#8288;&nbsp;binomische Formel</span></div>' +
                '<div class="row"><span class="l">' + xPlus(u) + '</span><span class="r">= 0</span><span class="op">|&#8288;&nbsp;' + (u > 0 ? MINUS + ' ' + QG.fmt(u) : '+ ' + QG.fmt(-u)) + '</span></div>' +
                '<div class="row result"><span class="l">x</span><span class="r">= ' + QG.fmt(-u) + '</span></div>'
              : '<div class="row"><span class="l">(' + xPlus(u) + ')(' + xPlus(v) + ')</span><span class="r">= 0</span><span class="op">|&#8288;&nbsp;Satz vom Nullprodukt</span></div>' +
                '<div class="row"><span class="fk-sol">x1 = ' + QG.fmt(-u) + ' &nbsp;oder&nbsp; x2 = ' + QG.fmt(-v) + '</span></div>') +
          '</div>' +
          (same ? '<p class="small">Beide Zahlen sind gleich – das ist eine binomische Formel. Es gibt nur <b>eine</b> Lösung.</p>' : '<p class="small">Vorzeichen umdrehen nicht vergessen: Aus <span class="m">' + xPlus(u) + ' = 0</span> folgt <span class="m">x = ' + QG.fmt(-u) + '</span>.</p>') +
          '<p class="fk-L"><span class="m">' + setL(same ? [-u] : [-u, -v]) + '</span></p>' +
          '</div>';
      } else {
        html += '<div class="fk-v-res bad">' +
          '<p><b>Kein Paar passt:</b> Bei keinem Paar ist die Summe <span class="m">' + QG.fmt(P) + '</span>.</p>' +
          '<p>Nicht ganzzahlig zerlegbar → nimm die quadratische Ergänzung.</p>' +
          '<button type="button" class="btn primary" data-qg-go="ergaenzung">Zu Weg 3: Quadratische Ergänzung →</button>' +
          '</div>';
      }
      out.innerHTML = html;
      QG.math(eqEl);
      QG.math(out);
      noWrapShort(out);
    }

    function readInput(inp) {
      var name = inp.getAttribute('data-n');
      var v = parseIntInput(inp.value);
      var max = name === 'p' ? PMAX : QMAX;
      if (v == null || Math.abs(v) > max) {
        inp.classList.add('is-bad');
        out.innerHTML = '<p class="fk-v-msg">Bitte für <span class="m">' + name + '</span> eine ganze Zahl zwischen ' + QG.fmt(-max) + ' und ' + max + ' eingeben.</p>';
        QG.math(out);
        return;
      }
      inp.classList.remove('is-bad');
      if (name === 'p') P = v; else Q = v;
      render();
    }
    [inP, inQ].forEach(function (inp) {
      inp.addEventListener('input', function () { readInput(inp); });
      inp.addEventListener('blur', function () { if (!inp.classList.contains('is-bad')) showInputs(); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    });
    bindSteppers(el, function (b) {
      var name = b.getAttribute('data-n');
      var max = name === 'p' ? PMAX : QMAX;
      var cur = name === 'p' ? P : Q;
      var nv = b.hasAttribute('data-flip') ? -cur : cur + parseInt(b.getAttribute('data-d'), 10);
      nv = Math.max(-max, Math.min(max, nv));
      if (nv === 0) nv = 0;
      if (name === 'p') P = nv; else Q = nv;
      showInputs();
      render();
    });
    Array.prototype.forEach.call(el.querySelectorAll('.fk-v-preset'), function (b) {
      b.addEventListener('click', function () {
        var pq = presets[parseInt(b.getAttribute('data-i'), 10)];
        P = pq[0]; Q = pq[1];
        showInputs();
        render();
      });
    });
    showInputs();
    render();
  });
})();

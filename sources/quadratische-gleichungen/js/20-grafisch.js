/* Kapitel 20 · Weg 1: Grafisch lösen
   Widgets: graf-plot (statische Koordinatensysteme), graf-labor (Parabel-Labor),
   graf-gerade (Normalparabel ∩ Gerade mit Missionen). */
(function () {
  'use strict';
  var QG = window.QG;
  if (!QG) return;

  var MINUS = '−';
  var EPS = 1e-9;
  var fmt = QG.fmt;

  /* ------------------------------------------------------------ Hilfen */
  function sq(x) { return x * x; }
  function isHalf(x) { return Math.abs(x * 2 - Math.round(x * 2)) < 1e-7; }
  function exact2(x) { return Math.abs(x * 100 - Math.round(x * 100)) < 1e-7; }
  /** Zahl mit „≈“, falls sie bei 2 Nachkommastellen gerundet wird */
  function num(x) { return (exact2(x) ? '' : '≈ ') + fmt(x); }

  /** Lösungen von a·x² + b·x + c = 0 (nur intern zum Markieren – keine Formel im Text!) */
  function roots(a, b, c) {
    var D = b * b - 4 * a * c;
    var tol = 1e-9 * Math.max(1, Math.abs(b * b), Math.abs(4 * a * c));
    if (D < -tol) return [];
    if (Math.abs(D) <= tol) return [-b / (2 * a)];
    var s = Math.sqrt(D);
    return [(-b - s) / (2 * a), (-b + s) / (2 * a)].sort(function (u, v) { return u - v; });
  }

  /** Scheitelpunktform a·(x − d)² + e als HTML */
  function vform(a, d, e) {
    var pre;
    if (Math.abs(a - 1) < EPS) pre = '';
    else if (Math.abs(a + 1) < EPS) pre = MINUS;
    else pre = fmt(a) + '·';
    var core;
    if (Math.abs(d) < EPS) {
      core = '<var>x</var>²';
      if (pre.slice(-1) === '·') pre = pre.slice(0, -1);
    } else {
      core = '(<var>x</var> ' + (d > 0 ? MINUS + ' ' : '+ ') + fmt(Math.abs(d)) + ')²';
    }
    var s = pre + core;
    if (Math.abs(e) > EPS) s += ' ' + QG.sign(e);
    return s;
  }

  function pt(x, y) { return '(' + fmt(x) + ' | ' + fmt(y) + ')'; }
  function setPct(input) {
    var min = +input.min, max = +input.max, v = +input.value;
    input.style.setProperty('--pct', (100 * (v - min) / (max - min)).toFixed(1) + '%');
  }
  var uid = 0;

  /** Schieberegler-Zeile */
  function sliderRow(p, labelHtml, min, max, step, color, title) {
    var id = 'graf-sl-' + (++uid);
    var row = QG.h('div', { class: 'graf-sl', 'data-p': p, style: '--sl-c: var(--c-' + color + ')' },
      '<label for="' + id + '" title="' + QG.esc(title || '') + '"><span class="m">' + labelHtml + '</span></label>' +
      '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" aria-label="' + QG.esc(title || p) + '">' +
      '<output for="' + id + '"></output>');
    return row;
  }

  /* ============================================================
     Statische Koordinatensysteme
     ============================================================ */
  function f1(a, b, c) { return function (x) { return a * x * x + b * x + c; }; }
  function tablePts(f, xs, color) {
    return xs.map(function (x) { return { x: x, y: f(x), color: color || 'blue', r: 4 }; });
  }
  function zeroPts(xs) {
    return xs.map(function (x, i) {
      return { x: x, y: 0, color: 'orange', r: 6.5, label: 'N' + (xs.length > 1 ? (i ? '₂' : '₁') : ''), pos: i ? 'ne' : 'nw' };
    });
  }

  var PLOTS = {
    idee: function () {
      var f = f1(1, -2, -3);
      return {
        xmin: -3, xmax: 5, ymin: -5, ymax: 5, label: 'Parabel y = x² − 2x − 3 mit den Nullstellen −1 und 3',
        fns: [{ f: f, color: 'blue' }],
        texts: [{ x: 3.3, y: -4.4, text: 'y = x² − 2x − 3', color: 'blue' }],
        points: zeroPts([-1, 3])
      };
    },
    trio2: function () {
      return { xmin: -3, xmax: 3, ymin: -2, ymax: 4, ticks: false, label: 'Parabel schneidet die x-Achse zweimal',
        fns: [{ f: f1(1, 0, -1), color: 'blue' }], points: [{ x: -1, y: 0, color: 'orange', r: 7 }, { x: 1, y: 0, color: 'orange', r: 7 }] };
    },
    trio1: function () {
      return { xmin: -3, xmax: 3, ymin: -2, ymax: 4, ticks: false, label: 'Parabel berührt die x-Achse im Scheitelpunkt',
        fns: [{ f: f1(1, 0, 0), color: 'blue' }], points: [{ x: 0, y: 0, color: 'orange', r: 7 }] };
    },
    trio0: function () {
      return { xmin: -3, xmax: 3, ymin: -2, ymax: 4, ticks: false, label: 'Parabel läuft über der x-Achse vorbei',
        fns: [{ f: f1(1, 0, 1), color: 'blue' }] };
    },
    bspA: function () {
      var f = f1(1, 2, -3);
      return {
        xmin: -5, xmax: 3, ymin: -5, ymax: 6, label: 'Parabel y = x² + 2x − 3 mit Wertetabelle, Nullstellen −3 und 1',
        fns: [{ f: f, color: 'blue' }],
        points: tablePts(f, [-4, -2, 0, 2]).concat([{ x: -1, y: -4, color: 'slate', r: 5, label: 'S', pos: 's' }]).concat(zeroPts([-3, 1]))
      };
    },
    bspB: function () {
      return {
        xmin: -3, xmax: 4, ymin: -1, ymax: 6, label: 'Normalparabel und Gerade y = x + 2 schneiden sich bei x = −1 und x = 2',
        fns: [{ f: f1(1, 0, 0), color: 'blue', label: 'y = x²', labelAt: -2.3, labelPos: 'e' },
          { f: function (x) { return x + 2; }, color: 'orange' }],
        texts: [{ x: 3.05, y: 1.2, text: 'y = x + 2', color: 'orange' }],
        points: [{ x: -1, y: 1, color: 'violet', r: 6.5, label: 'P₁', pos: 'se' }, { x: 2, y: 4, color: 'violet', r: 6.5, label: 'P₂', pos: 'e' }],
        lines: [{ x1: -1, y1: 1, x2: -1, y2: 0, color: 'violet', dash: true }, { x1: 2, y1: 4, x2: 2, y2: 0, color: 'violet', dash: true }]
      };
    },
    a1: function () {
      return { xmin: -5, xmax: 4, ymin: -7, ymax: 4, label: 'Parabel y = x² + x − 6', fns: [{ f: f1(1, 1, -6), color: 'blue' }] };
    },
    a2: function () {
      return { xmin: -1, xmax: 5, ymin: -4, ymax: 3, label: 'Parabel y = −x² + 4x − 3', fns: [{ f: f1(-1, 4, -3), color: 'blue' }] };
    },
    a3: function () {
      return { xmin: -4, xmax: 2, ymin: -5, ymax: 2, label: 'Parabel y = −x² − 2x − 1', fns: [{ f: f1(-1, -2, -1), color: 'blue' }] };
    },
    a4: function () {
      return { xmin: -3, xmax: 2, ymin: -5, ymax: 4, minor: true, label: 'Parabel y = 4x² + 4x − 3 mit Halbkästchen-Raster', fns: [{ f: f1(4, 4, -3), color: 'blue' }] };
    },
    a5: function () {
      return {
        xmin: -3, xmax: 3, ymin: -1, ymax: 6, label: 'Normalparabel y = x² und Gerade y = −x + 2',
        fns: [{ f: f1(1, 0, 0), color: 'blue', label: 'y = x²', labelAt: 2.35, labelPos: 'w' },
          { f: function (x) { return -x + 2; }, color: 'orange' }],
        texts: [{ x: -2.05, y: 0.75, text: 'y = −x + 2', color: 'orange' }]
      };
    },
    a6: function () {
      var f = f1(1, -2, -8);
      return {
        xmin: -4, xmax: 6, ymin: -10, ymax: 8, yscale: 0.55, ystep: 2, label: 'Parabel y = x² − 2x − 8 mit Nullstellen −2 und 4',
        fns: [{ f: f, color: 'blue' }],
        points: tablePts(f, [-3, -1, 0, 2, 3, 5]).concat([{ x: 1, y: -9, color: 'slate', r: 5, label: 'S(1 | −9)', pos: 'e' }]).concat(zeroPts([-2, 4]))
      };
    },
    a8: function () {
      return {
        xmin: -3, xmax: 4, ymin: -3, ymax: 7, label: 'Normalparabel und Gerade y = 3x − 2 schneiden sich bei x = 1 und x = 2',
        fns: [{ f: f1(1, 0, 0), color: 'blue', label: 'y = x²', labelAt: -2.4, labelPos: 'e' },
          { f: function (x) { return 3 * x - 2; }, color: 'orange' }],
        texts: [{ x: 2.8, y: -1.5, text: 'y = 3x − 2', color: 'orange' }],
        points: [{ x: 1, y: 1, color: 'violet', r: 6.5, label: 'P₁', pos: 'se' }, { x: 2, y: 4, color: 'violet', r: 6.5, label: 'P₂', pos: 'w' }],
        lines: [{ x1: 1, y1: 1, x2: 1, y2: 0, color: 'violet', dash: true }, { x1: 2, y1: 4, x2: 2, y2: 0, color: 'violet', dash: true }]
      };
    },
    a9: function () {
      var f = f1(1, 2, 3);
      return {
        xmin: -4, xmax: 2, ymin: -1, ymax: 7, label: 'Parabel y = x² + 2x + 3 liegt ganz über der x-Achse',
        fns: [{ f: f, color: 'blue' }],
        points: tablePts(f, [-3, -2, 0, 1]).concat([{ x: -1, y: 2, color: 'slate', r: 5, label: 'S(−1 | 2)', pos: 's' }])
      };
    },
    a10: function () {
      return {
        xmin: -4, xmax: 4, ymin: -2, ymax: 10, yscale: 0.7, ystep: 2, label: 'Normalparabel und Gerade y = x + 6 schneiden sich bei x = −2 und x = 3',
        fns: [{ f: f1(1, 0, 0), color: 'blue', label: 'y = x²', labelAt: -3.1, labelPos: 'e' },
          { f: function (x) { return x + 6; }, color: 'orange' }],
        texts: [{ x: -2.9, y: 1, text: 'y = x + 6', color: 'orange' }],
        points: [{ x: -2, y: 4, color: 'violet', r: 6.5, label: 'P₁', pos: 'se' }, { x: 3, y: 9, color: 'violet', r: 6.5, label: 'P₂', pos: 'e' }],
        lines: [{ x1: -2, y1: 4, x2: -2, y2: 0, color: 'violet', dash: true }, { x1: 3, y1: 9, x2: 3, y2: 0, color: 'violet', dash: true }]
      };
    },
    a14: function () {
      var f = f1(1, -4, 0);
      return {
        xmin: -2, xmax: 6, ymin: -5, ymax: 6, label: 'Parabel y = x² − 4x mit Nullstellen 0 und 4',
        fns: [{ f: f, color: 'blue' }],
        points: tablePts(f, [-1, 1, 3, 5]).concat([{ x: 2, y: -4, color: 'slate', r: 5, label: 'S', pos: 's' }]).concat(zeroPts([0, 4]))
      };
    }
  };

  QG.widget('graf-plot', function (el) {
    var mk = PLOTS[el.getAttribute('data-plot')];
    if (!mk) { console.warn('[grafisch] unbekannter Plot', el.getAttribute('data-plot')); return; }
    QG.plot(el, mk());
  });

  /* ============================================================
     Parabel-Labor
     ============================================================ */
  var A_VALS = [-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2];
  var LAB_VIEW = { xmin: -7, xmax: 7, ymin: -7, ymax: 7 };

  QG.widget('graf-labor', function (el) {
    var S = { mode: 'abc', a: 1, b: -2, c: -3, d: 1, e: -4 };

    el.innerHTML =
      '<div class="graf-seg no-print" role="group" aria-label="Form der Gleichung">' +
        '<button type="button" data-mode="abc" aria-pressed="true">Allgemeine Form</button>' +
        '<button type="button" data-mode="de" aria-pressed="false">Scheitelpunktform</button>' +
      '</div>' +
      '<div class="graf-eq" aria-live="polite"><span class="m"></span></div>' +
      '<div class="qg-plot-wrap graf-lab-plot"></div>' +
      '<div class="graf-sliders no-print"></div>' +
      '<div class="graf-out" aria-live="polite"></div>' +
      '<div class="graf-presets no-print" role="group" aria-label="Beispiele">' +
        '<button type="button" class="graf-chip" data-pre="2">2 Lösungen</button>' +
        '<button type="button" class="graf-chip" data-pre="1">1 Lösung</button>' +
        '<button type="button" class="graf-chip" data-pre="0">keine Lösung</button>' +
        '<button type="button" class="graf-chip" data-pre="krumm">krumme Lösungen</button>' +
        '<button type="button" class="graf-chip" data-pre="rand"><span aria-hidden="true">🎲</span> Zufall</button>' +
      '</div>';

    var eqEl = el.querySelector('.graf-eq .m');
    var outEl = el.querySelector('.graf-out');
    var slBox = el.querySelector('.graf-sliders');
    var rows = {
      a: sliderRow('a', 'a', 0, A_VALS.length - 1, 1, 'violet', 'Streckfaktor a'),
      b: sliderRow('b', 'b', -6, 6, 1, 'blue', 'Koeffizient b'),
      c: sliderRow('c', 'c', -9, 9, 1, 'teal', 'Konstante c'),
      d: sliderRow('d', 'd', -6, 6, 0.5, 'blue', 'Verschiebung d in x-Richtung'),
      e: sliderRow('e', 'e', -9, 9, 0.5, 'teal', 'Verschiebung e in y-Richtung')
    };
    ['a', 'b', 'c', 'd', 'e'].forEach(function (k) { slBox.appendChild(rows[k]); });
    QG.math(slBox);

    var plot = QG.plot(el.querySelector('.graf-lab-plot'), {
      xmin: LAB_VIEW.xmin, xmax: LAB_VIEW.xmax, ymin: LAB_VIEW.ymin, ymax: LAB_VIEW.ymax,
      label: 'Parabel-Labor: Graph der eingestellten Parabel'
    });

    function fromABC() { S.d = -S.b / (2 * S.a); S.e = S.c - S.b * S.b / (4 * S.a); }
    function fromDE() { S.b = -2 * S.a * S.d; S.c = S.a * S.d * S.d + S.e; }

    function syncSliders() {
      var abc = S.mode === 'abc';
      rows.b.hidden = rows.c.hidden = !abc;
      rows.d.hidden = rows.e.hidden = abc;
      ['a', 'b', 'c', 'd', 'e'].forEach(function (k) {
        var inp = rows[k].querySelector('input');
        var out = rows[k].querySelector('output');
        if (k === 'a') {
          inp.value = String(A_VALS.indexOf(S.a));
          out.textContent = fmt(S.a);
          inp.setAttribute('aria-valuetext', 'a = ' + fmt(S.a));
        } else {
          var step = +inp.step;
          var v = Math.max(+inp.min, Math.min(+inp.max, Math.round(S[k] / step) * step));
          inp.value = String(v);
          out.textContent = num(S[k]);
          inp.setAttribute('aria-valuetext', k + ' = ' + fmt(S[k]));
        }
        setPct(inp);
      });
      el.querySelectorAll('.graf-seg button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === S.mode));
      });
    }

    function render() {
      var a = S.a, b = S.b, c = S.c, d = S.d, e = S.e;
      var f = function (x) { return a * x * x + b * x + c; };
      var rs = roots(a, b, c);
      var rounded = !(exact2(b) && exact2(c) && exact2(d) && exact2(e));

      // Gleichung oben
      var main = S.mode === 'abc' ? QG.poly(a, b, c) + ' = 0' : vform(a, d, e) + ' = 0';
      eqEl.innerHTML = main;

      // Plot
      var pts = [];
      var vertexOnAxis = Math.abs(e) < 1e-9;
      if (!vertexOnAxis) pts.push({ x: d, y: e, color: 'slate', r: 4.5, label: 'S', pos: a > 0 ? 's' : 'n' });
      rs.forEach(function (x, i) {
        var pos;
        if (rs.length === 1) pos = 'n';
        else if (a > 0 && rs[1] - rs[0] > 2.2) pos = i ? 'nw' : 'ne';
        else pos = i ? 'ne' : 'nw';
        pts.push({ x: x, y: 0, color: 'orange', r: 7, label: rs.length > 1 ? (i ? 'N₂' : 'N₁') : 'N', pos: pos });
      });
      plot.update({ fns: [{ f: f, color: 'blue' }], points: pts });

      // Ausgabe
      var other = S.mode === 'abc'
        ? '<div class="graf-row"><span class="graf-k">Scheitelpunktform</span><span class="graf-v"><span class="m">' + vform(a, d, e) + ' = 0</span></span></div>'
        : '<div class="graf-row"><span class="graf-k">Allgemeine Form</span><span class="graf-v"><span class="m">' + QG.poly(a, b, c) + ' = 0</span></span></div>';
      var open = a > 0 ? 'nach oben geöffnet' : 'nach unten geöffnet';
      var sTxt = '<span class="m">S(' + num(d) + ' | ' + num(e) + ')</span> <span class="muted small">· ' + open + '</span>';

      var pill, lTxt, nice = rs.every(isHalf);
      if (rs.length === 2) pill = '<span class="pill green">2 Lösungen</span>';
      else if (rs.length === 1) pill = '<span class="pill orange">1 Lösung</span>';
      else pill = '<span class="pill red">keine Lösung</span>';

      if (!rs.length) lTxt = '<span class="m">L = { }</span>';
      else if (nice) lTxt = '<span class="m">L = {' + rs.map(function (x) { return fmt(x); }).join('; ') + '}</span>';
      else lTxt = rs.map(function (x, i) {
        return '<span class="m">x' + (rs.length > 1 ? (i + 1) : '') + ' ≈ ' + fmt(x) + '</span>';
      }).join(' und ');

      var outside = rs.some(function (x) { return x < LAB_VIEW.xmin || x > LAB_VIEW.xmax; });
      var note = '';
      if (rs.length && !nice) {
        note = '<div class="graf-note warn"><span aria-hidden="true">⚠️</span><span><b>Ablesen wird ungenau.</b> Die Nullstellen sind keine ganzen oder halben Zahlen. Grafisch bekommst du nur Näherungswerte – darum: <b>Probe!</b></span></div>';
      } else if (!rs.length) {
        note = '<div class="graf-note"><span aria-hidden="true">💡</span><span>Die Parabel trifft die <span class="m">x</span>-Achse nie. ' +
          (a > 0 ? 'Ihr tiefster Punkt <span class="m">S</span> liegt über der Achse.' : 'Ihr höchster Punkt <span class="m">S</span> liegt unter der Achse.') + '</span></div>';
      } else if (rs.length === 1) {
        note = '<div class="graf-note"><span aria-hidden="true">💡</span><span>Der Scheitelpunkt liegt genau auf der <span class="m">x</span>-Achse – die Parabel berührt sie nur.</span></div>';
      } else {
        note = '<div class="graf-note ok"><span aria-hidden="true">✅</span><span>Die Nullstellen sind ganze oder halbe Zahlen – gut ablesbar. Probe trotzdem nicht vergessen!</span></div>';
      }
      if (outside) note += '<div class="graf-note"><span aria-hidden="true">🔭</span><span>Mindestens eine Nullstelle liegt außerhalb des Bildausschnitts.</span></div>';
      else if (e < LAB_VIEW.ymin || e > LAB_VIEW.ymax || d < LAB_VIEW.xmin || d > LAB_VIEW.xmax) note += '<div class="graf-note"><span aria-hidden="true">🔭</span><span>Der Scheitelpunkt liegt außerhalb des Bildausschnitts.</span></div>';
      if (rounded) note += '<p class="small muted graf-round">Einige Werte sind gerundet (≈).</p>';

      outEl.innerHTML =
        other +
        '<div class="graf-row"><span class="graf-k">Scheitelpunkt</span><span class="graf-v">' + sTxt + '</span></div>' +
        '<div class="graf-row graf-res"><span class="graf-k">Lösungen</span><span class="graf-v">' + lTxt + ' ' + pill + '</span></div>' +
        note;
      QG.math(outEl);
    }

    function setABC(a, b, c) {
      S.a = a; S.b = b; S.c = c; fromABC();
      syncSliders(); render();
    }

    ['a', 'b', 'c', 'd', 'e'].forEach(function (k) {
      var inp = rows[k].querySelector('input');
      inp.addEventListener('input', function () {
        if (k === 'a') {
          S.a = A_VALS[+inp.value];
          if (S.mode === 'abc') fromABC(); else fromDE();
        } else {
          S[k] = +inp.value;
          if (k === 'b' || k === 'c') fromABC(); else fromDE();
        }
        syncSliders();
        render();
      });
    });

    el.querySelectorAll('.graf-seg button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        S.mode = btn.getAttribute('data-mode');
        syncSliders(); render();
      });
    });

    function randomParabola() {
      for (var tries = 0; tries < 300; tries++) {
        var a = QG.pick([1, 1, 1, -1, -1, 0.5, 2, -0.5]);
        if (S.mode === 'de') {
          var d = QG.rand(-4, 4), e = QG.rand(-6, 6);
          if (Math.random() < 0.6) {
            // ganzzahlige Nullstellen d ± k: e = −a·k²
            var k = QG.rand(1, 3);
            e = -a * k * k;
            if (Math.abs(e) > 8) continue;
          }
          if (a === S.a && d === S.d && e === S.e) continue;
          S.a = a; S.d = d; S.e = e; fromDE();
          return;
        }
        var b, c;
        if (Math.random() < 0.65) {
          var r1 = QG.rand(-5, 5), r2 = QG.rand(-5, 5);
          b = -a * (r1 + r2); c = a * r1 * r2;
        } else {
          b = QG.rand(-6, 6); c = QG.rand(-6, 6);
        }
        if (b !== Math.round(b) || c !== Math.round(c) || Math.abs(b) > 6 || Math.abs(c) > 6) continue;
        if (a === S.a && b === S.b && c === S.c) continue;
        S.a = a; S.b = b; S.c = c; fromABC();
        return;
      }
    }

    el.querySelectorAll('.graf-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = btn.getAttribute('data-pre');
        if (p === '2') setABC(1, -2, -3);
        else if (p === '1') setABC(1, -4, 4);
        else if (p === '0') setABC(1, 2, 3);
        else if (p === 'krumm') setABC(1, -2, -2);
        else { randomParabola(); syncSliders(); render(); }
      });
    });

    syncSliders();
    render();
  });

  /* ============================================================
     Normalparabel ∩ Gerade (Rezept B) mit Missionen
     ============================================================ */
  var MISSIONS = [
    { p: -1, q: -6 },  // x² − x − 6 = 0  → y = x + 6
    { p: 2, q: -3 },   // x² + 2x − 3 = 0 → y = −2x + 3
    { p: 0, q: -4 },   // x² − 4 = 0      → y = 4
    { p: -2, q: 1 },   // x² − 2x + 1 = 0 → y = 2x − 1 (berührt)
    { p: 1, q: 2 }     // x² + x + 2 = 0  → y = −x − 2 (keine Lösung)
  ];
  var GL_VIEW = { xmin: -4, xmax: 4, ymin: -2, ymax: 10 };

  QG.widget('graf-gerade', function (el) {
    var S = { m: 1, n: 1 };
    var mi = Math.min(MISSIONS.length, Math.max(0, +QG.store.get('graf-gl-mission', 0) || 0));
    var celebrated = false;

    el.innerHTML =
      '<div class="graf-mission no-print" aria-live="polite"></div>' +
      '<div class="graf-eq"><span class="m"></span></div>' +
      '<div class="qg-plot-wrap graf-lab-plot"></div>' +
      '<div class="graf-sliders no-print"></div>' +
      '<div class="graf-out" aria-live="polite"></div>';

    var misEl = el.querySelector('.graf-mission');
    var eqEl = el.querySelector('.graf-eq .m');
    var outEl = el.querySelector('.graf-out');
    var slBox = el.querySelector('.graf-sliders');
    var rows = {
      m: sliderRow('m', 'm', -4, 4, 0.5, 'orange', 'Steigung m der Geraden'),
      n: sliderRow('n', 'n', -4, 8, 0.5, 'pink', 'y-Achsenabschnitt n der Geraden')
    };
    rows.m.querySelector('label').insertAdjacentHTML('beforeend', '<span class="graf-sl-name">Steigung</span>');
    rows.n.querySelector('label').insertAdjacentHTML('beforeend', '<span class="graf-sl-name">Achsenabschnitt</span>');
    slBox.appendChild(rows.m); slBox.appendChild(rows.n);
    QG.math(slBox);

    var plot = QG.plot(el.querySelector('.graf-lab-plot'), {
      xmin: GL_VIEW.xmin, xmax: GL_VIEW.xmax, ymin: GL_VIEW.ymin, ymax: GL_VIEW.ymax,
      label: 'Normalparabel y = x² und verschiebbare Gerade'
    });

    function sync() {
      ['m', 'n'].forEach(function (k) {
        var inp = rows[k].querySelector('input');
        inp.value = String(S[k]);
        rows[k].querySelector('output').textContent = fmt(S[k]);
        inp.setAttribute('aria-valuetext', k + ' = ' + fmt(S[k]));
        setPct(inp);
      });
    }

    function missionHtml() {
      if (mi >= MISSIONS.length) {
        return '<div class="graf-mis-head"><span class="pill green">Alle Missionen geschafft</span></div>' +
          '<p>Stark! Du kannst jetzt jede Gleichung <span class="m">x² + px + q = 0</span> mit Normalparabel und Gerade lösen.</p>' +
          '<div class="btn-row"><button type="button" class="btn ghost" data-gl="restart">↺ Missionen von vorn</button></div>';
      }
      var M = MISSIONS[mi];
      var eq = QG.poly(1, M.p, M.q) + ' = 0';
      return '<div class="graf-mis-head"><span class="pill orange">Mission ' + (mi + 1) + ' von ' + MISSIONS.length + '</span></div>' +
        '<p>Stell die Gerade so ein, dass du <span class="m">' + eq + '</span> löst.</p>' +
        '<details class="hint graf-mis-tip"><summary>Tipp</summary><div><p>Forme um: <span class="m">' + eq + '</span> ⇔ <span class="m">x² = ' + QG.poly(0, -M.p, -M.q) + '</span>. ' +
        'Also <span class="m">m = ' + fmt(-M.p) + '</span> und <span class="m">n = ' + fmt(-M.q) + '</span>.</p></div></details>' +
        '<div class="graf-mis-ok" hidden></div>';
    }

    function renderMission() {
      misEl.innerHTML = missionHtml();
      misEl.classList.toggle('is-done', mi >= MISSIONS.length);
      QG.math(misEl);
      var rb = misEl.querySelector('[data-gl="restart"]');
      if (rb) rb.addEventListener('click', function () { mi = 0; QG.store.set('graf-gl-mission', 0); celebrated = false; renderMission(); checkMission(); });
    }

    function checkMission() {
      if (mi >= MISSIONS.length) return;
      var M = MISSIONS[mi];
      var hit = Math.abs(S.m + M.p) < EPS && Math.abs(S.n + M.q) < EPS;
      var okEl = misEl.querySelector('.graf-mis-ok');
      misEl.classList.toggle('is-hit', hit);
      if (!okEl) return;
      if (!hit) { okEl.hidden = true; okEl.innerHTML = ''; celebrated = false; return; }
      var rs = roots(1, M.p, M.q);
      var L = rs.length ? 'L = {' + rs.map(function (x) { return fmt(x); }).join('; ') + '}' : 'L = { }';
      var extra = rs.length === 0 ? ' Gerade und Parabel treffen sich nicht – keine Lösung.' : rs.length === 1 ? ' Die Gerade berührt die Parabel nur – genau eine Lösung.' : '';
      okEl.hidden = false;
      okEl.innerHTML = '<p class="graf-mis-yes"><span aria-hidden="true">🎯</span> Treffer! <span class="m">' + L + '</span>.' + extra + '</p>' +
        '<div class="btn-row"><button type="button" class="btn primary" data-gl="next">' + (mi + 1 < MISSIONS.length ? 'Nächste Mission →' : 'Abschließen ✓') + '</button></div>';
      QG.math(okEl);
      okEl.querySelector('[data-gl="next"]').addEventListener('click', function () {
        mi++;
        QG.store.set('graf-gl-mission', mi);
        celebrated = false;
        renderMission();
        checkMission();
      });
      if (!celebrated) { celebrated = true; QG.celebrate(okEl); }
    }

    function render() {
      var m = S.m, n = S.n;
      var line = function (x) { return m * x + n; };
      var rs = roots(1, -m, -n);
      eqEl.innerHTML = 'x² = ' + QG.poly(0, m, n) + ' &nbsp;⇔&nbsp; ' + QG.poly(1, -m, -n) + ' = 0';
      QG.math(eqEl);
      var pts = rs.map(function (x, i) {
        return { x: x, y: x * x, color: 'violet', r: 6.5, label: rs.length > 1 ? (i ? 'P₂' : 'P₁') : 'P', pos: i ? 'e' : 'w' };
      });
      var lines = rs.map(function (x) { return { x1: x, y1: x * x, x2: x, y2: 0, color: 'violet', dash: true }; });
      plot.update({
        fns: [{ f: function (x) { return x * x; }, color: 'blue', label: 'y = x²', labelAt: GL_VIEW.xmin + 0.85, labelPos: 'e' },
          { f: line, color: 'orange' }],
        points: pts, lines: lines
      });

      var nice = rs.every(isHalf);
      var pill = rs.length === 2 ? '<span class="pill green">2 Lösungen</span>' : rs.length === 1 ? '<span class="pill orange">1 Lösung</span>' : '<span class="pill red">keine Lösung</span>';
      var ptsTxt = rs.length ? rs.map(function (x, i) {
        var name = rs.length > 1 ? 'P<sub>' + (i + 1) + '</sub>' : 'P';
        return '<span class="m">' + name + '(' + fmt(x) + ' | ' + fmt(x * x) + ')</span>';
      }).join(', ') + (nice ? '' : ' <span class="muted small">(gerundet)</span>') : '<span class="muted">keine – die Gerade läuft unter der Parabel vorbei</span>';
      var lTxt;
      if (!rs.length) lTxt = '<span class="m">L = { }</span>';
      else if (nice) lTxt = '<span class="m">L = {' + rs.map(function (x) { return fmt(x); }).join('; ') + '}</span>';
      else lTxt = rs.map(function (x, i) { return '<span class="m">x' + (rs.length > 1 ? (i + 1) : '') + ' ≈ ' + fmt(x) + '</span>'; }).join(' und ');
      var note = '';
      if (rs.length && !nice) note = '<div class="graf-note warn"><span aria-hidden="true">⚠️</span><span><b>Krumme Schnittstellen:</b> Ablesen wird ungenau – <b>Probe!</b></span></div>';
      if (rs.some(function (x) { return x * x > GL_VIEW.ymax || x < GL_VIEW.xmin || x > GL_VIEW.xmax; })) {
        note += '<div class="graf-note"><span aria-hidden="true">🔭</span><span>Ein Schnittpunkt liegt außerhalb des Bildausschnitts.</span></div>';
      }

      outEl.innerHTML =
        '<div class="graf-row"><span class="graf-k">Gerade</span><span class="graf-v"><span class="m">y = ' + QG.poly(0, m, n) + '</span></span></div>' +
        '<div class="graf-row"><span class="graf-k">Schnittpunkte</span><span class="graf-v">' + ptsTxt + '</span></div>' +
        '<div class="graf-row graf-res"><span class="graf-k">Lösungen (<span class="m">x</span>-Werte)</span><span class="graf-v">' + lTxt + ' ' + pill + '</span></div>' +
        note;
      QG.math(outEl);
      checkMission();
    }

    ['m', 'n'].forEach(function (k) {
      var inp = rows[k].querySelector('input');
      inp.addEventListener('input', function () { S[k] = +inp.value; sync(); render(); });
    });

    renderMission();
    sync();
    render();
  });
})();

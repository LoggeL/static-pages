/* Kapitel 10 · Grundlagen: Mini-Parabeln (0/1/2 Lösungen) und Probe-Labor */
(function () {
  'use strict';
  var QG = window.QG;
  if (!QG) return;

  /* ---------- Drei kleine Parabeln: 2, 1 oder keine Lösung ---------- */
  var MINI = {
    '2': { f: function (x) { return x * x - 4; }, roots: [-2, 2], label: 'Parabel y = x² − 4 schneidet die x-Achse bei −2 und 2' },
    '1': { f: function (x) { return x * x - 2 * x + 1; }, roots: [1], label: 'Parabel y = x² − 2x + 1 berührt die x-Achse bei 1' },
    '0': { f: function (x) { return x * x + 1; }, roots: [], label: 'Parabel y = x² + 1 trifft die x-Achse nicht' }
  };

  QG.widget('grund-count', function (el) {
    el.querySelectorAll('.gl-mini-plot').forEach(function (host) {
      var d = MINI[host.getAttribute('data-n')];
      if (!d) return;
      QG.plot(host, {
        xmin: -3.5, xmax: 3.5, ymin: -4.5, ymax: 4.5, yscale: 0.62,
        grid: true, ticks: false, label: d.label,
        fns: [{ f: d.f, color: 'violet', width: 3 }],
        points: d.roots.map(function (r) { return { x: r, y: 0, color: 'orange', r: 6 }; })
      });
    });
  });

  /* ---------- Probe-Labor: x einsetzen in x² − 2x − 3 ---------- */
  QG.widget('grund-probe', function (el) {
    var f = function (x) { return x * x - 2 * x - 3; };
    var ROOTS = [-1, 3];
    var chipsBox = el.querySelector('.gl-lab-chips');
    var out = el.querySelector('.gl-lab-out');
    var host = el.querySelector('.gl-lab-plot');
    var tested = {};
    var current = null;
    var fmt = QG.fmt;

    var plot = QG.plot(host, {
      xmin: -3, xmax: 5, ymin: -5, ymax: 6, yscale: 0.5, ystep: 2, xstep: 1,
      label: 'Eingesetzte Zahlen als Punkte (x | Ergebnis)', fns: [], points: []
    });

    var buttons = [];
    for (var x = -2; x <= 4; x++) {
      (function (v) {
        var b = QG.h('button', { type: 'button', 'aria-pressed': 'false', 'aria-label': 'x = ' + fmt(v) + ' einsetzen' }, QG.esc(fmt(v)));
        b.addEventListener('click', function () { choose(v); });
        chipsBox.appendChild(b);
        buttons.push({ v: v, el: b });
      })(x);
    }

    var reset = QG.h('button', { type: 'button', class: 'btn ghost' }, '↺ Neu starten');
    reset.hidden = true;
    reset.addEventListener('click', function () {
      tested = {}; current = null;
      buttons.forEach(function (b) { b.el.setAttribute('aria-pressed', 'false'); b.el.classList.remove('is-root'); });
      reset.hidden = true;
      render();
    });
    el.appendChild(reset);

    function allFound() { return ROOTS.every(function (r) { return tested[r] != null; }); }

    function choose(v) {
      current = v;
      tested[v] = f(v);
      buttons.forEach(function (b) {
        b.el.setAttribute('aria-pressed', b.v === v ? 'true' : 'false');
        if (tested[b.v] === 0) b.el.classList.add('is-root');
      });
      reset.hidden = false;
      render();
    }

    function render() {
      if (current == null) {
        out.innerHTML = '<p class="gl-lab-verdict no">Tippe oben eine Zahl an.</p>';
      } else {
        var v = current, y = f(v);
        var xs = v < 0 ? '(' + fmt(v) + ')' : fmt(v);
        var lin = 2 * v;
        var line = xs + '² − 2 · ' + xs + ' − 3 = ' + fmt(v * v) + ' ' + (lin >= 0 ? '− ' + fmt(lin) : '+ ' + fmt(-lin)) + ' − 3 = <strong>' + fmt(y) + '</strong>';
        var verdict = y === 0
          ? '<p class="gl-lab-verdict ok">✓ Ergebnis 0 – also ist <span class="m">x = ' + fmt(v) + '</span> eine Lösung!</p>'
          : '<p class="gl-lab-verdict no">✗ <span class="m">' + fmt(y) + ' ≠ 0</span> – <span class="m">x = ' + fmt(v) + '</span> ist keine Lösung.</p>';
        var found = ROOTS.filter(function (r) { return tested[r] != null; });
        var foundTxt = allFound()
          ? '<p class="gl-lab-found">Beide Lösungen gefunden: <span class="m">L = {−1; 3}</span>. Sieh dir das Bild an: Alle Punkte liegen auf einer Parabel – und die Lösungen sind genau die Stellen, an denen sie die <span class="m">x</span>-Achse schneidet. Das ist die Idee von <a href="#grafisch">Weg 1</a>!</p>'
          : found.length ? '<p class="gl-lab-found">Eine Lösung hast du. Es gibt noch eine zweite – such weiter!</p>' : '';
        out.innerHTML = '<div class="mblock">' + line + '</div>' + verdict + foundTxt;
        QG.math(out);
      }
      var pts = Object.keys(tested).map(function (k) {
        var vx = Number(k), vy = tested[k];
        var p = { x: vx, y: vy, color: vy === 0 ? 'green' : 'red', r: vx === current ? 7 : 5 };
        if (vx === current && vy !== 0) { p.label = '(' + fmt(vx) + ' | ' + fmt(vy) + ')'; p.pos = vy >= 0 ? (vx > 1 ? 'nw' : 'ne') : (vx > 1 ? 'se' : 'sw'); }
        return p;
      });
      var lines = current != null && tested[current] !== 0 ? [{ x1: current, y1: 0, x2: current, y2: tested[current], color: 'red', dash: true }] : [];
      plot.update({
        fns: allFound() ? [{ f: f, color: 'violet', width: 3 }] : [],
        points: pts,
        lines: lines
      });
    }
    render();
  });
})();

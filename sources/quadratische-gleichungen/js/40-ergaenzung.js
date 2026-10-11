/* Kapitel 40 · Weg 3: Quadratische Ergänzung
   Widgets:
   - erg-area    Flächenmodell x² + px → (x + p/2)², schrittweise animiert, p wählbar
   - erg-solver  „Deine eigene Gleichung“: alle Schritte als Stepper (exakt mit Brüchen und Wurzeln)
   - erg-sol     Lösungsweg für eine Aufgabe (data-eq="a b c"), gleiche Rechen-Engine wie der Rechner
   - erg-vertex  Bonus: Parabel mit Scheitelpunkt und Nullstellen
   Die reine Rechen-Engine ist zusätzlich per module.exports testbar (node). */
(function () {
  'use strict';

  var MINUS = '−';

  /* =====================================================================
     1. Exakte Bruchrechnung
     ===================================================================== */
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a || 1; }
  function lcm(a, b) { return Math.abs(a * b) / gcd(a, b); }
  function F(n, d) {
    if (d == null) d = 1;
    if (d < 0) { n = -n; d = -d; }
    var g = gcd(n, d);
    var r = { n: n / g, d: d / g };
    if (r.n === 0) r.d = 1;
    if (Object.is(r.n, -0)) r.n = 0;
    return r;
  }
  function add(a, b) { return F(a.n * b.d + b.n * a.d, a.d * b.d); }
  function sub(a, b) { return F(a.n * b.d - b.n * a.d, a.d * b.d); }
  function mul(a, b) { return F(a.n * b.n, a.d * b.d); }
  function div(a, b) { return F(a.n * b.d, a.d * b.n); }
  function neg(a) { return F(-a.n, a.d); }
  function absF(a) { return F(Math.abs(a.n), a.d); }
  function val(a) { return a.n / a.d; }
  function isZero(a) { return a.n === 0; }
  function isOne(a) { return a.n === 1 && a.d === 1; }
  function sgn(a) { return a.n > 0 ? 1 : a.n < 0 ? -1 : 0; }
  function eqF(a, b) { return a.n === b.n && a.d === b.d; }

  /** "3", "-1,5", "3/2", "−7/4", "0.25" → Bruch; sonst null */
  function parseFrac(str) {
    var s = String(str == null ? '' : str).trim()
      .replace(/[−‒–—]/g, '-').replace(/\s+/g, '').replace(/,/g, '.');
    var m = /^([+-]?)(\d+(?:\.\d+)?|\.\d+)(?:\/(\d+(?:\.\d+)?))?$/.exec(s);
    if (!m) return null;
    function dec(t) {
      var k = (t.split('.')[1] || '').length;
      if (k > 4) return null;
      var f = Math.pow(10, k);
      return F(Math.round(parseFloat(t) * f), f);
    }
    var f = dec(m[2]);
    if (!f) return null;
    if (m[3]) {
      var d = dec(m[3]);
      if (!d || isZero(d)) return null;
      f = div(f, d);
    }
    return m[1] === '-' ? neg(f) : f;
  }

  /* =====================================================================
     2. Formatierung (HTML, Mathe-Notation)
     ===================================================================== */
  function fmtDec(x) {
    var r = Math.round(x * 100) / 100;
    if (Math.abs(r) < 1e-12) r = 0;
    var s = Math.abs(r).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return (r < 0 ? MINUS : '') + s.replace('.', ',');
  }
  function fracHTML(n, d) { return '<span class="frac"><span>' + n + '</span><span>' + d + '</span></span>'; }
  /** Bruch mit Vorzeichen */
  function fr(a) { return (a.n < 0 ? MINUS : '') + (a.d === 1 ? String(Math.abs(a.n)) : fracHTML(Math.abs(a.n), a.d)); }
  /** Betrag */
  function frAbs(a) { return fr(absF(a)); }
  /** ungekürzter Bruch (für Nebenrechnungen) */
  function raw(n, d) { return (n < 0 ? MINUS : '') + (d === 1 ? String(Math.abs(n)) : fracHTML(Math.abs(n), d)); }
  /** in Klammern, wenn negativ oder Bruch (zum Quadrieren / Einsetzen) */
  function paren(a) { return (a.n < 0 || a.d !== 1) ? '(' + fr(a) + ')' : fr(a); }
  /** " + 3" / " − 3" */
  function plusTerm(a) { return (a.n < 0 ? ' ' + MINUS + ' ' : ' + ') + frAbs(a); }
  /** a·x² + b·x + c mit Brüchen, 1-Koeffizienten und Nullterme weggelassen */
  function polyF(a, b, c) {
    var terms = [];
    function co(k) { return (k.n === k.d || k.n === -k.d) ? '' : frAbs(k); }
    if (!isZero(a)) terms.push([a.n < 0, co(a) + 'x²']);
    if (!isZero(b)) terms.push([b.n < 0, co(b) + 'x']);
    if (!isZero(c)) terms.push([c.n < 0, frAbs(c)]);
    if (!terms.length) return '0';
    return terms.map(function (t, i) {
      if (i === 0) return (t[0] ? MINUS : '') + t[1];
      return (t[0] ? ' ' + MINUS + ' ' : ' + ') + t[1];
    }).join('');
  }
  function m(s) { return '<span class="m">' + s + '</span>'; }
  function t(s) { return '<span class="t">' + s + '</span>'; }

  /** √r = k·√m mit m quadratfrei (r > 0) */
  function sqrtSimplify(r) {
    var s = r.n * r.d; // √(n/d) = √(n·d) / d
    var k = 1, rest = s;
    for (var i = 2; i * i <= rest; i++) {
      while (rest % (i * i) === 0) { rest /= i * i; k *= i; }
    }
    return { k: F(k, r.d), m: rest };
  }
  function rootHTML(sr) {
    if (sr.m === 1) return fr(sr.k);
    var kn = sr.k.n === 1 ? '' : String(sr.k.n);
    var core = kn + '√' + sr.m;
    return sr.k.d === 1 ? core : fracHTML(core, sr.k.d);
  }

  /* =====================================================================
     3. Rechen-Engine: alle Schritte der quadratischen Ergänzung
     ===================================================================== */
  function R(l, r, op, src, cls) {
    // Operationen mit Bruch nicht mitten im Bruch umbrechen
    if (op && op.indexOf('frac') >= 0) op = '<span class="erg-nw">' + op + '</span>';
    return { l: l, r: r, op: op || '', src: !!src, cls: cls || '' };
  }

  function probeLine(a, b, c, x) {
    var px = (x.n < 0 || x.d !== 1) ? '(' + fr(x) + ')' : fr(x);
    var parts = [], vals = [];
    function co(k) { return (k.n === k.d || k.n === -k.d) ? '' : frAbs(k) + '·'; }
    if (!isZero(a)) { parts.push([a.n < 0, co(a) + px + '²']); vals.push(mul(a, mul(x, x))); }
    if (!isZero(b)) { parts.push([b.n < 0, co(b) + px]); vals.push(mul(b, x)); }
    if (!isZero(c)) { parts.push([c.n < 0, frAbs(c)]); vals.push(c); }
    var NB = '\u00a0'; // geschützte Leerzeichen: Umbruch nur an „=“
    function join(list) {
      return list.map(function (p, i) {
        if (i === 0) return (p[0] ? MINUS : '') + p[1];
        return (p[0] ? NB + MINUS + NB : NB + '+' + NB) + p[1];
      }).join('');
    }
    var total = vals.reduce(function (s, v) { return add(s, v); }, F(0));
    var valsExpr = join(vals.map(function (v) { return [v.n < 0, frAbs(v)]; }));
    return { html: '<b>x' + NB + '=' + NB + fr(x) + ':</b> ' + join(parts) + ' = ' + valsExpr + ' = ' + fr(total) + (isZero(total) ? ' ✓' : ' ✗'), ok: isZero(total) };
  }

  /**
   * Löst a·x² + b·x + c = 0 (a ≠ 0) mit quadratischer Ergänzung.
   * → {steps:[{tag, rows, why, probe?}], kind: 'two'|'one'|'none', exact: bool, sols:[Bruch]|null, approx:[Zahl], L: HTML}
   */
  function solve(a, b, c) {
    var one = F(1), zero = F(0);
    var p = div(b, a), q = div(c, a);
    var h = div(p, F(2)), e = mul(h, h);
    var rhs = neg(q), r = add(rhs, e);
    var normal = polyF(one, p, q);
    var lhs = polyF(one, p, zero);
    var steps = [];
    var out = { steps: steps, p: p, q: q, h: h, e: e, r: r };

    // ---- 1 Normalform
    var s1 = { tag: 'Normalform herstellen', rows: [] };
    if (eqF(a, one)) {
      s1.rows.push(R(normal, '= 0'));
      s1.why = 'Vor ' + m('x²') + ' steht schon eine 1 – die Gleichung hat die Normalform ' + m('x² + px + q = 0') + '. Hier ist ' + m('p = ' + fr(p)) + ' und ' + m('q = ' + fr(q)) + '.';
    } else {
      s1.rows.push(R(polyF(a, b, c), '= 0', '| : ' + paren(a)));
      s1.rows.push(R(normal, '= 0'));
      s1.why = 'Vor ' + m('x²') + ' steht ' + m(fr(a)) + ' – für die Ergänzung brauchst du dort eine 1. Teile deshalb <b>jede</b> Zahl der Gleichung durch ' + m(fr(a)) + '. Jetzt ist ' + m('p = ' + fr(p)) + ' und ' + m('q = ' + fr(q)) + '.';
    }
    steps.push(s1);

    // ---- 2 q nach rechts
    var s2 = { tag: 'Zahl ohne <span class="m">x</span> nach rechts', rows: [] };
    if (isZero(q)) {
      s2.rows.push(R(lhs, '= 0', null, true));
      s2.why = 'Hier ist ' + m('q = 0') + ' – links steht keine Zahl ohne ' + m('x') + '. Es gibt nichts zu tun. (Bei ' + m('q = 0') + ' geht Ausklammern übrigens schneller – Weg 2.)';
    } else {
      var op2 = (q.n < 0 ? '+ ' : MINUS + ' ') + frAbs(q);
      s2.rows.push(R(normal, '= 0', '| ' + op2, true));
      s2.rows.push(R(lhs, '= ' + fr(rhs)));
      s2.why = 'Bring die Zahl ohne ' + m('x') + ' auf die rechte Seite: Rechne ' + m(op2) + ' auf beiden Seiten. Links bleibt nur ' + m(lhs) + ' stehen.';
    }
    steps.push(s2);

    // ---- 3 Ergänzen
    var s3 = { tag: 'Quadratisch ergänzen', rows: [] };
    var hs = paren(h) + '²';
    if (isZero(p)) {
      s3.rows.push(R(lhs, '= ' + fr(rhs), null, true));
      s3.why = 'Hier ist ' + m('p = 0') + ': Es gibt kein ' + m('x') + '-Glied, also auch nichts zu ergänzen – ' + m('x²') + ' ist schon ein Quadrat.';
    } else {
      s3.rows.push(R(lhs, '= ' + fr(rhs), '| + ' + hs, true));
      // Zwischenzeile „… + 3² = 7 + 3²“ nur bei ganzzahligem p/2 (bei Brüchen wird es sonst zu breit)
      if (h.d === 1) { var mid = R(lhs + ' + ' + hs, '= ' + (isZero(rhs) ? hs : fr(rhs) + ' + ' + hs)); mid.mid = true; s3.rows.push(mid); }
      var why3 = 'Halbiere ' + m('p') + ': ' + m(fr(p) + ' : 2 = ' + fr(h)) + '. Quadriere: ' + m(hs + ' = ' + fr(e)) + '. Addiere ' + m(fr(e)) + ' auf <b>beiden</b> Seiten – das ist die Ergänzung.';
      if (!isZero(rhs) && (rhs.d !== 1 || e.d !== 1)) {
        // Brüche: rechts gleichnamig machen, als eigene Zeile
        var L = lcm(rhs.d, e.d);
        var n1 = rhs.n * (L / rhs.d), n2 = e.n * (L / e.d);
        var chain = raw(n1, L) + ' + ' + raw(n2, L);
        s3.rows.push(R(lhs + ' + ' + fr(e), '= ' + chain));
        var tail = raw(n1 + n2, L) + (gcd(n1 + n2, L) !== 1 || n1 + n2 === 0 ? ' = ' + fr(r) : '');
        if (rhs.d === L && e.d === L) {
          // schon gleichnamig: keine doppelte Kette „3/4 + 1/4 = 3/4 + 1/4“
          why3 += ' Rechts addierst du die Brüche – sie haben schon denselben Nenner: ' + m(chain + ' = ' + tail) + '.';
        } else {
          why3 += ' Rechts machst du die Brüche gleichnamig: ' + m(fr(rhs) + ' + ' + fr(e) + ' = ' + chain + ' = ' + tail) + '.';
        }
      }
      s3.rows.push(R(lhs + ' + ' + fr(e), '= ' + fr(r)));
      s3.why = why3;
    }
    steps.push(s3);

    // ---- 4 Binom
    var s4 = { tag: 'Als Binom schreiben', rows: [] };
    var binIn = isZero(h) ? 'x' : 'x' + plusTerm(h);
    var binSq = isZero(h) ? 'x²' : '(' + binIn + ')²';
    if (isZero(p)) {
      s4.rows.push(R('x²', '= ' + fr(r), null, true));
      s4.why = 'Links steht schon ein Quadrat: ' + m('x²') + '.';
    } else {
      s4.rows.push(R(lhs + ' + ' + fr(e), '= ' + fr(r), '| ' + (h.n > 0 ? '1.' : '2.') + ' bin. Formel', true));
      s4.rows.push(R(binSq, '= ' + fr(r)));
      s4.why = 'Die linke Seite ist jetzt genau ' + m(binSq) + '. In die Klammer kommt ' + m('<span class="frac"><span>p</span><span>2</span></span> = ' + fr(h)) + ' – mit Vorzeichen' + (h.n < 0 ? ', hier also ein Minus' : '') + '. Kontrolle: ' + m(binSq + ' = ' + lhs + ' + ' + fr(e)) + ' ✓';
    }
    steps.push(s4);

    // ---- 5 Wurzel ziehen
    var s5 = { tag: 'Wurzel ziehen', rows: [] };
    var sg = sgn(r), sr = null, rootS = '', rhs5 = '';
    if (sg > 0) {
      sr = sqrtSimplify(r);
      rootS = rootHTML(sr);
      var rootRaw = '√' + (r.d === 1 ? String(r.n) : '(' + fr(r) + ')');
      rhs5 = '= ±' + (sr.m === 1 ? rootS : rootRaw + (rootRaw !== rootS ? ' = ±' + rootS : ''));
      s5.rows.push(R(binSq, '= ' + fr(r), '| √ (±!)', true));
      s5.rows.push(R(binIn, rhs5));
      var why5 = m(fr(r) + ' > 0') + ' → <b>zwei Lösungen</b>. Beim Wurzelziehen gibt es immer zwei Möglichkeiten: plus und minus. ';
      if (sr.m === 1) {
        var kq = sr.k.d === 1 ? fr(sr.k) : '(' + fr(sr.k) + ')';
        why5 += 'Denn ' + m(kq + '² = ' + fr(r)) + ' und auch ' + m('(' + MINUS + fr(sr.k) + ')² = ' + fr(r)) + '.';
      } else {
        why5 += 'Die Wurzel aus ' + m(fr(r)) + ' geht nicht glatt auf – sie bleibt einfach stehen. Das ist ein <b>exaktes</b> Ergebnis.';
        if (rootRaw !== rootS) why5 += ' Vereinfacht: ' + m(rootRaw + ' = ' + rootS) + '.';
      }
      s5.why = why5;
    } else if (sg === 0) {
      s5.rows.push(R(binSq, '= 0', '| √', true));
      s5.rows.push(R(binIn, '= 0'));
      s5.why = 'Rechts steht 0 → <b>genau eine Lösung</b>, denn nur ' + m('0² = 0') + '.';
    } else {
      s5.rows.push(R(binSq, '= ' + fr(r), null, true));
      s5.rows.push({ note: t('Ein Quadrat ist nie negativ ⇒ keine Lösung.') });
      s5.why = m(fr(r) + ' &lt; 0') + ' → <b>keine Lösung</b>. Egal, was du für ' + m('x') + ' einsetzt: ' + m(binSq) + ' ist immer ≥ 0 und kann nie ' + m(fr(r)) + ' werden. Aus einer negativen Zahl kannst du keine Wurzel ziehen.';
    }
    steps.push(s5);

    // ---- 6 nach x auflösen
    var s6 = { tag: sg < 0 ? 'Lösungsmenge angeben' : 'Nach <span class="m">x</span> auflösen', rows: [] };
    var mh = neg(h);
    var shift = isZero(h) ? '' : (h.n > 0 ? MINUS + ' ' : '+ ') + frAbs(h);
    var sols = null, approx = [], Lhtml;
    if (sg > 0) {
      s6.rows.push(R(binIn, rhs5, shift ? '| ' + shift : '', true));
      if (!isZero(h)) s6.rows.push(R('x', '= ' + fr(mh) + ' ± ' + rootS));
      if (sr.m === 1) {
        var x1 = add(mh, sr.k), x2 = sub(mh, sr.k);
        s6.rows.push(R('x1', '= ' + (isZero(h) ? fr(sr.k) : fr(mh) + ' + ' + fr(sr.k) + ' = ' + fr(x1))));
        s6.rows.push(R('x2', '= ' + (isZero(h) ? fr(neg(sr.k)) : fr(mh) + ' ' + MINUS + ' ' + fr(sr.k) + ' = ' + fr(x2))));
        sols = [x2, x1];
        approx = [val(x2), val(x1)];
        Lhtml = '{' + fr(x2) + '; ' + fr(x1) + '}';
      } else {
        var w = val(sr.k) * Math.sqrt(sr.m);
        var v1 = val(mh) + w, v2 = val(mh) - w;
        var e1 = isZero(h) ? rootS : fr(mh) + ' + ' + rootS;
        var e2 = isZero(h) ? MINUS + rootS : fr(mh) + ' ' + MINUS + ' ' + rootS;
        s6.rows.push(R('x1', '= ' + e1));
        s6.rows.push(R('x2', '= ' + e2));
        s6.rows.push({ note: t('Gerundet:') + ' x1 ≈ ' + fmtDec(v1) + ', x2 ≈ ' + fmtDec(v2) });
        approx = [v2, v1];
        Lhtml = '{' + e2 + '; ' + e1 + '}';
      }
      s6.why = (shift ? 'Rechne ' + m(shift) + ' – dann steht ' + m('x') + ' allein. ' : '') + 'Einmal mit +, einmal mit − rechnen: zwei Lösungen.' +
        (sr.m === 1 ? '' : ' Gib die Lösungen exakt mit Wurzel an. Die gerundeten Werte helfen dir bei der Kontrolle.');
    } else if (sg === 0) {
      if (isZero(h)) {
        s6.rows.push(R('x', '= 0', null, true));
      } else {
        s6.rows.push(R(binIn, '= 0', '| ' + shift, true));
        s6.rows.push(R('x', '= ' + fr(mh)));
      }
      sols = [mh];
      approx = [val(mh)];
      Lhtml = '{' + fr(mh) + '}';
      s6.why = (shift ? 'Rechne ' + m(shift) + '. ' : '') + 'Es gibt nur diese eine Lösung.';
    } else {
      Lhtml = '{ }';
      s6.why = 'Die Lösungsmenge ist leer. Schreib sie als ' + m('L = { }') + '.';
    }
    s6.rows.push(R('L', '= ' + Lhtml, null, false, 'result'));
    steps.push(s6);

    // ---- 7 Probe (nur bei glatten Lösungen)
    if (sols) {
      var probes = sols.filter(function (x, i) { return i === 0 || !eqF(x, sols[0]); }).map(function (x) { return probeLine(a, b, c, x); });
      out.probeOk = probes.every(function (pl) { return pl.ok; });
      steps.push({
        tag: 'Probe', rows: [], probe: probes.map(function (pl) { return pl.html; }),
        why: 'Setz ' + (probes.length > 1 ? 'jede Lösung' : 'die Lösung') + ' in die <b>Ausgangsgleichung</b> ein. Kommt 0 heraus, stimmt alles.'
      });
    }

    out.kind = sg > 0 ? 'two' : sg === 0 ? 'one' : 'none';
    out.exact = !!sols;
    out.sols = sols;
    out.approx = approx;
    out.L = Lhtml;
    return out;
  }

  /** Alle Schritte als eine durchgehende Umformungskette (doppelte Zeilen zusammengefasst). */
  function flatten(res) {
    var rows = [];
    res.steps.forEach(function (s) {
      s.rows.forEach(function (row) {
        if (row.mid) return; // Zwischenzeile nur im Stepper, im kompakten Lösungsweg weglassen
        if (row.src && rows.length) rows[rows.length - 1] = row;
        else rows.push(row);
      });
    });
    return rows;
  }

  function calcHTML(rows) {
    return '<div class="calc erg-calc">' + rows.map(function (row) {
      if (row.note != null) return '<div class="row"><span class="note">' + row.note + '</span></div>';
      return '<div class="row' + (row.cls ? ' ' + row.cls : '') + '"><span class="l">' + row.l + '</span><span class="r">' + row.r + '</span>' +
        (row.op ? '<span class="op">' + row.op + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function probeHTML(lines) {
    return '<div class="erg-probe">' + lines.map(function (l) { return '<div class="m">' + l + '</div>'; }).join('') + '</div>';
  }
  function stepsHTML(res) {
    return '<ol class="steps" data-stepper>' + res.steps.map(function (s) {
      return '<li><p class="erg-tag">' + s.tag + '</p><div class="step-math">' +
        (s.rows.length ? calcHTML(s.rows) : '') + (s.probe ? probeHTML(s.probe) : '') +
        '</div><p class="step-why">' + s.why + '</p></li>';
    }).join('') + '</ol>';
  }

  var ENGINE = { F: F, parseFrac: parseFrac, solve: solve, flatten: flatten, sqrtSimplify: sqrtSimplify, val: val, stepsHTML: stepsHTML, calcHTML: calcHTML, probeHTML: probeHTML };
  if (typeof module === 'object' && module && module.exports) module.exports = ENGINE;
  if (typeof window === 'undefined' || !window.QG) return;
  var QG = window.QG;

  /* =====================================================================
     4. Widget: Lösungsweg einer Aufgabe (data-eq="a b c")
     ===================================================================== */
  function parseEq(str) {
    var parts = String(str || '').trim().split(/\s+/).map(parseFrac);
    if (parts.length !== 3 || parts.some(function (x) { return !x; }) || isZero(parts[0])) return null;
    return parts;
  }

  QG.widget('erg-sol', function (el) {
    var co = parseEq(el.getAttribute('data-eq'));
    if (!co) { el.textContent = 'Lösungsweg nicht verfügbar.'; return; }
    var res = solve(co[0], co[1], co[2]);
    var html = calcHTML(flatten(res));
    var last = res.steps[res.steps.length - 1];
    if (last.probe) html += '<p class="small erg-probe-h"><b>Probe</b> in der Ausgangsgleichung:</p>' + probeHTML(last.probe);
    el.innerHTML = html;
  });

  /* =====================================================================
     5. Widget: Rechner „Deine eigene Gleichung“
     ===================================================================== */
  var PRESETS = [
    ['1', '6', '-7'], ['1', '-8', '12'], ['2', '8', '-10'], ['1', '3', '-10'], ['1', '2', '5'], ['1', '4', '-1'], ['1', '-4', '-1']
  ];

  QG.widget('erg-solver', function (el) {
    var form = el.querySelector('.erg-eq');
    var inputs = {
      a: el.querySelector('input[name="a"]'),
      b: el.querySelector('input[name="b"]'),
      c: el.querySelector('input[name="c"]')
    };
    var preview = el.querySelector('.erg-preview');
    var out = el.querySelector('.erg-out');
    var go = el.querySelector('.erg-go');
    var lastFocus = inputs.b;

    Object.keys(inputs).forEach(function (k) {
      var inp = inputs[k];
      inp.addEventListener('focus', function () { lastFocus = inp; });
      inp.addEventListener('input', function () { inp.classList.remove('is-bad'); updatePreview(); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(true); } });
    });
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); run(true); });
    go.addEventListener('click', function () { run(true); });

    // Mini-Tastatur (Minus/Bruchstrich fehlen auf vielen Handy-Zifferntastaturen)
    Array.prototype.forEach.call(el.querySelectorAll('.erg-keys button'), function (b) {
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () {
        var inp = lastFocus || inputs.b;
        var k = b.getAttribute('data-k');
        if (k === 'sign') {
          var v = inp.value.trim();
          inp.value = /^[-−]/.test(v) ? v.replace(/^[-−]\s*/, '') : '−' + v;
        } else if (k === 'clear') {
          inp.value = '';
        } else {
          var s = inp.selectionStart, en = inp.selectionEnd;
          if (s == null || document.activeElement !== inp) { s = en = inp.value.length; }
          inp.value = inp.value.slice(0, s) + k + inp.value.slice(en);
          try { inp.setSelectionRange(s + k.length, s + k.length); } catch (err) { /* egal */ }
        }
        inp.classList.remove('is-bad');
        inp.focus({ preventScroll: true });
        updatePreview();
      });
    });

    Array.prototype.forEach.call(el.querySelectorAll('[data-preset]'), function (b) {
      b.addEventListener('click', function () {
        var p = PRESETS[parseInt(b.getAttribute('data-preset'), 10)];
        inputs.a.value = p[0];
        inputs.b.value = p[1].replace('-', '−');
        inputs.c.value = p[2].replace('-', '−');
        Object.keys(inputs).forEach(function (k) { inputs[k].classList.remove('is-bad'); });
        run(false);
      });
    });

    function read() {
      var vals = {}, bad = [];
      Object.keys(inputs).forEach(function (k) {
        var raw0 = inputs[k].value.trim();
        if (raw0 === '' || raw0 === '+') raw0 = (k === 'a') ? '1' : '0';
        var f = parseFrac(raw0);
        if (!f || Math.abs(val(f)) > 1000 || f.d > 100) bad.push(k);
        vals[k] = f;
      });
      return { vals: vals, bad: bad };
    }

    function updatePreview() {
      var rd = read();
      if (rd.bad.length) { preview.innerHTML = '<span class="muted">Deine Gleichung: …</span>'; return; }
      var v = rd.vals;
      if (isZero(v.a)) { preview.innerHTML = '<span class="muted">Vor x² darf keine 0 stehen.</span>'; return; }
      preview.innerHTML = 'Deine Gleichung: ' + m(polyF(v.a, v.b, v.c) + ' = 0');
      QG.math(preview);
    }

    function msg(type, html) {
      out.innerHTML = '<div class="feedback"><div class="fb ' + type + '"><span>' + html + '</span></div></div>';
      QG.math(out);
    }

    function run(scroll) {
      updatePreview();
      var rd = read();
      if (rd.bad.length) {
        rd.bad.forEach(function (k) { inputs[k].classList.add('is-bad'); });
        msg('info', 'Das kann ich nicht lesen. Erlaubt sind ganze Zahlen, Dezimalzahlen und Brüche wie <b>3/2</b> – Beträge bis 1000, Nenner bis 100.');
        return;
      }
      var v = rd.vals;
      if (isZero(v.a)) {
        inputs.a.classList.add('is-bad');
        msg('info', 'Vor ' + m('x²') + ' steht 0 – dann ist es gar keine quadratische Gleichung. Nimm z. B. 1.');
        return;
      }
      var res;
      try { res = solve(v.a, v.b, v.c); } catch (e) { res = null; }
      var big = !res || [res.p, res.q, res.r].some(function (f) { return !isFinite(f.n) || Math.abs(f.n) > 1e7 || f.d > 1e5; });
      if (big) {
        msg('info', 'Mit diesen Zahlen wird es zu unübersichtlich. Probier etwas einfachere Zahlen.');
        return;
      }
      var badge = res.kind === 'two' ? 'zwei Lösungen' : res.kind === 'one' ? 'eine Lösung' : 'keine Lösung';
      out.innerHTML =
        '<div class="erg-out-head"><span class="m">' + polyF(v.a, v.b, v.c) + ' = 0</span>' +
        '<span class="pill orange erg-badge" hidden>' + badge + '</span></div>' +
        stepsHTML(res);
      QG.wire(out);
      // Abzeichen erst zeigen, wenn alle Schritte offen sind (nichts vorwegnehmen)
      var ol = out.querySelector('ol.steps');
      var badgeEl = out.querySelector('.erg-badge');
      var mo = new MutationObserver(function () {
        var hidden = ol.querySelectorAll(':scope > li.is-hidden').length;
        badgeEl.hidden = hidden > 0;
      });
      mo.observe(ol, { subtree: true, attributes: true, attributeFilter: ['class'] });
      if (scroll) {
        var r = out.getBoundingClientRect();
        if (r.top > innerHeight - 160 || r.top < 60) out.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    }

    updatePreview();
    run(false);
  });

  /* =====================================================================
     6. Widget: Flächenmodell
     ===================================================================== */
  var X = 140, U = 16, G = 26, G2 = 16, ML = 46, MT = 34, VW = 400, VH = 290;
  var NSTAGE = 6;

  function vx(s) { // „x“ in SVG-Text kursiv
    return String(s).replace(/x/g, '<tspan class="erg-var">x</tspan>');
  }

  QG.widget('erg-area', function (el) {
    var p = parseInt(el.getAttribute('data-p'), 10) || 6;
    var stage = 0;
    el.innerHTML =
      '<div class="erg-area-top">' +
        '<span class="erg-area-plabel" id="erg-area-pl">Wähle <span class="m">p</span>:</span>' +
        '<div class="erg-seg" role="group" aria-labelledby="erg-area-pl">' +
          [2, 4, 6, 8, 10].map(function (v) { return '<button type="button" data-p="' + v + '" aria-pressed="false">' + v + '</button>'; }).join('') +
        '</div>' +
      '</div>' +
      '<div class="erg-area-fig"><svg class="erg-area-svg" viewBox="0 0 ' + VW + ' ' + VH + '" role="img"></svg></div>' +
      '<div class="erg-area-cap" aria-live="polite"><div class="mblock erg-area-f"></div><p class="erg-area-t"></p></div>' +
      '<div class="erg-area-nav">' +
        '<button type="button" class="btn ghost erg-prev">← Zurück</button>' +
        '<span class="erg-dots" aria-hidden="true">' + new Array(NSTAGE + 1).join('<i></i>') + '</span>' +
        '<span class="sr-only erg-count"></span>' +
        '<button type="button" class="btn primary erg-next">Weiter →</button>' +
      '</div>';
    var svg = el.querySelector('svg');
    var fEl = el.querySelector('.erg-area-f');
    var tEl = el.querySelector('.erg-area-t');
    var prev = el.querySelector('.erg-prev');
    var next = el.querySelector('.erg-next');
    var dots = el.querySelectorAll('.erg-dots i');
    var count = el.querySelector('.erg-count');
    var segBtns = el.querySelectorAll('.erg-seg button');
    var K = {};

    function build() {
      var h = p / 2, b = h * U, S = X + b, e = h * h;
      var area = (h === 1 ? '' : h) + 'x';
      var s = '<g transform="translate(' + ML + ' ' + MT + ')">' +
        '<rect class="erg-q" x="0" y="0" width="' + X + '" height="' + X + '" rx="2"/>' +
        '<rect class="erg-r erg-mv" data-k="r1" x="0" y="0" width="' + b + '" height="' + X + '" rx="2"/>' +
        '<rect class="erg-r erg-mv erg-rot" data-k="r2" x="0" y="0" width="' + X + '" height="' + b + '" rx="2"/>' +
        '<rect class="erg-c erg-mv" data-k="c" x="' + X + '" y="' + X + '" width="' + b + '" height="' + b + '" rx="2"/>' +
        '<rect class="erg-ol erg-mv" data-k="ol" x="0" y="0" width="' + S + '" height="' + S + '" rx="3"/>' +
        '<path class="erg-br erg-mv" data-k="br" d="M' + (S + 5) + ' 0h6V' + S + 'h-6M0 ' + (S + 5) + 'v6H' + S + 'v-6"/>' +
        txt('tq', 'x²', 'erg-tq') + txt('tqt', 'x') + txt('tql', 'x') +
        txt('tp', p + 'x', 'erg-ta') + txt('tpw', String(p)) + txt('tph', 'x') +
        txt('t1', area, 'erg-ta') + txt('t1w', String(h)) +
        txt('t2', area, 'erg-ta') + txt('t2w', String(h)) +
        txt('tc', '?', 'erg-tc') + txt('tcr', String(h)) + txt('tcb', String(h)) +
        txt('tsr', 'x + ' + h, 'erg-tot', 'start') + txt('tsb', 'x + ' + h, 'erg-tot') +
        '</g>';
      svg.innerHTML = s;
      svg.classList.toggle('erg-thin', b < 24); // p = 2: schmale Streifen → kleinere Beschriftung
      svg.setAttribute('aria-label', 'Flächenmodell: Quadrat x mal x, zwei Rechtecke ' + h + ' mal x und ein kleines Quadrat ' + h + ' mal ' + h + ' ergeben zusammen ein Quadrat mit der Seitenlänge x plus ' + h + '.');
      K = {};
      Array.prototype.forEach.call(svg.querySelectorAll('[data-k]'), function (n) { K[n.getAttribute('data-k')] = n; });
      K.tq.style.transform = tr(X / 2, X / 2);
      K.tqt.style.transform = tr(X / 2, -13);
      K.tql.style.transform = tr(-17, X / 2);
      Array.prototype.forEach.call(segBtns, function (bt) { bt.setAttribute('aria-pressed', String(+bt.getAttribute('data-p') === p)); });
      return { h: h, b: b, S: S, e: e };
    }
    function txt(k, s, cls, anchor) {
      return '<text class="erg-mv ' + (cls || 'erg-tl') + '" data-k="' + k + '" x="0" y="0" text-anchor="' + (anchor || 'middle') + '" dominant-baseline="central">' + vx(s) + '</text>';
    }
    function tr(x, y, rot) { return 'translate(' + x + 'px, ' + y + 'px)' + (rot != null ? ' rotate(' + rot + 'deg)' : ''); }
    function show(k, on, x, y, rot) {
      var n = K[k];
      if (!n) return;
      n.style.opacity = on ? '1' : '0';
      if (x != null) n.style.transform = tr(x, y, rot);
    }

    var G0;
    function render() {
      var h = G0.h, b = G0.b, S = G0.S, e = G0.e;
      var st = stage;
      var L1 = X + G, L2 = X + G + b + (st >= 2 ? G2 : 0);
      // Rechtecke
      show('r1', st >= 1, st >= 3 ? X : L1, 0);
      if (st >= 3) show('r2', true, 0, X, 0);
      else show('r2', st >= 1, L2 + b / 2 - X / 2, X / 2 - b / 2, 90);
      K.c.classList.toggle('is-filled', st >= 5);
      show('c', st >= 4);
      show('ol', st >= 5);
      show('br', st >= 5);
      // Beschriftungen
      show('tp', st === 1, L1 + b, X / 2);
      show('tpw', st === 1, L1 + b, -13);
      show('tph', st === 1, L1 + 2 * b + 14, X / 2);
      show('t1', st >= 2, st >= 3 ? X + b / 2 : L1 + b / 2, X / 2);
      show('t1w', st >= 2, st >= 3 ? X + b / 2 : L1 + b / 2, -13);
      show('t2', st >= 2, st >= 3 ? X / 2 : L2 + b / 2, st >= 3 ? X + b / 2 : X / 2);
      show('t2w', st >= 2, st >= 3 ? -17 : L2 + b / 2, st >= 3 ? X + b / 2 : -13);
      K.tc.innerHTML = st >= 5 ? String(e) : '?';
      show('tc', st >= 4, X + b / 2, X + b / 2);
      show('tcr', st === 4, S + 13, X + b / 2);
      show('tcb', st === 4, X + b / 2, S + 15);
      show('tsr', st >= 5, S + 18, S / 2);
      show('tsb', st >= 5, S / 2, S + 24);

      // Text
      var hx = (h === 1 ? '' : h) + 'x';
      var Q = '<span class="hl-violet">x²</span>', P = '<span class="hl-teal">' + p + 'x</span>';
      var H = '<span class="hl-teal">' + hx + '</span>', E = '<span class="hl-orange">' + e + '</span>';
      var f, tx;
      switch (st) {
        case 0: f = Q; tx = 'Starte mit ' + m('x²') + ': Das ist die Fläche eines Quadrats mit der Seitenlänge ' + m('x') + '.'; break;
        case 1: f = Q + ' + ' + P; tx = 'Dazu kommt ' + m(p + 'x') + ': ein Rechteck mit den Seiten ' + m(p) + ' und ' + m('x') + '.'; break;
        case 2: f = Q + ' + ' + H + ' + ' + H; tx = 'Teile das Rechteck in zwei gleiche Hälften. Jede ist ' + m(h + ' · x') + ' groß – hier steckt das Halbieren: ' + m(p + ' : 2 = ' + h) + '.'; break;
        case 3: f = Q + ' + ' + H + ' + ' + H; tx = 'Leg eine Hälfte rechts und eine unten an das Quadrat. Das sieht schon fast aus wie ein großes Quadrat …'; break;
        case 4: f = Q + ' + ' + P + ' + <span class="hl-orange">?</span>'; tx = '… aber rechts unten fehlt eine Ecke: ein kleines Quadrat mit der Fläche ' + m(h + ' · ' + h + ' = ' + e) + '. Das ist das Quadrieren.'; break;
        default: f = Q + ' + ' + P + ' + ' + E + ' = (x + ' + h + ')²'; tx = 'Ergänzt! Die ganze Fläche ist jetzt ein Quadrat mit der Seitenlänge ' + m('x + ' + h) + '. Die Zahl, die du ergänzen musst, ist ' + m('(' + p + ' : 2)² = ' + e) + '.';
      }
      fEl.innerHTML = f;
      tEl.innerHTML = tx;
      QG.math(fEl); QG.math(tEl);
      prev.disabled = st === 0;
      next.textContent = st >= NSTAGE - 1 ? '↺ Von vorn' : 'Weiter →';
      Array.prototype.forEach.call(dots, function (d, i) { d.classList.toggle('on', i <= st); });
      count.textContent = 'Schritt ' + (st + 1) + ' von ' + NSTAGE;
    }

    function rebuild() {
      el.classList.add('erg-noanim');
      G0 = build();
      render();
      void svg.getBoundingClientRect();
      requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.remove('erg-noanim'); }); });
    }

    Array.prototype.forEach.call(segBtns, function (bt) {
      bt.addEventListener('click', function () {
        var v = +bt.getAttribute('data-p');
        if (v === p) return;
        p = v;
        rebuild();
      });
    });
    prev.addEventListener('click', function () { if (stage > 0) { stage--; render(); } });
    next.addEventListener('click', function () {
      stage = stage >= NSTAGE - 1 ? 0 : stage + 1;
      render();
    });
    rebuild();
  });

  /* =====================================================================
     7. Widget: Bonus-Plot Scheitelpunktform
     ===================================================================== */
  QG.widget('erg-vertex', function (el) {
    QG.plot(el, {
      xmin: -1, xmax: 5, ymin: -2, ymax: 4, grid: true,
      label: 'Parabel f(x) = x² − 4x + 3 mit Scheitelpunkt S(2 | −1) und Nullstellen bei 1 und 3',
      fns: [{ f: function (x) { return x * x - 4 * x + 3; }, color: 'orange', width: 3 }],
      lines: [{ x: 2, color: 'slate', dash: true, width: 1.5 }],
      points: [
        { x: 2, y: -1, label: 'S(2 | −1)', color: 'orange', pos: 'e' },
        { x: 1, y: 0, color: 'green' },
        { x: 3, y: 0, color: 'green' }
      ]
    });
  });
})();

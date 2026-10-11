/* Kapitel 50 · Welcher Weg wann?
   Widgets: mw-wegweiser (Gleichung analysieren / Fragen-Assistent), mw-tabs, mw-plot, mw-sortierspiel */
(function () {
  'use strict';
  var QG = window.QG;
  if (!QG) return;

  var MINUS = '−';
  var EPS = 1e-9;
  var X = '<var>x</var>';

  /* =====================================================================
     Zahlen & Terme
     ===================================================================== */
  function isInt(v) { return Math.abs(v - Math.round(v)) < 1e-9; }
  function clean(v) { if (Math.abs(v) < 1e-12) return 0; return isInt(v) ? Math.round(v) : v; }
  function F(v) { return QG.fmtFrac(clean(v), 400); }                     // Bruch bis Nenner 400
  function S(v) { return QG.sign(clean(v), F); }                          // „+ 3“ / „− 3“
  function P(v) { v = clean(v); return v < 0 ? '(' + F(v) + ')' : F(v); } // negative Zahl in Klammern
  function frac(top, bot) { return '<span class="frac"><span>' + top + '</span><span>' + bot + '</span></span>'; }
  function lin(k) { k = clean(k); return k === 0 ? X : X + ' ' + S(k); }  // x + k
  function linH(u, v) {                                                     // u·x + v
    u = clean(u); v = clean(v);
    var head = u === 1 ? X : u === -1 ? MINUS + X : F(u) + X;
    return v === 0 ? head : head + ' ' + S(v);
  }
  /** wie QG.poly, aber mit Brüchen bis Nenner 400 */
  function polyH(a, b, c) {
    a = clean(a); b = clean(b); c = clean(c);
    var terms = [];
    function coef(k) { return Math.abs(k - 1) < EPS ? '' : F(k); }
    if (a) terms.push([a < 0, coef(Math.abs(a)) + X + '²']);
    if (b) terms.push([b < 0, coef(Math.abs(b)) + X]);
    if (c) terms.push([c < 0, F(Math.abs(c))]);
    if (!terms.length) return '0';
    return terms.map(function (t, i) {
      if (i === 0) return (t[0] ? MINUS : '') + t[1];
      return (t[0] ? ' ' + MINUS + ' ' : ' + ') + t[1];
    }).join('');
  }
  function m(html) { return '<span class="m">' + html + '</span>'; }
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a || 1; }

  /** rationale Darstellung [Zähler, Nenner] (Nenner ≤ maxDen) oder null */
  function toFrac(v, maxDen) {
    var md = maxDen || 10000;
    for (var d = 1; d <= md; d++) {
      var n = v * d;
      if (Math.abs(n - Math.round(n)) < 1e-7 * Math.max(1, Math.abs(n))) return [Math.round(n), d];
    }
    return null;
  }

  /** √s als {k, m, d} mit √s = k·√m / d (m quadratfrei) – oder null */
  function sqrtParts(s) {
    var fr = toFrac(s, 2000);
    if (!fr || fr[0] <= 0) return null;
    var N = fr[0] * fr[1], d = fr[1];
    if (N > 1e9) return null;
    var k = 1, mm = N;
    for (var i = Math.floor(Math.sqrt(N) + 1e-9); i > 1; i--) {
      if (N % (i * i) === 0) { k = i; mm = N / (i * i); break; }
    }
    var g = gcd(k, d);
    return { k: k / g, m: mm, d: d / g };
  }
  function sqrtHtml(s) {
    var sp = sqrtParts(s);
    if (!sp) return '√' + P(s);
    if (sp.m === 1) return F(sp.k / sp.d);
    var core = (sp.k === 1 ? '' : sp.k) + '√' + sp.m;
    return sp.d === 1 ? core : frac(core, sp.d);
  }

  /** exakte Lösungen von ax² + bx + c = 0 (a ≠ 0) */
  function exactRoots(a, b, c) {
    var h = -b / (2 * a);
    var D = b * b - 4 * a * c;
    var scale = Math.max(1, b * b, Math.abs(4 * a * c));
    if (Math.abs(D) < 1e-9 * scale) return { vals: [clean(h)], html: [F(h)], rational: true, h: h, s: 0 };
    if (D < 0) return { vals: [], html: [], rational: true, h: h, s: D / (4 * a * a) };
    var s = D / (4 * a * a), r = Math.sqrt(s);
    var sp = sqrtParts(s);
    var v1 = h - r, v2 = h + r;
    if (sp && sp.m === 1) return { vals: [clean(v1), clean(v2)], html: [F(v1), F(v2)], rational: true, h: h, s: s };
    var sq = sqrtHtml(s);
    var html = clean(h) === 0 ? [MINUS + sq, sq] : [F(h) + ' ' + MINUS + ' ' + sq, F(h) + ' + ' + sq];
    return { vals: [v1, v2], html: html, rational: false, h: h, s: s };
  }
  function setHtml(roots) { return roots.vals.length ? '{' + roots.html.join('; ') + '}' : '{ }'; }

  /* ---------- Rechen-Zeilen (Core-.calc) ---------- */
  function R(l, r, op, cls) {
    return '<div class="row' + (cls ? ' ' + cls : '') + '"><span class="l">' + l + '</span><span class="r">' + r + '</span>' +
      (op ? '<span class="op">| ' + op + '</span>' : '') + '</div>';
  }
  function eqR(l, r, op) { return R(l, '= ' + r, op); }
  function note(t) { return '<div class="row"><span class="note">' + t + '</span></div>'; }
  function orLine(txt, op) { return '<div class="row"><span class="note mw-or">' + txt + (op ? '<span class="mw-or-op">| ' + op + '</span>' : '') + '</span></div>'; }
  function nw(h) { return '<span class="mw-nw">' + h + '</span>'; }
  function orRow(a, b, op) { return orLine(nw(X + ' = ' + a) + '&ensp;oder&ensp;' + nw(X + ' = ' + b), op); }
  function Lrow(roots) { return R('L', '= ' + setHtml(roots), null, 'result sep'); }
  function calc(rows) { return '<div class="calc">' + rows.join('') + '</div>'; }
  function minusOp(v) { v = clean(v); return v > 0 ? MINUS + ' ' + F(v) : '+ ' + F(-v); } // Operation, die v wegschafft
  function divOp(a) { return ': ' + P(a); }

  /* =====================================================================
     Parser für Gleichungen (Grad ≤ 2) mit Struktur-Erkennung
     ===================================================================== */
  function PErr(msg) { var e = new Error(msg); e.qg = true; return e; }

  function tokenize(src) {
    var s = String(src)
      .replace(/[−–—‒]/g, '-')
      .replace(/[·×∙⋅•]/g, '*')
      .replace(/X/g, 'x')
      .replace(/:/g, '/')
      .replace(/\^\s*(?:\(\s*2\s*\)|2(?![\d.]))/g, '²')
      .replace(/\^\s*(?:\(\s*3\s*\)|3(?![\d.]))/g, '³')
      .replace(/(\d),(\d)/g, '$1.$2')
      .replace(/\s+/g, '');
    var toks = [], i = 0;
    while (i < s.length) {
      var c = s[i];
      var mm = /^(\d+(?:\.\d+)?|\.\d+)/.exec(s.slice(i));
      if (mm) { toks.push({ t: 'num', v: parseFloat(mm[0]) }); i += mm[0].length; continue; }
      if (c === 'x') {
        toks.push({ t: 'x' }); i++;
        if (s[i] === '2' && !/[\d.]/.test(s[i + 1] || '')) { toks.push({ t: '²' }); i++; } // „x2“ = x²
        continue;
      }
      if ('+-*/()=²³'.indexOf(c) >= 0) { toks.push({ t: c }); i++; continue; }
      if (c === '^') throw PErr('Nach ^ erwarte ich eine 2, z. B. <b>x^2</b>.');
      if (/[a-wyz]/i.test(c)) throw PErr('Bitte nur die Variable <b>x</b> benutzen.');
      throw PErr('Das Zeichen „' + QG.esc(c) + '“ verstehe ich nicht.');
    }
    return toks;
  }

  function padd(p, q, sg) { return [p[0] + sg * q[0], p[1] + sg * q[1], p[2] + sg * q[2]]; }
  function pmul(p, q) {
    var r = [0, 0, 0, 0, 0];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) r[i + j] += p[i] * q[j];
    if (Math.abs(r[3]) > EPS || Math.abs(r[4]) > EPS) throw PErr('Da entsteht <b>x³</b> oder mehr – das ist keine quadratische Gleichung.');
    return [r[0], r[1], r[2]];
  }
  function deg(p) { return Math.abs(p[2]) > EPS ? 2 : Math.abs(p[1]) > EPS ? 1 : 0; }
  function isZero(p) { return deg(p) === 0 && Math.abs(p[0]) < EPS; }

  function parseEquation(str) {
    var toks = tokenize(str);
    if (!toks.length) throw PErr('Gib zuerst eine Gleichung ein, z. B. <b>x² + 3x = 10</b>.');
    if (toks.filter(function (t) { return t.t === '='; }).length > 1) throw PErr('Bitte nur <b>ein</b> Gleichheitszeichen.');
    var pos = 0;
    function peek() { return toks[pos] ? toks[pos].t : null; }

    function base() {
      var t = toks[pos];
      if (!t) throw PErr('Da fehlt noch etwas am Ende.');
      if (t.t === 'num') { pos++; return { p: [t.v, 0, 0], cls: 'const' }; }
      if (t.t === 'x') { pos++; return { p: [0, 1, 0], cls: 'x', base: [0, 1, 0] }; }
      if (t.t === '(') {
        pos++;
        var e = expr();
        if (peek() !== ')') throw PErr('Da fehlt eine schließende Klammer <b>)</b>.');
        pos++;
        var d = deg(e.p);
        return { p: e.p, cls: d === 0 ? 'const' : d === 1 ? 'lin' : 'other', base: e.p };
      }
      if (t.t === '=' || t.t === ')') throw PErr('Vor „' + t.t + '“ fehlt etwas.');
      throw PErr('An der Stelle „' + t.t + '“ komme ich nicht weiter.');
    }
    function factor() {
      if (peek() === '-') { pos++; var f = factor(); f.p = f.p.map(function (v) { return -v; }); f.sign = -(f.sign || 1); return f; }
      if (peek() === '+') { pos++; return factor(); }
      var b = base();
      b.sign = 1;
      while (peek() === '²' || peek() === '³') {
        var cube = peek() === '³';
        pos++;
        var p2 = pmul(b.p, b.p);
        if (cube) p2 = pmul(p2, b.p);
        var wasLin = b.cls === 'lin' || b.cls === 'x';
        b = { p: p2, cls: b.cls === 'const' ? 'const' : (wasLin && !cube ? (b.cls === 'x' ? 'x2' : 'sq') : 'other'), base: b.base, sign: 1 };
      }
      return b;
    }
    function term() {
      var f = factor();
      var acc = f.p, k = 1, nc = [];
      function take(ff) { if (ff.cls === 'const') k *= ff.p[0]; else { k *= ff.sign || 1; nc.push(ff); } }
      take(f);
      for (;;) {
        var t = peek();
        if (t === '*') { pos++; f = factor(); acc = pmul(acc, f.p); take(f); }
        else if (t === '/') {
          pos++; f = factor();
          if (deg(f.p) > 0) throw PErr('Durch einen Term mit <b>x</b> teilen geht hier nicht.');
          if (Math.abs(f.p[0]) < EPS) throw PErr('Durch 0 kann man nicht teilen.');
          acc = acc.map(function (v) { return v / f.p[0]; }); k /= f.p[0];
        } else if (t === 'x' || t === '(') { f = factor(); acc = pmul(acc, f.p); take(f); } // 2x, x(x − 3), (x + 1)(x − 2)
        else break;
      }
      return { p: acc, k: k, nc: nc };
    }
    function expr() {
      var p = [0, 0, 0], terms = [];
      var sg = 1;
      if (peek() === '-' || peek() === '+') { sg = peek() === '-' ? -1 : 1; pos++; }
      var t = term(); t.k *= sg; p = padd(p, t.p, sg); terms.push(t);
      while (peek() === '+' || peek() === '-') {
        sg = peek() === '-' ? -1 : 1; pos++;
        t = term(); t.k *= sg; p = padd(p, t.p, sg); terms.push(t);
      }
      var shape = null;
      if (terms.length === 1) {
        var tt = terms[0];
        if (tt.nc.length === 1 && tt.nc[0].cls === 'sq') shape = { type: 'square', k: tt.k, base: tt.nc[0].base };
        else if (tt.nc.length === 2 && tt.nc.every(function (f) { return f.cls === 'lin' || f.cls === 'x'; })) shape = { type: 'product', k: tt.k, f1: tt.nc[0].base, f2: tt.nc[1].base };
      }
      return { p: p, shape: shape };
    }

    var L = expr(), Rr, hasEq = false;
    if (peek() === '=') { pos++; hasEq = true; Rr = expr(); }
    else Rr = { p: [0, 0, 0], shape: null };
    if (pos < toks.length) throw PErr('An der Stelle „' + QG.esc(toks[pos].t === 'num' ? String(toks[pos].v) : toks[pos].t) + '“ komme ich nicht weiter.');
    return { L: L, R: Rr, hasEq: hasEq, toks: toks };
  }

  /** Eingabe hübsch darstellen (aus den Tokens) */
  function prettyInput(toks) {
    var out = '', prev = null;
    toks.forEach(function (t) {
      var unary = prev === null || prev === '(' || prev === '=' || prev === '*' || prev === '/';
      if (t.t === 'num') out += QG.fmt(t.v, 6);
      else if (t.t === 'x') out += 'x';
      else if (t.t === '+') out += unary ? '+' : ' + ';
      else if (t.t === '-') out += unary ? MINUS : ' ' + MINUS + ' ';
      else if (t.t === '*') out += ' · ';
      else if (t.t === '/') out += ' : ';
      else if (t.t === '=') out += ' = ';
      else out += t.t;
      prev = t.t;
    });
    return QG.esc(out).replace(/x/g, '<var>x</var>');
  }

  /* =====================================================================
     Methoden (für Wegweiser, Fragen-Assistent und Spiel)
     ===================================================================== */
  var METH = {
    aus:    { name: 'x ausklammern', color: 'green', ico: 'x(…)', href: '#fakt-a', link: 'Faktorisieren · Werkzeug A' },
    wurzel: { name: 'Wurzel ziehen', color: 'green', ico: '√', href: '#fakt-b', link: 'Faktorisieren · Werkzeug B' },
    binom:  { name: 'Binomische Formel rückwärts', color: 'green', ico: '(…)²', href: '#fakt-c', link: 'Faktorisieren · Werkzeug C' },
    vieta:  { name: 'Produkt-Summen-Trick (Vieta)', color: 'green', ico: 'u·v', href: '#fakt-d', link: 'Faktorisieren · Werkzeug D' },
    erg:    { name: 'Quadratische Ergänzung', color: 'orange', ico: '+□', href: '#ergaenzung', link: 'Weg 3: Quadratische Ergänzung' },
    nullp:  { name: 'Satz vom Nullprodukt – direkt ablesen', color: 'green', ico: '·=0', href: '#faktorisieren', link: 'Weg 2: Faktorisieren' },
    sq:     { name: 'Direkt Wurzel ziehen', color: 'green', ico: '√', href: '#fakt-b', link: 'Faktorisieren · Werkzeug B' },
    graf:   { name: 'Grafisch lösen', color: 'blue', ico: '📈', href: '#grafisch', link: 'Weg 1: Grafisch lösen' },
    linear: { name: 'Lineare Gleichung', color: 'slate', ico: '=', href: null, link: null }
  };
  var CHAPTER_OF = { fakt: 'faktorisieren', graf: 'grafisch', erg: 'ergaenzung' };
  /** Sprungziel prüfen – fehlt der Anker, aufs Kapitel ausweichen */
  function safeHref(href) {
    if (!href || href.charAt(0) !== '#') return href;
    var id = href.slice(1);
    if (document.getElementById(id)) return href;
    var pre = id.split('-')[0];
    return CHAPTER_OF[pre] ? '#' + CHAPTER_OF[pre] : '#' + id;
  }

  /* ---------- Lösungswege generieren ---------- */
  function stepsAus(a, b) {
    var r2 = -b / a;
    var ax = a === 1 ? X : a === -1 ? MINUS + X : F(a) + X;
    return calc([
      eqR(polyH(a, b, 0), '0', ax + ' ausklammern'),
      eqR(ax + ' · (' + lin(b / a) + ')', '0', 'Satz vom Nullprodukt'),
      orRow('0', F(r2)),
      Lrow(exactRoots(a, b, 0))
    ]);
  }
  function stepsWurzel(a, c, start) {
    var rows = [], k = -c / a;
    if (start) rows.push(eqR(polyH(start.a, 0, 0), F(start.r), start.a !== 1 ? divOp(start.a) : (k > 0 ? '√ (±!)' : null)));
    else {
      if (c !== 0) {
        rows.push(eqR(polyH(a, 0, c), '0', minusOp(c)));
        rows.push(eqR(polyH(a, 0, 0), F(-c), a !== 1 ? divOp(a) : (k > 0 ? '√ (±!)' : null)));
      } else rows.push(eqR(polyH(a, 0, 0), '0', a !== 1 ? divOp(a) : null));
    }
    if (a !== 1) rows.push(eqR(X + '²', F(k), k > 0 ? '√ (±!)' : null));
    var roots = exactRoots(a, 0, c);
    if (k > EPS) rows.push(eqR(X, '±' + sqrtHtml(k)));
    else if (k < -EPS) rows.push(note('Ein Quadrat ist nie negativ ⇒ keine Lösung.'));
    else rows.push(eqR(X, '0'));
    rows.push(Lrow(roots));
    return calc(rows);
  }
  function stepsBinom(a, b, c) {
    var rows = [], r0 = -b / (2 * a);
    var nr = b / a < 0 ? '2.' : '1.';
    var sa = Math.sqrt(a), sc = Math.sqrt(c);
    if (a !== 1 && a > 0 && c > 0 && isInt(sa) && isInt(sc)) {
      sa = Math.round(sa); sc = Math.round(sc);
      var sg = b > 0 ? 1 : -1;
      rows.push(eqR(polyH(a, b, c), '0', nr + ' binomische Formel'));
      rows.push(eqR('(' + linH(sa, sg * sc) + ')²', '0', '√'));
      rows.push(eqR(linH(sa, sg * sc), '0', minusOp(sg * sc)));
      rows.push(eqR(linH(sa, 0), F(-sg * sc), divOp(sa)));
    } else {
      var p = b, q = c;
      if (a !== 1) { rows.push(eqR(polyH(a, b, c), '0', divOp(a))); p = b / a; q = c / a; }
      rows.push(eqR(polyH(1, p, q), '0', nr + ' binomische Formel'));
      rows.push(eqR('(' + lin(p / 2) + ')²', '0', '√'));
      rows.push(eqR(lin(p / 2), '0', minusOp(p / 2)));
    }
    rows.push(eqR(X, F(r0)));
    rows.push(Lrow(exactRoots(a, b, c)));
    return calc(rows);
  }
  function stepsVieta(a, b, c, u, v) {
    var rows = [], p = b / a, q = c / a;
    if (a !== 1) rows.push(eqR(polyH(a, b, c), '0', divOp(a)));
    rows.push(eqR(polyH(1, p, q), '0', 'Zahlenpaar ' + F(u) + ' und ' + F(v)));
    rows.push(note(P(u) + ' · ' + P(v) + ' = ' + F(q) + ' und ' + P(u) + ' + ' + P(v) + ' = ' + F(p) + ' ✓'));
    if (u === v) {
      rows.push(eqR('(' + lin(u) + ')²', '0', 'Satz vom Nullprodukt'));
      rows.push(eqR(X, F(-u)));
    } else {
      rows.push(eqR('(' + lin(u) + ') · (' + lin(v) + ')', '0', 'Satz vom Nullprodukt'));
      rows.push(orRow(F(-u), F(-v)));
    }
    rows.push(Lrow(exactRoots(a, b, c)));
    return calc(rows);
  }
  function stepsErg(a, b, c) {
    var rows = [], p = b / a, q = c / a, h = p / 2, h2 = h * h, s = h2 - q;
    if (a !== 1) rows.push(eqR(polyH(a, b, c), '0', divOp(a)));
    if (clean(q) !== 0) rows.push(eqR(polyH(1, p, q), '0', minusOp(q)));
    var sqOf = (h < 0 || !isInt(h)) ? '(' + F(h) + ')²' : F(h) + '²';
    rows.push(eqR(polyH(1, p, 0), F(-q), '+ ' + sqOf + (isInt(h) && h > 0 ? '' : ' (= ' + F(h2) + ')')));
    rows.push(eqR(polyH(1, p, h2), F(s), (h > 0 ? '1.' : '2.') + ' binomische Formel'));
    rows.push(eqR('(' + lin(h) + ')²', F(s), s > EPS ? '√ (±!)' : null));
    var roots = exactRoots(a, b, c);
    if (s < -EPS) rows.push(note('Ein Quadrat ist nie negativ ⇒ keine Lösung.'));
    else {
      rows.push(eqR(lin(h), '±' + sqrtHtml(s), minusOp(h)));
      if (roots.rational && roots.vals.length === 2) rows.push(orRow(roots.html[1], roots.html[0]));
      else if (roots.vals.length === 2) rows.push(eqR(X, F(-h) + ' ± ' + sqrtHtml(s)));
    }
    rows.push(Lrow(roots));
    return calc(rows);
  }
  function factorHtml(f) { return (clean(f[0]) === 0 && clean(f[1]) === 1) ? X : '(' + linH(f[1], f[0]) + ')'; }
  function stepsNull(shape, a, b, c) {
    var k = clean(shape.k), f1 = shape.f1, f2 = shape.f2;
    var pre = k === 1 ? '' : k === -1 ? MINUS : F(k) + ' · ';
    var r1 = -f1[0] / f1[1], r2 = -f2[0] / f2[1];
    var rows = [
      eqR(pre + factorHtml(f1) + ' · ' + factorHtml(f2), '0', 'Satz vom Nullprodukt'),
      orLine(nw(linH(f1[1], f1[0]) + ' = 0') + '&ensp;oder&ensp;' + nw(linH(f2[1], f2[0]) + ' = 0'))
    ];
    rows.push(Math.abs(r1 - r2) < EPS ? eqR(X, F(r1)) : orRow(F(r1), F(r2)));
    rows.push(Lrow(exactRoots(a, b, c)));
    return calc(rows);
  }
  function stepsSquare(shape, rhs, a, b, c) {
    var k = clean(shape.k), u = shape.base[1], v = shape.base[0];
    if (u < 0) { u = -u; v = -v; }
    var s = rhs / k, rows = [];
    var sqH = '(' + linH(u, v) + ')²';
    if (k !== 1) rows.push(eqR((k === -1 ? MINUS : F(k) + ' · ') + sqH, F(rhs), divOp(k)));
    rows.push(eqR(sqH, F(s), s > EPS ? '√ (±!)' : (Math.abs(s) < EPS ? '√' : null)));
    if (s < -EPS) rows.push(note('Ein Quadrat ist nie negativ ⇒ keine Lösung.'));
    else if (Math.abs(s) < EPS) {
      rows.push(eqR(linH(u, v), '0', clean(v) !== 0 ? minusOp(v) : (u !== 1 ? divOp(u) : null)));
      rows.push(eqR(X, F(-v / u)));
    } else {
      var roots0 = exactRoots(a, b, c);
      rows.push(eqR(linH(u, v), '±' + sqrtHtml(s), clean(v) !== 0 ? minusOp(v) : (u !== 1 ? divOp(u) : null)));
      if (u !== 1 && clean(v) !== 0) rows.push(eqR(linH(u, 0), (F(-v) + ' ± ' + sqrtHtml(s)), divOp(u)));
      if (roots0.rational && roots0.vals.length === 2) rows.push(orRow(roots0.html[1], roots0.html[0]));
      else if (u === 1) rows.push(eqR(X, (clean(v) !== 0 ? F(-v) + ' ± ' : '±') + sqrtHtml(s)));
      else rows.push(eqR(X, frac(F(-v) + ' ± ' + sqrtHtml(s), F(u))));
    }
    rows.push(Lrow(exactRoots(a, b, c)));
    return calc(rows);
  }
  function stepsLinear(b, c) {
    var rows = [];
    if (clean(c) !== 0) rows.push(eqR(polyH(0, b, c), '0', minusOp(c)));
    rows.push(eqR(linH(b, 0), F(-c), b !== 1 ? divOp(b) : null));
    rows.push(eqR(X, F(-c / b)));
    rows.push(R('L', '= {' + F(-c / b) + '}', null, 'result sep'));
    return calc(rows);
  }

  /* ---------- Analyse ---------- */
  function analyze(eq) {
    var L = eq.L, Rr = eq.R, swapped = false;
    if ((isZero(L.p) && !isZero(Rr.p)) || deg(L.p) < deg(Rr.p)) { var t = L; L = Rr; Rr = t; swapped = true; }
    var Pp = padd(L.p, Rr.p, -1);
    var c = clean(Pp[0]), b = clean(Pp[1]), a = clean(Pp[2]);
    var rZero = isZero(Rr.p);
    var res = { a: a, b: b, c: c, checks: [], rec: null, alts: [], swapped: swapped, rZero: rZero };
    function check(state, q, ans) { res.checks.push({ state: state, q: q, a: ans }); }
    function rec(key, why, steps) { res.rec = { key: key, why: why, steps: steps }; }

    if (a === 0) {
      if (b === 0) {
        res.special = c === 0
          ? 'Links und rechts steht dasselbe – die Gleichung stimmt für <b>jede</b> Zahl.'
          : 'Die Gleichung ist ein Widerspruch (z. B. 3 = 5) – sie hat <b>keine</b> Lösung: ' + m('L = { }') + '.';
        return res;
      }
      rec('linear', 'Hier kommt kein ' + m(X + '²') + ' vor (oder es hebt sich weg). Das ist eine <b>lineare</b> Gleichung – einfach nach ' + m(X) + ' umstellen.', stepsLinear(b, c));
      return res;
    }

    // Abkürzungen über die Struktur
    var sqSide = null, sqRhs = null;
    if (L.shape && L.shape.type === 'square' && deg(Rr.p) === 0) { sqSide = L.shape; sqRhs = Rr.p[0]; }
    else if (Rr.shape && Rr.shape.type === 'square' && deg(L.p) === 0) { sqSide = Rr.shape; sqRhs = L.p[0]; }
    if (sqSide) {
      check('yes', 'Quadrat = Zahl?', 'Ja – auf einer Seite steht nur ein Quadrat, auf der anderen nur eine Zahl.');
      rec('sq', 'Das Quadrat steht schon allein. Zieh direkt die Wurzel (mit ±) – ausmultiplizieren wäre ein Umweg.', stepsSquare(sqSide, sqRhs, a, b, c));
      res.alts.push('Ausmultiplizieren und dann ' + METH.vieta.name + ' oder Ergänzung – geht auch, ist aber länger.');
      return res;
    }
    if (L.shape && L.shape.type === 'product') {
      if (rZero) {
        check('yes', 'Produkt = 0?', 'Ja – auf einer Seite steht schon ein Produkt, auf der anderen 0.');
        rec('nullp', 'Mehr brauchst du nicht: Ein Produkt ist null, wenn ein Faktor null ist. Setz jeden Faktor gleich 0.', stepsNull(L.shape, a, b, c));
        return res;
      }
      check('warn', 'Produkt = 0?', 'Da steht zwar ein Produkt, aber auf der anderen Seite steht <b>nicht 0</b>. Den Satz vom Nullprodukt darfst du so <b>nicht</b> anwenden – erst ausmultiplizieren und alles auf eine Seite bringen.');
    }

    // 0. Rechts 0?  (Sonderfall: links nur ax², rechts nur eine Zahl → direkt weiter)
    var pureSq = !rZero && deg(L.p) === 2 && Math.abs(L.p[1]) < EPS && Math.abs(L.p[0]) < EPS && deg(Rr.p) === 0;
    res.pureSq = pureSq;
    if (rZero) check('yes', 'Steht rechts 0?', swapped ? 'Ja – die 0 stand links, die Seiten darfst du einfach tauschen.' : 'Ja.');
    else if (swapped && !pureSq) check('no', 'Steht rechts 0?', 'Nein – ich tausche zuerst die Seiten (das darfst du immer) und bringe dann alles auf eine Seite: ' + m(polyH(a, b, c) + ' = 0'));
    else if (pureSq) check('yes', 'Steht ' + X + '² allein?', 'Ja – auf einer Seite nur ' + m(polyH(L.p[2], 0, 0)) + ', auf der anderen nur eine Zahl. Umformen auf „= 0“ ist hier nicht nötig.');
    else check('no', 'Steht rechts 0?', 'Nein – erst alles auf eine Seite bringen: ' + m(polyH(a, b, c) + ' = 0'));

    // Normalform-Vorbereitung
    var p = b / a, q = c / a;

    // 1. c fehlt?
    if (c === 0) {
      if (b === 0) {
        check('yes', 'Fehlt die Zahl ohne ' + X + '?', 'Ja – und das Glied mit ' + X + ' fehlt auch.');
        rec('wurzel', 'Es bleibt nur ' + m(polyH(a, 0, 0) + ' = 0') + '. Das geht nur, wenn ' + m(X + ' = 0') + ' ist.', stepsWurzel(a, 0, null));
        return res;
      }
      check('yes', 'Fehlt die Zahl ohne ' + X + '?', 'Ja – in jedem Glied steckt ein ' + X + '.');
      rec('aus', 'In jedem Glied steckt ein ' + m(X) + '. Klammere es aus und benutze den Satz vom Nullprodukt. Eine Lösung ist dann immer ' + m(X + ' = 0') + '. <b>Nicht</b> durch ' + m(X) + ' teilen – sonst geht sie verloren!', stepsAus(a, b));
      res.alts.push(METH.erg.name + ' – klappt auch, ist aber deutlich länger.');
      return res;
    }
    if (!pureSq) check('no', 'Fehlt die Zahl ohne ' + X + '?', 'Nein – ' + m('c = ' + F(c)) + '.');

    // 2. b fehlt?
    if (b === 0) {
      var k = -c / a;
      var start = pureSq ? { a: a, r: Rr.p[0] } : null;
      if (!pureSq) check('yes', 'Fehlt das Glied mit ' + X + '?', 'Ja – ' + m('b = 0') + '.');
      rec('wurzel', k < 0
        ? 'Es gibt kein Glied mit ' + m(X) + '. Umstellen zeigt sofort: ' + m(X + '² = ' + F(k)) + ' – und ein Quadrat ist nie negativ.'
        : 'Es gibt kein Glied mit ' + m(X) + '. Bring die Zahl auf die andere Seite' + (a !== 1 ? ', teile durch ' + F(a) : '') + ' und zieh die Wurzel – an ± denken!', stepsWurzel(a, c, start));
      var sa = Math.sqrt(a), sc = Math.sqrt(-c);
      if (k > 0 && a > 0 && isInt(sa) && isInt(sc)) res.alts.push('3. binomische Formel: ' + m('(' + linH(Math.round(sa), Math.round(sc)) + ') · (' + linH(Math.round(sa), -Math.round(sc)) + ') = 0') + ' – genauso schnell.');
      return res;
    }
    check('no', 'Fehlt das Glied mit ' + X + '?', 'Nein – ' + m('b = ' + F(b)) + '.');

    // 3. binomische Formel?
    var D = b * b - 4 * a * c;
    var roots = exactRoots(a, b, c);
    if (roots.vals.length === 1) {
      var bsa = Math.sqrt(a), bsc = Math.sqrt(c);
      var bTxt = a === 1 ? 'die Zahl ' + F(c) + ' ist ' + P(b / 2) + '² und das Mittelglied passt.'
        : (a > 0 && c > 0 && isInt(bsa) && isInt(bsc)) ? m(polyH(a, b, c) + ' = (' + linH(Math.round(bsa), (b > 0 ? 1 : -1) * Math.round(bsc)) + ')²') + '.'
        : 'nach dem Teilen durch ' + F(a) + ' passt eine binomische Formel.';
      check('yes', 'Binomische Formel?', 'Ja – ' + bTxt);
      rec('binom', 'Die Zahl ist eine Quadratzahl und das Mittelglied ist genau „2 · … · ' + X + '“. Also: binomische Formel rückwärts. Es gibt nur <b>eine</b> Lösung.', stepsBinom(a, b, c));
      if (isInt(p) && isInt(q) && isInt(roots.vals[0])) res.alts.push(METH.vieta.name + ': ' + m(P(-roots.vals[0]) + ' · ' + P(-roots.vals[0]) + ' = ' + F(q)) + ' – genauso schnell.');
      return res;
    }
    var need = b * b / (4 * a);
    check('no', 'Binomische Formel?', 'Nein – dafür müsste die Zahl ohne ' + X + ' genau ' + m(F(need)) + ' sein.');

    // 4. Produkt-Summen-Trick?
    var intPQ = isInt(p) && isInt(q);
    if (intPQ && roots.vals.length === 2 && roots.rational && isInt(roots.vals[0]) && isInt(roots.vals[1])) {
      var u = -roots.vals[1], v = -roots.vals[0];
      check('yes', 'Ganzzahliges Zahlenpaar?', 'Ja – ' + m(P(u) + ' · ' + P(v) + ' = ' + F(q)) + ' und ' + m(P(u) + ' + ' + P(v) + ' = ' + F(p)) + (a !== 1 ? ' (nach dem Teilen durch ' + F(a) + ')' : '') + '.');
      rec('vieta', (a !== 1 ? 'Nach dem Teilen durch ' + F(a) + ' hast du die Normalform. ' : 'Alle Glieder sind da, vor ' + m(X + '²') + ' steht 1. ') +
        'Zwei ganze Zahlen passen: Produkt ' + F(q) + ', Summe ' + F(p) + '. Damit bist du in drei Zeilen fertig.', stepsVieta(a, b, c, u, v));
      res.alts.push(METH.erg.name + ' – klappt immer, braucht aber mehr Zeilen.');
      return res;
    }
    check('no', 'Ganzzahliges Zahlenpaar?', intPQ
      ? 'Nein – kein Zahlenpaar hat Produkt ' + F(q) + ' und Summe ' + F(p) + '.'
      : 'Nein – ' + (a !== 1 ? 'auch nach dem Teilen durch ' + F(a) + ' sind ' : '') + m('p') + ' und ' + m('q') + ' keine ganzen Zahlen.');

    // 5. Ergänzung
    var why;
    if (D < 0) why = 'Kein Muster passt. Die quadratische Ergänzung zeigt: Rechts entsteht eine <b>negative</b> Zahl – also gibt es keine Lösung.';
    else if (roots.rational) why = 'Die Lösungen sind keine ganzen Zahlen – deshalb findest du kein Zahlenpaar. Die quadratische Ergänzung klappt trotzdem.';
    else why = 'Die Lösungen sind Wurzelzahlen – kein Zahlenpaar kann passen. Die quadratische Ergänzung klappt immer.';
    check('yes', 'Nichts passt?', 'Dann quadratische Ergänzung.');
    rec('erg', why, stepsErg(a, b, c));
    if (D >= 0) res.alts.push(roots.vals.every(function (v) { return isInt(2 * v); })
      ? 'Grafisch: Die Lösungen sind ganz- oder halbzahlig – Ablesen würde hier auch klappen (mit Probe).'
      : 'Grafisch kannst du die Lösungen hier nur ungefähr ablesen – gut zur Kontrolle.');
    return res;
  }

  /* ---------- Plot-Bereich automatisch ---------- */
  function autoPlot(a, b, c) {
    var f = function (x) { return a * x * x + b * x + c; };
    var xv = -b / (2 * a), yv = f(xv);
    var roots = exactRoots(a, b, c).vals;
    var pts = [xv].concat(roots);
    var lo = Math.min.apply(null, pts) - 2, hi = Math.max.apply(null, pts) + 2;
    if (hi - lo < 8) { var mid = (hi + lo) / 2; lo = mid - 4; hi = mid + 4; }
    lo = Math.floor(lo); hi = Math.ceil(hi);
    if (hi - lo > 30) return null;
    var ymin, ymax, span = (hi - lo) * 1.4;
    if (a > 0) {
      ymin = Math.floor(Math.min(yv, 0)) - 1;
      ymax = Math.ceil(Math.max(2, Math.min(Math.max(f(lo), f(hi)), Math.max(yv, 0) + span)));
      if (ymax < Math.max(yv, 0) + 2) ymax = Math.ceil(Math.max(yv, 0) + 2);
    } else {
      ymax = Math.ceil(Math.max(yv, 0)) + 1;
      ymin = Math.floor(Math.min(-2, Math.max(Math.min(f(lo), f(hi)), Math.min(yv, 0) - span)));
      if (ymin > Math.min(yv, 0) - 2) ymin = Math.floor(Math.min(yv, 0) - 2);
    }
    if (ymax - ymin > 400) return null;
    var xr = hi - lo, yr = ymax - ymin;
    return {
      xmin: lo, xmax: hi, ymin: ymin, ymax: ymax,
      yscale: Math.min(1, (xr * 0.85) / yr),
      fns: [{ f: f, color: 'pink' }],
      points: roots.map(function (r) { return { x: r, y: 0, color: 'pink' }; }).concat([{ x: xv, y: yv, color: 'slate', r: 4 }]),
      label: 'Parabel y = ' + polyH(a, b, c).replace(/<[^>]+>/g, '')
    };
  }

  function grafNote(a, b, c) {
    var roots = exactRoots(a, b, c);
    var n = roots.vals.length;
    var xv = -b / (2 * a), yv = a * xv * xv + b * xv + c;
    var s = 'Scheitelpunkt ' + m('S(' + F(xv) + ' | ' + F(yv) + ')') + '. ';
    if (n === 0) s += 'Die Parabel liegt komplett ' + (a > 0 ? 'über' : 'unter') + ' der ' + m(X) + '-Achse ⇒ <b>keine Lösung</b>.';
    else if (n === 1) s += 'Die Parabel berührt die ' + m(X) + '-Achse genau einmal ⇒ <b>eine Lösung</b>.';
    else {
      s += 'Die Parabel schneidet die ' + m(X) + '-Achse zweimal ⇒ <b>zwei Lösungen</b>. ';
      var half = roots.vals.every(function (v) { return isInt(v * 2); });
      s += half ? 'Die Lösungen sind ganz- oder halbzahlig – Ablesen würde hier klappen (mit Probe!).'
        : 'Ablesen geht nur ungefähr: ' + m(X + ' ≈ ' + QG.fmt(roots.vals[0]) + '</span> und <span class="m">' + X + ' ≈ ' + QG.fmt(roots.vals[1])) + '.';
    }
    return s;
  }

  /* =====================================================================
     Widget: Wegweiser
     ===================================================================== */
  var EXAMPLES = ['x² − 5x = 0', 'x² − 49 = 0', 'x² + 6x + 9 = 0', 'x² + 7x + 12 = 0', 'x² + 4x − 3 = 0',
    '2x² − 4x − 30 = 0', 'x² + 3x = 10', '(x − 2)² = 16', 'x(x − 3) = 10', 'x² + 4x + 7 = 0'];

  var ASK = {
    graf:   { t: 'q', q: 'Ist ein <b>Graph gegeben</b> – oder sollst du nur sagen, <b>wie viele</b> Lösungen es gibt?', yes: 'R:graf', no: 'null0' },
    null0:  { t: 'q', q: 'Steht auf einer Seite schon eine <b>0</b>?', ex: 'Ja bei ' + m('x² − 5x = 0') + ', nein bei ' + m('x² + 3x = 10') + '.', yes: 'prod', no: 'square' },
    square: { t: 'q', q: 'Steht auf einer Seite nur ein <b>Quadrat</b> wie ' + m('(x − 2)²') + ' und auf der anderen <b>nur eine Zahl</b>?', ex: 'Beispiel: ' + m('(x − 2)² = 16'), yes: 'R:sq', no: 'move' },
    move:   { t: 'i', q: 'Erst umformen', text: 'Bring alles auf eine Seite, sodass rechts <b>0</b> steht: Klammern ausmultiplizieren, zusammenfassen, dann z. B. ' + m('| − 10') + '.<br>Achtung: Auch ein Produkt wie ' + m('x(x − 3) = 10') + ' musst du dafür ausmultiplizieren – der Satz vom Nullprodukt gilt nur bei 0!', ex: m('x² + 3x = 10') + ' → ' + m('x² + 3x − 10 = 0'), next: 'c', btn: 'Erledigt – rechts steht 0' },
    prod:   { t: 'q', q: 'Steht auf der anderen Seite schon ein <b>Produkt</b>?', ex: 'Beispiel: ' + m('(x − 2)(x + 5) = 0') + ' oder ' + m('x(x − 4) = 0'), yes: 'R:nullp', no: 'c' },
    c:      { t: 'q', q: 'Fehlt die <b>Zahl ohne ' + X + '</b>?', ex: 'Beispiel: ' + m('x² − 5x = 0') + ' – hier gibt es kein ' + m('c') + '.', yes: 'R:aus', no: 'b' },
    b:      { t: 'q', q: 'Fehlt das <b>Glied mit ' + X + '</b>?', ex: 'Beispiel: ' + m('x² − 49 = 0') + ' – hier gibt es kein ' + m('bx') + '.', yes: 'R:wurzel', no: 'binom' },
    binom:  { t: 'q', q: 'Erkennst du eine <b>binomische Formel</b>?', ex: 'Die Zahl ist eine Quadratzahl und das Mittelglied genau „2 · … · ' + X + '“: ' + m('x² + 6x + 9 = (x + 3)²') + '.', yes: 'R:binom', no: 'a' },
    a:      { t: 'q', q: 'Steht vor ' + m('x²') + ' eine andere Zahl als 1?', ex: 'Beispiel: ' + m('2x² − 4x − 30 = 0'), yes: 'div', no: 'vieta' },
    div:    { t: 'i', q: 'Erst durch ' + m('a') + ' teilen', text: 'Teile die <b>ganze</b> Gleichung durch die Zahl vor ' + m('x²') + '. Dann hast du die Normalform ' + m('x² + px + q = 0') + '.', ex: m('2x² − 4x − 30 = 0') + ' → ' + m('x² − 2x − 15 = 0'), next: 'vieta', btn: 'Erledigt – weiter' },
    vieta:  { t: 'q', q: 'Findest du zwei <b>ganze Zahlen</b> mit Produkt ' + m('q') + ' und Summe ' + m('p') + '?', ex: 'Beispiel ' + m('x² + 7x + 12 = 0') + ': ' + m('3 · 4 = 12') + ' und ' + m('3 + 4 = 7') + '. Gib dir höchstens eine halbe Minute.', yes: 'R:vieta', no: 'R:erg' }
  };
  var ASK_RES = {
    graf: { why: 'Du sollst nur einen Überblick geben oder der Graph ist schon da. Dann reicht Ablesen: Wie oft schneidet die Parabel die ' + m(X) + '-Achse?',
      how: ['Parabel zeichnen (Wertetabelle oder Scheitelpunkt).', 'Schnittpunkte mit der ' + m(X) + '-Achse ablesen.', 'Probe machen – Ablesen ist ungenau!'],
      ex: 'Schneidet die Parabel die Achse zweimal, gibt es 2 Lösungen; berührt sie sie, 1; sonst keine.' },
    sq: { why: 'Das Quadrat steht schon allein – direkt Wurzel ziehen, nicht ausmultiplizieren!',
      how: ['Wurzel ziehen, dabei ± schreiben.', 'Beide Gleichungen nach ' + m(X) + ' auflösen.', 'Ist die Zahl negativ: keine Lösung.'],
      ex: calc([eqR('(' + lin(-2) + ')²', '16', '√ (±!)'), orLine(nw(lin(-2) + ' = 4') + '&ensp;oder&ensp;' + nw(lin(-2) + ' = −4'), '+ 2'), orRow('6', '−2'), R('L', '= {−2; 6}', null, 'result sep')]) },
    nullp: { why: 'Produkt = 0: Setz einfach jeden Faktor gleich 0.',
      how: ['Jeden Faktor gleich 0 setzen.', 'Jede Mini-Gleichung lösen.'],
      ex: calc([eqR('(' + lin(-2) + ') · (' + lin(5) + ')', '0', 'Satz vom Nullprodukt'), orRow('2', '−5'), R('L', '= {−5; 2}', null, 'result sep')]) },
    aus: { why: 'In jedem Glied steckt ein ' + m(X) + '. Klammere es aus – eine Lösung ist immer 0.',
      how: [m(X) + ' (oder z. B. ' + m('3x') + ') ausklammern.', 'Satz vom Nullprodukt.', '<b>Nie</b> durch ' + m(X) + ' teilen!'],
      ex: stepsAus(1, -5) },
    wurzel: { why: 'Kein Glied mit ' + m(X) + ': Umstellen, Wurzel ziehen, ± nicht vergessen.',
      how: ['Zahl auf die andere Seite bringen.', 'Durch die Zahl vor ' + m('x²') + ' teilen.', 'Wurzel ziehen: ' + m('±') + '! Negativ ⇒ keine Lösung.'],
      ex: stepsWurzel(1, -49, null) },
    binom: { why: 'Eine binomische Formel rückwärts – das geht in einer Zeile.',
      how: ['Als ' + m('(x ± d)² = 0') + ' schreiben.', 'Es gibt genau eine Lösung.'],
      ex: stepsBinom(1, 6, 9) },
    vieta: { why: 'Zwei ganze Zahlen mit Produkt ' + m('q') + ' und Summe ' + m('p') + ' – der schnellste Weg.',
      how: ['Zahlenpaar ' + m('u') + ', ' + m('v') + ' suchen: ' + m('u · v = q') + ', ' + m('u + v = p') + '.', m('(x + u)(x + v) = 0') + ' schreiben.', 'Lösungen: ' + m('−u') + ' und ' + m('−v') + ' – Vorzeichen umdrehen!'],
      ex: stepsVieta(1, 7, 12, 3, 4) },
    erg: { why: 'Kein Muster passt – die quadratische Ergänzung klappt immer.',
      how: ['Zahl ' + m('q') + ' nach rechts.', m('(<span class="frac"><span>p</span><span>2</span></span>)²') + ' auf <b>beiden</b> Seiten ergänzen.', 'Binomische Formel, Wurzel ziehen (±).'],
      ex: stepsErg(1, 4, -3) }
  };

  function recCard(key, why, stepsHtml, alts, open) {
    var M = METH[key];
    var html = '<div class="mw-rec" data-m="' + M.color + '">' +
      '<p class="mw-rec-kicker">Empfehlung</p>' +
      '<p class="mw-rec-name"><span class="mw-rec-ico" aria-hidden="true">' + QG.esc(M.ico) + '</span>' + M.name + '</p>' +
      '<p class="mw-rec-why">' + why + '</p>';
    if (stepsHtml) html += '<details class="more mw-rec-sol"' + (open ? ' open' : '') + '><summary>Lösungsweg zeigen</summary>' + stepsHtml + '</details>';
    if (alts && alts.length) html += '<p class="mw-rec-alt"><b>Auch möglich:</b> ' + alts.join(' ') + '</p>';
    if (M.href) html += '<a class="btn mw-rec-link" href="' + safeHref(M.href) + '">Mehr dazu: ' + M.link + ' →</a>';
    return html + '</div>';
  }

  QG.widget('mw-wegweiser', function (el) {
    var uid = 'mw' + Math.random().toString(36).slice(2, 7);
    el.innerHTML =
      '<div class="mw-seg" role="tablist" aria-label="Art der Hilfe">' +
        '<button type="button" role="tab" class="mw-seg-btn" aria-selected="true" aria-controls="' + uid + '-eq" id="' + uid + '-t1">✏️ Gleichung eingeben</button>' +
        '<button type="button" role="tab" class="mw-seg-btn" aria-selected="false" aria-controls="' + uid + '-ask" id="' + uid + '-t2" tabindex="-1">💬 Fragen beantworten</button>' +
      '</div>' +
      '<div class="mw-pane" role="tabpanel" id="' + uid + '-eq" aria-labelledby="' + uid + '-t1">' +
        '<label class="mw-label" for="' + uid + '-in">Deine Gleichung</label>' +
        '<div class="ans-row mw-in-row">' +
          '<div class="ans-field"><input class="ans" id="' + uid + '-in" type="text" inputmode="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="z. B. x² + 3x = 10"></div>' +
          '<button type="button" class="btn primary check mw-go">Weg finden</button>' +
        '</div>' +
        '<div class="kb mw-kb" role="group" aria-label="Zeichen einfügen"></div>' +
        '<p class="mw-ex-label">Oder probier ein Beispiel:</p>' +
        '<div class="mw-chips"></div>' +
        '<div class="mw-out" aria-live="polite"></div>' +
      '</div>' +
      '<div class="mw-pane" role="tabpanel" id="' + uid + '-ask" aria-labelledby="' + uid + '-t2" hidden>' +
        '<div class="mw-ask"></div>' +
      '</div>';

    var tabs = el.querySelectorAll('.mw-seg-btn');
    var panes = el.querySelectorAll('.mw-pane');
    function selectTab(i, focus) {
      Array.prototype.forEach.call(tabs, function (t, j) {
        t.setAttribute('aria-selected', i === j ? 'true' : 'false');
        t.tabIndex = i === j ? 0 : -1;
        panes[j].hidden = i !== j;
      });
      if (focus) tabs[i].focus();
    }
    Array.prototype.forEach.call(tabs, function (t, i) {
      t.addEventListener('click', function () { selectTab(i); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); selectTab((i + 1) % 2, true); }
      });
    });

    /* ---- Modus 1: Gleichung ---- */
    var input = el.querySelector('.ans');
    var out = el.querySelector('.mw-out');
    var kb = el.querySelector('.mw-kb');
    ['x²', 'x', '=', '+', '−', '(', ')', '²'].forEach(function (k) {
      var b = QG.h('button', { type: 'button', tabindex: '-1', 'aria-label': k + ' einfügen' }, QG.esc(k));
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () {
        var s = input.selectionStart, en = input.selectionEnd;
        if (s == null || document.activeElement !== input) { s = en = input.value.length; }
        var ins = (k === '=' || k === '+' || k === '−') ? ' ' + k + ' ' : k;
        input.setRangeText ? input.setRangeText(ins, s, en, 'end') : (input.value = input.value.slice(0, s) + ins + input.value.slice(en));
        input.focus({ preventScroll: true });
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      kb.appendChild(b);
    });
    var chips = el.querySelector('.mw-chips');
    EXAMPLES.forEach(function (ex) {
      var b = QG.h('button', { type: 'button', class: 'mw-chip' }, '<span class="m">' + QG.esc(ex) + '</span>');
      b.addEventListener('click', function () { input.value = ex; run(true); });
      chips.appendChild(b);
    });
    QG.math(chips);

    var hasRun = false, timer = null;
    function run(scroll) {
      var str = input.value;
      var eq;
      try { eq = parseEquation(str); }
      catch (e) {
        out.innerHTML = '<div class="mw-err"><b>Hm.</b> ' + (e.qg ? e.message : 'Das kann ich nicht lesen.') +
          '<br><span class="small">Schreib z. B. <span class="kbd">x^2 + 3x = 10</span> oder <span class="kbd">(x − 2)² = 16</span>.</span></div>';
        return;
      }
      hasRun = true;
      var r = analyze(eq);
      var html = '<p class="mw-read"><span class="mw-read-k">Ich lese:</span> <span class="m">' + prettyInput(eq.toks) + (eq.hasEq ? '' : ' = 0') + '</span></p>';
      if (!eq.hasEq) html += '<p class="small muted">Kein „=“ gefunden – ich lese das als „… = 0“.</p>';
      if (r.special) { out.innerHTML = html + '<div class="mw-err">' + r.special + '</div>'; QG.math(out); return; }
      if (r.a !== 0 && !r.pureSq && (!r.rZero || r.swapped || /[()]/.test(str)) && r.rec && r.rec.key !== 'sq' && r.rec.key !== 'nullp') {
        html += '<p class="mw-read"><span class="mw-read-k">Umgeformt:</span> <span class="m">' + polyH(r.a, r.b, r.c) + ' = 0</span></p>';
      }
      if (r.checks.length) {
        html += '<ol class="mw-path" aria-label="Der 5-Sekunden-Check">' + r.checks.map(function (c) {
          var ico = c.state === 'yes' ? '✓' : c.state === 'no' ? '✗' : '!';
          var lab = c.state === 'yes' ? 'Ja' : c.state === 'no' ? 'Nein' : 'Achtung';
          return '<li class="is-' + c.state + '"><span class="mw-path-ico" aria-label="' + lab + '">' + ico + '</span><span><b>' + c.q + '</b> ' + c.a + '</span></li>';
        }).join('') + '</ol>';
      }
      html += recCard(r.rec.key, r.rec.why, r.rec.steps, r.alts, false);
      if (r.a !== 0) {
        html += '<div class="mw-graf" data-m="blue"><p class="mw-graf-title"><span aria-hidden="true">📈</span> Blick auf die Parabel ' +
          '<span class="m">y = ' + polyH(r.a, r.b, r.c) + '</span></p><div class="qg-plot-wrap mw-graf-plot"></div>' +
          '<p class="small mw-graf-note">' + grafNote(r.a, r.b, r.c) + '</p></div>';
      }
      out.innerHTML = html;
      QG.math(out);
      var host = out.querySelector('.mw-graf-plot');
      if (host) {
        var opts = autoPlot(r.a, r.b, r.c);
        if (opts) QG.plot(host, opts);
        else host.outerHTML = '<p class="small muted">Für eine Zeichnung sind die Zahlen hier zu groß.</p>';
      }
      if (scroll) {
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var top = out.getBoundingClientRect().top;
        if (top > window.innerHeight * 0.6) out.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
      }
    }
    el.querySelector('.mw-go').addEventListener('click', function () { run(true); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); run(true); } });
    input.addEventListener('input', function () {
      if (!hasRun) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        try { parseEquation(input.value); } catch (e) { return; } // während des Tippens keine Fehlermeldung
        run(false);
      }, 350);
    });

    /* ---- Modus 2: Fragen ---- */
    var ask = el.querySelector('.mw-ask');
    var hist = [];          // [{node, ans}]
    var cur = 'graf';
    function qNum() { return hist.filter(function (h) { return ASK[h.node].t === 'q'; }).length + 1; }
    function shortQ(node) {
      var map = { graf: 'Graph/Anzahl?', null0: 'Eine Seite 0?', square: 'Quadrat = Zahl?', move: 'Umgeformt', prod: 'Schon ein Produkt?', c: 'c fehlt?', b: 'b fehlt?', binom: 'Binomisch?', a: 'Zahl vor x²?', div: 'Durch a geteilt', vieta: 'Zahlenpaar?' };
      return map[node] || node;
    }
    function renderAsk() {
      var trail = hist.length ? '<ol class="mw-trail">' + hist.map(function (h) {
        return '<li class="' + (h.ans === 'Ja' ? 'is-yes' : h.ans === 'Nein' ? 'is-no' : 'is-info') + '">' + shortQ(h.node) + ' <b>' + h.ans + '</b></li>';
      }).join('') + '</ol>' : '';
      var body;
      if (cur.indexOf('R:') === 0) {
        var key = cur.slice(2), RS = ASK_RES[key];
        body = recCard(key, RS.why, null, null, false) +
          '<div class="mw-recipe"><p class="mw-recipe-title">So gehst du vor</p><ol>' + RS.how.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>' +
          '<p class="mw-recipe-title">Beispiel</p>' + (RS.ex.indexOf('<div') === 0 ? RS.ex : '<p>' + RS.ex + '</p>') + '</div>';
        body = body.replace('<div class="mw-rec"', '<div class="mw-rec mw-rec-ask"');
      } else {
        var N = ASK[cur];
        if (N.t === 'q') {
          body = '<div class="mw-qcard"><p class="mw-qnum">Frage ' + qNum() + '</p><p class="mw-q">' + N.q + '</p>' +
            (N.ex ? '<p class="mw-qex">' + N.ex + '</p>' : '') +
            '<div class="mw-yn"><button type="button" class="btn primary" data-a="yes">Ja</button><button type="button" class="btn" data-a="no">Nein</button></div></div>';
        } else {
          body = '<div class="mw-qcard mw-qinfo"><p class="mw-qnum">Zwischenschritt</p><p class="mw-q">' + N.q + '</p><p>' + N.text + '</p>' +
            (N.ex ? '<p class="mw-qex">' + N.ex + '</p>' : '') +
            '<div class="mw-yn"><button type="button" class="btn primary" data-a="next">' + N.btn + ' →</button></div></div>';
        }
      }
      var ctrl = '<div class="btn-row mw-ask-ctrl">' +
        (hist.length ? '<button type="button" class="btn ghost" data-a="back">← Zurück</button>' : '') +
        (hist.length ? '<button type="button" class="btn ghost" data-a="reset">↺ Von vorn</button>' : '') + '</div>';
      ask.innerHTML = trail + body + ctrl;
      QG.math(ask);
    }
    ask.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-a]');
      if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'back') { var h = hist.pop(); if (h) cur = h.node; }
      else if (a === 'reset') { hist = []; cur = 'graf'; }
      else {
        var N = ASK[cur];
        if (!N) return;
        if (a === 'next') { hist.push({ node: cur, ans: '✓' }); cur = N.next; }
        else { hist.push({ node: cur, ans: a === 'yes' ? 'Ja' : 'Nein' }); cur = a === 'yes' ? N.yes : N.no; }
      }
      renderAsk();
      var first = ask.querySelector('.mw-qcard .btn, .mw-rec');
      if (first && first.focus) { if (first.tagName !== 'BUTTON') first.setAttribute('tabindex', '-1'); first.focus({ preventScroll: true }); }
      var top = ask.getBoundingClientRect().top;
      if (top < 60) window.scrollBy({ top: top - 80 });
    });
    renderAsk();
  });

  /* =====================================================================
     Widget: Tabs („Eine Gleichung – drei Wege“)
     ===================================================================== */
  QG.widget('mw-tabs', function (el) {
    var tabs = Array.prototype.slice.call(el.querySelectorAll('[role="tab"]'));
    function panel(t) { return document.getElementById(t.getAttribute('aria-controls')); }
    function select(i, focus) {
      tabs.forEach(function (t, j) {
        var on = i === j;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        var p = panel(t);
        if (p) p.classList.toggle('is-on', on);
      });
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(i); });
      t.addEventListener('keydown', function (e) {
        var k = e.key, n = tabs.length;
        if (k === 'ArrowRight') { e.preventDefault(); select((i + 1) % n, true); }
        else if (k === 'ArrowLeft') { e.preventDefault(); select((i - 1 + n) % n, true); }
        else if (k === 'Home') { e.preventDefault(); select(0, true); }
        else if (k === 'End') { e.preventDefault(); select(n - 1, true); }
      });
    });
    el.classList.add('is-ready');
    select(0);
  });

  /* =====================================================================
     Widget: feste Plots
     ===================================================================== */
  var PLOTS = {
    dreiwege: function () {
      return {
        xmin: -4, xmax: 6, ymin: -10, ymax: 4, yscale: 0.55, ystep: 2,
        fns: [{ f: function (x) { return x * x - 2 * x - 8; }, color: 'blue' }],
        points: [
          { x: -2, y: 0, label: 'N₁', color: 'blue', pos: 'nw' },
          { x: 4, y: 0, label: 'N₂', color: 'blue', pos: 'ne' },
          { x: 1, y: -9, label: 'S(1 | −9)', color: 'slate', pos: 'e', r: 4.5 }
        ],
        label: 'Parabel y = x² − 2x − 8 mit Nullstellen bei −2 und 4'
      };
    },
    'det-paul': function () {
      return {
        xmin: -5, xmax: 3, ymin: -2, ymax: 6, yscale: 0.75,
        fns: [{ f: function (x) { return x * x + 2 * x; }, color: 'blue' }],
        points: [{ x: -2, y: 0, color: 'red' }, { x: 0, y: 0, color: 'red' }],
        label: 'Parabel y = x² + 2x, rot markiert die Nullstellen −2 und 0'
      };
    },
    'det-paul-ok': function () {
      return {
        xmin: -5, xmax: 3, ymin: -2, ymax: 6, yscale: 0.75,
        fns: [{ f: function (x) { return x * x + 2 * x; }, color: 'blue' }],
        lines: [{ y: 3, color: 'orange', dash: true, width: 2.5 }],
        points: [{ x: -3, y: 3, color: 'green' }, { x: 1, y: 3, color: 'green' }],
        texts: [{ x: 2.2, y: 3.6, text: 'y = 3', color: 'orange', pos: 'c' }],
        label: 'Parabel y = x² + 2x und Gerade y = 3, Schnittpunkte bei −3 und 1'
      };
    }
  };
  QG.widget('mw-plot', function (el) {
    var fn = PLOTS[el.getAttribute('data-plot')];
    if (fn) QG.plot(el, fn());
  });

  /* =====================================================================
     Widget: Sortier-Spiel
     ===================================================================== */
  var OPTS = [
    { k: 'aus', label: 'x ausklammern', ico: 'x(…)' },
    { k: 'wurzel', label: 'Wurzel ziehen', ico: '√' },
    { k: 'binom', label: 'Binomische Formel', ico: '(…)²' },
    { k: 'vieta', label: 'Produkt-Summen-Trick', ico: 'u·v' },
    { k: 'erg', label: 'Quadratische Ergänzung', ico: '+□' }
  ];
  var OPT_NAME = {};
  OPTS.forEach(function (o) { OPT_NAME[o.k] = o.label; });

  var POOL = [
    { eq: 'x² − 5x = 0', ok: ['aus'], why: 'Es gibt keine Zahl ohne ' + m('x') + ' – ' + m('c') + ' fehlt. Also ' + m('x') + ' ausklammern:', sol: 'x · (x − 5) = 0 ⇒ L = {0; 5}' },
    { eq: 'x² − 49 = 0', ok: ['wurzel', 'binom'], why: 'Kein Glied mit ' + m('x') + ' – ' + m('b') + ' fehlt. Umstellen und Wurzel ziehen (oder 3. binomische Formel):', sol: 'x² = 49 ⇒ x = ±7 ⇒ L = {−7; 7}' },
    { eq: 'x² + 6x + 9 = 0', ok: ['binom', 'vieta'], why: m('9 = 3²') + ' und ' + m('6x = 2 · 3 · x') + ' – das ist die 1. binomische Formel (das Zahlenpaar 3 und 3 geht genauso):', sol: '(x + 3)² = 0 ⇒ L = {−3}' },
    { eq: 'x² + 7x + 12 = 0', ok: ['vieta'], why: m('3 · 4 = 12') + ' und ' + m('3 + 4 = 7') + ' – ein ganzzahliges Zahlenpaar passt:', sol: '(x + 3) · (x + 4) = 0 ⇒ L = {−4; −3}' },
    { eq: 'x² + 4x − 3 = 0', ok: ['erg'], why: 'Für ' + m('−3') + ' gibt es nur ' + m('1 · (−3)') + ' und ' + m('(−1) · 3') + ' – die Summe ist nie 4. Kein Muster, also quadratische Ergänzung:', sol: '(x + 2)² = 7 ⇒ L = {−2 − √7; −2 + √7}' },
    { eq: '3x² = 27', ok: ['wurzel', 'binom'], why: 'Kein Glied mit ' + m('x') + '. Durch 3 teilen, dann Wurzel ziehen:', sol: 'x² = 9 ⇒ x = ±3 ⇒ L = {−3; 3}' },
    { eq: '2x² + 8x = 0', ok: ['aus'], why: 'Keine Zahl ohne ' + m('x') + '. Klammere ' + m('2x') + ' aus:', sol: '2x · (x + 4) = 0 ⇒ L = {−4; 0}' },
    { eq: 'x² − 10x + 25 = 0', ok: ['binom', 'vieta'], why: m('25 = 5²') + ' und ' + m('10x = 2 · 5 · x') + ' – die 2. binomische Formel:', sol: '(x − 5)² = 0 ⇒ L = {5}' },
    { eq: 'x² − x − 6 = 0', ok: ['vieta'], why: m('(−3) · 2 = −6') + ' und ' + m('(−3) + 2 = −1') + ' – das Zahlenpaar passt:', sol: '(x − 3) · (x + 2) = 0 ⇒ L = {−2; 3}' },
    { eq: 'x² + 2x − 1 = 0', ok: ['erg'], why: 'Für ' + m('−1') + ' gibt es nur ' + m('1 · (−1)') + ' – Summe 0, nicht 2. Also quadratische Ergänzung:', sol: '(x + 1)² = 2 ⇒ L = {−1 − √2; −1 + √2}' },
    { eq: '(x − 2)² = 16', ok: ['wurzel'], why: 'Das Quadrat steht schon allein, rechts nur eine Zahl. Direkt Wurzel ziehen – nicht ausmultiplizieren!', sol: 'x − 2 = ±4 ⇒ L = {−2; 6}',
      wrong: { vieta: 'Dafür müsstest du erst ausmultiplizieren und umformen – ein Umweg. Das Quadrat steht doch schon allein!', erg: 'Das Quadrat ist schon fertig ergänzt! Du kannst sofort die Wurzel ziehen.', binom: 'Die binomische Formel steht schon da – jetzt fehlt nur noch das Wurzelziehen.' } },
    { eq: 'x² + 5 = 0', ok: ['wurzel'], why: 'Kein Glied mit ' + m('x') + '. Umstellen zeigt sofort:', sol: 'x² = −5 – kein Quadrat ist negativ ⇒ L = { }',
      wrong: { vieta: 'Für 5 gibt es kein Zahlenpaar mit Summe 0 – und das Glied mit ' + m('x') + ' fehlt ja ohnehin.', binom: m('x² + 5') + ' lässt sich mit keiner binomischen Formel zerlegen – es fehlt das Glied mit ' + m('x') + '.' } },
    { eq: 'x² − 6x + 4 = 0', ok: ['erg'], why: 'Für 4 klappt kein Zahlenpaar mit Summe ' + m('−6') + ', und ' + m('4 = 2²') + ' passt nicht zu ' + m('6x = 2 · 3 · x') + '. Also Ergänzung:', sol: '(x − 3)² = 5 ⇒ L = {3 − √5; 3 + √5}' },
    { eq: 'x² + 3x = 10', ok: ['vieta'], why: 'Achtung, rechts steht nicht 0! Erst umformen: ' + m('x² + 3x − 10 = 0') + '. Dann passt ' + m('5 · (−2) = −10') + ' und ' + m('5 + (−2) = 3') + ':', sol: '(x + 5) · (x − 2) = 0 ⇒ L = {−5; 2}',
      wrong: { aus: 'Ausklammern hilft hier nicht: Rechts steht 10, nicht 0. Mit ' + m('x · (x + 3) = 10') + ' kommst du nicht weiter.' } },
    { eq: 'x² = 7x', ok: ['aus'], why: 'Nicht durch ' + m('x') + ' teilen! Alles nach links: ' + m('x² − 7x = 0') + '. Keine Zahl ohne ' + m('x') + ', also ausklammern:', sol: 'x · (x − 7) = 0 ⇒ L = {0; 7}',
      wrong: { wurzel: 'Rechts steht ' + m('7x') + ' – das ist keine Zahl. Bring alles nach links, dann siehst du: Es fehlt die Zahl ohne ' + m('x') + '.' } },
    { eq: '4x² − 25 = 0', ok: ['wurzel', 'binom'], why: 'Kein Glied mit ' + m('x') + '. Umstellen und Wurzel ziehen (oder 3. binomische Formel ' + m('(2x + 5)(2x − 5)') + '):', sol: 'x² = 6,25 ⇒ x = ±2,5 ⇒ L = {−2,5; 2,5}',
      wrong: { vieta: 'Nach dem Teilen durch 4 steht da ' + m('x² − 6,25 = 0') + ' – dafür gibt es kein ganzzahliges Zahlenpaar. Das Glied mit ' + m('x') + ' fehlt ja ohnehin.' } },
    { eq: 'x² + 8x + 7 = 0', ok: ['vieta'], why: m('1 · 7 = 7') + ' und ' + m('1 + 7 = 8') + ' – das Zahlenpaar springt ins Auge:', sol: '(x + 1) · (x + 7) = 0 ⇒ L = {−7; −1}' },
    { eq: 'x² − 3x + 5 = 0', ok: ['erg'], why: 'Für 5 gibt es nur ' + m('1 · 5') + ' und ' + m('(−1) · (−5)') + ' – Summe ±6, nie ' + m('−3') + '. Die Ergänzung zeigt:', sol: '(x − 1,5)² = −2,75 – kein Quadrat ist negativ ⇒ L = { }' }
  ];

  function wrongReason(pick, item) {
    if (item.wrong && item.wrong[pick]) return item.wrong[pick];
    var main = item.ok[0];
    switch (pick) {
      case 'aus': return 'Ausklammern klappt nur, wenn in <b>jedem</b> Glied ein ' + m('x') + ' steckt – hier gibt es eine Zahl ohne ' + m('x') + '.';
      case 'wurzel': return 'Direkt Wurzel ziehen geht nur, wenn es kein Glied mit ' + m('x') + ' gibt (oder ein Quadrat schon allein steht).';
      case 'binom': return main === 'aus' ? 'Hier passt keine binomische Formel – es fehlt ja sogar die Zahl ohne ' + m('x') + '.'
        : 'Hier passt keine binomische Formel: Dafür müsste die Zahl genau ' + m('(<span class="frac"><span>p</span><span>2</span></span>)²') + ' sein.';
      case 'vieta': return main === 'erg' ? 'Hier gibt es kein ganzzahliges Zahlenpaar – probier es ruhig aus.'
        : 'Der Produkt-Summen-Trick ginge zwar, ist hier aber ein Umweg.';
      case 'erg': return 'Die quadratische Ergänzung klappt zwar immer – hier gibt es aber einen deutlich schnelleren Weg.';
    }
    return '';
  }

  /** 12 Gleichungen: von jeder Hauptmethode mindestens 2, Rest zufällig, gemischt */
  function drawRound() {
    var by = {};
    POOL.forEach(function (it, i) { (by[it.ok[0]] = by[it.ok[0]] || []).push(i); });
    var chosen = [];
    Object.keys(by).forEach(function (k) { chosen = chosen.concat(QG.shuffle(by[k]).slice(0, 2)); });
    var rest = QG.shuffle(POOL.map(function (_, i) { return i; }).filter(function (i) { return chosen.indexOf(i) < 0; }));
    chosen = chosen.concat(rest.slice(0, Math.max(0, 12 - chosen.length)));
    return QG.shuffle(chosen).slice(0, 12).map(function (i) { return POOL[i]; });
  }

  function mt(s) { return '<span class="m">' + QG.esc(s) + '</span>'; }

  QG.widget('mw-sortierspiel', function (el) {
    var KEY = 'mw:sortier';
    var stats = QG.store.get(KEY, null) || { best: 0, rounds: 0 };
    var round = [], i = 0, score = 0, streak = 0, maxStreak = 0, answered = false, misses = [];

    function startScreen() {
      el.innerHTML =
        '<div class="mw-g-start">' +
          '<div class="mw-g-hero" aria-hidden="true"><span>x(…)</span><span>√</span><span>(…)²</span><span>u·v</span><span>+□</span></div>' +
          '<p class="mw-g-title">Bereit?</p>' +
          '<p>12 Gleichungen, 5 Wege. Tippe jeweils den <b>schnellsten</b> Weg an – ausrechnen musst du nichts.</p>' +
          (stats.rounds ? '<p class="mw-g-best">🏆 Dein Bestwert: <b>' + stats.best + ' von 12</b></p>' : '') +
          '<button type="button" class="btn primary mw-g-startbtn">Spiel starten</button>' +
        '</div>';
      el.querySelector('.mw-g-startbtn').addEventListener('click', function () { newRound(true); });
    }

    function newRound(focus) {
      round = drawRound(); i = 0; score = 0; streak = 0; maxStreak = 0; misses = [];
      renderQ(focus);
    }

    function renderQ(focus) {
      var it = round[i];
      answered = false;
      el.innerHTML =
        '<div class="mw-g-top">' +
          '<span class="mw-g-count">Gleichung <b>' + (i + 1) + '</b> von 12</span>' +
          '<span class="mw-g-score" title="Punkte">✓ ' + score + '</span>' +
          '<span class="mw-g-streak' + (streak >= 2 ? ' is-on' : '') + '" title="Serie">🔥 ' + streak + '</span>' +
        '</div>' +
        '<div class="mw-g-bar" aria-hidden="true"><span style="width:' + (100 * i / 12) + '%"></span></div>' +
        '<p class="mw-g-ask">Welcher Weg ist hier am schnellsten?</p>' +
        '<div class="mw-g-eq">' + mt(it.eq) + '</div>' +
        '<div class="mw-g-opts" role="group" aria-label="Weg wählen">' + OPTS.map(function (o, n) {
          return '<button type="button" class="mw-opt" data-k="' + o.k + '" data-m="' + (o.k === 'erg' ? 'orange' : 'green') + '">' +
            '<span class="mw-opt-ico" aria-hidden="true">' + QG.esc(o.ico) + '</span><span class="mw-opt-label">' + o.label + '</span>' +
            '<span class="mw-opt-key" aria-hidden="true">' + (n + 1) + '</span></button>';
        }).join('') + '</div>' +
        '<div class="mw-g-fb" aria-live="polite"></div>' +
        '<div class="mw-g-next" hidden><button type="button" class="btn primary">' + (i < 11 ? 'Nächste Gleichung →' : 'Zur Auswertung →') + '</button></div>';
      QG.math(el);
      Array.prototype.forEach.call(el.querySelectorAll('.mw-opt'), function (b) {
        b.addEventListener('click', function () { answer(b.getAttribute('data-k')); });
      });
      el.querySelector('.mw-g-next .btn').addEventListener('click', next);
      if (focus) { var f = el.querySelector('.mw-opt'); if (f) f.focus({ preventScroll: true }); }
    }

    function answer(k) {
      if (answered) return;
      answered = true;
      var it = round[i];
      var ok = it.ok.indexOf(k) >= 0;
      if (ok) { score++; streak++; maxStreak = Math.max(maxStreak, streak); } else { streak = 0; misses.push({ it: it, pick: k }); }
      Array.prototype.forEach.call(el.querySelectorAll('.mw-opt'), function (b) {
        var bk = b.getAttribute('data-k');
        b.disabled = true;
        if (it.ok.indexOf(bk) >= 0) b.classList.add('is-right');
        if (bk === k) b.classList.add(ok ? 'is-picked-ok' : 'is-picked-bad');
      });
      var others = it.ok.filter(function (x) { return x !== k; });
      var head;
      if (ok) head = '<b>' + (streak >= 3 ? 'Richtig – ' + streak + ' in Folge! 🔥' : 'Richtig!') + '</b>' +
        (others.length ? ' <span class="mw-g-also">Genauso gut: ' + others.map(function (x) { return OPT_NAME[x]; }).join(', ') + '.</span>' : '');
      else head = '<b>Nicht ganz.</b> ' + wrongReason(k, it) + ' <span class="mw-g-also">Am schnellsten: <b>' + it.ok.map(function (x) { return OPT_NAME[x]; }).join('</b> oder <b>') + '</b>.</span>';
      var fb = el.querySelector('.mw-g-fb');
      fb.innerHTML = '<div class="mw-g-fbbox ' + (ok ? 'ok' : 'bad') + '"><p>' + head + '</p><p class="mw-g-why">' + it.why + '</p><div class="mw-g-sol">' + mt(it.sol) + '</div></div>';
      QG.math(fb);
      el.querySelector('.mw-g-score').textContent = '✓ ' + score;
      var stk = el.querySelector('.mw-g-streak');
      stk.textContent = '🔥 ' + streak; stk.classList.toggle('is-on', streak >= 2);
      el.querySelector('.mw-g-bar > span').style.width = (100 * (i + 1) / 12) + '%';
      var nx = el.querySelector('.mw-g-next');
      nx.hidden = false;
      nx.querySelector('.btn').focus({ preventScroll: true });
      var r = nx.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 10) {
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        nx.scrollIntoView({ block: 'end', behavior: reduce ? 'auto' : 'smooth' });
      }
    }

    function next() {
      if (i < 11) { i++; renderQ(true); keepInView(); }
      else finish();
    }
    function keepInView() {
      var r = el.getBoundingClientRect();
      if (r.top < 60) window.scrollBy({ top: r.top - 80 });
    }

    function finish() {
      var newBest = score > stats.best;
      stats.best = Math.max(stats.best, score);
      stats.rounds = (stats.rounds || 0) + 1;
      QG.store.set(KEY, stats);
      var msg = score === 12 ? 'Perfekt! Du erkennst jede Gleichung auf einen Blick.'
        : score >= 10 ? 'Sehr stark – damit bist du für die HÜ gut gerüstet.'
        : score >= 7 ? 'Gut! Schau dir unten deine Fehler an und spiel noch eine Runde.'
        : 'Übung macht’s: Lies dir oben den 5-Sekunden-Check noch einmal durch und versuch es erneut.';
      el.innerHTML =
        '<div class="mw-g-end">' +
          '<p class="mw-g-big"><b>' + score + '</b><span> von 12</span></p>' +
          '<p class="mw-g-msg">' + msg + '</p>' +
          '<p class="mw-g-stats">' + (newBest && stats.rounds > 1 ? '<span class="pill green">🏆 Neuer Bestwert!</span> ' : '') +
            '<span class="pill">Bestwert ' + stats.best + '/12</span> <span class="pill">Längste Serie ' + maxStreak + '</span></p>' +
          (misses.length ? '<div class="mw-g-misses"><p class="mw-g-mtitle">Das schaust du dir nochmal an:</p><ul>' + misses.map(function (x) {
            return '<li><span class="m">' + QG.esc(x.it.eq) + '</span> → <b>' + x.it.ok.map(function (k) { return OPT_NAME[k]; }).join(' / ') + '</b>' +
              '<span class="mw-g-mwhy">' + x.it.why + ' ' + '<span class="m">' + QG.esc(x.it.sol) + '</span></span></li>';
          }).join('') + '</ul></div>' : '') +
          '<div class="btn-row"><button type="button" class="btn primary mw-g-again">↺ Neue Runde (neu gemischt)</button></div>' +
        '</div>';
      QG.math(el);
      el.querySelector('.mw-g-again').addEventListener('click', function () { newRound(true); keepInView(); });
      keepInView();
      if (score === 12 || (newBest && stats.rounds > 1)) QG.celebrate(el.querySelector('.mw-g-big'));
    }

    el.addEventListener('keydown', function (e) {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (!answered && /^[1-5]$/.test(e.key) && el.querySelector('.mw-g-opts')) { e.preventDefault(); answer(OPTS[+e.key - 1].k); }
    });

    startScreen();
  });

  /* =====================================================================
     Kleinkram: Lösung im Fehlerdetektiv nach dem Finden aufklappen,
     Anker absichern (falls ein Kapitel seine IDs ändert)
     ===================================================================== */
  QG.on('task', function (ev) {
    if (!ev || !ev.ok || !ev.el || !ev.el.classList.contains('mw-det')) return;
    var sol = ev.el.querySelector(':scope > details.solution');
    if (sol) sol.open = true;
  });
  QG.ready(function () {
    var sec = document.getElementById('methodenwahl');
    if (!sec) return;
    Array.prototype.forEach.call(sec.querySelectorAll('a[href^="#"]'), function (a) {
      var h = a.getAttribute('href');
      var fixed = safeHref(h);
      if (fixed !== h) a.setAttribute('href', fixed);
    });
  });

  // für Tests
  QG._mw = { parseEquation: parseEquation, analyze: analyze, exactRoots: exactRoots, sqrtHtml: sqrtHtml, POOL: POOL };
})();

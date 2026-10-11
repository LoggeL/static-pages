/* Kapitel 60 · Trainingsraum
   Teil 1: reine Generator-Funktionen (ohne DOM) – in Node testbar: node tests/training.test.mjs
   Teil 2: Widget „trainer“ (nur im Browser, nutzt window.QG) */
(function () {
  'use strict';

  /* =====================================================================
     Teil 1 · Reine Funktionen
     ===================================================================== */
  var MINUS = '−';
  var X = '<var>x</var>';
  var rnd = Math.random;

  function ri(a, b) { return Math.floor(rnd() * (b - a + 1)) + a; }
  function rnz(a, b) { var v; do { v = ri(a, b); } while (v === 0); return v; }
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function chance(p) { return rnd() < p; }

  /* ---------- Bruchrechnung (exakt) ---------- */
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = a % b; a = b; b = t; } return a || 1; }
  function lcm(a, b) { return Math.abs(a * b) / gcd(a, b); }
  function F(n, d) {
    if (n && typeof n === 'object') return n;
    if (d == null) d = 1;
    if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) throw new Error('Bruch ungültig: ' + n + '/' + d);
    if (d < 0) { n = -n; d = -d; }
    var g = gcd(n, d);
    n = n / g; d = d / g;
    if (n === 0) return { n: 0, d: 1 };
    return { n: n, d: d };
  }
  function neg(x) { x = F(x); return F(-x.n, x.d); }
  function add(x, y) { x = F(x); y = F(y); return F(x.n * y.d + y.n * x.d, x.d * y.d); }
  function sub(x, y) { return add(x, neg(y)); }
  function mul(x, y) { x = F(x); y = F(y); return F(x.n * y.n, x.d * y.d); }
  function div(x, y) { x = F(x); y = F(y); if (!y.n) throw new Error('Division durch 0'); return F(x.n * y.d, x.d * y.n); }
  function sq(x) { return mul(x, x); }
  function val(x) { x = F(x); return x.n / x.d; }
  function isZ(x) { return F(x).n === 0; }
  function isInt(x) { return F(x).d === 1; }
  function sgn(x) { x = F(x); return x.n > 0 ? 1 : x.n < 0 ? -1 : 0; }
  function abs(x) { x = F(x); return F(Math.abs(x.n), x.d); }
  function eqF(x, y) { x = F(x); y = F(y); return x.n === y.n && x.d === y.d; }
  function isOne(x) { return eqF(x, 1); }

  /* ---------- Formatierung (HTML; Variablen werden vom Core kursiv gesetzt) ---------- */
  function frac(n, d) { return '<span class="frac"><span>' + n + '</span><span>' + d + '</span></span>'; }
  function fh(x) { x = F(x); var a = Math.abs(x.n); return (x.n < 0 ? MINUS : '') + (x.d === 1 ? String(a) : frac(a, x.d)); }
  /** Dezimalschreibweise für Halbe (grafisches Ablesen), sonst Bruch */
  function fdec(x) {
    x = F(x);
    if (x.d !== 2) return fh(x);
    var a = Math.abs(x.n);
    return (x.n < 0 ? MINUS : '') + Math.floor(a / 2) + ',5';
  }
  function fp(x) { x = F(x); return x.d === 1 ? String(x.n) : x.n + '/' + x.d; }
  function par(x, f) { x = F(x); f = f || fh; return (x.n < 0 || x.d !== 1) ? '(' + f(x) + ')' : f(x); }
  function sqShow(x) { x = F(x); return (x.d === 1 && x.n >= 0) ? fh(x) + '²' : '(' + fh(x) + ')²'; }
  function fD(x, D) { x = F(x); var n = x.n * (D / x.d); return (n < 0 ? MINUS : '') + frac(Math.abs(n), D); }
  function M(s) { return '<span class="m">' + s + '</span>'; }
  function T(s) { return '<span class="t">' + s + '</span>'; }

  /** Term aus [[Koeffizient, Symbol], …]; Koeffizient 1 und Nullterme werden weggelassen. */
  function term(list) {
    var out = '';
    list.forEach(function (t) {
      var c = F(t[0]);
      if (isZ(c)) return;
      var a = abs(c);
      var body = t[1] ? (isOne(a) ? '' : fh(a)) + t[1] : fh(a);
      if (!out) out = (c.n < 0 ? MINUS : '') + body;
      else out += (c.n < 0 ? ' ' + MINUS + ' ' : ' + ') + body;
    });
    return out || '0';
  }
  /** Rechenoperation „− 7x + 4“ (mit Leerzeichen nach dem ersten Vorzeichen) */
  function opTerm(list) {
    var t = term(list);
    return t.charAt(0) === MINUS ? MINUS + ' ' + t.slice(1) : '+ ' + t;
  }
  function quad(a, b, c) { return term([[a, 'x²'], [b, 'x'], [c, '']]); }
  function lin(k, m) { return term([[k, 'x'], [m, '']]); }
  function divOp(a) { a = F(a); return isInt(a) ? '| : ' + par(a) : '| · ' + par(div(1, a)); }
  function binName(m) { return sgn(m) > 0 ? '1.' : '2.'; }
  function sumDisplay(x, y) {
    x = F(x); y = F(y);
    var s = fh(x) + ' + ' + fh(y);
    if (x.d !== y.d) { var D = lcm(x.d, y.d); s += ' = ' + fD(x, D) + ' + ' + fD(y, D); }
    return s + ' = ' + fh(add(x, y));
  }

  /* ---------- Wurzeln & Lösungen: Wurzel r + s·√t ---------- */
  function isqrt(n) { if (n < 0) return -1; var s = Math.round(Math.sqrt(n)); return s * s === n ? s : -1; }
  function sqrtF(x) {
    x = F(x);
    if (x.n < 0) return null;
    var a = isqrt(x.n), b = isqrt(x.d);
    if (a >= 0 && b >= 0) return { rat: F(a, b) };
    var m = x.n * x.d, k = 1, t = m;
    for (var f = 2; f * f <= t; f++) { while (t % (f * f) === 0) { t /= f * f; k *= f; } }
    return { s: F(k, x.d), t: t };
  }
  function Root(r, s, t) { return { r: F(r), s: F(s || 0), t: t || 1 }; }
  function rootIrr(x) { return !isZ(x.s) && x.t !== 1; }
  function rootVal(x) { return val(x.r) + val(x.s) * Math.sqrt(x.t); }
  function surdHtml(s, t) {
    s = abs(s);
    var top = (s.n === 1 ? '' : s.n) + '√' + t;
    return s.d === 1 ? top : frac(top, s.d);
  }
  function rootHtml(x, f) {
    f = f || fh;
    if (!rootIrr(x)) return f(add(x.r, x.t === 1 ? x.s : 0));
    var sh = surdHtml(x.s, x.t);
    if (isZ(x.r)) return (sgn(x.s) < 0 ? MINUS : '') + sh;
    return fh(x.r) + (sgn(x.s) < 0 ? ' ' + MINUS + ' ' : ' + ') + sh;
  }
  function rootPlain(x) {
    if (!rootIrr(x)) return fp(add(x.r, x.t === 1 ? x.s : 0));
    var s = abs(x.s);
    var sp = (s.n === 1 ? '' : s.n + '*') + 'sqrt(' + x.t + ')' + (s.d === 1 ? '' : '/' + s.d);
    if (isZ(x.r)) return (sgn(x.s) < 0 ? '-' : '') + sp;
    return fp(x.r) + (sgn(x.s) < 0 ? '-' : '+') + sp;
  }
  /** Normalform x² + px + q = 0 exakt lösen (über die quadratische Ergänzung). */
  function solveNF(p, q) {
    var h = div(p, 2), R = sub(sq(h), q), roots = [];
    if (sgn(R) === 0) roots = [Root(neg(h))];
    else if (sgn(R) > 0) {
      var s = sqrtF(R);
      if (s.rat) roots = [Root(sub(neg(h), s.rat)), Root(add(neg(h), s.rat))];
      else roots = [Root(neg(h), neg(s.s), s.t), Root(neg(h), s.s, s.t)];
    }
    return { p: F(p), q: F(q), h: h, R: R, roots: roots };
  }
  function setHtml(roots, f) { return roots.length ? '{' + roots.map(function (r) { return rootHtml(r, f); }).join('; ') + '}' : '{ }'; }
  function answerOf(roots) { return roots.length ? roots.map(rootPlain).join(';') : 'leer'; }
  function rationalRoots(list) { return list.map(function (v) { return Root(v); }).sort(function (a, b) { return rootVal(a) - rootVal(b); }); }

  /* ---------- Rechenzeilen ---------- */
  // chk: eq = äquivalent zur Gleichung, pm = mit ± (beide Vorzeichen), one = gilt für eine Lösung,
  //      all = gilt für alle Lösungen, num = reine Zahlenrechnung, L = Lösungsmenge
  function row(l, r, op, chk, cls) { return { l: l, r: r, op: op || '', chk: chk || 'eq', cls: cls || '' }; }
  function note(html) { return { note: html }; }
  function step(n, text) { return note(T('<span class="tr-step">Schritt ' + n + '</span> ' + text)); }
  /** Rechenzeilen als .calc-Blöcke; Notizen stehen als eigene Absätze dazwischen (robust auf schmalen Displays). */
  function rowHtml(r) {
    return '<div class="row' + (r.cls ? ' ' + r.cls : '') + '"><span class="l">' + r.l + '</span><span class="r">= ' + r.r + '</span>' +
      (r.op ? '<span class="op">' + r.op + '</span>' : '') + '</div>';
  }
  function calcHtml(rows) {
    var out = '', buf = '';
    function flush() { if (buf) { out += '<div class="calc">' + buf + '</div>'; buf = ''; } }
    rows.forEach(function (r) {
      if (r.note) { flush(); out += '<p class="tr-note">' + r.note + '</p>'; }
      else if (r.chk === 'L') { flush(); out += '<div class="calc tr-L">' + rowHtml(r) + '</div>'; }
      else buf += rowHtml(r);
    });
    flush();
    return '<div class="tr-sol">' + out + '</div>';
  }

  /** Probe: a·r² + b·r + c als Zahlenterm */
  function subst(a, b, c, r, f) {
    f = f || fh;
    var pr = par(r, f), parts = [];
    // bei negativem a die 1 ausschreiben: „−1 · 2²“ statt des missverständlichen „−2²“
    if (!isZ(a)) parts.push([sgn(a) < 0, (isOne(abs(a)) && sgn(a) > 0 ? '' : fh(abs(a)) + ' · ') + pr + '²']);
    if (!isZ(b)) parts.push([sgn(b) < 0, (isOne(abs(b)) ? '' : fh(abs(b)) + ' · ') + pr]);
    if (!isZ(c)) parts.push([sgn(c) < 0, fh(abs(c))]);
    return joinParts(parts);
  }
  function joinParts(parts) {
    return parts.map(function (p, i) {
      if (i === 0) return (p[0] ? MINUS : '') + p[1];
      return (p[0] ? ' ' + MINUS + ' ' : ' + ') + p[1];
    }).join('') || '0';
  }

  /* ---------- Bausteine für Lösungswege ---------- */
  var NONSQ = [2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 29, 30, 32, 40, 45, 48, 50];

  /** x² = K → Lösungen */
  function fromXsq(rows, K) {
    K = F(K);
    if (sgn(K) < 0) {
      rows.push(row('x²', fh(K)));
      rows.push(note(T('Ein Quadrat ist nie negativ – keine Zahl ergibt quadriert ' + M(fh(K)) + '. Also gibt es keine Lösung.')));
      return;
    }
    if (isZ(K)) { rows.push(row('x²', '0', '| √')); rows.push(row('x', '0', '', 'all')); return; }
    var s = sqrtF(K);
    rows.push(row('x²', fh(K), '| √ (±!)'));
    if (s.rat) { rows.push(row('x', '±' + fh(s.rat), '', 'pm')); return; }
    if (isInt(K) && !isOne(s.s)) rows.push(row('x', '±√' + K.n, '| √' + K.n + ' = ' + surdHtml(s.s, s.t), 'pm'));
    rows.push(row('x', '±' + surdHtml(s.s, s.t), '', 'pm'));
  }

  /** (kx + m)² = K → Lösungen. opts.n5/n6: Schritt-Notizen (Ergänzung) */
  function fromSquare(rows, k, m, K, opts) {
    k = F(k); m = F(m); K = F(K); opts = opts || {};
    var base = lin(k, m), sqr = '(' + base + ')²';
    if (sgn(K) < 0) {
      if (opts.n5) rows.push(opts.n5);
      rows.push(row(sqr, fh(K)));
      if (!opts.n5) rows.push(note(T('Ein Quadrat ist nie negativ → keine Lösung.')));
      return;
    }
    if (isZ(K)) {
      if (opts.n5) rows.push(opts.n5);
      rows.push(row(sqr, '0'));
      if (!opts.n5) rows.push(note(T('Ein Quadrat ist nur dann 0, wenn die Klammer 0 ist:')));
      if (opts.n6) rows.push(opts.n6);
      rows.push(row(base, '0', '| ' + opTerm([[neg(m), '']]), 'all'));
      if (!isOne(k)) rows.push(row(term([[k, 'x']]), fh(neg(m)), divOp(k), 'all'));
      rows.push(row('x', fh(div(neg(m), k)), '', 'all'));
      return;
    }
    var s = sqrtF(K), sd = s.rat ? fh(s.rat) : surdHtml(s.s, s.t);
    if (opts.n5) rows.push(opts.n5);
    rows.push(row(sqr, fh(K), '| √ (±!)'));
    if (!s.rat && isInt(K) && !isOne(s.s)) rows.push(row(base, '±√' + K.n, '| √' + K.n + ' = ' + sd, 'pm'));
    if (opts.n6) rows.push(opts.n6);
    rows.push(row(base, '±' + sd, '| ' + opTerm([[neg(m), '']]), 'pm'));
    if (isOne(k)) {
      rows.push(row('x', fh(neg(m)) + ' ± ' + sd, '', 'pm'));
      if (s.rat) {
        rows.push(row('x1', fh(neg(m)) + ' − ' + fh(s.rat) + ' = ' + fh(sub(neg(m), s.rat)), '', 'one'));
        rows.push(row('x2', fh(neg(m)) + ' + ' + fh(s.rat) + ' = ' + fh(add(neg(m), s.rat)), '', 'one'));
      }
    } else {
      rows.push(row(term([[k, 'x']]), fh(neg(m)) + ' ± ' + sd, divOp(k), 'pm'));
      if (s.rat) {
        var lo = sgn(k) > 0 ? sub(neg(m), s.rat) : add(neg(m), s.rat);
        var hi = sgn(k) > 0 ? add(neg(m), s.rat) : sub(neg(m), s.rat);
        rows.push(row('x1', '(' + fh(neg(m)) + (sgn(k) > 0 ? ' − ' : ' + ') + fh(s.rat) + ') : ' + fh(k) + ' = ' + fh(div(lo, k)), '', 'one'));
        rows.push(row('x2', '(' + fh(neg(m)) + (sgn(k) > 0 ? ' + ' : ' − ') + fh(s.rat) + ') : ' + fh(k) + ' = ' + fh(div(hi, k)), '', 'one'));
      } else {
        rows.push(row('x', '(' + fh(neg(m)) + ' ± ' + sd + ') : ' + fh(k), '', 'pm'));
      }
    }
  }

  function recog(k, m) {
    k = F(k); m = F(m);
    var parts = [];
    if (!isOne(k)) parts.push(M(term([[sq(k), 'x²']]) + ' = (' + term([[k, 'x']]) + ')²'));
    parts.push(M(fh(sq(m)) + ' = ' + sqShow(abs(m))));
    parts.push(M(term([[abs(mul(2, mul(k, m))), 'x']]) + ' = 2 · ' + term([[k, 'x']]) + ' · ' + fh(abs(m))));
    return note(T('Erkennen: ' + parts.join(', ') + ' ✓'));
  }

  /** k²x² + 2kmx + m² = 0 → (kx + m)² = 0 */
  function perfectSquare(rows, k, m) {
    k = F(k); m = F(m);
    rows.push(recog(k, m));
    rows.push(row(quad(sq(k), mul(2, mul(k, m)), sq(m)), '0', '| ' + binName(m) + ' binomische Formel'));
    fromSquare(rows, k, m, 0);
  }

  /** k²x² − m² = 0 → (kx + m)(kx − m) = 0 ; mStr optional für √n */
  function diffSquares(rows, k, m, sqrtN) {
    k = F(k);
    var A = term([[k, 'x']]);
    var B = sqrtN ? '√' + sqrtN : fh(m);
    var c = sqrtN ? -sqrtN : neg(sq(m));
    var x1 = sqrtN ? MINUS + '√' + sqrtN : fh(div(neg(m), k));
    var x2 = sqrtN ? '√' + sqrtN : fh(div(m, k));
    if (sqrtN) rows.push(note(T('Trick: ' + M(sqrtN + ' = (√' + sqrtN + ')²') + ' – damit passt die 3. binomische Formel.')));
    rows.push(row(quad(sq(k), 0, c), '0', '| 3. binomische Formel'));
    rows.push(row('(' + A + ' + ' + B + ')(' + A + ' − ' + B + ')', '0', '| Satz vom Nullprodukt'));
    rows.push(row(A + ' + ' + B, '0', '| − ' + B, 'one'));
    if (!isOne(k)) rows.push(row(A, MINUS + B, divOp(k), 'one'));
    rows.push(row('x1', x1, '', 'one'));
    rows.push(row(A + ' − ' + B, '0', '| + ' + B, 'one'));
    if (!isOne(k)) rows.push(row(A, B, divOp(k), 'one'));
    rows.push(row('x2', x2, '', 'one'));
  }

  /* ---------- Weg-Metadaten ---------- */
  var WEG_IDS = ['grafisch', 'ausklammern', 'wurzel', 'binomisch', 'vieta', 'ergaenzung'];
  var WEGE = {
    grafisch: { name: 'Grafisch ablesen', html: 'Grafisch ablesen', color: 'blue', icon: '📈' },
    ausklammern: { name: 'x ausklammern', html: X + ' ausklammern', color: 'green', icon: '🧩' },
    wurzel: { name: 'Wurzel ziehen', html: 'Wurzel ziehen', color: 'green', icon: '√' },
    binomisch: { name: 'Binomische Formel', html: 'Binomische Formel', color: 'green', icon: '²' },
    vieta: { name: 'Produkt-Summen', html: 'Produkt-Summen-Trick', color: 'green', icon: '×' },
    ergaenzung: { name: 'Quadr. Ergänzung', html: 'Quadratische Ergänzung', color: 'orange', icon: '🟧' },
    gemischt: { name: 'Gemischt', html: 'Gemischt', color: 'pink', icon: '🎲' }
  };
  var WHY = {
    grafisch: 'Hier ist der Graph schon gezeichnet – also ablesen und mit der Probe absichern.',
    ausklammern: 'Es gibt keine Zahl ohne ' + X + ' (' + M('c = 0') + '). Dann klammerst du ' + X + ' aus – schneller geht es nicht.',
    wurzel: 'Es gibt kein ' + X + '-Glied, nur ' + M('x²') + ' und Zahlen. Also nach ' + M('x²') + ' umstellen und die Wurzel ziehen.',
    wurzelSq: 'Links steht schon ein Quadrat, rechts nur eine Zahl. Dann ziehst du direkt die Wurzel.',
    binomisch: 'Die Gleichung ist eine binomische Formel – das erkennst du an den Quadratzahlen außen und dem passenden Mittelglied.',
    binomischK: 'Links steht eine binomische Formel, rechts nur eine Zahl. Erst als Quadrat schreiben, dann Wurzel ziehen.',
    vieta: 'Alle drei Glieder sind da, vor ' + M('x²') + ' steht (nach dem Teilen) eine 1 und die Lösungen sind ganze Zahlen. Da ist der Produkt-Summen-Trick am schnellsten.',
    ergaenzung: 'Kein Glied fehlt, es ist keine binomische Formel und es gibt keine passenden ganzen Zahlen für den Produkt-Summen-Trick. Die quadratische Ergänzung klappt dagegen immer.'
  };

  function base(weg, level, a, b, c) {
    a = F(a); b = F(b); c = F(c);
    if (isZ(a)) throw new Error('a = 0');
    var nf = solveNF(div(b, a), div(c, a));
    return { weg: weg, level: level, a: a, b: b, c: c, nf: nf, roots: nf.roots, rows: [], wrong: [], hints: [], natural: true, why: WHY[weg], pre: '', post: '', plot: null };
  }
  function pushWrong(P, list, msg) {
    var m = answerOf(list);
    if (m === answerOf(P.roots)) return;
    if (P.wrong.some(function (w) { return w.match === m; })) return;
    P.wrong.push({ match: m, msg: msg });
  }
  function signWrong(P) {
    if (P.roots.length !== 2 || rootIrr(P.roots[0])) return;
    var flipped = P.roots.map(function (r) { return Root(neg(r.r)); }).sort(function (a, b) { return rootVal(a) - rootVal(b); });
    var r0 = P.roots[0].r;
    if (P.weg === 'grafisch') { pushWrong(P, flipped, 'Fast! Prüf die Vorzeichen: Liegen die Schnittstellen links (negativ) oder rechts (positiv) von der ' + M('y') + '-Achse?'); return; }
    var sr = P.sq ? sqrtF(P.sq.K) : null;
    if (sr && sr.rat && !isZ(P.sq.m)) {
      // (kx + m)² = s²  →  kx + m = ±s  →  kx = −m ± s
      var sk = F(P.sq.k), sm = F(P.sq.m);
      pushWrong(P, flipped, 'Fast! Prüf die Vorzeichen: Aus ' + M(lin(sk, sm) + ' = ±' + fh(sr.rat)) + ' folgt ' + M(term([[sk, 'x']]) + ' = ' + fh(neg(sm)) + ' ± ' + fh(sr.rat)) +
        ' – die ' + M(fh(abs(sm))) + ' wechselt beim Rüberbringen das Vorzeichen. Die Probe zeigt dir, ob es passt.');
    }
    else pushWrong(P, flipped, 'Fast! Prüf die Vorzeichen: Aus ' + M(lin(1, neg(r0)) + ' = 0') + ' folgt ' + M('x = ' + fh(r0)) + ' – beim Auflösen dreht sich das Vorzeichen um. Die Probe zeigt dir, ob es passt.');
  }

  /* ---------- Weg: x ausklammern ---------- */
  function genAusklammern(level) {
    var rows = [], a, b, orig, prep = '';
    if (level === 1) {
      a = F(1); b = F(rnz(-9, 9));
      orig = [quad(a, b, 0), '0'];
    } else if (level === 2) {
      var v = pick(['direkt', 'direkt', 'rechts', 'rechts', 'beide']);
      if (v === 'direkt') {
        a = F(pick([2, 3, 4, 5, -1, -2, -3])); b = F(rnz(-12, 12));
        orig = [quad(a, b, 0), '0'];
      } else if (v === 'rechts') {
        a = F(pick([1, 1, 2, 3, -1])); var k = rnz(-9, 9); b = F(-k);
        orig = [term([[a, 'x²']]), term([[k, 'x']])];
        rows.push(row(orig[0], orig[1], '| ' + opTerm([[-k, 'x']])));
        prep = 'move';
      } else {
        var b0 = rnz(-6, 6), d, c0 = rnz(-9, 9);
        do { d = rnz(-6, 6); } while (d === b0);
        a = F(1); b = F(b0 - d);
        orig = [quad(1, b0, c0), term([[d, 'x'], [c0, '']])];
        rows.push(row(orig[0], orig[1], '| ' + opTerm([[-d, 'x'], [-c0, '']])));
        prep = 'move';
      }
    } else {
      var v3 = pick(['mal', 'prod', 'bruch', 'bruch']);
      if (v3 === 'mal') {
        var u = rnz(-8, 8), w;
        do { w = rnz(-8, 8); } while (w === u);
        a = F(1); b = F(u - w);
        orig = ['x(' + lin(1, u) + ')', term([[w, 'x']])];
        rows.push(row(orig[0], orig[1], '| ausmultiplizieren'));
        rows.push(row(quad(1, u, 0), term([[w, 'x']]), '| ' + opTerm([[-w, 'x']])));
        prep = 'expand';
      } else if (v3 === 'prod') {
        var u2, w2;
        do { u2 = rnz(-7, 7); w2 = rnz(-7, 7); } while (u2 + w2 === 0);
        a = F(1); b = F(u2 + w2);
        orig = ['(' + lin(1, u2) + ')(' + lin(1, w2) + ')', fh(u2 * w2)];
        rows.push(row(orig[0], orig[1], '| ausmultiplizieren'));
        rows.push(row(quad(1, u2 + w2, u2 * w2), fh(u2 * w2), '| ' + opTerm([[-u2 * w2, '']])));
        prep = 'expand';
      } else {
        a = pick([F(1, 2), F(1, 3), F(1, 4), F(-1, 2), F(2, 3), F(3, 4)]);
        var r;
        do { b = F(rnz(-6, 6)); r = div(neg(b), a); } while (!isInt(r) || Math.abs(val(r)) > 24);
        orig = [quad(a, b, 0), '0'];
      }
    }
    var P = base('ausklammern', level, a, b, 0);
    P.orig = orig;
    P.umf = !!prep;
    var lf = lin(a, b), r0 = div(neg(b), a);
    rows.push(row(quad(a, b, 0), '0', '| x ausklammern'));
    rows.push(row('x · (' + lf + ')', '0', '| Satz vom Nullprodukt'));
    rows.push(note(T('Satz vom Nullprodukt: Mindestens ein Faktor muss null sein.')));
    rows.push(row('x1', '0', '', 'one'));
    rows.push(row(lf, '0', '| ' + opTerm([[neg(b), '']]), 'one'));
    if (!isOne(a)) rows.push(row(term([[a, 'x']]), fh(neg(b)), divOp(a), 'one'));
    rows.push(row('x2', fh(r0), '', 'one'));
    P.rows = rows;
    P.q = 'Löse die Gleichung durch Ausklammern.';
    P.hints = [
      (prep === 'expand' ? 'Multipliziere zuerst aus und bring dann alles auf die linke Seite, sodass rechts 0 steht. '
        : prep ? 'Bring zuerst alles auf die linke Seite, sodass rechts 0 steht. ' : '') +
      'In jedem Summanden steckt ein ' + X + ' – klammere ' + X + ' aus. Teile nie durch ' + X + ', sonst verlierst du die Lösung ' + M('x = 0') + '!',
      'Ausgeklammert: ' + M('x · (' + lf + ') = 0') + '. Ein Faktor muss 0 sein: ' + M('x = 0') + ' oder ' + M(lf + ' = 0') + '.'
    ];
    pushWrong(P, [Root(r0)], 'Da fehlt eine Lösung: ' + M('x = 0') + '! Hast du durch ' + X + ' geteilt? Dabei geht diese Lösung verloren – klammere ' + X + ' lieber aus.');
    pushWrong(P, rationalRoots([0, neg(r0)]), 'Fast! Prüf das Vorzeichen der zweiten Lösung: Löse ' + M(lf + ' = 0') + ' noch einmal sorgfältig nach ' + X + ' auf.');
    return P;
  }

  /* ---------- Weg: Wurzel ziehen ---------- */
  function genWurzel(level) {
    var rows = [], P, orig, v, s, K, a, c, d, why = WHY.wurzel, h2;
    if (level === 1) {
      s = ri(1, 12); K = s * s;
      if (chance(0.5)) orig = ['x²', fh(K)];
      else { orig = [quad(1, 0, -K), '0']; rows.push(row(orig[0], '0', '| + ' + K)); }
      fromXsq(rows, K);
      P = base('wurzel', 1, 1, 0, -K);
      h2 = 'Du kommst auf ' + M('x² = ' + K) + '. Welche Zahlen ergeben quadriert ' + M(String(K)) + '? Denk an die negative Lösung (±)!';
    } else if (level === 2) {
      v = pick(['ax2c', 'keine', 'square', 'square', 'umf', 'frac']);
      if (v === 'ax2c') {
        a = pick([2, 3, 4, 5, -2, -3]); s = ri(1, 6); c = -a * s * s;
        orig = [quad(a, 0, c), '0'];
        rows.push(row(orig[0], '0', '| ' + opTerm([[-c, '']])));
        rows.push(row(term([[a, 'x²']]), fh(-c), divOp(a)));
        fromXsq(rows, s * s);
        P = base('wurzel', 2, a, 0, c);
        h2 = 'Teile durch ' + M(fh(a)) + ': ' + M('x² = ' + s * s) + '. Jetzt Wurzel ziehen – mit ±!';
      } else if (v === 'keine') {
        a = pick([1, 2, 3]); var mm = ri(1, 9); c = a * mm;
        orig = [quad(a, 0, c), '0'];
        rows.push(row(orig[0], '0', '| ' + opTerm([[-c, '']])));
        if (a !== 1) rows.push(row(term([[a, 'x²']]), fh(-c), divOp(a)));
        fromXsq(rows, -mm);
        P = base('wurzel', 2, a, 0, c);
        h2 = 'Du kommst auf ' + M('x² = ' + fh(-mm)) + '. Welche Zahl ergibt quadriert etwas Negatives?';
      } else if (v === 'square') {
        d = rnz(-6, 6); s = chance(0.15) ? 0 : ri(1, 6); K = s * s;
        orig = ['(' + lin(1, d) + ')²', fh(K)];
        fromSquare(rows, 1, d, K);
        P = base('wurzel', 2, 1, 2 * d, d * d - K);
        P.sq = { k: 1, m: d, K: K };
        why = WHY.wurzelSq;
        h2 = 'Wurzel ziehen: ' + M(lin(1, d) + ' = ±' + s) + '. Dann ' + M(fh(d)) + ' auf die andere Seite bringen.';
        if (s === 0) h2 = 'Rechts steht 0 – dann muss die Klammer selbst 0 sein: ' + M(lin(1, d) + ' = 0') + '.';
      } else if (v === 'umf') {
        var a2 = pick([0, 1, 2]), g = pick([1, 1, 2, 3]), a1 = a2 + g;
        K = chance(0.2) ? -ri(1, 5) : Math.pow(ri(1, 6), 2);
        var c1 = rnz(-9, 9), c2 = c1 + g * K;
        orig = [quad(a1, 0, c1), quad(a2, 0, c2)];
        rows.push(row(orig[0], orig[1], '| ' + opTerm([[-a2, 'x²'], [-c1, '']])));
        if (g !== 1) rows.push(row(term([[g, 'x²']]), fh(g * K), divOp(g)));
        fromXsq(rows, K);
        P = base('wurzel', 2, g, 0, -g * K);
        h2 = 'Sortiere: ' + X + '²-Glieder nach links, Zahlen nach rechts. Du kommst auf ' + M('x² = ' + fh(K)) + '.';
      } else {
        var kk = pick([4, 9, 16, 25]), rk = Math.sqrt(kk), m;
        do { m = ri(1, 9); } while (gcd(m, rk) !== 1);
        orig = [term([[kk, 'x²']]), fh(m * m)];
        rows.push(row(orig[0], orig[1], divOp(kk)));
        fromXsq(rows, F(m * m, kk));
        P = base('wurzel', 2, kk, 0, -m * m);
        h2 = 'Teile durch ' + kk + ': ' + M('x² = ' + fh(F(m * m, kk))) + '. Die Wurzel aus einem Bruch: Zähler und Nenner einzeln!';
      }
    } else {
      v = pick(['irr', 'irr', 'sqirr', 'expand', 'expand2', 'bruchko']);
      if (v === 'irr') {
        a = pick([1, 1, 2, 3]); K = pick(NONSQ); c = -a * K;
        if (chance(0.5)) { orig = [quad(a, 0, c), '0']; rows.push(row(orig[0], '0', '| + ' + (a * K))); }
        else orig = [term([[a, 'x²']]), fh(a * K)];
        if (a !== 1) rows.push(row(term([[a, 'x²']]), fh(a * K), divOp(a)));
        fromXsq(rows, K);
        P = base('wurzel', 3, a, 0, c);
        h2 = 'Du kommst auf ' + M('x² = ' + K) + '. ' + K + ' ist keine Quadratzahl – dann bleibt die Wurzel einfach stehen' + (isOne(sqrtF(K).s) ? '' : ' (teilweise Wurzel ziehen: ' + M(K + ' = ' + sq(sqrtF(K).s).n + ' · ' + sqrtF(K).t) + ')') + '. Denk an ±!';
      } else if (v === 'sqirr') {
        d = rnz(-6, 6); K = pick(NONSQ.filter(function (n) { return n <= 30; }));
        orig = ['(' + lin(1, d) + ')²', fh(K)];
        fromSquare(rows, 1, d, K);
        P = base('wurzel', 3, 1, 2 * d, d * d - K);
        why = WHY.wurzelSq;
        h2 = 'Wurzel ziehen: ' + M(lin(1, d) + ' = ±√' + K) + '. Dann nach ' + X + ' auflösen.';
      } else if (v === 'expand') {
        var m3, s3, n3;
        do { m3 = ri(1, 9); s3 = ri(1, 10); n3 = s3 * s3 - m3 * m3; } while (n3 === 0);
        orig = ['(' + lin(1, m3) + ')(' + lin(1, -m3) + ')', fh(n3)];
        rows.push(row(orig[0], orig[1], '| 3. binomische Formel'));
        rows.push(row(quad(1, 0, -m3 * m3), fh(n3), '| + ' + m3 * m3));
        fromXsq(rows, s3 * s3);
        P = base('wurzel', 3, 1, 0, -s3 * s3);
        h2 = 'Links steht die 3. binomische Formel: ' + M('x² − ' + m3 * m3) + '. Dann ' + M('x² = ' + s3 * s3) + '.';
      } else if (v === 'expand2') {
        var k4 = pick([2, 3]), m4 = ri(1, 6), t4, n4;
        do { t4 = ri(1, 9); n4 = t4 * t4 - m4 * m4; } while (n4 === 0);
        orig = ['(' + lin(k4, -m4) + ')(' + lin(k4, m4) + ')', fh(n4)];
        rows.push(row(orig[0], orig[1], '| 3. binomische Formel'));
        rows.push(row(quad(k4 * k4, 0, -m4 * m4), fh(n4), '| + ' + m4 * m4));
        rows.push(row(term([[k4 * k4, 'x²']]), fh(t4 * t4), divOp(k4 * k4)));
        fromXsq(rows, F(t4 * t4, k4 * k4));
        P = base('wurzel', 3, k4 * k4, 0, -t4 * t4);
        h2 = '3. binomische Formel: ' + M(quad(k4 * k4, 0, -m4 * m4) + ' = ' + fh(n4)) + '. Dann nach ' + M('x²') + ' umstellen.';
      } else {
        var k5 = pick([2, 3, 4]);
        var s5 = pick(k5 === 3 ? [3, 6] : [2, 4, 6]);
        var c5 = s5 * s5 / k5;
        orig = [quad(F(1, k5), 0, -c5), '0'];
        rows.push(row(orig[0], '0', '| + ' + c5));
        rows.push(row(term([[F(1, k5), 'x²']]), fh(c5), '| · ' + k5));
        fromXsq(rows, s5 * s5);
        P = base('wurzel', 3, F(1, k5), 0, -c5);
        h2 = 'Erst ' + M(fh(c5)) + ' nach rechts, dann mal ' + k5 + ': ' + M('x² = ' + s5 * s5) + '.';
      }
    }
    P.orig = orig; P.rows = rows; P.why = why;
    P.umf = ['umf', 'expand', 'expand2'].indexOf(v) >= 0;
    P.q = 'Löse die Gleichung durch Wurzelziehen.';
    P.hints = [
      'Stelle die Gleichung so um, dass ' + M('x²') + ' (oder die Klammer zum Quadrat) allein auf einer Seite steht. Dann Wurzel ziehen – und an ± denken.',
      h2
    ];
    if (P.roots.length === 2 && !rootIrr(P.roots[0])) pushWrong(P, [P.roots[1]], 'Eine Lösung fehlt noch! Beim Wurzelziehen gibt es zwei Möglichkeiten: + und −.');
    if (P.roots.length === 0 && isZ(P.b)) {
      var kk2 = div(P.c, P.a), sr = sqrtF(kk2);
      if (sr && sr.rat && !isZ(sr.rat)) pushWrong(P, [Root(neg(sr.rat)), Root(sr.rat)], 'Mach die Probe! Rechts steht eine <b>negative</b> Zahl – und ein Quadrat ist nie negativ. Also gibt es keine Lösung.');
    }
    if (!isZ(P.b)) signWrong(P);
    return P;
  }

  /* ---------- Weg: Binomische Formeln ---------- */
  function genBinomisch(level) {
    var rows = [], P, v, k, m, d, why = WHY.binomisch, h1, h2;
    if (level === 1) v = chance(0.62) ? 'quadrat' : 'diff';
    else if (level === 2) v = pick(['k2', 'k2', 'diffk', 'umf', 'faktor', 'gleichK', 'gleichK']);
    else v = pick(['bruch', 'bruch', 'expand', 'malx', 'wurzeldiff', 'kK']);
    h1 = 'Vergleiche mit den binomischen Formeln: Sind die äußeren Glieder Quadrate? Passt das Mittelglied ' + M('2ab') + '?';
    switch (v) {
      case 'quadrat':
        d = rnz(-9, 9);
        P = base('binomisch', level, 1, 2 * d, d * d);
        P.orig = [quad(1, 2 * d, d * d), '0'];
        perfectSquare(rows, 1, d);
        h2 = 'Das ist die ' + binName(d) + ' binomische Formel: ' + M('(' + lin(1, d) + ')² = 0') + '.';
        break;
      case 'diff':
        m = ri(1, 12);
        P = base('binomisch', level, 1, 0, -m * m);
        P.orig = [quad(1, 0, -m * m), '0'];
        diffSquares(rows, 1, m);
        P.natural = false;
        h1 = 'Zwei Quadrate mit Minus dazwischen: Das ist die 3. binomische Formel ' + M('a² − b² = (a + b)(a − b)') + '.';
        h2 = M(quad(1, 0, -m * m) + ' = (x + ' + m + ')(x − ' + m + ')') + '. Jetzt Satz vom Nullprodukt.';
        break;
      case 'k2':
        k = ri(2, 5);
        do { m = rnz(-7, 7); } while (gcd(k, m) !== 1);
        P = base('binomisch', level, k * k, 2 * k * m, m * m);
        P.orig = [quad(k * k, 2 * k * m, m * m), '0'];
        perfectSquare(rows, k, m);
        h2 = M(quad(k * k, 0, 0) + ' = (' + k + 'x)²') + ' und ' + M(m * m + ' = ' + Math.abs(m) + '²') + ': ' + M('(' + lin(k, m) + ')² = 0') + '.';
        break;
      case 'diffk':
        k = ri(2, 5);
        do { m = ri(1, 9); } while (gcd(k, m) !== 1);
        P = base('binomisch', level, k * k, 0, -m * m);
        P.orig = [quad(k * k, 0, -m * m), '0'];
        diffSquares(rows, k, m);
        P.natural = false;
        h1 = 'Zwei Quadrate mit Minus dazwischen: 3. binomische Formel ' + M('a² − b² = (a + b)(a − b)') + '.';
        h2 = M(quad(k * k, 0, -m * m) + ' = (' + lin(k, m) + ')(' + lin(k, -m) + ')') + '. Jetzt Satz vom Nullprodukt.';
        break;
      case 'umf':
        d = rnz(-8, 8);
        P = base('binomisch', level, 1, 2 * d, d * d);
        P.orig = [quad(1, 0, d * d), term([[-2 * d, 'x']])];
        rows.push(row(P.orig[0], P.orig[1], '| ' + opTerm([[2 * d, 'x']])));
        perfectSquare(rows, 1, d);
        h1 = 'Bring zuerst alles auf die linke Seite und ordne: ' + M('x²') + ', dann das ' + X + '-Glied, dann die Zahl.';
        h2 = M(quad(1, 2 * d, d * d) + ' = 0') + ' ist die ' + binName(d) + ' binomische Formel.';
        break;
      case 'faktor':
        var g = pick([2, 3, -1, -2]);
        d = rnz(-6, 6);
        P = base('binomisch', level, g, 2 * g * d, g * d * d);
        P.orig = [quad(g, 2 * g * d, g * d * d), '0'];
        rows.push(row(P.orig[0], '0', divOp(g)));
        perfectSquare(rows, 1, d);
        h1 = 'Teile zuerst die ganze Gleichung durch ' + M(fh(g)) + '. Dann siehst du die binomische Formel.';
        h2 = 'Nach dem Teilen: ' + M(quad(1, 2 * d, d * d) + ' = 0') + ', also ' + M('(' + lin(1, d) + ')² = 0') + '.';
        break;
      case 'gleichK':
        d = rnz(-6, 6);
        var K;
        do { K = chance(0.25) ? -ri(1, 9) : Math.pow(ri(1, 6), 2); } while (K === d * d);
        P = base('binomisch', level, 1, 2 * d, d * d - K);
        P.orig = [quad(1, 2 * d, d * d), fh(K)];
        rows.push(recog(1, d));
        rows.push(row(P.orig[0], P.orig[1], '| ' + binName(d) + ' binomische Formel'));
        fromSquare(rows, 1, d, K);
        P.sq = { k: 1, m: d, K: K };
        why = WHY.binomischK;
        h1 = 'Schau nur auf die linke Seite: Das ist eine binomische Formel! Schreib sie als Quadrat.';
        h2 = M('(' + lin(1, d) + ')² = ' + fh(K)) + '. ' + (K < 0 ? 'Kann ein Quadrat negativ sein?' : 'Jetzt Wurzel ziehen – mit ±!');
        break;
      case 'bruch':
        var hh = pick([F(1, 2), F(-1, 2), F(1, 3), F(-1, 3), F(3, 2), F(-3, 2), F(1, 4), F(-1, 4), F(2, 3), F(-2, 3)]);
        P = base('binomisch', level, 1, mul(2, hh), sq(hh));
        P.orig = [quad(1, mul(2, hh), sq(hh)), '0'];
        perfectSquare(rows, 1, hh);
        h1 = 'Keine Angst vor dem Bruch: ' + M(fh(sq(hh)) + ' = ' + sqShow(abs(hh))) + '. Passt das Mittelglied zu ' + M('2ab') + '?';
        h2 = M(quad(1, mul(2, hh), sq(hh)) + ' = (' + lin(1, hh) + ')²') + '.';
        break;
      case 'expand':
        var u = rnz(-6, 6);
        P = base('binomisch', level, 1, -2 * u, u * u);
        P.orig = ['(' + lin(1, u) + ')²', term([[4 * u, 'x']])];
        rows.push(row(P.orig[0], P.orig[1], '| ' + binName(u) + ' binomische Formel'));
        rows.push(row(quad(1, 2 * u, u * u), term([[4 * u, 'x']]), '| ' + opTerm([[-4 * u, 'x']])));
        perfectSquare(rows, 1, -u);
        h1 = 'Löse zuerst die Klammer auf und bring alles nach links. Dann suchst du wieder eine binomische Formel.';
        h2 = 'Nach dem Umformen: ' + M(quad(1, -2 * u, u * u) + ' = 0') + ', also ' + M('(' + lin(1, -u) + ')² = 0') + '.';
        break;
      case 'malx':
        d = rnz(-7, 7);
        P = base('binomisch', level, 1, 2 * d, d * d);
        P.orig = ['x(' + lin(1, 2 * d) + ')', fh(-d * d)];
        rows.push(row(P.orig[0], P.orig[1], '| ausmultiplizieren'));
        rows.push(row(quad(1, 2 * d, 0), fh(-d * d), '| + ' + d * d));
        perfectSquare(rows, 1, d);
        h1 = 'Multipliziere aus und bring die Zahl nach links. Dann wird es eine binomische Formel.';
        h2 = M(quad(1, 2 * d, d * d) + ' = 0') + ', also ' + M('(' + lin(1, d) + ')² = 0') + '.';
        break;
      case 'wurzeldiff':
        var n = pick(NONSQ.filter(function (z) { return z <= 30; }));
        P = base('binomisch', level, 1, 0, -n);
        P.orig = [quad(1, 0, -n), '0'];
        diffSquares(rows, 1, null, n);
        P.natural = false;
        h1 = 'Auch Nicht-Quadratzahlen sind Quadrate: ' + M(n + ' = (√' + n + ')²') + '. Nutze die 3. binomische Formel.';
        h2 = M(quad(1, 0, -n) + ' = (x + √' + n + ')(x − √' + n + ')') + '.';
        break;
      default: // kK
        k = ri(2, 3);
        do { m = rnz(-5, 5); } while (gcd(k, m) !== 1);
        var s;
        do { s = ri(1, 5); } while (s === Math.abs(m));
        P = base('binomisch', level, k * k, 2 * k * m, m * m - s * s);
        P.orig = [quad(k * k, 2 * k * m, m * m), fh(s * s)];
        rows.push(recog(k, m));
        rows.push(row(P.orig[0], P.orig[1], '| ' + binName(m) + ' binomische Formel'));
        fromSquare(rows, k, m, s * s);
        P.sq = { k: k, m: m, K: s * s };
        why = WHY.binomischK;
        h1 = 'Die linke Seite ist eine binomische Formel. Schreib sie als Quadrat, dann Wurzel ziehen.';
        h2 = M('(' + lin(k, m) + ')² = ' + s * s) + ', also ' + M(lin(k, m) + ' = ±' + s) + '.';
    }
    P.rows = rows; P.why = why;
    P.umf = ['umf', 'expand', 'malx'].indexOf(v) >= 0;
    P.q = 'Löse die Gleichung mit einer binomischen Formel.';
    P.hints = [h1, h2];
    if (P.roots.length === 1) {
      var r = P.roots[0].r;
      if (!isZ(r)) pushWrong(P, [Root(neg(r)), Root(r)], 'Hier gibt es nur <b>eine</b> Lösung: ' + M('(…)² = 0') + ' heißt, die Klammer selbst ist 0.');
    }
    signWrong(P);
    if (P.roots.length === 2 && isZ(P.b) && !rootIrr(P.roots[0])) pushWrong(P, [P.roots[1]], 'Eine Lösung fehlt! Jeder der beiden Faktoren liefert eine Lösung.');
    return P;
  }

  /* ---------- Weg: Produkt-Summen-Trick ---------- */
  function intRoots(L, maxQ, minQ) {
    var r1, r2;
    do { r1 = rnz(-L, L); r2 = rnz(-L, L); }
    while (r1 === r2 || r1 + r2 === 0 || Math.abs(r1 * r2) > maxQ || Math.abs(r1 * r2) < (minQ || 0));
    return r1 < r2 ? [r1, r2] : [r2, r1];
  }
  function genVieta(level) {
    var rows = [], P, rr, a = F(1), v = 'std', prep = '';
    if (level === 1) {
      rr = intRoots(9, 40);
    } else if (level === 2) {
      v = pick(['a', 'a', 'umf', 'rechts', 'doppel']);
      if (v === 'doppel') { var dd = rnz(-8, 8); rr = [dd, dd]; }
      else rr = intRoots(7, 42);
      if (v === 'a') a = F(pick([2, 3, -1, -2, -3]));
    } else {
      v = pick(['prod', 'prod', 'malx', 'gross', 'a3']);
      rr = v === 'gross' ? intRoots(15, 160, 30) : intRoots(9, 60);
      if (v === 'a3') a = pick([F(2), F(3), F(-1), F(1, 2)]);
    }
    var r1 = rr[0], r2 = rr[1], p = -(r1 + r2), q = r1 * r2;
    var A = a, B = mul(a, p), C = mul(a, q);
    P = base('vieta', level, A, B, C);
    switch (v) {
      case 'a':
        P.orig = [quad(A, B, C), '0'];
        rows.push(note(T('Erst Normalform: Vor ' + M('x²') + ' muss eine 1 stehen.')));
        rows.push(row(P.orig[0], '0', divOp(A)));
        prep = 'div';
        break;
      case 'umf':
        P.orig = ['x²', term([[-p, 'x'], [-q, '']])];
        rows.push(row(P.orig[0], P.orig[1], '| ' + opTerm([[p, 'x'], [q, '']])));
        prep = 'move';
        break;
      case 'rechts':
        P.orig = [quad(1, p, 0), fh(-q)];
        rows.push(row(P.orig[0], P.orig[1], '| ' + opTerm([[q, '']])));
        prep = 'move';
        break;
      case 'prod':
        var u, w, k;
        do { u = rnz(-6, 6); w = p - u; k = u * w - q; } while (w === 0 || k === 0);
        P.orig = ['(' + lin(1, u) + ')(' + lin(1, w) + ')', fh(k)];
        rows.push(row(P.orig[0], P.orig[1], '| ausmultiplizieren'));
        rows.push(row(quad(1, p, u * w), fh(k), '| ' + opTerm([[-k, '']])));
        prep = 'expand';
        break;
      case 'malx':
        P.orig = ['x(' + lin(1, p) + ')', fh(-q)];
        rows.push(row(P.orig[0], P.orig[1], '| ausmultiplizieren'));
        rows.push(row(quad(1, p, 0), fh(-q), '| ' + opTerm([[q, '']])));
        prep = 'expand';
        break;
      case 'a3':
        P.orig = [quad(A, B, 0), fh(neg(C))];
        rows.push(row(P.orig[0], P.orig[1], '| ' + opTerm([[C, '']])));
        rows.push(note(T('Jetzt Normalform herstellen:')));
        rows.push(row(quad(A, B, C), '0', divOp(A)));
        prep = 'div';
        break;
      default:
        P.orig = [quad(1, p, q), '0'];
    }
    var m1 = -r1, m2 = -r2; // (x + m1)(x + m2)
    var fac = '(' + lin(1, m1) + ')(' + lin(1, m2) + ')';
    rows.push(note(T('Gesucht: zwei Zahlen mit Produkt ' + M(fh(q)) + ' und Summe ' + M(fh(p)) + '. Das sind ' + M(fh(m1)) + ' und ' + M(fh(m2)) +
      ', denn ' + M(fh(m1) + ' · ' + par(m2) + ' = ' + fh(q)) + ' und ' + M(fh(m1) + ' + ' + par(m2) + ' = ' + fh(p)) + '.')));
    rows.push(row(quad(1, p, q), '0', '| faktorisieren'));
    rows.push(row(fac, '0', '| Satz vom Nullprodukt'));
    if (r1 === r2) {
      rows.push(note(T('Beide Klammern sind gleich – es gibt nur eine Lösung:')));
      rows.push(row(lin(1, m1), '0', '| ' + opTerm([[-m1, '']]), 'all'));
      rows.push(row('x', fh(r1), '', 'all'));
      P.natural = false;
    } else {
      rows.push(row(lin(1, m1), '0', '| ' + opTerm([[-m1, '']]), 'one'));
      rows.push(row('x1', fh(r1), '', 'one'));
      rows.push(row(lin(1, m2), '0', '| ' + opTerm([[-m2, '']]), 'one'));
      rows.push(row('x2', fh(r2), '', 'one'));
    }
    rows.push(note(T('<b>Probe</b> in der Normalform – es muss 0 herauskommen:')));
    (r1 === r2 ? [r1] : [r1, r2]).forEach(function (r) { rows.push(row(subst(1, p, q, r), '0 ✓', '', 'num')); });
    P.rows = rows;
    P.vieta = { m1: m1, m2: m2, p: p, q: q };
    P.umf = prep === 'move' || prep === 'expand' || v === 'a3';
    P.q = 'Löse die Gleichung mit dem Produkt-Summen-Trick.';
    var pre = prep === 'div' ? 'Stell zuerst die Normalform her (vor ' + M('x²') + ' muss eine 1 stehen). '
      : prep === 'expand' ? 'Multipliziere zuerst aus und bring alles auf die linke Seite. '
        : prep === 'move' ? 'Bring zuerst alles auf die linke Seite, sodass rechts 0 steht. ' : '';
    P.hints = [
      pre + 'Suche zwei Zahlen: Ihr <b>Produkt</b> ist die Zahl ohne ' + X + ' (' + M('q') + '), ihre <b>Summe</b> die Zahl vor ' + X + ' (' + M('p') + ').' +
      (prep ? '' : ' Hier also: Produkt ' + M(fh(q)) + ', Summe ' + M(fh(p)) + '.'),
      'Die Zahlen sind ' + M(fh(m1)) + ' und ' + M(fh(m2)) + ': ' + M(fac + ' = 0') + '. Jetzt Satz vom Nullprodukt – Achtung, Vorzeichen!'
    ];
    if (r1 !== r2) pushWrong(P, rationalRoots([m1, m2]), 'Fast! Das sind die Zahlen aus den Klammern. Aus ' + M(lin(1, m1) + ' = 0') + ' folgt aber ' + M('x = ' + fh(r1)) + ' – das Vorzeichen dreht sich um.');
    else pushWrong(P, [Root(m1)], 'Vorzeichen! Aus ' + M(lin(1, m1) + ' = 0') + ' folgt ' + M('x = ' + fh(r1)) + '.');
    return P;
  }

  /* ---------- Weg: Quadratische Ergänzung (6 Schritte wie im Kapitel) ---------- */
  function ergSteps(rows, a, b, c, already2) {
    var p = div(b, a), q = div(c, a), h = div(p, 2), R = sub(sq(h), q), ah = abs(h);
    if (isOne(a)) rows.push(step(1, 'Normalform: Vor ' + M('x²') + ' steht schon eine 1 ✓'));
    else {
      rows.push(step(1, 'Normalform herstellen: die ganze Gleichung durch ' + M(fh(a)) + ' teilen' + (isInt(a) ? '.' : ' – das ist dasselbe wie mal ' + M(fh(div(1, a))) + '.')));
      rows.push(row(quad(a, b, c), '0', divOp(a)));
    }
    if (already2) rows.push(step(2, 'Die Zahl ohne ' + X + ' steht schon rechts ✓'));
    else {
      rows.push(step(2, M('q') + ' auf die andere Seite: Die Zahl ohne ' + X + ' kommt nach rechts.'));
      rows.push(row(quad(1, p, q), '0', '| ' + opTerm([[neg(q), '']])));
    }
    rows.push(step(3, 'Ergänzen – auf beiden Seiten: ' + M('(' + fh(abs(p)) + ' : 2)² = ' + sqShow(ah) + ' = ' + fh(sq(h))) + '.'));
    rows.push(row(quad(1, p, 0), fh(neg(q)), '| + ' + sqShow(ah)));
    rows.push(step(4, 'Als Binom schreiben (' + binName(h) + ' binomische Formel), rechts ausrechnen: ' + M(sumDisplay(neg(q), sq(h))) + '.'));
    rows.push(row(quad(1, p, 0) + ' + ' + fh(sq(h)), fh(neg(q)) + ' + ' + fh(sq(h)), '| Binom'));
    var n5, s = sgn(R) > 0 ? sqrtF(R) : null;
    if (sgn(R) < 0) n5 = step(5, 'Rechts steht eine <b>negative</b> Zahl. Ein Quadrat ist nie negativ → keine Lösung.');
    else if (sgn(R) === 0) n5 = step(5, 'Rechts steht 0. Ein Quadrat ist nur 0, wenn die Klammer 0 ist → genau eine Lösung.');
    else n5 = step(5, 'Wurzel ziehen – mit ±' + (s.rat && !isInt(R) ? ': ' + M('√' + fh(R) + ' = ' + fh(s.rat)) : '') + '.');
    fromSquare(rows, 1, h, R, { n5: n5, n6: step(6, 'Nach ' + X + ' auflösen, ' + M('L') + ' angeben.') });
    return { p: p, q: q, h: h, R: R };
  }
  function genErgaenzung(level) {
    var rows = [], P, v = 'std', h, s, q, already2 = false;
    function intCase(hl, sl) { do { h = rnz(-hl, hl); s = ri(1, sl); q = h * h - s * s; } while (q === 0); }
    if (level === 1) {
      intCase(6, 7);
      P = base('ergaenzung', 1, 1, 2 * h, q);
      if (chance(0.3)) { P.orig = [quad(1, 2 * h, 0), fh(-q)]; already2 = true; }
      else P.orig = [quad(1, 2 * h, q), '0'];
    } else if (level === 2) {
      v = pick(['a', 'a', 'keine', 'keine', 'umf', 'eine']);
      if (v === 'a') {
        var a = pick([F(2), F(3), F(-1), F(-2), F(1, 2)]);
        intCase(4, 5);
        P = base('ergaenzung', 2, a, mul(a, 2 * h), mul(a, q));
      } else if (v === 'keine') {
        var a2 = pick([1, 1, 2, -1]);
        h = rnz(-5, 5); q = h * h + ri(1, 9);
        P = base('ergaenzung', 2, a2, a2 * 2 * h, a2 * q);
      } else if (v === 'eine') {
        h = rnz(-6, 6); q = h * h;
        P = base('ergaenzung', 2, 1, 2 * h, q);
      } else {
        intCase(5, 6);
        P = base('ergaenzung', 2, 1, 2 * h, q);
        var c1 = rnz(-9, 9);
        P.orig = [quad(1, 0, c1), term([[-2 * h, 'x'], [c1 - q, '']])];
        rows.push(note(T('Zuerst alles auf die linke Seite bringen:')));
        rows.push(row(P.orig[0], P.orig[1], '| ' + opTerm([[2 * h, 'x'], [q - c1, '']])));
      }
    } else {
      v = pick(['odd', 'odd2', 'irr', 'irr', 'expand', 'oddkeine']);
      if (v === 'odd') {
        var o;
        do { o = intRoots(8, 60); } while ((o[0] + o[1]) % 2 === 0);
        P = base('ergaenzung', 3, 1, -(o[0] + o[1]), o[0] * o[1]);
      } else if (v === 'odd2') {
        var r1 = rnz(-4, 4), r2;
        do { r2 = F(2 * ri(-5, 4) + 1, 2); } while (Math.abs(val(r2) - r1) < 1);
        P = base('ergaenzung', 3, 2, mul(-2, add(r1, r2)), mul(2, mul(r1, r2)));
      } else if (v === 'irr') {
        var a3 = pick([1, 1, 1, 2, -1]), R;
        do { h = rnz(-5, 5); R = pick(NONSQ.filter(function (z) { return z <= 30; })); q = h * h - R; } while (q === 0);
        P = base('ergaenzung', 3, a3, a3 * 2 * h, a3 * q);
      } else if (v === 'expand') {
        var pp, qq;
        if (chance(0.5)) { var R2; do { h = rnz(-5, 5); R2 = pick([2, 3, 5, 6, 7, 8, 10, 11, 12, 13]); qq = h * h - R2; } while (qq === 0); pp = 2 * h; }
        else { var o2; do { o2 = intRoots(7, 40); } while ((o2[0] + o2[1]) % 2 === 0); pp = -(o2[0] + o2[1]); qq = o2[0] * o2[1]; }
        var u, w, k;
        do { u = rnz(-6, 6); w = pp - u; k = u * w - qq; } while (w === 0 || k === 0);
        P = base('ergaenzung', 3, 1, pp, qq);
        P.orig = ['(' + lin(1, u) + ')(' + lin(1, w) + ')', fh(k)];
        rows.push(note(T('Zuerst ausmultiplizieren und alles nach links bringen:')));
        rows.push(row(P.orig[0], P.orig[1], '| ausmultiplizieren'));
        rows.push(row(quad(1, pp, u * w), fh(k), '| ' + opTerm([[-k, '']])));
      } else {
        var po = pick([-5, -3, -1, 1, 3, 5]);
        P = base('ergaenzung', 3, 1, po, Math.floor(po * po / 4) + ri(1, 5));
      }
    }
    if (!P.orig) P.orig = [quad(P.a, P.b, P.c), '0'];
    var e = ergSteps(rows, P.a, P.b, P.c, already2);
    P.rows = rows;
    P.erg = e;
    P.sq = { k: 1, m: e.h, K: e.R };
    P.umf = v === 'umf' || v === 'expand';
    var allInt = P.roots.length > 0 && P.roots.every(function (r) { return !rootIrr(r) && isInt(r.r); });
    P.natural = !allInt;
    if (allInt && P.roots.length === 2) {
      P.post = '<p class="small muted tr-alt">Übrigens: Hier ginge auch der Produkt-Summen-Trick: ' +
        M('(' + lin(1, neg(P.roots[0].r)) + ')(' + lin(1, neg(P.roots[1].r)) + ') = 0') + '. Die Ergänzung klappt aber immer – auch wenn es keine ganzen Zahlen gibt.</p>';
    }
    P.q = 'Löse die Gleichung mit quadratischer Ergänzung.';
    var hp = !isOne(P.a) ? 'Teile zuerst durch ' + M(fh(P.a)) + '. ' : '';
    if (rows.length && rows[0].note && /Zuerst/.test(rows[0].note)) hp = 'Forme zuerst um, bis ' + M('x² + px + q = 0') + ' dasteht. ';
    P.hints = [
      hp + 'Bring die Zahl ohne ' + X + ' nach rechts und ergänze ' + M('(' + fh(abs(e.p)) + ' : 2)² = ' + fh(sq(e.h))) + ' auf <b>beiden</b> Seiten.',
      'Nach dem Ergänzen steht da: ' + M('(' + lin(1, e.h) + ')² = ' + fh(e.R)) + '. ' + (sgn(e.R) < 0 ? 'Schau dir die rechte Seite genau an!' : sgn(e.R) === 0 ? 'Rechts steht 0 …' : 'Jetzt Wurzel ziehen – an ± denken!')
    ];
    // häufiger Fehler: Ergänzung rechts vergessen → (x + h)² = −q
    if (sgn(neg(e.q)) > 0) {
      var forgot = solveNF(e.p, add(e.q, sq(e.h))).roots; // (x+h)² = −q  ⇔  x² + px + (h² + q) = 0
      if (forgot.length) pushWrong(P, forgot, 'Hast du die Ergänzung ' + M(fh(sq(e.h))) + ' auch auf der <b>rechten</b> Seite addiert? Was du links ergänzt, musst du rechts auch addieren.');
    }
    signWrong(P);
    return P;
  }

  /* ---------- Weg: Grafisch ablesen ---------- */
  function plotWindow(xs, ys) {
    var xmin = Math.floor(Math.min.apply(null, xs) - 2), xmax = Math.ceil(Math.max.apply(null, xs) + 2);
    xmin = Math.min(xmin, -1); xmax = Math.max(xmax, 1);
    while (xmax - xmin < 7) { xmin--; if (xmax - xmin < 7) xmax++; }
    var ymin = Math.floor(Math.min.apply(null, ys)), ymax = Math.ceil(Math.max.apply(null, ys));
    var w = xmax - xmin, hgt = ymax - ymin;
    return { xmin: xmin, xmax: xmax, ymin: ymin, ymax: ymax, yscale: hgt > w ? Math.max(0.55, Math.round(100 * w / hgt) / 100) : 1 };
  }
  function genGrafisch(level) {
    if (level === 3) return genGrafischGerade();
    var kind = level === 1 ? 'zwei' : pick(['zwei', 'zwei', 'zwei', 'zwei', 'zwei', 'zwei', 'keine', 'keine', 'eine', 'eine']);
    var a, d, e, roots = [], form = 'std', g;
    if (kind === 'zwei') {
      if (level === 1) {
        var r1, r2;
        do { r1 = ri(-5, 5); r2 = ri(-5, 5); } while (r2 - r1 < 2 || r2 - r1 > 5);
        a = F(1); roots = [F(r1), F(r2)];
      } else {
        g = pick(['a2', 'am1', 'half', 'mhalf', 'vertex', 'vertex']);
        if (g === 'a2') {
          var ri1, rh;
          do { ri1 = ri(-3, 3); rh = F(2 * ri(-4, 3) + 1, 2); } while (Math.abs(val(rh) - ri1) < 1.5 || Math.abs(val(rh) - ri1) > 3.5);
          a = F(2); roots = [F(ri1), rh];
        } else if (g === 'am1') {
          var s1, s2;
          do { s1 = ri(-5, 5); s2 = ri(-5, 5); } while (s2 - s1 < 2 || s2 - s1 > 5);
          a = F(-1); roots = [F(s1), F(s2)];
        } else if (g === 'half' || g === 'mhalf') {
          var t1, t2;
          do { t1 = ri(-5, 5); t2 = ri(-5, 5); } while ([2, 4, 6].indexOf(t2 - t1) < 0);
          a = F(g === 'half' ? 1 : -1, 2); roots = [F(t1), F(t2)];
        } else {
          a = F(1); d = rnz(-3, 3); var sv = ri(1, 3); e = F(-sv * sv); d = F(d);
          roots = [sub(d, sv), add(d, sv)]; form = 'vertex';
        }
      }
      roots.sort(function (x, y) { return val(x) - val(y); });
      if (!d) { d = div(add(roots[0], roots[1]), 2); e = mul(a, mul(sub(d, roots[0]), sub(d, roots[1]))); }
    } else if (kind === 'eine') {
      a = F(pick([1, -1])); d = F(rnz(-4, 4)); e = F(0); roots = [d];
    } else {
      a = F(pick([1, 1, -1, 2])); d = F(ri(-3, 3)); e = mul(sgn(a), ri(1, 3));
      if (chance(0.5) && !isZ(d)) form = 'vertex';
    }
    // a(x − d)² + e = ax² − 2ad·x + ad² + e
    var b = mul(mul(-2, a), d), c = add(mul(a, sq(d)), e);
    var P = base('grafisch', level, a, b, c);
    var fx = form === 'vertex' ? term([[a, '(' + lin(1, neg(d)) + ')²'], [e, '']]) : quad(a, b, c);
    P.orig = [fx, '0'];
    P.fForm = form;
    var xs = roots.map(val).concat([val(d)]), ys = [0, val(e)];
    if (sgn(a) > 0) ys.push(val(e) + 3, 3, -1); else ys.push(val(e) - 3, -3, 1);
    var W = plotWindow(xs, ys);
    if (sgn(a) > 0) { W.ymin = Math.min(W.ymin, Math.floor(val(e)) - 1); } else { W.ymax = Math.max(W.ymax, Math.ceil(val(e)) + 1); }
    var anyHalf = roots.some(function (r) { return !isInt(r); }) || !isInt(d);
    var fn = { a: val(a), b: val(b), c: val(c), color: 'blue' };
    P.plot = Object.assign({}, W, { minor: anyHalf, fns: [fn], points: [], lines: [], label: 'Graph der Funktion f' });
    var pts = [];
    if (roots.length === 2) {
      pts.push({ x: val(roots[0]), y: 0, label: 'N₁', pos: 'nw', color: 'red' });
      pts.push({ x: val(roots[1]), y: 0, label: 'N₂', pos: 'ne', color: 'red' });
    } else if (roots.length === 1) pts.push({ x: val(roots[0]), y: 0, label: 'B', pos: sgn(a) > 0 ? 'se' : 'ne', color: 'red' });
    else pts.push({ x: val(d), y: val(e), label: 'S', pos: sgn(a) > 0 ? 's' : 'n', color: 'violet' });
    P.solPlot = Object.assign({}, P.plot, { points: pts, label: 'Graph mit markierten Lösungen' });
    var rows = [], rts = roots.map(function (r) { return Root(r); });
    var sub2 = function (r) {
      if (form === 'vertex') {
        var inner = fdec(r) + (sgn(d) > 0 ? ' − ' + fdec(d) : ' + ' + fdec(neg(d)));
        return joinParts([[sgn(a) < 0, (isOne(abs(a)) ? '' : fh(abs(a)) + ' · ') + '(' + inner + ')²']].concat(isZ(e) ? [] : [[sgn(e) < 0, fh(abs(e))]]));
      }
      return subst(a, b, c, r, fdec);
    };
    var S = M('S(' + fdec(d) + ' | ' + fdec(e) + ')');
    if (roots.length === 2) {
      P.pre = '<p>Die Lösungen sind die <b>Nullstellen</b>: die Stellen, an denen die Parabel die ' + X + '-Achse schneidet.</p>';
      rows.push(note(T('Ablesen:')));
      rows.push(row('x1', fdec(roots[0]), '', 'one'));
      rows.push(row('x2', fdec(roots[1]), '', 'one'));
    } else if (roots.length === 1) {
      P.pre = '<p>Die Parabel <b>berührt</b> die ' + X + '-Achse nur in ihrem Scheitelpunkt ' + M('S(' + fdec(d) + ' | 0)') + '. Also gibt es genau eine Lösung.</p>';
      rows.push(note(T('Ablesen:')));
      rows.push(row('x', fdec(roots[0]), '', 'all'));
    } else {
      P.pre = '<p>Die Parabel ist nach ' + (sgn(a) > 0 ? 'oben' : 'unten') + ' geöffnet und ihr Scheitelpunkt ' + S + ' liegt ' + (sgn(a) > 0 ? 'über' : 'unter') +
        ' der ' + X + '-Achse. Sie trifft die ' + X + '-Achse also nie – es gibt <b>keine</b> Lösung.</p>';
    }
    if (roots.length) {
      rows.push(note(T('<b>Probe</b> – einsetzen muss 0 ergeben:')));
      roots.forEach(function (r) { rows.push(row(sub2(r), '0 ✓', '', 'num')); });
    }
    P.rows = rows;
    P.roots = rts;
    P.dec = true;
    P.q = 'Die Abbildung zeigt den Graphen von ' + M('f(x) = ' + fx) + '. Lies die Lösungen der Gleichung ab.';
    P.hints = [
      'Gesucht sind die Stellen, an denen die Parabel die ' + X + '-Achse schneidet oder berührt (die Nullstellen). Lies nur den ' + X + '-Wert ab.',
      (roots.length === 0
        ? 'Der Scheitelpunkt ist ' + S + ' und die Parabel ist nach ' + (sgn(a) > 0 ? 'oben' : 'unten') + ' geöffnet. Kann sie die ' + X + '-Achse dann überhaupt treffen?'
        : roots.length === 1
          ? 'Schau dir den Scheitelpunkt an: Er liegt genau auf der ' + X + '-Achse. Wie viele gemeinsame Punkte haben Parabel und ' + X + '-Achse dann?'
          : F(d).d <= 2 && F(e).d <= 2
            ? 'Der Scheitelpunkt ist ' + S + '. Die Parabel ist symmetrisch: Die Nullstellen liegen gleich weit links und rechts davon. Prüf deine Werte mit der Probe!'
        : 'Nutze das feine Raster: Ein kleines Kästchen ist 0,5 breit. Lies genau ab, wo die Parabel die ' + X + '-Achse kreuzt, und prüf deine Werte mit der Probe!')
    ];
    signWrong(P);
    return P;
  }
  function genGrafischGerade() {
    var kind = pick(['zwei', 'zwei', 'zwei', 'zwei', 'zwei', 'zwei', 'eine', 'eine', 'keine', 'keine']);
    var m, n, roots = [];
    if (kind === 'zwei') {
      var r1, r2;
      do { r1 = ri(-3, 3); r2 = ri(-3, 3); } while (r1 >= r2 || (r1 + r2 === 0 && r1 * r2 === 0));
      m = r1 + r2; n = -r1 * r2; roots = [r1, r2];
    } else if (kind === 'eine') {
      var dd = rnz(-2, 2); m = 2 * dd; n = -dd * dd; roots = [dd];
    } else {
      m = ri(-2, 2); n = Math.floor(-m * m / 4) - ri(1, 3);
    }
    var P = base('grafisch', 3, 1, -m, -n);
    var line = term([[m, 'x'], [n, '']]);
    var rows = [];
    if (chance(0.5)) {
      P.orig = [quad(1, -m, -n), '0'];
      rows.push(row(P.orig[0], '0', '| ' + opTerm([[m, 'x'], [n, '']])));
    } else {
      var c1 = rnz(-5, 5);
      P.orig = [quad(1, 0, c1), term([[m, 'x'], [n + c1, '']])];
      rows.push(row(P.orig[0], P.orig[1], '| ' + opTerm([[-c1, '']])));
    }
    rows.push(row('x²', line, '', 'eq'));
    rows.push(note(T('Links: Normalparabel ' + M('y = x²') + '. Rechts: Gerade ' + M('y = ' + line) + '. Gesucht sind die ' + X + '-Werte der Schnittpunkte.')));
    var maxR2 = roots.reduce(function (mx, r) { return Math.max(mx, r * r); }, 0);
    var W = { xmin: -4, xmax: 4, ymin: -3, ymax: Math.max(5, maxR2 + 1) };
    if (n - 1 < W.ymin && m === 0) W.ymin = n - 1; // waagerechte Gerade nicht auf den Rand legen
    W.yscale = (W.ymax - W.ymin) > 8 ? Math.max(0.6, Math.round(100 * 8 / (W.ymax - W.ymin)) / 100) : 1;
    P.plot = Object.assign({}, W, {
      minor: false, label: 'Normalparabel und Gerade',
      fns: [{ a: 1, b: 0, c: 0, color: 'blue' }, { a: 0, b: m, c: n, color: 'orange' }], points: [], lines: []
    });
    var pts = [], lns = [];
    roots.forEach(function (r, i) {
      pts.push({ x: r, y: r * r, label: roots.length === 1 ? 'B' : 'S' + (i ? '₂' : '₁'), pos: r < 0 ? 'nw' : r > 0 ? 'ne' : 'n', color: 'red' });
      if (r !== 0) lns.push({ x1: r, y1: 0, x2: r, y2: r * r, color: 'red', dash: true });
    });
    P.solPlot = Object.assign({}, P.plot, { points: pts, lines: lns, label: 'Schnittpunkte markiert' });
    if (roots.length === 2) {
      rows.push(row('x1', fh(roots[0]), '', 'one'));
      rows.push(row('x2', fh(roots[1]), '', 'one'));
    } else if (roots.length === 1) {
      rows.push(note(T('Die Gerade berührt die Parabel nur in einem Punkt:')));
      rows.push(row('x', fh(roots[0]), '', 'all'));
    } else {
      rows.push(note(T('Parabel und Gerade schneiden sich nicht → keine Lösung.')));
    }
    if (roots.length) {
      rows.push(note(T('<b>Probe</b> in ' + M('x² = ' + line) + ' – links und rechts muss dasselbe herauskommen:')));
      roots.forEach(function (r) {
        var rhs = joinParts([[m < 0, m === 0 ? '' : (Math.abs(m) === 1 ? '' : Math.abs(m) + ' · ') + par(r)]].filter(function () { return m !== 0; })
          .concat(n ? [[n < 0, String(Math.abs(n))]] : []));
        rows.push(row(par(r) + '²', (m === 0 ? fh(n) : rhs + ' = ' + fh(r * r)) + ' ✓', '', 'num'));
      });
    }
    P.rows = rows;
    P.roots = rationalRoots(roots);
    P.lineHtml = line;
    P.q = 'Löse die Gleichung grafisch mit der Normalparabel (blau) und einer Geraden (orange).';
    P.hints = [
      'Stell die Gleichung so um, dass links nur noch ' + M('x²') + ' steht. Links hast du dann die Normalparabel, rechts die Gerade.',
      'Die Gerade ist ' + M('y = ' + line) + '. Lies die ' + X + '-Werte der Schnittpunkte ab – nicht die ' + M('y') + '-Werte!'
    ];
    if (roots.length) pushWrong(P, rationalRoots(roots.map(function (r) { return r * r; }).filter(function (v, i, arr) { return arr.indexOf(v) === i; })),
      'Das sind die <b>' + M('y') + '-Werte</b> der Schnittpunkte. Gesucht sind die ' + X + '-Werte!');
    signWrong(P);
    return P;
  }

  /* ---------- Zusammenbau ---------- */
  var GEN = { grafisch: genGrafisch, ausklammern: genAusklammern, wurzel: genWurzel, binomisch: genBinomisch, vieta: genVieta, ergaenzung: genErgaenzung };
  var MIX_WEIGHTS = [['grafisch', 1], ['ausklammern', 2], ['wurzel', 2], ['binomisch', 2], ['vieta', 2], ['ergaenzung', 2]];
  function pickWeighted() {
    var tot = MIX_WEIGHTS.reduce(function (s, w) { return s + w[1]; }, 0), r = rnd() * tot;
    for (var i = 0; i < MIX_WEIGHTS.length; i++) { r -= MIX_WEIGHTS[i][1]; if (r < 0) return MIX_WEIGHTS[i][0]; }
    return 'vieta';
  }
  var LEVEL_NOTE = {
    1: '',
    2: '<p class="small muted tr-input-note">Brüche gibst du als <span class="nomath">3/2</span> ein, „keine Lösung“ mit der Taste unten.</p>',
    3: '<p class="small muted tr-input-note">Eingabe: Brüche als <span class="nomath">3/2</span>, Wurzeln als <span class="nomath">√5</span> oder <span class="nomath">2 ± √3</span>, „keine Lösung“ mit der Taste unten.</p>'
  };

  function finalize(P, mixed) {
    var W = WEGE[P.weg];
    P.mixed = !!mixed;
    if (P.umf && P.weg !== 'grafisch') P.why = 'Erst umformen (ausmultiplizieren, sortieren). Danach siehst du: ' + P.why;
    P.answer = answerOf(P.roots);
    P.rows.push({ l: 'L', r: setHtml(P.roots, P.dec ? fdec : fh), op: '', chk: 'L', cls: 'result' });
    P.Lhtml = 'L = ' + setHtml(P.roots, P.dec ? fdec : fh);
    P.eqHtml = P.orig[0] + ' = ' + P.orig[1];
    P.label = mixed ? 'Gemischt' : W.name;
    var isGraph = P.weg === 'grafisch';
    P.qHtml = mixed && !isGraph ? 'Löse die Gleichung. Welcher Weg passt hier am besten?' : P.q;
    P.body = '<div class="mblock">' + P.eqHtml + '</div>' +
      (isGraph ? '<div class="qg-plot-wrap tr-plot" data-tr-plot="task"></div>' : '') +
      (isGraph && P.level === 3 ? '<p class="small muted tr-legend"><span class="tr-key blue" aria-hidden="true"></span>Normalparabel <span class="m">y = x²</span> <span class="tr-key orange" aria-hidden="true"></span>Gerade</p>' : '') +
      (LEVEL_NOTE[P.level] || '');
    var head = mixed ? '<p class="tr-best"><span class="pill ' + W.color + '">Passender Weg: ' + W.html + '</span> ' + P.why + '</p>' : '';
    P.solution = head + (P.pre || '') + (P.solPlot ? '<div class="qg-plot-wrap tr-plot" data-tr-plot="sol"></div>' : '') + calcHtml(P.rows) + (P.post || '');
    P.hintsOut = mixed ? ['<b>Welcher Weg?</b> ' + P.why, P.hints[1]] : P.hints.slice();
    return P;
  }

  /** Neue Aufgabe: weg ∈ WEG_IDS oder 'gemischt', level 1–3 */
  function generate(weg, level) {
    level = Math.max(1, Math.min(3, parseInt(level, 10) || 1));
    if (weg === 'gemischt') {
      var P = null;
      for (var i = 0; i < 80; i++) {
        P = GEN[pickWeighted()](level);
        if (P.natural) break;
      }
      return finalize(P, true);
    }
    if (!GEN[weg]) weg = 'vieta';
    return finalize(GEN[weg](level), false);
  }

  var TR = {
    generate: generate, WEG_IDS: WEG_IDS, WEGE: WEGE,
    setRandom: function (fn) { rnd = fn || Math.random; },
    _: { rowHtml: rowHtml, F: F, add: add, sub: sub, mul: mul, div: div, val: val, solveNF: solveNF, sqrtF: sqrtF, rootVal: rootVal, rootHtml: rootHtml, rootPlain: rootPlain, quad: quad, term: term, fh: fh, fdec: fdec, calcHtml: calcHtml }
  };
  if (typeof module === 'object' && module && module.exports) module.exports = TR;
  if (typeof window === 'undefined' || typeof document === 'undefined' || !window.QG) return;

  /* =====================================================================
     Teil 2 · Widget „trainer“
     ===================================================================== */
  var Q = window.QG;
  var KEY = { cfg: 'train:cfg', stats: 'train:stats', streak: 'train:streak', turbo: 'train:turbo' };
  var LEVEL_DESC = {
    1: 'Normalform, ganzzahlige Lösungen – zum Warmwerden.',
    2: 'Mit Vorfaktor <span class="m">a ≠ 1</span> oder erst umformen. Auch mal keine oder nur eine Lösung.',
    3: 'Brüche, Wurzeln, erst ausmultiplizieren – knifflig, aber machbar.'
  };
  var BADGES = [
    { n: 5, icon: '🔥', name: '5er-Serie' },
    { n: 10, icon: '🏆', name: '10er-Serie' },
    { n: 20, icon: '👑', name: '20er-Serie' }
  ];
  var TURBO_N = 5, TURBO_SKIP = 30000;

  function fmtTime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function plotOpts(spec, withMarks) {
    return {
      xmin: spec.xmin, xmax: spec.xmax, ymin: spec.ymin, ymax: spec.ymax, minor: spec.minor, yscale: spec.yscale, grid: true,
      label: spec.label,
      fns: spec.fns.map(function (f) { return { f: function (x) { return f.a * x * x + f.b * x + f.c; }, color: f.color }; }),
      points: withMarks ? spec.points : [],
      lines: withMarks ? spec.lines : []
    };
  }

  Q.widget('trainer', function (el) {
    var sec = el.closest('.chapter') || document;
    var host = el.querySelector('.tr-host');
    var statusEl = el.querySelector('.tr-status');
    var turboEl = el.querySelector('.tr-turbo');
    var actions = el.querySelector('.tr-actions');
    var statsEl = sec.querySelector('[data-tr-stats]');
    var levelDesc = el.querySelector('[data-tr-leveldesc]');

    var cfg = Q.store.get(KEY.cfg, null) || {};
    if (!WEGE[cfg.weg]) cfg.weg = 'gemischt';
    if (!(cfg.level >= 1 && cfg.level <= 3)) cfg.level = 1;
    var stats = Q.store.get(KEY.stats, null) || {};
    WEG_IDS.forEach(function (w) { if (!stats[w] || typeof stats[w].n !== 'number') stats[w] = { ok: 0, n: 0 }; });
    var streak = Q.store.get(KEY.streak, null) || {};
    streak = { cur: streak.cur | 0, best: streak.best | 0, badges: Array.isArray(streak.badges) ? streak.badges : [] };
    var turboBest = Q.store.get(KEY.turbo, null) || {};

    var cur = null, seq = 0, turbo = null, timer = null, lastEq = {};

    // alte Trainings-IDs aus dem Gelöst-Speicher entfernen (zählen ohnehin nicht)
    try { Q.resetProgress('train-'); } catch (e) { /* egal */ }

    /* ---- Chips ---- */
    var chips = Array.prototype.slice.call(el.querySelectorAll('.tr-chip'));
    function renderChips() {
      chips.forEach(function (b) {
        var g = b.parentNode.getAttribute('data-tr-group');
        var on = g === 'weg' ? b.dataset.value === cfg.weg : +b.dataset.value === cfg.level;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.disabled = !!turbo;
      });
      if (levelDesc) { levelDesc.innerHTML = LEVEL_DESC[cfg.level]; Q.math(levelDesc); }
    }
    chips.forEach(function (b) {
      b.addEventListener('click', function () {
        if (turbo) return;
        var g = b.parentNode.getAttribute('data-tr-group');
        if (g === 'weg') { if (cfg.weg === b.dataset.value) return; cfg.weg = b.dataset.value; }
        else { if (cfg.level === +b.dataset.value) return; cfg.level = +b.dataset.value; }
        Q.store.set(KEY.cfg, cfg);
        renderChips();
        newTask();
      });
    });

    /* ---- Serie & Abzeichen ---- */
    function saveStreak() { Q.store.set(KEY.streak, streak); }
    function renderStatus(pop) {
      var next = BADGES.filter(function (b) { return streak.cur < b.n; })[0];
      statusEl.innerHTML =
        '<div class="tr-streak' + (streak.cur > 0 ? ' on' : '') + (streak.cur >= 5 ? ' hot' : '') + (pop ? ' pop' : '') + '"><span class="tr-flame" aria-hidden="true">🔥</span>' +
        '<span><b>' + streak.cur + '</b> in Folge</span></div>' +
        '<div class="tr-best">Rekord: <b>' + streak.best + '</b>' + (next ? ' · nächstes Ziel: ' + next.n : '') + '</div>' +
        '<div class="tr-badges" aria-label="Abzeichen">' + BADGES.map(function (b) {
          var got = streak.badges.indexOf(b.n) >= 0;
          return '<span class="tr-badge' + (got ? ' got' : '') + '" title="' + b.name + (got ? ' – geschafft!' : ' – noch nicht') + '">' +
            '<span aria-hidden="true">' + b.icon + '</span><span class="sr-only">' + b.name + (got ? ' erreicht' : ' noch nicht erreicht') + '</span></span>';
        }).join('') + '</div>';
    }
    function streakUp() {
      streak.cur++;
      if (streak.cur > streak.best) streak.best = streak.cur;
      var reward = streak.cur % 5 === 0;
      BADGES.forEach(function (b) {
        if (streak.cur === b.n && streak.badges.indexOf(b.n) < 0) streak.badges.push(b.n);
      });
      saveStreak();
      renderStatus(reward);
      if (reward) {
        var b = BADGES.filter(function (x) { return x.n === streak.cur; })[0];
        var msg = b ? b.icon + ' ' + b.name + '! ' + (b.n === 5 ? 'Du bist heiß gelaufen.' : b.n === 10 ? 'Zehn am Stück – stark!' : 'Unaufhaltsam!')
          : '🔥 ' + streak.cur + ' in Folge – weiter so!';
        Q.toast(msg, { type: 'ok', ms: 3400 });
        Q.celebrate(statusEl);
      }
    }
    function breakStreak() {
      if (!streak.cur) return;
      streak.cur = 0;
      saveStreak();
      renderStatus();
    }

    /* ---- Statistik ---- */
    function saveStats() { Q.store.set(KEY.stats, stats); }
    function renderStats() {
      if (!statsEl) return;
      var tot = { ok: 0, n: 0 };
      var html = '<div class="tr-stats">' + WEG_IDS.map(function (w) {
        var s = stats[w], W = WEGE[w];
        tot.ok += s.ok; tot.n += s.n;
        var pct = s.n ? Math.round(100 * s.ok / s.n) : 0;
        return '<div class="tr-stat" data-c="' + W.color + '"><span class="tr-stat-name">' + W.html + '</span>' +
          '<span class="tr-stat-bar" aria-hidden="true"><span style="width:' + pct + '%"></span></span>' +
          '<span class="tr-stat-num">' + s.ok + '/' + s.n + '</span></div>';
      }).join('') + '</div>';
      var tried = WEG_IDS.filter(function (w) { return stats[w].n >= 3; });
      var weakest = tried.sort(function (x, y) { return stats[x].ok / stats[x].n - stats[y].ok / stats[y].n; })[0];
      var untried = WEG_IDS.filter(function (w) { return stats[w].n === 0; });
      var tip = '';
      if (tot.n === 0) tip = 'Noch keine Aufgaben gerechnet. Leg los – die Statistik füllt sich von allein.';
      else if (untried.length) tip = 'Noch gar nicht geübt: ' + untried.map(function (w) { return '<button type="button" class="tr-link" data-tr-go="' + w + '">' + WEGE[w].html + '</button>'; }).join(', ') + '.';
      else if (weakest && stats[weakest].ok / stats[weakest].n < 0.8) tip = 'Dein Übungstipp: <button type="button" class="tr-link" data-tr-go="' + weakest + '">' + WEGE[weakest].html + '</button> – da geht noch was.';
      else if (weakest) tip = 'Alle Wege laufen gut. Probier Stufe ' + Math.min(3, cfg.level + 1) + ' oder die Turbo-Runde!';
      statsEl.innerHTML = html +
        '<p class="tr-total"><b>Gesamt: ' + tot.ok + ' von ' + tot.n + '</b> richtig' + (tot.n ? ' (' + Math.round(100 * tot.ok / tot.n) + ' %)' : '') + '</p>' +
        (tip ? '<p class="tr-tip">' + tip + '</p>' : '') +
        '<div class="btn-row"><button type="button" class="btn ghost" data-tr-reset>Statistik zurücksetzen</button></div>';
      Q.math(statsEl);
    }
    if (statsEl) {
      statsEl.addEventListener('click', function (e) {
        var go = e.target.closest('[data-tr-go]');
        if (go && !turbo) {
          cfg.weg = go.getAttribute('data-tr-go');
          Q.store.set(KEY.cfg, cfg);
          renderChips(); newTask();
          el.scrollIntoView({ block: 'start', behavior: 'smooth' });
          return;
        }
        var rs = e.target.closest('[data-tr-reset]');
        if (!rs) return;
        if (!rs.classList.contains('confirm')) {
          rs.classList.add('confirm');
          rs.textContent = 'Wirklich alles zurücksetzen?';
          setTimeout(function () { if (rs.isConnected) { rs.classList.remove('confirm'); rs.textContent = 'Statistik zurücksetzen'; } }, 3500);
          return;
        }
        WEG_IDS.forEach(function (w) { stats[w] = { ok: 0, n: 0 }; });
        streak = { cur: 0, best: 0, badges: [] };
        turboBest = {};
        saveStats(); saveStreak(); Q.store.set(KEY.turbo, turboBest);
        renderStats(); renderStatus();
        Q.toast('Statistik zurückgesetzt.');
      });
    }

    function countTry() {
      if (!cur || cur.counted) return;
      cur.counted = true;
      stats[cur.weg].n++;
      saveStats(); renderStats();
    }

    /* ---- Aufgaben ---- */
    function drawPlots(t, P) {
      if (!P.plot) return;
      var a = t.querySelector('[data-tr-plot="task"]'), b = t.querySelector('[data-tr-plot="sol"]');
      if (a) Q.plot(a, plotOpts(P.plot, false));
      if (b) Q.plot(b, plotOpts(P.solPlot || P.plot, true));
    }
    function newTask() {
      if (cur && !cur.solved && cur.counted && !turbo) breakStreak(); // aufgegeben
      if (cur && cur.id) Q.unmarkSolved(cur.id);
      var P;
      try {
        for (var k = 0; k < 12; k++) {
          P = generate(cfg.weg, cfg.level);
          if (!lastEq[P.eqHtml]) break;
        }
        lastEq[P.eqHtml] = 1;
        var keys = Object.keys(lastEq); if (keys.length > 15) delete lastEq[keys[0]];
      }
      catch (err) { console.error('[Training] Generator-Fehler', err); P = generate('vieta', 1); }
      var id = 'train-' + (++seq) + '-' + Date.now().toString(36);
      var t = Q.task({
        id: id, q: P.qHtml, body: P.body, answer: P.answer, hints: P.hintsOut, solution: P.solution,
        wrong: P.wrong, level: P.level,
        label: turbo ? '⚡ Turbo ' + (turbo.i + 1) + '/' + TURBO_N : (P.mixed ? '🎲 ' : '') + P.label
      });
      t.classList.add('tr-task');
      t.setAttribute('data-weg', P.weg);
      host.innerHTML = '';
      host.appendChild(t);
      drawPlots(t, P);
      cur = { P: P, el: t, id: id, weg: P.weg, counted: false, peeked: false, solved: false };
      var me = cur;
      var sol = t.querySelector(':scope > details.solution');
      if (sol) sol.addEventListener('toggle', function () {
        if (!sol.open || me.solved || me !== cur) return;
        if (!me.peeked) { me.peeked = true; countTry(); breakStreak(); }
      });
      var r = host.getBoundingClientRect();
      if (r.top < 60 || r.top > innerHeight - 160) host.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    Q.on('task', function (ev) {
      if (!cur || ev.el !== cur.el || cur.solved) return;
      countTry();
      if (ev.ok) {
        cur.solved = true;
        var clean = !cur.peeked;
        if (clean) { stats[cur.weg].ok++; saveStats(); renderStats(); }
        if (clean && ev.attempts === 1) streakUp(); else breakStreak();
        if (turbo) {
          if (clean && ev.attempts === 1) turbo.first++;
          turbo.i++;
          renderTurbo();
          if (turbo.i >= TURBO_N) setTimeout(finishTurbo, 700);
          else setTimeout(function () { if (turbo) newTask(); }, 1100);
        }
      } else if (ev.attempts === 1) breakStreak();
    });

    /* ---- Turbo-Runde ---- */
    function renderTurbo() {
      if (!turbo) { turboEl.hidden = true; actions.hidden = false; return; }
      turboEl.hidden = false; actions.hidden = true;
      var dots = '';
      for (var i = 0; i < TURBO_N; i++) dots += '<span class="tr-dot' + (i < turbo.i ? ' done' : i === turbo.i ? ' now' : '') + '"></span>';
      turboEl.querySelector('.tr-dots').innerHTML = dots;
      turboEl.querySelector('.tr-dots').setAttribute('aria-label', turbo.i + ' von ' + TURBO_N + ' geschafft');
      tick();
    }
    function tick() {
      if (!turbo) return;
      var t = Date.now() - turbo.t0 + turbo.pen;
      turboEl.querySelector('.tr-time').textContent = fmtTime(t);
    }
    function startTurbo() {
      if (cur && !cur.solved && cur.counted) breakStreak();
      turbo = { i: 0, t0: Date.now(), pen: 0, first: 0, skipped: 0 };
      renderChips(); renderTurbo();
      clearInterval(timer);
      timer = setInterval(tick, 250);
      cur = null;
      newTask();
    }
    function stopTurbo() {
      clearInterval(timer); timer = null;
      turbo = null;
      renderChips(); renderTurbo();
    }
    function finishTurbo() {
      if (!turbo) return;
      var ms = Date.now() - turbo.t0 + turbo.pen, res = turbo;
      var key = cfg.weg + '-' + cfg.level, best = turboBest[key];
      var record = !best || ms < best;
      if (record) { turboBest[key] = ms; Q.store.set(KEY.turbo, turboBest); }
      stopTurbo();
      if (cur && cur.id) Q.unmarkSolved(cur.id);
      cur = null;
      host.innerHTML = '<div class="card tr-result" tabindex="-1">' +
        '<p class="tr-result-icon" aria-hidden="true">⚡</p>' +
        '<h3>Turbo-Runde geschafft!</h3>' +
        '<p class="tr-result-time">' + fmtTime(ms) + '</p>' +
        '<p>' + res.first + ' von ' + TURBO_N + ' Aufgaben beim ersten Versuch richtig' +
        (res.skipped ? ' · ' + res.skipped + '× übersprungen (je +30 s)' : '') + '.</p>' +
        '<p class="tr-record">' + (record ? (best ? '🎉 Neue Bestzeit! Vorher: ' + fmtTime(best) : '🎉 Deine erste Bestzeit für diese Auswahl!') : 'Deine Bestzeit: ' + fmtTime(best)) + '</p>' +
        '<p class="small muted">' + WEGE[cfg.weg].html + ' · Stufe ' + cfg.level + '</p>' +
        '<div class="btn-row"><button type="button" class="btn primary" data-tr-again>⚡ Nochmal</button>' +
        '<button type="button" class="btn" data-tr-normal>Normal weiterüben</button></div></div>';
      Q.math(host);
      var card = host.firstChild;
      card.focus({ preventScroll: true });
      if (record) Q.celebrate(card);
      card.querySelector('[data-tr-again]').addEventListener('click', startTurbo);
      card.querySelector('[data-tr-normal]').addEventListener('click', newTask);
    }

    el.querySelector('[data-tr-new]').addEventListener('click', newTask);
    el.querySelector('[data-tr-turbo]').addEventListener('click', startTurbo);
    turboEl.querySelector('[data-tr-skip]').addEventListener('click', function () {
      if (!turbo || !cur || cur.solved) return; // gelöste Aufgabe: nächste kommt ohnehin gleich
      countTry(); breakStreak();
      turbo.pen += TURBO_SKIP; turbo.skipped++; turbo.i++;
      renderTurbo();
      Q.toast('+30 Sekunden Strafzeit');
      if (turbo.i >= TURBO_N) finishTurbo(); else newTask();
    });
    turboEl.querySelector('[data-tr-stop]').addEventListener('click', function () {
      stopTurbo();
      Q.toast('Turbo-Runde abgebrochen.');
      newTask();
    });
    Q.on('chapter', function (id) { if (id !== 'training' && turbo) { stopTurbo(); newTask(); } });

    renderChips();
    renderStatus();
    renderStats();
    newTask();
  });
})();

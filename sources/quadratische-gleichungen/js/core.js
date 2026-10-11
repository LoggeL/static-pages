/* Quadratische Gleichungen ohne Formel · Core
   Eine IIFE, keine Abhängigkeiten. Setzt window.QG.
   Reine Funktionen (Parser, Formatierung) sind zusätzlich per module.exports testbar. */
(function () {
  'use strict';

  /* =====================================================================
     1. Reine Hilfsfunktionen (ohne DOM)
     ===================================================================== */
  var MINUS = '−';
  var EPS = 1e-9;

  function roundTo(x, d) { var f = Math.pow(10, d); return Math.round(x * f) / f; }

  /** Deutsche Zahl: Komma, echtes Minus, max. 2 Nachkommastellen. */
  function fmt(x, digits) {
    if (typeof x !== 'number') x = Number(x);
    if (!isFinite(x)) return String(x);
    var d = digits == null ? 2 : digits;
    var r = roundTo(x, d);
    if (Math.abs(r) < 1e-12) r = 0;
    var s = Math.abs(r).toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return (r < 0 ? MINUS : '') + s.replace('.', ',');
  }

  /** Bruch-HTML, wenn x ein einfacher Bruch ist (Nenner ≤ maxDen), sonst fmt(x). */
  function fmtFrac(x, maxDen) {
    if (typeof x !== 'number') x = Number(x);
    if (!isFinite(x)) return String(x);
    var md = maxDen || 12;
    for (var d = 1; d <= md; d++) {
      var n = x * d;
      if (Math.abs(n - Math.round(n)) < 1e-9) {
        n = Math.round(n);
        if (d === 1) return fmt(n);
        return (n < 0 ? MINUS : '') + '<span class="frac"><span>' + Math.abs(n) + '</span><span>' + d + '</span></span>';
      }
    }
    return fmt(x);
  }

  /** "+ 3" bzw. "− 3" für Terme. */
  function sign(x, f) {
    var form = f || fmt;
    return (x < 0 ? MINUS + ' ' : '+ ') + form(Math.abs(x));
  }

  /** Hübscher Term a·x² + b·x + c als HTML (1-Koeffizienten und Nullterme weggelassen). */
  function poly(a, b, c, opt) {
    opt = opt || {};
    var v = opt.v || 'x';
    var f = opt.frac ? function (v) { return fmtFrac(v, opt.maxDen); } : fmt;
    var V = '<var>' + v + '</var>';
    var terms = [];
    function coef(k) { return Math.abs(k - 1) < EPS ? '' : f(k); }
    if (a) terms.push([a < 0, coef(Math.abs(a)) + V + '²']);
    if (b) terms.push([b < 0, coef(Math.abs(b)) + V]);
    if (c) terms.push([c < 0, f(Math.abs(c))]);
    if (!terms.length) return '0';
    return terms.map(function (t, i) {
      if (i === 0) return (t[0] ? MINUS : '') + t[1];
      return (t[0] ? ' ' + MINUS + ' ' : ' + ') + t[1];
    }).join('');
  }

  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- Ausdrucks-Auswerter: Zahlen, + − · /, Klammern, √, ^, ², implizites Mal vor √ und ( ---------- */
  function evalExpr(src) {
    var s = String(src).replace(/\s+/g, '');
    if (!s) return NaN;
    var i = 0;
    function peek() { return s[i]; }
    function fail() { throw new Error('parse'); }
    function number() {
      var m = /^(\d+(?:\.\d*)?|\.\d+)/.exec(s.slice(i));
      if (!m) fail();
      i += m[0].length;
      return parseFloat(m[0]);
    }
    function atom() {
      var c = peek();
      if (c === '(') { i++; var v = expr(); if (peek() !== ')') fail(); i++; return v; }
      if (c === '√') {
        i++;
        var arg = power(); // √5, √(5), √√16, √5² = √25
        if (arg < -EPS) fail();
        return Math.sqrt(Math.max(0, arg));
      }
      if (c !== undefined && /[\d.]/.test(c)) return number();
      fail();
    }
    function power() {
      var b = atom();
      for (;;) {
        var c = peek();
        if (c === '²') { i++; b = b * b; }
        else if (c === '³') { i++; b = b * b * b; }
        else if (c === '^') { i++; var e = unary(); b = Math.pow(b, e); }
        else break;
      }
      return b;
    }
    function unary() {
      var c = peek();
      if (c === '-') { i++; return -unary(); }
      if (c === '+') { i++; return unary(); }
      return power();
    }
    function term() {
      var v = unary();
      for (;;) {
        var c = peek();
        if (c === '*') { i++; v *= unary(); }
        else if (c === '/' || c === ':') { i++; var d = unary(); if (Math.abs(d) < EPS) fail(); v /= d; }
        else if (c === '√' || c === '(') { v *= power(); } // implizites Mal: 2√3, 2(1+√2)
        else break;
      }
      return v;
    }
    function expr() {
      var v = term();
      for (;;) {
        var c = peek();
        if (c === '+') { i++; v += term(); }
        else if (c === '-') { i++; v -= term(); }
        else break;
      }
      return v;
    }
    try {
      var v = expr();
      if (i !== s.length) return NaN;
      return isFinite(v) ? v : NaN;
    } catch (e) { return NaN; }
  }

  /** Ersetzt das erste ± durch + und − (rekursiv) → Liste von Ausdrücken. */
  function expandPM(tok) {
    var k = tok.indexOf('±');
    if (k < 0) return [tok];
    var a = tok.slice(0, k), b = tok.slice(k + 1);
    return expandPM(a + '+' + b).concat(expandPM(a + '-' + b));
  }

  function uniqSorted(vals, tol) {
    var t = tol == null ? 1e-7 : tol;
    var a = vals.slice().sort(function (x, y) { return x - y; });
    var out = [];
    for (var i = 0; i < a.length; i++) {
      if (!out.length || Math.abs(a[i] - out[out.length - 1]) > Math.max(t, 1e-9)) out.push(a[i]);
    }
    return out.map(function (x) { return Math.abs(x) < 1e-12 ? 0 : x; });
  }

  var EMPTY_RE = /kein|leer|∅|ø|⌀|nicht\s*l[öo]sbar|unl[öo]sbar|nichts/;

  function normalizeAnswer(str) {
    var s = String(str == null ? '' : str).toLowerCase();
    s = s.replace(/[−‒–—‐‑﹣－]/g, '-')
      .replace(/[·⋅×∙•]/g, '*')
      .replace(/[₀-₉]/g, function (c) { return String(c.charCodeAt(0) - 0x2080); })
      .replace(/[   ]/g, ' ')
      .replace(/≈/g, '=')
      .replace(/\+\s*\/\s*-/g, '±')
      .replace(/\+\s*-/g, '±')
      .replace(/sqrt|wurzel\s*aus|wurzel|w\s*(?=\()/g, '√')
      .replace(/[\r\n\t]+/g, ' ;');
    return s.trim();
  }

  /** Eine Deutung (Kommas schon aufgelöst) in Werte zerlegen. */
  function parseList(u) {
    var toks = u.split(';');
    var vals = [];
    for (var i = 0; i < toks.length; i++) {
      var tok = toks[i].trim().replace(/^,+|,+$/g, '').trim();
      if (!tok) continue;
      var exps = expandPM(tok);
      for (var j = 0; j < exps.length; j++) {
        var v = evalExpr(exps[j]);
        if (isNaN(v)) {
          // Fallback: Leerzeichen als Trenner („2 -3“)
          var pieces = exps[j].trim().split(/\s+/);
          if (pieces.length < 2) return null;
          for (var k = 0; k < pieces.length; k++) {
            var pv = evalExpr(pieces[k]);
            if (isNaN(pv)) return null;
            vals.push(pv);
          }
        } else vals.push(v);
      }
    }
    if (!vals.length) return null;
    return { empty: false, values: uniqSorted(vals) };
  }

  /**
   * Versteht Schülereingaben für Lösungsmengen.
   * → {empty, values, alts:[{empty, values}, …]} oder null.
   * alts enthält alle sinnvollen Deutungen (Dezimalkomma vs. Komma als Trenner).
   */
  function parseAnswer(str) {
    var s = normalizeAnswer(str);
    if (!s) return null;
    var flat = s.replace(/\s+/g, ' ');
    if (EMPTY_RE.test(flat)) return { empty: true, values: [], alts: [{ empty: true, values: [] }] };
    var stripped = flat.replace(/^\s*l\s*=\s*/, '').replace(/[{}\[\]]/g, '').trim();
    if (!stripped && /[{}]/.test(flat)) return { empty: true, values: [], alts: [{ empty: true, values: [] }] };

    var u = flat;
    // Wörter / Zeichen als harte Trenner
    u = u.replace(/\s*(?:\bund\b|\boder\b|\bbzw\b\.?|\bsowie\b|&|∨|\|)\s*/g, ';');
    // Variablen-Zuweisungen x=, x1=, x_2=, x1/2=, x1,2= (auch L=) → Trenner
    u = u.replace(/[a-zäöü]\s*_?\s*(?:\d\s*[,\/;]\s*\d|\d)?\s*=/g, ';');
    u = u.replace(/=/g, ';');
    u = u.replace(/[{}\[\]]/g, ' ');
    // Komma mit Leerraum daneben = Trenner
    u = u.replace(/\s+,|,\s+/g, ';');
    u = u.replace(/;(\s*;)+/g, ';').replace(/^\s*;\s*|\s*;\s*$/g, '').trim();
    if (!u) return null;

    // verbleibende Kommas: zwischen Ziffern = Dezimal-Kandidat, sonst Trenner
    var A = '', B = '', cand = false;
    for (var i = 0; i < u.length; i++) {
      var c = u[i];
      if (c === ',') {
        if (/\d/.test(u[i - 1] || '') && /\d/.test(u[i + 1] || '')) { A += '.'; B += ';'; cand = true; }
        else { A += ';'; B += ';'; }
      } else { A += c; B += c; }
    }
    var hard = A.indexOf(';') >= 0;
    var tries = (!cand || hard) ? [A] : [A, B];
    // „2 -3“: Leerzeichen vor Vorzeichen, keins danach → evtl. als Trenner gemeint (zusätzliche Deutung)
    if (/[\d)]\s+[-+]\S/.test(A)) tries.push(A.replace(/([\d)])\s+(?=[-+]\S)/g, '$1;'));
    var alts = [];
    for (var t = 0; t < tries.length; t++) {
      var r = parseList(tries[t]);
      if (r && !alts.some(function (x) { return sameSet(x, r); })) alts.push(r);
    }
    if (!alts.length) return null;
    return { empty: false, values: alts[0].values, alts: alts };
  }

  function toSet(a) {
    if (a == null) return null;
    if (Array.isArray(a)) return { empty: a.length === 0, values: a };
    if (typeof a === 'number') return { empty: false, values: [a] };
    if (typeof a === 'string') return parseAnswer(a);
    return a;
  }

  /** Gleiche Lösungsmenge? Akzeptiert Arrays, {empty, values} oder Strings. */
  function sameSet(a, b, tol) {
    var A = toSet(a), B = toSet(b);
    if (!A || !B) return false;
    var t = tol == null ? 1e-6 : tol;
    var av = A.empty ? [] : uniqSorted(A.values, Math.min(t, 1e-7));
    var bv = B.empty ? [] : uniqSorted(B.values, Math.min(t, 1e-7));
    if (av.length !== bv.length) return false;
    for (var i = 0; i < av.length; i++) if (Math.abs(av[i] - bv[i]) > t + 1e-12) return false;
    return true;
  }

  /** Anzahl Werte aus a, die (mit Toleranz) in b vorkommen. */
  function countIn(a, b, tol) {
    var n = 0;
    a.forEach(function (x) { if (b.some(function (y) { return Math.abs(x - y) <= tol; })) n++; });
    return n;
  }

  /** Antwort-String (data-answer) hübsch: "L = {−3; 2}" als HTML. */
  function prettyToken(tok) {
    var t = tok.trim();
    if (/^-?\d+\s*\/\s*\d+$/.test(t)) {
      var p = t.split('/');
      var n = parseInt(p[0], 10), d = parseInt(p[1], 10);
      return (n < 0 ? MINUS : '') + '<span class="frac"><span>' + Math.abs(n) + '</span><span>' + d + '</span></span>';
    }
    t = t.replace(/sqrt\(([^()]+)\)/g, function (m, a) { return /^[\d.,]+$/.test(a.trim()) ? '√' + a.trim() : '√(' + a + ')'; })
      .replace(/\s+/g, '')
      .replace(/\*(?=√|\()/g, '')
      .replace(/\*/g, '·')
      .replace(/(\d)\.(\d)/g, '$1,$2')
      .replace(/±/g, ' ± ')
      .replace(/-/g, MINUS)
      .replace(/([\d)√])([+−])/g, '$1 $2 ');
    return esc(t).replace(/ ± /g, ' ± ').trim();
  }
  function prettyAnswer(ans, kind) {
    var s = String(ans == null ? '' : ans).trim();
    if (kind === 'number') return prettyToken(s);
    if (EMPTY_RE.test(s.toLowerCase())) return 'L = { }';
    var toks = s.split(';').map(function (x) { return x.trim(); }).filter(Boolean);
    toks.sort(function (a, b) { return evalExpr(a.replace(/sqrt/g, '√')) - evalExpr(b.replace(/sqrt/g, '√')); });
    return 'L = {' + toks.map(prettyToken).join('; ') + '}';
  }

  /** Text-/Termeingabe normalisieren (für data-kind="text"). */
  function normText(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[−‒–—‐‑]/g, '-')
      .replace(/\^\s*2/g, '²').replace(/\^\s*3/g, '³')
      .replace(/sqrt/g, '√')
      .replace(/[\s*·⋅×∙]/g, '')
      // Dezimalzahlen vereinheitlichen: 1.5 = 1,5 = 1,50
      .replace(/(\d)\.(?=\d)/g, '$1,')
      .replace(/(\d),(\d*?)0+(?!\d)/g, function (m, a, b) { return b ? a + ',' + b : a; });
  }

  /** Alternativen an „|“ trennen; „\|“ steht für einen echten senkrechten Strich (z. B. S(3\|−4)). */
  function splitAlts(str) {
    var out = [''], s = String(str == null ? '' : str);
    for (var i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') { out[out.length - 1] += '|'; i++; }
      else if (s[i] === '|') out.push('');
      else out[out.length - 1] += s[i];
    }
    return out;
  }

  /* ---------- Mathe-Typografie: Variablen kursiv ---------- */
  var VAR_LETTERS = 'abcdefghkmnpqrstuvwxyz';
  var STOP = {
    und: 1, bzw: 1, da: 1, zu: 1, zum: 1, zur: 1, um: 1, es: 1, an: 1, am: 1, aus: 1, auf: 1,
    das: 1, der: 1, den: 1, dem: 1, des: 1, man: 1, ca: 1, usw: 1, etc: 1, max: 1, min: 1,
    cm: 1, mm: 1, km: 1, dm: 1, kg: 1, ct: 1, std: 1, ggt: 1, kgv: 1, ne: 1, nd: 1,
    nur: 1, hat: 1, was: 1, wer: 1, wen: 1, wem: 1, vs: 1, zw: 1
  };
  function isLetter(c) { return !!c && /[A-Za-zÄÖÜäöüßÀ-ÿ]/.test(c); }

  /** Zerlegt Mathe-Text in Segmente [{t:'text'|'var'|'sub', s}]. Wandelt - in − und * in · um. */
  function mathSegments(text) {
    var src = String(text);
    // Bindestrich → echtes Minus (außer zwischen zwei Buchstaben, z. B. „p-q-Formel“)
    var s = '';
    for (var k = 0; k < src.length; k++) {
      var ch = src[k];
      if (ch === '-' && !(isLetter(src[k - 1]) && isLetter(src[k + 1]))) s += MINUS;
      else if (ch === '*') s += '·';
      else s += ch;
    }
    var segs = [];
    var buf = '';
    var i = 0;
    while (i < s.length) {
      var c = s[i];
      if (isLetter(c)) {
        var j = i;
        while (j < s.length && isLetter(s[j])) j++;
        var run = s.slice(i, j);
        var isVar = run.length <= 3 && !STOP[run] && run.split('').every(function (x) { return VAR_LETTERS.indexOf(x) >= 0; });
        if (isVar) {
          if (buf) { segs.push({ t: 'text', s: buf }); buf = ''; }
          segs.push({ t: 'var', s: run });
          // Index: x1, x2 (eine Ziffer direkt nach einem einzelnen Buchstaben)
          if (run.length === 1 && /\d/.test(s[j] || '') && !/\d/.test(s[j + 1] || '')) {
            segs.push({ t: 'sub', s: s[j] });
            j++;
          }
        } else buf += run;
        i = j;
      } else { buf += c; i++; }
    }
    if (buf) segs.push({ t: 'text', s: buf });
    return segs;
  }

  var PURE = {
    fmt: fmt, fmtFrac: fmtFrac, sign: sign, poly: poly, rand: rand, pick: pick, shuffle: shuffle, esc: esc,
    evalExpr: evalExpr, parseAnswer: parseAnswer, sameSet: sameSet, prettyAnswer: prettyAnswer,
    normText: normText, splitAlts: splitAlts, mathSegments: mathSegments
  };
  if (typeof module === 'object' && module && module.exports) module.exports = PURE;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  /* =====================================================================
     2. DOM-Teil
     ===================================================================== */
  var QG = window.QG || {};
  window.QG = QG;
  Object.keys(PURE).forEach(function (k) { QG[k] = PURE[k]; });

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function h(tag, attrs, html) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] == null || attrs[k] === false) return;
      if (k === 'class') el.className = attrs[k];
      else el.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    if (html != null) el.innerHTML = html;
    return el;
  }
  QG.h = h;
  /** wie $$, schließt aber root selbst ein, falls es passt */
  function $$self(sel, root) {
    var list = $$(sel, root);
    if (root && root.nodeType === 1 && root.matches(sel)) list.unshift(root);
    return list;
  }
  var reducedMotion = function () {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  /* ---------- Store ---------- */
  QG.store = {
    get: function (key, fallback) {
      try {
        var v = localStorage.getItem('qg:' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem('qg:' + key, JSON.stringify(value)); } catch (e) { /* privat/voll */ }
    },
    remove: function (key) { try { localStorage.removeItem('qg:' + key); } catch (e) {} }
  };

  /* ---------- Events ---------- */
  var listeners = {};
  QG.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return fn; };
  QG.off = function (ev, fn) { listeners[ev] = (listeners[ev] || []).filter(function (f) { return f !== fn; }); };
  function emit(ev) {
    var args = Array.prototype.slice.call(arguments, 1);
    (listeners[ev] || []).slice().forEach(function (fn) {
      try { fn.apply(null, args); } catch (e) { console.error('[QG] Fehler in Listener „' + ev + '“', e); }
    });
  }
  QG.emit = emit;
  /** fn sofort ausführen, wenn der Core schon gebootet hat, sonst beim „ready“-Event */
  QG.ready = function (fn) { if (booted) setTimeout(fn, 0); else QG.on('ready', fn); };

  /* ---------- Gelöst-Status ---------- */
  var solvedMap = QG.store.get('solved', {}) || {};
  /** Generierte Trainingsaufgaben (train-…) nur im Speicher halten, sonst wächst localStorage endlos. */
  function saveSolved() {
    var keep = {};
    Object.keys(solvedMap).forEach(function (k) { if (k.indexOf('train-') !== 0) keep[k] = solvedMap[k]; });
    QG.store.set('solved', keep);
  }
  Object.keys(solvedMap).forEach(function (k) { if (k.indexOf('train-') === 0) delete solvedMap[k]; });
  QG.solved = function (id) { return !!(id && solvedMap[id]); };
  QG.solvedAnswer = function (id) { return id && solvedMap[id] && solvedMap[id].a; };
  QG.markSolved = function (id, answer) {
    if (!id) return;
    var first = !solvedMap[id];
    solvedMap[id] = { t: Date.now(), a: answer == null ? (solvedMap[id] && solvedMap[id].a) : String(answer).slice(0, 200) };
    saveSolved();
    if (first) emit('solved', id);
    updateProgress();
  };
  QG.unmarkSolved = function (id) {
    if (!solvedMap[id]) return;
    delete solvedMap[id];
    saveSolved();
    updateProgress();
  };
  QG.resetProgress = function (prefix) {
    Object.keys(solvedMap).forEach(function (k) { if (!prefix || k.indexOf(prefix) === 0) delete solvedMap[k]; });
    saveSolved();
    $$('.task').forEach(function (t) { if (t._qg && (!prefix || (t.dataset.id || '').indexOf(prefix) === 0)) resetTask(t, true); });
    updateProgress();
  };

  /* ---------- Toast & Konfetti ---------- */
  QG.toast = function (text, opt) {
    opt = opt || {};
    var box = document.getElementById('qg-toasts');
    if (!box) { box = h('div', { id: 'qg-toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(box); }
    var t = h('div', { class: 'toast' + (opt.type ? ' ' + opt.type : '') });
    t.textContent = text;
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { t.remove(); }, 320);
    }, opt.ms || 2600);
    return t;
  };

  QG.celebrate = function (el) {
    if (reducedMotion()) return;
    var r = (el && el.getBoundingClientRect) ? el.getBoundingClientRect() : { left: innerWidth / 2 - 1, top: innerHeight / 2, width: 2, height: 2 };
    var cx = r.left + r.width / 2;
    var cy = Math.max(40, Math.min(innerHeight - 40, r.top + Math.min(r.height / 2, 40)));
    var layer = h('div', { class: 'confetti', 'aria-hidden': 'true' });
    var cols = ['--c-violet', '--c-blue', '--c-green', '--c-orange', '--c-pink', '--c-yellow', '--c-teal'];
    for (var i = 0; i < 30; i++) {
      var p = document.createElement('i');
      if (i % 3 === 0) p.className = 'round';
      var ang = Math.random() * Math.PI - Math.PI; // nach oben
      var dist = 70 + Math.random() * 130;
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.setProperty('--dx', (Math.cos(ang) * dist * 1.3).toFixed(1) + 'px');
      p.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
      p.style.setProperty('--r', ((Math.random() * 2 - 1) * 540).toFixed(0) + 'deg');
      p.style.setProperty('--d', (Math.random() * 0.12).toFixed(2) + 's');
      p.style.setProperty('--c', 'var(' + cols[i % cols.length] + ')');
      layer.appendChild(p);
    }
    document.body.appendChild(layer);
    setTimeout(function () { layer.remove(); }, 1500);
  };

  /* ---------- Mathe-Formatierung ---------- */
  var SKIP_SEL = 'var, sub, sup, code, kbd, .kbd, .nomath, .t, input, textarea, script, style, button, svg';
  QG.math = function (root) {
    root = root || document;
    var containers = [];
    if (root.nodeType === 1 && root.matches('.m, .mblock, .calc')) containers.push(root);
    containers = containers.concat($$('.m, .mblock, .calc', root));
    containers.forEach(function (c) {
      var walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, null);
      var nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(function (node) {
        var p = node.parentElement;
        if (!p || (p.closest(SKIP_SEL) && c.contains(p.closest(SKIP_SEL)))) return;
        var txt = node.nodeValue;
        if (!/[A-Za-zÄÖÜäöüß\-*]/.test(txt)) return;
        var segs = mathSegments(txt);
        if (segs.length === 1 && segs[0].t === 'text') {
          if (segs[0].s !== txt) node.nodeValue = segs[0].s;
          return;
        }
        var frag = document.createDocumentFragment();
        segs.forEach(function (sg) {
          if (sg.t === 'text') frag.appendChild(document.createTextNode(sg.s));
          else { var e = document.createElement(sg.t); e.textContent = sg.s; frag.appendChild(e); }
        });
        node.parentNode.replaceChild(frag, node);
      });
    });
    // kurze Inline-Terme nicht mitten im Term umbrechen ( (x − 1)² ), lange dürfen umbrechen (.m.wrap erzwingt das)
    $$self('.m', root).forEach(function (m) {
      if (m._qgNw || m.classList.contains('wrap') || m.closest('.calc, .mblock, .choices.cols')) return;
      m._qgNw = true;
      if (m.textContent.replace(/\s+/g, ' ').trim().length <= 20) m.classList.add('nw');
    });
    // Rechenhinweis „| …“: nach dem Strich nicht umbrechen (Strich ist Unicode-Klasse BA)
    $$self('.calc .op', root).forEach(function (op) {
      var tn = op.firstChild;
      if (tn && tn.nodeType === 3 && /^\s*\|[ \u00a0]/.test(tn.nodeValue)) tn.nodeValue = tn.nodeValue.replace(/^(\s*)\|[ \u00a0]+/, '$1|\u2060\u00a0');
    });
    // Brüche: Screenreader-Text
    $$('.frac', root).forEach(function (f) {
      if (f.hasAttribute('aria-label') || f.children.length < 2) return;
      f.setAttribute('role', 'img');
      f.setAttribute('aria-label', f.children[0].textContent.trim() + ' durch ' + f.children[1].textContent.trim());
    });
    return root;
  };

  /* ---------- Flex-Container mit gemischtem Inline-Inhalt ----------
     .choice, .btn, .pill und summary sind Flex-Container. Text + <span class="m"> + <b> würden sonst
     zu einzelnen Flex-Items (Spalten, Lücken mitten im Term). Läufe aus Text und Inline-Elementen
     werden deshalb in ein <span class="flex-txt"> gepackt; Icons (svg, img, .ico) bleiben eigene Items. */
  var FLEX_SEL = '.choice, .btn, .pill, details > summary';
  function isIconNode(n) {
    return n.nodeType === 1 && (n.tagName === 'svg' || n.tagName === 'SVG' || n.tagName === 'IMG' || (n.classList && (n.classList.contains('ico') || n.classList.contains('flex-txt'))));
  }
  function wrapInline(el) {
    if (el._qgWrapped) return;
    el._qgWrapped = true;
    var kids = Array.prototype.slice.call(el.childNodes);
    if (kids.length < 2) return;
    var runs = [], run = [];
    kids.forEach(function (n) {
      if (isIconNode(n) || n.nodeType === 8) { if (run.length) runs.push(run); run = []; }
      else run.push(n);
    });
    if (run.length) runs.push(run);
    runs.forEach(function (r) {
      var texts = r.filter(function (n) { return n.nodeType === 3 && n.nodeValue.trim(); }).length;
      var elems = r.filter(function (n) { return n.nodeType === 1; }).length;
      if (!texts || !elems) return; // nur Text oder bewusst gegliederte Elemente → unverändert
      var span = document.createElement('span');
      span.className = 'flex-txt';
      r[0].parentNode.insertBefore(span, r[0]);
      r.forEach(function (n) { span.appendChild(n); });
    });
  }
  QG.wrapInline = wrapInline;

  /* ---------- Rechnungen (.calc) auf schmalen Screens ----------
     Passt eine Umformung nicht in die Breite, rückt der „| …“-Hinweis unter die Zeile (.stack-op). */
  var calcRO = window.ResizeObserver ? new ResizeObserver(function (entries) {
    var list = entries.map(function (e) { return e.target; });
    requestAnimationFrame(function () { list.forEach(fitCalc); });
  }) : null;
  function fitCalc(c) {
    if (printing || !c.isConnected || c.offsetParent === null) return;
    var w = c.parentElement ? c.parentElement.clientWidth : 0;
    if (!w || w === c._qgW) return;
    c._qgW = w;
    if (!c.querySelector('.op')) return;
    c.classList.remove('stack-op');
    if (c.scrollWidth > c.clientWidth + 1) c.classList.add('stack-op');
  }
  function watchCalcs(root) {
    if (!calcRO) return;
    $$self('.calc', root).forEach(function (c) {
      if (c._qgRO) return;
      c._qgRO = true;
      calcRO.observe(c);
    });
  }
  QG.fitCalcs = function (root) { $$self('.calc', root || document).forEach(function (c) { c._qgW = -1; fitCalc(c); }); };

  /* ---------- Boxen & Kapitelköpfe ---------- */
  var BOX_TITLES = { merke: 'Merke', tipp: 'Tipp', achtung: 'Achtung', beispiel: 'Beispiel', info: 'Gut zu wissen' };
  function initBoxes(root) {
    $$('.box', root).forEach(function (b) {
      if (b._qg || b.hasAttribute('data-notitle')) return;
      b._qg = true;
      var first = b.firstElementChild;
      if (first && first.classList.contains('box-title')) return;
      var type = Object.keys(BOX_TITLES).filter(function (k) { return b.classList.contains(k); })[0];
      if (!type) return;
      b.insertBefore(h('p', { class: 'box-title' }, BOX_TITLES[type]), b.firstChild);
    });
  }
  function initHeads(root) {
    $$('.chapter > .ch-head', root).forEach(function (hd) {
      if (hd._qg) return;
      hd._qg = true;
      var sec = hd.parentElement;
      if (!$('.ch-icon', hd) && sec.dataset.icon) hd.insertBefore(h('span', { class: 'ch-icon', 'aria-hidden': 'true' }, esc(sec.dataset.icon)), hd.firstChild);
      var h1 = $('h1', hd);
      if (h1 && !h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
    });
  }

  /* ---------- Stepper ---------- */
  function initStepper(ol) {
    if (ol._qg) return;
    ol._qg = true;
    var items = Array.prototype.filter.call(ol.children, function (li) { return li.tagName === 'LI'; });
    var n = items.length;
    if (!n) return;
    var shown = 1;
    var ctrl = h('div', { class: 'steps-ctrl no-print' });
    var next = h('button', { type: 'button', class: 'btn primary' }, 'Nächster Schritt');
    var all = h('button', { type: 'button', class: 'btn ghost' }, 'Alle zeigen');
    var restart = h('button', { type: 'button', class: 'btn ghost' }, 'Neu starten');
    var count = h('span', { class: 'steps-count', 'aria-live': 'polite' });
    ctrl.appendChild(next); ctrl.appendChild(all); ctrl.appendChild(restart); ctrl.appendChild(count);
    ol.parentNode.insertBefore(ctrl, ol.nextSibling);
    function render(animIdx) {
      items.forEach(function (li, i) {
        li.classList.toggle('is-hidden', i >= shown);
        li.classList.toggle('is-last-visible', i === shown - 1 && shown < n);
        li.classList.toggle('is-new', i === animIdx);
      });
      next.hidden = shown >= n;
      all.hidden = shown >= n;
      restart.hidden = shown < n;
      count.textContent = shown >= n ? 'Fertig ✓ · ' + n + ' Schritte' : 'Schritt ' + shown + ' von ' + n;
    }
    next.addEventListener('click', function () {
      if (shown < n) shown++;
      render(shown - 1);
      var li = items[shown - 1];
      if (li && li.getBoundingClientRect().bottom > innerHeight - 90) li.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      if (shown >= n) restart.focus({ preventScroll: true }); else next.focus({ preventScroll: true });
    });
    all.addEventListener('click', function () { shown = n; render(-1); restart.focus({ preventScroll: true }); });
    restart.addEventListener('click', function () {
      shown = 1; render(0);
      var r = ol.getBoundingClientRect();
      if (r.top < 70) window.scrollBy({ top: r.top - 90, behavior: reducedMotion() ? 'auto' : 'smooth' });
      next.focus({ preventScroll: true });
    });
    render(-1);
  }

  /* ---------- Aufgaben ---------- */
  var OK_MSGS = ['Richtig!', 'Stark – genau so!', 'Perfekt gelöst!', 'Sauber gerechnet!', 'Stimmt genau!', 'Richtig – weiter so!', 'Top, das sitzt!', 'Genau richtig!', 'Klasse gemacht!'];
  var OK_FIRST = ['Auf Anhieb richtig!', 'Direkt richtig – stark!', 'Beim ersten Versuch – super!'];
  var BAD_MSGS = [
    'Noch nicht ganz. Mach die Probe: Setz deine Zahl in die Gleichung ein.',
    'Leider nicht. Geh deinen Rechenweg Zeile für Zeile durch.',
    'Das passt noch nicht. Kein Stress – schau dir den letzten Schritt noch mal an.',
    'Knapp daneben ist auch daneben. Kontrollier vor allem die Vorzeichen.',
    'Noch nicht richtig. Tipp: Eine Probe deckt fast jeden Fehler auf.'
  ];
  var lastPick = {};
  function vary(key, arr) {
    var i;
    do { i = Math.floor(Math.random() * arr.length); } while (arr.length > 1 && i === lastPick[key]);
    lastPick[key] = i;
    return arr[i];
  }

  var KEYSETS = {
    set: ['−', ';', ',', '/', '√', '±', 'keine'],
    number: ['−', ',', '/', '√'],
    text: ['²', '+', '−', '(', ')', '√']
  };

  function taskKind(t) {
    var k = (t.dataset.kind || '').toLowerCase();
    if (k === 'number' || k === 'choice' || k === 'text' || k === 'self') return k;
    if (!k && $('.choices', t)) return 'choice';
    return 'set';
  }

  function say(t, type, html) {
    var fb = t._qg.fb;
    fb.innerHTML = '';
    if (!html) return;
    var d = h('div', { class: 'fb ' + type }, '<span>' + html + '</span>');
    fb.appendChild(d);
    QG.math(d);
  }
  function shake(t) {
    if (reducedMotion()) return;
    t.classList.remove('shake');
    void t.offsetWidth;
    t.classList.add('shake');
    setTimeout(function () { t.classList.remove('shake'); }, 450);
  }

  function buildHead(t, label) {
    var head = $(':scope > .task-head', t);
    if (!head) {
      head = h('div', { class: 'task-head' });
      t.insertBefore(head, t.firstChild);
    }
    var lvl = parseInt(t.dataset.level, 10);
    var lvlHtml = '';
    if (lvl >= 1) {
      var names = ['', 'leicht', 'mittel', 'schwer'];
      lvlHtml = '<span class="task-level" title="Schwierigkeit: ' + (names[Math.min(lvl, 3)] || lvl) + '" aria-label="Schwierigkeit: ' + (names[Math.min(lvl, 3)] || lvl) + '">' +
        [1, 2, 3].map(function (i) { return '<i' + (i <= lvl ? ' class="on"' : '') + '></i>'; }).join('') + '</span>';
    }
    head.innerHTML = '<span class="task-num">' + esc(label) + '</span>' + lvlHtml +
      '<span class="task-badge"><span aria-hidden="true">✓</span> gelöst</span>';
  }

  function insertionPoint(t) {
    // vor .wrong / details / Tipps / Lösung einfügen
    var kids = Array.prototype.slice.call(t.children);
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.matches('.wrong, details, .task-after')) return k;
    }
    return null;
  }

  function initTask(t) {
    if (t._qg) return;
    var kind = taskKind(t);
    var st = t._qg = { kind: kind, attempts: 0, solved: false };
    t.setAttribute('data-kind-resolved', kind);
    if (!$(':scope > .task-head', t)) buildHead(t, t.dataset.label || 'Aufgabe');
    var before = insertionPoint(t);
    st.fb = h('div', { class: 'feedback', 'aria-live': 'polite' });
    st.after = h('div', { class: 'task-after' });
    st.retry = h('button', { type: 'button', class: 'btn ghost retry' }, '↺ Nochmal versuchen');
    st.retry.hidden = true;
    st.retry.addEventListener('click', function () { resetTask(t); });

    if (kind === 'choice') {
      var ch = $('.choices', t);
      if (!ch) { console.warn('[QG] choice-Aufgabe ohne .choices', t); return; }
      var corrects = $$('.choice[data-correct]', ch);
      st.multi = corrects.length > 1;
      if (st.multi) {
        ch.classList.add('multi');
        ch.setAttribute('role', 'group');
        ch.parentNode.insertBefore(h('p', { class: 'choices-note' }, 'Mehrere Antworten sind richtig – wähle alle aus.'), ch.nextSibling);
      }
      $$('.choice', ch).forEach(function (b) {
        if (!b.hasAttribute('type')) b.setAttribute('type', 'button');
        if (st.multi) b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function () { onChoice(t, b); });
      });
      var anchor = ch.nextElementSibling && ch.nextElementSibling.classList.contains('choices-note') ? ch.nextElementSibling : ch;
      if (st.multi) {
        st.check = h('button', { type: 'button', class: 'btn primary check' }, 'Prüfen');
        st.check.addEventListener('click', function () { checkMulti(t); });
        var row = h('div', { class: 'btn-row', style: 'margin-top:10px' });
        row.appendChild(st.check);
        anchor.parentNode.insertBefore(row, anchor.nextSibling);
        anchor = row;
      }
      anchor.parentNode.insertBefore(st.fb, anchor.nextSibling);
      st.fb.parentNode.insertBefore(st.after, st.fb.nextSibling);
    } else if (kind === 'self') {
      var row2 = h('div', { class: 'btn-row self-row', style: 'margin-top:12px' });
      st.show = h('button', { type: 'button', class: 'btn primary' }, 'Lösung ansehen');
      st.yes = h('button', { type: 'button', class: 'btn ok' }, 'Hatte ich richtig ✓');
      st.no = h('button', { type: 'button', class: 'btn' }, 'Noch nicht ganz');
      st.yes.hidden = st.no.hidden = true;
      row2.appendChild(st.show); row2.appendChild(st.yes); row2.appendChild(st.no);
      t.insertBefore(row2, before);
      t.insertBefore(st.fb, before);
      t.insertBefore(st.after, before);
      st.show.addEventListener('click', function () {
        var sol = $(':scope > details.solution', t);
        if (sol) { sol.open = true; sol.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); }
        st.show.hidden = true; st.yes.hidden = false; st.no.hidden = false;
        say(t, 'info', 'Vergleich ehrlich mit deiner Lösung. Hattest du es richtig?');
      });
      st.yes.addEventListener('click', function () { solveTask(t, 'self', vary('ok', OK_MSGS) + ' Abgehakt.'); });
      st.no.addEventListener('click', function () {
        st.yes.hidden = st.no.hidden = true; st.show.hidden = false;
        say(t, 'info', 'Kein Problem – genau dafür übst du. Schau dir den Lösungsweg in Ruhe an und versuch es später noch einmal.');
      });
    } else {
      var io = h('div', { class: 'task-io' });
      var row = h('div', { class: 'ans-row' });
      var field = h('div', { class: 'ans-field' });
      var uid = 'qg-ans-' + (t.dataset.id || Math.random().toString(36).slice(2));
      var ph = t.dataset.placeholder || (kind === 'set' ? 'z. B. −3; 2  oder  keine' : kind === 'number' ? 'Zahl eingeben' : 'Term eingeben');
      if (t.dataset.prefix) field.appendChild(h('span', { class: 'ans-affix' }, esc(t.dataset.prefix)));
      st.input = h('input', {
        class: 'ans', id: uid, type: 'text', inputmode: 'text', autocomplete: 'off', autocorrect: 'off',
        autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', placeholder: ph,
        'aria-label': kind === 'set' ? 'Deine Lösungsmenge' : 'Deine Antwort'
      });
      field.appendChild(st.input);
      if (t.dataset.suffix) field.appendChild(h('span', { class: 'ans-affix' }, esc(t.dataset.suffix)));
      st.check = h('button', { type: 'button', class: 'btn primary check' }, 'Prüfen');
      row.appendChild(field); row.appendChild(st.check);
      io.appendChild(row);
      // Mini-Tastatur
      var keys = t.dataset.keys ? t.dataset.keys.split(/\s+/).filter(Boolean) : KEYSETS[kind] || KEYSETS.set;
      if (t.dataset.keys !== 'none') {
        var kb = h('div', { class: 'kb', role: 'group', 'aria-label': 'Sonderzeichen einfügen' });
        keys.forEach(function (k) {
          var isNone = k === 'keine';
          var b = h('button', { type: 'button', class: isNone ? 'wide' : null, tabindex: '-1', 'aria-label': isNone ? '„keine Lösung“ eintragen' : k + ' einfügen' }, isNone ? 'keine Lösung' : esc(k));
          b.addEventListener('pointerdown', function (e) { e.preventDefault(); }); // Fokus im Feld lassen
          b.addEventListener('mousedown', function (e) { e.preventDefault(); });
          b.addEventListener('click', function () {
            if (st.input.disabled) return;
            if (isNone) { st.input.value = 'keine Lösung'; }
            else insertAtCursor(st.input, k === ';' ? '; ' : k);
            st.input.focus({ preventScroll: true });
          });
          kb.appendChild(b);
        });
        io.appendChild(kb);
      }
      t.insertBefore(io, before);
      t.insertBefore(st.fb, before);
      t.insertBefore(st.after, before);
      st.check.addEventListener('click', function () { checkTask(t); });
      st.input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); checkTask(t); }
      });
    }
    st.after.appendChild(st.retry);
    // Tipp-Öffnung beendet Puls
    $$(':scope > details', t).forEach(function (d) {
      d.addEventListener('toggle', function () {
        if (!d.open) return;
        d.classList.remove('pulse');
        if (d.classList.contains('solution') && !printing) emit('peek', { el: t, id: t.dataset.id || null, solved: !!st.solved });
      });
    });
    // gespeicherten Zustand wiederherstellen
    if (t.dataset.id && QG.solved(t.dataset.id)) restoreSolved(t);
  }

  function insertAtCursor(input, str) {
    var s = input.selectionStart, e = input.selectionEnd;
    if (s == null || document.activeElement !== input) { s = e = input.value.length; }
    if (input.setRangeText) input.setRangeText(str, s, e, 'end');
    else { input.value = input.value.slice(0, s) + str + input.value.slice(e); }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function restoreSolved(t) {
    var st = t._qg;
    st.solved = true;
    t.classList.add('is-solved');
    var ans = QG.solvedAnswer(t.dataset.id);
    if (st.kind === 'choice') {
      $$('.choice', t).forEach(function (b) {
        b.disabled = true;
        if (b.hasAttribute('data-correct')) b.classList.add('is-correct');
      });
      if (st.check) st.check.hidden = true;
    } else if (st.kind === 'self') {
      st.show.hidden = st.yes.hidden = st.no.hidden = true;
    } else {
      if (ans && ans !== 'self') st.input.value = ans;
      st.input.disabled = true;
    }
    say(t, 'ok', 'Schon gelöst' + (st.kind === 'set' || st.kind === 'number' ? ': <span class="fb-ans">' + prettyAnswer(t.dataset.answer, st.kind) + '</span>' : '') + '.');
    st.retry.hidden = false;
  }

  function resetTask(t, silent) {
    var st = t._qg;
    if (!st) return;
    st.attempts = 0;
    st.solved = false;
    t.classList.remove('is-solved');
    say(t, '', '');
    st.retry.hidden = true;
    $$(':scope > details', t).forEach(function (d) { d.open = false; d.classList.remove('pulse'); });
    if (st.kind === 'choice') {
      $$('.choice', t).forEach(function (b) {
        b.disabled = false;
        b.classList.remove('is-correct', 'is-wrong', 'is-selected');
        if (st.multi) b.setAttribute('aria-pressed', 'false');
      });
      if (st.check) st.check.hidden = false;
    } else if (st.kind === 'self') {
      st.show.hidden = false; st.yes.hidden = st.no.hidden = true;
    } else {
      st.input.disabled = false;
      st.input.value = '';
      if (!silent) st.input.focus();
    }
  }

  function solveTask(t, answer, msg) {
    var st = t._qg;
    var wasSolved = t.dataset.id && QG.solved(t.dataset.id);
    st.solved = true;
    t.classList.add('is-solved');
    if (st.input) st.input.disabled = true;
    if (st.kind === 'self') { st.show.hidden = st.yes.hidden = st.no.hidden = true; }
    if (st.check && st.kind === 'choice') st.check.hidden = true;
    say(t, 'ok', msg);
    st.retry.hidden = false;
    if (t.dataset.id) QG.markSolved(t.dataset.id, answer);
    else updateTaskLists();
    QG.celebrate(st.fb.firstChild || t);
    emit('task', { el: t, id: t.dataset.id || null, ok: true, attempts: st.attempts, first: !wasSolved });
  }

  function failTask(t, msg) {
    var st = t._qg;
    var extra = '';
    var hints = $$(':scope > details.hint', t);
    var sol = $(':scope > details.solution', t);
    if (st.attempts === 2 || (st.attempts > 2 && st.attempts % 2 === 0)) {
      var closed = hints.filter(function (d) { return !d.open; })[0];
      if (closed) {
        var name = (closed.querySelector('summary') || {}).textContent || 'Tipp';
        extra = '<span class="fb-nudge">Schau dir „' + esc(name.trim()) + '“ unten an – der bringt dich weiter.</span>';
        closed.classList.remove('pulse'); void closed.offsetWidth; closed.classList.add('pulse');
      } else if (sol && st.attempts >= 3 && t.dataset.nudge !== 'off') {
        extra = '<span class="fb-nudge">Festgefahren? Unter „Lösung“ findest du den ganzen Rechenweg.</span>';
        sol.classList.remove('pulse'); void sol.offsetWidth; sol.classList.add('pulse');
      }
    }
    say(t, 'bad', msg + extra);
    shake(t);
    emit('task', { el: t, id: t.dataset.id || null, ok: false, attempts: st.attempts });
  }

  function okMessage(st) { return st.attempts === 1 ? vary('okf', OK_FIRST) : vary('ok', OK_MSGS); }

  function checkTask(t) {
    var st = t._qg;
    if (st.solved) return;
    var raw = st.input.value.trim();
    if (!raw) { say(t, 'info', 'Gib zuerst deine Antwort ein.'); st.input.focus(); return; }
    st.attempts++;
    var res = st.kind === 'text' ? judgeText(t, raw) : st.kind === 'number' ? judgeNumber(t, raw) : judgeSet(t, raw);
    if (res.unreadable) { st.attempts--; say(t, 'info', res.msg); shake(t); return; }
    if (res.ok) solveTask(t, raw, res.msg || okMessage(st));
    else failTask(t, res.msg);
  }

  function customWrong(t, got, kind) {
    var ws = $$(':scope > .wrong[data-match]', t);
    var interps = got.alts || [got];
    // erst exakt vergleichen; gerundete Eingaben (mind. 2 Nachkommastellen) treffen danach mit Rundungstoleranz
    var tols = /\d[.,]\d\d/.test(got.raw || '') && kind !== 'text' ? [1e-6, 0.0051] : [1e-6];
    for (var k = 0; k < tols.length; k++) {
      for (var i = 0; i < ws.length; i++) {
        var m = ws[i].getAttribute('data-match');
        if (m === '*1') continue;
        var alts = splitAlts(m);
        if (kind === 'text') {
          if (alts.some(function (x) { return normText(x) === normText(got.raw); })) return ws[i].innerHTML;
          continue;
        }
        // „|“ trennt auch bei Mengen/Zahlen Alternativen: data-match="-6;4|-4;6"
        for (var a = 0; a < alts.length; a++) {
          var ms = parseAnswer(alts[a]);
          if (!ms) continue;
          for (var j = 0; j < interps.length; j++) if (sameSet(interps[j], ms, tols[k])) return ws[i].innerHTML;
        }
      }
    }
    return null;
  }

  function judgeSet(t, raw) {
    var exp = parseAnswer(t.dataset.answer);
    if (!exp) { console.warn('[QG] data-answer nicht lesbar:', t.dataset.answer, t); return { ok: false, msg: 'Diese Aufgabe ist leider fehlerhaft hinterlegt.' }; }
    var got = parseAnswer(raw);
    if (!got) return { unreadable: true, msg: 'Das kann ich nicht lesen. Schreib die Lösungen mit Semikolon getrennt, z. B. <b>−3; 2</b>, oder <b>keine</b>, wenn es keine Lösung gibt.' };
    var tol = parseFloat(t.dataset.tol);
    if (!(tol >= 0)) tol = 1e-6;
    var interps = got.alts || [got];
    var st = t._qg;
    var pretty = '<span class="fb-ans">' + prettyAnswer(t.dataset.answer) + '</span>';
    for (var i = 0; i < interps.length; i++) {
      if (sameSet(interps[i], exp, tol)) return { ok: true, msg: okMessage(st) + ' ' + pretty };
    }
    // gerundete Dezimalzahlen (mind. 2 Nachkommastellen) bei krummen Lösungen akzeptieren
    if (/\d[.,]\d\d/.test(raw) && !exp.empty) {
      for (var r = 0; r < interps.length; r++) {
        if (sameSet(interps[r], exp, 0.0051)) return { ok: true, msg: 'Richtig – gerundet. Genau ist es ' + pretty + '.' };
      }
    }
    got.raw = raw;
    var cw = customWrong(t, got, 'set');
    if (cw) return { ok: false, msg: cw };
    // generische Diagnose mit der „besten“ Deutung
    var e = exp.values, best = interps[0], bestScore = -1;
    interps.forEach(function (g) { var sc = g.empty ? 0 : countIn(g.values, e, tol); if (sc > bestScore) { bestScore = sc; best = g; } });
    var g = best.empty ? [] : best.values;
    if (exp.empty && !best.empty) {
      return { ok: false, msg: 'Mach mal die Probe mit ' + (g.length > 1 ? 'deinen Zahlen' : 'deiner Zahl') + ' – klappt sie? Überleg, ob es hier überhaupt eine Lösung geben kann.' };
    }
    if (!exp.empty && best.empty) {
      return { ok: false, msg: 'Doch, hier gibt es ' + (e.length > 1 ? 'Lösungen' : 'eine Lösung') + '! Schau noch einmal genau hin.' };
    }
    var neg = g.map(function (x) { return -x; });
    if (g.length === e.length && sameSet(neg, e, tol) && !sameSet(g, e, tol)) {
      return { ok: false, msg: 'Fast! Die Beträge stimmen, aber die Vorzeichen sind vertauscht. Setz deine Zahlen zur Probe in die Gleichung ein.' };
    }
    var common = countIn(g, e, tol);
    if (common === g.length && g.length < e.length) {
      var star = $(':scope > .wrong[data-match="*1"]', t);
      if (star && e.length - g.length === 1) return { ok: false, msg: star.innerHTML };
      var symmetric = e.length === 2 && Math.abs(e[0] + e[1]) < 1e-6;
      if (symmetric) return { ok: false, msg: 'Eine Lösung fehlt noch – denk an ±!' };
      return { ok: false, msg: (g.length === 1 ? 'Eine Lösung hast du schon richtig!' : 'Deine Lösungen stimmen schon.') + ' Es fehlt aber noch ' + (e.length - g.length === 1 ? 'eine' : 'mehr') + '.' };
    }
    if (common === e.length && g.length > e.length) {
      return { ok: false, msg: e.length === 1 ? 'Hier gibt es nur eine Lösung. Mach mit jeder deiner Zahlen die Probe.' : 'Da ist eine Lösung zu viel. Mach mit jeder Zahl die Probe.' };
    }
    if (common > 0) return { ok: false, msg: (common === 1 ? 'Eine Zahl stimmt schon' : 'Ein Teil stimmt schon') + ', der Rest noch nicht. Mach mit jeder Zahl die Probe!' };
    if (g.length === 2 && e.length === 2 && sameSet([g[0] + g[1]], [-(e[0] + e[1])], tol) && Math.abs(g[0] * g[1] - e[0] * e[1]) < 1e-6) {
      return { ok: false, msg: 'Fast! Prüf die Vorzeichen deiner Lösungen.' };
    }
    return { ok: false, msg: vary('bad', BAD_MSGS) };
  }

  function judgeNumber(t, raw) {
    var target = evalExpr(String(t.dataset.answer).replace(/,/g, '.').replace(/sqrt/g, '√').replace(/[−]/g, '-'));
    if (isNaN(target)) { console.warn('[QG] data-answer (number) nicht lesbar:', t.dataset.answer, t); return { ok: false, msg: 'Diese Aufgabe ist leider fehlerhaft hinterlegt.' }; }
    var got = parseAnswer(raw);
    if (!got || got.empty) return { unreadable: true, msg: 'Gib hier bitte genau <b>eine Zahl</b> ein, z. B. <b>9</b> oder <b>' + MINUS + '2,5</b>.' };
    var tol = parseFloat(t.dataset.tol);
    if (!(tol >= 0)) tol = 1e-6;
    var interps = (got.alts || [got]).filter(function (g) { return g.values.length === 1; });
    if (!interps.length) return { unreadable: true, msg: 'Hier ist nur <b>eine Zahl</b> gefragt.' };
    var pretty = '<span class="fb-ans">' + prettyAnswer(t.dataset.answer, 'number') + '</span>';
    for (var i = 0; i < interps.length; i++) {
      var v = interps[i].values[0];
      if (Math.abs(v - target) <= tol) return { ok: true, msg: okMessage(t._qg) + ' ' + pretty };
      if (/\d[.,]\d\d/.test(raw) && Math.abs(v - target) <= 0.0051) return { ok: true, msg: 'Richtig – gerundet. Genau: ' + pretty + '.' };
    }
    got.raw = raw;
    var cw = customWrong(t, { alts: interps, raw: raw }, 'number');
    if (cw) return { ok: false, msg: cw };
    var v0 = interps[0].values[0];
    if (Math.abs(v0 + target) <= tol && Math.abs(target) > EPS) return { ok: false, msg: 'Fast! Der Betrag stimmt, aber das Vorzeichen nicht.' };
    if (Math.abs(target) > EPS && Math.abs(v0 - target * target) < 1e-6) return { ok: false, msg: 'Hm, du hast quadriert – gefragt ist aber die Zahl selbst.' };
    if (Math.abs(target) > EPS && Math.abs(v0 * v0 - target) < 1e-6 && v0 > 0) return { ok: false, msg: 'Fast: Gefragt ist hier das Quadrat, nicht die Wurzel.' };
    return { ok: false, msg: vary('bad', BAD_MSGS) };
  }

  function judgeText(t, raw) {
    var alts = splitAlts(t.dataset.answer || '');
    var n = normText(raw);
    for (var i = 0; i < alts.length; i++) if (normText(alts[i]) === n) return { ok: true, msg: okMessage(t._qg) };
    var cw = customWrong(t, { raw: raw }, 'text');
    if (cw) return { ok: false, msg: cw };
    if (alts.some(function (a) { return normText(a).replace(/[()]/g, '') === n.replace(/[()]/g, ''); })) {
      return { ok: false, msg: 'Fast – achte auf die Klammern.' };
    }
    return { ok: false, msg: vary('bad', ['Noch nicht ganz. Vergleich deinen Term Schritt für Schritt.', 'Das ist noch nicht der gesuchte Term. Prüf Vorzeichen und Hochzahlen.', 'Leider nicht. Multiplizier deinen Term zur Kontrolle aus.']) };
  }

  function onChoice(t, b) {
    var st = t._qg;
    if (st.solved || b.disabled) return;
    if (st.multi) {
      var on = !b.classList.contains('is-selected');
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.remove('is-wrong');
      return;
    }
    st.attempts++;
    if (b.hasAttribute('data-correct')) {
      b.classList.add('is-correct');
      $$('.choice', t).forEach(function (x) { x.disabled = true; });
      var why = b.getAttribute('data-why');
      solveTask(t, b.textContent.trim().slice(0, 120), okMessage(st) + (why ? ' ' + why : ''));
    } else {
      b.classList.add('is-wrong');
      b.disabled = true;
      failTask(t, b.getAttribute('data-why') || vary('bad', ['Leider nicht. Überleg noch mal in Ruhe.', 'Das stimmt so nicht. Probier eine andere Antwort.', 'Nicht ganz. Lies die Frage noch einmal genau.']));
    }
  }

  function checkMulti(t) {
    var st = t._qg;
    if (st.solved) return;
    var all = $$('.choice', t);
    var sel = all.filter(function (b) { return b.classList.contains('is-selected'); });
    if (!sel.length) { say(t, 'info', 'Wähle zuerst mindestens eine Antwort aus.'); return; }
    st.attempts++;
    var wrongSel = sel.filter(function (b) { return !b.hasAttribute('data-correct'); });
    var missing = all.filter(function (b) { return b.hasAttribute('data-correct') && !b.classList.contains('is-selected'); });
    if (!wrongSel.length && !missing.length) {
      all.forEach(function (b) { b.disabled = true; b.classList.remove('is-selected'); if (b.hasAttribute('data-correct')) b.classList.add('is-correct'); });
      solveTask(t, sel.map(function (b) { return b.textContent.trim(); }).join(' | ').slice(0, 200), okMessage(st));
      return;
    }
    wrongSel.forEach(function (b) { b.classList.add('is-wrong'); b.classList.remove('is-selected'); b.setAttribute('aria-pressed', 'false'); });
    var whys = wrongSel.map(function (b) { return b.getAttribute('data-why'); }).filter(Boolean);
    var msg = wrongSel.length ? (wrongSel.length === 1 ? 'Eine deiner Antworten stimmt nicht (rot markiert).' : 'Einige deiner Antworten stimmen nicht (rot markiert).') : '';
    if (missing.length) msg += (msg ? ' ' : '') + (missing.length === 1 ? 'Außerdem fehlt noch eine richtige Antwort.' : 'Es fehlen noch richtige Antworten.');
    if (!wrongSel.length && missing.length) msg = missing.length === 1 ? 'Gut so weit – aber eine richtige Antwort fehlt noch.' : 'Gut so weit – aber es fehlen noch richtige Antworten.';
    if (whys.length) msg += '<span class="fb-nudge">' + whys.join('<br>') + '</span>';
    failTask(t, msg);
  }

  /* ---------- Aufgabenlisten & Fortschritt ---------- */
  function initTaskList(list) {
    var tasks = $$(':scope > .task', list);
    tasks.forEach(function (t, i) {
      if (!t.dataset.label) buildHead(t, 'Aufgabe ' + (i + 1));
    });
    if (!list._qg) {
      list._qg = true;
      var head = h('div', { class: 'tasks-head no-print' },
        '<span class="tasks-label"></span><span class="tasks-bar" aria-hidden="true"><span></span></span><span class="tasks-count"></span>');
      list.insertBefore(head, list.firstChild);
      list._head = head;
    }
  }
  function updateTaskLists() {
    $$('.tasks').forEach(function (list) {
      if (!list._head) return;
      var tasks = $$(':scope > .task', list);
      var done = tasks.filter(function (t) { return t.classList.contains('is-solved') || (t.dataset.id && QG.solved(t.dataset.id)); }).length;
      list._head.querySelector('.tasks-label').textContent = tasks.length === 1 ? '1 Aufgabe' : tasks.length + ' Aufgaben';
      list._head.querySelector('.tasks-count').textContent = done + '/' + tasks.length + ' gelöst';
      list._head.querySelector('.tasks-bar > span').style.width = (tasks.length ? 100 * done / tasks.length : 0) + '%';
      list.classList.toggle('all-done', tasks.length > 0 && done === tasks.length);
    });
  }

  function countable(t) { var id = t.dataset.id; return !!id && id.indexOf('train-') !== 0; }
  QG.progress = function (chapterId) {
    if (chapterId) {
      var sec = document.getElementById(chapterId);
      if (!sec) return { done: 0, total: 0 };
      var ts = $$('.task[data-id]', sec).filter(countable);
      var seen = {};
      ts = ts.filter(function (t) { if (seen[t.dataset.id]) return false; seen[t.dataset.id] = 1; return true; });
      return { done: ts.filter(function (t) { return QG.solved(t.dataset.id); }).length, total: ts.length };
    }
    var d = 0, tot = 0;
    chapters.forEach(function (c) { var p = QG.progress(c.id); d += p.done; tot += p.total; });
    return { done: d, total: tot };
  };

  var progressQueued = false;
  function updateProgress() {
    if (progressQueued) return;
    progressQueued = true;
    setTimeout(function () {
      progressQueued = false;
      updateTaskLists();
      var all = QG.progress();
      var bar = $('.tb-progress');
      var pct = all.total ? Math.round(100 * all.done / all.total) : 0;
      if (bar) {
        bar.firstElementChild.style.width = pct + '%';
        bar.setAttribute('aria-valuenow', String(pct));
        bar.setAttribute('aria-valuetext', all.done + ' von ' + all.total + ' Aufgaben gelöst');
        bar.title = all.done + ' von ' + all.total + ' Aufgaben gelöst';
      }
      var tot = $('.sheet-total');
      if (tot) tot.textContent = all.done + ' von ' + all.total + ' Aufgaben gelöst';
      var per = {};
      chapters.forEach(function (c) {
        var p = per[c.id] = QG.progress(c.id);
        var item = c.menuItem;
        if (!item) return;
        item.querySelector('.menu-count').textContent = p.total ? p.done + '/' + p.total : '';
        item.querySelector('.menu-bar').style.display = p.total ? '' : 'none';
        item.querySelector('.menu-bar > span').style.width = (p.total ? 100 * p.done / p.total : 0) + '%';
        item.classList.toggle('is-done', p.total > 0 && p.done === p.total);
      });
      emit('progress', { done: all.done, total: all.total, chapters: per });
    }, 0);
  }
  QG.updateProgress = updateProgress;

  /* ---------- Widgets ---------- */
  var widgets = {};
  QG.widget = function (name, fn) {
    widgets[name] = fn;
    if (booted) {
      $$('[data-widget="' + name + '"]').forEach(function (el) { if (isLive(el)) initWidget(el); });
    }
  };
  function isLive(el) {
    var sec = el.closest('.chapter');
    return !sec || sec.classList.contains('is-active') || sec._seen;
  }
  function initWidget(el) {
    if (el._qgWidget) return;
    var fn = widgets[el.getAttribute('data-widget')];
    if (!fn) return;
    el._qgWidget = true;
    try { fn(el, QG); } catch (e) { console.error('[QG] Widget „' + el.getAttribute('data-widget') + '“ fehlgeschlagen', e); }
    QG.wire(el, { noWidgets: true });
  }
  function initWidgets(root) {
    $$('[data-widget]', root).forEach(function (el) { if (isLive(el)) initWidget(el); });
    if (root.nodeType === 1 && root.hasAttribute('data-widget') && isLive(root)) initWidget(root);
  }

  /* ---------- Verdrahten ---------- */
  QG.wire = function (root, opt) {
    root = root || document;
    opt = opt || {};
    initHeads(root);
    initBoxes(root);
    QG.math(root);
    $$self(FLEX_SEL, root).forEach(wrapInline);
    watchCalcs(root);
    $$self('ol.steps[data-stepper]', root).forEach(initStepper);
    $$self('.tasks', root).forEach(initTaskList);
    $$self('.task', root).forEach(initTask);
    if (!opt.noWidgets && booted) initWidgets(root);
    updateProgress();
    return root;
  };

  /** Aufgabe aus Spezifikation bauen (bereits verdrahtet). */
  QG.task = function (spec) {
    spec = spec || {};
    var t = h('div', { class: 'task' });
    if (spec.id) t.dataset.id = spec.id;
    if (spec.answer != null) t.dataset.answer = String(spec.answer);
    if (spec.kind) t.dataset.kind = spec.kind;
    if (spec.tol != null) t.dataset.tol = String(spec.tol);
    if (spec.level) t.dataset.level = String(spec.level);
    if (spec.label) t.dataset.label = spec.label;
    if (spec.prefix) t.dataset.prefix = spec.prefix;
    if (spec.suffix) t.dataset.suffix = spec.suffix;
    if (spec.placeholder) t.dataset.placeholder = spec.placeholder;
    if (spec.nudge === false) t.dataset.nudge = 'off';
    if (spec.keys) t.dataset.keys = Array.isArray(spec.keys) ? spec.keys.join(' ') : spec.keys;
    var html = '<p class="task-q">' + (spec.q || '') + '</p>';
    if (spec.body) html += spec.body;
    if (spec.choices) {
      t.dataset.kind = 'choice';
      html += '<div class="choices' + (spec.cols ? ' cols' : '') + '">' + spec.choices.map(function (c) {
        return '<button type="button" class="choice"' + (c.correct ? ' data-correct' : '') + (c.why ? ' data-why="' + esc(c.why) + '"' : '') + '>' + c.html + '</button>';
      }).join('') + '</div>';
    }
    (spec.wrong || []).forEach(function (w) { html += '<div class="wrong" data-match="' + esc(w.match) + '">' + w.msg + '</div>'; });
    (spec.hints || []).forEach(function (hh, i) {
      html += '<details class="hint"><summary>' + (spec.hints.length > 1 ? 'Tipp ' + (i + 1) : 'Tipp') + '</summary><div>' + hh + '</div></details>';
    });
    if (spec.solution) html += '<details class="solution"><summary>Lösung</summary><div>' + spec.solution + '</div></details>';
    t.innerHTML = html;
    QG.wire(t);
    return t;
  };

  /* ---------- Koordinatensystem ---------- */
  var NS = 'http://www.w3.org/2000/svg';
  var COLOR_NAMES = ['blue', 'green', 'orange', 'violet', 'pink', 'teal', 'red', 'yellow', 'slate'];
  function colorOf(c, fallback) {
    if (!c) return fallback || 'var(--accent)';
    if (COLOR_NAMES.indexOf(c) >= 0) return 'var(--c-' + c + ')';
    if (c === 'accent') return 'var(--accent)';
    if (c === 'text') return 'var(--text)';
    return c;
  }
  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] != null) e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  var plotCounter = 0;

  QG.plot = function (host, opts) {
    var o = {};
    var svg = svgEl('svg', { class: 'qg-plot', role: 'img', preserveAspectRatio: 'xMidYMid meet' });
    var id = 'qgp' + (++plotCounter);
    var old = host.querySelector(':scope > svg.qg-plot');
    if (old) old.remove();
    host.appendChild(svg);
    var U = 40, pad, W, H, ys;
    var cursor = null, lastPt = null;

    function X(x) { return pad.l + (x - o.xmin) * U; }
    function Y(y) { return pad.t + (o.ymax - y) * U * ys; }
    function fromSvg(px, py) { return { x: o.xmin + (px - pad.l) / U, y: o.ymax - (py - pad.t) / (U * ys) }; }

    function niceStep(range, px) {
      var perUnit = px / range;
      var steps = [1, 2, 5, 10, 20, 50, 100];
      for (var i = 0; i < steps.length; i++) if (perUnit * steps[i] >= 26) return steps[i];
      return 100;
    }

    function render() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      var xr = o.xmax - o.xmin, yr = o.ymax - o.ymin;
      ys = o.yscale || 1;
      U = o.unit || 40;
      pad = { l: 14, r: 22, t: 22, b: 14 };
      var w0 = xr * U + pad.l + pad.r;
      var cw = svg.clientWidth || host.clientWidth || 340;
      if (cw < 50) cw = 340;
      var k = w0 / Math.min(cw, 560);       // User-Units pro Bildschirm-Pixel
      var fs = Math.min(13 * k, U * 0.5);   // Schriftgröße in User-Units
      // Platz für Beschriftung, falls Achsen am Rand liegen
      if (o.xmin >= 0) pad.l += fs * 1.6;
      if (o.ymin >= 0) pad.b += fs * 1.4;
      W = xr * U + pad.l + pad.r;
      H = yr * U * ys + pad.t + pad.b;
      svg.setAttribute('viewBox', '0 0 ' + W.toFixed(1) + ' ' + H.toFixed(1));
      svg.style.setProperty('--qg-fs', fs.toFixed(2) + 'px');
      svg.setAttribute('aria-label', o.label || 'Koordinatensystem');
      var defs = svgEl('defs', null, svg);
      var cp = svgEl('clipPath', { id: id + 'c' }, defs);
      svgEl('rect', { x: pad.l, y: pad.t, width: xr * U, height: yr * U * ys }, cp);

      var stepX = o.xstep || niceStep(xr, Math.min(cw, 560) * (xr * U) / W);
      var stepY = o.ystep || niceStep(yr, Math.min(cw, 560) * (yr * U * ys) / W);
      var gridStep = o.gridStep || 1;

      // Raster
      if (o.grid !== false) {
        var g = svgEl('g', { class: 'grid' }, svg);
        if (o.minor) {
          for (var mx = Math.ceil(o.xmin / (gridStep / 2)) * (gridStep / 2); mx <= o.xmax + EPS; mx += gridStep / 2) svgEl('line', { class: 'minor', x1: X(mx), x2: X(mx), y1: Y(o.ymin), y2: Y(o.ymax) }, g);
          for (var my = Math.ceil(o.ymin / (gridStep / 2)) * (gridStep / 2); my <= o.ymax + EPS; my += gridStep / 2) svgEl('line', { class: 'minor', y1: Y(my), y2: Y(my), x1: X(o.xmin), x2: X(o.xmax) }, g);
        }
        var gsx = Math.max(gridStep, stepX >= 5 ? stepX / 5 : gridStep);
        var gsy = Math.max(gridStep, stepY >= 5 ? stepY / 5 : gridStep);
        for (var gx = Math.ceil(o.xmin / gsx) * gsx; gx <= o.xmax + EPS; gx += gsx) svgEl('line', { x1: X(gx), x2: X(gx), y1: Y(o.ymin), y2: Y(o.ymax) }, g);
        for (var gy = Math.ceil(o.ymin / gsy) * gsy; gy <= o.ymax + EPS; gy += gsy) svgEl('line', { y1: Y(gy), y2: Y(gy), x1: X(o.xmin), x2: X(o.xmax) }, g);
      }

      // Achsen
      var ax = svgEl('g', { class: 'axes' }, svg);
      var y0 = Math.min(Math.max(0, o.ymin), o.ymax), x0 = Math.min(Math.max(0, o.xmin), o.xmax);
      var ah = Math.max(7, fs * 0.55); // Pfeilgröße
      svgEl('line', { x1: X(o.xmin), x2: X(o.xmax) + pad.r - 4, y1: Y(y0), y2: Y(y0) }, ax);
      svgEl('path', { d: 'M' + (X(o.xmax) + pad.r - 2) + ' ' + Y(y0) + 'l' + (-ah * 1.5) + ' ' + (-ah * 0.75) + 'v' + (ah * 1.5) + 'z' }, ax);
      svgEl('line', { x1: X(x0), x2: X(x0), y1: Y(o.ymin), y2: 4 }, ax);
      svgEl('path', { d: 'M' + X(x0) + ' 2l' + (-ah * 0.75) + ' ' + (ah * 1.5) + 'h' + (ah * 1.5) + 'z' }, ax);
      var labelsLeft = (X(x0) - X(o.xmin)) > fs * 1.8 || o.xmin >= 0;
      var xn = svgEl('text', { class: 'axis-name', x: X(o.xmax) + pad.r - 4, y: Y(y0) - fs * 0.55, 'text-anchor': 'end' }, ax);
      xn.textContent = o.xname || 'x';
      var yn = svgEl('text', { class: 'axis-name', x: labelsLeft ? X(x0) + fs * 0.6 : X(x0) - fs * 0.6, y: fs * 0.95 + 2, 'text-anchor': labelsLeft ? 'start' : 'end' }, ax);
      yn.textContent = o.yname || 'y';

      // Ticks & Beschriftung
      if (o.ticks !== false) {
        var tk = svgEl('g', { class: 'ticks' }, svg);
        var tl = Math.max(4, fs * 0.3);
        for (var tx = Math.ceil(o.xmin / stepX) * stepX; tx <= o.xmax + EPS; tx += stepX) {
          if (Math.abs(tx) < EPS) continue;
          svgEl('line', { x1: X(tx), x2: X(tx), y1: Y(y0) - tl, y2: Y(y0) + tl }, tk);
          var lt = svgEl('text', { x: X(tx), y: Y(y0) + tl + fs * 0.95, 'text-anchor': 'middle' }, tk);
          lt.textContent = fmt(tx);
        }
        for (var ty = Math.ceil(o.ymin / stepY) * stepY; ty <= o.ymax + EPS; ty += stepY) {
          if (Math.abs(ty) < EPS) continue;
          svgEl('line', { y1: Y(ty), y2: Y(ty), x1: X(x0) - tl, x2: X(x0) + tl }, tk);
          var ly = svgEl('text', { x: labelsLeft ? X(x0) - tl - 3 : X(x0) + tl + 3, y: Y(ty) + fs * 0.35, 'text-anchor': labelsLeft ? 'end' : 'start' }, tk);
          ly.textContent = fmt(ty);
        }
        if (o.ymin <= 0 && o.ymax >= 0 && o.xmin <= 0 && o.xmax >= 0) {
          var l0 = svgEl('text', { x: X(0) - tl - 2, y: Y(0) + tl + fs * 0.95, 'text-anchor': 'end' }, tk);
          l0.textContent = '0';
        }
      }

      // Strecken / Geraden
      var cl = svgEl('g', { 'clip-path': 'url(#' + id + 'c)' }, svg);
      (o.lines || []).forEach(function (L) {
        var a;
        if (L.x != null) a = { x1: X(L.x), x2: X(L.x), y1: Y(o.ymin), y2: Y(o.ymax) };
        else if (L.y != null) a = { x1: X(o.xmin), x2: X(o.xmax), y1: Y(L.y), y2: Y(L.y) };
        else a = { x1: X(L.x1), x2: X(L.x2), y1: Y(L.y1), y2: Y(L.y2) };
        a.class = 'seg';
        a.stroke = colorOf(L.color, 'var(--text-dim)');
        if (L.dash) a['stroke-dasharray'] = L.dash === true ? '6 5' : L.dash;
        if (L.width) a.style = 'stroke-width:' + L.width + 'px';
        svgEl('line', a, cl);
      });

      // Funktionsgraphen
      var labels = [];
      (o.fns || []).forEach(function (F) {
        if (!F || typeof F.f !== 'function') return;
        var a = F.domain ? Math.max(F.domain[0], o.xmin) : o.xmin;
        var b = F.domain ? Math.min(F.domain[1], o.xmax) : o.xmax;
        var n = Math.max(120, Math.ceil((b - a) * 24));
        var d = '', pen = false, lo = o.ymin - yr * 4, hi = o.ymax + yr * 4;
        var lastIn = null;
        for (var i = 0; i <= n; i++) {
          var x = a + (b - a) * i / n, y;
          try { y = F.f(x); } catch (e) { y = NaN; }
          if (typeof y !== 'number' || !isFinite(y)) { pen = false; continue; }
          var yc = Math.max(lo, Math.min(hi, y));
          d += (pen ? 'L' : 'M') + X(x).toFixed(2) + ' ' + Y(yc).toFixed(2);
          pen = true;
          if (y >= o.ymin && y <= o.ymax) lastIn = { x: x, y: y };
        }
        var attrs = { class: 'fn', d: d, stroke: colorOf(F.color) };
        if (F.dash) attrs['stroke-dasharray'] = F.dash === true ? '8 6' : F.dash;
        if (F.width) attrs.style = 'stroke-width:' + F.width + 'px';
        svgEl('path', attrs, cl);
        if (F.label) {
          var at = F.labelAt != null ? { x: F.labelAt, y: F.f(F.labelAt) } : lastIn;
          if (at) labels.push({ x: at.x, y: at.y, text: F.label, color: colorOf(F.color), cls: 'fn-label', pos: F.labelPos || 'w' });
        }
      });

      // Punkte
      var pg = svgEl('g', { class: 'points' }, svg);
      (o.points || []).forEach(function (P) {
        if (P.x < o.xmin - EPS || P.x > o.xmax + EPS || P.y < o.ymin - EPS || P.y > o.ymax + EPS) return;
        svgEl('circle', { class: 'pt', cx: X(P.x), cy: Y(P.y), r: (P.r || 5.5) * Math.max(1, k * 0.9), fill: colorOf(P.color) }, pg);
        if (P.label) labels.push({ x: P.x, y: P.y, text: P.label, color: P.labelColor ? colorOf(P.labelColor) : null, cls: 'pt-label', pos: P.pos || 'ne' });
      });
      (o.texts || []).forEach(function (T) { labels.push({ x: T.x, y: T.y, text: T.text, color: T.color ? colorOf(T.color) : null, cls: 'pt-label', pos: T.pos || 'c' }); });

      // Beschriftungen
      var lg = svgEl('g', { class: 'labels' }, svg);
      labels.forEach(function (Lb) {
        var off = fs * 0.55;
        var dx = 0, dy = 0, anchor = 'middle';
        var p = Lb.pos;
        if (p.indexOf('e') >= 0) { dx = off; anchor = 'start'; }
        if (p.indexOf('w') >= 0) { dx = -off; anchor = 'end'; }
        if (p.indexOf('n') >= 0) dy = -off;
        if (p.indexOf('s') >= 0) dy = off + fs * 0.75;
        if (p === 'e' || p === 'w') dy = fs * 0.35;
        if (p === 'c') dy = fs * 0.35;
        var tx = svgEl('text', { class: Lb.cls, x: X(Lb.x) + dx, y: Y(Lb.y) + dy, 'text-anchor': anchor }, lg);
        if (Lb.color) tx.setAttribute('style', 'fill:' + Lb.color);
        tx.textContent = Lb.text;
        // Beschriftung am Rand des Bildes halten
        var bb = null;
        try { bb = tx.getBBox(); } catch (e) { bb = null; }
        if (bb && bb.width) {
          var m = 2, sx = 0, sy = 0;
          if (bb.x < m) sx = m - bb.x; else if (bb.x + bb.width > W - m) sx = W - m - bb.x - bb.width;
          if (bb.y < m) sy = m - bb.y; else if (bb.y + bb.height > H - m) sy = H - m - bb.y - bb.height;
          if (sx) tx.setAttribute('x', (parseFloat(tx.getAttribute('x')) + sx).toFixed(1));
          if (sy) tx.setAttribute('y', (parseFloat(tx.getAttribute('y')) + sy).toFixed(1));
        }
      });

      // Interaktiver Cursor
      cursor = svgEl('g', { class: 'cursor' }, svg);
      if (lastPt) drawCursor(lastPt);
    }

    function drawCursor(pt) {
      if (!cursor) return;
      while (cursor.firstChild) cursor.removeChild(cursor.firstChild);
      if (!pt) return;
      var fs = parseFloat(svg.style.getPropertyValue('--qg-fs')) || 14;
      svgEl('line', { x1: X(pt.x), x2: X(pt.x), y1: Y(Math.min(Math.max(0, o.ymin), o.ymax)), y2: Y(pt.y) }, cursor);
      svgEl('line', { x1: X(Math.min(Math.max(0, o.xmin), o.xmax)), x2: X(pt.x), y1: Y(pt.y), y2: Y(pt.y) }, cursor);
      svgEl('circle', { cx: X(pt.x), cy: Y(pt.y), r: fs * 0.42 }, cursor);
      var right = X(pt.x) < W * 0.62;
      var t = svgEl('text', { x: X(pt.x) + (right ? fs * 0.7 : -fs * 0.7), y: Y(pt.y) - fs * 0.6, 'text-anchor': right ? 'start' : 'end' }, cursor);
      t.textContent = (o.pointName || 'P') + '(' + fmt(pt.x) + ' | ' + fmt(pt.y) + ')';
    }

    function onPointer(e) {
      if (!o.interactive) return;
      var m = svg.getScreenCTM();
      if (!m) return;
      var p = svg.createSVGPoint();
      p.x = e.clientX; p.y = e.clientY;
      var q = p.matrixTransform(m.inverse());
      var c = fromSvg(q.x, q.y);
      var snap = o.snap || 0.5;
      var x = Math.round(c.x / snap) * snap;
      x = Math.max(o.xmin, Math.min(o.xmax, x));
      var y;
      if (o.interactive === 'trace' && o.fns && o.fns[0]) y = o.fns[0].f(x);
      else y = Math.max(o.ymin, Math.min(o.ymax, Math.round(c.y / snap) * snap));
      if (!isFinite(y)) return;
      lastPt = { x: x, y: y };
      drawCursor(lastPt);
      if (typeof o.onPoint === 'function') o.onPoint(lastPt, e);
    }
    svg.addEventListener('pointerdown', onPointer);
    svg.addEventListener('pointermove', function (e) { if (e.buttons || e.pointerType === 'mouse') onPointer(e); });

    var api = {
      svg: svg,
      update: function (n) { Object.assign(o, n || {}); render(); return api; },
      toSvg: function (x, y) { return { x: X(x), y: Y(y) }; },
      fromSvg: fromSvg,
      setCursor: function (pt) { lastPt = pt; drawCursor(pt); },
      get opts() { return o; }
    };
    Object.assign(o, { xmin: -5, xmax: 5, ymin: -5, ymax: 5, grid: true }, opts || {});
    render();
    if (window.ResizeObserver) {
      var lastW = 0;
      new ResizeObserver(function () {
        var w = Math.round(svg.clientWidth);
        if (w > 0 && Math.abs(w - lastW) > 8) { lastW = w; render(); }
      }).observe(svg);
    }
    return api;
  };

  /* =====================================================================
     3. App-Shell: Router, Menü, Theme, Druck
     ===================================================================== */
  var chapters = [];
  var current = null;
  var booted = false;
  QG.chapters = chapters;
  QG.current = function () { return current ? current.id : null; };

  function collectChapters() {
    chapters.length = 0;
    $$('section.chapter').forEach(function (sec) {
      chapters.push({
        id: sec.id,
        title: sec.dataset.title || ($('h1', sec) || {}).textContent || sec.id,
        short: sec.dataset.short || sec.dataset.title || sec.id,
        color: sec.dataset.color || 'violet',
        icon: sec.dataset.icon || '•',
        el: sec
      });
    });
  }

  function buildMenu() {
    var list = $('.menu-list');
    if (!list) return;
    list.innerHTML = '';
    chapters.forEach(function (c) {
      var a = h('a', { class: 'menu-item', href: '#' + c.id, 'data-color': c.color },
        '<span class="menu-icon" aria-hidden="true">' + esc(c.icon) + '</span>' +
        '<span class="menu-text"><span class="menu-title">' + esc(c.title) + '</span><span class="menu-bar" aria-hidden="true"><span></span></span></span>' +
        '<span class="menu-count"></span>');
      a.addEventListener('click', function () { closeMenu(); });
      c.menuItem = a;
      list.appendChild(a);
    });
  }

  var menu;
  function openMenu() {
    if (!menu) return;
    if (menu.showModal) { if (!menu.open) menu.showModal(); }
    else menu.setAttribute('open', '');
    $$('[data-qg-menu]').forEach(function (b) { b.setAttribute('aria-expanded', 'true'); });
    var cur = $('.menu-item[aria-current="page"]', menu);
    if (cur) setTimeout(function () { cur.focus({ preventScroll: true }); cur.scrollIntoView({ block: 'nearest' }); }, 30);
  }
  function closeMenu() {
    if (!menu) return;
    if (menu.close && menu.open) menu.close(); else menu.removeAttribute('open');
    $$('[data-qg-menu]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
  }
  QG.openMenu = openMenu;
  QG.closeMenu = closeMenu;

  function setTheme(t) {
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    QG.store.set('theme', t || null);
    var bg = getComputedStyle(document.body).backgroundColor;
    $$('meta[name="theme-color"]').forEach(function (m) { m.setAttribute('content', bg); });
    emit('theme', effectiveTheme());
  }
  function effectiveTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  QG.theme = effectiveTheme;
  QG.setTheme = setTheme;

  function renderNav() {
    var nav = $('.ch-nav');
    if (!nav) return;
    nav.innerHTML = '';
    if (!current) return;
    var i = chapters.indexOf(current);
    var prev = chapters[i - 1], next = chapters[i + 1];
    if (prev) nav.appendChild(h('a', { class: 'prev', href: '#' + prev.id, 'data-color': prev.color },
      '<span class="nav-dir">← Zurück</span><span class="nav-title">' + esc(prev.icon + ' ' + prev.short) + '</span>'));
    if (next) nav.appendChild(h('a', { class: 'next', href: '#' + next.id, 'data-color': current.color },
      '<span class="nav-dir">Weiter →</span><span class="nav-title">' + esc(next.icon + ' ' + next.short) + '</span>'));
  }

  function show(ch, target, initial) {
    var changed = current !== ch;
    current = ch;
    chapters.forEach(function (c) {
      var on = c === ch;
      c.el.classList.toggle('is-active', on);
      if (c.menuItem) { if (on) c.menuItem.setAttribute('aria-current', 'page'); else c.menuItem.removeAttribute('aria-current'); }
    });
    ch.el._seen = true;
    document.body.setAttribute('data-accent', ch.color);
    document.body.setAttribute('data-chapter', ch.id);
    var ic = $('.tb-icon'); if (ic) ic.textContent = ch.icon;
    var sh = $('.tb-short'); if (sh) sh.textContent = ch.short;
    document.title = (ch.id === 'start' ? 'Quadratische Gleichungen ohne Formel – Lernseite Klasse 9' : ch.title + ' · Quadratische Gleichungen ohne Formel');
    renderNav();
    initWidgets(ch.el);
    if (target) {
      if (target.tagName === 'DETAILS') target.open = true;
      setTimeout(function () { target.scrollIntoView({ block: 'start' }); }, 0);
    } else if (changed || !initial) {
      window.scrollTo(0, 0);
    }
    if (changed && !initial) {
      var h1 = $('.ch-head h1', ch.el);
      if (h1) h1.focus({ preventScroll: true });
    }
    if (changed) emit('chapter', ch.id);
  }

  function route(initial) {
    if (!chapters.length) return;
    var hash = '';
    try { hash = decodeURIComponent(location.hash.slice(1)); } catch (e) { hash = location.hash.slice(1); }
    var ch = null, target = null;
    for (var i = 0; i < chapters.length; i++) if (chapters[i].id === hash) ch = chapters[i];
    if (!ch && hash) {
      var el = document.getElementById(hash);
      var sec = el && el.closest('.chapter');
      if (sec) { ch = chapters.filter(function (c) { return c.el === sec; })[0]; target = el; }
    }
    if (!ch) {
      ch = chapters.filter(function (c) { return c.id === 'start'; })[0] || chapters[0];
      if (hash && history.replaceState) history.replaceState(null, '', '#' + ch.id);
    }
    show(ch, target, initial);
  }

  QG.go = function (id) {
    if (('#' + id) === location.hash) route(false);
    else location.hash = id;
  };

  /* Druck: Details aufklappen (Lösungen nur bei data-print-solutions), Stepper komplett */
  var printOpened = [];
  var printing = false;
  function beforePrint() {
    printing = true;
    printOpened = [];
    var sec = current ? current.el : document;
    var withSol = current && current.el.hasAttribute('data-print-solutions');
    $$('details', sec).forEach(function (d) {
      if (d.open) return;
      if (d.classList.contains('solution') && !withSol) return;
      d.open = true;
      printOpened.push(d);
    });
    $$('.calc.stack-op', sec).forEach(function (c) { c.classList.remove('stack-op'); c._qgW = -1; });
    emit('print', { phase: 'before', chapter: current ? current.id : null });
  }
  function afterPrint() {
    printOpened.forEach(function (d) { d.open = false; });
    printOpened = [];
    printing = false;
    emit('print', { phase: 'after', chapter: current ? current.id : null });
  }

  /* Selbsttest für Autor:innen: QG.selfcheck() in der Konsole */
  QG.selfcheck = function () {
    var issues = [];
    var ids = {};
    $$('.task').forEach(function (t) {
      var id = t.dataset.id;
      if (id) { if (ids[id]) issues.push('Doppelte data-id: ' + id); ids[id] = 1; }
      var kind = taskKind(t);
      if (kind === 'set' && !parseAnswer(t.dataset.answer)) issues.push('data-answer nicht lesbar (' + (id || '?') + '): ' + t.dataset.answer);
      if (kind === 'number' && isNaN(evalExpr(String(t.dataset.answer).replace(/,/g, '.').replace(/sqrt/g, '√')))) issues.push('data-answer (number) nicht lesbar (' + (id || '?') + '): ' + t.dataset.answer);
      if (kind === 'choice' && !$('.choice[data-correct]', t)) issues.push('choice ohne data-correct (' + (id || '?') + ')');
      if (kind === 'text' && !t.dataset.answer) issues.push('text ohne data-answer (' + (id || '?') + ')');
      $$(':scope > .wrong[data-match]', t).forEach(function (w) {
        var m = w.getAttribute('data-match');
        if (m !== '*1' && kind !== 'text' && !parseAnswer(m)) issues.push('data-match nicht lesbar (' + (id || '?') + '): ' + m);
      });
    });
    $$('section.chapter').forEach(function (s) {
      ['title', 'short', 'color', 'icon'].forEach(function (a) { if (!s.dataset[a]) issues.push('Kapitel #' + s.id + ' ohne data-' + a); });
      if (!$('.ch-head h1', s)) issues.push('Kapitel #' + s.id + ' ohne .ch-head h1');
    });
    $$('[data-widget]').forEach(function (w) { if (!widgets[w.getAttribute('data-widget')]) issues.push('Widget nicht registriert: ' + w.getAttribute('data-widget')); });
    return issues;
  };

  function boot() {
    if (booted) return;
    collectChapters();
    buildMenu();
    menu = document.getElementById('qg-menu');
    QG.wire(document, { noWidgets: true });
    booted = true;

    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-qg-menu], [data-qg-close], [data-qg-theme], [data-qg-print], [data-qg-go]');
      if (!t) return;
      if (t.hasAttribute('data-qg-menu')) openMenu();
      else if (t.hasAttribute('data-qg-close')) closeMenu();
      else if (t.hasAttribute('data-qg-theme')) setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
      else if (t.hasAttribute('data-qg-print')) { closeMenu(); setTimeout(function () { window.print(); }, 250); }
      else if (t.hasAttribute('data-qg-go')) { e.preventDefault(); QG.go(t.getAttribute('data-qg-go')); }
    });
    if (menu) {
      menu.addEventListener('click', function (e) { if (e.target === menu) closeMenu(); }); // Klick auf Backdrop
      menu.addEventListener('close', function () { $$('[data-qg-menu]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); }); });
    }
    window.addEventListener('hashchange', function () { route(false); });
    var fitT = 0;
    window.addEventListener('resize', function () {
      clearTimeout(fitT);
      fitT = setTimeout(function () { if (current) QG.fitCalcs(current.el); }, 150);
    });
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onMq = function () { if (!document.documentElement.getAttribute('data-theme')) emit('theme', effectiveTheme()); };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
    }
    var stored = QG.store.get('theme', null);
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
      var bg = getComputedStyle(document.body).backgroundColor;
      $$('meta[name="theme-color"]').forEach(function (m) { m.setAttribute('content', bg); });
    }

    route(true);
    updateProgress();
    var issues = QG.selfcheck();
    if (issues.length) console.warn('[QG] selfcheck:\n- ' + issues.join('\n- '));
    emit('ready');
  }

  function scheduleBoot() { setTimeout(boot, 0); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot);
  else scheduleBoot();
})();

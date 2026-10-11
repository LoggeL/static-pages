/* ==================================================================
   js/core.js
   ================================================================== */
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

/* ==================================================================
   js/00-start.js
   ================================================================== */
;try {
/* Kapitel 00 · Start: Kapitel-Übersicht, Lernplan, Selbsttest-Auswertung */
(function () {
  'use strict';
  var QG = window.QG;
  if (!QG) return;
  var esc = QG.esc;

  /* Zuletzt besuchtes Kapitel merken (für „Weiter bei …“) */
  QG.on('chapter', function (id) {
    if (id && id !== 'start') QG.store.set('start:last', id);
  });

  /* ---------- Kapitel-Übersicht mit Fortschritt ---------- */
  QG.widget('start-overview', function (el) {
    var R = 27, CIRC = 2 * Math.PI * R;
    var tiles = {};
    var built = 0;

    function build() {
      var chs = QG.chapters.filter(function (c) { return c.id !== 'start'; });
      built = chs.length;
      el.innerHTML =
        '<div class="st-ov-head">' +
          '<div class="st-ring-wrap" aria-hidden="true">' +
            '<svg viewBox="0 0 64 64"><circle class="st-ring-bg" cx="32" cy="32" r="' + R + '"/>' +
            '<circle class="st-ring-fg" cx="32" cy="32" r="' + R + '" stroke-dasharray="' + CIRC.toFixed(2) + '" stroke-dashoffset="' + CIRC.toFixed(2) + '"/></svg>' +
            '<span class="st-ring-pct">0 %</span>' +
          '</div>' +
          '<div class="st-ov-text"><strong class="st-ov-main">Noch nichts gelöst</strong><span class="st-ov-sub"></span></div>' +
          '<a class="btn primary st-resume" href="#grundlagen" hidden></a>' +
        '</div>' +
        '<div class="st-tiles"></div>';
      var grid = el.querySelector('.st-tiles');
      tiles = {};
      chs.forEach(function (c) {
        var a = QG.h('a', { class: 'st-tile', href: '#' + c.id, 'data-color': c.color },
          '<span class="st-tile-icon" aria-hidden="true">' + esc(c.icon) + '</span>' +
          '<span class="st-tile-title">' + esc(c.title) + '</span>' +
          '<span class="st-tile-foot"><span class="st-tile-bar" aria-hidden="true"><span></span></span><span class="st-tile-count"></span></span>');
        grid.appendChild(a);
        tiles[c.id] = a;
      });
    }

    function update(per) {
      if (built !== QG.chapters.length - 1) build();
      var done = 0, total = 0;
      var last = QG.store.get('start:last', null);
      QG.chapters.forEach(function (c) {
        var p = (per && per[c.id]) || QG.progress(c.id);
        done += p.done; total += p.total;
        var a = tiles[c.id];
        if (!a) return;
        var isDone = p.total > 0 && p.done === p.total;
        a.classList.toggle('is-done', isDone);
        a.classList.toggle('is-last', c.id === last && !isDone);
        a.querySelector('.st-tile-bar > span').style.width = (p.total ? 100 * p.done / p.total : 0) + '%';
        a.querySelector('.st-tile-bar').style.visibility = p.total ? '' : 'hidden';
        a.querySelector('.st-tile-count').textContent = p.total ? (isDone ? '✓ ' : '') + p.done + '/' + p.total : ({ training: '∞ Aufgaben', 'probe-hue': 'mit Timer', spickzettel: 'zum Ausdrucken', nachhilfe: 'Leitfaden' }[c.id] || 'ansehen');
        a.setAttribute('aria-label', c.title + (p.total ? ', ' + p.done + ' von ' + p.total + ' Aufgaben gelöst' : ''));
      });
      var pct = total ? Math.round(100 * done / total) : 0;
      el.querySelector('.st-ring-fg').setAttribute('stroke-dashoffset', (CIRC * (1 - pct / 100)).toFixed(2));
      el.querySelector('.st-ring-pct').textContent = pct + ' %';
      el.querySelector('.st-ov-main').textContent = done === 0 ? 'Noch nichts gelöst – leg los!' :
        done === total ? 'Alles gelöst – stark! 🎉' : done + ' von ' + total + ' Aufgaben gelöst';
      el.querySelector('.st-ov-sub').textContent = done === 0 ? 'Starte am besten mit den Grundlagen oder dem Selbsttest.' :
        done === total ? 'Jetzt noch die Probe-HÜ unter Zeit – dann bist du bereit.' : 'Jede gelöste Aufgabe zählt.';
      var btn = el.querySelector('.st-resume');
      var lastCh = QG.chapters.filter(function (c) { return c.id === last; })[0];
      if (lastCh) {
        btn.hidden = false;
        btn.setAttribute('href', '#' + lastCh.id);
        btn.textContent = 'Weiter bei ' + lastCh.icon + ' ' + lastCh.short;
      } else if (done === 0) {
        btn.hidden = false;
        btn.setAttribute('href', '#grundlagen');
        btn.textContent = 'Mit den Grundlagen starten';
      } else btn.hidden = true;
    }

    build();
    update();
    QG.on('progress', function (d) { update(d && d.chapters); });
    QG.on('chapter', function (id) { if (id === 'start') update(); });
  });

  /* ---------- Lernplan mit Checkboxen ---------- */
  QG.widget('start-plan', function (el) {
    var KEY = 'start:plan';
    var state = QG.store.get(KEY, {}) || {};
    var days = Array.prototype.slice.call(el.querySelectorAll('.st-day'));

    days.forEach(function (day) {
      var head = day.querySelector('.st-day-head');
      var cnt = QG.h('span', { class: 'st-day-count', 'aria-live': 'polite' });
      head.appendChild(cnt);
      day._cnt = cnt;
      day.querySelectorAll('input[type="checkbox"][data-key]').forEach(function (cb) {
        cb.checked = !!state[cb.dataset.key];
        cb.addEventListener('change', function () {
          var wasDone = day.classList.contains('is-done');
          if (cb.checked) state[cb.dataset.key] = 1; else delete state[cb.dataset.key];
          QG.store.set(KEY, state);
          render();
          if (!wasDone && day.classList.contains('is-done')) {
            var n = day.getAttribute('data-day');
            QG.toast(n === '4' ? 'Lernplan komplett – du bist bereit für die HÜ! 💪' : 'Tag ' + n + ' geschafft! 💪', { type: 'ok' });
            QG.celebrate(day.querySelector('.st-day-head'));
          }
        });
      });
    });

    var foot = QG.h('div', { class: 'st-plan-foot no-print' },
      '<p class="small muted">Wird nur auf diesem Gerät gespeichert.</p>');
    var reset = QG.h('button', { type: 'button', class: 'btn ghost' }, 'Häkchen zurücksetzen');
    reset.addEventListener('click', function () {
      if (!Object.keys(state).length) return;
      state = {};
      QG.store.set(KEY, state);
      el.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { cb.checked = false; });
      render();
      QG.toast('Lernplan zurückgesetzt');
    });
    foot.appendChild(reset);
    el.parentNode.insertBefore(foot, el.nextSibling);

    function render() {
      days.forEach(function (day) {
        var cbs = day.querySelectorAll('input[type="checkbox"]');
        var on = Array.prototype.filter.call(cbs, function (c) { return c.checked; }).length;
        day._cnt.textContent = on === cbs.length ? '✓ erledigt' : on + '/' + cbs.length;
        day.classList.toggle('is-done', on === cbs.length);
      });
      reset.hidden = !Object.keys(state).length;
    }
    render();
  });

  /* ---------- Selbsttest: Auswertung & Empfehlung ---------- */
  var ST_IDS = ['grund-0a', 'grund-0b', 'grund-0c'];
  var ST_KEY = 'start:selftest';
  var ST_INFO = {
    'grund-0a': {
      topic: 'Satz vom Nullprodukt',
      okTxt: 'Den Satz vom Nullprodukt kannst du schon.',
      tip: 'Lies den <a href="#gl-nullprodukt">Satz vom Nullprodukt</a> in den Grundlagen – das ist das Herzstück von Weg 2.'
    },
    'grund-0b': {
      topic: 'binomische Formeln',
      okTxt: 'Die binomischen Formeln sitzen.',
      tip: 'Wiederhole die <a href="#gl-fitcheck">binomischen Formeln im Fit-Check</a> – die brauchst du für Weg 2 und Weg 3.'
    },
    'grund-0c': {
      topic: 'Wurzel ziehen',
      okTxt: 'Wurzelziehen mit ± klappt.',
      tip: 'Schau dir <a href="#gl-anzahl">„Wie viele Lösungen?“</a> an: Bei <span class="m">x² = 16</span> gibt es <strong>zwei</strong> Lösungen (±).'
    }
  };

  QG.widget('start-selftest', function (el) {
    var res = QG.store.get(ST_KEY, {}) || {};
    // Ergebnisse aus früheren Sitzungen ohne Speicher: gelöste Aufgaben zählen als „ok“
    ST_IDS.forEach(function (id) { if (!res[id] && QG.solved(id)) res[id] = 'ok'; });

    function render() {
      var answered = ST_IDS.filter(function (id) { return res[id]; });
      if (!answered.length) { el.innerHTML = ''; return; }
      if (answered.length < ST_IDS.length) {
        el.innerHTML = '<p class="st-res-wait">' + answered.length + ' von 3 beantwortet – die Empfehlung erscheint nach der letzten Frage.</p>';
        return;
      }
      var miss = ST_IDS.filter(function (id) { return res[id] !== 'ok'; });
      var score = 3 - miss.length;
      var title, lead, items = [];
      if (score === 3) {
        title = 'Starke Basis!';
        lead = 'Du hast alles auf Anhieb gewusst. Du kannst direkt mit den drei Wegen loslegen.';
        items.push('<li class="ok"><span>Überflieg die <a href="#grundlagen">Grundlagen</a> nur kurz – vor allem „Probe“ und „Lösungsmenge notieren“.</span></li>');
        items.push('<li><span>Starte dann mit <a href="#grafisch">Weg 1: Grafisch lösen</a>.</span></li>');
      } else {
        title = score === 2 ? 'Fast alles sitzt.' : score === 1 ? 'Da ist noch Luft nach oben.' : 'Gut, dass du es jetzt weißt!';
        lead = 'Starte mit den <a href="#grundlagen">Grundlagen</a> – die drei Wege bauen genau darauf auf. Konkret:';
        miss.forEach(function (id) { items.push('<li><span>' + ST_INFO[id].tip + '</span></li>'); });
        ST_IDS.forEach(function (id) {
          if (res[id] === 'ok') items.push('<li class="ok"><span>' + ST_INFO[id].okTxt + '</span></li>');
        });
      }
      el.innerHTML = '<div class="st-res">' +
        '<h3>' + title + ' <span class="st-res-score">' + score + '/3 auf Anhieb</span></h3>' +
        '<p>' + lead + '</p><ul>' + items.join('') + '</ul>' +
        '<div class="btn-row"><a class="btn primary" href="' + (score === 3 ? '#grafisch' : '#grundlagen') + '">' + (score === 3 ? 'Zu Weg 1' : 'Zu den Grundlagen') + ' →</a>' +
        '<button type="button" class="btn ghost st-res-reset">Test wiederholen</button></div></div>';
      QG.math(el);
      el.querySelector('.st-res-reset').addEventListener('click', function () {
        res = {};
        QG.store.set(ST_KEY, res);
        QG.resetProgress('grund-0');
        render();
        var first = document.querySelector('[data-id="grund-0a"]');
        if (first) first.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }

    QG.on('task', function (e) {
      if (!e || ST_IDS.indexOf(e.id) < 0) return;
      if (e.ok) { if (e.attempts === 1) res[e.id] = 'ok'; else if (!res[e.id] || res[e.id] === 'ok') res[e.id] = 'miss'; }
      else res[e.id] = 'miss';
      QG.store.set(ST_KEY, res);
      // erst nach dem richtigen Antworten auswerten, nicht mitten im Raten
      if (e.ok) render();
    });
    render();
  });
})();
} catch (e) { console.error('[QG] Fehler in js/00-start.js', e); }

/* ==================================================================
   js/10-grundlagen.js
   ================================================================== */
;try {
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
} catch (e) { console.error('[QG] Fehler in js/10-grundlagen.js', e); }

/* ==================================================================
   js/20-grafisch.js
   ================================================================== */
;try {
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
} catch (e) { console.error('[QG] Fehler in js/20-grafisch.js', e); }

/* ==================================================================
   js/30-faktorisieren.js
   ================================================================== */
;try {
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
} catch (e) { console.error('[QG] Fehler in js/30-faktorisieren.js', e); }

/* ==================================================================
   js/40-ergaenzung.js
   ================================================================== */
;try {
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
} catch (e) { console.error('[QG] Fehler in js/40-ergaenzung.js', e); }

/* ==================================================================
   js/50-methodenwahl.js
   ================================================================== */
;try {
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
} catch (e) { console.error('[QG] Fehler in js/50-methodenwahl.js', e); }

/* ==================================================================
   js/60-training.js
   ================================================================== */
;try {
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
} catch (e) { console.error('[QG] Fehler in js/60-training.js', e); }

/* ==================================================================
   js/70-probe-hue.js
   ================================================================== */
;try {
/* Probe-HÜ: Graphen, Timer, Versionen A/B, Selbstkorrektur mit Notenschätzung, Druckmodi */
(function () {
  'use strict';
  var QG = window.QG;
  if (!QG) return;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var reduced = function () { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; };

  /* =====================================================================
     Graphen (QG.plot). Die Funktionen stehen hier, weil sie Code sind.
     ===================================================================== */
  var PLOTS = {
    A: {
      opts: { xmin: -3, xmax: 5, ymin: -5, ymax: 5, label: 'Parabel zu f(x) = x² − 2x − 3' },
      fns: [{ f: function (x) { return x * x - 2 * x - 3; }, color: 'blue', label: 'f', labelAt: 3.85, labelPos: 'e' }],
      sol: [
        { x: -1, y: 0, label: '−1', pos: 'nw', color: 'red' },
        { x: 3, y: 0, label: '3', pos: 'ne', color: 'red' }
      ]
    },
    B: {
      opts: { xmin: -3, xmax: 5, ymin: -1, ymax: 8, label: 'Normalparabel y = x² und Gerade y = x + 2' },
      fns: [
        { f: function (x) { return x * x; }, color: 'blue', label: 'y = x²', labelAt: 2.7, labelPos: 'e' },
        { f: function (x) { return x + 2; }, color: 'orange', label: 'y = x + 2', labelAt: 3.4, labelPos: 'se' }
      ],
      sol: [
        { x: -1, y: 1, label: 'P(−1 | 1)', pos: 'nw', color: 'red' },
        { x: 2, y: 4, label: 'Q(2 | 4)', pos: 'se', color: 'red' }
      ]
    }
  };

  QG.widget('hue-plot', function (el) {
    var cfg = PLOTS[el.getAttribute('data-plot')];
    if (!cfg) return;
    var o = {};
    Object.keys(cfg.opts).forEach(function (k) { o[k] = cfg.opts[k]; });
    o.fns = cfg.fns;
    o.points = el.hasAttribute('data-solution') ? cfg.sol : [];
    el.classList.add('qg-plot-wrap');
    QG.plot(el, o);
  });

  /* =====================================================================
     Notenschlüssel
     ===================================================================== */
  var KEY = [
    { min: 87.5, n: 1, w: 'sehr gut' },
    { min: 75, n: 2, w: 'gut' },
    { min: 62.5, n: 3, w: 'befriedigend' },
    { min: 50, n: 4, w: 'ausreichend' },
    { min: 25, n: 5, w: 'mangelhaft' },
    { min: 0, n: 6, w: 'ungenügend' }
  ];
  function grade(pct) {
    for (var i = 0; i < KEY.length; i++) if (pct >= KEY[i].min - 1e-9) return KEY[i];
    return KEY[KEY.length - 1];
  }

  function init() {
    var sec = document.getElementById('probe-hue');
    if (!sec || sec._hue) return;
    sec._hue = true;

    var VERSIONS = ['A', 'B'];
    var cur = QG.store.get('hue:v', 'A');
    if (VERSIONS.indexOf(cur) < 0) cur = 'A';

    /* ---------------------------------------------------------------
       Timer
       --------------------------------------------------------------- */
    var tCard = $('.hue-timer', sec);
    var tTime = $('.hue-time', sec);
    var tSub = $('.hue-sub', sec);
    var tRing = $('.hue-ring', sec);
    var tStart = $('.hue-start', sec);
    var tStartLabel = $('.hue-start-label', sec);
    var tReset = $('.hue-reset', sec);
    var tDone = $('.hue-done', sec);
    var tDurs = $$('.hue-dur', sec);
    var sndBox = $('.hue-snd', sec);
    var mini = $('.hue-mini', sec);
    var miniTime = $('.hue-mini-time', sec);
    var miniToggle = $('.hue-mini-toggle', sec);
    var miniJump = $('.hue-mini-jump', sec);

    var T = QG.store.get('hue:timer', null);
    if (!T || typeof T.dur !== 'number') T = { dur: 20 * 60000, running: false, endAt: 0, remain: 20 * 60000, done: false, w5: false, w1: false };
    var loop = null;
    var cardVisible = true;
    sndBox.checked = QG.store.get('hue:snd', true) !== false;

    function save() { QG.store.set('hue:timer', T); }
    function left() { return T.running ? Math.max(0, T.endAt - Date.now()) : Math.max(0, T.remain); }
    function mmss(ms) {
      var s = Math.ceil(ms / 1000);
      var m = Math.floor(s / 60);
      s = s % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    function state() {
      if (T.done) return 'done';
      if (T.running) return 'running';
      if (T.remain < T.dur) return 'paused';
      return 'idle';
    }

    var actx = null;
    function unlockAudio() {
      try {
        if (!actx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (AC) actx = new AC();
        }
        if (actx && actx.state === 'suspended') actx.resume();
      } catch (e) { actx = null; }
    }
    function beep() {
      if (!actx) return;
      try {
        var t0 = actx.currentTime + 0.05;
        [0, 0.38, 0.76].forEach(function (d, i) {
          var o = actx.createOscillator();
          var g = actx.createGain();
          o.type = 'sine';
          o.frequency.value = i === 2 ? 1175 : 880;
          g.gain.setValueAtTime(0.0001, t0 + d);
          g.gain.exponentialRampToValueAtTime(0.3, t0 + d + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + (i === 2 ? 0.55 : 0.28));
          o.connect(g); g.connect(actx.destination);
          o.start(t0 + d); o.stop(t0 + d + 0.6);
        });
      } catch (e) { /* kein Ton möglich */ }
    }
    function alarm() {
      if (!sndBox.checked) return;
      beep();
      try {
        var act = navigator.userActivation;
        if (navigator.vibrate && (!act || act.hasBeenActive)) navigator.vibrate([300, 150, 300, 150, 600]);
      } catch (e) {}
    }

    function render() {
      var l = left();
      var st = state();
      tCard.setAttribute('data-state', st);
      tCard.classList.toggle('is-warn', st === 'running' && l <= 5 * 60000 && l > 60000);
      tCard.classList.toggle('is-last', (st === 'running' || st === 'paused') && l <= 60000);
      var txt = mmss(l);
      tTime.textContent = txt;
      miniTime.textContent = txt;
      tRing.style.setProperty('--p', (T.dur ? l / T.dur : 0).toFixed(4));
      tSub.textContent = st === 'idle' ? 'bereit' : st === 'running' ? 'läuft …' : st === 'paused' ? 'pausiert' : 'Zeit um!';
      tStartLabel.textContent = st === 'running' ? 'Pause' : st === 'paused' ? 'Weiter' : st === 'done' ? 'Neu starten' : 'Start';
      tStart.firstElementChild.textContent = st === 'running' ? '❚❚' : '▶';
      tReset.hidden = st === 'idle';
      tDone.hidden = st !== 'done';
      tDurs.forEach(function (b) {
        var on = Number(b.getAttribute('data-min')) * 60000 === T.dur;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.disabled = st === 'running' || st === 'paused';
      });
      miniToggle.textContent = st === 'running' ? 'Pause' : 'Weiter';
      mini.hidden = !((st === 'running' || st === 'paused') && !cardVisible);
      mini.classList.toggle('is-warn', st === 'running' && l <= 5 * 60000);
    }

    function tick() {
      if (!T.running) { stopLoop(); return; }
      var l = left();
      if (T.dur > 5 * 60000 && l <= 5 * 60000 && !T.w5) { T.w5 = true; save(); QG.toast('Noch 5 Minuten'); }
      if (T.dur > 60000 && l <= 60000 && !T.w1) { T.w1 = true; save(); QG.toast('Noch 1 Minute – Lösungsmengen hinschreiben!'); }
      if (l <= 0) { finish(true); return; }
      render();
    }
    function startLoop() { if (!loop) loop = setInterval(tick, 250); }
    function stopLoop() { if (loop) { clearInterval(loop); loop = null; } }

    function start() {
      unlockAudio();
      if (T.done) { T.remain = T.dur; T.done = false; T.w5 = T.w1 = false; }
      T.endAt = Date.now() + T.remain;
      T.running = true;
      save(); startLoop(); render();
    }
    function pause() {
      T.remain = left();
      T.running = false;
      save(); stopLoop(); render();
    }
    function reset() {
      T.running = false; T.done = false; T.remain = T.dur; T.w5 = T.w1 = false;
      save(); stopLoop(); render();
    }
    function finish(withAlarm) {
      T.running = false; T.done = true; T.remain = 0;
      save(); stopLoop(); render();
      if (withAlarm) {
        alarm();
        QG.toast('⏰ Zeit ist um – Stift weg!', { ms: 5000 });
      }
    }

    tStart.addEventListener('click', function () {
      var st = state();
      if (st === 'running') pause(); else start();
    });
    tReset.addEventListener('click', reset);
    miniToggle.addEventListener('click', function () { if (T.running) pause(); else start(); });
    miniJump.addEventListener('click', function () {
      tCard.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    });
    tDurs.forEach(function (b) {
      b.addEventListener('click', function () {
        if (T.running || (T.remain < T.dur && !T.done)) return;
        T.dur = Number(b.getAttribute('data-min')) * 60000;
        T.remain = T.dur; T.done = false; T.w5 = T.w1 = false;
        save(); render();
      });
    });
    sndBox.addEventListener('change', function () {
      QG.store.set('hue:snd', sndBox.checked);
      if (sndBox.checked) unlockAudio();
    });
    $('.hue-snd-test', sec).addEventListener('click', function () {
      unlockAudio();
      beep();
      try { if (navigator.vibrate) navigator.vibrate(200); } catch (e) {}
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && T.running) tick(); });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { cardVisible = en.isIntersecting; });
        render();
      }, { rootMargin: '-70px 0px 0px 0px', threshold: 0 }).observe(tCard);
    }

    // Zustand nach dem Neuladen
    if (T.running) {
      if (T.endAt <= Date.now()) finish(false);
      else startLoop();
    }
    render();

    /* ---------------------------------------------------------------
       Versionen A / B
       --------------------------------------------------------------- */
    var tabs = $$('.hue-tab', sec);
    function setVersion(v, focus) {
      cur = v;
      QG.store.set('hue:v', v);
      tabs.forEach(function (t) {
        var on = t.getAttribute('data-v') === v;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
      });
      $$('.hue-panel', sec).forEach(function (p) { p.hidden = p.getAttribute('data-v') !== v; });
      renderScore();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { setVersion(t.getAttribute('data-v')); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
          setVersion(n.getAttribute('data-v'), true);
        }
      });
    });

    /* ---------------------------------------------------------------
       Selbstkorrektur & Auswertung
       --------------------------------------------------------------- */
    var res = $('.hue-result', sec);
    var S = {};
    VERSIONS.forEach(function (v) {
      var st = QG.store.get('hue:' + v, null) || {};
      S[v] = { c: Array.isArray(st.c) ? st.c : [], open: !!st.open, ev: !!st.ev };
    });
    function corrPanel(v) { return $('.hue-corr[data-v="' + v + '"]', sec); }
    function saveS(v) { QG.store.set('hue:' + v, S[v]); }

    function chapterLinks(ids) {
      return ids.split(/\s+/).filter(Boolean).map(function (id) {
        var c = (QG.chapters || []).filter(function (x) { return x.id === id; })[0];
        if (!c) return '';
        return '<a class="hue-go" href="#' + QG.esc(id) + '" data-color="' + QG.esc(c.color) + '"><span aria-hidden="true">' + QG.esc(c.icon) + '</span> ' + QG.esc(c.short) + ' →</a>';
      }).join('');
    }

    function compute(v) {
      var panel = corrPanel(v);
      var total = 0, max = 0, items = [];
      $$('.hue-c', panel).forEach(function (card) {
        var boxes = $$('input[type="checkbox"][data-p]', card);
        var p = 0, m = 0;
        boxes.forEach(function (b) { var w = Number(b.getAttribute('data-p')) || 0; m += w; if (b.checked) p += w; });
        total += p; max += m;
        items.push({ card: card, p: p, m: m });
      });
      return { total: total, max: max, items: items };
    }

    function renderScore() {
      VERSIONS.forEach(function (v) {
        var panel = corrPanel(v);
        panel.classList.toggle('is-locked', !S[v].open);
        var r = compute(v);
        r.items.forEach(function (it) {
          var sc = $('.hue-score', it.card);
          sc.querySelector('b').textContent = QG.fmt(it.p);
          it.card.classList.toggle('is-full', it.p === it.m && it.m > 0);
          $$('.hue-crit label', it.card).forEach(function (lb) {
            var cb = lb.querySelector('input');
            lb.classList.toggle('is-on', cb.checked);
          });
        });
        var tab = $('.hue-tab[data-v="' + v + '"] .hue-tab-state', sec);
        var pct = r.max ? 100 * r.total / r.max : 0;
        if (S[v].ev) tab.textContent = QG.fmt(r.total) + ' / ' + r.max + ' P. · Note ≈ ' + grade(pct).n;
        else tab.textContent = S[v].open ? 'in Korrektur' : 'noch offen';
        tab.parentNode.parentNode.classList.toggle('is-evaluated', S[v].ev);
      });

      // Ergebnis-Karte für die aktive Version
      var r = compute(cur);
      var s = S[cur];
      var pct = r.max ? 100 * r.total / r.max : 0;
      var g = grade(pct);
      res.hidden = !s.open;
      $('.hue-result-v', res).textContent = 'Probe-HÜ ' + cur;
      $('.hue-sum', res).textContent = QG.fmt(r.total);
      $('.hue-total-num > span', res).textContent = ' / ' + r.max + ' Punkte';
      $('.hue-total-pct', res).textContent = QG.fmt(Math.round(pct)) + ' %';
      $('.hue-bar > span', res).style.width = pct.toFixed(1) + '%';
      res.setAttribute('data-grade', s.ev ? String(g.n) : '');
      $('.hue-grade', res).textContent = s.ev ? String(g.n) : '–';
      $('.hue-grade-word', res).textContent = s.ev ? g.n + ' (' + g.w + ')' : 'tippe auf „Auswertung anzeigen“, wenn du alles abgehakt hast';
      $('.hue-eval-row', res).hidden = s.ev;
      var recs = $('.hue-recs', res);
      recs.hidden = !s.ev;
      if (s.ev) {
        var other = cur === 'A' ? 'B' : 'A';
        var msg;
        if (g.n <= 2) msg = 'Stark! Du bist gut vorbereitet. Wiederhole nur die Aufgaben unten, bei denen noch Punkte fehlen – und lies am Abend vorher den Spickzettel.';
        else if (g.n <= 4) msg = 'Solide Basis! Mit den Kapiteln unten holst du dir die fehlenden Punkte. Danach: Probe-HÜ ' + other + '.';
        else msg = 'Kein Grund zur Panik – jetzt weißt du genau, wo es hakt. Arbeite die Liste unten von oben nach unten ab und schreib danach Probe-HÜ ' + other + '.';
        $('.hue-recs-msg', recs).textContent = msg;
        var list = r.items.map(function (it) {
          var q = it.m ? it.p / it.m : 1;
          return { it: it, q: q };
        }).sort(function (a, b) { return a.q - b.q; });
        var html = list.map(function (x) {
          var it = x.it;
          var num = $('.hue-num', it.card).textContent;
          var title = $('h3', it.card).textContent;
          var cls, label;
          if (x.q >= 1) { cls = 'ok'; label = 'sitzt'; }
          else if (x.q >= 0.5) { cls = 'mid'; label = 'kurz wiederholen'; }
          else { cls = 'bad'; label = 'nochmal üben'; }
          var links = x.q >= 1 ? '' : chapterLinks(it.card.getAttribute('data-go') || '');
          return '<li class="hue-rec ' + cls + '">' +
            '<span class="hue-rec-ico" aria-hidden="true">' + (cls === 'ok' ? '✓' : cls === 'mid' ? '↻' : '!') + '</span>' +
            '<div class="hue-rec-body"><p><b>Aufgabe ' + QG.esc(num) + ' · ' + QG.esc(title) + '</b> <span class="hue-rec-pts">' + QG.fmt(it.p) + ' / ' + it.m + ' P.</span></p>' +
            '<p class="hue-rec-state">' + label + '</p>' +
            (links ? '<p class="hue-rec-links">' + links + '</p>' : '') + '</div></li>';
        }).join('');
        $('.hue-rec-list', recs).innerHTML = html;
      }
    }

    VERSIONS.forEach(function (v) {
      var panel = corrPanel(v);
      var boxes = $$('input[type="checkbox"][data-p]', panel);
      boxes.forEach(function (b, i) {
        b.checked = !!S[v].c[i];
        b.addEventListener('change', function () {
          S[v].c = boxes.map(function (x) { return x.checked ? 1 : 0; });
          saveS(v);
          renderScore();
        });
      });
      $('.hue-unlock', panel).addEventListener('click', function () {
        S[v].open = true; saveS(v);
        if (T.running) { pause(); QG.toast('Timer angehalten'); }
        renderScore();
        var first = $('.hue-c', panel);
        if (first) setTimeout(function () { first.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); }, 30);
      });
    });

    $('.hue-eval', res).addEventListener('click', function () {
      S[cur].ev = true; saveS(cur);
      renderScore();
      var r = compute(cur);
      if (r.max && 100 * r.total / r.max >= 75) QG.celebrate($('.hue-grade', res));
      $('.hue-grade-row', res).scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    });
    $('.hue-relock', res).addEventListener('click', function () {
      S[cur].open = false; saveS(cur);
      $$('details', corrPanel(cur)).forEach(function (d) { d.open = false; });
      renderScore();
      $('#hue-korrektur').scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    });
    var resetBtn = $('.hue-reset-score', res);
    var resetArm = null;
    resetBtn.addEventListener('click', function () {
      if (!resetArm) {
        resetBtn.textContent = 'Wirklich zurücksetzen?';
        resetBtn.classList.add('is-armed');
        resetArm = setTimeout(function () {
          resetArm = null;
          resetBtn.textContent = '↺ Bewertung zurücksetzen';
          resetBtn.classList.remove('is-armed');
        }, 3500);
        return;
      }
      clearTimeout(resetArm); resetArm = null;
      resetBtn.textContent = '↺ Bewertung zurücksetzen';
      resetBtn.classList.remove('is-armed');
      S[cur] = { c: [], open: true, ev: false };
      saveS(cur);
      $$('input[type="checkbox"][data-p]', corrPanel(cur)).forEach(function (b) { b.checked = false; });
      renderScore();
      QG.toast('Bewertung zurückgesetzt');
    });

    // Sprung zur Selbstkorrektur
    $$('.hue-to-corr', sec).forEach(function (b) {
      b.addEventListener('click', function () {
        var target = $('#hue-korrektur');
        if (target) target.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
      });
    });

    /* ---------------------------------------------------------------
       Drucken: Aufgabenblatt (ohne Lösungen) oder Lösungen
       --------------------------------------------------------------- */
    var printOpened = [];
    function cleanupPrint() {
      document.body.classList.remove('hue-print-sol', 'hue-print-sheet');
      printOpened.forEach(function (d) { d.open = false; });
      printOpened = [];
    }
    function doPrint(mode) {
      cleanupPrint();
      document.body.classList.add(mode === 'sol' ? 'hue-print-sol' : 'hue-print-sheet');
      if (mode === 'sol') {
        $$('details.hue-eh', corrPanel(cur)).forEach(function (d) {
          if (!d.open) { d.open = true; printOpened.push(d); }
        });
      }
      setTimeout(function () { window.print(); }, 80);
    }
    window.addEventListener('afterprint', function () { setTimeout(cleanupPrint, 0); });
    $('.hue-print-sheet', sec).addEventListener('click', function () { doPrint('sheet'); });
    $('.hue-print-sol', sec).addEventListener('click', function () { doPrint('sol'); });

    setVersion(cur);
  }

  QG.ready(init);
})();
} catch (e) { console.error('[QG] Fehler in js/70-probe-hue.js', e); }

/* ==================================================================
   js/90-nachhilfe.js
   ================================================================== */
;try {
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
} catch (e) { console.error('[QG] Fehler in js/90-nachhilfe.js', e); }

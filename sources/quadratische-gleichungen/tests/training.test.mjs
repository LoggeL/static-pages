// Tests für den Trainingsraum (js/60-training.js): Generator-Logik ohne DOM.
// Aufruf: node tests/training.test.mjs   (aus dem Projektordner oder von überall)
// Für jeden Weg × jede Stufe werden N Aufgaben erzeugt und gründlich geprüft:
//  - Lösungen erfüllen die Gleichung, Anzahl passt zur Diskriminante, a ≠ 0
//  - data-answer ist für den Core-Parser lesbar und ergibt genau die Lösungsmenge
//  - JEDE Zeile des Lösungswegs wird nachgerechnet (Äquivalenz, ±-Zeilen, Einzellösungen, Proben)
//  - Darstellung ohne „+ −“, „1x“, „+ 0“, „−0“, „NaN“, „undefined“ …
//  - grafische Aufgaben: Lösungen im sichtbaren Bereich, ganz- oder halbzahlig
//  - Lösungsweg enthält die richtigen Zahlen und endet mit L = {…}
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const N = parseInt(process.env.N || '500', 10);

const coreCtx = { module: { exports: {} }, console };
vm.runInNewContext(readFileSync(join(here, '..', 'js', 'core.js'), 'utf8'), coreCtx, { filename: 'core.js' });
const QG = coreCtx.module.exports;

const trCtx = { module: { exports: {} }, console };
vm.runInNewContext(readFileSync(join(here, '..', 'js', '60-training.js'), 'utf8'), trCtx, { filename: '60-training.js' });
const TR = trCtx.module.exports;
const _ = TR._;

let pass = 0, fail = 0;
const failures = new Map();
function ok(name, cond, info = '') {
  if (cond) { pass++; return true; }
  fail++;
  const k = name;
  if (!failures.has(k)) failures.set(k, { n: 0, info });
  failures.get(k).n++;
  return false;
}

/* ---------- Hilfen ---------- */
function fracToText(html) {
  return html.replace(/<span class="frac"><span>([^<]*)<\/span><span>([^<]*)<\/span><\/span>/g, '($1)/($2)');
}
function text(html) {
  return fracToText(String(html)).replace(/<\/span>/g, '</span> ').replace(/<sub>(\d)<\/sub>/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/[ \t\n]+/g, ' ').trim();
}
function toExpr(html) {
  let s = String(html).replace(/<span class="frac"><span>([^<]*)<\/span><span>([^<]*)<\/span><\/span>/g, '(($1)/($2))');
  s = s.replace(/<sub>\d<\/sub>/g, '').replace(/<[^>]+>/g, '');
  s = s.replace(/−/g, '-').replace(/·/g, '*').replace(/x[12]/g, 'x').replace(/(\d),(\d)/g, '$1.$2');
  return s.trim();
}
function evalAt(expr, x) {
  const s = expr.replace(/x/g, '(' + x + ')');
  return QG.evalExpr(s);
}
function expandPM(s) {
  const k = s.indexOf('±');
  if (k < 0) return [s];
  return expandPM(s.slice(0, k) + '+' + s.slice(k + 1)).concat(expandPM(s.slice(0, k) + '-' + s.slice(k + 1)));
}
const close = (a, b, t = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= t * Math.max(1, Math.abs(a), Math.abs(b));
const std = (P) => (x) => _.val(P.a) * x * x + _.val(P.b) * x + _.val(P.c);
const SAMPLE = [-2.37, -0.61, 0.73, 1.91, 3.29];

/** l = r äquivalent zu a x² + b x + c = 0 ? (l − r = k · Term, k ≠ 0) */
function equivalent(P, l, r) {
  const L = toExpr(l), R = toExpr(r), f = std(P);
  let k = null;
  for (const x of SAMPLE) {
    const g = evalAt(L, x) - evalAt(R, x), s = f(x);
    if (!Number.isFinite(g)) return 'nicht auswertbar: ' + L + ' = ' + R;
    if (Math.abs(s) < 1e-6) continue;
    if (k === null) { k = g / s; if (Math.abs(k) < 1e-9) return 'Faktor 0'; continue; }
    if (!close(g, k * s, 1e-7)) return 'nicht äquivalent: ' + text(l) + ' = ' + text(r);
  }
  return null;
}
/** Eine (Un-)Gleichungszeile mit evtl. mehreren „=“ in r: l = r1 = r2 … */
function rowHolds(l, r, x, pmVariant) {
  const L = evalAt(toExpr(l), x);
  const parts = r.split(' = ');
  return parts.every(p => {
    const vs = expandPM(toExpr(p)).map(e => evalAt(e, x));
    if (pmVariant != null) return close(L, vs[pmVariant] ?? vs[0], 1e-9);
    return vs.some(v => close(L, v, 1e-9));
  });
}
function numericRow(l, r) {
  ok('Probe endet mit ✓', /✓$/.test(r));
  const vals = [l].concat(r.replace(/\s*✓$/, '').split(' = ')).map(p => QG.evalExpr(toExpr(p)));
  return vals.every(v => close(v, vals[0], 1e-9));
}
/** Inhalt aller <span class="m">…</span> (balanciert) */
function mathSpans(html) {
  const out = [];
  const open = '<span class="m">';
  let i = 0;
  while ((i = html.indexOf(open, i)) >= 0) {
    let depth = 1, j = i + open.length;
    while (depth > 0 && j < html.length) {
      const o = html.indexOf('<span', j), c = html.indexOf('</span>', j);
      if (c < 0) break;
      if (o >= 0 && o < c) { depth++; j = o + 5; } else { depth--; j = c + 7; }
    }
    out.push(html.slice(i + open.length, j - 7));
    i = j;
  }
  return out;
}
const ALLOWED_VARS = new Set(['x', 'p', 'q', 'a', 'b', 'c', 'd', 'e', 'f', 'k', 'y']);
function badVars(mathHtml) {
  const t = text(mathHtml);
  return QG.mathSegments(t).filter(s => s.t === 'var' && !s.s.split('').every(ch => ALLOWED_VARS.has(ch))).map(s => s.s);
}
const BANNED = [
  [/\+ −/, '„+ −“'], [/− −/, '„− −“'], [/\+ \+/, '„+ +“'], [/− \+/, '„− +“'], [/= \+/, '„= +“'], [/±\s*−/, '„± −“'],
  [/(^|[^\d,)\/])1x/, '„1x“'], [/(^|[^\d,)\/])0x/, '„0x“'], [/\+ 0(?![,\d])/, '„+ 0“'], [/− ?0(?![,\d])/, '„−0“'],
  [/NaN/, 'NaN'], [/undefined/, 'undefined'], [/Infinity/, 'Infinity'], [/\[object/, '[object'], [/\bnull\)/, 'null)'],
  [/\(\+/, '„(+“'], [/\d\.\d/, 'Dezimalpunkt'], [/\s[;,]\s*[;,]/, 'doppelter Trenner']
];
function checkDisplay(label, html) {
  const t = text(html);
  for (const [re, name] of BANNED) ok(`Darstellung ${name}`, !re.test(t), `${label}: …${(t.match(re) || [''])[0]}… in „${t.slice(0, 160)}“`);
}
const isHalfOrInt = (v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;

/* ---------- Haupttest ---------- */
const WEGE = [...TR.WEG_IDS, 'gemischt'];
const counts = {};
let mixedNatural = 0, mixedTotal = 0;
for (const weg of WEGE) {
  for (const level of [1, 2, 3]) {
    const tag = `${weg}/${level}`;
    const rootCounts = { 0: 0, 1: 0, 2: 0 };
    for (let n = 0; n < N; n++) {
      let P;
      try { P = TR.generate(weg, level); }
      catch (e) { ok(`${tag}: Generator wirft keinen Fehler`, false, e.stack); continue; }
      const id = `${tag} #${n} (${P.weg}) ${text(P.eqHtml)}`;
      if (weg === 'gemischt') { mixedTotal++; if (P.natural) mixedNatural++; }
      else ok(`${tag}: weg stimmt`, P.weg === weg, id);
      ok(`${tag}: Stufe stimmt`, P.level === level, id);

      // a ≠ 0, Koeffizienten passend zum Weg
      ok('a ≠ 0', _.val(P.a) !== 0, id);
      if (P.weg === 'ausklammern') ok('Ausklammern: c = 0, b ≠ 0', _.val(P.c) === 0 && _.val(P.b) !== 0, id);
      if (P.weg === 'vieta' || P.weg === 'ergaenzung') ok(`${P.weg}: b ≠ 0 und c ≠ 0`, _.val(P.b) !== 0 && _.val(P.c) !== 0, id);
      if (P.weg === 'binomisch') ok('Binomisch: c ≠ 0', _.val(P.c) !== 0, id);

      // Lösungen erfüllen die Gleichung
      const vals = P.roots.map(_.rootVal);
      for (let i = 1; i < vals.length; i++) ok('Lösungen aufsteigend und verschieden', vals[i] > vals[i - 1] + 1e-12, id);
      const f = std(P);
      for (const r of P.roots) {
        const v = _.rootVal(r);
        ok('Lösung erfüllt Gleichung (|f(x)| < 1e-9)', Math.abs(f(v)) < 1e-9, `${id}: f(${v}) = ${f(v)}`);
        if (r.t === 1 || _.val(r.s) === 0) {
          const rr = _.add(r.r, r.t === 1 ? r.s : 0);
          const exact = _.add(_.add(_.mul(P.a, _.mul(rr, rr)), _.mul(P.b, rr)), P.c);
          ok('rationale Lösung exakt (f(x) = 0)', exact.n === 0, id);
        }
      }
      // Anzahl ↔ Diskriminante (exakt)
      const D = _.sub(_.mul(P.b, P.b), _.mul(4, _.mul(P.a, P.c)));
      const expectN = D.n > 0 ? 2 : D.n === 0 ? 1 : 0;
      ok('Anzahl Lösungen passt zur Diskriminante', P.roots.length === expectN, `${id}: ${P.roots.length} statt ${expectN}`);
      rootCounts[P.roots.length]++;

      // data-answer
      const pa = QG.parseAnswer(P.answer);
      ok('data-answer lesbar', !!pa, `${id}: ${P.answer}`);
      if (pa) ok('data-answer = Lösungsmenge', QG.sameSet(pa, P.roots.length ? vals : { empty: true, values: [] }, 1e-9), `${id}: ${P.answer} vs ${vals}`);
      ok('leere Menge als „leer“', (P.roots.length === 0) === (P.answer === 'leer'), id);

      // wrong-Treffer
      for (const w of P.wrong) {
        const wm = QG.parseAnswer(w.match);
        ok('wrong.match lesbar', !!wm, `${id}: ${w.match}`);
        if (wm && pa) ok('wrong.match ≠ richtige Lösung', !QG.sameSet(wm, pa, 1e-9), `${id}: ${w.match}`);
        checkDisplay(id + ' wrong', w.msg);
      }

      // Hinweise
      ok('genau 2 gestufte Tipps', Array.isArray(P.hintsOut) && P.hintsOut.length === 2 && P.hintsOut.every(h => typeof h === 'string' && text(h).length > 15), id);

      // Darstellung
      checkDisplay(id + ' Frage', P.qHtml);
      checkDisplay(id + ' Gleichung', P.eqHtml);
      checkDisplay(id + ' Body', P.body);
      P.hintsOut.forEach((h, i) => checkDisplay(id + ' Tipp ' + (i + 1), h));
      // Proben (Einsetzen von 0 ergibt legitim „− 0“) separat prüfen
      let solNoProbe = P.solution;
      for (const rw of P.rows) if (rw.chk === 'num') solNoProbe = solNoProbe.replace(_.rowHtml(rw), '');
      ok('Proben-Zeilen gefunden', P.rows.filter(r => r.chk === 'num').every(rw => P.solution.includes(_.rowHtml(rw))), id);
      checkDisplay(id + ' Lösung', solNoProbe);
      // Variablen-Kursivierung: nur echte Variablen
      const allHtml = [P.qHtml, P.body, P.solution, ...P.hintsOut, ...P.wrong.map(w => w.msg)].join(' ');
      for (const m of mathSpans(allHtml)) { const bv = badVars(m); ok('nur echte Variablen in .m', bv.length === 0, `${id}: ${bv} in „${text(m)}“`); }
      for (const rw of P.rows) {
        if (rw.note) continue;
        for (const part of [rw.l, rw.r, rw.op]) { const bv = badVars(part); ok('nur echte Variablen in .calc', bv.length === 0, `${id}: ${bv} in „${text(part)}“`); }
      }

      // Ausgangsgleichung ist äquivalent zur Standardform
      const e0 = equivalent(P, P.orig[0], P.orig[1]);
      ok('Ausgangsgleichung ↔ Standardform', !e0, `${id}: ${e0}`);

      // JEDE Rechenzeile prüfen
      const rows = P.rows.filter(r => !r.note);
      let sawL = false;
      for (const rw of rows) {
        const where = `${id}: „${text(rw.l)} = ${text(rw.r)}“ [${rw.chk}]`;
        switch (rw.chk) {
          case 'eq': { const e = equivalent(P, rw.l, rw.r); ok('Zeile äquivalent', !e, `${where} → ${e}`); break; }
          case 'pm': {
            const variants = expandPM(toExpr(rw.r.split(' = ')[0]));
            const L = toExpr(rw.l);
            ok('±-Zeile: jede Lösung passt zu einem Vorzeichen', vals.every(x => variants.some(v => close(evalAt(L, x), evalAt(v, x)))), where);
            ok('±-Zeile: jedes Vorzeichen liefert eine Lösung', variants.every(v => vals.some(x => close(evalAt(L, x), evalAt(v, x)))), where);
            ok('±-Zeile nur bei 2 Lösungen', vals.length === 2, where);
            break;
          }
          case 'one': ok('Einzelzeile gilt für eine Lösung', vals.some(x => rowHolds(rw.l, rw.r, x)), where); break;
          case 'all': ok('Zeile gilt für alle Lösungen', vals.length > 0 && vals.every(x => rowHolds(rw.l, rw.r, x)), where); break;
          case 'num': ok('Probe-Zeile rechnet richtig', numericRow(rw.l, rw.r), where); break;
          case 'L': sawL = true; ok('L-Zeile ist die letzte Zeile', rw === P.rows[P.rows.length - 1], where); break;
          default: ok('bekannter Prüftyp', false, where);
        }
      }
      ok('Lösungsweg endet mit L = {…}', sawL, id);

      // Lösungsweg enthält die richtigen Zahlen
      const solT = text(P.solution);
      const fmtRoot = (r) => text(P.dec ? (r.t === 1 && _.F(r.r).d === 2 ? _.fdec(r.r) : _.rootHtml(r)) : _.rootHtml(r));
      const Ltxt = 'L = ' + (P.roots.length ? '{' + P.roots.map(fmtRoot).join('; ') + '}' : '{ }');
      ok('Lösungsweg enthält „L = {…}“ mit den richtigen Zahlen', solT.includes(Ltxt), `${id}: erwartet „${Ltxt}“ in „…${solT.slice(-120)}“`);
      for (const r of P.roots) ok('jede Lösung steht im Lösungsweg', solT.includes(fmtRoot(r)), `${id}: ${fmtRoot(r)}`);
      ok('Lösungsweg nicht leer', solT.length > 25, id);

      // Wegspezifisch
      if (P.weg === 'ergaenzung') {
        const last = P.roots.length ? 6 : 5;
        for (let s = 1; s <= last; s++) ok('Ergänzung: Schritt ' + s + ' vorhanden', solT.includes('Schritt ' + s + ' '), id);
        ok('Ergänzung: (p/2)² richtig', solT.includes(text(_.fh(_.mul(P.erg.h, P.erg.h)))), id);
        ok('Ergänzung: rechte Seite (x + p/2)² = R richtig', P.rows.some(r => !r.note && text(r.r) === text(_.fh(P.erg.R)) && /\)²$/.test(text(r.l))), `${id}: R = ${text(_.fh(P.erg.R))}`);
      }
      if (P.weg === 'vieta') {
        const v = P.vieta;
        ok('Vieta: Produkt passt', v.m1 * v.m2 === v.q, id);
        ok('Vieta: Summe passt', v.m1 + v.m2 === v.p, id);
        ok('Vieta: Normalform passt zu p, q', _.val(P.b) / _.val(P.a) === v.p && _.val(P.c) / _.val(P.a) === v.q, id);
      }
      if (P.weg === 'grafisch') {
        const W = P.plot;
        ok('Grafisch: Plot vorhanden', !!W && Array.isArray(W.fns) && W.fns.length >= 1, id);
        ok('Grafisch: x-Achse sichtbar', W.ymin < 0 && W.ymax > 0, id);
        ok('Grafisch: y-Achse sichtbar', W.xmin < 0 && W.xmax > 0, id);
        for (const v of vals) {
          ok('Grafisch: Lösung ganz- oder halbzahlig', isHalfOrInt(v), `${id}: ${v}`);
          ok('Grafisch: Lösung im sichtbaren Bereich', v >= W.xmin + 0.5 && v <= W.xmax - 0.5, `${id}: ${v} in [${W.xmin}; ${W.xmax}]`);
          if (P.level === 3) ok('Grafisch: Schnittpunkt sichtbar', v * v <= W.ymax - 0.5, `${id}: y = ${v * v}, ymax ${W.ymax}`);
        }
        // Graph passt zur Gleichung
        const g = W.fns[0];
        if (P.level < 3) for (const x of SAMPLE) ok('Grafisch: Graph = Gleichung', close(g.a * x * x + g.b * x + g.c, f(x), 1e-9), id);
        else for (const x of SAMPLE) ok('Grafisch: Parabel − Gerade = Gleichung', close((x * x) - (W.fns[1].b * x + W.fns[1].c), f(x) / _.val(P.a), 1e-9), id);
        if (P.roots.length === 0 && P.level < 3) {
          const d = -_.val(P.b) / (2 * _.val(P.a)), e = f(d);
          ok('Grafisch: Scheitel sichtbar (keine Lösung)', d > W.xmin && d < W.xmax && e > W.ymin && e < W.ymax, id);
        }
        ok('Grafisch: Höhe vernünftig', (W.ymax - W.ymin) * (W.yscale || 1) <= 1.25 * (W.xmax - W.xmin) + 1e-9 && (W.xmax - W.xmin) <= 12, `${id}: ${JSON.stringify(W)}`);
        ok('Grafisch: Lösungsplot markiert Lösungen', (P.solPlot.points || []).length === (P.level === 3 ? P.roots.length : Math.max(1, P.roots.length)), id);
      }
    }
    counts[tag] = rootCounts;
  }
}

/* ---------- Kleinteile ---------- */
ok('fh(−3/2) = −Bruch', text(_.fh(_.F(-3, 2))) === '−(3)/(2)');
ok('term ohne 1-Koeffizient', text(_.term([[1, 'x²'], [-1, 'x'], [0, '']])) === 'x² − x');
ok('sqrtF(12) = 2√3', (() => { const s = _.sqrtF(_.F(12)); return s.s.n === 2 && s.s.d === 1 && s.t === 3; })());
ok('sqrtF(49/4) = 7/2', (() => { const s = _.sqrtF(_.F(49, 4)); return s.rat.n === 7 && s.rat.d === 2; })());
ok('Gemischt meist „sinnvollster Weg“', mixedNatural / mixedTotal > 0.99, `${mixedNatural}/${mixedTotal}`);

console.log('Verteilung (Anzahl Lösungen 0/1/2):');
for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(16)} ${v[0]}/${v[1]}/${v[2]}`);
for (const [k, v] of failures) console.log(`✗ ${k}  (${v.n}×)  z. B. ${v.info}`);
console.log(`\n${pass} Prüfungen bestanden, ${fail} fehlgeschlagen.`);
process.exit(fail ? 1 : 0);

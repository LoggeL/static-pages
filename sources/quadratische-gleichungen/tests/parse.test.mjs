// Tests für die reinen Core-Funktionen (Parser, Formatierung, Mathe-Typografie).
// Aufruf: node tests/parse.test.mjs   (aus dem Projektordner oder von überall)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'js', 'core.js'), 'utf8');
const ctx = { module: { exports: {} }, console };
vm.runInNewContext(src, ctx, { filename: 'core.js' });
const QG = ctx.module.exports;

let pass = 0, fail = 0;
const S2 = Math.SQRT2, S3 = Math.sqrt(3), S5 = Math.sqrt(5);

function show(r) { return r === null ? 'null' : JSON.stringify({ empty: r.empty, values: r.values, alts: r.alts && r.alts.map(a => a.empty ? '{}' : a.values) }); }
function ok(name, cond, info = '') {
  if (cond) pass++;
  else { fail++; console.log('✗ ' + name + (info ? '  →  ' + info : '')); }
}
/** erwartet: Array (Lösungsmenge), 'empty', null; any=true: irgendeine Deutung passt */
function P(input, expected, { any = false } = {}) {
  const r = QG.parseAnswer(input);
  if (expected === null) return ok(`parse(${JSON.stringify(input)}) = null`, r === null, show(r));
  if (expected === 'empty') return ok(`parse(${JSON.stringify(input)}) = leer`, r && r.empty === true, show(r));
  if (!r) return ok(`parse(${JSON.stringify(input)})`, false, 'null');
  const cands = any ? (r.alts || [r]) : [r];
  ok(`parse(${JSON.stringify(input)}) = {${expected.join('; ')}}`, cands.some(c => QG.sameSet(c, expected, 1e-9)), show(r));
}

// --- Grundformen ---
P('-3; 2', [-3, 2]);
P('−3;2', [-3, 2]);
P('L={-3;2}', [-3, 2]);
P('L = { −3 ; 2 }', [-3, 2]);
P('x1=-3, x2=2', [-3, 2]);
P('x₁ = −3 und x₂ = 2', [-3, 2]);
P('2 und -3', [-3, 2]);
P('2 oder -3', [-3, 2]);
P('-3 | 2', [-3, 2]);
P('x = -3 oder x = 2', [-3, 2]);
P('x1 = -3; x2 = 2', [-3, 2]);
P('x_1=-3 x_2=2', [-3, 2]);
P('-3, 2', [-3, 2]);
P('2;-3', [-3, 2]);
P('4', [4]);
P('x = 0', [0]);
P('0; 5', [0, 5]);
// --- Dezimalkomma / Brüche ---
P('1,5; -2', [-2, 1.5]);
P('1.5; -2', [-2, 1.5]);
P('3/2', [1.5]);
P('-3/2; 4', [-1.5, 4]);
P('x = 2,5', [2.5]);
P('x = 2,5', [2, 5], { any: true });
P('L={-3,2}', [-3, 2], { any: true });
P('-0,5', [-0.5]);
P('1,5, 2', [1.5, 2]);
P('x1 = 1,5, x2 = 2', [1.5, 2]);
// --- Wurzeln ---
P('-sqrt(5)', [-S5]);
P('√5', [S5]);
P('-2√3', [-2 * S3]);
P('2*sqrt(3)', [2 * S3]);
P('2·√3', [2 * S3]);
P('√(5)', [S5]);
P('±3', [-3, 3]);
P('±√5', [-S5, S5]);
P('1±√2', [1 - S2, 1 + S2]);
P('1 + √2; 1 − √2', [1 - S2, 1 + S2]);
P('x1,2 = ±3', [-3, 3]);
P('x1/2 = ±√5', [-S5, S5]);
P('+-3', [-3, 3]);
P('wurzel aus 5', [S5]);
P('-1 ± sqrt(2)', [-1 - S2, -1 + S2]);
P('√12/2', [S3]);
P('(1+√2)', [1 + S2]);
// --- keine Lösung ---
P('keine', 'empty');
P('keine Lösung', 'empty');
P('Keine Lösung!', 'empty');
P('{}', 'empty');
P('{ }', 'empty');
P('L = { }', 'empty');
P('∅', 'empty');
P('leer', 'empty');
P('L = ∅', 'empty');
P('nicht lösbar', 'empty');
// --- Duplikate / Unsinn ---
P('3; 3', [3]);
P('x1 = 2, x2 = 2', [2]);
P('', null);
P('hallo', null);
P('x', null);
P('3;;', [3]);
P('2 -3', [-3, 2], { any: true });
P('1 - √2', [1 - S2]);

// --- sameSet ---
ok('sameSet Reihenfolge egal', QG.sameSet([2, -3], [-3, 2]));
ok('sameSet Toleranz', QG.sameSet([1.95], [2], 0.1));
ok('sameSet leer', QG.sameSet({ empty: true, values: [] }, []));
ok('sameSet ungleich', !QG.sameSet([2], [2, 3]));
ok('sameSet String', QG.sameSet('leer', { empty: true, values: [] }));

// --- Formatierung ---
const M = '−';
ok('fmt 1.5', QG.fmt(1.5) === '1,5', QG.fmt(1.5));
ok('fmt -3', QG.fmt(-3) === M + '3', QG.fmt(-3));
ok('fmt 30', QG.fmt(30) === '30', QG.fmt(30));
ok('fmt 2.333', QG.fmt(7 / 3) === '2,33', QG.fmt(7 / 3));
ok('fmt -0', QG.fmt(-0.0001) === '0', QG.fmt(-0.0001));
ok('fmtFrac 1.5', QG.fmtFrac(1.5) === '<span class="frac"><span>3</span><span>2</span></span>', QG.fmtFrac(1.5));
ok('fmtFrac -0.25', QG.fmtFrac(-0.25).startsWith(M + '<span class="frac"><span>1</span><span>4</span>'), QG.fmtFrac(-0.25));
ok('fmtFrac 4', QG.fmtFrac(4) === '4');
ok('sign', QG.sign(-3) === M + ' 3' && QG.sign(2) === '+ 2');
ok('poly x²−5x+6', QG.poly(1, -5, 6) === '<var>x</var>² ' + M + ' 5<var>x</var> + 6', QG.poly(1, -5, 6));
ok('poly −x²+x', QG.poly(-1, 1, 0) === M + '<var>x</var>² + <var>x</var>', QG.poly(-1, 1, 0));
ok('poly 2x²−8', QG.poly(2, 0, -8) === '2<var>x</var>² ' + M + ' 8', QG.poly(2, 0, -8));
ok('poly 0', QG.poly(0, 0, 0) === '0');
ok('prettyAnswer', QG.prettyAnswer('2;-3') === 'L = {' + M + '3; 2}', QG.prettyAnswer('2;-3'));
ok('prettyAnswer leer', QG.prettyAnswer('leer') === 'L = { }');
ok('prettyAnswer sqrt', QG.prettyAnswer('1+sqrt(2);1-sqrt(2)') === 'L = {1 ' + M + ' √2; 1 + √2}', QG.prettyAnswer('1+sqrt(2);1-sqrt(2)'));
ok('normText', QG.normText('(x + 3)^2') === QG.normText('(x+3)²'));

// --- Mathe-Typografie ---
const segStr = (s) => QG.mathSegments(s).map(g => g.t === 'text' ? g.s : g.t === 'var' ? `[${g.s}]` : `_${g.s}`).join('');
const T = (inp, exp) => ok(`math(${inp})`, segStr(inp) === exp, segStr(inp));
T('x² + 5x + 6 = 0', '[x]² + 5[x] + 6 = 0');
T('ax² + bx + c = 0', '[ax]² + [bx] + [c] = 0');
T('L = {-3; 2}', `L = {${M}3; 2}`);
T('x1 = 2 und x2 = 3', '[x]_1 = 2 und [x]_2 = 3');
T('S(d | e)', 'S([d] | [e])');
T('P(2 | -3)', `P(2 | ${M}3)`);
T('Probe: 3 oder 4', 'Probe: 3 oder 4');
T('p-q-Formel', '[p]-[q]-Formel');
T('und oder Probe', 'und oder Probe');
T('f(x) = (x - 2)²', `[f]([x]) = ([x] ${M} 2)²`);
T('x₁ = 4', '[x]₁ = 4');
T('| : 2', '| : 2');
// --- Text-Antworten: Alternativen, Escape, Dezimalzahlen ---
ok('splitAlts a|b', JSON.stringify(QG.splitAlts('(x+3)^2|(3+x)^2')) === JSON.stringify(['(x+3)^2', '(3+x)^2']));
ok('splitAlts escaped |', JSON.stringify(QG.splitAlts('S(3\\|-4)|S(3 \\| −4)')) === JSON.stringify(['S(3|-4)', 'S(3 | −4)']), JSON.stringify(QG.splitAlts('S(3\\|-4)|S(3 \\| −4)')));
ok('normText 1,50 = 1,5', QG.normText('(x+1,50)^2') === QG.normText('(x + 1,5)²'));
ok('normText 1.5 = 1,5', QG.normText('(x+1.5)²') === QG.normText('(x+1,5)²'));
ok('normText 10 bleibt 10', QG.normText('x+10') === 'x+10');
ok('normText 2,0 = 2', QG.normText('(x-2,0)²') === QG.normText('(x−2)²'));
ok('normText 1,05 bleibt', QG.normText('x+1,05') === 'x+1,05');
// poly mit maxDen
ok('poly frac maxDen 16', QG.poly(1, 0.5, 1 / 16, { frac: true, maxDen: 16 }).includes('<span>16</span>'));

// idempotent: Ergebnis-Text erneut segmentieren ändert nichts mehr am Text
const once = QG.mathSegments('x - 3').map(g => g.s).join('');
ok('math idempotent', QG.mathSegments(once).map(g => g.s).join('') === once);

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);

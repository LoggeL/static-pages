// Laden und strikte Prüfung von scene.json. Jede Abweichung wird ein SceneError mit Feldpfad –
// es gibt keine Standardwerte für Pflichtfelder.

export class SceneError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'SceneError';
    this.path = path;
  }
}

export class SceneLoadError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'SceneLoadError';
  }
}

export async function loadScene(base) {
  const url = `${base}scene/scene.json`;
  let r;
  try {
    r = await fetch(url, { cache: 'no-cache' });
  } catch (err) {
    throw new SceneLoadError(`scene.json: Netzwerkfehler (${err.message})`, err);
  }
  if (!r.ok) throw new SceneLoadError(`scene.json: HTTP ${r.status}`);
  const text = await r.text();
  let cfg;
  try {
    cfg = JSON.parse(text);
  } catch (err) {
    throw new SceneLoadError(`scene.json ist kein gültiges JSON: ${err.message}`, err);
  }
  validateScene(cfg);
  return cfg;
}

const fail = (path, msg) => { throw new SceneError(path, msg); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEX12 = /^[0-9a-f]{12}$/;

function obj(v, path) { if (!isObj(v)) fail(path, v === undefined ? 'fehlt' : 'muss ein Objekt sein'); return v; }
function arr(v, path, min = 0) {
  if (!Array.isArray(v)) fail(path, v === undefined ? 'fehlt' : 'muss eine Liste sein');
  if (v.length < min) fail(path, `braucht mindestens ${min} Einträge, hat ${v.length}`);
  return v;
}
function str(v, path, nonEmpty = false) {
  if (typeof v !== 'string') fail(path, v === undefined ? 'fehlt' : 'muss ein Text sein');
  if (nonEmpty && !v.trim()) fail(path, 'darf nicht leer sein');
  return v;
}
function num(v, path, { min = -Infinity, max = Infinity, gt = -Infinity } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, v === undefined ? 'fehlt' : `muss eine endliche Zahl sein (ist ${JSON.stringify(v)})`);
  if (v < min) fail(path, `${v} ist kleiner als ${min}`);
  if (v > max) fail(path, `${v} ist größer als ${max}`);
  if (!(v > gt)) fail(path, `${v} muss größer als ${gt} sein`);
  return v;
}
function int(v, path, opt) { num(v, path, opt); if (!Number.isInteger(v)) fail(path, `${v} ist keine ganze Zahl`); return v; }
function bool(v, path) { if (typeof v !== 'boolean') fail(path, v === undefined ? 'fehlt' : 'muss true oder false sein'); return v; }
function pt(v, path) {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) fail(path, 'kein Punkt [x,y,z]');
  return v;
}
function pts(v, path, min) { arr(v, path, min).forEach((p, i) => pt(p, `${path}[${i}]`)); return v; }
function nums(v, path, n) {
  arr(v, path, n);
  if (v.length !== n) fail(path, `braucht genau ${n} Zahlen, hat ${v.length}`);
  v.forEach((x, i) => num(x, `${path}[${i}]`));
  return v;
}
function range4(v, path) {
  nums(v, path, 4);
  if (!(v[0] < v[1] && v[2] < v[3])) fail(path, 'muss [x0, x1, z0, z1] mit x0 < x1 und z0 < z1 sein');
  return v;
}
const opt = (o, key, fn, path) => { if (o[key] !== undefined) fn(o[key], `${path}.${key}`); };
// Felder, deren Wert im Plan unbekannt sein darf: null heißt ausdrücklich „unbekannt“.
const optNull = (o, key, fn, path) => { if (o[key] !== undefined && o[key] !== null) fn(o[key], `${path}.${key}`); };

export function validateScene(c) {
  obj(c, 'scene.json');
  str(c.title, 'title', true);
  str(c.subtitle, 'subtitle');
  str(c.version, 'version', true);
  str(c.frame, 'frame', true);
  obj(c.storage, 'storage');
  arr(c.storage.legacy_ids, 'storage.legacy_ids').forEach((s, i) => str(s, `storage.legacy_ids[${i}]`, true));

  obj(c.transform, 'transform');
  nums(c.transform.quaternion, 'transform.quaternion', 4);
  nums(c.transform.position, 'transform.position', 3);
  num(c.transform.scale, 'transform.scale', { gt: 0 });
  obj(c.view, 'view');
  pt(c.view.position, 'view.position');
  pt(c.view.target, 'view.target');
  if (Math.hypot(...c.view.position.map((v, i) => v - c.view.target[i])) < 1e-6) fail('view', 'position und target fallen zusammen');

  if (c.background !== undefined) {
    if (typeof c.background !== 'string') {
      arr(c.background, 'background', 2).forEach((s, i) => str(s, `background[${i}]`, true));
    }
  }
  if (c.picking !== undefined) {
    obj(c.picking, 'picking');
    opt(c.picking, 'tau', (v, p) => num(v, p, { min: 0, max: 1 }), 'picking');
    opt(c.picking, 'minOpacity', (v, p) => num(v, p, { min: 0, max: 1 }), 'picking');
  }
  obj(c.calibration, 'calibration');
  str(c.calibration.text, 'calibration.text', true);
  opt(c.calibration, 'reference', str, 'calibration');
  opt(c.calibration, 'scale_m_per_unit', (v, p) => num(v, p, { gt: 0 }), 'calibration');
  opt(c.calibration, 'tilt_x_deg', num, 'calibration');
  obj(c.plan, 'plan');
  num(c.plan.accuracy_m, 'plan.accuracy_m', { gt: 0 });
  opt(c.plan, 'area_total_m2', num, 'plan');
  opt(c.plan, 'parcels', (v, p) => arr(v, p).forEach((s, i) => str(s, `${p}[${i}]`)), 'plan');

  arr(c.boundaries, 'boundaries').forEach((b, i) => {
    const p = `boundaries[${i}]`;
    obj(b, p);
    str(b.name, `${p}.name`, true);
    if (b.style !== 'primary' && b.style !== 'secondary') fail(`${p}.style`, 'muss "primary" oder "secondary" sein');
    if (b.points === undefined && b.lines === undefined) fail(p, 'braucht "points" oder "lines"');
    opt(b, 'points', (v, q) => pts(v, q, 3), p);
    opt(b, 'lines', (v, q) => arr(v, q, 1).forEach((l, j) => pts(l, `${q}[${j}]`, 2)), p);
    opt(b, 'corners', (v, q) => pts(v, q, 0), p);
    opt(b, 'sides', (v, q) => arr(v, q).forEach((s, j) => { obj(s, `${q}[${j}]`); num(s.length, `${q}[${j}].length`, { gt: 0 }); pt(s.at, `${q}[${j}].at`); }), p);
    opt(b, 'labels', (v, q) => arr(v, q).forEach((s, j) => { obj(s, `${q}[${j}]`); str(s.text, `${q}[${j}].text`, true); pt(s.at, `${q}[${j}].at`); }), p);
    opt(b, 'center', pt, p);
    opt(b, 'area_m2', (v, q) => num(v, q, { gt: 0 }), p);
  });
  arr(c.buildings, 'buildings').forEach((b, i) => {
    const p = `buildings[${i}]`;
    obj(b, p);
    // Gebäude ohne Hausnummer haben in scene.json name: null (kein Etikett).
    if (b.name !== null) str(b.name, `${p}.name`);
    bool(b.own, `${p}.own`);
    pts(b.points, `${p}.points`, 3);
    pt(b.center, `${p}.center`);
    opt(b, 'kind', str, p);
    opt(b, 'area_m2', num, p);
    opt(b, 'base', num, p);
    opt(b, 'measured', bool, p);
  });
  const sw = obj(c.sewer, 'sewer');
  num(sw.corridor_m, 'sewer.corridor_m', { min: 0, max: 6 });
  str(sw.source, 'sewer.source');
  arr(sw.pipes, 'sewer.pipes', 1).forEach((q, i) => {
    const p = `sewer.pipes[${i}]`;
    obj(q, p);
    str(q.name, `${p}.name`, true); str(q.dn, `${p}.dn`, true);
    num(q.length, `${p}.length`, { gt: 0 }); num(q.slope_permille, `${p}.slope_permille`);
    pts(q.points, `${p}.points`, 2);
    optNull(q, 'depth_from', num, p); optNull(q, 'depth_to', num, p); opt(q, 'own_m', num, p);
  });
  arr(sw.manholes, 'sewer.manholes').forEach((m, i) => {
    const p = `sewer.manholes[${i}]`;
    obj(m, p);
    str(m.name, `${p}.name`, true);
    pt(m.at, `${p}.at`);
    optNull(m, 'depth', num, p);
    optNull(m, 'cover', num, p);
    if (m.note !== undefined && m.note !== null) str(m.note, `${p}.note`);
  });
  arr(sw.connections, 'sewer.connections').forEach((l, i) => pts(l, `sewer.connections[${i}]`, 2));

  validateMap(c.map);
  validateSplats(c.splats);
  return c;
}

function validateMap(m) {
  obj(m, 'map');
  range4(m.extent, 'map.extent');
  range4(m.start, 'map.start');
  num(m.grid_m, 'map.grid_m', { gt: 0 });
  num(m.min_mpp, 'map.min_mpp', { gt: 0 });
  const im = obj(m.image, 'map.image');
  str(im.dir, 'map.image.dir', true);
  if (im.format !== 'webp') fail('map.image.format', 'muss "webp" sein');
  if (!HEX12.test(str(im.version, 'map.image.version'))) fail('map.image.version', 'muss 12 Hex-Zeichen haben – tools/build_map.py ausführen');
  range4(im.bounds, 'map.image.bounds');
  num(im.res, 'map.image.res', { gt: 0 });
  nums(im.size, 'map.image.size', 2);
  const [bx0, bx1, bz0, bz1] = im.bounds;
  const W = Math.round((bx1 - bx0) / im.res), H = Math.round((bz1 - bz0) / im.res);
  if (im.size[0] !== W || im.size[1] !== H) fail('map.image.size', `ist ${im.size.join('×')}, aus bounds und res folgt ${W}×${H}`);
  int(im.tile, 'map.image.tile', { gt: 0 });
  int(im.overlap, 'map.image.overlap', { min: 0 });
  int(im.bytes, 'map.image.bytes', { gt: 0 });
  arr(im.levels, 'map.image.levels', 1).forEach((L, i) => {
    const p = `map.image.levels[${i}]`;
    obj(L, p);
    int(L.f, `${p}.f`, { min: 1 });
    if (i > 0 && L.f <= im.levels[i - 1].f) fail(`${p}.f`, 'Stufen müssen nach f aufsteigend sortiert sein');
    nums(L.size, `${p}.size`, 2);
    const w = Math.ceil(W / L.f), h = Math.ceil(H / L.f);
    if (L.size[0] !== w || L.size[1] !== h) fail(`${p}.size`, `ist ${L.size.join('×')}, erwartet ${w}×${h}`);
    const nx = Math.ceil(w / im.tile), ny = Math.ceil(h / im.tile);
    arr(L.tiles, `${p}.tiles`, 1).forEach((t, j) => {
      if (!Array.isArray(t) || t.length !== 2 || !Number.isInteger(t[0]) || !Number.isInteger(t[1])
        || t[0] < 0 || t[1] < 0 || t[0] >= nx || t[1] >= ny) fail(`${p}.tiles[${j}]`, `Kachelindex ${JSON.stringify(t)} außerhalb von ${nx}×${ny}`);
    });
  });
  const last = im.levels[im.levels.length - 1];
  if (last.size[0] > im.tile || last.size[1] > im.tile || last.tiles.length !== 1) {
    fail(`map.image.levels[${im.levels.length - 1}]`, 'die gröbste Stufe muss genau eine Kachel haben');
  }
  const g = obj(m.ground, 'map.ground');
  str(g.file, 'map.ground.file', true);
  if (!HEX12.test(str(g.version, 'map.ground.version'))) fail('map.ground.version', 'muss 12 Hex-Zeichen haben – tools/build_map.py ausführen');
  range4(g.bounds, 'map.ground.bounds');
  num(g.cell, 'map.ground.cell', { gt: 0 });
  int(g.cols, 'map.ground.cols', { gt: 0 });
  int(g.rows, 'map.ground.rows', { gt: 0 });
  int(g.bytes, 'map.ground.bytes', { gt: 0 });
  if (Math.round((g.bounds[1] - g.bounds[0]) / g.cell) !== g.cols) fail('map.ground.cols', `${g.cols} passt nicht zu bounds/cell`);
  if (Math.round((g.bounds[3] - g.bounds[2]) / g.cell) !== g.rows) fail('map.ground.rows', `${g.rows} passt nicht zu bounds/cell`);
  obj(g.accuracy_m, 'map.ground.accuracy_m');
  num(g.accuracy_m.measured, 'map.ground.accuracy_m.measured', { gt: 0 });
  num(g.accuracy_m.estimated, 'map.ground.accuracy_m.estimated', { gt: 0 });
}

export const DEVICE_CLASSES = ['software', 'phone_weak', 'phone', 'laptop_weak', 'laptop', 'desktop_strong'];

function validateSplats(s) {
  obj(s, 'splats');
  str(s.source, 'splats.source', true);
  const tiers = arr(s.tiers, 'splats.tiers', 1);
  const ids = new Set();
  const byFile = new Map();
  tiers.forEach((t, i) => {
    const p = `splats.tiers[${i}]`;
    obj(t, p);
    str(t.id, `${p}.id`, true);
    if (ids.has(t.id)) fail(`${p}.id`, `"${t.id}" ist doppelt`);
    ids.add(t.id);
    str(t.label, `${p}.label`, true);
    str(t.hint, `${p}.hint`);
    if (!/\.sog$/.test(str(t.file, `${p}.file`, true))) fail(`${p}.file`, 'muss auf .sog enden');
    if (t.bytes === 0) fail(`${p}.bytes`, '0 – tools/build_splat_tiers.py ausführen');
    int(t.count, `${p}.count`, { gt: 0 });
    int(t.bytes, `${p}.bytes`, { gt: 0 });
    if (!HEX12.test(str(t.hash, `${p}.hash`))) fail(`${p}.hash`, 'muss 12 Hex-Zeichen haben – tools/build_splat_tiers.py ausführen');
    int(t.sh, `${p}.sh`, { min: 0, max: 3 });
    bool(t.ext, `${p}.ext`);
    // 16-Bit-Positionen (PackedSplats): die Rundung schreibt build_splat_tiers.py, das Qualitätsmenü zeigt sie
    if (!t.ext) num(t.pos_round_mm, `${p}.pos_round_mm`, { gt: 0 });
    else if (t.pos_round_mm !== undefined) fail(`${p}.pos_round_mm`, 'nur bei ext: false (16-Bit-Positionen) erlaubt');
    if (t.build === undefined) fail(`${p}.build`, 'fehlt (null = Quelldatei unverändert)');
    if (t.build !== null) {
      obj(t.build, `${p}.build`);
      if (t.build.method !== 'adaptive' && t.build.method !== 'importance') fail(`${p}.build.method`, 'muss "adaptive" oder "importance" sein');
      int(t.build.target, `${p}.build.target`, { gt: 0 });
      int(t.build.sh, `${p}.build.sh`, { min: 0, max: 3 });
    }
    const r = obj(t.render, `${p}.render`);
    num(r.motionPixelRatio, `${p}.render.motionPixelRatio`, { gt: 0 });
    num(r.pixelRatio, `${p}.render.pixelRatio`, { min: r.motionPixelRatio });
    num(r.maxStdDev, `${p}.render.maxStdDev`, { min: 1, max: Math.sqrt(8) + 1e-9 });
    num(r.minAlpha, `${p}.render.minAlpha`, { min: 0, max: 1 });
    num(r.minPixelRadius, `${p}.render.minPixelRadius`, { min: 0 });
    num(r.maxPixelRadius, `${p}.render.maxPixelRadius`, { gt: 0 });
    num(r.clipXY, `${p}.render.clipXY`, { gt: 0 });
    num(r.minSortIntervalMs, `${p}.render.minSortIntervalMs`, { min: 0 });
    int(r.maxSh, `${p}.render.maxSh`, { min: 0, max: t.sh });
    const prev = byFile.get(t.file);
    if (prev) {
      for (const k of ['bytes', 'hash', 'count', 'sh']) {
        if (prev[k] !== t[k]) fail(`${p}.${k}`, `weicht von der Stufe "${prev.id}" mit derselben Datei ab`);
      }
    } else byFile.set(t.file, t);
  });
  obj(s.auto, 'splats.auto');
  for (const k of DEVICE_CLASSES) {
    if (!ids.has(str(s.auto[k], `splats.auto.${k}`, true))) fail(`splats.auto.${k}`, `"${s.auto[k]}" ist keine Stufen-id (${[...ids].join(', ')})`);
  }
}

// LUMEN fixture library: attribute catalogue, fixture types with DMX channel layouts,
// constraints (what a real fixture can actually do), DMX encoding, beam geometry and colour helpers.

export const DEG = Math.PI / 180;
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------------ attributes */
// Every frame attribute object carries ALL of these keys (normalised units).
export const ATTRS = {
  dim: { label: "Dimmer", group: "dim", min: 0, max: 1, def: 0, unit: "%" },
  r: { label: "Rot", group: "color", min: 0, max: 1, def: 1, unit: "%" },
  g: { label: "Grün", group: "color", min: 0, max: 1, def: 1, unit: "%" },
  b: { label: "Blau", group: "color", min: 0, max: 1, def: 1, unit: "%" },
  w: { label: "Weiß", group: "color", min: 0, max: 1, def: 0, unit: "%" },
  pan: { label: "Pan", group: "pos", min: -270, max: 270, def: 0, unit: "°" },
  tilt: { label: "Tilt", group: "pos", min: -135, max: 135, def: 0, unit: "°" },
  zoom: { label: "Zoom", group: "beam", min: 1, max: 60, def: 20, unit: "°" },
  iris: { label: "Iris", group: "beam", min: 0, max: 1, def: 1, unit: "%" },
  focus: { label: "Fokus", group: "beam", min: 0, max: 1, def: 0.5, unit: "%" },
  frost: { label: "Frost", group: "beam", min: 0, max: 1, def: 0, unit: "%" },
  gobo: { label: "Gobo", group: "beam", min: 0, max: 7, def: 0, unit: "", discrete: true },
  goboSpin: { label: "Gobo-Rotation", group: "beam", min: -1, max: 1, def: 0, unit: "U/s" },
  prism: { label: "Prisma", group: "beam", min: 0, max: 2, def: 0, unit: "", discrete: true },
  prismRot: { label: "Prisma-Rotation", group: "beam", min: -1, max: 1, def: 0, unit: "U/s" },
  strobe: { label: "Strobe", group: "shutter", min: 0, max: 25, def: 0, unit: "Hz" },
  lzPattern: { label: "Laser-Muster", group: "laser", min: 0, max: 2, def: 1, unit: "", discrete: true },
  lzFan: { label: "Fächerbreite", group: "laser", min: 0, max: 90, def: 40, unit: "°" },
  lzBeams: { label: "Strahlen", group: "laser", min: 1, max: 32, def: 12, unit: "", discrete: true },
  lzTilt: { label: "Laser-Tilt", group: "laser", min: -30, max: 30, def: 0, unit: "°" },
  lzSpeed: { label: "Scan-Speed", group: "laser", min: -4, max: 4, def: 0, unit: "Hz" },
};
export const ATTR_KEYS = Object.keys(ATTRS);
export const ATTR_GROUPS = {
  dim: { label: "Dimmer", attrs: ["dim"] },
  color: { label: "Farbe", attrs: ["r", "g", "b", "w"] },
  pos: { label: "Position", attrs: ["pan", "tilt"] },
  beam: { label: "Beam", attrs: ["zoom", "iris", "focus", "frost", "gobo", "goboSpin", "prism", "prismRot"] },
  shutter: { label: "Shutter", attrs: ["strobe"] },
  laser: { label: "Laser", attrs: ["lzPattern", "lzFan", "lzBeams", "lzTilt", "lzSpeed"] },
};
export const DISCRETE = new Set(ATTR_KEYS.filter((k) => ATTRS[k].discrete));

export const GOBOS = ["Offen", "Punkte", "Speichen", "Ring", "Splitter", "Stern", "Wellen", "Gitter"];
export const PRISMS = ["Aus", "3-fach rund", "6-fach linear"];
export const LASER_PATTERNS = ["Strahl", "Fächer", "Fläche"];

// colour wheel of the beam fixture (slot 0 = open)
export const COLOR_WHEEL = [
  { name: "Offen", rgb: [1, 1, 1] },
  { name: "Rot", rgb: [1, 0, 0] },
  { name: "Orange", rgb: [1, 0.42, 0] },
  { name: "Gelb", rgb: [1, 0.88, 0] },
  { name: "Grün", rgb: [0, 1, 0.12] },
  { name: "Cyan", rgb: [0, 0.9, 1] },
  { name: "Blau", rgb: [0, 0.15, 1] },
  { name: "Lavendel", rgb: [0.6, 0.5, 1] },
  { name: "Magenta", rgb: [1, 0, 0.8] },
  { name: "Pink", rgb: [1, 0.4, 0.62] },
  { name: "UV", rgb: [0.35, 0, 1] },
  { name: "CTO", rgb: [1, 0.74, 0.48] },
  { name: "Hellgrün", rgb: [0.6, 1, 0.3] },
  { name: "Tiefrot", rgb: [0.8, 0, 0.06] },
];

// "Farbrad-Presets" for the programmer: rgbw 0..1
export const SWATCHES = [
  { name: "Weiß", rgbw: [1, 1, 1, 1] },
  { name: "Warmweiß", rgbw: [1, 0.78, 0.52, 0.6] },
  { name: "Rot", rgbw: [1, 0, 0, 0] },
  { name: "Tiefrot", rgbw: [0.8, 0, 0.06, 0] },
  { name: "Orange", rgbw: [1, 0.42, 0, 0] },
  { name: "Gelb", rgbw: [1, 0.88, 0, 0] },
  { name: "Grün", rgbw: [0, 1, 0.12, 0] },
  { name: "Cyan", rgbw: [0, 0.9, 1, 0] },
  { name: "Hellblau", rgbw: [0.3, 0.6, 1, 0.1] },
  { name: "Blau", rgbw: [0, 0.15, 1, 0] },
  { name: "Lavendel", rgbw: [0.6, 0.5, 1, 0] },
  { name: "UV", rgbw: [0.35, 0, 1, 0] },
  { name: "Magenta", rgbw: [1, 0, 0.8, 0] },
  { name: "Pink", rgbw: [1, 0.4, 0.62, 0] },
];

/* ------------------------------------------------------------------ fixture types */
const MOVER_RANGE = { pan: [-270, 270], tilt: [-135, 135] };
const px = (n) => Array.from({ length: n }, (_, i) => [`px${i + 1}.r`, `px${i + 1}.g`, `px${i + 1}.b`]).flat();
const P = (o) => o; // readability only

export const FIXTURE_TYPES = {
  spot: P({
    key: "spot", name: "Moving Head Spot", short: "SP", category: "mover", body: "spot",
    channels: ["pan", "pan.fine", "tilt", "tilt.fine", "ptSpeed", "shutter", "dim", "dim.fine", "c", "m", "y", "cw",
      "gobo", "goboRot", "prism", "prismRot", "focus", "zoom", "iris", "frost"],
    attrs: ["dim", "r", "g", "b", "w", "pan", "tilt", "zoom", "iris", "focus", "frost", "gobo", "goboSpin", "prism", "prismRot", "strobe"],
    caps: { pantilt: true, color: "cmy", zoom: [8, 40], gobos: 8, prisms: 3, strobe: 20, pixels: 0 },
    range: MOVER_RANGE,
    beam: { angle: 18, power: 0.9, lens: 0.07, length: 22 },
    size: [0.42, 0.62, 0.36], weight: 24,
  }),
  beam: P({
    key: "beam", name: "Moving Head Beam", short: "BM", category: "mover", body: "beam",
    channels: ["pan", "pan.fine", "tilt", "tilt.fine", "ptSpeed", "shutter", "dim", "cw", "gobo", "prism", "prismRot", "focus", "frost", "ctrl"],
    attrs: ["dim", "r", "g", "b", "w", "pan", "tilt", "frost", "gobo", "prism", "prismRot", "focus", "strobe"],
    caps: { pantilt: true, color: "wheel", zoom: null, gobos: 8, prisms: 3, strobe: 20, pixels: 0 },
    range: MOVER_RANGE,
    beam: { angle: 2.5, power: 1, lens: 0.05, length: 40 },
    size: [0.36, 0.54, 0.3], weight: 18,
  }),
  wash: P({
    key: "wash", name: "Moving Head Wash", short: "WA", category: "mover", body: "wash",
    channels: ["pan", "pan.fine", "tilt", "tilt.fine", "ptSpeed", "shutter", "dim", "dim.fine", "r", "g", "b", "w", "cto", "zoom", "ctrl"],
    attrs: ["dim", "r", "g", "b", "w", "pan", "tilt", "zoom", "strobe"],
    caps: { pantilt: true, color: "rgbw", zoom: [6, 50], gobos: 0, prisms: 0, strobe: 20, pixels: 0 },
    range: MOVER_RANGE,
    beam: { angle: 25, power: 0.85, lens: 0.16, length: 16 },
    size: [0.46, 0.58, 0.4], weight: 22,
  }),
  par: P({
    key: "par", name: "LED-PAR RGBW", short: "PAR", category: "led", body: "par",
    channels: ["dim", "r", "g", "b", "w", "shutter"],
    attrs: ["dim", "r", "g", "b", "w", "strobe"],
    caps: { pantilt: false, color: "rgbw", zoom: null, gobos: 0, prisms: 0, strobe: 20, pixels: 0 },
    range: MOVER_RANGE,
    beam: { angle: 25, power: 0.45, lens: 0.1, length: 10 },
    size: [0.26, 0.26, 0.24], weight: 4,
  }),
  bar: P({
    key: "bar", name: "LED-Bar 8 Pixel", short: "BAR", category: "led", body: "bar",
    channels: ["dim", "shutter", ...px(8)],
    attrs: ["dim", "r", "g", "b", "w", "strobe"],
    caps: { pantilt: false, color: "rgb", zoom: null, gobos: 0, prisms: 0, strobe: 20, pixels: 8 },
    range: MOVER_RANGE,
    beam: { angle: 30, power: 0.35, lens: 0.05, length: 7 },
    size: [1, 0.09, 0.12], weight: 5,
  }),
  strobe: P({
    key: "strobe", name: "LED-Strobe", short: "STR", category: "strobe", body: "strobe",
    channels: ["dim", "rate", "dur", "fx"],
    attrs: ["dim", "strobe"],
    caps: { pantilt: false, color: "white", zoom: null, gobos: 0, prisms: 0, strobe: 25, pixels: 0 },
    range: MOVER_RANGE,
    beam: { angle: 110, power: 1, lens: 0.25, length: 9 },
    size: [0.55, 0.22, 0.16], weight: 7,
  }),
  blinder2: P({
    key: "blinder2", name: "Blinder 2-Lite", short: "BL2", category: "blinder", body: "blinder2",
    channels: ["cell1", "cell2"],
    attrs: ["dim"],
    caps: { pantilt: false, color: "tungsten", zoom: null, gobos: 0, prisms: 0, strobe: 0, pixels: 0, cells: 2 },
    range: MOVER_RANGE,
    beam: { angle: 55, power: 0.9, lens: 0.11, length: 12 },
    size: [0.62, 0.32, 0.22], weight: 6,
  }),
  blinder4: P({
    key: "blinder4", name: "Blinder 4-Lite", short: "BL4", category: "blinder", body: "blinder4",
    channels: ["cell1", "cell2", "cell3", "cell4"],
    attrs: ["dim"],
    caps: { pantilt: false, color: "tungsten", zoom: null, gobos: 0, prisms: 0, strobe: 0, pixels: 0, cells: 4 },
    range: MOVER_RANGE,
    beam: { angle: 55, power: 1, lens: 0.11, length: 14 },
    size: [0.62, 0.62, 0.22], weight: 10,
  }),
  laser: P({
    key: "laser", name: "Laser RGB (Fächer)", short: "LZ", category: "laser", body: "laser",
    channels: ["mode", "pattern", "r", "g", "b", "lzFan", "lzTilt", "lzSpeed", "lzBeams", "shutter"],
    attrs: ["dim", "r", "g", "b", "strobe", "lzPattern", "lzFan", "lzBeams", "lzTilt", "lzSpeed"],
    caps: { pantilt: false, color: "rgb", zoom: null, gobos: 0, prisms: 0, strobe: 20, pixels: 0, laser: true },
    range: MOVER_RANGE,
    beam: { angle: 0.3, power: 1, lens: 0.02, length: 45 },
    size: [0.3, 0.16, 0.36], weight: 6,
  }),
  hazer: P({
    key: "hazer", name: "Hazer", short: "HZ", category: "atmo", body: "hazer",
    channels: ["output", "fan"],
    attrs: ["dim"],
    caps: { pantilt: false, color: "none", zoom: null, gobos: 0, prisms: 0, strobe: 0, pixels: 0, haze: true },
    range: MOVER_RANGE,
    beam: null,
    size: [0.5, 0.35, 0.6], weight: 20,
  }),
};
for (const d of Object.values(FIXTURE_TYPES)) d.footprint = d.channels.length;

export const TYPE_KEYS = Object.keys(FIXTURE_TYPES);
export const getType = (key) => FIXTURE_TYPES[key] || null;

export const CHANNEL_LABELS = {
  pan: "Pan", "pan.fine": "Pan fein", tilt: "Tilt", "tilt.fine": "Tilt fein", ptSpeed: "P/T-Speed",
  shutter: "Shutter", dim: "Dimmer", "dim.fine": "Dimmer fein", c: "Cyan", m: "Magenta", y: "Gelb",
  cw: "Farbrad", gobo: "Gobo", goboRot: "Gobo-Rot.", prism: "Prisma", prismRot: "Prisma-Rot.",
  focus: "Fokus", zoom: "Zoom", iris: "Iris", frost: "Frost", r: "Rot", g: "Grün", b: "Blau", w: "Weiß",
  cto: "CTO", ctrl: "Control", rate: "Rate", dur: "Dauer", fx: "Effekt", mode: "Modus", pattern: "Muster",
  lzFan: "Fächer", lzTilt: "Tilt", lzSpeed: "Speed", lzBeams: "Strahlen", output: "Ausstoß", fan: "Lüfter",
  cell1: "Zelle 1", cell2: "Zelle 2", cell3: "Zelle 3", cell4: "Zelle 4",
};
export function channelLabel(ch) {
  const m = /^px(\d+)\.([rgb])$/.exec(ch);
  if (m) return `Px ${m[1]} ${{ r: "R", g: "G", b: "B" }[m[2]]}`;
  return CHANNEL_LABELS[ch] || ch;
}

/* ------------------------------------------------------------------ defaults & constraints */
export function defaultsFor(typeKey) {
  const d = getType(typeKey);
  const a = {};
  for (const k of ATTR_KEYS) a[k] = ATTRS[k].def;
  if (d && d.beam) a.zoom = d.beam.angle;
  if (d && d.caps.pixels) a.pixels = Array.from({ length: d.caps.pixels }, () => ({ r: 1, g: 1, b: 1, dim: 1 }));
  return a;
}

// does this fixture type have this attribute?
export const hasAttr = (typeKey, attr) => !!getType(typeKey)?.attrs.includes(attr);

export function nearestWheelSlot(r, g, b, w = 0) {
  r = Math.min(1, r + w); g = Math.min(1, g + w); b = Math.min(1, b + w);
  const m = Math.max(r, g, b);
  if (m < 1e-4) return 0;
  r /= m; g /= m; b /= m;
  let best = 0, bd = 1e9;
  COLOR_WHEEL.forEach((s, i) => {
    const d = (s.rgb[0] - r) ** 2 + (s.rgb[1] - g) ** 2 + (s.rgb[2] - b) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

// Clamp/snap attrs (in place) to what the physical fixture can do. Called by the engine as last step.
export function constrain(fixture, a) {
  const d = getType(fixture.type);
  if (!d) return a;
  for (const k of ATTR_KEYS) {
    const s = ATTRS[k];
    let v = a[k];
    if (typeof v !== "number" || Number.isNaN(v)) v = s.def;
    v = clamp(v, s.min, s.max);
    a[k] = s.discrete ? Math.round(v) : v;
  }
  if (d.caps.pantilt) {
    a.pan = clamp(a.pan, d.range.pan[0], d.range.pan[1]);
    a.tilt = clamp(a.tilt, d.range.tilt[0], d.range.tilt[1]);
  } else {
    a.pan = fixture.orient?.pan || 0;
    a.tilt = fixture.orient?.tilt || 0;
  }
  a.zoom = d.caps.zoom ? clamp(a.zoom, d.caps.zoom[0], d.caps.zoom[1]) : d.beam ? d.beam.angle : 0;
  a.gobo = Math.min(a.gobo, Math.max(0, (d.caps.gobos || 1) - 1));
  a.prism = Math.min(a.prism, Math.max(0, (d.caps.prisms || 1) - 1));
  if (!d.caps.strobe) a.strobe = 0;
  else a.strobe = Math.min(a.strobe, d.caps.strobe);
  const col = d.caps.color;
  if (col === "wheel") {
    const s = COLOR_WHEEL[nearestWheelSlot(a.r, a.g, a.b, a.w)].rgb;
    a.r = s[0]; a.g = s[1]; a.b = s[2]; a.w = 0;
  } else if (col === "cmy" || col === "rgb") {
    if (a.w > 0) { a.r = Math.min(1, a.r + a.w); a.g = Math.min(1, a.g + a.w); a.b = Math.min(1, a.b + a.w); a.w = 0; }
  } else if (col === "white" || col === "none") {
    a.r = a.g = a.b = 1; a.w = 0;
  } else if (col === "tungsten") {
    a.r = 1; a.g = 0.72; a.b = 0.42; a.w = 0;
  }
  if (d.caps.pixels) {
    if (!Array.isArray(a.pixels) || a.pixels.length !== d.caps.pixels)
      a.pixels = Array.from({ length: d.caps.pixels }, () => ({ r: a.r, g: a.g, b: a.b, dim: 1 }));
    for (const p of a.pixels) { p.r = clamp(p.r); p.g = clamp(p.g); p.b = clamp(p.b); p.dim = clamp(p.dim ?? 1); }
  } else if (a.pixels) delete a.pixels;
  return a;
}

/* ------------------------------------------------------------------ DMX encoding */
const b8 = (v) => Math.round(clamp(v) * 255);
const u16 = (v, lo, hi) => Math.round(clamp((v - lo) / (hi - lo)) * 65535);
const norm = (k, v) => (v - ATTRS[k].min) / (ATTRS[k].max - ATTRS[k].min);
const rot8 = (v) => Math.round(128 + clamp(v, -1, 1) * 127);

// One DMX channel value (0..255) for channel name `ch` from frame attrs `a`.
export function channelValue(ch, a, d) {
  const pm = /^px(\d+)\.([rgb])$/.exec(ch);
  if (pm) {
    const p = a.pixels?.[+pm[1] - 1];
    return p ? b8(p[pm[2]] * p.dim) : b8(a[pm[2]]);
  }
  const white = (c) => Math.min(1, a[c] + (a.w || 0));
  switch (ch) {
    case "pan": return u16(a.pan, d.range.pan[0], d.range.pan[1]) >> 8;
    case "pan.fine": return u16(a.pan, d.range.pan[0], d.range.pan[1]) & 255;
    case "tilt": return u16(a.tilt, d.range.tilt[0], d.range.tilt[1]) >> 8;
    case "tilt.fine": return u16(a.tilt, d.range.tilt[0], d.range.tilt[1]) & 255;
    case "dim": return u16(a.dim, 0, 1) >> 8;
    case "dim.fine": return u16(a.dim, 0, 1) & 255;
    case "shutter": return a.strobe > 0 ? 16 + Math.round(clamp(a.strobe / (d.caps.strobe || 20)) * 115) : 255;
    case "r": case "g": case "b": return b8(d.caps.color === "rgb" ? white(ch) : a[ch]);
    case "w": return b8(a.w);
    case "c": return b8(1 - white("r"));
    case "m": return b8(1 - white("g"));
    case "y": return b8(1 - white("b"));
    case "cw": return nearestWheelSlot(a.r, a.g, a.b, a.w) * 18;
    case "gobo": return a.gobo * 16;
    case "goboRot": return rot8(a.goboSpin);
    case "prism": return [0, 128, 192][a.prism] ?? 0;
    case "prismRot": return rot8(a.prismRot);
    case "focus": return b8(a.focus);
    case "iris": return b8(a.iris);
    case "frost": return b8(a.frost);
    case "zoom": return d.caps.zoom ? b8((a.zoom - d.caps.zoom[0]) / (d.caps.zoom[1] - d.caps.zoom[0])) : 0;
    case "rate": return b8(a.strobe / (d.caps.strobe || 25));
    case "dur": return a.strobe > 0 ? 40 : 0;
    case "cell1": case "cell2": case "cell3": case "cell4": return b8(a.dim);
    case "mode": return a.dim > 0 ? Math.max(1, b8(a.dim)) : 0;
    case "pattern": return a.lzPattern * 85;
    case "lzFan": case "lzTilt": case "lzSpeed": case "lzBeams": return b8(norm(ch, a[ch]));
    case "output": return b8(a.dim);
    case "fan": return a.dim > 0 ? 160 : 0;
    default: return 0; // ptSpeed, ctrl, cto, fx
  }
}

// Writes the fixture's channels into `out` (Uint8Array) starting at index `offset` (= address-1).
export function encode(typeKey, a, out, offset = 0) {
  const d = getType(typeKey);
  if (!d) return out;
  const n = d.channels.length;
  for (let i = 0; i < n && offset + i < out.length; i++) out[offset + i] = channelValue(d.channels[i], a, d);
  return out;
}

// universes: { [u:number]: Uint8Array(512) } — missing universes are created. Returns universes.
export function writeDMX(fixtures, attrsById, universes = {}) {
  for (const k in universes) universes[k].fill(0);
  for (const f of fixtures) {
    const a = attrsById[f.id];
    if (!a || !f.universe || !f.address) continue;
    const u = universes[f.universe] || (universes[f.universe] = new Uint8Array(512));
    encode(f.type, a, u, f.address - 1);
  }
  return universes;
}

// Which fixture/channel sits on universe u, address addr (1-based)? → {fixture, channel, index} | null
export function channelAt(fixtures, u, addr) {
  for (const f of fixtures) {
    if (f.universe !== u) continue;
    const d = getType(f.type);
    const i = addr - f.address;
    if (d && i >= 0 && i < d.footprint) return { fixture: f, channel: d.channels[i], index: i };
  }
  return null;
}

/* ------------------------------------------------------------------ geometry */
// World: metres, +Y up, +Z towards the audience, +X = stage left as seen from FOH (right on screen).
// Local fixture frame: +Y out of the base (the yoke axis), +Z = fixture front, +X = Y × Z.
// mount "floor": local = world. mount "hang": upside down, front still faces +Z (X → -X, Y → -Y).
// yaw (deg) then rotates the whole base around world Y (positive = counter-clockwise seen from above).
export function baseBasis(f) {
  const hang = f.mount === "hang";
  const cy = Math.cos((f.yaw || 0) * DEG), sy = Math.sin((f.yaw || 0) * DEG);
  const rot = (x, y, z) => [x * cy + z * sy, y, -x * sy + z * cy];
  return { x: rot(hang ? -1 : 1, 0, 0), y: rot(0, hang ? -1 : 1, 0), z: rot(0, 0, 1) };
}

// Beam direction (unit vector, world) for pan/tilt in degrees. tilt 0 = straight out of the base.
export function beamDirection(f, pan, tilt, basis = baseBasis(f)) {
  const p = pan * DEG, t = tilt * DEG;
  const lx = Math.sin(t) * Math.sin(p), ly = Math.cos(t), lz = Math.sin(t) * Math.cos(p);
  const { x, y, z } = basis;
  return [x[0] * lx + y[0] * ly + z[0] * lz, x[1] * lx + y[1] * ly + z[1] * lz, x[2] * lx + y[2] * ly + z[2] * lz];
}

// pan/tilt (deg) that point fixture f at world point [x,y,z]; respects the type's pan/tilt range.
export function aimAt(f, point) {
  const d = getType(f.type);
  const range = d ? d.range : MOVER_RANGE;
  const v = [point[0] - f.pos[0], point[1] - f.pos[1], point[2] - f.pos[2]];
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  const { x, y, z } = baseBasis(f);
  const dot = (a) => (a[0] * v[0] + a[1] * v[1] + a[2] * v[2]) / len;
  const lx = dot(x), ly = dot(y), lz = dot(z);
  const t0 = Math.acos(clamp(ly, -1, 1)) / DEG;
  const p0 = Math.atan2(lx, lz) / DEG;
  // two equivalent solutions (pan, tilt) and (pan ± 180, -tilt): prefer valid tilt, then smallest |pan|
  let best = null;
  for (const [p, t] of [[p0, t0], [p0 + 180, -t0], [p0 - 180, -t0]]) {
    for (const pp of [p - 360, p, p + 360]) {
      if (pp < range.pan[0] || pp > range.pan[1]) continue;
      const cost = (t < range.tilt[0] || t > range.tilt[1] ? 1e4 : 0) + Math.abs(pp);
      if (!best || cost < best.cost) best = { pan: pp, tilt: t, cost };
    }
  }
  const pan = best ? best.pan : clamp(p0, range.pan[0], range.pan[1]);
  const tilt = clamp(best ? best.tilt : t0, range.tilt[0], range.tilt[1]);
  return { pan: Math.round(pan * 100) / 100, tilt: Math.round(tilt * 100) / 100 };
}

/* ------------------------------------------------------------------ colour helpers */
// h in degrees, s/v 0..1 → [r,g,b] 0..1
export function hsv2rgb(h, s, v) {
  h = ((h % 360) + 360) % 360 / 60;
  const i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
}
export function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}
// visible light colour of an attrs object (white channel adds warm-ish white), 0..1 each
export function lightColor(a) {
  const w = a.w || 0;
  return [Math.min(1, a.r + w), Math.min(1, a.g + w * 0.94), Math.min(1, a.b + w * 0.86)];
}
// Strobe shutter state at time t (s): open for the first 30 % of each strobe period. Same rule for viz and monitor.
export const shutterOpen = (a, t) => !(a.strobe > 0) || ((t * a.strobe) % 1) < 0.3;
export const rgbCss = (r, g, b) => `rgb(${b8(r)},${b8(g)},${b8(b)})`;

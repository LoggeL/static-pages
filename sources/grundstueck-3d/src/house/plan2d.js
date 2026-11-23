import { splitWallSegments } from './dimensions.js';
import { accessGeometry } from './access.js';

// Each unit of the viewBox represents one metre. The plan uses the sketch's u/v axes.
const color = {
  paper: '#f8f6ee',
  line: '#2d3b34',
  dim: '#32675c',
  soft: '#a8b2a9',
  wet: '#e3ece5',
  wood: '#e6d8bf',
  fixture: '#d8d8ce',
  edge: '#ac9e89',
  glass: '#88ada8',
  door: '#906d41',
  roof: '#aa634b',
  ground: '#90683f',
};
const dec = (number) => Number(number).toFixed(2).replace('.', ',');
const n = (coordinate) => Number(coordinate.toFixed(4));
const xml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]
  );
const pts = (points) => points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
function line(x1, y1, x2, y2, stroke = color.line, width = 0.022, extra = '') {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;
}
function rect(x, y, x2, y2, fill, stroke = 'none', width = 0.017) {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(x2 - x)}" height="${n(y2 - y)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
}
function poly(points, fill, stroke = 'none', width = 0.017) {
  return `<polygon points="${pts(points)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
}
function label(
  x,
  y,
  text,
  size = 0.21,
  anchor = 'middle',
  ink = color.line,
  options = ''
) {
  return `<text x="${n(x)}" y="${n(y)}" fill="${ink}" font-size="${size}" text-anchor="${anchor}" ${options}>${xml(text)}</text>`;
}
function drawing(title, description, box, contents) {
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${xml(title)}" viewBox="${box.join(' ')}" font-family="Arial, sans-serif"><title>${xml(title)}</title><desc>${xml(description)}</desc>${rect(box[0], box[1], box[0] + box[2], box[1] + box[3], color.paper)}${contents.join('')}</svg>`;
}
// Dimension line with witness lines, slash ticks and a label kept upright on vertical chains.
function dimension(a, b, offset, caption) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = Math.hypot(dx, dy);
  if (length < 0.005) return '';
  const vx = dx / length,
    vy = dy / length,
    nx = -vy,
    ny = vx,
    side = Math.sign(offset);
  const start = [a[0] + nx * offset, a[1] + ny * offset],
    end = [b[0] + nx * offset, b[1] + ny * offset];
  let out = line(...start, ...end, color.dim, 0.012);
  for (const [source, tick] of [
    [a, start],
    [b, end],
  ]) {
    out += line(
      source[0] + nx * side * 0.05,
      source[1] + ny * side * 0.05,
      tick[0] + nx * side * 0.07,
      tick[1] + ny * side * 0.07,
      color.soft,
      0.009
    );
    out += line(
      tick[0] - 0.052 * (vx + nx),
      tick[1] - 0.052 * (vy + ny),
      tick[0] + 0.052 * (vx + nx),
      tick[1] + 0.052 * (vy + ny),
      color.dim,
      0.02
    );
  }
  if (caption) {
    const cx = (start[0] + end[0]) / 2,
      cy = (start[1] + end[1]) / 2;
    const angle = Math.abs(vy) > 0.9 ? -90 : 0;
    out += `<g transform="translate(${n(cx)} ${n(cy)}) rotate(${angle})">${label(0, -0.072, caption, 0.177, 'middle', color.dim, 'font-weight="600"')}</g>`;
  }
  return out;
}
function drawFixtures(furniture) {
  return furniture
    .map((f) => {
      const { u0: a, v0: b, u1: c, v1: d } = f;
      const isSoft = ['sofa', 'table', 'bed-desk', 'chair', 'bench'].includes(
        f.kind
      );
      let out = rect(
        a,
        b,
        c,
        d,
        isSoft ? color.wood : color.fixture,
        color.edge,
        0.014
      );
      if (['wc', 'sink', 'kitchen-sink'].includes(f.kind)) {
        out += `<ellipse cx="${n((a + c) / 2)}" cy="${n((b + d) / 2)}" rx="${n((c - a) * 0.34)}" ry="${n((d - b) * 0.32)}" fill="#f3f4eb" stroke="${color.soft}" stroke-width=".015"/>`;
      } else if (f.kind === 'shower') {
        out +=
          line(a, b, c, d, color.soft, 0.018) +
          line(a, d, c, b, color.soft, 0.018) +
          `<circle cx="${n(c - 0.19)}" cy="${n(b + 0.19)}" r=".055" fill="#f3f4eb" stroke="${color.soft}" stroke-width=".016"/>`;
      } else if (f.kind === 'kitchen-hob') {
        for (const u of [0.28, 0.72])
          for (const v of [0.27, 0.73])
            out += `<circle cx="${n(a + (c - a) * u)}" cy="${n(b + (d - b) * v)}" r=".078" fill="none" stroke="${color.edge}" stroke-width=".018"/>`;
      } else if (f.kind === 'sofa') {
        const back = f.back || (c - a > d - b ? 'bottom' : 'left');
        if (back === 'bottom')
          out += line(a + 0.06, d - 0.15, c - 0.06, d - 0.15, color.edge, 0.018);
        else if (back === 'top')
          out += line(a + 0.06, b + 0.15, c - 0.06, b + 0.15, color.edge, 0.018);
        else if (back === 'right')
          out += line(c - 0.15, b + 0.06, c - 0.15, d - 0.06, color.edge, 0.018);
        else
          out += line(a + 0.15, b + 0.06, a + 0.15, d - 0.06, color.edge, 0.018);
      }
      return `<g><title>${xml(f.label || 'Möbel')} · ${dec(c - a)} × ${dec(d - b)} m</title>${out}</g>`;
    })
    .join('');
}
function openingMarkup(w, o) {
  const [a, b, c, d] = o.rect,
    horizontal = w.axis === 'u';
  const u = (a + c) / 2,
    v = (b + d) / 2;
  let out = '';
  if (o.kind === 'window') {
    for (const t of [0.39, 0.61])
      out += horizontal
        ? line(a, b + (d - b) * t, c, b + (d - b) * t, color.glass, 0.028)
        : line(a + (c - a) * t, b, a + (c - a) * t, d, color.glass, 0.028);
  } else {
    out += horizontal
      ? line(a, v, c, v, color.door, 0.035)
      : line(u, b, u, d, color.door, 0.035);
    if (o.swing) {
      const hingeAtEnd = o.swing.endsWith('right');
      const hinge = hingeAtEnd ? o.s1 : o.s0;
      const sign =
        o.swing.startsWith('in-neg') || o.side === 'east' || o.side === 'north'
          ? -1
          : 1;
      const direction = hingeAtEnd ? -1 : 1,
        r = o.s1 - o.s0;
      const project = (along, across) =>
        horizontal ? [hinge + along, v + across] : [u + across, hinge + along];
      const curve = Array.from({ length: 15 }, (_, i) =>
        project(
          direction * r * Math.cos((i * Math.PI) / 28),
          sign * r * Math.sin((i * Math.PI) / 28)
        )
      );
      out +=
        line(...project(0, 0), ...project(0, sign * r), color.door, 0.017) +
        `<polyline points="${pts(curve)}" fill="none" stroke="${color.edge}" stroke-width=".012" stroke-dasharray=".055 .035"/>`;
    }
  }
  return `<g><title>${xml(o.label || 'Öffnung')} · ${dec(o.s1 - o.s0)} × ${dec(o.height)} m</title>${out}</g>`;
}
function roomLabel(room) {
  const [u, v] = room.labelAt;
  const small = room.areaM2 < 8;
  const aliases = {
    eg_hwr: 'Technik / HWR',
    eg_halle: 'Offener Bereich',
    og_wohnen: 'Wohnen / Essen / Küche',
    og_treppe: 'Treppenloch',
    eg_treppe: 'Treppe',
  };
  const name = aliases[room.id] || room.name;
  const halo = `font-weight="600" paint-order="stroke" stroke="${color.paper}" stroke-width=".08" stroke-linejoin="round"`;
  return (
    label(
      u,
      v - 0.012,
      name,
      small ? 0.177 : 0.225,
      'middle',
      color.line,
      halo
    ) +
    label(
      u,
      v + 0.185,
      `${dec(room.areaM2)} m²`,
      0.149,
      'middle',
      color.dim,
      halo
    )
  );
}
function addFloorDimensions(s, l, out) {
  const { length: L, width: W, wallExt: t } = s.footprint;
  out.push(
    dimension([0, 0], [L, 0], -0.78, `${dec(L)} m`),
    dimension([0, 0], [0, W], 0.85, `${dec(W)} m`)
  );
  const core = l.walls.find(
    (w) => w.id === 'eg_hwr_east' || w.id === 'og_bath_east'
  );
  const chain = core ? [0, t, core.u0, core.u1, L - t, L] : [0, t, L - t, L];
  chain
    .slice(1)
    .forEach((x, i) =>
      out.push(
        dimension(
          [chain[i], 0],
          [x, 0],
          -0.33,
          x - chain[i] > 0.6 ? dec(x - chain[i]) : ''
        )
      )
    );
  for (const side of ['east', 'north']) {
    const horizontal = side === 'east';
    const total = horizontal ? L : W;
    const points = [
      ...new Set([
        0,
        total,
        ...l.openings
          .filter((o) => o.side === side)
          .flatMap((o) => [o.s0, o.s1]),
      ]),
    ].sort((a, b) => a - b);
    points.slice(1).forEach((x, i) => {
      const a = points[i],
        b = x,
        cap = b - a > 0.53 ? dec(b - a) : '';
      out.push(
        horizontal
          ? dimension([a, W], [b, W], l.id === 'eg' ? 1.42 : 0.38, cap)
          : dimension([L, a], [L, b], -0.42, cap)
      );
    });
  }
}
export function renderFloorPlanSvg(s, levelId, options = {}) {
  const { length: L, width: W } = s.footprint;
  if (levelId === 'dach') return roofPlan(s);
  const l = s.levels[levelId],
    out = [rect(0, 0, L, W, '#f1eee2')];
  for (const r of l.rooms.filter((r) => /bad|wc|hwr/.test(r.id)))
    for (const q of r.rects) out.push(rect(...q, color.wet));
  if (levelId === 'eg') {
    const access =
      options.access ??
      accessGeometry(s, { doors: options.terrainInfo?.doors });
    const footprint = (q, fill) =>
      rect(q.u0, q.v0, q.u1, q.v1, fill, color.edge, 0.018);
    out.push(
      footprint(access.foyer.bottom, '#d9d9ce'),
      ...access.foyer.steps.map((q) => footprint(q, color.wood))
    );
    out.push(
      ...[
        access.hof.top,
        ...access.hof.steps,
        access.hof.bottom,
        access.gardenStep,
      ].map((q) => footprint(q, '#d6d4c8'))
    );
  }
  out.push(drawFixtures(l.furniture || []));
  for (const step of s.stairs.steps)
    out.push(poly(step.poly, color.wood, color.edge, 0.018));
  const walk = s.stairs.walkLine;
  if (walk?.length >= 2) {
    const start = walk[0];
    const prev = walk[walk.length - 2];
    const tip = walk[walk.length - 1];
    const dx = tip[0] - prev[0];
    const dy = tip[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const ah = 0.19;
    const aw = 0.11;
    const leftWing = [tip[0] - ux * ah - uy * aw, tip[1] - uy * ah + ux * aw];
    const rightWing = [tip[0] - ux * ah + uy * aw, tip[1] - uy * ah - ux * aw];
    out.push(
      `<polyline points="${pts(walk)}" fill="none" stroke="${color.door}" stroke-width=".024" stroke-dasharray=".065 .04"/>`,
      `<circle cx="${n(start[0])}" cy="${n(start[1])}" r=".055" fill="${color.paper}" stroke="${color.door}" stroke-width=".022"/>`,
      `<polyline points="${pts([leftWing, tip, rightWing])}" fill="none" stroke="${color.door}" stroke-width=".026" stroke-linejoin="round" stroke-linecap="round"/>`
    );
  }
  for (const w of l.walls) {
    const parts = splitWallSegments(w, l.openings);
    for (const solid of parts.solid) out.push(rect(...solid, color.line));
    for (const o of parts.openings) out.push(openingMarkup(w, o));
  }
  out.push(...l.rooms.map(roomLabel));
  addFloorDimensions(s, l, out);
  const footer = W + (levelId === 'eg' ? 1.96 : 1.04);
  out.push(
    label(
      0,
      footer,
      'Dautengasse links · Garten rechts',
      0.179,
      'start',
      color.dim
    ),
    label(L, footer, 'Maße in m', 0.17, 'end', color.dim)
  );
  return drawing(
    `Grundriss ${l.label}`,
    'Bemaßte Außenwände, Öffnungen, Einrichtung und Geschosstreppe aus dem Hausmodell.',
    [-1.27, -1.14, L + 2.27, footer + 1.44],
    out
  );
}
function roofPlan(s) {
  const { length: L, width: W } = s.footprint,
    r = s.roof;
  const [u0, v0, u1, v1] = r.eaveRectPlan,
    middle = W / 2;
  const out = [
    rect(u0, v0, u1, middle, '#c18a6a', color.roof),
    rect(u0, middle, u1, v1, '#b57457', color.roof),
  ];
  for (let v = v0 + 0.3; v < v1; v += 0.3)
    out.push(line(u0, v, u1, v, '#a16b52', 0.016));
  for (let u = u0 + 0.23; u < u1; u += 0.34)
    out.push(line(u, v0, u, v1, '#af785b', 0.012));
  out.push(
    line(0, middle, L, middle, '#794734', 0.085),
    label(
      L / 2,
      middle - 0.12,
      `First +${dec(s.heights.ridgeTopY)} m`,
      0.23,
      'middle',
      '#402c22',
      'font-weight="600"'
    ),
    label(L / 2, 1.4, `${r.pitchDeg}°`, 0.3),
    label(L / 2, W - 1, `${r.pitchDeg}°`, 0.3)
  );
  out.push(
    dimension([u0, v0], [u1, v0], -0.55, `${dec(u1 - u0)} m`),
    dimension([u0, v0], [u0, v1], 0.65, `${dec(v1 - v0)} m`),
    dimension([L, W], [L, v1], -0.45, dec(r.overhangEast))
  );
  out.push(
    label(
      0,
      v1 + 0.7,
      'Hof und Kanal · Traufe mit Überstand',
      0.185,
      'start',
      color.dim
    )
  );
  return drawing(
    'Dachaufsicht',
    'Satteldach mit gleicher Dachneigung auf beiden Seiten und bündiger Grenztraufe.',
    [-1, -1, L + 2.1, v1 + 2],
    out
  );
}
export function renderSectionSvg(s, terrain = {}, options = {}) {
  const long = options.axis === 'long',
    f = s.footprint,
    h = s.heights,
    r = s.roof;
  const width = long ? f.length : f.width,
    half = width / 2;
  const under = h.eaveWallY,
    t = f.wallExt,
    earth = terrain.plinthBottomLocalY ?? -h.defaultPlinthDepth;
  const out = [],
    component = (a, y0, b, y1, fill) =>
      rect(a, -y1, b, -y0, fill, color.line, 0.018);
  out.push(
    component(0, earth, width, 0, '#b6b4a5'),
    component(0, -h.floorSlabEg, width, 0, '#787e71')
  );
  out.push(
    component(0, 0, t, under, color.line),
    component(width - t, 0, width, under, color.line),
    component(0, h.egClear, width, h.okffOg, '#738275'),
    component(0, h.okffOg + h.ogClear, width, under, '#738275')
  );
  if (long) {
    const roofEdge = h.ridgeTopY - h.ridgeWallY;
    out.push(
      component(0, under, t, h.ridgeWallY, color.line),
      component(width - t, under, width, h.ridgeWallY, color.line),
      component(0, h.ridgeWallY, width, h.ridgeWallY + roofEdge, color.roof)
    );
  } else {
    const top = (u) => h.ridgeTopY - Math.abs(u - half) * Math.tan(r.pitchRad),
      left = -r.overhangWest,
      right = width + r.overhangEast;
    const thick = h.ridgeTopY - h.ridgeWallY;
    out.push(
      poly(
        [
          [left, -top(left)],
          [half, -h.ridgeTopY],
          [right, -top(right)],
          [right, -top(right) + thick],
          [half, -h.ridgeTopY + thick],
          [left, -top(left) + thick],
        ],
        color.roof,
        '#824831',
        0.024
      )
    );
    out.push(
      label(half, -under - 0.4, `${r.pitchDeg}°`, 0.3, 'middle', color.roof)
    );
  }
  const profile = long ? terrain.sectionLong : terrain.sectionCross;
  if (profile?.length)
    out.push(
      `<polyline points="${pts(profile.map((p) => [p.s + half, -p.yLocal]))}" fill="none" stroke="${color.ground}" stroke-width=".045" stroke-dasharray=".15 .075"/>`
    );
  for (const [height, caption, end] of [
    [0, '±0,00 EG', width],
    [h.okffOg, `+${dec(h.okffOg)} OG`, width],
    [under, `+${dec(under)} Wand`, width],
    [h.ridgeTopY, `+${dec(h.ridgeTopY)} First`, long ? width : half],
  ]) {
    out.push(
      line(
        -1.52,
        -height,
        end,
        -height,
        color.soft,
        0.015,
        'stroke-dasharray=".10 .055"'
      ),
      label(-1.5, -height - 0.09, caption, 0.18, 'start', color.dim)
    );
  }
  out.push(
    dimension([width, 0], [width, -h.egClear], 0.52, dec(h.egClear)),
    dimension(
      [width, -h.okffOg],
      [width, -h.okffOg - h.ogClear],
      0.52,
      dec(h.ogClear)
    )
  );
  out.push(dimension([0, -earth], [width, -earth], 0.38, `${dec(width)} m`));
  out.push(
    label(
      0,
      -earth + 1.04,
      long ? 'Dautengasse' : 'Grenzwand 215/3',
      0.22,
      'start',
      color.dim
    ),
    label(
      width,
      -earth + 1.04,
      long ? 'Garten' : 'Hof und Kanal',
      0.22,
      'end',
      color.dim
    )
  );
  out.push(
    line(
      0,
      -earth + 1.48,
      0.5,
      -earth + 1.48,
      color.ground,
      0.045,
      'stroke-dasharray=".12 .06"'
    ),
    label(
      0.64,
      -earth + 1.55,
      'Gelände in der Hausmitte',
      0.17,
      'start',
      color.ground
    )
  );
  return drawing(
    long
      ? 'Längsschnitt durch die Hausmitte'
      : 'Querschnitt durch die Hausmitte',
    'Geschosse und Dach in ihrer tatsächlichen Höhe. Die gestrichelte Linie zeigt das Gelände im jeweiligen Schnitt.',
    [-2.12, -h.ridgeTopY - 0.65, width + 4.3, h.ridgeTopY - earth + 2.5],
    out
  );
}

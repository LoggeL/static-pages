import { evaluate, fmtLen, dist } from './measure.js';
import { clipSegment, clipPolygon, screenAt, toScreen, inside, boxOutside, bbox } from './clip.js';
import { COLORS, NF1, NF2 } from './format.js';

// Zeichnet Messpunkte, Linien, Grenzen, Bestand, Kanal, blaue Baugrenze und 2D-Hausgrundriss
// als SVG/HTML über Karte bzw. 3D-Bild. Ohne three.js.

const f1 = (v) => v.toFixed(1);
const xy = (p) => `${f1(p[0])},${f1(p[1])}`;

function group(points) {
  return { pts: points, C: points.map(() => new Float64Array(4)), box: bbox(points) };
}
function project(g, proj) { for (let i = 0; i < g.pts.length; i++) proj.toClip(g.pts[i], g.C[i]); }

function pathOf(C, closed, proj) {
  const n = C.length;
  let d = '', open = false;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = C[i], b = C[(i + 1) % n];
    const r = clipSegment(a, b, proj);
    if (!r) { open = false; continue; }
    const [t0, t1] = r;
    if (!(open && t0 === 0)) d += `M${xy(t0 === 0 ? toScreen(a, proj) : screenAt(a, b, t0, proj))}`;
    d += `L${xy(t1 === 1 ? toScreen(b, proj) : screenAt(a, b, t1, proj))}`;
    open = t1 === 1;
  }
  return d;
}

function polySub(V, proj) {
  const s = clipPolygon(V, proj);
  if (!s) return '';
  let a = 0;
  for (let i = 0; i < s.length; i++) { const p = s[i], q = s[(i + 1) % s.length]; a += p[0] * q[1] - q[0] * p[1]; }
  if (a < 0) s.reverse();
  return `M${s.map(xy).join('L')}Z`;
}

export class Overlay {
  constructor(svg, labels) {
    this.svg = svg;
    this.labels = labels;
    this.w = 1; this.h = 1;
    this.labelSig = '';
    this.c = new Float64Array(4);
    this.c2 = new Float64Array(4);
    this.builds = 0;
    this.baugrenze = null;
    this.house = null;
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  setStatic({ boundaries, buildings, sewer, wallH }) {
    this.bounds = boundaries.map((b) => ({
      b,
      rings: [...(b.points ? [{ g: group(b.points), closed: true }] : []), ...(b.lines || []).map((l) => ({ g: group(l), closed: false }))],
    }));
    for (const B of this.bounds) B.box = bbox(B.rings.flatMap((r) => r.g.pts));
    this.wallH = wallH;
    this.buildings = buildings.map((b) => {
      const topY = Math.max(...b.points.map((p) => p[1])) + wallH;
      const lo = group(b.points), hi = group(b.points.map((p) => [p[0], topY, p[2]]));
      return { b, lo, hi, topY, box: bbox([...lo.pts, ...hi.pts]) };
    });
    this.sewer = sewer;
    this.pipes = sewer.pipes.map((p) => ({ p, g: group(p.points) }));
    this.conns = sewer.connections.map((c) => group(c));
    this.corrWidth = null;
  }

  // Amtliche rückwärtige blaue Baugrenze (±0,5 m Unsicherheitsband)
  setBaugrenze(bg) {
    if (!bg) { this.baugrenze = null; return; }
    const line = group(bg.line);
    const bandFront = group(bg.bandFront);
    const bandBack = group(bg.bandBack);
    const bandPoly = group(bg.bandPoly);
    this.baugrenze = {
      meta: bg.meta,
      line, bandFront, bandBack, bandPoly,
      labelAt: bg.labelAt,
      box: bbox(bg.bandPoly),
    };
  }

  // Maßstäblicher 2D-Hausgrundriss / Dachaufsicht + DN250-Konfliktzone
  setHouse(h) {
    if (!h) { this.house = null; return; }
    const footprint = group(h.footprint);
    const eaves = group(h.eaves);
    const ridge = group(h.ridge);
    const walls = (h.walls || []).map((w) => ({ ext: w.ext, g: group(w.poly) }));
    const openings = (h.openings || []).map((o) => ({ kind: o.kind, g: group([o.a, o.b]) }));
    const stairSteps = (h.stairSteps || []).map((p) => group(p));
    const exteriorParts = (h.exteriorParts || []).map((p) => group(p));
    const stairOpening = h.stairOpening ? group(h.stairOpening) : null;
    const conflictPoly = h.conflictPoly ? group(h.conflictPoly) : null;
    const entrance = h.entrance ? { g: group([h.entrance.from, h.entrance.to]), label: h.entrance.label, at: h.entrance.from } : null;
    const cutLine = h.cutLine ? group(h.cutLine) : null;
    this.house = {
      mode: h.mode,
      showRoof: !!h.showRoof,
      footprint, eaves, ridge, walls, openings, stairSteps, exteriorParts, stairOpening,
      rooms: h.rooms || [],
      entrance,
      dims: h.dims || null,
      conflictPoly,
      conflictLabel: h.conflictLabel || null,
      cutLine,
      box: bbox([...h.footprint, ...h.eaves, ...exteriorParts.flatMap((g) => g.pts)]),
    };
  }

  setCorridor(w) {
    if (w === this.corrWidth) return;
    this.corrWidth = w;
    this.corr = [];
    if (!(w > 0)) return;
    for (const { p } of this.pipes) {
      const pts = p.points;
      const L = [], R = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let nx = -(b[2] - a[2]), nz = b[0] - a[0];
        const len = Math.hypot(nx, nz) || 1; nx /= len; nz /= len;
        L.push([pts[i][0] + nx * w, pts[i][1], pts[i][2] + nz * w]);
        R.push([pts[i][0] - nx * w, pts[i][1], pts[i][2] - nz * w]);
      }
      const quads = [];
      for (let i = 0; i < pts.length - 1; i++) quads.push(group([L[i], L[i + 1], R[i + 1], R[i]]));
      for (const c of [pts[0], pts[pts.length - 1]]) {
        const ring = [];
        for (let t = 0; t < 20; t++) { const ang = (t / 20) * Math.PI * 2; ring.push([c[0] + w * Math.cos(ang), c[1], c[2] + w * Math.sin(ang)]); }
        quads.push(group(ring));
      }
      const edges = [group(L), group(R)];
      this.corr.push({ quads, edges, box: bbox([...L, ...R, ...quads.flatMap((q) => q.pts)]) });
    }
  }

  // scene: { k, selectedId, showBounds, showBuildings, showSewer, showBaugrenze, showHouse, items, draft, marker, grid }
  render(scene, proj) {
    this.builds++;
    const svg = [], lab = [];
    if (scene.grid) this.drawGrid(scene.grid, svg, proj);
    if (scene.showBuildings) this.drawBuildings(svg, lab, proj);
    if (scene.showSewer) this.drawSewer(svg, lab, proj);
    if (scene.showBaugrenze && this.baugrenze) this.drawBaugrenze(svg, lab, proj);
    if (scene.showBounds) for (const B of this.bounds) this.drawBoundary(B, svg, lab, proj);
    if (scene.showHouse && this.house) this.drawHouse(svg, lab, proj, scene.showSewer);
    for (const it of scene.items) this.drawItem(it, scene.k, it.id === scene.selectedId, svg, lab, proj);
    if (scene.draft) this.drawItem(scene.draft, scene.k, false, svg, lab, proj);
    if (scene.marker) {
      const c = proj.toClip(scene.marker, this.c);
      if (inside(c, proj, 8)) { const s = toScreen(c, proj); svg.push(`<circle class="marker" cx="${f1(s[0])}" cy="${f1(s[1])}" r="6"/>`); }
    }
    this.svg.innerHTML = svg.join('');
    this.setLabels(lab);
  }

  setLabels(lab) {
    const sig = lab.map((l) => l.html + l.style).join('\u0001');
    if (sig === this.labelSig && this.labels.childElementCount === lab.length) {
      const ch = this.labels.children;
      for (let i = 0; i < lab.length; i++) ch[i].style.transform = lab[i].tf;
      return;
    }
    this.labelSig = sig;
    this.labels.innerHTML = lab.map((l) => l.html.replace('<div ', `<div style="transform:${l.tf};${l.style}" `)).join('');
  }

  label(lab, s, text, cls, color, above = false) {
    lab.push({
      html: `<div class="mlabel ${cls}">${text}</div>`,
      style: `--c:${color}`,
      tf: `translate(${f1(s[0])}px,${f1(s[1])}px) translate(-50%,${above ? 'calc(-100% - 10px)' : '-50%'})`,
    });
  }
  tag(lab, p, text, cls, color, proj, maxDist = Infinity, above = false) {
    const c = proj.toClip(p, this.c);
    if (!inside(c, proj, 80)) return null;
    const d = proj.labelDist(p);
    if (d > maxDist) return null;
    this.label(lab, toScreen(c, proj), text, cls, color, above);
    return d;
  }
  dot(svg, p, proj, cls, r) {
    const c = proj.toClip(p, this.c);
    if (!inside(c, proj, r + 2)) return;
    const s = toScreen(c, proj);
    svg.push(`<circle class="${cls}" cx="${f1(s[0])}" cy="${f1(s[1])}" r="${r}"/>`);
  }

  drawGrid(grid, svg, proj) {
    const { step0, extent, image, view } = grid;
    let step = step0;
    while (step / view.mpp < 24) step *= 2;
    const [ex0, ex1, ez0, ez1] = extent;
    const [bx0, bx1, bz0, bz1] = image;
    const vx0 = Math.max(ex0, view.x0), vx1 = Math.min(ex1, view.x1), vz0 = Math.max(ez0, view.z0), vz1 = Math.min(ez1, view.z1);
    if (vx0 >= vx1 || vz0 >= vz1) return;
    const a = this.c, b = this.c2;
    let d = '';
    const seg = (p, q) => {
      proj.toClip(p, a); proj.toClip(q, b);
      const r = clipSegment(a, b, proj);
      if (r) d += `M${xy(screenAt(a, b, r[0], proj))}L${xy(screenAt(a, b, r[1], proj))}`;
    };
    for (let x = Math.ceil(vx0 / step) * step; x <= vx1; x += step) {
      if (x > bx0 && x < bx1) { if (vz0 < bz0) seg([x, 0, vz0], [x, 0, Math.min(bz0, vz1)]); if (vz1 > bz1) seg([x, 0, Math.max(bz1, vz0)], [x, 0, vz1]); }
      else seg([x, 0, vz0], [x, 0, vz1]);
    }
    for (let z = Math.ceil(vz0 / step) * step; z <= vz1; z += step) {
      if (z > bz0 && z < bz1) { if (vx0 < bx0) seg([vx0, 0, z], [Math.min(bx0, vx1), 0, z]); if (vx1 > bx1) seg([Math.max(bx1, vx0), 0, z], [vx1, 0, z]); }
      else seg([vx0, 0, z], [vx1, 0, z]);
    }
    if (d) svg.push(`<path class="grid" d="${d}"/>`);
  }

  drawBoundary(B, svg, lab, proj) {
    const b = B.b;
    if (boxOutside(B.box, proj)) return;
    const secondary = b.style === 'secondary';
    let d = '';
    for (const r of B.rings) { project(r.g, proj); d += pathOf(r.g.C, r.closed, proj); }
    if (d) svg.push(`${secondary ? '' : `<path class="boundary halo" d="${d}"/>`}<path class="${secondary ? 'boundary secondary' : 'boundary'}" d="${d}"/>`);
    for (const c of b.corners || []) this.dot(svg, c, proj, 'corner', 4);
    for (const sd of b.sides || []) this.tag(lab, sd.at, `${NF2.format(sd.length)} m`, 'bound', '#ff8fa0', proj, 70);
    for (const l of b.labels || []) this.tag(lab, l.at, l.text, 'bound nb', '#d9c3c7', proj, 90);
    if (b.center) {
      const extra = b.name === 'Flurstück 215' ? ' · priv. Grünfläche' : b.name === 'Flurstück 214' ? ' (dig.)' : '';
      this.tag(lab, b.center, `${b.name}${b.area_m2 ? ` · ${NF1.format(b.area_m2)} m²` : ''}${extra}`, 'bound name', '#ff8fa0', proj);
    }
  }

  // Amtliche rückwärtige blaue Baugrenze (B-Plan 1:1000) inkl. ±0,5-m-Unsicherheitsband
  drawBaugrenze(svg, lab, proj) {
    const bg = this.baugrenze;
    if (!bg || boxOutside(bg.box, proj)) return;
    project(bg.bandPoly, proj);
    const fill = polySub(bg.bandPoly.C, proj);
    if (fill) svg.push(`<path class="bg-band" d="${fill}"/>`);
    project(bg.bandFront, proj);
    project(bg.bandBack, proj);
    const edge = pathOf(bg.bandFront.C, false, proj) + pathOf(bg.bandBack.C, false, proj);
    if (edge) svg.push(`<path class="bg-edge" d="${edge}"/>`);
    project(bg.line, proj);
    const axis = pathOf(bg.line.C, false, proj);
    if (axis) svg.push(`<path class="bg-line halo" d="${axis}"/><path class="bg-line" d="${axis}"/>`);
    this.tag(lab, bg.labelAt, bg.meta.shortLabel || 'Baugrenze ±0,5 m', 'bound bg', '#6cb6ff', proj, 65, true);
  }

  // Maßstäblicher 2D-Hausgrundriss / Dachaufsicht in der 2D-Karte (in 3D trägt das echte 3D-Modell die Darstellung)
  drawHouse(svg, lab, proj, showSewer) {
    const H = this.house;
    if (!H || boxOutside(H.box, proj)) return;
    if (!proj.topDown) {
      // In 3D kein flaches SVG über das echte 3D-Haus legen – nur optional dezente Konfliktlinie am Kanal
      if (showSewer && H.conflictPoly) {
        project(H.conflictPoly, proj);
        const cf = polySub(H.conflictPoly.C, proj);
        if (cf) svg.push(`<path class="house-conflict" d="${cf}"/>`);
      }
      return;
    }

    project(H.footprint, proj);
    const fpFill = polySub(H.footprint.C, proj);
    const fpEdge = pathOf(H.footprint.C, true, proj);

    if (H.showRoof) {
      project(H.eaves, proj);
      project(H.ridge, proj);
      const roofFill = polySub(H.eaves.C, proj);
      const roofEdge = pathOf(H.eaves.C, true, proj);
      const ridgePath = pathOf(H.ridge.C, false, proj);
      if (roofFill) svg.push(`<path class="house-roof-fill" d="${roofFill}"/>`);
      if (fpEdge) svg.push(`<path class="house-footprint-dash" d="${fpEdge}"/>`);
      if (roofEdge) svg.push(`<path class="house-roof-edge" d="${roofEdge}"/>`);
      if (ridgePath) svg.push(`<path class="house-ridge" d="${ridgePath}"/>`);
    } else {
      if (fpFill) svg.push(`<path class="house-floor-fill" d="${fpFill}"/>`);
      let extD = '', intD = '';
      for (const w of H.walls) {
        project(w.g, proj);
        const p = polySub(w.g.C, proj);
        if (w.ext) extD += p; else intD += p;
      }
      if (extD) svg.push(`<path class="house-wall-ext" d="${extD}"/>`);
      if (intD) svg.push(`<path class="house-wall-int" d="${intD}"/>`);

      let winD = '', doorD = '';
      for (const o of H.openings) {
        project(o.g, proj);
        const p = pathOf(o.g.C, false, proj);
        if (o.kind === 'window') winD += p; else doorD += p;
      }
      if (winD) svg.push(`<path class="house-win" d="${winD}"/>`);
      if (doorD) svg.push(`<path class="house-door" d="${doorD}"/>`);

      let stairD = '';
      for (const st of H.stairSteps) {
        project(st, proj);
        stairD += pathOf(st.C, true, proj);
      }
      if (stairD) svg.push(`<path class="house-stair" d="${stairD}"/>`);
      if (H.stairOpening) {
        project(H.stairOpening, proj);
        const so = pathOf(H.stairOpening.C, true, proj);
        if (so) svg.push(`<path class="house-stair-open" d="${so}"/>`);
      }
      if (H.cutLine) {
        project(H.cutLine, proj);
        const cl = pathOf(H.cutLine.C, false, proj);
        if (cl) svg.push(`<path class="house-cut" d="${cl}"/>`);
      }
      if (fpEdge) svg.push(`<path class="house-footprint-edge" d="${fpEdge}"/>`);
      for (const rm of H.rooms) {
        this.tag(lab, rm.at, `${rm.name} · ${NF1.format(rm.areaM2)} m²`, 'bound house-room', '#f4efe6', proj, 28);
      }
    }

    // Außentreppen / Podeste (Hof/Kanal & Garten) in 2D sichtbar halten
    if (H.exteriorParts?.length) {
      let extStairD = '';
      for (const ep of H.exteriorParts) {
        project(ep, proj);
        extStairD += pathOf(ep.C, true, proj);
      }
      if (extStairD) svg.push(`<path class="house-stair" d="${extStairD}"/>`);
    }

    // DN250-Schutzstreifen-Überdeckung offen als Konfliktzone hervorheben
    if (showSewer && H.conflictPoly) {
      project(H.conflictPoly, proj);
      const cf = polySub(H.conflictPoly.C, proj);
      const ce = pathOf(H.conflictPoly.C, true, proj);
      if (cf) svg.push(`<path class="house-conflict" d="${cf}"/>`);
      if (ce) svg.push(`<path class="house-conflict-edge" d="${ce}"/>`);
      if (H.conflictLabel) this.tag(lab, H.conflictLabel.at, H.conflictLabel.text, 'bound conflict', '#ff8b8b', proj, 48);
    }

    // Eingangspfeil (Dautengasse)
    if (H.entrance) {
      project(H.entrance.g, proj);
      const r = clipSegment(H.entrance.g.C[0], H.entrance.g.C[1], proj);
      if (r) {
        const a = screenAt(H.entrance.g.C[0], H.entrance.g.C[1], r[0], proj);
        const b = screenAt(H.entrance.g.C[0], H.entrance.g.C[1], r[1], proj);
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const h1 = [b[0] - ux * 8 + uy * 5, b[1] - uy * 8 - ux * 5];
        const h2 = [b[0] - ux * 8 - uy * 5, b[1] - uy * 8 + ux * 5];
        svg.push(`<path class="house-entry" d="M${xy(a)}L${xy(b)}M${xy(h1)}L${xy(b)}L${xy(h2)}"/>`);
      }
      this.tag(lab, H.entrance.at, H.entrance.label || 'Eingang', 'bound house-dim', '#ffe0a3', proj, 42);
    }

    // Außenbemaßung 11,00 m × 7,15 m
    if (H.dims) {
      this.tag(lab, H.dims.lengthAt, H.dims.length, 'bound house-dim', '#f6d8ae', proj, 55);
      this.tag(lab, H.dims.widthAt, H.dims.width, 'bound house-dim', '#f6d8ae', proj, 55);
    }
  }

  drawBuildings(svg, lab, proj) {
    let fill = '', fillOwn = '', base = '', top = '', baseOwn = '', topOwn = '';
    for (const B of this.buildings) {
      const b = B.b;
      if (boxOutside(B.box, proj)) continue;
      project(B.lo, proj);
      const n = B.lo.pts.length;
      const bd = pathOf(B.lo.C, true, proj);
      let fd = '', td = '';
      if (proj.topDown) {
        fd = polySub(B.lo.C, proj);
      } else {
        project(B.hi, proj);
        td = pathOf(B.hi.C, true, proj);
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const s = clipSegment(B.lo.C[i], B.hi.C[i], proj);
          if (s) td += `M${xy(screenAt(B.lo.C[i], B.hi.C[i], s[0], proj))}L${xy(screenAt(B.lo.C[i], B.hi.C[i], s[1], proj))}`;
          fd += polySub([B.lo.C[i], B.lo.C[j], B.hi.C[j], B.hi.C[i]], proj);
        }
      }
      if (b.own) { fillOwn += fd; baseOwn += bd; topOwn += td; } else { fill += fd; base += bd; top += td; }
      if (b.name) this.tag(lab, proj.topDown ? b.center : [b.center[0], B.topY, b.center[2]], b.name, 'bound house', '#ffe3a0', proj, 90);
    }
    if (fill) svg.push(`<path class="bwall" d="${fill}"/>`);
    if (fillOwn) svg.push(`<path class="bwall own" d="${fillOwn}"/>`);
    if (top) svg.push(`<path class="building thin" d="${top}"/>`);
    if (base) svg.push(`<path class="building" d="${base}"/>`);
    if (topOwn) svg.push(`<path class="building thin own" d="${topOwn}"/>`);
    if (baseOwn) svg.push(`<path class="building own" d="${baseOwn}"/>`);
  }

  drawSewer(svg, lab, proj) {
    let fill = '', edge = '', axis = '', conn = '';
    for (const C of this.corr) {
      if (boxOutside(C.box, proj)) continue;
      for (const q of C.quads) { project(q, proj); fill += polySub(q.C, proj); }
      for (const e of C.edges) { project(e, proj); edge += pathOf(e.C, false, proj); }
    }
    for (const { p, g } of this.pipes) {
      if (boxOutside(g.box, proj)) continue;
      project(g, proj);
      axis += pathOf(g.C, false, proj);
      const mid = p.points[Math.floor(p.points.length / 2)];
      const depth = p.depth_from != null && p.depth_to != null
        ? ` · Sohle ${NF1.format(Math.min(p.depth_from, p.depth_to))}–${NF1.format(Math.max(p.depth_from, p.depth_to))} m tief` : '';
      this.tag(lab, mid, `${p.dn} · ${NF2.format(p.length)} m · ${NF1.format(p.slope_permille)} ‰${depth}`, 'bound sewer', '#7fd8ff', proj, 60);
    }
    for (const g of this.conns) { if (boxOutside(g.box, proj)) continue; project(g, proj); conn += pathOf(g.C, false, proj); }
    if (fill) svg.push(`<path class="corridor" d="${fill}"/>`);
    if (edge) svg.push(`<path class="corridor-edge" d="${edge}"/>`);
    if (conn) svg.push(`<path class="sewer conn" d="${conn}"/>`);
    if (axis) svg.push(`<path class="sewer halo" d="${axis}"/><path class="sewer" d="${axis}"/>`);
    for (const m of this.sewer.manholes) {
      const c = proj.toClip(m.at, this.c);
      if (!inside(c, proj, 80)) continue;
      const s = toScreen(c, proj);
      svg.push(`<circle class="manhole" cx="${f1(s[0])}" cy="${f1(s[1])}" r="6"/>`);
      const depth = m.depth != null ? ` · ${NF2.format(m.depth)} m tief` : '';
      const text = proj.labelDist(m.at) < 45 ? `Schacht ${m.name}${depth}${m.note ? ` · ${m.note}` : ''}` : m.name;
      this.label(lab, s, text, 'bound sewer', '#7fd8ff', true);
    }
  }

  drawItem(it, k, selected, svg, lab, proj) {
    const color = COLORS[it.type];
    if (!color) throw new Error(`Overlay: unbekannter Messtyp "${it.type}"`);
    const hover = it.draft && it.hover ? it.hover : null;
    const all = hover ? [...it.points, hover] : it.points;
    if (!all.length) return;
    const V = all.map((p) => proj.toClip(p, new Float64Array(4)));
    const cls = `m ${it.draft ? 'draft' : ''} ${selected ? 'sel' : ''}`;

    const line = (a, b, dash = false) => {
      const r = clipSegment(a, b, proj);
      if (!r) return null;
      const p = screenAt(a, b, r[0], proj), q = screenAt(a, b, r[1], proj);
      const d = `x1="${f1(p[0])}" y1="${f1(p[1])}" x2="${f1(q[0])}" y2="${f1(q[1])}"`;
      svg.push(`<line class="${cls} halo" ${d}/>`);
      svg.push(`<line class="${cls}" ${d} stroke="${color}"${dash ? ' stroke-dasharray="6 5"' : ''}/>`);
      return { mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], px: Math.hypot(q[0] - p[0], q[1] - p[1]) };
    };
    const label = (pos, text, kind = '') => {
      if (pos) this.label(lab, pos, text, `${kind} ${it.draft ? 'draft' : ''}`, color);
    };

    if (it.type === 'dist' || it.type === 'calib') {
      for (let i = 1; i < V.length; i++) {
        const s = line(V[i - 1], V[i], it.draft && hover && i === V.length - 1);
        if (s) label(s.mid, fmtLen(dist(all[i - 1], all[i]) * k), 'main');
      }
    } else if (it.type === 'height' && V.length >= 2) {
      const a = all[0], b = all[1];
      const dh = (b[1] - a[1]) * k;
      const est = !it.draft && it.src && evaluate(it, k).estimated;
      const main = `${dh >= 0 ? '↑' : '↓'} ${fmtLen(Math.abs(dh))}${est ? ' (geschätzt)' : ''}`;
      if (proj.topDown) {
        const s = line(V[0], V[1], true);
        if (s) label(s.mid, main, 'main');
      } else {
        const H = proj.toClip([b[0], a[1], b[2]], new Float64Array(4));
        line(V[0], V[1], true);
        const sh = line(V[0], H);
        const sv = line(H, V[1]);
        const horiz = Math.hypot(b[0] - a[0], b[2] - a[2]) * k;
        if (sv) label(sv.mid, main, 'main');
        if (sh && sh.px > 46) label(sh.mid, fmtLen(horiz), 'seg');
      }
    } else if (it.type === 'area') {
      const n = V.length;
      if (n >= 3) {
        const s = clipPolygon(V, proj);
        if (s) svg.push(`<polygon class="${cls} fill" points="${s.map(xy).join(' ')}" fill="${color}"/>`);
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (j === 0 && n < 3) break;
        const closing = j === 0 && it.draft;
        const s = line(V[i], V[j], closing || (it.draft && hover && j === n - 1));
        if (s && s.px > 46 && !closing) label(s.mid, fmtLen(dist(all[i], all[j]) * k), 'seg');
      }
      if (n >= 3) {
        const e = evaluate({ type: 'area', points: all, closed: true }, k);
        const cw = [0, 0, 0];
        for (const p of all) { cw[0] += p[0] / n; cw[1] += p[1] / n; cw[2] += p[2] / n; }
        const c = proj.toClip(cw, this.c);
        if (inside(c, proj, 0)) label(toScreen(c, proj), e.primary, 'main');
      }
    }

    V.forEach((c, i) => {
      if (!inside(c, proj, 12)) return;
      const [x, y] = toScreen(c, proj);
      const isHover = hover && i === V.length - 1;
      if (isHover && it.hoverSnap) svg.push(`<circle class="snap" cx="${f1(x)}" cy="${f1(y)}" r="9"/>`);
      svg.push(`<circle class="${cls} dot ${isHover ? 'hover' : ''}" cx="${f1(x)}" cy="${f1(y)}" r="${isHover ? 4 : 5}" fill="${color}"/>`);
    });
  }
}

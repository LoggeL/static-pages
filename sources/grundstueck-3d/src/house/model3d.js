import * as T from 'three';
import { accessGeometry } from './access.js';
// Geometry is defined in the plan coordinates: u along the long wall, v towards the courtyard.
export function createHouse3D(s, opts = {}) {
  const { length: L, width: W, wallExt: outer } = s.footprint;
  const h = s.heights,
    roof = s.roof,
    ground = opts.terrainAtDoors || {},
    layers = {},
    root = new T.Group();
  root.name = 'Wohnhaus 214';
  const group = (name, parent = root) => {
    const g = new T.Group();
    g.name = name;
    parent.add(g);
    return g;
  };
  for (const id of [
    'sockel',
    'eg',
    'og',
    'dach',
    'deckeOg',
    'deckeEg',
    'treppe',
    'water',
    'power',
  ])
    layers[id] = group(id);
  const paint = (name, hex, roughness = 1, extra = {}) =>
    new T.MeshStandardMaterial({ name, color: hex, roughness, ...extra });
  const m = {
    putz: paint('Kalkputz warmweiß', 0xeee9da),
    in: paint('Innenputz', 0xf6f2e6),
    base: paint('Sockel mineralisch', 0x918b7c),
    rim: paint('Werkstein', 0xc7baa4),
    wood: paint('Eiche', 0xba8b59, 0.82),
    door: paint('Haustür Eiche', 0x92704f),
    frame: paint('Fensterrahmen', 0x494d45, 0.58),
    glass: paint('Fensterglas', 0xa9d5e0, 0.22, {
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: T.DoubleSide,
    }),
    light: paint('Keramik', 0xe9eae0, 0.39),
    tile: paint('Bodenfliese', 0xb5b7ad),
    floor: paint('Dielen', 0xcfb594),
    red: paint('Unglasierter Tonziegel', 0xa85138),
    ridge: paint('Firstziegel', 0x904632),
    metal: paint('Rinne und Geländer', 0x646964, 0.51, { metalness: 0.45 }),
    cush: paint('Polsterstoff salbei', 0x909b87),
    panel: paint('Küchenfront', 0xc7bea6),
    dark: paint('Kochfeld', 0x424743, 0.4),
    blue: paint('Becken', 0xdde4dd, 0.4),
    waterPipe: paint('Trinkwasserleitung', 0x0b7ab8, 0.35, { metalness: 0.22 }),
    waterBox: paint('Wasserzähler', 0x065585, 0.42, { metalness: 0.28 }),
    powerPipe: paint('Elektroleitung', 0xd96b1f, 0.38, { metalness: 0.18 }),
    powerBox: paint('Elektroverteilung', 0x9c430e, 0.44, { metalness: 0.22 }),
    serviceAccent: paint('Anschlussarmatur', 0xdce4ea, 0.3, { metalness: 0.6 }),
  };
  const cube = new T.BoxGeometry(1, 1, 1),
    jointSphere = new T.SphereGeometry(1, 10, 8),
    resources = new Set([cube, jointSphere]);
  const xyz = (u, y, v) => new T.Vector3(u - L / 2, y, v - W / 2);
  function mesh(parent, name, geo, mat) {
    const o = new T.Mesh(geo, mat);
    o.name = name;
    parent.add(o);
    return o;
  }
  function box(p, id, u0, v0, u1, v1, y0, y1, mat) {
    if (u1 - u0 < 0.001 || v1 - v0 < 0.001 || y1 - y0 < 0.001) return;
    const o = mesh(p, id, cube, mat);
    o.position.copy(xyz((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2));
    o.scale.set(u1 - u0, y1 - y0, v1 - v0);
    return o;
  }
  function segment(p, id, a, b, diam, mat) {
    const va = xyz(...a),
      vb = xyz(...b),
      axis = vb.clone().sub(va);
    const geo = new T.CylinderGeometry(diam / 2, diam / 2, axis.length(), 8);
    resources.add(geo);
    const o = mesh(p, id, geo, mat);
    o.position.copy(va).lerp(vb, 0.5);
    o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize());
    return o;
  }
  function polygonStep(p, id, poly, low, high, mat) {
    const shape = new T.Shape(
      poly.map(([u, v]) => new T.Vector2(u - L / 2, -(v - W / 2)))
    );
    const g = new T.ExtrudeGeometry(shape, {
      depth: high - low,
      bevelEnabled: false,
    });
    g.rotateX(-Math.PI / 2);
    resources.add(g);
    const o = mesh(p, id, g, mat);
    o.position.y = low;
    return o;
  }
  function slab(p, id, low, high, opening, mat) {
    if (!opening) return box(p, id, 0, 0, L, W, low, high, mat);
    const { u0, v0, u1, v1 } = opening;
    for (const [a, b, c, d] of [
      [0, 0, u0, W],
      [u1, 0, L, W],
      [u0, 0, u1, v0],
      [u0, v1, u1, W],
    ])
      box(p, id, a, b, c, d, low, high, mat);
  }
  const access =
    opts.access ??
    accessGeometry(s, { doors: ground, groundAtPlan: opts.groundAtPlan });
  const entryGap = { ...access.foyer.opening, u0: 0 };
  slab(
    layers.sockel,
    'Hangsockel',
    -Math.abs(opts.plinthDepth ?? 2),
    -h.floorSlabEg,
    entryGap,
    m.base
  );
  slab(layers.eg, 'Fußboden Erdgeschoss', -h.floorSlabEg, 0, entryGap, m.floor);
  slab(
    layers.deckeEg,
    'Geschossdecke mit Treppenloch',
    h.egClear,
    h.okffOg,
    s.stairs.slabOpening,
    m.floor
  );
  slab(
    layers.deckeOg,
    'Decke über OG',
    h.okffOg + h.ogClear,
    h.eaveWallY,
    null,
    m.rim
  );
  for (const key of ['eg', 'og']) {
    const l = s.levels[key],
      base = l.yFloor,
      top = l.yCeiling,
      parent = layers[key];
    for (const w of l.walls) {
      const aw = w.axis === 'u',
        wg = group(w.id, parent);
      wg.userData.frontCut = w.side === 'south' || w.side === 'east';
      const start = aw ? w.u0 : w.v0,
        end = aw ? w.u1 : w.v1,
        cross0 = aw ? w.v0 : w.u0,
        cross1 = aw ? w.v1 : w.u1;
      const pr = (id, a, b, y0, y1, mat, ca = cross0, cb = cross1) =>
        aw
          ? box(wg, id, a, ca, b, cb, y0, y1, mat)
          : box(wg, id, ca, a, cb, b, y0, y1, mat);
      const items = l.openings
        .filter((o) => o.wallId === w.id)
        .sort((a, b) => a.s0 - b.s0);
      let cur = start;
      for (const o of [...items, null]) {
        const a = o?.s0 ?? end;
        pr('Wand', cur, a, base, top, w.ext ? m.putz : m.in);
        if (!o) break;
        const b = o.s1,
          low = base + o.sillY,
          head = low + o.height;
        pr('Brüstung', a, b, base, low, w.ext ? m.putz : m.in);
        pr('Sturz', a, b, head, top, w.ext ? m.putz : m.in);
        cur = b;
        if (o.kind === 'portal') continue;
        const mid = (cross0 + cross1) / 2;
        const wdw = o.kind === 'window',
          glazed = wdw || o.glazed;
        const frame = wdw ? m.frame : m.door;
        const inlay = (id, aa, bb, lo, hi, material, half = 0.038) =>
          pr(id, aa, bb, lo, hi, material, mid - half, mid + half);
        inlay(o.id + ' Rahmen', a, a + 0.056, low, head, frame);
        inlay('Rahmen', b - 0.056, b, low, head, frame);
        inlay('Oberrahmen', a + 0.056, b - 0.056, head - 0.06, head, frame);
        if (glazed) {
          inlay('Unterrahmen', a + 0.056, b - 0.056, low, low + 0.06, frame);
          inlay(
            o.label,
            a + 0.057,
            b - 0.057,
            low + 0.06,
            head - 0.06,
            m.glass,
            0.008
          );
          inlay(
            'Fenstersprosse',
            (a + b) / 2 - 0.016,
            (a + b) / 2 + 0.016,
            low + 0.05,
            head - 0.06,
            frame,
            0.026
          );
          if (wdw)
            pr(
              'Fenstergesims',
              a - 0.045,
              b + 0.045,
              low - 0.055,
              low,
              m.rim,
              cross0 - 0.055,
              cross1 + 0.055
            );
        } else
          inlay(
            o.label,
            a + 0.055,
            b - 0.055,
            low + 0.01,
            head - 0.06,
            m.door,
            0.024
          );
      }
    }
    for (const f of l.furniture) {
      const { u0: a, v0: b, u1: c, v1: d } = f,
        height = f.h,
        cr = group(f.label || f.id, parent),
        part = (id, a1, b1, c1, d1, y, z, mat) =>
          box(cr, id, a1, b1, c1, d1, base + y, base + z, mat);
      if (f.kind === 'bed-desk') {
        part('Bettgestell', a, b, c, d, 0.1, 0.33, m.wood);
        part(
          'Matratze',
          a + 0.03,
          b + 0.025,
          c - 0.03,
          d - 0.025,
          0.33,
          0.49,
          m.light
        );
        part(
          'Kissen',
          a + 0.08,
          b + 0.09,
          a + 0.45,
          d - 0.09,
          0.49,
          0.61,
          m.cush
        );
        part(
          'Decke',
          a + 0.65,
          b + 0.025,
          c - 0.03,
          d - 0.025,
          0.49,
          0.54,
          m.cush
        );
      } else if (f.kind === 'table') {
        part('Platte', a, b, c, d, height - 0.075, height, m.wood);
        for (const x of [a + 0.06, c - 0.12])
          for (const v of [b + 0.05, d - 0.1])
            part('Bein', x, v, x + 0.06, v + 0.06, 0, height - 0.075, m.wood);
        if (f.id === 'eg_table') {
          for (const u of [a + 0.52, c - 0.52])
            for (const v of [b - 0.27, d + 0.27]) {
              part(
                'Stuhlsitz',
                u - 0.2,
                v - 0.19,
                u + 0.2,
                v + 0.19,
                0.42,
                0.47,
                m.wood
              );
              const back = v < b ? v - 0.19 : v + 0.16;
              part(
                'Rückenlehne',
                u - 0.2,
                back,
                u + 0.2,
                back + 0.03,
                0.44,
                0.82,
                m.wood
              );
              for (const x of [u - 0.17, u + 0.14])
                for (const z of [v - 0.16, v + 0.13])
                  part(
                    'Stuhlbein',
                    x,
                    z,
                    x + 0.035,
                    z + 0.035,
                    0,
                    0.43,
                    m.wood
                  );
            }
        }
      } else if (f.kind === 'sofa') {
        part('Sitz', a, b, c, d, 0.05, 0.46, m.cush);
        const back = f.back || (c - a > d - b ? 'bottom' : 'left');
        if (back === 'bottom')
          part('Rücken', a, d - 0.19, c, d, 0.45, height, m.cush);
        else if (back === 'top')
          part('Rücken', a, b, c, b + 0.19, 0.45, height, m.cush);
        else if (back === 'right')
          part('Rücken', c - 0.19, b, c, d, 0.45, height, m.cush);
        else part('Rücken', a, b, a + 0.19, d, 0.45, height, m.cush);
      } else if (f.kind === 'shower') {
        part('Brausetasse', a, b, c, d, 0, 0.09, m.light);
        part('Duschglas', a, b, a + 0.018, d, 0.09, height, m.glass);
        part(
          'Duschwand',
          a,
          d - 0.018,
          a + (c - a) * 0.58,
          d,
          0.09,
          height,
          m.glass
        );
      } else if (f.kind === 'wc' || f.kind === 'sink') {
        const geo = new T.SphereGeometry(1, 16, 10);
        resources.add(geo);
        const o = mesh(cr, f.label, geo, m.light);
        o.position.copy(xyz((a + c) / 2, base + height * 0.8, (b + d) / 2));
        o.scale.set((c - a) * 0.46, height * 0.18, (d - b) * 0.46);
        part(
          'Unterbau',
          a + 0.04,
          b + 0.04,
          c - 0.04,
          d - 0.04,
          0.03,
          height * 0.7,
          m.blue
        );
      } else {
        part(
          f.label,
          a,
          b,
          c,
          d,
          0.025,
          height,
          f.kind === 'shelf' ? m.wood : m.panel
        );
        if (f.id === 'og_k_ofen')
          part(
            'Einbaubackofen',
            c - 0.015,
            b + 0.04,
            c + 0.015,
            d - 0.04,
            0.66,
            1.29,
            m.dark
          );
        if (f.id === 'og_k_kuehl')
          part(
            'Kühlschrankgriff',
            c,
            b + 0.1,
            c + 0.04,
            b + 0.13,
            0.74,
            1.49,
            m.metal
          );
        if (f.kind === 'appliance') {
          for (const u of [a + 0.31, c - 0.31]) {
            const drum = mesh(
              cr,
              'Bullauge',
              new T.CylinderGeometry(0.205, 0.205, 0.02, 24),
              m.frame
            );
            resources.add(drum.geometry);
            drum.rotation.x = Math.PI / 2;
            drum.position.copy(xyz(u, base + 0.45, d + 0.01));
          }
        }
        if (f.kind.startsWith('kitchen')) {
          part('Arbeitsfläche', a, b, c, d, height, height + 0.035, m.rim);
          if (f.kind === 'kitchen-hob' || f.kind === 'kitchen-sink')
            part(
              f.label,
              a + 0.09,
              b + 2 * roof.ridgeCapRadius,
              c - 0.09,
              d - 2 * roof.ridgeCapRadius,
              height + 0.035,
              height + 0.05,
              f.kind === 'kitchen-hob' ? m.dark : m.metal
            );
        }
      }
    }
  }
  function putPart(parent, name, part, mat) {
    return box(
      parent,
      name,
      part.u0,
      part.v0,
      part.u1,
      part.v1,
      part.yBottom,
      part.yTop,
      mat
    );
  }
  const egAccess = group('Zugänge und Außentreppen', layers.eg),
    main = s.entrance.main,
    side = s.entrance.side;
  const throat = main.plinthCutout;
  for (const [v0, v1] of [
    [entryGap.v0, throat.v0],
    [throat.v1, entryGap.v1],
  ])
    box(
      egAccess,
      'Sockelanschluss Haustür',
      0,
      v0,
      throat.u1,
      v1,
      -Math.abs(opts.plinthDepth ?? 2),
      0,
      m.base
    );
  putPart(egAccess, 'Türschwelle Straße', main.thresholdStep, m.rim);
  putPart(egAccess, 'Eingangspodest unten', main.landing, m.rim);
  for (const part of main.enclosingWalls)
    putPart(egAccess, 'Sockelwand Treppenraum', part, m.base);
  for (const step of main.stair.steps)
    putPart(egAccess, 'Innere Eingangsstufe ' + step.index, step, m.wood);
  putPart(egAccess, 'Hofpodest oben', side.landing, m.rim);
  for (const step of side.stair.steps)
    putPart(egAccess, 'Hofstufe ' + step.index, step, m.rim);
  putPart(egAccess, 'Hofpodest unten', side.stair.bottomPad, m.rim);
  putPart(egAccess, 'Gartenstufe', s.entrance.garden.steps[0], m.rim);
  for (const rail of [...main.railingSegments, ...side.railingSegments]) {
    const { u0, v0, y0, u1, v1, y1, heightM } = rail,
      top0 = [u0, y0 + heightM, v0],
      top1 = [u1, y1 + heightM, v1];
    segment(egAccess, 'Handlauf ' + rail.id, top0, top1, 0.046, m.metal);
    const count = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.13));
    for (let i = 0; i <= count; i++) {
      const t = i / count,
        u = u0 + (u1 - u0) * t,
        v = v0 + (v1 - v0) * t,
        y = y0 + (y1 - y0) * t;
      segment(
        egAccess,
        'Geländerfüllung',
        [u, y, v],
        [u, y + heightM, v],
        0.018,
        m.metal
      );
    }
  }
  for (const u of [
    side.landing.u0 + 2 * roof.ridgeCapRadius,
    side.landing.u1 - 0.12,
  ])
    segment(
      egAccess,
      'Podeststütze Hof',
      [
        u,
        -(ground.side?.drop_m ?? 1.27) - 2 * roof.ridgeCapRadius,
        side.landing.v1 - 0.1,
      ],
      [u, side.landing.yBottom, side.landing.v1 - 0.1],
      0.08,
      m.metal
    );
  for (const step of s.stairs.steps)
    polygonStep(
      layers.treppe,
      'Treppenstufe ' + step.index,
      step.poly,
      Math.max(0, step.yTop - 0.135),
      step.yTop,
      m.wood
    );
  for (const rail of s.stairs.railingSegments) {
    const a = [rail.u0, h.okffOg + s.stairs.railingHeightM, rail.v0],
      b = [rail.u1, a[1], rail.v1];
    segment(layers.og, 'Handlauf', a, b, 0.055, m.wood);
    const count = Math.ceil(
      Math.hypot(rail.u1 - rail.u0, rail.v1 - rail.v0) / 0.13
    );
    for (let i = 0; i <= count; i++) {
      const t = i / count,
        x = rail.u0 + (rail.u1 - rail.u0) * t,
        v = rail.v0 + (rail.v1 - rail.v0) * t;
      segment(layers.og, 'Stab', [x, h.okffOg, v], [x, a[1], v], 0.02, m.metal);
    }
  }
  // The handrail follows the inside of both straight flights and the turning steps.
  const turn = s.stairs.spindle,
    innerRail = [];
  s.stairs.steps.forEach((step) => {
    const center = step.poly.reduce(
      (acc, p) => [
        acc[0] + p[0] / step.poly.length,
        acc[1] + p[1] / step.poly.length,
      ],
      [0, 0]
    );
    let u,
      v = center[1];
    if (step.flight === 'right') u = turn.u1 + 0.055;
    else if (step.flight === 'left') u = turn.u0 - 0.055;
    else {
      const du = center[0] - turn.pivot[0],
        dv = center[1] - turn.pivot[1],
        len = Math.hypot(du, dv) || 1;
      u = turn.pivot[0] + (du * 0.16) / len;
      v = turn.pivot[1] + (dv * 0.16) / len;
    }
    const top = [u, step.yTop + 0.93, v];
    innerRail.push(top);
    if (step.index % 2 === 1)
      segment(
        layers.treppe,
        'Geländerstab Geschosstreppe',
        [u, step.yTop, v],
        top,
        0.026,
        m.metal
      );
  });
  for (let i = 1; i < innerRail.length; i++)
    segment(
      layers.treppe,
      'Handlauf Geschosstreppe',
      innerRail[i - 1],
      innerRail[i],
      0.048,
      m.wood
    );
  const e = h.eaveWallY,
    mid = W / 2,
    rise = roof.pitchRad,
    above = (v) => h.ridgeWallY - Math.abs(v - mid) * Math.tan(rise);
  for (const [u, side] of [
    [0, 'south'],
    [L - outer, 'north'],
  ]) {
    const hole = roof.gableOpenings.find((o) => o.side === side),
      poly = new T.Shape([
        new T.Vector2(0, e),
        new T.Vector2(W, e),
        new T.Vector2(mid, h.ridgeWallY),
      ]);
    if (hole) {
      const y = hole.absSillY,
        a = hole.s0,
        b = hole.s1,
        z = y + hole.height;
      poly.holes.push(
        new T.Path([
          new T.Vector2(a, y),
          new T.Vector2(a, z),
          new T.Vector2(b, z),
          new T.Vector2(b, y),
        ])
      );
      box(
        layers.dach,
        'Giebelfenster',
        u + 0.15,
        a,
        u + 0.18,
        b,
        y,
        z,
        m.glass
      );
      for (const v of [a, b - 0.055])
        box(
          layers.dach,
          'Giebelrahmen',
          u + 0.13,
          v,
          u + 0.2,
          v + 0.055,
          y,
          z,
          m.frame
        );
      for (const k of [y, z - 0.055])
        box(
          layers.dach,
          'Giebelrahmen',
          u + 0.13,
          a,
          u + 0.2,
          b,
          k,
          k + 0.055,
          m.frame
        );
    }
    const g = new T.ExtrudeGeometry(poly, {
      depth: outer,
      bevelEnabled: false,
    });
    const attr = g.attributes.position;
    for (let i = 0; i < attr.count; i++) {
      const v = attr.getX(i),
        y = attr.getY(i),
        dep = attr.getZ(i);
      attr.setXYZ(i, u + outer - dep - L / 2, y, v - W / 2);
    }
    g.computeVertexNormals();
    resources.add(g);
    mesh(layers.dach, 'Putzgiebel', g, m.putz);
  }
  const slopes = [
    [-roof.overhangWest, mid, -1],
    [mid, W + roof.overhangEast, 1],
  ];
  function roofPrism(u0, u1, v0, v1, yA, yB, tall) {
    const shape = new T.Shape([
      new T.Vector2(v0 - W / 2, yA),
      new T.Vector2(v1 - W / 2, yB),
      new T.Vector2(v1 - W / 2, yB + tall),
      new T.Vector2(v0 - W / 2, yA + tall),
    ]);
    const g = new T.ExtrudeGeometry(shape, {
      depth: u1 - u0,
      bevelEnabled: false,
    });
    g.rotateY(-Math.PI / 2);
    g.translate(u1 - L / 2, 0, 0);
    resources.add(g);
    return g;
  }
  for (const [a, b, sign] of slopes) {
    const shell = h.ridgeTopY - h.ridgeWallY;
    const geo = roofPrism(0, L, a, b, above(a), above(b), shell);
    mesh(layers.dach, 'Dachfläche', geo, m.red);
    const nU = Math.ceil(L / 0.265),
      nV = Math.ceil((b - a) / (0.34 * Math.cos(rise))),
      cellU = L / nU,
      cellV = (b - a) / nV;
    const tileGeo = roofPrism(
      L / 2 - cellU * 0.492,
      L / 2 + cellU * 0.492,
      W / 2 - cellV * 0.49,
      W / 2 + cellV * 0.49,
      sign * cellV * 0.49 * Math.tan(rise),
      -sign * cellV * 0.49 * Math.tan(rise),
      0.026
    );
    const tiles = new T.InstancedMesh(tileGeo, m.red, nU * nV);
    tiles.name = 'Unglasierte Tonziegel';
    const xf = new T.Object3D();
    for (let i = 0; i < nU; i++)
      for (let j = 0; j < nV; j++) {
        const u = (i + 0.5) * cellU,
          v = a + (j + 0.5) * cellV;
        xf.position.copy(xyz(u, above(v) + shell + 0.006, v));
        xf.updateMatrix();
        tiles.setMatrixAt(i * nV + j, xf.matrix);
        const style = new T.Color(1, 1, 1).multiplyScalar(
          0.8 + ((i * 37 + j * 19) % 23) / 100
        );
        tiles.setColorAt(i * nV + j, style);
      }
    layers.dach.add(tiles);
  }
  segment(
    layers.dach,
    'Firstziegel',
    [0.03, h.ridgeTopY + roof.ridgeCapLift, mid],
    [L - 0.03, h.ridgeTopY + roof.ridgeCapLift, mid],
    2 * roof.ridgeCapRadius,
    m.ridge
  );
  segment(
    layers.dach,
    'Hofrinne',
    [0.08, h.eaveEastTopY - 0.04, W + roof.overhangEast + 0.035],
    [L - 0.08, h.eaveEastTopY - 0.04, W + roof.overhangEast + 0.035],
    0.115,
    m.metal
  );
  const drainU = L - 0.28,
    drainV = W + 0.075,
    gutterV = W + roof.overhangEast + 0.035;
  segment(
    layers.dach,
    'Ablaufknie',
    [drainU, h.eaveEastTopY - 0.05, gutterV],
    [drainU, h.eaveEastTopY - 0.46, drainV],
    0.095,
    m.metal
  );
  segment(
    layers.dach,
    'Fallrohr',
    [drainU, h.eaveEastTopY - 0.46, drainV],
    [drainU, -0.22, drainV],
    0.09,
    m.metal
  );
  box(
    layers.dach,
    'Innenliegende Rinne an der Grenzwand',
    0.01,
    0.016,
    L - 0.01,
    0.14,
    h.eaveWestTopY - 0.008,
    h.eaveWestTopY + 0.031,
    m.metal
  );
  // 3D Trinkwasser- & Stromleitungen (steuerbar via setServices({ water, power }))
  const serviceRadii = {
    water: { supply: 0.024, riser: 0.022, junction: 0.017, outlet: 0.014, default: 0.016 },
    power: { supply: 0.020, riser: 0.019, junction: 0.014, outlet: 0.011, default: 0.013 },
  };
  const tagService = (obj, service, level, extra = {}) => {
    if (!obj) return obj;
    obj.userData = { ...obj.userData, service, level, frontCut: false, ...extra };
    return obj;
  };
  if (opts.services?.routes?.length) {
    for (const r of opts.services.routes) {
      const sys = r.system;
      const parent = layers[sys];
      if (!parent || !Array.isArray(r.points) || r.points.length < 2) continue;
      const level = r.level || 'eg';
      const pipeMat = sys === 'water' ? m.waterPipe : m.powerPipe;
      const rad = serviceRadii[sys]?.[r.mark] ?? serviceRadii[sys]?.default ?? 0.015;
      const rg = tagService(group(r.id, parent), sys, level, { routeId: r.id, mark: r.mark || '' });
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = r.points[i], b = r.points[i + 1];
        if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < 1e-4) continue;
        const seg = segment(rg, `${r.id}_${i}`, [a[0], a[2], a[1]], [b[0], b[2], b[1]], rad * 2, pipeMat);
        tagService(seg, sys, level, { routeId: r.id });
      }
      for (let i = 0; i < r.points.length; i++) {
        const p = r.points[i];
        const isEnd = i === r.points.length - 1;
        const isStart = i === 0;
        const accent = (isEnd && r.mark === 'outlet') || (isStart && r.level === 'site');
        const joint = mesh(rg, `${r.id}_j${i}`, jointSphere, accent ? m.serviceAccent : pipeMat);
        joint.position.copy(xyz(p[0], p[2], p[1]));
        joint.scale.setScalar(rad * (accent ? 1.55 : 1.15));
        tagService(joint, sys, level, { routeId: r.id });
      }
    }
  }
  if (opts.services?.stations?.length) {
    for (const st of opts.services.stations) {
      const sys = st.system;
      const parent = layers[sys];
      if (!parent || !Array.isArray(st.point)) continue;
      const level = st.level || 'eg';
      const [su, sv, sz] = st.point;
      const sg = tagService(group(`Station_${st.id}`, parent), sys, level, { stationId: st.id });
      const mat = sys === 'water' ? m.waterBox : m.powerBox;
      const du = sys === 'water' ? 0.14 : 0.15;
      const dv = sys === 'water' ? 0.22 : 0.22;
      const dz = sys === 'water' ? 0.24 : 0.56;
      const u0 = Math.max(outer + 0.005, su - du / 2);
      const u1 = u0 + du;
      tagService(
        box(sg, `${st.id} Gehäuse`, u0, sv - dv / 2, u1, sv + dv / 2, sz - dz / 2, sz + dz / 2, mat),
        sys,
        level,
        { stationId: st.id }
      );
      tagService(
        box(
          sg,
          `${st.id} Armatur`,
          u1,
          sv - dv * 0.34,
          u1 + 0.018,
          sv + dv * 0.34,
          sz - dz * 0.34,
          sz + dz * 0.34,
          m.serviceAccent
        ),
        sys,
        level,
        { stationId: st.id }
      );
    }
  }

  let currentMode = 'full';
  let currentServices = { water: false, power: false };

  function applyServicesVisibility() {
    for (const sys of ['water', 'power']) {
      const layer = layers[sys];
      const active = !!currentServices[sys];
      layer.visible = active;
      if (!active) continue;
      layer.children.forEach((child) => {
        const lvl = child.userData.level || 'eg';
        child.visible = currentMode !== 'eg' || lvl === 'eg' || lvl === 'site';
      });
    }
  }

  function mode(which) {
    currentMode = which;
    layers.sockel.visible = true;
    layers.eg.visible = true;
    layers.og.visible = which !== 'eg';
    layers.deckeEg.visible = which !== 'eg';
    layers.deckeOg.visible = which === 'full' || which === 'roof';
    layers.dach.visible = layers.deckeOg.visible;
    [layers.eg, layers.og].forEach((g) =>
      g.children.forEach(
        (o) => (o.visible = !(which === 'cutaway' && o.userData.frontCut))
      )
    );
    applyServicesVisibility();
  }

  function setServices(next = {}) {
    currentServices = { water: !!next.water, power: !!next.power };
    applyServicesVisibility();
  }

  mode('full');
  return {
    group: root,
    layers,
    setMode: mode,
    setServices,
    setCutaway: (on) => mode(on ? 'cutaway' : 'full'),
    getBounds: () => new T.Box3().setFromObject(root),
    dispose() {
      resources.forEach((x) => x.dispose());
      Object.values(m).forEach((x) => x.dispose());
      root.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
      });
    },
  };
}

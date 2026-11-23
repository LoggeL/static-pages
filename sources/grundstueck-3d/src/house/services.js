// Proposed services in the house plan frame (u, v, height above ground-floor FFL).
// Heights serve the 3D schematic only. The plan contains no surveyed water/power mains or service points.
// Street connections terminate strictly at the digitised Flurstück 214 boundary (no lines invented in public space).
export const systems = {
  water: { title: 'Trinkwasser', ink: '#006da0', bright: '#45cbff', dash: '.16 .07', screenDash: '7 3' },
  power: { title: 'Strom', ink: '#a8440d', bright: '#ffae65', dash: '.24 .06 .045 .06', screenDash: '10 3 2 3' },
};

function streetEdge(parcel, v) {
  const hits = [];
  for (let i = 0; i < parcel.length; i++) {
    const [a, b] = [parcel[i], parcel[(i + 1) % parcel.length]];
    if ((a[1] <= v && b[1] > v) || (b[1] <= v && a[1] > v))
      hits.push(a[0] + (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]));
  }
  if (!hits.length) throw new Error('Straßengrenze im Hauskoordinatensystem fehlt');
  return Math.min(...hits);
}
const mid = (f) => [(f.u0 + f.u1) / 2, (f.v0 + f.v1) / 2];
const round = (x) => Math.round(x * 1000) / 1000;

export function designServices(spec, parcel) {
  const routes = [];
  const add = (id, system, level, label, points, mark = 'outlet') => {
    const clean = points.map(p => p.map(round)).filter((p, i, a) => !i || p.some((n, k) => n !== a[i - 1][k]));
    if (clean.length < 2) throw new Error('Leere Trasse ' + id);
    routes.push({ id, system, level, label, points: clean, mark });
  };

  const rooms = spec.levels;
  const floor = rooms.og.yFloor;
  const fixtures = new Map([...rooms.eg.furniture, ...rooms.og.furniture].map(f => [f.id, f]));
  const wallMid = (lvl, id, axis, fallback) => {
    const w = rooms[lvl]?.walls?.find(x => x.id === id);
    return w ? round((w[axis + '0'] + w[axis + '1']) / 2) : fallback;
  };

  // House connections enter HWR on solid street-wall piers clear of window F_eg_s1 (v = 1.35..2.20),
  // clear of eg_wm (v <= 1.05) and eg_regal (v >= 2.46), and >6 m away from the DN 250 sewer (v ≈ 8.4).
  // Burial depths (-1.80 m / -1.85 m below OKFF EG) give frost-free water cover under the real DEM
  // while remaining above plinth bottom (~-1.95..-2.20 m).
  const water = { x: .48, v: 1.20, z: .62, entryZ: -1.80 };
  const power = { x: .48, v: 2.33, z: 1.35, entryZ: -1.85 };
  const supply = (key, p, title) => {
    const u = streetEdge(parcel, p.v);
    add(key + '-anschluss', key, 'site', title, [[u, p.v, p.entryZ], [p.x, p.v, p.entryZ], [p.x, p.v, p.z]], 'supply');
  };
  supply('water', water, 'Straßengrenze (offener Übergabepunkt) zum Wasserzähler im HWR');
  supply('power', power, 'Straßengrenze (offener Übergabepunkt) zur Elektroverteilung im HWR');

  const stations = [
    ['W', 'water', 'Wasserzähler / Trinkwasserverteilung (HWR)', [water.x, water.v, water.z]],
    ['E', 'power', 'Elektroverteilung / Zählerschrank (HWR)', [power.x, power.v, power.z]],
  ].map(([id, system, label, point]) => ({ id, system, label, point, level: 'eg' }));

  // Stacked solid interior-wall axes verified open-free in both EG and OG:
  // - wetPartV: partition HWR/Bad <-> WC (v = 2.94..3.055, solid in EG & OG for u <= 2.28)
  // - instWallU: 17.5 cm Installations-/Tragwand HWR/Bad <-> Küche (u = 3.24..3.415, solid in EG & OG for v <= 1.88)
  // - wcEastU: partition WC <-> Flur (u = 2.05..2.165, solid wall junction with wetPartV in both floors)
  const wetPartV = wallMid('eg', 'eg_hwr_south', 'v', 2.998);
  const instWallU = wallMid('eg', 'eg_hwr_east', 'u', 3.328);
  const wcEastU = wallMid('eg', 'eg_wc_east', 'u', 2.108);
  const vorwandU = water.x;

  // --- DRINKING WATER (Trinkwasser) ---
  // Two interior-wall wet risers avoid open-room crossings, cabinet collisions, and door conflicts:
  // 1) Bad/WC riser inside HWR/Bad <-> WC partition at (wWetU, wetPartV)
  // 2) Shower/Kitchen riser inside 17.5 cm Installationswand at (instWallU, wInstV)
  const wWetU = 1.15;
  const wInstV = 1.48;
  const oz = round(floor + .42);
  const hwrNorthV = .44;

  const egWm = fixtures.get('eg_wm');
  const egWp = fixtures.get('eg_wp');
  const egWcPan = fixtures.get('eg_wc_pan');
  const egWcSink = fixtures.get('eg_wc_sink');
  const ogDusche = fixtures.get('og_dusche');
  const ogBadWb1 = fixtures.get('og_bad_wb1');
  const ogBadWc = fixtures.get('og_bad_wc');
  const ogBadWb2 = fixtures.get('og_bad_wb2');
  const ogWcPan = fixtures.get('og_wc_pan');
  const ogWcSink = fixtures.get('og_wc_sink');
  const ogSpuelm = fixtures.get('og_k_spuelm');
  const ogSpuele = fixtures.get('og_k_spuele');

  // EG water distribution from station W (zero overlapping segments)
  const wmWaterPt = egWm ? [round(egWm.u0 + .36), round(egWm.v0 + .16)] : [.78, .58];
  const wpWaterPt = egWp ? [round(egWp.u0 + .55), round(egWp.v0 + .18)] : [2.35, .60];
  const egWcPanPt = egWcPan ? [round(egWcPan.u0 + .18), round(mid(egWcPan)[1])] : [.56, 3.59];
  const egWcSinkPt = egWcSink ? [round(mid(egWcSink)[0]), round(egWcSink.v0 + .12)] : [1.58, 3.185];

  // North HWR trunk along Grenzwand to WM, Technik/WP and Shower/Kitchen riser
  add('eg-w-hwr-nord', 'water', 'eg', 'HWR-Verteilung zu Technik und Steigstrang Küche', [
    [water.x, water.v, water.z],
    [water.x, hwrNorthV, water.z],
    [instWallU, hwrNorthV, water.z],
    [instWallU, wInstV, water.z],
  ], 'junction');
  add('w-wm', 'water', 'eg', 'Waschmaschine im HWR', [
    [wmWaterPt[0], hwrNorthV, water.z],
    [wmWaterPt[0], wmWaterPt[1], water.z],
    [wmWaterPt[0], wmWaterPt[1], .74],
  ]);
  add('w-eg_wp', 'water', 'eg', 'Technik / Warmwasserbereitung (HWR)', [
    [wpWaterPt[0], hwrNorthV, water.z],
    [wpWaterPt[0], wpWaterPt[1], water.z],
    [wpWaterPt[0], wpWaterPt[1], .78],
  ]);
  add('w-steig-kueche-eg', 'water', 'eg', 'Steigstrang Installationswand Dusche / Küche', [
    [instWallU, wInstV, water.z],
    [instWallU, wInstV, floor],
  ], 'riser');

  // South Vorwand trunk from W to EG WC and Bad/WC riser
  add('eg-w-vorwand', 'water', 'eg', 'Vorwand HWR zum WC EG', [
    [vorwandU, water.v, water.z],
    [vorwandU, egWcPanPt[1], water.z],
  ], 'junction');
  add('eg-w-trennwand', 'water', 'eg', 'Verteilung Trennwand HWR / WC', [
    [vorwandU, wetPartV, water.z],
    [Math.max(wWetU, egWcSinkPt[0]), wetPartV, water.z],
  ], 'junction');
  add('w-steig-eg', 'water', 'eg', 'Steigstrang Bad / WC zum OG', [
    [wWetU, wetPartV, water.z],
    [wWetU, wetPartV, floor],
  ], 'riser');
  add('w-eg_wc_pan', 'water', 'eg', 'WC-Spülkasten EG', [
    [vorwandU, egWcPanPt[1], water.z],
    [egWcPanPt[0], egWcPanPt[1], water.z],
    [egWcPanPt[0], egWcPanPt[1], .72],
  ]);
  add('w-eg_wc_sink', 'water', 'eg', 'Handwaschbecken WC EG', [
    [egWcSinkPt[0], wetPartV, water.z],
    [egWcSinkPt[0], egWcSinkPt[1], water.z],
    [egWcSinkPt[0], egWcSinkPt[1], .78],
  ]);

  // OG Core 1: Bad & WC supplied from Bad/WC riser (all wall-guided, zero room/cabinet crossings)
  const ogWb1Pt = ogBadWb1 ? [round(ogBadWb1.u0 + .18), round(mid(ogBadWb1)[1])] : [.56, 1.745];
  const ogBadWcPt = ogBadWc ? [round(ogBadWc.u0 + .18), round(mid(ogBadWc)[1])] : [.56, 2.50];
  const ogWb2Pt = ogBadWb2 ? [round(mid(ogBadWb2)[0]), round(ogBadWb2.v1 - .14)] : [1.59, 2.79];
  const ogWcPanPt = ogWcPan ? [round(ogWcPan.u0 + .18), round(mid(ogWcPan)[1])] : [.56, 3.59];
  const ogWcSinkPt = ogWcSink ? [round(mid(ogWcSink)[0]), round(ogWcSink.v0 + .12)] : [1.58, 3.185];

  add('w-steig-og', 'water', 'og', 'Steigstrang Bad / WC aus dem EG', [
    [wWetU, wetPartV, floor],
    [wWetU, wetPartV, oz],
  ], 'riser');
  add('og-w-trennwand-l', 'water', 'og', 'Trennwand Bad / WC zur Vorwand', [
    [wWetU, wetPartV, oz],
    [vorwandU, wetPartV, oz],
  ], 'junction');
  add('og-w-trennwand-r', 'water', 'og', 'Trennwand zu Waschtisch und Handwaschbecken', [
    [wWetU, wetPartV, oz],
    [Math.max(ogWb2Pt[0], ogWcSinkPt[0]), wetPartV, oz],
  ], 'junction');
  add('og-w-vorwand-n', 'water', 'og', 'Vorwand Bad (Straßenseite)', [
    [vorwandU, wetPartV, oz],
    [vorwandU, Math.min(ogWb1Pt[1], ogBadWcPt[1]), oz],
  ], 'junction');
  add('og-w-vorwand-s', 'water', 'og', 'Vorwand WC OG (Straßenseite)', [
    [vorwandU, wetPartV, oz],
    [vorwandU, ogWcPanPt[1], oz],
  ], 'junction');
  add('w-og_bad_wb1', 'water', 'og', 'Waschtisch Bad (Straßenseite)', [
    [vorwandU, ogWb1Pt[1], oz],
    [ogWb1Pt[0], ogWb1Pt[1], oz],
    [ogWb1Pt[0], ogWb1Pt[1], floor + .78],
  ]);
  add('w-og_bad_wc', 'water', 'og', 'WC-Spülkasten Bad', [
    [vorwandU, ogBadWcPt[1], oz],
    [ogBadWcPt[0], ogBadWcPt[1], oz],
    [ogBadWcPt[0], ogBadWcPt[1], floor + .72],
  ]);
  add('w-og_bad_wb2', 'water', 'og', 'Waschtisch Bad (Innenwand)', [
    [ogWb2Pt[0], wetPartV, oz],
    [ogWb2Pt[0], ogWb2Pt[1], oz],
    [ogWb2Pt[0], ogWb2Pt[1], floor + .78],
  ]);
  add('w-og_wc_pan', 'water', 'og', 'WC-Spülkasten OG', [
    [vorwandU, ogWcPanPt[1], oz],
    [ogWcPanPt[0], ogWcPanPt[1], oz],
    [ogWcPanPt[0], ogWcPanPt[1], floor + .72],
  ]);
  add('w-og_wc_sink', 'water', 'og', 'Handwaschbecken WC OG', [
    [ogWcSinkPt[0], wetPartV, oz],
    [ogWcSinkPt[0], ogWcSinkPt[1], oz],
    [ogWcSinkPt[0], ogWcSinkPt[1], floor + .78],
  ]);

  // OG Core 2: Shower & Kitchen supplied from 17.5 cm Installationswand riser
  const ogDuschePt = ogDusche ? [round(ogDusche.u1 - .13), round(mid(ogDusche)[1])] : [3.10, .905];
  const ogSpuelmPt = ogSpuelm ? [round(ogSpuelm.u0 + .13), round(mid(ogSpuelm)[1])] : [3.55, .79];
  const ogSpuelePt = ogSpuele ? [round(ogSpuele.u0 + .13), round(mid(ogSpuele)[1])] : [3.55, 1.63];

  add('w-steig-kueche-og', 'water', 'og', 'Steigstrang Dusche / Küche aus dem EG', [
    [instWallU, wInstV, floor],
    [instWallU, wInstV, oz],
  ], 'riser');
  add('og-w-inst-n', 'water', 'og', 'Installationswand Dusche / Spülmaschine', [
    [instWallU, wInstV, oz],
    [instWallU, Math.min(ogDuschePt[1], ogSpuelmPt[1]), oz],
  ], 'junction');
  add('og-w-inst-s', 'water', 'og', 'Installationswand Küchenspüle', [
    [instWallU, wInstV, oz],
    [instWallU, ogSpuelePt[1], oz],
  ], 'junction');
  add('w-og_dusche', 'water', 'og', 'Dusche (Armatur Installationswand)', [
    [instWallU, ogDuschePt[1], oz],
    [ogDuschePt[0], ogDuschePt[1], oz],
    [ogDuschePt[0], ogDuschePt[1], floor + 1.10],
  ]);
  add('w-og_k_spuelm', 'water', 'og', 'Geschirrspüler (Kaltwasser)', [
    [instWallU, ogSpuelmPt[1], oz],
    [ogSpuelmPt[0], ogSpuelmPt[1], oz],
    [ogSpuelmPt[0], ogSpuelmPt[1], floor + .62],
  ]);
  add('w-og_k_spuele', 'water', 'og', 'Küchenspüle (Kalt-/Warmwasser)', [
    [instWallU, ogSpuelePt[1], oz],
    [ogSpuelePt[0], ogSpuelePt[1], oz],
    [ogSpuelePt[0], ogSpuelePt[1], floor + .78],
  ]);

  // --- ELECTRICAL POWER (Strom) ---
  // Power riser sits in the stacked solid wall junction (wcEastU, wetPartV), clear of doors and wet risers.
  // Ceiling distribution spine runs at ev = power.v (2.33), visually separated from water trunks (0.44 and 2.998).
  const ex = wcEastU;
  const ey = wetPartV;
  const ev = power.v;
  const ez = 2.45;
  const upstairs = round(floor + 2.40);

  const wmPowerPt = egWm ? [round(egWm.u1 - .33), round(egWm.v0 + .16)] : [1.32, .58];
  const wpPowerPt = egWp ? [round(egWp.u1 - .32), round(egWp.v0 + .18)] : [2.86, .60];
  const stairBox = spec.stairs?.slabOpening || spec.stairs?.box || { u0: 8.22, v0: 4.37, u1: 10.635, v1: 6.785 };
  const egStairLightU = round((stairBox.u0 + stairBox.u1) / 2);
  const egStairLightV = round(stairBox.v0 - .14); // under solid deckeEg ceiling right at stair entry

  const egTargets = [
    ['licht-wc', 'Licht WC EG', 1.20, 3.55, 2.62],
    ['wm', 'Geräteanschluss WM / TR', wmPowerPt[0], wmPowerPt[1], 1.12],
    ['licht-hwr', 'Licht HWR', 1.65, 1.62, 2.62],
    ['licht-eingang', 'Licht Eingang / Diele', 1.85, 5.65, 2.62],
    ['steck-diele', 'Steckdose Diele / Hofzugang', 2.00, 6.72, .32],
    ['wp', 'Kraftstrom Technik / Wärmepumpe', wpPowerPt[0], wpPowerPt[1], 1.25],
    ['steck-raum-hof', 'Steckdosen offener Bereich (Hof/Kanal)', 5.87, 6.72, .32],
    ['licht-raum', 'Licht offener Bereich EG', 6.45, 2.65, 2.64],
    ['steck-raum', 'Steckdosen offener Bereich (Grenzwand)', 6.85, .40, .32],
    ['licht-treppe', 'Licht Treppenantritt EG', egStairLightU, egStairLightV, 2.64],
    ['steck-garten', 'Steckdosen offener Bereich (Gartenseite)', 9.65, .40, .32],
  ];

  // Single continuous EG ceiling spine from E (u = 0.48) eastwards — zero backtracking or overlap
  const egMaxU = Math.max(ex, ...egTargets.map(t => t[2]));
  add('e-verteilung', 'power', 'eg', 'Elektroverteilung zur Deckenverteilung EG', [
    [power.x, power.v, power.z],
    [power.x, power.v, ez],
    [egMaxU, ev, ez],
  ], 'junction');
  add('e-steig-zuleitung', 'power', 'eg', 'Abzweig zur Elektrosteigzone', [
    [ex, ev, ez],
    [ex, ey, ez],
  ], 'junction');
  add('e-steig-eg', 'power', 'eg', 'Elektrosteigzone zum OG', [
    [ex, ey, ez],
    [ex, ey, floor],
  ], 'riser');
  for (const [id, label, u, v, h] of egTargets) {
    add('e-eg-' + id, 'power', 'eg', label, [[u, ev, ez], [u, v, ez], [u, v, h]]);
  }

  // OG electrical distribution + dedicated shared kitchen trunk (zero overlapping runs)
  const ogTable = fixtures.get('og_ecktisch');
  const ogEatPt = ogTable ? [round(mid(ogTable)[0]), round(mid(ogTable)[1])] : [6.32, 5.10];
  const ogRoomTargets = [
    ['steck-zimmer', 'Steckdosen Zimmer OG', 1.00, 4.22, .32],
    ['licht-wc', 'Licht WC OG', 1.20, 3.55, 2.58],
    ['licht-bad', 'Licht Bad', 1.63, 1.65, 2.58],
    ['licht-raum', 'Licht Zimmer OG', 1.85, 5.46, 2.58],
    ['steck-bad', 'Steckdose Waschtisch Bad', 1.96, 2.88, 1.15],
    ['licht-flur', 'Licht Flur OG', 2.79, 3.56, 2.58],
    ['licht-essen', 'Licht Esstisch / Sitzecke', ogEatPt[0], ogEatPt[1], 2.58],
    ['licht-wohnen', 'Licht Wohnen / Küche', 6.70, 2.35, 2.58],
    ['steck-wohnen', 'Steckdosen Wohnen', 7.38, .40, .32],
    ['licht-treppe', 'Licht Treppenhaus OG', round((stairBox.u0 + stairBox.u1) / 2), round((stairBox.v0 + stairBox.v1) / 2), 2.58],
  ];

  const kitchenDefs = [
    ['og_k_spuelm', 'Geräteanschluss Spülmasch.', .55],
    ['og_k_arbp', 'Steckdosen Arbeitsfläche Küche', 1.15],
    ['og_k_kuehl', 'Geräteanschluss Kühlschr.', 1.05],
    ['og_k_herd', 'Herdanschluss (400 V)', 1.05],
    ['og_k_ofen', 'Geräteanschluss Backofen', 1.05],
  ].filter(([id]) => fixtures.has(id));
  const kitchenTrunkU = kitchenDefs.length
    ? round(Math.max(...kitchenDefs.map(([id]) => fixtures.get(id).u1)) - .14)
    : 4.18;

  const ogMinU = Math.min(ex, ...ogRoomTargets.map(t => t[2]));
  const ogMaxU = Math.max(ex, kitchenTrunkU, ...ogRoomTargets.map(t => t[2]));

  add('e-steig-og', 'power', 'og', 'Elektrosteigzone aus dem EG', [
    [ex, ey, floor],
    [ex, ey, upstairs],
  ], 'riser');
  add('og-e-zuleitung', 'power', 'og', 'Steigzone zur Deckenverteilung OG', [
    [ex, ey, upstairs],
    [ex, ev, upstairs],
  ], 'junction');
  if (ogMinU < ex) {
    add('og-e-verteilung-l', 'power', 'og', 'Gemeinsamer Leitungsweg West', [
      [ex, ev, upstairs],
      [ogMinU, ev, upstairs],
    ], 'junction');
  }
  if (ogMaxU > ex) {
    add('og-e-verteilung-r', 'power', 'og', 'Gemeinsamer Leitungsweg Ost', [
      [ex, ev, upstairs],
      [ogMaxU, ev, upstairs],
    ], 'junction');
  }
  for (const [id, label, u, v, h] of ogRoomTargets) {
    add('e-og-' + id, 'power', 'og', label, [[u, ev, upstairs], [u, v, upstairs], [u, v, floor + h]]);
  }

  if (kitchenDefs.length) {
    const kVs = kitchenDefs.map(([id]) => round(mid(fixtures.get(id))[1]));
    const minKV = Math.min(...kVs);
    const maxKV = Math.max(...kVs);
    if (minKV < ev) {
      add('og-e-kueche-n', 'power', 'og', 'Küchenstrang Nord (Spülmaschine)', [
        [kitchenTrunkU, ev, upstairs],
        [kitchenTrunkU, minKV, upstairs],
      ], 'junction');
    }
    if (maxKV > ev) {
      add('og-e-kueche-s', 'power', 'og', 'Küchenstrang Süd (Gerätezeile)', [
        [kitchenTrunkU, ev, upstairs],
        [kitchenTrunkU, maxKV, upstairs],
      ], 'junction');
    }
    for (const [id, label, h] of kitchenDefs) {
      const f = fixtures.get(id);
      const v = round(mid(f)[1]);
      // Offset dishwasher power away from water outlet (u = 3.55) so both symbols stay distinct
      const u = id === 'og_k_spuelm' ? round(f.u1 - .24) : round(mid(f)[0]);
      add('e-og-' + id, 'power', 'og', label, [
        [kitchenTrunkU, v, upstairs],
        [u, v, upstairs],
        [u, v, floor + h],
      ]);
    }
  }

  return { routes, stations };
}

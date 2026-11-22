// Einziges Haus-Integrationsmodul (dynamisch geladen nach Szenenstart -> Start-Chunk bleibt ≤ 45 KB gzip).
// Kein Three.js! Verbindet HOUSE_SPEC, dimensions.js, site.js, baugrenze.js und (lazy) plan2d.js.
// Alle sichtbaren Bezeichnungen strikt lagebezogen (Dautengasse / Garten / Hof/Kanal / Grenzwand 215/3),
// keine falschen Himmelsrichtungen, ohne Farbcode-Bindung, keine „Wohnfläche“-Suggestion.

import { HOUSE_SPEC } from './house/spec.js';
import { accessGeometry } from './house/access.js';
import { getMapOverlayData, deriveDimensions } from './house/dimensions.js';
import { computeSitePlacement, getHouseFocusPoints } from './site.js';
import { OFFICIAL_BAUGRENZE, buildBaugrenzeOverlay } from './baugrenze.js';
import { NF1, NF2 } from './format.js';

const m2 = (v) => `${NF2.format(v)} m`;
const m1 = (v) => `${NF1.format(v)} m`;
const area1 = (v) => `${NF1.format(v)} m²`;
const area2 = (v) => `${NF2.format(v)} m²`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Lagebezogene Fassadennamen nach LVermGeo ALKIS (#24 Punkt 3 – keine falschen Himmelsrichtungen!)
const FACADE_LABELS = {
  west: 'Grenzwand 215/3',
  grenzwand: 'Grenzwand 215/3',
  boundary: 'Grenzwand 215/3',
  east: 'Hof/Kanal',
  hof: 'Hof/Kanal',
  courtyard: 'Hof/Kanal',
  south: 'Dautengasse',
  dautengasse: 'Dautengasse',
  street: 'Dautengasse',
  north: 'Garten (Flst. 215)',
  garten: 'Garten (Flst. 215)',
  garden: 'Garten (Flst. 215)',
};

function facadeLabel(f) {
  const key = String(f?.id || '').toLowerCase();
  if (FACADE_LABELS[key]) return FACADE_LABELS[key];
  const raw = String(f?.label || f?.id || '');
  return raw
    .replace(/\bWest\b/gi, 'Grenzwand 215/3')
    .replace(/\bOst\b/gi, 'Hof/Kanal')
    .replace(/\bSüd\b/gi, 'Dautengasse')
    .replace(/\bNord\b/gi, 'Garten');
}

// Berechnet EG-/OG-Innenflächen garantiert OHNE offenes OG-Treppenloch (5,93 m²) (#24 Punkt 1)
export function computeFloorAreas(spec = HOUSE_SPEC) {
  const stairBox = spec.stairs?.slabOpening || spec.stairs?.box;
  const boxArea = stairBox
    ? +((stairBox.u1 - stairBox.u0) * (stairBox.v1 - stairBox.v0)).toFixed(2)
    : 5.93;
  const ogRooms = spec.levels.og.rooms || [];
  const ogOpeningRoom = ogRooms.find((r) => r.isOpening || r.id === 'og_treppe' || /treppenloch/i.test(r.name));
  const stairOpeningM2 = spec.levels.og.stairOpeningAreaM2 ?? ogOpeningRoom?.areaM2 ?? boxArea;

  const egRooms = (spec.levels.eg.rooms || []).filter((r) => !r.isOpening && !/treppenloch/i.test(r.name));
  const egAreaM2 = spec.levels.eg.netAreaM2 ?? +egRooms.reduce((s, r) => s + r.areaM2, 0).toFixed(2);

  const ogUsableRooms = ogRooms.filter((r) => r !== ogOpeningRoom && !r.isOpening && r.id !== 'og_treppe' && !/treppenloch/i.test(r.name));
  const ogUsableSum = +ogUsableRooms.reduce((s, r) => s + r.areaM2, 0).toFixed(2);
  const ogWithoutOpeningM2 = spec.levels.og.netAreaWithoutStairOpeningM2
    ?? (spec.levels.og.stairOpeningAreaM2 != null && spec.levels.og.netAreaM2 != null
      ? Math.min(spec.levels.og.netAreaM2, ogUsableSum > 0 ? ogUsableSum : spec.levels.og.netAreaM2)
      : ogUsableSum);

  return { egAreaM2, ogWithoutOpeningM2, stairOpeningM2 };
}

function summarizeEntrance(entry, fallbackNote) {
  if (!entry) return fallbackNote;
  if (entry.accessSummary) return entry.accessSummary;
  if (entry.splitLevel) return 'Split-Level-Eingang (Entwurfsannahme)';
  if (entry.shortLabel) return entry.shortLabel;
  return fallbackNote;
}

export class HouseController {
  constructor(cfg, ground) {
    this.cfg = cfg;
    this.ground = ground;
    this.spec = HOUSE_SPEC;
    this.planMod = null;
    this.baugrenzeOverlay = buildBaugrenzeOverlay(cfg, ground, OFFICIAL_BAUGRENZE);
    this.placement = computeSitePlacement(cfg, ground, this.spec, cfg.sewer.corridor_m, OFFICIAL_BAUGRENZE);
  }

  get access() { return accessGeometry(this.spec); }

  recompute(corridorM) {
    this.placement = computeSitePlacement(this.cfg, this.ground, this.spec, corridorM, OFFICIAL_BAUGRENZE);
    return this.placement;
  }

  getFocusPoints() {
    return getHouseFocusPoints(this.placement, this.spec);
  }

  // Übergabepaket für createHouse3D(spec, opts) in src/view3d.js
  get3DConfig() {
    const pl = this.placement;
    return {
      spec: this.spec,
      placement: pl,
      opts: {
        plinthDepth: pl.terrain.plinthDepth,
        plinthBottomLocalY: pl.terrain.plinthBottomLocalY,
        okffWorldY: pl.terrain.okffEgY,
        nhnOffset: pl.terrain.nhnOffset,
        terrainAtDoors: pl.terrain.doors,
        cornersGround: pl.terrain.corners,
        cornersTerrain: pl.terrain.corners,
        terrainInfo: pl.terrain,
        access: this.access,
      },
    };
  }

  // Wandelt lokale Grundriss-/Dachdaten aus dimensions.js in Weltkoordinaten [wx, y, wz] für overlay.js um
  getOverlayData(mode = 'full') {
    const mapData = getMapOverlayData(this.spec, mode);
    const tf = this.placement.transform;
    const y = this.placement.terrain.okffEgY + 0.06;
    const pt3 = ([lx, lz]) => {
      const [wx, wz] = tf.toWorldXZ(lx, lz);
      return [wx, y, wz];
    };
    const poly3 = (poly) => poly.map(pt3);

    // Exakt gegen den aktiven DN250-Schutzstreifen (±corridorM) gekappte Konfliktfläche
    const cfXZ = this.placement.sewer.conflictPolyXZ;
    const conflictPoly = cfXZ ? cfXZ.map(([x, z]) => [x, y + 0.02, z]) : null;
    let conflictLabel = null;
    if (conflictPoly && this.placement.sewer.conflictActive) {
      let sx = 0, sz = 0;
      for (const p of cfXZ) { sx += p[0]; sz += p[1]; }
      conflictLabel = {
        at: [sx / cfXZ.length, y + 0.05, sz / cfXZ.length],
        text: `DN250-Konflikt: ${m2(this.placement.sewer.overlapActive_m)} in ±${m1(this.placement.sewer.corridorActive_m)}`,
      };
    }

    const extraSteps = [...mapData.stairSteps, ...mapData.splitStairSteps];
    const exteriorParts = mapData.exteriorSteps.map(poly3);

    const cutLine = mode === 'cutaway'
      ? [pt3([0, -this.spec.footprint.width / 2 - 0.5]), pt3([0, this.spec.footprint.width / 2 + 0.5])]
      : null;

    return {
      mode,
      showRoof: mapData.showRoof,
      footprint: poly3(mapData.footprintLocal),
      eaves: poly3(mapData.eaveCornersLocal),
      ridge: mapData.ridgeLocal.map(pt3),
      walls: (mapData.walls || []).map((w) => ({ ext: w.ext, poly: poly3(w.poly) })),
      openings: (mapData.openings || []).map((o) => ({ kind: o.kind, a: pt3(o.a), b: pt3(o.b) })),
      stairSteps: extraSteps.map(poly3),
      exteriorParts,
      stairOpening: mapData.stairOpening ? poly3(mapData.stairOpening) : null,
      rooms: (mapData.rooms || []).map((r) => ({ name: r.name, areaM2: r.areaM2, at: pt3(r.at) })),
      entrance: mapData.entranceArrow
        ? {
          from: pt3(mapData.entranceArrow.from),
          to: pt3(mapData.entranceArrow.to),
          label: 'Eingang (Dautengasse)',
        }
        : null,
      dims: mapData.outerDims
        ? {
          length: mapData.outerDims.length,
          width: mapData.outerDims.width,
          lengthAt: pt3(mapData.outerDims.lengthAt),
          widthAt: pt3(mapData.outerDims.widthAt),
        }
        : null,
      conflictPoly,
      conflictLabel,
      cutLine,
    };
  }

  // Baut das kompakte, ehrliche deutsche Prüfpanel im Seitenpanel (#house-content)
  renderPanelHtml() {
    const pl = this.placement;
    const c = pl.clearances;
    const rh = pl.roofHull;
    const sw = pl.sewer;
    const bg = pl.baugrenze;
    const hs = pl.heightsSummary;
    const bp = this.spec.bplanCheck;
    const areas = computeFloorAreas(this.spec);
    const doors = pl.terrain.doors;

    const badge = (cls, txt) => `<span class="h-badge ${cls}">${esc(txt)}</span>`;
    const row = (k, v, cls = '') => `<div class="h-row"><span>${esc(k)}</span><b class="${cls}">${v}</b></div>`;

    const sewerStatus = sw.conflictActive
      ? badge('bad', `Kollision ${m2(sw.overlapActive_m)} in ±${m1(sw.corridorActive_m)}`)
      : badge('ok', `Frei ggü. ±${m1(sw.corridorActive_m)}`);
    const bgStatus = bg.exceeded
      ? badge('bad', `Überschritten (${m2(bg.clearance_m)})`)
      : bg.withinUncertainty
        ? badge('warn', `${m2(bg.clearance_m)} (in ±${m1(bg.uncertainty_m)}-Unsicherheit)`)
        : badge('ok', `${m2(bg.clearance_m)} vor Linie`);
    const roofBoundaryStatus = rh.boundary215_3_m >= -0.005
      ? `${m2(rh.boundary215_3_m)} (bündig 0,00 m)`
      : `Übertritt ${m2(-rh.boundary215_3_m)}`;
    const roofStreetStatus = rh.street_m >= -0.005
      ? `${m2(rh.street_m)} (kein Überbau)`
      : `Übertritt ${m2(-rh.street_m)}`;

    const mainNote = summarizeEntrance(this.spec.entrance?.main, 'Split-Level-Eingang');
    const sideNote = summarizeEntrance(this.spec.entrance?.side, 'Podest + Außentreppe');
    const gardenNote = summarizeEntrance(this.spec.entrance?.garden, 'Gartenstufe');

    return `
      <div class="h-meta">
        <span><b>${m2(this.spec.footprint.length)} × ${m2(this.spec.footprint.width)}</b> · BGF ${area1(this.spec.footprint.areaM2)}/Gesch.</span>
        <span class="h-sub">EG Innenfläche ${area2(areas.egAreaM2)} · OG Innenfläche ohne Treppenloch ${area2(areas.ogWithoutOpeningM2)} (+ ${area2(areas.stairOpeningM2)} Treppenöffnung; keine WoFlV)</span>
      </div>

      <div class="h-sec">
        <h4>Prüflage Flurstück 214 &amp; Konflikte</h4>
        ${row('DN250-Kanal (Wand ↔ Achse)', `${m2(sw.axisDist_m)} ${sewerStatus}`, sw.conflictActive ? 'c-bad' : 'c-ok')}
        ${row('Hofaußentreppe bis Kanalachse', m2(sw.stairAxisDist_m), 'c-bad')}
        <p class="h-note">Überdeckung je Annahme: ±2,0 m → <b>${m2(sw.overlap20_m)}</b> · ±2,5 m → <b>${m2(sw.overlap25_m)}</b> · ±3,0 m → <b>${m2(sw.overlap30_m)}</b> (Dachkante Hof/Kanal zur Achse: ${m2(sw.roofAxisDist_m)}).</p>
        ${row('Blaue Baugrenze (1:1000)', bgStatus, bg.withinUncertainty ? 'c-warn' : '')}
        ${row('Grenzwand 215/3 (I.3)', `Wand ${m2(c.boundary215_3_m)} · Dach ${roofBoundaryStatus}`)}
        ${row('Dautengasse (Straßenrand)', `Wand ${m2(c.street_m)} · Dach ${roofStreetStatus}`)}
        ${row('Grenze Hof/Kanal (zu 213)', `Wand ${m2(c.hof213_m)} · Dach ${m2(rh.hof213_m)}`)}
        ${row('Gartenseite (zu Flst. 215)', `Wand ${m2(c.garden215_m)}`)}
        ${row('Bestand Haus Nr. 4 / Nr. 6 / Nr. 3', `${m2(c.haus4_m)} / ${m2(c.haus6_m)} / ${m2(c.haus3_m)}`)}
        ${row('2 Stellplätze/WE (B-Plan)', badge('bad', 'Nicht konfliktfrei nachgewiesen'), 'c-bad')}
        <p class="h-note">${esc(pl.parking.summary)}</p>
      </div>

      <div class="h-sec">
        <h4>Gebäudehöhen &amp; Gelände (alle Entwurfsannahme · DEM q=${pl.terrain.qMin})</h4>
        ${row('Gelände am Baukörper', `${m2(pl.terrain.minY)} bis ${m2(pl.terrain.maxY)} (Δ ${m2(pl.terrain.spanY)})`)}
        ${row('OKFF EG (Bezug ±0,00 m)', `${m2(hs.okffEg.worldY)} · ${NF2.format(hs.okffEg.nhn)} m NHN`)}
        ${row('Wand-Traufpunkt (OK OG-Decke)', `${m2(hs.eaveWall.local)} · ${NF2.format(hs.eaveWall.nhn)} m NHN`)}
        ${row('Dachkante Grenzwand 215/3 (Attika)', `${m2(hs.roofEdgeBoundary.local)} · ${NF2.format(hs.roofEdgeBoundary.nhn)} m NHN`)}
        ${row('Traufkante UK / OK Hof/Kanal (0,45 m)', `${m2(hs.roofEdgeHofUnder.local)} / ${m2(hs.roofEdgeHofTop.local)}`)}
        ${row('First der Dachflächen', `${m2(hs.ridge.local)} ab OKFF EG`)}
        ${row('Oberkante Firstziegel', `${m2(this.spec.heights.ridgeCapTopY)} · ca. ${m2(pl.terrain.okffEgNhn + this.spec.heights.ridgeCapTopY)} NHN`)}
        <p class="h-note">First über Geländetiefpunkt: ${m2(hs.ridge.aboveMinGround)} · Hangsockel ${m2(pl.terrain.plinthDepth)} tief. Höhenunterschiede zum Gelände an den Türen: Dautengasse ${doors.main ? m2(doors.main.drop_m) : '–'} (${esc(mainNote)}), Hof/Kanal ${doors.side ? m2(doors.side.drop_m) : '–'} (${esc(sideNote)}), Garten ${doors.garden ? m2(doors.garden.drop_m) : '–'} (${esc(gardenNote)}).</p>
      </div>

      <div class="h-sec">
        <h4>B-Plan Wattenheim „Ortskern“ &amp; Entwurfsannahmen</h4>
        <p class="h-note"><b>Flurstück 214:</b> ${esc(pl.parcel.areaInfo.label)}.</p>
        <p class="h-note"><b>Flurstück 215 (${area1(pl.parcel215.area_m2)}):</b> ${esc(pl.parcel215.status)}</p>
        <p class="h-note"><b>Gestaltung laut Satzung</b> · Beide Dachseiten gleich geneigt, mindestens 30°. Zulässig sind rote bis rotbraune unglasierte Tonziegel oder Betondachsteine. Der Entwurf hat ein Satteldach mit ${NF1.format(bp.roofPitchDeg)}° und Tonziegeln. Für die Fassaden gelten Hochformat-Öffnungen (min. H/B ${NF2.format(bp.actualMinRatioHB)} ≥ 1,25), max. Öffnungsanteil ${NF1.format(bp.maxOpeningSharePct)} % (&lt; 50 %), min. Pfeiler ${m2(bp.actualMinPierM)} (≥ 0,24 m), farblich abgesetzte Fenstergesimse, 2 Stellplätze/WE, Grenzbauten nach I.3.</p>
        <p class="h-note"><b>Entwurfsannahme Fassade:</b> Heller, matter Putz. Die Satzung erlaubt Putz und nennt hierfür keinen bestimmten Farbton.</p>
        <p class="h-disc">${esc(pl.disclaimer)} · <a href="${esc(pl.bplanUrl)}" target="_blank" rel="noopener noreferrer">Original-B-Plan</a></p>
      </div>
    `;
  }

  // Öffnet / rendert den interaktiven 2D-Grundriss- & Schnitt-Dialog (lädt plan2d.js erst bei Bedarf!)
  async renderPlanDialog(tab, els) {
    if (!this.planMod) {
      els.canvas.innerHTML = '<p class="plan-loading">Grundriss- und Schnittzeichnung wird geladen …</p>';
      this.planMod = await import('./house/plan2d.js');
    }
    const pl = this.placement;
    const terrainInfo = {
      okffWorldY: pl.terrain.okffEgY,
      nhnOffset: pl.terrain.nhnOffset,
      minY: pl.terrain.minY,
      maxY: pl.terrain.maxY,
      meanY: pl.terrain.avgY,
      plinthDepth: pl.terrain.plinthDepth,
      plinthBottomLocalY: pl.terrain.plinthBottomLocalY,
      doors: pl.terrain.doors,
      corners: pl.terrain.corners,
      sectionCross: pl.terrain.sectionCross,
      sectionLong: pl.terrain.sectionLong,
      baugrenze: pl.baugrenze,
      sewer: pl.sewer,
      heightsSummary: pl.heightsSummary,
    };

    const dims = deriveDimensions(this.spec, {
      okffWorldY: pl.terrain.okffEgY,
      nhnOffset: pl.terrain.nhnOffset,
      terrainMinY: pl.terrain.minY,
      terrainMeanY: pl.terrain.avgY,
    });

    let svgHtml = '';
    if (tab === 'eg' || tab === 'og' || tab === 'dach') {
      svgHtml = this.planMod.renderFloorPlanSvg(this.spec, tab, { terrainInfo, placement: pl, dimensions: dims });
    } else {
      const axis = (tab === 'section-long' || tab === 'long') ? 'long' : 'cross';
      svgHtml = this.planMod.renderSectionSvg(this.spec, terrainInfo, { axis, placement: pl, dimensions: dims });
    }
    if (typeof svgHtml === 'string') els.canvas.innerHTML = svgHtml;
    else if (svgHtml instanceof Node) { els.canvas.innerHTML = ''; els.canvas.appendChild(svgHtml); }

    const areas = computeFloorAreas(this.spec);
    const hs = pl.heightsSummary;
    const bp = this.spec.bplanCheck;
    const prov = this.spec.provenance;

    const facadeRows = bp.facades.map((f) => `<tr>
      <td>${esc(facadeLabel(f))}</td>
      <td>${f.openingCount}</td>
      <td>${NF1.format(f.openingSharePct)} %</td>
      <td>${f.minRatioHB != null ? NF2.format(f.minRatioHB) : '–'}</td>
      <td>${f.minPierM != null ? m2(f.minPierM) : '–'}</td>
    </tr>`).join('');

    els.meta.innerHTML = `
      <div class="plan-grid">
        <section>
          <h3>Maße und Flächen</h3>
          <ul>
            <li><b>Außenmaße:</b> ${m2(dims.outer.lengthM)} <span class="tag v">Vorgabe</span> × ${m2(dims.outer.widthM)} <span class="tag f">Foto-Näherung</span> · BGF ${area2(dims.outer.bgfPerFloorM2)}/Gesch.</li>
            <li><b>Innenflächen (Entwurf, keine Wohnfläche nach WoFlV):</b> EG ${area2(areas.egAreaM2)} · OG ohne Treppenloch ${area2(areas.ogWithoutOpeningM2)} (Treppenöffnung separat ${area2(areas.stairOpeningM2)})</li>
            <li><b>Treppe EG ↔ OG:</b> ${dims.stairs.risers} Stg. × ${NF2.format(dims.stairs.riseCm)} cm, ${dims.stairs.treads} Auftr. (∅ ${NF1.format(dims.stairs.treadMeanCm)} cm), 2s+a = ${NF1.format(dims.stairs.stepFormulaCm)} cm, Durchgangshöhe ≥ ${m2(dims.stairs.minHeadroomM)} <span class="tag i">Interpretation</span></li>
            <li><b>Höhen ab OKFF EG <span class="tag e">Entwurfsannahme</span>:</b> Wand-Traufe ${m2(hs.eaveWall.local)} · Dachkante Grenzwand 215/3 (bündig/Attika) ${m2(hs.roofEdgeBoundary.local)} · Traufkante Hof/Kanal UK/OK ${m2(hs.roofEdgeHofUnder.local)} / ${m2(hs.roofEdgeHofTop.local)} · First der Dachflächen ${m2(hs.ridge.local)} (${NF2.format(hs.ridge.nhn)} m NHN), Oberkante Firstziegel ${m2(this.spec.heights.ridgeCapTopY)}</li>
            <li><b>Orientierung (LVermGeo ALKIS, EPSG:25832):</b> Modellachse +Z = Dautengasse (~NO 58°), −Z = Garten/Flst. 215, +X = Hof/Kanal, −X = Grenzwand 215/3.</li>
          </ul>
        </section>
        <section>
          <h3>Fassadenbilanz (B-Plan Wattenheim „Ortskern“)</h3>
          <table class="plan-tbl">
            <thead><tr><th>Fassade</th><th>Öffn.</th><th>Anteil (&lt;50%)</th><th>min H/B (≥1,25)</th><th>min Pfeiler (≥0,24m)</th></tr></thead>
            <tbody>${facadeRows}</tbody>
          </table>
          <p class="plan-small"><b>Örtliche Bauvorschriften</b> · Beidseits gleiche Neigung ab 30°. Der Entwurf verwendet ein Satteldach mit ${NF1.format(bp.roofPitchDeg)}° und folgender Deckung. ${esc(bp.roofCovering)}, Hochformat H/B ≥ 1,25, Öffnungen &lt; 50 %, Pfeiler ≥ 0,24 m, abgesetzte Fenstergesimse.</p>
          <p class="plan-small"><b>Entwurfsannahme Fassade:</b> Heller, matter Putz. Die Satzung erlaubt Putz und nennt hierfür keinen bestimmten Farbton.</p>
        </section>
      </div>
      <div class="plan-legend">
        <h4>Quellen-Legende &amp; Annahmen</h4>
        <div class="legend-cols">
          <div><span class="tag v">Vorgabe</span><ul>${prov.vorgabe.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
          <div><span class="tag f">Foto-Näherung</span><ul>${prov.foto.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
          <div><span class="tag i">Interpretation</span><ul>${prov.interpretation.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
          <div><span class="tag e">Entwurfsannahme</span><ul>${prov.entwurf.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
        </div>
        <p class="h-disc">${esc(pl.disclaimer)} · <a href="${esc(pl.bplanUrl)}" target="_blank" rel="noopener noreferrer">Original-B-Plan Wattenheim „Ortskern“</a></p>
      </div>
    `;
  }
}

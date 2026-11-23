const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./plan2d-C7Ak5RaY.js","./site-CBYAAxN0.js","./access-DT0a7FcM.js","./services-plan-BeSXLwfU.js"])))=>i.map(i=>d[i]);
import{a as e,c as t,i as n,n as r,o as i,r as a,s as o,t as s,u as c}from"./site-CBYAAxN0.js";import{t as l}from"./access-DT0a7FcM.js";import{i as u,r as d}from"./main-DFBbaDUq.js";import{t as f}from"./preload-helper-DLr8UypG.js";var p=e=>`${u.format(e)} m`,m=e=>`${d.format(e)} m`,h=e=>`${d.format(e)} m²`,g=e=>`${u.format(e)} m²`,_=e=>String(e).replace(/[&<>"]/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`})[e]),v={west:`Grenzwand 215/3`,grenzwand:`Grenzwand 215/3`,boundary:`Grenzwand 215/3`,east:`Hof/Kanal`,hof:`Hof/Kanal`,courtyard:`Hof/Kanal`,south:`Dautengasse`,dautengasse:`Dautengasse`,street:`Dautengasse`,north:`Garten (Flst. 215)`,garten:`Garten (Flst. 215)`,garden:`Garten (Flst. 215)`};function y(e){let t=String(e?.id||``).toLowerCase();return v[t]?v[t]:String(e?.label||e?.id||``).replace(/\bWest\b/gi,`Grenzwand 215/3`).replace(/\bOst\b/gi,`Hof/Kanal`).replace(/\bSüd\b/gi,`Dautengasse`).replace(/\bNord\b/gi,`Garten`)}function b(e=c){let t=e.stairs?.slabOpening||e.stairs?.box,n=t?+((t.u1-t.u0)*(t.v1-t.v0)).toFixed(2):0,r=e.levels.og.rooms||[],i=r.find(e=>e.isOpening||e.id===`og_treppe`||/treppenloch/i.test(e.name)),a=e.levels.og.stairOpeningAreaM2??i?.areaM2??n,o=(e.levels.eg.rooms||[]).filter(e=>!e.isOpening&&!/treppenloch/i.test(e.name)),s=e.levels.eg.netAreaM2??+o.reduce((e,t)=>e+t.areaM2,0).toFixed(2),l=+r.filter(e=>e!==i&&!e.isOpening&&e.id!==`og_treppe`&&!/treppenloch/i.test(e.name)).reduce((e,t)=>e+t.areaM2,0).toFixed(2);return{egAreaM2:s,ogWithoutOpeningM2:e.levels.og.netAreaWithoutStairOpeningM2??(e.levels.og.stairOpeningAreaM2!=null&&e.levels.og.netAreaM2!=null?Math.min(e.levels.og.netAreaM2,l>0?l:e.levels.og.netAreaM2):l),stairOpeningM2:a}}function x(e,t){return e?e.accessSummary?e.accessSummary:e.splitLevel?`Split-Level-Eingang (Entwurfsannahme)`:e.shortLabel?e.shortLabel:t:t}var S=class{constructor(e,t){this.cfg=e,this.ground=t,this.spec=c,this.planMod=null,this.baugrenzeOverlay=n(e,t,a),this.recompute(e.sewer.corridor_m)}get access(){return l(this.spec)}recompute(t){this.placement=s(this.cfg,this.ground,this.spec,t,a);let{length:n,width:r}=this.spec.footprint,o=this.cfg.boundaries.find(e=>e.name===`Flurstück 214`),c=this.placement.transform,l=o.points.map(([e,,t])=>{let[i,a]=c.toLocalXZ(e,t);return[i+n/2,a+r/2]});return this.parcelPlan=l,this.services=e(this.spec,l),this.serviceWorld=this.services.routes.map(e=>({...e,color:i[e.system].bright,dash:i[e.system].screenDash,points:e.points.map(([e,t,i])=>c.toWorld3(e-n/2,i,t-r/2,this.placement.terrain.okffEgY))})),this.serviceStationsWorld=this.services.stations.map(e=>({...e,color:i[e.system].bright,point:c.toWorld3(e.point[0]-n/2,e.point[2],e.point[1]-r/2,this.placement.terrain.okffEgY)})),this.placement}getFocusPoints(){return r(this.placement,this.spec)}get3DConfig(){let e=this.placement;return{spec:this.spec,placement:e,opts:{plinthDepth:e.terrain.plinthDepth,plinthBottomLocalY:e.terrain.plinthBottomLocalY,okffWorldY:e.terrain.okffEgY,nhnOffset:e.terrain.nhnOffset,terrainAtDoors:e.terrain.doors,cornersGround:e.terrain.corners,cornersTerrain:e.terrain.corners,terrainInfo:e.terrain,access:this.access,services:this.services}}}getOverlayData(e=`full`){let n=t(this.spec,e),r=this.placement.transform,i=this.placement.terrain.okffEgY+.06,a=([e,t])=>{let[n,a]=r.toWorldXZ(e,t);return[n,i,a]},o=e=>e.map(a),s=this.placement.sewer.conflictPolyXZ,c=s?s.map(([e,t])=>[e,i+.02,t]):null,l=null;if(c&&this.placement.sewer.conflictActive){let e=0,t=0;for(let n of s)e+=n[0],t+=n[1];l={at:[e/s.length,i+.05,t/s.length],text:`DN250-Konflikt: ${p(this.placement.sewer.overlapActive_m)} in ±${m(this.placement.sewer.corridorActive_m)}`}}let u=[...n.stairSteps,...n.splitStairSteps],d=n.exteriorSteps.map(o),f=e===`cutaway`?[a([0,-this.spec.footprint.width/2-.5]),a([0,this.spec.footprint.width/2+.5])]:null;return{mode:e,services:this.serviceWorld,serviceStations:this.serviceStationsWorld,showRoof:n.showRoof,footprint:o(n.footprintLocal),eaves:o(n.eaveCornersLocal),ridge:n.ridgeLocal.map(a),walls:(n.walls||[]).map(e=>({ext:e.ext,poly:o(e.poly)})),openings:(n.openings||[]).map(e=>({kind:e.kind,a:a(e.a),b:a(e.b)})),stairSteps:u.map(o),exteriorParts:d,stairOpening:n.stairOpening?o(n.stairOpening):null,rooms:(n.rooms||[]).map(e=>({name:e.name,areaM2:e.areaM2,at:a(e.at)})),entrance:n.entranceArrow?{from:a(n.entranceArrow.from),to:a(n.entranceArrow.to),label:`Eingang (Dautengasse)`}:null,dims:n.outerDims?{length:n.outerDims.length,width:n.outerDims.width,lengthAt:a(n.outerDims.lengthAt),widthAt:a(n.outerDims.widthAt)}:null,conflictPoly:c,conflictLabel:l,cutLine:f}}renderPanelHtml(){let e=this.placement,t=e.clearances,n=e.roofHull,r=e.sewer,i=e.baugrenze,a=e.heightsSummary,o=this.spec.bplanCheck,s=b(this.spec),c=e.terrain.doors,l=(e,t)=>`<span class="h-badge ${e}">${_(t)}</span>`,f=(e,t,n=``)=>`<div class="h-row"><span>${_(e)}</span><b class="${n}">${t}</b></div>`,v=r.conflictActive?l(`bad`,`Kollision ${p(r.overlapActive_m)} in ±${m(r.corridorActive_m)}`):l(`ok`,`Frei ggü. ±${m(r.corridorActive_m)}`),y=i.exceeded?l(`bad`,`Überschritten (${p(i.clearance_m)})`):i.withinUncertainty?l(`warn`,`${p(i.clearance_m)} (in ±${m(i.uncertainty_m)}-Unsicherheit)`):l(`ok`,`${p(i.clearance_m)} vor Linie`),S=n.boundary215_3_m>=-.005?`${p(n.boundary215_3_m)} (bündig 0,00 m)`:`Übertritt ${p(-n.boundary215_3_m)}`,C=n.street_m>=-.005?`${p(n.street_m)} (kein Überbau)`:`Übertritt ${p(-n.street_m)}`,w=x(this.spec.entrance?.main,`Split-Level-Eingang`),T=x(this.spec.entrance?.side,`Podest + Außentreppe`),E=x(this.spec.entrance?.garden,`Gartenstufe`);return`
      <div class="h-meta">
        <span><b>${p(this.spec.footprint.length)} × ${p(this.spec.footprint.width)}</b> · BGF ${h(this.spec.footprint.areaM2)}/Gesch.</span>
        <span class="h-sub">EG Innenfläche ${g(s.egAreaM2)} · OG Innenfläche ohne Treppenloch ${g(s.ogWithoutOpeningM2)} (+ ${g(s.stairOpeningM2)} Treppenöffnung; keine WoFlV)</span>
      </div>

      <div class="h-sec">
        <h4>Prüflage Flurstück 214 &amp; Konflikte</h4>
        ${f(`DN250-Kanal (Wand ↔ Achse)`,`${p(r.axisDist_m)} ${v}`,r.conflictActive?`c-bad`:`c-ok`)}
        ${f(`Hofaußentreppe bis Kanalachse`,p(r.stairAxisDist_m),`c-bad`)}
        <p class="h-note">Überdeckung je Annahme: ±2,0 m → <b>${p(r.overlap20_m)}</b> · ±2,5 m → <b>${p(r.overlap25_m)}</b> · ±3,0 m → <b>${p(r.overlap30_m)}</b> (Dachkante Hof/Kanal zur Achse: ${p(r.roofAxisDist_m)}).</p>
        ${f(`Blaue Baugrenze (1:1000)`,y,i.withinUncertainty?`c-warn`:``)}
        ${f(`Grenzwand 215/3 (I.3)`,`Wand ${p(t.boundary215_3_m)} · Dach ${S}`)}
        ${f(`Dautengasse (Straßenrand)`,`Wand ${p(t.street_m)} · Dach ${C}`)}
        ${f(`Grenze Hof/Kanal (zu 213)`,`Wand ${p(t.hof213_m)} · Dach ${p(n.hof213_m)}`)}
        ${f(`Gartenseite (zu Flst. 215)`,`Wand ${p(t.garden215_m)}`)}
        ${f(`Bestand Haus Nr. 4 / Nr. 6 / Nr. 3`,`${p(t.haus4_m)} / ${p(t.haus6_m)} / ${p(t.haus3_m)}`)}
        ${f(`2 Stellplätze/WE (B-Plan)`,l(`bad`,`Nicht konfliktfrei nachgewiesen`),`c-bad`)}
        <p class="h-note">${_(e.parking.summary)}</p>
      </div>

      <div class="h-sec">
        <h4>Gebäudehöhen &amp; Gelände (alle Entwurfsannahme · DEM q=${e.terrain.qMin})</h4>
        ${f(`Gelände am Baukörper`,`${p(e.terrain.minY)} bis ${p(e.terrain.maxY)} (Δ ${p(e.terrain.spanY)})`)}
        ${f(`OKFF EG (Bezug ±0,00 m)`,`${p(a.okffEg.worldY)} · ${u.format(a.okffEg.nhn)} m NHN`)}
        ${f(`Wand-Traufpunkt (OK OG-Decke)`,`${p(a.eaveWall.local)} · ${u.format(a.eaveWall.nhn)} m NHN`)}
        ${f(`Dachkante Grenzwand 215/3 (Attika)`,`${p(a.roofEdgeBoundary.local)} · ${u.format(a.roofEdgeBoundary.nhn)} m NHN`)}
        ${f(`Traufkante UK / OK Hof/Kanal (0,45 m)`,`${p(a.roofEdgeHofUnder.local)} / ${p(a.roofEdgeHofTop.local)}`)}
        ${f(`First der Dachflächen`,`${p(a.ridge.local)} ab OKFF EG`)}
        ${f(`Oberkante Firstziegel`,`${p(this.spec.heights.ridgeCapTopY)} · ca. ${p(e.terrain.okffEgNhn+this.spec.heights.ridgeCapTopY)} NHN`)}
        <p class="h-note">First über Geländetiefpunkt: ${p(a.ridge.aboveMinGround)} · Hangsockel ${p(e.terrain.plinthDepth)} tief. Höhenunterschiede zum Gelände an den Türen: Dautengasse ${c.main?p(c.main.drop_m):`–`} (${_(w)}), Hof/Kanal ${c.side?p(c.side.drop_m):`–`} (${_(T)}), Garten ${c.garden?p(c.garden.drop_m):`–`} (${_(E)}).</p>
      </div>

      <div class="h-sec">
        <h4>B-Plan Wattenheim „Ortskern“ &amp; Entwurfsannahmen</h4>
        <p class="h-note"><b>Flurstück 214:</b> ${_(e.parcel.areaInfo.label)}.</p>
        <p class="h-note"><b>Flurstück 215 (${h(e.parcel215.area_m2)}):</b> ${_(e.parcel215.status)}</p>
        <p class="h-note"><b>Gestaltung laut Satzung</b> · Beide Dachseiten gleich geneigt, mindestens 30°. Zulässig sind rote bis rotbraune unglasierte Tonziegel oder Betondachsteine. Der Entwurf hat ein Satteldach mit ${d.format(o.roofPitchDeg)}° und Tonziegeln. Für die Fassaden gelten Hochformat-Öffnungen (min. H/B ${u.format(o.actualMinRatioHB)} ≥ 1,25), max. Öffnungsanteil ${d.format(o.maxOpeningSharePct)} % (&lt; 50 %), min. Pfeiler ${p(o.actualMinPierM)} (≥ 0,24 m), farblich abgesetzte Fenstergesimse, 2 Stellplätze/WE, Grenzbauten nach I.3.</p>
        <p class="h-note"><b>Entwurfsannahme Fassade:</b> Heller, matter Putz. Die Satzung erlaubt Putz und nennt hierfür keinen bestimmten Farbton.</p>
        <p class="h-disc">${_(e.disclaimer)} · <a href="${_(e.bplanUrl)}" target="_blank" rel="noopener noreferrer">Original-B-Plan</a></p>
      </div>
    `}async renderPlanDialog(e,t,n={}){this.planMod||=(t.canvas.innerHTML=`<p class="plan-loading">Grundriss- und Schnittzeichnung wird geladen …</p>`,await f(()=>import(`./plan2d-C7Ak5RaY.js`),__vite__mapDeps([0,1,2]),import.meta.url));let r=this.placement,i={okffWorldY:r.terrain.okffEgY,nhnOffset:r.terrain.nhnOffset,minY:r.terrain.minY,maxY:r.terrain.maxY,meanY:r.terrain.avgY,plinthDepth:r.terrain.plinthDepth,plinthBottomLocalY:r.terrain.plinthBottomLocalY,doors:r.terrain.doors,corners:r.terrain.corners,sectionCross:r.terrain.sectionCross,sectionLong:r.terrain.sectionLong,baugrenze:r.baugrenze,sewer:r.sewer,heightsSummary:r.heightsSummary},a=o(this.spec,{okffWorldY:r.terrain.okffEgY,nhnOffset:r.terrain.nhnOffset,terrainMinY:r.terrain.minY,terrainMeanY:r.terrain.avgY}),s=``;if(e===`eg`||e===`og`||e===`dach`)s=this.planMod.renderFloorPlanSvg(this.spec,e,{terrainInfo:i,placement:r,dimensions:a});else{let t=e===`section-long`||e===`long`?`long`:`cross`;s=this.planMod.renderSectionSvg(this.spec,i,{axis:t,placement:r,dimensions:a})}if((e===`eg`||e===`og`)&&(n.water||n.power||n.sketch)){let[{servicePlanMarkup:t},{referenceMarkup:r}]=await Promise.all([f(()=>import(`./services-plan-BeSXLwfU.js`),__vite__mapDeps([3,1]),import.meta.url),f(()=>import(`./sketch-overlay-DRXrvMnb.js`),[],import.meta.url)]),i=(n.sketch?r(e,this.spec.footprint):``)+t(this.services,e,n);s=s.replace(`</svg>`,i+`</svg>`)}typeof s==`string`?t.canvas.innerHTML=s:s instanceof Node&&(t.canvas.innerHTML=``,t.canvas.appendChild(s));let c=b(this.spec),l=r.heightsSummary,m=this.spec.bplanCheck,h=this.spec.provenance,v=m.facades.map(e=>`<tr>
      <td>${_(y(e))}</td>
      <td>${e.openingCount}</td>
      <td>${d.format(e.openingSharePct)} %</td>
      <td>${e.minRatioHB==null?`–`:u.format(e.minRatioHB)}</td>
      <td>${e.minPierM==null?`–`:p(e.minPierM)}</td>
    </tr>`).join(``);t.meta.innerHTML=`
      <div class="plan-grid">
        <section>
          <h3>Maße und Flächen</h3>
          <ul>
            <li><b>Außenmaße:</b> ${p(a.outer.lengthM)} <span class="tag v">Vorgabe</span> × ${p(a.outer.widthM)} <span class="tag e">Entwurfstiefe</span> · BGF ${g(a.outer.bgfPerFloorM2)}/Gesch.</li>
            <li><b>Innenflächen (Entwurf, keine Wohnfläche nach WoFlV):</b> EG ${g(c.egAreaM2)} · OG ohne Treppenloch ${g(c.ogWithoutOpeningM2)} (Treppenöffnung separat ${g(c.stairOpeningM2)})</li>
            <li><b>Treppe EG ↔ OG:</b> Halbgewendelte U-Treppe nach DIN 18065 (${a.stairs.risers} Stg., Treppenloch ${g(c.stairOpeningM2)}); abweichende Skizzenmotive sind im Skizzenoverlay sichtbar und in den Annahmen dokumentiert.</li>
            <li><b>Höhen ab OKFF EG <span class="tag e">Entwurfsannahme</span>:</b> Wand-Traufe ${p(l.eaveWall.local)} · Dachkante Grenzwand 215/3 (bündig/Attika) ${p(l.roofEdgeBoundary.local)} · Traufkante Hof/Kanal UK/OK ${p(l.roofEdgeHofUnder.local)} / ${p(l.roofEdgeHofTop.local)} · First der Dachflächen ${p(l.ridge.local)} (${u.format(l.ridge.nhn)} m NHN), Oberkante Firstziegel ${p(this.spec.heights.ridgeCapTopY)}</li>
            <li><b>Orientierung (LVermGeo ALKIS, EPSG:25832):</b> Modellachse +Z = Dautengasse (~NO 58°), −Z = Garten/Flst. 215, +X = Hof/Kanal, −X = Grenzwand 215/3.</li>
          </ul>
        </section>
        <section>
          <h3>Fassadenbilanz (B-Plan Wattenheim „Ortskern“)</h3>
          <table class="plan-tbl">
            <thead><tr><th>Fassade</th><th>Öffn.</th><th>Anteil (&lt;50%)</th><th>min H/B (≥1,25)</th><th>min Pfeiler (≥0,24m)</th></tr></thead>
            <tbody>${v}</tbody>
          </table>
          <p class="plan-small"><b>Örtliche Bauvorschriften</b> · Beidseits gleiche Neigung ab 30°. Der Entwurf verwendet ein Satteldach mit ${d.format(m.roofPitchDeg)}° und folgender Deckung. ${_(m.roofCovering)}, Hochformat H/B ≥ 1,25, Öffnungen &lt; 50 %, Pfeiler ≥ 0,24 m, abgesetzte Fenstergesimse.</p>
          <p class="plan-small"><b>Entwurfsannahme Fassade:</b> Heller, matter Putz. Die Satzung erlaubt Putz und nennt hierfür keinen bestimmten Farbton.</p>
        </section>
      </div>
      <div class="plan-legend">
        <h4>Quellen-Legende &amp; Annahmen</h4>
        <div class="legend-cols">
          <div><span class="tag v">Vorgabe</span><ul>${h.vorgabe.map(e=>`<li>${_(e)}</li>`).join(``)}</ul></div>
          <div><span class="tag f">Foto-Näherung</span><ul>${h.foto.map(e=>`<li>${_(e)}</li>`).join(``)}</ul></div>
          <div><span class="tag i">Interpretation</span><ul>${h.interpretation.map(e=>`<li>${_(e)}</li>`).join(``)}</ul></div>
          <div><span class="tag e">Entwurfsannahme</span><ul>${h.entwurf.map(e=>`<li>${_(e)}</li>`).join(``)}</ul></div>
        </div>
        <p class="h-disc">${_(r.disclaimer)} · <a href="${_(r.bplanUrl)}" target="_blank" rel="noopener noreferrer">Original-B-Plan Wattenheim „Ortskern“</a></p>
      </div>
    `}};export{S as HouseController,b as computeFloorAreas};
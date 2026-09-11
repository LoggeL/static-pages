import { COMPONENTS,pure } from './thermo.js';
import { CASES } from './cases.js';
import { fmt,escapeHTML as esc } from './charts.js';
document.getElementById('propertyCards').innerHTML=Object.entries(COMPONENTS).map(([id,c])=>{
  const p=pure(id,298.15);
  return `<article class="property-card"><span class="formula">${esc(c.formula)}</span><h3>${esc(c.name)}</h3><p>CAS ${esc(c.cas)}</p><dl><div><dt>Molmasse</dt><dd>${fmt(c.mw*1000,3)} g/mol</dd></div><div><dt>Normalsiedepunkt</dt><dd>${fmt(c.boilingK-273.15,2)} °C</dd></div><div><dt>Dichte, 25 °C</dt><dd>${fmt(c.mw/p.vL,1)} kg/m³</dd></div><div><dt>cp,L, 25 °C</dt><dd>${fmt(p.cpL,1)} J/(mol K)</dd></div></dl><a class="microcopy" href="${esc(c.source)}">NIST Stoffseite ↗</a></article>`;
}).join('');
document.getElementById('knowledgeCases').innerHTML=CASES.map(c=>`<article class="knowledge-case"><h3>${c.number} · ${c.name}</h3><p>${c.description} ${c.watch}</p><a href="./?case=${c.id}">Experiment starten ↗</a></article>`).join('');
try{
  const response=await fetch('./data/validation.json');if(!response.ok)throw new Error('Referenzdaten nicht verfügbar.');const report=await response.json();
  const baseline=report.cases.find(c=>c.id==='reference').initial;
  document.getElementById('defaultXD').textContent=`${fmt(baseline.xD*100,2)} %`;
  document.getElementById('defaultXB').textContent=`${fmt((1-baseline.xB)*100,2)} %`;
  document.getElementById('defaultD').textContent=fmt(baseline.D,2);
  const r=report.references;
  document.getElementById('validationDetails').innerHTML=`Im eingefrorenen Prüflauf: größte Blasenpunktabweichung zur Python-Referenz ${r.maxBubbleTemperatureK.toExponential(2)} K, größte Dampfdruckabweichung ${r.maxPsatRelative.toExponential(2)} relativ. Über alle acht 30-min-Läufe bleibt der maximale relative Gesamtstoff-Bilanzfehler bei ${Math.max(...report.cases.map(c=>c.maxErrors.mass)).toExponential(2)}, der Energie-Bilanzfehler bei ${Math.max(...report.cases.map(c=>c.maxErrors.energy)).toExponential(2)}. Das sind numerische Prüfergebnisse innerhalb des Modells.`;
}catch(error){console.warn(error.message);}

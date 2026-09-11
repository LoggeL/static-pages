export const COLORS={blue:'#89b8ff',orange:'#ffb779',mint:'#79ddc6',muted:'#768ba3',pink:'#e6a7e8'};
export const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmt=(n,d=1)=>Number.isFinite(n)?n.toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}):'–';
const nice=number=>{const power=10**Math.floor(Math.log10(Math.max(number,1e-10))),v=number/power;return (v<=1?1:v<=2?2:v<=5?5:10)*power;};

export function lineChart({series,xLabel='',yLabel='',xDomain,yDomain,markers=[],title='',reverseY=false,width=640,height=290,events=[]}){
  const all=series.flatMap(s=>s.points).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(!all.length)return '<div class="empty-chart">Die ersten Messpunkte erscheinen hier.</div>';
  const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);
  let [xmin,xmax]=xDomain??[Math.min(...xs),Math.max(...xs)];
  let [ymin,ymax]=yDomain??[Math.min(...ys),Math.max(...ys)];
  if(xmax-xmin<1e-8)xmax=xmin+1;
  if(ymax-ymin<.01){ymin-=.5;ymax+=.5;}
  if(!yDomain){const tick=nice((ymax-ymin)/4);ymin=Math.floor(ymin/tick)*tick;ymax=Math.ceil(ymax/tick)*tick;if(ymax===ymin)ymax+=tick;}
  const l=60,r=22,t=30,b=46,w=width-l-r,h=height-t-b;
  const sx=x=>l+(x-xmin)/(xmax-xmin)*w,sy=y=>reverseY?t+(y-ymin)/(ymax-ymin)*h:t+h-(y-ymin)/(ymax-ymin)*h;
  let grid='';
  for(let i=0;i<5;i++){
    const x=xmin+(xmax-xmin)*i/4,y=ymin+(ymax-ymin)*i/4;
    const dp=(ymax-ymin)<1?2:(ymax-ymin)<5?1:0;
    grid+=`<path d="M${l} ${sy(y)}H${width-r}" class="chart-grid"/><text x="${l-12}" y="${sy(y)+4}" text-anchor="end" class="chart-tick">${fmt(y,dp)}</text><text x="${sx(x)}" y="${t+h+24}" text-anchor="middle" class="chart-tick">${fmt(x,(xmax-xmin)<5?1:0)}</text>`;
  }
  const paths=series.map(s=>{
    const points=s.points.filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
    if(!points.length)return '';
    const path=points.map((p,i)=>`${i?'L':'M'}${sx(p[0]).toFixed(2)},${sy(p[1]).toFixed(2)}`).join(' ');
    return `<path d="${path}" fill="none" stroke="${s.color??COLORS.blue}" stroke-width="${s.thin?1.5:2.8}" ${s.dashed?'stroke-dasharray="6 6"':''} stroke-linecap="round" stroke-linejoin="round"><title>${escapeHTML(s.name)}</title></path>`;
  }).join('');
  const dots=markers.map(p=>`<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${p.r??5}" fill="${p.color??COLORS.orange}" stroke="#101b28" stroke-width="2"><title>${escapeHTML(p.label??'')}</title></circle>`).join('');
  const lines=events.filter(e=>e.x>=xmin&&e.x<=xmax).map(e=>`<path d="M${sx(e.x)} ${t}V${t+h}" stroke="${COLORS.muted}" stroke-dasharray="3 5" opacity=".6"><title>${escapeHTML(e.label)}</title></path>`).join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(title)}"><title>${escapeHTML(title)}</title>${grid}${lines}${paths}${dots}<text x="${l}" y="16" class="chart-label">${escapeHTML(yLabel)}</text><text x="${width-r}" y="${height-3}" text-anchor="end" class="chart-label">${escapeHTML(xLabel)}</text></svg>`;
}

function tint(f){const a=[137,184,255],b=[255,183,121];f=Math.max(0,Math.min(1,f));return `rgb(${a.map((v,j)=>Math.round(v*(1-f)+b[j]*f)).join(',')})`;}
export function processDiagram(s,selected,mode='temperature'){
  const n=s.p.trays,top=s.stages[0],bottom=s.stages.at(-1),feed=s.stages[s.p.feedTray],start=218,span=360;
  const stageY=i=>start+(i-1)*span/Math.max(1,n-1),feedY=stageY(s.p.feedTray);
  const component=mode==='composition';
  const trays=s.stages.slice(1,-1).map(t=>{
    const color=tint(component?1-t.x:(t.T-top.T)/Math.max(1,bottom.T-top.T)),y=stageY(t.i),active=t.i===selected;
    return `<g class="tray-node ${active?'selected':''}" data-stage="${t.i}" tabindex="0" role="button" aria-label="Boden ${t.i}, ${fmt(t.T-273.15)} Grad Celsius, ${fmt(t.x*100)} mol-Prozent A"><title>Boden ${t.i}: ${fmt(t.T-273.15,2)} °C · xA ${fmt(t.x*100,2)} mol-% · ${fmt(t.M/1000,3)} kmol</title><rect x="285" y="${y-6}" width="130" height="12" rx="3" fill="${color}" opacity="${active?.8:.22}" stroke="${active?color:'none'}"/><path d="M287 ${y}H413" stroke="${color}" stroke-width="2.2"/><text x="274" y="${y+4}" text-anchor="end" fill="${active?'#f1f5fb':'#8295aa'}" font-size="10">${String(t.i).padStart(2,'0')}</text>${active?`<circle cx="428" cy="${y}" r="4" fill="${color}"/>`:''}</g>`;
  }).join('');
  const pipe=(d,color,flow,arrow='arrowBlue')=>`<path d="${d}" class="pipe-bed"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${2+Math.min(4,flow/60)}" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${arrow})"/><path d="${d}" class="flow-motion" style="--flow-duration:${Math.max(.6,3-flow/120)}s" stroke="${color}"/>`;
  const label=(x,y,head,value,unit='',color='#dce8f6')=>`<g transform="translate(${x} ${y})"><text class="diagram-label">${head}</text><text y="24" class="diagram-value" fill="${color}">${value}<tspan class="diagram-unit"> ${unit}</tspan></text></g>`;
  return `<svg class="process-svg" viewBox="0 0 700 790" role="group" aria-label="Interaktives Prozessbild. Böden sind auswählbar.">
  <defs><linearGradient id="vessel" x1="0" x2="1"><stop stop-color="#172b40"/><stop offset=".4" stop-color="#243b52"/><stop offset=".75" stop-color="#1a2b3f"/><stop offset="1" stop-color="#122237"/></linearGradient><linearGradient id="phaseTint" x2="0" y2="1"><stop stop-color="#89b8ff" stop-opacity=".08"/><stop offset="1" stop-color="#ffb779" stop-opacity=".15"/></linearGradient><marker id="arrowBlue" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L6 3L0 6" fill="none" stroke="#89b8ff" stroke-width="1.5"/></marker><marker id="arrowOrange" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L6 3L0 6" fill="none" stroke="#ffb779" stroke-width="1.5"/></marker></defs>
  <path d="M350 174V82H512V103M540 190H644M540 190V244H450V192H415M350 642V729H644M414 610H490V635M520 605V596H415" class="pipe-bed"/>
  ${pipe('M350 174V82H512V103',COLORS.blue,s.flows.topVapor)}
  <circle cx="512" cy="131" r="28" fill="#112a3b" stroke="#7fb0df" stroke-width="1.5"/><path d="M491 133l9-12 12 23 12-23 9 12" stroke="#a6cdf9" fill="none" stroke-width="1.5"/>
  <path d="M512 159V190H540" fill="none" stroke="#89b8ff" stroke-width="3"/>
  ${pipe('M540 190H644',COLORS.blue,s.flows.distillate)}
  ${pipe('M540 190V244H450V192H415',COLORS.blue,s.flows.reflux)}
  <rect x="508" y="177" width="44" height="25" rx="5" fill="#142639" stroke="#829dbd"/><rect x="511" y="${199-s.levels.drum*19}" width="38" height="${s.levels.drum*19}" rx="2" fill="#89b8ff" opacity=".4"/>
  <rect x="283" y="171" width="134" height="472" rx="53" fill="url(#vessel)" stroke="#7190b2" stroke-width="1.6"/><rect x="283" y="171" width="134" height="472" rx="53" fill="url(#phaseTint)"/><path d="M293 224V588" stroke="#9ac2ed" opacity=".13"/>
  <text x="350" y="161" text-anchor="middle" class="diagram-label">C-101</text>
  ${trays}
  <rect x="299" y="${625-s.levels.bottom*28}" width="102" height="${s.levels.bottom*28}" rx="7" fill="#ffb779" opacity=".2"/>
  ${pipe(`M46 ${feedY}H282`,COLORS.mint,s.flows.feed)}
  <circle cx="231" cy="${feedY}" r="4" fill="#79ddc6"/>
  ${pipe('M350 643V729H644',COLORS.orange,s.flows.bottom,'arrowOrange')}
  <path d="M415 611H490V635" fill="none" stroke="#b9906e" stroke-width="2"><title>Schematische Flüssigkeitsverbindung zum Verdampfer, Umlaufstrom nicht separat modelliert.</title></path>
  ${pipe('M520 605V596H417',COLORS.orange,s.flows.boilup,'arrowOrange')}
  <circle cx="520" cy="636" r="30" fill="#2e241e" stroke="#bd9678" stroke-width="1.5"/><path d="M500 636h8l5-11 9 22 6-11h12" fill="none" stroke="#ffc087" stroke-width="1.7"/>
  ${label(38,45,'KOPF · LEICHTSIEDER A',fmt(top.x*100,2),'mol-%',COLORS.blue)}
  <text x="38" y="88" class="diagram-secondary">${fmt(top.T-273.15,2)} °C · ${fmt(top.P/1e5,3)} bar</text>
  ${label(553,111,'KONDENSATOR',fmt(s.heat.cooling,3),'MW',COLORS.blue)}
  ${label(553,156,'DESTILLAT D',fmt(s.flows.distillate,1),'kmol/h',COLORS.blue)}
  ${label(466,278,'RÜCKLAUF L',fmt(s.flows.reflux,1),'kmol/h',COLORS.blue)}
  <text x="466" y="320" class="diagram-secondary">R = ${fmt(s.flows.R,2)} · Behälter ${fmt(s.levels.drum*100,0)} %</text>
  ${label(38,feedY-63,'FEED F',fmt(s.flows.feed,1),'kmol/h',COLORS.mint)}
  <text x="38" y="${feedY-20}" class="diagram-secondary">${fmt(s.p.feedX*100,1)} mol-% A · ${fmt(s.feed.T-273.15,1)} °C</text>
  <text x="38" y="${feedY+25}" class="diagram-secondary">${s.feed.phase}</text>
  ${label(38,652,'SUMPF · SCHWERSIEDER B',fmt((1-bottom.x)*100,2),'mol-%',COLORS.orange)}
  <text x="38" y="695" class="diagram-secondary">${fmt(bottom.T-273.15,2)} °C · ${fmt(bottom.P/1e5,3)} bar</text>
  ${label(559,626,'VERDAMPFER',fmt(s.heat.input,3),'MW',COLORS.orange)}
  ${label(459,690,'SUMPFABZUG B',fmt(s.flows.bottom,1),'kmol/h',COLORS.orange)}
  <text x="459" y="753" class="diagram-secondary">Sumpffüllstand ${fmt(s.levels.bottom*100,1)} %</text>
  <text x="350" y="783" text-anchor="middle" class="diagram-secondary">${n} reale Modellböden · Murphree ${fmt(s.p.efficiency*100,0)} %</text>
  </svg>`;
}

export function energyBars(heat){
  const items=[['Heizung',heat.input,COLORS.orange],['Feedenthalpie',heat.feedMW,COLORS.mint],['Kondensator',-heat.cooling,COLORS.blue],['Produkte',-heat.productsMW,'#a1aec0'],['Wärmeverlust',-heat.loss,'#e6a7e8'],['Speicherung',-heat.netMW,'#8eab91']];
  const scale=Math.max(...items.map(i=>Math.abs(i[1])),.1);
  return `<div class="energy-bars">${items.map(([name,value,color])=>`<div class="energy-row"><span>${name}</span><div class="energy-track"><i style="width:${Math.abs(value)/scale*100}%;background:${color}"></i></div><strong>${value>0?'+':''}${fmt(value,3)} <small>MW</small></strong></div>`).join('')}</div>`;
}

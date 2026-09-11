import { SYSTEMS, COMPONENTS } from './thermo.js';
import { LIMITS } from './model.js';
import { CASES, getCase } from './cases.js';
import { COLORS, escapeHTML as esc, fmt, lineChart, processDiagram, energyBars } from './charts.js';
import { sample } from './session.js';

const $=id=>document.getElementById(id);
const set=(id,value)=>{$(id).textContent=value;};
const clock=t=>[Math.floor(t/3600),Math.floor(t/60)%60,Math.floor(t)%60].map(n=>String(n).padStart(2,'0')).join(':');
const percent=n=>fmt(n*100,2);
const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
let frame=null,activeView='process',request=0,pendingSettings=null,toastTimer;
const send=(type,params={})=>{const requestId=++request;worker.postMessage({type,...params,requestId});return requestId;};
const toast=message=>{set('toast',message);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);};
const error=message=>{set('errorText',message);$('errorNotice').hidden=false;};
const edit=(patch,label)=>send('edit',{patch,label});
const stageName=(i,n)=>i===0?'Kopfbehälter':i===n-1?'Sumpf':`Boden ${String(i).padStart(2,'0')}`;
const bar=(id,n)=>{$(id).style.width=`${Math.max(0,Math.min(100,n*100))}%`;};

const controls=[
  {key:'feed',label:'Feedstrom',symbol:'F',unit:'kmol/h',step:1,digits:0},
  {key:'feedX',label:'Feedanteil A',symbol:'z',unit:'mol-%',step:1,mult:100,digits:1},
  {key:'reflux',label:'Rücklaufstrom',symbol:'L',unit:'kmol/h',step:1,digits:0},
  {key:'heatMW',label:'Heizleistung',symbol:'Q̇',unit:'MW',step:.005,digits:3,warm:true},
];
function controlMarkup(c){
  const m=c.mult??1,[min,max]=LIMITS[c.key].map(v=>v*m);
  return `<div class="control ${c.warm?'warm':''}" data-control="${c.key}"><div class="control-top"><label for="value-${c.key}"><span class="control-symbol">${c.symbol??''}</span>${c.label}</label><span class="value-with-unit"><input id="value-${c.key}" data-key="${c.key}" data-mult="${m}" type="number" min="${min}" max="${max}" step="${c.step}" aria-label="${c.label} in ${c.unit}"><span>${c.unit}</span></span></div><input id="range-${c.key}" data-key="${c.key}" data-mult="${m}" type="range" min="${min}" max="${max}" step="${c.step}" aria-label="${c.label} Schieberegler"><div class="range-bounds"><span>${fmt(min,Math.min(c.digits,2))}</span><span>${fmt(max,Math.min(c.digits,2))} ${c.unit}</span></div></div>`;
}
$('operatingControls').innerHTML=controls.map(controlMarkup).join('');
const extraControls={temperature:{key:'feedTemperature',label:'Feedtemperatur',symbol:'T',unit:'°C',step:1,digits:1},quality:{key:'feedLiquidFraction',label:'Flüssiganteil',symbol:'q',unit:'%',step:1,mult:100,digits:0}};
function syncControl(c,p){
  const number=$(`value-${c.key}`),range=$(`range-${c.key}`);if(!number)return;
  const value=p[c.key]*(c.mult??1);
  if(document.activeElement!==number&&document.activeElement!==range){number.value=Number(value.toFixed(c.digits));range.value=value;}
  range.style.setProperty('--fill',`${(Number(range.value)-Number(range.min))/(Number(range.max)-Number(range.min))*100}%`);
  number.disabled=range.disabled=c.key==='reflux'&&p.qualityAuto;
}
function controlInput(event){
  const input=event.target,key=input.dataset.key;if(!key||!frame)return;
  const isRange=input.type==='range';
  if(isRange){$(`value-${key}`).value=input.value;input.style.setProperty('--fill',`${(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100}%`);}
  else if(input.value!==''&&input.validity.valid){const range=$(`range-${key}`);range.value=input.value;range.style.setProperty('--fill',`${(Number(range.value)-Number(range.min))/(Number(range.max)-Number(range.min))*100}%`);}
  if(event.type!=='change')return;
  if(!input.checkValidity()||input.value===''){input.reportValidity();return;}
  const def=[...controls,...Object.values(extraControls)].find(c=>c.key===key);
  edit({[key]:Number(input.value)/Number(input.dataset.mult)},`${def.label}: ${fmt(Number(input.value),def.digits)} ${def.unit}`);
}
for(const event of ['input','change']){$('operatingControls').addEventListener(event,controlInput);$('feedExtra').addEventListener(event,controlInput);}

function syncControls(p){
  controls.forEach(c=>syncControl(c,p));
  if($('feedMode').value!==p.feedMode)$('feedMode').value=p.feedMode;
  if($('feedExtra').dataset.mode!==p.feedMode){$('feedExtra').dataset.mode=p.feedMode;$('feedExtra').innerHTML=extraControls[p.feedMode]?controlMarkup(extraControls[p.feedMode]):'';}
  if(extraControls[p.feedMode])syncControl(extraControls[p.feedMode],p);
  $('auto').setAttribute('aria-checked',String(p.qualityAuto));
  if(document.activeElement!==$('qualityTarget'))$('qualityTarget').value=Number((p.qualityTarget*100).toFixed(1));
  set('modeTag',p.qualityAuto?'PI-REGELUNG':'MANUELL');
  set('controllerNote',p.qualityAuto?`Gemessene Reinheit: ${percent(frame.snapshot.measured)} mol-% A. Rücklauf aktuell ${fmt(frame.snapshot.flows.reflux,1)} kmol/h.`:'Füllstandsregler für Kopfbehälter und Sumpf sind immer aktiv.');
}

function currentHistory(){
  const points=frame.history.slice();
  if(points.at(-1)?.t!==frame.snapshot.t)points.push(sample(frame.snapshot));
  return points;
}
function historySeries(metric,points){
  const definitions={
    purity:[['Kopf A','xD',100,COLORS.blue],['Sumpf B','xB',-100,COLORS.orange]],
    temperature:[['Kopf','TD',1,COLORS.blue],['Sumpf','TB',1,COLORS.orange]],
    flow:[['Feed','F',1,COLORS.mint],['Destillat','D',1,COLORS.blue],['Sumpf','B',1,COLORS.orange],['Rücklauf','L',1,COLORS.pink]],
    level:[['Kopfbehälter','drum',100,COLORS.blue],['Sumpf','bottom',100,COLORS.orange]],
    heat:[['Heizung','Q',1,COLORS.orange],['Kondensator','QC',1,COLORS.blue]],
  };
  return definitions[metric].map(([name,key,mult,color])=>({name,color,points:points.map(h=>[h.t/60,mult<0?100+h[key]*mult:h[key]*mult])}));
}
function renderMini(){
  const t=frame.snapshot.t/60,points=currentHistory().filter(h=>h.t>=Math.max(0,frame.snapshot.t-1800));
  $('miniTrend').innerHTML=lineChart({series:historySeries('purity',points),yLabel:'Reinheit / mol-%',xLabel:'Zeit / min',width:330,height:190,xDomain:[Math.max(0,t-30),Math.max(1,t)],title:'Verlauf der beiden Produktreinheiten'});
}
function renderProfile(){
  const s=frame.snapshot,key=$('profileMetric').value;
  const value=t=>key==='temperature'?t.T-273.15:key==='composition'?t.x*100:key==='holdup'?t.M/1000:t.velocity;
  const label={temperature:'Temperatur / °C',composition:'Flüssigkeit A / mol-%',holdup:'Flüssigkeitsvorrat / kmol',velocity:'Dampf, aktive Fläche / m/s'}[key];
  const series=[{name:'Aktuelles Profil',points:s.stages.map(t=>[value(t),t.i]),color:COLORS.blue}];
  if(frame.reference)series.unshift({name:frame.reference.label,points:frame.reference.snapshot.stages.map(t=>[value(t),t.i]),color:COLORS.muted,dashed:true,thin:true});
  const t=s.stages[frame.selected];
  $('profileChart').innerHTML=lineChart({series,xLabel:label,yLabel:'Stufe, Kopf = 0',yDomain:[0,s.stages.length-1],reverseY:true,width:330,height:285,markers:[{x:value(t),y:t.i,color:COLORS.orange,label:stageName(t.i,s.stages.length)}],title:'Profil über alle Stufen, Kopf oben und Sumpf unten'});
  $('clearReferenceBtn').hidden=!frame.reference;set('referenceLabel',frame.reference?.label??'');
}
function renderDetails(){
  const s=frame.snapshot,t=s.stages[frame.selected],n=s.stages.length;
  set('selectedTitle',stageName(t.i,n));
  if($('stageSelect').options.length!==n)$('stageSelect').innerHTML=s.stages.map(t=>`<option value="${t.i}">${t.i===0?'Kopf':t.i===n-1?'Sumpf':String(t.i).padStart(2,'0')}</option>`).join('');
  $('stageSelect').value=t.i;
  const details=[['Temperatur',`${fmt(t.T-273.15,2)} °C`],['Druck',`${fmt(t.P/1e5,3)} bar`],['Vorrat',`${fmt(t.M/1000,3)} kmol`],['Flüssigkeit x',`${percent(t.x)} %`],['Dampf y',t.i===0?'Kondensiert':`${percent(t.yOut)} %`],['Ideal y*',`${percent(t.y)} %`],['Flüssigkeit L',`${fmt(t.L*3.6,1)} kmol/h`],['Dampf V',`${fmt(t.V*3.6,1)} kmol/h`],['Dichte',`${fmt(t.rho,0)} kg/m³`]];
  $('stageDetails').innerHTML=details.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  if(!$('stageTableWrap').hidden)$('stageRows').innerHTML=s.stages.map(t=>`<tr class="${t.i===frame.selected?'selected':''}"><th><button class="small-button" data-stage="${t.i}">${stageName(t.i,n)}</button></th><td>${fmt(t.T-273.15,2)}</td><td>${fmt(t.P/1e5,3)}</td><td>${percent(t.x)}</td><td>${t.i?percent(t.yOut):'—'}</td><td>${fmt(t.M/1000,3)}</td><td>${fmt(t.L*3.6,2)}</td><td>${fmt(t.V*3.6,2)}</td></tr>`).join('');
}
function renderView(){
  if(!frame)return;
  const s=frame.snapshot,t=s.stages[frame.selected];
  if(activeView==='process'){
    const focus=document.activeElement.closest?.('[data-stage]'),id=focus?.dataset.stage;
    $('processDiagram').innerHTML=processDiagram(s,frame.selected,$('colorMode').value);
    if(id&&focus.closest('#processDiagram'))$('processDiagram').querySelector(`[data-stage="${id}"]`)?.focus({preventScroll:true});
  }else if(activeView==='equilibrium'){
    const curve=frame.curve;
    set('equilibriumNote',`${stageName(t.i,s.stages.length)} bei ${fmt(t.P/1e5,4)} bar. Anteile beziehen sich auf ${COMPONENTS[SYSTEMS[s.p.system].components[0]].name}, jeweils in mol-%.`);
    const markers=[{x:t.x*100,y:t.y*100,color:COLORS.blue,label:'Ideales Dampfgleichgewicht'}];
    if(t.i)markers.push({x:t.x*100,y:t.yOut*100,color:COLORS.orange,label:'Tatsächlicher Dampfaustritt'});
    $('xyChart').innerHTML=lineChart({series:[{name:'Diagonale y = x',points:[[0,0],[100,100]],color:COLORS.muted,thin:true,dashed:true},{name:'Dampfgleichgewicht',points:curve.map(p=>[p.x*100,p.y*100]),color:COLORS.mint}],markers,xDomain:[0,100],yDomain:[0,100],xLabel:'Flüssigkeit xA / mol-%',yLabel:'Dampf yA / mol-%',title:'Dampf-Flüssigkeits-Gleichgewicht',height:340});
    $('txyChart').innerHTML=lineChart({series:[{name:'Siedelinie',points:curve.map(p=>[p.x*100,p.T-273.15]),color:COLORS.blue},{name:'Taulinie',points:curve.map(p=>[p.y*100,p.T-273.15]),color:COLORS.orange}],markers:[{x:t.x*100,y:t.T-273.15,color:COLORS.blue},{x:t.y*100,y:t.T-273.15,color:COLORS.orange}],xDomain:[0,100],xLabel:'Anteil A / mol-%',yLabel:'Temperatur / °C',title:'Siedelinse am lokalen Stufendruck',height:270});
    $('azeotropeCallout').hidden=!frame.azeotrope;
    if(frame.azeotrope)$('azeotropeCallout').innerHTML=`<strong>Azeotrop am Kopfdruck: ${percent(frame.azeotrope.x)} mol-% Ethanol.</strong><p>Das entspricht ${percent(frame.azeotrope.massFraction)} Massen-% bei ${fmt(frame.azeotrope.T-273.15,2)} °C. Die Kurven oben gelten für den ausgewählten Boden, dessen Druck abweichen kann.</p>`;
  }else if(activeView==='history'){
    const metric=$('historyMetric').value,window=Number($('historyWindow').value),t=s.t/60;
    const series=historySeries(metric,currentHistory().filter(h=>h.t/60>=t-window));
    $('historyChart').innerHTML=lineChart({series,xDomain:[Math.max(0,t-window),Math.max(1,t)],xLabel:'Simulationszeit / min',yLabel:{purity:'Reinheit / mol-%',temperature:'Temperatur / °C',flow:'Stoffstrom / kmol/h',level:'Füllstand / %',heat:'Wärmeleistung / MW'}[metric],events:frame.log.filter(e=>e.t>0).map(e=>({x:e.t/60,label:e.label})),title:'Zeitverlauf der gewählten Messgrößen',height:365});
    $('historyLegend').innerHTML=series.map(line=>`<span><i class="legend-line" style="background:${line.color}"></i>${esc(line.name)}</span>`).join('');
    set('eventCount',`${frame.log.length} Einträge`);
    $('eventLog').innerHTML=frame.log.slice().reverse().map(e=>`<li><time>${clock(e.t)}</time><span>${esc(e.label)}</span></li>`).join('');
  }else{
    const b=s.balance;
    $('massBalance').innerHTML=`<div class="mass-cards">${[['Feed',s.flows.feed],['Destillat',s.flows.distillate],['Sumpf',s.flows.bottom]].map(([k,v])=>`<div class="mass-card"><span>${k}</span><strong>${fmt(v,2)}</strong> <small>kmol/h</small></div>`).join('')}</div><div class="mass-storage"><span>Akkumulation F − D − B</span><strong>${fmt(s.flows.feed-s.flows.distillate-s.flows.bottom,4)} kmol/h</strong></div><div class="mass-storage"><span>Flüssigkeitsvorrat der gesamten Kolonne</span><strong>${fmt(b.inventory.total/1000,3)} kmol</strong></div>`;
    $('energyChart').innerHTML=energyBars(s.heat);
    const metrics=[['Gesamtstoff',b.massRelative,`${b.massError.toExponential(2)} mol`],['Komponente A',b.componentRelative,`${b.componentError.toExponential(2)} mol`],['Energie',b.energyRelative,`${b.energyError.toExponential(2)} J`]];
    $('balanceMetrics').innerHTML=metrics.map(([name,rel,abs])=>`<div class="balance-metric"><span>${name}, rel. Fehler</span><strong>${Math.abs(rel).toExponential(1)}</strong><small>Absolut: ${abs}</small></div>`).join('');
  }
}

function render(){
  const s=frame.snapshot,p=s.p,top=s.stages[0],bottom=s.stages.at(-1),sys=SYSTEMS[p.system],scenario=getCase(frame.caseId);
  set('caseNumber',scenario.number);set('caseTag',frame.custom?'EIGENES EXPERIMENT':scenario.tag);set('caseTitle',scenario.name);set('caseDescription',frame.custom?`Angepasster Betrieb: ${sys.name}, ${p.trays} Böden, ${fmt(p.efficiency*100,0)} % Murphree-Effizienz. Zurücksetzen lädt die ursprüngliche Vorlage.`:scenario.description);set('watchNote',scenario.watch);
  const next=frame.events.filter(e=>!e.done).sort((a,b)=>a.at-b.at)[0];
  set('nextEvent',next?next.label:frame.events.length?'Alle Störungen ausgelöst':'Freies Experiment');
  set('eventTime',next?`in ${fmt(Math.max(0,next.at-s.t),0)} s bei ${clock(next.at)}`:'Du bestimmst die Stellgrößen.');
  set('clock',clock(s.t));$('play').disabled=false;set('playGlyph',frame.playing?'Ⅱ':'▶');set('playText',frame.playing?'Pausieren':'Fortsetzen');$('play').setAttribute('aria-label',frame.playing?'Simulation pausieren':'Simulation fortsetzen');
  $('speed').value=frame.speed;document.body.classList.toggle('is-paused',!frame.playing);
  const cooling=s.heat.cooling/s.heat.capacity;
  const warn=cooling>.9;
  set('stateBadge',!frame.playing?'Pausiert':warn?'Kühlreserve < 10 %':s.maxChange<1e-7?'Nahe stationär':'Dynamischer Betrieb');
  $('stateBadge').className=`state-pill ${!frame.playing?'paused':warn?'warn':''}`;
  set('lightName',COMPONENTS[sys.components[0]].name);set('heavyName',COMPONENTS[sys.components[1]].name);
  set('kpiXD',percent(top.x));set('kpiXB',percent(1-bottom.x));set('kpiTD',`${fmt(top.T-273.15,2)} °C`);set('kpiTB',`${fmt(bottom.T-273.15,2)} °C`);
  const recovery=s.flows.distillate*top.x/(p.feed*p.feedX);
  set('recovery',`A-Ausbeute ${fmt(recovery*100,1)} %`);$('recovery').title='Momentanes Verhältnis D·xD / (F·zA). Bei Entleerung des Vorrats vorübergehend über 100 % möglich.';
  set('bottomFlow',`Abzug ${fmt(s.flows.bottom,1)} kmol/h`);set('kpiD',fmt(s.flows.distillate,2));set('ratio',`R = ${fmt(s.flows.R,2)}`);set('feedSummary',`Feed ${fmt(p.feed,0)} kmol/h`);
  set('kpiQ',fmt(s.heat.input,3));set('coolingSummary',`Kühlung ${fmt(s.heat.cooling,3)} MW`);set('specificEnergy',`${fmt(s.heat.input*1000/Math.max(.001,s.flows.distillate),1)} kWh/kmol D`);
  bar('barD',top.x);bar('barB',1-bottom.x);bar('barSplit',s.flows.distillate/p.feed);bar('barQ',s.heat.input/5);
  set('modelLabel',`${sys.name.toUpperCase()} · ${sys.model.toUpperCase()}`);
  syncControls(p);renderMini();renderProfile();renderDetails();renderView();
}
worker.onmessage=({data})=>{
  if(data.type==='error'){
    error(data.message);
    if(data.requestId===pendingSettings){set('settingsError',data.message);$('applySettings').disabled=false;pendingSettings=null;}
  }else if(data.type==='export'){download(JSON.stringify(data.data,null,2),'application/json',`rectify-${frame.caseId}-${Math.floor(frame.snapshot.t)}s.json`);toast('Simulationslauf gespeichert.');}
  else if(data.type==='state'){
    frame=data;render();
    if(data.requestId===pendingSettings){$('settingsDialog').close();$('applySettings').disabled=false;pendingSettings=null;toast('Neuer Betriebspunkt berechnet.');}
  }
};
worker.onerror=event=>error(`Die Berechnung konnte nicht ausgeführt werden: ${event.message||'Worker nicht erreichbar. Bitte die Seite über HTTP oder HTTPS öffnen.'}`);

function showView(view){
  activeView=view;
  document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===view;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;$(`view-${button.dataset.view}`).hidden=!active;});
  renderView();
}
document.querySelectorAll('[data-view]').forEach(button=>{
  button.tabIndex=button.dataset.view===activeView?0:-1;
  button.onclick=()=>showView(button.dataset.view);
  button.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=Array.from(document.querySelectorAll('[data-view]')),i=tabs.indexOf(button),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].focus();showView(tabs[next].dataset.view);};
});
$('play').onclick=()=>frame&&send('play',{playing:!frame.playing});
$('reset').onclick=()=>frame&&send('case',{id:frame.caseId});
$('speed').onchange=()=>send('speed',{speed:Number($('speed').value)});
$('dismissError').onclick=()=>$('errorNotice').hidden=true;
$('feedMode').onchange=()=>edit({feedMode:$('feedMode').value},'Feedzustand geändert.');
$('auto').onclick=()=>frame&&edit({qualityAuto:!frame.snapshot.p.qualityAuto},frame.snapshot.p.qualityAuto?'Reinheitsregler ausgeschaltet.':'Reinheitsregler eingeschaltet.');
$('qualityTarget').onchange=()=>{if($('qualityTarget').reportValidity())edit({qualityTarget:Number($('qualityTarget').value)/100},`Sollreinheit: ${$('qualityTarget').value} mol-% A`);};
for(const id of ['colorMode','profileMetric','historyMetric','historyWindow'])$(id).onchange=()=>{if(frame){renderView();renderProfile();}};
$('stageSelect').onchange=()=>send('select',{stage:Number($('stageSelect').value)});
document.addEventListener('click',event=>{const stage=event.target.closest('[data-stage]');if(stage)send('select',{stage:Number(stage.dataset.stage)});});
$('processDiagram').addEventListener('keydown',event=>{const stage=event.target.closest('[data-stage]');if(stage&&['Enter',' '].includes(event.key)){event.preventDefault();send('select',{stage:Number(stage.dataset.stage)});}});
$('rememberBtn').onclick=()=>{send('remember');toast('Aktuelles Profil als Referenz hinterlegt.');};
$('clearReferenceBtn').onclick=()=>send('clearReference');
$('toggleTable').onclick=()=>{const open=$('stageTableWrap').hidden;$('stageTableWrap').hidden=!open;$('toggleTable').setAttribute('aria-expanded',String(open));set('toggleTable',open?'Tabelle schließen':'Tabelle öffnen');if(frame)renderDetails();};
document.querySelectorAll('[data-disturb]').forEach(button=>button.onclick=()=>{
  if(!frame)return;const p=frame.snapshot.p;
  const actions={feed:[{feed:Math.min(180,p.feed*1.2)},'Feed um 20 % erhöht.'],composition:[{feedX:Math.max(.02,p.feedX-.05)},'Feedanteil A um 5 Prozentpunkte gesenkt.'],heat:[{heatMW:Math.min(5,p.heatMW*1.08)},'Heizleistung um 8 % erhöht.'],cold:[{feedMode:'temperature',feedTemperature:40},'Feedtemperatur auf 40 °C gestellt.']};
  edit(...actions[button.dataset.disturb]);
});

for(const [button,dialog] of [['scenariosBtn','scenariosDialog'],['exportBtn','exportDialog']])$(button).onclick=()=>$(dialog).showModal();
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$(button.dataset.close).close());
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();}}));
$('scenarioCards').innerHTML=CASES.map(c=>`<button class="scenario-card" data-case="${c.id}"><div class="scenario-top"><span class="scenario-number">${c.number}</span><span class="tiny-tag">${c.tag}</span></div><h3>${c.name}</h3><p>${c.description}</p><div class="scenario-bottom"><span>${SYSTEMS[c.params.system??'benzene-toluene'].name}</span><span>${c.params.trays??18} Böden ↗</span></div></button>`).join('');
$('scenarioCards').onclick=event=>{const button=event.target.closest('[data-case]');if(button){send('case',{id:button.dataset.case});$('scenariosDialog').close();$('errorNotice').hidden=true;const url=new URL(location.href);url.searchParams.set('case',button.dataset.case);history.replaceState(null,'',url);}};

const fields={
  structureSettings:[['system','Stoffsystem'],['trays','Reale Böden','',1],['feedTray','Feedboden','',1],['pressureBar','Kopfdruck','bar',.001],['pressureDropMbar','Druckverlust je Boden','mbar',.1],['efficiency','Murphree-Effizienz','%',1,100],['diameter','Kolonnendurchmesser','m',.01],['feed','Feedstrom','kmol/h',1],['feedX','Feedanteil A','mol-%',.1,100],['reflux','Rücklauf','kmol/h',1],['heatMW','Heizleistung','MW',.005]],
  thermalSettings:[['steamTemperature','Heizmedium','°C',1],['reboilerUA','Verdampfer UA','kW/K',1,.001],['coolingWater','Kühlwasserstrom','m³/h',1],['coolingTemperature','Kühlwasser ein','°C',1],['condenserUA','Kondensator UA','kW/K',1,.001],['wallCapacity','Wärmekapazität je Boden','kJ/K',1,.001],['drumWallCapacity','Wärmekapazität Kopf','kJ/K',1,.001],['bottomWallCapacity','Wärmekapazität Sumpf','kJ/K',1,.001],['lossUA','Wärmeverlust je Stufe UA','W/K',1],['ambient','Umgebung','°C',1],['heatTime','Heizungszeitkonstante','s',1]],
  advancedSettings:[['activeFraction','Aktive Bodenfläche','%',1,100],['weirHeight','Wehrhöhe','mm',1,1000],['weirLength','Wehrlänge','m',.01],['traySpacing','Bodenabstand','m',.01],['drumVolume','Volumen Kopfbehälter','m³',.1],['bottomVolume','Sumpfvolumen','m³',.1],['drumTarget','Sollfüllstand Kopf','%',1,100],['bottomTarget','Sollfüllstand Sumpf','%',1,100],['valveTime','Ventilzeitkonstante','s',1],['levelGain','Füllstandsregler Kp','',.1],['levelTime','Füllstandsregler Ti','s',1],['measurementTime','Reinheitsmessung Filter','s',1],['qualityGain','Reinheitsregler Kp','kmol/h',10],['qualityTime','Reinheitsregler Ti','s',10]],
};
$('settingsBtn').onclick=()=>{
  if(!frame)return;
  for(const [group,defs] of Object.entries(fields))$(group).innerHTML=defs.map(([key,label,unit='',step=1,mult=1])=>`<div class="field"><label for="config-${key}">${label}${unit?` / ${unit}`:''}</label>${key==='system'?`<select id="config-system" name="system">${Object.values(SYSTEMS).map(s=>`<option value="${s.id}" ${frame.snapshot.p.system===s.id?'selected':''}>${s.name} (${s.model})</option>`).join('')}</select>`:`<input id="config-${key}" name="${key}" data-mult="${mult}" type="number" min="${LIMITS[key][0]*mult}" max="${LIMITS[key][1]*mult}" step="${step}" value="${Number((frame.snapshot.p[key]*mult).toFixed(6))}" required>`}</div>`).join('');
  set('settingsError','');$('settingsDialog').showModal();
  for(const input of $('settingsForm').querySelectorAll('input'))if(!['trays','feedTray'].includes(input.name))input.step='any';
};
$('settingsForm').onsubmit=event=>{
  event.preventDefault();if(!frame||!$('settingsForm').reportValidity())return;
  const params={...frame.snapshot.p};
  for(const input of $('settingsForm').querySelectorAll('[name]'))params[input.name]=input.name==='system'?input.value:Number(input.value)/Number(input.dataset.mult);
  $('applySettings').disabled=true;set('settingsError','Betriebspunkt wird berechnet …');
  pendingSettings=send('configure',{params});
};

function download(content,type,name){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('exportJSON').onclick=()=>frame&&send('export');
$('exportCSV').onclick=()=>{
  if(!frame)return;
  const headers=['Zeit_s','Kopf_A_molProzent','Sumpf_B_molProzent','Kopf_C','Sumpf_C','Feed_kmol_h','Destillat_kmol_h','Sumpf_kmol_h','Ruecklauf_kmol_h','Dampf_Sumpf_kmol_h','Heizung_MW','Kondensator_MW','Kopf_Fuellstand_Prozent','Sumpf_Fuellstand_Prozent','Mengenfehler_relativ','Energiefehler_relativ'];
  const rows=currentHistory().map(h=>[h.t,h.xD*100,(1-h.xB)*100,h.TD,h.TB,h.F,h.D,h.B,h.L,h.V,h.Q,h.QC,h.drum*100,h.bottom*100,h.massError,h.energyError].map(v=>String(Number(v.toPrecision(12))).replace('.',',')).join(';'));
  download('\uFEFF'+headers.join(';')+'\r\n'+rows.join('\r\n'),'text/csv;charset=utf-8',`rectify-${frame.caseId}-trend.csv`);toast('Trenddaten exportiert.');
};
$('importJSON').onclick=()=>$('fileInput').click();
$('fileInput').onchange=async()=>{const file=$('fileInput').files[0];if(!file)return;try{if(file.size>8e6)throw new Error('Die Datei darf höchstens 8 MB groß sein.');const data=JSON.parse(await file.text());send('import',{data});$('exportDialog').close();}catch(e){error(e.message);}$('fileInput').value='';};
for(const [id,type] of [['steadyBtn','steady'],['mixedBtn','mixed']])$(id).onclick=()=>{send(type);$('exportDialog').close();};
document.addEventListener('visibilitychange',()=>{send('visibility',{visible:!document.hidden});$('backgroundNotice').hidden=!document.hidden;});
document.addEventListener('keydown',event=>{if(event.code==='Space'&&!event.repeat&&!event.target.closest('input,select,button,textarea,dialog,[role=button]')&&frame){event.preventDefault();send('play',{playing:!frame.playing});}});
send('case',{id:getCase(new URLSearchParams(location.search).get('case')).id});
send('visibility',{visible:!document.hidden});

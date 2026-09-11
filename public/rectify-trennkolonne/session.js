import { ColumnModel, validateParams } from './model.js';
import { getCase, caseParams } from './cases.js';
import { azeotrope } from './thermo.js';

export function sample(s){return {t:s.t,xD:s.stages[0].x,xB:s.stages.at(-1).x,TD:s.stages[0].T-273.15,TB:s.stages.at(-1).T-273.15,F:s.flows.feed,D:s.flows.distillate,B:s.flows.bottom,L:s.flows.reflux,V:s.flows.boilup,Q:s.heat.input,QC:s.heat.cooling,drum:s.levels.drum,bottom:s.levels.bottom,target:s.p.qualityTarget,massError:s.balance.massRelative,energyError:s.balance.energyRelative};}

export class SimulationSession {
  constructor(id='reference',params){
    this.caseId=id;this.custom=!!params;this.model=new ColumnModel(params??caseParams(id));this.model.solveSteady();
    this.history=[];this.log=[];this.events=params?[]:getCase(id).events.map(e=>({...e,patch:{...e.patch},done:false}));
    this.reference=null;this.record();this.log.push({t:0,label:'Stationärer Betriebspunkt berechnet.'});
    this.azeotrope=azeotrope(this.model.p.system,this.model.pressure(0));
  }
  record(){const point=sample(this.model.snapshot());if(this.history.at(-1)?.t===point.t)this.history[this.history.length-1]=point;else this.history.push(point);if(this.history.length>3601)this.history.splice(0,this.history.length-3601);}
  applyDue(){for(const event of this.events.filter(e=>!e.done&&e.at<=this.model.t+1e-7)){this.model.operating(event.patch);event.done=true;this.log.push({t:this.model.t,label:event.label});}}
  advance(seconds){
    if(!Number.isFinite(seconds)||seconds<0||seconds>36000)throw new Error('Ungültiger Zeitschritt.');
    const target=this.model.t+seconds;
    this.applyDue();
    while(this.model.t<target-1e-8){
      const nextEvent=Math.min(...this.events.filter(e=>!e.done).map(e=>e.at),Infinity);
      const nextSample=(Math.floor((this.model.t+1e-7)/5)+1)*5;
      const until=Math.min(target,nextEvent,nextSample);
      this.model.advance(until-this.model.t);
      this.applyDue();
      if(Math.abs(this.model.t-nextSample)<1e-6)this.record();
    }
  }
  edit(patch,label){this.model.operating(patch);this.custom=true;this.log.push({t:this.model.t,label:label??'Stellgrößen geändert.'});if(this.log.length>200)this.log.shift();}
  frame(selected=1){
    const s=this.model.snapshot();const stage=Math.max(0,Math.min(this.model.n-1,selected));
    return {snapshot:s,caseId:this.caseId,custom:this.custom,history:this.history,log:this.log,events:this.events,reference:this.reference,azeotrope:this.azeotrope,curve:this.model.curves[stage].nodes.map(p=>({x:p.x,y:p.y,T:p.T})),selected:stage};
  }
  remember(){const s=this.model.snapshot();this.reference={label:`Referenz bei ${(s.t/60).toFixed(1)} min`,snapshot:s};}
  save(){return {format:'rectify-session-v2',model:this.model.save(),caseId:this.caseId,custom:this.custom,events:this.events,history:this.history,log:this.log};}
  static restore(data){
    if(data?.format!=='rectify-session-v2')throw new Error('Diese Datei ist kein RECTIFY-2-Lauf. Alte Dateien mit hypothetischen Stoffen sind nicht direkt übertragbar.');
    const model=ColumnModel.restore(data.model);
    if(!Array.isArray(data.events)||data.events.length>20||!Array.isArray(data.history)||data.history.length>3601||!Array.isArray(data.log)||data.log.length>200)throw new Error('Ungültiger Laufverlauf.');
    const events=data.events.map(e=>{
      if(!Number.isFinite(e.at)||e.at<0||e.at>86400||typeof e.label!=='string'||e.label.length>120||typeof e.done!=='boolean'||!e.patch||typeof e.patch!=='object')throw new Error('Ungültiges Ereignis.');
      const permitted=['feed','feedX','feedMode','feedTemperature','feedLiquidFraction','heatMW','reflux','qualityAuto','qualityTarget'];
      if(Object.keys(e.patch).some(k=>!permitted.includes(k)))throw new Error('Unzulässige Ereignis-Stellgröße.');
      validateParams({...model.p,...e.patch});if(!e.done&&e.at<model.t-1e-6)throw new Error('Offenes Ereignis liegt in der Vergangenheit.');
      if(e.done&&e.at>model.t+1e-6)throw new Error('Ausgeführtes Ereignis liegt in der Zukunft.');
      return {...e,patch:{...e.patch}};
    });
    let previous=-1;
    const keys=Object.keys(sample(model.snapshot()));
    const history=data.history.map(h=>{
      if(keys.some(k=>!Number.isFinite(h[k]))||h.t<previous||h.t<0||h.t>model.t+1e-6)throw new Error('Ungültige Trenddaten.');
      if(h.xD<0||h.xD>1||h.xB<0||h.xB>1)throw new Error('Ungültige Trendzusammensetzung.');
      previous=h.t;return Object.fromEntries(keys.map(k=>[k,h[k]]));
    });
    const log=data.log.map(e=>{
      if(!Number.isFinite(e.t)||e.t<0||e.t>model.t+1e-6||typeof e.label!=='string'||e.label.length>160)throw new Error('Ungültiges Ereignisprotokoll.');
      return {t:e.t,label:e.label};
    });
    const session=Object.create(SimulationSession.prototype);
    Object.assign(session,{model,caseId:getCase(data.caseId).id,custom:data.custom===true,events,history,log,reference:null,azeotrope:azeotrope(model.p.system,model.pressure(0))});
    return session;
  }
}

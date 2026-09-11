import { SYSTEMS, COMPONENTS, SaturationCurve, feedState, vapor, bounded, GAS_R, T_REF } from './thermo.js';

const KPH = 1000/3600;
export const DEFAULTS = Object.freeze({
  system:'benzene-toluene', trays:18, feedTray:10, pressureBar:1.01325, pressureDropMbar:4,
  feed:80, feedX:.5, feedMode:'saturated', feedTemperature:80, feedLiquidFraction:1,
  reflux:120, heatMW:1.395, efficiency:.75, diameter:1.4, activeFraction:.8,
  weirHeight:.035, weirLength:.98, traySpacing:.5, drumVolume:1, bottomVolume:1.5,
  drumTarget:.5, bottomTarget:.5, wallCapacity:50000, drumWallCapacity:40000, bottomWallCapacity:100000,
  lossUA:4, ambient:22, steamTemperature:160, reboilerUA:60000,
  coolingWater:100, coolingTemperature:20, condenserUA:70000,
  heatTime:15, valveTime:5, measurementTime:15, levelGain:2, levelTime:90,
  qualityAuto:false, qualityTarget:.97, qualityGain:250, qualityTime:600,
});
export const LIMITS = Object.freeze({
  trays:[6,32],feedTray:[1,32],pressureBar:[.5,1.8],pressureDropMbar:[0,12],
  feed:[10,180],feedX:[.02,.98],feedTemperature:[10,145],feedLiquidFraction:[0,1],
  reflux:[5,500],heatMW:[.05,5],efficiency:[.35,1],diameter:[.8,2.8],activeFraction:[.5,.9],
  weirHeight:[.015,.09],weirLength:[.3,2.4],traySpacing:[.3,.9],drumVolume:[.3,4],bottomVolume:[.4,6],
  drumTarget:[.2,.8],bottomTarget:[.2,.8],wallCapacity:[0,200000],drumWallCapacity:[0,300000],bottomWallCapacity:[0,500000],
  lossUA:[0,50],ambient:[0,45],steamTemperature:[115,210],reboilerUA:[10000,250000],
  coolingWater:[10,300],coolingTemperature:[5,60],condenserUA:[10000,300000],
  heatTime:[1,120],valveTime:[1,60],measurementTime:[1,120],levelGain:[.2,8],levelTime:[10,600],
  qualityTarget:[.1,.999],qualityGain:[0,1500],qualityTime:[30,3600],
});
const STRUCTURAL = ['system','trays','feedTray','pressureBar','pressureDropMbar','efficiency','diameter','activeFraction','weirHeight','weirLength','traySpacing','drumVolume','bottomVolume','wallCapacity','drumWallCapacity','bottomWallCapacity'];

export function validateParams(input) {
  const p={...DEFAULTS,...input};
  if(!SYSTEMS[p.system]) throw new Error('Unbekanntes Stoffsystem.');
  for(const [key,[min,max]] of Object.entries(LIMITS)) if(!Number.isFinite(p[key])||p[key]<min||p[key]>max) throw new Error(`${key}: zulässiger Bereich ${min} bis ${max}.`);
  if(!Number.isInteger(p.trays)||!Number.isInteger(p.feedTray)||p.feedTray>p.trays) throw new Error('Feedboden muss innerhalb der Kolonne liegen.');
  if(!['saturated','temperature','quality'].includes(p.feedMode)) throw new Error('Ungültiger Feedzustand.');
  if(typeof p.qualityAuto!=='boolean') throw new Error('Ungültiger Reglermodus.');
  if(p.weirLength>p.diameter) throw new Error('Die Wehrlänge darf den Kolonnendurchmesser nicht überschreiten.');
  return p;
}

export class ModelLimit extends Error { constructor(message) {super(message);this.name='ModelLimit';} }

function linearSolve(matrix, rhs) {
  const n=rhs.length,a=matrix.map((row,i)=>Float64Array.from([...row,rhs[i]]));
  for(let k=0;k<n;k++) {
    let pivot=k;for(let i=k+1;i<n;i++) if(Math.abs(a[i][k])>Math.abs(a[pivot][k]))pivot=i;
    if(Math.abs(a[pivot][k])<1e-13) throw new Error('Singuläre Matrix beim Betriebspunkt.');
    [a[k],a[pivot]]=[a[pivot],a[k]];
    for(let i=k+1;i<n;i++){const f=a[i][k]/a[k][k];for(let j=k+1;j<=n;j++)a[i][j]-=f*a[k][j];}
  }
  const x=new Float64Array(n);
  for(let i=n-1;i>=0;i--){let v=a[i][n];for(let j=i+1;j<n;j++)v-=a[i][j]*x[j];x[i]=v/a[i][i];}
  return x;
}
const maxabs = values => Math.max(...Array.from(values,Math.abs));
const sum = values => values.reduce((a,b)=>a+b,0);

// Dormand–Prince 5(4). The ledgers use the very same stages as the inventories.
const RK_A=[[],[1/5],[3/40,9/40],[44/45,-56/15,32/9],[19372/6561,-25360/2187,64448/6561,-212/729],[9017/3168,-355/33,46732/5247,49/176,-5103/18656],[35/384,0,500/1113,125/192,-2187/6784,11/84]];
const RK_B=[35/384,0,500/1113,125/192,-2187/6784,11/84,0];
const RK_E=RK_B.map((v,i)=>v-[5179/57600,0,7571/16695,393/640,-92097/339200,187/2100,1/40][i]);

export class ColumnModel {
  constructor(input={},options={}) {
    this.p=validateParams(input);this.n=this.p.trays+2;this.t=0;this.stepSize=.2;
    this.rtol=options.rtol??2e-8;this.maxStep=options.maxStep??2;
    this.stats={accepted:0,rejected:0,minStep:null,maxStep:0};
    this.curves=Array.from({length:this.n},(_,i)=>new SaturationCurve(this.p.system,this.pressure(i)));
    this._feed=this.makeFeed();this._biasFeed=this.p.feed;this._qualityBias=this.p.reflux;
    const c=2*this.n;
    this.i={heat:c,d:c+1,b:c+2,l:c+3,id:c+4,ib:c+5,measured:c+6,iq:c+7,feed:c+8,dist:c+9,bottom:c+10,feedA:c+11,distA:c+12,bottomA:c+13,energy:c+14,heating:c+15,cooling:c+16,loss:c+17};
    this.state=new Float64Array(c+18);
    this.resetMixed();
  }
  pressure(i){return (this.p.pressureBar+Math.max(0,i-1)*this.p.pressureDropMbar/1000)*100000;}
  area(){return Math.PI*this.p.diameter**2/4*this.p.activeFraction;}
  makeFeed(){return feedState(this.p.system,this.pressure(this.p.feedTray),this.p.feedX,this.p.feedTemperature,this.p.feedMode,this.p.feedLiquidFraction);}
  capacity(i){return i===0?this.p.drumWallCapacity:i===this.n-1?this.p.bottomWallCapacity:this.p.wallCapacity;}
  heatAvailable(T){return Math.max(0,this.p.reboilerUA*(this.p.steamTemperature+273.15-T))/1e6;}
  hydraulicM(flow,sat){const volumeFlow=flow*sat.v,over=(Math.max(0,volumeFlow)/(1.84*this.p.weirLength))**(2/3);return this.area()*(this.p.weirHeight+over)/sat.v;}
  resetLedger(){for(const key of ['feed','dist','bottom','feedA','distA','bottomA','energy','heating','cooling','loss'])this.state[this.i[key]]=0;this.initial=this.inventory(this.state);this.t=0;this.stats={accepted:0,rejected:0,minStep:null,maxStep:0};}
  resetMixed(){
    const p=this.p,i=this.i,s=this.state; s.fill(0);
    for(let j=0;j<this.n;j++){
      const sat=this.curves[j].at(p.feedX);
      const M=j===0?p.drumVolume*p.drumTarget/sat.v:j===this.n-1?p.bottomVolume*p.bottomTarget/sat.v:this.hydraulicM((p.reflux+(j>=p.feedTray?p.feed:0))*KPH,sat);
      s[2*j]=M;s[2*j+1]=M*p.feedX;
    }
    s[i.heat]=Math.min(p.heatMW,this.heatAvailable(this.curves[this.n-1].at(p.feedX).T));s[i.d]=p.feed*.5;s[i.b]=p.feed*.5;s[i.l]=p.reflux;s[i.measured]=p.feedX;
    this.resetLedger();
  }
  inventory(s){
    let total=0,A=0,energy=0;
    for(let j=0;j<this.n;j++){const M=s[2*j],x=s[2*j+1]/M,sat=this.curves[j].at(x);total+=M;A+=s[2*j+1];energy+=M*sat.h+this.capacity(j)*(sat.T-T_REF);}
    return {total,A,energy};
  }
  operating(patch){
    if(Object.keys(patch).some(key=>STRUCTURAL.includes(key)))throw new Error('Geometrie und Stoffsystem über einen neuen Betriebspunkt übernehmen.');
    if(Object.keys(patch).some(key=>!(key in DEFAULTS)))throw new Error('Unbekannte Stellgröße.');
    const previous=this.p,previousFeed=this._feed,previousQualityBias=this._qualityBias,previousIQ=this.state[this.i.iq];
    try{
      this.p=validateParams({...this.p,...patch});this._feed=this.makeFeed();
      if(patch.qualityAuto===true&&!previous.qualityAuto){this._qualityBias=this.state[this.i.l];this.state[this.i.iq]=-this.p.qualityGain*(this.p.qualityTarget-this.state[this.i.measured]);}
      if(patch.reflux!==undefined)this._qualityBias=patch.reflux;
      this.evaluate(this.state);
    }catch(error){this.p=previous;this._feed=previousFeed;this._qualityBias=previousQualityBias;this.state[this.i.iq]=previousIQ;throw error;}
  }
  evaluate(s,withDerivatives=true){
    const p=this.p,n=this.n,ii=this.i,F=p.feed*KPH;
    const stages=Array.from({length:n},(_,j)=>{
      const M=s[2*j],A=s[2*j+1];
      if(!Number.isFinite(M)||M<1 || A< -1e-6 || A>M+1e-6)throw new ModelLimit('Flüssigkeitsvorrat oder Zusammensetzung außerhalb des gültigen Bereichs.');
      const x=A/M,sat=this.curves[j].at(x);
      return {i:j,M,x,...sat,K:sat.dh+this.capacity(j)/M*sat.dT,L:0,V:0};
    });
    for(let j=n-1;j>=1;j--){const t=stages[j];t.yOut=j===n-1?t.y:p.efficiency*t.y+(1-p.efficiency)*stages[j+1].yOut;t.hV=vapor(p.system,t.T,t.yOut).h;}
    const L=Math.max(0,s[ii.l])*KPH,D=Math.max(0,s[ii.d])*KPH,B=Math.max(0,s[ii.b])*KPH;
    stages[0].L=L;stages[n-1].L=B;
    for(let j=1;j<n-1;j++){
      const t=stages[j];t.height=t.M*t.v/this.area();
      t.L=1.84*p.weirLength*Math.max(0,t.height-p.weirHeight)**1.5/t.v;
      if(t.height>=p.traySpacing*.85)throw new ModelLimit('Flüssigkeit staut sich bis zum nächsten Boden. Die einfache Wehrhydraulik ist hier nicht mehr gültig.');
    }
    const Q=Math.min(Math.max(0,s[ii.heat]),this.heatAvailable(stages[n-1].T))*1e6;
    let totalLoss=0;
    for(let j=n-1;j>=1;j--){
      const t=stages[j],upper=stages[j-1],below=stages[j+1],fi=j===p.feedTray?F:0;
      const loss=p.lossUA*(t.T-273.15-p.ambient);t.loss=loss;totalLoss+=loss;
      const supply=upper.L*(upper.h-t.h-t.K*(upper.x-t.x))+(below?below.V*(below.hV-t.h-t.K*(below.yOut-t.x)):0)+fi*(this._feed.h-t.h-t.K*(p.feedX-t.x))+(j===n-1?Q:0)-loss;
      const denominator=t.hV-t.h-t.K*(t.yOut-t.x);
      if(!Number.isFinite(denominator)||denominator<1000)throw new ModelLimit('Die reduzierte Energiebilanz ist an diesem Betriebspunkt nicht lösbar.');
      t.V=supply/denominator;
      if(t.V< -1e-6)throw new ModelLimit('Ein Boden würde vollständig unterkühlen. Dieses Modell beschreibt eine gefüllte, siedende Kolonne: Heizleistung erhöhen oder Feed vorwärmen.');
      t.V=Math.max(0,t.V);
    }
    const top=stages[0],first=stages[1],bottom=stages[n-1];
    const topLoss=p.lossUA*(top.T-273.15-p.ambient);top.loss=topLoss;totalLoss+=topLoss;
    const cooling=first.V*(first.hV-top.h-top.K*(first.yOut-top.x))-topLoss;
    const waterHeatCapacity=p.coolingWater/3.6*4180;
    const coolingCapacity=waterHeatCapacity*Math.max(0,top.T-273.15-p.coolingTemperature)*(1-Math.exp(-p.condenserUA/waterHeatCapacity));
    if(cooling>coolingCapacity*1.001)throw new ModelLimit('Die Kühlleistung reicht für Totalkondensation bei diesem Druck nicht aus. Kühlwasserstrom erhöhen, Kühlwasser abkühlen oder Heizleistung senken.');
    if(cooling< -1)throw new ModelLimit('Der Rücklaufbehälter würde zusätzliche Wärme benötigen; der gesättigte Totalkondensator ist für diesen Zustand nicht gültig.');
    const derivative=new Float64Array(s.length);
    for(let j=0;j<n;j++){
      const t=stages[j],upper=stages[j-1],below=stages[j+1];
      let mass,component,energy;
      if(j===0){mass=first.V-L-D;component=first.V*first.yOut-(L+D)*top.x;energy=first.V*first.hV-(L+D)*top.h-cooling-topLoss;}
      else{
        const fi=j===p.feedTray?F:0,vin=below?.V??0,yin=below?.yOut??0,hvin=below?.hV??0;
        mass=upper.L+vin+fi-t.L-t.V;
        component=upper.L*upper.x+vin*yin+fi*p.feedX-t.L*t.x-t.V*t.yOut;
        energy=upper.L*upper.h+vin*hvin+fi*this._feed.h-t.L*t.h-t.V*t.hV+(j===n-1?Q:0)-t.loss;
      }
      derivative[2*j]=mass;derivative[2*j+1]=component;
      t.dx=(component-t.x*mass)/t.M;t.dM=mass;t.energyResidual=energy-(t.h*mass+t.K*(component-t.x*mass));
      t.energyFlow=energy;
      t.rho=(t.x*COMPONENTS[SYSTEMS[p.system].components[0]].mw+(1-t.x)*COMPONENTS[SYSTEMS[p.system].components[1]].mw)/t.v;
      t.velocity=j? t.V*GAS_R*t.T/t.P/this.area():0;
    }
    const levelD=top.M*top.v/p.drumVolume,levelB=bottom.M*bottom.v/p.bottomVolume;
    if(levelD>.98||levelB>.98||levelD<.02||levelB<.02)throw new ModelLimit('Ein Behälter erreicht seine Füllgrenze. Abzüge, Feed und Füllstandsregler prüfen.');
    const level=(error,intIndex,bias,valveIndex)=>{
      const raw=bias+p.feed*p.levelGain*error+s[intIndex],limit=Math.max(300,3*p.feed),target=bounded(raw,0,limit);
      const rate=p.feed*p.levelGain/p.levelTime*error;
      derivative[intIndex]=(raw>=0&&raw<=limit)||(raw<0&&rate>0)||(raw>limit&&rate<0)?rate:0;
      derivative[valveIndex]=(target-s[valveIndex])/p.valveTime;
    };
    level(levelD-p.drumTarget,ii.id,this._biasFeed*.5,ii.d);
    level(levelB-p.bottomTarget,ii.ib,this._biasFeed*.5,ii.b);
    derivative[ii.heat]=(Math.min(p.heatMW,this.heatAvailable(bottom.T))-s[ii.heat])/p.heatTime;
    derivative[ii.measured]=(top.x-s[ii.measured])/p.measurementTime;
    let refluxTarget=p.reflux;
    if(p.qualityAuto){
      const error=p.qualityTarget-s[ii.measured],raw=this._qualityBias+p.qualityGain*error+s[ii.iq],rate=p.qualityGain/p.qualityTime*error;
      refluxTarget=bounded(raw,5,500);
      derivative[ii.iq]=(raw>=5&&raw<=500)||(raw<5&&rate>0)||(raw>500&&rate<0)?rate:0;
    }
    derivative[ii.l]=(refluxTarget-s[ii.l])/p.valveTime;
    derivative[ii.feed]=F;derivative[ii.dist]=D;derivative[ii.bottom]=B;
    derivative[ii.feedA]=F*p.feedX;derivative[ii.distA]=D*top.x;derivative[ii.bottomA]=B*bottom.x;
    derivative[ii.energy]=(F*this._feed.h-D*top.h-B*bottom.h+Q-cooling-totalLoss)/1e6;
    derivative[ii.heating]=Q/1e6;derivative[ii.cooling]=cooling/1e6;derivative[ii.loss]=totalLoss/1e6;
    return {derivative,stages,F,D,B,L,Q,cooling,coolingCapacity,totalLoss,levelD,levelB,refluxTarget,feed:{...this._feed},waterOut:p.coolingTemperature+cooling/waterHeatCapacity};
  }
  advance(seconds){
    if(!Number.isFinite(seconds)||seconds<0||seconds>36000)throw new Error('Ungültiger Zeitschritt.');
    let remaining=seconds,steps=0;
    while(remaining>1e-9){
      const h=Math.min(remaining,this.stepSize,this.maxStep);let k=[],next,errorNorm=0,problem;
      try{
        for(let r=0;r<7;r++){
          const trial=Float64Array.from(this.state,(v,j)=>v+h*RK_A[r].reduce((total,a,c)=>total+a*k[c][j],0));
          k.push(this.evaluate(trial).derivative);
        }
        next=Float64Array.from(this.state,(v,j)=>v+h*RK_B.reduce((total,b,c)=>total+b*k[c][j],0));
        for(let j=0;j<next.length;j++){
          const error=h*RK_E.reduce((total,b,c)=>total+b*k[c][j],0);
          const absolute=j<2*this.n?1e-6:j===this.i.measured?1e-10:1e-8;
          const scale=absolute+this.rtol*Math.max(Math.abs(this.state[j]),Math.abs(next[j]));
          errorNorm=Math.max(errorNorm,Math.abs(error)/scale);
        }
        this.evaluate(next);
      }catch(error){problem=error;errorNorm=Infinity;}
      if(errorNorm<=1){
        this.state=next;this.t+=h;remaining-=h;this.stats.accepted++;this.stats.minStep=Math.min(this.stats.minStep??h,h);this.stats.maxStep=Math.max(this.stats.maxStep,h);
        this.stepSize=Math.min(this.maxStep,h*bounded(.9*(errorNorm||1e-10)**(-.2),.2,4));
      }else{
        this.stats.rejected++;this.stepSize=h*(Number.isFinite(errorNorm)?Math.max(.15,.9*errorNorm**(-.2)):.3);
        if(this.stepSize<1e-5)throw problem??new ModelLimit('Die Fehlertoleranz konnte nicht eingehalten werden.');
      }
      if(++steps>100000)throw new ModelLimit('Integrationsgrenze erreicht.');
    }
    return this.snapshot();
  }
  _steadyResidual(u){
    const p=this.p,n=this.n,F=p.feed*KPH,L=p.reflux*KPH;
    const stages=Array.from({length:n},(_,j)=>({...this.curves[j].at(u[j]),x:u[j]}));
    const V=[0,...Array.from(u.slice(n),v=>v*F)],D=V[1]-L,B=F-D;
    if(D<=.0001||B<=.0001)throw new ModelLimit('Für diese Kombination aus Heizleistung und Rücklauf existieren keine zwei positiven Produktströme.');
    const liquidFlows=[L];for(let j=1;j<n-1;j++){liquidFlows[j]=L+V[j+1]-V[1]+(j>=p.feedTray?F:0);if(liquidFlows[j]<=0)throw new ModelLimit('Kein positiver Flüssigkeitsstrom.');}liquidFlows[n-1]=B;
    for(let j=n-1;j>=1;j--){const t=stages[j];t.yOut=j===n-1?t.y:p.efficiency*t.y+(1-p.efficiency)*stages[j+1].yOut;t.hV=vapor(p.system,t.T,t.yOut).h;}
    const Q=Math.min(p.heatMW,this.heatAvailable(stages[n-1].T))*1e6;
    const residual=[stages[0].x-stages[1].yOut];
    for(let j=1;j<n;j++){
      const t=stages[j],up=stages[j-1],down=stages[j+1],fi=j===p.feedTray?F:0;
      residual.push((liquidFlows[j-1]*up.x+(down?V[j+1]*down.yOut:0)+fi*p.feedX-liquidFlows[j]*t.x-V[j]*t.yOut)/F);
    }
    for(let j=1;j<n;j++){
      const t=stages[j],up=stages[j-1],down=stages[j+1],fi=j===p.feedTray?F:0;
      residual.push((liquidFlows[j-1]*up.h+(down?V[j+1]*down.hV:0)+fi*this._feed.h-liquidFlows[j]*t.h-V[j]*t.hV+(j===n-1?Q:0)-p.lossUA*(t.T-273.15-p.ambient))/(F*35000));
    }
    return {residual,stages,V,L:liquidFlows,D,B,Q};
  }
  solveSteady(){
    const p=this.p,n=this.n,F=p.feed*KPH;
    const warmX=Array.from({length:n},(_,j)=>bounded(p.feedX+(p.system==='ethanol-water'?.25:.42)*(1-2*j/(n-1)),.02,.98));
    const referenceV=p.reflux*KPH+.5*F;
    let u=new Float64Array([...warmX,...Array(n-1).fill(referenceV/F)]),out,iterations=0;
    for(;iterations<70;iterations++){
      out=this._steadyResidual(u);const norm=maxabs(out.residual);
      if(norm<2e-10)break;
      const dim=u.length,jac=Array.from({length:dim},()=>new Float64Array(dim));
      for(let col=0;col<dim;col++){
        const trial=u.slice(),delta=col<n?1e-6:Math.max(1e-6,Math.abs(u[col])*1e-6);trial[col]+=delta;
        const diff=this._steadyResidual(trial).residual;
        for(let row=0;row<dim;row++)jac[row][col]=(diff[row]-out.residual[row])/delta;
      }
      const delta=linearSolve(jac,out.residual.map(v=>-v));let alpha=1,accepted=false;
      for(let j=0;j<n;j++){if(delta[j]>0)alpha=Math.min(alpha,.98*(1-1e-9-u[j])/delta[j]);if(delta[j]<0)alpha=Math.min(alpha,.98*(u[j]-1e-9)/(-delta[j]));}
      for(let attempt=0;attempt<28;attempt++){
        const trial=Float64Array.from(u,(v,j)=>v+alpha*delta[j]);
        try{if(maxabs(this._steadyResidual(trial).residual)<norm){u=trial;accepted=true;break;}}catch{}
        alpha*=.5;
      }
      if(!accepted)throw new ModelLimit('Für diese Einstellungen wurde kein stationärer Betriebspunkt gefunden. Heizleistung und Rücklauf gemeinsam anpassen.');
    }
    if(iterations===70)throw new ModelLimit('Der stationäre Betriebspunkt ist nicht konvergiert.');
    const state=new Float64Array(this.state.length);
    for(let j=0;j<n;j++){
      const sat=out.stages[j],M=j===0?p.drumVolume*p.drumTarget/sat.v:j===n-1?p.bottomVolume*p.bottomTarget/sat.v:this.hydraulicM(out.L[j],sat);
      state[2*j]=M;state[2*j+1]=M*sat.x;
    }
    const i=this.i;state[i.heat]=out.Q/1e6;state[i.d]=out.D/KPH;state[i.b]=out.B/KPH;state[i.l]=p.reflux;
    state[i.id]=state[i.d]-this._biasFeed*.5;state[i.ib]=state[i.b]-this._biasFeed*.5;state[i.measured]=out.stages[0].x;
    state[i.iq]=-p.qualityGain*(p.qualityTarget-state[i.measured]);
    this.evaluate(state);this.state=state;this._qualityBias=p.reflux;this.resetLedger();this.stepSize=.2;
    return {iterations,residual:maxabs(out.residual),...this.snapshot()};
  }
  snapshot(){
    const s=this.state,o=this.evaluate(s,false),inv=this.inventory(s),i=this.i,initial=this.initial;
    const massError=inv.total-initial.total-(s[i.feed]-s[i.dist]-s[i.bottom]);
    const componentError=inv.A-initial.A-(s[i.feedA]-s[i.distA]-s[i.bottomA]);
    const energyError=inv.energy-initial.energy-s[i.energy]*1e6;
    const scale=Math.max(1e6,Math.abs(initial.energy),s[i.heating]*1e6+Math.abs(s[i.feed])*Math.abs(this._feed.h));
    return {
      t:this.t,p:{...this.p},stages:o.stages,feed:o.feed,
      flows:{feed:o.F/KPH,distillate:o.D/KPH,bottom:o.B/KPH,reflux:o.L/KPH,boilup:o.stages[this.n-1].V/KPH,topVapor:o.stages[1].V/KPH,R:o.D>1e-9?o.L/o.D:null},
      heat:{input:o.Q/1e6,cooling:o.cooling/1e6,loss:o.totalLoss/1e6,capacity:o.coolingCapacity/1e6,waterOut:o.waterOut,netMW:o.derivative[i.energy],feedMW:o.F*this._feed.h/1e6,productsMW:(o.D*o.stages[0].h+o.B*o.stages[this.n-1].h)/1e6},
      levels:{drum:o.levelD,bottom:o.levelB},
      balance:{massError,componentError,energyError,energyRelative:energyError/scale,massRelative:massError/Math.max(inv.total,s[i.feed],1),componentRelative:componentError/Math.max(inv.A,s[i.feedA],1),instantEnergy:maxabs(o.stages.map(t=>t.energyResidual)),inventory:inv,feed:s[i.feed],distillate:s[i.dist],bottom:s[i.bottom],feedA:s[i.feedA],distillateA:s[i.distA],bottomA:s[i.bottomA],heatMJ:s[i.heating],coolMJ:s[i.cooling]},
      maxChange:Math.max(maxabs(o.stages.map(t=>t.dx)),maxabs(o.stages.map(t=>t.dM/t.M)),Math.abs(o.derivative[i.heat])/Math.max(.1,this.p.heatMW),Math.abs(o.derivative[i.l])/Math.max(1,this.p.reflux)),measured:s[i.measured],stats:{...this.stats},
    };
  }
  save(){return {format:'rectify-column-v2',p:{...this.p},t:this.t,state:Array.from(this.state),initial:{...this.initial},biasFeed:this._biasFeed,qualityBias:this._qualityBias};}
  static restore(data){
    if(!data||data.format!=='rectify-column-v2')throw new Error('Bitte einen RECTIFY-2-Simulationslauf auswählen.');
    const m=new ColumnModel(data.p);
    if(!Array.isArray(data.state)||data.state.length!==m.state.length||data.state.some(v=>!Number.isFinite(v)))throw new Error('Ungültige Zustandsdaten.');
    if(!Number.isFinite(data.t)||data.t<0||data.t>1e8)throw new Error('Ungültige Simulationszeit.');
    for(const k of ['total','A','energy'])if(!Number.isFinite(data.initial?.[k]))throw new Error('Ungültige Anfangsbilanz.');
    if(data.initial.total<=0||data.initial.A<0||data.initial.A>data.initial.total)throw new Error('Ungültiger Anfangsvorrat.');
    if(!Number.isFinite(data.biasFeed)||data.biasFeed<10||data.biasFeed>180||!Number.isFinite(data.qualityBias)||data.qualityBias<5||data.qualityBias>500)throw new Error('Ungültiger Reglerzustand.');
    m.state=Float64Array.from(data.state);m.t=data.t;m.initial={...data.initial};m._biasFeed=data.biasFeed;m._qualityBias=data.qualityBias;
    for(const k of ['heat','d','b','l','feed','dist','bottom','feedA','distA','bottomA','heating','cooling'])if(m.state[m.i[k]]<0)throw new Error('Negative Betriebs- oder Bilanzgröße.');
    if(m.state[m.i.measured]<0||m.state[m.i.measured]>1)throw new Error('Ungültiger Messwert.');
    m.evaluate(m.state);
    const checks=m.snapshot().balance;
    if(Math.abs(checks.massRelative)>1e-5||Math.abs(checks.componentRelative)>1e-5||Math.abs(checks.energyRelative)>1e-3)throw new Error('Der gespeicherte Lauf verletzt die Stoff- oder Energiebilanz.');
    return m;
  }
}

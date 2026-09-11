import { PROPERTY_DATA } from './data/properties.js';

export const GAS_R = 8.31446261815324;
export const T_REF = PROPERTY_DATA.referenceTemperature;
export const COMPONENTS = PROPERTY_DATA.components;
export const SYSTEMS = Object.freeze({
  'ethanol-water': { id: 'ethanol-water', name: 'Ethanol / Wasser', components: ['ethanol', 'water'], model: 'NRTL', note: 'Nichtideales Gemisch mit azeotroper Trennbegrenzung.', color: '#75dfc5' },
  'benzene-toluene': { id: 'benzene-toluene', name: 'Benzol / Toluol', components: ['benzene', 'toluene'], model: 'Raoult', note: 'Näherungsweise ideales Referenzgemisch.', color: '#89b8ff' },
  'hexane-heptane': { id: 'hexane-heptane', name: 'n-Hexan / n-Heptan', components: ['hexane', 'heptane'], model: 'Raoult', note: 'Näherungsweise ideales Kohlenwasserstoffgemisch.', color: '#ffc186' },
});

export function bounded(value, min, max) { return Math.max(min, Math.min(max, value)); }

// Cubic Hermite: the derivative is the exact derivative of the interpolant.
function hermite(y0, y1, m0, m1, u, span) {
  const u2 = u*u, u3 = u2*u;
  return {
    value: (2*u3-3*u2+1)*y0 + (u3-2*u2+u)*span*m0 + (-2*u3+3*u2)*y1 + (u3-u2)*span*m1,
    derivative: (6*u2-6*u)*(y0-y1)/span + (3*u2-4*u+1)*m0 + (3*u2-2*u)*m1,
  };
}

export function pure(id, T) {
  const c = COMPONENTS[id];
  if (!c || !Number.isFinite(T) || T < 280 || T > 450) throw new RangeError('Stoffdaten gelten für 280 bis 450 K.');
  const j = Math.min(84, Math.floor((T-280)/2)), u = (T-(280+2*j))/2;
  const read = (values, slopes) => hermite(c[values][j], c[values][j+1], c[slopes][j], c[slopes][j+1], u, 2);
  const log = read('logPsat', 'dLogPsat'), liq = read('hL', 'cpL'), vap = read('hV', 'cpV'), volume = read('vL', 'dvL');
  const psat = Math.exp(log.value);
  return { psat, dPsat: psat*log.derivative, hL: liq.value, cpL: liq.derivative, hV: vap.value, cpV: vap.derivative, vL: volume.value, mw: c.mw };
}

// Binary NRTL, component 1 = ethanol, component 2 = water.
// tau_ij = a_ij + b_ij/T. DTU, Cyclic Distillation Technology, Table 4.4.
// Temperature derivative is analytical, including tau and G derivatives.
export function nrtl(T, x) {
  const z = 1-x, t12 = -0.8009+246.18/T, t21 = 3.4578-586.081/T;
  const d12 = -246.18/(T*T), d21 = 586.081/(T*T);
  const g12 = Math.exp(-0.3*t12), g21 = Math.exp(-0.3*t21);
  const dg12 = -0.3*d12*g12, dg21 = -0.3*d21*g21;
  const a = x+z*g21, b = z+x*g12, da = z*dg21, db = x*dg12;
  const first = (t, dt, g, dg, den, dden, power) => {
    const numerator = t*g**power;
    const derivative = dt*g**power + t*power*g**(power-1)*dg;
    return [numerator/(den*den), derivative/(den*den)-2*numerator*dden/(den**3)];
  };
  const a1 = first(t21,d21,g21,dg21,a,da,2), b1 = first(t12,d12,g12,dg12,b,db,1);
  const a2 = first(t12,d12,g12,dg12,b,db,2), b2 = first(t21,d21,g21,dg21,a,da,1);
  const log1 = z*z*(a1[0]+b1[0]), log2 = x*x*(a2[0]+b2[0]);
  const dLog1 = z*z*(a1[1]+b1[1]), dLog2 = x*x*(a2[1]+b2[1]);
  return { gamma: [Math.exp(log1), Math.exp(log2)], dLog: [dLog1,dLog2], hE: -GAS_R*T*T*(x*dLog1+z*dLog2) };
}

export function liquid(systemId, T, x) {
  const s = SYSTEMS[systemId];
  if (!s) throw new RangeError('Unbekanntes Stoffsystem.');
  const a = pure(s.components[0],T), b = pure(s.components[1],T);
  const hE = s.model === 'NRTL' ? nrtl(T,x).hE : 0;
  const volume = x*a.vL+(1-x)*b.vL;
  const mw = x*a.mw+(1-x)*b.mw;
  return { h: x*a.hL+(1-x)*b.hL+hE, hE, v: volume, rho: mw/volume, mw };
}

export function vapor(systemId, T, y) {
  const s = SYSTEMS[systemId], a = pure(s.components[0],T), b = pure(s.components[1],T);
  return { h: y*a.hV+(1-y)*b.hV, mw: y*a.mw+(1-y)*b.mw };
}

export function bubble(systemId, x, P, guess) {
  if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(P) || P <= 0) throw new RangeError('Ungültiger Gleichgewichtszustand.');
  const system = SYSTEMS[systemId];
  if (!system) throw new RangeError('Unbekanntes Stoffsystem.');
  const evaluate = T => {
    const a = pure(system.components[0], T), b = pure(system.components[1], T);
    const activity = system.model === 'NRTL' ? nrtl(T,x) : { gamma:[1,1], dLog:[0,0] };
    const pa = x*activity.gamma[0]*a.psat, pb = (1-x)*activity.gamma[1]*b.psat;
    return { residual:pa+pb-P, y:pa/P, slope: x*activity.gamma[0]*(a.dPsat+a.psat*activity.dLog[0])+(1-x)*activity.gamma[1]*(b.dPsat+b.psat*activity.dLog[1]) };
  };
  let lo=280, hi=450, T=bounded(guess ?? 360,lo,hi), item;
  if (evaluate(lo).residual>0 || evaluate(hi).residual<0) throw new RangeError('Siedepunkt außerhalb des hinterlegten Stoffdatenbereichs.');
  for (let i=0;i<45;i++) {
    item=evaluate(T);
    if(Math.abs(item.residual)<P*1e-11) return {T,y:bounded(item.y,0,1),residual:item.residual};
    if(item.residual>0) hi=T; else lo=T;
    const next=T-item.residual/item.slope;
    T=next>lo && next<hi ? next : (lo+hi)/2;
  }
  throw new Error('Siedepunktberechnung nicht konvergiert.');
}

export function azeotrope(systemId, P=101325) {
  if(SYSTEMS[systemId]?.model!=='NRTL') return null;
  let lo=.5, hi=.99999, f0=bubble(systemId,lo,P).y-lo;
  if(f0*(bubble(systemId,hi,P).y-hi)>=0) return null;
  for(let i=0;i<40;i++) {
    const mid=(lo+hi)/2, f=bubble(systemId,mid,P).y-mid;
    if(f*f0>0) {lo=mid;f0=f;} else hi=mid;
  }
  const x=(lo+hi)/2, point=bubble(systemId,x,P);
  return {x,T:point.T,massFraction:x*COMPONENTS.ethanol.mw/(x*COMPONENTS.ethanol.mw+(1-x)*COMPONENTS.water.mw)};
}

// Fixed-pressure paths accelerate the simulation. All accumulation derivatives
// use these same differentiable paths, preserving the reduced energy equations.
export class SaturationCurve {
  constructor(systemId,P,resolution=240) {
    this.systemId=systemId;this.P=P;this.nodes=[];
    let guess;
    for(let i=0;i<=resolution;i++) {
      const x=i===resolution?1:Math.sin(Math.PI*i/(2*resolution))**2;
      const state=bubble(systemId,x,P,guess);guess=state.T;
      const l=liquid(systemId,state.T,x);
      this.nodes.push({x,T:state.T,y:state.y,h:l.h,v:l.v});
    }
    // Stable, second-order slopes for a nonuniform (endpoint-refined) grid.
    for(let i=0;i<=resolution;i++) {
      const j=bounded(i,1,resolution-1), a=this.nodes[j-1], b=this.nodes[j], c=this.nodes[j+1], at=this.nodes[i].x;
      for(const key of ['T','y','h','v']) {
        this.nodes[i]['d'+key]=a[key]*(2*at-b.x-c.x)/((a.x-b.x)*(a.x-c.x)) + b[key]*(2*at-a.x-c.x)/((b.x-a.x)*(b.x-c.x)) + c[key]*(2*at-a.x-b.x)/((c.x-a.x)*(c.x-b.x));
      }
    }
  }
  at(x) {
    if(x< -1e-8 || x>1+1e-8 || !Number.isFinite(x)) throw new RangeError('Unphysikalische Zusammensetzung.');
    x=bounded(x,0,1);
    let lo=0,hi=this.nodes.length-1;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(this.nodes[mid].x<=x)lo=mid;else hi=mid;}
    const a=this.nodes[lo],b=this.nodes[hi],span=b.x-a.x,u=(x-a.x)/span,result={x,P:this.P};
    for(const key of ['T','y','h','v']) {
      const value=hermite(a[key],b[key],a['d'+key],b['d'+key],u,span);
      result[key]=value.value;result['d'+key]=value.derivative;
    }
    return result;
  }
}

export function feedState(systemId, P, z, temperatureC, mode='temperature', quality=1) {
  const sat=bubble(systemId,z,P);
  if(mode==='saturated') return {T:sat.T,h:liquid(systemId,sat.T,z).h,q:1,phase:'Gesättigte Flüssigkeit'};
  if(mode==='quality') {
    // quality here is the liquid fraction, not the vapor quality.
    const q=bounded(quality,0,1);
    // Isobaric flash with specified vapor fraction: solve z=q*x+(1-q)*y(x).
    let lo=0,hi=1;
    for(let i=0;i<45;i++){const x=(lo+hi)/2,s=bubble(systemId,x,P);if(q*x+(1-q)*s.y>z)hi=x;else lo=x;}
    const x=(lo+hi)/2,s=bubble(systemId,x,P);
    return {T:s.T,h:q*liquid(systemId,s.T,x).h+(1-q)*vapor(systemId,s.T,s.y).h,q,phase:q===0?'Gesättigter Dampf':q===1?'Gesättigte Flüssigkeit':'Zweiphasig',x,y:s.y};
  }
  const T=temperatureC+273.15;
  if(T<=sat.T) return {T,h:liquid(systemId,T,z).h,q:1,phase:'Unterkühlte Flüssigkeit'};
  // Exact binary, isothermal flash in the accessible single-liquid phase region.
  const s=SYSTEMS[systemId];
  const at=x=>{const a=pure(s.components[0],T),b=pure(s.components[1],T),g=s.model==='NRTL'?nrtl(T,x).gamma:[1,1];return {sum:x*g[0]*a.psat+(1-x)*g[1]*b.psat,y:x*g[0]*a.psat/P};};
  const roots=[];let oldX=0,oldF=at(0).sum-P;
  for(let j=1;j<=120;j++){
    const x=j/120,f=at(x).sum-P;
    if(f*oldF<0){let lo=oldX,hi=x,fl=oldF;for(let k=0;k<35;k++){const m=(lo+hi)/2,fm=at(m).sum-P;if(fm*fl>0){lo=m;fl=fm;}else hi=m;}roots.push((lo+hi)/2);}
    oldX=x;oldF=f;
  }
  for(const x of roots){const y=at(x).y,beta=(z-x)/(y-x);if(beta>=0&&beta<=1)return {T,h:(1-beta)*liquid(systemId,T,x).h+beta*vapor(systemId,T,y).h,q:1-beta,phase:'Zweiphasig',x,y};}
  return {T,h:vapor(systemId,T,z).h,q:0,phase:'Überhitzter Dampf'};
}

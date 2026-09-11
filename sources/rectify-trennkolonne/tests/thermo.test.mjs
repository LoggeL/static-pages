import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pure,nrtl,bubble,SaturationCurve,feedState,azeotrope } from '../thermo.js';
const reference=JSON.parse(readFileSync(new URL('./thermo-reference.json',import.meta.url)));
const near=(actual,expected,absolute,relative=0)=>assert.ok(Math.abs(actual-expected)<=absolute+relative*Math.abs(expected),`${actual} != ${expected}`);

test('30 off-grid pure-property cases agree with the pinned thermo source',()=>{
  for(const r of reference.pure){const p=pure(r.id,r.T);near(p.psat,r.p,.05,2e-7);near(p.hL,r.hL,.002);near(p.hV,r.hV,.002);near(p.cpL,r.cpL,.01);near(p.vL,r.vL,1e-10);}
});
test('28 NRTL activity and excess-enthalpy cases agree with independent thermo.NRTL',()=>{
  for(const r of reference.nrtl){const p=nrtl(r.T,r.x);near(p.gamma[0],r.gamma[0],1e-11);near(p.gamma[1],r.gamma[1],1e-11);near(p.hE,r.hE,1e-7);}
});
test('54 bubble points agree with the independent scipy / thermo reference',()=>{
  for(const r of reference.bubble){const p=bubble(r.system,r.x,r.P);near(p.T,r.T,.0001);near(p.y,r.y,2e-6);near(p.residual,0,.0001);}
});
test('accelerated saturation paths retain accurate temperatures and derivatives',()=>{
  for(const system of ['ethanol-water','benzene-toluene','hexane-heptane']){
    const curve=new SaturationCurve(system,101325);
    for(let j=1;j<100;j++){const x=j/101,p=curve.at(x),truth=bubble(system,x,101325);near(p.T,truth.T,.003);near(p.y,truth.y,.00004);const h=1e-7;near(p.dh,(curve.at(x+h).h-curve.at(x-h).h)/(2*h),.03);}
  }
});
test('ethanol/water azeotrope is close to an independent experimental reference',()=>{
  // Pemberton & Mash (1978), doi:10.1016/0021-9614(78)90160-X.
  // Experimental .8933 / 351.320 K. Tolerances are model deviations, not
  // experimental uncertainty, and are explicitly shown on the knowledge page.
  const p=azeotrope('ethanol-water');near(p.x,.8933,.006);near(p.T,351.320,.15);near(bubble('ethanol-water',p.x,101325).y,p.x,1e-10);
});
test('feed quality flash conserves both overall composition and phase fractions',()=>{
  for(const z of [.1,.5,.8])for(const q of [0,.3,.7,1]){const f=feedState('ethanol-water',101325,z,0,'quality',q);near(q*f.x+(1-q)*f.y,z,1e-10);assert.ok(Number.isFinite(f.h));}
});
test('temperature feed flash distinguishes subcooled, two-phase and vapor feed',()=>{
  assert.equal(feedState('benzene-toluene',101325,.5,40).phase,'Unterkühlte Flüssigkeit');
  const two=feedState('benzene-toluene',101325,.5,95);assert.ok(two.q>0&&two.q<1);
  assert.equal(feedState('benzene-toluene',101325,.5,130).phase,'Überhitzter Dampf');
});
test('out-of-range physical inputs fail explicitly',()=>{
  assert.throws(()=>pure('water',500));assert.throws(()=>bubble('ethanol-water',1.1,101325));assert.throws(()=>bubble('unknown',.5,101325));
});

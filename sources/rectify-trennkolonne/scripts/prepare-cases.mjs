import { writeFileSync,readFileSync } from 'node:fs';
import { SimulationSession, sample } from '../session.js';
import { CASES } from '../cases.js';
import { pure,nrtl,bubble,azeotrope } from '../thermo.js';
const root=new URL('../',import.meta.url);
const report={version:2,method:'Calculated regression fixtures, not measured column data',cases:[],references:{}};
for(const c of CASES){
  const session=new SimulationSession(c.id),initial=sample(session.model.snapshot());
  const max={mass:0,component:0,energy:0,instantEnergy:0};
  for(let t=0;t<1800;t+=30){session.advance(30);const b=session.model.snapshot().balance;max.mass=Math.max(max.mass,Math.abs(b.massRelative));max.component=Math.max(max.component,Math.abs(b.componentRelative));max.energy=Math.max(max.energy,Math.abs(b.energyRelative));max.instantEnergy=Math.max(max.instantEnergy,b.instantEnergy);}
  report.cases.push({id:c.id,initial,after30min:sample(session.model.snapshot()),maxErrors:max});
}
const ref=JSON.parse(readFileSync(new URL('tests/thermo-reference.json',root)));
report.references={pureCases:ref.pure.length,nrtlCases:ref.nrtl.length,bubbleCases:ref.bubble.length,
  maxPsatRelative:Math.max(...ref.pure.map(r=>Math.abs(pure(r.id,r.T).psat/r.p-1))),
  maxLiquidEnthalpyJmol:Math.max(...ref.pure.map(r=>Math.abs(pure(r.id,r.T).hL-r.hL))),
  maxNrtlGammaAbsolute:Math.max(...ref.nrtl.flatMap(r=>nrtl(r.T,r.x).gamma.map((v,i)=>Math.abs(v-r.gamma[i])))),
  maxNrtlExcessEnthalpyJmol:Math.max(...ref.nrtl.map(r=>Math.abs(nrtl(r.T,r.x).hE-r.hE))),
  maxBubbleTemperatureK:Math.max(...ref.bubble.map(r=>Math.abs(bubble(r.system,r.x,r.P).T-r.T))),
  maxBubbleVaporFraction:Math.max(...ref.bubble.map(r=>Math.abs(bubble(r.system,r.x,r.P).y-r.y))),
  azeotrope:{model:azeotrope('ethanol-water'),experimental:{x:.8933,T:351.320,P:101325,doi:'10.1016/0021-9614(78)90160-X'}}};
writeFileSync(new URL('data/validation.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));

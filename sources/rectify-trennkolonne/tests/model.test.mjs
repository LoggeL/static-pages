import test from 'node:test';
import assert from 'node:assert/strict';
import { ColumnModel } from '../model.js';
import { CASES,caseParams } from '../cases.js';

for(const scenario of CASES){
  test(`${scenario.id}: converged baseline and 30 minutes with scheduled disturbances`,()=>{
    const model=new ColumnModel(caseParams(scenario.id));const initial=model.solveSteady();
    assert.ok(initial.residual<1e-8);assert.ok(initial.flows.distillate>0&&initial.flows.bottom>0);
    let last=initial;
    for(let t=0;t<1800;t+=30){for(const e of scenario.events)if(e.at===t)model.operating(e.patch);last=model.advance(30);}
    assert.ok(Math.abs(last.balance.massRelative)<1e-10);
    assert.ok(Math.abs(last.balance.componentRelative)<1e-10);
    assert.ok(Math.abs(last.balance.energyRelative)<2e-6,`energy drift ${last.balance.energyRelative}`);
    assert.ok(last.balance.instantEnergy<.00001);
    assert.ok(last.stages.every(s=>s.M>0&&s.x>=0&&s.x<=1));
    assert.ok(last.levels.drum>.02&&last.levels.drum<.98);
    assert.ok(last.levels.bottom>.02&&last.levels.bottom<.98);
  });
}
test('lower efficiency loses separation at the same actual tray count',()=>{
  const normal=new ColumnModel();const low=new ColumnModel({efficiency:.45});
  const a=normal.solveSteady(),b=low.solveSteady();assert.ok(a.stages[0].x>b.stages[0].x);assert.ok(a.stages.at(-1).x<b.stages.at(-1).x);
});
test('cold feed consumes vapor and changes the energy balance',()=>{
  const model=new ColumnModel(),baseline=model.solveSteady();model.operating({feedMode:'temperature',feedTemperature:40});const next=model.snapshot();
  assert.ok(next.flows.topVapor<baseline.flows.topVapor);assert.ok(next.heat.feedMW<baseline.heat.feedMW);
});
test('adaptive integration converges independently of the maximum step',()=>{
  const a=new ColumnModel({}, {rtol:2e-7,maxStep:2}),b=new ColumnModel({}, {rtol:1e-10,maxStep:.25});a.solveSteady();b.solveSteady();
  for(const m of [a,b])m.operating({feed:100,feedX:.45});
  const x=a.advance(900),y=b.advance(900);
  for(let i=0;i<x.stages.length;i++){assert.ok(Math.abs(x.stages[i].x-y.stages[i].x)<2e-6);assert.ok(Math.abs(x.stages[i].M-y.stages[i].M)<.01);}
});
test('saved trajectories resume deterministically and reject corrupted inventories',()=>{
  const a=new ColumnModel();a.solveSteady();a.operating({feed:90});a.advance(120);
  const save=a.save(),b=ColumnModel.restore(save);const left=a.advance(60),right=b.advance(60);
  assert.ok(Math.abs(left.stages[0].x-right.stages[0].x)<1e-8);
  const bad=structuredClone(save);bad.state[1]*=2;assert.throws(()=>ColumnModel.restore(bad));
  assert.throws(()=>ColumnModel.restore({...save,format:'rectify-column-v1'}));
});
test('insufficient cooling is an explicit model limit and an edit is transactional',()=>{
  const model=new ColumnModel();model.solveSteady();const previous=model.p.coolingWater;
  assert.throws(()=>model.operating({coolingWater:10,coolingTemperature:60}),/Kühlleistung/);
  assert.equal(model.p.coolingWater,previous);
});

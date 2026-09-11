import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationSession } from '../session.js';
import { ColumnModel } from '../model.js';
import { CASES,caseParams } from '../cases.js';

test('events fire exactly on the scheduled instant and samples include the change',()=>{
  const s=new SimulationSession('feed-step');s.advance(119.9);assert.equal(s.model.p.feed,80);s.advance(.1);assert.equal(s.model.p.feed,100);assert.equal(s.events[0].done,true);assert.equal(s.history.at(-1).F,100);assert.equal(s.log.at(-1).t,120);
});
test('a large session step and small UI-sized steps follow the same event timeline',()=>{
  const a=new SimulationSession('cold-feed'),b=new SimulationSession('cold-feed');a.advance(600);for(let i=0;i<600;i++)b.advance(1);
  assert.ok(Math.abs(a.model.snapshot().stages[0].x-b.model.snapshot().stages[0].x)<1e-7);assert.deepEqual(a.log,b.log);assert.equal(a.history.length,121);
});
test('session save and restore preserve pending events and reject impossible timelines',()=>{
  const a=new SimulationSession('feed-step');a.advance(30);const data=a.save(),b=SimulationSession.restore(data);b.advance(100);assert.equal(b.model.p.feed,100);
  const bad=structuredClone(data);bad.events[0].done=true;assert.throws(()=>SimulationSession.restore(bad),/Zukunft/);
  bad.events[0].done=false;bad.history[0].xD=2;assert.throws(()=>SimulationSession.restore(bad),/Trendzusammensetzung/);
  assert.throws(()=>a.advance(-1));
});
test('all mixed starts have valid saturated initial states and conserve material',()=>{
  for(const c of CASES){const m=new ColumnModel(caseParams(c.id));m.snapshot();const s=m.advance(60);assert.ok(Math.abs(s.balance.massRelative)<1e-10);}
});
test('the default purity controller recovers from its composition disturbance over four hours',()=>{
  const s=new SimulationSession('quality-control');s.advance(14400);const result=s.model.snapshot();
  assert.ok(Math.abs(result.stages[0].x-result.p.qualityTarget)<.0001);
  assert.ok(Math.abs(result.levels.drum-.5)<.0001&&Math.abs(result.levels.bottom-.5)<.0001);
  assert.ok(Math.abs(result.balance.energyRelative)<1e-7);
});

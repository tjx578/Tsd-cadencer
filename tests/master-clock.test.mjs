import assert from 'node:assert/strict';
import test from 'node:test';
import {RallyMasterClock,formatMasterClock,makeSubSchedule,scheduledSub,activationDecision,cpTargetSecond} from '../Utils/MasterClock.mjs';

test('HH:mm:ss.cc appearance is WITA-explicit, not inherited browser zone',()=>{
  const e=Date.parse('2026-10-26T10:03:27.449+08:00');
  assert.equal(formatMasterClock(e),'10:03:27.44');
  assert.equal(formatMasterClock(e,'Asia/Jakarta'),'09:03:27.44');
});
test('never claim master time when device clock unverified',()=>{
  const c=new RallyMasterClock({monoNow:()=>1,wallNow:()=>Date.now()});
  assert.equal(c.snapshot().quality,'UNSYNCED');
  assert.equal(scheduledSub([],c.snapshot()).status,'TIME_SOURCE_HOLD');
});
test('only authenticated NaviPRO source accepted',()=>{
  const c=new RallyMasterClock({monoNow:()=>50});
  const s={serverEpochMs:1234,clientStartMonoMs:0,clientEndMonoMs:20,sourceId:'INDORALLYHUB',authenticated:true};
  assert.throws(()=>c.sync(s),/UNTRUSTED/);
  assert.throws(()=>c.sync({...s,sourceId:'NAVIPRO_MASTER_CLOCK',authenticated:false}),/UNTRUSTED/);
});
test('two apps agree using same server epoch and monotonic ticks',()=>{
  let aMono=150,bMono=150;
  const a=new RallyMasterClock({monoNow:()=>aMono,wallNow:()=>1});
  const b=new RallyMasterClock({monoNow:()=>bMono,wallNow:()=>9999999999});
  const sample={serverEpochMs:Date.parse('2026-08-29T08:04:00+08:00'),clientStartMonoMs:100,clientEndMonoMs:200,sourceId:'NAVIPRO_MASTER_CLOCK',authenticated:true};
  a.sync(sample);b.sync(sample);
  aMono+=1000;bMono+=1000;
  assert.equal(a.snapshot().display,'08:04:01.00');
  assert.equal(a.snapshot().epochMs,b.snapshot().epochMs);
});
test('low quality sample and stale sample fail closed',()=>{
  let mono=100; const c=new RallyMasterClock({monoNow:()=>mono,staleAfterMs:100});
  assert.throws(()=>c.sync({serverEpochMs:1,clientStartMonoMs:0,clientEndMonoMs:4000,sourceId:'NAVIPRO_MASTER_CLOCK',authenticated:true}),/LOW_QUALITY/);
  c.sync({serverEpochMs:1000000,clientStartMonoMs:0,clientEndMonoMs:100,sourceId:'NAVIPRO_MASTER_CLOCK',authenticated:true});
  mono=201;assert.equal(c.snapshot().authoritative,false);
});
test('minute-only sub schedule and no implicit physical activation',()=>{
  assert.throws(()=>makeSubSchedule({eventDate:'2026-08-29',startTime:'07:59',offsetsMinutes:[{id:'A',minutes:2.5}]}),/INVALID_SUB/);
  const s=makeSubSchedule({eventDate:'2026-08-29',startTime:'07:59',offsetsMinutes:[{id:'A',minutes:5},{id:'B',minutes:22}]});
  const x=scheduledSub(s,{epochMs:s[1].startEpochMs,authoritative:true});
  assert.equal(x.scheduled,'B');
  assert.equal(activationDecision({scheduleStatus:x,boundaryVerified:false,planAcknowledged:true}),'BOUNDARY_HOLD');
});
test('CP target requires known physical binding AND distance authority',()=>{
  const p={subStartEpochMs:0,subDistanceM:11050,durationMinutes:46,cpDistanceM:3000,cpBindingStatus:'VERIFIED',distanceAuthority:'OFFICIAL_RECONCILED'};
  assert.equal(cpTargetSecond(p).elapsedSeconds,749);
  assert.equal(cpTargetSecond({...p,cpBindingStatus:'CANDIDATE'}).status,'UNRESOLVED');
});
test('PREP fixture does not need Master Pos',()=>{
  const s=makeSubSchedule({eventDate:'2026-08-29',startTime:'07:59',offsetsMinutes:[{id:'A',minutes:5},{id:'B',minutes:22},{id:'C',minutes:46},{id:'D',minutes:10},{id:'E',minutes:24},{id:'F',minutes:77},{id:'G',minutes:50},{id:'H',minutes:6}]});
  assert.equal((s.at(-1).endEpochMs-s[0].startEpochMs)/60000,240);
});

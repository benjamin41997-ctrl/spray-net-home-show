import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisitRecorder} from '../public/visits.js';

const access={id:crypto.randomUUID(),token:'a'.repeat(43)};
test('one page opening records once across repeated steps and concurrent attempts',async()=>{
  const calls=[];let finish;
  const recorder=createVisitRecorder((lead,body,signal)=>{calls.push({lead,body,signal});return new Promise(resolve=>{finish=resolve;});});
  const first=recorder.record(access),second=recorder.record(access);
  await Promise.resolve();assert.equal(calls.length,1);assert.equal(first,second);assert.match(calls[0].body.visitId,/^[a-f0-9-]{36}$/);
  finish({recorded:true});assert.equal(await first,true);assert.equal(await recorder.record(access),false);assert.equal(calls.length,1);
});
test('failed recording does not break the visitor flow and retries keep the same idempotent visit ID',async()=>{
  const bodies=[];const recorder=createVisitRecorder(async(_,body)=>{bodies.push(body);if(bodies.length===1)throw new Error('Synthetic outage');});
  assert.equal(await recorder.record(access),false);assert.equal(await recorder.record(access),true);
  assert.equal(bodies[0].visitId,bodies[1].visitId);
  const anotherPage=createVisitRecorder(async(_,body)=>{bodies.push(body);});await anotherPage.record(access);
  assert.notEqual(bodies[1].visitId,bodies[2].visitId);
});
test('tablet reset aborts pending tracking, rejects its late reply, and creates a new visitor visit ID',async()=>{
  const calls=[];const recorder=createVisitRecorder((_,body,signal)=>new Promise(resolve=>calls.push({body,signal,resolve})));
  const old=recorder.record(access);await Promise.resolve();recorder.reset();assert.equal(calls[0].signal.aborted,true);
  const next=recorder.record(access);await Promise.resolve();assert.notEqual(calls[0].body.visitId,calls[1].body.visitId);
  calls[0].resolve();assert.equal(await old,false);calls[1].resolve();assert.equal(await next,true);
  assert.equal(await recorder.record(null),false);
});

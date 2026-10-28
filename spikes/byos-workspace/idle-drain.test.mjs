import assert from 'node:assert/strict';
import test from 'node:test';
import {IdleDrain} from './idle-drain.mjs';
const ids=Array.from({length:26},(_,i)=>String.fromCharCode(65+i));
const flush=async()=>{for(let i=0;i<200;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(overrides={}){
 let now=0,n=0;const timers=new Map(),saved=[],verified=[],syncs=[];
 const clock={setTimeout(fn,ms){timers.set(++n,{at:now+ms,fn});return n;},clearTimeout(id){timers.delete(id);}};
 const run=new IdleDrain({ids,clock,now:()=>now,save:async id=>saved.push(id),sync:async()=>syncs.push(now),verify:async id=>verified.push(id),check:async()=>true,available:()=>true,...overrides});
 async function advance(t){for(let steps=0;;steps++){assert.ok(steps<1000,'no timer spin');const next=[...timers].filter(([,v])=>v.at<=t).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=t;await flush();}
 return {run,advance,saved,verified,syncs};
}
test('A–Z last-input deadlines independent; Z idle saves and all generations verify',async()=>{
 const f=fixture();for(let i=0;i<26;i++){await f.advance(i*100);f.run.input(ids[i]);}
 await f.advance(4999);assert.equal(f.saved.length,0);
 await f.advance(5000);assert.equal(f.saved[0],'A'); // Z did not reset A
 await f.advance(7500);assert.equal(f.saved.at(-1),'Z');assert.equal(f.verified.length,26);assert.equal(f.run.ready,true);
 assert.equal(f.run.events.filter(e=>e.type==='eligible').length,26);
});
test('long gaps drain more than two dispatches within finite run budget',async()=>{
 const f=fixture();for(let i=0;i<26;i++){f.run.input(ids[i]);await f.advance((i+1)*6000);}
 assert.equal(f.syncs.length,26);assert.equal(f.run.ready,true);
});
test('local Z autosave proceeds during held cloud work; stale verification cannot certify new input',async()=>{
 const hold=deferred();let calls=0;const f=fixture({verify:async()=>{if(!calls++)await hold.promise;}});
 for(const id of ids)f.run.input(id);await f.advance(5000);
 assert.equal(f.run.flight,true);f.run.input('Z');await f.advance(10000);assert.equal(f.run.entries.get('Z').saved,2);assert.equal(f.run.ready,false);
 hold.resolve();await flush();await f.advance(10000);assert.equal(f.run.entries.get('Z').verified,2);assert.equal(f.run.ready,true);
});
test('failure keeps uncertain latch and prevents automatic retry/ready',async()=>{
 const f=fixture({sync:async()=>{throw Error('TIMEOUT');}});for(const id of ids)f.run.input(id);await f.advance(5000);
 assert.match(f.run.halted,/TIMEOUT/);f.run.input('Z');await f.advance(20000);assert.equal(f.run.syncs,1);assert.equal(f.run.ready,false);
});
test('failed local commit cannot acknowledge or sync',async()=>{
 const f=fixture({save:async()=>{throw Error('disk');}});f.run.input('Z');await f.advance(5000);
 assert.equal(f.run.entries.get('Z').saved,0);assert.equal(f.syncs.length,0);assert.equal(f.run.ready,false);
});
test('stop does not flush or assert safe close; timeout while flight held remains uncertain',async()=>{
 const hold=deferred();const f=fixture({sync:()=>hold.promise,maxMs:6000});for(const id of ids)f.run.input(id);await f.advance(6000);
 assert.equal(f.run.halted,'RUN_TIME_BUDGET_EXHAUSTED');hold.resolve();await flush();assert.equal(f.run.ready,false);
 const g=fixture();g.run.input('Z');g.run.stop();await g.advance(6000);assert.equal(g.saved.length,0);assert.equal(g.run.ready,false);
});
test('aggregate final check and newer input during audit forbid false close',async()=>{
 const gate=deferred();const f=fixture({check:()=>gate.promise});for(const id of ids)f.run.input(id);await f.advance(5000);f.run.input('Z');gate.resolve(true);await flush();assert.equal(f.run.ready,false);
});
test('post-commit save settlement reruns readiness even when no cloud batch remains',async()=>{
 const hold=deferred();let f;f=fixture({save:async id=>{if(id==='Z'){f.run.saved(id,f.run.entries.get(id).generation);await hold.promise;}}});
 for(const id of ids)f.run.input(id);await f.advance(5000);
 assert.equal(f.run.entries.get('Z').saving,true);assert.equal(f.run.ready,false);
 hold.resolve();await flush();await f.advance(5000);
 assert.equal(f.run.entries.get('Z').saving,false);assert.equal(f.run.ready,true);
});
test('editing after ready retains original wall-clock deadline',async()=>{
 const f=fixture({maxMs:7000});for(const id of ids)f.run.input(id);await f.advance(5000);assert.equal(f.run.ready,true);
 f.run.input('Z');await f.advance(7000);assert.equal(f.run.halted,'RUN_TIME_BUDGET_EXHAUSTED');assert.equal(f.run.ready,false);
});
test('held old audit trails a newer fully verified generation',async()=>{
 const hold=deferred();let checks=0;const f=fixture({check:async()=>{if(!checks++)return hold.promise;return true;}});
 for(const id of ids)f.run.input(id);await f.advance(5000);assert.equal(f.run.checking,true);
 f.run.input('Z');await f.advance(10000);assert.equal(f.run.entries.get('Z').verified,2);
 hold.resolve(true);await flush();await f.advance(10000);assert.equal(f.run.ready,true);assert.ok(checks>=2);
});
test('stale false audit is discarded; stop during audit never restores ready',async()=>{
 const hold=deferred();let calls=0;const f=fixture({check:async()=>calls++?true:hold.promise});
 for(const id of ids)f.run.input(id);await f.advance(5000);f.run.input('Z');await f.advance(10000);hold.resolve(false);await flush();assert.equal(f.run.ready,true);assert.equal(f.run.halted,null);
 const stop=deferred();const g=fixture({check:()=>stop.promise});for(const id of ids)g.run.input(id);await g.advance(5000);g.run.stop();stop.resolve(true);await flush();assert.equal(g.run.ready,false);
});
test('local mutation settlement requests the deferred final audit',async()=>{
 let settling=true;const f=fixture({canAudit:()=>!settling});for(const id of ids)f.run.input(id);await f.advance(5000);assert.equal(f.run.ready,false);assert.ok(f.run.snapshot().pages.every(p=>p.verified===p.generation));
 settling=false;await f.run.audit();assert.equal(f.run.ready,true);
});

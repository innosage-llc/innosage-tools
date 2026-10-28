import test from 'node:test';
import assert from 'node:assert/strict';
import {PreparedDrain} from './prepared-drain.mjs';
const ids=Array.from({length:26},(_,i)=>'w142_'+String.fromCharCode(65+i));
const doc=(id,g)=>({id,body:JSON.stringify({title:id,parentId:null,order:0,markdown:'generation '+g}),editId:id+'-'+g,_deleted:false});
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
class Clock {
  time=0;serial=0;timers=new Map();
  setTimeout=(fn,delay)=>{const id=++this.serial;this.timers.set(id,{at:this.time+delay,fn});return id;};
  clearTimeout=id=>this.timers.delete(id);
  async to(target){await flush();for(;;){const next=[...this.timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;this.time=next[1].at;this.timers.delete(next[0]);next[1].fn();await flush();}this.time=target;await flush();}
}
function fixture(overrides={}){
  const clock=new Clock(),local=new Map(),writes=[],publications=[];let run;
  const session={baseline:id=>({fileId:'file-'+id,etag:'"v0"',record:doc(id,0)}),
    async protect(rows,allowed){assert(allowed());publications.push(structuredClone(rows));},
    async upload(row,{canDispatch,onDispatched}){assert(canDispatch());writes.push({id:row.target.id,generation:row.generation,at:clock.time,row:structuredClone(row)});onDispatched({atMs:clock.time});return {observed:{record:structuredClone(row.target),etag:'"v'+row.generation+'"'}};},
    async finish(current){assert(current());},halt(){},...overrides};
  run=new PreparedDrain({ids,clock,now:()=>clock.time,session,check:async()=>true,save:async id=>{const generation=run.entries.get(id).generation,value=doc(id,generation);local.set(id,value);run.saved(id,generation,value,generation);}});
  return {clock,run,session,local,writes,publications};
}
test('A–Z each performs its own exact current-version upload at last input plus5s, including Z',async()=>{
  const f=fixture();for(let i=0;i<26;i++){await f.clock.to(i*1000);f.run.input(ids[i]);await flush();}
  await f.clock.to(30000);assert.equal(f.writes.length,26);for(let i=0;i<26;i++){assert.equal(f.writes[i].id,ids[i]);assert.equal(f.writes[i].at,i*1000+5000);assert.equal(f.writes[i].row.target.editId,ids[i]+'-1');}
  assert.equal(f.run.ready,true);assert.equal(f.local.size,26);assert.equal(f.run.events.at(-1).type,'safe-to-close');assert.equal(f.run.events.at(-1).onsetTargetMet,true);assert.equal(f.run.snapshot().flight,false);
});
test('slow WAL protection is recorded as lateness, never as an upload at eligibility',async()=>{
  let release;const gate=new Promise(r=>{release=r;});let first=true;const f=fixture({async protect(){if(first){first=false;await gate;}}});
  f.run.input(ids[0]);await f.clock.to(5000);assert.equal(f.writes.length,0);assert(f.run.events.some(e=>e.type==='deadline-waiting-for-protection'));
  await f.clock.to(6500);release();await flush();assert.equal(f.writes[0].at,6500);assert.equal(f.run.entries.get(ids[0]).onsetLatenessMs,1500);assert.equal(f.run.ready,false);f.run.stop();
});
test('editing A again resets only A; B still uploads on its own deadline',async()=>{
  const f=fixture();f.run.input(ids[0]);await f.clock.to(1000);f.run.input(ids[1]);await f.clock.to(2999);f.run.input(ids[0]);await f.clock.to(8000);
  assert.deepEqual(f.writes.map(r=>[r.id,r.generation,r.at]),[[ids[1],1,6000],[ids[0],2,7999]]);f.run.stop();
});
test('A1 remains in flight while B uploads; A2 waits for its own deadline and never inherits A1 completion',async()=>{
  const f=fixture();const upload=f.session.upload;let release;
  f.session.upload=async(row,options)=>{const result=await upload(row,options);if(row.target.id===ids[0]&&row.generation===1)await new Promise(r=>{release=r;});return result;};
  f.run.input(ids[0]);await f.clock.to(1000);f.run.input(ids[1]);await f.clock.to(5500);f.run.input(ids[0]);await f.clock.to(6000);
  assert(f.writes.some(r=>r.id===ids[1]&&r.at===6000));assert.equal(f.run.entries.get(ids[0]).verified,0);
  await f.clock.to(7000);release();await flush();assert.equal(f.run.entries.get(ids[0]).verified,0);
  await f.clock.to(10500);assert(f.writes.some(r=>r.id===ids[0]&&r.generation===2&&r.at===10500));assert.equal(f.run.entries.get(ids[0]).verified,2);f.run.stop();
});
test('new input during finalization invalidates readiness and remains locally durable',async()=>{
  const f=fixture();f.session.finish=async()=>{f.run.input(ids[0]);await flush();};
  for(let i=0;i<26;i++){await f.clock.to(i*1000);f.run.input(ids[i]);}await f.clock.to(30000);
  assert.equal(f.run.ready,false);assert.match(f.run.halted,/FINALIZATION_FAILED/);assert.equal(f.local.get(ids[0]).editId,ids[0]+'-2');assert.equal(f.run.entries.get(ids[0]).saved,2);
});
test('missing physical upload receipt cannot be credited as a successful measured generation',async()=>{
  const f=fixture({upload:async row=>({observed:{record:row.target,etag:'"v1"'}})});f.run.input(ids[0]);await f.clock.to(5000);assert.match(f.run.halted,/ACTUAL_UPLOAD_RECEIPT_MISSING/);assert.equal(f.run.ready,false);
});
test('local autosave continues after cloud protection failure, without further cloud dispatch',async()=>{
  const f=fixture({protect:async()=>{throw Error('permission');}});f.run.input(ids[0]);await flush();assert.match(f.run.halted,/WAL_PROTECTION_FAILED/);f.run.input(ids[25]);await flush();assert.equal(f.local.get(ids[25]).editId,ids[25]+'-1');await f.clock.to(6000);assert.equal(f.writes.length,0);
});
test('older duplicate local ACK cannot replace a newer saved record for the same input generation',async()=>{
  const f=fixture();f.run.input(ids[0]);await flush();const newer={...doc(ids[0],1),editId:'newer-edit'};
  f.run.saved(ids[0],1,newer,3);f.run.saved(ids[0],1,doc(ids[0],1),2);await f.clock.to(5000);assert.equal(f.writes[0].row.target.editId,'newer-edit');f.run.stop();
});

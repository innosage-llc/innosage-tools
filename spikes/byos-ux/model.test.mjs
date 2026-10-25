import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,catalog,copy,same} from './model.mjs';
class Clock {
  time=0;seq=0;tasks=new Map();
  setTimeout(fn,ms){const id=++this.seq;this.tasks.set(id,{at:this.time+ms,fn});return id;}
  clearTimeout(id){this.tasks.delete(id);}
  async advance(ms){const end=this.time+ms;for(;;){const next=[...this.tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;this.time=next[1].at;this.tasks.delete(next[0]);await next[1].fn();await flush();}this.time=end;await flush();}
}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function memory(){const rows=new Map();return {identity:'unit',all:async()=>copy([...rows.values()]),put:async row=>{rows.set(row.id,copy(row));}};}
async function fixture(size){const storage=memory(),clock=new Clock();const sim=await new Simulation(storage,{clock,now:()=>clock.time}).open();assert.equal(catalog(size).length,size);return {sim,storage,clock};}
for(const size of [12,10000]) {
 for(const latency of [10000,45000])test(`${size} pages / ${latency}ms fake clock: coalesce, one flight, FIFO fairness, handoff invalidation`,async()=>{
  const {sim,clock}=await fixture(size);sim.latency=latency;
  await sim.edit('page-1','first');const old=copy(sim.row('page-1').draft);
  await sim.edit('page-2','inactive full body');await sim.edit('page-1','newer 1');await sim.edit('page-1','newer 2');
  assert.equal(sim.metrics.sends,1);assert.equal(sim.pending.size,2);assert.match(sim.handoff().state,/INCOMPLETE/);
  await clock.advance(latency);assert.equal(sim.flight.id,'page-2');assert(same(sim.destination('page-1'),old));assert.equal(sim.view('page-1').cloud,'queued');
  await clock.advance(latency);assert.equal(sim.flight.id,'page-1');assert.equal(sim.row('page-2').draft.body,'inactive full body');
  await clock.advance(latency);assert.equal(sim.metrics.sends,3);assert.equal(sim.pending.size,0);assert.match(sim.handoff().state,/handoff confirmed/);
  await sim.edit('page-1','after handoff');assert.match(sim.handoff().state,/INCOMPLETE/);assert.equal(sim.destination('page-1').body,'newer 2');
  sim.close();
 });
 test(`${size} pages: never, cancel, late completion, offline/auth recovery and pending reopen`,async()=>{
  const {sim,clock,storage}=await fixture(size);sim.latency='never';await sim.edit('page-1','complete never body');await clock.advance(60000);
  assert.equal(sim.flight.stalled,true);assert.match(sim.view('page-1').cloud,/stalled/);assert.match(sim.handoff().state,/INCOMPLETE/);
  assert.equal(sim.cancel(),true);await sim.edit('page-1','newest after cancel');assert.equal(await sim.late(),false);assert.equal(sim.destination('page-1'),null);
  sim.close();const reopened=await new Simulation(storage,{clock}).open();assert.equal(reopened.row('page-1').draft.body,'newest after cancel');assert.equal(reopened.view('page-1').cloud,'uncertain');assert.equal(reopened.pending.size,1);
  reopened.setFault('auth');assert.equal(reopened.view('page-1').cloud,'authorization-needed');assert.equal(reopened.flight,null);assert.match(reopened.handoff().state,/INCOMPLETE/);
  reopened.latency=10000;await reopened.retry();await clock.advance(10000);assert.match(reopened.handoff().state,/handoff confirmed/);reopened.close();
 });
 for(const action of ['cloud','local','merge'])test(`${size} pages: conflict while typing / ${action} preserves both originals`,async()=>{
  const {sim,clock}=await fixture(size);await sim.edit('page-1','complete local original');await sim.conflict('page-1','complete remote original');
  await sim.edit('page-1','typing continues');await clock.advance(10000);
  assert.equal(sim.row('page-1').draft.body,'typing continues');assert.equal(sim.row('page-1').conflict.local.body,'complete local original');assert.equal(sim.view('page-1').cloud,'needs-resolution');assert.match(sim.handoff().state,/INCOMPLETE/);
  await sim.resolve('page-1',action,'manual complete merge');const row=sim.row('page-1');assert.equal(row.history[0].local.body,'complete local original');assert.equal(row.history[0].remote.body,'complete remote original');
  assert.equal(row.draft.body,action==='cloud'?'complete remote original':action==='local'?'typing continues':'manual complete merge');
  await clock.advance(10000);assert.match(sim.handoff().state,/handoff confirmed/);sim.close();
 });
}
test('local ACK waits for commit; failed commit has no ACK or transport',async()=>{
 const store=memory();let release;store.put=()=>new Promise(r=>release=r);const sim=await new Simulation(store).open();const save=sim.edit('page-1','pending body');await flush();assert.equal(sim.row('page-1').local,'pending');assert.equal(sim.flight,null);release();await save;assert.equal(sim.row('page-1').local,'saved');sim.close();
 const other=await new Simulation(memory()).open();other.failNext=true;await assert.rejects(other.edit('page-1','unsaved'),/persistence failure/);assert.equal(other.row('page-1').local,'failed');assert.equal(other.flight,null);assert.match(other.handoff().state,/INCOMPLETE/);other.close();
});
test('cancel after old completion starts cannot race durable receipt; newer edit survives',async()=>{
 const {sim,clock}=await fixture(12);await sim.edit('page-1','old');const op=sim.flight;await sim.edit('page-1','new');await sim.complete(op);assert.equal(sim.row('page-1').draft.body,'new');assert.equal(sim.destination('page-1').body,'old');assert.notEqual(sim.view('page-1').cloud,'confirmed');await clock.advance(10000);sim.close();
});
test('repeated conflict injection retains earlier complete conflict bodies',async()=>{
 const {sim}=await fixture(12);sim.setFault('offline');await sim.edit('page-1','original local');await sim.conflict('page-1','remote one');await sim.edit('page-1','new local');await sim.conflict('page-1','remote two');assert.equal(sim.row('page-1').history[0].remote.body,'remote one');assert.equal(sim.row('page-1').history[0].local.body,'original local');assert.equal(sim.row('page-1').conflict.remote.body,'remote two');sim.close();
});

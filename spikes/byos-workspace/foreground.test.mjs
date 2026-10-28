import assert from 'node:assert/strict';
import test from 'node:test';
import {ForegroundRun} from './foreground.mjs';

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => {resolve=yes;reject=no;}); return {promise,resolve,reject}; }
function fixture(sync = async () => {}) {
  const timers = new Map(); let counter = 0;
  const clock = {setTimeout(fn) {timers.set(++counter,fn);return counter;}, clearTimeout(id) {timers.delete(id);}};
  const flags = {authorized:true,visible:true,online:true};
  const store = {writer:true,closed:false}; let calls = 0;
  const workspace = {store,sync:()=>{calls++;return sync();}};
  const options = {clock,authorized:()=>flags.authorized,visible:()=>flags.visible,online:()=>flags.online};
  const run = new ForegroundRun(workspace,options);
  const tick = () => {const ready=[...timers.values()];timers.clear();for(const fn of ready)fn();};
  return {run,workspace,options,flags,store,timers,tick,calls:()=>calls};
}
const settle = async () => {await Promise.resolve();await Promise.resolve();};

test('foreground policy coalesces durable signals and never produces verification', async () => {
  const f=fixture();for(let i=0;i<12;i++)f.run.saved();
  assert.equal(f.calls(),0);assert.equal(f.timers.size,1);
  f.tick();await settle();assert.equal(f.calls(),1);
  assert.deepEqual(f.run.snapshot(),{state:'idle',acknowledged:12,settled:12,pending:false,dispatches:1,cloudVerified:false,destinationObserved:false});
});
test('saves during both flights retain newest intent when two-dispatch budget ends', async () => {
  const flights=[deferred(),deferred()];let i=0;const f=fixture(()=>flights[i++].promise);
  f.run.saved();f.tick();f.run.saved();f.run.saved();assert.equal(f.timers.size,0);
  flights[0].resolve();await settle();assert.equal(f.run.snapshot().pending,true);
  f.tick();f.run.saved();flights[1].resolve();await settle();
  assert.equal(f.calls(),2);assert.equal(f.run.snapshot().state,'budget-exhausted');
  assert.equal(f.run.snapshot().pending,true);assert.equal(f.run.snapshot().settled,3);
  f.run.wake();f.tick();assert.equal(f.calls(),2);
});
test('never-settling operation remains sole flight; stop is not cancellation', async () => {
  const hold=deferred(),f=fixture(()=>hold.promise);f.run.saved();f.tick();
  for(let i=0;i<20;i++){f.run.saved();f.run.wake();f.tick();}
  assert.equal(f.calls(),1);assert.equal(f.run.snapshot().state,'in-flight');
  f.run.stop();hold.resolve();await settle();f.tick();assert.equal(f.calls(),1);
  assert.equal(f.run.snapshot().state,'stopped');assert.equal(f.run.snapshot().pending,true);
});
test('timeout rejection and late underlying success cannot rearm or replace run', async () => {
  const exposed=deferred(),underlying=deferred();let late=false;
  underlying.promise.then(()=>{late=true;});const f=fixture(()=>exposed.promise);
  f.run.saved();f.tick();f.run.saved();exposed.reject(Error('SYNC_BUDGET_EXHAUSTED'));await settle();
  assert.equal(f.run.snapshot().state,'halted');assert.equal(f.run.snapshot().pending,true);
  underlying.resolve();await settle();assert.equal(late,true);
  f.run.saved();f.run.wake();f.tick();assert.equal(f.calls(),1);
  assert.throws(()=>new ForegroundRun(f.workspace,f.options),/replacement\/rearming/);
});
for(const flag of ['visible','online','authorized'])test(`dispatch rechecks ${flag}, preserves pending signals without polling`, async () => {
  const f=fixture();f.run.saved();f.flags[flag]=false;f.tick();assert.equal(f.calls(),0);
  assert.equal(f.run.snapshot().pending,true);assert.equal(f.timers.size,0);
  f.flags[flag]=true;f.run.wake();f.tick();await settle();assert.equal(f.calls(),1);
});
test('manual cloud action and writer ownership fence dispatch; duplicate mount rejected', async () => {
  const f=fixture();assert.throws(()=>new ForegroundRun(f.workspace,f.options),/already exists/);
  f.run.saved();f.store.operation={kind:'verify',pending:true};f.tick();assert.equal(f.calls(),0);
  f.store.operation.pending=false;f.run.wake();f.store.writer=false;f.tick();assert.equal(f.calls(),0);
  f.store.writer=true;f.run.wake();f.tick();await settle();assert.equal(f.calls(),1);
});

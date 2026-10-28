import test from 'node:test';
import assert from 'node:assert/strict';
import {PreparedSession} from './prepared-session.mjs';
import {conditionalFileMutation} from './prepared-mutation.mjs';
import {retryDelay} from './upload-retry.mjs';
import {PreparedDrain} from './prepared-drain.mjs';

const doc=(id,g)=>({id,body:JSON.stringify({title:id,parentId:null,order:id.charCodeAt(0),markdown:'g'+g}),editId:id+'-'+g,_deleted:false});
function fixture(){
  let time=0,version=1;const calls=[],events=[],files=new Map(),baselines=new Map();
  for(const id of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'){const record=doc(id,0);baselines.set(id,{fileId:'file'+id,record,etag:'"v0"'});files.set('file'+id,{value:record,etag:'"v0"'});}
  files.set('wal',{value:null,etag:'"wal0"'});files.set('lease',{value:{createdAtClientTime:123,owner:'run'},etag:'"lease0"'});
  const io={
    async readFile(id){calls.push(['read',id]);return structuredClone(files.get(id));},
    async putFile(id,etag,value,{beforeDispatch=()=>{},onDispatched=()=>{}}={}){
      beforeDispatch();calls.push(['put',id,etag,structuredClone(value)]);onDispatched({atMs:time});
      if(files.get(id).etag!==etag)throw Object.assign(Error('CAS'),{status:412});
      files.set(id,{value:structuredClone(value),etag:'"v'+version+++'"'});
    },
    async readPage(id){const result=await io.readFile(id);return {...result,record:result.value};},
    writePage:(...args)=>io.putFile(...args),
  };
  const clock={now:()=>time,wallNow:()=>Date.UTC(2026,9,28)+time,sleep:async ms=>{time+=ms;},random:()=>0.5};
  let reconciled=0,retired=0;
  const session=new PreparedSession({workspace:'workspace',runId:'run',baselines,wal:{fileId:'wal',...files.get('wal')},lease:{fileId:'lease',acquiredAt:0,...files.get('lease')},io,clock,
    budget:{assertCanRequest(){if(time>=180000)throw Error('BUDGET');},remainingMs:()=>180000-time},event:e=>events.push(e),
    reconcile:async()=>{reconciled++;},retire:async()=>{retired++;}});
  const row=(id,g=1,base=baselines.get(id))=>({fileId:base.fileId,expectedEtag:base.etag,base:base.record,target:doc(id,g),generation:g});
  return {session,files,io,clock,calls,events,row,at:ms=>{time=ms;},get reconciled(){return reconciled;},get retired(){return retired;}};
}
test('26 protected pages require complete readback, WAL clear and lease release before native reconciliation and retirement',async()=>{
  const f=fixture(),rows=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(id=>f.row(id));await f.session.protect(rows);
  const receipts=[];for(const row of rows)await f.session.upload(row,{canDispatch:()=>true,onDispatched:r=>receipts.push(r)});
  await f.session.finish(()=>true);
  assert.equal(receipts.length,26);assert.equal(f.session.finished,true);assert.equal(f.reconciled,1);assert.equal(f.retired,1);
  assert.equal(f.files.get('wal').value,null);assert.equal(f.files.get('lease').value,null);
  assert.deepEqual(f.calls.filter(c=>c[0]==='put').slice(-2).map(c=>c[1]),['wal','lease']);
});
test('never-dispatched protected drafts may coalesce, but a lost-outcome predecessor cannot be dropped',async()=>{
  const f=fixture();await f.session.protect([f.row('A')]);await f.session.protect([f.row('A',2)]);
  const put=f.io.putFile;f.io.putFile=async(...args)=>{await put(...args);if(args[0]==='fileA')throw Object.assign(Error('lost'),{network:true});};
  f.io.readPage=async()=>{throw Object.assign(Error('expired'),{status:401});};
  await assert.rejects(f.session.upload(f.row('A',2),{canDispatch:()=>true}),/WRITE_OUTCOME_UNRESOLVED/);
  await assert.rejects(f.session.protect([f.row('A',3)]),/UNCONFIRMED_WAL_PREDECESSOR/);
  assert.equal(f.files.get('wal').value.rows[0].generation,2);
});
test('confirmed predecessor enables a successor only with its exact complete baseline and ETag',async()=>{
  const f=fixture();await f.session.protect([f.row('A')]);const result=await f.session.upload(f.row('A'),{canDispatch:()=>true});
  await assert.rejects(f.session.protect([f.row('A',2)]),/UNCONFIRMED_WAL_PREDECESSOR/);
  const baseline={fileId:'fileA',...result.observed};await f.session.protect([f.row('A',2,baseline)]);
  await f.session.protect([f.row('A',3,baseline)]);
  assert.equal(f.files.get('wal').value.rows[0].generation,3);
});
test('external WAL replacement rejects stale CAS and preserves all local obligations',async()=>{
  const f=fixture();await f.session.protect([f.row('A')]);const foreign={value:{format:'foreign'},etag:'"foreign"'};f.files.set('wal',foreign);
  await assert.rejects(f.session.protect([f.row('A',2)]),/UPLOAD_CONFLICT/);
  assert.deepEqual(f.files.get('wal'),foreign);assert.equal(f.session.rows.get('A').generation,1);
});
test('lease cutoff refuses physical writes without extending native lease or retiring journals',async()=>{
  const f=fixture();await f.session.protect([f.row('A')]);f.at(40000);
  await assert.rejects(f.session.upload(f.row('A'),{canDispatch:()=>true}),/LEASE_WRITE_WINDOW_EXHAUSTED/);
  assert(!f.calls.some(c=>c[0]==='put'&&c[1]==='fileA'));assert.equal(f.retired,0);assert(f.files.get('wal').value);
});
test('uncertain WAL clear reconciles exact empty content without duplicate PUT',async()=>{
  const f=fixture();const put=f.io.putFile;f.io.putFile=async(...args)=>{await put(...args);throw Object.assign(Error('lost'),{network:true});};
  const snapshot=structuredClone(f.files.get('lease'));
  const result=await conditionalFileMutation({fileId:'lease',snapshot,target:null,io:f.io,canDispatch:()=>true,budget:f.session.mutationBudget(),clock:f.clock});
  assert.equal(result.value,null);assert.equal(f.calls.filter(c=>c[0]==='put').length,1);
});
test('new edit during native reconciliation prevents retirement even after cleanup',async()=>{
  const f=fixture(),rows=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(id=>f.row(id));await f.session.protect(rows);for(const row of rows)await f.session.upload(row,{canDispatch:()=>true});
  let current=true;f.session.reconcile=async()=>{current=false;};
  await assert.rejects(f.session.finish(()=>current),/GENERATION_CHANGED_DURING_RECONCILIATION/);
  assert.equal(f.retired,0);assert.equal(f.session.finished,false);assert.equal(f.session.released,true);
});
test('Retry-After HTTP date uses wall clock while next retry retains monotonic clock',()=>{
  const wall=Date.UTC(2026,9,28),retryAfter=new Date(wall+4000).toUTCString();
  const delay=retryDelay({attempt:1,retryAfter,nowMs:1200,wallNowMs:wall,remainingMs:10000});
  assert.equal(delay.delayMs,4000);assert.equal(delay.nextAtMs,5200);
});
test('publishing a replacement fences predecessor dispatch while unchanged other pages remain admissible',async()=>{
  const f=fixture();await f.session.protect([f.row('A'),f.row('B')]);
  const put=f.io.putFile;let release,entered;const waiting=new Promise(r=>{entered=r;});
  f.io.putFile=async(...args)=>{if(args[0]==='wal'){entered();await new Promise(r=>{release=r;});}return put(...args);};
  const publication=f.session.protect([f.row('A',2),f.row('B')]);await waiting;
  await assert.rejects(f.session.upload(f.row('A'),{canDispatch:()=>true}),/PAGE_NOT_EXCLUSIVELY_PROTECTED/);
  await f.session.upload(f.row('B'),{canDispatch:()=>true});release();await publication;
  assert(!f.calls.some(c=>c[0]==='put'&&c[1]==='fileA'));assert.equal(f.files.get('wal').value.rows[0].generation,2);
});
test('real session completion remains stable through repeated wake and audit; later input invalidates it and still saves locally',async()=>{
  const f=fixture(),ids=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];let saves=0;
  const timer={setTimeout:()=>1,clearTimeout(){}};
  const drain=new PreparedDrain({ids,save:async()=>{saves++;},session:f.session,check:async()=>true,clock:timer,now:f.clock.now});
  // Populate acknowledged inputs, then exercise the actual publisher, upload
  // coordinator, cleanup, and non-idempotent session completion together.
  for(const id of ids){drain.input(id);drain.saved(id,1,doc(id,1),1);}
  for(let i=0;i<100&&drain.publishing;i++)await new Promise(r=>setImmediate(r));
  f.at(5000);drain.wake();
  for(let i=0;i<100&&!drain.ready&&!drain.halted;i++)await new Promise(r=>setImmediate(r));
  assert.equal(drain.halted,null);assert.equal(drain.ready,true);assert.equal(f.session.finished,true);
  const calls=f.calls.length;for(let i=0;i<5;i++){drain.wake();await drain.audit();}
  assert.equal(drain.ready,true);assert.equal(drain.halted,null);assert.equal(f.calls.length,calls);
  drain.input('A');await new Promise(r=>setImmediate(r));assert.equal(drain.ready,false);assert.equal(saves,27);assert.equal(f.calls.length,calls);
});

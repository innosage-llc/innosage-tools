import test from 'node:test';
import assert from 'node:assert/strict';
import {PreparedOwner} from './prepared-owner.mjs';

const record=(id,g)=>({id,body:JSON.stringify({title:id,parentId:null,order:0,markdown:'complete '+g}),editId:id+'-'+g,_deleted:false});
function fixture({applied=true,readMs=500,releaseReadFailure=false,renewable=false}={}){
  const ids=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],events=[],writes=[],files=new Map(),journals=new Map();
  let time=0,version=1,retired=0,reconciled=0,current=true,nativeGuard;
  for(const id of ids){const base=record(id,0),draft=record(id,1);journals.set(id,{page:id,session:'session',seq:1,state:'pending',base,draft});files.set('file'+id,{value:applied?draft:base,etag:'"v0"'});}
  files.set('lease',{value:null,etag:'"lease0"'});files.set('wal',{value:null,etag:'"wal0"'});
  const bindings={fileIds:new Map(ids.map(id=>[id,'file'+id])),walId:'wal',leaseId:'lease'};
  const clock={now:()=>time,wallNow:()=>1793200000000+time,sleep:async ms=>{time+=ms;},random:()=>0.5,setTimeout:()=>1,clearTimeout(){}};
  const store={workspace:'workspace',session:'session',writer:true,closed:false,operation:{pending:true},db:{isLeader:()=>true,localDrafts:{find:()=>({exec:async()=>[...journals.values()].map(row=>({toJSON:()=>structuredClone(row)}))})}},
    replication:{pause:async()=>{},googleDrive:{},driveStructure:{}},draft:async id=>structuredClone(journals.get(id)),
    holdPreparedGenerations:async(confirmed,check)=>{assert(check());assert.equal(confirmed.size,26);},
    _sync:async()=>{reconciled++;},retirePreparedGenerations:async(rows,check)=>{assert(check());assert.equal(rows.size,26);retired++;}};
  const owner=new PreparedOwner({store,inventory:async()=>bindings,clock,renewable,event:e=>events.push(e),assertDrained:async()=>{},withNativeFence:async(guard,fn)=>{nativeGuard=guard;guard();return fn();},
    budget:{assertCanRequest(){assert(time<180000);},remainingMs:()=>180000-time},
    createIO:({assertCanRequest,assertCanWrite})=>{
      const io={readFile:async id=>{assertCanRequest();time+=readMs;if(releaseReadFailure&&id==='lease'&&writes.length===2)throw Object.assign(Error('AUTH_REQUIRED'),{status:401});return structuredClone(files.get(id));},
        putFile:async(id,etag,value,{beforeDispatch=()=>{}}={})=>{assertCanRequest();assertCanWrite({role:id==='lease'?'lease':id==='wal'?'wal':'page'});beforeDispatch();
          writes.push({id,etag,value:structuredClone(value)});assert.equal(files.get(id).etag,etag,'original CAS validator');time+=1000;files.set(id,{value:structuredClone(value),etag:'"v'+version+++'"'});},
        readPage:async id=>{const value=await io.readFile(id);return {...value,record:value.value};},writePage:(...args)=>io.putFile(...args)};return io;
    }});
  return {owner,store,ids,files,journals,writes,events,bindings,nativeGuard:()=>nativeGuard(),recover:()=>owner.recover(ids,()=>current),invalidate:()=>{current=false;},advance:ms=>{time+=ms;},get time(){return time;},get retired(){return retired;},get reconciled(){return reconciled;}};
}

test('slow already-applied recovery reads all 26 full records without republishing no-op WAL',async()=>{
  const f=fixture();await f.recover();
  assert.equal(f.retired,1);assert.equal(f.reconciled,1);assert.equal(f.owner.mode,'complete');
  assert.deepEqual(f.writes.map(w=>w.id),['lease','lease']);assert.equal(f.files.get('wal').value,null);assert.equal(f.files.get('lease').value,null);
  const observed=f.events.filter(e=>e.type==='recovery-page-observed');assert.equal(observed.length,26);
  for(const e of observed){assert(e.matchesFinal);assert.deepEqual(e.observed.record,record(e.page,1));assert.equal(e.generation,1);assert(e.observed.etag);}
  assert(f.time<40000);assert(f.events.some(e=>e.type==='recovery-already-applied'));
});
test('not-yet-applied recovery still protects full intents in WAL before any page writes',async()=>{
  const f=fixture({applied:false,readMs:0});await f.recover();
  assert.equal(f.retired,1);const firstPage=f.writes.findIndex(w=>w.id.startsWith('file')),wal=f.writes.findIndex(w=>w.id==='wal'&&w.value);
  assert(wal>=0&&wal<firstPage);assert.equal(f.writes[wal].value.rows.length,26);assert.equal(f.writes.filter(w=>w.id.startsWith('file')).length,26);
  assert(!f.events.some(e=>e.type==='recovery-already-applied'));
});
test('external remote record aborts recovery without dropping any journal or overwriting content',async()=>{
  const f=fixture();f.files.set('fileA',{value:record('A',9),etag:'"external"'});
  await assert.rejects(f.recover(),/RECOVERY_LOCAL_REMOTE_CONFLICT/);assert.equal(f.retired,0);assert.equal(f.journals.size,26);
  assert.deepEqual(f.files.get('fileA').value,record('A',9));assert.deepEqual(f.writes.map(w=>w.id),['lease']);
});
test('new input during native reconciliation prevents retirement after no-op recovery',async()=>{
  const f=fixture();f.store._sync=async()=>f.invalidate();await assert.rejects(f.recover(),/RECOVERY_OWNERSHIP_CHANGED/);assert.equal(f.retired,0);assert.equal(f.journals.size,26);
});
test('changed journal during reconciliation is retained even after full cloud readback',async()=>{
  const f=fixture();f.store._sync=async()=>{f.journals.get('A').seq=2;f.journals.get('A').draft=record('A',2);};
  await assert.rejects(f.recover(),/RECOVERY_LOCAL_GENERATION_CHANGED/);assert.equal(f.retired,0);assert.deepEqual(f.journals.get('A').draft,record('A',2));
});
test('native reconciliation failure cannot mark already-applied recovery complete',async()=>{
  const f=fixture();f.store._sync=async()=>{throw Error('native failed');};await assert.rejects(f.recover(),/native failed/);assert.equal(f.retired,0);assert.equal(f.owner.mode,'halted');
});
test('already-applied optimization never extends the unchanged 40-second mutation cutoff',async()=>{
  const f=fixture({readMs:1500});await assert.rejects(f.recover(),/LEASE_WRITE_WINDOW_EXHAUSTED/);assert.equal(f.retired,0);assert.equal(f.writes.length,1);assert(f.files.get('lease').value);assert.equal(f.journals.size,26);
});
test('lost release verification preserves every journal and never reports recovery complete',async()=>{
  const f=fixture({releaseReadFailure:true});await assert.rejects(f.recover(),/WRITE_OUTCOME_UNRESOLVED/);
  assert.equal(f.retired,0);assert.equal(f.reconciled,0);assert.equal(f.journals.size,26);assert.equal(f.owner.mode,'halted');
  assert(!f.events.some(e=>e.type==='recovery-complete'));assert.deepEqual(f.writes.map(w=>w.id),['lease','lease']);
});
test('native physical callback fence blocks page/WAL work if heartbeat becomes uncertain after callback admission',async()=>{
  const f=fixture({renewable:true});let owned,physicalWrites=0;const acquire=f.owner.ioForLease.bind(f.owner);
  f.owner.ioForLease=async(...args)=>{owned=await acquire(...args);return owned;};
  f.owner.mode='reconciling';f.owner.context={workspace:'workspace',allowedIds:new Set(f.ids),fileIds:f.bindings.fileIds};f.owner.bindings=f.bindings;
  await assert.rejects(f.owner.runTransaction({}, {}, 'id',async()=>{owned.authority.uncertain=true;f.nativeGuard();physicalWrites++;}),/LEASE_RENEWAL_UNCERTAIN/);
  assert.equal(physicalWrites,0);assert.equal(f.journals.size,26);assert.equal(f.owner.mode,'halted');owned.authority.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {WAL_FORMAT,WAL_VERSION,validateWal,recoveryDecision,recoverPreparedWal,auditLegacyRow} from './prepared-wal.mjs';
import {classifyUploadError,retryDelay} from './upload-retry.mjs';
const doc=(id,g)=>({id,body:JSON.stringify({title:id,parentId:null,order:0,markdown:'generation '+g}),editId:id+'-'+g,_deleted:false});
const context={workspace:'fixture',allowedIds:new Set(['A','B']),fileIds:new Map([['A','fileA'],['B','fileB']])};
const row=id=>({generation:1,fileId:'file'+id,expectedEtag:'"v0"',base:doc(id,0),target:doc(id,1)});
const snapshot=()=>({etag:'"wal1"',value:{format:WAL_FORMAT,version:WAL_VERSION,workspace:'fixture',runId:'run1',rows:[row('A'),row('B')]}});
function memoryIO() {
  const pages=new Map(['A','B'].map(id=>['file'+id,{etag:'"v0"',record:doc(id,0)}]));
  const calls=[];let walEtag='"wal1"';
  const io={
    assertCanWrite(){calls.push('admit');},
    async readPage(id){return structuredClone(pages.get(id));},
    async writePage(id,etag,target){calls.push({write:id,etag,target});if(pages.get(id).etag!==etag)throw Error('412');pages.set(id,{etag:'"v1"',record:structuredClone(target)});},
    async clearWal(etag){calls.push({clear:etag});if(etag!==walEtag)throw Error('WAL412');},
  };
  return {io,pages,calls,changeWal:()=>{walEtag='"wal2"';}};
}
test('versioned WAL validates workspace, full records, unique identity and frozen file binding',()=>{
  assert.equal(validateWal(snapshot().value,context).rows.length,2);
  for(const mutate of [v=>v.version++,v=>v.workspace='other',v=>v.rows[0].fileId='personal',v=>v.rows.push(v.rows[0]),v=>v.rows[0].target.id='B']){
    const value=snapshot().value;mutate(value);assert.throws(()=>validateWal(value,context));
  }
});
test('recovery uses original baseline and ETag; exact target is idempotently recognized',()=>{
  const r=row('A');assert.equal(recoveryDecision(r,{etag:'"v0"',record:doc('A',0)}),'write-with-stored-etag');
  assert.equal(recoveryDecision(r,{etag:'"v2"',record:doc('A',1)}),'already-applied');
  assert.equal(recoveryDecision(r,{etag:'"v2"',record:doc('A',0)}),'conflict');
  assert.equal(recoveryDecision(r,{etag:'"v0"',record:doc('A',9)}),'conflict');
});
test('crash after WAL publish: guarded recovery applies and independently reads exact records before clear',async()=>{
  const m=memoryIO();const result=await recoverPreparedWal(snapshot(),context,m.io);assert.deepEqual(result,{recovered:2,writes:2});
  assert.deepEqual(m.pages.get('fileA').record,doc('A',1));assert.equal(m.calls.at(-1).clear,'"wal1"');
});
test('outside edit before recovery preserves all pages and WAL without any write',async()=>{
  const m=memoryIO();m.pages.set('fileB',{etag:'"external"',record:doc('B',9)});
  await assert.rejects(recoverPreparedWal(snapshot(),context,m.io),/RECOVERY_CONFLICT/);assert.equal(m.calls.length,0);
});
test('outside edit after recovery read is protected by stored CAS, with no WAL clear',async()=>{
  const m=memoryIO();const read=m.io.readPage;let reads=0;m.io.readPage=async id=>{const value=await read(id);if(++reads===2)m.pages.set('fileA',{etag:'"external"',record:doc('A',9)});return value;};
  await assert.rejects(recoverPreparedWal(snapshot(),context,m.io),/412/);assert.deepEqual(m.pages.get('fileA').record,doc('A',9));assert(!m.calls.some(c=>c.clear));
});
test('lost page response after commit retains WAL; later recovery recognizes target without duplicate mutation',async()=>{
  const m=memoryIO();const write=m.io.writePage;let once=true;m.io.writePage=async(...args)=>{await write(...args);if(once){once=false;throw Error('LOST_RESPONSE');}};
  await assert.rejects(recoverPreparedWal(snapshot(),context,m.io),/LOST_RESPONSE/);assert(!m.calls.some(c=>c.clear));
  const result=await recoverPreparedWal(snapshot(),context,m.io);assert.equal(result.writes,1);assert.equal(m.calls.filter(c=>c.write==='fileA').length,1);
});
test('new WAL generation cannot be cleared using a freshly substituted validator',async()=>{
  const m=memoryIO();m.changeWal();await assert.rejects(recoverPreparedWal(snapshot(),context,m.io),/WAL412/);
  assert.equal(m.calls.at(-1).clear,'"wal1"');
});
test('expired lease refuses mutation; unknown WAL and unsafe legacy creates fail closed',async()=>{
  const m=memoryIO();m.io.assertCanWrite=()=>{throw Error('LEASE_EXPIRED');};await assert.rejects(recoverPreparedWal(snapshot(),context,m.io),/LEASE_EXPIRED/);assert.equal(m.calls.length,0);
  const legacy={assumedMasterState:doc('A',0),newDocumentState:doc('A',1)};
  assert.equal(auditLegacyRow(legacy,{etag:'"v0"',record:doc('A',0)},'fileA',1,context.allowedIds,context.fileIds).expectedEtag,'"v0"');
  assert.throws(()=>auditLegacyRow({...legacy,assumedMasterState:null},{etag:'"v0"',record:doc('A',0)},'fileA',1,context.allowedIds,context.fileIds),/UNSAFE_LEGACY/);
  assert.throws(()=>auditLegacyRow(legacy,{etag:'"external"',record:doc('A',9)},'fileA',1,context.allowedIds,context.fileIds),/LEGACY_WAL_CONFLICT/);
});
test('retry classification distinguishes reason-specific rate limits, permissions, authentication and unknown writes',()=>{
  assert.equal(classifyUploadError({status:403,reason:'userRateLimitExceeded',write:true}).retry,true);
  assert.equal(classifyUploadError({status:403,reason:'insufficientPermissions',write:true}).retry,false);
  assert.equal(classifyUploadError({status:429,reason:'storageQuotaExceeded'}).retry,false);
  assert.equal(classifyUploadError({status:401}).state,'auth-required');
  assert.equal(classifyUploadError({status:503,write:true}).reconcile,true);
  assert.equal(classifyUploadError({network:true,write:true}).reconcile,true);
  assert.equal(classifyUploadError({status:412,write:true}).retry,false);
  assert.equal(classifyUploadError({offline:true}).retry,false);
});
test('bounded backoff honors Retry-After and stops instead of exceeding remaining budget',()=>{
  const args={attempt:1,nowMs:100000,wallNowMs:100000,remainingMs:10000};
  assert.equal(retryDelay({...args,retryAfter:'3'}).delayMs,3000);
  assert.equal(retryDelay({...args,retryAfter:new Date(105000).toUTCString()}).delayMs,5000);
  assert.equal(retryDelay({...args,attempt:3}).stop,'ATTEMPT_BUDGET_EXHAUSTED');
  assert.equal(retryDelay({...args,retryAfter:'20'}).stop,'TIME_BUDGET_EXHAUSTED');
});

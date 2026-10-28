import test from 'node:test';
import assert from 'node:assert/strict';
import {conditionalUpload} from './conditional-upload.mjs';
const doc=g=>({id:'A',body:JSON.stringify({title:'A',parentId:null,order:0,markdown:'g'+g}),editId:'A-'+g,_deleted:false});
const row={generation:1,fileId:'fileA',expectedEtag:'"v0"',base:doc(0),target:doc(1)};
function fixture(){
  let time=0,current=true,remote={record:doc(0),etag:'"v0"'};const events=[],writes=[],waits=[];let reads=0;
  const args={row,canDispatch:()=>current,onState:e=>events.push(e),budget:{remainingMs:()=>10000-time,assertCanRequest(){assert(time<10000);}},
    clock:{now:()=>time,random:()=>0.5,sleep:async ms=>{waits.push(ms);time+=ms;}},
    io:{readPage:async()=>{reads++;return structuredClone(remote);},writePage:async(id,etag,target)=>{writes.push({id,etag,target});assert.equal(etag,remote.etag);remote={record:structuredClone(target),etag:'"v1"'};}}};
  return {args,events,writes,waits,get reads(){return reads;},supersede:()=>{current=false;},setRemote:x=>{remote=x;}};
}
test('transient 503 retries with bounded backoff and exact original CAS after independent baseline check',async()=>{
  const f=fixture(),write=f.args.io.writePage;let attempts=0;f.args.io.writePage=async(...args)=>{if(++attempts===1)throw Object.assign(Error('temporary'),{status:503});return write(...args);};
  const r=await conditionalUpload(f.args);assert.equal(r.attempts,2);assert.deepEqual(f.waits,[500]);assert.equal(f.reads,2);assert.equal(f.writes[0].etag,'"v0"');assert.equal(f.events.at(-1).state,'verified');
});
test('lost response after server commit is verified without issuing a duplicate PUT',async()=>{
  const f=fixture(),write=f.args.io.writePage;f.args.io.writePage=async(...args)=>{await write(...args);throw Object.assign(Error('lost response'),{network:true});};
  const r=await conditionalUpload(f.args);assert.equal(r.reconciled,true);assert.equal(f.writes.length,1);assert.equal(f.waits.length,0);
});
test('new input during backoff blocks old attempt and preserves its unresolved obligation',async()=>{
  const f=fixture();let attempts=0;f.args.io.writePage=async()=>{attempts++;throw Object.assign(Error('timeout'),{network:true});};
  const sleep=f.args.clock.sleep;f.args.clock.sleep=async ms=>{await sleep(ms);f.supersede();};
  await assert.rejects(conditionalUpload(f.args),/SUPERSEDED_WITH_UNCERTAIN_WRITE/);assert.equal(attempts,1);assert(!f.events.some(e=>e.state==='verified'));
});
test('old upload confirmation cannot mark a newer local generation verified',async()=>{
  const f=fixture(),write=f.args.io.writePage;f.args.io.writePage=async(...args)=>{await write(...args);f.supersede();};
  const r=await conditionalUpload(f.args);assert.equal(r.row.generation,1);assert.equal(f.events.at(-1).state,'pending');assert.equal(f.events.at(-1).confirmedGeneration,1);
});
test('Retry-After is honored, attempt cap stops repeated temporary errors',async()=>{
  const f=fixture();let attempts=0;f.args.io.writePage=async()=>{attempts++;throw Object.assign(Error('rate limit'),{status:403,reason:'userRateLimitExceeded',retryAfter:'2'});};
  await assert.rejects(conditionalUpload(f.args),/ATTEMPT_BUDGET_EXHAUSTED/);assert.equal(attempts,3);assert.deepEqual(f.waits,[2000,2000,2000]);assert(!f.events.some(e=>e.state==='verified'));
  assert.equal(f.events.at(-1).state,'failed');
});
test('authentication and actual permission errors pause without read or write retry',async()=>{
  for(const error of [{status:401},{status:403,reason:'insufficientPermissions'}]){
    const f=fixture();let attempts=0;f.args.io.writePage=async()=>{attempts++;throw Object.assign(Error('denied'),error);};
    await assert.rejects(conditionalUpload(f.args),/denied/);assert.equal(attempts,1);assert.equal(f.reads,0);assert.equal(f.waits.length,0);
  }
});
test('CAS conflict preserves the external complete version and does not adopt a new ETag',async()=>{
  const f=fixture();f.setRemote({record:doc(9),etag:'"external"'});f.args.io.writePage=async()=>{throw Object.assign(Error('precondition'),{status:412});};
  await assert.rejects(conditionalUpload(f.args),/UPLOAD_CONFLICT/);assert.equal(f.events.at(-1).state,'conflict');assert.equal(f.writes.length,0);
});
test('unverifiable outcome after lost write response does not cause blind repeated writes',async()=>{
  const f=fixture();let attempts=0;f.args.io.writePage=async()=>{attempts++;throw Object.assign(Error('lost'),{network:true});};f.args.io.readPage=async()=>{throw Object.assign(Error('no access'),{status:403});};
  await assert.rejects(conditionalUpload(f.args),/WRITE_OUTCOME_UNRESOLVED/);assert.equal(attempts,1);assert.equal(f.events.at(-1).uncertain,true);
});
test('reauthorization remains visible when it prevents uncertain-write reconciliation',async()=>{
  const f=fixture();f.args.io.writePage=async()=>{throw Object.assign(Error('lost'),{network:true});};f.args.io.readPage=async()=>{throw Object.assign(Error('expired'),{status:401});};
  await assert.rejects(conditionalUpload(f.args),/WRITE_OUTCOME_UNRESOLVED/);assert.equal(f.events.at(-1).state,'auth-required');assert.equal(f.events.at(-1).uncertain,true);
});
test('synchronous uploading observer cannot supersede a generation and still dispatch old bytes',async()=>{
  const f=fixture(),observe=f.args.onState;f.args.onState=e=>{observe(e);if(e.state==='uploading')f.supersede();};
  await assert.rejects(conditionalUpload(f.args),/SUPERSEDED_BEFORE_DISPATCH/);assert.equal(f.writes.length,0);
});
test('Retry-After precedes reconciliation and is not added again before the next PUT',async()=>{
  const f=fixture(),read=f.args.io.readPage,write=f.args.io.writePage;const timeline=[];let attempts=0;
  f.args.io.writePage=async(...args)=>{timeline.push(['put',f.args.clock.now()]);if(++attempts===1)throw Object.assign(Error('service'),{status:503,retryAfter:'3'});return write(...args);};
  f.args.io.readPage=async(...args)=>{timeline.push(['read',f.args.clock.now()]);return read(...args);};
  await conditionalUpload(f.args);assert.deepEqual(timeline,[['put',0],['read',3000],['put',3000],['read',3000]]);assert.deepEqual(f.waits,[3000]);
});
test('physical IO guard refuses a generation changed after coordinator admission',async()=>{
  const f=fixture();f.args.io.writePage=async(_id,_etag,_target,{beforeDispatch})=>{f.supersede();beforeDispatch();assert.fail('old fetch must not run');};
  await assert.rejects(conditionalUpload(f.args),/SUPERSEDED_BEFORE_DISPATCH/);assert.equal(f.events.at(-1).state,'pending');assert.equal(f.writes.length,0);
});

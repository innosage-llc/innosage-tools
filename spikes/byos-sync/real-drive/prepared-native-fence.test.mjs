import test from 'node:test';
import assert from 'node:assert/strict';
import {PreparedOwner} from '../../byos-workspace/prepared-owner.mjs';
import {createRequire} from 'node:module';
const {fetchDocumentContents}=createRequire(import.meta.url)('rxdb/plugins/replication-google-drive');

async function setup(){
 const transport=await import('./transport.mjs?fence='+crypto.randomUUID());transport.authorize('synthetic',3600);transport.begin();
 let time=0,leader=true,physical=0;
 const originals={fetch:globalThis.fetch};globalThis.fetch=async()=>{physical++;return Response.json({id:'wal'});};
 const files=new Map([['lease',{value:null,etag:'"lease0"'}],['wal',{value:null,etag:'"wal0"'}]]);
 const owner=new PreparedOwner({store:{writer:true,closed:false,db:{isLeader:()=>leader}},inventory:async()=>{},assertDrained:async()=>{},
  withNativeFence:transport.withPreparedNativeFence,clock:{now:()=>time,wallNow:()=>Date.UTC(2026,9,28)+time,sleep:async ms=>{time+=ms;}},budget:{assertCanRequest(){},remainingMs:()=>180000-time},
  createIO:({assertCanRequest,assertCanWrite})=>({
   async readFile(id){assertCanRequest();return structuredClone(files.get(id));},
   async putFile(id,etag,value,{beforeDispatch}){assertCanRequest();assertCanWrite({role:id});beforeDispatch();assert.equal(files.get(id).etag,etag);files.set(id,{value:structuredClone(value),etag:'"updated"'});},
  }),
 });
 owner.mode='reconciling';owner.bindings={leaseId:'lease',walId:'wal'};owner.context={workspace:'fixture',allowedIds:new Set(),fileIds:new Map()};
 return {transport,owner,files,at:ms=>{time=ms;},lose:()=>{leader=false;},get physical(){return physical;},restore:()=>{globalThis.fetch=originals.fetch;}};
}
for(const scenario of ['lease-cutoff','halt','leadership-loss','new-generation'])test('held native callback cannot dispatch after '+scenario,async()=>{
 const f=await setup();let enter,release;const entered=new Promise(r=>{enter=r;});
 try{
  const task=f.owner.runTransaction({}, {},'id',async()=>{enter();await new Promise(r=>{release=r;});return f.transport.driveFetch(f.transport.API+'/upload/drive/v2/files/wal?uploadType=media',{method:'PUT',headers:{'If-Match':'"wal0"'},body:'[]'});});
  await entered;
  if(scenario==='lease-cutoff')f.at(40000);else if(scenario==='halt')f.owner.halt('test-stop');else if(scenario==='leadership-loss')f.lose();else f.owner.currentAuthority=()=>false;
  release();await assert.rejects(task,/LEASE_WRITE_WINDOW_EXHAUSTED|PREPARED_OWNER_HALTED|PREPARED_OWNERSHIP_LOST|PREPARED_GENERATION_AUTHORITY_CLOSED/);
  assert.equal(f.physical,0);assert.equal(f.files.get('wal').value,null);assert(f.files.get('lease').value,'failed owner retains lease for safe recovery');
 }finally{f.restore();}
});
test('native physical fence repeats after observers before fetch',async()=>{
 const f=await setup();let allowed=true;
 try{
  f.transport.onProgress(()=>{allowed=false;});
  await assert.rejects(f.transport.withPreparedNativeFence(()=>{if(!allowed)throw Error('AUTHORITY_CLOSED');},()=>f.transport.driveFetch(f.transport.API+'/upload/drive/v2/files/wal?uploadType=media',{method:'PUT',body:'[]'})),/AUTHORITY_CLOSED/);
  assert.equal(f.physical,0);assert.equal(f.transport.evidence().requests[0].status,'CANCELLED_BEFORE_DISPATCH');
 }finally{f.restore();}
});
test('a delayed metadata-to-media continuation retains its original closed capability',async()=>{
 const f=await setup();let allow=true,resolveMetadata,entered;
 const waiting=new Promise(r=>{entered=r;});let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;entered();return new Promise(r=>{resolveMetadata=r;});};
  let pending;
  await f.transport.withPreparedNativeFence(()=>{if(!allow)throw Error('CAPABILITY_CLOSED');},async()=>{pending=f.transport.driveFetch(f.transport.API+'/drive/v2/files/file?alt=media');await waiting;});
  allow=false;resolveMetadata(Response.json({id:'file',mimeType:'application/json',fileSize:'2',version:'1',headRevisionId:'r1',etag:'"v1"'}));
  await assert.rejects(pending,/CAPABILITY_CLOSED|PREPARED_NATIVE_SCOPE_CLOSED/);assert.equal(calls,1,'media must not escape the captured scope');
 }finally{f.restore();}
});
test('actual native Promise.all worker cannot start another GET after sibling404 closes the transaction',{timeout:3000},async()=>{
 const f=await setup();let held,lateRejected;const late=new Promise(resolve=>{lateRejected=resolve;});const physical=[];
 try{
  // Test-only injection routes the installed native helper through the same
  // transport that the browser build injects. Neither branch accesses network.
  globalThis.fetch=async(input,init)=>{
   const id=new URL(input).pathname.split('/').at(-1);
   if(new Headers(init?.headers).get('Authorization')==='Bearer native-placeholder'){
    try{return await f.transport.driveFetch(input,init);}catch(error){if(id==='late')lateRejected(error);throw error;}
   }
   physical.push(id);
   if(id==='bad')return Response.json({error:{message:'missing'}},{status:404});
   if(id==='held')return new Promise(resolve=>{held=resolve;});
   assert.fail('late native request must not physically dispatch');
  };
  await assert.rejects(f.transport.withPreparedNativeFence(()=>{},()=>fetchDocumentContents({apiEndpoint:f.transport.API,authToken:'native-placeholder'},['bad','held','late'],2)));
  assert(held);held(Response.json({id:'held'}));
  assert.match((await late).message,/PREPARED_NATIVE_SCOPE_CLOSED/);assert.deepEqual(physical,['bad','held']);
  await assert.rejects(f.transport.withPreparedNativeFence(()=>{},async()=>{}),/PREPARED_NATIVE_RELOAD_REQUIRED/);
 }finally{f.restore();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {metadataSummary,errorSummary} from './diagnostics.mjs';
import {API,authorize,forget,begin,driveFetch,evidence} from './transport.mjs';
import {startTransactionTryOnce,commitTransaction,isTransactionTimedOut} from '../node_modules/rxdb/dist/esm/plugins/replication-google-drive/transaction.js';
import {writeToWal} from '../node_modules/rxdb/dist/esm/plugins/replication-google-drive/upstream.js';

test('diagnostics retain only allowlisted codes/status/direction and boolean validator comparison',()=>{
 const secret='PRIVATE_SENTINEL';
 const e={code:'RC_PULL',message:secret,parameters:{direction:'pull',checkpoint:secret,errors:[{code:'GDR11',parameters:{args:{status:412,etag:secret},authToken:secret}},{code:secret,message:secret}]}};
 const s=errorSummary(e);assert.equal(s.code,'RC_PULL');assert.equal(s.nested[0].code,'GDR11');assert.equal(s.nested[0].status,412);assert.equal(s.nested[1].code,'UNKNOWN');assert.doesNotMatch(JSON.stringify(s),/PRIVATE|checkpoint|authToken|etag/);
 assert.deepEqual(metadataSummary('"representation"',{etag:'"file"',owners:secret}),{httpPresent:true,jsonPresent:true,httpStrong:true,jsonStrong:true,equal:false,shape:{id:false,version:false,size:false,zeroSize:false,revision:false,jsonMime:false}});
 assert.equal(metadataSummary(null,{}).equal,null);
 assert.equal(errorSummary(new Error('MEDIA_VERSION_CHANGED')).code,'MEDIA_VERSION_CHANGED');
 const cyclic={code:'RC_PUSH',parameters:{errors:[]}};cyclic.parameters.errors.push(cyclic);assert(JSON.stringify(errorSummary(cyclic)).length<500);
});

test('metadata observations alias files and preserve original response/validator without extra dispatches',async()=>{
 const original=globalThis.fetch;let n=0;
 globalThis.fetch=async()=>{n++;return Response.json({id:'private-file',etag:'"canonical-private"',owners:[{emailAddress:'private@example.invalid'}]},{headers:{ETag:'"http-private"'}});};
 authorize('PRIVATE_AUTH',60);begin();
 try{
  const r=await driveFetch(API+'/drive/v2/files/private-file?fields=id,etag');assert.equal(r.headers.get('etag'),'"http-private"');assert.equal((await r.json()).etag,'"canonical-private"');
  await driveFetch(API+'/drive/v2/files/private-file');assert.equal(n,2);
  const rows=evidence().requests.slice(-2);assert.equal(rows[0].fileAlias,rows[1].fileAlias);assert(rows[1].sequence>rows[0].sequence);assert.equal(rows[0].metadataValidators.equal,false);
  assert.doesNotMatch(JSON.stringify(rows),/private-file|PRIVATE_AUTH|canonical-private|http-private|emailAddress/);
 }finally{globalThis.fetch=original;forget();}
});

// Exact pinned native paths, controlled causal alternatives. These fixtures do
// not claim Google emitted differing validators in either real attempt.
const options={apiEndpoint:'https://fixture.invalid',authToken:'SYNTHETIC_ONLY',transactionTimeout:60000};
const init={transactionFile:{fileId:'transaction'},walFile:{fileId:'wal'}};
const response=(body,status=200)=>new Response(body,{status,headers:{ETag:'"current"',Date:'Sun, 25 Oct 2026 05:01:00 GMT','Content-Type':'application/json'}});
async function isolate(fetch,work){const original=globalThis.fetch;globalThis.fetch=fetch;try{await work();}finally{globalThis.fetch=original;}}
test('native acquisition 412 is retry, whereas commit 412 is GDR11; no universal 412 failure oracle',async()=>{
 let calls=0;
 await isolate(async(u,o)=>{calls++;return o.method==='PUT'?response('',412):response('');},async()=>{
  assert.deepEqual(await startTransactionTryOnce(options,init),{retry:true});assert.equal(calls,3);
  await assert.rejects(commitTransaction(options,init,{etag:'"stale"'}),e=>{assert.equal(errorSummary(e).code,'GDR11');assert.equal(errorSummary(e).status,412);return true;});assert.equal(calls,5);
 });
});
test('native timeout uses full metadata HTTP validator; hypothetical partial WAL mismatch yields GDR19',async()=>{
 const calls=[];
 await isolate(async(u,o)=>{const url=new URL(u);calls.push({fields:url.searchParams.get('fields'),method:o.method,validator:o.headers['If-Match']});
  if(o.method==='PUT')return response('',412);
  if(url.searchParams.get('alt')==='media')return response('');
  return response(JSON.stringify({id:'wal',fileSize:'0',mimeType:'application/json',etag:'"json-file"',modifiedDate:'2026-10-25T05:00:00Z'}));
 },async()=>{
  const timeout=await isTransactionTimedOut(options,init);assert.equal(timeout.expired,true);assert.equal(timeout.etag,'"current"');assert.equal(calls[0].fields,null);
  await assert.rejects(writeToWal(options,init),e=>e.code==='GDR19');
  assert.equal(calls[1].fields,'id,fileSize,mimeType,title,etag');assert.equal(calls[2].validator,'"current"');
 });
});

test('two native acquisitions sharing one empty observation produce one owner and one retry',async()=>{
 let body='',etag='"v1"',reads=0,release;
 const bothReads=new Promise(resolve=>{release=resolve;});
 await isolate(async(u,o={})=>{
  if(o.method==='PUT'){
   if(o.headers['If-Match']!==etag)return response('',412);
   body=o.body;etag='"v2"';return response('',200);
  }
  const content=body,validator=etag;
  if(++reads<=2){if(reads===2)release();await bothReads;}
  return new Response(content,{headers:{ETag:validator,Date:'Sun, 25 Oct 2026 05:01:00 GMT','Content-Type':'application/json'}});
 },async()=>{
  const results=await Promise.all([startTransactionTryOnce(options,init),startTransactionTryOnce(options,init)]);
  assert.equal(results.filter(r=>r.retry).length,1);
  assert.equal(results.filter(r=>r.etag==='"v2"').length,1);
  assert.ok(body.includes('createdAtClientTime'));
 });
});

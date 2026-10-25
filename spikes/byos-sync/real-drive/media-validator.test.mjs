import test from 'node:test';
import assert from 'node:assert/strict';
import {API,authorize,forget,begin,driveFetch,evidence} from './transport.mjs';
import {fillFileIfEtagMatches} from '../node_modules/rxdb/dist/esm/plugins/replication-google-drive/google-drive-helper.js';
const path='/drive/v2/files/synthetic-file',media=API+path+'?alt=media';
const initial=()=>({id:'synthetic-file',etag:'"validator-private-1"',version:'9007199254740993',headRevisionId:'revision-1',fileSize:'7',mimeType:'application/json'});
async function fixture(work,{metadata={},body='{"x":1}',changeDuringMedia=false,mediaStatus=200,actualBody,metadataStatus=200}={}){
 const original=globalThis.fetch,calls=[],first={...initial(),...metadata};
 const state={meta:{...first},body};let mediaCount=0;
 globalThis.fetch=async(u,opts={})=>{
  const url=new URL(u),headers=new Headers(opts.headers);calls.push({url,opts,headers});
  if(opts.method==='PUT'){
   assert.equal(headers.get('If-Match'),'"validator-private-1"');
   return new Response('',{status:headers.get('If-Match')===state.meta.etag?200:412});
  }
  if(url.searchParams.get('alt')==='media'){
   if(++mediaCount===1&&changeDuringMedia){state.meta={...state.meta,etag:'"validator-private-2"',version:'9007199254740994',headRevisionId:'revision-2'};state.body='{"x":2}';}
   const pinned=url.searchParams.get('revisionId');
   const bytes=actualBody??(pinned===first.headRevisionId?body:state.body);
   return new Response(bytes,{status:mediaStatus,headers:{'Content-Type':'application/json',Date:'Sun, 25 Oct 2026 05:00:00 GMT',...(!pinned?{ETag:state.meta.etag}:{})}});
  }
  return Response.json(state.meta,{status:metadataStatus,headers:{ETag:state.meta.etag??'"http-only"'}});
 };
 authorize('SYNTHETIC_SECRET',60);begin();
 try{await work(calls,state);}finally{globalThis.fetch=original;forget();}
}
test('one metadata snapshot binds pinned bytes to original strong ETag with no after-read request',async()=>{
 await fixture(async calls=>{
  const r=await driveFetch(media);assert.equal(await r.text(),'{"x":1}');assert.equal(r.headers.get('etag'),'"validator-private-1"');
  assert.equal(calls.length,2);assert.equal(calls[1].url.searchParams.get('revisionId'),'revision-1');
  assert(calls.every(c=>c.opts.cache==='no-store'));assert(calls.every(c=>c.headers.get('Authorization')==='Bearer SYNTHETIC_SECRET'));
  assert.doesNotMatch(JSON.stringify(evidence()),/SYNTHETIC_SECRET|synthetic-file|revision-1|validator-private/);
 });
});
test('concurrent mutation after metadata preserves old pinned snapshot and native stale PUT still returns412',async()=>{
 await fixture(async(calls,state)=>{
  const r=await driveFetch(media);assert.equal(await r.text(),'{"x":1}');assert.equal(r.headers.get('etag'),'"validator-private-1"');assert.equal(calls.length,2);
  assert.equal(state.meta.etag,'"validator-private-2"');assert.equal(state.body,'{"x":2}');
  const write=await fillFileIfEtagMatches({apiEndpoint:API,authToken:'NATIVE_ONLY'},'synthetic-file',r.headers.get('etag'),{x:3});
  assert.equal(write.status,412);assert.equal(state.body,'{"x":2}');assert.equal(calls.filter(c=>c.opts.method==='PUT').length,1);assert.equal(calls.length,4);
 },{changeDuringMedia:true});
});
test('actual empty bytes uniquely identify a headless bootstrap snapshot; no later validator is substituted',async()=>{
 for(const fileSize of ['0','00'])await fixture(async calls=>{
  const r=await driveFetch(media);assert.equal(await r.text(),'');assert.equal(r.headers.get('etag'),'"validator-private-1"');assert.equal(calls.length,2);
 },{metadata:{fileSize,headRevisionId:undefined},body:''});
});
test('headless empty metadata followed by a nonempty download rejects rather than mixing snapshots',async()=>{
 await fixture(()=>assert.rejects(driveFetch(media),/MEDIA_SIZE_MISMATCH/),{metadata:{fileSize:'0',headRevisionId:undefined},body:'',changeDuringMedia:true});
});
test('missing or malformed identity, strong validator, size, version, MIME or required revision rejects',async()=>{
 for(const metadata of [{id:'wrong'},{etag:undefined},{etag:'W/"weak"'},{fileSize:'invalid'},{fileSize:undefined},{version:undefined},{mimeType:'text/plain'},{headRevisionId:undefined}])
  await fixture(()=>assert.rejects(driveFetch(media),/MEDIA_METADATA_UNSUPPORTED/),{metadata});
});
test('unmatched caller revision and ranges reject before downloading bytes',async()=>{
 await fixture(async calls=>{await assert.rejects(driveFetch(media+'&revisionId=other'),/MEDIA_REVISION_NOT_CURRENT/);assert.equal(calls.length,1);});
 await fixture(async calls=>{await assert.rejects(driveFetch(media,{headers:{Range:'bytes=0-1'}}),/MEDIA_RANGE_UNSUPPORTED/);assert.equal(calls.length,0);});
});
test('wrong byte length rejects, failed pinned download remains failed with no current-body fallback',async()=>{
 await fixture(()=>assert.rejects(driveFetch(media),/MEDIA_SIZE_MISMATCH/),{actualBody:'wrong'});
 await fixture(async calls=>{const r=await driveFetch(media);assert.equal(r.status,404);assert.equal(calls.length,2);},{mediaStatus:404});
 await fixture(async calls=>{const r=await driveFetch(media);assert.equal(r.status,503);assert.equal(calls.length,1);},{metadataStatus:503});
});

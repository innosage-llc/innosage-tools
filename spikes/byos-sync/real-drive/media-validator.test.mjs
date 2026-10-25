import test from 'node:test';
import assert from 'node:assert/strict';
import {errorSummary} from './diagnostics.mjs';
import {API,authorize,forget,begin,driveFetch,evidence} from './transport.mjs';
const path='/drive/v2/files/synthetic-file';
const media=API+path+'?alt=media';
const meta=()=>({id:'synthetic-file',etag:'"file-1"',version:'9007199254740993',headRevisionId:'revision-1',fileSize:'7',mimeType:'application/json'});
async function fixture(work,{change,body='{"x":1}',missing,weak=false,empty=false,mediaStatus=200}={}){
 const original=globalThis.fetch,calls=[];let reads=0;
 globalThis.fetch=async(u,opts)=>{const url=new URL(u);calls.push({url,opts});
  if(opts.method==='PUT')return new Response('',{status:412});
  if(url.searchParams.get('alt')==='media')return new Response(body,{status:mediaStatus,headers:{'Content-Type':'application/json',Date:'Sun, 25 Oct 2026 05:00:00 GMT'}});
  const m=meta();if(empty){m.fileSize='0';delete m.headRevisionId;}if(missing)delete m[missing];if(weak)m.etag='W/"weak"';if(++reads===2&&change)change(m);
  return Response.json(m,{headers:{ETag:m.etag??'"header-only"',Date:'Sun, 25 Oct 2026 05:00:00 GMT'}});
 };
 authorize('SYNTHETIC_SECRET',60);begin();try{await work(calls);}finally{globalThis.fetch=original;forget();}
}
test('media bytes without ETag are correlated to a stable file version and explicit revision',async()=>{
 await fixture(async calls=>{const r=await driveFetch(media);assert.equal(r.headers.get('etag'),'"file-1"');assert.equal(await r.text(),'{"x":1}');assert.equal(r.headers.get('date'),'Sun, 25 Oct 2026 05:00:00 GMT');assert.equal(calls.length,3);assert.equal(calls[1].url.searchParams.get('revisionId'),'revision-1');assert(calls.every(c=>c.opts.cache==='no-store'));assert(calls.every(c=>c.opts.headers.get('Authorization')==='Bearer SYNTHETIC_SECRET'));assert.doesNotMatch(JSON.stringify(evidence()),/SYNTHETIC_SECRET|synthetic-file|revision-1/);});
});
test('concurrent write during the read rejects instead of attaching a later ETag to old bytes',async()=>{
 await fixture(()=>assert.rejects(driveFetch(media),/MEDIA_VERSION_CHANGED/),{change:m=>{m.version='9007199254740994';m.etag='"file-2"';m.headRevisionId='revision-2';}});
});
test('restored content and ETag cannot hide a different pinned head revision',async()=>{
 await fixture(()=>assert.rejects(driveFetch(media),/MEDIA_VERSION_CHANGED/),{change:m=>{m.version='9007199254740994';m.headRevisionId='revision-2';}});
});
test('missing identity/version/revision or weak file validator fails closed',async()=>{
 for(const missing of ['id','etag','version','headRevisionId','fileSize'])await fixture(()=>assert.rejects(driveFetch(media),/MEDIA_METADATA_UNSUPPORTED/),{missing});
 await fixture(()=>assert.rejects(driveFetch(media),/MEDIA_METADATA_UNSUPPORTED/),{weak:true});
});
test('native zero-byte bootstrap requires two matching metadata samples and actual zero bytes',async()=>{
 await fixture(async calls=>{const r=await driveFetch(media);assert.equal(await r.text(),'');assert.equal(r.headers.get('etag'),'"file-1"');assert.equal(calls.length,3);},{empty:true,body:''});
 await fixture(()=>assert.rejects(driveFetch(media),/MEDIA_SIZE_MISMATCH/),{empty:true});
});
test('a competing write AFTER the final metadata read still gets native 412; never replace validator',async()=>{
 await fixture(async calls=>{const r=await driveFetch(media);const response=await driveFetch(API+'/upload/drive/v2/files/synthetic-file?uploadType=media',{method:'PUT',headers:{'If-Match':r.headers.get('etag')},body:'{"x":2}'});assert.equal(response.status,412);assert.equal(calls.length,4);assert.equal(calls[3].opts.headers.get('If-Match'),'"file-1"');});
});
test('failed revision download stays failed, with no metadata substitution or write',async()=>{
 await fixture(async calls=>{const r=await driveFetch(media);assert.equal(r.status,404);assert.equal(calls.length,2);},{mediaStatus:404});
});

test('drift evidence identifies only changed fields and ordering, with no metadata values',async()=>{
 await fixture(()=>assert.rejects(driveFetch(media),error=>{
  const summary=errorSummary(error);assert.equal(summary.code,'MEDIA_VERSION_CHANGED');
  assert.deepEqual(summary.mediaDrift,{etag:true,version:true,headRevisionId:false,fileSize:false,mimeType:false,versionOrder:'greater',role:'other'});
  assert.doesNotMatch(JSON.stringify(summary),/900719925|file-1|revision-1|synthetic-file/);return true;
 }),{change:m=>{m.version='9007199254740994';m.etag='"file-2"';}});
});

test('documented non-content version increase does not reject unchanged pinned bytes and file validator',async()=>{
 await fixture(async calls=>{const r=await driveFetch(media);assert.equal(await r.text(),'{"x":1}');assert.equal(r.headers.get('etag'),'"file-1"');assert.equal(calls.length,3);},{change:m=>{m.version='9007199254740994';}});
});
test('version decrease remains unsupported even with matching content identity',async()=>{
 await fixture(()=>assert.rejects(driveFetch(media),/MEDIA_VERSION_CHANGED/),{change:m=>{m.version='9007199254740992';}});
});
test('same size does not hide changed validator or revision even if version is unchanged',async()=>{
 for(const change of [m=>{m.etag='"file-2"';},m=>{m.headRevisionId='revision-2';},m=>{m.fileSize='8';},m=>{m.mimeType='text/plain';}])
  await fixture(()=>assert.rejects(driveFetch(media),/MEDIA_VERSION_CHANGED|MEDIA_METADATA_UNSUPPORTED/),{change});
});
test('zero-byte bootstrap cannot waive a version increase without a pinned content revision',async()=>{
 await fixture(()=>assert.rejects(driveFetch(media),/MEDIA_VERSION_CHANGED/),{empty:true,body:'',change:m=>{m.version='9007199254740994';}});
});

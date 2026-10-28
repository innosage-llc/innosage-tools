import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreparedDriveIO} from './prepared-drive-io.mjs';
const record={id:'A',body:'{"title":"A","parentId":null,"markdown":"synthetic"}',editId:'A-1',_deleted:false};
function fixture(){
  const calls=[],events=[];let writable=true;
  const bytes=JSON.stringify(record);
  const metadata={id:'fileA',title:'A.json',parents:[{id:'docs'}],mimeType:'application/json',fileSize:String(new TextEncoder().encode(bytes).length),etag:'"original"',version:'3',headRevisionId:'revision3'};
  const args={apiEndpoint:'https://fixture.invalid',files:new Map([['fileA',{role:'page',name:'A.json',parentId:'docs',pageId:'A'}]]),assertCanRequest:()=>{},assertCanWrite:()=>{if(!writable)throw Error('LEASE_EXPIRED');},event:e=>events.push(e),identify:()=>({generation:1}),
    fetchOnce:async(url,init)=>{init.preparedGuard();calls.push({url:new URL(url),init});init.preparedOnDispatched();if(init.method==='PUT')return Response.json({id:'fileA'});return new URL(url).searchParams.has('alt')?new Response(bytes):Response.json(metadata);}};
  return {args,calls,events,metadata,expire:()=>{writable=false;}};
}
test('read binds approved folder/name, exact ETag and revision-pinned complete bytes',async()=>{
  const f=fixture();const io=createPreparedDriveIO(f.args),r=await io.readPage('fileA');assert.deepEqual(r.record,record);assert.equal(r.etag,'"original"');assert.equal(f.calls.length,2);assert.equal(f.calls[1].url.searchParams.get('revisionId'),'revision3');
});
test('moved/renamed file is rejected before downloading body or writing',async()=>{
  for(const mutate of [m=>m.parents=[{id:'personal'}],m=>m.title='other.json',m=>m.etag='weak',m=>m.headRevisionId=undefined]){
    const f=fixture();mutate(f.metadata);await assert.rejects(createPreparedDriveIO(f.args).readPage('fileA'),/FILE_BINDING_OR_VERSION_INVALID/);assert.equal(f.calls.length,1);
  }
});
test('physical write carries exact CAS and complete version attribution, with no hidden read or retry',async()=>{
  const f=fixture();await createPreparedDriveIO(f.args).writePage('fileA','"original"',record);assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.headers['If-Match'],'"original"');assert.deepEqual(JSON.parse(f.calls[0].init.body),record);
  const start=f.events.find(e=>e.type==='page-put-start');assert.equal(start.page,'A');assert.equal(start.editId,'A-1');assert.equal(start.generation,1);assert.match(start.bodyHash,/^[a-f0-9]{64}$/);
});
test('observer-triggered lease loss and physical generation guard prevent fetch',async()=>{
  const f=fixture();f.args.event=e=>{f.events.push(e);if(e.type==='request-admission')f.expire();};await assert.rejects(createPreparedDriveIO(f.args).writePage('fileA','"original"',record),/LEASE_EXPIRED/);assert.equal(f.calls.length,0);assert(!f.events.some(e=>e.type==='page-put-start'));
  const g=fixture();await assert.rejects(createPreparedDriveIO(g.args).writePage('fileA','"original"',record,{beforeDispatch(){throw Error('SUPERSEDED');}}),/SUPERSEDED/);assert.equal(g.calls.length,0);assert(!g.events.some(e=>e.type==='page-put-start'));
});
test('provider error reason and Retry-After survive without an implicit request retry',async()=>{
  const f=fixture();let count=0;f.args.fetchOnce=async(_url,init)=>{init.preparedGuard();count++;init.preparedOnDispatched();return Response.json({error:{errors:[{reason:'userRateLimitExceeded'}]}},{status:403,headers:{'Retry-After':'3'}});};
  await assert.rejects(createPreparedDriveIO(f.args).writePage('fileA','"original"',record),e=>e.status===403&&e.reason==='userRateLimitExceeded'&&e.retryAfter==='3');assert.equal(count,1);
});
test('unknown file and page/file mismatch never reach transport',async()=>{
  const f=fixture(),io=createPreparedDriveIO(f.args);await assert.rejects(io.readPage('personal'),/UNAPPROVED_FILE/);await assert.rejects(io.writePage('fileA','"original"',{...record,id:'B'}),/PAGE_FILE_BINDING_MISMATCH/);assert.equal(f.calls.length,0);
});

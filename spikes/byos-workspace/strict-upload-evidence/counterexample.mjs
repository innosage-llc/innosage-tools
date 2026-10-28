// Local-only architectural probe. No browser, real Drive, or runtime edits.
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {mock} from '../../byos-sync/src/mock.mjs';
import {initDriveStructure} from '../../byos-sync/node_modules/rxdb/dist/esm/plugins/replication-google-drive/init.js';
import {runInTransaction} from '../../byos-sync/node_modules/rxdb/dist/esm/plugins/replication-google-drive/transaction.js';
import {handleUpstreamBatch} from '../../byos-sync/node_modules/rxdb/dist/esm/plugins/replication-google-drive/upstream.js';

const hash=x=>createHash('sha256').update(x).digest('hex');
const m=await mock({network:'fast',seed:142});
const originalFetch=globalThis.fetch;
let origin=null;
const rows=[],events=[];
const now=()=>origin===null?null:performance.now()-origin;
globalThis.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url);
  assert.equal(url.origin,m.url,'Only the task-owned loopback server is allowed');
  const id=url.pathname.match(/\/files\/([^/]+)$/)?.[1];
  const file=m.files.get(id);let body;try{body=JSON.parse(init.body);}catch{}
  const row={atMs:now(),method:init.method??'GET',fileName:file?.name??null,
    kind:body?.id&&body?.editId?'page-content':Array.isArray(body)?'wal':'other',
    page:body?.id??null,editId:body?.editId??null,bodyHash:body?.id?hash(JSON.stringify(body)):null};
  rows.push(row);const response=await originalFetch(input,init);row.status=response.status;row.endMs=now();return response;
};
const options={apiEndpoint:m.url,authToken:'synthetic',space:'drive',folderPath:'strict-local-only',transactionTimeout:60000};
const baseline=id=>({id,body:'phase0 '+id,editId:'initial-'+id,_deleted:false});
const final=id=>({id,body:'phase1 '+id,editId:'final-'+id,_deleted:false});
try{
  const structure=await initDriveStructure(options);
  for(const id of ['A','B'])m.create({name:id+'.json',parents:[structure.docsFolderId],mimeType:'application/json'},Buffer.from(JSON.stringify(baseline(id))));
  // The pinned native push helper acknowledges WAL without materializing a page.
  await runInTransaction(options,structure,'id',()=>handleUpstreamBatch(options,structure,'id',[{assumedMasterState:baseline('A'),newDocumentState:final('A')}]));
  const aFile=[...m.files.values()].find(f=>f.name==='A.json');
  assert.deepEqual(JSON.parse(aFile.body),baseline('A'));
  const walOnly={nativePushReturned:true,pageStillBaseline:true,walContainsCurrent:JSON.parse(m.files.get(structure.walFile.fileId).body)[0].newDocumentState.editId==='final-A'};
  await runInTransaction(options,structure,'id',async()=>{});
  assert.deepEqual(JSON.parse(aFile.body),final('A'));
  // Fresh synthetic generations; a legal 7s transaction occupies the shared lock.
  const next=id=>({...final(id),body:'phase2 '+id,editId:'deadline-'+id});
  let release,entered;
  const held=new Promise(r=>{release=r;});const started=new Promise(r=>{entered=r;});
  const holder=runInTransaction(options,structure,'id',async()=>{entered();await held;});
  await started;origin=performance.now();
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const schedule=async(id)=>{
    const inputAt=now(),deadline=inputAt+5000;events.push({type:'input',page:id,atMs:inputAt,deadlineMs:deadline});
    while(now()<deadline)await sleep(deadline-now());
    events.push({type:'handler-invoked',page:id,atMs:now()});
    await runInTransaction(options,structure,'id',()=>handleUpstreamBatch(options,structure,'id',[{assumedMasterState:id==='A'?final(id):baseline(id),newDocumentState:next(id)}]));
    events.push({type:'handler-returned',page:id,atMs:now()});
  };
  const a=schedule('A'),b=sleep(1000).then(()=>schedule('B'));
  await sleep(6500);
  assert.equal(rows.filter(r=>r.atMs!==null&&r.kind==='page-content').length,0);
  assert.equal(rows.filter(r=>r.atMs!==null&&r.kind==='wal').length,0);
  events.push({type:'both-deadlines-passed-no-content-or-wal-upload',atMs:now()});
  await sleep(500);events.push({type:'holder-released',atMs:now()});release();
  await Promise.all([holder,a,b]);
  await runInTransaction(options,structure,'id',async()=>{});
  const uploads=rows.filter(r=>r.atMs!==null&&r.kind==='page-content');
  for(const id of ['A','B']){
    const row=uploads.find(r=>r.page===id&&r.editId==='deadline-'+id);assert(row&&row.atMs>7000);
    const f=[...m.files.values()].find(f=>f.name===id+'.json');assert.deepEqual(JSON.parse(f.body),next(id));
    assert.equal(row.bodyHash,hash(JSON.stringify(next(id))));
  }
  assert.equal(m.unsupported.length,0);
  const sourceHashes={};for(const name of ['transaction.js','upstream.js','document-handling.js'])sourceHashes[name]=hash(await readFile(new URL('../../byos-sync/node_modules/rxdb/dist/esm/plugins/replication-google-drive/'+name,import.meta.url)));
  const result={classification:'LOCAL_MOCK_COUNTEREXAMPLE_PASS',providerCalls:0,browserActions:0,nativeVersion:'17.6.0',sourceHashes,walOnly,events,uploads,rows:rows.filter(r=>r.atMs!==null),limitations:['Public native helpers with controlled shared-lock occupancy, not an A–Z app or real Drive timing result','Synthetic input markers; this probe does not test local durable ACK','Proves a legal shared-lock state delays even invoked per-page handlers; not the root cause of the earlier real timeout']};
  await writeFile(new URL('./counterexample.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({classification:result.classification,walOnly,events,uploads,requests:result.rows.length,providerCalls:0},null,2));
}finally{globalThis.fetch=originalFetch;await m.close();}

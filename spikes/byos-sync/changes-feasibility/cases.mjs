import assert from 'node:assert/strict';
export const ids=['S0_TRANSITION','S1_PAGE_TRAVERSAL','S2_BOOTSTRAP_PERSIST_BARRIER','S3_READ_FAILURE_REPLAY','S4_RETAINED_EVENT','S4_NO_EVENT','S5_LOST_RESPONSE_INTENT'];
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
export async function execute(w,id){
 const T=w.fixture.bodies;
 async function baseline(){
  const a=await w.open('a'),b=await w.open('b');
  await a.db.pages.upsert({id:'page',body:T.A,editId:'baseline-A'});await w.connect(a);await a.remote('page');await w.connect(b);
  assert.equal((await b.page('page')).body,T.A);await w.snapshot('stock-baseline');return {a,b};
 }
 async function fork(){const {a,b}=await baseline();await a.save('page',T.B);await b.save('page',T.C);await b.verify('page');await a.sync();
  const v=await a.view('page');assert.equal(v.body,T.B);assert.equal(v.page.body,T.C);assert.equal(v.journal.sourceLocal.body,T.B);assert.equal(v.journal.sourceCloud.body,T.C);return {a,b};}
 async function migrated(){const x=await baseline();await w.transition(x.a);return x;}
 const update=(name,body,editId)=>{const f=w.file(name);assert(f);const previous=JSON.parse(f.body.toString());return w.provider.update(f.id,{...previous,body,editId});};
 const putRemote=async(b,docs)=>{await b.db.pages.bulkUpsert(docs);await b.sync();await b.remote(docs[0].id);};
 const page=(id,body,editId)=>({id,body,editId});
 const eq=(actual,expected)=>assert.deepEqual(actual,expected);
 if(id==='S0_TRANSITION'){
  const {a,b}=await fork();await a.save('page',T.D);await b.save('page',T.E);await b.verify('page');
  await putRemote(b,[page('other',T.M,'other-M')]);
  await putRemote(b,[page('discovery-old',T.A,'discovery-old-original'),page('discovery-new',T.A,'discovery-new-original')]);await a.sync();
  await putRemote(b,w.fixture.document_contract.ties);w.forceTieTime();
  await putRemote(b,[page('discovery-old',T.C,'discovery-old-latest')]);await putRemote(b,[page('discovery-new',T.E,'discovery-new-latest')]);
  const old=w.file('discovery-old'),newer=w.file('discovery-new');assert(old.modifiedTime<newer.modifiedTime);
  const frozenOld={modifiedTime:old.modifiedTime,version:old.version,body:old.body.toString()};w.m.control.hiddenIds=[old.id];await a.sync();
  const legacy=await w.checkpoint(a);assert(legacy.modifiedTime>old.modifiedTime);assert.equal((await a.page('discovery-new')).editId,'discovery-new-latest');assert.equal((await a.page('discovery-old')).editId,'discovery-old-original');
  w.m.control.hiddenIds=[];await a.sync();eq({modifiedTime:old.modifiedTime,version:old.version,body:old.body.toString()},frozenOld);assert.equal((await a.page('discovery-old')).editId,'discovery-old-original');
  const before=await w.snapshot('before-transition');const identity=await w.identity(a);const oldMeta=await w.metadata(a);assert(oldMeta.some(x=>x.id==='page|0'));
  await w.transition(a);await a.sync();
  const v=await a.view('page');assert.equal(v.page.body,T.E);assert.equal(v.body,T.D);assert.equal(v.journal.sourceLocal.body,T.B);assert.equal(v.journal.sourceCloud.body,T.C);assert.equal((await a.page('other')).body,T.M);
  for(const expected of w.fixture.document_contract.ties)eq(await a.page(expected.id),expected);
  assert.equal((await a.page('discovery-old')).body,T.C);assert.equal((await a.page('discovery-new')).body,T.E);
  eq(await w.identity(a),identity);const afterMeta=await w.metadata(a);for(const old of oldMeta.filter(x=>x.isCheckpoint==='0'))assert(afterMeta.some(x=>x.id===old.id),'preexisting assumed row retained');
  const cp=await w.checkpoint(a);assert.equal(cp.changes109.tag,'tools109-changes-v1');assert(cp.modifiedTime,'legacy top-level checkpoint coexists');
  await w.restart(a);await a.sync();eq(await w.identity(a),identity);assert.equal((await a.view('page')).body,T.D);
  await w.snapshot('transition-restarted');return {status:'PASS',identity,checkpoint:await w.checkpoint(a),journal:await a.draft('page'),legacyBefore:before.stores.find(s=>s.role==='a').checkpoint};
 }
 if(id==='S1_PAGE_TRAVERSAL'){
  const {a,b}=await migrated();const docs=[0,1,2,3,4].map(i=>page('p'+i,`# Page ${i}\n\nComplete current body ${i}.`,'p-'+i));await putRemote(b,docs);
  const internal=[...w.m.files.values()].find(f=>f.name==='transaction.json');const changes=docs.map(d=>{const f=w.file(d.id);return {fileId:f.id,removed:false,file:w.provider.metadata(f)};});
  w.provider.state.pages=[[{fileId:internal.id,removed:false,file:w.provider.metadata(internal)}],[],[changes[0]],[changes[0],...changes.slice(1)]];
  w.provider.state.scriptStartToken=(await w.checkpoint(a)).changes109.token;
  w.batch.set(a.db.name,2);await w.restart(a);await a.sync();for(const d of docs)eq(await a.page(d.id),d);
  await w.snapshot('traversal-script-settled');w.provider.state.pages=null;
  const prior=await w.checkpoint(a);await w.restart(a);await a.sync();const after=await w.checkpoint(a);await w.snapshot('empty-terminal-replay');
  const changed=update('p4','# Page 4\n\nLater real change.','p4-later');await w.restart(a);await a.sync();eq(await a.page('p4'),page('p4','# Page 4\n\nLater real change.','p4-later'));
  await w.snapshot('after-empty-real-change');return {status:'PASS',emptyTailCheckpointBefore:prior,emptyTailCheckpointAfter:after,emptyTailDurableAdvanced:JSON.stringify(prior)!==JSON.stringify(after),limitation:'Zero-relevant terminal progress may replay old durable token; no checkpoint-only persistence claim',changedFile:changed.id};
 }
 if(id==='S2_BOOTSTRAP_PERSIST_BARRIER'){
  const {a,b}=await baseline();const docs=[0,1,2,3].map(i=>page('b'+i,`# Bootstrap ${i}`,'bootstrap-'+i));await putRemote(b,docs);
  const target=w.file('b0');const latest='# Bootstrap 0\n\nAfter inventory page read.';let injected=false,armed=false;
  w.provider.state.onInventory=async({page:listed})=>{assert(listed.some(f=>f.id===target.id));armed=true;};
  w.afterResponse=async e=>{if(armed&&!injected&&e.url.includes(`/files/${target.id}?alt=media`)){injected=true;update('b0',latest,'bootstrap-race');}};
  const reached=deferred(),release=deferred();const storage=a.db.pages.storageInstance,original=storage.bulkWrite.bind(storage);let intercepted=false;
  storage.bulkWrite=async(rows,context)=>{if(!intercepted&&rows.some(r=>r.document.id==='b0'&&r.document.editId==='bootstrap-race')){intercepted=true;w.event({type:'fixture-storage-write-paused',context,rows});reached.resolve();await release.promise;}return original(rows,context);};
  const preWriteCheckpoint=await w.checkpoint(a);const task=w.transition(a);await reached.promise;
  const paused=await w.snapshot('actual-native-persistence-paused');assert(injected&&intercepted);
  const persisted=await storage.findDocumentsById(['b0'],true);assert(!persisted[0]||persisted[0].editId!=='bootstrap-race','latest body not yet persisted');
  const cp=await w.checkpoint(a);const returned=w.events.filter(e=>e.type==='pull-return'&&e.result.documents.some(d=>d.editId==='bootstrap-race')).at(-1);assert(returned);
  const targetEventPosition=w.provider.changes.findLastIndex(c=>c.fileId===target.id&&c.file.modifiedTime===target.modifiedTime);assert(targetEventPosition>=0);
  const coversTarget=checkpoint=>checkpoint?.changes109?.phase==='changes'&&w.provider.index(checkpoint.changes109.token)>targetEventPosition;
  assert(!coversTarget(preWriteCheckpoint));assert(!coversTarget(cp),'durable semantic cursor cannot cover unpersisted target event');assert(coversTarget(returned.result.checkpoint),'returned handler cursor actually covers target event');
  const pausedAssumed=(await w.metadata(a)).find(d=>d.id==='b0|0');assert(!pausedAssumed||pausedAssumed.docData.editId!=='bootstrap-race','assumed-master not advanced before fork persistence');
  release.resolve();await task;storage.bulkWrite=original;await a.sync();eq(await a.page('b0'),page('b0',latest,'bootstrap-race'));
  const durableBody=(await storage.findDocumentsById(['b0'],true))[0],durableAssumed=(await w.metadata(a)).find(d=>d.id==='b0|0');assert.equal(durableBody.body,latest);assert.equal(durableBody.editId,'bootstrap-race');assert.equal(durableAssumed.docData.body,latest);assert.equal(durableAssumed.docData.editId,'bootstrap-race');assert(coversTarget(await w.checkpoint(a)));
  await w.snapshot('native-persistence-released');await w.restart(a);await a.sync();eq(await a.page('b0'),page('b0',latest,'bootstrap-race'));
  await w.snapshot('barrier-restarted');return {status:'PASS',preWriteCheckpoint,pausedCheckpoint:cp,pausedPhysicalBodies:persisted,pausedAssumed:pausedAssumed??null,targetEventPosition,handlerReturnedCheckpoint:returned.result.checkpoint,durableBody,durableAssumed,realStorageBarrier:true,pausedSnapshotPhase:paused.phase};
 }
 if(id==='S3_READ_FAILURE_REPLAY'){
  const {a,b}=await migrated();await putRemote(b,[page('read0','# Read zero','r0'),page('read1','# Read one','r1')]);
  w.provider.append(w.file('read0').id);const failed=deferred(),release=deferred();const before=await w.checkpoint(a);
  w.m.faults.push({method:'GET',fileId:w.file('read1').id,path:'/drive/v3/files/',status:503});
  w.afterResponse=async e=>{if(e.status===503){w.blockNetwork=release.promise;failed.resolve();}};
  const task=a.sync();await failed.promise;await w.snapshot('content-failure-before-retry');eq(await w.checkpoint(a),before);assert.notEqual((await a.view('read1')).status,'remote-verified');
  w.blockNetwork=null;release.resolve();await task;w.afterResponse=null;await w.restart(a);await a.sync();eq(await a.page('read0'),page('read0','# Read zero','r0'));eq(await a.page('read1'),page('read1','# Read one','r1'));
  await w.snapshot('content-failure-replayed');return {status:'PASS',beforeCheckpoint:before,faults:w.m.faults,limitation:'Native callback failure retains lock until unchanged timeout/CAS protocol recovers; errors archived'};
 }
 if(id==='S4_RETAINED_EVENT'||id==='S4_NO_EVENT'){
  const {a,b}=await baseline();const oldId='discovery-old',newId='discovery-new';await putRemote(b,[page(oldId,T.A,'old-initial'),page(newId,T.A,'new-initial')]);await a.sync();
  const old=w.file(oldId);let preUpdateCheckpoint=null,feedStart=0;
  if(id==='S4_NO_EVENT'){
   w.provider.omitted?.add(old.id);w.provider.state.omitIds.add(old.id);w.m.control.hiddenIds=[old.id];
   update(oldId,T.C,'old-latest');update(newId,T.E,'new-latest');await w.transition(a);await a.sync();
  }else{
   await w.transition(a);preUpdateCheckpoint=await w.checkpoint(a);assert.equal(preUpdateCheckpoint.changes109.phase,'changes');feedStart=w.provider.index(preUpdateCheckpoint.changes109.token);
   await w.snapshot('pre-update-durable-token');await putRemote(b,[page(oldId,T.C,'old-latest')]);await putRemote(b,[page(newId,T.E,'new-latest')]);assert(old.modifiedTime<w.file(newId).modifiedTime);w.m.control.hiddenIds=[old.id];
  }
  const frozen={modifiedTime:old.modifiedTime,body:old.body.toString(),version:old.version};const source=w.provider.snapshot();w.m.control.hiddenIds=[];await w.snapshot('old-restored-no-new-event');eq({modifiedTime:old.modifiedTime,body:old.body.toString(),version:old.version},frozen);
  const priorEvents=w.events.length;await a.sync();await w.snapshot('retention-final');const actual=await a.page(oldId);
  if(id==='S4_RETAINED_EVENT'){
   eq(actual,page(oldId,T.C,'old-latest'));eq(await a.page(newId),page(newId,T.E,'new-latest'));
   const newFile=w.file(newId),retainedOld=source.changes.findIndex((c,i)=>i>=feedStart&&c.fileId===old.id&&c.file.modifiedTime===old.modifiedTime),retainedNew=source.changes.findIndex((c,i)=>i>=feedStart&&c.fileId===newFile.id&&c.file.modifiedTime===newFile.modifiedTime);assert(retainedOld>=feedStart);assert(retainedNew>retainedOld);
   const responses=w.events.slice(priorEvents).filter(e=>e.type==='response'),feedResponses=responses.filter(e=>new URL(e.url).pathname==='/drive/v3/changes');
   for(const fileId of [old.id,newFile.id])assert(feedResponses.some(e=>JSON.parse(e.body).changes.some(c=>c.fileId===fileId)),'actual feed response contains retained event');
   for(const expected of [page(oldId,T.C,'old-latest'),page(newId,T.E,'new-latest')])assert(responses.some(e=>{try{const d=JSON.parse(e.body);return d.id===expected.id&&d.body===expected.body&&d.editId===expected.editId;}catch{return false;}}),'actual full content response matches');
   assert(!responses.some(e=>e.url.includes('orderBy=name')),'no inventory rescan');return {status:'PASS',actual,newActual:await a.page(newId),preUpdateCheckpoint,feedStart,retainedOld,retainedNew,oldModifiedTime:old.modifiedTime,newModifiedTime:newFile.modifiedTime,sourceAssumption:'Both ordered relevant changed-file events retained after actual pre-update durable token; no restoration event added'};
  }
  assert.equal(actual.editId,'old-initial');return {status:'BOUNDARY_FAIL_RECOVERY_NOT_PROVEN',actual,sourceLatest:JSON.parse(old.body.toString()),sourceAssumption:'Old absent from migration inventory and no recoverable old event after captured token; no fabricated restoration event/backfill'};
 }
 if(id==='S5_LOST_RESPONSE_INTENT'){
  const {a,b}=await fork();await w.transition(a);await a.save('page',T.D);await a.resolve('page','merge',T.M);
  const chosen=await a.draft('page');const failed=deferred(),release=deferred();const wal=[...w.m.files.values()].find(f=>f.name==='rxdb-wal.json');
  w.m.faults.push({method:'PUT',fileId:wal.id,kind:'unknown-success',bodyContains:chosen.draft.editId});
  w.afterFetchError=async()=>{const f=w.m.faults.find(f=>f.kind==='unknown-success'&&f.used);if(f){w.blockNetwork=release.promise;failed.resolve();}};
  const task=a.sync();await failed.promise;const uncertain=await w.snapshot('successful-wal-mutation-response-lost');const fault=w.m.faults.find(f=>f.kind==='unknown-success');assert.equal(fault.matched.mutation_applied,true);assert.equal(fault.matched.response_delivered,false);assert(fault.matched.stored_body_matches_request);
  assert.equal((await a.draft('page')).draft.body,T.M);assert.notEqual((await a.view('page')).status,'remote-verified');
  const newer=await a.save('page',T.D+'\n\nNew generation during uncertainty.');assert(newer.journal.seq>chosen.seq);await w.snapshot('newer-generation-ack-during-network-wait');
  w.blockNetwork=null;release.resolve();await task;w.afterFetchError=null;
  assert(await a.draft('page'),'earlier mutation and sync alone cannot retire newer intent');await w.snapshot('older-generation-cannot-retire');
  await a.resolve('page','local');let hookFired=false;
  a.hook=async boundary=>{if(boundary==='before-cleanup'&&!hookFired){hookFired=true;const row=await a.db.localDrafts.findOne('page:a').exec();await row.incrementalModify(d=>({...d,seq:d.seq+1,draft:{...d.draft,body:T.E,editId:'newer-before-cleanup'}}));}};
  await assert.rejects(()=>a.verify('page'),/Draft advanced/);assert(hookFired);assert.equal((await a.draft('page')).draft.body,T.E);a.hook=async()=>{};
  await w.snapshot('newer-before-cleanup-retained');
  let raced=false;a.hook=async boundary=>{if(boundary==='resolution-journal'&&!raced){raced=true;await b.sync();await b.save('page',T.E);await b.sync();assert.equal((await b.remote('page')).body,T.E,'race control requires independently materialized E');}};
  await a.resolve('page','merge',T.M);await a.verify('page');assert.equal((await a.view('page')).page.body,T.E);assert.equal((await a.draft('page')).sourceLocal.body,T.B);assert.equal((await a.draft('page')).sourceCloud.body,T.C);a.hook=async()=>{};
  await w.snapshot('e-race-master-wins-protected');
  await a.save('unrelated','# Unrelated acknowledged intent.');await a.resolve('page','cloud');assert.equal(await a.draft('page'),null);assert(await a.draft('unrelated'));
  await w.snapshot('owned-discard-unrelated-retained');return {status:'PASS',uncertainPhase:uncertain.phase,fault,chosen,newer,hookFired,unrelated:await a.draft('unrelated')};
 }
 throw new Error('Unknown case');
}

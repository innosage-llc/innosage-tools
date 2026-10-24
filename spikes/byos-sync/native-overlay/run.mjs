import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mock} from '../src/mock.mjs';
import {rxReplica} from '../src/candidates.mjs';
import {fixtures,bodies as T} from './fixtures.mjs';
const sourceAtStart=createHash('sha256').update(await readFile('native-overlay/page-store.mjs')).digest('hex');
await mkdir('native-overlay/.generated',{recursive:true});
await build({entryPoints:['native-overlay/page-store.mjs'],bundle:true,platform:'node',
  packages:'external',format:'cjs',outfile:'native-overlay/.generated/store.cjs'});
const require=createRequire(import.meta.url);
const {openPageStore}=require('./.generated/store.cjs');

const selected=process.argv.find(x=>x.startsWith('--fixture='))?.split('=')[1];
const results=[];
const seedCount=Number(process.argv.find(x=>x.startsWith('--seeds='))?.split('=')[1]??0);
const seedResults=[];
const allowed=new Set();
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
 const url=new URL(typeof input==='string'?input:input.url);
 if(!allowed.has(url.origin)) throw new Error('NON_LOOPBACK_FETCH_BLOCKED '+url.origin);
 return originalFetch(input,init);
};
const config={live:false,transactionTimeout:50,retryTime:1000};
const timed=async fn=>{const t=performance.now();const result=await fn();return {result,ms:performance.now()-t};};
const remoteBodies=m=>Object.fromEntries([...m.files.values()].filter(f=>f.name.endsWith('.json')&&
 !['transaction.json','rxdb-wal.json'].includes(f.name)).flatMap(f=>{
 try {const d=JSON.parse(f.body.toString());return d.id?[[d.id,d.body]]:[];}catch{return [];}}));
async function world(opts={}) {
 const m=await mock(opts);allowed.add(m.url);
 const clients=[],acknowledged=[];
 const suffix=crypto.randomUUID().replaceAll('-','');
 const open=async(device,session=device,hook)=>{
  const s=await openPageStore({workspace:device+suffix,session,multiInstance:false,hook});
  s.workspace='remote'+suffix;
  const save=s.save.bind(s);
  s.save=async(page,body)=>{const view=await save(page,body);
    acknowledged.push({device,session,page,body,editId:view.journal?.draft.editId});return view;};
  clients.push(s);return s;
 };
 return {m,open,clients,acknowledged,async close(){for(const s of clients)if(!s.closed)await s.close();await m.close();allowed.delete(m.url);}};
}
async function baseline(w) {
 const a=await w.open('a'),b=await w.open('b');
 await a.save('page',T.A);let nativeCreated=0; a.hook=async boundary=>{if(boundary==='native-created')nativeCreated++;};
 await Promise.all([a.connect(w.m.url,config),a.connect(w.m.url,config)]);
 assert.equal(nativeCreated,1); a.hook=async()=>{};
 await a.verify('page');
 await b.connect(w.m.url,config);await b.sync();
 assert.equal((await b.page('page')).body,T.A);
 return {a,b};
}
async function fork(w) {
 const {a,b}=await baseline(w);
 await a.save('page',T.B);await b.save('page',T.C);
 await b.sync();await b.verify('page');await a.sync();
 const v=await a.view('page');
 assert.equal(v.body,T.B);assert.equal(v.page.body,T.C);
 assert.equal(v.cloud,T.C);assert.equal(v.status,'needs-resolution');
 return {a,b};
}
const cases={
 async F01(w){
  let s=await w.open('a');
  s.hook=async(boundary,row)=>{if(boundary==='journal-committed'){
   assert.equal((await s.draft('page')).draft.body,T.B);
   assert.equal(await s.page('page'),null);assert.equal(row.draft.body,T.B);
  }};
  const v=await s.save('page',T.B);assert.equal(v.status,'local-saved');
  await s.close();s=await w.open('a');assert.equal((await s.view('page')).body,T.B);
  assert.notEqual((await s.view('page')).status,'remote-verified');return {recovered:await s.view('page')};
 },
 async F02(w){const {a,b}=await baseline(w);
  await a.save('first',T.B);await b.save('second',T.C);
  await a.sync();await b.sync();await a.sync();await b.sync();
  assert.equal((await a.page('second')).body,T.C);assert.equal((await b.page('first')).body,T.B);
  assert.equal((await a.view('first')).warning,false);assert.equal((await b.view('second')).warning,false);
  return {remote:remoteBodies(w.m)};
 },
 async F03(w){let {a}=await fork(w);const expected=await a.view('page');
  await a.close();a=await w.open('a');
  const v=await a.view('page');assert.equal(v.body,T.B);assert.equal(v.cloud,T.C);
  assert.equal(v.journal.sourceLocal.body,T.B);assert.equal(v.journal.sourceCloud.body,T.C);
  return {before:expected,recovered:v,remote:remoteBodies(w.m)};
 },
 async F04(w){const {a,b}=await fork(w);
  await a.save('page',T.D);await b.save('page',T.E);await b.sync();await a.sync();
  await a.save('other',T.M);await a.sync();await b.sync();
  const v=await a.view('page');assert.equal(v.body,T.D);assert.equal(v.cloud,T.E);
  assert.equal(v.journal.sourceLocal.body,T.B);assert.equal(v.journal.sourceCloud.body,T.C);
  assert.equal(remoteBodies(w.m).page,T.E);assert.equal((await b.page('other')).body,T.M);
  return {view:v,remote:remoteBodies(w.m)};
 },
 async F05(w){const {a}=await fork(w);
  // A remote capture between old snapshot and journal write must survive CAS.
  a.hook=async boundary=>{if(boundary==='before-journal-update'){
   await a.captureMaster({id:'page',body:T.E,editId:'intervening-remote'});
  }};
  await a.save('page',T.D);
  const captured=await a.draft('page');
  assert.equal(captured.remote.body,T.E);assert.equal(captured.sourceLocal.body,T.B);
  assert.equal(captured.sourceCloud.body,T.C);assert.equal(captured.state,'needs-resolution');
  assert.equal((await a.page('page')).body,T.C);
  a.hook=async()=>{};
const before=await a.draft('page');
  for(let i=0;i<5;i++)for(const name of ['sent','received','conflict'])
   a.replication.subjects[name].next({input:{realMasterState:{id:'page',body:T.A,editId:'stale'}},body:T.A});
  assert.deepEqual(await a.draft('page'),before);return {journal:before,signals:15};
 },
 async F06(w){const {a,b}=await fork(w);await b.save('page',T.E);await b.sync();
  await a.resolve('page','cloud');const v=await a.view('page');
  assert.equal(v.body,T.E);assert.equal(v.journal,null);assert.equal(remoteBodies(w.m).page,T.E);
  return {view:v,remote:remoteBodies(w.m)};
 },
 async F07(w){const {a}=await fork(w);await a.save('page',T.D);
  await a.resolve('page','local');assert.ok(await a.draft('page'));
  await a.verify('page');const v=await a.view('page');assert.equal(v.body,T.D);
  assert.equal(v.journal,null);assert.equal(v.status,'remote-verified');assert.equal(remoteBodies(w.m).page,T.D);
  // Guard a newer sequence injected between verification and cleanup.
  await a.save('page',T.M);
  a.hook=async boundary=>{if(boundary==='before-cleanup'){
    const row=await a.db.localDrafts.findOne('page:a').exec();
    await row.incrementalModify(d=>({...d,seq:d.seq+1,
      draft:{...d.draft,body:T.E,editId:'newer-sequence'}}));
  }};
  await assert.rejects(()=>a.verify('page'),/Draft advanced/);
  assert.equal((await a.draft('page')).draft.body,T.E);
  return {view:v,remote:remoteBodies(w.m),newer_sequence_retained:true};
 },
 async F08(w){const {a}=await fork(w);await a.resolve('page','merge',T.M);
  const d=await a.draft('page');assert.equal(d.sourceLocal.body,T.B);assert.equal(d.sourceCloud.body,T.C);
  await a.verify('page');assert.equal((await a.view('page')).journal,null);
  assert.equal(remoteBodies(w.m).page,T.M);return {beforeVerification:d,remote:remoteBodies(w.m)};
 },
 async F09(w){const {a,b}=await fork(w);let injected=false;
  a.hook=async boundary=>{if(boundary==='resolution-journal'&&!injected){injected=true;
   await b.save('page',T.E);await b.sync();}};
  await a.resolve('page','merge',T.M);await a.verify('page');
  const v=await a.view('page');assert.equal(v.body,T.M);assert.equal(v.cloud,T.E);
  assert.equal(v.status,'needs-resolution');assert.equal(v.page.body,T.E);assert.ok(v.journal);
  assert.equal(v.journal.sourceLocal.body,T.B);assert.equal(v.journal.sourceCloud.body,T.C);
  return {view:v,remote:remoteBodies(w.m)};
 },
 async F10(w){const {a}=await baseline(w);await a.save('page',T.B);
  const faults=[];
  // Direct published verification path must fail closed on access errors. Native
  // retry storm/timeout and all response schedules require the later browser lane.
  for(const status of [401,403,429,500,503]){
   w.m.control.status=status;let failed=false;
   try{await a.remote('page');}catch{failed=true;}
   assert.equal(failed,true);assert.equal((await a.draft('page')).draft.body,T.B);
   assert.notEqual((await a.view('page')).status,'remote-verified');faults.push({status,preserved:true});
  }
  w.m.control.status=null;return {faults,coverage:'verification path only; native retry/timeout schedules NOT_RUN'};
 },
 async F16(w){
  const a=await rxReplica('checkpointa'+crypto.randomUUID().replaceAll('-',''),w.m),
    b=await rxReplica('checkpointb'+crypto.randomUUID().replaceAll('-',''),w.m);
  try{
   const pages=Array.from({length:30},(_,i)=>({id:'page'+String(i).padStart(3,'0'),
    parentId:null,body:`# Same-time ${i}\n\nComplete acknowledged body ${i}.`,editIds:[`same-${i}`]}));
   await a.putAll(pages);await a.sync();await a.sync();await b.sync();await b.sync();
   const cold=await b.read(),remote=remoteBodies(w.m);
   const lost=pages.filter(p=>!cold.some(q=>q.id===p.id&&q.body===p.body));
   assert.equal(Object.keys(remote).length,30);
   return {gate:lost.length?'NATIVE CHECKPOINT BLOCKER / HOLD':'PASS',remote_count:30,
    cold_count:cold.length,undiscovered_ids:lost.map(p=>p.id),
    expected:30,actual:cold.length,configuration:'stock17.6.0 batchSize10, same modifiedTime; live:false harness',
    hidden_listing:'NOT_RUN in this increment'};
  }finally{await a.close();await b.close();}
 },
};
try {
 for(const f of fixtures){
  if(selected&&selected!==f.id)continue;
  const row={...f,layer:'store-only',label:'MOCK-TESTED',real_provider:'REAL-PROVIDER-NOT-RUN'};
  if(!cases[f.id]){results.push({...row,status:'NOT_RUN',reason:'Separate native browser/UI lane; not executed by the store-only runner'});continue;}
  const w=await world({sameTime:f.id==='F16'});
  try{
   const {result,ms}=await timed(()=>cases[f.id](w));
   Object.assign(row,{status:'PASS',store_status:'PASS',evidence:result,duration_ms:ms});
   if(f.id==='F10'){row.status='NOT_RUN';row.reason='Partial access-error verification only; full fault matrix outstanding';}
   if(f.id==='F16'&&result.gate!=='PASS'){row.status='FAIL';row.expected_native_blocker=true;}
  }catch(e){Object.assign(row,{status:'FAIL',store_status:'FAIL',error:e.stack});}
  finally{
   row.requests=w.m.requests;row.faults=w.m.faults;row.acknowledged=w.acknowledged;
   row.methods=Object.fromEntries([...new Set(w.m.requests.map(r=>r.method))].map(method=>
    [method,w.m.requests.filter(r=>r.method===method).length]));
   row.bytes_up=w.m.requests.reduce((n,r)=>n+r.bytes_up,0);
   row.bytes_down=w.m.requests.reduce((n,r)=>n+r.bytes_down,0);
   await w.close();
  }
  results.push(row);console.log(f.id,row.status,row.error?.split('\n')[0]??row.evidence?.gate??'');
 }
 for(let seed=1;seed<=seedCount;seed++) {
  const w=await world({seed});let rng=seed>>>0;
  const random=()=>{rng=(1664525*rng+1013904223)>>>0;return rng/4294967296;};
  const schedule=[];
  try {
   let {a,b}=await fork(w);
   let local=T.B,cloud=T.C;
   const count=1+Math.floor(random()*4);
   for(let step=0;step<count;step++){
    if(random()<.5){cloud=T.E+`\nSeed ${seed} remote ${step}`;
      await b.save('page',cloud);await b.sync();await b.verify('page');
      schedule.push({op:'remote-save',body:cloud});}
    local=T.D+`\nSeed ${seed} local ${step}`;await a.save('page',local);
    schedule.push({op:'local-review-edit',body:local});
    if(random()<.5){await a.sync();schedule.push({op:'remote-invalidation'});}
   }
   if(random()<.5){await a.close();a=await w.open('a');await a.connect(w.m.url,config);
    assert.equal((await a.view('page')).body,local);schedule.push({op:'close-reopen-local-journal'});}
   const action=['cloud','local','merge'][Math.floor(random()*3)];
   const raced=action!=='cloud' && random()<.5;
   if(raced) a.hook=async boundary=>{
    if(boundary==='resolution-journal') {cloud=T.E+`\nSeed ${seed} intervening race`;
      await b.save('page',cloud);await b.sync();await b.verify('page');
      schedule.push({op:'resolution-race',body:cloud});}
   };
   const merged=T.M+`\nSeed ${seed}`;
   await a.resolve('page',action,merged);schedule.push({op:'resolve',action});
   if(action!=='cloud')await a.verify('page');
   const v=await a.view('page'),remote=remoteBodies(w.m),expected=action==='merge'?merged:local;
   if(action==='cloud'){assert.equal(v.body,cloud);assert.equal(v.journal,null);}
   else if(raced){assert.equal(v.body,expected);assert.equal(v.cloud,cloud);assert.ok(v.journal);
    assert.equal(remote.page,cloud);assert.equal(v.status,'needs-resolution');
    assert.equal(v.journal.sourceLocal.body,T.B);assert.equal(v.journal.sourceCloud.body,T.C);}
   else {assert.equal(v.body,expected);assert.equal(v.journal,null);assert.equal(remote.page,expected);}
   seedResults.push({seed,action,raced,status:'PASS',schedule,acknowledged:w.acknowledged,view:v,remote,
    requests:w.m.requests.length,bytes_up:w.m.requests.reduce((n,r)=>n+r.bytes_up,0),
    bytes_down:w.m.requests.reduce((n,r)=>n+r.bytes_down,0)});
  }catch(error){seedResults.push({seed,status:'FAIL',schedule,error:String(error)});process.exitCode=1;}
  finally{await w.close();}
  if(seed%10===0)console.log('SEEDS',seed,'/',seedCount);
 }
 const hashes={};
 for(const file of ['native-overlay/page-store.mjs','native-overlay/fixtures.mjs','native-overlay/run.mjs',
  'package-lock.json','src/mock.mjs','node_modules/rxdb/src/replication-protocol/default-conflict-handler.ts',
  'node_modules/rxdb/src/plugins/replication-google-drive/downstream.ts'])
   hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
 if(hashes['native-overlay/page-store.mjs']!==sourceAtStart)throw new Error('Source changed during fixture execution; report is stale');
 const report={master:'https://github.com/innosage-llc/innosage-tools/issues/102',
  source_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes,
  runtime:process.version,rxdb:'17.6.0',mock_only:true,ui_status:'NOT_RUN by store-only runner; see native UI/browser evidence',
  recommendation:'INCOMPLETE; NOT SAFE FOR PRODUCT',seeds_run:seedResults.length,seedResults,results};
 await writeFile('native-overlay/.generated/results.json',JSON.stringify(report,null,2)+'\n');
 if(results.some(r=>r.store_status==='FAIL'))process.exitCode=1;
} finally {globalThis.fetch=originalFetch;}

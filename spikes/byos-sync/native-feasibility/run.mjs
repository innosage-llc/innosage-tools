// Tools107 purpose-built CLI. Parent watchdog owns exactly one child per invocation.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, openSync, closeSync, renameSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url)), spike = resolve(here, '..');
const sha = x => createHash('sha256').update(x).digest('hex');
const json = x => JSON.stringify(x, null, 2) + '\n';
const clone = x => x === undefined ? null : JSON.parse(JSON.stringify(x));
const oraclePath = resolve(here, 'oracle.json');
const protocol = 'tools107-candidate-oracle-v1';
const expectedLocked = '9eccd0669600638b270768f9b400348a8ac1a07e1db8445b06484a83e8b8cf37';
const req = createRequire(import.meta.url);
const rxRoot = resolve(dirname(req.resolve('rxdb')), '../..');
const tieDocs = Array.from({length:30}, (_, i) => {
  const index = String(i).padStart(3, '0');
  return {id:`page${index}`, parentId:null, body:`# Tie ${index}\n\nComplete immutable body ${index}.`, editIds:[`tie-${index}`]};
});
const initial = [0,1].map(i => ({id:`visibility${i}`, parentId:null, body:`# Original ${i}`, editIds:[`initial-${i}`]}));
const latest = [0,1].map(i => ({id:`visibility${i}`, parentId:null, body:`# Latest ${i}\n\nExact new intent.`, editIds:[`latest-${i}`]}));
const expanded = {
  protocol, designManifestSha256:'897ed936b9d764c0c613aff88e400de66887be112fd9aab4ca4a7ca24c8df0e3',
  lockedSpecSha256:expectedLocked, correctness:'Full expected docs: id,parentId,body,editIds; native metadata retained in actual payloads.',
  rounds:2, maxAdmittedFetches:1000, maxInvocationMs:180000,
  config:{replicationIdentifier:'byos',live:false,waitForLeadership:false,push:{batchSize:100},googleDrive:{folderPath:'workspace',transactionTimeout:50},retryTime:20},
  overrides:'transactionTimeout 50ms and retryTime 20ms reused from existing fast harness, not product defaults; no timing/product inference.',
  cases:{
    T10:{sameTime:true,pullBatchSize:10,expected:tieDocs,prediction:{received:16,criterion:'FAIL'},schedule:['independent native writer bulkUpsert','writer 2 explicit sync rounds','cold receiver 2 explicit sync rounds']},
    T100:{sameTime:true,pullBatchSize:100,expected:tieDocs,prediction:{received:30,criterion:'PASS'},schedule:['independent native writer bulkUpsert','writer 2 explicit sync rounds','cold receiver 2 explicit sync rounds']},
    H100:{sameTime:false,pullBatchSize:100,initial,latest,prediction:{existingOldStale:true,initialCheckpointOldStale:true,freshLatestBoth:true},schedule:['writer baseline 2 rounds','receiver baseline 2 rounds','writer update 0 then 2 rounds','writer update 1 then 2 rounds','assert old modifiedTime < new','hide only old ID','receiver 2 rounds; latest1 and cursor above old required','restore visibility without timestamp/body mutation','same DB/collection/identifier restart 2 rounds','same-ID restart initialCheckpoint epoch empty seen 2 rounds','separate fresh DB diagnostic 2 rounds; latest both required']}
  },
  initialCheckpoint:{modifiedTime:'1970-01-01T00:00:00.000Z',docIdsWithSameModifiedTime:[]},
  verdictRules:{captureSetupControlSourceFailure:'INCONCLUSIVE',predictedDefect:'C3 FAIL (never diagnostic PASS)',unexpectedRestartRecovery:'STOP_FOR_LEAD_ANALYSIS',freshDatabase:'diagnostic positive control only, never remedy'}
};
const sources = [
  ['harness',fileURLToPath(import.meta.url)],['expanded-oracle',oraclePath],
  ['locked-spec',resolve(here,'locked-spec.json')],
  ...['src/mock.mjs','src/candidates.mjs','package.json','package-lock.json'].map(p=>[p,resolve(spike,p)]),
  ['rxdb/package.json',resolve(rxRoot,'package.json')],
  ...['plugins/replication-google-drive/downstream','plugins/replication-google-drive/index','plugins/replication-google-drive/init','plugins/replication-google-drive/document-handling','plugins/replication/index','replication-protocol/downstream','replication-protocol/checkpoint','replication-protocol/default-conflict-handler'].flatMap(p=>[
    [`rxdb/dist/cjs/${p}.js`,resolve(rxRoot,`dist/cjs/${p}.js`)],
    [`rxdb/src/${p}.ts`,resolve(rxRoot,`src/${p}.ts`)]
  ])
];
function bindings(){return sources.map(([label,path])=>({label,path:relative(spike,path),sha256:sha(readFileSync(path)),body:readFileSync(path,'utf8')}));}
function guard(origin, allowed, admitted, max=1000){
  if(origin!==allowed) throw new Error(`NON_LOOPBACK_FETCH_BLOCKED ${origin}`);
  if(admitted>=max) throw new Error('REQUEST_CAP_BEFORE_DISPATCH');
  return admitted+1;
}

const mode = process.argv[2];
if(mode==='--freeze'){
  assert(!existsSync(oraclePath),'Oracle already frozen; do not overwrite');
  const locked=readFileSync('/tmp/tools107-locked-spec.json'); assert.equal(sha(JSON.parse(locked).body),expectedLocked);
  writeFileSync(resolve(here,'locked-spec.json'),locked);
  writeFileSync(oraclePath,json(expanded));
  const frozen={protocol,oracleSha256:sha(readFileSync(oraclePath)),harnessSha256:sha(readFileSync(fileURLToPath(import.meta.url))),lockedContainerSha256:sha(locked),lockedBodySha256:sha(JSON.parse(locked).body),provenance:'Initial pre-execution freeze rejected container hash mismatch. Lead independently confirmed mandated hash is exact JSON.body UTF8; no cases ran before resolution, no semantic oracle change.',at:new Date().toISOString()};
  writeFileSync(resolve(here,'freeze.json'),json(frozen)); console.log(json(frozen));
} else if(mode==='--self-check'){
  let count=0,dispatches=0;
  for(let i=0;i<1000;i++){count=guard('http://127.0.0.1:1','http://127.0.0.1:1',count);dispatches++;}
  assert.throws(()=>{count=guard('http://127.0.0.1:1','http://127.0.0.1:1',count);dispatches++;},/REQUEST_CAP/);
  assert.equal(dispatches,1000);
  assert.throws(()=>guard('https://example.com','http://127.0.0.1:1',0),/NON_LOOPBACK/);
  assert.equal(tieDocs.length,30); assert.equal(new Set(tieDocs.map(x=>x.id)).size,30);
  console.log('PASS synchronous admission: dispatch 1..1000; reject 1001 before dispatch; nonmock origin rejected; oracle 30 unique immutable docs');
} else if(mode==='--child'){
  await child(process.argv[3],process.argv[4]);
} else if(['T10','T100','H100'].includes(mode)){
  await parent(mode);
} else {throw new Error('Usage: node native-feasibility/run.mjs --freeze | --self-check | T10 | T100 | H100');}

async function parent(caseId){
  const started=performance.now(), at=new Date().toISOString();
  const dir=resolve(here,'evidence',caseId); assert(!existsSync(dir),'Preserve original invocation; evidence directory already exists'); mkdirSync(dir,{recursive:true});
  let pre;
  try{
    const frozen=JSON.parse(readFileSync(resolve(here,'freeze.json')));
    assert.equal(sha(readFileSync(oraclePath)),frozen.oracleSha256); assert.equal(sha(readFileSync(fileURLToPath(import.meta.url))),frozen.harnessSha256);
    pre=bindings(); writeFileSync(resolve(dir,'sources-pre.json.gz'),gzipSync(json(pre)));
  }catch(error){writeFileSync(resolve(dir,'receipt.json'),json({caseId,status:'INCONCLUSIVE',stage:'source-preflight',error:String(error)}));throw error;}
  const out=openSync(resolve(dir,'console.txt'),'wx');
  const worker=spawn(process.execPath,[fileURLToPath(import.meta.url),'--child',caseId,dir],{cwd:spike,stdio:['ignore',out,out]});
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;worker.kill('SIGKILL');},Math.max(1,180000-(performance.now()-started)));
  const outcome=await new Promise(resolveExit=>{worker.once('error',e=>resolveExit({spawnError:String(e)}));worker.once('exit',(code,signal)=>resolveExit({code,signal}));});
  clearTimeout(timer);closeSync(out);
  const post=bindings(), sourceUnchanged=pre.every((x,i)=>x.sha256===post[i].sha256);
  writeFileSync(resolve(dir,'sources-post.json.gz'),gzipSync(json(post)));
  const eventsPath=resolve(dir,'events.jsonl'), events=existsSync(eventsPath)?readFileSync(eventsPath,'utf8'):'';
  writeFileSync(resolve(dir,'events.jsonl.gz'),gzipSync(events));
  if(existsSync(eventsPath)){mkdirSync(resolve(here,'.generated'),{recursive:true});renameSync(eventsPath,resolve(here,'.generated',`${caseId}-events.jsonl`));}
  const eventRows=events.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
  const result=existsSync(resolve(dir,'result.json'))?JSON.parse(readFileSync(resolve(dir,'result.json'))):null;
  const receipt={protocol,caseId,command:`node native-feasibility/run.mjs ${caseId}`,startedAt:at,elapsedMs:performance.now()-started,...outcome,timedOut,watchdog:'parent SIGKILL to its own direct child only; no Promise.race, no retries',maxInvocationMs:180000,maxAdmittedFetches:1000,admitted:eventRows.filter(x=>x.type==='admit').length,observed:eventRows.filter(x=>x.type==='response').length,sourceUnchanged,sourceHashes:post.map(({label,path,sha256})=>({label,path,sha256})),oracleSha256:sha(readFileSync(oraclePath)),harnessSha256:sha(readFileSync(fileURLToPath(import.meta.url))),baseHead:execFileSync('git',['rev-parse','HEAD'],{cwd:spike,encoding:'utf8'}).trim(),requested:{model:'gpt-6.1-sol',effort:'high'},hostRouted:'UNKNOWN',providerObserved:'UNKNOWN',usageCost:'UNKNOWN',status:timedOut||!sourceUnchanged||outcome.code!==0||!result?'INCONCLUSIVE':result.status,resultSha256:result?sha(readFileSync(resolve(dir,'result.json'))):null,rawEventSha256:sha(events),limitations:['supplemental source attestation; no retroattestation of historical evidence','mock-only synthetic listing assumption; no real Google/provider inference','fake-indexeddb process-local state; no crash persistence claim','fast harness timeout/retry overrides; no performance inference']};
  writeFileSync(resolve(dir,'receipt.json'),json(receipt));console.log(json({caseId,status:receipt.status,admitted:receipt.admitted,observed:receipt.observed,elapsedMs:receipt.elapsedMs,outcome,result}));
  if(receipt.status==='INCONCLUSIVE')process.exitCode=2;
}

async function child(caseId,dir){
  await import('fake-indexeddb/auto');
  const {mock}=await import('../src/mock.mjs'), {schema}=await import('../src/candidates.mjs');
  const {createRxDatabase}=req('rxdb'), {getRxStorageDexie}=req('rxdb/plugins/storage-dexie'), {replicateGoogleDrive}=req('rxdb/plugins/replication-google-drive');
  const o=JSON.parse(readFileSync(oraclePath)), spec=o.cases[caseId];assert(spec);
  const replicas=[], errors=[], phases=[]; let phase='setup', admitted=0, observed=0, m, result;
  const event=x=>appendFileSync(resolve(dir,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),phase,...x})+'\n');
  const fatal=error=>{event({type:'hard-stop',error:String(error),admitted,observed});writeFileSync(resolve(dir,'result.json'),json({caseId,status:'INCONCLUSIVE',phase,error:String(error),admitted,observed}));process.exit(2);};
  const original=globalThis.fetch;
  try{
    m=await mock({sameTime:spec.sameTime});
    globalThis.fetch=(input,init)=>{
      const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);
      try{admitted=guard(url.origin,m.url,admitted,o.maxAdmittedFetches);}catch(error){fatal(error);}
      const n=admitted,requestPhase=phase;
      event({type:'admit',n,url:String(url),method:init?.method??'GET',query:Object.fromEntries(url.searchParams),requestBody:init?.body?String(init.body):null});
      return original(input,init).then(async res=>{
        const body=await res.clone().text();observed++;
        event({type:'response',n,requestPhase,url:String(url),status:res.status,headers:Object.fromEntries(res.headers),body});return res;
      },error=>{event({type:'fetch-error',n,error:String(error)});throw error;});
    };
    async function make(role){
      const name='tools107'+role+randomUUID().replaceAll('-','');
      const db=await createRxDatabase({name,storage:getRxStorageDexie(),multiInstance:false});
      await db.addCollections({pages:{schema}});
      const r={role,name,db,repl:null,rounds:0,config:null};replicas.push(r);return r;
    }
    function payload(doc){return {id:doc.id,parentId:doc.parentId,body:doc.body,editIds:doc.editIds};}
    async function read(r){return (await r.db.pages.find().exec()).map(d=>d.toJSON()).sort((a,b)=>a.id.localeCompare(b.id));}
    function check(actual,expected){return {expectedCount:expected.length,actualCount:actual.length,missingIds:expected.filter(e=>!actual.some(a=>a.id===e.id)).map(e=>e.id),mismatchedIds:expected.filter(e=>{const a=actual.find(x=>x.id===e.id);return a&&JSON.stringify(payload(a))!==JSON.stringify(e);}).map(e=>e.id),unexpectedIds:actual.filter(a=>!expected.some(e=>e.id===a.id)).map(a=>a.id)};}
    function remote(expected){
      const folderIds=replicas.map(r=>r.repl?.driveStructure.docsFolderId).filter(Boolean);
      return [...m.files.values()].filter(f=>folderIds.some(id=>f.parents.includes(id))&&expected.some(e=>f.name===e.id+'.json')).map(f=>JSON.parse(f.body.toString()));
    }
    async function snap(label,expected){
      phase=label;const inventory=[...m.files.values()].map(f=>{let parsed;try{parsed=JSON.parse(f.body.toString());}catch{parsed=null;}return {id:f.id,name:f.name,mimeType:f.mimeType,parents:f.parents,visible:!m.control.hiddenIds.includes(f.id),createdTime:f.createdTime,modifiedTime:f.modifiedTime,version:f.version,rawBody:f.body.toString(),parsedDocument:parsed,isExpectedDoc:expected.some(e=>f.name===e.id+'.json'),docsFolderMatches:replicas.filter(r=>r.repl&&f.parents.includes(r.repl.driveStructure.docsFolderId)).map(r=>r.role)};});
      const state={phase:label,inventory,replicas:await Promise.all(replicas.map(async r=>({role:r.role,name:r.name,rounds:r.rounds,config:r.config,effectiveNativeConfig:r.repl?{googleDrive:clone(r.repl.googleDrive),pullBatchSize:r.repl.pull.batchSize,pullInitialCheckpoint:clone(r.repl.pull.initialCheckpoint),pushBatchSize:r.repl.push.batchSize,live:r.repl.live,retryTime:r.repl.retryTime,autoStart:r.repl.autoStart,replicationIdentifier:r.repl.replicationIdentifier}:null,driveStructure:clone(r.repl?.driveStructure),checkpointDocs:clone(r.repl?.internalReplicationState?.lastCheckpointDoc),payloads:await read(r),comparison:check(await read(r),expected)}))),remoteComparison:check(remote(expected),expected),admitted,observed,nativeRequests:clone(m.requests),unsupported:clone(m.unsupported)};
      phases.push(state);writeFileSync(resolve(dir,`phase-${String(phases.length).padStart(2,'0')}.json`),json(state));event({type:'phase',label});return state;
    }
    async function sync(r,label,initialCheckpoint){
      phase=label;event({type:'round-start',role:r.role,round:r.rounds+1});
      if(r.repl) await r.repl.cancel();
      const config={replicationIdentifier:o.config.replicationIdentifier,googleDrive:{apiEndpoint:m.url,authToken:'synthetic',oauthClientId:'synthetic',...o.config.googleDrive},pull:{batchSize:spec.pullBatchSize,...(initialCheckpoint?{initialCheckpoint}:{})},push:o.config.push,live:false,waitForLeadership:false,retryTime:o.config.retryTime};
      r.config=config;event({type:'config',role:r.role,config,collectionSchema:clone(r.db.pages.schema.jsonSchema),conflictHandler:'unchanged collection default; no custom handler supplied'});
      r.repl=await replicateGoogleDrive({collection:r.db.pages,...config});
      r.repl.error$.subscribe(error=>{errors.push({phase,error:String(error)});event({type:'native-error',error:String(error)});});
      await r.repl.awaitInitialReplication();await r.repl.awaitInSync();r.rounds++;
      event({type:'round-complete',role:r.role,round:r.rounds,checkpointDocs:clone(r.repl.internalReplicationState?.lastCheckpointDoc)});
      await snap(label,caseId==='H100'?o.cases.H100.latest:spec.expected);
    }
    async function two(r,label,cp){await sync(r,label+'-round1',cp);await sync(r,label+'-round2',cp);}
    const writer=await make('writer');
    await snap('setup-inventory',caseId==='H100'?spec.initial:spec.expected);
    if(caseId!=='H100'){
      await writer.db.pages.bulkUpsert(spec.expected);await two(writer,'writer-materialize');
      assert.deepEqual(check(remote(spec.expected),spec.expected),{expectedCount:30,actualCount:30,missingIds:[],mismatchedIds:[],unexpectedIds:[]},'independent remote full-body positive control');
      const docFiles=[...m.files.values()].filter(f=>spec.expected.some(e=>f.name===e.id+'.json'));
      assert.equal(new Set(docFiles.map(f=>f.modifiedTime)).size,1,'all 30 remote timestamps equal');
      const receiver=await make('receiver');await two(receiver,'cold-receiver');
      const comparison=check(await read(receiver),spec.expected);
      result={caseId,status:comparison.missingIds.length||comparison.mismatchedIds.length?'FAIL':'PASS',criterion:'C3',comparison,prediction:spec.prediction,positiveControl:'all 30 native materialized remote documents equal complete oracle; equal timestamp asserted',errors};
    }else{
      await writer.db.pages.bulkUpsert(spec.initial);await two(writer,'writer-baseline');
      const receiver=await make('receiver');await two(receiver,'receiver-baseline');
      assert.deepEqual((await read(receiver)).map(payload),spec.initial,'baseline receiver full docs');
      for(let i=0;i<2;i++){await writer.db.pages.upsert(spec.latest[i]);await two(writer,`writer-update${i}`);}
      const docFiles=[...m.files.values()].filter(f=>f.parents.includes(writer.repl.driveStructure.docsFolderId));
      const old=docFiles.find(f=>f.name==='visibility0.json'), newer=docFiles.find(f=>f.name==='visibility1.json');
      assert(old&&newer);assert(old.modifiedTime<newer.modifiedTime,'actual strict remote timestamp order');
      assert.deepEqual(check(remote(spec.latest),spec.latest),{expectedCount:2,actualCount:2,missingIds:[],mismatchedIds:[],unexpectedIds:[]});
      const oldFrozen={modifiedTime:old.modifiedTime,body:old.body.toString(),version:old.version};
      m.control.hiddenIds=[old.id];const start=m.requests.length;await two(receiver,'hidden-old');
      const hidden=await read(receiver),checkpoint=receiver.repl.internalReplicationState.lastCheckpointDoc.down?.checkpointData;
      assert.deepEqual(payload(hidden.find(d=>d.id==='visibility1')),spec.latest[1],'newer latest body received');
      assert.equal(hidden.find(d=>d.id==='visibility0').body,spec.initial[0].body,'older hidden body remains initial');
      const lowerBounds=m.requests.slice(start).map(r=>r.query?.q?.match(/modifiedTime >= '([^']+)'/)?.[1]).filter(Boolean);
      assert(checkpoint?.modifiedTime>old.modifiedTime,'persisted native checkpoint above old timestamp');
      assert(lowerBounds.some(t=>t>old.modifiedTime),'actual native query lower bound above old timestamp');
      m.control.hiddenIds=[];await snap('restored-before-restart',spec.latest);
      assert.deepEqual({modifiedTime:old.modifiedTime,body:old.body.toString(),version:old.version},oldFrozen,'restore only changes listing visibility');
      await two(receiver,'same-id-restart');const restartComparison=check(await read(receiver),spec.latest);
      if(!restartComparison.mismatchedIds.length&&!restartComparison.missingIds.length){result={caseId,status:'UNEXPECTED_RECOVERY_STOP',restartComparison};}
      else{
        await two(receiver,'same-id-initialCheckpoint',o.initialCheckpoint);const initialCheckpointComparison=check(await read(receiver),spec.latest);
        if(!initialCheckpointComparison.mismatchedIds.length&&!initialCheckpointComparison.missingIds.length){result={caseId,status:'UNEXPECTED_RECOVERY_STOP',restartComparison,initialCheckpointComparison};}
        else{
          const fresh=await make('fresh-diagnostic');await two(fresh,'fresh-diagnostic');const freshComparison=check(await read(fresh),spec.latest);
          assert.deepEqual(freshComparison,{expectedCount:2,actualCount:2,missingIds:[],mismatchedIds:[],unexpectedIds:[]},'genuinely separate fresh DB diagnostic must retrieve both latest full docs');
          result={caseId,status:'FAIL',criterion:'C3',restartComparison,initialCheckpointComparison,freshComparison,oldRemote:{id:old.id,modifiedTime:old.modifiedTime},newerRemote:{id:newer.id,modifiedTime:newer.modifiedTime},hiddenCheckpoint:checkpoint,hiddenLowerBounds:lowerBounds,prediction:spec.prediction,positiveControls:'latest remote restored old full body unchanged; fresh separate DB retrieves both latest bodies; no metadata removal or substitute recovery',errors};
        }
      }
    }
    if(errors.length||m.unsupported.length)result={...result,status:'INCONCLUSIVE',reason:'native errors or unsupported mock API'};
    await snap('final-before-cleanup',caseId==='H100'?spec.latest:spec.expected);
  }catch(error){result={caseId,status:'INCONCLUSIVE',phase,error:String(error),stack:error.stack,errors};event({type:'experiment-error',error:String(error),stack:error.stack});}
  finally{
    phase='cleanup';
    try{for(const r of replicas){if(r.repl)await r.repl.cancel();await r.db.close();}if(m)await m.close();event({type:'cleanup-complete',admitted,observed});}
    catch(error){result={...result,status:'INCONCLUSIVE',cleanupError:String(error)};}
    globalThis.fetch=original;
    writeFileSync(resolve(dir,'result.json'),json({...result,admitted,observed,phases:phases.map(x=>x.phase),package:{version:JSON.parse(readFileSync(resolve(rxRoot,'package.json'))).version,rxdb:req.resolve('rxdb'),drive:req.resolve('rxdb/plugins/replication-google-drive'),storage:req.resolve('rxdb/plugins/storage-dexie')},explicitSyncOnly:true}));
    if(result?.status==='INCONCLUSIVE')process.exitCode=2;
  }
}

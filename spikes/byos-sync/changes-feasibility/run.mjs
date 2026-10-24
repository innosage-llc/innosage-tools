import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,readdirSync,openSync,closeSync,renameSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,relative} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {ids} from './cases.mjs';
const here=dirname(fileURLToPath(import.meta.url)),spike=resolve(here,'..'),product=resolve(spike,'../..'),hub=resolve(product,'../..');
const require=createRequire(import.meta.url),sha=x=>createHash('sha256').update(x).digest('hex'),json=x=>JSON.stringify(x,null,2)+'\n',copy=x=>x==null?null:JSON.parse(JSON.stringify(x));
const lead=resolve(hub,'docs/sessions/20261024-tools-102-native-overlay/master-team-v4/research-changes');
const expectedOracle='e82d62f45c2aa04d9c751508168b3bb6f4c531e083bd292daa07446d6771e9b2';
function guard(origin,allowed,n){if(origin!==allowed)throw new Error('NON_LOOPBACK_FETCH_BLOCKED '+origin);if(n>=1000)throw new Error('REQUEST_CAP_BEFORE_DISPATCH');return n+1;}
const own=['run.mjs','adapter.mjs','provider.mjs','cases.mjs','oracle.json','fixture.json','binding.json','.generated/mock-extended.mjs','.generated/store.cjs','.generated/factory-binding.cjs'];
function sourceSnapshot(){const refs=JSON.parse(readFileSync(resolve(lead,'source-bindings-v1.json'))).files;
 return [...refs.map(x=>({label:x.path,path:resolve(product,x.path),expected:x.sha256})),...own.map(p=>({label:'changes-feasibility/'+p,path:resolve(here,p)})),...['design-v1.md','oracle-v2.json','revision-v2.md','ledger-v2.json','source-bindings-v1.json'].map(p=>({label:'lead/'+p,path:resolve(lead,p)}))].map(x=>{const bytes=readFileSync(x.path),hash=sha(bytes);if(x.expected)assert.equal(hash,x.expected,x.label);return {label:x.label,path:relative(spike,x.path),sha256:hash,body:bytes.toString()};});}
function latestFreeze(){const names=readdirSync(here).filter(x=>/^freeze-v\d+\.json$/.test(x)).sort();assert(names.length,'freeze first');return JSON.parse(readFileSync(resolve(here,names.at(-1))));}
async function freeze(){
 mkdirSync(resolve(here,'.generated'),{recursive:true});
 const oracle=readFileSync(resolve(lead,'oracle-v2.json'));assert.equal(sha(oracle),expectedOracle);writeFileSync(resolve(here,'oracle.json'),oracle);
 const locked=JSON.parse(readFileSync('/tmp/tools109-locked-spec.json'));assert.equal(sha(locked.body),'4b531826ab127bb41ce7a43c72b73c8f8ae3d18433ca056f50e2a152fc4e1688');
 const fixture=JSON.parse(oracle);fixture.expansion={provider:'provider.mjs scripted pages honor requested maximum; event metadata from observed native mock mutations/current bodies; exact pages archived per phase',ties:'all30 native-written tie docs get one fixture-only shared timestamp equal to original page creation time, before discovery-old/new native writes; never rewrites discovery timestamps',config:{live:false,transactionTimeout:50,retryTime:1000,pullBatchSize:10,pushBatchSize:100,replicationIdentifier:'native-overlay'},caseIds:ids,auth:'synthetic only',boundaries:'No empty-checkpoint mutation, no historical rollback guarantee, no source retention guarantee beyond fixtures'};writeFileSync(resolve(here,'fixture.json'),json(fixture));
 const base=readFileSync(resolve(spike,'src/mock.mjs'),'utf8');const old='sameTime = false,\n} = {}) {';assert.equal(base.split(old).length,2);
 let extended=base.replace(old,'sameTime = false,\n  extension = async () => false,\n} = {}) {');const anchor='    const match = u.pathname.match(';assert.equal(extended.split(anchor).length,2);
 extended=extended.replace(anchor,'    if (await extension({req,res,u,body,files,create,control,finish,entry,meta})) return;\n'+anchor);writeFileSync(resolve(here,'.generated/mock-extended.mjs'),extended);
 const wrapper=`const native=require('rxdb/plugins/replication-google-drive');\nexports.runInTransaction=native.runInTransaction;\nexports.getDocumentFiles=native.getDocumentFiles;\nexports.fetchDocumentContents=native.fetchDocumentContents;\nexports.replicateGoogleDrive=options=>globalThis.__tools109Factory(options);\n`;
 writeFileSync(resolve(here,'.generated/factory-binding.cjs'),wrapper);
 const {build}=await import('esbuild');const entry=resolve(spike,'native-overlay/page-store.mjs');const entryBefore=readFileSync(entry);
 const result=await build({entryPoints:[entry],bundle:true,platform:'node',packages:'external',format:'cjs',outfile:resolve(here,'.generated/store.cjs'),metafile:true,plugins:[{name:'tools109-explicit-factory-binding',setup(build){build.onResolve({filter:/^rxdb\/plugins\/replication-google-drive$/},args=>args.importer===entry?{path:resolve(here,'.generated/factory-binding.cjs')}:undefined);}}]});
 assert.deepEqual(readFileSync(entry),entryBefore);assert(Object.keys(result.metafile.inputs).some(p=>p.endsWith('factory-binding.cjs')),'binding applied');
 const binding={sourcePageStoreSha256:sha(entryBefore),sourceTextUnchanged:true,binding:'Only module import resolution changes replicateGoogleDrive to fixture registry; journal/save/resolve/verify methods untouched; stock mode uses original published factory',entry:'native-overlay/page-store.mjs',wrapperSha256:sha(wrapper),generatedStoreSha256:sha(readFileSync(resolve(here,'.generated/store.cjs'))),mockBaselineSha256:sha(base),mockExtendedSha256:sha(extended),mockDivergences:['optional fixture-owned extension parameter','single awaited extension route before base Drive dispatch; existing fault/WAL/CAS/server behavior unchanged'],metafile:result.metafile};
 writeFileSync(resolve(here,'binding.json'),json(binding));
 const sources=sourceSnapshot(),n=readdirSync(here).filter(x=>/^freeze-v\d+\.json$/.test(x)).length+1,version=String(n).padStart(3,'0');
 writeFileSync(resolve(here,`sources-v${version}.json.gz`),gzipSync(json(sources)));
 const frozen={version,oracleSha256:sha(oracle),fixtureSha256:sha(readFileSync(resolve(here,'fixture.json'))),sourceHashes:sources.map(({label,path,sha256})=>({label,path,sha256})),sourceArchive:`sources-v${version}.json.gz`,sourceArchiveSha256:sha(readFileSync(resolve(here,`sources-v${version}.json.gz`))),at:new Date().toISOString(),requested:'gpt-6.1-sol/high',hostRouted:'UNKNOWN',providerObserved:'UNKNOWN',usageCost:'UNKNOWN'};
 writeFileSync(resolve(here,`freeze-v${version}.json`),json(frozen));console.log(json({version,oracleSha256:frozen.oracleSha256,fixtureSha256:frozen.fixtureSha256,harnessSha256:sha(readFileSync(fileURLToPath(import.meta.url))),sourceEntries:sources.length,sourceArchiveSha256:frozen.sourceArchiveSha256}));
}
const mode=process.argv[2];
if(mode==='--freeze')await freeze();
else if(mode==='--self-check'){let n=0,dispatches=0;for(let i=0;i<1000;i++){n=guard('http://127.0.0.1:1','http://127.0.0.1:1',n);dispatches++;}assert.throws(()=>{n=guard('http://127.0.0.1:1','http://127.0.0.1:1',n);dispatches++;},/REQUEST_CAP/);assert.equal(dispatches,1000);assert.throws(()=>guard('https://example.com','http://127.0.0.1:1',0),/NON_LOOPBACK/);console.log('PASS synchronous admission rejects1001 before dispatch and nonmock origin');}
else if(mode==='--child')await child(process.argv[3],process.argv[4]);
else if(ids.includes(mode))await parent(mode,process.argv[3]??'a1');
else throw new Error('Use --freeze | --self-check | CASE [attempt-label]');

async function parent(id,attempt){
 assert(/^[a-z0-9-]+$/.test(attempt));const started=performance.now(),at=new Date().toISOString(),dir=resolve(here,'evidence',id+'-'+attempt);assert(!existsSync(dir),'Preserve original attempt; never overwrite');mkdirSync(dir,{recursive:true});
 const frozen=latestFreeze(),pre=sourceSnapshot();assert.deepEqual(pre.map(({label,path,sha256})=>({label,path,sha256})),frozen.sourceHashes,'freeze exact changed bytes before execution');writeFileSync(resolve(dir,'sources-pre.json.gz'),gzipSync(json(pre)));
 const log=resolve(here,'.generated',id+'-'+attempt+'-console.txt'),fd=openSync(log,'wx');const proc=spawn(process.execPath,[fileURLToPath(import.meta.url),'--child',id,dir],{cwd:spike,stdio:['ignore',fd,fd]});let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;proc.kill('SIGKILL');},Math.max(1,179500-(performance.now()-started)));
 const outcome=await new Promise(r=>{proc.once('error',error=>r({spawnError:String(error)}));proc.once('exit',(code,signal)=>r({code,signal}));});clearTimeout(timer);closeSync(fd);
 const post=sourceSnapshot(),unchanged=pre.every((x,i)=>x.sha256===post[i].sha256);writeFileSync(resolve(dir,'sources-post.json.gz'),gzipSync(json(post)));
 const bytes=readFileSync(log),consoleGzip=gzipSync(bytes);writeFileSync(resolve(dir,'console.txt.gz'),consoleGzip);
 const eventsPath=resolve(dir,'events.jsonl'),events=existsSync(eventsPath)?readFileSync(eventsPath):Buffer.alloc(0);writeFileSync(resolve(dir,'events.jsonl.gz'),gzipSync(events));if(existsSync(eventsPath))renameSync(eventsPath,resolve(here,'.generated',id+'-'+attempt+'-events.jsonl'));
 const rows=events.toString().trim().split('\n').filter(Boolean).map(JSON.parse),result=existsSync(resolve(dir,'result.json'))?JSON.parse(readFileSync(resolve(dir,'result.json'))):null;
 const receipt={id,attempt,command:`node changes-feasibility/run.mjs ${id} ${attempt}`,startedAt:at,elapsedMs:performance.now()-started,...outcome,timedOut,limits:{maxAdmitted:1000,maxWallMs:180000},watchdog:'parent179500ms owns direct task child SIGKILL only; no Promise.race or automatic retries',admitted:rows.filter(x=>x.type==='admit').length,dispatched:rows.filter(x=>x.type==='dispatch').length,observed:rows.filter(x=>x.type==='response').length,fetchErrors:rows.filter(x=>x.type==='fetch-error').length,sourceUnchanged:unchanged,freezeVersion:frozen.version,oracleSha256:frozen.oracleSha256,harnessSha256:sha(readFileSync(fileURLToPath(import.meta.url))),fixtureSha256:frozen.fixtureSha256,sourceHashes:post.map(({label,path,sha256})=>({label,path,sha256})),console:{path:'console.txt.gz',originalSha256:sha(bytes),gzipSha256:sha(consoleGzip),originalBytes:bytes.length},rawEventSha256:sha(events),resultSha256:result?sha(readFileSync(resolve(dir,'result.json'))):null,status:timedOut||!unchanged||outcome.code!==0||!result?'INCONCLUSIVE':result.status,baseHead:execFileSync('git',['rev-parse','HEAD'],{cwd:spike,encoding:'utf8'}).trim(),runtime:{node:process.version,rxdb:require('rxdb/package.json').version,exports:{replication:relative(spike,require.resolve('rxdb/plugins/replication')),drive:relative(spike,require.resolve('rxdb/plugins/replication-google-drive'))},requested:'gpt-6.1-sol/high',hostRouted:'UNKNOWN',providerObserved:'UNKNOWN',usageCost:'UNKNOWN'}};
 writeFileSync(resolve(dir,'receipt.json'),json(receipt));console.log(json({id,attempt,status:receipt.status,admitted:receipt.admitted,dispatched:receipt.dispatched,observed:receipt.observed,fetchErrors:receipt.fetchErrors,elapsedMs:receipt.elapsedMs,outcome,result}));if(receipt.status==='INCONCLUSIVE')process.exitCode=2;
}

async function child(id,dir){
 await import('fake-indexeddb/auto');const {provider}=await import('./provider.mjs'),{createChangesReplication}=await import('./adapter.mjs'),{execute}=await import('./cases.mjs'),{mock}=await import('./.generated/mock-extended.mjs');
 const {replicateGoogleDrive}=require('rxdb/plugins/replication-google-drive'),{getRxStorageDexie}=require('rxdb/plugins/storage-dexie'),{prepareQuery,normalizeMangoQuery}=require('rxdb');
 const {openPageStore}=require('./.generated/store.cjs');const fixture=JSON.parse(readFileSync(resolve(here,'fixture.json')));
 let phase='setup',admitted=0,dispatched=0,observed=0,m,result;const original=globalThis.fetch,stores=[],events=[],modes=new Map(),batch=new Map(),latest=new Map();let snapshotIndex=0;
 const event=x=>{const row={at:new Date().toISOString(),phase,...x};events.push(row);appendFileSync(resolve(dir,'events.jsonl'),JSON.stringify(row)+'\n');};
 const fatal=error=>{event({type:'hard-stop',error:String(error),admitted,dispatched,observed});writeFileSync(resolve(dir,'result.json'),json({id,status:'INCONCLUSIVE',phase,error:String(error),admitted,dispatched,observed}));process.exit(2);};
 const p=provider({event}),suffix=randomUUID().replaceAll('-',''),config=fixture.expansion.config;
 const w={fixture,event,events,provider:p,batch,m:null,blockNetwork:null,afterResponse:null,afterFetchError:null,
  async open(role){const s=await openPageStore({workspace:role+suffix,session:role,multiInstance:false,hook:async(boundary,row)=>event({type:'page-store-hook',role,boundary,row})});s.workspace='remote'+suffix;s.role=role;stores.push(s);modes.set(s.db.name,'stock');return s;},
  async connect(s){await s.connect(m.url,{live:false,transactionTimeout:config.transactionTimeout,retryTime:config.retryTime});},
  file(name){return [...m.files.values()].find(f=>f.name===name+'.json'&&f.parents.includes((latest.get(stores[0]?.db.name))?.driveStructure.docsFolderId));},
  forceTieTime(){const stamp=w.file('page').createdTime;for(const f of m.files.values())if(/^tie\d{3}\.json$/.test(f.name))f.modifiedTime=stamp;event({type:'fixture-shared-tie-time',stamp,ids:[...m.files.values()].filter(f=>/^tie\d{3}\.json$/.test(f.name)).map(f=>f.id)});},
  async transition(s){phase='transition-'+s.role;const old=latest.get(s.db.name);await w.snapshot('before-old-owner-cancel');await s.disconnect();event({type:'old-owner-canceled',role:s.role,isStopped:old.isStopped()});assert(old.isStopped());modes.set(s.db.name,'changes');await w.connect(s);await w.snapshot('after-adapter-start');},
  async restart(s){phase='restart-'+s.role;await s.disconnect();await w.connect(s);event({type:'same-identity-restart',role:s.role});},
  async identity(s){const r=latest.get(s.db.name),meta=await r.metaInfoPromise;return {databaseName:s.db.name,collectionName:s.db.pages.name,replicationIdentifier:r.replicationIdentifier,deletedField:r.deletedField,metaCollection:meta.collectionName,metaSchema:meta.schema,logicalIdentifier:r.internalReplicationState?.input.identifier};},
  async metadata(s){const r=latest.get(s.db.name);if(!r)return [];const info=await r.metaInfoPromise;const instance=await getRxStorageDexie().createStorageInstance({databaseInstanceToken:s.db.token,databaseName:s.db.name,collectionName:info.collectionName,schema:info.schema,multiInstance:false,options:s.db.instanceCreationOptions??{},password:s.db.password,devMode:false});try{return (await instance.query(prepareQuery(info.schema,normalizeMangoQuery(info.schema,{selector:{}})))).documents;}finally{await instance.close();}},
  async checkpoint(s){return (await w.metadata(s)).find(d=>d.id==='down|1')?.checkpointData??null;},
  async snapshot(label){phase=label;p.refresh();const inventory=[...m.files.values()].map(f=>{let parsed;try{parsed=JSON.parse(f.body.toString());}catch{parsed=null;}return {id:f.id,name:f.name,mimeType:f.mimeType,parents:f.parents,createdTime:f.createdTime,modifiedTime:f.modifiedTime,version:f.version,visible:!m.control.hiddenIds.includes(f.id),rawBody:f.body.toString(),parsedDocument:parsed};});
   const captures=[];for(const s of stores){const r=latest.get(s.db.name);captures.push({role:s.role,name:s.db.name,mode:modes.get(s.db.name),identity:r?await w.identity(s):null,checkpoint:r?await w.checkpoint(s):null,metadata:r?await w.metadata(s):[],pageSchema:s.db.pages.schema.jsonSchema,defaultConflictHandler:s.db.pages.conflictHandler.resolve.toString(),pages:(await s.db.pages.find().exec()).map(d=>d.toJSON()),physicalPages:await s.db.pages.storageInstance.findDocumentsById(inventory.filter(f=>f.parsedDocument?.id).map(f=>f.parsedDocument.id),true),journals:(await s.db.localDrafts.find().exec()).map(d=>d.toJSON()),views:await Promise.all((await s.db.localDrafts.find().exec()).map(d=>s.view(d.page))),state:s.state,driveStructure:copy(r?.driveStructure)});}
   const snap={phase:label,inventory,feed:p.snapshot(),stores:captures,nativeRequests:copy(m.requests),faults:copy(m.faults),unsupported:copy(m.unsupported),admitted,dispatched,observed};const name=`phase-${String(++snapshotIndex).padStart(2,'0')}.json.gz`;writeFileSync(resolve(dir,name),gzipSync(json(snap)));event({type:'snapshot',label,path:name});return snap;}
 };
 try{
  m=await mock({extension:p.route});w.m=m;p.attach(m);
  globalThis.fetch=(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);try{admitted=guard(url.origin,m.url,admitted);}catch(error){fatal(error);}const n=admitted,requestPhase=phase;
   event({type:'admit',n,url:String(url),method:init?.method??'GET',query:Object.fromEntries(url.searchParams),requestBody:init?.body?String(init.body):null});
   return (async()=>{if(w.blockNetwork)await w.blockNetwork;dispatched++;event({type:'dispatch',n,url:String(url)});try{const res=await original(input,init),body=await res.clone().text();observed++;p.refresh();const capture={type:'response',n,requestPhase,url:String(url),status:res.status,headers:Object.fromEntries(res.headers),body};event(capture);if(w.afterResponse)await w.afterResponse(capture);return res;}catch(error){p.refresh();event({type:'fetch-error',n,url:String(url),error:String(error)});if(w.afterFetchError)await w.afterFetchError(error);throw error;}})();};
  globalThis.__tools109Factory=async options=>{
   const name=options.collection.database.name,role=stores.find(s=>s.db.name===name)?.role;
   event({type:'factory-config',role,mode:modes.get(name),config:{replicationIdentifier:options.replicationIdentifier,googleDrive:options.googleDrive,pull:options.pull,push:options.push,live:options.live,waitForLeadership:options.waitForLeadership,retryTime:options.retryTime},journalSourceSha256:sha(readFileSync(resolve(spike,'native-overlay/page-store.mjs')))});
   if(modes.get(name)==='changes')return createChangesReplication(options,{batchSize:batch.get(name)??10,event:x=>event({role,...x}),onCreated:r=>{latest.set(name,r);}});
   const r=await replicateGoogleDrive(options);latest.set(name,r);r.error$.subscribe(error=>event({type:'native-stock-error',role,error:String(error),parameters:error.parameters??null}));return r;
  };
  result=await execute(w,id);await w.snapshot('final-before-cleanup');
 }catch(error){result={status:'INCONCLUSIVE',phase,error:String(error),stack:String(error.stack).replaceAll(spike,'<byos>'),classification:error instanceof assert.AssertionError?'fixture/assertion failure; requires causal review, never PASS':'setup/API/capture failure'};event({type:'case-error',error:result.error,stack:result.stack});try{if(m)await w.snapshot('failure-preserved');}catch(captureError){event({type:'capture-error',error:String(captureError)});}}
 finally{phase='cleanup';try{w.blockNetwork=null;for(const s of stores)if(!s.closed)await s.close();if(m)await m.close();event({type:'cleanup-complete'});}catch(error){result={...result,status:'INCONCLUSIVE',cleanupError:String(error)};}globalThis.fetch=original;delete globalThis.__tools109Factory;
  writeFileSync(resolve(dir,'result.json'),json({id,...result,admitted,dispatched,observed,snapshots:snapshotIndex,explicitSyncOnly:true,changedAdapterHypothesis:true,sourceAssumptions:fixture.source_assumptions}));if(result?.status==='INCONCLUSIVE')process.exitCode=2;}
}

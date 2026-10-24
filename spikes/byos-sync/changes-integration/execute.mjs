import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {admit} from './run.mjs';
import {mock} from './.generated/mock.mjs';
import {provider} from '../changes-feasibility/provider.mjs';
import {bodies as T} from '../native-overlay/fixtures.mjs';
const id=process.argv[2],dir=process.argv[3],json=x=>(JSON.stringify(x,null,2)+'\n').replaceAll(process.cwd(),'<byos>');
let phase='setup',admitted=0,requests=0,uiRequests=0,snapshotNo=0,result,m,browser,server;
const event=x=>appendFileSync(resolve(dir,'events.jsonl'),(JSON.stringify({at:new Date().toISOString(),phase,...x})+'\n').replaceAll(process.cwd(),'<byos>'));
const p=provider({event}),stores=[],contexts=[],allowed=[];const originalFetch=globalThis.fetch;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label,ms=15000)=>{const start=performance.now();while(performance.now()-start<ms){if(await fn())return;await sleep(25);}throw new Error('WAIT_TIMEOUT '+label);};
const persist=(name,data)=>{const path=`phase-${String(++snapshotNo).padStart(2,'0')}.json.gz`;writeFileSync(resolve(dir,path),gzipSync(json(data)));event({type:'snapshot',name,path});return data;};
const inventory=()=>[...m.files.values()].map(f=>({...f,body:f.body.toString()}));
const scope='i'+randomUUID().replaceAll('-','');
let responseHook=null,networkHold=null;const holds=[];
const hold=()=>new Promise(resolve=>holds.push(resolve));
try{
 m=await mock({extension:async ctx=>{
  if(p.incomplete&&ctx.req.method==='GET'&&ctx.u.pathname==='/drive/v3/files'&&ctx.u.searchParams.get('orderBy')==='name'){
   assert(ctx.u.searchParams.get('fields').includes('incompleteSearch'));
   ctx.finish(200,{files:[],incompleteSearch:true});event({type:'explicit-incomplete-response',query:Object.fromEntries(ctx.u.searchParams)});return true;
  }
  return p.route(ctx);
 }});p.attach(m);allowed.push(m.url);
 globalThis.fetch=(input,init)=>{
  const url=String(typeof input==='string'||input instanceof URL?input:input.url);admitted=admit(url,allowed,admitted);
  const n=admitted;event({type:'admit',n,url,method:init?.method??'GET',body:init?.body?String(init.body):null});
  return (async()=>{if(networkHold)await networkHold;event({type:'dispatch',n,url});try{const response=await originalFetch(input,init);const body=await response.clone().text();requests++;p.refresh();const row={type:'response',n,url,status:response.status,body};event(row);if(responseHook)await responseHook(row);return response;}catch(error){event({type:'fetch-error',n,url,error:String(error)});throw error;}})();
 };
 if(id==='I1'||id==='I2'){
  await import('fake-indexeddb/auto');const require=createRequire(import.meta.url),{openPageStore,inspect}=require('./.generated/runtime.cjs');
  globalThis.__integration={events:[],latest:new Map(),mode:'changes'};
  const s=await openPageStore({workspace:scope,session:'a',multiInstance:false,hook:async(boundary,row)=>event({type:'hook',boundary,row})});stores.push(s);
  const snap=async name=>{phase=name;return persist(name,{name,receiver:await inspect(s),inventory:inventory(),requests:m.requests,faults:m.faults,provider:p.snapshot()});};
  const connect=()=>s.connect(m.url,{live:false,transactionTimeout:50,retryTime:1000});
  const latest=()=>globalThis.__integration.latest.get(s.db.name);
  const file=name=>[...m.files.values()].find(f=>f.name===name+'.json'&&f.parents.includes(latest().driveStructure.docsFolderId));
  const update=(name,body,editId)=>{const f=file(name);assert(f);p.update(f.id,{...JSON.parse(f.body.toString()),body,editId});};
  const seed=(name,body,editId)=>{const f=m.create({name:name+'.json',parents:[latest().driveStructure.docsFolderId],mimeType:'application/json'},Buffer.from(JSON.stringify({id:name,body,editId,_deleted:false})));p.refresh();return f;};
  if(id==='I1'){
   // Existing stock factory supplies a real pre-transition checkpoint, never a reset.
   globalThis.__integration.mode='stock';await s.save('page',T.A);await connect();await s.verify('page');
   const before=await snap('stock-baseline');await s.disconnect();globalThis.__integration.mode='changes';
   seed('required','# Required full body\n\nR — retained across fault.','required-r');p.incomplete=true;
   let release;networkHold=null;
   responseHook=async row=>{if(row.body.includes('"incompleteSearch":true')){networkHold=hold();release=holds.at(-1);}};
   const task=connect();await until(()=>globalThis.__integration.events.some(e=>e.type==='native-adapter-error'&&e.error.includes('INCOMPLETE_INVENTORY_SEARCH')),'incomplete native error');
   const fault=await snap('explicit-incomplete-blocked');assert.deepEqual(fault.receiver.checkpoint,before.receiver.checkpoint);assert.equal(await s.page('required'),null);assert.equal(fault.receiver.state,'blocked');assert.notEqual((await s.view('page')).status,'remote-verified');
   p.incomplete=false;responseHook=null;networkHold=null;release();await task;await s.sync();
   assert.equal((await s.page('required')).editId,'required-r');const recovered=await snap('same-receiver-incomplete-cleared');assert.deepEqual(recovered.receiver.identity,before.receiver.identity);
   update('required','# Required full body\n\nR2 — read failure then replay.','required-r2');const checkpoint=structuredClone(recovered.receiver.checkpoint);
   // Native body fetch retries four transient 503s internally. Let those reads
   // finish, then hold the next native replication retry after the fifth failure.
   let releaseRead,readFailures=0;for(let i=0;i<5;i++)m.faults.push({method:'GET',fileId:file('required').id,path:'/drive/v3/files/',status:503});
   responseHook=async row=>{if(row.status===503&&++readFailures===5){networkHold=hold();releaseRead=holds.at(-1);}};
   const readTask=s.sync();readTask.catch(()=>{});await until(()=>m.faults.some(f=>f.used),'body failure');await until(()=>s.state==='blocked','blocked status');
   const readFault=await snap('required-body-read-blocked');assert.deepEqual(readFault.receiver.checkpoint,checkpoint);assert.equal((await s.page('required')).editId,'required-r');assert.notEqual((await s.view('required')).status,'remote-verified');
   responseHook=null;networkHold=null;releaseRead();await readTask;await s.sync();assert.equal((await s.page('required')).editId,'required-r2');const after=await snap('same-receiver-body-retry');assert.deepEqual(after.receiver.identity,before.receiver.identity);
   result={status:'PASS',scope:'Original parent-folder inventory in spaces=drive; no corpora/driveId override; incomplete result handling is injected response behavior, not provider occurrence proof',beforeCheckpoint:before.receiver.checkpoint,incompleteCheckpoint:fault.receiver.checkpoint,readCheckpoint:readFault.receiver.checkpoint,afterCheckpoint:after.receiver.checkpoint,identity:after.receiver.identity};
  }else{
   for(const page of ['page','local','merge'])await s.save(page,T.A);await connect();for(const page of ['page','local','merge'])await s.verify(page);
   await s.disconnect();for(const page of ['page','local','merge'])await s.save(page,T.B);
   for(const page of ['page','local','merge'])update(page,T.C,'cloud-C-'+page);await connect();await s.sync();
   for(const page of ['page','local','merge']){const v=await s.view(page);assert.equal(v.body,T.B);assert.equal(v.page.body,T.C);assert.equal(v.journal.sourceLocal.body,T.B);assert.equal(v.journal.sourceCloud.body,T.C);}
   await s.save('page',T.D);update('page',T.E,'cloud-E');seed('other','# Unrelated\n\nO — independent remote progress.','other-O');const before=await snap('before-explicit-progress');
   await s.sync();const v=await s.view('page');assert.equal(v.body,T.D);assert.equal(v.page.body,T.E);assert.equal(v.journal.sourceLocal.body,T.B);assert.equal(v.journal.sourceCloud.body,T.C);assert.equal((await s.page('other')).editId,'other-O');assert.equal(JSON.parse(file('page').body).editId,'cloud-E');await snap('D-E-unrelated-protected');
   await s.resolve('page','cloud');assert.equal(await s.draft('page'),null);assert(await s.draft('local'));assert(await s.draft('merge'));assert.equal((await s.view('page')).body,T.E);await snap('cloud-owned-discard');
   for(const [page,action,body] of [['local','local',T.B],['merge','merge',T.M]]){
    await s.resolve(page,action,body);const pending=await s.draft(page);assert.equal(pending.draft.body,body);assert.equal(pending.sourceLocal.body,T.B);assert.equal(pending.sourceCloud.body,T.C);assert.notEqual((await s.view(page)).status,'remote-verified');await snap(action+'-before-verification');
    await s.verify(page);assert.equal(await s.draft(page),null);assert.equal((await s.view(page)).status,'remote-verified');assert.equal((await s.remote(page)).body,body);await snap(action+'-independently-verified');
   }
   const after=await snap('explicit-choices-final');assert.deepEqual(after.receiver.identity,before.receiver.identity);
   result={status:'PASS',identity:after.receiver.identity,configuration:{live:false,multiInstance:false,transactionTimeout:50,retryTime:1000},choices:['cloud-owned-discard','local-independent-verification','merge-independent-verification'],reusedFaultControls:'S5_LOST_RESPONSE_INTENT-a3 unchanged source paths: lost response, newer generation, E race, owned cloud discard. No historical label promoted to new run.'};
  }
 }else{
  const {executeBrowser}=await import('./browser-cases.mjs');
  result=await executeBrowser({id,dir,m,p,T,scope,allowed,contexts,event,persist,inventory,until,admitRequest:(url,reserve)=>{admitted=admit(url,allowed,admitted,reserve);event({type:'browser-admit',url,reserve,reservedTotal:admitted});},onBrowser:b=>browser=b,onServer:s=>server=s,onUIRequest:()=>uiRequests++});
 }
}catch(error){result={status:'INCONCLUSIVE',phase,error:String(error),stack:error.stack,classification:error instanceof assert.AssertionError?'Assertion failure: preserve and diagnose; never PASS':'Setup/runtime/capture failure'};event({type:'case-error',...result});}
finally{
 phase='final';try{if(m)persist('final-raw',{inventory:inventory(),requests:m.requests,faults:m.faults,provider:p.snapshot()});}catch(error){event({type:'final-capture-error',error:String(error)});}
 phase='task-resource-close';responseHook=null;p.incomplete=false;networkHold=null;for(const release of holds)release();event({type:'teardown-artificial-holds-released',count:holds.length,resultStatus:result?.status});
 try{for(const s of stores)await s.close();for(const c of contexts)await c.close();if(browser)await browser.close();if(server)await server.close();if(m)await m.close();}catch(error){result={...result,status:'INCONCLUSIVE',closeError:String(error)};}
 globalThis.fetch=originalFetch;
 const actualRequests=(m?.requests.length??0)+uiRequests;
 if(actualRequests>1000)result={...result,status:'INCONCLUSIVE',error:'ACTUAL_REQUEST_CAP_EXCEEDED'};
 const output={id,...result,admittedOrReserved:admitted,actualRequests,mockRequests:m?.requests.length??0,uiRequests,nodeResponses:requests,snapshots:snapshotNo,explicitSyncOnly:true,noStorageReset:true};writeFileSync(resolve(dir,'result.json'),json(output));console.log(json(output));if(output.status!=='PASS')process.exitCode=2;
}

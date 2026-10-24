import 'fake-indexeddb/auto';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {mock} from '../src/mock.mjs';
await build({entryPoints:['native-overlay/page-store.mjs'],bundle:true,platform:'node',
 packages:'external',format:'cjs',outfile:'native-overlay/.generated/fault-store.cjs'});
const {openPageStore}=createRequire(import.meta.url)('./.generated/fault-store.cjs');
const original=globalThis.fetch;let origin;
globalThis.fetch=(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input.url);
 if(url.origin!==origin)throw new Error('NON_LOOPBACK_FETCH_BLOCKED');
 return original(input,{...init,signal:AbortSignal.timeout(500)});
};
const evidence=[];
try{
 for(const fault of ['offline',401,403,429,500,'timeout','duplicate-response','delayed-response','unknown-success']){
  const m=await mock();origin=m.url;
  const suffix=crypto.randomUUID().replaceAll('-','');
  const s=await openPageStore({workspace:'fault'+suffix,session:'a',multiInstance:false});
  const cfg={live:false,transactionTimeout:50,retryTime:100};
  const body=`# Protected ${fault}\n\nFull acknowledged intent survives transport faults.`;
  const row={id:'F10',fault,label:'MOCK-TESTED',fetch_timeout_ms:500,retryTime_ms:100,status:'NOT_RUN'};
  try{
   await s.save('page','# Baseline');await s.connect(m.url,cfg);await s.verify('page');
   await s.save('page',body);
   const start=m.requests.length;
   if(typeof fault==='number'||fault==='offline'){
    m.control.status=fault==='offline'?503:fault;
    await assert.rejects(()=>s.remote('page'));
    const view=await s.view('page');assert.equal(view.body,body);assert.ok(view.journal);
    assert.equal(view.status,fault===401?'reauth-required':'blocked');
    // Persistent access failures do not trigger an application retry loop.
    const calls=m.requests.length-start;assert.ok(calls<=2);
    row.blocked=view;row.calls_during_failure=calls;m.control.status=null;
   }else{
    m.faults.push({method:'PUT',fileName:'rxdb-wal.json',bodyContains:`# Protected ${fault}`,kind:fault});
   }
   await s.verify('page');
   const after=await s.view('page');assert.equal(after.body,body);
   if(fault==='duplicate-response'&&after.journal){
    assert.equal(after.journal.draft.body,body);assert.notEqual(after.status,'remote-verified');
    row.native_stale_success='Native metadata may acknowledge stale cached WAL success; protected draft retained for explicit resolution';
   }else{assert.equal(after.status,'remote-verified');assert.equal(after.journal,null);}
   if(typeof fault==='string'&&fault!=='offline')assert.ok(m.faults[0].used);
   row.status='PASS';row.after=after;
  }catch(error){row.status='FAIL';row.error=String(error);process.exitCode=1;}
  finally{m.control.status=null;row.requests=m.requests;row.faults=m.faults;
   await s.close();await m.close();}
  evidence.push(row);console.log(fault,row.status,row.error??'');
 }
 {
  const m=await mock();origin=m.url;
  const s=await openPageStore({workspace:'offline'+crypto.randomUUID().replaceAll('-',''),session:'a',multiInstance:false});
  const row={id:'F10',fault:'persistent-native-sync-followed-by-local-save',status:'NOT_RUN'};
  try{
   await s.save('page','# Verified baseline');
   await s.connect(m.url,{live:true,transactionTimeout:50,retryTime:100});await s.verify('page');
   m.control.offline=true;let settled=false;
   const sync=s.sync().finally(()=>{settled=true;});sync.catch(()=>{});
   const start=Date.now();while(!m.requests.some(r=>r.status===503)&&Date.now()-start<2000)
    await new Promise(r=>setTimeout(r,10));
   assert.ok(m.requests.some(r=>r.status===503));assert.equal(settled,false);
   const body='# Local editing continues\n\nSaved despite persistent native retry.';
   let timer;
   const view=await Promise.race([s.save('page',body),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('Network wait blocked local journal')),2000);
   })]).finally(()=>clearTimeout(timer));
   assert.equal(view.body,body);assert.equal((await s.draft('page')).draft.body,body);
   assert.notEqual(view.status,'remote-verified');row.durableDuringRetry=view;
   m.control.offline=false;await sync;await s.verify('page');row.status='PASS';
  }catch(error){row.status='FAIL';row.error=String(error);process.exitCode=1;}
  finally{m.control.offline=false;row.requests=m.requests;await s.close();await m.close();}
  evidence.push(row);console.log(row.fault,row.status,row.error??'');
 }
 await writeFile('native-overlay/.generated/fault-results.json',JSON.stringify({id:'F10',
  coverage:'native WAL transport one-shot faults + persistent verification access failures; loopback fetch deadline harness',
  evidence},null,2)+'\n');
}finally{globalThis.fetch=original;}

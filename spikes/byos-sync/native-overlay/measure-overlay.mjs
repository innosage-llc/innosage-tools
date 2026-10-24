import 'fake-indexeddb/auto';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {mock} from '../src/mock.mjs';
import assert from 'node:assert/strict';
await build({entryPoints:['native-overlay/page-store.mjs'],bundle:true,platform:'node',
 packages:'external',format:'cjs',outfile:'native-overlay/.generated/measure-store.cjs'});
const {openPageStore}=createRequire(import.meta.url)('./.generated/measure-store.cjs');
const original=globalThis.fetch;let origin;
globalThis.fetch=(input,init)=>{if(new URL(typeof input==='string'?input:input.url).origin!==origin)
 throw new Error('NON_LOOPBACK_FETCH_BLOCKED');return original(input,init);};
const evidence=[];
try{
 for(const scale of [10,1000])for(let seed=1;seed<=3;seed++){
  const m=await mock({seed});origin=m.url;const suffix=crypto.randomUUID().replaceAll('-','');
  const a=await openPageStore({workspace:'ma'+suffix,session:'a',multiInstance:false}),
   b=await openPageStore({workspace:'mb'+suffix,session:'b',multiInstance:false});
  b.workspace=a.workspace;
  try{
   const pages=Array.from({length:scale},(_,i)=>({id:'page'+String(i).padStart(5,'0'),
    body:`# Initial ${i}\n\nSynthetic scale ${scale}`,editId:`initial-${i}`}));
   const init=performance.now();await a.db.pages.bulkInsert(pages);
   const config={live:false,transactionTimeout:50,retryTime:1000};
   await a.connect(m.url,config);await a.sync();await b.connect(m.url,config);await b.sync();
   assert.equal((await b.db.pages.find().exec()).length,scale);
   const initialization_ms=performance.now()-init,start=m.requests.length;
   const id=pages.at(-1).id,body=`# Foreground ${scale}\n\nUnique overlay edit ${seed}.`;
   const savedAt=performance.now();await a.save(id,body);const local_ack_ms=performance.now()-savedAt;
   const projectedAt=performance.now();assert.equal((await a.view(id)).body,body);
   const foreground_projection_ms=performance.now()-projectedAt;
   const pendingAt=performance.now();await a.verify(id);const remote_verification_ms=performance.now()-pendingAt;
   await b.sync();assert.equal((await b.page(id)).body,body);
   const settle_ms=performance.now()-savedAt,requests=m.requests.slice(start);
   evidence.push({id:'F17',scale,seed,status:'PASS',initialization_ms,local_ack_ms,
    foreground_projection_ms,remote_verification_ms,pending_ms:remote_verification_ms,settle_ms,
    foreground_priority:'Exact page local projection before cloud settle; stock native network checkpoint order unchanged',
    config,calls:requests.length,methods:Object.fromEntries([...new Set(requests.map(r=>r.method))].map(method=>
     [method,requests.filter(r=>r.method===method).length])),bytes_up:requests.reduce((n,r)=>n+r.bytes_up,0),
    bytes_down:requests.reduce((n,r)=>n+r.bytes_down,0),requests});
   console.log(scale,seed,settle_ms.toFixed(1),requests.length);
  }finally{await a.close();await b.close();await m.close();}
 }
 const distributions=[10,1000].map(scale=>{
  const samples=evidence.filter(r=>r.scale===scale),settle=samples.map(r=>r.settle_ms).sort((a,b)=>a-b);
  return {scale,n:samples.length,p50_settle_ms:settle[Math.ceil(settle.length*.5)-1],
   p95_settle_ms:settle[Math.ceil(settle.length*.95)-1]};
 });
 await writeFile('native-overlay/.generated/overlay-measurements.json',JSON.stringify({label:'MOCK-TESTED; REAL-PROVIDER-NOT-RUN',
  method:'Synthetic loopback, manual native cycles; n=3 per scale; no cloud performance inference',distributions,evidence},null,2)+'\n');
}finally{globalThis.fetch=original;}

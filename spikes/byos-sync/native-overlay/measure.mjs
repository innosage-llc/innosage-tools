import 'fake-indexeddb/auto';
import {rxReplica} from '../src/candidates.mjs';
import {mock} from '../src/mock.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const results=[];
const original=globalThis.fetch;
let allowed;
globalThis.fetch=(input,init)=>{
 const u=new URL(typeof input==='string'?input:input.url);
 if(u.origin!==allowed) throw new Error('NON_LOOPBACK_FETCH_BLOCKED');
 return original(input,init);
};
try {
 for(const scale of [10,1000])for(let seed=1;seed<=3;seed++){
  const m=await mock({seed}),suffix=crypto.randomUUID().replaceAll('-','');allowed=m.url;
  const a=await rxReplica('ma'+suffix,m),b=await rxReplica('mb'+suffix,m);
  try{
   const pages=Array.from({length:scale},(_,i)=>({id:'page'+String(i).padStart(5,'0'),
    parentId:null,body:`# Fixture ${i}\n\nFull fixture body for scale ${scale}.`,editIds:[`initial-${i}`]}));
   const t=performance.now();await a.putAll(pages);await a.sync();await a.sync();
   await b.sync();await b.sync();
   assert.equal((await b.read()).length,scale);
   const initialization_ms=performance.now()-t,start=m.requests.length;
   const change={...pages.at(-1),body:`# Foreground ${scale}\n\nUnique one-page edit ${seed}.`,editIds:[`change-${seed}`]};
   const changeStart=performance.now();await a.put(change);await a.sync();await a.sync();
   await b.sync();await b.sync();const change_ms=performance.now()-changeStart;
   assert.equal((await b.read()).find(p=>p.id===change.id).body,change.body);
   const requests=m.requests.slice(start);
   results.push({id:'F17',scale,seed,status:'PASS',mode:'published stock RxDB; live:false baseline harness',
    foreground_priority:'NOT IMPLEMENTED: native checkpoint scan order',initialization_ms,change_ms,
    calls:requests.length,methods:Object.fromEntries([...new Set(requests.map(r=>r.method))].map(method=>
     [method,requests.filter(r=>r.method===method).length])),
    bytes_up:requests.reduce((n,r)=>n+r.bytes_up,0),bytes_down:requests.reduce((n,r)=>n+r.bytes_down,0),requests});
   console.log(scale,seed,change_ms.toFixed(1),requests.length);
  }finally{await a.close();await b.close();await m.close();}
 }
 const distribution=[10,1000].map(scale=>{
  const data=results.filter(r=>r.scale===scale).map(r=>r.change_ms).sort((a,b)=>a-b);
  return {scale,n:data.length,p50_ms:data[Math.ceil(data.length*.5)-1],p95_ms:data[Math.ceil(data.length*.95)-1]};
 });
 await mkdir('native-overlay/.generated',{recursive:true});
 await writeFile('native-overlay/.generated/measurements.json',JSON.stringify({
  label:'MOCK-TESTED; REAL-PROVIDER-NOT-RUN',status:'PARTIAL — native baseline only; overlay/live/foreground priority outstanding',
  distributions:distribution,results},null,2)+'\n');
}finally{globalThis.fetch=original;}

import test from 'node:test';
import assert from 'node:assert/strict';
const original=globalThis.fetch;
async function setup(){const t=await import('./transport.mjs?prepared='+crypto.randomUUID());t.authorize('synthetic',60);t.beginExperiment({maxRequests:10,maxMs:10000,policy:'prepared-retry-v1'});t.begin();return t;}
test('prepared transient failure is one attempt and permits coordinator-managed retry',async()=>{
 const t=await setup();let calls=0;globalThis.fetch=async()=>new Response('',{status:++calls===1?503:200});
 try{assert.equal((await t.preparedRequestOnce(t.API+'/drive/v2/files/f1')).status,503);assert.equal(calls,1);assert.equal(t.experimentEvidence().halted,null);await t.preparedRequestOnce(t.API+'/drive/v2/files/f1');assert.equal(calls,2);assert.equal(t.experimentEvidence().requests,2);}finally{globalThis.fetch=original;}
});
test('physical generation guard refusal produces no RPC count or dispatch receipt',async()=>{
 const t=await setup();let calls=0,receipts=0;globalThis.fetch=async()=>{calls++;return new Response('');};
 try{await assert.rejects(t.preparedRequestOnce(t.API+'/drive/v2/files/f1',{preparedGuard(){throw Error('SUPERSEDED');},preparedOnDispatched(){receipts++;}}),/SUPERSEDED/);assert.equal(calls,0);assert.equal(receipts,0);assert.equal(t.experimentEvidence().requests,0);}finally{globalThis.fetch=original;}
});
test('prepared request forbids other origins, creation and unconditional writes',async()=>{
 const t=await setup();let calls=0;globalThis.fetch=async()=>{calls++;return new Response('');};
 try{await assert.rejects(t.preparedRequestOnce('https://other.invalid/drive/v2/files/f1'),/EXISTING_FILES_ONLY/);await assert.rejects(t.preparedRequestOnce(t.API+'/drive/v3/files',{method:'POST'}),/EXISTING_FILES_ONLY/);await assert.rejects(t.preparedRequestOnce(t.API+'/upload/drive/v2/files/f1?uploadType=media',{method:'PUT',body:'{}'}),/CAS_REQUIRED/);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
test('actual page request records bound page/version and strips internal hooks before fetch',async()=>{
 const t=await setup();let received;globalThis.fetch=async(_url,init)=>{received=init;return Response.json({id:'f1'});};
 const body=JSON.stringify({id:'w142_A',body:'synthetic',editId:'A-1',_deleted:false});
 const bodyHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const trace={role:'page',phase:'formal',page:'w142_A',editId:'A-1',generation:1,bodyHash};let calls=0;
 try{await t.preparedRequestOnce(t.API+'/upload/drive/v2/files/f1?uploadType=media',{method:'PUT',headers:{'If-Match':'"v0"'},body,preparedTrace:trace,preparedOnDispatched(){calls++;}});assert.equal(calls,1);assert.equal(received.preparedTrace,undefined);assert.equal(received.preparedGuard,undefined);const row=t.experimentEvidence().rows[0];assert.equal(row.page,'w142_A');assert.equal(row.generation,1);assert.equal(row.status,200);assert(!JSON.stringify(row).includes('synthetic'));}finally{globalThis.fetch=original;}
});
test('post-dispatch observer failure still settles and accounts for the physical request',async()=>{
 const t=await setup();let release;globalThis.fetch=()=>new Promise(r=>{release=()=>r(new Response('body'));});
 try{const request=t.preparedRequestOnce(t.API+'/drive/v2/files/f1',{preparedOnDispatched(){throw Error('observer');}});assert.equal(t.experimentEvidence().active,1);release();await assert.rejects(request,/observer/);assert.equal(t.experimentEvidence().active,0);assert.equal(t.experimentEvidence().requests,1);assert.equal(t.experimentEvidence().bytesDown,4);}finally{globalThis.fetch=original;}
});

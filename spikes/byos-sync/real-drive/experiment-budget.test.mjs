import test from 'node:test';
import assert from 'node:assert/strict';
const originalFetch=globalThis.fetch;
async function fresh(){return import('./transport.mjs?experiment-test='+crypto.randomUUID());}
test('experimental cumulative budget survives operation begin and cannot rearm',async()=>{
 const t=await fresh();let requests=0;globalThis.fetch=async()=>{requests++;return new Response('body');};
 try{t.authorize('synthetic',60);t.beginExperiment({maxRequests:2,maxMs:10000});t.begin();await t.driveFetch(t.API+'/fixture',{method:'POST',body:'abc'});t.begin();await t.driveFetch(t.API+'/fixture');t.begin();await assert.rejects(t.driveFetch(t.API+'/fixture'),/EXPERIMENT_BUDGET/);assert.equal(requests,2);assert.throws(()=>t.beginExperiment({maxRequests:2,maxMs:10000}),/ALREADY/);assert.equal(t.experimentHealthy(),false);assert.equal(t.experimentEvidence().bytesUp,3);assert.equal(t.experimentEvidence().bytesDown,8);assert.ok(!JSON.stringify(t.experimentEvidence()).includes('synthetic'));}finally{globalThis.fetch=originalFetch;}
});
test('ambiguous failure latches transport before native retry; begin cannot clear it',async()=>{
 const t=await fresh();let requests=0;globalThis.fetch=async()=>{requests++;throw Error('lost response');};
 try{t.authorize('synthetic',60);t.beginExperiment({maxRequests:20,maxMs:10000});t.begin();await assert.rejects(t.driveFetch(t.API+'/fixture'),/lost response/);t.begin();await assert.rejects(t.driveFetch(t.API+'/fixture'),/AMBIGUOUS/);assert.equal(requests,1);assert.equal(t.experimentEvidence().active,0);}finally{globalThis.fetch=originalFetch;}
});
test('ordinary native CAS contention remains allowed, explicit stop blocks new requests',async()=>{
 const t=await fresh();let requests=0;globalThis.fetch=async()=>{requests++;return new Response('',{status:412});};
 try{t.authorize('synthetic',60);t.beginExperiment({maxRequests:20,maxMs:10000});t.begin();await t.driveFetch(t.API+'/fixture');assert.equal(t.experimentHealthy(),true);t.haltExperiment('STOPPED');await assert.rejects(t.driveFetch(t.API+'/fixture'),/STOPPED/);assert.equal(requests,1);}finally{globalThis.fetch=originalFetch;}
});
test('observer withdraws readiness and blocks unexpected post-ready request before fetch',async()=>{
 const t=await fresh();let requests=0,ready=true;globalThis.fetch=async()=>{requests++;return new Response('x');};
 try{t.authorize('synthetic',60);t.beginExperiment({maxRequests:20,maxMs:10000});t.onExperimentChange(state=>{if(ready&&(state.starting||state.halted)){ready=false;t.haltExperiment('UNEXPECTED_AFTER_READY');}});t.begin();await assert.rejects(t.driveFetch(t.API+'/fixture'),/UNEXPECTED_AFTER_READY/);assert.equal(ready,false);assert.equal(requests,0);assert.equal(t.experimentEvidence().requests,0);}finally{globalThis.fetch=originalFetch;}
});
test('late native uncertainty is synchronously observable even without a request',async()=>{
 const t=await fresh();t.beginExperiment({maxRequests:20,maxMs:10000});let ready=true;t.onExperimentChange(state=>{if(state.halted)ready=false;});t.haltExperiment('NATIVE_ERROR');assert.equal(ready,false);assert.equal(t.experimentHealthy(),false);
});

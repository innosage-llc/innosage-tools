import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const output=new URL('../native-overlay/.generated/operation-test-'+process.pid+'.cjs',import.meta.url);
await build({entryPoints:[fileURLToPath(new URL('../native-overlay/page-store.mjs',import.meta.url))],bundle:true,platform:'node',packages:'external',format:'cjs',outfile:fileURLToPath(output)});
const {PageStore}=createRequire(import.meta.url)(fileURLToPath(output));
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const subject=()=>{const s=Object.create(PageStore.prototype);Object.assign(s,{operation:null,operationSequence:0,notifications:0,notify(){this.notifications++;}});return s;};
test('whole action remains pending across nested phases, repeats coalesce, competing choice rejects',async()=>{
 const s=subject(),first=gate(),second=gate();let calls=0;
 const action=()=>{calls++;return (async()=>{await first.promise;s.phase('reading');await second.promise;return 'done';})();};
 const a=s.runOperation('resolve-local','page',action),b=s.runOperation('resolve-local','page',action);
 assert.equal(a,b);assert.equal(s.operationBusy,true);assert.equal(s.operation.pending,true);
 await assert.rejects(s.runOperation('resolve-cloud','page',()=>{}),/Another cloud action/);
 first.resolve();await Promise.resolve();await Promise.resolve();assert.equal(s.operation.pending,true);assert.equal(s.operation.phase,'reading');
 second.resolve();assert.equal(await a,'done');assert.equal(calls,1);assert.equal(s.operationBusy,false);assert.equal(s.operation.phase,'complete');
});
test('failed cloud action releases its UI coordinator and does not swallow the error',async()=>{
 const s=subject(),g=gate();const a=s.runOperation('verify','page',()=>g.promise);g.reject(new Error('body read failed'));
 await assert.rejects(a,/body read failed/);assert.equal(s.operation.pending,false);assert.equal(s.operation.phase,'failed');
 assert.equal(await s.runOperation('verify','page',async()=>42),42);assert.equal(s.operation.id,2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mockProvider} from './mock-provider.mjs';
import {WAL_FORMAT,WAL_VERSION} from './prepared-wal.mjs';
const require=createRequire(new URL('../byos-sync/package.json',import.meta.url));
const {runInTransaction,isTransactionTimedOut,startTransactionTryOnce,fillFileIfEtagMatches}=require('../byos-sync/native-overlay/.generated/workspace-store.cjs');
test('installed older native transaction rejects versioned WAL before page mutations or WAL cleanup; its lease remains stranded',async()=>{
 const remote=await mockProvider();
 try{
  const lease=remote.create({name:'transaction.json',mimeType:'application/json',parents:['root']});
  const body=Buffer.from(JSON.stringify({format:WAL_FORMAT,version:WAL_VERSION,workspace:'fixture',runId:'run',rows:[]}));
  const wal=remote.create({name:'rxdb-wal.json',mimeType:'application/json',parents:['root']},body);
  let callback=false;
  await assert.rejects(runInTransaction({apiEndpoint:remote.url,authToken:'synthetic',transactionTimeout:60000},{transactionFile:{fileId:lease.id},walFile:{fileId:wal.id}},'id',async()=>{callback=true;}),/map is not a function/);
  assert.equal(callback,false);assert.deepEqual(remote.files.get(wal.id).body,body);assert(remote.files.get(lease.id).body.length>0);
  const writes=remote.requests.filter(r=>r.method==='PUT');assert.equal(writes.length,1);assert(writes[0].path.endsWith('/'+lease.id));
 }finally{await remote.close();}
});
test('installed native peer respects refreshed modifiedDate and stale expiry clear loses CAS',async()=>{
 const remote=await mockProvider();
 try{
  const lease=remote.create({name:'transaction.json',mimeType:'application/json',parents:['root']},Buffer.from(JSON.stringify({preparedRunId:'owner',renewalId:'old'})));
  const options={apiEndpoint:remote.url,authToken:'synthetic',transactionTimeout:60000},init={transactionFile:{fileId:lease.id}};
  lease.modifiedTime=new Date(Date.now()-62000).toISOString();
  const stale=await isTransactionTimedOut(options,init);assert(stale.expired);
  const renewed=await fillFileIfEtagMatches(options,lease.id,stale.etag,{preparedRunId:'owner',renewalId:'new'});assert.equal(renewed.status,200);
  assert.equal((await isTransactionTimedOut(options,init)).expired,false);
  assert.equal((await fillFileIfEtagMatches(options,lease.id,stale.etag,undefined)).status,412);
  assert.equal((await startTransactionTryOnce(options,init)).retry,true);
  lease.modifiedTime=new Date(Date.now()-62000).toISOString();const expired=await isTransactionTimedOut(options,init);assert(expired.expired);
  assert.equal((await fillFileIfEtagMatches(options,lease.id,expired.etag,undefined)).status,200);
  assert.equal((await startTransactionTryOnce(options,init)).retry,undefined);
 }finally{await remote.close();}
});

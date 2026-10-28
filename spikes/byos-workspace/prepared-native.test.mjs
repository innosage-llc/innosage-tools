import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mockProvider} from './mock-provider.mjs';
import {WAL_FORMAT,WAL_VERSION} from './prepared-wal.mjs';
const require=createRequire(new URL('../byos-sync/package.json',import.meta.url));
const {runInTransaction}=require('../byos-sync/native-overlay/.generated/workspace-store.cjs');
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

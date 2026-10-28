// Native Changes adapter comparison against the loopback fixture only.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {Workspace} from './workspace.mjs';
import {ForegroundRun} from './foreground.mjs';
import {mockProvider} from './mock-provider.mjs';
const require=createRequire(new URL('../byos-sync/package.json',import.meta.url));
require('fake-indexeddb/auto');
const {openPageStore,createChangesReplication}=require('../byos-sync/native-overlay/.generated/workspace-store.cjs');

test('explicit versus coalesced 12-page native sync preserves exact full tree without verification claims', {timeout:60000}, async () => {
  const observations=[];
  for(const mode of ['explicit','foreground']) {
    const remote=await mockProvider(),clients=[];
    const workspaceId='test'+crypto.randomUUID().replaceAll('-','');
    let run;
    try {
      async function open(session) {
        const store=await openPageStore({workspace:'test'+crypto.randomUUID().replaceAll('-',''),session,multiInstance:false});
        store.workspace=workspaceId;store.explicitSync=true;
        store.connectionProvider=async()=>({factory:createChangesReplication,googleDrive:{apiEndpoint:remote.url,authToken:'synthetic',oauthClientId:'synthetic',folderPath:workspaceId,transactionTimeout:50}});
        await store.connect(remote.url,{live:true,autoStart:false,retryTime:100});
        const workspace=new Workspace(store);clients.push(workspace);return workspace;
      }
      const a=await open('a'),b=await open('b');
      const timers=new Map();let nextTimer=0;
      if(mode==='foreground')run=new ForegroundRun(a,{authorized:()=>true,visible:()=>true,online:()=>true,
        clock:{setTimeout(fn){timers.set(++nextTimer,fn);return nextTimer;},clearTimeout(id){timers.delete(id);}}});
      const requestStart=remote.requests.length,started=performance.now();let explicitDispatches=0;
      for(let i=0;i<12;i++) {
        await a.create({id:'w142_eval'+i,title:'Page '+i,parentId:i?'w142_eval0':null,order:i,markdown:'x'.repeat(4096)});
        if(run)run.saved();else{await a.sync();explicitDispatches++;}
      }
      if(run){assert.equal(timers.size,1);for(const fn of timers.values())fn();timers.clear();await run.flight.promise;}
      const senderRequests=remote.requests.slice(requestStart);
      const senderDurationMs=performance.now()-started;
      const before=await a.catalog();assert.equal(before.pages.length,12);assert.equal(before.pendingCount,12);
      for(const page of before.pages)assert.equal((await a.read(page.id)).cloudVerified,false,'sync is not independent verification');
      await b.sync();const after=await b.catalog();assert.deepEqual(after.pages,before.pages);assert.equal(after.healthy,true);
      assert.equal((await a.handoff()).complete,false);
      observations.push({mode,pages:12,markdownBytesPerPage:4096,dispatches:run?run.snapshot().dispatches:explicitDispatches,
        senderRequests:senderRequests.length,bytesUp:senderRequests.reduce((n,r)=>n+r.bytes_up,0),bytesDown:senderRequests.reduce((n,r)=>n+r.bytes_down,0),
        senderDurationMs,fullTreeEqual:true,pendingJournalsRetained:12,cloudVerified:false,destinationHandoffClaim:false});
    } finally {
      run?.stop();for(const workspace of clients){workspace.close();await workspace.store.close();}await remote.close();
    }
  }
  assert.equal(observations[0].dispatches,12);assert.equal(observations[1].dispatches,1);
  const evidence={status:'PASS',scope:'NATIVE_LOOPBACK_POLICY_EVALUATION_ONLY',realGoogleRequests:0,
    defaultUiChanged:false,samplesPerMode:1,percentiles:'NOT_APPLICABLE',
    limits:'Explicit sync after every durable create versus one foreground batch; this is a scheduling-policy comparison, not identical sync timing or measured Google cost/latency.',observations};
  const output=new URL('.generated/foreground/',import.meta.url);await mkdir(output,{recursive:true});
  await writeFile(new URL('evidence.json',output),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
});

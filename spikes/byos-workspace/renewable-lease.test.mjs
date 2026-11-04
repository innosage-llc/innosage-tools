import test from 'node:test';
import assert from 'node:assert/strict';
import {RenewableLease} from './renewable-lease.mjs';

function fixture(){
  let now=0,version=1;const timers=new Map(),events=[],writes=[];
  const lease={fileId:'lease',value:{preparedRunId:'owner',createdAtClientTime:0},etag:'"v1"',version:'1',modifiedDateMs:0,acquiredAt:0};
  let remote=structuredClone(lease),hook=null;
  const clock={now:()=>now,wallNow:()=>now,sleep:async ms=>{now+=ms;},random:()=>0.5,setTimeout:(fn,ms)=>{const id=Symbol();timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  const budget={assertCanRequest(){if(now>=180000)throw Error('EXPERIMENT_BUDGET_EXHAUSTED');},remainingMs:()=>180000-now};
  const io={readFile:async()=>{if(hook?.read)await hook.read();return structuredClone(remote);},putFile:async(id,etag,value,{beforeDispatch})=>{beforeDispatch();if(hook?.before)await hook.before();if(etag!==remote.etag)throw Object.assign(Error('CAS'),{status:412});writes.push({etag,value});remote={value:structuredClone(value),etag:'"v'+(++version)+'"',version:String(version),modifiedDateMs:now};if(hook?.after)await hook.after();}};
  const authority=new RenewableLease({lease,io,clock,budget,event:e=>events.push(e)});
  return {authority,lease,io,clock,budget,timers,events,writes,at:ms=>{now=ms;},hook:value=>{hook=value;},foreign:()=>{remote={...remote,value:{preparedRunId:'foreign'},etag:'"foreign"'};},remote:()=>remote};
}
test('confirmed CAS heartbeats support editing across repeated old40s boundaries with same native timeout',async()=>{
  const f=fixture();for(const time of [20000,40000,60000,80000,100000]){f.at(time);await f.authority.refresh();assert.equal(f.lease.acquiredAt,time);f.authority.assertWrite({role:'page'});}
  assert.equal(f.writes.length,5);assert.equal(new Set(f.writes.map(w=>w.value.renewalId)).size,5);assert(f.writes.every(w=>w.value.preparedRunId==='owner'));
  f.at(180000);assert.throws(()=>f.authority.assertWrite({role:'page'}),/EXPERIMENT_BUDGET/);f.authority.close();assert.equal(f.timers.size,0);
});
test('lost successful renewal response is read-reconciled once before authority advances',async()=>{
  const f=fixture();f.at(20000);f.hook({after:async()=>{throw Object.assign(Error('lost'),{network:true});}});await f.authority.refresh();assert.equal(f.writes.length,1);assert.equal(f.lease.acquiredAt,20000);assert(f.events.some(e=>e.reconciled));f.authority.close();
});
test('old unchanged lease cannot be mistaken for successful renewal and transient failure retries finitely',async()=>{
  const f=fixture();f.at(20000);let calls=0;f.hook({before:async()=>{if(++calls===1)throw Object.assign(Error('temporary'),{status:503});}});await f.authority.refresh();assert.equal(calls,2);assert.equal(f.writes.length,1);assert.equal(f.lease.acquiredAt,20000);f.authority.close();
});
test('foreign CAS owner prevents renewal and closes write authority without changing local lease snapshot',async()=>{
  const f=fixture();f.at(20000);f.foreign();await assert.rejects(f.authority.refresh(),/UPLOAD_CONFLICT/);assert.equal(f.lease.acquiredAt,0);assert.equal(f.writes.length,0);assert.throws(()=>f.authority.assertWrite({role:'page'}));f.authority.close();
});
test('ambiguous renewal without readback cannot authorize another write window',async()=>{
  const f=fixture();f.at(20000);f.hook({after:async()=>{throw Object.assign(Error('lost'),{network:true});},read:async()=>{throw Object.assign(Error('auth'),{status:401});}});await assert.rejects(f.authority.refresh(),/WRITE_OUTCOME_UNRESOLVED/);assert.equal(f.lease.acquiredAt,0);assert.throws(()=>f.authority.assertWrite({role:'page'}));f.authority.close();
});
test('release drains a started heartbeat and uses its latest confirmed validator; no later timer can reopen it',async()=>{
  const f=fixture();f.at(20000);let resume;f.hook({before:()=>new Promise(r=>{resume=r;})});const flight=f.authority.refresh();await Promise.resolve();await Promise.resolve();const release=f.authority.beginRelease();assert.throws(()=>f.authority.assertWrite({role:'page'}),/CLOSED/);resume();await flight;const latest=await release;assert.equal(latest.etag,f.remote().etag);assert.equal(f.timers.size,0);f.authority.close();await assert.rejects(f.authority.refresh(),/CLOSED/);
});
test('timer suspension never silently reacquires an expired lock',async()=>{
  const f=fixture();const timer=[...f.timers.values()][0];f.at(61000);timer.fn();await Promise.resolve();await Promise.resolve();assert.equal(f.writes.length,0);assert.equal(f.lease.acquiredAt,0);assert.throws(()=>f.authority.assertWrite({role:'page'}));f.authority.close();
});
test('late renewal after closed authority cannot update the shared acquisition clock',async()=>{
  const f=fixture();f.at(20000);let resume;f.hook({read:()=>new Promise(r=>{resume=r;})});const flight=f.authority.refresh();for(let i=0;i<8&&!resume;i++)await Promise.resolve();f.authority.close();resume();await assert.rejects(flight,/CLOSED/);assert.equal(f.lease.acquiredAt,0);
});
test('unchanged provider modification time never proves fresh authority even with new content and validator',async()=>{
  const f=fixture();f.at(20000);f.hook({after:async()=>{f.remote().modifiedDateMs=0;}});await assert.rejects(f.authority.refresh(),/LEASE_REFRESH_NOT_PROVEN/);assert.equal(f.lease.acquiredAt,0);assert.throws(()=>f.authority.assertWrite({role:'page'}));f.authority.close();
});
test('authentication denial stops renewal with no repeated PUT and preserves old snapshot',async()=>{
  const f=fixture();f.at(20000);let attempts=0;f.hook({before:async()=>{attempts++;throw Object.assign(Error('auth'),{status:401});}});await assert.rejects(f.authority.refresh(),/auth/);assert.equal(attempts,1);assert.equal(f.lease.acquiredAt,0);assert.equal(f.writes.length,0);f.authority.close();
});
test('closed old acquisition never borrows a later acquisition freshness',async()=>{
  const old=fixture(),next=fixture();old.authority.close();next.at(20000);await next.authority.refresh();assert.throws(()=>old.authority.assertWrite({role:'page'}),/CLOSED/);next.authority.assertWrite({role:'page'});assert.equal(old.lease.acquiredAt,0);next.authority.close();
});
test('a late release continuation cannot reopen terminally closed authority',async()=>{
  const f=fixture();f.authority.close();await assert.rejects(f.authority.beginRelease(),/CLOSED/);assert.equal(f.authority.state,'closed');assert.throws(()=>f.authority.assertWrite({role:'lease'}),/CLOSED/);assert.equal(f.writes.length,0);
});

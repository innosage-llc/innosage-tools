import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import {mockProvider} from './mock-provider.mjs';
import {Workspace} from './workspace.mjs';
import {makePage,encode,decode,treeIssues} from './envelope.mjs';
const require=createRequire(new URL('../byos-sync/package.json',import.meta.url));
require('fake-indexeddb/auto');
const {openPageStore,createChangesReplication}=require('../byos-sync/native-overlay/.generated/workspace-store.cjs');
const newStore=async(options={})=>openPageStore({workspace:'test'+crypto.randomUUID().replaceAll('-',''),session:'a',multiInstance:false,...options});
const root='w142_project',child='w142_notes',grand='w142_agenda';
const markdown='# Meeting Notes\n\n- exact  \n\n```js\n42\n```\n[Agenda](https://example.invalid)\n';
async function fixture(t) {const store=await newStore();const workspace=new Workspace(store);t.after(async()=>{workspace.close();await store.close();});return {store,workspace};}

test('prepared native reconciliation holds new input durably without exposing it to replication',async t=>{
 const {store,workspace}=await fixture(t);await workspace.create({id:root,title:'A',markdown:'confirmed'});
 const confirmed=await store.page(root);await store.holdPreparedGenerations(new Map([[root,{record:confirmed}]]),()=>true);
 await workspace.save(root,{markdown:'new input'},confirmed);
 const first=await store.draft(root);assert.equal(first.state,'pending');assert.deepEqual(first.base,confirmed);
 assert.deepEqual(await store.page(root),confirmed);assert.equal((await workspace.read(root)).page.markdown,'new input');
 await workspace.save(root,{markdown:'newer input'},first.draft);
 const second=await store.draft(root);assert.equal(second.state,'pending');assert.deepEqual(second.base,confirmed);assert.deepEqual(await store.page(root),confirmed);
 await assert.rejects(store.retirePreparedGenerations(new Map([[root,{target:confirmed}]]),()=>true),/advanced/);
 assert.equal((await store.draft(root)).seq,second.seq);assert.equal((await workspace.read(root)).cloudVerified,false);
});
test('prepared retirement requires exact matching page and journal and respects generation invalidation',async t=>{
 const {store,workspace}=await fixture(t);await workspace.create({id:root,title:'A'});const record=await store.page(root);
 await store.holdPreparedGenerations(new Map([[root,{record}]]),()=>true);let current=true;
 store.hook=async name=>{if(name==='before-prepared-cleanup')current=false;};
 await assert.rejects(store.retirePreparedGenerations(new Map([[root,{target:record}]]),()=>current),/advanced/);
 assert(await store.draft(root));assert.equal(store.verified.has(root),false);
 current=true;store.hook=async()=>{};await store.retirePreparedGenerations(new Map([[root,{target:record}]]),()=>current);
 assert.equal(await store.draft(root),null);assert.equal((await workspace.read(root)).cloudVerified,true);
});

test('full envelope strict validation, version/identity/workspace/size; deterministic encoding',()=>{
 const page=makePage({workspaceId:'test',id:root,title:'Project',markdown});
 assert.deepEqual(decode({id:root,body:encode(page),editId:'gen'},'test'),{...page,editId:'gen'});
 assert.throws(()=>decode({id:child,body:encode(page)}));
 assert.throws(()=>decode({id:root,body:encode(page)},'different'));
 assert.throws(()=>encode({...page,version:2}));
 assert.throws(()=>encode({...page,extra:1}));
 assert.throws(()=>encode({...page,markdown:'x'.repeat(262144)}));
 assert.equal(encode(page),encode({...page,markdown}));
});
test('root/child/grandchild rename, reparent, exact bodies and cold restart',async t=>{
 const {store,workspace}=await fixture(t);
 await workspace.create({id:root,title:'Project',markdown:'# Project\n\n- scope\n'});
 await workspace.create({id:child,title:'Meeting Notes',parentId:root,markdown});
 await workspace.create({id:grand,title:'Agenda',parentId:child,markdown:'# Agenda\n'});
 let read=await workspace.read(child);await workspace.save(child,{title:'Review Notes'},read.baseline);
 read=await workspace.read(grand);await workspace.save(grand,{parentId:null},read.baseline);
 const before=await workspace.catalog();assert.equal(before.pages.length,3);assert.deepEqual(before.issues,[]);
 assert.equal(before.pages.find(p=>p.id===child).markdown,markdown);
 workspace.close();await store.close();
 const reopened=await newStore({workspace:store.workspace});t.after(()=>reopened.close());
 const after=await new Workspace(reopened).catalog();assert.deepEqual(after.pages,before.pages);assert.equal(after.pendingCount,3);
});
test('local orphan/cycle moves rejected without overwriting acknowledged intent',async t=>{
 const {store,workspace}=await fixture(t);
 await workspace.create({id:root,title:'Project'});await workspace.create({id:child,parentId:root});
 const before=await store.page(root);
 await assert.rejects(workspace.save(root,{parentId:child},before),/Invalid/);
 await assert.rejects(workspace.create({id:grand,parentId:'w142_missing'}),/Invalid/);
 assert.deepEqual(await store.page(root),before);
});
test('incoming reciprocal cycle and missing parent remain visible, block confirmation',async t=>{
 const {store,workspace}=await fixture(t);
 await store.save(root,encode(makePage({workspaceId:store.workspace,id:root,parentId:child})));
 await store.save(child,encode(makePage({workspaceId:store.workspace,id:child,parentId:root})));
 await store.save(grand,encode(makePage({workspaceId:store.workspace,id:grand,parentId:'w142_missing'})));
 const catalog=await workspace.catalog();assert.equal(catalog.knownCount,3);assert.equal(catalog.healthy,false);
 assert.equal(catalog.issues.length,3);assert.equal((await workspace.handoff()).complete,false);
 assert.equal(treeIssues(catalog.pages).length,3);
});
test('failed protected commit never acknowledges or creates a page',async t=>{
 const {store,workspace}=await fixture(t);store.hook=async(name)=>{if(name==='before-journal-update')throw Error('commit-failed');};
 await assert.rejects(workspace.create({id:root}),/commit-failed/);
 assert.equal(await store.page(root),null);assert.equal(await store.draft(root),null);
});
test('failure after journal commit preserves full orphaned draft recovery',async t=>{
 const {store,workspace}=await fixture(t);store.hook=async(name)=>{if(name==='journal-committed')throw Error('owner-crash');};
 await assert.rejects(workspace.create({id:root,title:'Protected',markdown}),/owner-crash/);
 assert.equal(await store.page(root),null);const catalog=await workspace.catalog();
 assert.equal(catalog.pages[0].markdown,markdown);assert.equal(catalog.pendingCount,1);
});
test('old per-page verification cannot confirm a new generation or unrelated page',async t=>{
 const {store,workspace}=await fixture(t);await workspace.create({id:root});
 const old=await store.page(root);store.verified.set(root,old);
 // With protected intent still present, even equal old receipt is not enough.
 assert.equal((await workspace.read(root)).cloudVerified,false);
 const draft=await store.db.localDrafts.findOne(root+':a').exec();await draft.remove();
 assert.equal((await workspace.read(root)).cloudVerified,true);
 await workspace.save(root,{markdown},old);assert.equal((await workspace.read(root)).cloudVerified,false);
 store.state='clean';await workspace.create({id:child});assert.equal((await workspace.read(child)).cloudVerified,false);
});
test('stale captured baseline preserves metadata/body branch as conflict',async t=>{
 const {store,workspace}=await fixture(t);await workspace.create({id:root,title:'Original'});
 const baseline=await store.page(root);const journal=await store.db.localDrafts.findOne(root+':a').exec();await journal.remove();
 const remote={...baseline,body:encode(makePage({workspaceId:store.workspace,id:root,title:'Remote'})),editId:'remote'};
 await (await store.db.pages.findOne(root).exec()).incrementalModify(row=>({...row,...remote}));
 await workspace.save(root,{title:'Local',markdown},baseline);
 const view=await store.view(root);assert.equal(view.status,'needs-resolution');assert.equal(decode(view.journal.draft).title,'Local');
 assert.equal(decode(view.journal.sourceExternal).title,'Remote');assert.deepEqual(await store.page(root),remote);
});
test('namespace isolation and malformed envelope preserve raw source without false catalog success',async t=>{
 const {store,workspace}=await fixture(t);await store.save('page','accepted old demo');await store.save(root,'not-json');
 const catalog=await workspace.catalog();assert.equal(catalog.knownCount,1);assert.equal(catalog.invalid[0].record.body,'not-json');assert.equal(catalog.healthy,false);
 assert.equal((await store.page('page')).body,'accepted old demo');assert.equal((await store.draft(root)).draft.body,'not-json');
});
test('duplicate in-process owner cannot open competing native database',async t=>{
 const {store}=await fixture(t);
 await assert.rejects(newStore({workspace:store.workspace}),error=>error.code==='DB8');
});

for (const choice of ['cloud','local','merge']) test(`Changes adapter full-record A/B round trip and ${choice} conflict`,{timeout:60000},async t=>{
 const remote=await mockProvider();const clients=[];const remoteWorkspace='test'+crypto.randomUUID().replaceAll('-','');
 t.after(async()=>{for(const client of clients)await client.close();await remote.close();});
 async function open(session){
  const store=await newStore({session});clients.push(store);
  // Independent local databases; same remote binding, like separate profiles.
  store.workspace=remoteWorkspace;store.explicitSync=true;
  store.connectionProvider=async()=>({factory:createChangesReplication,googleDrive:{apiEndpoint:remote.url,authToken:'synthetic',oauthClientId:'synthetic',folderPath:remoteWorkspace,transactionTimeout:50}});
  await store.connect(remote.url,{live:true,autoStart:false,retryTime:100});
  return new Workspace(store);
 }
 const a=await open('a'),b=await open('b');
 await a.create({id:root,title:'Project',markdown});await a.create({id:child,title:'Notes',parentId:root,markdown});
 await a.create({id:grand,title:'Agenda',parentId:child,markdown});
 for(const id of [root,child,grand])await a.verify(id);
 await b.sync();assert.deepEqual((await b.catalog()).pages,(await a.catalog()).pages);
 let old=await b.read(child);await b.save(child,{title:'B reply',markdown:'# B reply\n'},old.baseline);await b.verify(child);
 await a.sync();assert.deepEqual((await a.read(child)).page,(await b.read(child)).page);
 const beforeA=await a.read(child),beforeB=await b.read(child);
 await a.save(child,{title:'A conflict',parentId:null,markdown:'# A retained\n'},beforeA.baseline);
 await b.save(child,{title:'B conflict',parentId:root,markdown:'# B retained\n'},beforeB.baseline);await b.verify(child);
 await a.sync();const conflict=await a.read(child);assert.equal(conflict.view.status,'needs-resolution');
 assert.equal(decode(conflict.view.journal.draft).title,'A conflict');assert.equal(decode(conflict.view.journal.remote).title,'B conflict');
 const merged=encode(makePage({workspaceId:remoteWorkspace,id:child,title:'Merged',parentId:root,markdown:'# A retained\n# B retained\n'}));
 await a.resolve(child,choice,choice==='merge'?merged:undefined);
 if(choice!=='cloud')await a.verify(child);
 await b.sync();const final=(await a.read(child)).page;
 assert.equal(final.title,choice==='cloud'?'B conflict':choice==='local'?'A conflict':'Merged');
 assert.deepEqual((await b.read(child)).page,final);assert.equal((await a.catalog()).healthy,true);
 assert.equal((await a.handoff()).complete,false);a.close();b.close();
});
test('conflict does not block another page local save, and newer protected metadata survives body patch',async t=>{
 const {store,workspace}=await fixture(t);await workspace.create({id:root});await workspace.create({id:child,parentId:root,title:'Protected title'});
 let current=await workspace.read(child);await workspace.save(child,{title:'Acknowledged rename'},current.baseline);
 current=await workspace.read(child);
 await (await store.db.localDrafts.findOne(root+':a').exec()).incrementalModify(row=>({...row,state:'needs-resolution'}));
 await workspace.save(child,{markdown},current.baseline);
 assert.equal((await workspace.read(child)).page.title,'Acknowledged rename');assert.equal((await workspace.read(child)).page.markdown,markdown);
});
test('frozen S0 complete-body/tree oracle',async t=>{
 const {fixture:oracle}=await import('./fixture.mjs');const {workspace}=await fixture(t);
 for(const page of oracle)await workspace.create(page);
 const actual=(await workspace.catalog()).pages.map(({workspaceId,format,version,editId,...page})=>page).sort((a,b)=>a.id.localeCompare(b.id));
 assert.deepEqual(actual,[...oracle].sort((a,b)=>a.id.localeCompare(b.id)));
 let read=await workspace.read(child);await workspace.save(child,{title:'Review Notes'},read.baseline);
 read=await workspace.read(grand);await workspace.save(grand,{parentId:null},read.baseline);
 const changed=(await workspace.catalog()).pages;
 assert.equal(changed.find(p=>p.id===child).title,'Review Notes');assert.equal(changed.find(p=>p.id===grand).parentId,null);
 for(const page of oracle)assert.equal(changed.find(p=>p.id===page.id).markdown,page.markdown);
});

test('existing orphan cannot be reparented to another missing parent under same issue name',async t=>{
 const {store,workspace}=await fixture(t);
 await store.save(root,encode(makePage({workspaceId:store.workspace,id:root,parentId:'w142_missingA'})));
 const before=await store.page(root);
 await assert.rejects(workspace.save(root,{parentId:'w142_missingB'},before),/Invalid tree/);
 await workspace.save(root,{markdown:'body-only recovery'},before);
 assert.equal((await workspace.read(root)).page.parentId,'w142_missingA');
});
async function discardWorld(t) {
 const remote=await mockProvider(),clients=[],hooks=[];const binding='test'+crypto.randomUUID().replaceAll('-','');
 t.after(async()=>{for(const workspace of clients){workspace.close();await workspace.store.close();}await remote.close();});
 async function open(session){
  const store=await newStore({session,hook:async(name)=>{hooks.push({session,name});}});
  store.workspace=binding;store.explicitSync=true;
  store.connectionProvider=async()=>({factory:createChangesReplication,googleDrive:{apiEndpoint:remote.url,authToken:'synthetic',oauthClientId:'synthetic',folderPath:binding,transactionTimeout:50}});
  await store.connect(remote.url,{live:true,autoStart:false,retryTime:100});const workspace=new Workspace(store);clients.push(workspace);return workspace;
 }
 const a=await open('a'),b=await open('b');
 await a.create({id:root,title:'Project'});await a.create({id:child,title:'Child',parentId:root,markdown});
 await a.verify(root);await a.verify(child);await b.sync();
 const oldA=await a.read(child),oldB=await b.read(child);
 await a.save(child,{title:'Protected local',markdown:'# full local intent\n'},oldA.baseline);
 await b.save(child,{title:'Valid remote',markdown:'# valid cloud original\n'},oldB.baseline);await b.verify(child);await a.sync();
 assert.equal((await a.read(child)).view.status,'needs-resolution');
 return {a,b,hooks,binding};
}
for(const invalid of ['malformed','identity','version','workspace','orphan','cycle'])test(`cloud discard rejects ${invalid} accepted final record and preserves complete journal`,{timeout:60000},async t=>{
 const {a,b,binding}=await discardWorld(t);const before=JSON.parse(JSON.stringify(await a.store.draft(child)));
 assert.equal(decode(before.remote).title,'Valid remote');
 const remotePage=makePage({workspaceId:binding,id:child,title:'Invalid incoming',parentId:root,markdown:'# cloud newer\n'});
 if(invalid==='identity')remotePage.id='w142_wrong';
 if(invalid==='version')remotePage.version=2;
 if(invalid==='workspace')remotePage.workspaceId='different';
 if(invalid==='orphan')remotePage.parentId='w142_missing';
 if(invalid==='cycle')remotePage.parentId=child;
 const raw=invalid==='malformed'?'not-json':JSON.stringify(remotePage);
 const baseline=await b.store.page(child);await b.store.save(child,raw,{base:baseline});await b.store.verify(child);
 // Journal still has the previously valid remote; validation must inspect the
 // independently accepted newest record inside native discard, not that cache.
 await assert.rejects(a.resolve(child,'cloud'));
 assert.deepEqual(JSON.parse(JSON.stringify(await a.store.draft(child))),before);
 assert.equal((await a.store.remote(child)).body,raw,'subsequent native transaction proves lease released');
});
test('valid cloud discard preserves original hooks and rejects a journal advanced during validation',{timeout:60000},async t=>{
 const {a,hooks}=await discardWorld(t);
 assert(hooks.some(row=>row.session==='a'&&row.name==='remote-read'));
 const prior=a.previousHook;let mutated;
 a.previousHook=async(name,row,context)=>{
  await prior(name,row,context);
  if(name==='before-cloud-discard'){
   const doc=await a.store.db.localDrafts.findOne(row.id).exec();
   await doc.incrementalModify(current=>({...current,seq:current.seq+1,draft:{...current.draft,editId:'new-protected-generation',body:encode(makePage({workspaceId:a.store.workspace,id:child,title:'New protected intent',parentId:root,markdown:'# never retire\n'}))}}));
   mutated=JSON.parse(JSON.stringify(await a.store.draft(child)));
  }
 };
 await assert.rejects(a.resolve(child,'cloud'),/Generation advanced/);
 assert.deepEqual(JSON.parse(JSON.stringify(await a.store.draft(child))),mutated);
 assert(hooks.some(row=>row.session==='a'&&row.name==='before-cloud-discard'));
 await a.store.remote(child);
 a.previousHook=prior;
 await a.resolve(child,'cloud');assert.equal(await a.store.draft(child),null);assert.equal((await a.read(child)).page.title,'Valid remote');
});

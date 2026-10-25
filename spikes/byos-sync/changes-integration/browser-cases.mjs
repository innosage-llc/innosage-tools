import {chromium} from 'playwright';
import http from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import assert from 'node:assert/strict';
export async function executeBrowser(w){
 const {id,m,p,T,scope,event,persist,inventory,until}=w;
 const js=readFileSync('changes-integration/.generated/ui.js'),html=readFileSync('native-overlay/index.html');
 const server=http.createServer((req,res)=>{w.onUIRequest();res.setHeader('content-type',req.url.split('?')[0]==='/ui-bundle.js'?'application/javascript':'text/html');res.end(req.url.split('?')[0]==='/ui-bundle.js'?js:html);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;w.allowed.push(url);
 w.onServer({close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})});
 const profile=resolve('changes-integration/.generated/profiles',basename(w.dir));mkdirSync(profile,{recursive:true});
 const c=await chromium.launchPersistentContext(profile,{headless:true});w.contexts.push(c);w.onBrowser(c.browser());
 const uploads=[],owners=[];
 await c.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  try{
   // Reserve two physical requests for each cross-origin mock dispatch: the
   // actual request and its possible Chromium-generated CORS preflight.
   w.admitRequest(req.url(),u.origin===m.url?2:1);
   event({type:'browser-dispatch',url:req.url(),method:req.method(),body:req.postData()});
   const f=[...m.files.values()].find(f=>u.pathname.endsWith('/'+f.id)&&f.name==='page.json');
   if(f&&['PUT','PATCH'].includes(req.method())){try{const doc=JSON.parse(req.postData());if(doc.editId)uploads.push({editId:doc.editId,body:doc.body,at:Date.now(),session:new URL(req.frame().url()).searchParams.get('session')});}catch{}}
   await route.continue();
  }catch(error){event({type:'browser-hard-stop',error:String(error)});await route.abort();throw error;}
 });
 c.on('response',response=>{response.body().then(body=>event({type:'browser-response',url:response.url(),status:response.status(),body:body.toString()})).catch(()=>{});});
 const pages=[];
 const open=async session=>{const page=await c.newPage();pages.push(page);page.on('pageerror',error=>event({type:'page-error',session,error:String(error)}));page.on('console',msg=>{if(msg.type()==='error')event({type:'browser-console',session,text:msg.text()});});await page.goto(`${url}/?workspace=${scope}&session=${session}`);await page.waitForFunction(()=>window.spike?.ready);return page;};
 const snap=async(name,targets,hint=null)=>{const receivers=[];for(const page of targets)receivers.push(await page.evaluate(async hint=>({receiver:await window.integrationInspect(window.spike.store,hint),ui:{body:document.querySelector('#editor').value,status:document.querySelector('#status').textContent,warning:document.querySelector('#warning').textContent,warningHidden:document.querySelector('#warning').hidden},session:window.spike.store.session}),hint));return persist(name,{name,receivers,inventory:inventory(),requests:m.requests,faults:m.faults,provider:p.snapshot(),uploads:structuredClone(uploads),owners:structuredClone(owners)});};
 const save=(page,body)=>page.evaluate(body=>window.spike.store.save('page',body),body);
 const sync=page=>page.evaluate(()=>window.spike.store.sync());
 const verify=page=>page.evaluate(()=>window.spike.store.verify('page'));
 const view=page=>page.evaluate(()=>window.spike.store.view('page'));
 const connect=page=>page.evaluate(endpoint=>window.spike.store.connect(endpoint,{live:false,transactionTimeout:50,retryTime:1000}),m.url);
 const folder=page=>page.evaluate(()=>window.__integration.latest.get(window.spike.store.db.name).driveStructure.docsFolderId);
 const a=await open('a');await save(a,T.A);await connect(a);await verify(a);owners.push({at:Date.now(),session:'a',leader:await a.evaluate(()=>window.spike.store.db.isLeader()),created:true});
 if(id==='I3_CRASH'){
  await a.evaluate(()=>window.spike.store.disconnect());await save(a,T.B);
  const docsFolder=await folder(a),file=[...m.files.values()].find(f=>f.name==='page.json'&&f.parents.includes(docsFolder));assert(file);
  p.update(file.id,{...JSON.parse(file.body),body:T.C,editId:'remote-C'});await connect(a);await sync(a);assert.equal((await view(a)).journal.sourceLocal.body,T.B);assert.equal((await view(a)).journal.sourceCloud.body,T.C);
  await save(a,T.D);const before=await snap('acknowledged-conflict-before-interruption',[a]);
  const required=m.create({name:'required.json',mimeType:'application/json',parents:[docsFolder]},Buffer.from(JSON.stringify({id:'required',body:'# Required native body\n\nR — unapplied before crash.',editId:'required-crash',_deleted:false})));p.refresh();const targetPosition=p.changes.findLastIndex(x=>x.fileId===required.id);assert(targetPosition>=0);
  await a.evaluate(()=>{
   window.barrier=null;const storage=window.spike.store.db.pages.storageInstance,original=storage.bulkWrite.bind(storage);
   storage.bulkWrite=async(rows,context)=>{if(rows.some(row=>row.document.id==='required'&&row.document.editId==='required-crash')){window.barrier={rows:structuredClone(rows),context};await new Promise(()=>{});}return original(rows,context);};
   window.pendingSync=window.spike.store.sync().catch(error=>{window.syncFailure=String(error);});
  });
  await a.waitForFunction(()=>window.barrier,{},{timeout:20000});
  const held=await snap('actual-native-downstream-held',[a]);const heldReceiver=held.receivers[0].receiver;
  const physical=await a.evaluate(()=>window.spike.store.db.pages.storageInstance.findDocumentsById(['required'],true));assert.equal(physical.length,0);
  const returned=heldReceiver.events.findLast(e=>e.type==='pull-return'&&e.result.documents.some(d=>d.id==='required'));assert(returned);
  const covers=cp=>cp?.changes109?.phase==='changes'&&p.index(cp.changes109.token)>targetPosition;
  assert(!covers(heldReceiver.checkpoint));assert(covers(returned.result.checkpoint));assert(!heldReceiver.metadata.some(row=>row.id==='required|0'&&row.docData.editId==='required-crash'));
  const barrier=await a.evaluate(()=>window.barrier);persist('discriminating-barrier-receipt',{targetPosition,physical,checkpoint:heldReceiver.checkpoint,handlerReturned:returned.result.checkpoint,barrier});
  const session=await c.newCDPSession(a);await Promise.race([session.send('Page.crash').catch(()=>{}),new Promise(r=>a.once('crash',r))]);await a.close().catch(()=>{});
  const reopened=await open('a');const recovered=await snap('same-receiver-native-indexeddb-reopened',[reopened],heldReceiver.identity),v=recovered.receivers[0].receiver.views.find(v=>v.journal?.page==='page');
  assert.equal(v.body,T.D);assert.equal(v.journal.sourceLocal.body,T.B);assert.equal(v.journal.sourceCloud.body,T.C);assert.notEqual(v.status,'remote-verified');assert.deepEqual(recovered.receivers[0].receiver.identity,heldReceiver.identity);assert(!covers(recovered.receivers[0].receiver.checkpoint));
  await connect(reopened);await sync(reopened);const after=await snap('explicit-native-retry-after-crash',[reopened]);const r=after.receivers[0].receiver;
  assert.deepEqual(r.identity,heldReceiver.identity);assert(r.pages.some(d=>d.id==='required'&&d.editId==='required-crash'));assert(covers(r.checkpoint));assert.equal((await view(reopened)).body,T.D);assert.equal((await view(reopened)).journal.sourceLocal.body,T.B);assert.equal((await view(reopened)).journal.sourceCloud.body,T.C);
  return {status:'PASS',browser:c.browser().version(),method:'CDP Page.crash real Chromium renderer; retained persistent profile and native IndexedDB; same receiver and metadata',profile:profile.slice(profile.indexOf('changes-integration')),identity:r.identity,targetPosition,heldCheckpoint:heldReceiver.checkpoint,returnedCheckpoint:returned.result.checkpoint,afterCheckpoint:r.checkpoint,configuration:{live:false,multiInstance:true,transactionTimeout:50,retryTime:1000},preCrashBodies:before.receivers[0].receiver.journals};
 }
 const b=await open('b');await until(async()=>await b.locator('#editor').inputValue()===T.A,'clean UI initial refresh');
 // Same receiver, different session; follower queues native leadership once.
 await b.evaluate(endpoint=>{window.nativeCreated=0;window.spike.store.hook=async name=>{if(name==='native-created')window.nativeCreated++;};window.pendingConnect=window.spike.store.connect(endpoint,{live:false,transactionTimeout:50,retryTime:1000}).catch(error=>{window.connectError=String(error);});},m.url);
 assert.equal(await b.evaluate(()=>!!window.spike.store.replication),false);
 await save(a,T.B);await until(async()=>await b.locator('#editor').inputValue()===T.B,'clean UI refresh after native local write');assert.equal(await b.locator('#warning').isHidden(),true);await snap('clean-tab-refresh',[a,b]);
 const unsaved='# Independent dirty tab\n\nC — unsaved complete input.';await b.locator('#editor').fill(unsaved);await save(a,T.D);
 await until(async()=>!(await b.locator('#warning').isHidden()),'dirty scoped warning');assert.equal(await b.locator('#editor').inputValue(),unsaved);await snap('unsaved-dirty-editor-protected',[a,b]);
 await b.locator('#save-btn').click();await b.waitForFunction(body=>window.spike.lastSaveAcknowledgement?.body===body,unsaved);const both=await snap('both-dirty-acknowledged',[a,b]);
 for(const r of both.receivers){assert.deepEqual(new Set(r.receiver.journals.map(j=>j.draft.body)),new Set([T.D,unsaved]));}
 await sync(a);const beforeClose=await snap('single-owner-before-close',[a,b]);assert.equal(await a.evaluate(()=>window.spike.store.db.isLeader()),true);assert.equal(await b.evaluate(()=>!!window.spike.store.replication),false);owners.push({at:Date.now(),session:'a',leader:true,closing:true});
 await a.close();await b.waitForFunction(()=>window.nativeCreated===1&&!!window.spike.store.replication?.wasStarted,{},{timeout:90000});await sync(b);
 owners.push({at:Date.now(),session:'b',leader:await b.evaluate(()=>window.spike.store.db.isLeader()),created:await b.evaluate(()=>window.nativeCreated)});assert.equal(owners.at(-1).leader,true);
 const reopened=await open('a');const after=await snap('native-owner-handoff-old-session-reopen',[b,reopened]);assert.equal((await view(reopened)).body,T.D);assert.equal((await view(b)).body,unsaved);assert.equal((await view(b)).journal.sourceExternal.body,T.D);assert.deepEqual(after.receivers[0].receiver.identity,beforeClose.receivers[0].receiver.identity);
 assert.equal(new Set(uploads.map(u=>u.editId)).size,uploads.length,'duplicate physical page uploads for a logical edit');
 return {status:'PASS',browser:c.browser().version(),profile:profile.slice(profile.indexOf('changes-integration')),configuration:{live:false,multiInstance:true,transactionTimeout:50,retryTime:1000},owners,uploads,identity:after.receivers[0].receiver.identity,cleanDirtyBothDirtyAndHandoff:true,limitations:'Explicit sync; no unattended freshness claim. Workspace/no-lock/duplicate-session guards reused with unchanged source justification.'};
}

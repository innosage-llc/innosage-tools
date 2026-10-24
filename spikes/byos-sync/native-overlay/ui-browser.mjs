import {chromium} from 'playwright';
import {mock} from '../src/mock.mjs';
import {uiServer} from './ui-server.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {bodies as T} from './fixtures.mjs';
const server=await uiServer(),remote=await mock(),browser=await chromium.launch({headless:true});
const evidence=[],contexts=[];
const scope='ui'+crypto.randomUUID().replaceAll('-','');
const newContext=async()=>{const c=await browser.newContext();contexts.push(c);
 await c.route('**/*',r=>[server.url,remote.url].includes(new URL(r.request().url()).origin)?r.continue():r.abort());return c;};
const open=async(c,session,workspace=scope)=>{const p=await c.newPage();await p.goto(`${server.url}/?workspace=${workspace}&session=${session}&endpoint=${encodeURIComponent(remote.url)}`);
 await p.waitForFunction(()=>window.spike?.ready);return p;};
const ready=async p=>{
 try {await p.waitForFunction(()=>!!window.spike.store.replication?.wasStarted,{},{timeout:5000});}
 catch(error){
  const details=await p.evaluate(async()=>({status:document.getElementById('status').textContent,
   replication:!!window.spike.store.replication,leader:window.spike.store.db.isLeader,
   explicit_start:await window.spike.store.replication?.start().then(()=>null).catch(e=>String(e))}));
  throw new Error(JSON.stringify(details)+' '+error);
 }
};
const save=async(p,body)=>{await p.getByRole('textbox',{name:'Markdown editor',exact:true}).fill(body);
 await p.getByRole('button',{name:'Save locally',exact:true}).click();
 await p.waitForFunction(body=>window.spike.lastSaveAcknowledgement?.body===body,body);};
const verify=async p=>{await p.getByRole('button',{name:'Verify remote',exact:true}).click();
 await until(()=>p.evaluate(()=>window.spike.store.view('page').then(v=>v.status==='remote-verified')),'remote verification');
 const body=await p.evaluate(()=>window.spike.store.view('page').then(v=>v.body));
 await p.waitForFunction(body=>document.getElementById('editor').value===body,body);};
const until=async(fn,label)=>{
 const start=Date.now();while(Date.now()-start<20000){if(await fn())return;
 await new Promise(r=>setTimeout(r,25));}throw new Error('Awaited condition timed out: '+label);
};
const editor=p=>p.getByRole('textbox',{name:'Markdown editor',exact:true});
try{
 const ca=await newContext(),a=await open(ca,'a');await ready(a);
 await save(a,T.A);await verify(a);
 await editor(a).fill('# Unsaved after verification');
 await a.evaluate(()=>window.spike.store.notify());
 await a.waitForFunction(()=>document.getElementById('status').textContent==='Edited — not saved locally');
 assert.equal(await editor(a).inputValue(),'# Unsaved after verification');
 evidence.push({id:'F05',status:'PASS',behavior:'unsaved editor never inherits a verified store status'});
 await save(a,T.A);await verify(a);
 const clean=await open(ca,'clean');await editor(clean).waitFor();
 await clean.waitForFunction(body=>document.getElementById('editor').value===body,T.A);
 await save(a,T.B);await clean.waitForFunction(body=>document.getElementById('editor').value===body,T.B);
 assert.equal(await clean.locator('#warning').isVisible(),false);
 evidence.push({id:'F12',status:'PASS',behavior:'visible clean editor refreshed'});
 await editor(clean).fill('## Unsaved B\n\nDirty tab content.');
 assert.equal(await clean.locator('#warning').isVisible(),false);
 await save(a,T.C);await verify(a);
 await clean.locator('#warning').waitFor({state:'visible'});
 assert.equal(await editor(clean).inputValue(),'## Unsaved B\n\nDirty tab content.');
 evidence.push({id:'F13',status:'PASS',behavior:'visible unsaved editor retained with warning'});
 // Recover acknowledged independent sessions across same-browser tab closure.
 await clean.getByRole('button',{name:'Save locally',exact:true}).click();
 await clean.waitForFunction(()=>window.spike.lastSaveAcknowledgement?.body==='## Unsaved B\n\nDirty tab content.');
 const guarded=await clean.evaluate(()=>window.spike.store.view('page'));
 assert.equal(guarded.page.body,T.C);assert.equal(guarded.journal.state,'needs-resolution');
 assert.equal(guarded.journal.sourceExternal.body,T.C);
 evidence.push({id:'F14-before-close',view:guarded});
 await clean.close();const recovered=await open(ca,'clean');
 assert.equal(await editor(recovered).inputValue(),'## Unsaved B\n\nDirty tab content.');
 const recoveredDraft=await recovered.evaluate(()=>window.spike.store.view('page'));
 assert.equal(recoveredDraft.journal.sourceExternal.body,T.C);assert.equal(recoveredDraft.page.body,T.C);
 evidence.push({id:'F14',status:'PASS',behavior:'independent acknowledged draft recovered after tab close'});
 await recovered.close();await a.close();await ca.close();
 // Fresh local devices, same mock native Drive. Live mode + native leadership.
 const c1=await newContext(),c2=await newContext(),x=await open(c1,'x',scope+'fork');await ready(x);
 await save(x,T.A);await verify(x);
 const y=await open(c2,'y',scope+'fork');await ready(y);
 await until(()=>y.evaluate(body=>window.spike.store.page('page').then(p=>p?.body===body),T.A),'cold baseline');
 await y.evaluate(()=>window.spike.store.sync());
 for(const p of [x,y])await p.evaluate(()=>window.spike.store.disconnect());
 assert.equal(await y.evaluate(()=>window.spike.store.page('page').then(p=>p?.body)),T.A);
 await save(x,T.B);await save(y,T.C);
 await y.evaluate(url=>window.spike.store.connect(url),remote.url);await verify(y);
 await x.evaluate(url=>window.spike.store.connect(url),remote.url);await x.evaluate(()=>window.spike.store.sync());
 await x.waitForFunction(body=>document.getElementById('cloud-body').textContent===body,T.C);
 assert.equal(await editor(x).inputValue(),T.B);
 assert.equal(await x.locator('#local-body').textContent(),T.B);
 evidence.push({id:'F03',status:'PASS',view:await x.evaluate(()=>window.spike.store.view('page'))});
 await save(x,T.D);await save(y,T.E);await verify(y);await x.evaluate(()=>window.spike.store.sync());
 assert.equal(await editor(x).inputValue(),T.D);
 assert.equal(await x.locator('#cloud-body').textContent(),T.E);
 evidence.push({id:'F04',status:'PASS',view:await x.evaluate(()=>window.spike.store.view('page'))});
 await x.screenshot({path:'native-overlay/.generated/conflict-ui.png',fullPage:true});
 await x.getByRole('button',{name:'Merge manually',exact:true}).click();
 await x.locator('#merge-editor').fill(T.M);
 await x.getByRole('button',{name:'Commit manual merge',exact:true}).click();
 await until(()=>x.evaluate(body=>window.spike.store.draft('page').then(d=>d?.draft.body===body),T.M),'merge journal');
 const before=await x.evaluate(()=>window.spike.store.draft('page'));
 assert.equal(before.sourceLocal.body,T.B);assert.equal(before.sourceCloud.body,T.C);
 await verify(x);assert.equal(await editor(x).inputValue(),T.M);
 evidence.push({id:'F08',status:'PASS',beforeVerification:before});
 const forkAgain=async()=>{
  await y.evaluate(()=>window.spike.store.sync());
  for(const p of [x,y])await p.evaluate(()=>window.spike.store.disconnect());
  await save(x,T.B);await save(y,T.C);
  await y.evaluate(url=>window.spike.store.connect(url),remote.url);await verify(y);
  await x.evaluate(url=>window.spike.store.connect(url),remote.url);await x.evaluate(()=>window.spike.store.sync());
  assert.equal((await x.evaluate(()=>window.spike.store.view('page'))).cloud,T.C);
 };
 await forkAgain();
 await editor(x).fill(T.D);
 await x.getByRole('button',{name:'Keep local',exact:true}).click();
 await until(()=>x.evaluate(body=>window.spike.store.draft('page').then(d=>d?.draft.body===body),T.D),'keep local journal');
 await verify(x);assert.equal(await editor(x).inputValue(),T.D);
 evidence.push({id:'F07',status:'PASS',body:T.D});
 await forkAgain();
 await x.evaluate(()=>{
  window.raceHit=false;window.spike.store.hook=async boundary=>{
   if(boundary==='resolution-journal'){window.raceHit=true;await new Promise(r=>{window.releaseRace=r;});}
  };
 });
 await x.getByRole('button',{name:'Merge manually',exact:true}).click();
 await x.locator('#merge-editor').fill(T.M);
 await x.getByRole('button',{name:'Commit manual merge',exact:true}).click();
 await x.waitForFunction(()=>window.raceHit);
 await save(y,T.E);await verify(y);
 await x.evaluate(()=>{window.releaseRace();window.spike.store.hook=async()=>{};});
 await x.evaluate(()=>window.spike.store.sync());
 await x.getByRole('button',{name:'Verify remote',exact:true}).click();
 await until(()=>x.evaluate(body=>window.spike.store.view('page').then(v=>v.body===body&&v.cloud!==null),T.M),'resolution race retained');
 const raced=await x.evaluate(()=>window.spike.store.view('page'));
 assert.equal(raced.status,'needs-resolution');assert.equal(raced.cloud,T.E);
 assert.equal(raced.journal.sourceLocal.body,T.B);assert.equal(raced.journal.sourceCloud.body,T.C);
 evidence.push({id:'F09',status:'PASS',view:raced});
 await x.getByRole('button',{name:'Use cloud',exact:true}).click();
 await until(()=>x.evaluate(()=>window.spike.store.draft('page').then(d=>!d)),'explicit cloud discard');
 await x.waitForFunction(body=>document.getElementById('editor').value===body,T.E);
 assert.equal(await editor(x).inputValue(),T.E);evidence.push({id:'F06',status:'PASS'});
} catch(error){
 const snapshots=[];
 for(const c of contexts)for(const p of c.pages()){
  try{snapshots.push(await p.evaluate(()=>({view:window.spike?.store?window.spike.store.view('page'):null,
   editor:document.getElementById('editor')?.value,status:document.getElementById('status')?.textContent,
   cloud:document.getElementById('cloud-body')?.textContent})).then(async value=>{
    value.view=await p.evaluate(()=>window.spike.store.view('page'));return value;
   }));}catch{}
 }
 evidence.push({status:'FAIL',error:error.stack,snapshots});process.exitCode=1;
}
finally{
 console.log(evidence.map(x=>`${x.id??'ERROR'} ${x.status} ${x.error??''}`).join('\n'));
 await writeFile('native-overlay/.generated/ui-results.json',JSON.stringify({browser:browser.version(),
  mode:'native live:true; multiInstance:true; leader election; ICE servers disabled for offline isolation',evidence,
  requests:remote.requests,faults:remote.faults},null,2)+'\n');
 for(const c of contexts)await c.close().catch(()=>{});await browser.close();await remote.close();await server.close();
}

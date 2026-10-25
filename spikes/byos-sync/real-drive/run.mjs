import {until} from './wait.mjs';
// Real-service runner: drives normal browser controls; no token extraction,
// storageState export, trace recording, private WAL edits or consent automation.
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const url=process.env.BYOS_DEMO_URL,clientId=process.env.BYOS_PUBLIC_CLIENT_ID;
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const criteria=Object.fromEntries(['R1','R2','R3','R4','R5','R6','R7'].map(k=>[k,'NOT_RUN_AUTH']));
if(!url||!clientId||!process.argv.includes('--interactive')){
 console.log(JSON.stringify({status:'NOT_RUN_AUTH',source,criteria,setup:'Set BYOS_DEMO_URL and BYOS_PUBLIC_CLIENT_ID (public only); run with --interactive after approved disposable-account OAuth setup. Human authorizes both profiles; no tokens in environment or arguments.'}));process.exitCode=2;
}else{
 const origin=new URL(url);
 assert(origin.protocol==='https:'&&/^[a-z0-9-]+\.innosage-tools\.pages\.dev$/.test(origin.hostname),'Only existing immutable Tools staging is allowed');
 assert(/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(clientId));
 const runId=crypto.randomUUID(),root=resolve('.byos-real',runId);await mkdir(root,{recursive:true,mode:0o700});
 const target=url+'?workspace='+runId,contexts=[],phases=[];let requests=0,lost=false,hold=false,loseEdit=null;
 const started=Date.now();let status='INCONCLUSIVE',reason=null;
 async function open(label){
  const c=await chromium.launchPersistentContext(resolve(root,label),{headless:false});contexts.push(c);
  await c.route('https://www.googleapis.com/**',async route=>{
   if(++requests>3000||Date.now()-started>1200000)return route.abort();
   if(hold)return route.abort();
   if(loseEdit&&route.request().method()==='PUT'&&(route.request().postData()??'').includes(loseEdit)){
    const response=await route.fetch();if(response.ok()){lost=true;hold=true;return route.abort();}return route.fulfill({response});
   }
   return route.continue();
  });
  const p=await c.newPage();await p.goto(target);await p.waitForFunction(()=>window.byos&&window.spike?.ready);await p.locator('#oauth-client').fill(clientId);
  return {c,p,label};
 }
 const snap=p=>p.evaluate(()=>window.byos.snapshot());
 async function consent(p,label){console.log(`Human action in Profile ${label}: confirm disposable account and click Authorize test account (twice on first load). Sign in/approve drive.file in Google. No secrets in terminal.`);await until(p,async()=>(await window.byos.snapshot()).transport.authorized,{},{timeout:600000});}
 async function save(p,body){await p.locator('#editor').fill(body);await p.locator('#save-btn').click();await p.waitForFunction(t=>window.spike.lastSaveAcknowledgement?.body===t,body);return (await snap(p)).view.journal.draft;}
 async function verify(p){await p.locator('#verify-btn').click();await until(p,async()=>{const s=await window.byos.snapshot();return s.lastRemote&&s.view.page?.body===s.lastRemote.body&&!s.view.journal;},{},{timeout:180000});return snap(p);}
 async function receive(p,doc){await p.locator('#sync-btn').click();await until(p,async d=>{const s=await window.byos.snapshot();return !s.busy&&s.view.page?.editId===d.editId&&s.view.page.body===d.body&&document.querySelector('#editor').value===d.body;},doc,{timeout:180000});}
 async function record(name,clients){const receipts=[];for(const x of clients)receipts.push({profile:x.label,...await snap(x.p)});phases.push({name,receipts});}
 try{
  const a=await open('A'),b=await open('B');await consent(a.p,'A');await consent(b.p,'B');
  const A=await save(a.p,`# ${runId} A\n\n**Full Markdown** 中文\n\n\`\`\`js\nconst value = 1;\n\`\`\`\n`);await verify(a.p);await receive(b.p,A);
  const B=await save(b.p,`# ${runId} B\n\nIndependent profile returns the complete body.\n- one\n- two\n`);await verify(b.p);await receive(a.p,B);await record('A-Drive-B-Drive-A',[a,b]);criteria.R2='PASS';
  await a.c.setOffline(true);const offline=await save(a.p,`# ${runId} offline\n\nAcknowledged before full profile close.\n`);const prior=await snap(a.p);await a.c.close();const reopened=await open('A');a.c=reopened.c;a.p=reopened.p;
  assert.equal((await snap(a.p)).session,prior.session);assert.deepEqual((await snap(a.p)).view.journal.draft,offline);await consent(a.p,'A reopened');await verify(a.p);await receive(b.p,offline);await record('offline-reopen',[a,b]);criteria.R3='PASS';
  for(const choice of ['cloud','local','merge']){
   const base=await snap(a.p);await receive(b.p,base.view.page);
   const local=await save(a.p,`# ${runId} conflict ${choice} local\n\nProtected complete local body.`);
   const cloud=await save(b.p,`# ${runId} conflict ${choice} cloud\n\nIndependent cloud body.`);await verify(b.p);
   await a.p.locator('#sync-btn').click();await until(a.p,async()=>!!(await window.byos.snapshot()).view.journal?.sourceCloud,{},{timeout:180000});
   const conflict=await snap(a.p);assert.equal(conflict.view.journal.sourceLocal.body,local.body);assert.equal(conflict.view.journal.sourceCloud.body,cloud.body);await record('conflict-'+choice,[a,b]);
   if(choice==='merge'){await a.p.locator('#merge-manual-btn').click();await a.p.locator('#merge-editor').fill(local.body+'\n\n'+cloud.body);await a.p.locator('#commit-merge-btn').click();}
   else await a.p.locator(choice==='cloud'?'#use-cloud-btn':'#keep-local-btn').click();
   if(choice==='cloud')await until(a.p,async()=>!(await window.byos.snapshot()).view.journal,{},{timeout:180000});
   else{await until(a.p,async()=> (await window.byos.snapshot()).view.journal?.state==='pending',{},{timeout:180000});await verify(a.p);}
   const resolved=await snap(a.p);const expected=choice==='cloud'?cloud.body:choice==='local'?local.body:local.body+'\n\n'+cloud.body;
   assert.equal(resolved.view.page.body,expected);
   if(choice==='cloud')assert.equal(resolved.view.page.editId,cloud.editId);
   else {assert.equal(resolved.lastRemote.body,expected);assert.equal(resolved.lastRemote.editId,resolved.view.page.editId);assert.notEqual(resolved.view.page.editId,cloud.editId);}
   await receive(b.p,resolved.view.page);assert.equal((await snap(b.p)).view.page.body,expected);await record('resolved-'+choice,[a,b]);
  }criteria.R4='PASS';
  const uncertain=await save(a.p,`# ${runId} uncertain\n\nSuccessful write with lost response.`);loseEdit=uncertain.editId;await a.p.locator('#sync-btn').click();
  for(let i=0;i<180&&!lost;i++)await new Promise(r=>setTimeout(r,500));assert(lost,'real successful write boundary not reached');
  const retained=await snap(a.p);assert.equal(retained.view.journal.draft.editId,uncertain.editId);assert.notEqual(retained.view.status,'remote-verified');await record('real-write-response-lost',[a]);
  hold=false;loseEdit=null;await verify(a.p);await receive(b.p,uncertain);await record('uncertain-recovered',[a,b]);
  await a.c.route('https://www.googleapis.com/**',route=>route.fulfill({status:401,contentType:'application/json',body:'{"error":{"code":401}}'}));
  const denied=await save(a.p,`# ${runId} unauthorized\n\nRetain this local body.`);await a.p.locator('#sync-btn').click();await until(a.p,async()=> (await window.byos.snapshot()).view.status==='reauth-required',{},{timeout:60000});assert.equal((await snap(a.p)).view.journal.draft.editId,denied.editId);await record('client-injected-401-not-provider-revocation',[a]);
  criteria.R5='CONDITIONAL: real lost response recovered; client-injected 401, actual expiry/revocation NOT_PROVEN';
  criteria.R1='CONDITIONAL: actual browser APIs exercised; inspect request/header/pagination coverage';criteria.R6='PASS';criteria.R7='PENDING_REVIEW';status='CONDITIONAL';
 }catch(e){reason=e.name==='TimeoutError'?'BOUND_REACHED_OR_AUTH_NOT_COMPLETED':'ASSERTION_OR_RUNTIME_FAILURE';}
 finally{for(const c of contexts)await c.close().catch(()=>{});const receipt={status,source,runId,criteria,reason,requests,elapsedMs:Date.now()-started,quotaCost:'UNKNOWN',phases,toolchain:JSON.parse(await readFile('spikes/byos-sync/real-drive/toolchain.json'))};await writeFile(resolve(root,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});console.log(JSON.stringify({status,criteria,requests,runId,reason}));if(status!=='PASS')process.exitCode=2;}
}

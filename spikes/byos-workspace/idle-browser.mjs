// Fresh task-owned Chrome and local mock only. No existing profiles or Google traffic.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve} from './server.mjs';
import {mockProvider} from './mock-provider.mjs';
const require=createRequire(new URL('../byos-sync/package.json',import.meta.url));
const {chromium}=require('playwright');
const server=await serve(0,{idleTest:true}),remote=await mockProvider();let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext();await context.route('**/*',route=>{assert([server.url,remote.url].includes(new URL(route.request().url()).origin));return route.continue();});
 const page=await context.newPage(),errors=[],failedRequests=[];let phase='setup';page.on('pageerror',e=>errors.push({message:e.message,stack:e.stack,phase,at:Date.now()}));page.on('requestfailed',r=>failedRequests.push({path:new URL(r.url()).pathname,method:r.method(),failure:r.failure(),phase}));
 const url=server.url+'/?workspace=az'+crypto.randomUUID().replaceAll('-','')+'&endpoint='+encodeURIComponent(remote.url);
 await page.goto(url);await page.waitForFunction(()=>window.workspaceDemo?.ready);
 const ids=await page.evaluate(async()=>{const ids=[];for(let i=0;i<26;i++){const result=await window.workspaceDemo.workspace.create({title:'AZ142 '+String.fromCharCode(65+i),markdown:'initial '+i,order:i});ids.push(result.page.id);}return ids;});
 await page.evaluate(async()=>{const w=window.workspaceDemo.workspace;await w.sync();for(const p of (await w.catalog()).pages)await w.verify(p.id);});
 await page.waitForFunction(()=>document.querySelectorAll('.tree-row').length>=26);
 // Already-started create is a local mutation fenced before admission.
 await page.evaluate(()=>{const store=window.workspaceDemo.store,save=store.save.bind(store);store.save=async(...args)=>{store.save=save;await new Promise(resolve=>window.releaseCreate=resolve);return save(...args);};});
 await page.locator('#new-root-btn').click();await page.waitForFunction(()=>!!window.releaseCreate);
 assert.equal(await page.locator('#idle-start').isDisabled(),true);
 await page.evaluate(()=>document.querySelector('#idle-start').dispatchEvent(new Event('click')));
 assert.equal(await page.evaluate(()=>!!window.workspaceIdleSnapshot),false);
 await page.evaluate(()=>window.releaseCreate());await page.waitForFunction(()=>document.querySelector('#page-title').value==='New Project');
 await page.locator('#verify-btn').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Exact saved generation cloud verified'));
 // Hold admission across another scheduler attempt and an input epoch change.
 await page.evaluate(()=>{const w=window.workspaceDemo.workspace,original=w.catalog.bind(w);w.catalog=async()=>{w.catalog=original;await new Promise(resolve=>window.releaseAdmission=resolve);return original();};});
 await page.locator('#idle-start').click();await page.waitForFunction(()=>!!window.releaseAdmission);
 assert.equal(await page.locator('#foreground-start-btn').isDisabled(),true);
 assert.equal(await page.locator('#new-root-btn').isDisabled(),true);assert.equal(await page.locator('#new-child-btn').isDisabled(),true);
 await page.evaluate(()=>{document.querySelector('#foreground-start-btn').dispatchEvent(new Event('click'));document.querySelector('#new-root-btn').dispatchEvent(new Event('click'));document.querySelector('#new-child-btn').dispatchEvent(new Event('click'));document.querySelector('#editor').dispatchEvent(new Event('input',{bubbles:true}));window.releaseAdmission();});
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Idle experiment refused'));
 assert.equal(await page.evaluate(()=>!!window.workspaceIdleSnapshot),false);
 assert.match(await page.locator('#foreground-status').textContent(),/Off/);
 await page.locator('#save-btn').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Locally saved'));
 await page.locator('#verify-btn').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Exact saved generation cloud verified'));
 await page.locator('#idle-start').click();await page.waitForFunction(()=>!!window.workspaceIdleSnapshot);
 phase='timed-edit';const started=Date.now();
 for(let i=0;i<26;i++){
  await page.getByText('AZ142 '+String.fromCharCode(65+i),{exact:true}).click();
  await page.waitForFunction(id=>document.querySelector('#meta-page-id').textContent.includes(id),ids[i]);
  await page.locator('#editor').fill('Final '+String.fromCharCode(65+i)+'\n'+'x'.repeat(4096));
 }
 const lastInputAt=Date.now();
 await page.waitForFunction(()=>['safe-to-close','halted'].includes(window.workspaceIdleSnapshot().run.state),null,{timeout:120000});
 const evidence=await page.evaluate(()=>window.workspaceIdleSnapshot());assert.equal(evidence.run.state,'safe-to-close',JSON.stringify(evidence.run));
 phase='ready-regressions';
 // A repeated unchanged Save must not create a new untracked journal after ready.
 const beforeRepeat=await page.evaluate(()=>window.workspaceIdleSnapshot().events.filter(e=>e.type==="durable").length);
 await page.locator('#save-btn').click();
 assert.equal(await page.evaluate(()=>window.workspaceIdleSnapshot().run.ready),true);
 assert.equal(await page.evaluate(async()=> (await window.workspaceDemo.store.db.localDrafts.find().exec()).length),0);
 assert.equal(await page.evaluate(()=>window.workspaceIdleSnapshot().events.filter(e=>e.type==="durable").length),beforeRepeat);
 // A held local commit immediately invalidates ready and cannot certify its input.
 await page.evaluate(()=>{const store=window.workspaceDemo.store,save=store.save.bind(store);store.save=async(...args)=>{store.save=save;await new Promise(resolve=>window.releaseIdleLocalSave=resolve);return save(...args);};});
 await page.locator('#editor').fill('Final Z\n'+'x'.repeat(4096)+' newer');
 await page.locator('#save-btn').click();await page.waitForFunction(()=>!!window.releaseIdleLocalSave);
 assert.equal(await page.evaluate(()=>window.workspaceIdleSnapshot().run.ready),false);
 await page.evaluate(()=>window.releaseIdleLocalSave());
 await page.waitForFunction(()=>['safe-to-close','halted'].includes(window.workspaceIdleSnapshot().run.state),null,{timeout:120000});
 assert.equal(await page.evaluate(()=>window.workspaceIdleSnapshot().run.ready),true);
 const expected=await page.evaluate(async()=>{const w=window.workspaceDemo.workspace,c=await w.catalog();return c.pages;});
 assert.equal(expected.length,27);for(let i=0;i<26;i++)assert.equal(expected.find(p=>p.id===ids[i]).markdown,'Final '+String.fromCharCode(65+i)+'\n'+'x'.repeat(4096)+(i===25?' newer':''));
 assert.equal(evidence.run.pages.every(p=>p.generation&&p.saved===p.generation&&p.verified===p.generation),true);
 const z=evidence.events.filter(e=>e.id===ids[25]);assert.ok(z.find(e=>e.type==='durable').atMs-z.find(e=>e.type==='input').atMs>=5000);
 const finalEvidence=await page.evaluate(()=>window.workspaceIdleSnapshot());
 // Actual tab close/reopen retains exact records. Safe-close does not persist a stale green flag.
 phase='closing-verified-tab';await page.close();const reopened=await context.newPage();await reopened.goto(url);await reopened.waitForFunction(()=>window.workspaceDemo?.ready);
 const actual=await reopened.evaluate(async()=> (await window.workspaceDemo.workspace.catalog()).pages);assert.deepEqual(actual,expected);
 assert.equal(await reopened.locator('#idle-status').getAttribute('data-state'),null);
 if(errors.length||failedRequests.length)console.log(JSON.stringify({diagnosticErrors:errors,failedRequests:failedRequests.slice(0,20)}));
 assert.deepEqual(errors,[]);
 const output=new URL('.generated/idle-ui/',import.meta.url);await mkdir(output,{recursive:true});
 await writeFile(new URL('evidence.json',output),JSON.stringify({status:'PASS',scope:'ACTUAL_CHROME_LOCAL_NATIVE_MOCK',realGoogleRequests:0,started,lastInputAt,observedAt:Date.now(),requests:remote.requests.length,exact26RecordsAfterReopen:true,evidence,finalEvidence,shutdownErrors:errors},null,2));
 console.log(JSON.stringify({status:'PASS',scope:'CHROME_LOCAL_NATIVE_MOCK',realGoogleRequests:0,requests:remote.requests.length,exact26RecordsAfterReopen:true,errors}));await context.close();
}finally{if(browser)await browser.close();await server.close();await remote.close();}

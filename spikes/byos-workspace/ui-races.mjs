// UI callback lifecycle fault injection ONLY; no real/provider evidence.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {serve} from './server.mjs';
const require=createRequire(new URL('../byos-sync/package.json',import.meta.url));
const {chromium}=require('playwright');const server=await serve();let browser;
try {
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage();await page.route('**/*',route=>{assert.equal(new URL(route.request().url()).origin,server.url);return route.continue();});
 await page.goto(server.url+'/?workspace=races'+crypto.randomUUID().replaceAll('-',''));await page.waitForFunction(()=>window.workspaceDemo?.ready);
 await page.locator('#new-root-btn').click();await page.waitForFunction(()=>document.querySelector('#meta-page-id').textContent.includes('w142_'));
 await page.locator('#page-title').fill('Page A');await page.locator('#save-btn').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Locally saved'));
 await page.locator('#new-root-btn').click();await page.waitForFunction(()=>document.querySelector('#page-title').value==='New Project');
 await page.locator('#page-title').fill('Page B');await page.locator('#save-btn').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Locally saved'));
 const select=async title=>{await page.locator('.tree-row').filter({has:page.locator('.tree-title-text',{hasText:title})}).click();await page.waitForFunction(title=>document.querySelector('#page-title').value===title,title);};
 await select('Page A');
 await page.evaluate(()=>{window.workspaceDemo.workspace.verify=()=>new Promise(resolve=>{window.finishVerify=resolve;});});
 await page.locator('#verify-btn').click();await page.waitForFunction(()=>!!window.finishVerify);
 await select('Page B');await page.locator('#editor').fill('B newer typing');await page.evaluate(()=>window.finishVerify());
 await page.waitForTimeout(80);assert.equal(await page.locator('#page-title').inputValue(),'Page B','late verify must not navigate back');
 assert.equal(await page.locator('#editor').inputValue(),'B newer typing');assert.doesNotMatch(await page.locator('#status').textContent(),/Cloud verified successfully/,'cannot claim current dirty input verified');
 // Make resolution controls visible: lifecycle stub does not emulate native CAS.
 await page.evaluate(()=>{document.querySelector('#conflict-section').style.display='block';window.workspaceDemo.workspace.resolve=()=>new Promise(resolve=>{window.finishResolve=resolve;});});
 await page.locator('#use-cloud-btn').click();await page.waitForFunction(()=>!!window.finishResolve);
 await page.locator('#editor').fill('B typing DURING resolution');await page.evaluate(()=>window.finishResolve());await page.waitForTimeout(100);
 assert.equal(await page.locator('#editor').inputValue(),'B typing DURING resolution','late resolve must preserve newer input');
 // Hold a real local journal boundary while page navigation is trying to save.
 await page.evaluate(()=>{
   let first=true;
   window.workspaceDemo.store.hook=async(name)=>{
     if(name==='before-journal-update'&&first){first=false;window.localCommitEntered=true;await new Promise(resolve=>{window.releaseCommit=resolve;});}
   };
 });
 await page.locator('.tree-row').filter({has:page.locator('.tree-title-text',{hasText:'Page A'})}).click();
 await page.waitForFunction(()=>window.localCommitEntered);
 await page.locator('#editor').fill('B latest input during local commit');await page.evaluate(()=>window.releaseCommit());
 await page.waitForTimeout(100);
 assert.equal(await page.locator('#page-title').inputValue(),'Page B','navigation must remain on newly dirty page');
 assert.equal(await page.locator('#editor').inputValue(),'B latest input during local commit');
 await page.evaluate(()=>{window.workspaceDemo.store.hook=async()=>{};});
 await page.locator('#save-btn').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Locally saved'));
 await select('Page A');
 const savedB=await page.evaluate(async()=> (await window.workspaceDemo.workspace.catalog()).pages.find(p=>p.title==='Page B'));
 assert.equal(savedB.markdown,'B latest input during local commit');
 // Unreadable source must remain visible as exact raw recovery, not disappear.
 await page.evaluate(async()=>{await window.workspaceDemo.store.save('w142_unreadable','RAW_INVALID_ENVELOPE_EXACT');});
 await page.waitForFunction(()=>document.querySelector('.invalid-envelope-recovery')?.textContent.includes('RAW_INVALID_ENVELOPE_EXACT'));
 // A valid intentionally empty editor must stay empty in the full merge template.
 await page.locator('#editor').fill('');
 await page.evaluate(async()=>{
   const store=window.workspaceDemo.store;
   const a=(await window.workspaceDemo.workspace.catalog()).pages.find(p=>p.title==='Page A');
   const journal=await store.db.localDrafts.findOne(a.id+':'+store.session).exec();
   await journal.incrementalModify(row=>({...row,state:'needs-resolution'}));
 });
 await page.waitForFunction(()=>JSON.parse(document.querySelector('#merge-editor').value||'{}').markdown==='');
 // Target read held during navigation: typing must retain old page ownership.
 await page.locator('#editor').fill('A before loading target');await page.locator('#save-btn').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Locally saved'));
 await page.evaluate(()=>{
   const controller=window.workspaceDemo.workspace;window.originalRead=controller.read.bind(controller);
   controller.read=async id=>{const result=await window.originalRead(id);if(result.page?.title==='Page B'&&!window.targetReadEntered){window.targetReadEntered=true;await new Promise(resolve=>{window.releaseTargetRead=resolve;});}return result;};
 });
 await page.locator('.tree-row').filter({has:page.locator('.tree-title-text',{hasText:'Page B'})}).click();await page.waitForFunction(()=>window.targetReadEntered);
 await page.locator('#editor').fill('A typed while B loading');await page.evaluate(()=>window.releaseTargetRead());await page.waitForTimeout(100);
 assert.equal(await page.locator('#page-title').inputValue(),'Page A');assert.equal(await page.locator('#editor').inputValue(),'A typed while B loading');
 await page.evaluate(()=>{window.workspaceDemo.workspace.read=window.originalRead;});
 await page.locator('#save-btn').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Locally saved'));
 const bUnchanged=await page.evaluate(async()=> (await window.workspaceDemo.workspace.catalog()).pages.find(p=>p.title==='Page B'));
 assert.equal(bUnchanged.markdown,'B latest input during local commit');
 // Same input generation can mint a new native editId; the old receipt is stale.
 await page.evaluate(()=>{
   const {workspace:controller,store}=window.workspaceDemo;
   controller.verify=async id=>{
     const old=await controller.read(id);old.cloudVerified=true;
     await store.save(id,old.baseline.body,{base:old.baseline});
     return old;
   };
 });
 await page.locator('#verify-btn').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Older saved-generation verification finished'));
 assert.doesNotMatch(await page.locator('#status').textContent(),/Exact saved generation cloud verified/);
 console.log(JSON.stringify({status:'PASS',scope:'UI_CALLBACK_INJECTION_ONLY',checks:['late-verify-selection-generation','late-cloud-resolution-newer-typing','newer-input-during-navigation-commit','raw-malformed-recovery','empty-markdown-merge','typing-during-target-read','native-editId-advanced-without-input-generation']}));
}finally{if(browser)await browser.close();await server.close();}

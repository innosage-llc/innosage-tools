import {chromium} from 'playwright';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const supplied=process.env.BYOS_DEMO_URL;
let server;
if(!supplied){server=http.createServer(async(req,res)=>{try{const js=req.url.split('?')[0].endsWith('app.js');res.setHeader('Content-Type',js?'text/javascript':'text/html');res.end(await readFile(resolve('public/byos-demo',js?'app.js':'index.html')));}catch{res.statusCode=500;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));}
const base=supplied??`http://127.0.0.1:${server.address().port}/tools/byos-demo/index.html`;
const workspace=crypto.randomUUID(),url=base+'?workspace='+workspace;
const root=resolve('.byos-real','offline-'+Date.now());await mkdir(root,{recursive:true,mode:0o700});
const contexts=[];let external=0;const errors=[];
async function open(label){const c=await chromium.launchPersistentContext(resolve(root,label),{headless:true});contexts.push(c);await c.route('**/*',route=>{if(new URL(route.request().url()).origin!==new URL(base).origin){external++;return route.abort();}return route.continue();});const p=await c.newPage();p.on('pageerror',e=>{errors.push(e.message);console.error('PAGE_ERROR',e.message);});await p.goto(url);await p.waitForFunction(()=>window.byos&&window.spike?.ready,{},{timeout:15000});return {c,p};}
const text='# Offline acknowledged content\n\nFull Markdown, **bold**, 中文.\n\n```js\nconst safe = true;\n```\n';
try{
 let a=await open('A');const b=await open('B');
 await a.p.locator('#editor').fill(text);await a.p.locator('#save-btn').click();await a.p.waitForFunction(t=>window.spike.lastSaveAcknowledgement?.body===t,text);
 const before=await a.p.evaluate(()=>window.byos.snapshot());const second=await b.p.evaluate(()=>window.byos.snapshot());
 assert.notEqual(before.session,second.session);assert.equal(second.view.body,'');assert.equal(before.view.journal.draft.body,text);
 await a.p.locator('#sync-btn').click();await a.p.waitForFunction(()=>/reauth/i.test(document.querySelector('#status').textContent));
 assert.equal((await a.p.evaluate(()=>window.byos.snapshot())).view.journal.draft.editId,before.view.journal.draft.editId);
 const duplicate=await a.c.newPage();await duplicate.goto(url);await duplicate.waitForFunction(()=>window.byos&&window.spike?.ready);assert.equal((await duplicate.evaluate(()=>window.byos.snapshot())).view.writer,false);await duplicate.close();
 await a.c.close();a=await open('A');const after=await a.p.evaluate(()=>window.byos.snapshot());assert.equal(after.session,before.session);assert.equal(after.view.body,text);assert.deepEqual(after.view.journal,before.view.journal);
 assert.equal(await a.p.locator('#editor').inputValue(),text);assert.equal(external,0);assert.deepEqual(errors,[]);
 for(const selector of ['#oauth-client','#authorize-btn','#sync-btn','#verify-btn','#use-cloud-btn','#keep-local-btn','#merge-manual-btn'])assert.equal(await a.p.locator(selector).isVisible(),true);
 const storage=await a.p.evaluate(()=>JSON.stringify({...localStorage}));assert.doesNotMatch(storage,/access_token|Bearer|refresh_token/);
 const receipt={status:'PASS',kind:supplied?'STAGING_UI':'LOCAL_BROWSER',browser:a.c.browser().version(),source:process.env.BYOS_SOURCE_SHA??'working-tree',workspace,body:text,editId:before.view.journal.draft.editId,stableIdentity:true,twoIndependentProfiles:true,duplicateWriterRefused:true,noAuthNoNetwork:true,externalRequests:external,realProvider:'NOT_RUN_AUTH'};
 await writeFile(resolve(root,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{for(const c of contexts)await c.close().catch(()=>{});if(server)await new Promise(r=>server.close(r));}

// Focused offline-shell boundary: no Google calls, routing or OAuth stubs.
import {chromium} from 'playwright';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('.byos-real','shell-'+Date.now());await mkdir(root,{recursive:true});
let corruptUpdate=false;
const server=http.createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 const file=path==='/byos-demo/'?'index.html':path==='/tools/byos-demo/app.js'?'app.js':path==='/byos-demo/sw.js'?'sw.js':null;
 if(!file){res.writeHead(404).end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.setHeader('Cache-Control','no-store');let bytes=await readFile('public/byos-demo/'+file);if(corruptUpdate&&file==='sw.js')bytes=Buffer.concat([bytes,Buffer.from('\n// changed worker update')]);if(corruptUpdate&&file==='app.js')bytes=Buffer.from('/* corrupt incomplete deployment */');res.end(bytes);}
 catch{res.writeHead(404).end();}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,workspace=crypto.randomUUID(),url=origin+'/byos-demo/?workspace='+workspace;
let context;const external=[];const errors=[];
const body='# Offline persistent shell\n\n中文 **full body** café\n\n```js\nconst retained = true;\n```\n';
try{
 context=await chromium.launchPersistentContext(resolve(root,'profile'),{headless:true});
 context.on('request',r=>{if(new URL(r.url()).origin!==origin)external.push(r.url());});
 let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>window.spike?.ready);
 await page.waitForFunction(()=>window.byos.offlineShell?.status==='ready',{},{timeout:10000});
 await page.locator('#editor').fill(body);await page.locator('#save-btn').click();
 await page.waitForFunction(t=>window.spike.lastSaveAcknowledgement?.body===t,body);
 const before=await page.evaluate(()=>window.byos.snapshot());assert(before.view.journal);
 // An update whose paired bundle fails integrity cannot replace the good shell.
 corruptUpdate=true;
 await page.evaluate(async()=>{
  const registration=await navigator.serviceWorker.getRegistration();
  let timer;
  const rejected=new Promise(resolve=>registration.addEventListener('updatefound',()=>{
   const worker=registration.installing;worker.addEventListener('statechange',()=>{if(worker.state==='redundant')resolve();});
  },{once:true}));
  try{await Promise.race([(async()=>{await registration.update();await rejected;})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Corrupt shell rejection bound reached')),20000);})]);}
  finally{clearTimeout(timer);}
 });
 corruptUpdate=false;
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.spike?.ready);
 let after=await page.evaluate(()=>window.byos.snapshot());assert.equal(after.view.body,body);assert.deepEqual(after.view.journal,before.view.journal);assert.equal(after.session,before.session);assert.equal(after.transport.authorized,false);assert.equal(after.transport.requests.length,0);
 // Browser process exit/reopen, not a same-page fake IndexedDB reopen.
 await context.close();context=await chromium.launchPersistentContext(resolve(root,'profile'),{headless:true,offline:true});
 context.on('request',r=>{if(new URL(r.url()).origin!==origin)external.push(r.url());});
 page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>window.spike?.ready);
 after=await page.evaluate(()=>window.byos.snapshot());assert.equal(after.view.body,body);assert.deepEqual(after.view.journal,before.view.journal);assert.equal(after.session,before.session);
 const cache=await page.evaluate(async()=>{const names=(await caches.keys()).filter(n=>n.startsWith('byos113-shell-'));return Promise.all(names.map(async name=>({name,urls:(await (await caches.open(name)).keys()).map(r=>r.url)})));});
 assert.equal(cache.length,1);assert.equal(cache[0].urls.length,2);
 assert(cache[0].urls.every(u=>new URL(u).origin===origin&&!u.includes(workspace)));
 assert(cache[0].urls.some(u=>new URL(u).pathname==='/byos-demo/'));
 assert(cache[0].urls.some(u=>/^\/tools\/byos-demo\/app\.js\?revision=[a-f0-9]{64}$/.test(new URL(u).pathname+new URL(u).search)));
 await context.setOffline(false);await page.locator('#verify-btn').click();
 await page.waitForFunction(()=>document.getElementById('status').textContent==='reauth-required');
 assert.equal((await page.evaluate(()=>window.byos.snapshot())).view.journal.draft.editId,before.view.journal.draft.editId);
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 const receipt={kind:'OFFLINE_STATIC_SHELL',status:'PASS',sameSession:true,fullBody:body,editId:before.view.journal.draft.editId,rejectedCorruptUpdateKeepsPriorShell:true,reloadOffline:true,processReopenOffline:true,cacheOnlyStaticPair:true,authNotPersisted:true,noAuthRetryRetainsIntent:true,googleRequests:0,cache};
 await writeFile(resolve(root,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{await context?.close();await new Promise(r=>server.close(r));}

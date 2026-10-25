import {chromium} from 'playwright';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {serve} from './server.mjs';
const server=await serve();const evidence=new URL('./evidence/',import.meta.url);await mkdir(evidence,{recursive:true});
const results=[],errors=[],external=[];
const executablePath='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
async function open(profile){const context=await chromium.launchPersistentContext(profile,{executablePath,headless:true,viewport:{width:1440,height:1100}});await context.route('**/*',route=>{if(new URL(route.request().url()).origin===server.url)return route.continue();external.push(route.request().url());return route.abort();});context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));return context;}
async function ready(page,url){await page.goto(url);await page.waitForFunction(()=>!!window.ux);}
async function saved(page,body){await page.locator('#editor').fill(body);await page.waitForFunction(body=>window.ux.snapshot().draft.body===body&&window.ux.snapshot().local==='saved',body);return page.evaluate(()=>window.ux.snapshot());}
try {
 await Promise.all([12,10000].map(async size=>{
  const profile=await mkdtemp(join(tmpdir(),'byos-ux-136-'));let context=await open(profile);let page=await context.newPage();const url=`${server.url}/?size=${size}&workspace=browser-evidence`;
  await ready(page,url);const row={size,bodyCharacters:4096,timingMethod:'20 sequential Playwright fill → matching edit durable ACK, browser performance.now; real wall clock, not fake clock',samplesMs:[]};
  await page.locator('#latency').selectOption('never');
  for(let i=0;i<20;i++){
   const body=`# measurement ${i}\n`+'x'.repeat(4096-String(`# measurement ${i}\n`).length);
   const start=await page.evaluate(()=>performance.now());await saved(page,body);row.samplesMs.push((await page.evaluate(()=>performance.now()))-start);
  }
  row.metrics=await page.evaluate(()=>window.ux.sim.metrics);assert.equal(row.metrics.bodyReads,0);assert.equal(row.metrics.sends,1);
  assert.match(await page.locator('#localStatus').textContent(),/Locally saved/);
  await page.locator('#handoff').click();assert.match(await page.locator('#handoffStatus').textContent(),/INCOMPLETE/);
  await page.locator('#cancel').click();await page.locator('#late').click();assert.equal(await page.evaluate(()=>window.ux.sim.destination('page-1')),null);
  const full=`# acknowledged offline ${size}\n`+'Full preserved paragraph.\n'.repeat(160);
  const before=await saved(page,full);const identity=before.draft.editId;
  await page.screenshot({path:new URL(`pending-${size}.png`,evidence).pathname,fullPage:true});
  // Entire Chrome process/context closes; reopen same profile and origin.
  await context.close();context=await open(profile);page=await context.newPage();await ready(page,url);
  const recovered=await page.evaluate(()=>window.ux.snapshot());assert.equal(recovered.draft.body,full);assert.equal(recovered.draft.editId,identity);assert.equal(recovered.pendingPages,1);assert.equal(recovered.cloud,'uncertain');
  row.browserRestart={bodyExact:true,editIdentityExact:true,pendingPages:recovered.pendingPages,cloud:recovered.cloud};
  // Offline then auth interruption, no transport/confirmation; explicit retry.
  await page.locator('#fault').selectOption('offline');await saved(page,'offline full acknowledged body');
  assert.match(await page.locator('#cloudStatus').textContent(),/offline/);
  await page.locator('#fault').selectOption('auth');assert.match(await page.locator('#cloudStatus').textContent(),/authorization-needed/);
  await page.locator('#handoff').click();assert.match(await page.locator('#handoffStatus').textContent(),/INCOMPLETE/);
  row.realTimeOperations=[];
  for(const latency of [10000,45000]){
   await page.locator('#latency').selectOption(String(latency));const start=performance.now();await page.locator('#retry').click();
   await page.waitForFunction(()=>window.ux.snapshot().cloud==='confirmed',null,{timeout:latency+10000});
   const elapsed=performance.now()-start;assert(elapsed>=latency-100);row.realTimeOperations.push({labelMs:latency,observedWallMs:elapsed,clock:'REAL',provider:'SIMULATION'});
   await page.locator('#handoff').click();assert.match(await page.locator('#handoffStatus').textContent(),/handoff confirmed/);
   await page.locator('#fault').selectOption('offline');await saved(page,`newer after ${latency}`);assert.match(await page.locator('#handoffStatus').textContent(),/INCOMPLETE/);
  }
  await page.locator('[data-page="page-2"]').click();await saved(page,'inactive page full acknowledged body');
  await page.locator('[data-page="page-1"]').click();assert.equal(await page.locator('#editor').inputValue(),'newer after 45000');
  assert.equal(await page.evaluate(()=>window.ux.snapshot().pendingPages),2);
  await page.locator('#conflict').click();await page.waitForFunction(()=>!!window.ux.snapshot().conflict);await saved(page,'active typing during conflict');
  assert.equal(await page.locator('#editor').inputValue(),'active typing during conflict');assert.match(await page.locator('#remoteBody').textContent(),/Complete conflicting content/);
  await page.screenshot({path:new URL(`conflict-${size}.png`,evidence).pathname,fullPage:true});
  await page.locator('#keepLocal').click();await page.waitForFunction(()=>window.ux.snapshot().local==='saved'&&!window.ux.snapshot().conflict);
  assert.equal(await page.locator('#editor').inputValue(),'active typing during conflict');
  await page.locator('#failLocal').click();await page.locator('#editor').fill('failed persistence text');await page.waitForFunction(()=>window.ux.snapshot().local==='failed');
  assert.match(await page.locator('#localStatus').textContent(),/NOT SAVED/);
  row.browserScenarios=['restart exact full body/edit/pending','offline','auth','10s and 45s real-time simulated confirmation','handoff incomplete/confirmed/new edit','page switch distinct backlog','conflict typing retained + Keep local','local persistence failure no ACK'];
  row.typingP50Ms=[...row.samplesMs].sort((a,b)=>a-b)[10];row.typingMaxMs=Math.max(...row.samplesMs);results.push(row);await context.close();
 }));
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(new URL('browser.json',evidence),JSON.stringify({status:'PASS',source:'working candidate; exact hashes in acceptance manifest',fixtureSizes:[12,10000],results,externalRequests:external,pageErrors:errors,humanUsability:'NOT_RUN',satisfaction:'UNKNOWN',limits:'Concurrent local synthetic browsers, 20 automation samples each; no human comprehension or Drive performance claim. Real time waits only prove simulated timers.'},null,2));
 console.log(JSON.stringify({status:'PASS',results:results.map(r=>({size:r.size,p50Ms:r.typingP50Ms,maxMs:r.typingMaxMs,realTimeOperations:r.realTimeOperations}))}));
}finally{await server.close();}

import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {serve} from './server.mjs';
const server=await serve(),browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const results=[],errors=[],external=[];
try {
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin===server.url)return route.continue();external.push(route.request().url());return route.abort();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.url+'/?workspace=focused');await page.waitForFunction(()=>window.ux);
 // Delay each IndexedDB enumeration to reproduce overlapping initialization.
 await page.evaluate(async()=>{
  const original=IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll=function(...args){const request=original.apply(this,args);let listener;Object.defineProperty(request,'onsuccess',{set(fn){listener=fn;request.addEventListener('success',event=>setTimeout(()=>listener(event),100));}});return request;};
  const switcher=window.ux.switchCatalog;
  await Promise.all([switcher(10000),switcher(12),switcher(10000),switcher(12)]);
 });
 assert.equal(await page.locator('#catalog').inputValue(),'12');assert.match(await page.locator('#catalogInfo').textContent(),/12 synthetic/);assert.equal(await page.locator('#editor').isEnabled(),true);
 const other=await context.newPage();await other.goto(server.url+'/?workspace=focused');await other.waitForFunction(()=>document.querySelector('#error').textContent.includes('already open'));assert.equal(await other.locator('#editor').isDisabled(),true);await other.close();results.push('delayed overlapping size switches serialize; final catalog and writer ownership retained');
 for(const size of [12,10000]){
  await page.evaluate(size=>window.ux.switchCatalog(size),size);await page.locator('#fault').selectOption('offline');
  for(const [button,expected] of [['useCloud','Complete conflicting content'],['keepLocal','latest local'],['merge','manual full merge']]){
   await page.locator('#editor').fill(`original local for ${button}`);await page.waitForFunction(()=>window.ux.snapshot().local==='saved');
   await page.locator('#conflict').click();await page.waitForFunction(()=>!!window.ux.snapshot().conflict);
   await page.locator('#editor').fill('latest local');await page.waitForFunction(()=>window.ux.snapshot().local==='saved');
   await page.locator('#mergeBody').fill('manual full merge');await page.locator('#'+button).click();await page.waitForFunction(()=>window.ux.snapshot().local==='saved'&&!window.ux.snapshot().conflict);
   assert((await page.locator('#editor').inputValue()).includes(expected));
   assert.equal(await page.locator('.conflict-history-drawer').isVisible(),true);await page.locator('.conflict-history-drawer summary').click();assert.match(await page.locator('#history').textContent(),/original local for/);assert.match(await page.locator('#history').textContent(),/Complete conflicting content/);await page.locator('.conflict-history-drawer summary').click();
  }
  await page.locator('#handoff').click();assert.match(await page.locator('#handoffStatus').textContent(),/INCOMPLETE/);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:new URL(`./evidence/final-${size}.png`,import.meta.url).pathname,fullPage:true});
  results.push(`${size}: all three UI resolutions; complete archived bodies visible after resolution; no horizontal overflow at 1280px`);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const hashes={};for(const file of ['app.mjs','model.mjs','storage.mjs','index.html','styles.css','server.mjs'])hashes[file]=createHash('sha256').update(await readFile(new URL(file,import.meta.url))).digest('hex');
 await writeFile(new URL('./evidence/focused-browser.json',import.meta.url),JSON.stringify({status:'PASS',results,sourceHashes:hashes,pageErrors:errors,externalRequests:external,humanUsability:'NOT_RUN'},null,2));
 console.log(JSON.stringify({status:'PASS',results}));
} finally {await browser.close();await server.close();}

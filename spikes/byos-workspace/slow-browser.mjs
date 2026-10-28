// Real-clock UI waiting tests with injected callbacks, never provider timings.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve} from './server.mjs';
const require=createRequire(new URL('../byos-sync/package.json',import.meta.url));
const {chromium}=require('playwright');const server=await serve();let browser;
const results=[];
try {
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 for(const delay of [10000,45000,null]) {
  const context=await browser.newContext();await context.route('**/*',route=>{assert.equal(new URL(route.request().url()).origin,server.url);return route.continue();});
  const page=await context.newPage();await page.goto(server.url+'/?workspace=slow'+crypto.randomUUID().replaceAll('-',''));await page.waitForFunction(()=>window.workspaceDemo?.ready);
  await page.locator('#new-root-btn').click();await page.waitForFunction(()=>document.querySelector('#meta-page-id').textContent.includes('w142_'));
  await page.evaluate(delay=>{window.workspaceDemo.workspace.sync=()=>new Promise(resolve=>{window.slowStarted=performance.now();if(delay!==null)setTimeout(()=>{window.slowFinished=performance.now();resolve();},delay);});},delay);
  await page.locator('#sync-btn').click();await page.waitForFunction(()=>!!window.slowStarted);
  assert.equal(await page.locator('#editor').isEnabled(),true);assert.equal(await page.locator('#save-btn').isEnabled(),true);assert.equal(await page.locator('#sync-btn').isDisabled(),true);
  await page.locator('#editor').fill('# Typed during injected '+delay);await page.locator('#save-btn').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Locally saved'));
  assert.equal(await page.locator('#sync-btn').isDisabled(),true);assert.match(await page.locator('#meta-verified').textContent(),/NO/);
  assert.equal(await page.evaluate(async()=> (await window.workspaceDemo.workspace.handoff()).complete),false);
  if(delay!==null)await page.waitForFunction(()=>!!window.slowFinished,null,{timeout:delay+10000});else await page.waitForTimeout(1200);
  const observed=await page.evaluate(()=>({elapsedMs:(window.slowFinished??performance.now())-window.slowStarted,finished:!!window.slowFinished,operationText:document.querySelector('#operation-status').textContent}));
  if(delay===null){assert.equal(observed.finished,false);assert.equal(await page.locator('#sync-btn').isDisabled(),true);}else {assert(observed.elapsedMs>=delay);await page.waitForTimeout(50);assert.match(await page.locator('#operation-status').textContent(),new RegExp('Elapsed: '+Math.floor(delay/1000)+'s'));}
  results.push({injectedDelayMs:delay,neverCompletes:delay===null,...observed,localEditSaveAvailable:true,handoffComplete:false});
  await context.close();
 }
 const out=new URL('.generated/slow/',import.meta.url);await mkdir(out,{recursive:true});await writeFile(new URL('evidence.json',out),JSON.stringify({status:'PASS',scope:'UI_CALLBACK_INJECTION_REAL_CLOCK_NOT_PROVIDER',results},null,2)+'\n');
 console.log(JSON.stringify({status:'PASS',scope:'UI_CALLBACK_INJECTION_REAL_CLOCK_NOT_PROVIDER',results}));
}finally{if(browser)await browser.close();await server.close();}

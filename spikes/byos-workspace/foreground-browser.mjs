// Actual Chrome UI/native loopback qualification; no existing profiles or Google.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve} from './server.mjs';
import {mock} from '../byos-sync/src/mock.mjs';
const require=createRequire(new URL('../byos-sync/package.json',import.meta.url));
const {chromium}=require('playwright');
const server=await serve(),remote=await mock();let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext();
  await context.route('**/*',route=>{assert([server.url,remote.url].includes(new URL(route.request().url()).origin));return route.continue();});
  const errors=[];
  async function open() {
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(server.url+'/?workspace=fg'+crypto.randomUUID().replaceAll('-','')+'&endpoint='+encodeURIComponent(remote.url));
    await page.waitForFunction(()=>window.workspaceDemo?.ready);
    await page.locator('#new-root-btn').click();await page.waitForFunction(()=>document.querySelector('#page-title').value==='New Project');
    return page;
  }
  const page=await open();
  const before=remote.requests.length;
  await page.locator('#editor').fill('Default explicit-only body');await page.locator('#save-btn').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Locally saved'));
  await page.waitForTimeout(1000);assert.equal(remote.requests.length,before,'default Save must not dispatch sync');
  await page.evaluate(()=>{
    const controller=window.workspaceDemo.workspace,original=controller.sync.bind(controller);window.foregroundCalls=0;
    controller.sync=async()=>{window.foregroundCalls++;if(window.foregroundCalls===1)await new Promise(resolve=>{window.releaseForeground=resolve;});return original();};
  });
  await page.locator('#foreground-start-btn').click();await page.waitForFunction(()=>!!window.releaseForeground);
  assert.match(await page.locator('#operation-status').textContent(),/foreground-sync/);
  assert.equal(await page.locator('#sync-btn').isDisabled(),true);assert.equal(await page.locator('#verify-btn').isDisabled(),true);
  assert.equal(await page.locator('#save-btn').isEnabled(),true);
  await page.locator('#editor').fill('Acknowledged while foreground held');await page.locator('#save-btn').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Locally saved'));
  await page.locator('#editor').fill('Unsaved typing during foreground completion');
  await page.evaluate(()=>window.releaseForeground());
  await page.waitForFunction(()=>document.querySelector('#foreground-status').dataset.state==='budget-exhausted',null,{timeout:30000});
  assert.equal(await page.evaluate(()=>window.foregroundCalls),2);
  assert.equal(await page.locator('#editor').inputValue(),'Unsaved typing during foreground completion');
  assert.match(await page.locator('#meta-verified').textContent(),/NO/);
  assert.equal(await page.locator('#foreground-start-btn').isDisabled(),true);
  await page.locator('#verify-btn').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Save current input locally'));
  await page.locator('#save-btn').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Locally saved'));
  await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>window.foregroundCalls),2,'exhaustion never rearms');
  await page.locator('#verify-btn').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Exact saved generation cloud verified'),null,{timeout:30000});
  assert.match(await page.locator('#meta-verified').textContent(),/YES/);
  const failure=await open();
  await failure.evaluate(()=>{window.failedCalls=0;window.workspaceDemo.workspace.sync=async()=>{window.failedCalls++;throw Error('injected cloud failure');};});
  await failure.locator('#foreground-start-btn').click();await failure.waitForFunction(()=>document.querySelector('#foreground-status').dataset.state==='halted');
  await failure.locator('#editor').fill('Retained after cloud failure');await failure.locator('#save-btn').click();
  await failure.waitForFunction(()=>document.querySelector('#status').textContent.includes('Locally saved'));
  await failure.waitForTimeout(1000);assert.equal(await failure.evaluate(()=>window.failedCalls),1);
  assert.equal(await failure.locator('#foreground-start-btn').isDisabled(),true);assert.equal(await failure.locator('#editor').inputValue(),'Retained after cloud failure');
  const manualFailure=await open();
  await manualFailure.evaluate(()=>{window.manualCalls=0;window.workspaceDemo.workspace.sync=async()=>{window.manualCalls++;throw Error('manual preflight failure');};});
  await manualFailure.locator('#foreground-start-btn').click();
  await manualFailure.locator('#sync-btn').click();
  await manualFailure.waitForFunction(()=>document.querySelector('#foreground-status').dataset.state==='halted');
  await manualFailure.locator('#editor').fill('Local intent after manual failure');await manualFailure.locator('#save-btn').click();
  await manualFailure.waitForTimeout(1000);
  assert.equal(await manualFailure.evaluate(()=>window.manualCalls),1,'failed manual action must not wake queued foreground work');
  assert.equal(await manualFailure.locator('#foreground-start-btn').isDisabled(),true);
  assert.deepEqual(errors,[]);
  const output=new URL('.generated/foreground-ui/',import.meta.url);await mkdir(output,{recursive:true});
  await page.screenshot({path:new URL('workspace.png',output).pathname,fullPage:true});
  const evidence={status:'PASS',scope:'CHROME_NATIVE_LOOPBACK_WITH_EXPLICIT_CALLBACK_HOLD_AND_FAILURE',realGoogleRequests:0,
    checks:['default-save-no-sync','explicit-opt-in','manual-cloud-actions-disabled-during-flight','local-save-during-flight','dirty-input-preserved','two-dispatch-limit-no-rearm','dirty-verify-refusal','explicit-verify-after-budget','error-halt-local-save-retained','manual-failure-halts-queued-foreground'],errors};
  await writeFile(new URL('evidence.json',output),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
  await context.close();
}finally{if(browser)await browser.close();await server.close();await remote.close();}

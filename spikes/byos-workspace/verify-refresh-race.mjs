// Narrow UI callback/refresh interleaving regression; no provider traffic.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {serve} from './server.mjs';
const require=createRequire(new URL('../byos-sync/package.json',import.meta.url));const {chromium}=require('playwright');
const server=await serve();let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage();await page.route('**/*',route=>{assert.equal(new URL(route.request().url()).origin,server.url);return route.continue();});
 await page.goto(server.url+'/?workspace=refresh'+crypto.randomUUID().replaceAll('-',''));await page.waitForFunction(()=>window.workspaceDemo?.ready);
 await page.locator('#new-root-btn').click();await page.waitForFunction(()=>document.querySelector('#meta-page-id').textContent.includes('w142_'));
 await page.evaluate(async()=>{
  const {workspace:controller,store}=window.workspaceDemo;const id=(await controller.catalog()).pages[0].id;
  const draft=await store.db.localDrafts.findOne(id+':'+store.session).exec();await draft.remove();store.verified.set(id,await store.page(id));store.notify();
 });
 await page.waitForFunction(()=>document.querySelector('#meta-verified').textContent==='Cloud Verified: YES');
 await page.evaluate(async()=>{
  const {workspace:controller,store}=window.workspaceDemo;const id=(await controller.catalog()).pages[0].id;
  const old=await controller.read(id);const catalog=controller.catalog.bind(controller),read=controller.read.bind(controller);
  controller.verify=async()=>old;
  controller.catalog=async()=>{
   if(!window.oldRefreshEntered){window.oldRefreshEntered=true;await new Promise(resolve=>{window.releaseOldRefresh=resolve;});}
   else if(window.holdNewRefresh){window.newRefreshEntered=true;await new Promise(resolve=>{(window.newRefreshReleases??=[]).push(resolve);});}
   return catalog();
  };
  controller.save=async(id,patch,baseline)=>{
   window.holdNewRefresh=true;
   const view=await store.save(id,old.baseline.body,{base:baseline});window.nativeSaveAck=true;
   return {page:(await read(id)).page,baseline:view.page,view};
  };
 });
 await page.locator('#verify-btn').click();await page.waitForFunction(()=>window.oldRefreshEntered);
 await page.evaluate(async()=>{
   const {workspace:controller,store}=window.workspaceDemo;window.holdNewRefresh=true;
   const id=(await store.db.pages.find().exec())[0].id;const old=await store.page(id);
   await store.save(id,old.body,{base:old});window.nativeSaveAck=true;
 });
 await page.waitForFunction(()=>window.nativeSaveAck&&window.newRefreshEntered);
 await page.evaluate(()=>window.releaseOldRefresh());
 await page.waitForTimeout(100);
 assert.doesNotMatch(await page.locator('#status').textContent(),/Exact saved generation cloud verified/,'superseded refresh cannot authorize positive current-generation status');
 await page.evaluate(()=>{window.holdNewRefresh=false;for(const release of window.newRefreshReleases??[])release();});
 console.log(JSON.stringify({status:'PASS',scope:'UI_CALLBACK_INTERLEAVING_ONLY',checks:['superseded-verify-refresh-with-held-new-native-generation']}));
}finally{if(browser)await browser.close();await server.close();}

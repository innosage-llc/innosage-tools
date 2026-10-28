// Local browser metrics only. In-flight is an explicitly held loopback request,
// never a measured Drive latency or simulated confirmation.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve} from './server.mjs';
import {mock} from '../byos-sync/src/mock.mjs';
const require=createRequire(new URL('../byos-sync/package.json',import.meta.url));
const {chromium}=require('playwright');
const out=new URL('.generated/metrics/',import.meta.url);await mkdir(out,{recursive:true});
const server=await serve(),remote=await mock();let browser;
const results=[];const errors=[];
const summary=values=>{const a=[...values].sort((a,b)=>a-b);return {n:a.length,p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)};};
try {
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 for(const size of [12,500]) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});let releaseRequest=null,held=false;
  await context.route('**/*',async route=>{
   const origin=new URL(route.request().url()).origin;
   assert([server.url,remote.url].includes(origin),'block non-loopback traffic');
   if(origin===remote.url&&held){held=false;await new Promise(resolve=>{releaseRequest=resolve;});}
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.url+'/?workspace=metrics'+crypto.randomUUID().replaceAll('-','')+'&endpoint='+encodeURIComponent(remote.url));
  await page.waitForFunction(()=>window.workspaceDemo?.ready);
  await page.evaluate(async size=>{
   const {store}=window.workspaceDemo;
   const records=Array.from({length:size},(_,i)=>({id:'w142_perf_'+i,body:JSON.stringify({format:'innosage-workspace-page',version:1,workspaceId:store.workspace,id:'w142_perf_'+i,title:'P'+i,parentId:null,order:i,markdown:'seed-'+i}),editId:'fixture-'+i}));
   const inserted=await store.db.pages.bulkInsert(records);if(inserted.error.length)throw Error('fixture insert failed');
   window.ackMetrics=[];const save=store.save.bind(store);
   store.save=async(...args)=>{const result=await save(...args);window.ackMetrics.push({id:args[0],body:args[1],editId:result.journal?.draft.editId,ms:performance.now()-window.inputStarted});return result;};
  },size);
  await page.waitForFunction(size=>document.querySelectorAll('.tree-row').length===size,size);
  await page.waitForFunction(()=>document.querySelector('#page-title').value==='P0');
  for(const mode of ['idle','in-flight']) {
   if(mode==='in-flight') {
    held=true;
    await page.locator('#sync-btn').click();
    await page.waitForFunction(()=>!!window.workspaceDemo.store.operation?.pending);
    // The native transaction's first request is now blocked by the route.
    for(let i=0;i<100&&!releaseRequest;i++)await page.waitForTimeout(10);
    assert(releaseRequest,'must observe real loopback native request in flight');
   }
   const ack=[],switches=[];
   for(let trial=0;trial<30;trial++) {
    const text=('# Trial '+trial+' '+mode+'\n').padEnd(4096,'x');
    const row=await page.evaluate(async({text,trial})=>{
     const count=window.ackMetrics.length;window.inputStarted=performance.now();
     const editor=document.querySelector('#editor');editor.value=text;editor.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#save-btn').click();
     return await new Promise((resolve,reject)=>{const started=performance.now();function poll(){if(window.ackMetrics.length>count)return resolve(window.ackMetrics.at(-1));if(performance.now()-started>10000)return reject(Error('durable ACK timeout'));requestAnimationFrame(poll);}poll();});
    },{text,trial});
    assert.equal(JSON.parse(row.body).markdown,text);assert(row.editId);ack.push(row.ms);
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Locally saved'));
    const target=trial%2===0?'P1':'P0';
    const ms=await page.evaluate(async target=>{
     const start=performance.now();const label=[...document.querySelectorAll('.tree-title-text')].find(node=>node.textContent===target);if(!label)throw Error('target missing');label.parentElement.click();
     return await new Promise((resolve,reject)=>{function poll(){if(document.querySelector('#page-title').value===target&&!document.querySelector('#editor').disabled)return resolve(performance.now()-start);if(performance.now()-start>10000)return reject(Error('switch timeout'));requestAnimationFrame(poll);}poll();});
    },target);switches.push(ms);
   }
   results.push({size,mode,bodyUnits:4096,ackDefinition:'input event to full-envelope matching native save promise return after protected commit',switchDefinition:'navigation click to selected enabled editor observed in animation frame',ackMs:summary(ack),switchMs:summary(switches),rawAckMs:ack,rawSwitchMs:switches});
   if(mode==='in-flight') {
    // Preserve the observation and stop the task-owned context. A never-ending
    // request is not a cloud result; no successful sync/handoff is claimed.
    releaseRequest();releaseRequest=null;
   }
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);
 const evidence={status:'MEASURED_LOCAL_ONLY',browser:browser.version(),environment:'Mac Studio macOS arm64; task-owned headless Chrome; loopback mock request held in-flight; no Google requests',results,errors,targets:{durableAckP95Ms:200,switchP95Ms:150},targetPass:results.every(r=>r.ackMs.p95<=200&&r.switchMs.p95<=150),liveProvider:'NOT_RUN',humanUsability:'NOT_RUN'};
 await writeFile(new URL('evidence.json',out),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({...evidence,results:results.map(({rawAckMs,rawSwitchMs,...r})=>r)}));
}finally{if(browser)await browser.close();await server.close();await remote.close();}

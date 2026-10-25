import {until} from './wait.mjs';
// Focused contract fixture for NEW browser auth/provider wiring. Google URLs are
// intercepted before dispatch. Existing #109 provider supplies native API behavior.
import {chromium} from 'playwright';
import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {provider} from '../changes-feasibility/provider.mjs';
const baseline=process.env.BYOS_LATENCY_BASELINE==='1';
const appUrl=process.env.BYOS_LATENCY_APP_URL;
if(appUrl)assert.match(appUrl,/^https:\/\/(?:staging|[a-f0-9]{8})\.innosage-tools\.pages\.dev\/byos-demo\/$/);
const bundle=process.env.BYOS_LATENCY_BUNDLE??'public/byos-demo/app.js';
const delayMs=Number(process.env.BYOS_FIXTURE_DELAY_MS??0);assert([0,250].includes(delayMs));const root=resolve('.byos-real','latency-repair-'+(baseline?'before':'after')+'-'+delayMs+'-'+process.pid+'-'+Date.now());await mkdir(root,{recursive:true});
let source=await readFile('spikes/byos-sync/src/mock.mjs','utf8');
const sig='sameTime = false,\n} = {}) {',anchor='    const match = u.pathname.match(';
assert.equal(source.split(sig).length,2);assert.equal(source.split(anchor).length,2);
source=source.replace(sig,'sameTime = false,\n extension = async () => false,\n} = {}) {').replace(anchor,'    if(await extension({req,res,u,body,files,create,control,finish,entry,meta}))return;\n'+anchor);
source=source.replace('const stamp = () => new Date(epoch + (sameTime ? 0 : ++tick)).toISOString();','const stamp = () => new Date(Date.now()).toISOString();').replace('new Date(Date.now() + tick).toUTCString()','new Date(Date.now()).toUTCString()');
await writeFile(resolve(root,'mock.mjs'),source);const {mock}=await import(pathToFileURL(resolve(root,'mock.mjs')));
const p=provider();const workspace=crypto.randomUUID();let marked=false,deny=false;
const m=await mock({extension:ctx=>p.route(ctx)});p.attach(m);
const server=http.createServer(async(req,res)=>{const js=req.url.split('?')[0].endsWith('app.js');res.setHeader('Content-Type',js?'text/javascript':'text/html');let bytes=await readFile(js?bundle:'public/byos-demo/index.html');if(!js&&process.env.BYOS_LATENCY_BUNDLE)bytes=Buffer.from(bytes.toString().replace(/ integrity="[^"]+"/g,''));res.end(bytes);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,url=(appUrl??origin+'/')+'?workspace='+workspace,contexts=[],errors=[];let heldPreflight=null;let requests=0;const revisions=new Map();
const remember=()=>{for(const f of m.files.values())revisions.set(`${f.id}:r${f.version}`,Buffer.from(f.body));};
const watchdog=setTimeout(()=>{console.error('MOCK_BROWSER_BOUND');process.exit(2);},179000);
async function open(label){
 const c=await chromium.launchPersistentContext(resolve(root,label),{headless:true});contexts.push(c);
 await c.addInitScript(()=>{window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:opts=>({requestAccessToken:()=>opts.callback({access_token:'synthetic-only',expires_in:3600,scope:'https://www.googleapis.com/auth/drive.file'})})}}};});
 await c.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());
  if(u.origin===origin||(appUrl&&u.origin===new URL(appUrl).origin))return route.continue();
  if(r.method()==='PUT'&&u.pathname.startsWith('/upload/drive/'))assert(r.headers()['if-match'],'native conditional writes must retain If-Match');
  assert.equal(u.origin,'https://www.googleapis.com');assert(++requests<=2000);
  if(delayMs)await new Promise(r=>setTimeout(r,delayMs));
  if(u.pathname==='/drive/v3/about'&&heldPreflight){const held=heldPreflight;heldPreflight=null;held.enter();await held.promise;}
  if(deny)return route.fulfill({status:401,json:{error:{code:401}}});
  if(u.pathname==='/drive/v3/about')return route.fulfill({json:{user:{permissionId:'fixture-account'}}});
  if(u.pathname==='/drive/v3/files'&&u.searchParams.get('corpora')==='user'){
   const folder=[...m.files.values()].find(f=>f.name==='InnoSage_BYOS_'+workspace);
   return route.fulfill({json:{files:folder?[{id:folder.id,mimeType:folder.mimeType,ownedByMe:true,appProperties:{byos113:workspace}}]:[]}});
  }
  if(r.method()==='POST'&&u.pathname==='/drive/v3/files'&&r.postDataJSON()?.appProperties){
   assert.equal(marked,false);marked=true;const f=m.create(r.postDataJSON());return route.fulfill({json:{id:f.id,mimeType:f.mimeType,ownedByMe:true,appProperties:{byos113:workspace}}});
  }
  // Contract-grounded compatibility fixture: full metadata has a file validator
  // and revision, while media does not expose ETag (observed real boundary).
  const fileId=u.pathname.match(/^\/drive\/v2\/files\/([^/]+)$/)?.[1];
  const file=fileId&&m.files.get(decodeURIComponent(fileId));
  if(file&&u.searchParams.has('revisionId')){
   remember();const body=revisions.get(`${file.id}:${u.searchParams.get('revisionId')}`);
   if(!body)return route.fulfill({status:404,json:{error:{code:404}}});
   return route.fulfill({status:200,body,headers:{'Content-Type':'application/json','Date':new Date().toUTCString(),'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Date,ETag'}});
  }
  remember();
  const response=await route.fetch({url:m.url+u.pathname+u.search,maxRedirects:0});
  if(file&&r.method()==='GET'&&response.ok()){
   if(u.searchParams.get('alt')==='media'){const headers=response.headers();delete headers.etag;return route.fulfill({response,headers});}
   const data=await response.json();if(data.fileSize!=='0')data.headRevisionId=`r${data.version}`;
   return route.fulfill({response,json:data});
  }
  remember();return route.fulfill({response});
 });
 const page=await c.newPage();page.on('pageerror',e=>errors.push(e.message));if(process.env.BYOS_LOCAL_DEBUG==='1')page.on('console',m=>{if(m.type()==='error')console.error(m.text());});await page.goto(url);await page.waitForFunction(()=>window.byos&&window.spike?.ready);
 await page.locator('#oauth-client').fill('123-fixture.apps.googleusercontent.com');await page.locator('#test-account').check();await page.locator('#authorize-btn').click();await until(page,async()=> (await window.byos.snapshot()).transport.authorized);return page;
}
async function save(page,body){await page.locator('#editor').fill(body);await page.locator('#save-btn').click();await page.waitForFunction(t=>window.spike.lastSaveAcknowledgement?.body===t,body);return (await page.evaluate(()=>window.byos.snapshot())).view.journal.draft;}
async function verify(page){await page.locator('#verify-btn').click();await until(page,async()=>{const s=await window.byos.snapshot();return s.view.operation?.phase==='failed'||(s.lastRemote&&!s.view.journal&&s.lastRemote.editId===s.view.page?.editId);},{},{timeout:60000});const state=await page.evaluate(()=>window.byos.snapshot());assert.notEqual(state.view.operation?.phase,'failed',await page.locator('#operation-status').textContent());}
async function receive(page,doc){await page.locator('#sync-btn').click();await until(page,async d=>{const s=await window.byos.snapshot();return !s.busy&&s.view.page?.editId===d.editId&&document.querySelector('#editor').value===d.body;},doc,{timeout:60000});assert.equal(await page.locator('#editor').inputValue(),doc.body);}
try{
 const a=await open('A'),b=await open('B');
 const settle=async()=>new Promise(r=>setTimeout(r,delayMs*16+200));
 const A=await save(a,'# latency baseline A\n\nComplete body.');await verify(a);await settle();await receive(b,A);await settle();
 const L=await save(a,'# latency local\n\nProtected complete local body.');
 const C=await save(b,'# latency cloud\n\nIndependent complete cloud body.');await verify(b);await settle();
 await a.locator('#sync-btn').click();await until(a,async()=>{const s=await window.byos.snapshot();return !s.busy&&s.view.journal?.sourceCloud?.editId;},{},{timeout:90000});await settle();
 const before=await a.evaluate(()=>window.byos.snapshot());assert.equal(before.view.journal.sourceLocal.body,L.body);assert.equal(before.view.journal.sourceCloud.body,C.body);
 await a.evaluate(()=>{
  const region=document.getElementById('operation-status');
  document.getElementById('keep-local-btn').addEventListener('click',()=>{window.__latencyClick=performance.now();},{once:true,capture:true});
  if(region){new MutationObserver((_,observer)=>{if(!region.hidden&&window.__latencyClick!=null){window.__feedbackMs=performance.now()-window.__latencyClick;observer.disconnect();}}).observe(region,{attributes:true,childList:true,subtree:true});}
 });
 const beforeRequests=requests,started=performance.now();await a.locator('#keep-local-btn').click();await new Promise(r=>setTimeout(r,25));
 const immediate=await a.evaluate(()=>({status:document.getElementById('status').textContent,operation:document.getElementById('operation-status')?.textContent??null,ariaBusy:document.getElementById('keep-local-btn').getAttribute('aria-busy'),disabled:document.getElementById('keep-local-btn').disabled,feedbackMs:window.__feedbackMs??null,saveAvailable:!document.getElementById('save-btn').disabled,editorAvailable:!document.getElementById('editor').disabled}));
 if(!baseline){
  assert(immediate.feedbackMs!==null&&immediate.feedbackMs<100);assert.equal(immediate.disabled,true);assert.equal(immediate.ariaBusy,'true');assert(immediate.operation);assert(immediate.saveAvailable&&immediate.editorAvailable);
  // Deliberately dispatch past disabled DOM controls to verify the handler's
  // same-tick guard; a compatible repeat must not amplify backend requests.
  await a.locator('#keep-local-btn').dispatchEvent('click');
  await a.locator('#use-cloud-btn').dispatchEvent('click');
 }
 await until(a,async()=>{const s=await window.byos.snapshot();return s.view.journal?.state==='pending'&&s.view.journal?.seq===2&&s.view.page?.editId===s.view.journal?.draft?.editId;},{},{timeout:90000});
 await until(a,async()=>!(await window.byos.snapshot()).busy,{},{timeout:90000});
 const elapsedMs=performance.now()-started,resolvePhysicalRequests=requests-beforeRequests,after=await a.evaluate(()=>window.byos.snapshot());assert.equal(after.view.journal.draft.body,L.body);assert.equal(after.view.journal.sourceCloud.body,C.body);assert.deepEqual(errors,[]);assert.deepEqual(after.errors,[]);
 const operationRows=after.transport.requests.slice(before.transport.requests.length);await writeFile(resolve(root,'structured-snapshots.json'),JSON.stringify({before,after},null,2));
 let idleSave=null,generationSafety=null;
 if(!baseline){
  const settled=requests;await new Promise(r=>setTimeout(r,350));assert.equal(requests,settled);
  const saveStart=performance.now();const next=await save(a,'# Later local intent\n\nMust remain local until the next explicit action.');
  const ackMs=performance.now()-saveStart;
  await a.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await new Promise(r=>setTimeout(r,350));assert.equal(requests,settled);
  const pending=await a.evaluate(()=>window.byos.snapshot());assert.equal(pending.view.journal.draft.editId,next.editId);
  await verify(a);await until(a,async()=>!(await window.byos.snapshot()).busy,{},{timeout:90000});
  const verified=await a.evaluate(()=>window.byos.snapshot());assert.equal(verified.lastRemote.editId,next.editId);assert.equal(verified.lastRemote.body,next.body);assert.equal(verified.view.journal,null);assert.deepEqual(verified.errors,[]);
  idleSave={idleRequests:0,localSaveRequests:0,localSaveAckMs:ackMs,pausedSavePickedUpOnExplicitResume:true,fullBodyVerified:true};
  if(delayMs===0){
   await receive(b,next);
   await save(a,'# Protected choice before preflight');
   const remote=await save(b,'# Independent newer remote for choice');await verify(b);
   await a.locator('#sync-btn').click();await until(a,async()=>{const s=await window.byos.snapshot();return !s.busy&&s.view.journal?.sourceCloud?.editId;},{},{timeout:60000});
   const choiceTimes={};for(const choice of ['cloud','merge']){
    const choiceStart=performance.now();
    let enter,release;const entered=new Promise(r=>enter=r),promise=new Promise(r=>release=r);heldPreflight={enter,promise};
    if(choice==='merge'){await a.locator('#merge-manual-btn').click();await a.locator('#merge-editor').fill('# Older merge candidate');await a.locator('#commit-merge-btn').click();}
    else await a.locator('#use-cloud-btn').click();
    await entered;
    const newer=await save(a,'# New ACK during '+choice+' preflight\n\nMust never be discarded or replaced.');
    release();await until(a,async()=>!(await window.byos.snapshot()).busy,{},{timeout:60000});
    const retained=await a.evaluate(()=>window.byos.snapshot());
    assert.equal(retained.view.journal.draft.editId,newer.editId);assert.equal(retained.view.journal.draft.body,newer.body);assert.equal(retained.view.operation.phase,'failed');
    choiceTimes[choice]=performance.now()-choiceStart;assert(choiceTimes[choice]<5000);
    assert([...m.files.values()].filter(f=>f.name==='transaction.json').every(f=>f.body.length===0),'guard failure must release the native CAS lease');
   }
   generationSafety={cloudNewerAckRetained:true,mergeNewerAckRetained:true,heldAt:'account-preflight',leaseReleasedAfterFailure:true,choiceElapsedMs:choiceTimes};
  }
 }
 const result={baseline,appUrl:appUrl??'LOOPBACK',idleSave,generationSafety,nativeErrors:after.errors,operationRows,clockModel:'coherent wall clock for Date and modifiedTime, original failed fixture retained',kind:appUrl?'STAGING_UI_SYNTHETIC_PROVIDER_LATENCY':'CONTROLLED_LOOPBACK_LATENCY_DIAGNOSTIC',source:process.env.BYOS_SOURCE_SHA??'WORKING_TREE_HASHED_SEPARATELY',operation:'Keep local after settled conflict',fixedDelayPerPhysicalDispatchMs:delayMs,resolvePhysicalRequests,elapsedMs,immediate25ms:immediate,sourceBodiesRetained:true,status:after.view.status,journalState:after.view.journal.state,totalFixtureDispatches:requests,realGoogleRequests:0,providerLatencyClaim:false,notes:'Controlled transport delay and synthetic OAuth/provider interception. Existing mock with coherent clock and pinned historical revision bodies; not actual Google timing or OAuth proof.'};
 await writeFile(resolve(root,'latency-receipt.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,operationRows:undefined,receipt:resolve(root,'latency-receipt.json')}));
}catch(e){console.error('MOCK_BROWSER_FAIL',e.message);let failed=[];for(const c of contexts)for(const page of c.pages())failed.push(await page.evaluate(async()=>({snapshot:await window.byos.snapshot(),ui:document.querySelector('#editor').value,status:document.querySelector('#status').textContent})).catch(()=>({closed:true})));await writeFile(resolve(root,'failure-snapshots.json'),JSON.stringify({error:e.message,failed},null,2));throw e;}
finally{clearTimeout(watchdog);for(const c of contexts)await c.close();await m.close();await new Promise(r=>server.close(r));}

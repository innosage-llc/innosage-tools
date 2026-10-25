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
const root=resolve('.byos-real','mock-'+Date.now());await mkdir(root,{recursive:true});
let source=await readFile('spikes/byos-sync/src/mock.mjs','utf8');
const sig='sameTime = false,\n} = {}) {',anchor='    const match = u.pathname.match(';
assert.equal(source.split(sig).length,2);assert.equal(source.split(anchor).length,2);
source=source.replace(sig,'sameTime = false,\n extension = async () => false,\n} = {}) {').replace(anchor,'    if(await extension({req,res,u,body,files,create,control,finish,entry,meta}))return;\n'+anchor);
await writeFile(resolve(root,'mock.mjs'),source);const {mock}=await import(pathToFileURL(resolve(root,'mock.mjs')));
const p=provider();const workspace=crypto.randomUUID();let marked=false,deny=false;
const m=await mock({extension:ctx=>p.route(ctx)});p.attach(m);
const server=http.createServer(async(req,res)=>{const js=req.url.split('?')[0].endsWith('app.js');res.setHeader('Content-Type',js?'text/javascript':'text/html');res.end(await readFile('public/byos-demo/'+(js?'app.js':'index.html')));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/?workspace='+workspace,contexts=[],errors=[];let requests=0;
const watchdog=setTimeout(()=>{console.error('MOCK_BROWSER_BOUND');process.exit(2);},179000);
async function open(label){
 const c=await chromium.launchPersistentContext(resolve(root,label),{headless:true});contexts.push(c);
 await c.addInitScript(()=>{window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:opts=>({requestAccessToken:()=>opts.callback({access_token:'synthetic-only',expires_in:3600,scope:'https://www.googleapis.com/auth/drive.file'})})}}};});
 await c.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());
  if(u.origin===origin)return route.continue();
  assert.equal(u.origin,'https://www.googleapis.com');assert(++requests<=2000);
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
  if(file&&u.searchParams.has('revisionId')&&u.searchParams.get('revisionId')!==`r${file.version}`)return route.fulfill({status:404,json:{error:{code:404}}});
  const response=await route.fetch({url:m.url+u.pathname+u.search,maxRedirects:0});
  if(file&&r.method()==='GET'&&response.ok()){
   if(u.searchParams.get('alt')==='media'){const headers=response.headers();delete headers.etag;return route.fulfill({response,headers});}
   const data=await response.json();if(file.body.length)data.headRevisionId=`r${file.version}`;
   return route.fulfill({response,json:data});
  }
  return route.fulfill({response});
 });
 const page=await c.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.byos&&window.spike?.ready);
 await page.locator('#oauth-client').fill('123-fixture.apps.googleusercontent.com');await page.locator('#test-account').check();await page.locator('#authorize-btn').click();await until(page,async()=> (await window.byos.snapshot()).transport.authorized);return page;
}
async function save(page,body){await page.locator('#editor').fill(body);await page.locator('#save-btn').click();await page.waitForFunction(t=>window.spike.lastSaveAcknowledgement?.body===t,body);return (await page.evaluate(()=>window.byos.snapshot())).view.journal.draft;}
async function verify(page){await page.locator('#verify-btn').click();await until(page,async()=>{const s=await window.byos.snapshot();return s.lastRemote&&!s.view.journal&&s.lastRemote.editId===s.view.page?.editId;},{},{timeout:60000});}
async function receive(page,doc){await page.locator('#sync-btn').click();await until(page,async d=>{const s=await window.byos.snapshot();return !s.busy&&s.view.page?.editId===d.editId&&document.querySelector('#editor').value===d.body;},doc,{timeout:60000});assert.equal(await page.locator('#editor').inputValue(),doc.body);}
try{
 const a=await open('A'),b=await open('B');const A=await save(a,'# A complete\n\n中文 **Markdown**\n\n- retained\n');await verify(a);await receive(b,A);
 const B=await save(b,'# B return\n\n```js\nconst body = "complete";\n```');await verify(b);await receive(a,B);
 const local=await save(a,'# Local conflict full body'),cloud=await save(b,'# Cloud conflict full body');await verify(b);await a.locator('#sync-btn').click();await until(a,async()=>!!(await window.byos.snapshot()).view.journal?.sourceCloud,{},{timeout:60000});
 const conflict=await a.evaluate(()=>window.byos.snapshot());assert.equal(conflict.view.journal.sourceLocal.body,local.body);assert.equal(conflict.view.journal.sourceCloud.body,cloud.body);
 await a.locator('#keep-local-btn').click();await until(a,async()=> (await window.byos.snapshot()).view.journal?.state==='pending',{},{timeout:60000});await verify(a);const after=await a.evaluate(()=>window.byos.snapshot());await receive(b,after.view.page);
 deny=true;const failed=await save(b,'# Auth failure retained');await b.locator('#sync-btn').click();await until(b,async()=> (await window.byos.snapshot()).view.status==='reauth-required',{},{timeout:30000});
 await b.locator('#disconnect-btn').click();assert.match(await b.locator('#connection-status').textContent(),/Reload/);
 await b.locator('#authorize-btn').click();assert.match(await b.locator('#connection-status').textContent(),/Reload/);
 assert.equal((await b.evaluate(()=>window.byos.snapshot())).view.journal.draft.editId,failed.editId);
 const diagnostics=await b.evaluate(()=>window.byos.snapshot());
 assert(diagnostics.errors.length>0);assert(diagnostics.errors.length<=32);
 assert(diagnostics.transport.requests.some(r=>r.metadataValidators?.equal===true&&r.fileAlias));
 assert.doesNotMatch(JSON.stringify({errors:diagnostics.errors,requests:diagnostics.transport.requests}),/synthetic-only|Bearer|access_token|fixture-account/);
 assert.deepEqual(errors,[]);assert.equal(after.lastRemote.body,local.body);assert(after.checkpoint?.changes109);
 const receipt={status:'PASS',kind:'MOCK_BROWSER_PROVIDER_WIRING',requests,fullBodies:{A,B,local,cloud,conflict:conflict.view.journal,verified:after.lastRemote},checkpoint:after.checkpoint,pendingInitialAuthFailureDisconnect:'PASS_RELOAD_REQUIRED_NO_BEARER_SWAP',realProvider:'NOT_RUN_AUTH',upstream:'Existing src/mock + changes-feasibility/provider; fixture-only account/folder metadata and GIS consent stub'};
 await writeFile(resolve(root,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}catch(e){console.error('MOCK_BROWSER_FAIL',e.message);for(const c of contexts)for(const page of c.pages())console.error(await page.evaluate(async()=>({snapshot:await window.byos.snapshot(),ui:document.querySelector('#editor').value,status:document.querySelector('#status').textContent})).catch(()=>({closed:true})));throw e;}
finally{clearTimeout(watchdog);for(const c of contexts)await c.close();await m.close();await new Promise(r=>server.close(r));}

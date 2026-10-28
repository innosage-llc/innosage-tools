// End-to-end native/UI qualification using a separate headless Playwright
// browser and fully intercepted synthetic provider. ZERO real Google traffic.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve} from './server.mjs';
import {mockProvider} from './mock-provider.mjs';
import {makePage,encode} from './envelope.mjs';
const require=createRequire(new URL('../byos-sync/package.json',import.meta.url)),{chromium}=require('playwright');
const server=await serve(0,{real:true}),remote=await mockProvider();let browser;
const workspace=crypto.randomUUID(),account=createHash('sha256').update('prepared-synthetic-account').digest('hex');
const folder=remote.create({name:'InnoSage_BYOS_'+workspace,mimeType:'application/vnd.google-apps.folder',parents:['root']});
const docs=remote.create({name:'docs',mimeType:'application/vnd.google-apps.folder',parents:[folder.id]});
remote.create({name:'signaling',mimeType:'application/vnd.google-apps.folder',parents:[folder.id]});
remote.create({name:'rxdb.json',mimeType:'application/json',parents:[folder.id]},Buffer.from(JSON.stringify({replicationIdentifier:'prepared-synthetic'})));
for(const name of ['transaction.json','rxdb-wal.json'])remote.create({name,mimeType:'application/json',parents:[folder.id]});
const ids=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(letter=>'w142_prepared_'+letter),originals=new Map();
for(const [index,id] of [...ids,...Array.from({length:12},(_,i)=>'w142_original_'+i)].entries()){
 const envelope=makePage({workspaceId:workspace,id,title:index<26?'AZ142 '+String.fromCharCode(65+index):'Original '+index,markdown:'baseline '+id,order:index});
 const record={id,body:encode(envelope),editId:'baseline-'+id,_deleted:false};
 const file=remote.create({name:id+'.json',mimeType:'application/json',parents:[docs.id]},Buffer.from(JSON.stringify(record)));
 if(index>=26)originals.set(file.id,Buffer.from(file.body));
}
const revisions=new Map(),errors=[],wire=[];let injected=false,injectTransient=false,intercepted=0;
const remember=()=>{for(const file of remote.files.values())revisions.set(`${file.id}:r${file.version}`,Buffer.from(file.body));};
try{
 // No channel/executable override: use the dedicated installed Playwright
 // headless browser, never the shared user Chrome application/profile.
 browser=await chromium.launch({headless:true});
 async function open(){
  const context=await browser.newContext();
  await context.addInitScript(({workspace,account,folderId})=>{
   localStorage.setItem('byos113-client-id','123-example.apps.googleusercontent.com');localStorage.setItem('byos113-binding:'+workspace,JSON.stringify({account,clientId:'123-example.apps.googleusercontent.com',folderId}));
   window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:options=>({requestAccessToken:()=>options.callback({access_token:'synthetic-only',expires_in:3600})})}}};
  },{workspace,account,folderId:folder.id});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin===server.url)return route.continue();
   assert.equal(url.origin,'https://www.googleapis.com');assert(++intercepted<=6000,'bounded mock RPC');
   wire.push({method:request.method(),path:url.pathname,at:Date.now()});
   if(url.pathname==='/drive/v3/about')return route.fulfill({json:{user:{permissionId:'prepared-synthetic-account'}}});
   if(url.pathname==='/drive/v3/files'&&url.searchParams.get('corpora')==='user')return route.fulfill({json:{files:[{id:folder.id,mimeType:folder.mimeType,ownedByMe:true,appProperties:{byos113:workspace}}]}});
   assert(!(request.method()==='POST'&&request.postDataJSON()?.mimeType==='application/vnd.google-apps.folder'),'no folder creation');
   if(injectTransient&&!injected&&request.method()==='PUT'&&request.postDataJSON()?.id===ids[0]){injected=true;return route.fulfill({status:503,json:{error:{errors:[{reason:'backendError'}]}}});}
   const id=url.pathname.match(/^\/drive\/v2\/files\/([^/]+)$/)?.[1],file=id&&remote.files.get(decodeURIComponent(id));remember();
   if(file&&url.searchParams.has('revisionId')){const body=revisions.get(`${file.id}:${url.searchParams.get('revisionId')}`);assert(body);return route.fulfill({status:200,body,headers:{'Content-Type':'application/json','Date':new Date().toUTCString(),'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Date,ETag'}});}
   const response=await route.fetch({url:remote.url+url.pathname+url.search,maxRedirects:0});remember();
   if(file&&request.method()==='GET'&&response.ok()&&!url.searchParams.has('alt')){const data=await response.json();data.parents=file.parents.map(id=>({id}));if(data.fileSize!=='0')data.headRevisionId=`r${data.version}`;return route.fulfill({response,json:data});}
   return route.fulfill({response});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return {page,context};
 }
 async function load(page,prepared=false){
  await page.goto(server.url+'/?workspace='+workspace+(prepared?'&prepared=1':''));await page.waitForFunction(()=>window.workspaceRealReady);
  await page.locator('main section.panel').first().locator('input[type=checkbox]').check();await page.getByRole('button',{name:'Reauthorize existing test account'}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('main section.panel p')].some(n=>n.textContent.includes('Authorized in memory')));
 }
 async function select(page,index){const title='AZ142 '+String.fromCharCode(65+index);await page.locator('.tree-row').filter({has:page.locator('.tree-title-text',{hasText:new RegExp('^'+title+'$')})}).click();await page.waitForFunction(title=>document.querySelector('#page-title').value===title,title);}
 async function sync(page){await page.locator('#sync-btn').click();try{await page.waitForFunction(()=>/Sync finished|failed|Error/.test(document.querySelector('#status').textContent),null,{timeout:60000});assert.match(await page.locator('#status').textContent(),/Sync finished/);}catch(error){console.log(JSON.stringify({stage:'native-sync',status:await page.locator('#status').textContent(),snapshot:await page.evaluate(()=>window.workspaceRealSnapshot()),errors,wire:wire.slice(-15),requests:remote.requests.slice(-15)}));throw error;}}
 const a=await open(),b=await open();await load(a.page);await sync(a.page);await load(b.page);await sync(b.page);
 // Create the bounded historical-pending shape locally; no cloud operation.
 for(let i=0;i<26;i++){await select(a.page,i);await a.page.locator('#editor').fill('recovery '+i);await a.page.locator('#save-btn').click();await a.page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Locally saved'));}
 assert.equal((await a.page.evaluate(()=>window.workspaceRealSnapshot())).catalog.pendingCount,26);
 await load(a.page,true);await a.page.getByRole('button',{name:'Recover prior A–Z pending intents'}).click();
 await a.page.waitForFunction(()=>/recovered and independently verified|Recovery stopped/.test(document.querySelector('#status').textContent),null,{timeout:180000});
 const recoveryStatus=await a.page.locator('#status').textContent();assert.match(recoveryStatus,/recovered and independently verified/);
 const recovery=await a.page.evaluate(()=>window.workspacePreparedRecoverySnapshot());
 await load(a.page,true);await a.page.locator('#idle-start').click();
 await a.page.waitForFunction(()=>window.workspaceIdleSnapshot||document.querySelector('#status').textContent.includes('experiment refused'),null,{timeout:60000});
 assert(await a.page.evaluate(()=>!!window.workspaceIdleSnapshot),await a.page.locator('#status').textContent());
 injectTransient=true;const starts=[];
 for(let i=0;i<26;i++){await select(a.page,i);starts.push(Date.now());await a.page.locator('#editor').fill('formal '+i+' '+ 'x'.repeat(1024));if(i<25)await a.page.waitForTimeout(Math.max(0,1000-(Date.now()-starts.at(-1))));}
 await a.page.waitForFunction(()=>['safe-to-close','failed'].includes(document.querySelector('#idle-status').dataset.state),null,{timeout:180000});
 const formal=await a.page.evaluate(()=>window.workspaceIdleSnapshot());
 const out=new URL('.generated/prepared/',import.meta.url);await mkdir(out,{recursive:true});
 await writeFile(new URL('intercepted-evidence.json',out),JSON.stringify({provider:'INTERCEPTED_SYNTHETIC_NOT_REAL_DRIVE',realGoogleRequests:0,recovery,formal,errors},null,2)+'\n');
 assert.equal(formal.run.ready,true,JSON.stringify(formal.run));assert(injected);assert(formal.run.pages.some(p=>p.attempt===2));assert.equal(formal.run.pages.filter(p=>p.verified===p.generation).length,26);
 const before=await a.page.evaluate(()=>window.workspaceRealSnapshot());await sync(b.page);const after=await b.page.evaluate(()=>window.workspaceRealSnapshot());assert.deepEqual(after.catalog.pages,before.catalog.pages);
 const aUrl=a.page.url();await a.page.close();const reopened=await a.context.newPage();await reopened.goto(aUrl);await reopened.waitForFunction(()=>window.workspaceRealReady);assert.deepEqual((await reopened.evaluate(()=>window.workspaceRealSnapshot())).catalog.pages,before.catalog.pages);
 for(const [id,bytes] of originals)assert.deepEqual(remote.files.get(id).body,bytes);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'PASS',provider:'INTERCEPTED_SYNTHETIC_NOT_REAL_DRIVE',realGoogleRequests:0,interceptedRequests:intercepted,verified:26,original12Unchanged:true,destinationFullTree:true,actualCloseReopen:true,injected503Recovered:true}));
 await a.context.close();await b.context.close();
}finally{if(browser)await browser.close();await server.close();await remote.close();}

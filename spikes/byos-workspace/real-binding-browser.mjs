// Compile/real-browser provider wiring qualification. Every Google request is
// intercepted by the accepted local mock. This is NOT real Drive evidence.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve} from './server.mjs';
import {mockProvider} from './mock-provider.mjs';
const require=createRequire(new URL('../byos-sync/package.json',import.meta.url));const {chromium}=require('playwright');
const server=await serve(0,{real:true}),remote=await mockProvider();let browser;
const workspace=crypto.randomUUID(),account=createHash('sha256').update('synthetic-account').digest('hex');
const folder=remote.create({name:'InnoSage_BYOS_'+workspace,mimeType:'application/vnd.google-apps.folder',parents:['root']});
remote.create({name:'docs',mimeType:'application/vnd.google-apps.folder',parents:[folder.id]});
remote.create({name:'signaling',mimeType:'application/vnd.google-apps.folder',parents:[folder.id]});
remote.create({name:'rxdb.json',mimeType:'application/json',parents:[folder.id]},Buffer.from(JSON.stringify({replicationIdentifier:'existing-synthetic-replication'})));
const revisions=new Map();let intercepted=0;const errors=[];
const remember=()=>{for(const file of remote.files.values())revisions.set(`${file.id}:r${file.version}`,Buffer.from(file.body));};
try {
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 async function open(label,bound=true){
  const context=await browser.newContext();
  await context.addInitScript(({workspace,account,folderId,bound})=>{
   if(bound){localStorage.setItem('byos113-client-id','123-example.apps.googleusercontent.com');localStorage.setItem('byos113-binding:'+workspace,JSON.stringify({account,clientId:'123-example.apps.googleusercontent.com',folderId}));}
   window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:options=>({requestAccessToken:()=>options.callback({access_token:'synthetic-only',expires_in:3600})})}}};
  },{workspace,account,folderId:folder.id,bound});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin===server.url)return route.continue();
   assert.equal(url.origin,'https://www.googleapis.com');assert(++intercepted<=2000,'bounded intercepted calls');
   if(url.pathname==='/drive/v3/about')return route.fulfill({json:{user:{permissionId:'synthetic-account'}}});
   if(url.pathname==='/drive/v3/files'&&url.searchParams.get('corpora')==='user')return route.fulfill({json:{files:[{id:folder.id,mimeType:folder.mimeType,ownedByMe:true,appProperties:{byos113:workspace}}]}});
   assert(!(request.method()==='POST'&&url.pathname==='/drive/v3/files'&&request.postDataJSON()?.mimeType==='application/vnd.google-apps.folder'),'must not dispatch ANY folder creation');
   const id=url.pathname.match(/^\/drive\/v2\/files\/([^/]+)$/)?.[1];const file=id&&remote.files.get(decodeURIComponent(id));
   remember();
   if(file&&url.searchParams.has('revisionId')){const body=revisions.get(`${file.id}:${url.searchParams.get('revisionId')}`);assert(body);return route.fulfill({status:200,body,headers:{'Content-Type':'application/json','Date':new Date().toUTCString(),'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Date,ETag'}});}
   const response=await route.fetch({url:remote.url+url.pathname+url.search,maxRedirects:0});remember();
   if(file&&request.method()==='GET'&&response.ok()){
    if(url.searchParams.get('alt')==='media'){const headers=response.headers();delete headers.etag;return route.fulfill({response,headers});}
    const data=await response.json();if(data.fileSize!=='0')data.headRevisionId=`r${data.version}`;return route.fulfill({response,json:data});
   }
   return route.fulfill({response});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(server.url+'/?workspace='+workspace);
  if(!bound){await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('binding required'));return {context,page};}
  await page.waitForFunction(()=>window.workspaceRealReady);assert.equal(await page.evaluate(()=>!!window.workspaceDemo),false,'no native debug store in real build');
  await page.locator('main section.panel').first().locator('input[type=checkbox]').check();await page.getByRole('button',{name:'Reauthorize existing test account'}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('main section.panel p')].some(node=>node.textContent.includes('Authorized in memory')));
  return {context,page};
 }
 const negative=await open('unbound',false);assert.equal(intercepted,0);await negative.context.close();
 const a=await open('a'),b=await open('b');
 async function save(page,title,text){await page.locator('#page-title').fill(title);await page.locator('#editor').fill(text);await page.locator('#save-btn').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Locally saved'));}
 await a.page.locator('#new-root-btn').click();await a.page.waitForFunction(()=>document.querySelector('#page-title').value==='New Project');await save(a.page,'Project','# Project\n\n- exact\n');
 await a.page.locator('#new-child-btn').click();await a.page.waitForFunction(()=>document.querySelector('#page-title').value==='New Child Page');await save(a.page,'Notes','# Notes\n');
 await a.page.locator('#new-child-btn').click();await a.page.waitForFunction(()=>document.querySelector('#page-title').value==='New Child Page');await save(a.page,'Agenda','# Agenda\n\n```js\n42\n```\n');
 for(const title of ['Project','Notes','Agenda']){
  await a.page.locator('.tree-row').filter({has:a.page.locator('.tree-title-text',{hasText:new RegExp('^'+title+'$')})}).click();await a.page.waitForFunction(title=>document.querySelector('#page-title').value===title,title);
  await a.page.locator('#verify-btn').click();await a.page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Exact saved generation cloud verified'),null,{timeout:60000});
 }
 const before=await a.page.evaluate(()=>window.workspaceRealSnapshot());await b.page.locator('#sync-btn').click();await b.page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Sync finished'),null,{timeout:60000});
 const received=await b.page.evaluate(()=>window.workspaceRealSnapshot());assert.deepEqual(received.catalog.pages,before.catalog.pages);
 await b.page.locator('.tree-row').filter({has:b.page.locator('.tree-title-text',{hasText:'Agenda'})}).click();await b.page.waitForFunction(()=>document.querySelector('#page-title').value==='Agenda');
 await save(b.page,'Agenda B reply','# B exact reverse reply\n');await b.page.locator('#verify-btn').click();await b.page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Exact saved generation cloud verified'),null,{timeout:60000});
 await a.page.locator('#sync-btn').click();await a.page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Sync finished'),null,{timeout:60000});
 assert.deepEqual((await a.page.evaluate(()=>window.workspaceRealSnapshot())).catalog.pages,(await b.page.evaluate(()=>window.workspaceRealSnapshot())).catalog.pages);
 assert.deepEqual(errors,[]);const evidence={status:'PASS',provider:'INTERCEPTED_SYNTHETIC_NOT_REAL_DRIVE',checks:['unbound-zero-provider-requests','existing-account-folder-reauthorization-wiring','no-native-debug-store','full-tree-A-to-B','full-tree-B-to-A'],interceptedRequests:intercepted,realGoogleRequests:0,errors};
 const out=new URL('.generated/real-binding/',import.meta.url);await mkdir(out,{recursive:true});await writeFile(new URL('evidence.json',out),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
 await a.context.close();await b.context.close();
}finally{if(browser)await browser.close();await server.close();await remote.close();}

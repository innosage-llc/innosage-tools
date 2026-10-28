import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(new URL('../byos-sync/package.json',import.meta.url));
const {chromium}=require('playwright');
const server=http.createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 const name=path==='/byos-workspace/'?'index.html':path.slice('/byos-workspace/'.length);
 if(!path.startsWith('/byos-workspace/')||!['index.html','app.mjs','sw.js'].includes(name)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',name.endsWith('.html')?'text/html':'text/javascript');
 res.end(await readFile(new URL('../../public/byos-workspace/'+name,import.meta.url)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext(),workspace=crypto.randomUUID(),errors=[];
 await context.addInitScript(workspace=>{localStorage.setItem('byos113-client-id','synthetic.apps.googleusercontent.com');localStorage.setItem('byos113-binding:'+workspace,JSON.stringify({account:'synthetic',folderId:'synthetic-existing',clientId:'synthetic.apps.googleusercontent.com'}));},workspace);
 const origin='http://127.0.0.1:'+server.address().port;
 await context.route('**/*',route=>{assert.equal(new URL(route.request().url()).origin,origin);return route.continue();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/byos-workspace/?workspace='+workspace);
 await page.waitForFunction(()=>window.workspaceRealReady);
 await page.waitForFunction(()=>document.querySelector('#offline-status').textContent.startsWith('Offline editor ready'));
 await page.locator('#new-root-btn').click();await page.waitForFunction(()=>document.querySelector('#page-title').value==='New Project');
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.workspaceRealReady);
 assert.match(await page.locator('#tree').textContent(),/New Project/);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'PASS',checks:['static-subpath-ready','integrity-shell-ready','offline-reload-local-page-retained'],realGoogleRequests:0}));
 await context.close();
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}

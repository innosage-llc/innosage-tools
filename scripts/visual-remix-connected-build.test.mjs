// Actual compiled route guard. All sharing traffic terminates at a local mock;
// this is not live OAuth, MCP, ChatGPT vision or Founder acceptance evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import {createRequire} from 'node:module';
import { chromium } from 'playwright';

test('connected build retains pairing, consented reference sharing and HTML export', { timeout: 60000 }, async () => {
  const until=process.env.NEXT_PUBLIC_SCENE_UNTIL_REVOKED==='true';
  const reauth=process.env.NEXT_PUBLIC_SCENE_REAUTH==='true';
  const {build}=createRequire(resolve('workers/video-scissors-mcp/package.json'))('esbuild');
  const consentBundle=await build({entryPoints:['workers/video-scissors-mcp/src/scene/SceneConsentView.ts'],bundle:true,platform:'node',format:'cjs',write:false});
  const consentModule={exports:{}};new Function('module','exports',consentBundle.outputFiles[0].text)(consentModule,consentModule.exports);
  const renderConsent=consentModule.exports.renderSceneConsentView;
  const requestId='11111111-1111-4111-8111-111111111111',nonce='local-compiled-reauth-nonce';
  const output=resolve(until?'.deploy/visual-remix/until-revoked/compiled-guard':'.deploy/visual-remix-connected-build');
  const staticRoot=resolve('out');
  await mkdir(output,{recursive:true});
  const server=createServer(async(req,res)=>{
    try {
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(pathname==='/authorize-local'){
        res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-"+nonce+"'; form-action 'self'");
        return res.end(renderConsent({handle:'synthetic-handle',clientName:'Synthetic ChatGPT',clientId:'same-client',redirectHost:'chatgpt.com',isLoopback:false,referenceEnabled:true,untilRevokedEnabled:until,reauthorization:{requestId,expiresAt:Date.now()+300000,scriptNonce:nonce}}));
      }
      if(pathname!=='/tools'&&!pathname.startsWith('/tools/')){res.statusCode=404;return res.end();}
      let name=pathname.slice('/tools'.length).replace(/^\//,'');
      if(name.includes('..')){res.statusCode=400;return res.end();}
      if(!name)name='index.html';else if(!extname(name))name+='.html';
      const file=resolve(staticRoot,name);
      if(!file.startsWith(staticRoot+sep)){res.statusCode=400;return res.end();}
      const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
      res.setHeader('Content-Type',mime[extname(name)]||'application/octet-stream');res.end(await readFile(file));
    } catch {res.statusCode=404;res.end();}
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  let browser;
  const calls=[],external=[],errors=[];let paired=false;
  try {
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
    const page=await context.newPage();
    const origin='http://127.0.0.1:'+server.address().port;
    const canary=resolve(output,'containment-canary.json');await writeFile(canary,'{"control":"LOCAL-CONTAINMENT-CONTROL"}');
    assert.equal((await fetch(origin+encodeURI(canary))).status,404,'absolute requests cannot expose files outside out');
    assert.ok([400,404].includes((await fetch(origin+'/tools/%2e%2e%2fpackage.json')).status),'encoded traversal is rejected');
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==origin){external.push(url.origin);return route.abort();}
      if(!url.pathname.startsWith('/scene/browser/'))return route.continue();
      const body=request.postDataJSON();calls.push({path:url.pathname,body});
      let result={ok:true};
      if(url.pathname.endsWith('/create')){
        const issued=Date.now();result={auth:{purpose:'visual-remix',shareId:'local-build-guard',projectId:body.snapshot.projectId,generation:body.snapshot.generation,epoch:1,credential:'a'.repeat(64)},proof:'b'.repeat(64),expiresAt:until?null:issued+1800000,proofExpiresAt:issued+300000,...(until?{lifetime:'until-revoked',issuedAt:issued}:{})};
      } else if(url.pathname.endsWith('/reauth/describe'))result={requestId,clientId:'same-client',clientName:'Synthetic ChatGPT',redirectHost:'chatgpt.com',resource:origin+'/scene/mcp',scopes:['scene:read','scene:propose'],expiresAt:Date.now()+300000,issuedAt:Date.now(),state:'pending'};
      else if(url.pathname.endsWith('/reauth/issue'))result={requestId,proof:'c'.repeat(64),expiresAt:Date.now()+300000,issuedAt:Date.now()};
      else if(url.pathname.endsWith('/poll'))result={command:null,cancellations:[],connected:paired,...(until?{cacheEpoch:0}:{})};
      else {if(until&&url.pathname.endsWith('/sync'))result.cacheEpoch=0;assert.ok(['/sync','/reference','/revoke','/report'].some(suffix=>url.pathname.endsWith(suffix)),url.pathname);}
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    });
    await page.goto(origin+'/tools/visual-remix');
    await page.getByText('Ready. Select a reference or open a saved project.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'Visual Remix Scene Sharing',exact:true}).count(),1,'Connected staging build omitted Scene Sharing. Use NEXT_PUBLIC_SCENE_REMOTE=true, not NEXT_PUBLIC_SCENE_REMOTE_ENABLED.');
    assert.equal(calls.length,0,'loading must not create a share');
    await page.getByRole('button',{name:'Add text block',exact:true}).click();
    await page.getByLabel('Text content',{exact:true}).fill('Connected export control 中文');
    const exportButton=page.getByRole('button',{name:'Export HTML',exact:true});
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Export HTML'&&!b.disabled));
    const [download]=await Promise.all([page.waitForEvent('download'),exportButton.click()]);
    const html=await readFile(await download.path(),'utf8');assert.match(html,/Connected export control 中文/);assert.match(html,/data-layer-id=/);
    const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=32;c.height=24;const x=c.getContext('2d');x.fillStyle='#218c64';x.fillRect(0,0,32,24);return c.toDataURL('image/png').split(',')[1];});
    await page.getByLabel('Reference image',{exact:true}).setInputFiles({name:'synthetic-connected-build.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await page.getByText('Reference ready locally. Choose reference sharing when connecting',{exact:false}).waitFor();
    assert.equal(await page.getByText('Attach it yourself to your chosen vision agent',{exact:false}).count(),0);
    await page.getByText('Review sharing consent',{exact:true}).click();
    const connect=page.getByRole('button',{name:'Connect',exact:true});assert.ok(await connect.isDisabled());
    await page.getByRole('checkbox',{name:/I authorize sharing scene text/}).check();
    assert.ok(await connect.isDisabled(),'both sharing confirmations are required');
    await page.getByRole('checkbox',{name:until?/I authorize sharing until I Disconnect or revoke/:/I authorize a 30-minute remote-sharing session/}).check();
    await page.getByRole('checkbox',{name:/Authorize sharing a normalized PNG copy/}).check();
    assert.equal(calls.length,0,'consent toggles alone must not upload');
    await connect.click();
    const proof=page.getByLabel('Pairing Proof (single-use, valid 5 minutes)',{exact:true});await proof.waitFor();assert.match(await proof.inputValue(),/^[a-f0-9]{64}$/);
    const creation=calls.filter(c=>c.path.endsWith('/create'));assert.equal(creation.length,1);if(until){assert.equal(creation[0].body.leaseMs,undefined);assert.deepEqual(creation[0].body.lifetime,{mode:'until-revoked',version:1,rememberBrowserControl:true});}else assert.equal(creation[0].body.leaseMs,1800000);assert.equal(creation[0].body.referenceConsent.confirmed,true);
    assert.equal(calls.filter(c=>c.path.endsWith('/reference')).length,0,'no image bytes before host binding');
    paired=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.getByText('Reference is stored in service D1',{exact:false}).waitFor();
    const uploads=calls.filter(c=>c.path.endsWith('/reference'));assert.equal(uploads.length,1);const image=uploads[0].body.reference;
    assert.equal(createHash('sha256').update(Buffer.from(image.data,'base64')).digest('hex'),image.manifest.sha256);
    assert.equal(await page.getByAltText('Reference · local only').count(),1);
    if(reauth){
      const oauth=await page.context().newPage();oauth.on('pageerror',e=>errors.push(e.message));
      await oauth.goto(origin+'/authorize-local');
      const reconnect=page.getByRole('button',{name:'Approve reconnect',exact:true});await reconnect.waitFor();assert.ok(await reconnect.isDisabled());
      assert.equal(calls.filter(c=>c.path.endsWith('/reauth/issue')).length,0);
      await page.getByRole('checkbox',{name:/Authorize reconnecting active Scene share/}).check();
      await page.getByRole('button',{name:'Dismiss',exact:true}).click();
      await oauth.getByRole('button',{name:'Ask active editor again',exact:true}).click();
      await reconnect.waitFor();assert.ok(await reconnect.isDisabled(),'reannounced request requires fresh consent');
      assert.equal(await page.getByRole('checkbox',{name:/Authorize reconnecting active Scene share/}).isChecked(),false);
      await page.getByRole('checkbox',{name:/Authorize reconnecting active Scene share/}).check();await reconnect.click();
      await oauth.getByText('Proof received from active editor. Click Approve below to complete authorization.',{exact:true}).waitFor();
      assert.equal(await oauth.locator('#browserProof').inputValue(),'c'.repeat(64));assert.equal(await oauth.locator('#reauthRequestId').inputValue(),requestId);
      assert.equal(new URL(oauth.url()).pathname,'/authorize-local','no auto-submit or navigation');
      assert.equal(calls.filter(c=>c.path.endsWith('/reauth/issue')).length,1);assert.equal(calls.filter(c=>c.path.endsWith('/create')).length,1);
      await oauth.locator('#browserProof').fill('d'.repeat(64));assert.equal(await oauth.locator('#reauthRequestId').inputValue(),'','manual proof cannot retain a different request binding');
      await oauth.close();
    }
    if(until){
      await page.getByText('Until you Disconnect or revoke',{exact:true}).waitFor();
      const beforeReload=calls.length;
      await page.reload();
      await page.getByText('Saved control recovery',{exact:true}).waitFor();
      assert.equal(calls.length,beforeReload,'recovered owner control must not sync, upload or reconnect');
      assert.equal(await page.getByLabel('Pairing Proof (single-use, valid 5 minutes)').count(),0);
      assert.equal(await page.getByRole('button',{name:'Connect',exact:true,includeHidden:true}).isDisabled(),true);
      await page.getByRole('button',{name:'Add text block',exact:true}).click();
      await page.getByLabel('Text content',{exact:true}).fill('Local work during control recovery');
      await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Export HTML'&&!b.disabled));
      const [recoveryDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export HTML',exact:true}).click()]);
      assert.match(await readFile(await recoveryDownload.path(),'utf8'),/Local work during control recovery/);
      assert.equal(calls.length,beforeReload);
    }
    await page.getByRole('button',{name:'Disconnect',exact:true}).click();
    await page.getByText('Revocation confirmed: active payloads have been removed from the service.',{exact:true}).waitFor();
    assert.equal(calls.filter(c=>c.path.endsWith('/revoke')).length,1);if(!until)assert.equal(await page.getByAltText('Reference · local only').count(),1);else assert.equal(await page.getByLabel('Text content',{exact:true}).inputValue(),'Local work during control recovery');
    assert.equal(external.length,0);assert.deepEqual(errors,[]);
    await page.screenshot({path:resolve(output,'connected-controls.png'),fullPage:true});
    const receipt={classification:'Compiled connected UI with local mock only; not live MCP/host proof',browser:browser.version(),sharingVisible:true,sameShareReauthorizationUI:reauth,untilRevokedMode:until,explicitRecoveryWithoutAutoSharing:until,localWorkDuringRecovery:until,referenceConsentVisible:true,manualConsentRequired:true,pairingProofReachable:true,referenceBytesAfterMockBinding:true,referenceHashVerified:true,htmlExportPreserved:true,revocationConfirmedLocally:true,localReferencePreserved:true,externalRequests:external.length,postCounts:Object.fromEntries([...new Set(calls.map(c=>c.path))].map(path=>[path,calls.filter(c=>c.path===path).length]))};
    await writeFile(resolve(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
  } finally {await browser?.close();await new Promise(ok=>server.close(ok));}
});

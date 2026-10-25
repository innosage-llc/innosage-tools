// Actual compiled route guard. All sharing traffic terminates at a local mock;
// this is not live OAuth, MCP, ChatGPT vision or Founder acceptance evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

test('connected build retains pairing, consented reference sharing and HTML export', { timeout: 60000 }, async () => {
  const output=resolve('.deploy/visual-remix-connected-build');
  const staticRoot=resolve('out');
  await mkdir(output,{recursive:true});
  const server=createServer(async(req,res)=>{
    try {
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
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
    const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});
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
        const issued=Date.now();result={auth:{purpose:'visual-remix',shareId:'local-build-guard',projectId:body.snapshot.projectId,generation:body.snapshot.generation,epoch:1,credential:'a'.repeat(64)},proof:'b'.repeat(64),expiresAt:issued+1800000,proofExpiresAt:issued+300000};
      } else if(url.pathname.endsWith('/poll'))result={command:null,cancellations:[],connected:paired};
      else assert.ok(['/sync','/reference','/revoke','/report'].some(suffix=>url.pathname.endsWith(suffix)),url.pathname);
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
    await page.getByRole('checkbox',{name:/I authorize a 30-minute remote-sharing session/}).check();
    await page.getByRole('checkbox',{name:/Authorize sharing a normalized PNG copy/}).check();
    assert.equal(calls.length,0,'consent toggles alone must not upload');
    await connect.click();
    const proof=page.getByLabel('Pairing Proof (single-use, valid 5 minutes)',{exact:true});await proof.waitFor();assert.match(await proof.inputValue(),/^[a-f0-9]{64}$/);
    const creation=calls.filter(c=>c.path.endsWith('/create'));assert.equal(creation.length,1);assert.equal(creation[0].body.leaseMs,1800000);assert.equal(creation[0].body.referenceConsent.confirmed,true);
    assert.equal(calls.filter(c=>c.path.endsWith('/reference')).length,0,'no image bytes before host binding');
    paired=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.getByText('Reference is stored in service D1',{exact:false}).waitFor();
    const uploads=calls.filter(c=>c.path.endsWith('/reference'));assert.equal(uploads.length,1);const image=uploads[0].body.reference;
    assert.equal(createHash('sha256').update(Buffer.from(image.data,'base64')).digest('hex'),image.manifest.sha256);
    await page.getByRole('button',{name:'Disconnect',exact:true}).click();
    await page.getByText('Revocation confirmed: active payloads have been removed from the service.',{exact:true}).waitFor();
    assert.equal(calls.filter(c=>c.path.endsWith('/revoke')).length,1);assert.equal(await page.getByAltText('Reference · local only').count(),1);
    assert.equal(external.length,0);assert.deepEqual(errors,[]);
    await page.screenshot({path:resolve(output,'connected-controls.png'),fullPage:true});
    const receipt={classification:'Compiled connected UI with local mock only; not live MCP/host proof',browser:browser.version(),sharingVisible:true,referenceConsentVisible:true,manualConsentRequired:true,pairingProofReachable:true,referenceBytesAfterMockBinding:true,referenceHashVerified:true,htmlExportPreserved:true,revocationConfirmedLocally:true,localReferencePreserved:true,externalRequests:external.length,postCounts:Object.fromEntries([...new Set(calls.map(c=>c.path))].map(path=>[path,calls.filter(c=>c.path===path).length]))};
    await writeFile(resolve(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
  } finally {await browser?.close();await new Promise(ok=>server.close(ok));}
});

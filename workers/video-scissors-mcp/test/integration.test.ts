import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { unstable_dev } from 'wrangler';

for (const arm of ['A', 'B'] as const) {
test(`full LOCAL ${arm} official OAuth/MCP + hidden WASM Cut1[2,4]/Cut2[6,10]/byte-Undo2/revoke/privacy`, { timeout: 120_000 }, async () => {
  const { chromium } = await import(process.env.VIDEO_SCISSORS_PLAYWRIGHT_MODULE || 'playwright');
  const worker = await unstable_dev('test/integration-worker.ts', { config: arm === 'B' ? 'wrangler.do-staging.template.jsonc' : 'wrangler.jsonc', local: true, localProtocol: 'https', persist: false,
    // Override only this ephemeral local process, never the template/live bindings.
    kv: [{ binding: 'OAUTH_KV', id: '00000000000000000000000000000000' }],
    vars: { EXPERIMENT_ENABLED: 'true' }, experimental: { disableExperimentalWarning: true, disableDevRegistry: true,
      d1Databases: [{ binding: 'DB', database_name: 'video-scissors-local-only', database_id: '00000000-0000-0000-0000-000000000000' }] }, logLevel: 'error' });
  console.log('local-integration-phase', 'worker-ready');
  const profile = await mkdtemp(join(tmpdir(),'hub346-integration-'));
  const downloads = join(profile,'downloads'); await mkdir(downloads);
  const chrome = spawn(process.env.VIDEO_SCISSORS_CHROME || chromium.executablePath(),
    [`--user-data-dir=${profile}`,'--remote-debugging-port=0','--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
  let browser;
  try {
    let port = '';
    for(let i=0;i<100&&!port;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{await delay(50);}}
    assert.ok(port);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{noDefaults:true});
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Security.setIgnoreCertificateErrors',{ignore:true});
    await cdp.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:downloads,eventsEnabled:true});
    const context = browser.contexts()[0];
    context.setDefaultTimeout(15_000); context.setDefaultNavigationTimeout(15_000);
    const origin = `https://${worker.address}:${worker.port}`;
    const initialized = await context.request.post(origin+'/__fixture/init',{ignoreHTTPSErrors:true});
    assert.equal(initialized.status(),204);
    const capabilities = await context.request.get(origin+'/remote/capabilities',{ignoreHTTPSErrors:true});
    assert.equal(capabilities.status(),200);
    assert.deepEqual(await capabilities.json(),{enabled:true,wakeup:arm === 'B' ? 'websocket' : 'poll'});
    const page = await context.newPage();
    const requests: {method:string;path:string;body:string|null;sameOrigin:boolean}[] = [];
    let appSockets=0;
    context.on('request', r => {const url=new URL(r.url());if(url.protocol==='http:'||url.protocol==='https:')requests.push({method:r.method(),path:url.pathname,body:r.postData(),sameOrigin:url.origin===origin});});
    page.on('websocket',()=>appSockets++);
    page.on('response',async r=>{if(new URL(r.url()).pathname==='/remote/projects'){const b=await r.json().catch(()=>({}));console.log('local-project-response',JSON.stringify({status:r.status(),error:b.error??null,hasProof:typeof b.proof==='string'}));}});
    page.on('pageerror',error=>console.log('local-page-error',error.message.replace(/https?:\/\/\S+/g,'<url>')));
    await page.goto(origin+'/tools/video-scissors');
    console.log('local-integration-phase', 'page-ready');
    await page.locator('input[type=file]').setInputFiles({name:'SYNTHETIC_MEDIA_CANARY.mp4',mimeType:'video/mp4',buffer:await readFile('../../public/video-scissors/demo.mp4')});
    await page.getByText('Video ready. Clip times use the original video.',{exact:true}).waitFor();
    console.log('local-integration-phase', 'wasm-inspection-ready');
    await page.getByRole('button',{name:'Connect experimental ChatGPT control',exact:true}).click();
    const proofElement=page.locator('code').filter({hasText:/^[a-f0-9]{64}$/});
    await proofElement.waitFor(); const proof=(await proofElement.textContent())!;
    const json=async(path:string,body:unknown,token?:string)=>{
      const r=await context.request.post(origin+path,{headers:{Origin:origin,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(token?{Authorization:'Bearer '+token,'MCP-Protocol-Version':'2025-06-18'}:{})},data:body,ignoreHTTPSErrors:true,maxRedirects:0});
      assert.equal(r.status(),path==='/oauth/register'?201:200);
      const text=await r.text();return r.headers()['content-type']?.includes('text/event-stream')?JSON.parse(text.split('\n').find(l=>l.startsWith('data: '))!.slice(6)):JSON.parse(text);
    };
    const client=await json('/oauth/register',{client_name:'Local synthetic MCP caller',redirect_uris:['https://client.example/callback/local'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']});
    const verifier='b'.repeat(64),challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
    const consent=await context.newPage();
    await consent.goto(origin+'/authorize?'+new URLSearchParams({client_id:client.client_id,redirect_uri:'https://client.example/callback/local',response_type:'code',scope:'video:read video:edit',resource:origin+'/mcp',state:'synthetic-state',code_challenge:challenge,code_challenge_method:'S256'}));
    await consent.getByLabel('One-Time Browser Pairing Proof',{exact:true}).fill(proof);
    // Capture the redirect locally; never contact the synthetic external client.
    let callback='';
    await context.route('https://client.example/**',route=>{callback=route.request().url();return route.fulfill({status:200,body:'Synthetic callback captured locally'});});
    await consent.getByRole('button',{name:'Approve',exact:true}).click();
    await consent.waitForURL('https://client.example/**');
    const url=new URL(callback);assert.equal(url.searchParams.get('iss'),origin);
    console.log('local-integration-phase', 'consent-approved');
    const exchanged=await context.request.post(origin+'/oauth/token',{ignoreHTTPSErrors:true,form:{grant_type:'authorization_code',client_id:client.client_id,code:url.searchParams.get('code')!,code_verifier:verifier,redirect_uri:'https://client.example/callback/local',resource:origin+'/mcp'}});
    assert.equal(exchanged.status(),200);const token=(await exchanged.json()).access_token;
    const rpc=async(name:string,args:object={})=>{
      const response=await json('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},token);
      assert.equal(response.result.isError,undefined);return JSON.parse(response.result.content[0].text);
    };
    const waitForOperation=async(operationId:string)=>{
      for(let i=0;i<200;i++){
        const status=await rpc('status',{operationId});
        if(status.state==='completed')return status.metadata;
        assert.ok(['queued','claimed'].includes(status.state),`${operationId} must not fail or disappear`);
        await delay(250);
      }
      assert.fail(`${operationId} did not complete within 50 seconds`);
    };
    const waitForPreview=async(seconds:number)=>page.waitForFunction(expected=>{
      const video=document.querySelector<HTMLVideoElement>('video[aria-label="Edited video preview"]');
      return !!video&&video.readyState>=1&&Number.isFinite(video.duration)&&Math.abs(video.duration-expected)<0.15;
    },seconds,{timeout:60_000});
    const currentPlan=()=>page.locator('input[aria-label^="Clip "]').evaluateAll(inputs=>inputs.map(input=>{
      const element=input as HTMLInputElement;
      return [element.getAttribute('aria-label'),element.valueAsNumber];
    }));
    const download=async()=>{
      const blobBytes=Buffer.from(await page.evaluate(async()=>{
        const video=document.querySelector<HTMLVideoElement>('video[aria-label="Edited video preview"]');
        if(!video?.src.startsWith('blob:'))throw new Error('Expected browser-local preview blob');
        return Array.from(new Uint8Array(await(await fetch(video.src)).arrayBuffer()));
      }));
      // GUID filenames avoid repeated suggested download names resolving to an
      // earlier Cut1 file. Match the completion event to this exact download.
      const finished=new Promise<string>(resolve=>{
        let guid='';
        const begin=(event:{guid:string})=>{guid=event.guid;};
        const progress=(event:{guid:string;state:string})=>{
          if(event.guid===guid&&event.state==='completed'){
            cdp.off('Browser.downloadWillBegin',begin);cdp.off('Browser.downloadProgress',progress);resolve(guid);
          }
        };
        cdp.on('Browser.downloadWillBegin',begin);cdp.on('Browser.downloadProgress',progress);
      });
      await page.getByRole('button',{name:'Download cut MP4 video',exact:true}).click();
      const filename=await finished;assert.equal(basename(filename),filename);
      const downloadedPath=join(downloads,filename);
      const bytes=await readFile(downloadedPath);
      assert.deepEqual(bytes,blobBytes,'download matches the current preview blob byte-for-byte');
      // Probe the existing download: ffprobe may stop reading stdin before Node
      // finishes writing a larger MP4, causing an unrelated EPIPE in the harness.
      const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name','-of','json',downloadedPath],{encoding:'utf8'}));
      assert.deepEqual(probe.streams.map((stream:{codec_name:string})=>stream.codec_name),['h264','aac']);
      return {bytes,hash:createHash('sha256').update(bytes).digest('hex'),seconds:Number(probe.format.duration)};
    };
    await page.getByText('Connected',{exact:true}).waitFor();
    await consent.bringToFront();
    assert.equal(await page.evaluate(()=>document.visibilityState),'hidden');
    const project=await rpc('getproject');
    const started=Date.now();
    assert.equal((await rpc('cut',{operationId:'browser-cut-1',generation:project.metadata.generation,version:project.metadata.version,clips:[{start:2,end:4}]})).state,'queued');
    const cut1Metadata=await waitForOperation('browser-cut-1');
    assert.equal(await page.evaluate(()=>document.visibilityState),'hidden');
    await page.bringToFront();
    // Completion above proves hidden execution. Preview metadata/rAF may be
    // suspended in hidden Chrome tabs, so inspect readiness after foregrounding.
    await waitForPreview(2);
    const cut1Plan=await currentPlan();
    assert.deepEqual(cut1Plan,[['Clip 1 start time in seconds',2],['Clip 1 end time in seconds',4]]);
    const cut1=await download();assert.ok(Math.abs(cut1.seconds-2)<0.1);
    await consent.bringToFront();assert.equal(await page.evaluate(()=>document.visibilityState),'hidden');
    const beforeCut2=await rpc('getproject');
    assert.equal(beforeCut2.metadata.latestOperationId,'browser-cut-1');
    assert.equal((await rpc('cut',{operationId:'browser-cut-2',generation:beforeCut2.metadata.generation,version:beforeCut2.metadata.version,clips:[{start:6,end:10}]})).state,'queued');
    const cut2Metadata=await waitForOperation('browser-cut-2');
    assert.equal(await page.evaluate(()=>document.visibilityState),'hidden');
    await page.bringToFront();
    await waitForPreview(4);
    assert.deepEqual(await currentPlan(),[['Clip 1 start time in seconds',6],['Clip 1 end time in seconds',10]]);
    const cut2=await download();assert.ok(Math.abs(cut2.seconds-4)<0.1);
    assert.notEqual(cut2.hash,cut1.hash,'Cut2 must not reuse Cut1 content');
    await consent.bringToFront();assert.equal(await page.evaluate(()=>document.visibilityState),'hidden');
    const beforeUndo=await rpc('getproject');
    assert.equal(beforeUndo.metadata.latestOperationId,'browser-cut-2');
    assert.equal((await rpc('undo',{operationId:'browser-undo-2',generation:beforeUndo.metadata.generation,version:beforeUndo.metadata.version,targetOperationId:'browser-cut-2'})).state,'queued');
    const restoredMetadata=await waitForOperation('browser-undo-2');
    assert.equal(await page.evaluate(()=>document.visibilityState),'hidden');
    await page.bringToFront();
    await waitForPreview(2);
    const restored=await download();
    assert.deepEqual(restored.bytes,cut1.bytes,'Undo2 restores Cut1 bytes exactly');
    assert.equal(restored.hash,cut1.hash,'Undo2 restores Cut1 SHA-256 exactly');
    assert.deepEqual(await currentPlan(),cut1Plan,'Undo2 restores Cut1 clip plan exactly');
    assert.equal(restoredMetadata.generation,cut1Metadata.generation);
    assert.ok(restoredMetadata.version>cut2Metadata.version,'Undo2 version remains monotonic');
    assert.equal(restoredMetadata.hasOutput,true);
    await page.getByRole('button',{name:'Disconnect',exact:true}).click();
    await page.getByText('Disconnected',{exact:true}).waitFor();
    const revoked=await json('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'getproject',arguments:{}}},token);
    assert.equal(revoked.result.isError,true);
    // Local controls remain usable after cloud disconnect, with the same history.
    await page.getByRole('spinbutton',{name:'Clip 1 start time in seconds',exact:true}).fill('0');
    await page.getByRole('spinbutton',{name:'Clip 1 end time in seconds',exact:true}).fill('2');
    await page.getByRole('button',{name:'Cut video segments',exact:true}).click();
    await page.getByText('Cut complete. Your original video is unchanged.',{exact:true}).waitFor();
    const previousPreview=await page.locator('video').last().getAttribute('src');
    for(const range of [{start:'0',end:'61'},{start:'-1',end:'2'},{start:'3',end:'2'}]){
      await page.getByRole('spinbutton',{name:'Clip 1 start time in seconds',exact:true}).fill(range.start);
      await page.getByRole('spinbutton',{name:'Clip 1 end time in seconds',exact:true}).fill(range.end);
      await page.getByRole('button',{name:'Cut video segments',exact:true}).click();
      await page.getByRole('alert').filter({hasText:'Processing Error'}).waitFor();
      assert.equal(await page.locator('video').last().getAttribute('src'),previousPreview);
      assert.equal(await page.getByRole('button',{name:'Download cut MP4 video',exact:true}).isEnabled(),true);
    }
    await page.getByRole('button',{name:'Undo cut and restore previous plan',exact:true}).click();
    const appRequests=requests.filter(r=>!r.path.startsWith('/authorize')&&r.sameOrigin);
    assert.ok(appRequests.every(r=>!r.body?.includes('SYNTHETIC_MEDIA_CANARY')&&!r.body?.includes('data:video')&&!r.body?.includes('blob:')));
    assert.ok(requests.filter(r=>r.body&&r.sameOrigin).every(r=>['/remote/','/mcp','/oauth/','/authorize','/__fixture/'].some(prefix=>r.path.startsWith(prefix))));
    if(arm==='A')assert.equal(appSockets,0);else assert.ok(appSockets>=1,'B exercises its real local wake socket');
    console.log('local-integration-result',JSON.stringify({arm,officialOAuth:true,syntheticMcpCaller:true,realChatGPT:false,geminiConsentUI:true,hiddenDelivery:true,wasmCut:true,download:true,cutRanges:[[2,4],[6,10]],outputSeconds:[cut1.seconds,cut2.seconds,restored.seconds],cut1Sha256:cut1.hash,undo2Sha256:restored.hash,undo2ByteIdenticalToCut1:true,undo2PlanIdenticalToCut1:true,previewBlobsMatchDownloads:true,codecs:['h264','aac'],remoteUndo:true,localAfterDisconnect:true,invalidLocalRangesVisible:true,previousPreviewRetained:true,d1Revoke:true,appWebSockets:appSockets,mediaCanaryAbsent:true,controlBodyCount:requests.filter(r=>r.body&&r.sameOrigin).length,wallMilliseconds:Date.now()-started,cloudCpuMilliseconds:null}));
  }finally{
    await browser?.close();
    if(chrome.exitCode===null){const exited=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill('SIGTERM');await exited;}
    await worker.stop();await rm(profile,{recursive:true,force:true});
  }
});
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { unstable_dev } from 'wrangler';

test('full LOCAL official OAuth/MCP + Gemini UI + background browser WASM cut/download/Undo/revoke/privacy', { timeout: 120_000 }, async () => {
  const { chromium } = await import(process.env.VIDEO_SCISSORS_PLAYWRIGHT_MODULE || 'playwright');
  const worker = await unstable_dev('test/integration-worker.ts', { config: 'wrangler.jsonc', local: true, localProtocol: 'https', persist: false,
    vars: { EXPERIMENT_ENABLED: 'true' }, experimental: { disableExperimentalWarning: true, disableDevRegistry: true }, logLevel: 'error' });
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
    await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
    const context = browser.contexts()[0];
    context.setDefaultTimeout(15_000); context.setDefaultNavigationTimeout(15_000);
    const origin = `https://${worker.address}:${worker.port}`;
    const initialized = await context.request.post(origin+'/__fixture/init',{ignoreHTTPSErrors:true});
    assert.equal(initialized.status(),204);
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
    await page.getByText('Connected',{exact:true}).waitFor();
    await consent.bringToFront();
    assert.equal(await page.evaluate(()=>document.visibilityState),'hidden');
    const project=await rpc('getproject');
    const started=Date.now();
    await rpc('cut',{operationId:'browser-cut',generation:project.metadata.generation,version:project.metadata.version,clips:[{start:0,end:2}]});
    await page.getByText('Cut complete. Your original video is unchanged.',{exact:true}).waitFor({timeout:60_000});
    assert.equal(await page.evaluate(()=>document.visibilityState),'hidden');
    const completed=await rpc('status',{operationId:'browser-cut'});
    // Browser completion may precede terminal HTTP acknowledgement briefly.
    for(let i=0;completed.state!=='completed'&&i<100;i++){await delay(50);Object.assign(completed,await rpc('status',{operationId:'browser-cut'}));}
    assert.equal(completed.state,'completed');
    await page.bringToFront();
    const downloadFinished=new Promise<string>(resolve=>{let name='';cdp.on('Browser.downloadWillBegin',e=>{name=e.suggestedFilename;});cdp.on('Browser.downloadProgress',e=>{if(e.state==='completed')resolve(name);});});
    await page.getByRole('button',{name:'Download cut MP4 video',exact:true}).click();
    const filename=await downloadFinished;assert.equal(basename(filename),filename);
    const output=await readFile(join(downloads,filename));
    const native=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name','-of','json','pipe:0'],{input:output,encoding:'utf8'}));
    assert.ok(Math.abs(Number(native.format.duration)-2)<0.1);assert.deepEqual(native.streams.map((s:{codec_name:string})=>s.codec_name),['h264','aac']);
    const beforeUndo=await rpc('getproject');
    await rpc('undo',{operationId:'browser-undo',generation:beforeUndo.metadata.generation,version:beforeUndo.metadata.version,targetOperationId:'browser-cut'});
    await page.getByRole('button',{name:'Undo cut and restore previous plan',exact:true}).waitFor();
    for(let i=0;i<100;i++){const s=await rpc('status',{operationId:'browser-undo'});if(s.state==='completed')break;await delay(50);}
    assert.equal((await rpc('status',{operationId:'browser-undo'})).state,'completed');
    await page.getByRole('button',{name:'Disconnect',exact:true}).click();
    await page.getByText('Disconnected',{exact:true}).waitFor();
    const revoked=await json('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'getproject',arguments:{}}},token);
    assert.equal(revoked.result.isError,true);
    // Local controls remain usable after cloud disconnect, with the same history.
    await page.getByRole('button',{name:'Add clip segment',exact:true}).click();
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
    assert.equal(appSockets,0);
    console.log('local-integration-result',JSON.stringify({officialOAuth:true,syntheticMcpCaller:true,realChatGPT:false,geminiConsentUI:true,hiddenDelivery:true,wasmCut:true,download:true,outputSeconds:Number(native.format.duration),codecs:['h264','aac'],remoteUndo:true,localAfterDisconnect:true,invalidLocalRangesVisible:true,previousPreviewRetained:true,d1Revoke:true,appWebSockets:appSockets,mediaCanaryAbsent:true,controlBodyCount:requests.filter(r=>r.body&&r.sameOrigin).length,wallMilliseconds:Date.now()-started,cloudCpuMilliseconds:null}));
  }finally{
    await browser?.close();
    if(chrome.exitCode===null){const exited=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill('SIGTERM');await exited;}
    await worker.stop();await rm(profile,{recursive:true,force:true});
  }
});

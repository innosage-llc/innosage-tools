// Local Chrome/WASM fixture: no live service, credentials, media artifacts or host claim.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require = createRequire(new URL('../workers/video-scissors-mcp/package.json', import.meta.url));
const { build } = require('esbuild');
const output = resolve('.deploy/video-scissors-frames'); mkdirSync(output, { recursive: true });
const bundle = await build({ stdin: { contents: `
import { videoScissorsRenderer as renderer } from './lib/video-scissors-browser';
import { withFfmpeg } from './lib/local-ffmpeg-browser';
import { VideoScissorsController } from './lib/video-scissors';
import { VideoScissorsRemoteAdapter } from './lib/video-scissors-remote';
window.runFrames = async () => {
  const signal = new AbortController().signal;
  const generated = await withFfmpeg(signal, async (ff,logs) => {
    const code = await ff.exec(['-f','lavfi','-i','color=c=black:s=160x90:r=10:d=3',
      '-f','lavfi','-i','sine=frequency=440:duration=3',
      '-vf','geq=lum=16+N*5:cb=128:cr=128','-c:v','libx264','-g','10','-bf','0',
      '-pix_fmt','yuv420p','-crf','0','-c:a','aac','-shortest','fixture.mp4']);
    if(code)throw Error('FIXTURE');
    const vfr = await ff.exec(['-i','fixture.mp4','-vf','select=not(eq(n\\\\,10))','-fps_mode','vfr','-c:v','libx264','-crf','0','-c:a','copy','vfr.mp4']);
    if(vfr)throw Error('VFR_FIXTURE '+logs.slice(-8).join(' | '));
    return {cfr:await ff.readFile('fixture.mp4'),vfr:await ff.readFile('vfr.mp4')};
  });
  const bytes=generated.cfr;
  const file = new File([bytes], 'private-synthetic-name.mp4', {type:'video/mp4'});
  const c = new VideoScissorsController({renderer}); await c.selectSource(file);
  if(c.getSnapshot().error) throw Error(c.getSnapshot().error);
  const adapter = new VideoScissorsRemoteAdapter(c, { publish: async()=>{}, claim:async()=>null,
    report:async()=>{}, cancellation:async()=>false, revoke:async()=>{} });
  c.setSegments([{start:1,end:2}]); await adapter.localCut('cut',c.getSnapshot().segments);
  const mp4 = c.createDownload().blob, preview = c.getSnapshot().previewUrl;
  const rows=[];
  const times=[0, .099, .101, .999, 1, 1.001, 1.999, 2.001, 2.89, 2.999];
  for(const time of times){
    const m=adapter.metadata(), command={operationId:'png-'+times.indexOf(time),generation:m.generation,version:m.version,kind:'extractframe',timeSeconds:time};
    const pending=adapter.execute(command); if(adapter.execute(command)!==pending)throw Error('REPLAY');
    const result=await pending; if(result.status!=='completed')throw Error('EXTRACT '+time+' '+c.getSnapshot().error);
    const blob=c.createFrameDownload().blob, bitmap=await createImageBitmap(blob);
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
    rows.push({time,width:canvas.width,height:canvas.height,pixel:Array.from(ctx.getImageData(80,45,1,1).data),type:blob.type,size:blob.size});
    if(c.createDownload().blob!==mp4||c.getSnapshot().previewUrl!==preview)throw Error('MP4_CHANGED');
    if(adapter.metadata().latestOperationId!=='cut')throw Error('UNDO_TARGET');
  }
  const stable=c.createFrameDownload().blob;
  await c.extractFrame({operationId:'bad',sourceGeneration:c.getSnapshot().sourceGeneration,version:c.getSnapshot().version},3);
  if(c.createFrameDownload().blob!==stable)throw Error('FAILED_FRAME_LOST');
  const m=adapter.metadata();const pending=adapter.execute({operationId:'cancel',generation:m.generation,version:m.version,kind:'extractframe',timeSeconds:2});
  c.cancel(); if((await pending).status!=='cancelled'||c.createFrameDownload().blob!==stable)throw Error('CANCEL');
  if((await adapter.localUndo('undo')).status!=='completed'||c.createDownload()!==null||c.createFrameDownload().blob!==stable)throw Error('UNDO');
  const metadata=adapter.metadata();
  if(/private|blob:|fileName|frameUrl|png/.test(JSON.stringify(metadata)))throw Error('PRIVACY');
  await c.selectSource(new File([generated.vfr],'vfr.mp4',{type:'video/mp4'}));
  if(c.getSnapshot().error)throw Error('VFR_INSPECT '+c.getSnapshot().error);
  const variable=[];
  for(const time of [.999,1,1.001,2.999]) {
    const m=adapter.metadata();const result=await adapter.execute({operationId:'vfr-'+variable.length,generation:m.generation,version:m.version,kind:'extractframe',timeSeconds:time});
    if(result.status!=='completed')throw Error('VFR_EXTRACT '+time);
    const bitmap=await createImageBitmap(c.createFrameDownload().blob);
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
    variable.push({time,observedFrame:Math.round(ctx.getImageData(80,45,1,1).data[0]*219/255/5)});
  }
  await c.selectSource(new File([bytes],'second.mp4',{type:'video/mp4'}));
  if(c.createFrameDownload()!==null||c.getSnapshot().frameUrl!==null)throw Error('SOURCE_SWITCH');
  await adapter.dispose();c.dispose();return {rows,variable,metadata,fixture:Array.from(bytes)};
};`, resolveDir: resolve('.'), sourcefile: 'frame-test.ts', loader: 'ts' }, bundle: true, format: 'iife', platform: 'browser', write: false });
const requests = [], errors = [];
const server = createServer((req, res) => {
  requests.push({ method: req.method });
  res.setHeader('Cross-Origin-Opener-Policy','same-origin'); res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  try {
    if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<script src="/harness.js"></script>');}
    if(req.url==='/harness.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].text);}
    if(req.url.startsWith('/tools/') && !req.url.includes('/video-scissors/ffmpeg/')) {
      const clean=req.url.split('?')[0].replace(/^\/tools/, '');
      const path=resolve('out',clean.slice(1)+(clean==='/video-scissors'?'.html':''));
      if(!path.startsWith(resolve('out')+'/'))throw Error('PATH');
      const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2'}[extname(path)];
      if(type)res.setHeader('Content-Type',type);return res.end(readFileSync(path));
    }
    const path=resolve('public/video-scissors/ffmpeg',req.url.split('/').at(-1));
    res.setHeader('Content-Type',extname(path)==='.js'?'application/javascript':'application/octet-stream');
    res.end(readFileSync(path));
  }catch{res.statusCode=404;res.end();}
});
await new Promise(yes=>server.listen(0,'127.0.0.1',yes));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.VIDEO_SCISSORS_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{assert.ok(r.url().startsWith(origin)||r.url().startsWith('blob:'),'no external request');assert.equal(r.postData(),null);});
  await page.goto(origin);const result=await page.evaluate(()=>window.runFrames());
  for(const row of result.rows){
    assert.equal(row.width,160);assert.equal(row.height,90);assert.equal(row.type,'image/png');assert.ok(row.size>0);
    const expectedFrame=Math.min(29,Math.ceil(row.time*10));
    const observedFrame=Math.round(row.pixel[0]*219/255/5);
    assert.equal(observedFrame,expectedFrame,JSON.stringify(row));
    row.observedFrame=observedFrame;
    assert.ok(Math.abs(observedFrame/10-row.time)<=.1+1e-6);
  }
  assert.deepEqual(result.variable.map(r=>r.observedFrame),[11,11,11,29]);
  const fixture=Buffer.from(result.fixture);delete result.fixture;
  await page.goto(origin+'/tools/video-scissors');
  await page.locator('input[type=file]').setInputFiles({name:'synthetic.mp4',mimeType:'video/mp4',buffer:fixture});
  await page.getByRole('status').filter({hasText:'Video ready'}).waitFor();
  await page.getByRole('button',{name:'Add clip segment',exact:true}).click();
  await page.getByRole('spinbutton',{name:'Clip 1 start time in seconds',exact:true}).fill('1');
  await page.getByRole('spinbutton',{name:'Clip 1 end time in seconds',exact:true}).fill('2');
  await page.getByRole('button',{name:'Cut video segments',exact:true}).click();
  await page.getByRole('button',{name:'Download cut MP4 video',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('button[aria-label="Download cut MP4 video"]').disabled);
  await page.getByLabel('Original-source time (seconds)',{exact:true}).fill('0.101');
  await page.getByRole('button',{name:'Capture Current Frame',exact:true}).click();
  const image=page.getByRole('img',{name:/Extracted original-source frame/});await image.waitFor();
  await page.waitForFunction(()=>document.querySelector('img[alt^="Extracted original-source frame"]')?.naturalWidth===160);
  const pixel=await image.evaluate(img=>{const c=document.createElement('canvas');c.width=160;c.height=90;const x=c.getContext('2d');x.drawImage(img,0,0);return x.getImageData(80,45,1,1).data[0];});
  assert.equal(Math.round(pixel*219/255/5),2,'UI captures original, not edited timeline');
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download PNG',exact:true}).click();
  const download=await event;assert.match(download.suggestedFilename(),/\.png$/);
  const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
  const png=Buffer.concat(chunks);assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),160);assert.equal(png.readUInt32BE(20),90);
  await page.getByRole('button',{name:'Undo cut and restore previous plan',exact:true}).click();
  assert.equal(await image.count(),1);
  await page.locator('input[type=file]').setInputFiles({name:'second.mp4',mimeType:'video/mp4',buffer:fixture});
  await page.getByRole('status').filter({hasText:'Video ready'}).waitFor();assert.equal(await image.count(),0);
  assert.equal(await page.getByRole('button',{name:'Download PNG',exact:true}).isDisabled(),true);
  assert.deepEqual(errors,[]);assert.ok(requests.every(r=>['GET','HEAD'].includes(r.method)));
  result.website={preview:'PASS',downloadPng:'PASS',sourceTimeAfterCut:'PASS',undoPreservesPng:'PASS',sourceSwitch:'PASS',chatConnection:false};
  const sourceHash=createHash('sha256');
  for(const path of ['lib/video-scissors.ts','lib/video-scissors-browser.ts','lib/video-scissors-remote.ts','lib/video-scissors-remote-browser.ts','app/video-scissors/VideoScissorsApp.tsx','app/video-scissors/VideoScissorsView.tsx','workers/video-scissors-mcp/src/d/mcp.ts','workers/video-scissors-mcp/src/d/ProjectStateDO.ts','scripts/video-scissors-frames.e2e.mjs'])sourceHash.update(readFileSync(path));
  const evidence={status:'PASS',browser:await browser.version(),sourceHash:sourceHash.digest('hex'),...result,
    requests:requests.length,mediaUploads:0,requestBodies:0,externalRequests:0,mp4CutUndo:'PASS',cancel:'PASS',sourceSwitch:'PASS',hostProof:false};
  writeFileSync(resolve(output,'evidence.json'),JSON.stringify(evidence,null,2)); console.log(JSON.stringify(evidence,null,2));
}finally{await browser.close();await new Promise(yes=>server.close(yes));}

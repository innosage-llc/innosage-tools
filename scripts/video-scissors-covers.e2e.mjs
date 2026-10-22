// Offline synthetic fixture only: actual shipped browser/WASM renderer, isolated Chrome.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require = createRequire(new URL('../workers/video-scissors-mcp/package.json', import.meta.url));
const { build } = require('esbuild');
const root = resolve('.');
const output = resolve('.deploy/video-scissors-covers'); mkdirSync(output, { recursive: true });
const bundle = await build({ stdin: { contents: `
  import { videoScissorsRenderer as renderer } from './lib/video-scissors-browser';
  import { VideoScissorsController } from './lib/video-scissors';
  import { COVER_PRESETS } from './lib/video-scissors-covers';
  window.runCovers = async () => {
    const bytes = await (await fetch('/fixture.mp4')).arrayBuffer();
    const file = new File([bytes], '本周_Founder_Sync.mp4', {type:'video/mp4'});
    const c = new VideoScissorsController({renderer});
    await c.selectSource(file); if(c.getSnapshot().error) throw Error(c.getSnapshot().error);
    c.setSegments([{start:20,end:22},{start:0,end:2}]);
    const result = [];
    for(const preset of COVER_PRESETS){
      const s=c.getSnapshot(); await c.applyCoverPreset({operationId:preset.id,sourceGeneration:s.sourceGeneration,version:s.version},preset.id);
      if(c.getSnapshot().error) throw Error(c.getSnapshot().error);
      const download=c.createDownload(); if(!download)throw Error('NO_DOWNLOAD');
      const blob=download.blob; const url=URL.createObjectURL(blob);
      const video=document.createElement('video');video.muted=true;video.src=url;
      await new Promise((yes,no)=>{video.onloadedmetadata=yes;video.onerror=no;});
      const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      const ctx=canvas.getContext('2d');
      const pixels=[];
      for(const time of [0.2,1.4,1.6,3.7,5.4]){
        video.currentTime=time;await new Promise(yes=>video.onseeked=yes);ctx.drawImage(video,0,0);
        pixels.push(Array.from(ctx.getImageData(12,12,1,1).data).slice(0,3));
      }
      const audio=new AudioContext();const decoded=await audio.decodeAudioData(await blob.arrayBuffer());
      const samples=decoded.getChannelData(0);
      const energy=(start,end)=>{let sum=0;for(let i=Math.floor(start*decoded.sampleRate);i<Math.floor(end*decoded.sampleRate);i++)sum+=samples[i]*samples[i];return sum/((end-start)*decoded.sampleRate);};
      const probe=await renderer.inspect(new File([blob],'output.mp4'),new AbortController().signal);
      const data=await new Promise(yes=>{const r=new FileReader();r.onload=()=>yes(r.result.split(',')[1]);r.readAsDataURL(blob);});
      result.push({id:preset.id,duration:video.duration,probe,pixels,silence:energy(.1,1.4),footage:energy(1.7,2),data});
      await audio.close();URL.revokeObjectURL(url);
    }
    const last=c.createDownload().blob;const before=c.getSnapshot();
    c.undo({operationId:'undo-final',sourceGeneration:before.sourceGeneration,version:before.version});
    if(c.getSnapshot().coverPresetId!=='lavender'||c.createDownload().blob===last)throw Error('UNDO');
    c.dispose(); return result;
  };`, resolveDir: root, sourcefile: 'cover-test.ts', loader: 'ts' }, bundle: true, format: 'iife', platform: 'browser', write: false });
const requests = []; const errors = [];
const server = createServer((req, res) => {
  requests.push({ path: req.url, method: req.method });
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  try {
    if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<script src="/harness.js"></script>');}
    if(req.url==='/harness.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].text);}
    const path=req.url==='/fixture.mp4'?resolve('public/video-scissors/demo.mp4'):resolve('public/video-scissors/ffmpeg',req.url.split('/').at(-1));
    if(!path.startsWith(root+'/public/'))throw Error('PATH');
    res.setHeader('Content-Type',extname(path)==='.js'?'application/javascript':extname(path)==='.mp4'?'video/mp4':'application/octet-stream');
    res.end(readFileSync(path));
  }catch{res.statusCode=404;res.end();}
});
await new Promise(yes=>server.listen(0,'127.0.0.1',yes));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.VIDEO_SCISSORS_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{assert.ok(r.url().startsWith(origin)||r.url().startsWith('blob:'),'no external request');});
  await page.goto(origin);const results=await page.evaluate(()=>window.runCovers());
  for(const result of results){
    writeFileSync(resolve(output,result.id+'.mp4'),Buffer.from(result.data,'base64'));delete result.data;
    assert.ok(Math.abs(result.duration-5.5)<.15,`${result.id} duration ${result.duration}`);
    assert.equal(result.probe.videoCodec,'h264');assert.equal(result.probe.audioCodec,'aac');
    assert.ok(result.silence<.00001,`${result.id} intro silence`);assert.ok(result.footage>.001,`${result.id} footage audio`);
    assert.ok(result.pixels[2][1]>result.pixels[2][0]+40,'first footage is green');
    assert.ok(result.pixels[3][0]>result.pixels[3][1]+80,'next clip is red');
    assert.ok(result.pixels[4][0]>result.pixels[4][1]+80,'last frame remains footage');
    assert.ok(result.pixels[0].every((channel,index)=>Math.abs(channel-result.pixels[1][index])<=4),'static title card through 1.4s (H.264 quantization tolerance)');
  }
  assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'),'no media upload');
  writeFileSync(resolve(output,'evidence.json'),JSON.stringify({results,requests,errors,hostProof:false},null,2));
  console.log(JSON.stringify({passed:results.length,output,externalRequests:0,mediaUploads:0}));
}finally{await browser.close();await new Promise(yes=>server.close(yes));}

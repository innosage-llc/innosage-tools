import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const require=createRequire(resolve('workers/video-scissors-mcp/package.json'));
const {build}=require('esbuild');
test('offline layered HTML: text/order/geometry, original bytes, crop isolation, fidelity and independent DOM edits',{timeout:60000},async()=>{
 const output=resolve('.deploy/visual-remix/html-export/synthetic');await mkdir(output,{recursive:true});
 const compiled=await build({stdin:{contents:"import {exportSceneHTML} from './lib/visual-remix-html.ts';import {renderScene} from './lib/visual-remix-renderer.ts';import {emptyScene} from './lib/visual-remix.ts';import {LocalAssets} from './lib/visual-remix-assets.ts';window.fixture={exportSceneHTML,renderScene,emptyScene,LocalAssets};",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'esm',write:false});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?compiled.outputFiles[0].text:'<!doctype html><script type="module" src="/fixture.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1080,height:1440},deviceScaleFactor:1});
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.fixture);
  const result=await page.evaluate(async()=>{
   const {exportSceneHTML,renderScene,emptyScene,LocalAssets}=window.fixture,signal=new AbortController().signal,assets=new LocalAssets(),canvas=document.createElement('canvas');
   canvas.width=32;canvas.height=24;const ctx=canvas.getContext('2d');ctx.fillStyle='#ee2233';ctx.fillRect(0,0,16,24);ctx.fillStyle='#22bb66';ctx.fillRect(16,0,16,24);ctx.clearRect(16,0,2,2);
   const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const asset=await assets.add('used',blob,signal);
   ctx.fillStyle='#4433cc';ctx.fillRect(0,0,32,24);const unused=await new Promise(r=>canvas.toBlob(r,'image/png'));const extra=await assets.add('unused',unused,signal);
   const box=(id,x,y,width,height)=>({id,x,y,width,height,rotation:0,opacity:1});
   const scene={...emptyScene(),provenance:'PRIVATE_META_MUST_NOT_EXPORT',limitations:'PRIVATE_LIMITATIONS',assets:[asset,extra],nodes:[
    {...box('title',80,80,600,180),type:'text',text:'Hello & 中文\nExact "quotes" and entities &lt;img&gt;\r\nFinal',font:'sans',fontSize:32,fontWeight:'normal',lineHeight:1.25,align:'left',wrap:'word',fill:'#111111'},
    {...box('shape',80,320,200,60),type:'rect',fill:'#4455cc80',cornerRadius:12},
    {...box('full-image',80,440,128,96),type:'image',assetId:'used',crop:{x:0,y:0,width:32,height:24}},
    {...box('crop-image',300,440,128,128),type:'image',assetId:'used',crop:{x:16,y:0,width:16,height:16}},
    {...box('ellipse',520,440,150,100),type:'ellipse',fill:'#ff8844',opacity:0.5,rotation:15},
    {...box('wrapped',80,700,250,250),type:'text',text:'清晰的文字表达想法。保留文字与布局，逐层继续编辑。 Keep original words and readable spacing.',font:'sans',fontSize:24,fontWeight:'bold',lineHeight:1.4,align:'center',wrap:'word',fill:'#111111'}
   ]};
   const html=await exportSceneHTML(scene,assets,signal),render=await renderScene(scene,assets,signal);
   const base64=async b=>{const a=new Uint8Array(await b.arrayBuffer());let s='';for(const v of a)s+=String.fromCharCode(v);return btoa(s);};
   const partial=await exportSceneHTML({...scene,nodes:[scene.nodes[3]]},assets,signal);
   const errors=[];for(const patch of [{fill:'url(https://invalid.example)'},{text:'<img src=x onerror=alert(1)>'},{type:'unsupported'}]){
    const broken=structuredClone(scene);Object.assign(broken.nodes[0],patch);try{await exportSceneHTML(broken,assets,signal);}catch{errors.push(true);}
   }
   const fractional=structuredClone(scene);fractional.nodes[3].crop.x=16.5;fractional.nodes[3].crop.width=15;
   let fractionalRejected=false;try{await exportSceneHTML(fractional,assets,signal);}catch(e){fractionalRejected=e.message.includes('FRACTIONAL_CROP');}
   const aborted=new AbortController();aborted.abort();let canceled=false;try{await exportSceneHTML(scene,assets,aborted.signal);}catch{canceled=true;}
   return{html,partial,png:await base64(render.png),original:await base64(blob),unused:await base64(unused),scene,diagnostics:render.diagnostics,errors,fractionalRejected,canceled};
  });
  assert.equal(result.errors.length,3);assert.ok(result.fractionalRejected);assert.ok(result.canceled);
  assert.doesNotMatch(result.html,/PRIVATE_META|PRIVATE_LIMITATIONS|data-layer-id="unused"|<script|<canvas|<svg|onclick=/);
  assert.ok(!result.html.includes(result.unused));assert.ok(!result.partial.includes(result.original),'cropped-only export never retains the uncropped encoded file');
  const file=resolve(output,'synthetic.html');await writeFile(file,result.html);await writeFile(resolve(output,'konva.png'),Buffer.from(result.png,'base64'));
  const document=await browser.newPage({viewport:{width:1080,height:1440},deviceScaleFactor:1});let network=0;
  document.on('request',r=>{if(/^https?:/.test(r.url()))network++;});
  await document.goto(pathToFileURL(file).href);await document.locator('img').evaluateAll(async imgs=>{await Promise.all(imgs.map(img=>img.decode()));});
  const inspection=await document.evaluate(async()=>{
   const layers=[...document.querySelectorAll('[data-layer-id]')],image=layers.find(n=>n.dataset.layerId==='full-image'),crop=layers.find(n=>n.dataset.layerId==='crop-image');
   const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;const ctx=canvas.getContext('2d');ctx.drawImage(crop,0,0,16,16);
   return{ids:layers.map(n=>n.dataset.layerId),text:layers[0].textContent,source:image.src.split(',')[1],cropSize:[crop.naturalWidth,crop.naturalHeight],cropPixel:[...ctx.getImageData(8,8,1,1).data],cropAlpha:ctx.getImageData(0,0,1,1).data[3],geometry:layers.map(n=>{const s=getComputedStyle(n);return [parseFloat(s.left),parseFloat(s.top),parseFloat(s.width),parseFloat(s.height)];}),canvas:document.querySelectorAll('canvas,svg,script,iframe').length};
  });
  assert.deepEqual(inspection.ids,result.scene.nodes.map(n=>n.id));assert.equal(inspection.text,result.scene.nodes[0].text);assert.equal(inspection.source,result.original);
  assert.deepEqual(inspection.cropSize,[16,16]);assert.deepEqual(inspection.cropPixel,[34,187,102,255]);assert.equal(inspection.cropAlpha,0);
  assert.deepEqual(inspection.geometry,result.scene.nodes.map(n=>[n.x,n.y,n.width,n.height]));assert.equal(inspection.canvas,0);assert.equal(network,0);
  const screenshot=await document.screenshot({fullPage:true});await writeFile(resolve(output,'html.png'),screenshot);
  const diff=await page.evaluate(async({before,after})=>{
   const pixels=async data=>{const image=await createImageBitmap(new Blob([Uint8Array.from(atob(data),x=>x.charCodeAt(0))],{type:'image/png'}));const c=document.createElement('canvas');c.width=1080;c.height=1440;const x=c.getContext('2d');x.drawImage(image,0,0);image.close();return x.getImageData(0,0,1080,1440).data;};
   const a=await pixels(before),b=await pixels(after);let changed=0;for(let i=0;i<a.length;i+=4)if(a.slice(i,i+4).some((v,j)=>Math.abs(v-b[i+j])>8))changed++;
   return{changed,total:1080*1440,ratio:changed/(1080*1440)};
  },{before:result.png,after:screenshot.toString('base64')});
  assert.ok(diff.ratio<0.02,JSON.stringify(diff));
  const edited=await document.evaluate(()=>{const layer=id=>document.querySelector('[data-layer-id="'+id+'"]');const original=layer('crop-image').src;layer('title').textContent='Independently edited text';layer('crop-image').style.left='360px';layer('shape').style.background='#123456';return{text:layer('title').textContent,imageLeft:layer('crop-image').style.left,imageUnchanged:layer('crop-image').src===original,shape:getComputedStyle(layer('shape')).backgroundColor,otherText:layer('wrapped').textContent};});
  assert.equal(edited.text,'Independently edited text');assert.equal(edited.imageLeft,'360px');assert.ok(edited.imageUnchanged);assert.equal(edited.shape,'rgb(18, 52, 86)');assert.equal(edited.otherText,result.scene.nodes[5].text);assert.equal(network,0);
  const receipt={classification:'Synthetic local HTML/DOM proof; NOT native Stitch editing',dimensions:[1080,1440],layerCount:inspection.ids.length,textExact:true,fullImageBytesExact:true,cropPixelsOnly:true,networkRequests:network,independentDOMEdits:true,pixelComparison:diff,fonts:'same local stacks; cross-browser/target wrapping not guaranteed',fractionalCrop:'explicitly unsupported',nativeStitch:'NOT_RUN/UNVERIFIED'};
  await writeFile(resolve(output,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));await document.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

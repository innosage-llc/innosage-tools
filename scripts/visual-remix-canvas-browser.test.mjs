import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import {emptyScene} from '../lib/visual-remix.ts';

test('direct canvas: pointer, IME, history, zoom, overlap, cancellation and portable exports', {timeout:120000}, async()=>{
 const root=resolve(import.meta.dirname,'..'),output=resolve(root,'.deploy/tools140-after');await mkdir(output,{recursive:true});
 const server=createServer(async(req,res)=>{try{let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/tools\/?/,'');if(p.includes('..'))throw Error();if(!p)p='index.html';else if(!extname(p))p+='.html';res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(p)]??'application/octet-stream');res.end(await readFile(resolve(root,'out',p)));}catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1100},acceptDownloads:true});const origin=`http://127.0.0.1:${server.address().port}`;
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{if(!r.request().url().startsWith(origin)){external.push(r.request().url());return r.abort();}return r.continue();});
  await page.goto(origin+'/tools/visual-remix');await page.getByText('Ready. Select a reference or open a saved project.',{exact:true}).waitFor();
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=16;const x=c.getContext('2d');x.fillStyle='#ee8844';x.fillRect(0,0,8,16);x.fillStyle='#004488';x.fillRect(8,0,8,16);return c.toDataURL();});
  const box={x:100,y:200,width:600,height:300,rotation:0,opacity:1};
  const scene=emptyScene();scene.assets=[{id:'logo',mime:'image/png',width:16,height:16}];scene.nodes=[
   {...box,id:'time',type:'text',text:'13:21',font:'sans',fontSize:96,fontWeight:'bold',lineHeight:1.2,align:'left',wrap:'word',fill:'#111111'},
   {...box,id:'copy',y:600,width:800,height:300,type:'text',text:'让每一次分享都值得阅读。\n保持设计的节奏。',font:'sans',fontSize:48,fontWeight:'normal',lineHeight:1.4,align:'left',wrap:'word',fill:'#111111'},
   {...box,id:'logo-node',x:800,y:1000,width:100,height:100,type:'image',assetId:'logo',crop:{x:0,y:0,width:16,height:16}},
   {...box,id:'rotated',x:400,y:1000,width:150,height:100,rotation:20,type:'rect',fill:'#2277aa',cornerRadius:10},
   {...box,id:'under',x:100,y:1000,width:150,height:100,type:'rect',fill:'#ee8844',cornerRadius:0},
   {...box,id:'over',x:100,y:1000,width:150,height:100,type:'ellipse',fill:'#6644cc'}];
  const original={schemaVersion:1,projectId:'canvas-fixture',revision:0,scene,assets:[{id:'logo',data}]};
  async function open(project){await page.getByLabel('Open project',{exact:true}).setInputFiles({name:'poster.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await ready();}
  async function ready(){await page.waitForFunction(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Download PNG');return b&&!b.disabled;});await page.waitForFunction(()=>{const i=document.querySelector('img[alt="Applied image"]');return i?.complete&&i.naturalWidth===1080;});}
  async function download(name){const promise=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return readFile(await(await promise).path());}
  async function save(){return JSON.parse((await download('Save project')).toString());}
  const svg=page.getByTestId('editable-canvas');
  async function coord(x,y,scroll=true){if(scroll){await svg.scrollIntoViewIfNeeded();await svg.evaluate((s,p)=>{const v=s.parentElement.parentElement;if(v.scrollHeight>v.clientHeight){v.scrollTop=p.y-v.clientHeight/2;v.scrollLeft=p.x-v.clientWidth/2;}},{x,y});}const r=await svg.boundingBox();return {x:r.x+x*r.width/1080,y:r.y+y*r.height/1440};}
  async function click(x,y,twice=false){const p=await coord(x,y);await page.mouse[twice?'dblclick':'click'](p.x,p.y);}
  async function drag(x,y,dx,dy,cancel=false){const p=await coord(x,y),q=await coord(x+dx,y+dy,false);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(q.x,q.y,{steps:8});assert.equal(await page.getByRole('button',{name:'Download PNG',exact:true}).isDisabled(),true);if(cancel)await page.keyboard.press('Escape');await page.mouse.up();await ready();}
  await open(original);await page.getByTestId('preview-controls').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(output,'poster-before.png'),fullPage:true});
  const brief=JSON.parse((await download('Download agent brief')).toString());
  await page.getByLabel('Proposal JSON',{exact:true}).fill(JSON.stringify({...brief.proposalIdentity,requestId:'click-keeps-candidate',scene:{...scene,background:'#fafafa'},explanation:'Selection must preserve this preview'}));
  await page.getByRole('button',{name:'Preview proposal',exact:true}).click();await page.getByRole('button',{name:'Apply candidate',exact:true}).waitFor();
  await click(160,250);assert.equal(await page.getByRole('button',{name:'Apply candidate',exact:true}).count(),1);await page.getByRole('button',{name:'Cancel candidate',exact:true}).click();await ready();
  await click(160,250,true);await page.getByLabel('Edit canvas text').dispatchEvent('compositionstart');await page.getByLabel('Edit canvas text').fill('discard this composition');await page.getByRole('button',{name:'Discard local draft',exact:true}).click();await page.getByLabel('Edit canvas text').waitFor({state:'detached'});await ready();assert.equal((await save()).scene.nodes[0].text,'13:21');
  await click(160,250);assert.equal(await page.getByLabel('Layer',{exact:true}).inputValue(),'time');await ready();
  await click(160,250,true);const input=page.getByLabel('Edit canvas text');await input.waitFor();assert.equal(await page.getByRole('button',{name:'Download PNG',exact:true}).isDisabled(),true);
  await input.dispatchEvent('compositionstart');await input.fill('15:21\n中文 🧭');await input.press('Escape');assert.equal(await input.count(),1);await input.dispatchEvent('compositionend',{data:'中文'});await page.getByRole('button',{name:'Done',exact:true}).click();await ready();
  let saved=await save();assert.equal(saved.scene.nodes[0].text,'15:21\n中文 🧭');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await ready();assert.equal((await save()).scene.nodes[0].text,'13:21');await page.getByRole('button',{name:'Redo',exact:true}).click();await ready();
  await drag(160,250,60,50);saved=await save();assert.equal(saved.scene.nodes[0].x,160);assert.equal(saved.scene.nodes[0].y,250);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await ready();assert.equal((await save()).scene.nodes[0].x,100);await page.getByRole('button',{name:'Redo',exact:true}).click();await ready();
  await drag(220,300,50,50,true);assert.equal((await save()).scene.nodes[0].x,160);
  // Resize the box, preserving the typography and asset bytes.
  const h=page.getByTestId('resize-se');await h.scrollIntoViewIfNeeded();const b=await h.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+25,b.y+b.height/2+25,{steps:5});await page.mouse.up();await ready();saved=await save();assert.equal(saved.scene.nodes[0].fontSize,96);assert.ok(saved.scene.nodes[0].width>600);assert.deepEqual(saved.assets,original.assets);
  await click(175,1050);assert.equal(await page.getByLabel('Layer',{exact:true}).inputValue(),'over');await ready();await page.getByLabel('Layer',{exact:true}).selectOption('under');assert.equal(await page.getByLabel('Layer',{exact:true}).inputValue(),'under');
  await click(460,1050);assert.equal(await page.getByLabel('Layer',{exact:true}).inputValue(),'rotated');await ready();await drag(460,1050,20,10);assert.equal((await save()).scene.nodes.find(n=>n.id==='rotated').x,420);
  await page.getByRole('button',{name:'100%',exact:true}).click();await drag(460,1050,20,10);assert.equal((await save()).scene.nodes.find(n=>n.id==='rotated').x,440);const rotated=(await save()).scene.nodes.find(n=>n.id==='rotated');const a=rotated.rotation*Math.PI/180;const corner=await coord(rotated.x+rotated.width*Math.cos(a)-rotated.height*Math.sin(a),rotated.y+rotated.width*Math.sin(a)+rotated.height*Math.cos(a));await page.mouse.move(corner.x,corner.y);await page.mouse.down();await page.mouse.move(corner.x+15,corner.y+20,{steps:4});await page.mouse.up();await ready();const resized=(await save()).scene.nodes.find(n=>n.id==='rotated');assert.equal(resized.rotation,20);assert.ok(resized.width>rotated.width);assert.ok(resized.height>rotated.height);await page.getByRole('button',{name:'Fit',exact:true}).click();
  await click(850,1050);await ready();await drag(850,1050,20,20);saved=await save();assert.deepEqual(saved.assets,original.assets);assert.deepEqual(saved.scene.nodes.find(n=>n.type==='image').crop,original.scene.nodes.find(n=>n.type==='image').crop);
  await page.getByLabel('Layer',{exact:true}).selectOption('time');await page.getByLabel('Inspector fill',{exact:true}).fill('#114488');await ready();await page.getByLabel('Font size',{exact:true}).fill('88');await ready();assert.equal((await save()).scene.nodes[0].fill,'#114488');assert.equal((await save()).scene.nodes[0].fontSize,88);
  await click(1050,1400);assert.equal(await page.getByLabel('Layer',{exact:true}).inputValue(),'');
  const png=await download('Download PNG');const preview=await page.getByAltText('Applied image',{exact:true}).evaluate(async i=>Array.from(new Uint8Array(await(await fetch(i.src)).arrayBuffer())));assert.deepEqual(png,Buffer.from(preview));
  const html=(await download('Export HTML')).toString();assert.match(html,/15:21/);assert.ok(html.includes(data));
  // Save/reopen preserves the same committed Scene.
  const project=await save();await open(project);assert.deepEqual((await save()).scene,project.scene);
  await page.getByLabel('Layer',{exact:true}).selectOption('time');await page.getByTestId('preview-controls').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(output,'poster-after.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await writeFile(resolve(output,'receipt.json'),JSON.stringify({browser:browser.version(),pointer:true,syntheticComposition:true,nativeIME:'NOT_RUN',zoom:['Fit','100%'],pngParity:true,assetBytes:true,reopen:true,errors,external},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

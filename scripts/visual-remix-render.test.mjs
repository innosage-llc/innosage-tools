// Offline real-browser renderer proof. No app route or live service required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { chromium } from 'playwright';

test('real Konva: CJK reflow, overflow, collisions, PNG parity, assets and cancellation', async () => {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const modules=new Map();
  for(const name of ['visual-remix','visual-remix-assets','visual-remix-renderer','visual-remix-controller']) {
    const source=await readFile(path.join(root,'lib',name+'.ts'),'utf8');
    modules.set('/'+name+'.ts',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace("import('konva')","import('/konva/index.js')"));
  }
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/') {res.setHeader('Content-Type','text/html');return res.end('<!doctype html><title>Offline Visual Remix renderer test</title>');}
      res.setHeader('Content-Type','text/javascript');
      if(modules.has(url.pathname)) return res.end(modules.get(url.pathname));
      if(/^\/konva\/[a-zA-Z0-9_./-]+\.js$/.test(url.pathname) && !url.pathname.includes('..')) return res.end(await readFile(path.join(root,'node_modules',url.pathname.replace('/konva/','konva/lib/'))));
      res.statusCode=404;res.end();
    } catch {res.statusCode=500;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result=await page.evaluate(async()=>{
      const {emptyScene}=await import('/visual-remix.ts');
      const {LocalAssets,savePortableProject,loadPortableProject,cropRaster}=await import('/visual-remix-assets.ts');
      const {renderScene}=await import('/visual-remix-renderer.ts');
      const {VisualRemixController}=await import('/visual-remix-controller.ts');
      const s=emptyScene(); s.nodes=[{id:'quote',type:'text',x:80,y:200,width:560,height:500,rotation:0,opacity:1,text:'我们用清晰的文字表达想法，让每一次分享都值得阅读。保持设计的节奏，给长句足够的空间，让内容自然展开，而不是缩小所有文字。',font:'sans',fontSize:48,fontWeight:'normal',lineHeight:1.4,align:'left',wrap:'word',fill:'#111111'}];
      const assets=new LocalAssets(); const signal=new AbortController().signal;
      const good=await renderScene(s,assets,signal);
      const dimensions=await createImageBitmap(good.png); const size=[dimensions.width,dimensions.height]; dimensions.close();
      const overflow=structuredClone(s); overflow.nodes[0].height=60;
      const bad=await renderScene(overflow,assets,signal);
      const omitted=[];
      for(const [content,width] of [['中',1],['iii中后续文字',20],['iii\n中后续文字',20]]) {
        const narrow=structuredClone(s);Object.assign(narrow.nodes[0],{text:content,width,fontSize:48});
        const output=await renderScene(narrow,assets,signal);
        const controller=new VisualRemixController(renderScene);await controller.open('narrow',0,narrow,assets);
        let exportBlocked=false;try{controller.exportPNG();}catch{exportBlocked=true;}
        omitted.push({content,diagnostics:output.diagnostics,exportBlocked});controller.dispose();
      }
      const narrowLatin=structuredClone(s);Object.assign(narrowLatin.nodes[0],{text:'iii',width:20,fontSize:48});
      const fittingNarrow=await renderScene(narrowLatin,assets,signal);
      const overlap=structuredClone(s); overlap.nodes.push({...overlap.nodes[0],id:'collision'});
      const collision=await renderScene(overlap,assets,signal);
      const adjacent=structuredClone(s);const line={...s.nodes[0],text:'Tibo',width:900,height:80,fontSize:32,x:80,y:700};
      adjacent.nodes=[{...line,id:'author-name'},{...line,id:'author-handle',text:'@thstottiaux',x:180,width:500}];
      const adjacentResult=await renderScene(adjacent,assets,signal);
      adjacent.nodes[1].x=100;const realAdjacentCollision=await renderScene(adjacent,assets,signal);
      const aligned=[];
      for(const align of ['left','center','right']){const a=structuredClone(s);a.nodes=[{...line,id:'aligned',align},{...line,id:'neighbor',x:1000,width:80,text:'Hi'}];aligned.push((await renderScene(a,assets,signal)).diagnostics);}
      const multiline=structuredClone(s);multiline.nodes=[{...line,id:'multiline',text:'Top\nBottom',height:150,lineHeight:2},{...line,id:'between-lines',x:300,y:740,width:100,text:'Hi'}];
      const betweenLines=await renderScene(multiline,assets,signal);
      const rotated=structuredClone(s); rotated.nodes[0].rotation=-90;
      const outside=await renderScene(rotated,assets,signal);
      const c=new VisualRemixController(renderScene); await c.open('browser',0,s,assets);
      const p={schemaVersion:1,requestId:'layout',projectId:'browser',generation:c.snapshot().generation,baseRevision:0,scene:{...s,background:'#faf0e0'},explanation:'Change background and move quote'};
      p.scene.nodes=structuredClone(s.nodes);p.scene.nodes[0].y=500;
      await c.propose(p); const preview=c.snapshot().preview.output.png; c.apply('layout');
      const equal=Array.from(new Uint8Array(await preview.arrayBuffer())).join()===Array.from(new Uint8Array(await c.exportPNG().arrayBuffer())).join();
      const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);
      const assetBlob=await new Promise(r=>canvas.toBlob(r));const asset=await assets.add('raster',assetBlob,signal);
      const withImage=structuredClone(s);withImage.assets=[asset];withImage.nodes.push({id:'raster-node',type:'image',x:800,y:800,width:100,height:100,rotation:0,opacity:1,assetId:'raster',crop:{x:0,y:0,width:16,height:16}});
      const saved=await savePortableProject('portable',3,withImage,assets);const loaded=await loadPortableProject(saved,signal);
      const portable=await renderScene(loaded.project.scene,loaded.assets,signal);
      const pattern=document.createElement('canvas');pattern.width=32;pattern.height=16;const ctx=pattern.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,16,16);ctx.fillStyle='#0000ff';ctx.fillRect(16,0,16,16);
      const original=await new Promise(resolve=>pattern.toBlob(resolve));
      const tight=await cropRaster(original,{x:0,y:0,width:16,height:16},signal);
      const cropAssets=new LocalAssets(),tightDescriptor=await cropAssets.add('portrait',tight,signal);
      const cropScene=structuredClone(withImage);cropScene.assets=[tightDescriptor];cropScene.nodes=cropScene.nodes.filter(n=>n.type!=='image');cropScene.nodes.push({...withImage.nodes.at(-1),assetId:'portrait',id:'portrait'});
      const cropProject=await savePortableProject('tight',1,cropScene,cropAssets),cropReload=await loadPortableProject(cropProject,signal);
      const reopenedCrop=cropReload.assets.blob(tightDescriptor);const cropBitmap=await createImageBitmap(reopenedCrop);const cropCanvas=document.createElement('canvas');cropCanvas.width=16;cropCanvas.height=16;cropCanvas.getContext('2d').drawImage(cropBitmap,0,0);cropBitmap.close();
      const cropPixels=Array.from(cropCanvas.getContext('2d').getImageData(0,0,16,16).data);
      let invalidCrop=false;try{await cropRaster(original,{x:16,y:0,width:17,height:16},signal);}catch{invalidCrop=true;}
      const cropSameBytes=Array.from(new Uint8Array(await tight.arrayBuffer())).join()===Array.from(new Uint8Array(await reopenedCrop.arrayBuffer())).join();
      const nativeDecode=globalThis.createImageBitmap;let active=0,maxActive=0;const canceledRenders=[];
      globalThis.createImageBitmap=async(...args)=>{active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,15));try{return await nativeDecode(...args);}finally{active--;}};
      try {
        for(let i=0;i<5;i++){const a=new AbortController();canceledRenders.push(renderScene(withImage,assets,a.signal).catch(()=>null));if(i<4)setTimeout(()=>a.abort(),5);}
        await Promise.all(canceledRenders);
      } finally {globalThis.createImageBitmap=nativeDecode;}
      let corrupt=false;try{await assets.add('corrupt',new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,2,0,0,0,2,0,0,0,0])]),signal);}catch{corrupt=true;}
      const canceled=new AbortController();canceled.abort();let abort=false;try{await renderScene(s,assets,canceled.signal);}catch{abort=true;}
      const pngBase64=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(good.png);});
      return {adjacent:adjacentResult.diagnostics,realAdjacentCollision:realAdjacentCollision.diagnostics,aligned,betweenLines:betweenLines.diagnostics,crop:{descriptor:tightDescriptor,sameBytes:cropSameBytes,onlyRed:cropPixels.every((v,i)=>v===([255,0,0,255][i%4])),invalidCrop,entries:JSON.parse(cropProject).assets.length},size,good:good.diagnostics,bad:bad.diagnostics,omitted,fittingNarrow:fittingNarrow.diagnostics,collision:collision.diagnostics,outside:outside.diagnostics,equal,portable:portable.png.size,corrupt,abort,pngSize:good.png.size,maxActive,pngBase64};
    });
    assert.deepEqual(result.size,[1080,1440]); assert.ok(result.pngSize>1000);
    assert.equal(result.good.some(d=>d.severity==='error'),false);
    assert.ok(result.bad.some(d=>d.code==='TEXT_OVERFLOW'));
    for(const omitted of result.omitted) {assert.ok(omitted.diagnostics.some(d=>d.code==='TEXT_OVERFLOW'),`omitted text must diagnose overflow: ${omitted.content}`);assert.ok(omitted.exportBlocked);}
    assert.equal(result.fittingNarrow.some(d=>d.severity==='error'),false,'narrow Latin fits with actual glyph metrics even when font size exceeds box width');
    assert.equal(result.adjacent.some(d=>d.code==='TEXT_OVERLAP'),false,'overlapping editable boxes with separated glyphs must export');
    assert.ok(result.realAdjacentCollision.some(d=>d.code==='TEXT_OVERLAP'),'real rendered collision remains blocked');
    for(const d of result.aligned)assert.equal(d.some(x=>x.code==='TEXT_OVERLAP'),false,'alignment must use actual glyph positions');
    assert.equal(result.betweenLines.some(d=>d.code==='TEXT_OVERLAP'),false);
    assert.equal(result.crop.descriptor.width,16);assert.equal(result.crop.descriptor.height,16);assert.ok(result.crop.sameBytes&&result.crop.onlyRed&&result.crop.invalidCrop);assert.equal(result.crop.entries,1);
    assert.ok(result.collision.some(d=>d.code==='TEXT_OVERLAP'));
    assert.ok(result.outside.some(d=>d.code==='OUTSIDE_CANVAS'));
    assert.ok(result.equal && result.portable>1000 && result.corrupt && result.abort);
    assert.equal(result.maxActive,1);
    const {pngBase64,...evidence}=result;
    const output=path.join(root,'.deploy','visual-remix-core');await mkdir(output,{recursive:true});
    await writeFile(path.join(output,'long-cjk.png'),Buffer.from(pngBase64,'base64'));
    await writeFile(path.join(output,'browser-evidence.json'),JSON.stringify({browser:browser.version(),...evidence},null,2)+'\n');
    console.log(JSON.stringify({browser:browser.version(),...evidence}));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportSceneHTML} from '../lib/visual-remix-html.ts';
import {emptyScene,type Scene} from '../lib/visual-remix.ts';
import {LocalAssets} from '../lib/visual-remix-assets.ts';
const signal=()=>new AbortController().signal;
function scene():Scene{return{...emptyScene(),provenance:'PRIVATE_APP_METADATA',captions:{titleCN:'NOT_VISIBLE',captionCN:'',titleEN:'',captionEN:''},nodes:[{id:'text',type:'text',x:12.5,y:80,width:600,height:160,rotation:5,opacity:0.5,text:'A & "B"\r\n&lt;img&gt; 中文',font:'sans',fontSize:32,fontWeight:'bold',lineHeight:1.25,align:'right',wrap:'word',fill:'#11223380'}]};}
function png(size=32){const b=new Uint8Array(size);b.set([137,80,78,71,13,10,26,10]);const v=new DataView(b.buffer);v.setUint32(8,13);b.set([73,72,68,82],12);v.setUint32(16,2);v.setUint32(20,2);return b;}
const decode=async()=>({width:2,height:2,close(){}});
test('HTML safely escapes exact text/CR and serializes geometry, without private application fields',async()=>{
 const s=scene(),before=JSON.stringify(s),html=await exportSceneHTML(s,new LocalAssets(),signal());
 assert.match(html,/A &amp; &quot;B&quot;&#13;\n&amp;lt;img&amp;gt; 中文/);assert.match(html,/left:12.5px;top:80px;width:600px;height:160px;transform:rotate\(5deg\)/);
 assert.match(html,/opacity:0.5/);assert.match(html,/color:#11223380/);assert.doesNotMatch(html,/PRIVATE_APP_METADATA|NOT_VISIBLE|<script|<canvas|<svg|onclick=/);assert.equal(JSON.stringify(s),before);
 assert.match(html,/default-src &#39;none&#39;/);assert.match(html,/img-src data:/);assert.match(html,/Stitch native layer editing is unverified/);
});
test('only used approved full-image bytes are embedded; no unused asset data or external URLs',async()=>{
 const assets=new LocalAssets(),bytes=png(),used=await assets.add('used',new Blob([bytes]),signal(),decode),unused=await assets.add('unused',new Blob([png(48)]),signal(),decode);
 const s={...emptyScene(),assets:[used,unused],nodes:[{id:'photo',type:'image' as const,x:0,y:0,width:100,height:100,rotation:0,opacity:1,assetId:'used',crop:{x:0,y:0,width:2,height:2}}]};
 const html=await exportSceneHTML(s,assets,signal()),data=html.match(/src="data:image\/png;base64,([^"]+)"/)![1];assert.deepEqual(Buffer.from(data,'base64'),Buffer.from(bytes));assert.ok(!html.includes(Buffer.from(png(48)).toString('base64')));assert.match(html,/image-orientation:none/);
 await assert.rejects(exportSceneHTML(s,new LocalAssets(),signal()),/ASSET_NOT_APPROVED/);
});
test('invalid markup, inherited fields, unsupported layers and CSS URLs reject rather than execute/drop',async()=>{
 for(const patch of [{text:'<img src=x onerror=alert(1)>'},{fill:'url(https://example.com)'},{type:'video'},{x:Infinity}]){
  const s=scene();Object.assign(s.nodes[0],patch);await assert.rejects(exportSceneHTML(s,new LocalAssets(),signal()),/INVALID_SCENE_DATA/);
 }
 await assert.rejects(exportSceneHTML(Object.create(scene()),new LocalAssets(),signal()),/INVALID_SCENE_DATA/);
});
test('fractional image crops explicitly reject before any hidden-source embedding',async()=>{
 const assets=new LocalAssets(),a=await assets.add('crop',new Blob([png()]),signal(),decode);
 const s={...emptyScene(),assets:[a],nodes:[{id:'fractional',type:'image' as const,x:0,y:0,width:100,height:100,rotation:0,opacity:1,assetId:'crop',crop:{x:0.5,y:0,width:1,height:1}}]};
 await assert.rejects(exportSceneHTML(s,assets,signal()),/HTML_FRACTIONAL_CROP_UNSUPPORTED: fractional/);
});
test('aborted export cannot produce HTML',async()=>{const c=new AbortController();c.abort();await assert.rejects(exportSceneHTML(scene(),new LocalAssets(),c.signal),/abort/i);});
test('repeated large raster layers hit the explicit standalone-file budget',async()=>{
 const assets=new LocalAssets(),a=await assets.add('large',new Blob([png(9_000_000)]),signal(),decode);
 const node={id:'one',type:'image' as const,x:0,y:0,width:100,height:100,rotation:0,opacity:1,assetId:'large',crop:{x:0,y:0,width:2,height:2}};
 await assert.rejects(exportSceneHTML({...emptyScene(),assets:[a],nodes:[node,{...node,id:'two'}]},assets,signal()),/HTML_EXPORT_TOO_LARGE/);
});

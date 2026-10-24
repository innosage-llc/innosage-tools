import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { fixture, origin } from './fixtures/scene-client.ts';

const waitFor = async (check: () => boolean) => { for (let i=0;i<500;i++) { if(check())return; await new Promise(r=>setTimeout(r,10)); } assert.ok(check(),'local lifecycle did not complete'); };
for (const clientClockOffset of [0,-120000,600000]) {
test(`inactive transport + actual provider/D1/controller: consent through revoke with client clock offset ${clientClockOffset}`,async()=>{
  const f = await fixture(), directory = await mkdtemp(join(tmpdir(),'tools85-scene-controller-'));
  let controller, transport;
  try {
    const output = join(directory,'controller.mjs');
    await build({stdin:{contents:"export {VisualRemixTransport} from './lib/visual-remix-transport.ts';export {VisualRemixController} from './lib/visual-remix-controller.ts';export {LocalAssets} from './lib/visual-remix-assets.ts';export {emptyScene} from './lib/visual-remix.ts';",resolveDir:resolve('../..')},bundle:true,platform:'node',format:'esm',outfile:output});
    const {VisualRemixTransport,VisualRemixController,LocalAssets,emptyScene} = await import(pathToFileURL(output).href);
    // Renderer is a deterministic test stub here, not PNG pixel acceptance.
    controller = new VisualRemixController(async()=>({png:new Blob(['local-render']),diagnostics:[]}));
    await controller.open('adapter-project',0,{...emptyScene(),nodes:[{id:'headline',type:'text',x:80,y:80,width:900,height:160,rotation:0,opacity:1,text:'Before',font:'sans',fontSize:48,fontWeight:'bold',lineHeight:1.3,align:'left',wrap:'word',fill:'#111111'}]},new LocalAssets());
    const requests: {path:string;body:string}[]=[];
    transport = new VisualRemixTransport(controller,true,()=>{},()=>{},async(path: string, init: RequestInit)=>{
      requests.push({path,body:String(init.body)});
      return f.request(path,{...init,headers:{...init.headers,Origin:origin}});
    },()=>Date.now()+clientClockOffset);
    await transport.connect(true);
    assert.equal(transport.snapshot().phase,'awaiting-consent');
    const c=await f.client(),a=await f.authorize(c),tokenResponse=await f.token(c,await f.approve(a,transport.snapshot().proof));
    assert.equal(tokenResponse.status,200);const token=await tokenResponse.json();
    await waitFor(()=>transport.snapshot().phase==='connected');
    const shared=JSON.parse((await f.rpc(token.access_token,'tools/call',{name:'get_scene',arguments:{}})).data.result.content[0].text);
    const changed={...shared.scene,nodes:shared.scene.nodes.map((n: {id:string})=>n.id==='headline'?{...n,text:'After',x:120,y:240}:n)};
    const proposal={schemaVersion:1,projectId:shared.projectId,generation:shared.generation,baseRevision:shared.revision,requestId:'actual-adapter',explanation:'Change headline and move it lower',scene:changed};
    const queued=JSON.parse((await f.rpc(token.access_token,'tools/call',{name:'propose_scene',arguments:{proposal}})).data.result.content[0].text);
    assert.equal(queued.state,'queued');assert.equal(queued.applied,false);
    await waitFor(()=>controller.status('actual-adapter')==='preview');
    assert.equal(controller.snapshot().revision,0);assert.equal(controller.snapshot().scene.nodes[0].text,'Before');
    assert.equal(controller.apply('actual-adapter'),'applied');transport.notifyLocalChange();
    assert.equal(controller.undo(),true);transport.notifyLocalChange();
    await waitFor(()=>requests.some(r=>r.path.endsWith('/sync')&&JSON.parse(r.body).snapshot.revision===2));
    // Serial frames report Apply at revision1 before the later Undo snapshot.
    let status;
    for(let i=0;i<30;i++) {status=JSON.parse((await f.rpc(token.access_token,'tools/call',{name:'proposal_status',arguments:{requestId:'actual-adapter'}})).data.result.content[0].text);if(status.applied)break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(status.applied,true);assert.equal(status.terminal,true);
    assert.equal(controller.snapshot().revision,2);assert.equal(controller.snapshot().scene.nodes[0].text,'Before');
    assert.ok(requests.every(r=>!r.body.includes('local-render')));
    const png=controller.exportPNG();await transport.disconnect();
    assert.equal(transport.snapshot().revocationConfirmed,true);assert.equal(controller.exportPNG().size,png.size);
    assert.equal((await f.rpc(token.access_token,'tools/call',{name:'get_scene',arguments:{}})).r.status,401);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_shares WHERE snapshot IS NOT NULL').first('n'),0);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_requests WHERE payload IS NOT NULL').first('n'),0);
    f.noEgress();
  } finally { if(transport){await transport.disconnect();transport.dispose();}controller?.dispose();await f.mf.dispose();await rm(directory,{recursive:true,force:true}); }
});
}

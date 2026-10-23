import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const require=createRequire(resolve('workers/video-scissors-mcp/package.json'));
const {build}=require('esbuild');
const directory=await mkdtemp(join(tmpdir(),'tools85-scene-transport-'));
after(()=>rm(directory,{recursive:true,force:true}));
const output=join(directory,'fixture.mjs');
await build({stdin:{contents:"export {VisualRemixTransport} from './lib/visual-remix-transport.ts';export {VisualRemixController} from './lib/visual-remix-controller.ts';export {LocalAssets} from './lib/visual-remix-assets.ts';export {emptyScene} from './lib/visual-remix.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:output});
const {VisualRemixTransport,VisualRemixController,LocalAssets,emptyScene}=await import(pathToFileURL(output).href);
const waitFor=async(check)=>{for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}assert.ok(check(),'condition did not complete');};
const response=x=>Response.json(x);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function fixture({slowCreate=false,failRevoke=false,slowPoll=false}={}){
 let renders=0,renderGate=null,command=null,cancel=[],connected=false,revokeFailures=failRevoke?2:0;
 const calls=[],states=[];
 const controller=new VisualRemixController(async()=>{renders++;if(renderGate)await renderGate.promise;return{png:new Blob(['local-png']),diagnostics:[]};});
 await controller.open('fixture',0,emptyScene(),new LocalAssets());
 const source=controller.snapshot(),gate=deferred(),pollGate=deferred();
 const owner={purpose:'visual-remix',shareId:'synthetic-share',projectId:source.projectId,generation:source.generation,epoch:1,credential:'a'.repeat(64)};
 const share={auth:owner,proof:'b'.repeat(64),expiresAt:Date.now()+899000,proofExpiresAt:Date.now()+299000};
 const transport=new VisualRemixTransport(controller,true,s=>states.push(s),()=>{},async(path,init)=>{
  const body=JSON.parse(init.body);calls.push({path,body});
  if(path.endsWith('/create')){if(slowCreate)await gate.promise;return response(share);}
  if(path.endsWith('/sync'))return response({ok:true});
  if(path.endsWith('/poll')){const result={command,cancellations:cancel,connected};command=null;if(slowPoll)await pollGate.promise;return response(result);}
  if(path.endsWith('/report'))return response({ok:true});
  if(path.endsWith('/revoke')){if(revokeFailures-->0)return new Response('Uncertain',{status:503});return response({ok:true});}
  throw new Error('Unknown path');
 });
 return{controller,transport,calls,states,gate,pollGate,share,setCommand:c=>command=c,setCancel:c=>cancel=c,setRenderGate:g=>renderGate=g,connect:async()=>{await transport.connect(true);await waitFor(()=>calls.some(c=>c.path.endsWith('/poll')));},get renders(){return renders;}};
}
const proposal=(f,id='request')=>{const s=f.controller.snapshot();return{schemaVersion:1,projectId:s.projectId,generation:s.generation,baseRevision:s.revision,requestId:id,explanation:'Synthetic edit',scene:{...s.scene,background:'#123456'}};};

test('inactive adapter: explicit consent, preview -> manual Apply -> immediate Undo records ordered actual snapshots/status',async()=>{
 const f=await fixture();try{
  await assert.rejects(()=>f.transport.connect(false));assert.equal(f.calls.length,0);
  f.setCommand(proposal(f));await f.connect();await waitFor(()=>f.controller.status('request')==='preview');
  assert.equal(f.controller.snapshot().revision,0);assert.equal(f.controller.snapshot().scene.background,'#ffffff');
  assert.equal(f.controller.apply('request'),'applied');f.transport.notifyLocalChange();
  assert.equal(f.controller.undo(),true);f.transport.notifyLocalChange();
  await waitFor(()=>f.calls.some(c=>c.path.endsWith('/sync')&&c.body.snapshot.revision===2));
  const applied=f.calls.findIndex(c=>c.path.endsWith('/report')&&c.body.state==='applied');
  const revision1=f.calls.findIndex(c=>c.path.endsWith('/sync')&&c.body.snapshot.revision===1);
  const revision2=f.calls.findIndex(c=>c.path.endsWith('/sync')&&c.body.snapshot.revision===2);
  assert.ok(revision1>=0&&applied>revision1&&revision2>applied);
  assert.equal(f.controller.exportPNG().size,9);
  assert.ok(f.calls.every(c=>!JSON.stringify(c.body).includes('local-png')));
 }finally{await f.transport.disconnect();f.transport.dispose();f.controller.dispose();}
});

test('inactive adapter: actual timer keeps poll/cancel running during an asynchronous controller render',async()=>{
 const f=await fixture(),gate=deferred();try{
  f.setRenderGate(gate);f.setCommand(proposal(f));await f.connect();await waitFor(()=>f.controller.status('request')==='rendering');
  f.setCancel(['request']);await new Promise(r=>setTimeout(r,3100));
  assert.equal(f.controller.status('request'),'canceled');assert.equal(f.controller.snapshot().revision,0);
  gate.resolve();await waitFor(()=>f.calls.some(c=>c.path.endsWith('/report')&&c.body.state==='canceled'));
 }finally{gate.resolve();await f.transport.disconnect();f.transport.dispose();f.controller.dispose();}
});

test('inactive adapter: late create after Cancel is revoked without adopting, syncing or exposing proof',async()=>{
 const f=await fixture({slowCreate:true});try{
  const pending=f.transport.connect(true);await waitFor(()=>f.calls.length===1);await f.transport.disconnect();
  assert.equal(f.transport.snapshot().phase,'revoking');f.gate.resolve();await pending;
  assert.deepEqual(f.calls.map(c=>c.path),['/scene/browser/create','/scene/browser/revoke']);
  assert.equal(f.transport.snapshot().revocationConfirmed,true);
  assert.ok(!f.states.some(s=>s.proof));
 }finally{f.transport.dispose();f.controller.dispose();}
});

test('inactive adapter: lost revoke remains unconfirmed, blocks reconnect and preserves PNG until explicit retry',async()=>{
 const f=await fixture({failRevoke:true});try{
  await f.connect();const png=f.controller.exportPNG();await f.transport.disconnect();
  assert.equal(f.transport.snapshot().phase,'error');assert.equal(f.transport.snapshot().canConnect,false);assert.equal(f.transport.snapshot().canDisconnect,true);assert.notEqual(f.transport.snapshot().revocationConfirmed,true);
  assert.equal(f.calls.filter(c=>c.path.endsWith('/revoke')).length,2);
  assert.equal(f.controller.exportPNG().size,png.size);
  await f.transport.disconnect();assert.equal(f.transport.snapshot().revocationConfirmed,true);
 }finally{f.transport.dispose();f.controller.dispose();}
});


test('inactive adapter: a claim delivered after acknowledged Disconnect cannot render or mutate the local controller',async()=>{
 const f=await fixture({slowPoll:true});try{
  f.setCommand(proposal(f));await f.connect();await f.transport.disconnect();f.pollGate.resolve();
  await new Promise(r=>setTimeout(r,20));
  assert.equal(f.controller.status('request'),null);assert.equal(f.renders,1);
  assert.equal(f.transport.snapshot().phase,'disconnected');assert.equal(f.transport.snapshot().revocationConfirmed,true);
 }finally{f.pollGate.resolve();f.transport.dispose();f.controller.dispose();}
});

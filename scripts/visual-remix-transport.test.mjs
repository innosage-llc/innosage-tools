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
async function fixture({slowCreate=false,failRevoke=false,slowPoll=false,respectCreateAbort=false,clientNow=Date.now,pollStatus=0,paired=false,slowUpload=false}={}){
 let renders=0,renderGate=null,command=null,cancel=[],connected=paired,revokeFailures=failRevoke?2:0;
 const calls=[],states=[];
 const controller=new VisualRemixController(async()=>{renders++;if(renderGate)await renderGate.promise;return{png:new Blob(['local-png']),diagnostics:[]};});
 await controller.open('fixture',0,emptyScene(),new LocalAssets());
 const source=controller.snapshot(),gate=deferred(),pollGate=deferred(),uploadGate=deferred();
 const owner={purpose:'visual-remix',shareId:'synthetic-share',projectId:source.projectId,generation:source.generation,epoch:1,credential:'a'.repeat(64)};
 const issuedAt=Date.now();
 const share={auth:owner,proof:'b'.repeat(64),expiresAt:issuedAt+1800000,proofExpiresAt:issuedAt+300000};
 const transport=new VisualRemixTransport(controller,true,s=>states.push(s),()=>{},async(path,init)=>{
  const body=JSON.parse(init.body);calls.push({path,body});
  if(path.endsWith('/create')){
   if(slowCreate)await (respectCreateAbort?Promise.race([gate.promise,new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))]):gate.promise);
   return response(share);
  }
  if(path.endsWith('/sync'))return response({ok:true});
  if(path.endsWith('/poll')){if(pollStatus)return new Response('private token must never be reflected',{status:pollStatus,headers:{'X-Visual-Remix-Request-Id':'12345678-1234-1234-1234-123456789abc','X-Visual-Remix-Version':'0.1.6','X-Visual-Remix-Revision':'a'.repeat(40)}});const result={command,cancellations:cancel,connected};command=null;if(slowPoll)await pollGate.promise;return response(result);}
  if(path.endsWith('/report'))return response({ok:true});
  if(path.endsWith('/reference')){if(slowUpload)await uploadGate.promise;return response({ok:true});}
  if(path.endsWith('/revoke')){if(revokeFailures-->0)return new Response('Uncertain',{status:503});return response({ok:true});}
  throw new Error('Unknown path');
 },clientNow);
 return{controller,transport,calls,states,gate,pollGate,uploadGate,share,setPaired:c=>connected=c,setCommand:c=>command=c,setCancel:c=>cancel=c,setRenderGate:g=>renderGate=g,connect:async()=>{await transport.connect(true);await waitFor(()=>calls.some(c=>c.path.endsWith('/poll')));},get renders(){return renders;}};
}
const proposal=(f,id='request')=>{const s=f.controller.snapshot();return{schemaVersion:1,projectId:s.projectId,generation:s.generation,baseRevision:s.revision,requestId:id,explanation:'Synthetic edit',scene:{...s.scene,background:'#123456'}};};
const preparedReference=()=>({consent:{confirmed:true,reuseCrops:true,manifest:{version:1,sourceSHA256:'c'.repeat(64),sourceWidth:10,sourceHeight:10,sha256:'d'.repeat(64),width:10,height:10,mime:'image/png',bytes:3}},source:new Blob(['original-local-only']),data:'YWJj'});

test('fresh pixel consent sends manifest before pairing but bytes only after binding; old flow never uploads',async()=>{
 const f=await fixture();try {
  const image=preparedReference();await f.transport.connect(true,image);await waitFor(()=>f.calls.some(c=>c.path.endsWith('/poll')));
  assert.deepEqual(f.calls.find(c=>c.path.endsWith('/create')).body.referenceConsent,image.consent);
  assert.ok(!f.calls.some(c=>JSON.stringify(c.body).includes('YWJj')),'no pixels before host binding');
  f.setPaired(true);f.transport.refresh();await waitFor(()=>f.transport.snapshot().reference==='ready');
  const uploads=f.calls.filter(c=>c.path.endsWith('/reference'));assert.equal(uploads.length,1);assert.deepEqual(uploads[0].body.reference,{manifest:image.consent.manifest,data:image.data});
  f.transport.refresh();await new Promise(r=>setTimeout(r,20));assert.equal(f.calls.filter(c=>c.path.endsWith('/reference')).length,1);
 }finally{await f.transport.disconnect();f.transport.dispose();f.controller.dispose();}
 const old=await fixture({paired:true});try{await old.connect();assert.ok(!old.calls.some(c=>c.path.endsWith('/reference')));}finally{await old.transport.disconnect();old.transport.dispose();old.controller.dispose();}
});
test('late image upload after Disconnect cannot revive connection or submit a candidate',async()=>{
 const f=await fixture({paired:true,slowUpload:true});try {
  await f.transport.connect(true,preparedReference());await waitFor(()=>f.calls.some(c=>c.path.endsWith('/reference')));
  await f.transport.disconnect();f.uploadGate.resolve();await new Promise(r=>setTimeout(r,20));
  assert.equal(f.transport.snapshot().phase,'disconnected');assert.equal(f.transport.snapshot().reference,undefined);assert.equal(f.controller.snapshot().revision,0);
 }finally{f.uploadGate.resolve();f.transport.dispose();f.controller.dispose();}
});
test('cancellation while local crop preparation is pending reports canceled and never creates stale preview',async()=>{
 const f=await fixture({paired:true}),gate=deferred();let preparing=false;try {
  const p=proposal(f,'slow-crop');await f.transport.connect(true,preparedReference(),async p=>{preparing=true;await gate.promise;return p;});
  await waitFor(()=>f.transport.snapshot().reference==='ready');f.setCommand(p);f.transport.refresh();await waitFor(()=>preparing);
  f.setCancel([p.requestId]);f.transport.refresh();await waitFor(()=>f.calls.some(c=>c.path.endsWith('/report')&&c.body.state==='canceled'));
  gate.resolve();await new Promise(r=>setTimeout(r,20));assert.equal(f.controller.snapshot().preview,null);assert.equal(f.controller.snapshot().revision,0);assert.notEqual(f.transport.snapshot().phase,'error');
 }finally{gate.resolve();await f.transport.disconnect();f.transport.dispose();f.controller.dispose();}
});

test('creation tolerates server clock offsets without extending the local lease',async()=>{
 for(const offset of [120000,-600000]){
  const f=await fixture();const started=Date.now();
  f.share.expiresAt+=offset;f.share.proofExpiresAt+=offset;
  try{
   await f.transport.connect(true);
   const state=f.transport.snapshot();
   assert.equal(state.phase,'awaiting-consent');
   assert.ok(state.expiresAt>=started+1799000&&state.expiresAt<=Date.now()+1800000);
   assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,1);
  }finally{await f.transport.disconnect();f.transport.dispose();f.controller.dispose();}
 }
});

test('invalid confirmation retains only bound auth for explicit revocation, never proof or polling',async()=>{
 for(const invalid of [
  {expiresAt:1.5},{expiresAt:Number.MAX_SAFE_INTEGER+1},{expiresAt:Infinity},
  {expiresAt:-1},{proofExpiresAt:1.5},{proofExpiresAt:-1},{proof:'invalid'},
  share=>{share.expiresAt+=1;},
 ]){
  const f=await fixture();if(typeof invalid==='function')invalid(f.share);else Object.assign(f.share,invalid);
  try{
   await f.transport.connect(true);
   const state=f.transport.snapshot();assert.equal(state.phase,'error');
   assert.equal(state.canConnect,false);assert.equal(state.canDisconnect,true);
   assert.equal(state.proof,undefined);
   assert.deepEqual(f.calls.map(c=>c.path),['/scene/browser/create']);
   await f.transport.disconnect();assert.equal(f.transport.snapshot().revocationConfirmed,true);
   assert.deepEqual(f.calls.map(c=>c.path),['/scene/browser/create','/scene/browser/revoke']);
  }finally{f.transport.dispose();f.controller.dispose();}
 }
});

test('a confirmation after the local proof deadline is withheld but explicitly revocable',async()=>{
 let now=Date.now();const f=await fixture({slowCreate:true,clientNow:()=>now});
 try{
  const pending=f.transport.connect(true);now+=300001;f.gate.resolve();await pending;
  const state=f.transport.snapshot();assert.equal(state.phase,'error');assert.equal(state.proof,undefined);
  assert.equal(state.canDisconnect,true);assert.deepEqual(f.calls.map(c=>c.path),['/scene/browser/create']);
  await f.transport.disconnect();assert.equal(f.transport.snapshot().revocationConfirmed,true);
 }finally{f.transport.dispose();f.controller.dispose();}
});

test('a missing confirmation field cannot auto-recreate or claim',async()=>{
 const f=await fixture();delete f.share.proofExpiresAt;
 try{
  await f.transport.connect(true);assert.equal(f.transport.snapshot().phase,'error');
  assert.equal(f.transport.snapshot().canConnect,false);assert.equal(f.transport.snapshot().canDisconnect,false);
  assert.deepEqual(f.calls.map(c=>c.path),['/scene/browser/create']);
 }finally{f.transport.dispose();f.controller.dispose();}
});

test('unknown or mismatched creation auth cannot be used to revoke another share',async()=>{
 for(const invalid of [{projectId:'other-project'},{generation:'other-generation'},{credential:'invalid'}]){
  const f=await fixture();Object.assign(f.share.auth,invalid);
  try{
   await f.transport.connect(true);assert.equal(f.transport.snapshot().phase,'error');
   assert.equal(f.transport.snapshot().canDisconnect,false);
   assert.deepEqual(f.calls.map(c=>c.path),['/scene/browser/create']);
  }finally{f.transport.dispose();f.controller.dispose();}
 }
});

test('a slow creation response is accepted after five seconds without a second create',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=await fixture({slowCreate:true,respectCreateAbort:true});
 try{
  const pending=f.transport.connect(true);t.mock.timers.tick(6000);f.gate.resolve();await pending;
  assert.equal(f.transport.snapshot().phase,'awaiting-consent');
  assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,1);
 }finally{await f.transport.disconnect();f.transport.dispose();f.controller.dispose();}
});

test('creation still times out once and leaves uncertain delivery blocked',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=await fixture({slowCreate:true,respectCreateAbort:true});
 try{
  const pending=f.transport.connect(true);t.mock.timers.tick(15001);await pending;
  assert.equal(f.transport.snapshot().phase,'error');assert.equal(f.transport.snapshot().canConnect,false);
  assert.equal(f.transport.snapshot().canDisconnect,false);
  assert.deepEqual(f.calls.map(c=>c.path),['/scene/browser/create']);
 }finally{f.gate.resolve();f.transport.dispose();f.controller.dispose();}
});

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

test('late invalid confirmation honors cancellation or disposal without proof or polling',async()=>{
 for(const dispose of [false,true])for(const expired of [false,true]){
  let now=Date.now();const f=await fixture({slowCreate:true,clientNow:()=>now});
  try{
   const pending=f.transport.connect(true);
   if(dispose)f.transport.dispose();else await f.transport.disconnect();
   if(expired)now+=300001;else f.share.proof='invalid';
   f.gate.resolve();await pending;
   assert.deepEqual(f.calls.map(c=>c.path),['/scene/browser/create','/scene/browser/revoke']);
   assert.equal(f.transport.snapshot().revocationConfirmed,true);
   assert.ok(!f.states.some(s=>s.proof));
  }finally{f.transport.dispose();f.controller.dispose();}
 }
});

test('late invalid confirmation keeps a lost requested revoke unconfirmed and explicitly retryable',async()=>{
 const f=await fixture({slowCreate:true,failRevoke:true});
 try{
  const pending=f.transport.connect(true);await f.transport.disconnect();
  f.share.proof='invalid';f.gate.resolve();await pending;
  assert.equal(f.transport.snapshot().phase,'error');assert.equal(f.transport.snapshot().canDisconnect,true);
  assert.notEqual(f.transport.snapshot().revocationConfirmed,true);
  assert.deepEqual(f.calls.map(c=>c.path),['/scene/browser/create','/scene/browser/revoke','/scene/browser/revoke']);
  assert.ok(!f.states.some(s=>s.proof));
  await f.transport.disconnect();assert.equal(f.transport.snapshot().revocationConfirmed,true);
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


test('recovery: owner HTTP failures preserve safe diagnostics and local work, with no automatic reconnection',async()=>{
 for(const status of [401,429]){
  const f=await fixture({pollStatus:status});
  try{
   await f.transport.connect(true);await waitFor(()=>f.transport.snapshot().phase==='error');const state=f.transport.snapshot();
   assert.equal(state.diagnostic.status,status);assert.equal(state.diagnostic.version,'0.1.6');assert.equal(state.diagnostic.revision,'a'.repeat(40));assert.equal(state.canConnect,false);assert.equal(state.canDisconnect,true);assert.ok(!JSON.stringify(state).includes('private token'));assert.match(state.error,status===401?/manually reconnect/:/Stop retrying/);assert.equal(f.controller.exportPNG().size,9);
   assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,1);await f.transport.disconnect();assert.equal(f.transport.snapshot().revocationConfirmed,true);
  }finally{f.transport.dispose();f.controller.dispose();}
 }
});

test('recovery: proof and lease expiry explain fresh manual authorization without losing local work',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const paired of [false,true]){
  let now=Date.now();const f=await fixture({paired,clientNow:()=>now});
  try{
   await f.transport.connect(true);for(let i=0;i<30;i++)await new Promise(setImmediate);
   if(paired)assert.equal(f.transport.snapshot().phase,'connected');
   now+=paired?1800001:300001;t.mock.timers.tick(3001);for(let i=0;i<30;i++)await new Promise(setImmediate);
   assert.equal(f.transport.snapshot().revocationConfirmed,true);
   assert.match(f.transport.snapshot().notice,paired?/lease expired/:/proof expired/);assert.equal(f.controller.exportPNG().size,9);assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,1);
  }finally{f.transport.dispose();f.controller.dispose();}
 }
});


test('foreground wake refreshes only existing consent and never creates, extends or revives expired sharing',async()=>{
 let now=Date.now();const f=await fixture({clientNow:()=>now,paired:true});
 try{
  f.transport.refresh();assert.equal(f.calls.length,0);
  await f.connect();await waitFor(()=>f.transport.snapshot().phase==='connected');
  const deadline=f.transport.snapshot().expiresAt, syncs=f.calls.filter(c=>c.path.endsWith('/sync')).length;
  f.transport.refresh();await waitFor(()=>f.calls.filter(c=>c.path.endsWith('/sync')).length>syncs);
  assert.equal(f.transport.snapshot().expiresAt,deadline);
  assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,1);
  now=deadline+1;f.transport.refresh();await waitFor(()=>f.transport.snapshot().phase==='disconnected');
  f.transport.refresh();assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,1);assert.ok(f.transport.snapshot().revocationConfirmed);
 }finally{await f.transport.disconnect();f.transport.dispose();f.controller.dispose();}
});

test('expiry preserves pending local parameters, applied PNG and Undo/Redo; only explicit fresh consent reconnects',async()=>{
 let now=Date.now();const f=await fixture({paired:true,clientNow:()=>now});try{
  await f.connect();await waitFor(()=>f.transport.snapshot().phase==='connected');
  const next={...f.controller.snapshot().scene,background:'#112233'};
  await f.controller.renderLocalEdit(next,f.controller.stageLocalEdit());f.transport.notifyLocalChange();
  const before=f.controller.snapshot(),png=await f.controller.exportPNG().text();
  const draft=f.controller.stageLocalEdit('pending-gesture');
  now+=1800001;f.transport.refresh();await waitFor(()=>f.transport.snapshot().phase==='disconnected');
  assert.ok(f.transport.snapshot().reauthorizationRequired);assert.equal(f.controller.snapshot().editing,true);
  assert.deepEqual(f.controller.snapshot().scene,before.scene);assert.equal(f.controller.snapshot().generation,before.generation);
  assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,1);f.transport.refresh();assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,1);
  const later={...next,background:'#223344'};assert.equal(await f.controller.renderLocalEdit(later,draft),'applied');assert.ok(f.controller.undo());assert.ok(f.controller.redo());
  assert.equal(await f.controller.exportPNG().text(),png);assert.deepEqual(f.controller.snapshot().scene,later);
  await assert.rejects(f.transport.connect(false),/NOT_CONFIRMED/);
  await f.transport.connect(true);await waitFor(()=>f.transport.snapshot().phase==='connected');
  assert.equal(f.calls.filter(c=>c.path.endsWith('/create')).length,2);assert.equal(f.calls.filter(c=>c.path.endsWith('/create'))[1].body.leaseMs,1800000);
  assert.deepEqual(f.controller.snapshot().scene,later);assert.equal(f.transport.snapshot().reauthorizationRequired,undefined);
 }finally{await f.transport.disconnect();f.transport.dispose();f.controller.dispose();}
});

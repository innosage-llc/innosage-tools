import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyScene, parseScene, importProject, importProposal, REMIX_LIMITS, type Scene, type Proposal } from '../lib/visual-remix.ts';
import { LocalAssets, rasterHeader, loadPortableProject, savePortableProject } from '../lib/visual-remix-assets.ts';
import { VisualRemixController, type RenderedScene } from '../lib/visual-remix-controller.ts';

function scene(): Scene {
  return { ...emptyScene(), nodes: [{ id: 'title', type: 'text', x: 80, y: 80, width: 900, height: 150, rotation: 0, opacity: 1, text: 'Hello 世界', font: 'sans', fontSize: 60, fontWeight: 'bold', lineHeight: 1.3, align: 'left', wrap: 'word', fill: '#111111' }] };
}
function proposal(c: VisualRemixController, requestId: string, candidate = scene()): Proposal {
  const s = c.snapshot(); return { schemaVersion: 1, requestId, projectId: s.projectId, generation: s.generation, baseRevision: s.revision, scene: candidate, explanation: 'Changed copy and geometry' };
}
const rendered = (s: Scene): RenderedScene => ({ png: new Blob([JSON.stringify(s)]), diagnostics: [] });
const signal = () => new AbortController().signal;
function pngHeader(width = 2, height = 2): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(32); data.set([137,80,78,71,13,10,26,10]); const v = new DataView(data.buffer); v.setUint32(8,13); data.set([73,72,68,82],12); v.setUint32(16,width); v.setUint32(20,height); return data;
}

test('strict schema rejects executable, unknown, inherited, invalid geometry and reference data', () => {
  const valid = scene(); assert.deepEqual(parseScene(valid), valid);
  for (const extra of ['className','__proto__','constructor','url','html']) {
    const input = JSON.parse(JSON.stringify(valid)); Object.defineProperty(input.nodes[0],extra,{value:'evil',enumerable:true}); assert.throws(() => parseScene(input));
  }
  for (const patch of [{ x: NaN }, { x: Infinity }, { width: -1 }, { x: 1000 }, { rotation: 181 }, { text: '<script>alert(1)</script>' }, { fill: 'url(https://example.com)' }, { font: 'https://font.example' }]) {
    const input = scene(); Object.assign(input.nodes[0],patch); assert.throws(() => parseScene(input));
  }
  const inherited = Object.create(valid); assert.throws(() => parseScene(inherited));
  const duplicate = scene(); duplicate.nodes.push({ ...duplicate.nodes[0] }); assert.throws(() => parseScene(duplicate));
  const dangling = scene(); dangling.nodes = [{ ...dangling.nodes[0], type: 'image', assetId: 'missing', crop: { x:0,y:0,width:1,height:1 } } as unknown as Scene['nodes'][0]]; assert.throws(() => parseScene(dangling));
  const tooMany = scene(); tooMany.nodes = Array.from({length:101},(_,i) => ({...tooMany.nodes[0],id:'n'+i})); assert.throws(() => parseScene(tooMany));
  const long = scene(); if(long.nodes[0].type === 'text') long.nodes[0].text = '中'.repeat(20_001); assert.throws(() => parseScene(long));
  assert.throws(() => importProposal(' '.repeat(REMIX_LIMITS.proposalBytes+1)));
  assert.throws(() => importProject(' '.repeat(REMIX_LIMITS.projectBytes+1)));
});

test('portable schema excludes URLs, credentials, unreferenced or duplicate assets', () => {
  const p = {schemaVersion:1,projectId:'p',revision:0,scene:scene(),assets:[]};
  assert.deepEqual(importProject(JSON.stringify(p)),p);
  for (const data of ['https://example.com/a.png','file:///private.png','data:image/svg+xml;base64,PHN2Zz4=']) assert.throws(() => importProject(JSON.stringify({...p,assets:[{id:'asset',data}]})));
  assert.throws(() => importProject(JSON.stringify({...p,token:'secret'})));
});

test('raster preflight rejects corrupt signatures, oversized dimensions and byte limits before decode', async () => {
  assert.deepEqual(rasterHeader(pngHeader()),{mime:'image/png',width:2,height:2});
  for (const bytes of [new Uint8Array(32), pngHeader(5000,5000), pngHeader(0,10), new Uint8Array(REMIX_LIMITS.imageBytes+1)]) assert.throws(() => rasterHeader(bytes));
  let calls = 0; const store = new LocalAssets();
  await assert.rejects(store.add('huge',new Blob([pngHeader(5000,5000)]),signal(),async () => {calls++; return {width:5000,height:5000,close(){}};}));
  assert.equal(calls,0);
  let closed = false;
  await assert.rejects(store.add('wrong',new Blob([pngHeader()]),signal(),async () => ({width:3,height:2,close(){closed=true;}})),/DIMENSION/);
  assert.equal(closed,true); assert.deepEqual(store.descriptors(),[]);
});

test('portable assets survive save/reload; header, MIME and decoded size must agree', async () => {
  const store = new LocalAssets(); const decode = async () => ({width:2,height:2,close(){}});
  const a = await store.add('crop',new Blob([pngHeader()]),signal(),decode);
  const s = scene(); s.assets = [a];
  const text = await savePortableProject('p',4,s,store);
  const loaded = await loadPortableProject(text,signal(),decode);
  assert.deepEqual(loaded.project.scene,s); assert.deepEqual(await loaded.assets.blob(a).arrayBuffer(),await store.blob(a).arrayBuffer());
  const bad = JSON.parse(text); bad.scene.assets[0].width = 3;
  await assert.rejects(loadPortableProject(JSON.stringify(bad),signal(),decode),/DIMENSION/);
});

test('aggregate decode reservation bounds simultaneous allocation and releases on cancellation', async () => {
  const store = new LocalAssets(); const release: (() => void)[] = []; let calls=0, closed=0;
  const decode = async () => { calls++; await new Promise<void>(r=>release.push(r)); return {width:4000,height:4000,close(){closed++;}}; };
  const abort = new AbortController();
  const one = store.add('one',new Blob([pngHeader(4000,4000)]),abort.signal,decode);
  const two = store.add('two',new Blob([pngHeader(4000,4000)]),signal(),decode);
  while(calls<2) await new Promise(r=>setTimeout(r,0));
  await assert.rejects(store.add('three',new Blob([pngHeader(4000,4000)]),signal(),decode),/PIXEL_LIMIT/);
  abort.abort(); release.forEach(r=>r());
  await assert.rejects(one); await two; assert.equal(closed,2); assert.equal(store.descriptors().length,1);
});

test('preview is separate; content and geometry changes apply exactly, replay does not compute or reapply', async () => {
  let calls=0; const c = new VisualRemixController(async s=>{calls++;return rendered(s);});
  await c.open('p',0,scene(),new LocalAssets()); const original = c.snapshot();
  const changed=scene(); changed.nodes[0].y=400; if(changed.nodes[0].type==='text') changed.nodes[0].text='Longer revised quote 中文';
  const p=proposal(c,'change',structuredClone(changed)); assert.equal(await c.propose(p),'preview');
  assert.deepEqual(c.snapshot().scene,original.scene); assert.equal(c.snapshot().revision,0);
  p.scene.nodes[0].y=900; // Caller cannot alter the retained candidate.
  assert.equal(c.apply('change'),'applied'); assert.equal(c.snapshot().scene?.nodes[0].y,400);
  assert.equal(c.snapshot().revision,1); assert.deepEqual(JSON.parse(await c.exportPNG().text()),changed);
  assert.equal(await c.propose({...p,scene:changed}),'applied'); assert.equal(calls,2); assert.equal(c.apply('change'),'applied'); assert.equal(c.snapshot().revision,1);
  assert.throws(()=>c.propose(p),/CONFLICT/);
  assert.equal(c.undo(),true); assert.equal(c.snapshot().revision,2); assert.deepEqual(c.snapshot().scene,original.scene);
});

test('stale, canceled, replaced and revoked proposals cannot commit even after late render', async () => {
  let release: (()=>void)|undefined;
  const c = new VisualRemixController(async s=>{if(release !== undefined) await new Promise<void>(r=>{release=r;});return rendered(s);});
  await c.open('p',0,scene(),new LocalAssets());
  const stale=proposal(c,'stale'); stale.baseRevision=99; assert.equal(await c.propose(stale),'stale');
  release=()=>{}; const p=proposal(c,'late'); const pending=c.propose(p); c.cancel('late'); release!(); assert.equal(await pending,'canceled'); assert.equal(c.apply('late'),'canceled');
  const p2=proposal(c,'revoke'); const pending2=c.propose(p2); c.revoke(); release!(); assert.equal(await pending2,'revoked'); assert.equal(c.apply('revoke'),'revoked'); assert.equal(c.snapshot().revision,0);
  release=undefined; assert.equal(await c.propose(p2),'revoked');
  assert.equal(await c.propose(proposal(c,'before-replace')),'preview');
  assert.equal(await c.propose(proposal(c,'replacement')),'preview');
  assert.equal(c.apply('before-replace'),'canceled'); assert.equal(c.apply('replacement'),'applied');
});

test('same project reload creates fresh authority; old rendering cannot overwrite imported project', async () => {
  let release: (()=>void)|undefined; let calls=0;
  const c=new VisualRemixController(async s=>{calls++;if(calls===2) await new Promise<void>(r=>release=r);return rendered(s);});
  await c.open('same',0,scene(),new LocalAssets()); const old=proposal(c,'old'); const pending=c.propose(old);
  const next=scene();next.background='#223344'; await c.open('same',0,next,new LocalAssets());
  release!(); assert.equal(await pending,'stale'); assert.equal(await c.propose(old),'stale'); assert.equal(c.snapshot().scene?.background,'#223344');
});

test('failed render and layout errors preserve last good PNG; unsafe export blocked', async () => {
  const c = new VisualRemixController(async s=> { if(s.background==='#ff0000') throw new Error('decoder failure'); return {...rendered(s),diagnostics:s.background==='#000000' ? [{code:'TEXT_OVERFLOW',severity:'error',nodeIds:['title'],message:'overflow'}] : []}; });
  await c.open('p',0,scene(),new LocalAssets()); const good=await c.exportPNG().text();
  assert.equal(await c.propose(proposal(c,'fail',{...scene(),background:'#ff0000'})),'failed'); assert.equal(await c.exportPNG().text(),good);
  assert.equal(await c.propose(proposal(c,'overflow',{...scene(),background:'#000000'})),'preview'); c.apply('overflow'); assert.throws(()=>c.exportPNG(),/FIX_LAYOUT/);
  assert.equal(c.undo(),true); assert.equal(await c.exportPNG().text(),good);
});

test('revoke while opening rejects late load and preserves last committed scene and PNG', async () => {
  let release: (() => void) | undefined;
  const c = new VisualRemixController(async s => {
    if (s.background === '#123456') await new Promise<void>(resolve => { release = resolve; });
    return rendered(s); // Deliberately ignores AbortSignal, like an in-flight decoder.
  });
  await c.open('original', 7, scene(), new LocalAssets());
  const before = c.snapshot(), png = await c.exportPNG().text();
  const loading = c.open('replacement', 22, { ...scene(), background: '#123456' }, new LocalAssets());
  const rejected = assert.rejects(loading, /abort|STALE_RENDER/i);
  const loadingGeneration = c.snapshot().generation;
  c.revoke();
  assert.notEqual(c.snapshot().generation, loadingGeneration);
  release!();
  await rejected;
  assert.equal(c.snapshot().projectId, before.projectId);
  assert.equal(c.snapshot().revision, before.revision);
  assert.deepEqual(c.snapshot().scene, before.scene);
  assert.equal(await c.exportPNG().text(), png);
});

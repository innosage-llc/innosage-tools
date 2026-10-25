import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyScene, type Scene, type Proposal } from '../lib/visual-remix.ts';
import { LocalAssets } from '../lib/visual-remix-assets.ts';
import { VisualRemixController, type RenderedScene, type SceneRenderer } from '../lib/visual-remix-controller.ts';
import { VisualRemixOfflineBridge, SCENE_SHARE_FIELDS, SCENE_MESSAGE_BYTES, type SceneShareConsent } from '../lib/visual-remix-bridge.ts';

const scene = (): Scene => ({ ...emptyScene(), captions: { titleCN: '演示', captionCN: 'Manual draft https://example.com/source', titleEN: 'Demo', captionEN: 'Verify before publishing' } });
const rendered = (s: Scene): RenderedScene => ({ png: new Blob(['PRIVATE_EXPORT_BYTES', JSON.stringify(s)]), diagnostics: [] });
async function world(renderer: SceneRenderer = async s => rendered(s)) {
  const controller = new VisualRemixController(renderer); await controller.open('project', 0, scene(), new LocalAssets());
  const snapshot = controller.snapshot(); let time = Date.now();
  const consent: SceneShareConsent = { purpose: 'visual-remix', confirmed: true, projectId: snapshot.projectId, generation: snapshot.generation, expiresAt: time + 60_000, fields: [...SCENE_SHARE_FIELDS] };
  const bridge = new VisualRemixOfflineBridge(controller, consent, () => time);
  return { controller, bridge, consent, expire: () => { time += 60_001; } };
}
function proposal(c: VisualRemixController, requestId: string, candidate = scene()): Proposal {
  const s = c.snapshot(); return { schemaVersion: 1, requestId, projectId: s.projectId, generation: s.generation, baseRevision: s.revision, scene: candidate, explanation: 'Synthetic offline content/layout proposal' };
}

test('legacy sharing requires current Scene purpose, explicit field consent and a finite local lease', async t => {
  const w = await world(); t.after(() => w.bridge.revoke());
  for (const patch of [{ purpose: 'video' }, { confirmed: false }, { projectId: 'another' }, { generation: 'stale' }, { expiresAt: 0 }, { expiresAt: Infinity }, { expiresAt: Date.now() + 31 * 60_000 }, { fields: ['text'] }]) {
    assert.throws(() => new VisualRemixOfflineBridge(w.controller, { ...w.consent, ...patch } as SceneShareConsent), /SCENE_SHARE_NOT_CONFIRMED/);
  }
  w.consent.projectId = 'mutated-after-consent';
  assert.equal(w.bridge.getScene().projectId, 'project');
});

test('projection includes declared user content and raster descriptors, never owned pixel/export/credential fields', async t => {
  const w = await world(); t.after(() => w.bridge.revoke());
  w.bridge.revoke();
  const store = new LocalAssets(), bytes = new Uint8Array(32);
  bytes.set([137,80,78,71,13,10,26,10]); new DataView(bytes.buffer).setUint32(8,13); bytes.set([73,72,68,82],12);
  new DataView(bytes.buffer).setUint32(16,2); new DataView(bytes.buffer).setUint32(20,2);
  const descriptor = await store.add('approved', new Blob([bytes,'PRIVATE_SOURCE_BYTES']), new AbortController().signal, async () => ({ width:2,height:2,close(){} }));
  const unused = await store.add('unused', new Blob([bytes,'PRIVATE_UNUSED_BYTES']), new AbortController().signal, async () => ({ width:2,height:2,close(){} }));
  const local = scene(); local.assets = [descriptor, unused];
  local.nodes = [{ id:'crop',type:'image',x:0,y:0,width:20,height:20,rotation:0,opacity:1,assetId:descriptor.id,crop:{x:0,y:0,width:2,height:2} }];
  await w.controller.open('project', 0, local, store);
  const b = new VisualRemixOfflineBridge(w.controller, { ...w.consent,generation:w.controller.snapshot().generation }); t.after(() => b.revoke());
  const shared = b.getScene();
  assert.deepEqual(Object.keys(shared).sort(), ['schemaVersion', 'projectId', 'generation', 'revision', 'scene'].sort());
  assert.equal(shared.scene.captions.captionCN, 'Manual draft https://example.com/source');
  assert.deepEqual(shared.scene.assets, [descriptor]);
  assert.doesNotMatch(JSON.stringify(shared), /PRIVATE_SOURCE_BYTES|PRIVATE_UNUSED_BYTES|PRIVATE_EXPORT_BYTES|"unused"|"output"|"preview"|"credential"|"data"|"url"/);
  shared.scene.background = '#000000'; assert.equal(w.controller.snapshot().scene?.background, '#ffffff');
});

test('proposal completes at preview, Apply remains browser-owned, and terminal status reflects actual controller', async t => {
  const w = await world(); t.after(() => w.bridge.revoke());
  const candidate = scene(); candidate.background = '#ffeecc';
  const p = proposal(w.controller, 'a', candidate), payload = JSON.stringify(p);
  assert.deepEqual(await w.bridge.proposeScene(payload), { requestId: 'a', state: 'preview', applied: false, awaitingApply: true, terminal: false });
  assert.equal(w.controller.snapshot().revision, 0);
  assert.equal(await w.controller.exportPNG().text(), await rendered(scene()).png.text());
  assert.equal((await w.bridge.proposeScene(payload)).state, 'preview');
  await assert.rejects(w.bridge.proposeScene(JSON.stringify({ ...p, explanation: 'conflicting retry' })), /REQUEST_ID_CONFLICT/);
  // Synthetic offline unit test only; unrelated to the denied original-image staged Apply.
  assert.equal(w.controller.apply('a'), 'applied');
  assert.equal(w.bridge.proposalStatus('a').applied, true);
  assert.equal(w.bridge.cancelProposal('a').state, 'applied');
  const stale = proposal(w.controller, 'stale'); stale.baseRevision = 0;
  assert.equal((await w.bridge.proposeScene(JSON.stringify(stale))).state, 'stale');
  assert.throws(() => w.bridge.proposalStatus('unowned'), /UNKNOWN_SCENE_REQUEST/);
});

test('UTF-8 message cap rejects a large valid local Scene without changing local PNG export', async t => {
  const w = await world(); t.after(() => w.bridge.revoke());
  const local = scene(); local.provenance = '中'.repeat(1500); local.limitations = '中'.repeat(1500); local.captions.captionCN = '中'.repeat(2000);
  await w.controller.open('project', 0, local, new LocalAssets());
  const snapshot = w.controller.snapshot(); const b = new VisualRemixOfflineBridge(w.controller, { ...w.consent, generation: snapshot.generation }); t.after(() => b.revoke());
  assert.throws(() => b.getScene(), /SCENE_MESSAGE_TOO_LARGE/);
  assert.ok(w.controller.exportPNG().size > SCENE_MESSAGE_BYTES);
  await assert.rejects(b.proposeScene(' '.repeat(SCENE_MESSAGE_BYTES + 1)), /SCENE_MESSAGE_TOO_LARGE/);
  assert.equal(w.controller.snapshot().revision, 0);
});

test('cancel/revoke fence a late render and preserve the applied synthetic PNG', async t => {
  let resolve!: (value: RenderedScene) => void;
  const renderer: SceneRenderer = async s => s.background === '#123456' ? new Promise(r => { resolve = r; }) : rendered(s);
  const w = await world(renderer); t.after(() => w.bridge.revoke());
  const candidate = scene(); candidate.background = '#123456';
  const pending = w.bridge.proposeScene(JSON.stringify(proposal(w.controller, 'late', candidate)));
  assert.equal(w.bridge.proposalStatus('late').state, 'rendering');
  assert.equal(w.bridge.cancelProposal('late').state, 'canceled');
  w.bridge.revoke(); resolve(rendered(candidate));
  assert.equal((await pending).state, 'share_revoked');
  assert.equal(w.controller.snapshot().revision, 0); assert.equal(w.controller.snapshot().preview, null);
  assert.throws(() => w.bridge.getScene(), /REVOKED_OR_EXPIRED/);
});

test('expired consent rejects late completion without claiming Apply', async t => {
  let resolve!: (value: RenderedScene) => void;
  const w = await world(async s => s.background === '#123456' ? new Promise(r => { resolve = r; }) : rendered(s)); t.after(() => w.bridge.revoke());
  const candidate = scene(); candidate.background = '#123456';
  const pending = w.bridge.proposeScene(JSON.stringify(proposal(w.controller, 'expires', candidate)));
  w.expire(); resolve(rendered(candidate));
  assert.equal((await pending).state, 'share_revoked');
  assert.equal(w.controller.snapshot().scene?.background, '#ffffff');
});

test('old consent cannot read or cancel a replacement project with a reused request ID', async t => {
  let resolve!: (value: RenderedScene) => void;
  const w = await world(async s => s.background === '#123456' ? new Promise(r => { resolve = r; }) : rendered(s)); t.after(() => w.bridge.revoke());
  await w.bridge.proposeScene(JSON.stringify(proposal(w.controller, 'same-id')));
  await w.controller.open('new-project', 0, scene(), new LocalAssets());
  const candidate = scene(); candidate.background = '#123456';
  const fresh = w.controller.propose(proposal(w.controller, 'same-id', candidate));
  assert.throws(() => w.bridge.getScene(), /REVOKED_OR_EXPIRED/);
  assert.equal(w.controller.status('same-id'), 'rendering');
  resolve(rendered(candidate)); assert.equal(await fresh, 'preview');
});

test('same-ID import rejects transitional consent and requires a settled fresh binding', async t => {
  let resolve!: (value: RenderedScene) => void;
  const w = await world(async s => s.background === '#123456' ? new Promise(r => { resolve = r; }) : rendered(s));
  t.after(() => w.bridge.revoke());
  const replacement = scene(); replacement.background = '#123456';
  const opening = w.controller.open('project', 0, replacement, new LocalAssets());
  const transitional = w.controller.snapshot();
  assert.equal(transitional.loading, true);
  assert.equal(transitional.scene?.background, '#ffffff');
  const mixedConsent = { ...w.consent, generation: transitional.generation };
  assert.throws(() => new VisualRemixOfflineBridge(w.controller, mixedConsent), /SCENE_SHARE_NOT_CONFIRMED/);
  assert.throws(() => w.bridge.getScene(), /REVOKED_OR_EXPIRED/);
  resolve(rendered(replacement)); await opening;
  const settled = w.controller.snapshot();
  assert.equal(settled.loading, false);
  assert.notEqual(settled.generation, transitional.generation);
  assert.throws(() => new VisualRemixOfflineBridge(w.controller, mixedConsent), /SCENE_SHARE_NOT_CONFIRMED/);
  const fresh = new VisualRemixOfflineBridge(w.controller, { ...w.consent, generation: settled.generation });
  t.after(() => fresh.revoke());
  assert.equal(fresh.getScene().scene.background, '#123456');
});


test('explicit until-revoked local bridge has no timer, still requires current binding and manual Apply',async t=>{
 const w=await world();let now=Date.now();t.after(()=>w.bridge.revoke());
 const consent={...w.consent,expiresAt:null,lifetime:'until-revoked' as const};
 assert.throws(()=>new VisualRemixOfflineBridge(w.controller,{...consent,lifetime:undefined} as unknown as SceneShareConsent),/NOT_CONFIRMED/);
 const b=new VisualRemixOfflineBridge(w.controller,consent,()=>now);t.after(()=>b.revoke());
 now+=31*60000;assert.equal(b.getScene().projectId,'project');
 const next=scene();next.background='#112233';assert.equal((await b.proposeScene(JSON.stringify(proposal(w.controller,'permanent-preview',next)))).awaitingApply,true);assert.equal(w.controller.snapshot().revision,0);
 assert.equal(w.controller.apply('permanent-preview'),'applied');const png=w.controller.exportPNG();b.revoke();assert.throws(()=>b.getScene(),/REVOKED_OR_EXPIRED/);assert.equal(w.controller.exportPNG(),png);
});

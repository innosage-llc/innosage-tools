import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { emptyScene, type Proposal } from '../../../lib/visual-remix.ts';
import { parseSceneSnapshot, sceneToolResult, SCENE_LIMITS, type SceneAuth, type SceneOwner, type SceneSnapshot } from '../../../lib/visual-remix-remote.ts';
const snapshot = (): SceneSnapshot => ({ schemaVersion: 1, projectId: 'synthetic-project', generation: 'synthetic-generation', revision: 0, scene: emptyScene() });
type Created = { auth: SceneOwner; proof: string; expiresAt: number };
async function fixture() {
  const bundle = await build({ entryPoints: ['test/fixtures/scene.ts'], bundle: true, format: 'esm', platform: 'browser', conditions: ['workerd'], write: false });
  let egress = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-13', d1Databases: ['DB'], outboundService: () => { egress++; return new Response('DENIED', { status: 403 }); } }));
  const db = await mf.getD1Database('DB');
  for (const path of ['migrations/0001.sql','candidate-migrations/scene.sql','candidate-migrations/scene-until-revoked.sql']) await db.exec(readFileSync(path, 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' '));
  let time = Date.now();
  const call = async (action: string, data: Record<string, unknown> = {}) => {
    const response = await mf.dispatchFetch('https://localhost/fixture', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-fixture-time': String(time) }, body: JSON.stringify({ action, ...data }) });
    return { status: response.status, ...await response.json() as { value?: unknown; error?: string } };
  };
  const create = async (leaseMs?:number) => { const r = await call('create', { snapshot: snapshot(),...(leaseMs!==undefined?{leaseMs}:{}) }); assert.equal(r.status, 200, r.error); return r.value as Created; };
  const consent = async () => { const created = await create(); const r = await call('bind', { proof: created.proof, handle: crypto.randomUUID() }); assert.equal(r.status, 200, r.error); return { ...created, remote: r.value as SceneAuth }; };
  return { mf, db, call, create, consent, advance: (ms: number) => { time += ms; }, noEgress: () => assert.equal(egress, 0) };
}
const proposal = (id = 'request-1'): Proposal => ({ schemaVersion: 1, requestId: id, projectId: snapshot().projectId, generation: snapshot().generation, baseRevision: 0, scene: { ...emptyScene(), background: '#123456' }, explanation: 'Synthetic content/layout proposal' });

test('actual local D1: proof races, cross-purpose isolation and consent-handle tombstones', async () => {
  const f = await fixture();
  try {
    const p = await f.create();
    assert.equal((await f.call('snapshot', { auth: { ...p.auth, credential: undefined } })).value, null);
    const races = await Promise.all(['handle-one','handle-two'].map(handle => f.call('bind', { proof: p.proof, handle })));
    assert.equal(races.filter(r => r.value).length, 1);
    const second = await f.create(), winner = races[0].value ? 'handle-one' : 'handle-two';
    assert.equal((await f.call('bind', { proof: second.proof, handle: winner })).status, 409);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_consent_bindings').first('n'), 1);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM projects').first('n'), 0);
    assert.equal((await f.call('bind', { proof: 'a'.repeat(64), handle: 'unused' })).value, null);
    f.noEgress();
  } finally { await f.mf.dispose(); }
});

test('actual local D1: admission/claim races, preview is pending, applied result requires matching snapshot', async () => {
  const f = await fixture();
  try {
    const p = await f.consent(), request = proposal();
    const admissions = await Promise.all([1,2].map(() => f.call('propose', { auth: p.remote, proposal: request })));
    assert.ok(admissions.every(r => r.status === 200), JSON.stringify(admissions));
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_requests').first('n'), 1);
    assert.equal(await f.db.prepare('SELECT request_count FROM scene_shares WHERE id=?').bind(p.auth.shareId).first('request_count'), 1, 'concurrent retry consumes one distinct request slot');
    assert.equal((await f.call('propose', { auth: p.remote, proposal: { ...request, explanation: 'conflict' } })).status, 409);
    const claims = await Promise.all([1,2].map(() => f.call('claim', { auth: p.auth })));
    assert.equal(claims.filter(r => r.value).length, 1);
    assert.equal((await f.call('report', { auth: p.auth, id: request.requestId, state: 'preview' })).value, true);
    assert.deepEqual((await f.call('status', { auth: p.remote, id: request.requestId })).value, { requestId: request.requestId, state: 'preview', applied: false, awaitingApply: true, terminal: false });
    assert.equal((await f.call('report', { auth: p.auth, id: request.requestId, state: 'applied' })).value, false);
    const changed = { ...snapshot(), revision: 1, scene: request.scene };
    assert.equal((await f.call('sync', { auth: p.auth, snapshot: changed })).value, true);
    assert.equal((await f.call('report', { auth: p.auth, id: request.requestId, state: 'applied' })).value, true);
    assert.equal((await f.call('report', { auth: p.auth, id: request.requestId, state: 'applied' })).value, true);
    assert.equal((await f.call('report', { auth: p.auth, id: request.requestId, state: 'failed' })).value, false);
    assert.equal((await f.call('sync', { auth: p.auth, snapshot: { ...snapshot(), revision: 2, scene: { ...emptyScene(), background: '#abcdef' } } })).value, true);
    assert.equal((await f.call('report', { auth: p.auth, id: request.requestId, state: 'applied' })).value, true, 'lost applied ACK survives later local revisions');
    assert.equal((await f.call('report', { auth: { ...p.auth, credential: 'a'.repeat(64) }, id: request.requestId, state: 'applied' })).value, false);
    assert.equal((await f.call('report', { auth: { ...p.auth, epoch: 2 }, id: request.requestId, state: 'applied' })).value, false);
    assert.equal((await f.call('claim', { auth: p.auth })).value, null);
    f.noEgress();
  } finally { await f.mf.dispose(); }
});

test('actual local D1: owner/generation/freshness fences, cancel/revoke and bounded retention', async () => {
  const f = await fixture();
  try {
    const p = await f.consent(), other = await f.consent(), request = proposal();
    assert.equal((await f.call('sync', { auth: { ...p.auth, credential: 'a'.repeat(64) }, snapshot: snapshot() })).value, false);
    assert.equal((await f.call('sync', { auth: p.auth, snapshot: { ...snapshot(), generation: 'replacement' } })).value, false);
    assert.equal((await f.call('sync', { auth: p.auth, snapshot: { ...snapshot(), scene: request.scene } })).value, false, 'same revision cannot change content');
    f.advance(SCENE_LIMITS.freshnessMs + 1);
    assert.equal((await f.call('snapshot', { auth: p.remote })).value, null);
    assert.equal((await f.call('propose', { auth: p.remote, proposal: request })).value, null);
    assert.equal((await f.call('sync', { auth: p.auth, snapshot: snapshot() })).value, true);
    await f.call('propose', { auth: p.remote, proposal: request }); await f.call('claim', { auth: p.auth });
    assert.equal((await f.call('cancel', { auth: other.remote, id: request.requestId })).value, false);
    assert.equal((await f.call('cancel', { auth: p.remote, id: request.requestId })).value, true);
    assert.deepEqual((await f.call('cancellations', { auth: p.auth })).value, [request.requestId]);
    assert.equal((await f.call('revoke', { auth: p.auth })).value, true);
    assert.equal((await f.call('revoke', { auth: p.auth })).value, true, 'lost revoke acknowledgement is idempotent');
    assert.equal((await f.call('report', { auth: p.auth, id: request.requestId, state: 'applied' })).value, false);
    assert.equal((await f.call('snapshot', { auth: p.remote })).value, null);
    assert.equal(await f.db.prepare('SELECT snapshot FROM scene_shares WHERE id=?').bind(p.auth.shareId).first('snapshot'), null);
    assert.equal(await f.db.prepare('SELECT payload FROM scene_requests WHERE share=?').bind(p.auth.shareId).first('payload'), null);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_consent_bindings').first('n'), 2);
    f.advance(SCENE_LIMITS.leaseMs);
    assert.equal((await f.call('lease', { auth: other.remote })).value, null);
    await f.call('sweep');
    assert.equal(await f.db.prepare('SELECT snapshot FROM scene_shares WHERE id=?').bind(other.auth.shareId).first('snapshot'), null);
    assert.equal(await f.db.prepare('SELECT shares FROM scene_budget').first('shares'), 2);
    f.noEgress();
  } finally { await f.mf.dispose(); }
});

test('bounded schema and actual escaped tool envelopes reject binary/unused data and oversized UTF-8', () => {
  assert.deepEqual(parseSceneSnapshot(snapshot()), snapshot());
  assert.throws(() => parseSceneSnapshot({ ...snapshot(), output: 'private' }));
  assert.throws(() => parseSceneSnapshot({ ...snapshot(), scene: { ...emptyScene(), assets: [{ id: 'unused', mime: 'image/png', width: 2, height: 2 }] } }));
  assert.throws(() => parseSceneSnapshot({ ...snapshot(), scene: { ...emptyScene(), provenance: '中'.repeat(5000) } }));
  assert.throws(() => sceneToolResult({ text: '\\'.repeat(10_000) }), /SCENE_MESSAGE_LIMIT/);
});

test('actual local D1: finite cumulative share and distinct-request budgets cannot reset through retry or revoke', async () => {
  const f = await fixture();
  try {
    const p = await f.consent();
    for (let i = 0; i < SCENE_LIMITS.requests; i++) {
      const request = proposal('bounded-' + i);
      assert.equal((await f.call('propose', { auth: p.remote, proposal: request })).status, 200);
      assert.equal((await f.call('cancel', { auth: p.remote, id: request.requestId })).value, true);
    }
    assert.equal((await f.call('propose', { auth: p.remote, proposal: proposal('bounded-0') })).status, 200, 'terminal duplicate remains readable at budget limit');
    assert.equal((await f.call('propose', { auth: p.remote, proposal: proposal('excess') })).status, 409);
    await f.call('revoke', { auth: p.auth });
    for (let i = 1; i < SCENE_LIMITS.shares; i++) await f.create();
    assert.equal((await f.call('create', { snapshot: snapshot() })).status, 409);
    assert.equal(await f.db.prepare('SELECT shares FROM scene_budget').first('shares'), 20);
    assert.equal(await f.db.prepare('SELECT request_count FROM scene_shares WHERE id=?').bind(p.auth.shareId).first('request_count'), 16);
    f.noEgress();
  } finally { await f.mf.dispose(); }
});

test('explicit 30-minute consent keeps legacy leases short and fixed across heartbeat; expiry and revoke remain enforced',async()=>{
 const f=await fixture();try{
  const old=await f.create(),newer=await f.create(SCENE_LIMITS.leaseMs);
  assert.equal(newer.expiresAt-old.expiresAt,900000);
  const oldRemote=(await f.call('bind',{proof:old.proof,handle:'legacy'})).value;
  const remote=(await f.call('bind',{proof:newer.proof,handle:'new-consent'})).value;
  for(const bad of [0,900000,1800001,'1800000',null])assert.equal((await f.call('create',{snapshot:snapshot(),leaseMs:bad})).status,409);
  f.advance(900001);assert.equal((await f.call('lease',{auth:oldRemote})).value,null);
  assert.deepEqual((await f.call('lease',{auth:remote})).value,{expiresAt:newer.expiresAt});
  assert.equal((await f.call('sync',{auth:newer.auth,snapshot:snapshot()})).value,true);
  assert.deepEqual((await f.call('lease',{auth:remote})).value,{expiresAt:newer.expiresAt},'heartbeat does not extend');
  f.advance(900000);assert.equal((await f.call('lease',{auth:remote})).value,null);assert.equal((await f.call('snapshot',{auth:remote})).value,null);
  assert.equal((await f.call('sync',{auth:newer.auth,snapshot:snapshot()})).value,false);
  assert.equal((await f.call('propose',{auth:remote,proposal:proposal('expired')})).value,null);
  assert.equal((await f.call('revoke',{auth:newer.auth})).value,true);assert.equal((await f.call('revoke',{auth:newer.auth})).value,true);
  const next=await f.create(SCENE_LIMITS.leaseMs);assert.notEqual(next.auth.shareId,newer.auth.shareId);assert.notEqual(next.proof,newer.proof);
  assert.equal((await f.call('bind',{proof:newer.proof,handle:'no-reuse'})).value,null);f.noEgress();
 }finally{await f.mf.dispose();}
});

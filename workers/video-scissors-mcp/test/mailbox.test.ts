import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const metadata = { duration: 30, generation: 1, version: 1, hasOutput: false, canUndo: false, latestOperationId: null, errorCode: 'NONE' };
const command = (id: string) => ({ kind: 'cut', operationId: id, generation: 1, version: 1, clips: [{ start: 1, end: 2 }] });
async function fixture() {
  const bundled = await build({ entryPoints: ['test/fixture-worker.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, loader: { '.sql': 'text' } });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-10-13', d1Databases: ['DB'] }));
  const db = await mf.getD1Database('DB');
  // exec accepts each statement on one line, including complete trigger bodies.
  const sql = readFileSync('migrations/0001.sql', 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
  await db.exec(sql);
  const call = async (action: string, body: object = {}) => {
    const response = await mf.dispatchFetch('http://fixture.local/', { method: 'POST', body: JSON.stringify({ action, ...body }) });
    return { status: response.status, value: await response.json() };
  };
  const project = async (handle = crypto.randomUUID()) => {
    const created = await call('create');
    assert.equal(created.status, 200);
    const auth = created.value as {project: string; epoch: number; credential: string; proof: string};
    const bound = await call('bind', { auth, proof: auth.proof, handle });
    assert.equal(bound.status, 200); assert.ok(bound.value);
    assert.equal((await call('sync', { auth, metadata })).value, true);
    return auth;
  };
  return { mf, db, call, project };
}

test('real local Workers/D1: concurrent proof consumption and durable handle tombstone', async () => {
  const f = await fixture();
  try {
    const { value: auth } = await f.call('create');
    const p = auth as {proof: string};
    const races = await Promise.all(['consent-a','consent-b'].map(handle => f.call('bind', { auth, proof: p.proof, handle })));
    assert.equal(races.filter(r => r.value && r.status === 200).length, 1);
    const winner = races[0].value ? 'consent-a' : 'consent-b';
    const { value: second } = await f.call('create');
    const rejected = await f.call('bind', { auth: second, proof: (second as {proof: string}).proof, handle: winner });
    assert.equal(rejected.status, 409);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM consent_bindings').first('n'), 1);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM projects WHERE proof_hash IS NOT NULL').first('n'), 1, 'failed tombstone bind rolls back proof consumption');
  } finally { await f.mf.dispose(); }
});

test('real local Workers/D1: independent concurrent claims, duplicate binding and uncertain slot', async () => {
  const f = await fixture();
  try {
    const auth = await f.project();
    assert.equal((await f.call('admit', { auth, command: command('one') })).status, 200);
    const claims = await Promise.all([1,2].map(() => f.call('claim', { auth, metadata })));
    assert.equal(claims.filter(r => r.value !== null).length, 1);
    assert.equal((await f.call('claim', { auth, metadata })).value, null, 'lost dispatch is never redelivered');
    assert.equal((await f.call('admit', { auth, command: command('one') })).status, 200);
    assert.equal((await f.call('admit', { auth, command: { ...command('one'), clips: [{ start: 2, end: 3 }] } })).status, 409);
    await f.db.prepare("UPDATE commands SET deadline=0 WHERE id='one'").run();
    assert.equal((await f.call('admit', { auth, command: command('two') })).status, 409, 'timeout never releases claimed active slot');
    assert.equal((await f.call('report', { auth: { ...auth, credential: 'wrong' }, id: 'one', state: 'completed', metadata })).value, false);
    assert.equal((await f.call('cancel', { auth, id: 'one' })).value, true);
    assert.equal((await f.call('report', { auth, id: 'one', state: 'completed', metadata })).value, true, 'cancel intent cannot strand known completion');
    assert.equal((await f.call('report', { auth, id: 'one', state: 'completed', metadata })).value, true, 'identical lost ACK is idempotent');
    assert.equal((await f.call('report', { auth, id: 'one', state: 'completed', metadata: { ...metadata, version: 99 } })).value, false, 'different terminal payload is denied');
    assert.equal((await f.call('admit', { auth, command: command('two') })).status, 200);
    await f.call('claim', { auth, metadata });
    assert.equal((await f.call('cancel', { auth, id: 'one' })).value, false, 'late cancel cannot target the next operation');
    assert.equal((await f.call('report', { auth, id: 'two', state: 'cancelled', metadata })).value, true);
    assert.equal((await f.call('report', { auth, id: 'two', state: 'completed', metadata })).value, false, 'actual terminal cancelled cannot revive');
  } finally { await f.mf.dispose(); }
});

test('real local Workers/D1: revoke/claim race is serialized; no authorization TOCTOU', async () => {
  const f = await fixture();
  try {
    const auth = await f.project();
    await f.call('admit', { auth, command: command('race') });
    const [claim, revoked] = await Promise.all([f.call('claim', { auth, metadata }), f.call('revoke', { auth })]);
    assert.equal(revoked.value, true);
    assert.ok(claim.value === null || (claim.value as {operationId: string}).operationId === 'race');
    assert.equal((await f.call('claim', { auth, metadata })).value, null);
    assert.equal((await f.call('admit', { auth, command: command('after') })).value, null);
    assert.equal((await f.call('report', { auth, id: 'race', state: 'completed', metadata })).value, false);
  } finally { await f.mf.dispose(); }
});

test('real local Workers/D1: queued expiry, stale generation, privacy and budgets fail closed', async () => {
  const f = await fixture();
  try {
    const auth = await f.project();
    assert.equal((await f.call('sync', { auth, metadata: { ...metadata, fileName: 'synthetic.mp4' } })).status, 409);
    assert.equal((await f.call('admit', { auth, command: { ...command('stale'), generation: 0 } })).value, null);
    await f.call('admit', { auth, command: command('expired') });
    await f.db.prepare("UPDATE commands SET deadline=0 WHERE id='expired'").run();
    assert.equal((await f.call('claim', { auth, metadata })).value, null);
    assert.equal(await f.db.prepare("SELECT state FROM commands WHERE id='expired'").first('state'), 'stale');
    await f.db.prepare('UPDATE projects SET proof_expires=0 WHERE id=?').bind(auth.project).run();
    const { value: unbound } = await f.call('create');
    await f.db.prepare('UPDATE projects SET proof_expires=0 WHERE id=?').bind((unbound as {project: string}).project).run();
    assert.equal((await f.call('bind', { auth: unbound, proof: (unbound as {proof: string}).proof, handle: 'late' })).value, null);
    await f.db.prepare('UPDATE experiment SET oauth=20,projects=20').run();
    assert.equal((await f.call('oauth')).status, 409);
    assert.equal((await f.call('create')).status, 409);
    await f.db.prepare('UPDATE experiment SET http=1999').run();
    assert.equal((await f.call('claim', { auth, metadata })).status, 200);
    assert.equal((await f.call('claim', { auth, metadata })).status, 409);
  } finally { await f.mf.dispose(); }
});

test('real local Workers/D1: late sync/report cannot regress newer metadata', async () => {
  const f = await fixture();
  try {
    const auth = await f.project();
    await f.call('admit', { auth, command: command('older') });
    await f.call('claim', { auth, metadata });
    const newer = { ...metadata, generation: 2, version: 10 };
    assert.equal((await f.call('sync', { auth, metadata: newer })).value, true);
    assert.equal((await f.call('sync', { auth, metadata })).value, false);
    assert.equal((await f.call('report', { auth, id: 'older', state: 'stale', metadata })).value, true);
    const stored = JSON.parse(await f.db.prepare('SELECT metadata FROM projects WHERE id=?').bind(auth.project).first('metadata') as string);
    assert.equal(stored.generation, 2); assert.equal(stored.version, 10);
    await f.db.prepare('UPDATE projects SET expires=0 WHERE id=?').bind(auth.project).run();
    assert.equal((await f.call('admit', { auth, command: { ...command('late'), generation: 2, version: 10 } })).value, null);
    assert.equal((await f.call('claim', { auth, metadata: newer })).value, null);
  } finally { await f.mf.dispose(); }
});

test('real local Workers/D1: concurrent duplicate admission stays idempotent; distinct active commands serialize', async () => {
  const f = await fixture();
  try {
    const auth = await f.project();
    const same = await Promise.all([1,2].map(() => f.call('admit', { auth, command: command('same') })));
    assert.deepEqual(same.map(r => r.status), [200,200]);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM commands').first('n'), 1);
    await f.call('cancel', { auth, id: 'same' });
    const distinct = await Promise.all(['left','right'].map(id => f.call('admit', { auth, command: command(id) })));
    assert.equal(distinct.filter(r => r.status === 200 && r.value).length, 1);
    assert.equal(distinct.filter(r => r.status === 409).length, 1);
  } finally { await f.mf.dispose(); }
});

test('real local Workers/D1: one handle cannot race-bind two projects; admission/revoke race fails closed afterward', async () => {
  const f = await fixture();
  try {
    const created = await Promise.all([f.call('create'), f.call('create')]);
    const bindings = await Promise.all(created.map(r => f.call('bind', { auth: r.value, proof: (r.value as {proof:string}).proof, handle: 'shared-handle' })));
    assert.equal(bindings.filter(r => r.status === 200 && r.value).length, 1);
    assert.equal(bindings.filter(r => r.status === 409).length, 1);
    const auth = await f.project();
    const [admit, revoke] = await Promise.all([f.call('admit', { auth, command: command('admission-race') }), f.call('revoke', { auth })]);
    assert.equal(revoke.value, true);
    assert.ok(admit.value === null || (admit.value as {id: string}).id === 'admission-race');
    assert.equal((await f.call('claim', { auth, metadata })).value, null);
    assert.equal((await f.call('admit', { auth, command: command('revoked') })).value, null);
  } finally { await f.mf.dispose(); }
});

test('real local Workers/D1: delayed old poll cannot stale or claim a newly valid queued job', async () => {
  const f = await fixture();
  try {
    const auth = await f.project();
    const fresh = { ...metadata, version: 9 };
    assert.equal((await f.call('sync', { auth, metadata: fresh })).value, true);
    assert.equal((await f.call('admit', { auth, command: { ...command('fresh'), version: 9 } })).status, 200);
    assert.equal((await f.call('claim', { auth, metadata })).value, null);
    assert.equal(await f.db.prepare("SELECT state FROM commands WHERE id='fresh'").first('state'), 'queued');
    const oldPoll = (await f.call('poll', { auth, metadata })).value;
    assert.equal(oldPoll.command, null);
    assert.equal(oldPoll.refresh, true);
    assert.equal(oldPoll.queries, 1);
    assert.equal(await f.db.prepare("SELECT state FROM commands WHERE id='fresh'").first('state'), 'queued');
    assert.equal((await f.call('claim', { auth, metadata: fresh })).value.operationId, 'fresh');
    assert.equal((await f.call('claim', { auth, metadata: fresh })).value, null);
  } finally { await f.mf.dispose(); }
});

test('real local Workers/D1: empty long-poll is finite, metered and below Free query cap', { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const auth = await f.project();
    const result = await f.call('poll', { auth, metadata });
    assert.equal(result.status, 200);
    const r = result.value as {command: null; checks: number; queries: number; rowsRead: number; rowsWritten: number; wallMilliseconds: number; cpuMilliseconds: null};
    assert.equal(r.command, null); assert.equal(r.checks, 8); assert.equal(r.queries, 24);
    assert.ok(r.wallMilliseconds >= 21_000 && r.wallMilliseconds < 25_000);
    assert.equal(r.cpuMilliseconds, null, 'local wall/database timing must not masquerade as Worker CPU');
    console.log('local-empty-poll-metrics', JSON.stringify(r));
  } finally { await f.mf.dispose(); }
});

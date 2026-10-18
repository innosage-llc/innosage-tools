import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const metadata = { duration: 60, generation: 1, version: 1, hasOutput: false, canUndo: false, latestOperationId: null, errorCode: 'NONE' };
async function fixture() {
  const bundled = await build({ entryPoints: ['test/batch1-worker.ts'], bundle: true, format: 'esm', platform: 'browser',
    conditions: ['workerd'], external: ['node:*', 'cloudflare:*'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'],
    kvNamespaces: ['OAUTH_KV'], bindings: { EXPERIMENT_ENABLED: 'true' } }));
  const db = await mf.getD1Database('DB');
  await db.exec(readFileSync('migrations/0001.sql', 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' '));
  const request = (path: string, options: RequestInit = {}) => mf.dispatchFetch('https://localhost' + path, options);
  const counts = (response: Response) => JSON.parse(response.headers.get('x-fixture-counts')!);
  const register = () => request('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Batch1 local', redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }) });
  const project = async (id: string) => {
    await db.prepare('INSERT INTO projects(id,credential_hash,proof_expires,expires,consent_hash,metadata) VALUES(?,?,0,?,?,?)')
      .bind(id, 'local-owner', Date.now() + 1_800_000, 'consent-' + id, JSON.stringify(metadata)).run();
    return { project: id, epoch: 1, scopes: ['video:read', 'video:edit'] };
  };
  const rpc = async (props: object, scopes: string[] = ['video:read', 'video:edit'], extra: Record<string, string> = {}, name = 'getproject', args = {}) => {
    const r = await request('/__batch1/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18',
      'x-fixture-props': JSON.stringify(props), 'x-fixture-scopes': JSON.stringify(scopes), ...extra },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    const raw = await r.text();
    const data = JSON.parse(r.headers.get('content-type')?.includes('text/event-stream')
      ? raw.split('\n').find(line => line.startsWith('data: '))!.slice(6) : raw);
    return { r, result: data.result, counts: counts(r) };
  };
  return { mf, db, request, counts, register, project, rpc };
}

test('Batch1 native D1: frozen cold/warm HTTP, DCR and authorized getproject counters', async () => {
  const f = await fixture();
  try {
    const cold = await f.request('/.well-known/oauth-authorization-server'); assert.equal(cold.status, 200);
    const warm = await f.request('/.well-known/oauth-authorization-server'); assert.equal(warm.status, 200);
    const dcr = await f.register(); assert.equal(dcr.status, 201);
    const props = await f.project('measured');
    const first = await f.rpc(props); const second = await f.rpc(props);
    for (const r of [first, second]) {
      assert.equal(r.result.isError, undefined);
      assert.deepEqual(JSON.parse(r.result.content[0].text).metadata, metadata);
      assert.equal(r.counts.projectReads, 2);
      assert.equal(r.counts.statements, 2);
      assert.equal(r.counts.rowsWritten, 0);
    }
    assert.equal(f.counts(cold).statements, 2); assert.equal(f.counts(warm).statements, 2);
    assert.equal(f.counts(dcr).statements, 3);
    console.log('batch1-OBSERVED-LOCAL', JSON.stringify({ contract: 'unchanged baseline', cold: f.counts(cold), warm: f.counts(warm),
      dcr: f.counts(dcr), getproject: first.counts, nextRequest: second.counts }));
  } finally { await f.mf.dispose(); }
});

test('Batch1 native D1: cold concurrent init, cumulative HTTP cap and preserved other counters', async () => {
  const f = await fixture();
  try {
    const cold = await Promise.all(Array.from({ length: 8 }, () => f.request('/.well-known/oauth-authorization-server')));
    assert.ok(cold.every(r => r.status === 200));
    const initial = await f.db.prepare('SELECT * FROM experiment').first(); assert.equal(initial!.http, 8);
    await f.db.prepare('UPDATE experiment SET http=1999,oauth=7,dcr=9,projects=11').run();
    const boundary = await Promise.all(Array.from({ length: 8 }, () => f.request('/.well-known/oauth-authorization-server')));
    assert.equal(boundary.filter(r => r.status === 200).length, 1);
    for (const denied of boundary.filter(r => r.status !== 200)) {
      assert.equal(denied.status, 400); assert.deepEqual(await denied.json(), { error: 'REQUEST_REJECTED' });
    }
    const final = await f.db.prepare('SELECT * FROM experiment').first();
    assert.deepEqual(final, { ...initial, http: 2000, oauth: 7, dcr: 9, projects: 11 });
    const exhausted = await f.request('/.well-known/oauth-authorization-server'); assert.equal(exhausted.status, 400);
    console.log('batch1-OBSERVED-LOCAL-boundary', JSON.stringify({ coldRequests: cold.length,
      coldStatements: cold.reduce((sum, r) => sum + f.counts(r).statements, 0), admitted: 1, denied: 7, persistedHttp: final!.http }));
  } finally { await f.mf.dispose(); }
});

test('Batch1 native D1: concurrent DCR ceiling spends HTTP even on denied registration', async () => {
  const f = await fixture();
  try {
    await f.request('/.well-known/oauth-authorization-server');
    await f.db.prepare('UPDATE experiment SET http=0,dcr=19').run();
    const responses = await Promise.all(Array.from({ length: 8 }, () => f.register()));
    assert.equal(responses.filter(r => r.status === 201).length, 1);
    assert.equal(responses.filter(r => r.status === 400).length, 7);
    assert.deepEqual(await f.db.prepare('SELECT http,dcr FROM experiment').first(), { http: 8, dcr: 20 });
    console.log('batch1-OBSERVED-LOCAL-dcr', JSON.stringify({ statements: responses.reduce((sum, r) => sum + f.counts(r).statements, 0), http: 8, dcr: 20, registered: 1 }));
  } finally { await f.mf.dispose(); }
});

test('Batch1 native D1: fail-closed init/spend and single-upsert non-equivalence', async () => {
  const f = await fixture();
  try {
    // A real SQLite failure after initialization must retain the committed row.
    await f.db.exec("CREATE TRIGGER fail_spend BEFORE UPDATE OF http ON experiment BEGIN SELECT RAISE(ABORT,'fixture'); END;");
    const rejected = await f.request('/.well-known/oauth-authorization-server');
    assert.equal(rejected.status, 400); assert.deepEqual(await rejected.json(), { error: 'REQUEST_REJECTED' });
    const persisted = await f.db.prepare('SELECT * FROM experiment').first();
    assert.ok(persisted); assert.equal(persisted.http, 0); assert.ok(Number(persisted.started) > 0);
    await f.db.exec('CREATE TABLE upsert_candidate (singleton INTEGER PRIMARY KEY CHECK(singleton=1),started INTEGER NOT NULL,http INTEGER NOT NULL DEFAULT 0,oauth INTEGER NOT NULL DEFAULT 0,dcr INTEGER NOT NULL DEFAULT 0,projects INTEGER NOT NULL DEFAULT 0);');
    await f.db.exec("CREATE TRIGGER fail_insert_spend BEFORE INSERT ON upsert_candidate WHEN NEW.http>0 BEGIN SELECT RAISE(ABORT,'fixture'); END;");
    await assert.rejects(f.db.prepare(`INSERT INTO upsert_candidate(singleton,started,http) VALUES(1,?,1)
      ON CONFLICT(singleton) DO UPDATE SET http=http+1 WHERE http<2000 RETURNING singleton`)
      .bind(Date.now()).run());
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM upsert_candidate').first('n'), 0,
      'combined cold initialization/spend has no committed initialization on failure');
    await f.db.exec("CREATE TRIGGER fail_init BEFORE INSERT ON experiment BEGIN SELECT RAISE(ABORT,'fixture'); END;");
    const failedInit = await f.request('/.well-known/oauth-authorization-server');
    assert.equal(failedInit.status, 400); assert.equal(f.counts(failedInit).statements, 1);
    assert.deepEqual(await f.db.prepare('SELECT * FROM experiment').first(), persisted);
    console.log('batch1-budget-candidate-DROPPED', JSON.stringify({ persistedColdHttp: 0, combinedColdRows: 0,
      reason: 'separate committed initialization and initialization-error boundary cannot be preserved by one mutation' }));
  } finally { await f.mf.dispose(); }
});

test('Batch1 native D1: getproject scope/epoch/consent/expiry/revoke/isolation fences', async () => {
  const f = await fixture();
  try {
    await f.request('/.well-known/oauth-authorization-server');
    const props = await f.project('owner'); const other = await f.project('other');
    for (const [p, scopes] of [[{ ...props, scopes: ['video:edit'] }, ['video:read']], [props, ['video:edit']]] as const) {
      const denied = await f.rpc(p, [...scopes]);
      assert.equal(denied.result.isError, true); assert.equal(denied.result.content[0].text, 'INSUFFICIENT_SCOPE');
      assert.equal(denied.counts.projectReads, 0); assert.ok(denied.result._meta['mcp/www_authenticate']);
    }
    for (const p of [{ ...props, epoch: 2 }, { ...props, project: 'missing' }]) {
      const denied = await f.rpc(p); assert.equal(denied.result.content[0].text, 'PROJECT_EXPIRED_OR_REVOKED');
      assert.equal(denied.counts.projectReads, 1);
    }
    await f.db.prepare('UPDATE projects SET metadata=? WHERE id=?').bind(JSON.stringify({ ...metadata, duration: 99 }), other.project).run();
    assert.equal(JSON.parse((await f.rpc(props)).result.content[0].text).metadata.duration, 60);
    assert.equal(JSON.parse((await f.rpc(other)).result.content[0].text).metadata.duration, 99);
    await f.db.prepare('UPDATE projects SET consent_hash=NULL WHERE id=?').bind(other.project).run();
    assert.equal((await f.rpc(other)).result.content[0].text, 'PROJECT_EXPIRED_OR_REVOKED');
    await f.db.prepare('UPDATE projects SET expires=0 WHERE id=?').bind(props.project).run();
    assert.equal((await f.rpc(props)).result.content[0].text, 'PROJECT_EXPIRED_OR_REVOKED');
    await f.db.prepare('UPDATE projects SET expires=?,revoked=1 WHERE id=?').bind(Date.now() + 1_800_000, props.project).run();
    assert.equal((await f.rpc(props)).result.content[0].text, 'PROJECT_EXPIRED_OR_REVOKED');
  } finally { await f.mf.dispose(); }
});

test('Batch1 native D1: preserve second-read null across concurrent revoke; later mutation denied', async () => {
  const f = await fixture();
  try {
    await f.request('/.well-known/oauth-authorization-server');
    const props = await f.project('race');
    const raced = await f.rpc(props, undefined, { 'x-fixture-revoke': 'after-read', 'x-fixture-project': props.project });
    assert.equal(raced.result.isError, undefined);
    const value = JSON.parse(raced.result.content[0].text);
    assert.equal(value, null, 'binding contract: second query observes revoke between the reads');
    assert.equal(raced.counts.projectReads, 2);
    assert.equal(await f.db.prepare('SELECT revoked FROM projects WHERE id=?').bind(props.project).first('revoked'), 1);
    const next = await f.rpc(props); assert.equal(next.result.content[0].text, 'PROJECT_EXPIRED_OR_REVOKED');
    const cut = await f.rpc(props, undefined, {}, 'cut', { operationId: 'after-revoke', generation: 1, version: 1, clips: [{ start: 2, end: 4 }] });
    assert.equal(cut.result.content[0].text, 'PROJECT_EXPIRED_OR_REVOKED');
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM commands').first('n'), 0);
    const mutationProps = await f.project('mutation-race');
    const mutation = await f.rpc(mutationProps, undefined,
      { 'x-fixture-revoke': 'after-read', 'x-fixture-project': mutationProps.project }, 'cut',
      { operationId: 'during-revoke', generation: 1, version: 1, clips: [{ start: 2, end: 4 }] });
    assert.deepEqual(JSON.parse(mutation.result.content[0].text), { error: 'STALE_OR_REJECTED' },
      'even an authorized guard snapshot cannot authorize admission after revoke');
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM commands').first('n'), 0);
    console.log('batch1-OBSERVED-LOCAL-revoke', JSON.stringify({ contract: 'unchanged baseline', racedResult: 'null',
      projectReads: raced.counts.projectReads, nextRequest: 'denied', laterMutation: 'denied' }));
  } finally { await f.mf.dispose(); }
});

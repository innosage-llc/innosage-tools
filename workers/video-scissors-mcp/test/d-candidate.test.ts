import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import type { TestProjectStateDO } from './d-harness.ts';
import { signWakeTicket } from '../src/d/routing.ts';

const origin = 'https://localhost';
const key = 'ab'.repeat(32);
const metadata = { duration: 30, generation: 1, version: 1, hasOutput: false, canUndo: false,
  latestOperationId: null, errorCode: 'NONE' };
const bundle = await build({ entryPoints: ['test/d-harness.ts'], bundle: true, format: 'esm', platform: 'browser',
  conditions: ['workerd'], external: ['node:*', 'cloudflare:*'], write: false });

async function world(experiment = 'true') {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'], kvNamespaces: ['OAUTH_KV'],
    durableObjects: { PROJECT_STATE: { className: 'TestProjectStateDO', useSQLite: true } },
    bindings: { EXPERIMENT_ENABLED: experiment, D_ROUTING_HMAC_KEY: key } }));
  const request = (path: string, init: RequestInit = {}) => mf.dispatchFetch(origin + path, { ...init, redirect: 'manual' });
  const json = (path: string, body: unknown, headers: Record<string, string> = {}) => request(path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const form = (path: string, body: URLSearchParams, cookie = '') => request(path, {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  const project = async () => {
    const response = await json('/remote/projects', {}); assert.equal(response.status, 200);
    return response.json() as Promise<{ project: string; epoch: number; credential: string; proof: string; expiresAt: number }>;
  };
  const client = async () => {
    const response = await json('/oauth/register', { client_name: 'D local fixture',
      redirect_uris: ['https://client.example/d-callback'], token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    assert.equal(response.status, 201); return response.json() as Promise<{ client_id: string }>;
  };
  const verifier = 'c'.repeat(64);
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  const authorize = async (c: { client_id: string }) => {
    const query = new URLSearchParams({ client_id: c.client_id, redirect_uri: 'https://client.example/d-callback',
      response_type: 'code', scope: 'video:read video:edit', resource: origin + '/mcp', state: 'd-fixture-state',
      code_challenge: challenge, code_challenge_method: 'S256' });
    const response = await request('/authorize?' + query), html = await response.text();
    assert.equal(response.status, 200);
    const handle = html.match(/name="handle"[^>]*value="([^"]+)"/)?.[1] ?? html.match(/value="([^"]+)"[^>]*name="handle"/)?.[1];
    assert.ok(handle);
    return { handle, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] };
  };
  const link = async () => {
    const p = await project(), c = await client(), a = await authorize(c);
    const approved = await form('/authorize', new URLSearchParams([['handle', a.handle], ['decision', 'approve'],
      ['browserProof', p.proof], ['scope', 'video:read'], ['scope', 'video:edit']]), a.cookie);
    assert.equal(approved.status, 302);
    const callback = new URL(approved.headers.get('location')!);
    const token = await form('/oauth/token', new URLSearchParams({ grant_type: 'authorization_code', client_id: c.client_id,
      code: callback.searchParams.get('code')!, code_verifier: verifier, redirect_uri: 'https://client.example/d-callback', resource: origin + '/mcp' }));
    assert.equal(token.status, 200);
    const tokens = await token.json() as { access_token: string };
    const auth = { project: p.project, epoch: p.epoch, credential: p.credential };
    assert.deepEqual(await (await json('/remote/sync', { auth, metadata })).json(), { ok: true });
    return { p, auth, c, tokens };
  };
  const rpc = (token: string, method: string, params: unknown = {}) => json('/mcp',
    { jsonrpc: '2.0', id: 1, method, params }, { Authorization: `Bearer ${token}`,
      Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' });
  return { mf, request, json, project, link, rpc, form };
}
async function stateFor(f: Awaited<ReturnType<typeof world>>, project: string) {
  const namespace = await f.mf.getDurableObjectNamespace('PROJECT_STATE') as DurableObjectNamespace<TestProjectStateDO>;
  return namespace.getByName(project);
}
async function rpcData(response: Response): Promise<unknown> {
  const text = await response.text();
  const dataLine = text.split('\n').find(line => line.startsWith('data: '));
  return JSON.parse(dataLine ? dataLine.slice(6) : text);
}

test('D is disabled by default and its config template has no D1 or live identifiers', async () => {
  const config = readFileSync('wrangler.d-local.template.jsonc', 'utf8');
  assert.match(config, /"EXPERIMENT_ENABLED":\s*"false"/);
  assert.match(config, /"PROJECT_STATE"/);
  assert.match(config, /"OAUTH_KV"/);
  assert.match(config, /D_ROUTING_HMAC_KEY/);
  assert.doesNotMatch(config, /"(?:d1_databases|database_id|routes|custom_domain)"\s*:/i);
  assert.match(config, /00000000000000000000000000000000/);
  const f = await world('false');
  try {
    assert.equal((await f.request('/remote/capabilities')).status, 503);
    assert.equal((await f.request('/mcp')).status, 503);
  } finally { await f.mf.dispose(); }
});

test('D official OAuth/MCP uses one project SQLite DO, and command is claimed only by the owner browser', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    const { p, auth, tokens } = await f.link();
    const listed = await f.rpc(tokens.access_token, 'tools/list');
    const listText = await listed.text();
    assert.equal(listed.status, 200, listText);
    const listedData = JSON.parse(listText);
    assert.deepEqual(listedData.result.tools.map((tool: { name: string }) => tool.name).sort(), ['cancel', 'cut', 'getproject', 'status', 'undo']);
    for (const tool of listedData.result.tools) assert.deepEqual(tool.securitySchemes, tool._meta?.securitySchemes, JSON.stringify(tool));

    const cut = await f.rpc(tokens.access_token, 'tools/call', { name: 'cut', arguments: {
      operationId: 'fixture-cut', generation: 1, version: 1, clips: [{ start: 2, end: 7 }],
    } });
    assert.equal(cut.status, 200);
    const cutData = await rpcData(cut) as { result: { content: Array<{ text: string }> } };
    assert.equal(JSON.parse(cutData.result.content[0].text).state, 'queued');

    const claimed = await f.json('/remote/claim', { auth, metadata });
    assert.equal(claimed.status, 200);
    assert.equal((await claimed.json() as { command: { operationId: string } }).command.operationId, 'fixture-cut');
    assert.deepEqual(await (await f.json('/remote/claim', { auth, metadata })).json(), { command: null, refresh: false }, 'claimed commands are never dispatched twice');
    assert.equal(p.project, auth.project);
  } finally { await f.mf.dispose(); }
});

test('revoke-before-admit/claim transaction cannot queue or dispatch a command', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    const { auth, p } = await f.link();
    const state = await stateFor(f, p.project);
    const command = { kind: 'cut', operationId: 'pre-revoke', generation: 1, version: 1, clips: [{ start: 1, end: 4 }] };
    const admitted = await state.admit({ project: auth.project, epoch: auth.epoch }, command);
    assert.equal(admitted.operationId, 'pre-revoke'); assert.equal(admitted.state, 'queued');
    assert.equal(await state.revoke(auth), true);

    // Ordered regression: revoke commits first; following admit/claim each do
    // their async hash and then reach the same SQLite transaction fence.
    const late = await state.admit({ project: auth.project, epoch: auth.epoch }, { ...command, operationId: 'late-admit' });
    const dispatch = await state.claim(auth, metadata);
    assert.equal(late, null);
    assert.equal(dispatch, null, 'no post-revoke command can reach the browser compute loop');
    const snapshot = await state.inspectForTest();
    assert.equal(snapshot.project.revoked, 1);
    assert.equal(snapshot.commands.length, 0);
    assert.equal(await state.registerWakeTicket(auth, 'late-wake-ticket', Date.now() + 30_000), false,
      'async ticket hashing cannot persist authority after revocation');
    assert.deepEqual((await state.inspectForTest()).wakeTickets, []);
  } finally { await f.mf.dispose(); }
});

test('wrong browser credential cannot read, sync, or claim another owner project', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    const { auth, p } = await f.link(), state = await stateFor(f, p.project);
    const wrong = { ...auth, credential: 'f'.repeat(64) };
    assert.equal(await state.owner(wrong), null);
    assert.equal(await state.sync(wrong, { ...metadata, duration: 29 }), false);
    assert.deepEqual(await (await f.json('/remote/sync', { auth: wrong, metadata: { ...metadata, duration: 29 } })).json(), { ok: false });
    const queued = await state.admit({ project: auth.project, epoch: auth.epoch }, {
      kind: 'cut', operationId: 'owner-only', generation: 1, version: 1, clips: [{ start: 1, end: 3 }],
    });
    assert.equal(queued.state, 'queued');
    assert.equal(await state.claim(wrong, metadata), null);
    const ownerClaim = await state.claim(auth, metadata);
    assert.equal(ownerClaim.operationId, 'owner-only');
  } finally { await f.mf.dispose(); }
});

test('same operation key recovers an uncertain ACK but conflicting payload and repeat claims never redispatch', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    const { auth, p } = await f.link(), state = await stateFor(f, p.project);
    const command = { kind: 'cut', operationId: 'uncertain-cut', generation: 1, version: 1, clips: [{ start: 2, end: 7 }] };
    const first = await state.admit({ project: auth.project, epoch: auth.epoch }, command);
    assert.equal(first.operationId, 'uncertain-cut'); assert.equal(first.state, 'queued');
    const recovered = await state.admit({ project: auth.project, epoch: auth.epoch }, command);
    assert.equal(recovered.operationId, 'uncertain-cut'); assert.equal(recovered.state, 'queued', 'matching retry recovers an admission whose ACK was lost');
    assert.equal(await state.admit({ project: auth.project, epoch: auth.epoch },
      { ...command, clips: [{ start: 3, end: 7 }] }), null, 'same key cannot identify a different operation');
    assert.equal((await state.claim(auth, metadata)).operationId, 'uncertain-cut');
    assert.equal(await state.claim(auth, metadata), null, 'claim ACK retry does not dispatch the command again');
    const claimedReceipt = await state.admit({ project: auth.project, epoch: auth.epoch }, command);
    assert.equal(claimedReceipt.operationId, 'uncertain-cut');
    assert.equal(claimedReceipt.state, 'claimed', 'the retained receipt records dispatch after an uncertain claim ACK');
    assert.equal(await state.admit({ project: auth.project, epoch: auth.epoch },
      { ...command, clips: [{ start: 3, end: 7 }] }), null, 'conflicting retry after uncertain claim ACK is rejected');
    assert.equal(await state.claim(auth, metadata), null);
    const snapshot = await state.inspectForTest();
    assert.equal(snapshot.commands.length, 1);
    assert.equal(snapshot.commands[0].state, 'claimed');
  } finally { await f.mf.dispose(); }
});

test('wakeup failure preserves a committed command receipt and status-based recovery', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    const { auth, p, tokens } = await f.link(), state = await stateFor(f, p.project);
    await state.failNextNotifyForTest();
    const response = await f.rpc(tokens.access_token, 'tools/call', { name: 'cut', arguments: {
      operationId: 'wake-failed-cut', generation: 1, version: 1, clips: [{ start: 2, end: 7 }],
    } });
    assert.equal(response.status, 200);
    const receipt = JSON.parse((await rpcData(response) as { result: { content: Array<{ text: string }> } }).result.content[0].text);
    assert.deepEqual(receipt, { operationId: 'wake-failed-cut', state: 'queued' },
      'notification failure cannot turn a committed admission into a rejected MCP call');

    const status = await f.rpc(tokens.access_token, 'tools/call', { name: 'status', arguments: { operationId: 'wake-failed-cut' } });
    assert.equal(status.status, 200);
    assert.equal(JSON.parse((await rpcData(status) as { result: { content: Array<{ text: string }> } }).result.content[0].text).state, 'queued');
    const claim = await f.json('/remote/claim', { auth, metadata });
    assert.equal((await claim.json() as { command: { operationId: string } }).command.operationId, 'wake-failed-cut');
    assert.deepEqual(await (await f.json('/remote/claim', { auth, metadata })).json(), { command: null, refresh: false },
      'recovery claims the committed operation at most once');
  } finally { await f.mf.dispose(); }
});

test('explicit revoke lost-ACK retry confirms only the same owner during the tombstone lease', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    const { auth, p } = await f.link(), state = await stateFor(f, p.project);
    const dropped = await f.json('/remote/revoke', { auth });
    assert.equal(dropped.status, 200);
    await dropped.body?.cancel(); // Simulate the committed response being lost by the caller.

    const retry = await f.json('/remote/revoke', { auth });
    assert.deepEqual(await retry.json(), { ok: true, closedSockets: 0 },
      'identical owner retry confirms revoke without recreating the project');
    assert.equal(await state.project({ project: auth.project, epoch: auth.epoch }), null,
      'the receipt grants no read or write authority');
    assert.equal(await state.revoke({ ...auth, credential: 'f'.repeat(64) }), false,
      'different credentials cannot use the receipt');
    assert.equal(await state.revoke({ ...auth, epoch: auth.epoch + 1 }), false,
      'the receipt cannot be replayed under another epoch');
    const snapshot = await state.inspectForTest();
    assert.equal(snapshot.project.revoked, 1);
    assert.equal(snapshot.project.owner_hash, '');
    assert.equal(snapshot.project.metadata, '{}');
  } finally { await f.mf.dispose(); }
});

test('Undo admission and atomic claim require the latest target and current generation/version', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    const { auth, p } = await f.link(), state = await stateFor(f, p.project);
    const latest = { ...metadata, hasOutput: true, canUndo: true, latestOperationId: 'cut-latest' };
    assert.equal(await state.sync(auth, latest), true);
    const undo = (operationId: string, generation: number, version: number, targetOperationId: string) =>
      ({ kind: 'undo', operationId, generation, version, targetOperationId });
    assert.equal(await state.admit({ project: auth.project, epoch: auth.epoch }, undo('undo-wrong-target', 1, 1, 'cut-old')), null);
    assert.equal(await state.admit({ project: auth.project, epoch: auth.epoch }, undo('undo-wrong-generation', 0, 1, 'cut-latest')), null);
    assert.equal(await state.admit({ project: auth.project, epoch: auth.epoch }, undo('undo-wrong-version', 1, 0, 'cut-latest')), null);
    assert.equal((await state.admit({ project: auth.project, epoch: auth.epoch }, undo('undo-superseded', 1, 1, 'cut-latest'))).state, 'queued');

    // Keep generation/version constant deliberately: claim must still fence
    // against the authoritative latest Undo target, not trust the queued one.
    const replacedTarget = { ...latest, latestOperationId: 'cut-newest' };
    assert.equal(await state.sync(auth, replacedTarget), true);
    assert.equal(await state.claim(auth, replacedTarget), null);
    assert.equal((await state.inspectForTest()).commands[0].state, 'stale');

    assert.equal((await state.admit({ project: auth.project, epoch: auth.epoch }, undo('undo-current', 1, 1, 'cut-newest'))).state, 'queued');
    const currentUndo = await state.claim(auth, replacedTarget);
    assert.equal(currentUndo.operationId, 'undo-current');
    assert.equal(currentUndo.kind, 'undo');
    assert.equal(currentUndo.targetOperationId, 'cut-newest');
    assert.equal(currentUndo.generation, 1);
    assert.equal(currentUndo.version, 1);
    assert.equal(await state.claim(auth, replacedTarget), null);
  } finally { await f.mf.dispose(); }
});

test('revoke and lease expiry clear payloads immediately, retain a bounded tombstone alarm, then purge without reuse', { timeout: 30_000 }, async () => {
  for (const terminal of ['revoke', 'expiry'] as const) {
    const f = await world();
    try {
      const { auth, p } = await f.link();
      const state = await stateFor(f, p.project);
      const admitted = await state.admit({ project: auth.project, epoch: auth.epoch }, {
        kind: 'cut', operationId: `cleanup-${terminal}`, generation: 1, version: 1, clips: [{ start: 1, end: 2 }],
      });
      assert.equal(admitted.operationId, `cleanup-${terminal}`); assert.equal(admitted.state, 'queued');
      if (terminal === 'revoke') assert.equal(await state.revoke(auth), true);
      else {
        assert.equal(await state.expireLeaseForTest(auth.project, auth.epoch), null, 'lease check transitions expiry to tombstone');
      }
      const tombstone = await state.inspectForTest();
      assert.equal(tombstone.project.revoked, 1);
      assert.equal(tombstone.project.owner_hash, '');
      assert.equal(tombstone.project.metadata, '{}');
      assert.deepEqual(tombstone.commands, [], 'command payload is cleared immediately');
      assert.ok(tombstone.alarm > Date.now() && tombstone.alarm <= Date.now() + 31 * 60_000);
      assert.equal(await state.createProject({ project: p.project, epoch: 1, ownerHash: p.project,
        expiresAt: Date.now() + 60_000, consentTicket: 'no-reuse', ticketExpiresAt: Date.now() + 30_000 }), false,
        'a retained tombstone prevents blind reuse of the same project identity');

      await state.fastForwardTombstoneForTest();
      const purged = await state.inspectForTest();
      assert.equal(purged.project, null);
      assert.deepEqual(purged.commands, []);
      assert.equal(purged.alarm, null);
      const fresh = await f.project();
      assert.notEqual(fresh.project, p.project, 'post-purge creation mints a new server-owned project identity');
    } finally { await f.mf.dispose(); }
  }
});

test('routing rejects forged, expired, and wrong-project wake tickets; browser body cannot choose another DO', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    const p = await f.project(), auth = { project: p.project, epoch: p.epoch, credential: p.credential };
    const join = await f.json('/remote/bridge/join', { auth });
    assert.equal(join.status, 200);
    const { proof, expiresAt: joinExpiresAt } = await join.json() as { proof: string; expiresAt: number };
    assert.ok(joinExpiresAt > Date.now() && joinExpiresAt <= Date.now() + 60_000,
      'the one-minute proof only limits how long a new connection may be established');
    const socket = (project: string, ticket: string, epoch = p.epoch) => f.request(`/remote/bridge/${project}/${epoch}`, {
      method: 'GET', headers: { Origin: origin, Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': `video-scissors-wakeup.v1, join.${ticket}` },
    });
    assert.equal((await socket(p.project, proof)).status, 101);
    const state = await stateFor(f, p.project);
    const [attachment] = await state.socketAttachmentsForTest();
    assert.equal(attachment.expiresAt, p.expiresAt,
      'an established socket lives through the project lease, not merely the join-proof TTL');
    assert.ok(attachment.expiresAt > joinExpiresAt);
    assert.equal((await socket(p.project, '0'.repeat(64))).status, 401, 'forged HMAC is rejected');
    assert.equal((await socket('f'.repeat(64), proof)).status, 401, 'ticket cannot route to a different project');
    const expired = await signWakeTicket(key, p.project, p.epoch, Date.now() - 1000);
    assert.equal((await socket(p.project, expired)).status, 401, 'expired ticket is rejected');

    const forged = { ...auth, project: 'f'.repeat(64) };
    assert.deepEqual(await (await f.json('/remote/sync', { auth: forged, metadata })).json(), { ok: false },
      'browser-supplied project does not select or authorize a DO');
  } finally { await f.mf.dispose(); }
});

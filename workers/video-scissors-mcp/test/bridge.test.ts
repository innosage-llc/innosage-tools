import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { VideoScissorsRemoteBrowser, remoteWakeupFromCapabilities } from '../../../lib/video-scissors-remote-browser.ts';
import { VideoScissorsController } from '../../../lib/video-scissors.ts';

const protocol = 'video-scissors-wakeup.v1';
const metadata = { duration: 30, generation: 1, version: 1, hasOutput: false, canUndo: false, latestOperationId: null, errorCode: 'NONE' };
const bundle = await build({ entryPoints: ['src/index-do.ts'], bundle: true, format: 'esm', platform: 'browser',
  conditions: ['workerd'], external: ['node:*','cloudflare:*'], write: false });

async function world(origin: string, withBridge = true) {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], kvNamespaces: ['OAUTH_KV'],
    ...(withBridge ? { durableObjects: { VIDEO_BRIDGE: { className: 'VideoScissorsBridgeDO', useSQLite: true } } } : {}),
    bindings: { EXPERIMENT_ENABLED: 'true' } }));
  const db = await mf.getD1Database('DB');
  await db.exec(readFileSync('migrations/0001.sql', 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' '));
  const request = (path: string, init: RequestInit = {}) => mf.dispatchFetch(origin + path, { ...init, redirect: 'manual' });
  const json = (path: string, body: unknown, extra: Record<string, string> = {}) => request(path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body),
  });
  const project = async () => {
    const r = await json('/remote/projects', {}); assert.equal(r.status, 200); return r.json();
  };
  const connectSocket = (p: {project: string; epoch: number}, ticket: string, requestOrigin = origin) => request(
    `/remote/bridge/${p.project}/${p.epoch}`, { method: 'GET', headers: { Origin: requestOrigin, Upgrade: 'websocket',
      'Sec-WebSocket-Protocol': `${protocol}, join.${ticket}` } });
  const client = async () => {
    const r = await json('/oauth/register', { client_name: 'bridge-test', redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code','refresh_token'], response_types: ['code'] });
    assert.equal(r.status, 201); return r.json();
  };
  const authorize = async (c: {client_id: string}) => {
    const verifier = 'b'.repeat(64), challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
    const query = new URLSearchParams({ client_id: c.client_id, redirect_uri: 'https://client.example/callback', response_type: 'code',
      scope: 'video:read video:edit', resource: origin + '/mcp', state: 'bridge-state', code_challenge: challenge, code_challenge_method: 'S256' });
    const response = await request('/authorize?' + query);
    const html = await response.text();
    const handle = html.match(/name="handle"[^>]*value="([^"]+)"/)?.[1] ?? html.match(/value="([^"]+)"[^>]*name="handle"/)?.[1];
    assert.equal(response.status, 200); assert.ok(handle);
    return { handle, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0], verifier };
  };
  const approve = async (p: {proof: string}, c: {client_id: string}) => {
    const a = await authorize(c);
    const response = await request('/authorize', { method: 'POST', headers: { Origin: origin, Cookie: a.cookie,
      'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams([['handle', a.handle], ['decision', 'approve'],
        ['browserProof', p.proof], ['scope', 'video:read'], ['scope', 'video:edit']]).toString() });
    return { response, authorize: a };
  };
  const token = async (p: {proof: string}, c: {client_id: string}) => {
    const a = await approve(p, c); assert.equal(a.response.status, 302);
    const callback = new URL(a.response.headers.get('location')!);
    const result = await request('/oauth/token', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: c.client_id, code: callback.searchParams.get('code')!,
        code_verifier: a.authorize.verifier, redirect_uri: 'https://client.example/callback', resource: origin + '/mcp' }).toString() });
    assert.equal(result.status, 200); return result.json();
  };
  return { mf, db, request, json, project, connectSocket, client, approve, token };
}

test('DO bridge requires owner/origin, consumes one-use proofs, reconnects with a fresh proof, and closes at revoke/expiry', { timeout: 30_000 }, async () => {
  const w = await world('https://cut-a.example');
  try {
    const p = await w.project(), auth = { project: p.project, epoch: p.epoch, credential: p.credential };
    const caps = await w.request('/remote/capabilities');
    assert.deepEqual(await caps.json(), { enabled: true, wakeup: 'websocket' });
    assert.equal((await w.json('/remote/bridge/join', { auth }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await w.json('/remote/bridge/join', { auth: { ...auth, credential: 'f'.repeat(64) } })).status, 401);
    const minted = await w.json('/remote/bridge/join', { auth }); assert.equal(minted.status, 200);
    const ticket = await minted.json(); assert.ok(ticket.expiresAt > Date.now() && ticket.expiresAt <= Date.now() + 60_000);

    assert.equal((await w.connectSocket(p, ticket.proof, 'https://evil.example')).status, 403, 'foreign Origin cannot consume a join proof');
    const first = await w.connectSocket(p, ticket.proof);
    assert.equal(first.status, 101); assert.equal(first.headers.get('sec-websocket-protocol'), protocol);
    const socket = first.webSocket;
    assert.ok(socket, 'DO returned the WebSocket pair');
    socket.accept();
    socket.close(1000, 'test-reconnect');
    assert.equal((await w.connectSocket(p, ticket.proof)).status, 401, 'proof is single-use even after disconnect');

    const nextTicket = await (await w.json('/remote/bridge/join', { auth })).json();
    const second = await w.connectSocket(p, nextTicket.proof);
    assert.equal(second.status, 101, 'reconnect requires and accepts a fresh proof');
    const liveSocket = second.webSocket;
    liveSocket.accept();
    assert.equal(liveSocket.readyState, WebSocket.OPEN);
    const revokeResponse = await w.json('/remote/revoke', { auth });
    assert.equal(revokeResponse.status, 200);
    const revokeResult = await revokeResponse.json();
    assert.equal(revokeResult.closedSockets, 1, 'D1 revoke found and closed the matching hibernated DO socket');
    const repeatedRevoke = await (await w.json('/remote/revoke', { auth })).json();
    assert.equal(repeatedRevoke.ok, true, 'D1 revoke is idempotent');
    assert.equal(repeatedRevoke.closedSockets, 0);
    assert.equal((await w.json('/remote/bridge/join', { auth })).status, 401, 'revoked owner cannot mint a proof');

    const expired = await w.project();
    await w.db.prepare('UPDATE projects SET expires=? WHERE id=?').bind(Date.now() - 1, expired.project).run();
    assert.equal((await w.json('/remote/bridge/join', { auth: { project: expired.project, epoch: expired.epoch, credential: expired.credential } })).status, 401,
      'expired project lease cannot mint or reconnect');
  } finally { await w.mf.dispose(); }
});

test('capability negotiation requires an explicit known wakeup mode', () => {
  assert.equal(remoteWakeupFromCapabilities({ enabled: true, wakeup: 'poll' }), 'poll');
  assert.equal(remoteWakeupFromCapabilities({ enabled: true, wakeup: 'websocket' }), 'websocket');
  for (const value of [null, {}, { enabled: false }, { enabled: true }, { enabled: true, wakeup: 'unknown' }]) {
    assert.throws(() => remoteWakeupFromCapabilities(value), /CAPABILITIES/);
  }
});

test('DO arm fails closed when its bridge binding is absent instead of advertising polling', { timeout: 30_000 }, async () => {
  const w = await world('https://video-scissors-mcp-do-staging.example.workers.dev', false);
  try {
    const response = await w.request('/remote/capabilities');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'BRIDGE_UNAVAILABLE' });
  } finally { await w.mf.dispose(); }
});

test('remote connect fails closed on capability network/status/shape errors before project creation', async () => {
  const cases: Array<[string, typeof fetch]> = [
    ['network', async () => { throw new Error('offline'); }],
    ['status', async () => new Response('{}', { status: 503 })],
    ['malformed JSON', async () => new Response('{', { status: 200 })],
    ['missing mode', async () => Response.json({ enabled: true })],
    ['malformed mode', async () => Response.json({ enabled: true, wakeup: 'unknown' })],
  ];
  for (const [name, send] of cases) {
    const controller = new VideoScissorsController({ renderer: { inspect: async () => { throw new Error('unused'); }, render: async () => { throw new Error('unused'); } } });
    const requests: string[] = [];
    const remote = new VideoScissorsRemoteBrowser(controller, async (input, init) => {
      requests.push(String(input));
      return send(input, init);
    });
    try {
      await remote.connect();
      assert.deepEqual(requests, ['/remote/capabilities'], name);
      assert.equal(remote.snapshot().pairingProof, null, name);
      assert.equal(remote.snapshot().state, 'uncertain', name);
    } finally { await remote.dispose(); controller.dispose(); }
  }
});

test('separate A/B D1 and OAuth KV reject the other arm’s pairing proof and access token', { timeout: 30_000 }, async () => {
  const a = await world('https://cut-a.example'), b = await world('https://cut-b.example');
  try {
    const projectA = await a.project(), projectB = await b.project();
    const clientA = await a.client(), clientB = await b.client();
    const tokenA = await a.token(projectA, clientA), tokenB = await b.token(projectB, clientB);

    const aHandleOnB = await b.approve(projectA, clientB);
    assert.equal(aHandleOnB.response.status, 403, 'A pairing proof cannot bind a B consent handle');
    const bHandleOnA = await a.approve(projectB, clientA);
    assert.equal(bHandleOnA.response.status, 403, 'B pairing proof cannot bind an A consent handle');

    const rpc = (w: Awaited<ReturnType<typeof world>>, token: string) => w.json('/mcp',
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' });
    assert.equal((await rpc(b, tokenA.access_token)).status, 401, 'A access token is not present/accepted by B provider bindings');
    assert.equal((await rpc(a, tokenB.access_token)).status, 401, 'B access token is not present/accepted by A provider bindings');
  } finally { await Promise.all([a.mf.dispose(), b.mf.dispose()]); }
});

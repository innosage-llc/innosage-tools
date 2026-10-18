import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import type { TestProjectStateDO } from './d-harness.ts';
import { signWakeTicket } from '../src/d/routing.ts';
import { D_EXPERIMENT_BUDGET_OBJECT } from '../src/d/budget.ts';

const origin = 'https://localhost';
const key = 'ab'.repeat(32);
const metadata = { duration: 30, generation: 1, version: 1, hasOutput: false, canUndo: false,
  latestOperationId: null, errorCode: 'NONE' };
const bundle = await build({ entryPoints: ['test/d-harness.ts'], bundle: true, format: 'esm', platform: 'browser',
  conditions: ['workerd'], external: ['node:*', 'cloudflare:*'], write: false });

async function world(experiment = 'true', script = bundle.outputFiles[0].text) {
  const options = (script: string) => convertV4MiniflareOptions({ modules: true, script,
    compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'], kvNamespaces: ['OAUTH_KV'],
    serviceBindings: { ASSETS: async request => new Response(`asset:${new URL(request.url).pathname}`) },
    durableObjects: { PROJECT_STATE: { className: 'TestProjectStateDO', useSQLite: true } },
    bindings: { EXPERIMENT_ENABLED: experiment, D_ROUTING_HMAC_KEY: key } });
  const mf = new Miniflare(options(script));
  const reloadScript = (script: string) => mf.setOptions(options(script));
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
    assert.deepEqual(await (await json('/remote/sync', { auth, metadata })).json(), { ok: true, consented: true });
    return { p, auth, c, tokens };
  };
  const rpc = (token: string, method: string, params: unknown = {}) => json('/mcp',
    { jsonrpc: '2.0', id: 1, method, params }, { Authorization: `Bearer ${token}`,
      Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' });
  return { mf, request, json, project, link, rpc, form, reloadScript };
}
async function stateFor(f: Awaited<ReturnType<typeof world>>, project: string) {
  const namespace = await f.mf.getDurableObjectNamespace('PROJECT_STATE') as DurableObjectNamespace<TestProjectStateDO>;
  return namespace.getByName(project);
}
async function budgetFor(f: Awaited<ReturnType<typeof world>>) {
  const namespace = await f.mf.getDurableObjectNamespace('PROJECT_STATE') as DurableObjectNamespace<TestProjectStateDO>;
  return namespace.getByName(D_EXPERIMENT_BUDGET_OBJECT);
}
async function exhaustRequests(f: Awaited<ReturnType<typeof world>>) {
  const budget = await budgetFor(f);
  const used = (await budget.budgetSnapshotForTest())?.worker_requests ?? 0;
  const responses = await Promise.all(Array.from({ length: 200 - used }, () => f.request('/remote/capabilities')));
  assert.ok(responses.every(response => response.status === 200));
  assert.equal((await budget.budgetSnapshotForTest())?.worker_requests, 200);
  return budget;
}
async function rpcData(response: Response): Promise<unknown> {
  const text = await response.text();
  const dataLine = text.split('\n').find(line => line.startsWith('data: '));
  return JSON.parse(dataLine ? dataLine.slice(6) : text);
}
// Miniflare RPC rows are lazy proxies; compare detached values, not proxy identity.
const detached = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

test('D is disabled by default and its config template has no D1 or live identifiers', async () => {
  const config = readFileSync('wrangler.d-local.template.jsonc', 'utf8');
  const stagingConfig = readFileSync('wrangler.d-staging.template.jsonc', 'utf8');
  assert.match(config, /"EXPERIMENT_ENABLED":\s*"false"/);
  assert.match(config, /"PROJECT_STATE"/);
  assert.match(config, /"OAUTH_KV"/);
  assert.match(config, /D_ROUTING_HMAC_KEY/);
  assert.doesNotMatch(config, /"(?:d1_databases|database_id|routes|custom_domain)"\s*:/i);
  assert.match(config, /00000000000000000000000000000000/);
  assert.match(stagingConfig, /"name":\s*"video-scissors-mcp-d-staging"/);
  assert.match(stagingConfig, /"EXPERIMENT_ENABLED":\s*"false"/);
  assert.match(stagingConfig, /"PROJECT_STATE"/);
  assert.match(stagingConfig, /"OAUTH_KV"/);
  assert.doesNotMatch(stagingConfig, /"(?:d1_databases|database_id|routes|custom_domain)"\s*:/i);
  assert.match(stagingConfig, /D_ROUTING_HMAC_KEY/);
  assert.match(stagingConfig, /00000000000000000000000000000000/);
  const f = await world('false');
  try {
    const asset = await f.request('/tools/video-scissors');
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), 'asset:/tools/video-scissors');
    assert.equal((await f.request('/remote/capabilities')).status, 503);
    assert.equal((await f.request('/mcp')).status, 503);
    assert.deepEqual(await (await f.json('/remote/revoke', {})).json(), { error: 'NOT_ENABLED' });
    assert.equal(await (await budgetFor(f)).budgetSnapshotForTest(), null, 'disabled traffic does not consume the experiment budget');
  } finally { await f.mf.dispose(); }
});

test('D quota cleanup: exact owner revoke survives full or unavailable budget without resetting it', { timeout: 30_000 }, async () => {
  for (const failure of [false, true]) {
    const f = await world();
    try {
      const { p, auth, tokens } = await f.link(), state = await stateFor(f, p.project);
      const neighbor = await f.project(), neighborState = await stateFor(f, neighbor.project);
      const neighborBefore = detached(await neighborState.inspectForTest());
      assert.equal((await state.admit(auth, { kind: 'cut', operationId: 'quota-queued',
        generation: 1, version: 1, clips: [{ start: 2, end: 4 }] })).state, 'queued');
      const join = await f.json('/remote/bridge/join', { auth });
      const { proof } = await join.json() as { proof: string };
      const upgraded = await f.request(`/remote/bridge/${p.project}/${p.epoch}`, { headers: {
        Origin: origin, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `video-scissors-wakeup.v1, join.${proof}`,
      } });
      assert.equal(upgraded.status, 101);
      const socket = upgraded.webSocket!; socket.accept();
      assert.deepEqual(await state.socketReadyStatesForTest(), [1]);
      const budget = await exhaustRequests(f), before = detached(await budget.budgetSnapshotForTest());
      const undo = await f.rpc(tokens.access_token, 'tools/call', { name: 'undo', arguments: {
        operationId: 'quota-undo', generation: 1, version: 1, targetOperationId: 'quota-queued',
      } });
      assert.equal(undo.status, 429);
      assert.deepEqual(await undo.json(), { error: 'DAILY_REQUEST_LIMIT' });
      if (failure) await budget.failNextWorkerBudgetForTest();
      const revoked = await f.json('/remote/revoke', { auth });
      assert.equal(revoked.status, 200);
      assert.equal((await revoked.json() as { ok: boolean }).ok, true);
      // Native server socket is closing/closed. Miniflare's dispatchFetch peer
      // does not reliably emit close; the existing browser test covers the peer.
      assert.ok((await state.socketReadyStatesForTest()).every(value => value === 2 || value === 3));
      socket.close();
      const tombstone = await state.inspectForTest();
      assert.equal(tombstone.project.revoked, 1);
      assert.equal(tombstone.project.epoch, auth.epoch + 1);
      assert.equal(tombstone.project.owner_hash, '');
      assert.equal(tombstone.project.metadata, '{}');
      assert.deepEqual(tombstone.commands, []);
      assert.deepEqual(tombstone.wakeTickets, []);
      assert.ok(tombstone.alarm > Date.now() && tombstone.alarm <= Date.now() + 31 * 60_000);
      assert.equal(await state.owner(auth), null);
      assert.equal(await state.project(auth), null);
      assert.equal((await state.sync(auth, metadata)).ok, false);
      assert.equal(await state.admit(auth, { kind: 'cut', operationId: 'quota-after-revoke',
        generation: 1, version: 1, clips: [{ start: 2, end: 4 }] }), null);
      assert.equal(await state.claim(auth, metadata), null);
      const ordinary = await f.request('/remote/capabilities');
      assert.equal(ordinary.status, failure ? 503 : 429, 'revoke never consulted or consumed the injected budget failure');
      assert.deepEqual(await ordinary.json(), { error: failure ? 'BUDGET_UNAVAILABLE' : 'DAILY_REQUEST_LIMIT' });
      assert.equal((await f.request('/mcp')).status, 429);
      assert.deepEqual(detached(await budget.budgetSnapshotForTest()), before, '200 ordinary requests and 2 project attempts remain unchanged');
      await state.fastForwardTombstoneForTest();
      const purged = await state.inspectForTest();
      assert.equal(purged.project, null); assert.deepEqual(purged.commands, []); assert.equal(purged.alarm, null);
      assert.deepEqual(detached(await neighborState.inspectForTest()), neighborBefore, 'cleanup and alarm never remove another project');
      assert.deepEqual(detached(await budget.budgetSnapshotForTest()), before);
      console.log('local-d-quota-cleanup', JSON.stringify({ workerRequests: 200, projectAttempts: 2, failure,
        undo: 429, revoke: 200, socketClose: 'native server closing/closed', authority: 'denied', purge: true, neighborUnchanged: true }));
    } finally { await f.mf.dispose(); }
  }
});

test('D quota cleanup: invalid auth and neighboring paths cannot use the exact revoke exemption', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    const { p, auth } = await f.link(), victim = await stateFor(f, p.project);
    const neighbor = await f.project(), other = await stateFor(f, neighbor.project);
    const before = detached(await victim.inspectForTest()), otherBefore = detached(await other.inspectForTest());
    const budget = await exhaustRequests(f), budgetBefore = detached(await budget.budgetSnapshotForTest());
    const raw = (body: string, headers: Record<string, string> = {}) => f.request('/remote/revoke', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body,
    });
    for (const response of [
      await f.json('/remote/revoke', { auth }, { Origin: 'https://evil.example' }),
      await raw(JSON.stringify({ auth }), { 'Content-Type': 'text/plain' }),
      await raw('{'), await raw('x'.repeat(16_385)), await f.json('/remote/revoke', {}),
      await f.json('/remote/revoke', { auth: { ...auth, credential: 'f'.repeat(64) } }),
      await f.json('/remote/revoke', { auth: { ...auth, epoch: auth.epoch + 1 } }),
      await f.json('/remote/revoke', { auth: { ...auth, project: neighbor.project } }),
      await f.json('/remote/revoke', { auth: { ...auth, credential: neighbor.credential } }),
    ]) {
      assert.notEqual((await response.json() as { ok?: boolean }).ok, true);
      assert.deepEqual(detached(await victim.inspectForTest()), before);
      assert.deepEqual(detached(await other.inspectForTest()), otherBefore);
    }
    for (const [path, method] of [['/remote/revoke', 'GET'], ['/remote/revoke', 'PUT'],
      ['/remote/revoke/', 'POST'], ['/remote/revoke/child', 'POST'], ['/remote/revoke-other', 'POST'],
      ['/remote/%72evoke', 'POST'], ['/remote/projects', 'POST'], ['/remote/sync', 'POST'],
      ['/mcp', 'POST'], ['/mcp/undo', 'POST'], ['/tools/video-scissors', 'GET']]) {
      const response = await f.request(path, { method });
      assert.equal(response.status, 429, `${method} ${path} remains budgeted`);
      assert.deepEqual(await response.json(), { error: 'DAILY_REQUEST_LIMIT' });
    }
    assert.deepEqual(detached(await victim.inspectForTest()), before);
    assert.deepEqual(detached(await other.inspectForTest()), otherBefore);
    assert.deepEqual(detached(await budget.budgetSnapshotForTest()), budgetBefore);
  } finally { await f.mf.dispose(); }
});

test('D worker request cap is atomic, global and covers protocol plus static HTTP requests', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    const responses = await Promise.all(Array.from({ length: 205 }, () => f.request('/remote/capabilities')));
    assert.equal(responses.filter(response => response.status === 200).length, 200);
    const limited = responses.filter(response => response.status === 429);
    assert.equal(limited.length, 5);
    for (const response of limited) assert.deepEqual(await response.json(), { error: 'DAILY_REQUEST_LIMIT' });
    assert.equal((await f.request('/tools/video-scissors')).status, 429, 'static requests use the same enabled-run ceiling');
    const budget = await (await budgetFor(f)).budgetSnapshotForTest();
    assert.equal(budget?.worker_requests, 200);
    assert.equal(budget?.project_creations, 0);
  } finally { await f.mf.dispose(); }
});

test('D daily project-creation cap is shared and atomic', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    const responses = await Promise.all(Array.from({ length: 5 }, () => f.json('/remote/projects', {})));
    assert.equal(responses.filter(response => response.status === 200).length, 2);
    const limited = responses.filter(response => response.status === 429);
    assert.equal(limited.length, 3);
    for (const response of limited) assert.deepEqual(await response.json(), { error: 'DAILY_PROJECT_LIMIT' });
    const budget = await (await budgetFor(f)).budgetSnapshotForTest();
    assert.equal(budget?.worker_requests, 5);
    assert.equal(budget?.project_creations, 2);
  } finally { await f.mf.dispose(); }
});

test('D WebSocket upgrade spends exactly one Worker HTTP request slot', async () => {
  const f = await world();
  try {
    const response = await f.request(`/remote/bridge/${'a'.repeat(64)}/1`, { method: 'GET', headers: {
      Origin: origin, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'video-scissors-wakeup.v1, join.invalid',
    } });
    assert.equal(response.status, 401, 'invalid join proof is rejected after the upgrade request is admitted');
    const budget = await (await budgetFor(f)).budgetSnapshotForTest();
    assert.equal(budget?.worker_requests, 1);
  } finally { await f.mf.dispose(); }
});

test('D shared budget fails closed and rolls over at the UTC date boundary', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    const budget = await budgetFor(f);
    await budget.failNextWorkerBudgetForTest();
    const unavailable = await f.request('/remote/capabilities');
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { error: 'BUDGET_UNAVAILABLE' });
    assert.deepEqual(await (await f.request('/remote/capabilities')).json(), { enabled: true, wakeup: 'websocket' });
    const beforeRollover = await budget.budgetSnapshotForTest();
    assert.equal(beforeRollover?.worker_requests, 1, 'failed admission does not increment the request counter');
    await budget.rewindBudgetForTest();
    assert.equal(await budget.consumeWorkerRequest(), true);
    assert.equal(await budget.reserveProjectCreation(), true);
    const afterRollover = await budget.budgetSnapshotForTest();
    assert.equal(afterRollover?.worker_requests, 1);
    assert.equal(afterRollover?.project_creations, 1);
    assert.equal(afterRollover?.utc_day, new Date().toISOString().slice(0, 10));

    await budget.failNextProjectBudgetForTest();
    const blockedCreate = await f.json('/remote/projects', {});
    assert.equal(blockedCreate.status, 503);
    assert.deepEqual(await blockedCreate.json(), { error: 'BUDGET_UNAVAILABLE' });
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

test('same D fixture records local resource use without changing results', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    assert.equal(await (await budgetFor(f)).consumeWorkerRequest(), true);
    const { p, auth, tokens } = await f.link(), state = await stateFor(f, p.project), budget = await budgetFor(f);
    const delta = (after: Awaited<ReturnType<typeof state.resourceSnapshotForTest>>, before: typeof after) =>
      Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value - before[key as keyof typeof before]]));
    const beforeBudget = await budget.resourceSnapshotForTest();
    for (let i = 0; i < 10; i++) assert.equal(await budget.consumeWorkerRequest(), true);
    const budgetUse = delta(await budget.resourceSnapshotForTest(), beforeBudget);
    const beforeProject = await state.resourceSnapshotForTest();
    const read = await rpcData(await f.rpc(tokens.access_token, 'tools/call', { name: 'getproject', arguments: {} })) as
      { result: { content: Array<{ text: string }> } };
    assert.deepEqual(JSON.parse(read.result.content[0].text).metadata, metadata);
    const projectUse = delta(await state.resourceSnapshotForTest(), beforeProject);
    const beforeTicket = await state.resourceSnapshotForTest();
    assert.equal(await state.registerWakeTicket(auth, 'e'.repeat(64), Date.now() + 30_000), true);
    const ticketUse = delta(await state.resourceSnapshotForTest(), beforeTicket);
    // Frozen baseline 861b28b, identical local fixture: budget 50/50/10,
    // getproject 4/4/0 + 2 RPC, ticket 2/2/3 (SQL/read/write).
    assert.deepEqual(budgetUse, { statements: 40, rowsRead: 40, rowsWritten: 10, projectCalls: 0 });
    assert.deepEqual(projectUse, { statements: 4, rowsRead: 4, rowsWritten: 0, projectCalls: 2 });
    assert.deepEqual(ticketUse, { statements: 2, rowsRead: 2, rowsWritten: 2, projectCalls: 0 });
    console.log('local-d-resource-fixture', JSON.stringify({ budgetUse, projectUse, ticketUse }));
    assert.equal((await budget.budgetSnapshotForTest())?.project_creations, 1);
    assert.equal(await state.revoke(auth), true);
    const denied = await rpcData(await f.rpc(tokens.access_token, 'tools/call', { name: 'getproject', arguments: {} })) as
      { result: { isError: boolean; content: Array<{ text: string }> } };
    assert.equal(denied.result.isError, true);
    assert.equal(denied.result.content[0].text, 'PROJECT_EXPIRED_OR_REVOKED');
  } finally { await f.mf.dispose(); }
});

test('D restored contract: revoke after first authority read returns successful null, no later mutation', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    const { p, auth, tokens } = await f.link(), state = await stateFor(f, p.project);
    const before = await state.resourceSnapshotForTest();
    await state.revokeAfterNextProjectReadForTest(auth);
    const response = await f.rpc(tokens.access_token, 'tools/call', { name: 'getproject', arguments: {} });
    assert.equal(response.status, 200);
    const raced = await rpcData(response) as { result: { isError?: boolean; content: Array<{ text: string }> } };
    assert.equal(raced.result.isError, undefined);
    assert.equal(raced.result.content[0].text, 'null');
    assert.equal(JSON.parse(raced.result.content[0].text), null);
    assert.equal((await state.resourceSnapshotForTest()).projectCalls - before.projectCalls, 2);
    const tombstone = await state.inspectForTest();
    assert.equal(tombstone.project.revoked, 1);
    assert.equal(tombstone.project.metadata, '{}', 'real super.revoke cleared authority before response');
    for (const params of [{ name: 'getproject', arguments: {} }, { name: 'cut', arguments: {
      operationId: 'after-read-revoke', generation: 1, version: 1, clips: [{ start: 2, end: 4 }],
    } }]) {
      const denied = await rpcData(await f.rpc(tokens.access_token, 'tools/call', params)) as
        { result: { isError: boolean; content: Array<{ text: string }> } };
      assert.equal(denied.result.isError, true);
      assert.equal(denied.result.content[0].text, 'PROJECT_EXPIRED_OR_REVOKED');
    }
    assert.equal(await state.admit(auth, { kind: 'cut', operationId: 'direct-after-revoke',
      generation: 1, version: 1, clips: [{ start: 2, end: 4 }] }), null);
    assert.deepEqual((await state.inspectForTest()).commands, []);
    console.log('local-d-read-revoke-contract', JSON.stringify({ current: 'OBSERVED LOCAL successful JSON null',
      projectCalls: 2, nextRead: 'denied', subsequentMutation: 'denied', queuedCommands: 0,
      classification: 'pre-PR73 second-read contract restored; not a security bug claim' }));
  } finally { await f.mf.dispose(); }
});

test('D restored contract: second project RPC failure returns COMMAND_REJECTED and does not reuse metadata', { timeout: 30_000 }, async () => {
  const f = await world();
  try {
    const { p, tokens } = await f.link(), state = await stateFor(f, p.project);
    const before = await state.resourceSnapshotForTest();
    await state.failSecondProjectReadForTest();
    const response = await f.rpc(tokens.access_token, 'tools/call', { name: 'getproject', arguments: {} });
    assert.equal(response.status, 200);
    const failed = await rpcData(response) as { result: { isError: boolean; content: Array<{ text: string }> } };
    assert.equal(failed.result.isError, true);
    assert.equal(failed.result.content[0].text, 'COMMAND_REJECTED');
    assert.equal((await state.resourceSnapshotForTest()).projectCalls - before.projectCalls, 2);
    const recovered = await rpcData(await f.rpc(tokens.access_token, 'tools/call', { name: 'getproject', arguments: {} })) as
      { result: { isError?: boolean; content: Array<{ text: string }> } };
    assert.equal(recovered.result.isError, undefined);
    assert.deepEqual(JSON.parse(recovered.result.content[0].text), { metadata, expiresAt: p.expiresAt });
    assert.deepEqual((await state.inspectForTest()).commands, []);
    console.log('local-d-second-read-failure', JSON.stringify({ error: 'COMMAND_REJECTED',
      projectCalls: 2, nextRead: 'successful fresh metadata', queuedCommands: 0 }));
  } finally { await f.mf.dispose(); }
});

test('legacy ticket index upgrade and rollback retain existing authority and one-use tickets', { timeout: 30_000 }, async () => {
  const candidate = bundle.outputFiles[0].text;
  // Only reverse the index DDL, not runtime auth/expiry behavior, for the legacy schema fixture.
  const legacy = candidate.replace('DROP INDEX IF EXISTS route_tickets_expiry',
    'CREATE INDEX IF NOT EXISTS route_tickets_expiry ON route_tickets(expires_at)');
  assert.notEqual(legacy, candidate);
  const f = await world('true', legacy);
  try {
    const p = await f.project(), auth = { project: p.project, epoch: p.epoch, credential: p.credential };
    const join = await f.json('/remote/bridge/join', { auth });
    assert.equal(join.status, 200);
    const { proof } = await join.json() as { proof: string };
    let state = await stateFor(f, p.project);
    assert.ok((await state.ticketIndexNamesForTest()).includes('route_tickets_expiry'));
    const snapshot = async () => JSON.parse(JSON.stringify(await state.inspectForTest()));
    const before = await snapshot();
    await f.reloadScript(candidate);
    state = await stateFor(f, p.project);
    assert.equal((await state.ticketIndexNamesForTest()).includes('route_tickets_expiry'), false);
    assert.deepEqual(await snapshot(), before, 'upgrade changes only the index, not rows or alarm');
    await f.reloadScript(legacy);
    state = await stateFor(f, p.project);
    assert.ok((await state.ticketIndexNamesForTest()).includes('route_tickets_expiry'));
    assert.deepEqual(await snapshot(), before, 'rollback recreates the index without restoring data');
    await f.reloadScript(candidate);
    const socket = () => f.request(`/remote/bridge/${p.project}/${p.epoch}`, { headers: {
      Origin: origin, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `video-scissors-wakeup.v1, join.${proof}`,
    } });
    assert.equal((await socket()).status, 101, 'pre-upgrade ticket still works');
    assert.equal((await socket()).status, 401, 'ticket remains single-use');
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
    const wrongSync = await state.sync(wrong, { ...metadata, duration: 29 });
    assert.equal(wrongSync.ok, false);
    assert.equal(wrongSync.consented, false);
    assert.deepEqual(await (await f.json('/remote/sync', { auth: wrong, metadata: { ...metadata, duration: 29 } })).json(), { ok: false, consented: false });
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
    const firstSync = await state.sync(auth, latest);
    assert.equal(firstSync.ok, true);
    assert.equal(firstSync.consented, true);
    const undo = (operationId: string, generation: number, version: number, targetOperationId: string) =>
      ({ kind: 'undo', operationId, generation, version, targetOperationId });
    assert.equal(await state.admit({ project: auth.project, epoch: auth.epoch }, undo('undo-wrong-target', 1, 1, 'cut-old')), null);
    assert.equal(await state.admit({ project: auth.project, epoch: auth.epoch }, undo('undo-wrong-generation', 0, 1, 'cut-latest')), null);
    assert.equal(await state.admit({ project: auth.project, epoch: auth.epoch }, undo('undo-wrong-version', 1, 0, 'cut-latest')), null);
    assert.equal((await state.admit({ project: auth.project, epoch: auth.epoch }, undo('undo-superseded', 1, 1, 'cut-latest'))).state, 'queued');

    // Keep generation/version constant deliberately: claim must still fence
    // against the authoritative latest Undo target, not trust the queued one.
    const replacedTarget = { ...latest, latestOperationId: 'cut-newest' };
    const replacedSync = await state.sync(auth, replacedTarget);
    assert.equal(replacedSync.ok, true);
    assert.equal(replacedSync.consented, true);
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
    assert.deepEqual(await (await f.json('/remote/sync', { auth: forged, metadata })).json(), { ok: false, consented: false },
      'browser-supplied project does not select or authorize a DO');
  } finally { await f.mf.dispose(); }
});

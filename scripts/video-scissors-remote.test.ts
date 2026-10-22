import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VideoScissorsController, type VideoScissorsRenderer } from '../lib/video-scissors.ts';
import { VideoScissorsRemoteAdapter, parseRemoteCommand, type RemoteCommand, type RemoteTransport } from '../lib/video-scissors-remote.ts';
import { VideoScissorsRemoteBrowser } from '../lib/video-scissors-remote-browser.ts';

async function fixture(render?: VideoScissorsRenderer['render']) {
  let count = 0;
  const controller = new VideoScissorsController({
    renderer: { inspect: async () => ({ duration: 30, width: 64, height: 64, framesPerSecond: 10, videoCodec: 'h264', audioCodec: 'aac' }),
      render: render ?? (async () => { count++; return new Blob(['synthetic']); }) },
    createObjectURL: () => 'blob:synthetic', revokeObjectURL: () => {},
  });
  await controller.selectSource(Object.assign(new Blob(['synthetic']), { name: 'private-name-never-forward.mp4', lastModified: 0 }) as File);
  let incoming: RemoteCommand | null = null, cancel = false, reports = 0;
  const transport: RemoteTransport = {
    claim: async () => { const next = incoming; incoming = null; return next; },
    report: async () => { reports++; }, cancellation: async () => cancel, revoke: async () => {}, publish: async () => {},
  };
  const adapter = new VideoScissorsRemoteAdapter(controller, transport);
  const cmd = (operationId: string): RemoteCommand => ({ operationId, generation: adapter.metadata().generation,
    version: adapter.metadata().version, kind: 'cut', clips: [{ start: 1, end: 2 }] });
  return { adapter, controller, transport, cmd, count: () => count, reports: () => reports,
    enqueue: (c: RemoteCommand) => { incoming = c; }, cancel: () => { cancel = true; } };
}

test('preset command is allowlisted, private data is rejected and duplicate delivery computes once', async () => {
  const f = await fixture();
  const command = { operationId: 'cover', generation: f.adapter.metadata().generation, version: f.adapter.metadata().version, kind: 'cover', presetId: 'ocean-gradient' };
  assert.throws(() => parseRemoteCommand({ ...command, presetId: 'unknown' }));
  for (const key of ['fileName','title','path','media','frame','blob']) assert.throws(() => parseRemoteCommand({ ...command, [key]: 'PRIVATE' }));
  const first = f.adapter.execute(command);
  assert.equal(f.adapter.execute(command), first);
  assert.equal((await first).status, 'completed'); assert.equal(f.count(), 1);
  assert.equal(f.controller.getSnapshot().coverPresetId, 'ocean-gradient');
  assert.doesNotMatch(JSON.stringify(f.adapter.metadata()), /private-name|ocean-gradient|fileName|title/);
  await assert.rejects(f.adapter.execute({ ...command, presetId: 'sunrise' }), /ID_CONFLICT/);
  assert.equal((await f.adapter.localUndo('undo-cover')).status, 'completed');
  assert.equal(f.controller.getSnapshot().coverPresetId, null);
  assert.equal(f.controller.getSnapshot().hasOutput, false);
  await f.adapter.dispose(); f.controller.dispose();
});

class TestWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static readonly instances: TestWebSocket[] = [];
  readyState = TestWebSocket.CONNECTING;
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  onclose: ((event: CloseEvent) => unknown) | null = null;

  constructor(_url: string | URL, _protocols?: string | string[]) {
    super();
    TestWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState !== TestWebSocket.CONNECTING) return;
      this.readyState = TestWebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
    });
  }

  wake(): void { this.onmessage?.(new MessageEvent('message', { data: 'wake' })); }
  close(): void {
    if (this.readyState === TestWebSocket.CLOSED) return;
    this.readyState = TestWebSocket.CLOSED;
    const event = new Event('close') as CloseEvent;
    this.dispatchEvent(event);
    this.onclose?.(event);
  }
}

function installFakeBrowserGlobals(): () => void {
  const webSocketDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  TestWebSocket.instances.length = 0;
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: TestWebSocket });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://cut.example/tools/video-scissors' } });
  return () => {
    if (webSocketDescriptor) Object.defineProperty(globalThis, 'WebSocket', webSocketDescriptor);
    else Reflect.deleteProperty(globalThis, 'WebSocket');
    if (locationDescriptor) Object.defineProperty(globalThis, 'location', locationDescriptor);
    else Reflect.deleteProperty(globalThis, 'location');
    TestWebSocket.instances.length = 0;
  };
}

async function waitFor(predicate: () => boolean, description: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for ' + description);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const pause = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

test('adapter validates entire plan before mutation and strips all private metadata', async () => {
  const f = await fixture();
  try {
    const before = f.controller.getSnapshot();
    assert.equal((await f.adapter.execute({ ...f.cmd('bad'), clips: [{ start: 1, end: 2 }, { start: 2, end: 90 }] })).status, 'failed');
    assert.strictEqual(f.controller.getSnapshot(), before);
    assert.deepEqual(Object.keys(f.adapter.metadata()).sort(), ['duration','generation','version','hasOutput','canUndo','latestOperationId','errorCode'].sort());
    assert.doesNotMatch(JSON.stringify(f.adapter.metadata()), /private-name|blob:|fileName|path/);
    assert.equal((await f.adapter.execute(f.cmd('valid'))).status, 'completed');
    assert.equal(f.count(), 1);
  } finally { await f.adapter.dispose(); f.controller.dispose(); }
});

test('local invalid ranges use existing visible controller error without crash or preview/history loss; remote rejection unchanged', async () => {
  const f=await fixture();
  try {
    await f.adapter.localCut('good-preview',[{start:0,end:2}]);
    const preview=f.controller.getSnapshot().previewUrl;
    for(const [index,clips] of [[{start:0,end:31}],[{start:-1,end:2}],[{start:3,end:2}]].entries()) {
      assert.equal((await f.adapter.localCut('invalid-'+index,clips)).status,'failed');
      const s=f.controller.getSnapshot();
      assert.ok(s.error);assert.equal(s.previewUrl,preview);assert.equal(s.hasOutput,true);
      assert.equal(s.canUndo,true);assert.equal(f.adapter.metadata().latestOperationId,'good-preview');
    }
    assert.equal(f.count(),1);
    const before=f.controller.getSnapshot();
    assert.equal((await f.adapter.execute({...f.cmd('remote-range'),clips:[{start:0,end:31}]})).status,'failed');
    assert.strictEqual(f.controller.getSnapshot(),before);
    assert.throws(()=>f.adapter.execute({...f.cmd('remote-reversed'),clips:[{start:3,end:2}]}));
    assert.strictEqual(f.controller.getSnapshot(),before);
  } finally {await f.adapter.dispose();f.controller.dispose();}
});
test('adapter ID/payload dedup, stale command and UI cut/Undo target share one history', async () => {
  const f = await fixture();
  try {
    const c = f.cmd('one');
    await f.adapter.execute(c); await f.adapter.execute(c);
    assert.equal(f.count(), 1);
    await assert.rejects(f.adapter.execute({ ...c, clips: [{ start: 3, end: 4 }] }), /ID_CONFLICT/);
    assert.equal((await f.adapter.execute({ ...c, operationId: 'stale' })).status, 'stale');
    await f.adapter.localCut('ui-cut', [{ start: 2, end: 3 }]);
    const m = f.adapter.metadata();
    assert.equal(m.latestOperationId, 'ui-cut');
    assert.equal((await f.adapter.execute({ kind: 'undo', operationId: 'wrong-undo', generation: m.generation, version: m.version, targetOperationId: 'one' })).status, 'stale');
    assert.equal((await f.adapter.localUndo('ui-undo')).status, 'completed');
    assert.equal(f.adapter.metadata().latestOperationId, 'ui-undo');
  } finally { await f.adapter.dispose(); f.controller.dispose(); }
});
test('independent cancellation poll reaches pending render; late render cannot complete', async () => {
  let finish!: (value: Blob) => void;
  const pending = new Promise<Blob>(resolve => { finish = resolve; });
  const f = await fixture(async () => pending);
  try {
    f.enqueue(f.cmd('pending'));
    const task = f.adapter.pollOnce();
    await new Promise(resolve => setImmediate(resolve));
    f.cancel(); await f.adapter.pollCancellation();
    assert.equal(f.controller.getOperationStatus('pending'), 'cancelled');
    finish(new Blob(['late'])); await task;
    assert.equal(f.reports(), 1); assert.equal(f.controller.getSnapshot().hasOutput, false);
  } finally { await f.adapter.dispose(); f.controller.dispose(); }
});
test('uncertain report does not replay; silent controller cut no-op is not completed', async () => {
  const f = await fixture();
  try {
    const c = f.cmd('uncertain'); f.enqueue(c);
    f.transport.report = async () => { throw new Error('connection-lost'); };
    await assert.rejects(f.adapter.pollOnce(), /connection-lost/);
    await f.adapter.execute(c); assert.equal(f.count(), 1);
    // Controller accepted an operation outside adapter: same ID must not be
    // reported as a fresh success just because its promise resolves silently.
    await f.controller.cut({ operationId: 'outside', sourceGeneration: f.adapter.metadata().generation, version: f.adapter.metadata().version });
    assert.equal((await f.adapter.execute(f.cmd('outside'))).status, 'stale');
  } finally { await f.adapter.dispose(); f.controller.dispose(); }
});

test('new original source invalidates the adapter latest target and disposed adapter cannot execute', async () => {
  const f = await fixture();
  try {
    await f.adapter.localCut('first', [{ start: 0, end: 2 }]);
    await f.controller.selectSource(Object.assign(new Blob(['new-synthetic']), { name: 'new.mp4', lastModified: 0 }) as File, 'replacement');
    assert.equal(f.adapter.metadata().latestOperationId, null);
    assert.equal((await f.adapter.localUndo('old-target')).status, 'stale');
    const next = f.cmd('after-dispose');
    await f.adapter.dispose();
    assert.equal((await f.adapter.execute(next)).status, 'stale');
  } finally { f.controller.dispose(); }
});

test('UI plan changes publish while a poll is outstanding; completion publishes latest Undo target', async () => {
  const f = await fixture();
  const published: ReturnType<typeof f.adapter.metadata>[] = [];
  let deliver!: (c: RemoteCommand) => void;
  let reported = '';
  f.transport.publish = async m => { published.push({ ...m }); };
  f.transport.claim = () => new Promise(resolve => { deliver = resolve; });
  f.transport.report = async (_id, result) => { reported = result.status; };
  try {
    const old = f.cmd('delayed');
    const task = f.adapter.pollOnce();
    await new Promise(resolve => setImmediate(resolve));
    f.controller.setSegments([{ start: 3, end: 4 }]);
    await f.adapter.flushMetadata();
    assert.equal(published.at(-1)?.version, f.controller.getSnapshot().version);
    deliver(old); await task;
    assert.equal(reported, 'stale');
    assert.deepEqual(f.controller.getSnapshot().segments, [{ start: 3, end: 4 }]);
    await f.adapter.localCut('ui-complete', [{ start: 4, end: 5 }]);
    await f.adapter.flushMetadata();
    assert.equal(published.at(-1)?.latestOperationId, 'ui-complete');
    assert.equal(published.at(-1)?.canUndo, true);
    assert.ok(published.filter(m => m.hasOutput).every(m => m.latestOperationId === 'ui-complete'));
    await f.adapter.localUndo('ui-undo-complete');
    await f.adapter.flushMetadata();
    assert.equal(published.at(-1)?.latestOperationId, 'ui-undo-complete');
    assert.equal(published.at(-1)?.version, f.controller.getSnapshot().version);
  } finally { await f.adapter.dispose(); f.controller.dispose(); }
});

test('lost terminal ACK before/after commit retries result only before next claim; local controls survive disconnect', async () => {
  for (const committedBeforeLoss of [false, true]) {
    const f = await fixture();
    const server = new Map<string, string>();
    let calls = 0, claims = 0;
    const claim = f.transport.claim;
    f.transport.claim = async (m, signal) => { claims++; return claim(m, signal); };
    f.transport.report = async (id, result) => {
      calls++;
      const payload = JSON.stringify(result);
      if (calls === 1) {
        if (committedBeforeLoss) server.set(id, payload);
        throw new Error('ACK_LOST');
      }
      if (server.has(id)) assert.equal(server.get(id), payload);
      server.set(id, payload);
    };
    try {
      f.enqueue(f.cmd('first'));
      await assert.rejects(f.adapter.pollOnce(), /ACK_LOST/);
      assert.equal(f.count(), 1);
      // Another outage retries only the pending result, never another claim.
      const report = f.transport.report;
      f.transport.publish = async () => { throw new Error('DISCONNECTED'); };
      await f.adapter.localCut('offline-cut', [{ start: 2, end: 3 }]);
      await f.adapter.localUndo('offline-undo');
      assert.equal(f.adapter.metadata().latestOperationId, 'offline-undo');
      assert.equal(claims, 1);
      f.transport.publish = async () => {};
      f.enqueue(f.cmd('next'));
      await f.adapter.pollOnce();
      assert.equal(f.count(), 3, 'first, local cut and next cut each compute once');
      assert.equal(server.size, 2);
      assert.equal(calls, 3);
      assert.equal(claims, 2);
      f.transport.report = report;
    } finally { await f.adapter.dispose(); f.controller.dispose(); }
  }
});

test('late project creation after Disconnect is revoked with its original binding, never adopted', async () => {
  const f = await fixture();
  let finish!: (response: Response) => void;
  const calls: {path: string; body: unknown}[] = [];
  const remote = new VideoScissorsRemoteBrowser(f.controller, async (input, init) => {
    const path=String(input); calls.push({path,body:init?.body ? JSON.parse(String(init.body)) : null});
    if(path==='/remote/capabilities') return Response.json({enabled:true,wakeup:'poll'});
    if(path==='/remote/projects') return new Promise(resolve=>{finish=resolve;});
    assert.equal(path,'/remote/revoke');return Response.json({ok:true});
  });
  try {
    const pending=remote.connect();
    await new Promise(resolve=>setImmediate(resolve)); // Let capability negotiation reach the deferred project request.
    await remote.disconnect();
    finish(Response.json({project:'old-project',epoch:1,credential:'synthetic-credential',proof:'synthetic-proof',proofExpiresAt:Date.now()+300000,expiresAt:Date.now()+1800000}));
    await pending;
    assert.equal(remote.snapshot().state,'disconnected');
    assert.equal(remote.snapshot().pairingProof,null);
    assert.deepEqual(calls.map(c=>c.path),['/remote/capabilities','/remote/projects','/remote/revoke']);
    assert.deepEqual(calls[2].body,{auth:{project:'old-project',epoch:1,credential:'synthetic-credential'}});
  } finally { await remote.dispose();await f.adapter.dispose();f.controller.dispose(); }
});

test('offline component teardown aborts poll and subscriptions without a retry/tight loop or server-revoke claim', async () => {
  const f=await fixture();let requests=0,subscriptions=0,aborted=false,revokeAttempts=0;
  const subscribe=f.controller.subscribe;
  f.controller.subscribe=listener=>{subscriptions++;const stop=subscribe(listener);return()=>{subscriptions--;stop();};};
  const remote=new VideoScissorsRemoteBrowser(f.controller,async(input,init)=>{
    requests++;
    if(input==='/remote/capabilities')return Response.json({enabled:true,wakeup:'poll'});
    if(input==='/remote/projects')return Response.json({project:'local-fixture',epoch:1,credential:'synthetic',proof:'synthetic',proofExpiresAt:Date.now()+300000,expiresAt:Date.now()+1800000});
    if(input==='/remote/sync')return Response.json({ok:true});
    if(input==='/remote/revoke'){revokeAttempts++;throw Error('OFFLINE');}
    assert.equal(input,'/remote/poll');
    return new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>{aborted=true;reject(Error('ABORTED'));},{once:true}));
  });
  await remote.connect();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(subscriptions,2);
  await remote.dispose();
  const stoppedCount=requests;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests,stoppedCount);assert.equal(aborted,true);assert.equal(revokeAttempts,1);
  assert.equal(subscriptions,0);assert.equal(remote.snapshot().pairingProof,null);
  assert.equal(remote.snapshot().state,'disconnected','local teardown only, not evidence of a remote fence');
  await remote.connect();assert.equal(requests,stoppedCount,'disposed owner cannot restart');
  await f.adapter.dispose();f.controller.dispose();
});

test('DO wake keeps one bounded catch-up after transient sync/claim failures', { timeout: 45_000 }, async () => {
  const restoreBrowserGlobals = installFakeBrowserGlobals();
  try {
    for (const scenario of ['sync-once', 'claim-once', 'claim-always'] as const) {
      TestWebSocket.instances.length = 0;
      const f = await fixture();
      const leaseExpiresAt = Date.now() + 30 * 60_000;
      let syncCalls = 0, claimCalls = 0;
      const remote = new VideoScissorsRemoteBrowser(f.controller, async input => {
        const path = String(input);
        if (path === '/remote/capabilities') return Response.json({ enabled: true, wakeup: 'websocket' });
        if (path === '/remote/projects') return Response.json({ project: 'synthetic-project', epoch: 1, credential: 'synthetic',
          proof: 'synthetic-proof', proofExpiresAt: Date.now() + 60_000, expiresAt: leaseExpiresAt });
        if (path === '/remote/bridge/join') return Response.json({ proof: 'a'.repeat(64), expiresAt: Math.min(Date.now() + 60_000, leaseExpiresAt) });
        if (path === '/remote/sync') {
          syncCalls++;
          if (scenario === 'sync-once' && syncCalls === 1) return new Response('{}', { status: 503 });
          return Response.json({ ok: true });
        }
        if (path === '/remote/claim') {
          claimCalls++;
          if (scenario === 'claim-always' || (scenario === 'claim-once' && claimCalls === 1)) return new Response('{}', { status: 503 });
          return Response.json({ command: null });
        }
        if (path === '/remote/revoke') return Response.json({ ok: true });
        throw new Error('Unexpected request: ' + path);
      });
      try {
        await remote.connect();
        await waitFor(() => TestWebSocket.instances.length === 1 && TestWebSocket.instances[0].readyState === TestWebSocket.OPEN, 'bridge socket open');
        const socket = TestWebSocket.instances[0];
        socket.wake();
        const expectedClaims = scenario === 'sync-once' ? 1 : scenario === 'claim-once' ? 2 : 2;
        await waitFor(() => claimCalls >= expectedClaims, 'bounded catch-up claim');
        if (scenario === 'claim-always') await pause(3_100);
        else await pause(50);
        assert.equal(claimCalls, expectedClaims, scenario + ' claim count');
        assert.equal(syncCalls, scenario === 'sync-once' ? 2 : 1, scenario + ' sync count');
        assert.equal(f.count(), 0, 'failed catch-up never starts or replays compute');
      } finally {
        await remote.disconnect();
        await remote.dispose();
        await f.adapter.dispose();
        f.controller.dispose();
      }
    }
  } finally { restoreBrowserGlobals(); }
});

test('DO wake committed between claim and response is checked when remote execution starts', { timeout: 15_000 }, async () => {
  const restoreBrowserGlobals = installFakeBrowserGlobals();
  let finishRender!: (value: Blob) => void;
  const pendingRender = new Promise<Blob>(resolve => { finishRender = resolve; });
  let renderCalls = 0;
  const f = await fixture(async () => { renderCalls++; return pendingRender; });
  let socket: TestWebSocket | undefined;
  let cancellationCommitted = false, cancellationCalls = 0, reportCalls = 0;
  const leaseExpiresAt = Date.now() + 30 * 60_000;
  const remote = new VideoScissorsRemoteBrowser(f.controller, async input => {
    const path = String(input);
    if (path === '/remote/capabilities') return Response.json({ enabled: true, wakeup: 'websocket' });
    if (path === '/remote/projects') return Response.json({ project: 'synthetic-project', epoch: 1, credential: 'synthetic',
      proof: 'synthetic-proof', proofExpiresAt: Date.now() + 60_000, expiresAt: leaseExpiresAt });
    if (path === '/remote/bridge/join') return Response.json({ proof: 'b'.repeat(64), expiresAt: Math.min(Date.now() + 60_000, leaseExpiresAt) });
    if (path === '/remote/sync') return Response.json({ ok: true });
    if (path === '/remote/claim') {
      cancellationCommitted = true;
      socket?.wake();
      await Promise.resolve();
      assert.equal(cancellationCalls, 0, 'the pre-response wake arrives before an operation is active');
      return Response.json({ command: f.cmd('cancel-before-claim-response') });
    }
    if (path === '/remote/cancellation') {
      cancellationCalls++;
      return Response.json({ stop: cancellationCommitted });
    }
    if (path === '/remote/report') { reportCalls++; return Response.json({ ok: true }); }
    if (path === '/remote/revoke') return Response.json({ ok: true });
    throw new Error('Unexpected request: ' + path);
  });
  try {
    await remote.connect();
    await waitFor(() => TestWebSocket.instances.length === 1 && TestWebSocket.instances[0].readyState === TestWebSocket.OPEN, 'bridge socket open');
    socket = TestWebSocket.instances[0];
    socket.wake();
    await waitFor(() => cancellationCalls === 1 && f.controller.getOperationStatus('cancel-before-claim-response') === 'cancelled', 'initial cancellation check');
    assert.equal(renderCalls, 1);
    assert.equal(f.controller.getSnapshot().hasOutput, false);
    finishRender(new Blob(['late synthetic render']));
    await waitFor(() => reportCalls === 1, 'cancelled result acknowledgement');
    assert.equal(renderCalls, 1, 'the claimed command is computed once');
    assert.equal(f.controller.getOperationStatus('cancel-before-claim-response'), 'cancelled');
  } finally {
    await remote.disconnect();
    await remote.dispose();
    await f.adapter.dispose();
    f.controller.dispose();
    restoreBrowserGlobals();
  }
});

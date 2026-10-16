import { Mailbox, type BrowserAuth } from './mailbox';
import { boundedBody, exactObject, sameOrigin, reply } from './http';

const BRIDGE_PROTOCOL = 'video-scissors-wakeup.v1';
type BridgeStub = {
  mintJoinProof(project: string, epoch: number): Promise<{proof: string; expiresAt: number} | null>;
  consumeJoinProof(project: string, epoch: number, proof: string): Promise<boolean>;
  notify(project: string, epoch: number): Promise<void>;
  closeProject(project: string, epoch: number): Promise<number>;
  fetch(request: Request): Promise<Response>;
};
export type BridgeNamespace = { idFromName(name: string): unknown; get(id: unknown): unknown };
const bridgeStub = (bridge: BridgeNamespace, project: string) =>
  bridge.get(bridge.idFromName(project)) as BridgeStub;
const browserAuth = (value: unknown): BrowserAuth | null => {
  try {
    const a = exactObject(value, ['project','epoch','credential']);
    if (typeof a.project !== 'string' || !/^[a-f0-9-]{36}$/.test(a.project) || !Number.isSafeInteger(a.epoch) ||
      typeof a.credential !== 'string' || !/^[a-f0-9]{64}$/.test(a.credential)) return null;
    return { project: a.project, epoch: Number(a.epoch), credential: a.credential };
  } catch { return null; }
};

export async function browserRoute(request: Request, mailbox: Mailbox, bridge?: BridgeNamespace): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/remote/capabilities' && request.method === 'GET') return reply({ enabled: true, wakeup: bridge ? 'websocket' : 'poll' });
  if (path === '/remote/bridge/join') {
    if (!bridge) return reply({ error: 'NOT_FOUND' }, 404);
    if (request.method !== 'POST' || !sameOrigin(request) || !request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'ORIGIN_OR_METHOD' }, 403);
    const body = exactObject(JSON.parse(await boundedBody(request, 1024)), ['auth']);
    const auth = browserAuth(body.auth);
    if (!auth || !await mailbox.bridgeOwner(auth)) return reply({ error: 'AUTH' }, 401);
    const minted = await bridgeStub(bridge, auth.project).mintJoinProof(auth.project, auth.epoch);
    return minted ? reply(minted) : reply({ error: 'EXPIRED_OR_REVOKED' }, 410);
  }
  const socket = /^\/remote\/bridge\/([a-f0-9-]{36})\/(\d+)$/.exec(path);
  if (socket) {
    if (!bridge) return reply({ error: 'NOT_FOUND' }, 404);
    if (request.method !== 'GET' || !sameOrigin(request) || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return reply({ error: 'ORIGIN_OR_METHOD' }, 403);
    const epoch = Number(socket[2]), project = socket[1];
    if (!Number.isSafeInteger(epoch) || !await mailbox.bridgeLease({ project, epoch })) return reply({ error: 'EXPIRED_OR_REVOKED' }, 410);
    const protocols = request.headers.get('sec-websocket-protocol')?.split(',').map(value => value.trim()) ?? [];
    const proof = protocols.find(value => value.startsWith('join.'))?.slice(5) ?? '';
    if (protocols.length !== 2 || !protocols.includes(BRIDGE_PROTOCOL) || !/^[a-f0-9]{64}$/.test(proof)) return reply({ error: 'JOIN_PROOF' }, 401);
    const stub = bridgeStub(bridge, project);
    if (!await stub.consumeJoinProof(project, epoch, proof)) return reply({ error: 'JOIN_PROOF' }, 401);
    // The proof is removed before forwarding; the DO sees only its fixed protocol.
    const headers = new Headers(request.headers);
    headers.set('Sec-WebSocket-Protocol', BRIDGE_PROTOCOL);
    return stub.fetch(new Request(request, { headers }));
  }
  if (request.method !== 'POST' || !sameOrigin(request) || !request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'ORIGIN_OR_METHOD' }, 403);
  const b = exactObject(JSON.parse(await boundedBody(request)), ['auth','metadata','operationId','state']);
  if (path === '/remote/projects') {
    exactObject(b, []);
    const created = await mailbox.create();
    return reply({ ...created, proofExpiresAt: Date.now() + 300_000, expiresAt: Date.now() + 1_800_000 });
  }
  const auth = browserAuth(b.auth);
  if (!auth) return reply({ error: 'AUTH' }, 401);
  if (path === '/remote/sync') return reply({ ok: await mailbox.sync(auth, b.metadata) });
  if (path === '/remote/poll') return reply(await mailbox.poll(auth, b.metadata, request.signal));
  if (path === '/remote/claim' && bridge) return reply({ command: await mailbox.claim(auth, b.metadata), refresh: false });
  if (path === '/remote/revoke') {
    const ok = await mailbox.revoke(auth);
    const closedSockets = ok && bridge ? await bridgeStub(bridge, auth.project).closeProject(auth.project, auth.epoch) : 0;
    return reply({ ok, ...(bridge ? { closedSockets } : {}) });
  }
  if (typeof b.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(b.operationId)) return reply({ error: 'OPERATION' }, 400);
  if (path === '/remote/report' && typeof b.state === 'string') return reply({ ok: await mailbox.report(auth, b.operationId, b.state, b.metadata) });
  if (path === '/remote/cancellation') return reply({ stop: bridge
    ? await mailbox.cancellation(auth, b.operationId)
    : await mailbox.cancellationPoll(auth, b.operationId, request.signal) });
  return reply({ error: 'NOT_FOUND' }, 404);
}

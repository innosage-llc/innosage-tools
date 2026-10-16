import { Mailbox, type BrowserAuth } from './mailbox';
import { boundedBody, exactObject, sameOrigin, reply } from './http';

export async function browserRoute(request: Request, mailbox: Mailbox): Promise<Response> {
  if (new URL(request.url).pathname === '/remote/capabilities' && request.method === 'GET') return reply({ enabled: true });
  if (request.method !== 'POST' || !sameOrigin(request) || !request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'ORIGIN_OR_METHOD' }, 403);
  const path = new URL(request.url).pathname;
  const b = exactObject(JSON.parse(await boundedBody(request)), ['auth','metadata','operationId','state']);
  if (path === '/remote/projects') {
    exactObject(b, []);
    const created = await mailbox.create();
    return reply({ ...created, proofExpiresAt: Date.now() + 300_000, expiresAt: Date.now() + 1_800_000 });
  }
  const a = exactObject(b.auth, ['project','epoch','credential']);
  if (typeof a.project !== 'string' || !/^[a-f0-9-]{36}$/.test(a.project) || !Number.isSafeInteger(a.epoch) ||
    typeof a.credential !== 'string' || !/^[a-f0-9]{64}$/.test(a.credential)) return reply({ error: 'AUTH' }, 401);
  const auth: BrowserAuth = { project: a.project, epoch: Number(a.epoch), credential: a.credential };
  if (path === '/remote/sync') return reply({ ok: await mailbox.sync(auth, b.metadata) });
  if (path === '/remote/poll') return reply(await mailbox.poll(auth, b.metadata, request.signal));
  if (path === '/remote/revoke') return reply({ ok: await mailbox.revoke(auth) });
  if (typeof b.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(b.operationId)) return reply({ error: 'OPERATION' }, 400);
  if (path === '/remote/report' && typeof b.state === 'string') return reply({ ok: await mailbox.report(auth, b.operationId, b.state, b.metadata) });
  if (path === '/remote/cancellation') return reply({ stop: await mailbox.cancellationPoll(auth, b.operationId, request.signal) });
  return reply({ error: 'NOT_FOUND' }, 404);
}

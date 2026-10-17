import { boundedBody, exactObject, reply, sameOrigin } from '../http';
import { projectForCredential, sha256Hex, signConsentTicket, signWakeTicket, verifyConsentTicket, verifyWakeTicket } from './routing';
import type { BrowserAuth, DEnv, ProjectAuth } from './types';

const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
const authFrom = (value: unknown): BrowserAuth | null => {
  try {
    const body = exactObject(value, ['project','epoch','credential']);
    if (typeof body.project !== 'string' || !/^[a-f0-9]{64}$/.test(body.project) || !Number.isSafeInteger(body.epoch) ||
      typeof body.credential !== 'string' || !/^[a-f0-9]{64}$/.test(body.credential)) return null;
    return { project: body.project, epoch: Number(body.epoch), credential: body.credential };
  } catch { return null; }
};
const jsonRequest = (request: Request) => request.method === 'POST' && sameOrigin(request) &&
  request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() === 'application/json';
const wakeStub = (env: DEnv, project: string) => env.PROJECT_STATE.getByName(project);

export async function dBrowserRoute(request: Request, env: DEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/remote/capabilities' && request.method === 'GET') return reply({ enabled: true, wakeup: 'websocket' });
  const socketRoute = /^\/remote\/bridge\/([a-f0-9]{64})\/(\d+)$/.exec(path);
  if (socketRoute) {
    if (request.method !== 'GET' || !sameOrigin(request) || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return reply({ error: 'ORIGIN_OR_METHOD' }, 403);
    const epoch = Number(socketRoute[2]);
    const protocols = request.headers.get('sec-websocket-protocol')?.split(',').map(value => value.trim()) ?? [];
    const ticket = protocols.find(value => value.startsWith('join.'))?.slice(5) ?? '';
    const key = env.D_ROUTING_HMAC_KEY;
    const verified = await verifyWakeTicket(key, socketRoute[1], epoch, ticket);
    if (!verified || protocols.length !== 2 || !protocols.includes('video-scissors-wakeup.v1')) return reply({ error: 'JOIN_PROOF' }, 401);
    // The signed project/epoch selects the DO only. The DO consumes its matching
    // persisted one-time proof before upgrading the socket.
    // Wrangler's generated request/response types differ from the standard
    // Fetch types used by this adapter. This narrow cast preserves the Worker
    // Fetch/WebSocket runtime contract at the binding boundary.
    const socketStub = wakeStub(env, verified.project) as unknown as { fetch(request: Request): Promise<Response> };
    return socketStub.fetch(request);
  }
  if (!jsonRequest(request)) return reply({ error: 'ORIGIN_OR_METHOD' }, 403);
  const body = exactObject(JSON.parse(await boundedBody(request, 16_384)), ['auth','metadata','operationId','state']);

  if (path === '/remote/projects') {
    exactObject(body, []);
    const key = env.D_ROUTING_HMAC_KEY;
    if (!key || !/^[a-f0-9]{64}$/i.test(key)) return reply({ error: 'ROUTING_UNAVAILABLE' }, 503);
    const credential = secret(), project = await projectForCredential(credential), epoch = 1;
    const now = Date.now(), expiresAt = now + 30 * 60_000, proofExpiresAt = Math.min(now + 5 * 60_000, expiresAt);
    const proof = await signConsentTicket(key, project, epoch, proofExpiresAt);
    const stub = wakeStub(env, project);
    if (!await stub.createProject({ project, epoch, ownerHash: project, expiresAt, consentTicket: proof, ticketExpiresAt: proofExpiresAt })) {
      return reply({ error: 'PROJECT_CREATE_FAILED' }, 503);
    }
    return reply({ project, epoch, credential, proof, proofExpiresAt, expiresAt });
  }
  if (path === '/remote/bridge/join') {
    const data = exactObject(body, ['auth']);
    const auth = authFrom(data.auth);
    if (!auth) return reply({ error: 'AUTH' }, 401);
    const routedProject = await projectForCredential(auth.credential), stub = wakeStub(env, routedProject);
    const owner = await stub.owner(auth);
    if (!owner) return reply({ error: 'AUTH' }, 401);
    const key = env.D_ROUTING_HMAC_KEY;
    if (!key || !/^[a-f0-9]{64}$/i.test(key)) return reply({ error: 'ROUTING_UNAVAILABLE' }, 503);
    const expiresAt = Math.min(Date.now() + 60_000, owner.expiresAt);
    const proof = await signWakeTicket(key, routedProject, auth.epoch, expiresAt);
    if (!await stub.registerWakeTicket(auth, proof, expiresAt)) return reply({ error: 'EXPIRED_OR_REVOKED' }, 410);
    return reply({ proof, expiresAt });
  }

  const data = exactObject(body, ['auth','metadata','operationId','state']);
  const auth = authFrom(data.auth);
  if (!auth) return reply({ error: 'AUTH' }, 401);
  // Never route by the caller's project field. DO identity derives only from
  // the private browser credential; ProjectStateDO verifies both fields.
  const routedProject = await projectForCredential(auth.credential), stub = wakeStub(env, routedProject);
  if (path === '/remote/sync') return reply({ ok: await stub.sync(auth, data.metadata) });
  if (path === '/remote/claim') return reply({ command: await stub.claim(auth, data.metadata), refresh: false });
  if (path === '/remote/revoke') {
    const ok = await stub.revoke(auth);
    const closedSockets = ok ? await stub.closeProject(routedProject, auth.epoch) : 0;
    return reply({ ok, closedSockets });
  }
  if (typeof data.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(data.operationId)) return reply({ error: 'OPERATION' }, 400);
  if (path === '/remote/report' && typeof data.state === 'string') return reply({ ok: await stub.report(auth, data.operationId, data.state, data.metadata) });
  if (path === '/remote/cancellation') return reply({ stop: await stub.cancellation(auth, data.operationId) });
  return reply({ error: 'NOT_FOUND' }, 404);
}

export async function consumeConsentTicket(env: DEnv, token: string, handle: string): Promise<ProjectAuth | null> {
  const key = env.D_ROUTING_HMAC_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) return null;
  const ticket = await verifyConsentTicket(key, token);
  if (!ticket) return null;
  return wakeStub(env, ticket.project).bindConsentTicket({ project: ticket.project, epoch: ticket.epoch,
    ticket: token, handleHash: await sha256Hex(handle) });
}

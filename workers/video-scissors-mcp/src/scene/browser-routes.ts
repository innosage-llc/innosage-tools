import { boundedBody, reply, sameOrigin } from '../http';
import { SceneMailbox } from './mailbox';
import { parseSceneAuth, sceneId, sceneJSON, sceneObject, SCENE_LIMITS, type SceneOwner, type SceneState } from '../../../../lib/visual-remix-remote';

// Inactive candidate; same-origin browser ownership is distinct from OAuth.
export async function sceneBrowserRoute(request: Request, store: SceneMailbox): Promise<Response> {
  if (request.method !== 'POST' || !sameOrigin(request) || request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reply({ error: 'ORIGIN_OR_METHOD' }, 403);
  const path = new URL(request.url).pathname;
  const fields: Record<string, string[]> = {
    '/scene/browser/create': ['snapshot','fields','confirmed'],
    '/scene/browser/sync': ['auth','snapshot'], '/scene/browser/poll': ['auth'],
    '/scene/browser/report': ['auth','requestId','state'], '/scene/browser/revoke': ['auth'],
  };
  if (!fields[path]) return reply({ error: 'NOT_FOUND' }, 404);
  const body = sceneObject(JSON.parse(await boundedBody(request)), fields[path]);
  const result = (data: unknown) => new Response(sceneJSON(data, SCENE_LIMITS.wireBytes), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  if (path === '/scene/browser/create') return result(await store.create(body.snapshot, body.fields, body.confirmed));
  const auth = parseSceneAuth(body.auth, true) as SceneOwner;
  // Revoke remains idempotent after the lease was revoked/expired.
  if (path === '/scene/browser/revoke') return result({ ok: await store.revoke(auth) });
  if (!await store.owner(auth)) return reply({ error: 'OWNER_EXPIRED_OR_REVOKED' }, 401);
  if (path === '/scene/browser/sync') return result({ ok: await store.sync(auth, body.snapshot) });
  if (path === '/scene/browser/poll') return result({ command: await store.claim(auth), cancellations: await store.cancellations(auth) });
  return result({ ok: await store.report(auth, sceneId(body.requestId), body.state as SceneState) });
}

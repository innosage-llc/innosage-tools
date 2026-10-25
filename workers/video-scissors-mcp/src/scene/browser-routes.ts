import { REFERENCE_LIMITS } from '../../../../lib/visual-remix-reference';
import { boundedBody, reply, sameOrigin } from '../http';
import { SceneMailbox } from './mailbox';
import { parseSceneAuth, sceneId, sceneJSON, sceneObject, SCENE_LIMITS, type SceneOwner, type SceneState } from '../../../../lib/visual-remix-remote';

// Inactive candidate; same-origin browser ownership is distinct from OAuth.
export async function sceneBrowserRoute(request: Request, store: SceneMailbox, referencesEnabled = false): Promise<Response> {
  if (request.method !== 'POST' || !sameOrigin(request) || request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reply({ error: 'ORIGIN_OR_METHOD' }, 403);
  const path = new URL(request.url).pathname;
  const fields: Record<string, string[]> = {
    '/scene/browser/create': ['snapshot','fields','confirmed'],
    '/scene/browser/sync': ['auth','snapshot'], '/scene/browser/poll': ['auth'],
    '/scene/browser/report': ['auth','requestId','state'], '/scene/browser/revoke': ['auth'],
  };
  if (!fields[path] && path !== '/scene/browser/reference') return reply({ error: 'NOT_FOUND' }, 404);
  if (path === '/scene/browser/reference') {
    if (!referencesEnabled) return reply({error:'REFERENCE_NOT_ENABLED'},503);
    const raw=JSON.parse(await boundedBody(request,REFERENCE_LIMITS.wireBytes));
    const body = sceneObject(raw,['auth','reference',...(raw && Object.hasOwn(raw,'cacheEpoch')?['cacheEpoch']:[])]);
    const auth = parseSceneAuth(body.auth,true) as SceneOwner;
    if (!await store.owner(auth)) return reply({error:'OWNER_EXPIRED_OR_REVOKED'},401);
    return reply({ok:await store.referenceStore().upload(auth,body.reference,body.cacheEpoch)});
  }
  const raw = JSON.parse(await boundedBody(request));
  const keys = [...fields[path],...(path === '/scene/browser/poll' && raw && Object.hasOwn(raw,'cacheEpoch')?['cacheEpoch']:[]),...(path === '/scene/browser/create' && referencesEnabled && raw && Object.hasOwn(raw,'referenceConsent') ? ['referenceConsent'] : []),...(path === '/scene/browser/create' && raw && Object.hasOwn(raw,'leaseMs') ? ['leaseMs'] : []),...(path === '/scene/browser/create' && raw && Object.hasOwn(raw,'lifetime') ? ['lifetime'] : [])];
  const body = sceneObject(raw, keys);
  const result = (data: unknown) => new Response(sceneJSON(data, SCENE_LIMITS.wireBytes), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  if (path === '/scene/browser/create') return result(await store.create(body.snapshot, body.fields, body.confirmed, body.referenceConsent,body.leaseMs,body.lifetime));
  const auth = parseSceneAuth(body.auth, true) as SceneOwner;
  // Revoke remains idempotent after the lease was revoked/expired.
  if (path === '/scene/browser/revoke') return result(await store.revokeOutcome(auth));
  if (!await store.owner(auth)) return reply({ error: 'OWNER_EXPIRED_OR_REVOKED' }, 401);
  if (path === '/scene/browser/sync') return result({ ok: await store.sync(auth, body.snapshot),...await store.cacheState(auth) });
  if (path === '/scene/browser/poll') return result({ command: await store.claim(auth,body.cacheEpoch), cancellations: await store.cancellations(auth), connected: !!await store.lease({purpose:auth.purpose,shareId:auth.shareId,projectId:auth.projectId,generation:auth.generation,epoch:auth.epoch}),...await store.cacheState(auth) });
  return result({ ok: await store.report(auth, sceneId(body.requestId), body.state as SceneState) });
}

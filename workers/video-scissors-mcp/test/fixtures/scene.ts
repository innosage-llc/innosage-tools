// Offline fixture only. Never imported by the active Worker.
import { SceneMailbox } from '../../src/scene/mailbox';
import { SCENE_FIELDS, type SceneAuth, type SceneOwner, type SceneState } from '../../../../lib/visual-remix-remote';
export default { async fetch(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ action: string; leaseMs?: number; lifetime?:unknown; referenceConsent?:unknown; reference:unknown; cacheEpoch?:unknown; auth: SceneOwner; snapshot: unknown; proposal: unknown; id: string; state: SceneState; proof: string; handle: string }>();
  const clock = Number(request.headers.get('x-fixture-time')) || Date.now();
  const store = new SceneMailbox(env.DB, () => clock,request.headers.get('x-fixture-reference')==='true',request.headers.get('x-fixture-until-revoked')==='true');
  try {
    let value: unknown;
    switch (body.action) {
      case 'create': value = await store.create(body.snapshot, SCENE_FIELDS, true,body.referenceConsent,body.leaseMs,body.lifetime); break;
      case 'bind': value = await store.bindFromProof(body.proof, body.handle); break;
      case 'snapshot': value = await store.snapshot(body.auth as SceneAuth); break;
      case 'lease': value = await store.lease(body.auth as SceneAuth); break;
      case 'sync': value = await store.sync(body.auth, body.snapshot); break;
      case 'propose': value = await store.propose(body.auth as SceneAuth, body.proposal); break;
      case 'claim': value = await store.claim(body.auth,body.cacheEpoch); break;
      case 'cancel': value = await store.cancel(body.auth as SceneAuth, body.id); break;
      case 'cancellations': value = await store.cancellations(body.auth); break;
      case 'status': value = await store.status(body.auth as SceneAuth, body.id); break;
      case 'report': value = await store.report(body.auth, body.id, body.state); break;
      case 'revoke': value = await store.revoke(body.auth); break;
      case 'sweep': await store.sweepExpired(); value = true; break;
      case 'spend': await store.spend(); value = true; break;
      case 'cache': value = await store.cacheState(body.auth); break;
      case 'purge': await store.purgeInactiveCache(); value = true; break;
      case 'upload': value = await store.referenceStore().upload(body.auth,body.reference,body.cacheEpoch); break;
      case 'readReference': value = await store.referenceStore().read(body.auth); break;
      default: return Response.json({ error: 'FIXTURE_ACTION' }, { status: 400 });
    }
    return Response.json({ value });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'ERROR' }, { status: 409 }); }
} };

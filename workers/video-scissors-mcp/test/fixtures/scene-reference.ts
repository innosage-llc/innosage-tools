// Local-only fixture. No live entrypoint imports this module.
import { SceneMailbox } from '../../src/scene/mailbox';
import { boundedSceneRpc, sceneMcpHandler } from '../../src/scene/mcp';
import { sceneBrowserRoute } from '../../src/scene/browser-routes';
import { SCENE_FIELDS, SCENE_SCOPES, type SceneOwner, type SceneAuth } from '../../../../lib/visual-remix-remote';
export default { async fetch(request: Request, env: Env) {
        const time = Number(request.headers.get('x-fixture-time')) || Date.now(), enabled = request.headers.get('x-fixture-disabled') !== 'true';
        const store = new SceneMailbox(env.DB, () => time, enabled), url = new URL(request.url);
        if (url.pathname.startsWith('/scene/browser/'))
            return sceneBrowserRoute(request, store, enabled);
        const body = await request.json<{
            action: string;
            leaseMs?: number;
            snapshot: unknown;
            consent: unknown;
            auth: SceneOwner;
            reference: unknown;
            proof: string;
            rpc: unknown;
            proposal: unknown;
            id: string;
            state: never;
        }>();
        try {
            if (body.action === 'rpc') {
                const rpc = new Request('https://localhost/scene/mcp', { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json', 'accept': 'application/json,text/event-stream', 'mcp-protocol-version': '2025-03-26' }, body: JSON.stringify(body.rpc) });
                return boundedSceneRpc(rpc, r => sceneMcpHandler(env.DB, body.auth as SceneAuth, 'https://localhost/scene/mcp', enabled).fetch(r, { authInfo: { token: 'synthetic-local-token', clientId: 'synthetic-local-client', scopes: [...SCENE_SCOPES], expiresAt: Math.floor(Date.now() / 1000) + 900, resource: new URL('https://localhost/scene/mcp') } }), enabled);
            }
            let value: unknown;
            switch (body.action) {
                case 'create':
                    value = await store.create(body.snapshot, SCENE_FIELDS, true, body.consent,body.leaseMs);
                    break;
                case 'bind':
                    value = await store.bindFromProof(body.proof, crypto.randomUUID());
                    break;
                case 'upload':
                    value = await store.referenceStore().upload(body.auth, body.reference);
                    break;
                case 'read':
                    value = await store.referenceStore().read(body.auth);
                    break;
                case 'sync':
                    value = await store.sync(body.auth, body.snapshot);
                    break;
                case 'propose':
                    value = await store.propose(body.auth, body.proposal);
                    break;
                case 'claim':
                    value = await store.claim(body.auth);
                    break;
                case 'report':
                    value = await store.report(body.auth, body.id, body.state);
                    break;
                case 'revoke':
                    value = await store.revoke(body.auth);
                    break;
                case 'sweep':
                    await store.sweepExpired();
                    value = true;
                    break;
                default: throw new Error('ACTION');
            }
            return Response.json({ value });
        }
        catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : 'ERROR' }, { status: 409 });
        }
    } };

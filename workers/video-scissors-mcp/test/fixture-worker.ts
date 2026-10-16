// Local Miniflare fixture ONLY. Never imported by the deployable entrypoint.
import { Mailbox } from '../src/mailbox.ts';
import migration from '../migrations/0001.sql';
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'GET' || request.method === 'HEAD') return env.ASSETS.fetch(request);
    const b = await request.json<{ action: string; auth: {project: string; epoch: number; credential: string}; proof: string; handle: string; command: unknown; metadata: unknown; id: string; state: string; deadline?: number }>();
    if (b.action === 'initialize-local-fixture') await env.DB.exec(migration.replace(/--[^\n]*/g, '').replace(/\s+/g, ' '));
    const m = new Mailbox(env.DB);
    await m.initialize();
    try {
      await m.spend('http');
      let result: unknown;
      switch (b.action) {
        case 'initialize-local-fixture': result = true; break;
        case 'create': result = await m.create(); break;
        case 'bind': result = await m.bindProof(b.auth.project, b.proof, b.handle); break;
        case 'consent': result = await m.consentProject(b.handle); break;
        case 'sync': result = await m.sync(b.auth, b.metadata); break;
        case 'admit': result = await m.admit(b.auth, b.command, b.deadline); break;
        case 'claim': result = await m.claim(b.auth, b.metadata); break;
        case 'poll': result = await m.poll(b.auth, b.metadata, request.signal); break;
        case 'report': result = await m.report(b.auth, b.id, b.state, b.metadata); break;
        case 'cancel': result = await m.cancel(b.auth, b.id); break;
        case 'cancellation': result = await m.cancellation(b.auth, b.id); break;
        case 'revoke': result = await m.revoke(b.auth); break;
        case 'oauth': await m.spend('oauth'); result = true; break;
        default: return new Response(null, { status: 404 });
      }
      return Response.json(result);
    } catch {
      // No raw body, credential or SQL error text in fixture receipts.
      return Response.json({ error: 'REJECTED' }, { status: 409 });
    }
  },
} satisfies ExportedHandler<Env>;

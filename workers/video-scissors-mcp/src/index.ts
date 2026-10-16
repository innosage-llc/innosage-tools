import { Mailbox } from './mailbox';
import { providerFor } from './oauth';
import { boundedBody, reply } from './http';
// Public deployment remains disabled until exact final HIGH review.
// No fixture routes are imported by this entrypoint.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/mcp') && path !== '/mcp') return reply({ error: 'RESOURCE_NOT_FOUND' }, 404);
    if (path === '/mcp' || path.startsWith('/oauth') || path === '/authorize' || path.startsWith('/remote') || path.startsWith('/.well-known/')) {
      if (String(env.EXPERIMENT_ENABLED) !== 'true') return reply({ error: 'NOT_ENABLED' }, 503);
      try {
        const mailbox = new Mailbox(env.DB);
        await mailbox.initialize();
        await mailbox.spend('http');
        if (path === '/oauth/register' && request.method === 'POST') await mailbox.spend('dcr');
        // Bound protocol bodies too, before the official provider reads them.
        if (request.body) request = new Request(request, { body: await boundedBody(request) });
        return await providerFor(env, new URL(request.url).origin).fetch(request, env, ctx);
      } catch { return reply({ error: 'REQUEST_REJECTED' }, 400); }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

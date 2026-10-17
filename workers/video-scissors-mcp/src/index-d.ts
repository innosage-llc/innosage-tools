import { boundedBody, reply } from './http';
import { ProjectStateDO } from './d/ProjectStateDO';
import { dProviderFor } from './d/oauth';
import { isRoutingKey } from './d/routing';
import type { DEnv } from './d/types';

// Wrangler resolves the SQLite binding class from this D-specific entrypoint.
export { ProjectStateDO };

const protocolPath = (path: string) => path === '/mcp' || path.startsWith('/mcp/') ||
  path.startsWith('/oauth/') || path === '/authorize' || path.startsWith('/remote/') ||
  path.startsWith('/.well-known/');

// Isolated P1 candidate entrypoint. This file is selected only by the local D
// config template; the existing A/B production entrypoint is unchanged.
export default {
  async fetch(request: Request, env: DEnv, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!protocolPath(path)) {
      // Keep the binding conversion isolated to this standard Fetch boundary;
      // Wrangler and the OAuth/MCP dependencies ship duplicate Workers types.
      return env.ASSETS.fetch(request as never) as unknown as Response;
    }
    if (env.EXPERIMENT_ENABLED !== 'true') return reply({ error: 'NOT_ENABLED' }, 503);
    if (!isRoutingKey(env.D_ROUTING_HMAC_KEY)) return reply({ error: 'ROUTING_UNAVAILABLE' }, 503);
    try {
      // Bound every protocol body before OAuth/MCP parses it. These endpoints
      // carry only small JSON/form control data, never media or paths.
      if (request.body) request = new Request(request, { body: await boundedBody(request) });
      return await dProviderFor(env, new URL(request.url).origin).fetch(request, env, ctx);
    } catch {
      return reply({ error: 'REQUEST_REJECTED' }, 400);
    }
  },
} satisfies ExportedHandler<DEnv>;

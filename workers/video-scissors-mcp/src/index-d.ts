import { boundedBody, reply } from './http';
import { ProjectStateDO } from './d/ProjectStateDO';
import { dProviderFor } from './d/oauth';
import { isRoutingKey } from './d/routing';
import { D_EXPERIMENT_BUDGET_OBJECT } from './d/budget';
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
    const isProtocol = protocolPath(path);
    if (!protocolPath(path)) {
      if (env.EXPERIMENT_ENABLED !== 'true') {
        // Keep the binding conversion isolated to this standard Fetch boundary;
        // Wrangler and the OAuth/MCP dependencies ship duplicate Workers types.
        return env.ASSETS.fetch(request as never) as unknown as Response;
      }
    }
    if (isProtocol && env.EXPERIMENT_ENABLED !== 'true') return reply({ error: 'NOT_ENABLED' }, 503);
    // Cleanup alone must survive exhausted/unavailable admission. The existing
    // handler still checks bounded JSON, origin and credential-derived ownership.
    const isRevoke = path === '/remote/revoke' && request.method === 'POST';
    if (env.EXPERIMENT_ENABLED === 'true' && !isRevoke) {
      try {
        if (!await env.PROJECT_STATE.getByName(D_EXPERIMENT_BUDGET_OBJECT).consumeWorkerRequest()) {
          return reply({ error: 'DAILY_REQUEST_LIMIT' }, 429);
        }
      } catch {
        return reply({ error: 'BUDGET_UNAVAILABLE' }, 503);
      }
    }
    if (!isProtocol) {
      // When D is enabled, static and protocol HTTP requests share the same
      // ordinary-request daily admission ceiling (exact POST revoke is exempt).
      // Disabled static assets remain available without waking the budget object.
      return env.ASSETS.fetch(request as never) as unknown as Response;
    }
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

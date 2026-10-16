import worker from './index';
import { reply } from './http';

type DoEnv = Env & { VIDEO_BRIDGE?: unknown };
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    const bridgeRequired = path === '/mcp' || path.startsWith('/mcp/') || path.startsWith('/oauth') ||
      path === '/authorize' || path.startsWith('/remote') || path.startsWith('/.well-known/');
    if (bridgeRequired && !(env as DoEnv).VIDEO_BRIDGE) return reply({ error: 'BRIDGE_UNAVAILABLE' }, 503);
    return worker.fetch(request, env, ctx);
  },
};
export { VideoScissorsBridgeDO } from './VideoScissorsBridgeDO';

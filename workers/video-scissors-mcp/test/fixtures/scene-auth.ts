// Offline fixture only. No deployed entrypoint imports this dispatch switch.
import legacy from '../../src/index';
import candidate from '../../src/scene/candidate-entry';
import { sceneMcpHandler } from '../../src/scene/mcp';
export default { fetch(request: Request, env: Env, ctx: ExecutionContext) {
  if (request.headers.get('x-fixture-old') === 'true') return legacy.fetch(request, env, ctx);
  if (request.headers.get('x-fixture-lease-race') === 'true') return sceneMcpHandler(env.DB,{purpose:'visual-remix',shareId:'expired-share',projectId:'race-project',generation:'race-generation',epoch:1},new URL('/scene/mcp',request.url).href).fetch(request);
  return candidate.fetch(request, { ...env, SCENE_BUILD_REVISION:'a'.repeat(40), SCENE_REMOTE_ENABLED: request.headers.get('x-fixture-disabled') === 'true' ? 'false' : 'true' }, ctx);
} };

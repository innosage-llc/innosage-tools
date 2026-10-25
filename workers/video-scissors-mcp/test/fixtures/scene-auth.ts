// Offline fixture only. No deployed entrypoint imports this dispatch switch.
import legacy from '../../src/index';
import candidate from '../../src/scene/candidate-entry';
import { sceneMcpHandler } from '../../src/scene/mcp';
// This isolated Miniflare fixture controls time for the actual provider and
// mailbox together. No deployed entrypoint accepts this header or clock.
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
export default { fetch(request: Request, env: Env, ctx: ExecutionContext) {
  offset = Number(request.headers.get('x-fixture-time-offset') ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 86_400_000) throw new Error('FIXTURE_TIME');
  if (request.headers.get('x-fixture-old') === 'true') return legacy.fetch(request, env, ctx);
  if (request.headers.get('x-fixture-lease-race') === 'true') return sceneMcpHandler(env.DB,{purpose:'visual-remix',shareId:'expired-share',projectId:'race-project',generation:'race-generation',epoch:1},new URL('/scene/mcp',request.url).href).fetch(request);
  return candidate.fetch(request, { ...env, SCENE_BUILD_REVISION:'a'.repeat(40), SCENE_UNTIL_REVOKED_ENABLED:request.headers.get('x-fixture-until-revoked')==='true'?'true':'false', SCENE_REMOTE_ENABLED: request.headers.get('x-fixture-disabled') === 'true' ? 'false' : 'true' }, ctx);
} };

export { VideoScissorsBridgeDO } from '../../src/VideoScissorsBridgeDO';

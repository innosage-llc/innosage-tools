// Offline fixture only. No deployed entrypoint imports this dispatch switch.
import legacy from '../../src/index';
import { sceneCandidateFor } from '../../src/scene/oauth-candidate';
export default { fetch(request: Request, env: Env, ctx: ExecutionContext) {
  if (request.headers.get('x-fixture-old') === 'true') return legacy.fetch(request, env, ctx);
  return sceneCandidateFor(env, new URL(request.url).origin, request.headers.get('x-fixture-disabled') !== 'true').fetch(request, env, ctx);
} };

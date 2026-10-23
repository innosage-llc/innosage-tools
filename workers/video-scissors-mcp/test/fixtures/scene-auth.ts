// Offline fixture only. No deployed entrypoint imports this dispatch switch.
import legacy from '../../src/index';
import candidate from '../../src/scene/candidate-entry';
export default { fetch(request: Request, env: Env, ctx: ExecutionContext) {
  if (request.headers.get('x-fixture-old') === 'true') return legacy.fetch(request, env, ctx);
  return candidate.fetch(request, { ...env, SCENE_REMOTE_ENABLED: request.headers.get('x-fixture-disabled') === 'true' ? 'false' : 'true' }, ctx);
} };

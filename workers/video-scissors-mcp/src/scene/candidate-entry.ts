import { sceneCandidateFor } from './oauth-candidate';
import type { BridgeNamespace } from '../browser-routes';

// Inactive alternate entrypoint. No checked-in deployment points here and no
// flag is set by this module. Activation needs the exact reviewed approval.
type CandidateEnv = Env & { SCENE_REMOTE_ENABLED?: string; SCENE_REFERENCE_ENABLED?: string; SCENE_BUILD_REVISION?: string; VIDEO_BRIDGE?: BridgeNamespace };
const candidate = {
  fetch(request: Request, env: CandidateEnv, ctx: ExecutionContext): Promise<Response> {
    return sceneCandidateFor(env, new URL(request.url).origin,
      env.SCENE_REMOTE_ENABLED === 'true', env.VIDEO_BRIDGE).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<CandidateEnv>;
export default candidate;

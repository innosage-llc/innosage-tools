import { sceneCandidateFor } from './oauth-candidate';
import { SceneMailbox } from './mailbox';
import type { BridgeNamespace } from '../browser-routes';

// Inactive alternate entrypoint. No checked-in deployment points here and no
// flag is set by this module. Activation needs the exact reviewed approval.
type CandidateEnv = Env & { SCENE_REMOTE_ENABLED?: string; SCENE_REFERENCE_ENABLED?: string; SCENE_UNTIL_REVOKED_ENABLED?:string; SCENE_RETIRED_RECLAIM_ENABLED?:string; SCENE_BUILD_REVISION?: string; VIDEO_BRIDGE?: BridgeNamespace };
const candidate = {
  fetch(request: Request, env: CandidateEnv, ctx: ExecutionContext): Promise<Response> {
    return sceneCandidateFor(env, new URL(request.url).origin,
      env.SCENE_REMOTE_ENABLED === 'true', env.VIDEO_BRIDGE).fetch(request, env, ctx);
  },
  async scheduled(_event:ScheduledController,env:CandidateEnv):Promise<void>{
    // Schedule configuration is separate runtime activation. Keep cleanup when
    // new creation is disabled; never log grant IDs, content or credentials.
    const store=new SceneMailbox(env.DB,Date.now,env.SCENE_REFERENCE_ENABLED==='true',false,env.SCENE_RETIRED_RECLAIM_ENABLED==='true');
    await store.sweepExpired();
    await store.purgeInactiveCache();
    await store.reclaimRetired();
  },
} satisfies ExportedHandler<CandidateEnv>;
export default candidate;

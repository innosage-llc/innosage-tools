import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { DurableObjectNamespace, Fetcher, KVNamespace } from '@cloudflare/workers-types';
import type { ProjectStateDO } from './ProjectStateDO';

export type DEnv = {
  ASSETS: Fetcher;
  EXPERIMENT_ENABLED?: string;
  D_ROUTING_HMAC_KEY?: string;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER?: OAuthHelpers;
  PROJECT_STATE: DurableObjectNamespace<ProjectStateDO>;
};

export type ProjectAuth = { project: string; epoch: number };
export type BrowserAuth = ProjectAuth & { credential: string };

export const projectStub = (env: DEnv, project: string) => env.PROJECT_STATE.getByName(project);

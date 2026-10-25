import type { SceneAuth } from '../../../../lib/visual-remix-remote';
// Every operation retains purpose parsing plus exact grant binding and revoke.
// Storage sentinel0 is valid only with explicit versioned until-revoked consent.
export const liveLifetime = "((s.expiry_policy='fixed' AND s.expires>?) OR (s.expiry_policy='until_revoked' AND s.expires=0 AND s.grant_consent_version=1))";
export const liveGrant = 's.id=? AND s.project=? AND s.generation=? AND s.epoch=? AND s.revoked=0 AND ' + liveLifetime;
export const grantArgs = (auth: SceneAuth, now: number) => [auth.shareId, auth.projectId, auth.generation, auth.epoch, now];
export const SCENE_CACHE_MS = 1800000;
export const SCENE_OAUTH_SECONDS = 1800;

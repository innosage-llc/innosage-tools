import { sceneObject } from './visual-remix-remote.ts';
export const UNTIL_REVOKED_MODE = 'until-revoked' as const;
export type UntilRevokedConsent = {
    mode: typeof UNTIL_REVOKED_MODE;
    version: 1;
    rememberBrowserControl: true;
};
export const UNTIL_REVOKED_CONSENT: UntilRevokedConsent = { mode: UNTIL_REVOKED_MODE, version: 1, rememberBrowserControl: true };
export function parseUntilRevokedConsent(value: unknown): UntilRevokedConsent {
    const v = sceneObject(value, ['mode', 'version', 'rememberBrowserControl']);
    if (v.mode !== UNTIL_REVOKED_MODE || v.version !== 1 || v.rememberBrowserControl !== true)
        throw new Error('SCENE_LIFETIME_CONSENT');
    return { ...UNTIL_REVOKED_CONSENT };
}

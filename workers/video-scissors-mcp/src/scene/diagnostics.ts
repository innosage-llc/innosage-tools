import { SCENE_SCOPES } from '../../../../lib/visual-remix-remote';
import { reply } from '../http';

export const SCENE_SERVICE_VERSION = '0.1.6';
export function sceneOAuthChallenge(resource: string) {
  const metadata = new URL('/.well-known/oauth-protected-resource/scene/mcp', resource).href;
  return `Bearer resource_metadata="${metadata}", scope="${SCENE_SCOPES.join(' ')}", error="invalid_token", error_description="Scene authorization is required; use the host reconnect prompt"`;
}

export function sceneAuthContextReply(resource: string): Response {
  const response = reply({ error:'AUTH_CONTEXT' },401);
  response.headers.set('WWW-Authenticate',sceneOAuthChallenge(resource));
  return response;
}

export function sceneReauthorization(resource: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: 'SCENE_REAUTHORIZATION_REQUIRED: no proposal was delivered. Use the host reconnect prompt for OAuth authorization. If the Scene share itself expired or was revoked, a fresh explicitly consented share is required in Visual Remix. A new share is a distinct profile. Do not claim an SVG fallback is an application preview.' }],
    _meta: { 'mcp/www_authenticate': [sceneOAuthChallenge(resource)] },
  };
}

// Response-only diagnostics: no persistence, request bodies, headers or user IDs.
export function sceneDiagnostic(response: Response, requestId: string, revision: unknown, tool?: string): Response {
  // A Workers upgrade carries a separate webSocket extension; return it intact.
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set('X-Visual-Remix-Request-Id', requestId);
  headers.set('X-Visual-Remix-Version', SCENE_SERVICE_VERSION);
  headers.set('X-Visual-Remix-Revision', typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision) ? revision : 'unknown');
  if (tool) headers.set('X-Visual-Remix-Tool', tool);
  return new Response(response.body, { status: response.status, headers });
}

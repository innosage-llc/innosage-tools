import { SCENE_SCOPES } from '../../../../lib/visual-remix-remote';

export const SCENE_SERVICE_VERSION = '0.1.6';
export function sceneReauthorization(resource: string) {
  const metadata = new URL('/.well-known/oauth-protected-resource/scene/mcp', resource).href;
  return {
    isError: true,
    content: [{ type: 'text' as const, text: 'SCENE_REAUTHORIZATION_REQUIRED: no proposal was delivered. Open Visual Remix, Disconnect, create a fresh share and manually reconnect the host. Do not claim an SVG fallback is an application preview.' }],
    _meta: { 'mcp/www_authenticate': [`Bearer resource_metadata="${metadata}", scope="${SCENE_SCOPES.join(' ')}", error="invalid_token", error_description="Scene sharing expired or was revoked; fresh manual authorization is required"`] },
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

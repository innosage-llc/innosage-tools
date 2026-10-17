import { OAuthProvider, OAuthError, insufficientScope, type OAuthHelpers, type OAuthResourceContext } from '@cloudflare/workers-oauth-provider';
import { renderConsentView } from '../ConsentView';
import { boundedBody, exactObject, reply, sameOrigin } from '../http';
import { consumeConsentTicket, dBrowserRoute } from './browser-routes';
import { dMcpHandler, projectToolSecurity } from './mcp';
import type { DEnv, ProjectAuth } from './types';

const scopes = ['video:read','video:edit'];

export function dProviderFor(env: DEnv, origin: string) {
  return new OAuthProvider<DEnv>({
    apiRoute: '/mcp',
    apiHandler: { async fetch(request, currentEnv, ctx) {
      const verified = ctx as ExecutionContext & OAuthResourceContext<Record<string, unknown>>;
      if (!verified.auth?.clientId || !verified.props || typeof verified.props !== 'object') return reply({ error: 'AUTH_CONTEXT' }, 401);
      if (!scopes.every(scope => verified.auth.scope.includes(scope))) return insufficientScope(verified.auth, scopes);
      const handler = dMcpHandler(currentEnv, verified.props, origin);
      // Preserve an untouched finite RPC copy for the owned tools/list
      // descriptor projection; the MCP adapter consumes the original body.
      const projectionRequest = request.clone();
      const response = await handler.fetch(request, { authInfo: { token: verified.auth.token, clientId: verified.auth.clientId,
        scopes: verified.auth.scope, expiresAt: verified.auth.expiresAt, resource: new URL('/mcp', origin) } });
      return projectToolSecurity(projectionRequest as unknown as Request, response);
    } },
    authorizeEndpoint: '/authorize', tokenEndpoint: '/oauth/token', clientRegistrationEndpoint: '/oauth/register',
    accessTokenTTL: 1800, refreshTokenTTL: 1800,
    tokenExchangeCallback: async options => {
      const p = exactObject(options.props, ['project','epoch','scopes']);
      if (typeof p.project !== 'string' || !/^[a-f0-9]{64}$/.test(p.project) || !Number.isSafeInteger(p.epoch) ||
        !Array.isArray(p.scopes) || !p.scopes.every(scope => typeof scope === 'string') ||
        !scopes.every(scope => (p.scopes as string[]).includes(scope)) ||
        !await env.PROJECT_STATE.getByName(p.project).project({ project: p.project, epoch: Number(p.epoch) })) {
        throw new OAuthError('invalid_grant', { description: 'Project expired or revoked' });
      }
    },
    scopesSupported: scopes, requiredScopes: scopes,
    allowTokenExchangeGrant: false, clientIdMetadataDocumentEnabled: false,
    resourceMetadata: { resource: new URL('/mcp', origin).href, resource_name: 'Local Video Scissors stateless DO candidate' },
    defaultHandler: { async fetch(request, currentEnv) {
      const path = new URL(request.url).pathname;
      if (path.startsWith('/remote/')) return dBrowserRoute(request, currentEnv);
      if (path !== '/authorize') {
        // OAuth Provider's bundled Fetch types and Wrangler's generated Fetcher
        // types come from distinct Workers type copies; the runtime contract is
        // still the standard Fetch request/response at this binding boundary.
        return currentEnv.ASSETS.fetch(request as never) as unknown as Response;
      }
      const oauth = (currentEnv as DEnv & { OAUTH_PROVIDER: OAuthHelpers }).OAUTH_PROVIDER;
      if (request.method === 'GET') {
        const auth = await oauth.parseAuthRequest(request);
        if (auth.scope.some(scope => !scopes.includes(scope)) || !scopes.every(scope => auth.scope.includes(scope))) return reply({ error: 'BOTH_SCOPES_REQUIRED' }, 400);
        const details = await oauth.describeConsent(auth), consent = await oauth.beginConsent(auth);
        consent.headers.set('Content-Type', 'text/html; charset=utf-8');
        return new Response(renderConsentView({ details, handle: consent.handle, errorCode: 'NONE' }), { headers: consent.headers });
      }
      if (request.method !== 'POST' || !sameOrigin(request) ||
        request.headers.get('content-type')?.split(';',1)[0].trim() !== 'application/x-www-form-urlencoded') return reply({ error: 'ORIGIN_OR_METHOD' }, 403);
      const form = new URLSearchParams(await boundedBody(request, 4096));
      if ([...form.keys()].some(key => !['handle','decision','scope','browserProof'].includes(key)) ||
        form.getAll('handle').length !== 1 || form.getAll('decision').length !== 1) return reply({ error: 'FORM' }, 400);
      const handle = form.get('handle') ?? '';
      if (form.get('decision') === 'deny') {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      if (form.get('decision') !== 'approve' || form.getAll('browserProof').length !== 1) return reply({ error: 'FORM' }, 400);
      const approved = await oauth.approveConsent(request, handle, { scope: form.getAll('scope') });
      if (approved.request.scope.some(scope => !scopes.includes(scope)) || !scopes.every(scope => approved.request.scope.includes(scope))) return reply({ error: 'BOTH_SCOPES_REQUIRED' }, 400);
      const auth: ProjectAuth | null = await consumeConsentTicket(currentEnv, form.get('browserProof') ?? '', handle);
      if (!auth) return reply({ error: 'PROOF_REJECTED' }, 403);
      const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: auth.project,
        metadata: {}, scope: approved.request.scope, props: { ...auth, scopes: approved.request.scope } });
      await currentEnv.PROJECT_STATE.getByName(auth.project).notify(auth.project, auth.epoch).catch(() => {});
      approved.headers.set('Location', redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    } },
  });
}

import { OAuthProvider, OAuthError, insufficientScope, type OAuthHelpers, type OAuthResourceContext, type OAuthProviderOptions } from '@cloudflare/workers-oauth-provider';
import { renderConsentView } from './ConsentView';
import { Mailbox } from './mailbox';
import { mcpHandler } from './mcp';
import { browserRoute } from './browser-routes';
import type { BridgeNamespace } from './browser-routes';
import { boundedBody, exactObject, sameOrigin, reply } from './http';

const scopes = ['video:read', 'video:edit'];
type VideoOptions = Omit<OAuthProviderOptions<Env>, 'apiHandler'> & { apiHandler: { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> } };
// Shared configuration; providerFor retains the existing single-resource behavior.
export function videoOAuthOptionsFor(env: Env, origin: string, bridge?: BridgeNamespace): VideoOptions {
  const wake = async (project: string, epoch: number) => {
    if (!bridge) return;
    const stub = bridge.get(bridge.idFromName(project)) as {notify(project: string, epoch: number): Promise<void>};
    await stub.notify(project, epoch);
  };
  return {
    apiRoute: '/mcp', apiHandler: { async fetch(request, currentEnv, ctx) {
      // Provider 1.2.3 supplies ctx.auth, not the newer Agents verified-symbol
      // bridge. Map ONLY the provider-verified fields through the official API.
      const verified = ctx as ExecutionContext & OAuthResourceContext<Record<string, unknown>>;
      if (!verified.auth?.clientId || !verified.props || typeof verified.props !== 'object') return reply({ error: 'AUTH_CONTEXT' }, 401);
      if (!scopes.every(scope => verified.auth.scope.includes(scope))) return insufficientScope(verified.auth, scopes);
      const handler = mcpHandler(currentEnv.DB, verified.props, origin, auth => wake(auth.project, auth.epoch), !bridge);
      const rpc = request.method === 'POST' ? await request.clone().json<{method?: string}>() : null;
      const response = await handler.fetch(request, { authInfo: { token: verified.auth.token,
        clientId: verified.auth.clientId, scopes: verified.auth.scope, expiresAt: verified.auth.expiresAt,
        resource: new URL('/mcp', origin) } });
      // SDK v2.3.1 only registers _meta, while ChatGPT also expects the explicit
      // top-level per-tool declaration. Project ONLY our five owned descriptors.
      if (rpc?.method === 'tools/list' && response.body) {
        // Published-2025 fallback may use SSE even with responseMode=json.
        // This one finite, owned descriptor response is bounded and projected;
        // arbitrary tool streams are never buffered or transformed.
        const text = await boundedBody(new Request(request.url, { method: 'POST', body: response.body }));
        const json = response.headers.get('content-type')?.includes('text/event-stream') ? text.split('\n').find(line => line.startsWith('data: '))?.slice(6) : text;
        const data = exactObject(JSON.parse(json ?? ''), ['jsonrpc','id','result','error']);
        if (data.result && typeof data.result === 'object' && 'tools' in data.result && Array.isArray(data.result.tools)) {
          for (const value of data.result.tools) {
            if (!value || typeof value !== 'object' || !('_meta' in value) || !value._meta || typeof value._meta !== 'object' || !('securitySchemes' in value._meta)) throw new Error('TOOL_DESCRIPTOR');
            Object.assign(value, { securitySchemes: value._meta.securitySchemes });
          }
        }
        const headers = new Headers(response.headers);
        headers.set('Content-Type', 'application/json'); headers.delete('Content-Length');
        return Response.json(data, { status: response.status, headers });
      }
      return response;
    } },
    authorizeEndpoint: '/authorize', tokenEndpoint: '/oauth/token', clientRegistrationEndpoint: '/oauth/register',
    accessTokenTTL: 1800, refreshTokenTTL: 1800,
    tokenExchangeCallback: async options => {
      const p = exactObject(options.props, ['project','epoch','scopes']);
      if (typeof p.project !== 'string' || !Number.isSafeInteger(p.epoch) ||
        !await new Mailbox(options.env.DB).project({ project: p.project, epoch: Number(p.epoch) })) {
        throw new OAuthError('invalid_grant', { description: 'Project expired or revoked' });
      }
    },
    scopesSupported: scopes, requiredScopes: scopes,
    allowTokenExchangeGrant: false, clientIdMetadataDocumentEnabled: false,
    resourceMetadata: { resource: new URL('/mcp', origin).href, resource_name: 'Local Video Scissors experimental control' },
    defaultHandler: { async fetch(request, currentEnv) {
      const path = new URL(request.url).pathname;
      const mailbox = new Mailbox(currentEnv.DB);
      if (path.startsWith('/remote/')) return browserRoute(request, mailbox, bridge);
      if (path !== '/authorize') return currentEnv.ASSETS.fetch(request);
      const oauth = (currentEnv as Env & { OAUTH_PROVIDER: OAuthHelpers }).OAUTH_PROVIDER;
      if (request.method === 'GET') {
        const auth = await oauth.parseAuthRequest(request);
        if (auth.scope.some(scope => !scopes.includes(scope)) || !scopes.every(scope => auth.scope.includes(scope))) return reply({ error: 'BOTH_SCOPES_REQUIRED' }, 400);
        const details = await oauth.describeConsent(auth);
        await mailbox.spend('oauth');
        const consent = await oauth.beginConsent(auth);
        consent.headers.set('Content-Type', 'text/html; charset=utf-8');
        return new Response(renderConsentView({ details, handle: consent.handle, errorCode: 'NONE' }), { headers: consent.headers });
      }
      if (request.method !== 'POST' || !sameOrigin(request) || !request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return reply({ error: 'ORIGIN_OR_METHOD' }, 403);
      const form = new URLSearchParams(await boundedBody(request));
      if ([...form.keys()].some(k => !['handle','decision','scope','browserProof'].includes(k)) ||
        form.getAll('handle').length !== 1 || form.getAll('decision').length !== 1) return reply({ error: 'FORM' }, 400);
      const handle = form.get('handle') ?? '';
      if (form.get('decision') === 'deny') {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      if (form.get('decision') !== 'approve' || form.getAll('browserProof').length !== 1) return reply({ error: 'FORM' }, 400);
      // Helper verifies cookie/CSRF and recovers the stored request; form cannot
      // replace client, redirect, project or epoch. D1 then consumes proof and
      // permanently tombstones this handle in the same SQL mutation.
      const approved = await oauth.approveConsent(request, handle, { scope: form.getAll('scope') });
      if (!scopes.every(scope => approved.request.scope.includes(scope))) return reply({ error: 'BOTH_SCOPES_REQUIRED' }, 400);
      const auth = await mailbox.bindFromProof(form.get('browserProof') ?? '', handle);
      if (!auth) return reply({ error: 'PROOF_REJECTED' }, 403);
      const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: auth.project,
        metadata: {}, scope: approved.request.scope, props: { ...auth, scopes: approved.request.scope } });
      await wake(auth.project, auth.epoch).catch(() => {});
      approved.headers.set('Location', redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    } },
  };
}

export function providerFor(env: Env, origin: string, bridge?: BridgeNamespace) {
  return new OAuthProvider<Env>(videoOAuthOptionsFor(env, origin, bridge));
}

// INACTIVE CANDIDATE. Never imported by src/index.ts; caller gate defaults off.
import { OAuthAuthorizationServer, OAuthResourceServer, OAuthError, insufficientScope, type OAuthHelpers, type OAuthResourceContext } from '@cloudflare/workers-oauth-provider';
import { videoOAuthOptionsFor } from '../oauth';
import { Mailbox } from '../mailbox';
import { renderConsentView } from '../ConsentView';
import { boundedBody, sameOrigin, reply } from '../http';
import legacyEntrypoint from '../index';
import { browserRoute } from '../browser-routes';
import type { BridgeNamespace } from '../browser-routes';
import { SceneMailbox } from './mailbox';
import { renderSceneConsentView } from './SceneConsentView';
import { boundedSceneRpc, sceneMcpHandler } from './mcp';
import { sceneBrowserRoute } from './browser-routes';
import { sceneDiagnostic } from './diagnostics';
type SceneEnv = Env & { SCENE_BUILD_REVISION?: string };
import { SCENE_SCOPES, parseSceneAuth, sceneObject, type SceneAuth } from '../../../../lib/visual-remix-remote';
const videoScopes = ['video:read','video:edit'];
const scopesEqual = (value: string[], expected: readonly string[]) => value.length === expected.length && new Set(value).size === expected.length && expected.every(scope => value.includes(scope));
function sceneProps(input: unknown): SceneAuth {
  const props = sceneObject(input, ['purpose','shareId','projectId','generation','epoch','scopes']);
  if (!Array.isArray(props.scopes) || !scopesEqual(props.scopes, SCENE_SCOPES)) throw new Error('SCENE_TOKEN_SCOPE');
  return parseSceneAuth({ purpose: props.purpose, shareId: props.shareId, projectId: props.projectId, generation: props.generation, epoch: props.epoch });
}
const consentHeaders = (headers: Headers) => {
  headers.set('Content-Type','text/html; charset=utf-8'); headers.set('Cache-Control','no-store');
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
  headers.set('X-Frame-Options','DENY'); // Preserve Origin on same-origin form POST; cross-origin redirects get no referrer.
  headers.set('Referrer-Policy','same-origin');
  return headers;
};
export function sceneCandidateFor(env: SceneEnv, origin: string, enabled = false, bridge?: BridgeNamespace) {
  const videoResource = origin + '/mcp', sceneResource = origin + '/scene/mcp';
  const options = videoOAuthOptionsFor(env, origin, bridge);
  const store = new SceneMailbox(env.DB);
  const authorization = new OAuthAuthorizationServer<Env>({
    issuer: origin, resources: [videoResource,sceneResource], defaultResource: videoResource, legacyGrantResource: videoResource,
    authorizeEndpoint: options.authorizeEndpoint, tokenEndpoint: options.tokenEndpoint,
    clientRegistrationEndpoint: options.clientRegistrationEndpoint, accessTokenTTL: options.accessTokenTTL,
    refreshTokenTTL: options.refreshTokenTTL, allowTokenExchangeGrant: false, clientIdMetadataDocumentEnabled: false,
    scopesSupported: [...videoScopes,...SCENE_SCOPES],
    tokenExchangeCallback: async input => {
      if (input.resource === videoResource) return options.tokenExchangeCallback?.(input);
      if (input.resource !== sceneResource || input.grantType !== 'authorization_code' || !scopesEqual(input.scope, SCENE_SCOPES) || !scopesEqual(input.requestedScope, SCENE_SCOPES)) throw new OAuthError('invalid_grant', { description: 'Scene lease or grant rejected' });
      const auth = sceneProps(input.props), lease = await new SceneMailbox(input.env.DB).lease(auth);
      const ttl = lease ? Math.floor((lease.expiresAt - Date.now()) / 1000) : 0;
      if (ttl < 60) throw new OAuthError('invalid_grant', { description: 'Scene lease or grant rejected' });
      return { accessTokenTTL: ttl, refreshTokenTTL: 0 };
    },
  });
  const localValidation = (current: Env) => (resource: string, token: string) => authorization.validateToken(resource, token, current);
  const video = new OAuthResourceServer<Env>({ resourceMetadata: { resource: videoResource, authorization_servers: [origin] }, requiredScopes: videoScopes, validateToken: localValidation, handler: options.apiHandler });
  // Let the official resource server challenge revoked/expired bindings, just as
  // it challenges invalid OAuth tokens. Data operations remain fenced by D1.
  const sceneValidation = (current: Env) => async (resource: string, token: string) => {
    const validation = await authorization.validateToken(resource, token, current);
    if (!validation) return null;
    let auth: SceneAuth;
    try { auth = sceneProps(validation.props); } catch { return null; }
    return await new SceneMailbox(current.DB).lease(auth) ? validation : null;
  };
  const scene = new OAuthResourceServer<Env>({ resourceMetadata: { resource: sceneResource, authorization_servers: [origin] }, requiredScopes: [...SCENE_SCOPES], validateToken: sceneValidation,
    handler: { async fetch(request, current, ctx) {
      const verified = ctx as ExecutionContext & OAuthResourceContext<Record<string, unknown>>;
      if (!verified.auth?.clientId) return reply({ error: 'AUTH_CONTEXT' }, 401);
      if (!scopesEqual(verified.auth.scope, SCENE_SCOPES)) return insufficientScope(verified.auth, [...SCENE_SCOPES]);
      const auth = sceneProps(verified.props), clientId = verified.auth.clientId;
      return boundedSceneRpc(request, bounded => sceneMcpHandler(current.DB, auth, sceneResource).fetch(bounded, { authInfo: { token: verified.auth.token, clientId, scopes: verified.auth.scope, expiresAt: verified.auth.expiresAt, resource: new URL(sceneResource) } }));
    } },
  });
  async function consent(request: Request, oauth: OAuthHelpers): Promise<Response> {
    if (request.method === 'GET') {
      const auth = await oauth.parseAuthRequest(request), isScene = auth.resource === sceneResource;
      if (auth.resource !== videoResource && !isScene || !scopesEqual(auth.scope, isScene ? SCENE_SCOPES : videoScopes)) return reply({ error: 'RESOURCE_OR_SCOPE' }, 400);
      if (isScene) await new Mailbox(env.DB).recordActivity('oauth');
      else await new Mailbox(env.DB).spend('oauth');
      const details = await oauth.describeConsent(auth), transaction = await oauth.beginConsent(auth);
      const html = isScene ? renderSceneConsentView({ handle: transaction.handle, clientName: details.clientName, clientId: details.clientId, redirectHost: details.redirectHost, isLoopback: details.redirectIsLoopback }) : renderConsentView({ details, handle: transaction.handle, errorCode: 'NONE' });
      return new Response(html, { headers: consentHeaders(transaction.headers) });
    }
    if (request.method !== 'POST' || !sameOrigin(request) || !request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return reply({ error: 'ORIGIN_OR_METHOD' }, 403);
    const form = new URLSearchParams(await boundedBody(request));
    if ([...form.keys()].some(k => !['handle','decision','scope','browserProof'].includes(k)) || form.getAll('handle').length !== 1 || form.getAll('decision').length !== 1) return reply({ error: 'FORM' }, 400);
    const handle = form.get('handle') ?? '';
    if (form.get('decision') === 'deny') { const denied = await oauth.denyConsent(request,handle); return new Response(null,{status:302,headers:denied.headers}); }
    if (form.get('decision') !== 'approve' || form.getAll('browserProof').length !== 1) return reply({ error: 'FORM' }, 400);
    const approved = await oauth.approveConsent(request,handle,{scope:form.getAll('scope')});
    const resource = approved.request.resource ?? videoResource;
    let props: Record<string,unknown>, userId: string;
    if (resource === sceneResource) {
      if (!scopesEqual(approved.request.scope,SCENE_SCOPES)) return reply({error:'SCENE_SCOPES'},400);
      const auth = await store.bindFromProof(form.get('browserProof') ?? '',handle);
      if (!auth) return reply({error:'SCENE_PROOF_REJECTED'},403);
      props = { ...auth, scopes:[...SCENE_SCOPES] }; userId = auth.shareId;
    } else if (resource === videoResource) {
      if (!scopesEqual(approved.request.scope,videoScopes)) return reply({error:'VIDEO_SCOPES'},400);
      const auth = await new Mailbox(env.DB).bindFromProof(form.get('browserProof') ?? '',handle);
      if (!auth) return reply({error:'PROOF_REJECTED'},403);
      props = { ...auth, scopes:approved.request.scope }; userId = auth.project;
    } else return reply({error:'RESOURCE'},400);
    const result = await oauth.completeAuthorization({request:approved.request,userId,metadata:{},scope:approved.request.scope,props});
    if (resource === videoResource && bridge) {
      const stub = bridge.get(bridge.idFromName(userId)) as { notify(project: string, epoch: number): Promise<void> };
      await stub.notify(userId, Number(props.epoch)).catch(() => {});
    }
    approved.headers.set('Location',result.redirectTo);approved.headers.set('Cache-Control','no-store');
    return new Response(null,{status:302,headers:approved.headers});
  }
  return { async fetch(request: Request, current: SceneEnv, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    const isScene = path.startsWith('/scene/') || path === '/.well-known/oauth-protected-resource/scene/mcp';
    const requestId = crypto.randomUUID(); let tool: string | undefined;
    const finish = (response: Response) => sceneDiagnostic(response,requestId,current.SCENE_BUILD_REVISION,tool);
    if (!enabled) return isScene ? finish(reply({error:'SCENE_NOT_ENABLED'},503)) : legacyEntrypoint.fetch(request,current,ctx);
    if (path.startsWith('/mcp') && path !== '/mcp') return reply({error:'RESOURCE_NOT_FOUND'},404);
    const protocol = isScene || path === '/mcp' || path.startsWith('/oauth') || path === '/authorize' || path.startsWith('/remote') || path.startsWith('/.well-known/');
    if (!protocol) return current.ASSETS.fetch(request);
    if (String(current.EXPERIMENT_ENABLED) !== 'true') return finish(reply({error:'NOT_ENABLED'},503));
    try {
      const videoStore = new Mailbox(current.DB);
      await videoStore.initialize(); await videoStore.recordActivity('http');
      if (path === '/oauth/register' && request.method === 'POST') await videoStore.spend('dcr');
      if (request.body) {
        const text = await boundedBody(request);
        if (path === '/scene/mcp') {
          try { const rpc = JSON.parse(text); if (rpc?.method === 'tools/call' && ['get_scene','propose_scene','proposal_status','cancel_proposal'].includes(rpc.params?.name)) tool = rpc.params.name; } catch { /* Protocol parser returns the safe rejection. */ }
        }
        request = new Request(request,{body:text});
      }
      if (isScene) { await store.spend(); await store.sweepExpired(); }
      if (path.startsWith('/scene/browser/')) return finish(await sceneBrowserRoute(request,store));
      if (path.startsWith('/remote/')) return finish(await browserRoute(request,videoStore,bridge));
      if (path === '/authorize') return finish(await consent(request,authorization.getOAuthApi(current)));
      if (path === '/mcp' || path === '/.well-known/oauth-protected-resource/mcp') return finish(await video.fetch(request,current,ctx));
      if (path === '/scene/mcp' || path === '/.well-known/oauth-protected-resource/scene/mcp') return finish(await scene.fetch(request,current,ctx));
      if (isScene) return finish(reply({error:'RESOURCE_NOT_FOUND'},404));
      if (path.startsWith('/oauth/') || path === '/.well-known/oauth-authorization-server') return finish(await authorization.fetch(request,current,ctx));
      return reply({error:'RESOURCE_NOT_FOUND'},404);
    } catch (error) {
      if (isScene && error instanceof Error && error.message.includes('SCENE_SHARE_BUDGET')) return finish(reply({error:'SCENE_STORAGE_LIMIT',recovery:'The bounded stored-share limit was reached. Stop retrying; changing this security/storage bound requires review.'},429));
      return finish(reply({error:'CANDIDATE_REQUEST_REJECTED'},400));
    }
  } };
}

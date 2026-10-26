import { REFERENCE_LIMITS } from '../../../../lib/visual-remix-reference';
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { SceneMailbox } from './mailbox';
import { boundedBody, reply } from '../http';
import { SCENE_SCOPES, SCENE_LIMITS, sceneJSON, sceneToolResult, type SceneAuth } from '../../../../lib/visual-remix-remote';
import { SCENE_SERVICE_VERSION, sceneReauthorization } from './diagnostics';

export function sceneMcpHandler(db: D1Database, auth: SceneAuth, resource: string, referencesEnabled = false) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'visual-remix-scene', version: SCENE_SERVICE_VERSION });
    const store = new SceneMailbox(db,Date.now,referencesEnabled), id = z.string().regex(/^[a-zA-Z0-9_-]{1,96}$/);
    const meta = { securitySchemes: [{ type: 'oauth2', scopes: [...SCENE_SCOPES] }] };
    const invoke = async (action: () => Promise<unknown>) => {
      if (!await store.lease(auth)) return sceneReauthorization(resource);
      try {
        const value = await action(), result = sceneToolResult(value);
        return value && typeof value === 'object' && 'error' in value ? {...result,isError:true} : result;
      }
      catch { return { isError: true, content: [{ type: 'text' as const, text: 'SCENE_COMMAND_REJECTED' }] }; }
    };
    // The independently consented share is this service's profile, not an owner
    // account or the project shared by several grants. Identity needs live
    // authority, but never browser freshness, cached Scene content or pixels.
    server.registerTool('get_profile', {
      description:'Return the authenticated Scene share profile. Its stored opaque ID identifies this independently authorized share; another share, even for the same project, is a distinct profile. No Scene or image is read.',
      inputSchema:z.object({}).strict(),
      outputSchema:z.object({id:z.string().min(1).regex(/\S/),name:z.string().optional(),email:z.string().optional(),nickname:z.string().optional()}).strict(),
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
      _meta:{...meta,'openai/profile':true},
    },async()=>{
      if(!await store.lease(auth))return sceneReauthorization(resource);
      const profile={id:auth.shareId,name:'Editable Screen Scene share',nickname:'Scene share '+auth.shareId.slice(0,8)};
      return {isError:false,structuredContent:profile,content:[{type:'text' as const,text:sceneJSON(profile)}]};
    });
    if (referencesEnabled) server.registerTool('read_shared_reference', {description:'Read the freshly consented reference as native image content for vision, without asking the user to attach it again. Read only for first reconstruction; reuse the editable Scene thereafter. No URL/public image is supplied. Authorization, lease, browser freshness and explicit image consent are required. A successful transport is not proof you understood the pixels. Use original dimensions for photo/logo crop coordinates; preserve editable text/shapes. Never generate substitute identity assets.',inputSchema:z.object({}).strict(),_meta:meta,annotations:{readOnlyHint:true}},async()=>{
      if(!await store.lease(auth)) return sceneReauthorization(resource);
      try {return await store.referenceStore().read(auth);} catch {return {isError:true,content:[{type:'text' as const,text:'REFERENCE_READ_REJECTED'}]};}
    });
    server.registerTool('get_scene', { description: 'Read the current shared Scene before proposing. No raster bytes in this tool. When available, read_shared_reference returns the freshly consented reference as native image content for first reconstruction; no duplicate attachment is needed. Keep the external Visual Remix browser open. On authorization failure stop and request fresh manual connection; no proposal or edit was completed. Never substitute an SVG download for the application preview.', inputSchema: z.object({}).strict(), _meta: meta, annotations: { readOnlyHint: true } },
      async () => invoke(async () => await store.snapshot(auth) ?? { error: 'BROWSER_UNAVAILABLE', recovery: 'Bring the existing editor into a visible window and wait for its heartbeat, then read get_scene again. Do not create another share unless authorization expired.' }));
    server.registerTool('propose_scene', { description: 'Queue one bounded Scene proposal for preview in the external Visual Remix browser, not a ChatGPT image viewer. Queued/rendering/preview are pending; only proposal_status applied confirms manual Apply. Read get_scene immediately before submitting, after preparing the Scene. Only poll a successfully admitted queued/rendering/preview request; a result with admitted:false was rejected and gives recovery steps. Keep the editor visible in a separate window to avoid background suspension. For uncertain delivery query the same requestId before any bounded retry. Use fresh get_scene project/generation/revision, a unique requestId, explanation and full descriptor-only scene. On authorization failure no preview was delivered; stop, preserve work and request manual reconnection, never claim completion or substitute SVG.', inputSchema: z.object({ proposal: z.unknown() }).strict(), _meta: meta },
      async input => invoke(async () => await store.propose(auth, input.proposal) ?? await store.proposalRejection(auth,input.proposal)));
    server.registerTool('proposal_status', { description: 'Read actual state only for an admitted or uncertain requestId. Do not poll an explicitly rejected proposal. Preview awaits manual Apply; queued is never completed.', inputSchema: z.object({ requestId: id }).strict(), _meta: meta, annotations: { readOnlyHint: true } },
      async input => invoke(async () => await store.status(auth, input.requestId) ?? { error: 'REQUEST_NOT_FOUND', requestId:input.requestId, applied:false, recovery:'No request with this ID is recorded in the current share. If propose_scene explicitly rejected it, recover that rejection before resubmitting. For an uncertain submission, reconcile this same ID and current Scene before any retry; never invent a new ID to evade uncertainty.' }));
    server.registerTool('cancel_proposal', { description: 'Cancel a queued request or ask the browser to cancel a pending preview. Never undoes applied changes.', inputSchema: z.object({ requestId: id }).strict(), _meta: meta },
      async input => invoke(async () => ({ requested: await store.cancel(auth, input.requestId) })));
    return server;
  }, { route: '/scene/mcp', responseMode: 'json', authContext: { props: { ...auth } } });
}

// Only finite owned SDK requests are admitted. Bound ids before any tool mutates
// the mailbox, and the complete escaped response before releasing it.
export async function boundedSceneRpc(request: Request, run: (request: Request) => Promise<Response>, referencesEnabled = false): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
  const text = await boundedBody(request), rpc = JSON.parse(text);
  if (!rpc || typeof rpc !== 'object' || Array.isArray(rpc) || rpc.jsonrpc !== '2.0' ||
    !['initialize','notifications/initialized','ping','tools/list','tools/call'].includes(rpc.method) ||
    (rpc.id !== undefined && !(typeof rpc.id === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(rpc.id)) && !(typeof rpc.id === 'number' && Number.isSafeInteger(rpc.id))) ||
    (rpc.method === 'tools/call' && rpc.id === undefined)) return reply({ error: 'SCENE_RPC' }, 400);
  const imageRead = referencesEnabled && rpc.method === 'tools/call' && rpc.params?.name === 'read_shared_reference';
  const responseLimit = imageRead ? REFERENCE_LIMITS.wireBytes : SCENE_LIMITS.wireBytes;
  const response = await run(new Request(request, { body: text }));
  if (!response.body) return response;
  const body = await boundedBody(new Request(request.url, { method: 'POST', body: response.body }), responseLimit);
  const json = response.headers.get('content-type')?.includes('text/event-stream') ? body.split('\n').find(line => line.startsWith('data: '))?.slice(6) : body;
  const data = JSON.parse(json ?? '');
  if (rpc.method === 'tools/list' && data.result?.tools) {
    for (const tool of data.result.tools) tool.securitySchemes = tool._meta.securitySchemes;
  }
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json'); headers.set('Cache-Control', 'no-store'); headers.delete('Content-Length');
  return new Response(sceneJSON(data, responseLimit), { status: response.status, headers });
}

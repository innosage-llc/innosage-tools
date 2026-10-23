import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { SceneMailbox } from './mailbox';
import { boundedBody, reply } from '../http';
import { SCENE_SCOPES, SCENE_LIMITS, sceneJSON, sceneToolResult, type SceneAuth } from '../../../../lib/visual-remix-remote';

export function sceneMcpHandler(db: D1Database, auth: SceneAuth) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'visual-remix-scene', version: '0.1.6' });
    const store = new SceneMailbox(db), id = z.string().regex(/^[a-zA-Z0-9_-]{1,96}$/);
    const meta = { securitySchemes: [{ type: 'oauth2', scopes: [...SCENE_SCOPES] }] };
    const invoke = async (action: () => Promise<unknown>) => {
      if (!await store.lease(auth)) return { isError: true, content: [{ type: 'text' as const, text: 'SCENE_EXPIRED_OR_REVOKED' }] };
      try { return sceneToolResult(await action()); }
      catch { return { isError: true, content: [{ type: 'text' as const, text: 'SCENE_COMMAND_REJECTED' }] }; }
    };
    server.registerTool('get_scene', { description: 'Read explicitly shared editable Scene data. No raster bytes. A suspended browser is unavailable.', inputSchema: z.object({}).strict(), _meta: meta, annotations: { readOnlyHint: true } },
      async () => invoke(async () => await store.snapshot(auth) ?? { error: 'BROWSER_UNAVAILABLE' }));
    server.registerTool('propose_scene', { description: 'Queue one bounded Scene proposal for browser preview. Queued/rendering/preview are pending; Apply and all exports require browser interaction. Use get_scene project/generation/revision, a unique requestId, explanation and full descriptor-only scene.', inputSchema: z.object({ proposal: z.unknown() }).strict(), _meta: meta },
      async input => invoke(async () => await store.propose(auth, input.proposal) ?? { error: 'STALE_OR_BROWSER_UNAVAILABLE' }));
    server.registerTool('proposal_status', { description: 'Read actual request state. Preview awaits manual Apply; queued is never completed.', inputSchema: z.object({ requestId: id }).strict(), _meta: meta, annotations: { readOnlyHint: true } },
      async input => invoke(async () => await store.status(auth, input.requestId) ?? { error: 'UNKNOWN_REQUEST' }));
    server.registerTool('cancel_proposal', { description: 'Cancel a queued request or ask the browser to cancel a pending preview. Never undoes applied changes.', inputSchema: z.object({ requestId: id }).strict(), _meta: meta },
      async input => invoke(async () => ({ requested: await store.cancel(auth, input.requestId) })));
    return server;
  }, { route: '/scene/mcp', responseMode: 'json', authContext: { props: { ...auth } } });
}

// Only finite owned SDK requests are admitted. Bound ids before any tool mutates
// the mailbox, and the complete escaped response before releasing it.
export async function boundedSceneRpc(request: Request, run: (request: Request) => Promise<Response>): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
  const text = await boundedBody(request), rpc = JSON.parse(text);
  if (!rpc || typeof rpc !== 'object' || Array.isArray(rpc) || rpc.jsonrpc !== '2.0' ||
    !['initialize','notifications/initialized','ping','tools/list','tools/call'].includes(rpc.method) ||
    (rpc.id !== undefined && !(typeof rpc.id === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(rpc.id)) && !(typeof rpc.id === 'number' && Number.isSafeInteger(rpc.id))) ||
    (rpc.method === 'tools/call' && rpc.id === undefined)) return reply({ error: 'SCENE_RPC' }, 400);
  const response = await run(new Request(request, { body: text }));
  if (!response.body) return response;
  const body = await boundedBody(new Request(request.url, { method: 'POST', body: response.body }), SCENE_LIMITS.wireBytes);
  const json = response.headers.get('content-type')?.includes('text/event-stream') ? body.split('\n').find(line => line.startsWith('data: '))?.slice(6) : body;
  const data = JSON.parse(json ?? '');
  if (rpc.method === 'tools/list' && data.result?.tools) {
    for (const tool of data.result.tools) tool.securitySchemes = tool._meta.securitySchemes;
  }
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json'); headers.set('Cache-Control', 'no-store'); headers.delete('Content-Length');
  return new Response(sceneJSON(data, SCENE_LIMITS.wireBytes), { status: response.status, headers });
}

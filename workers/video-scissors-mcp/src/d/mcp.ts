import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler, getMcpAuthContext } from 'agents/mcp/server';
import { z } from 'zod';
import { boundedBody, exactObject } from '../http';
import type { DEnv, ProjectAuth } from './types';
import type { ProjectStateDO } from './ProjectStateDO';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,96}$/);
const version = { generation: z.number().int().nonnegative(), version: z.number().int().nonnegative() };
const security = { securitySchemes: [{ type: 'oauth2', scopes: ['video:read','video:edit'] }] };

async function notifyBestEffort(state: { notify(project: string, epoch: number): Promise<void> }, project: string, epoch: number) {
  try { await state.notify(project, epoch); }
  catch { /* Durable admission is authoritative; status/reconnect recovers a missed wakeup. */ }
}

export function dMcpHandler(env: DEnv, props: Record<string, unknown>, origin: string) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'video-scissors-stateless-do-candidate', version: '0.1.0' });
    const invoke = async (scope: string, scopes: string[] | undefined,
      action: (auth: ProjectAuth, project: NonNullable<Awaited<ReturnType<ProjectStateDO['project']>>>) => Promise<unknown>) => {
      const p = getMcpAuthContext()?.props;
      if (!p || typeof p.project !== 'string' || !/^[a-f0-9]{64}$/.test(p.project) || !Number.isSafeInteger(p.epoch) ||
        !Array.isArray(p.scopes) || !p.scopes.includes(scope) || !scopes?.includes(scope)) {
        return { isError: true, content: [{ type: 'text' as const, text: 'INSUFFICIENT_SCOPE' }],
          _meta: { 'mcp/www_authenticate': [`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", scope="${scope}"`] } };
      }
      const auth = { project: p.project, epoch: Number(p.epoch) };
      const state = env.PROJECT_STATE.getByName(auth.project);
      const project = await state.project(auth);
      if (!project) return { isError: true, content: [{ type: 'text' as const, text: 'PROJECT_EXPIRED_OR_REVOKED' }] };
      try { return { content: [{ type: 'text' as const, text: JSON.stringify(await action(auth, project)) }] }; }
      catch { return { isError: true, content: [{ type: 'text' as const, text: 'COMMAND_REJECTED' }] }; }
    };
    const stateFor = (auth: ProjectAuth) => env.PROJECT_STATE.getByName(auth.project);
    server.registerTool('getproject', { description: 'Read allowlisted local video session metadata. No media or file data is relayed.',
      inputSchema: z.object({}).strict(), _meta: security },
    async (_input, context) => invoke('video:read', context.http?.authInfo?.scopes, async (_auth, project) => project));
    server.registerTool('status', { description: 'Read one command status. Claimed commands are never replayed.',
      inputSchema: z.object({ operationId: id }).strict(), _meta: security },
    async (input, context) => invoke('video:read', context.http?.authInfo?.scopes, auth => stateFor(auth).status(auth, input.operationId)));
    server.registerTool('cut', { description: 'Queue one bounded local cut using source seconds and current generation/version; media stays in the browser.',
      inputSchema: z.object({ operationId: id, ...version, clips: z.array(z.object({ start: z.number(), end: z.number() }).strict()).min(1).max(20) }).strict(), _meta: security },
    async (input, context) => invoke('video:edit', context.http?.authInfo?.scopes, async auth => {
      const state = stateFor(auth), result = await state.admit(auth, { ...input, kind: 'cut' });
      if (result?.state === 'queued') await notifyBestEffort(state, auth.project, auth.epoch);
      return result ?? { error: 'STALE_OR_REJECTED' };
    }));
    server.registerTool('undo', { description: 'Queue Undo of the current latest operation; no media is uploaded.',
      inputSchema: z.object({ operationId: id, ...version, targetOperationId: id }).strict(), _meta: security },
    async (input, context) => invoke('video:edit', context.http?.authInfo?.scopes, async auth => {
      const state = stateFor(auth), result = await state.admit(auth, { ...input, kind: 'undo' });
      if (result?.state === 'queued') await notifyBestEffort(state, auth.project, auth.epoch);
      return result ?? { error: 'STALE_OR_REJECTED' };
    }));
    server.registerTool('cancel', { description: 'Cancel this exact queued/claimed operation; never replays dispatched work.',
      inputSchema: z.object({ operationId: id }).strict(), _meta: security },
    async (input, context) => invoke('video:edit', context.http?.authInfo?.scopes, async auth => {
      const state = stateFor(auth), requested = await state.cancel(auth, input.operationId);
      if (requested) await notifyBestEffort(state, auth.project, auth.epoch);
      return { requested };
    }));
    return server;
  }, { route: '/mcp', authContext: { props }, responseMode: 'json' });
}

export async function projectToolSecurity(request: Request, response: Response): Promise<Response> {
  if (request.method !== 'POST' || !response.body) return response;
  let rpc: { method?: string } | null = null;
  try { rpc = await request.clone().json<{ method?: string }>(); } catch { return response; }
  if (rpc?.method !== 'tools/list') return response;
  const raw = await boundedBody(new Request(request.url, { method: 'POST', body: response.body }));
  const json = response.headers.get('content-type')?.includes('text/event-stream')
    ? raw.split('\n').find(line => line.startsWith('data: '))?.slice(6) : raw;
  const data = exactObject(JSON.parse(json ?? ''), ['jsonrpc','id','result','error']);
  if (data.result && typeof data.result === 'object' && 'tools' in data.result && Array.isArray(data.result.tools)) {
    for (const value of data.result.tools) {
      if (!value || typeof value !== 'object' || !('_meta' in value) || !value._meta || typeof value._meta !== 'object' ||
        !('securitySchemes' in value._meta)) throw new Error('TOOL_DESCRIPTOR');
      Object.assign(value, { securitySchemes: value._meta.securitySchemes });
    }
  }
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json'); headers.delete('Content-Length');
  return Response.json(data, { status: response.status, headers });
}

import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler, getMcpAuthContext } from 'agents/mcp/server';
import { z } from 'zod';
import { Mailbox, type ProjectAuth } from './mailbox';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,96}$/);
const version = { generation: z.number().int().nonnegative(), version: z.number().int().nonnegative() };
const security = (_scope: string) => ({ securitySchemes: [{ type: 'oauth2', scopes: ['video:read','video:edit'] }] });
export function mcpHandler(db: D1Database, props: Record<string, unknown>, origin: string, wake?: (auth: ProjectAuth) => Promise<void>) {
  // A new server per request, never isolate-local routing/session state.
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'local-video-scissors', version: '0.1.0' });
    const mailbox = new Mailbox(db);
    const invoke = async (scope: string, tokenScopes: string[] | undefined, action: (auth: ProjectAuth) => Promise<unknown>) => {
      const p = getMcpAuthContext()?.props;
      if (!p || typeof p.project !== 'string' || !Number.isSafeInteger(p.epoch) || !Array.isArray(p.scopes) ||
        !p.scopes.includes(scope) || !tokenScopes?.includes(scope)) {
        return { isError: true, content: [{ type: 'text' as const, text: 'INSUFFICIENT_SCOPE' }],
          _meta: { 'mcp/www_authenticate': [`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", error_description="Additional video control scope required", scope="${scope}"`] } };
      }
      const auth = { project: p.project, epoch: Number(p.epoch) };
      if (!await mailbox.project(auth)) return { isError: true, content: [{ type: 'text' as const, text: 'PROJECT_EXPIRED_OR_REVOKED' }] };
      try { return { content: [{ type: 'text' as const, text: JSON.stringify(await action(auth)) }] }; }
      catch { return { isError: true, content: [{ type: 'text' as const, text: 'COMMAND_REJECTED' }] }; }
    };
    server.registerTool('getproject', { description: 'Read allowlisted local video session metadata. No media access.', inputSchema: z.object({}).strict(), _meta: security('video:read') },
      async (_input, context) => invoke('video:read', context.http?.authInfo?.scopes, auth => mailbox.project(auth)));
    server.registerTool('status', { description: 'Read a single operation status; claimed delivery is never replayed.', inputSchema: z.object({ operationId: id }).strict(), _meta: security('video:read') },
      async (input, context) => invoke('video:read', context.http?.authInfo?.scopes, auth => mailbox.status(auth, input.operationId)));
    server.registerTool('cut', { description: 'Queue one local cut using original seconds and current generation/version. Never uploads media.',
      inputSchema: z.object({ operationId: id, ...version, clips: z.array(z.object({ start: z.number(), end: z.number() }).strict()).min(1).max(20) }).strict(), _meta: security('video:edit') },
      async (input, context) => invoke('video:edit', context.http?.authInfo?.scopes, async auth => {
        const row = await mailbox.admit(auth, { ...input, kind: 'cut' });
        if (row?.state === 'queued') await wake?.(auth).catch(() => {});
        return row ? { operationId: row.id, state: row.state } : { error: 'STALE_OR_REJECTED' };
      }));
    server.registerTool('undo', { description: 'Queue Undo of the latest operation only, with current source generation/version.',
      inputSchema: z.object({ operationId: id, ...version, targetOperationId: id }).strict(), _meta: security('video:edit') },
      async (input, context) => invoke('video:edit', context.http?.authInfo?.scopes, async auth => {
        const row = await mailbox.admit(auth, { ...input, kind: 'undo' });
        if (row?.state === 'queued') await wake?.(auth).catch(() => {});
        return row ? { operationId: row.id, state: row.state } : { error: 'STALE_OR_REJECTED' };
      }));
    server.registerTool('cancel', { description: 'Request cancellation of this exact operation; cannot undo already-dispatched/completed work.',
      inputSchema: z.object({ operationId: id }).strict(), _meta: security('video:edit') },
      async (input, context) => invoke('video:edit', context.http?.authInfo?.scopes, async auth => {
        const requested = await mailbox.cancel(auth, input.operationId);
        if (requested) await wake?.(auth).catch(() => {});
        return { requested };
      }));
    return server;
  }, { route: '/mcp', authContext: { props }, responseMode: 'json' });
}

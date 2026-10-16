import { DurableObject } from 'cloudflare:workers';

const PROTOCOL = 'video-scissors-wakeup.v1';
const WAKE = 'wake';
type Attachment = { project: string; epoch: number; expiresAt: number };
type BridgeEnv = { DB: D1Database };

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const proof = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const hash = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));

// One project-named, hibernatable notification bridge. D1 remains authoritative;
// SQLite stores only short-lived, single-use join-proof hashes.
export class VideoScissorsBridgeDO extends DurableObject<BridgeEnv> {
  private readonly ready: Promise<void>;
  constructor(ctx: DurableObjectState, env: BridgeEnv) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS join_proofs (
        proof_hash TEXT PRIMARY KEY, project TEXT NOT NULL, epoch INTEGER NOT NULL, expires_at INTEGER NOT NULL
      )`);
      ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS join_proofs_expiry ON join_proofs(expires_at)');
    });
  }

  private async lease(project: string, epoch: number): Promise<{ expiresAt: number } | null> {
    const row = await this.env.DB.prepare('SELECT epoch,revoked,expires FROM projects WHERE id=?')
      .bind(project).first<{ epoch: number; revoked: number; expires: number }>();
    if (!row || row.epoch !== epoch || row.revoked !== 0 || row.expires <= Date.now()) return null;
    return { expiresAt: row.expires };
  }

  async mintJoinProof(project: string, epoch: number): Promise<{ proof: string; expiresAt: number } | null> {
    await this.ready;
    const lease = await this.lease(project, epoch);
    if (!lease) return null;
    const now = Date.now(), expiresAt = Math.min(now + 60_000, lease.expiresAt), value = proof();
    if (expiresAt <= now) return null;
    this.ctx.storage.sql.exec('DELETE FROM join_proofs WHERE expires_at<=?', now);
    this.ctx.storage.sql.exec('INSERT INTO join_proofs(proof_hash,project,epoch,expires_at) VALUES(?,?,?,?)',
      await hash(value), project, epoch, expiresAt);
    return { proof: value, expiresAt };
  }

  async consumeJoinProof(project: string, epoch: number, value: string): Promise<boolean> {
    await this.ready;
    if (!/^[a-f0-9]{64}$/.test(value)) return false;
    const rows = this.ctx.storage.sql.exec<{ project: string; epoch: number }>(
      'DELETE FROM join_proofs WHERE proof_hash=? AND project=? AND epoch=? AND expires_at>? RETURNING project,epoch',
      await hash(value), project, epoch, Date.now()).toArray();
    return rows.length === 1 && rows[0].project === project && rows[0].epoch === epoch;
  }

  async notify(project: string, epoch: number): Promise<void> {
    await this.ready;
    const lease = await this.lease(project, epoch);
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (!attachment || attachment.project !== project || attachment.epoch !== epoch) continue;
      if (!lease || lease.expiresAt <= now || attachment.expiresAt <= now) {
        socket.close(1008, 'lease-ended');
        continue;
      }
      try { socket.send(WAKE); } catch { socket.close(1011, 'wake-failed'); }
    }
  }

  async closeProject(project: string, epoch: number): Promise<number> {
    await this.ready;
    const lease = await this.lease(project, epoch);
    if (lease) return 0;
    let closed = 0;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (attachment?.project === project && attachment.epoch === epoch) { socket.close(1008, 'project-revoked'); closed++; }
    }
    return closed;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url), match = /^\/(?:remote\/)?bridge\/([a-f0-9-]{36})\/(\d+)$/.exec(url.pathname);
    if (!match || request.headers.get('upgrade')?.toLowerCase() !== 'websocket' ||
      request.headers.get('sec-websocket-protocol') !== PROTOCOL) return new Response('Not found', { status: 404 });
    const project = match[1], epoch = Number(match[2]), lease = await this.lease(project, epoch);
    if (!Number.isSafeInteger(epoch) || !lease) return new Response('Project expired or revoked', { status: 410 });
    const pair = new WebSocketPair(), [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ project, epoch, expiresAt: lease.expiresAt } satisfies Attachment);
    server.send(WAKE);
    return new Response(null, { status: 101, webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': PROTOCOL } });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ready;
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (!attachment) { socket.close(1008, 'invalid-attachment'); return; }
    const lease = await this.lease(attachment.project, attachment.epoch);
    if (!lease || lease.expiresAt <= Date.now() || attachment.expiresAt <= Date.now()) {
      socket.close(1008, 'lease-ended'); return;
    }
    // The bridge is server-to-client wake-only; all client frames are rejected.
    void message;
    socket.close(1008, 'client-frames-not-supported');
  }

  webSocketClose(): void { /* Hibernatable cleanup is implicit in the socket close. */ }
  webSocketError(socket: WebSocket): void { try { socket.close(1011, 'socket-error'); } catch { /* already closed */ } }
}

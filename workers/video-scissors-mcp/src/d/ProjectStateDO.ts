import { DurableObject } from 'cloudflare:workers';
import { parseRemoteCommand, parseRemoteMetadata, type RemoteCommand, type RemoteMetadata } from '../../../../lib/video-scissors-remote.ts';
import type { BrowserAuth, DEnv, ProjectAuth } from './types';
import { sha256Hex } from './routing';

const WAKE_PROTOCOL = 'video-scissors-wakeup.v1';
const LEASE_MS = 30 * 60_000;
// OAuth access/refresh tokens have a 30-minute maximum lifetime. Keep a
// minimal tombstone for one extra minute after revoke/lease expiry, then purge.
const TOMBSTONE_MS = 31 * 60_000;
const COMMAND_MS = 60_000;
const TICKET_PURPOSE = { consent: 'consent', wake: 'wake' } as const;
type SqlRow = Record<string, string | number | null>;
type ProjectRow = { project_id: string; epoch: number; owner_hash: string; expires_at: number; consented: number; revoked: number; metadata: string };
type Attachment = { project: string; epoch: number; expiresAt: number };
type CommandRow = { operation_id: string; payload_hash: string; payload: string; state: string; deadline: number; cancel_requested: number; result_metadata: string | null };

const projectName = /^[a-f0-9]{64}$/;
const operationName = /^[a-zA-Z0-9_-]{1,96}$/;

// One SQLite authority per verified project. No D1, media, filename, or path is
// accepted here; only bounded command/control metadata is durable.
export class ProjectStateDO extends DurableObject<DEnv> {
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: DEnv) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS project (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), project_id TEXT NOT NULL, epoch INTEGER NOT NULL,
        owner_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, consented INTEGER NOT NULL DEFAULT 0,
        consent_handle_hash TEXT, revoked INTEGER NOT NULL DEFAULT 0, metadata TEXT NOT NULL,
        revocation_owner_hash TEXT, revoked_epoch INTEGER
      )`);
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS route_tickets (
        ticket_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, project_id TEXT NOT NULL,
        epoch INTEGER NOT NULL, expires_at INTEGER NOT NULL
      )`);
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS consent_handles (handle_hash TEXT PRIMARY KEY)`);
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS commands (
        operation_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL, generation INTEGER NOT NULL, version INTEGER NOT NULL,
        payload_hash TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, deadline INTEGER NOT NULL,
        cancel_requested INTEGER NOT NULL DEFAULT 0, owner_hash TEXT, result_metadata TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )`);
      // Legacy d_experiment_budget tables/rows, if present, are left untouched.
      // Tickets are accessed by their primary key; expiry is checked on that row.
      // Drop the unused legacy index without changing ticket data or semantics.
      ctx.storage.sql.exec('DROP INDEX IF EXISTS route_tickets_expiry');
      ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS commands_state ON commands(state)');
    });
  }

  private rows<T extends SqlRow>(sql: string, ...values: (string | number | null)[]): T[] {
    return this.ctx.storage.sql.exec<T>(sql, ...values).toArray();
  }
  private row<T extends SqlRow>(sql: string, ...values: (string | number | null)[]): T | null {
    return this.rows<T>(sql, ...values)[0] ?? null;
  }
  private transaction<T>(operation: () => T): T { return this.ctx.storage.transactionSync(operation); }
  private async current(project: string, epoch: number, needsConsent: boolean): Promise<ProjectRow | null> {
    await this.ready;
    await this.expireIfNeeded();
    if (!projectName.test(project) || !Number.isSafeInteger(epoch) || epoch < 1) return null;
    const row = this.row<ProjectRow>(`SELECT project_id,epoch,owner_hash,expires_at,consented,revoked,metadata FROM project
      WHERE singleton=1 AND project_id=? AND epoch=? AND revoked=0 AND expires_at>? AND (?=0 OR consented=1)`,
      project, epoch, Date.now(), needsConsent ? 1 : 0);
    return row;
  }
  private async expireIfNeeded(): Promise<void> {
    const row = this.row<{ expires_at: number; revoked: number }>('SELECT expires_at,revoked FROM project WHERE singleton=1');
    if (row && !row.revoked && row.expires_at <= Date.now()) await this.cleanupToTombstone();
  }
  private async cleanupToTombstone(receipt?: { ownerHash: string; epoch: number }): Promise<void> {
    const purgeAt = Date.now() + TOMBSTONE_MS;
    this.transaction(() => {
      this.ctx.storage.sql.exec('DELETE FROM route_tickets');
      this.ctx.storage.sql.exec('DELETE FROM consent_handles');
      this.ctx.storage.sql.exec('DELETE FROM commands');
      this.ctx.storage.sql.exec(`UPDATE project SET revoked=1,consented=0,owner_hash='',consent_handle_hash=NULL,
        metadata='{}',epoch=epoch+1,expires_at=?,revocation_owner_hash=?,revoked_epoch=?
        WHERE singleton=1 AND revoked=0`, purgeAt, receipt?.ownerHash ?? null, receipt?.epoch ?? null);
    });
    // Replacing the lease alarm with the tombstone-purge alarm is essential:
    // terminal state is bounded, but never left behind indefinitely.
    await this.ctx.storage.setAlarm(purgeAt);
    this.closeSockets();
  }
  private async purgeTombstone(): Promise<void> {
    this.transaction(() => {
      this.ctx.storage.sql.exec('DELETE FROM route_tickets');
      this.ctx.storage.sql.exec('DELETE FROM consent_handles');
      this.ctx.storage.sql.exec('DELETE FROM commands');
      this.ctx.storage.sql.exec('DELETE FROM project WHERE singleton=1 AND revoked=1 AND expires_at<=?', Date.now());
    });
    await this.ctx.storage.deleteAlarm();
    this.closeSockets();
  }
  private closeSockets(): number {
    let closed = 0;
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.close(1008, 'project-ended'); closed++; } catch { /* already closed */ }
    }
    return closed;
  }

  async createProject(input: { project: string; epoch: number; ownerHash: string; expiresAt: number; consentTicket: string; ticketExpiresAt: number }): Promise<boolean> {
    await this.ready;
    const now = Date.now();
    if (!projectName.test(input.project) || input.project !== input.ownerHash || input.epoch !== 1 ||
      input.expiresAt <= now || input.expiresAt > now + LEASE_MS || input.ticketExpiresAt <= now ||
      input.ticketExpiresAt > Math.min(now + 300_000, input.expiresAt) || input.consentTicket.length > 160) return false;
    const ticketHash = await sha256Hex(input.consentTicket);
    const metadata: RemoteMetadata = { duration: 0, generation: 0, version: 0, hasOutput: false,
      canUndo: false, latestOperationId: null, errorCode: 'NONE' };
    const made = this.transaction(() => {
      if (this.row('SELECT singleton FROM project WHERE singleton=1')) return false;
      this.ctx.storage.sql.exec(`INSERT INTO project(singleton,project_id,epoch,owner_hash,expires_at,metadata)
        VALUES(1,?,?,?,?,?)`, input.project, input.epoch, input.ownerHash, input.expiresAt, JSON.stringify(metadata));
      this.ctx.storage.sql.exec(`INSERT INTO route_tickets(ticket_hash,purpose,project_id,epoch,expires_at)
        VALUES(?,?,?,?,?)`, ticketHash, TICKET_PURPOSE.consent, input.project, input.epoch, input.ticketExpiresAt);
      return true;
    });
    if (made) await this.ctx.storage.setAlarm(input.expiresAt);
    return made;
  }

  async bindConsentTicket(input: { project: string; epoch: number; ticket: string; handleHash: string }): Promise<ProjectAuth | null> {
    await this.ready;
    const ticketHash = await sha256Hex(input.ticket), now = Date.now();
    return this.transaction(() => {
      const project = this.row<ProjectRow>(`SELECT project_id,epoch,owner_hash,expires_at,consented,revoked,metadata FROM project
        WHERE singleton=1 AND project_id=? AND epoch=? AND revoked=0 AND expires_at>?`, input.project, input.epoch, now);
      if (!project || project.consented || !/^[a-f0-9]{64}$/.test(input.handleHash) ||
        this.row('SELECT handle_hash FROM consent_handles WHERE handle_hash=?', input.handleHash)) return null;
      const consumed = this.row<{ ticket_hash: string }>(`DELETE FROM route_tickets WHERE ticket_hash=? AND purpose='consent'
        AND project_id=? AND epoch=? AND expires_at>? RETURNING ticket_hash`, ticketHash, input.project, input.epoch, now);
      if (!consumed) return null;
      this.ctx.storage.sql.exec('INSERT INTO consent_handles(handle_hash) VALUES(?)', input.handleHash);
      this.ctx.storage.sql.exec('UPDATE project SET consented=1,consent_handle_hash=? WHERE singleton=1', input.handleHash);
      return { project: input.project, epoch: input.epoch };
    });
  }

  async project(auth: ProjectAuth): Promise<{ metadata: RemoteMetadata; expiresAt: number } | null> {
    const row = await this.current(auth.project, auth.epoch, true);
    if (!row) return null;
    try { return { metadata: parseRemoteMetadata(JSON.parse(row.metadata)), expiresAt: row.expires_at }; } catch { return null; }
  }
  async owner(auth: BrowserAuth): Promise<{ expiresAt: number } | null> {
    const row = await this.current(auth.project, auth.epoch, false);
    if (!row || row.owner_hash !== await sha256Hex(auth.credential)) return null;
    return { expiresAt: row.expires_at };
  }
  async sync(auth: BrowserAuth, input: unknown): Promise<{ ok: boolean; consented: boolean }> {
    const metadata = parseRemoteMetadata(input), serialized = JSON.stringify(metadata), ownerHash = await sha256Hex(auth.credential);
    const row = await this.current(auth.project, auth.epoch, false);
    if (!row || row.owner_hash !== ownerHash) return { ok: false, consented: false };
    const synced = this.transaction(() => this.row<{ consented: number }>(`UPDATE project SET metadata=? WHERE singleton=1 AND project_id=? AND epoch=?
      AND owner_hash=? AND revoked=0 AND expires_at>? AND
      (json_extract(metadata,'$.generation') IS NULL OR (? >= json_extract(metadata,'$.generation') AND ? >= json_extract(metadata,'$.version')))
      RETURNING consented`, serialized, auth.project, auth.epoch, ownerHash, Date.now(), metadata.generation, metadata.version));
    return { ok: !!synced, consented: synced?.consented === 1 };
  }
  async status(auth: ProjectAuth, operationId: string): Promise<{ operationId: string; state: string; cancelRequested: boolean; metadata: RemoteMetadata | null } | null> {
    if (!operationName.test(operationId) || !await this.current(auth.project, auth.epoch, true)) return null;
    const row = this.row<CommandRow>('SELECT operation_id,payload_hash,payload,state,deadline,cancel_requested,result_metadata FROM commands WHERE operation_id=? AND epoch=?', operationId, auth.epoch);
    if (!row) return null;
    return { operationId: row.operation_id, state: row.state, cancelRequested: row.cancel_requested === 1,
      metadata: row.result_metadata ? parseRemoteMetadata(JSON.parse(row.result_metadata)) : null };
  }
  async admit(auth: ProjectAuth, input: unknown): Promise<{ operationId: string; state: string } | null> {
    await this.ready;
    const command = parseRemoteCommand(input), payload = JSON.stringify(command), payloadHash = await sha256Hex(payload);
    return this.transaction(() => {
      // Hashing yields to other DO requests. Re-read the consent/epoch/revoke/
      // lease fence and metadata inside the exact transaction that may insert.
      const now = Date.now();
      const project = this.row<ProjectRow>(`SELECT project_id,epoch,owner_hash,expires_at,consented,revoked,metadata FROM project
        WHERE singleton=1 AND project_id=? AND epoch=? AND revoked=0 AND consented=1 AND expires_at>?`, auth.project, auth.epoch, now);
      if (!project) return null;
      let currentMetadata: RemoteMetadata;
      try { currentMetadata = parseRemoteMetadata(JSON.parse(project.metadata)); } catch { return null; }
      if (command.generation !== currentMetadata.generation || command.version !== currentMetadata.version ||
        (command.kind === 'undo' && (!currentMetadata.canUndo || command.targetOperationId !== currentMetadata.latestOperationId))) return null;
      const existing = this.row<CommandRow>('SELECT operation_id,payload_hash,payload,state,deadline,cancel_requested,result_metadata FROM commands WHERE operation_id=?', command.operationId);
      if (existing) return existing.payload_hash === payloadHash ? { operationId: existing.operation_id, state: existing.state } : null;
      const active = this.row<{ operation_id: string }>("SELECT operation_id FROM commands WHERE state IN ('queued','claimed') LIMIT 1");
      if (active) return null;
      this.ctx.storage.sql.exec(`INSERT INTO commands(operation_id,epoch,generation,version,payload_hash,payload,state,deadline,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'queued',?,?,?)`, command.operationId, auth.epoch, command.generation, command.version,
        payloadHash, payload, now + COMMAND_MS, now, now);
      return { operationId: command.operationId, state: 'queued' };
    });
  }
  async claim(auth: BrowserAuth, input: unknown): Promise<RemoteCommand | null> {
    await this.ready;
    const metadata = parseRemoteMetadata(input), ownerHash = await sha256Hex(auth.credential);
    return this.transaction(() => {
      // As with admission, the owner/consent/epoch/revoke/lease fence and
      // version check are re-read after the async hash and in the claim txn.
      const now = Date.now();
      const project = this.row<ProjectRow>(`SELECT project_id,epoch,owner_hash,expires_at,consented,revoked,metadata FROM project
        WHERE singleton=1 AND project_id=? AND epoch=? AND revoked=0 AND consented=1 AND expires_at>? AND owner_hash=?`,
        auth.project, auth.epoch, now, ownerHash);
      if (!project) return null;
      let currentMetadata: RemoteMetadata;
      try { currentMetadata = parseRemoteMetadata(JSON.parse(project.metadata)); } catch { return null; }
      if (metadata.generation !== currentMetadata.generation || metadata.version !== currentMetadata.version) return null;
      this.ctx.storage.sql.exec(`UPDATE commands SET state='stale',updated_at=? WHERE state='queued' AND
        (deadline<=? OR generation!=? OR version!=? OR
          (json_extract(payload,'$.kind')='undo' AND
            (?=0 OR json_extract(payload,'$.targetOperationId') IS NOT ?)))`,
        now, now, metadata.generation, metadata.version, currentMetadata.canUndo ? 1 : 0, currentMetadata.latestOperationId);
      const row = this.row<{ payload: string }>(`UPDATE commands SET state='claimed',owner_hash=?,updated_at=? WHERE operation_id=(
        SELECT operation_id FROM commands WHERE state='queued' AND epoch=? AND generation=? AND version=?
          AND deadline>? AND cancel_requested=0 AND (json_extract(payload,'$.kind')!='undo' OR
            (?=1 AND json_extract(payload,'$.targetOperationId')=?)) AND EXISTS(SELECT 1 FROM project p WHERE p.singleton=1
            AND p.project_id=? AND p.epoch=? AND p.revoked=0 AND p.consented=1 AND p.expires_at>? AND p.owner_hash=?)
          ORDER BY created_at LIMIT 1)
        AND state='queued' RETURNING payload`, ownerHash, now, auth.epoch, metadata.generation, metadata.version, now,
        currentMetadata.canUndo ? 1 : 0, currentMetadata.latestOperationId, auth.project, auth.epoch, now, ownerHash);
      return row ? parseRemoteCommand(JSON.parse(row.payload)) : null;
    });
  }
  async report(auth: BrowserAuth, operationId: string, state: string, input: unknown): Promise<boolean> {
    if (!operationName.test(operationId) || !['completed','failed','cancelled','stale'].includes(state)) return false;
    const metadata = JSON.stringify(parseRemoteMetadata(input)), ownerHash = await sha256Hex(auth.credential), now = Date.now();
    const project = await this.current(auth.project, auth.epoch, false);
    if (!project || project.owner_hash !== ownerHash) return false;
    return this.transaction(() => {
      const changed = this.row<{ operation_id: string }>(`UPDATE commands SET state=?,result_metadata=?,updated_at=?
        WHERE operation_id=? AND epoch=? AND state='claimed' AND owner_hash=? RETURNING operation_id`,
        state, metadata, now, operationId, auth.epoch, ownerHash);
      if (changed) return true;
      const duplicate = this.row<{ operation_id: string }>(`SELECT operation_id FROM commands WHERE operation_id=? AND epoch=?
        AND state=? AND owner_hash=? AND result_metadata=?`, operationId, auth.epoch, state, ownerHash, metadata);
      return !!duplicate;
    });
  }
  async cancel(auth: ProjectAuth, operationId: string): Promise<boolean> {
    if (!operationName.test(operationId) || !await this.current(auth.project, auth.epoch, true)) return false;
    return !!this.transaction(() => this.row<{ operation_id: string }>(`UPDATE commands SET cancel_requested=1,
      state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END,updated_at=?
      WHERE operation_id=? AND epoch=? AND state IN ('queued','claimed') RETURNING operation_id`, Date.now(), operationId, auth.epoch));
  }
  async cancellation(auth: BrowserAuth, operationId: string): Promise<boolean> {
    if (!operationName.test(operationId)) return true;
    const project = await this.current(auth.project, auth.epoch, false);
    if (!project || project.owner_hash !== await sha256Hex(auth.credential)) return true;
    const row = this.row<{ cancel_requested: number }>('SELECT cancel_requested FROM commands WHERE operation_id=? AND epoch=?', operationId, auth.epoch);
    return !row || row.cancel_requested === 1;
  }
  async revoke(auth: BrowserAuth): Promise<boolean> {
    const ownerHash = await sha256Hex(auth.credential), project = await this.current(auth.project, auth.epoch, false);
    if (!project) {
      // A lost revoke ACK can be confirmed only by the same owner, exact
      // original epoch, and while the non-reusable tombstone is retained.
      await this.ready;
      const receipt = this.row<{ project_id: string; revoked: number; expires_at: number;
        revocation_owner_hash: string | null; revoked_epoch: number | null }>(`SELECT project_id,revoked,expires_at,
        revocation_owner_hash,revoked_epoch FROM project WHERE singleton=1 AND project_id=?`, auth.project);
      return !!receipt && receipt.revoked === 1 && receipt.expires_at > Date.now() &&
        receipt.revoked_epoch === auth.epoch && receipt.revocation_owner_hash === ownerHash;
    }
    if (project.owner_hash !== ownerHash) return false;
    await this.cleanupToTombstone({ ownerHash, epoch: auth.epoch });
    return true;
  }
  async registerWakeTicket(auth: BrowserAuth, ticket: string, expiresAt: number): Promise<boolean> {
    await this.ready;
    if (ticket.length < 1 || ticket.length > 160 || !projectName.test(auth.project) ||
      !Number.isSafeInteger(auth.epoch) || auth.epoch < 1) return false;
    const ownerHash = await sha256Hex(auth.credential);
    const ticketHash = await sha256Hex(ticket);
    return !!this.transaction(() => {
      // Hashing yields to revoke/expiry. Fence ticket insertion in its own
      // transaction so cleanup cannot be followed by a late credential write.
      const now = Date.now();
      const project = this.row<ProjectRow>(`SELECT project_id,epoch,owner_hash,expires_at,consented,revoked,metadata FROM project
        WHERE singleton=1 AND project_id=? AND epoch=? AND revoked=0 AND expires_at>? AND owner_hash=?`,
        auth.project, auth.epoch, now, ownerHash);
      if (!project || expiresAt <= now || expiresAt > Math.min(now + 60_000, project.expires_at)) return false;
      return !!this.row(`INSERT INTO route_tickets(ticket_hash,purpose,project_id,epoch,expires_at)
        VALUES(?,'wake',?,?,?) RETURNING ticket_hash`, ticketHash, auth.project, auth.epoch, expiresAt);
    });
  }

  async notify(project: string, epoch: number): Promise<void> {
    if (!await this.current(project, epoch, true)) return;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (attachment?.project !== project || attachment.epoch !== epoch || attachment.expiresAt <= Date.now()) continue;
      try { socket.send('wake'); } catch { try { socket.close(1011, 'wake-failed'); } catch { /* closed */ } }
    }
  }
  async closeProject(project: string, epoch: number): Promise<number> {
    const row = this.row<{ project_id: string; revoked: number; expires_at: number; epoch: number }>('SELECT project_id,revoked,expires_at,epoch FROM project WHERE singleton=1');
    if (row && row.project_id === project && row.epoch === epoch && !row.revoked && row.expires_at > Date.now()) return 0;
    return this.closeSockets();
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const path = new URL(request.url).pathname;
    const match = /^\/remote\/bridge\/([a-f0-9]{64})\/(\d+)$/.exec(path);
    const protocols = request.headers.get('sec-websocket-protocol')?.split(',').map(value => value.trim()) ?? [];
    const ticket = protocols.find(value => value.startsWith('join.'))?.slice(5) ?? '';
    if (!match || request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket' ||
      protocols.length !== 2 || !protocols.includes(WAKE_PROTOCOL) || !/^[a-f0-9]{64}$/.test(ticket)) return new Response('Not found', { status: 404 });
    const project = match[1], epoch = Number(match[2]), current = await this.current(project, epoch, false), now = Date.now();
    if (!current) return new Response('Project unavailable', { status: 410 });
    const ticketHash = await sha256Hex(ticket);
    const consumed = this.transaction(() => this.row<{ ticket_hash: string }>(`DELETE FROM route_tickets WHERE ticket_hash=? AND purpose='wake'
      AND project_id=? AND epoch=? AND expires_at>? RETURNING ticket_hash`, ticketHash, project, epoch, now));
    if (!consumed) return new Response('Join proof rejected', { status: 401 });
    const pair = new WebSocketPair(), [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    // The one-minute proof authorizes joining only; an established socket is
    // valid for the project lease, matching the existing bridge contract.
    server.serializeAttachment({ project, epoch, expiresAt: current.expires_at } satisfies Attachment);
    server.send('wake');
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': WAKE_PROTOCOL } });
  }
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    void message;
    try { socket.close(1008, 'server-to-client-only'); } catch { /* closed */ }
  }
  webSocketClose(): void { /* Hibernating socket lifecycle is managed by the runtime. */ }
  webSocketError(socket: WebSocket): void { try { socket.close(1011, 'socket-error'); } catch { /* closed */ } }
  async alarm(): Promise<void> {
    await this.ready;
    const row = this.row<{ revoked: number; expires_at: number }>('SELECT revoked,expires_at FROM project WHERE singleton=1');
    if (!row) { await this.ctx.storage.deleteAlarm(); return; }
    if (row.revoked) {
      if (row.expires_at > Date.now()) { await this.ctx.storage.setAlarm(row.expires_at); return; }
      await this.purgeTombstone();
      return;
    }
    if (row.expires_at > Date.now()) { await this.ctx.storage.setAlarm(row.expires_at); return; }
    await this.cleanupToTombstone();
  }
}

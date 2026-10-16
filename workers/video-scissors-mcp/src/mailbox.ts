import { parseRemoteCommand, parseRemoteMetadata, type RemoteCommand } from '../../../lib/video-scissors-remote.ts';

export const digest = async (text: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
const secret = (): string => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
export type ProjectAuth = { project: string; epoch: number };
export type BrowserAuth = ProjectAuth & { credential: string };
type CommandRow = { id: string; payload_hash: string; payload: string; state: string; deadline: number };
const live = 'p.id=? AND p.epoch=? AND p.revoked=0 AND p.expires>? AND p.consent_hash IS NOT NULL';

// Internal repository API, NOT an HTTP authentication layer. Production routes
// stay disabled until official consent + approved scopes supply ProjectAuth.
export class Mailbox {
  private readonly db: D1DatabaseSession;
  constructor(db: D1Database) { this.db = db.withSession('first-primary'); }
  async initialize(): Promise<void> {
    await this.db.prepare('INSERT OR IGNORE INTO experiment(singleton,started) VALUES(1,?)').bind(Date.now()).run();
  }
  async spend(kind: 'http' | 'oauth' | 'dcr'): Promise<void> {
    const limit = kind === 'http' ? 2000 : 20;
    const r = await this.db.prepare(`UPDATE experiment SET ${kind}=${kind}+1 WHERE singleton=1 AND ${kind}<? RETURNING singleton`).bind(limit).first();
    if (!r) throw new Error('BUDGET');
  }
  async create(): Promise<{ project: string; epoch: number; credential: string; proof: string }> {
    const project = crypto.randomUUID(), credential = secret(), proof = secret(), now = Date.now();
    await this.db.prepare('INSERT INTO projects(id,credential_hash,proof_hash,proof_expires,expires) VALUES(?,?,?,?,?)')
      .bind(project, await digest(credential), await digest(proof), now + 300_000, now + 1_800_000).run();
    return { project, epoch: 1, credential, proof };
  }
  // Call with the official server-bound consent handle, never a form project ID.
  // Trigger insert of UNIQUE tombstone and proof consumption are one SQL mutation.
  async bindProof(project: string, proof: string, consentHandle: string): Promise<ProjectAuth | null> {
    const row = await this.db.prepare(`UPDATE projects SET consent_hash=?,proof_hash=NULL
      WHERE id=? AND proof_hash=? AND proof_expires>? AND expires>? AND revoked=0 AND consent_hash IS NULL
      RETURNING id,epoch`).bind(await digest(consentHandle), project, await digest(proof), Date.now(), Date.now()).first<{id: string; epoch: number}>();
    return row ? { project: row.id, epoch: row.epoch } : null;
  }
  async consentProject(handle: string): Promise<ProjectAuth | null> {
    const row = await this.db.prepare(`SELECT p.id,p.epoch FROM consent_bindings b JOIN projects p ON p.id=b.project
      WHERE b.handle_hash=? AND b.epoch=p.epoch AND b.expires>? AND p.revoked=0 AND p.expires>?`)
      .bind(await digest(handle), Date.now(), Date.now()).first<{id: string; epoch: number}>();
    return row ? { project: row.id, epoch: row.epoch } : null;
  }
  async bindFromProof(proof: string, handle: string): Promise<ProjectAuth | null> {
    if (!/^[a-f0-9]{64}$/.test(proof) || handle.length > 512) return null;
    const row = await this.db.prepare('SELECT id FROM projects WHERE proof_hash=? AND proof_expires>? AND expires>? AND revoked=0')
      .bind(await digest(proof), Date.now(), Date.now()).first<{id: string}>();
    return row ? this.bindProof(row.id, proof, handle) : null;
  }
  async project(auth: ProjectAuth) {
    const row = await this.db.prepare(`SELECT p.metadata,p.expires FROM projects p WHERE ${live}`)
      .bind(auth.project, auth.epoch, Date.now()).first<{metadata: string; expires: number}>();
    return row ? { metadata: parseRemoteMetadata(JSON.parse(row.metadata)), expiresAt: row.expires } : null;
  }
  // Bridge proofs are minted only for the browser owner credential and current
  // lease. Consent may still be pending so the socket can receive its approval
  // wakeup; all command authority remains behind the consent-aware `live` fence.
  async bridgeOwner(auth: BrowserAuth): Promise<{expiresAt: number} | null> {
    const row = await this.db.prepare(`SELECT expires FROM projects WHERE id=? AND epoch=?
      AND revoked=0 AND expires>? AND credential_hash=?`)
      .bind(auth.project, auth.epoch, Date.now(), await digest(auth.credential)).first<{expires: number}>();
    return row ? { expiresAt: row.expires } : null;
  }
  async bridgeLease(auth: ProjectAuth): Promise<{expiresAt: number} | null> {
    const row = await this.db.prepare(`SELECT expires FROM projects WHERE id=? AND epoch=? AND revoked=0 AND expires>?`)
      .bind(auth.project, auth.epoch, Date.now()).first<{expires: number}>();
    return row ? { expiresAt: row.expires } : null;
  }
  async status(auth: ProjectAuth, id: string) {
    const row = await this.db.prepare(`SELECT c.id,c.state,c.cancel_requested,c.result_metadata FROM commands c JOIN projects p ON p.id=c.project
      WHERE ${live} AND c.epoch=p.epoch AND c.id=?`)
      .bind(auth.project, auth.epoch, Date.now(), id).first<{id: string; state: string; cancel_requested: number; result_metadata: string | null}>();
    return row ? { operationId: row.id, state: row.state, cancelRequested: row.cancel_requested === 1,
      metadata: row.result_metadata ? parseRemoteMetadata(JSON.parse(row.result_metadata)) : null } : null;
  }
  async admit(auth: ProjectAuth, input: unknown, deadline = Date.now() + 60_000): Promise<CommandRow | null> {
    const c = parseRemoteCommand(input), payload = JSON.stringify(c), hash = await digest(payload), now = Date.now();
    if (deadline <= now || deadline > now + 60_000) throw new Error('DEADLINE');
    // Every authorization/version/deadline predicate is in admission itself.
    // A partial unique index forbids a second queued OR claimed operation.
    const admitted = await this.db.prepare(`INSERT INTO commands(project,id,epoch,generation,version,payload_hash,payload,state,deadline)
      SELECT p.id,?,p.epoch,?,?,?,?,'queued',? FROM projects p WHERE ${live}
      AND json_extract(p.metadata,'$.generation')=? AND json_extract(p.metadata,'$.version')=?
      AND ?<p.expires
      ON CONFLICT(project,id) DO NOTHING
      RETURNING id,payload_hash,payload,state,deadline`)
      .bind(c.operationId, c.generation, c.version, hash, payload, deadline, auth.project, auth.epoch, now, c.generation, c.version, now).first<CommandRow>();
    if (admitted) return admitted;
    const duplicate = await this.db.prepare(`SELECT c.id,c.payload_hash,c.payload,c.state,c.deadline FROM commands c JOIN projects p ON c.project=p.id
      WHERE ${live} AND c.epoch=p.epoch AND c.id=?`).bind(auth.project, auth.epoch, Date.now(), c.operationId).first<CommandRow>();
    if (duplicate?.payload_hash !== undefined && duplicate.payload_hash !== hash) throw new Error('ID_CONFLICT');
    if (duplicate?.state === 'queued' && duplicate.deadline <= Date.now()) throw new Error('QUEUED_EXPIRED');
    return duplicate;
  }
  async sync(auth: BrowserAuth, input: unknown): Promise<boolean> {
    const metadata = JSON.stringify(parseRemoteMetadata(input));
    const m = parseRemoteMetadata(input);
    const r = await this.db.prepare(`UPDATE projects AS p SET metadata=? WHERE ${live} AND credential_hash=?
      AND (json_extract(metadata,'$.generation') IS NULL OR
        (? >= json_extract(metadata,'$.generation') AND ? >= json_extract(metadata,'$.version')))
      RETURNING id`)
      .bind(metadata, auth.project, auth.epoch, Date.now(), await digest(auth.credential), m.generation, m.version).first();
    return !!r;
  }
  async claim(auth: BrowserAuth, input: unknown): Promise<RemoteCommand | null> {
    return (await this.claimMeasured(auth, input)).command;
  }
  private async claimMeasured(auth: BrowserAuth, input: unknown) {
    const m = parseRemoteMetadata(input), owner = await digest(auth.credential), now = Date.now();
    // Expired/stale queued work is terminal, never dispatch it. Claimed work is
    // deliberately excluded: no timeout can release its uncertain active slot.
    const retired = await this.db.prepare(`UPDATE commands SET state='stale' WHERE project=? AND state='queued'
      AND (deadline<=? OR EXISTS(SELECT 1 FROM projects p WHERE p.id=commands.project
        AND (commands.epoch!=p.epoch OR commands.generation!=json_extract(p.metadata,'$.generation')
          OR commands.version!=json_extract(p.metadata,'$.version'))))
      AND EXISTS(SELECT 1 FROM projects p WHERE ${live} AND p.credential_hash=?)`)
      .bind(auth.project, now, auth.project, auth.epoch, now, owner).run();
    const claimed = await this.db.prepare(`UPDATE commands SET state='claimed',owner_hash=? WHERE project=? AND state='queued'
      AND epoch=? AND generation=? AND version=? AND deadline>? AND cancel_requested=0
      AND EXISTS(SELECT 1 FROM projects p WHERE ${live} AND p.credential_hash=?
        AND json_extract(p.metadata,'$.generation')=? AND json_extract(p.metadata,'$.version')=?)
      RETURNING payload`).bind(owner, auth.project, auth.epoch, m.generation, m.version, now,
      auth.project, auth.epoch, now, owner, m.generation, m.version).all<{payload: string}>();
    const row = claimed.results[0];
    return { command: row ? parseRemoteCommand(JSON.parse(row.payload)) : null,
      queries: 2, rowsRead: retired.meta.rows_read + claimed.meta.rows_read,
      rowsWritten: retired.meta.rows_written + claimed.meta.rows_written,
      dbMilliseconds: retired.meta.duration + claimed.meta.duration };
  }
  // Finite HTTP long-poll, no browser visibility timer or application DO.
  // Primary reads plus atomic claim: at most 8*3=24 SQL queries (+ fixture budget/init).
  async poll(auth: BrowserAuth, input: unknown, signal: AbortSignal) {
    const m = parseRemoteMetadata(input), owner = await digest(auth.credential), started = Date.now();
    const stats = { checks: 0, queries: 0, rowsRead: 0, rowsWritten: 0, dbMilliseconds: 0 };
    for (let i = 0; i < 8 && !signal.aborted && Date.now() - started < 25_000; i++) {
      const current = await this.db.prepare(`SELECT p.metadata FROM projects p WHERE ${live} AND p.credential_hash=?`)
        .bind(auth.project, auth.epoch, Date.now(), owner).all<{metadata: string}>();
      stats.checks++; stats.queries++; stats.rowsRead += current.meta.rows_read;
      stats.rowsWritten += current.meta.rows_written; stats.dbMilliseconds += current.meta.duration;
      const row = current.results[0];
      const fresh = row ? parseRemoteMetadata(JSON.parse(row.metadata)) : null;
      if (signal.aborted || Date.now() - started >= 25_000) break;
      if (!fresh || fresh.generation !== m.generation || fresh.version !== m.version) {
        return { command: null, refresh: true, ...stats, wallMilliseconds: Date.now() - started, cpuMilliseconds: null };
      }
      const cycle = await this.claimMeasured(auth, m);
      stats.queries += cycle.queries; stats.rowsRead += cycle.rowsRead;
      stats.rowsWritten += cycle.rowsWritten; stats.dbMilliseconds += cycle.dbMilliseconds;
      if (cycle.command) return { ...stats, command: cycle.command, refresh: false, wallMilliseconds: Date.now() - started, cpuMilliseconds: null };
      if (i < 7) await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, Math.min(3000, Math.max(0, 25_000 - (Date.now() - started))));
        signal.addEventListener('abort', finish, { once: true });
      });
    }
    return { command: null, refresh: false, ...stats, wallMilliseconds: Date.now() - started, cpuMilliseconds: null };
  }
  async report(auth: BrowserAuth, id: string, state: string, input: unknown): Promise<boolean> {
    if (!['completed','failed','cancelled','stale'].includes(state)) throw new Error('TRANSITION');
    const m = JSON.stringify(parseRemoteMetadata(input)), owner = await digest(auth.credential), now = Date.now();
    const r = await this.db.prepare(`UPDATE commands SET state=?,result_metadata=? WHERE project=? AND id=? AND epoch=?
      AND state='claimed' AND owner_hash=?
      AND EXISTS(SELECT 1 FROM projects p WHERE ${live} AND p.credential_hash=?) RETURNING id`)
      .bind(state, m, auth.project, id, auth.epoch, owner, auth.project, auth.epoch, now, owner).first();
    if (r) return true;
    // Lost HTTP ACK after commit: the exact owner/result may acknowledge again,
    // without another state transition or metadata trigger. No terminal revival.
    return !!await this.db.prepare(`SELECT c.id FROM commands c JOIN projects p ON c.project=p.id
      WHERE ${live} AND p.credential_hash=? AND c.owner_hash=? AND c.id=?
      AND c.epoch=p.epoch AND c.state=? AND c.result_metadata=?`)
      .bind(auth.project, auth.epoch, now, owner, owner, id, state, m).first();
  }
  async cancel(auth: ProjectAuth, id: string): Promise<boolean> {
    const r = await this.db.prepare(`UPDATE commands SET cancel_requested=1,state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END
      WHERE project=? AND id=? AND epoch=? AND state IN ('queued','claimed')
      AND EXISTS(SELECT 1 FROM projects p WHERE ${live}) RETURNING id`)
      .bind(auth.project, id, auth.epoch, auth.project, auth.epoch, Date.now()).first();
    return !!r;
  }
  async cancellation(auth: BrowserAuth, id: string): Promise<boolean> {
    const r = await this.db.prepare(`SELECT c.cancel_requested FROM commands c JOIN projects p ON p.id=c.project
      WHERE ${live} AND p.credential_hash=? AND c.owner_hash=? AND c.id=? AND c.epoch=?`)
      .bind(auth.project, auth.epoch, Date.now(), await digest(auth.credential), await digest(auth.credential), id, auth.epoch).first<{cancel_requested: number}>();
    // Expired/revoked ownership is also a stop signal, not permission to replay.
    return !r || r.cancel_requested === 1;
  }
  async revoke(auth: BrowserAuth): Promise<boolean> {
    const r = await this.db.prepare('UPDATE projects SET revoked=1,epoch=epoch+1 WHERE id=? AND epoch=? AND credential_hash=? RETURNING id')
      .bind(auth.project, auth.epoch, await digest(auth.credential)).first();
    return !!r || !!await this.db.prepare('SELECT id FROM projects WHERE id=? AND epoch=? AND revoked=1 AND credential_hash=?')
      .bind(auth.project, auth.epoch + 1, await digest(auth.credential)).first();
  }
  async cancellationPoll(auth: BrowserAuth, id: string, signal: AbortSignal): Promise<boolean> {
    for (let i = 0; i < 8 && !signal.aborted; i++) {
      if (await this.cancellation(auth, id)) return true;
      if (i < 7) await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, 3000);
        signal.addEventListener('abort', finish, { once: true });
      });
    }
    return false;
  }
}

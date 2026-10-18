import worker from '../src/index-d.ts';
import { ProjectStateDO } from '../src/d/ProjectStateDO.ts';
import type { BrowserAuth, ProjectAuth } from '../src/d/types.ts';

// Local fixture-only subclass: accelerates the real alarm path without
// adding a production route or shortening the production tombstone lifetime.
export class TestProjectStateDO extends ProjectStateDO {
  private readonly resourceCursors: SqlStorageCursor[];
  private projectCalls = 0;
  private revokeAfterRead: BrowserAuth | null = null;
  private failProjectReadAt: number | null = null;
  constructor(ctx: DurableObjectState, env: ConstructorParameters<typeof ProjectStateDO>[1]) {
    const cursors: SqlStorageCursor[] = [];
    // Test-only observation: retain native objects and their receiver.
    // No query/value capture, production route, timer or alternative storage.
    const sql = ctx.storage.sql;
    const exec = sql.exec.bind(sql);
    Object.defineProperty(sql, 'exec', { value: (...args: Parameters<SqlStorage['exec']>) => {
      const cursor = exec(...args); cursors.push(cursor); return cursor;
    } });
    super(ctx, env);
    this.resourceCursors = cursors;
  }
  override async project(auth: ProjectAuth) {
    this.projectCalls++;
    if (this.projectCalls === this.failProjectReadAt) {
      this.failProjectReadAt = null;
      throw new Error('fixture project RPC failed');
    }
    const project = await super.project(auth);
    const revoke = this.revokeAfterRead;
    if (project && revoke?.project === auth.project && revoke.epoch === auth.epoch) {
      this.revokeAfterRead = null;
      if (!await super.revoke(revoke)) throw new Error('fixture revoke failed');
    }
    return project;
  }
  async revokeAfterNextProjectReadForTest(auth: BrowserAuth) { this.revokeAfterRead = auth; }
  async failSecondProjectReadForTest() { this.failProjectReadAt = this.projectCalls + 2; }
  resourceSnapshotForTest() {
    return { statements: this.resourceCursors.length,
      rowsRead: this.resourceCursors.reduce((sum, cursor) => sum + cursor.rowsRead, 0),
      rowsWritten: this.resourceCursors.reduce((sum, cursor) => sum + cursor.rowsWritten, 0),
      projectCalls: this.projectCalls };
  }
  ticketIndexNamesForTest() {
    return this.ctx.storage.sql.exec<{ name: string }>("PRAGMA index_list('route_tickets')").toArray().map(row => row.name);
  }
  // Local SQLite fixture only: model retained legacy data, never a runtime reset.
  async seedLegacyBudgetForTest() {
    this.ctx.storage.sql.exec(`CREATE TABLE d_experiment_budget (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), utc_day TEXT NOT NULL,
      worker_requests INTEGER NOT NULL CHECK(worker_requests BETWEEN 0 AND 200),
      project_creations INTEGER NOT NULL CHECK(project_creations BETWEEN 0 AND 2))`);
    this.ctx.storage.sql.exec('INSERT INTO d_experiment_budget VALUES(1,?,200,2)', new Date().toISOString().slice(0, 10));
  }
  async legacyBudgetSnapshotForTest() {
    if (!this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='d_experiment_budget'").toArray().length) return null;
    return this.ctx.storage.sql.exec<{ utc_day: string; worker_requests: number; project_creations: number }>(
      'SELECT utc_day,worker_requests,project_creations FROM d_experiment_budget WHERE singleton=1').toArray()[0] ?? null;
  }
  async failNextNotifyForTest() {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS test_flags (name TEXT PRIMARY KEY)');
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO test_flags(name) VALUES('fail_next_notify')");
  }
  override async notify(project: string, epoch: number) {
    const failure = this.ctx.storage.sql.exec<{ name: string }>(
      "DELETE FROM test_flags WHERE name='fail_next_notify' RETURNING name").toArray()[0];
    if (failure) throw new Error('injected wakeup failure');
    return super.notify(project, epoch);
  }
  async inspectForTest() {
    const rows = this.ctx.storage.sql.exec<{ project_id: string; epoch: number; owner_hash: string;
      expires_at: number; consented: number; revoked: number; metadata: string }>(
      'SELECT project_id,epoch,owner_hash,expires_at,consented,revoked,metadata FROM project WHERE singleton=1').toArray();
    const commands = this.ctx.storage.sql.exec('SELECT operation_id,payload,state FROM commands').toArray();
    const wakeTickets = this.ctx.storage.sql.exec("SELECT ticket_hash FROM route_tickets WHERE purpose='wake'").toArray();
    return { project: rows[0] ?? null, commands, wakeTickets, alarm: await this.ctx.storage.getAlarm() };
  }
  socketAttachmentsForTest() {
    return this.ctx.getWebSockets().map(socket => socket.deserializeAttachment());
  }
  socketReadyStatesForTest() {
    return this.ctx.getWebSockets().map(socket => socket.readyState);
  }
  async fastForwardTombstoneForTest() {
    this.ctx.storage.sql.exec('UPDATE project SET expires_at=? WHERE singleton=1 AND revoked=1', Date.now() - 1);
    await this.alarm();
  }
  async expireLeaseForTest(project: string, epoch: number) {
    this.ctx.storage.sql.exec('UPDATE project SET expires_at=? WHERE singleton=1 AND project_id=? AND epoch=? AND revoked=0',
      Date.now() - 1, project, epoch);
    return this.project({ project, epoch });
  }
}

export default worker;

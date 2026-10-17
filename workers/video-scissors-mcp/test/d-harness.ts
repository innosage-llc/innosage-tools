import worker from '../src/index-d.ts';
import { ProjectStateDO } from '../src/d/ProjectStateDO.ts';

// Local fixture-only subclass: accelerates the real alarm path without
// adding a production route or shortening the production tombstone lifetime.
export class TestProjectStateDO extends ProjectStateDO {
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

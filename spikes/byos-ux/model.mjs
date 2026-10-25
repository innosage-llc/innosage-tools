// Isolated UX simulator. No provider, transport, service or product integration.
// Mirrors PageStore journal-first ACK and {id,body,editId} matching semantics.
export const copy = value => structuredClone(value);
export const same = (a, b) => !!a && !!b && a.id === b.id && a.editId === b.editId && a.body === b.body;
export const catalog = size => Array.from({length:size}, (_, i) => ({id:`page-${i + 1}`, title:`Page ${String(i + 1).padStart(5, '0')}`}));
export class Simulation {
  constructor(storage, {clock = globalThis, now = () => Date.now(), changed = () => {}} = {}) {
    Object.assign(this, {storage, clock, now, changed});
    this.rows = new Map(); this.pending = new Set(); this.localTail = Promise.resolve();
    this.fault = 'none'; this.latency = 10000; this.flight = null; this.cancelled = null;
    this.sequence = 0; this.failNext = false; this.handoffRequested = false; this.closed = false;
    this.metrics = {bodyReads:0, writes:0, sends:0};
  }
  async open() {
    for (const row of await this.storage.all()) {
      this.metrics.bodyReads++;
      // Interrupted operations have no matching durable receipt. Never infer success.
      row.local = 'saved'; row.cloud = same(row.draft, row.confirmed) && !row.conflict ? 'confirmed' : row.conflict ? 'needs-resolution' : 'uncertain';
      this.rows.set(row.id, row);
      if (!same(row.draft, row.confirmed) || row.conflict) this.pending.add(row.id);
    }
    this.changed(); return this;
  }
  row(id) {
    if (!this.rows.has(id)) this.rows.set(id, {id, draft:{id,body:`# ${id}\n\nSynthetic page. Edit this page to begin.`,editId:'seed'}, confirmed:null, conflict:null, history:[], local:'untouched',cloud:'not-confirmed'});
    return this.rows.get(id);
  }
  view(id) {
    const row = this.row(id);
    const cloud = row.conflict ? 'needs-resolution' : row.local !== 'saved' ? 'not-confirmed' : this.fault === 'offline' ? 'offline' : this.fault === 'auth' ? 'authorization-needed' : same(row.draft, row.confirmed) ? 'confirmed' : row.cloud;
    return {...copy(row), cloud, pendingPages:this.pending.size, flight:this.flight ? {id:this.flight.id, editId:this.flight.draft.editId, started:this.flight.started, stalled:this.flight.stalled} : null};
  }
  edit(id, body, resolution = null) {
    const row = this.row(id);
    row.draft = {id,body,editId:`${this.storage.identity}/${++this.sequence}`};
    if (resolution) { row.history.push(copy(row.conflict)); row.conflict = null; }
    row.local = 'pending'; row.cloud = row.conflict ? 'needs-resolution' : 'queued'; row.error = null;
    this.pending.add(id); this.changed();
    return this.persist(id, copy(row));
  }
  persist(id, snapshot) {
    const task = this.localTail.then(async () => {
      try {
        if (this.failNext) { this.failNext = false; throw new Error('SIMULATED local persistence failure'); }
        await this.storage.put(snapshot); this.metrics.writes++;
        const current = this.row(id);
        if (same(current.draft, snapshot.draft)) { current.local = 'saved'; current.error = null; }
      } catch (error) {
        const current = this.row(id);
        if (same(current.draft, snapshot.draft)) { current.local = 'failed'; current.error = error.message; }
        throw error;
      } finally { this.changed(); }
    });
    this.localTail = task.catch(() => {});
    // ACK promise never waits for simulation. Pump only durably acknowledged rows.
    task.then(() => this.pump(), () => {});
    return task;
  }
  setFault(fault) { this.fault = fault; this.changed(); if (fault === 'none') this.pump(); }
  async retry() {
    for (const id of this.pending) {
      const row = this.row(id);
      if (row.local === 'failed') await this.persist(id, copy(row));
    }
    for (const id of this.pending) { const row=this.row(id); if (!row.conflict) row.cloud='queued'; }
    this.fault = 'none'; this.changed(); this.pump();
  }
  pump() {
    if (this.closed || this.flight || this.fault !== 'none') return;
    // FIFO over distinct pending pages; completion requeues newer intent at tail.
    for (const id of this.pending) {
      const row = this.row(id);
      if (row.local !== 'saved' || row.conflict || row.cloud === 'uncertain') continue;
      this.pending.delete(id);
      const op = {id,draft:copy(row.draft),started:this.now(),stalled:false};
      this.flight = op; this.pending.add(id); row.cloud = 'sending'; this.metrics.sends++;
      if (this.latency !== 'never') op.timer = this.clock.setTimeout(() => this.complete(op), Number(this.latency));
      op.watchdog = this.clock.setTimeout(() => { if (this.flight === op) {op.stalled = true; row.cloud = 'uncertain/stalled'; this.changed();} }, 60000);
      this.changed(); return;
    }
  }
  complete(op) {
    // Cancellation is logical in this simulation; stale callbacks are fenced.
    if (this.closed || this.flight !== op || op.completing) return Promise.resolve(false);
    op.completing = true; this.clock.clearTimeout(op.watchdog);
    const task = this.localTail.then(async () => {
      if (this.flight !== op) return false;
      const row = this.row(op.id);
      if (this.fault !== 'none' || row.conflict) { row.cloud = row.conflict ? 'needs-resolution' : 'uncertain'; return false; }
      const saved = {...copy(row), confirmed:copy(op.draft)};
      // Persist receipt before advertising confirmation. Does not replace draft.
      await this.storage.put(saved); this.metrics.writes++;
      row.confirmed = copy(op.draft);
      row.cloud = same(row.draft, op.draft) ? 'confirmed' : 'queued';
      return true;
    }).catch(error => {const row=this.row(op.id);row.cloud='uncertain';row.error=error.message;return false;}).finally(() => {
      if (this.flight !== op) return;
      this.flight = null; this.pending.delete(op.id);
      const row = this.row(op.id);
      if (!same(row.draft,row.confirmed) || row.conflict) this.pending.add(op.id);
      this.changed(); this.pump();
    });
    this.localTail = task.catch(() => {}); return task;
  }
  cancel() {
    const op=this.flight; if (!op || op.completing) return false;
    this.clock.clearTimeout(op.timer); this.clock.clearTimeout(op.watchdog);
    this.cancelled=op; this.flight=null; this.row(op.id).cloud='uncertain';
    // Explicit retry required; cancel does not silently claim delivery.
    this.fault='offline'; this.changed(); return true;
  }
  late() { return this.cancelled ? this.complete(this.cancelled) : Promise.resolve(false); }
  async conflict(id, remoteBody) {
    const row=this.row(id);
    if(row.conflict) row.history.push(copy(row.conflict));
    row.conflict={local:copy(row.draft),remote:{id,body:remoteBody,editId:`remote/${this.storage.identity}/${++this.sequence}`}};
    row.cloud='needs-resolution'; this.pending.add(id); this.changed();
    await this.persist(id,copy(row));
  }
  resolve(id, action, body) {
    const row=this.row(id); if (!row.conflict) throw new Error('No conflict');
    if (!['cloud','local','merge'].includes(action)) throw new Error('Unknown choice');
    // Explicit user choice creates a new protected generation; both originals retained.
    return this.edit(id, action==='cloud'?row.conflict.remote.body:action==='local'?row.draft.body:body, action);
  }
  handoff() {
    this.handoffRequested=true;
    const rows=[...this.rows.values()].filter(r=>r.local!=='untouched');
    const confirmed=rows.filter(r=>r.local==='saved'&&!r.conflict&&same(r.draft,r.confirmed)).length;
    return {state:rows.length && confirmed===rows.length ? 'SIMULATED handoff confirmed' : 'INCOMPLETE — keep this device', localProtected:rows.filter(r=>r.local==='saved').length, confirmed, pages:rows.length, pending:this.pending.size, conflicts:rows.filter(r=>r.conflict).length, errors:rows.filter(r=>r.error).length};
  }
  destination(id) {return copy(this.row(id).confirmed);}
  close() {this.closed=true;if(this.flight){this.clock.clearTimeout(this.flight.timer);this.clock.clearTimeout(this.flight.watchdog);} }
}

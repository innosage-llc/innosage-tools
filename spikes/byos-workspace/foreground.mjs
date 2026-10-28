// Opt-in bounded policy. No run exists until the user explicitly starts one.
// Dispatches existing workspace-wide sync; owns no records or replication state.
const runs = new WeakMap();

export class ForegroundRun {
  constructor(workspace, {authorized, visible, online, busy = () => false, changed = () => {}, clock = globalThis, delay = 750} = {}) {
    if (!workspace?.store || typeof workspace.sync !== 'function' ||
        [authorized, visible, online].some(check => typeof check !== 'function'))
      throw new Error('Explicit workspace and foreground/authority checks required');
    if (runs.has(workspace.store)) throw new Error('Foreground run already exists; replacement/rearming is forbidden');
    if (!Number.isFinite(delay) || delay < 0) throw new Error('Invalid debounce delay');
    Object.assign(this, {workspace, authorized, visible, online, busy, changed, clock, delay});
    this.acknowledged = 0; this.settled = 0; this.dispatches = 0;
    this.timer = null; this.flight = null; this.halted = false; this.stopped = false;
    runs.set(workspace.store, this);
  }
  gate() {
    const store = this.workspace.store;
    if (this.stopped || store.closed) return 'stopped';
    if (this.halted) return 'halted';
    if (this.flight) return 'in-flight';
    if (this.dispatches >= 2) return 'budget-exhausted';
    if (!store.writer) return 'read-only';
    if (!this.authorized()) return 'authorization-needed';
    if (!this.visible()) return 'hidden';
    if (!this.online()) return 'offline';
    if (store.operation?.pending || this.busy()) return 'cloud-action-active';
    return this.acknowledged > this.settled ? 'queued' : 'idle';
  }
  snapshot() {
    return {state: this.gate(), acknowledged: this.acknowledged, settled: this.settled,
      pending: this.acknowledged > this.settled, dispatches: this.dispatches,
      // A sync promise settling never proves a cloud generation or destination.
      cloudVerified: false, destinationObserved: false};
  }
  // Caller signals only after Workspace.create/save has durably acknowledged.
  saved() { this.acknowledged++; this.wake(); }
  notify() { this.changed(); }
  // Called by a foreground/online/manual-operation completion event, never polling.
  wake() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.notify();
    if (this.gate() !== 'queued') return;
    this.timer = this.clock.setTimeout(() => { this.timer = null; this.dispatch(); }, this.delay);
  }
  dispatch() {
    // Recheck at dispatch: visibility/authority/ownership may change in debounce.
    if (this.gate() !== 'queued') { this.notify(); return; }
    const generation = this.acknowledged;
    this.dispatches++;
    // Set flight before invoking the controller, including synchronous failures.
    const flight = {}; this.flight = flight;
    this.notify();
    flight.promise = (async () => {
      try {
        await this.workspace.sync();
        this.settled = generation;
      } catch {
        // Never retry/rearm after error: timeout work may still be running.
        this.halted = true;
      } finally {
        this.flight = null;
        this.wake();
      }
    })();
  }
  halt() {
    this.halted = true;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.notify();
  }
  stop() {
    this.stopped = true;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.notify();
    // Do not cancel, replace or falsely settle an existing native operation.
  }
}

import { VideoScissorsController } from './video-scissors.ts';
import { VideoScissorsRemoteAdapter, parseRemoteCommand, type RemoteTransport } from './video-scissors-remote.ts';
import type { RemoteConnectionViewModel } from '../workers/video-scissors-mcp/src/ui-contract';

type Session = { project: string; epoch: number; credential: string; proof: string; proofExpiresAt: number; expiresAt: number; abort: AbortController; revokedConfirmed?: boolean };
// No persistence, media access or visibility timer. Every request captures its
// exact project/epoch/credential closure; old responses cannot retarget a session.
export class VideoScissorsRemoteBrowser {
  readonly adapter: VideoScissorsRemoteAdapter;
  private session: Session | null = null;
  private state: RemoteConnectionViewModel['state'] = 'disconnected';
  private readonly listeners = new Set<() => void>();
  private readonly reportOwners = new Map<string, Session>();
  private connecting = false;
  private bindingGeneration = 0;
  private disposed = false;
  private readonly unsubscribe: () => void;
  private readonly controller: VideoScissorsController;
  private readonly send: typeof fetch;
  constructor(controller: VideoScissorsController, send: typeof fetch = (input, init) => fetch(input, init)) {
    this.controller = controller; this.send = send;
    const transport: RemoteTransport = {
      publish: async metadata => {
        const s = this.session;
        if (!s) return;
        const r = await this.call(s, 'sync', { metadata });
        if (!r.ok) throw new Error('NOT_BOUND_OR_REVOKED');
        if (this.session === s) { if (this.state !== 'uncertain') this.state = 'connected'; s.proof = ''; this.emit(); }
      },
      claim: async (metadata, signal) => {
        const s = this.session;
        if (!s) return null;
        const r = await this.call(s, 'poll', { metadata }, signal);
        if (this.session !== s || s.abort.signal.aborted) return null;
        this.state = 'connected'; this.emit();
        if (!r.command) return null;
        const c = parseRemoteCommand(r.command);
        this.reportOwners.set(c.operationId, s);
        return c;
      },
      report: async (id, result) => {
        const s = this.reportOwners.get(id);
        if (!s) throw new Error('REPORT_OWNER_UNKNOWN');
        if (s.revokedConfirmed) { this.reportOwners.delete(id); return; }
        const r = await this.call(s, 'report', { operationId: id, state: result.status, metadata: result.metadata });
        if (!r.ok) throw new Error('ACK_UNCERTAIN');
        this.reportOwners.delete(id);
        if (this.session === s) { this.state = 'connected'; this.emit(); }
      },
      cancellation: async (id, signal) => {
        const s = this.reportOwners.get(id);
        if (!s) return false;
        const r = await this.call(s, 'cancellation', { operationId: id }, signal);
        return this.session === s && r.stop === true;
      },
      onRemoteExecution: id => { void this.cancellationLoop(id); },
      revoke: async () => { await this.disconnect(); },
    };
    this.adapter = new VideoScissorsRemoteAdapter(controller, transport);
    this.unsubscribe = controller.subscribe(() => this.emit());
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot(): RemoteConnectionViewModel {
    const s = this.session;
    return { state: this.state, pairingProof: s?.proof || null, proofExpiresAt: s?.proofExpiresAt ?? null,
      projectExpiresAt: s?.expiresAt ?? null, metadata: this.adapter.metadata() };
  }
  private emit(): void { for (const listener of this.listeners) listener(); }
  private async backoff(s: Session): Promise<void> {
    if (s.abort.signal.aborted || this.disposed) return;
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); s.abort.signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, 3000);
      s.abort.signal.addEventListener('abort', finish, { once: true });
    });
  }
  private async call(s: Session, action: string, data: object = {}, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.send('/remote/' + action, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([s.abort.signal, signal ?? AbortSignal.timeout(25_000)]),
      body: JSON.stringify({ auth: { project: s.project, epoch: s.epoch, credential: s.credential }, ...data }) });
    if (!response.ok) throw new Error('REMOTE_REQUEST_REJECTED');
    return response.json();
  }
  async connect(): Promise<void> {
    if (this.disposed) return;
    if (this.session && Date.now() >= this.session.expiresAt) await this.disconnect();
    if (this.connecting || this.session) return;
    this.connecting = true;
    const binding = ++this.bindingGeneration;
    try {
      const r = await this.send('/remote/projects', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(25_000),
        headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!r.ok) throw new Error('PROJECT_CREATION_REJECTED');
      const v = await r.json();
      if (typeof v.project !== 'string' || !Number.isSafeInteger(v.epoch) || typeof v.credential !== 'string' || typeof v.proof !== 'string' ||
        !Number.isFinite(v.expiresAt) || !Number.isFinite(v.proofExpiresAt)) throw new Error('PROJECT_RESPONSE');
      const s: Session = { ...v, abort: new AbortController() };
      if (this.disposed || binding !== this.bindingGeneration) {
        // Late creation belongs to its old attempt, never a replacement session.
        await this.call(s, 'revoke').catch(() => {}); s.abort.abort(); return;
      }
      this.adapter.remoteBindingChanged();
      this.session = s; this.state = 'awaiting_approval'; this.emit();
      void this.loop(s);
    } catch { if (!this.disposed && binding === this.bindingGeneration) { this.state = 'uncertain'; this.emit(); } }
    finally { this.connecting = false; }
  }
  private async loop(s: Session): Promise<void> {
    while (!this.disposed && this.session === s && !s.abort.signal.aborted && Date.now() < s.expiresAt) {
      if (this.controller.getSnapshot().busy) await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); unsubscribe(); s.abort.signal.removeEventListener('abort', finish); resolve(); };
        const unsubscribe = this.controller.subscribe(() => { if (!this.controller.getSnapshot().busy) finish(); });
        const timer = setTimeout(finish, Math.max(0, s.expiresAt - Date.now()));
        s.abort.signal.addEventListener('abort', finish, { once: true });
      });
      if (this.disposed || this.session !== s || s.abort.signal.aborted) return;
      try { await this.adapter.pollOnce(); }
      catch {
        if (this.disposed || this.session !== s || s.abort.signal.aborted) return;
        if (this.state !== 'awaiting_approval') { this.state = 'uncertain'; this.emit(); }
        // Error backoff only. Successful long-polls renew immediately, hidden too.
        await this.backoff(s);
      }
    }
    if (this.session === s) { this.state = 'expired'; s.proof = ''; this.emit(); }
  }
  private async cancellationLoop(id: string): Promise<void> {
    const s = this.reportOwners.get(id);
    while (!this.disposed && s && this.session === s && !s.abort.signal.aborted && this.adapter.activeOperationId() === id && Date.now() < s.expiresAt) {
      try { await this.adapter.pollCancellation(); }
      catch {
        if (this.disposed || this.session !== s || s.abort.signal.aborted) return;
        this.state = 'uncertain'; this.emit();
        await this.backoff(s);
      }
    }
  }
  async disconnect(): Promise<void> {
    this.bindingGeneration++;
    const s = this.session;
    if (!s) { this.state = 'disconnected'; this.emit(); return; }
    try {
      // Confirm the D1 fence before dropping an uncertain ACK or its owner.
      const r = await this.call(s, 'revoke');
      if (!r.ok) throw new Error('REVOKE_UNCERTAIN');
      s.revokedConfirmed = true;
      s.abort.abort();
      if (this.session === s) {
        this.session = null; this.adapter.detachRevokedRemote();
        for (const id of this.reportOwners.keys()) if (id !== this.adapter.activeOperationId()) this.reportOwners.delete(id);
        this.state = 'disconnected'; this.emit();
      }
    } catch { this.state = 'uncertain'; this.emit(); }
  }
  unload(): void {
    const s = this.session;
    if (!s) return;
    // Best effort only: authoritative server expiry still applies.
    void this.send('/remote/revoke', { method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auth: {project:s.project,epoch:s.epoch,credential:s.credential} }) }).catch(() => {});
  }
  async dispose(): Promise<void> {
    this.disposed = true; this.bindingGeneration++;
    this.unsubscribe(); this.listeners.clear();
    // Teardown is not explicit confirmed Disconnect: stop locally even offline.
    // Best-effort unload revoke is NOT a server-fence PASS; lease expiry remains.
    this.unload();
    this.session?.abort.abort(); this.session = null; this.reportOwners.clear();
    this.state = 'disconnected';
    await this.adapter.dispose();
  }
}

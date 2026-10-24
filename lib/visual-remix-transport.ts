import { VisualRemixOfflineBridge, SCENE_SHARE_FIELDS } from './visual-remix-bridge.ts';
import { VisualRemixController } from './visual-remix-controller.ts';
import { SCENE_LIMITS, parseSceneAuth, parseSceneProposal, parseSceneSnapshot, sceneJSON, sceneObject, type SceneOwner, type SceneSnapshot, type SceneState } from './visual-remix-remote.ts';
import type { SceneSharingState } from './visual-remix-sharing-view.ts';

type Frame = { snapshot: SceneSnapshot; states: [string, SceneState][] };
type Share = { auth: SceneOwner; proof: string; expiresAt: number; proofExpiresAt: number };
type Sender = (path: string, init: RequestInit) => Promise<Response>;

// Only instantiated behind the product build gate and explicit user consent.
// No configurable destination, source bytes, persistence, Apply or export.
export class VisualRemixTransport {
  private bridge: VisualRemixOfflineBridge | null = null;
  private owner: Share | null = null;
  private creating = false;
  private stopped = true;
  private disposed = false;
  private pumping = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly issued = new Set<string>();
  private readonly acknowledged = new Map<string, SceneState>();
  private frames: Frame[] = [];
  private fingerprint = '';
  private state: SceneSharingState;
  constructor(private readonly controller: VisualRemixController, private readonly available: boolean,
    private readonly changed: (state: SceneSharingState) => void, private readonly renderChanged: () => void,
    private readonly send: Sender = (path, init) => fetch(path, init), private readonly now: () => number = Date.now) {
    this.state = { available, canConnect: available, canDisconnect: false, phase: 'disconnected' };
  }
  snapshot(): SceneSharingState { return { ...this.state }; }
  private publish(value: Omit<SceneSharingState, 'available'>): void {
    this.state = { available: this.available, ...value };
    if (!this.disposed) this.changed(this.snapshot());
  }
  private async call(path: string, data: unknown, retry = false): Promise<unknown> {
    const body = sceneJSON(data, SCENE_LIMITS.wireBytes);
    for (let attempt = 0; ; attempt++) {
      const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), path === 'create' ? 15000 : 5000);
      let retryable = true;
      try {
        const response = await this.send('/scene/browser/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: abort.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
        if (!response.ok) { retryable = response.status >= 500; throw new Error('SCENE_HTTP_' + response.status); }
        if (response.headers.get('content-type')?.split(';')[0] !== 'application/json') { retryable = false; throw new Error('SCENE_TRANSPORT'); }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('SCENE_RESPONSE');
        const parts: Uint8Array[] = []; let count = 0;
        try {
          for (;;) { const { done, value } = await reader.read(); if (done) break; count += value.byteLength; if (count > SCENE_LIMITS.wireBytes) { await reader.cancel(); throw new Error('SCENE_RESPONSE'); } parts.push(value); }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(count); let offset = 0;
        for (const part of parts) { bytes.set(part, offset); offset += part.length; }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch (error) { if (!retry || !retryable || attempt >= 1) throw error; }
      finally { clearTimeout(timeout); }
    }
  }
  async connect(confirmed: boolean): Promise<void> {
    if (!confirmed || !this.available || !this.state.canConnect || this.disposed) throw new Error('SCENE_SHARE_NOT_CONFIRMED');
    const local = this.controller.snapshot(), startedAt = this.now(), expiresAt = startedAt + SCENE_LIMITS.leaseMs;
    const proofExpiresAt = startedAt + SCENE_LIMITS.proofMs;
    const bridge = new VisualRemixOfflineBridge(this.controller, { purpose:'visual-remix', confirmed:true, projectId:local.projectId, generation:local.generation, expiresAt, fields:SCENE_SHARE_FIELDS }, this.now);
    let snapshot: SceneSnapshot;
    try { snapshot = parseSceneSnapshot(bridge.getScene()); } catch (error) { bridge.revoke(); throw error; }
    this.bridge = bridge; this.stopped = false; this.creating = true;
    this.publish({ phase:'connecting', canConnect:false, canDisconnect:true });
    try {
      // Never retry creation: a lost response can conceal a committed share.
      const value = sceneObject(await this.call('create', { snapshot, fields:SCENE_SHARE_FIELDS, confirmed:true }), ['auth','proof','expiresAt','proofExpiresAt']);
      const auth = parseSceneAuth(value.auth,true) as SceneOwner;
      if (auth.projectId !== snapshot.projectId || auth.generation !== snapshot.generation) throw new Error('SCENE_BINDING');
      // Retain validated ownership only for explicit Disconnect if confirmation fails.
      this.owner = { auth, proof:'', expiresAt, proofExpiresAt };
      this.creating = false;
      // Honor cancellation/disposal even when the rest of confirmation is invalid.
      if (this.stopped || this.disposed || !this.bound()) { await this.disconnect(); return; }
      if (typeof value.proof !== 'string' || !/^[a-f0-9]{64}$/.test(value.proof) ||
        !Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) < SCENE_LIMITS.leaseMs ||
        !Number.isSafeInteger(value.proofExpiresAt) || Number(value.proofExpiresAt) < SCENE_LIMITS.proofMs ||
        Number(value.expiresAt) - Number(value.proofExpiresAt) !== SCENE_LIMITS.leaseMs - SCENE_LIMITS.proofMs ||
        this.now() >= proofExpiresAt) throw new Error('SCENE_BINDING');
      // The server enforces its own fixed-duration leases. Starting this browser's
      // deadlines before create is conservative without assuming clock agreement.
      this.owner.proof = value.proof;
      this.creating = false;
      if (this.stopped || this.disposed || !this.bound()) { await this.disconnect(); return; }
      this.publish({ phase:'awaiting-consent', proof:value.proof, expiresAt:this.owner.expiresAt, canConnect:false, canDisconnect:true });
      this.notifyLocalChange(); this.schedule();
    } catch (error) {
      this.creating = false; this.stopped = true; bridge.revoke();
      const detail = error instanceof Error && /^SCENE_HTTP_\d{3}$/.test(error.message) ? ` (service returned HTTP ${error.message.slice(-3)})` : error instanceof Error && error.name === 'AbortError' ? ' (request timed out)' : '';
      this.publish({ phase:'error', canConnect:false, canDisconnect:!!this.owner, error:`Sharing could not be confirmed${detail}. A share may exist; access is lease-limited but stored content can remain until cleanup. Use Disconnect when available. No automatic reconnect or revocation claim.` });
    }
  }
  private bound(): boolean {
    const state = this.controller.snapshot();
    return !!this.owner && !state.loading && state.projectId === this.owner.auth.projectId && state.generation === this.owner.auth.generation && this.now() < this.owner.expiresAt;
  }
  notifyLocalChange(): void {
    if (this.stopped || !this.bridge || !this.owner) return;
    if (!this.bound()) { void this.disconnect(); return; }
    let frame: Frame;
    try { frame = { snapshot:parseSceneSnapshot(this.bridge.getScene()), states:[] }; } catch { this.fail(); return; }
    for (const id of this.issued) {
      const status = this.controller.status(id);
      if (status && status !== 'rendering') frame.states.push([id,status]);
    }
    const fingerprint = sceneJSON(frame, SCENE_LIMITS.wireBytes);
    if (fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint;
    if (this.frames.length >= 64) { this.fail(); return; }
    this.frames.push(frame); void this.pump();
  }
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(() => { this.timer = null; if (this.owner && this.state.phase === 'awaiting-consent' && this.now() >= this.owner.proofExpiresAt) { void this.disconnect(); return; } this.fingerprint = ''; this.notifyLocalChange(); this.schedule(); }, 3000);
  }
  private fail(): void {
    this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; this.frames = [];
    this.bridge?.revoke(); this.renderChanged();
    this.publish({ phase:'error', canConnect:false, canDisconnect:!!this.owner, error:'Connection stopped. Local edits and exports are preserved. Disconnect to confirm service revocation; expiration alone does not guarantee physical deletion.' });
  }
  private async pump(): Promise<void> {
    if (this.pumping || this.stopped || !this.owner) return;
    this.pumping = true; const startedOwner = this.owner;
    try {
      while (!this.stopped && this.frames.length) {
        const owner: Share = this.owner, frame: Frame = this.frames.shift()!;
        if (!this.bound()) { await this.disconnect(); break; }
        const synced = sceneObject(await this.call('sync', { auth:owner.auth, snapshot:frame.snapshot },true), ['ok']);
        if (this.stopped || this.owner !== owner) return;
        if (synced.ok !== true) throw new Error('SCENE_SYNC');
        for (const [requestId,state] of frame.states) {
          if (this.acknowledged.get(requestId) === state) continue;
          const result = sceneObject(await this.call('report',{auth:owner.auth,requestId,state},true),['ok']);
          if (this.stopped || this.owner !== owner) return;
          if (result.ok !== true) throw new Error('SCENE_REPORT');
          this.acknowledged.set(requestId,state);
        }
        if (this.stopped) break;
        // Claim is not replayed after uncertain delivery.
        const polled = sceneObject(await this.call('poll', { auth:owner.auth }), ['command','cancellations','connected']);
        if (this.stopped || this.owner !== owner) return;
        if (!Array.isArray(polled.cancellations) || polled.cancellations.length > SCENE_LIMITS.requests || typeof polled.connected !== 'boolean') throw new Error('SCENE_POLL');
        if (polled.connected && this.state.phase === 'awaiting-consent') this.publish({phase:'connected',canConnect:false,canDisconnect:true,expiresAt:owner.expiresAt});
        for (const id of polled.cancellations) if (typeof id === 'string' && this.issued.has(id)) { this.bridge!.cancelProposal(id); this.renderChanged(); }
        if (polled.command) {
          const proposal = parseSceneProposal(polled.command);
          if (this.issued.has(proposal.requestId) || this.issued.size >= SCENE_LIMITS.requests) throw new Error('SCENE_CLAIM_REPLAY');
          this.issued.add(proposal.requestId);
          // Rendering is intentionally separate so heartbeat and cancel continue.
          void this.bridge!.proposeScene(sceneJSON(proposal)).then(() => { if (this.owner === owner && !this.stopped) { this.renderChanged(); this.notifyLocalChange(); } }).catch(() => { if (this.owner === owner && !this.stopped) this.fail(); });
          this.renderChanged();
        }
        this.notifyLocalChange();
      }
    } catch { if (!this.stopped && this.owner === startedOwner) this.fail(); }
    finally { this.pumping = false; if (!this.stopped && this.frames.length) void this.pump(); }
  }
  async disconnect(): Promise<void> {
    this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; this.frames = []; this.bridge?.revoke();
    this.publish({ phase:'revoking',canConnect:false,canDisconnect:false });
    if (this.creating) return; // Late create response owns cleanup; never adopt it.
    if (!this.owner) { this.publish({phase:'disconnected',canConnect:this.available,canDisconnect:false,revocationConfirmed:false}); return; }
    try {
      const result = sceneObject(await this.call('revoke', { auth:this.owner.auth },true), ['ok']);
      if (result.ok !== true) throw new Error('SCENE_REVOKE');
      this.owner = null; this.bridge = null; this.issued.clear(); this.acknowledged.clear(); this.fingerprint = '';
      this.publish({phase:'disconnected',canConnect:this.available,canDisconnect:false,revocationConfirmed:true});
    } catch {
      this.publish({phase:'error',canConnect:false,canDisconnect:true,error:'Revocation is unconfirmed. Retry Disconnect. Existing service content may remain until a successful revoke or later cleanup.'});
    }
  }
  dispose(): void { this.disposed = true; void this.disconnect(); }
}

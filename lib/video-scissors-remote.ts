import { VideoScissorsController, validateVideoClips, type VideoClip, type OperationStatus } from './video-scissors.ts';
import { isCoverPresetId, type CoverPresetId } from './video-scissors-covers.ts';

export type RemoteMetadata = {
  duration: number; generation: number; version: number; hasOutput: boolean;
  canUndo: boolean; latestOperationId: string | null; errorCode: 'NONE' | 'LOCAL_FAILURE';
};
export type RemoteCommand = {
  operationId: string; generation: number; version: number;
} & ({ kind: 'cut'; clips: VideoClip[] } | { kind: 'undo'; targetOperationId: string } | { kind: 'cover'; presetId: CoverPresetId });
export type RemoteResult = { status: OperationStatus; metadata: RemoteMetadata };
export interface RemoteTransport {
  // Credential stays inside this controller-lifetime transport closure, never URL/storage.
  claim(metadata: RemoteMetadata, signal: AbortSignal): Promise<RemoteCommand | null>;
  report(id: string, result: RemoteResult): Promise<void>;
  cancellation(id: string, signal: AbortSignal): Promise<boolean>;
  revoke(): Promise<void>;
  publish(metadata: RemoteMetadata): Promise<void | boolean>;
  onRemoteExecution?(operationId: string): void;
}
export function parseRemoteCommand(value: unknown): RemoteCommand {
  if (!value || typeof value !== 'object') throw new Error('COMMAND');
  const v = value as Record<string, unknown>;
  const keys = ['operationId', 'generation', 'version', 'kind', v.kind === 'cut' ? 'clips' : v.kind === 'cover' ? 'presetId' : 'targetOperationId'];
  if (Object.keys(v).some(k => !keys.includes(k)) || typeof v.operationId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,96}$/.test(v.operationId) || !Number.isSafeInteger(v.generation) ||
    Number(v.generation) < 0 || !Number.isSafeInteger(v.version) || Number(v.version) < 0) throw new Error('COMMAND');
  if (v.kind === 'cut') {
    if (!Array.isArray(v.clips) || v.clips.some(c => !c || typeof c !== 'object' ||
      Object.keys(c).some(k => !['start', 'end'].includes(k)) || typeof c.start !== 'number' || typeof c.end !== 'number')) throw new Error('COMMAND');
    const clips: VideoClip[] = v.clips.map(c => ({ start: c.start, end: c.end }));
    validateVideoClips(clips, 300);
    return { operationId: v.operationId, generation: Number(v.generation), version: Number(v.version), kind: 'cut', clips };
  }
  if (v.kind === 'cover') {
    if (!isCoverPresetId(v.presetId)) throw new Error('COMMAND');
    return { operationId: v.operationId, generation: Number(v.generation), version: Number(v.version), kind: 'cover', presetId: v.presetId };
  }
  if (v.kind !== 'undo' || typeof v.targetOperationId !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(v.targetOperationId)) throw new Error('COMMAND');
  return { operationId: v.operationId, generation: Number(v.generation), version: Number(v.version), kind: 'undo', targetOperationId: v.targetOperationId };
}
export function parseRemoteMetadata(value: unknown): RemoteMetadata {
  if (!value || typeof value !== 'object') throw new Error('METADATA');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== ['duration','generation','version','hasOutput','canUndo','latestOperationId','errorCode'].sort().join() ||
    typeof v.duration !== 'number' || !Number.isFinite(v.duration) || v.duration < 0 || v.duration > 300 ||
    !Number.isSafeInteger(v.generation) || Number(v.generation) < 0 || !Number.isSafeInteger(v.version) || Number(v.version) < 0 ||
    typeof v.hasOutput !== 'boolean' || typeof v.canUndo !== 'boolean' ||
    !(v.latestOperationId === null || (typeof v.latestOperationId === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(v.latestOperationId))) ||
    !['NONE', 'LOCAL_FAILURE'].includes(String(v.errorCode))) throw new Error('METADATA');
  return { duration: v.duration, generation: Number(v.generation), version: Number(v.version), hasOutput: v.hasOutput,
    canUndo: v.canUndo, latestOperationId: v.latestOperationId as string | null, errorCode: v.errorCode as RemoteMetadata['errorCode'] };
}

export class VideoScissorsRemoteAdapter {
  private latest: string | null = null;
  private active: string | null = null;
  private stopped = false;
  private generation = -1;
  // Tombstones remain for the finite controller lifetime; uncertain reports never replay.
  private readonly receipts = new Map<string, { payload: string; result: Promise<RemoteResult> }>();
  private readonly controller: VideoScissorsController;
  private readonly transport: RemoteTransport;
  private readonly unsubscribe: () => void;
  private publishQueued = false;
  private lastPublished: string | null = null;
  private publication: Promise<void> = Promise.resolve();
  private publicationFailed = false;
  private pendingReport: { id: string; result: RemoteResult; send: RemoteTransport['report'] } | null = null;
  constructor(controller: VideoScissorsController, transport: RemoteTransport) {
    this.controller = controller; this.transport = transport;
    this.unsubscribe = controller.subscribe(() => this.queueMetadata());
  }
  private queueMetadata(): void {
    if (this.stopped || this.publishQueued) return;
    this.publishQueued = true;
    queueMicrotask(() => {
      this.publishQueued = false;
      // Completion publishes only after latest-target tracking below is updated.
      if (this.stopped || (this.active && this.controller.getOperationStatus(this.active) === 'completed')) return;
      const m = this.metadata(), serialized = JSON.stringify(m);
      if (serialized === this.lastPublished) return;
      this.lastPublished = serialized;
      this.publication = this.transport.publish(m).then(published => {
        this.publicationFailed = false;
        if (published === false) this.lastPublished = null;
      }, () => {
        this.publicationFailed = true; this.lastPublished = null;
      });
    });
  }
  async flushMetadata(): Promise<void> {
    this.queueMetadata();
    await Promise.resolve();
    await this.publication;
    if (this.publicationFailed) throw new Error('METADATA_SYNC_UNCERTAIN');
  }
  metadata(): RemoteMetadata {
    const s = this.controller.getSnapshot();
    if (this.generation !== s.sourceGeneration) {
      this.generation = s.sourceGeneration;
      this.latest = null;
    }
    return { duration: s.duration, generation: s.sourceGeneration, version: s.version,
      hasOutput: s.hasOutput, canUndo: s.canUndo, latestOperationId: this.latest, errorCode: s.error ? 'LOCAL_FAILURE' : 'NONE' };
  }
  execute(input: unknown): Promise<RemoteResult> {
    const c = parseRemoteCommand(input);
    const payload = JSON.stringify(c);
    const old = this.receipts.get(c.operationId);
    if (old) {
      if (old.payload !== payload) return Promise.reject(new Error('ID_CONFLICT'));
      return old.result;
    }
    // Start synchronously: no async gap between checking current version, setting
    // the validated whole plan and cutting against the newly incremented version.
    const result = this.start(c);
    this.receipts.set(c.operationId, { payload, result });
    void result.then(() => this.queueMetadata(), () => this.queueMetadata());
    return result;
  }
  private start(c: RemoteCommand): Promise<RemoteResult> {
    this.metadata(); // Clear the latest Undo target on original-source replacement.
    const before = this.controller.getSnapshot();
    const result = (status: OperationStatus): RemoteResult => ({ status, metadata: this.metadata() });
    if (this.stopped || this.active || before.busy || c.generation !== before.sourceGeneration || c.version !== before.version) return Promise.resolve(result('stale'));
    if (c.kind === 'undo') {
      if (c.targetOperationId !== this.latest || !this.controller.undo({ operationId: c.operationId, sourceGeneration: c.generation, version: c.version })) return Promise.resolve(result('stale'));
      this.latest = c.operationId;
      return Promise.resolve(result('completed'));
    }
    if (c.kind === 'cut') {
      try { validateVideoClips(c.clips, before.duration); } catch { return Promise.resolve(result('failed')); }
      if (!this.controller.setSegments(c.clips, c.generation)) return Promise.resolve(result('stale'));
    }
    const command = { operationId: c.operationId, sourceGeneration: c.generation, version: this.controller.getSnapshot().version };
    const task = c.kind === 'cover' ? this.controller.applyCoverPreset(command, c.presetId) : this.controller.cut(command);
    if (this.controller.getSnapshot().error) return Promise.resolve(result('failed'));
    if (this.controller.getOperationStatus(c.operationId) !== 'running') return Promise.resolve(result('stale'));
    this.active = c.operationId;
    return task.then(() => {
      const status = this.controller.getOperationStatus(c.operationId) ?? 'stale';
      if (status === 'completed') this.latest = c.operationId;
      return result(status);
    }).finally(() => { this.active = null; });
  }
  // The future UI MUST use these wrappers too, not bypass latest-target tracking.
  localCut(operationId: string, clips: VideoClip[]): Promise<RemoteResult> {
    const m = this.metadata();
    if (this.stopped || this.active || this.controller.getSnapshot().busy) return Promise.resolve({ status: 'stale', metadata: m });
    // Local editor values may be temporarily invalid. Use the controller's
    // existing visible error path before strict remote-command parsing.
    if (!this.controller.validateCutPlan(clips)) return Promise.resolve({ status: 'failed', metadata: this.metadata() });
    return this.execute({ operationId, generation: m.generation, version: m.version, kind: 'cut', clips });
  }
  localUndo(operationId: string): Promise<RemoteResult> {
    const m = this.metadata();
    return this.execute({ operationId, generation: m.generation, version: m.version, kind: 'undo', targetOperationId: this.latest ?? 'none' });
  }
  async pollOnce(): Promise<void> {
    if (this.stopped || this.active || this.controller.getSnapshot().busy) return;
    // Retry a known result, not its computation. Capture its original transport
    // binding so reconnecting cannot acknowledge an old ID into a new project.
    await this.flushReport();
    await this.flushMetadata();
    const c = await this.transport.claim(this.metadata(), AbortSignal.timeout(25_000));
    if (!c) return;
    const task = this.execute(c);
    this.transport.onRemoteExecution?.(c.operationId);
    const r = await task;
    // A failed report is uncertain delivery, NOT permission to execute again.
    this.pendingReport = { id: c.operationId, result: r, send: this.transport.report.bind(this.transport) };
    await this.flushReport();
  }
  async flushReport(): Promise<void> {
    const pending = this.pendingReport;
    if (!pending) return;
    await pending.send(pending.id, pending.result);
    if (this.pendingReport === pending) this.pendingReport = null;
  }
  activeOperationId(): string | null { return this.active; }
  // Only the connection owner calls this AFTER a confirmed D1 project revoke.
  // It never clears controller history or allows an operation ID to recompute.
  detachRevokedRemote(): void { this.pendingReport = null; }
  remoteBindingChanged(): void { this.lastPublished = null; }
  async pollCancellation(): Promise<void> {
    const id = this.active;
    if (id && await this.transport.cancellation(id, AbortSignal.timeout(25_000)) && this.active === id) this.controller.cancel();
  }
  cancelLocal(): void { this.controller.cancel(); }
  async dispose(): Promise<void> {
    this.stopped = true;
    this.unsubscribe();
    this.controller.cancel();
    try { await this.transport.revoke(); } finally { this.receipts.clear(); }
  }
}

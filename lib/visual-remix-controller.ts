import { REMIX_LIMITS, parseProposal, parseScene, type Proposal, type Scene } from './visual-remix.ts';
import { LocalAssets } from './visual-remix-assets.ts';

export type LayoutDiagnostic = { code: 'TEXT_OVERFLOW' | 'TEXT_OVERLAP' | 'OUTSIDE_CANVAS' | 'FONT_FALLBACK'; nodeIds: string[]; severity: 'error' | 'warning'; message: string };
export type RenderedScene = { png: Blob; diagnostics: LayoutDiagnostic[] };
export type SceneRenderer = (scene: Scene, assets: LocalAssets, signal: AbortSignal) => Promise<RenderedScene>;
export type ProposalStatus = 'rendering' | 'preview' | 'applied' | 'stale' | 'canceled' | 'revoked' | 'failed';
type Receipt = { proposal: Proposal; payload: string; status: ProposalStatus; render?: RenderedScene; abort: AbortController; completion: Promise<ProposalStatus> };
type Committed = { scene: Scene; render: RenderedScene };
function copy<T>(value: T): T { return structuredClone(value); }

// Only browser-owned local edits auto-commit. Remote proposals still require Apply.
// No network, transport, credentials or remote auto-apply.
export class VisualRemixController {
  private generation = crypto.randomUUID();
  private projectId = '';
  private revision = 0;
  private current: Committed | null = null;
  private history: Committed[] = [];
  private localEdit: { id: string; generation: string; revision: number; abort: AbortController } | null = null;
  private lastLocalCommit = 0;
  private assets = new LocalAssets();
  private receipts = new Map<string, Receipt>();
  private loading: AbortController | null = null;
  private previewId: string | null = null;
  private readonly renderer: SceneRenderer;
  constructor(renderer: SceneRenderer) { this.renderer = renderer; }
  snapshot() {
    const preview = this.previewId ? this.receipts.get(this.previewId) : undefined;
    return copy({ projectId: this.projectId, generation: this.generation, revision: this.revision, loading: this.loading !== null, editing: this.localEdit !== null, scene: this.current?.scene ?? null, output: this.current?.render ?? null, canUndo: this.history.length > 0,
      preview: preview?.status === 'preview' ? { requestId: preview.proposal.requestId, scene: preview.proposal.scene, explanation: preview.proposal.explanation, output: preview.render! } : null });
  }
  status(requestId: string): ProposalStatus | null { return this.receipts.get(requestId)?.status ?? null; }
  private invalidate(status: 'stale' | 'revoked' | 'canceled'): void {
    for (const r of this.receipts.values()) if (r.status === 'rendering' || r.status === 'preview') { r.status = status; r.abort.abort(); r.render = undefined; }
    this.previewId = null;
  }
  async open(projectId: string, revision: number, input: unknown, assets: LocalAssets): Promise<void> {
    const scene = parseScene(input);
    if (!/^[a-zA-Z0-9_-]{1,96}$/.test(projectId) || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new Error('INVALID_PROJECT');
    for (const asset of scene.assets) assets.blob(asset);
    this.loading?.abort(); this.discardLocalEdit(); this.invalidate('stale');
    // Fresh authority immediately, even for same-ID imports; canceled imports do
    // not resurrect pending work for the previous project.
    this.generation = crypto.randomUUID();
    const abort = new AbortController(); this.loading = abort;
    try {
      const render = await this.renderer(copy(scene), assets, abort.signal);
      abort.signal.throwIfAborted();
      if (this.loading !== abort) throw new Error('STALE_RENDER');
      // A transitional snapshot cannot grant authority over the committed import.
      this.generation = crypto.randomUUID();
      this.projectId = projectId; this.revision = revision; this.assets = assets;
      this.current = { scene, render: copy(render) }; this.history = []; this.lastLocalCommit = 0; this.receipts = new Map();
    } finally { if (this.loading === abort) this.loading = null; }
  }
  propose(input: unknown): Promise<ProposalStatus> {
    const p = parseProposal(input), payload = JSON.stringify(p);
    const old = this.receipts.get(p.requestId);
    if (old) { if (old.payload !== payload) throw new Error('REQUEST_ID_CONFLICT'); return old.completion.then(() => old.status); }
    if (this.receipts.size >= REMIX_LIMITS.requests) throw new Error('REQUEST_LIMIT_REOPEN_PROJECT');
    const r: Receipt = { proposal: p, payload, status: 'rendering', abort: new AbortController(), completion: Promise.resolve('rendering') };
    this.receipts.set(p.requestId, r);
    if (!this.current || this.loading || this.localEdit || p.projectId !== this.projectId || p.generation !== this.generation || p.baseRevision !== this.revision) { r.status = 'stale'; r.completion = Promise.resolve('stale'); return r.completion; }
    // Replacing the preview invalidates any earlier render/preview, not history.
    for (const previous of this.receipts.values()) if (previous !== r && (previous.status === 'rendering' || previous.status === 'preview')) { previous.status = 'canceled'; previous.abort.abort(); previous.render = undefined; }
    this.previewId = null;
    r.completion = this.renderProposal(r);
    return r.completion;
  }
  private async renderProposal(r: Receipt): Promise<ProposalStatus> {
    try {
      for (const a of r.proposal.scene.assets) this.assets.blob(a);
      const output = await this.renderer(copy(r.proposal.scene), this.assets, r.abort.signal);
      if (r.status !== 'rendering') return r.status;
      if (r.proposal.generation !== this.generation || r.proposal.baseRevision !== this.revision) return r.status = 'stale';
      r.render = copy(output); r.status = 'preview'; this.previewId = r.proposal.requestId;
    } catch { if (r.status === 'rendering') r.status = 'failed'; }
    return r.status;
  }
  apply(requestId: string): ProposalStatus {
    const r = this.receipts.get(requestId);
    if (!r) throw new Error('UNKNOWN_REQUEST');
    if (r.status !== 'preview') return r.status;
    if (!this.current || this.loading || this.localEdit || this.previewId !== requestId || r.proposal.projectId !== this.projectId || r.proposal.generation !== this.generation || r.proposal.baseRevision !== this.revision) return r.status = 'stale';
    const scene = parseScene(r.proposal.scene);
    for (const a of scene.assets) this.assets.blob(a);
    if (JSON.stringify({ ...r.proposal, scene }) !== r.payload || !r.render) throw new Error('PREVIEW_CHANGED');
    if (this.revision >= Number.MAX_SAFE_INTEGER - 1) throw new Error('REVISION_LIMIT');
    this.remember(); this.lastLocalCommit = 0; this.current = { scene, render: r.render }; this.revision++;
    r.status = 'applied'; r.render = undefined; this.invalidate('stale');
    return r.status;
  }
  private remember(): void {
    if (this.current) this.history = [...this.history.slice(-19), this.current];
  }
  // Browser-owned parameter edits only. Remote JSON/tools cannot invoke this
  // path. Stage immediately fences pending proposals; UI debounces rendering.
  stageLocalEdit(): string {
    if (!this.current || this.loading) throw new Error('NO_SCENE');
    this.discardLocalEdit(); this.invalidate('stale');
    const id = crypto.randomUUID();
    this.localEdit = {id,generation:this.generation,revision:this.revision,abort:new AbortController()};
    return id;
  }
  discardLocalEdit(): void { this.localEdit?.abort.abort(); this.localEdit = null; }
  async renderLocalEdit(input: unknown, ticket: string): Promise<'applied' | 'stale'> {
    const edit = this.localEdit;
    if (!edit || edit.id !== ticket) return 'stale';
    const scene = parseScene(input);
    for (const asset of scene.assets) this.assets.blob(asset);
    const render = await this.renderer(copy(scene),this.assets,edit.abort.signal);
    if (this.localEdit !== edit || edit.abort.signal.aborted || this.loading || edit.generation !== this.generation || edit.revision !== this.revision) return 'stale';
    if (this.revision >= Number.MAX_SAFE_INTEGER-1) throw new Error('REVISION_LIMIT');
    // Consecutive typing in one short burst shares an Undo checkpoint.
    const now = Date.now();
    if (!this.lastLocalCommit || now-this.lastLocalCommit > 750) this.remember();
    this.lastLocalCommit = now; this.current = {scene,render:copy(render)};this.revision++;
    this.localEdit = null;this.invalidate('stale');
    return 'applied';
  }
  undo(): boolean {
    this.discardLocalEdit();
    if (!this.history.length || this.loading || this.revision >= Number.MAX_SAFE_INTEGER-1) return false;
    this.invalidate('stale'); this.current = this.history.pop()!;this.lastLocalCommit = 0;this.revision++;return true;
  }
  cancel(requestId: string): void {
    const r = this.receipts.get(requestId);
    if (r && (r.status === 'rendering' || r.status === 'preview')) { r.status = 'canceled'; r.abort.abort(); r.render = undefined; if (this.previewId === requestId) this.previewId = null; }
  }
  revoke(): void { this.discardLocalEdit(); this.lastLocalCommit = 0; this.loading?.abort(); this.loading = null; this.invalidate('revoked'); this.generation = crypto.randomUUID(); }
  exportPNG(): Blob {
    if (!this.current) throw new Error('NO_SCENE');
    if (this.localEdit) throw new Error('LOCAL_EDIT_PENDING');
    if (this.current.render.diagnostics.some(d => d.severity === 'error')) throw new Error('FIX_LAYOUT_BEFORE_EXPORT');
    return this.current.render.png;
  }
  dispose(): void { this.discardLocalEdit(); this.loading?.abort(); this.loading = null; this.invalidate('canceled'); this.current = null; this.history = []; this.generation = crypto.randomUUID(); }
}

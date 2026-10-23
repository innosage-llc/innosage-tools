import { REMIX_LIMITS, parseProposal, parseScene, type Proposal, type Scene } from './visual-remix.ts';
import { LocalAssets } from './visual-remix-assets.ts';

export type LayoutDiagnostic = { code: 'TEXT_OVERFLOW' | 'TEXT_OVERLAP' | 'OUTSIDE_CANVAS' | 'FONT_FALLBACK'; nodeIds: string[]; severity: 'error' | 'warning'; message: string };
export type RenderedScene = { png: Blob; diagnostics: LayoutDiagnostic[] };
export type SceneRenderer = (scene: Scene, assets: LocalAssets, signal: AbortSignal) => Promise<RenderedScene>;
export type ProposalStatus = 'rendering' | 'preview' | 'applied' | 'stale' | 'canceled' | 'revoked' | 'failed';
type Receipt = { proposal: Proposal; payload: string; status: ProposalStatus; render?: RenderedScene; abort: AbortController; completion: Promise<ProposalStatus> };
type Committed = { scene: Scene; render: RenderedScene };
function copy<T>(value: T): T { return structuredClone(value); }

// UI owns calls to apply(). No network, transport, credentials or implicit apply.
export class VisualRemixController {
  private generation = crypto.randomUUID();
  private projectId = '';
  private revision = 0;
  private current: Committed | null = null;
  private previous: Committed | null = null;
  private assets = new LocalAssets();
  private receipts = new Map<string, Receipt>();
  private loading: AbortController | null = null;
  private previewId: string | null = null;
  private readonly renderer: SceneRenderer;
  constructor(renderer: SceneRenderer) { this.renderer = renderer; }
  snapshot() {
    const preview = this.previewId ? this.receipts.get(this.previewId) : undefined;
    return copy({ projectId: this.projectId, generation: this.generation, revision: this.revision, loading: this.loading !== null, scene: this.current?.scene ?? null, output: this.current?.render ?? null, canUndo: !!this.previous,
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
    this.loading?.abort(); this.invalidate('stale');
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
      this.current = { scene, render: copy(render) }; this.previous = null; this.receipts = new Map();
    } finally { if (this.loading === abort) this.loading = null; }
  }
  propose(input: unknown): Promise<ProposalStatus> {
    const p = parseProposal(input), payload = JSON.stringify(p);
    const old = this.receipts.get(p.requestId);
    if (old) { if (old.payload !== payload) throw new Error('REQUEST_ID_CONFLICT'); return old.completion.then(() => old.status); }
    if (this.receipts.size >= REMIX_LIMITS.requests) throw new Error('REQUEST_LIMIT_REOPEN_PROJECT');
    const r: Receipt = { proposal: p, payload, status: 'rendering', abort: new AbortController(), completion: Promise.resolve('rendering') };
    this.receipts.set(p.requestId, r);
    if (!this.current || this.loading || p.projectId !== this.projectId || p.generation !== this.generation || p.baseRevision !== this.revision) { r.status = 'stale'; r.completion = Promise.resolve('stale'); return r.completion; }
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
    if (!this.current || this.loading || this.previewId !== requestId || r.proposal.projectId !== this.projectId || r.proposal.generation !== this.generation || r.proposal.baseRevision !== this.revision) return r.status = 'stale';
    const scene = parseScene(r.proposal.scene);
    for (const a of scene.assets) this.assets.blob(a);
    if (JSON.stringify({ ...r.proposal, scene }) !== r.payload || !r.render) throw new Error('PREVIEW_CHANGED');
    if (this.revision >= Number.MAX_SAFE_INTEGER - 1) throw new Error('REVISION_LIMIT');
    this.previous = this.current; this.current = { scene, render: r.render }; this.revision++;
    r.status = 'applied'; r.render = undefined; this.invalidate('stale');
    return r.status;
  }
  undo(): boolean {
    if (!this.previous || this.loading || this.revision >= Number.MAX_SAFE_INTEGER - 1) return false;
    this.invalidate('stale'); this.current = this.previous; this.previous = null; this.revision++; return true;
  }
  cancel(requestId: string): void {
    const r = this.receipts.get(requestId);
    if (r && (r.status === 'rendering' || r.status === 'preview')) { r.status = 'canceled'; r.abort.abort(); r.render = undefined; if (this.previewId === requestId) this.previewId = null; }
  }
  revoke(): void { this.loading?.abort(); this.loading = null; this.invalidate('revoked'); this.generation = crypto.randomUUID(); }
  exportPNG(): Blob {
    if (!this.current) throw new Error('NO_SCENE');
    if (this.current.render.diagnostics.some(d => d.severity === 'error')) throw new Error('FIX_LAYOUT_BEFORE_EXPORT');
    return this.current.render.png;
  }
  dispose(): void { this.loading?.abort(); this.loading = null; this.invalidate('canceled'); this.current = null; this.previous = null; this.generation = crypto.randomUUID(); }
}

import { importProposal, parseScene, type Scene } from './visual-remix.ts';
import { VisualRemixController, type ProposalStatus } from './visual-remix-controller.ts';
import { SCENE_LIMITS } from './visual-remix-remote.ts';

// Offline preparation only. No route, OAuth verifier, storage, fetch or Apply tool.
// A future transport must supply independently verified purpose-specific authority;
// these local consent fields are never proof of a remote caller's identity.
export const SCENE_MESSAGE_BYTES = 12 * 1024;
export const SCENE_SHARE_FIELDS = ['text', 'layout', 'captions', 'provenance', 'limitations', 'rasterDescriptors'] as const;
export type SceneShareConsent = {
  purpose: 'visual-remix'; confirmed: true; projectId: string; generation: string;
  expiresAt: number; fields: readonly (typeof SCENE_SHARE_FIELDS)[number][];
};
type Reply = { requestId: string; state: ProposalStatus | 'share_revoked'; applied: boolean; awaitingApply: boolean; terminal: boolean };
function bounded(text: string): void {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > SCENE_MESSAGE_BYTES) throw new Error('SCENE_MESSAGE_TOO_LARGE');
}

export class VisualRemixOfflineBridge {
  private readonly consent: Pick<SceneShareConsent, 'projectId' | 'generation' | 'expiresAt'>;
  private readonly controller: VisualRemixController;
  private readonly now: () => number;
  private readonly issued = new Set<string>();
  private readonly expiry: ReturnType<typeof setTimeout>;
  private closed = false;
  constructor(controller: VisualRemixController, consent: SceneShareConsent, now: () => number = Date.now) {
    const snapshot = controller.snapshot();
    if (!consent || consent.purpose !== 'visual-remix' || consent.confirmed !== true ||
      consent.projectId !== snapshot.projectId || consent.generation !== snapshot.generation || !snapshot.scene || snapshot.loading ||
      !Number.isFinite(consent.expiresAt) || consent.expiresAt <= now() || consent.expiresAt - now() > SCENE_LIMITS.leaseMs ||
      !Array.isArray(consent.fields) || consent.fields.length !== SCENE_SHARE_FIELDS.length ||
      new Set(consent.fields).size !== SCENE_SHARE_FIELDS.length || !SCENE_SHARE_FIELDS.every(field => consent.fields.includes(field))) throw new Error('SCENE_SHARE_NOT_CONFIRMED');
    this.controller = controller; this.consent = { projectId: consent.projectId, generation: consent.generation, expiresAt: consent.expiresAt }; this.now = now;
    this.expiry = setTimeout(() => this.revoke(), consent.expiresAt - now());
  }
  private bound(): boolean {
    const snapshot = this.controller.snapshot();
    return !snapshot.loading && snapshot.projectId === this.consent.projectId && snapshot.generation === this.consent.generation;
  }
  private active(): boolean {
    if (!this.closed && (!this.bound() || this.now() >= this.consent.expiresAt)) this.revoke();
    return !this.closed;
  }
  private requireShare(): void { if (!this.active()) throw new Error('SCENE_SHARE_REVOKED_OR_EXPIRED'); }
  getScene(): { schemaVersion: 1; projectId: string; generation: string; revision: number; scene: Scene } {
    this.requireShare();
    const snapshot = this.controller.snapshot(), scene = parseScene(snapshot.scene);
    const used = new Set(scene.nodes.flatMap(node => node.type === 'image' ? [node.assetId] : []));
    scene.assets = scene.assets.filter(asset => used.has(asset.id));
    // Select owned fields explicitly; snapshot output/preview Blobs never cross.
    const result = { schemaVersion: 1 as const, projectId: snapshot.projectId, generation: snapshot.generation, revision: snapshot.revision, scene };
    bounded(JSON.stringify(result)); return result;
  }
  async proposeScene(payload: string): Promise<Reply> {
    this.requireShare(); bounded(payload);
    const proposal = importProposal(payload);
    const pending = this.controller.propose(proposal);
    this.issued.add(proposal.requestId);
    await pending;
    return this.reply(proposal.requestId);
  }
  proposalStatus(requestId: string): Reply { this.requireShare(); return this.reply(requestId); }
  cancelProposal(requestId: string): Reply {
    this.requireShare();
    if (!this.issued.has(requestId)) throw new Error('UNKNOWN_SCENE_REQUEST');
    this.controller.cancel(requestId); return this.reply(requestId);
  }
  private reply(requestId: string): Reply {
    if (!this.issued.has(requestId)) throw new Error('UNKNOWN_SCENE_REQUEST');
    const state = this.active() ? this.controller.status(requestId) : 'share_revoked';
    if (!state) throw new Error('UNKNOWN_SCENE_REQUEST');
    return { requestId, state, applied: state === 'applied', awaitingApply: state === 'preview', terminal: state !== 'rendering' && state !== 'preview' };
  }
  revoke(): void {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.expiry);
    // An old session must never cancel a new project's reused request IDs.
    if (this.bound()) for (const requestId of this.issued) this.controller.cancel(requestId);
  }
}

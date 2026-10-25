import { parseProposal, parseScene, type Proposal, type Scene } from './visual-remix.ts';

// Inactive candidate data contract. Never contains raster/export bytes or URLs.
export const SCENE_SCOPES = ['scene:read', 'scene:propose'] as const;
export const SCENE_FIELDS = ['text', 'layout', 'captions', 'provenance', 'limitations', 'rasterDescriptors'] as const;
export const SCENE_LIMITS = { payloadBytes: 12_288, wireBytes: 16_384, leaseMs: 1_800_000, legacyLeaseMs: 900_000, proofMs: 300_000, freshnessMs: 10_000, shares: 20, requests: 16 } as const;
export type SceneSnapshot = { schemaVersion: 1; projectId: string; generation: string; revision: number; scene: Scene };
export type SceneAuth = { purpose: 'visual-remix'; shareId: string; projectId: string; generation: string; epoch: number };
export type SceneOwner = SceneAuth & { credential: string };
export type SceneState = 'queued' | 'rendering' | 'preview' | 'applied' | 'stale' | 'canceled' | 'revoked' | 'failed';
export type SceneResult = { requestId: string; state: SceneState; applied: boolean; awaitingApply: boolean; terminal: boolean };
export const sceneId = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(value)) throw new Error('SCENE_ID');
  return value;
};
export function sceneObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertyNames(value).sort().join('|') !== [...keys].sort().join('|') || Object.getOwnPropertySymbols(value).length ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d))) throw new Error('SCENE_FIELDS');
  return value as Record<string, unknown>;
}
export function sceneJSON(value: unknown, max: number = SCENE_LIMITS.payloadBytes): string {
  const text = JSON.stringify(value);
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > max) throw new Error('SCENE_MESSAGE_LIMIT');
  return text;
}
function remoteScene(value: unknown): Scene {
  const scene = parseScene(value), used = new Set(scene.nodes.flatMap(node => node.type === 'image' ? [node.assetId] : []));
  if (scene.assets.some(asset => !used.has(asset.id))) throw new Error('UNUSED_SCENE_ASSET');
  return scene;
}
export function parseSceneSnapshot(value: unknown): SceneSnapshot {
  const s = sceneObject(value, ['schemaVersion', 'projectId', 'generation', 'revision', 'scene']);
  if (s.schemaVersion !== 1 || !Number.isSafeInteger(s.revision) || Number(s.revision) < 0 || Number(s.revision) >= Number.MAX_SAFE_INTEGER) throw new Error('SCENE_REVISION');
  const result: SceneSnapshot = { schemaVersion: 1, projectId: sceneId(s.projectId), generation: sceneId(s.generation), revision: Number(s.revision), scene: remoteScene(s.scene) };
  sceneJSON(result); return result;
}
export function parseSceneProposal(value: unknown): Proposal {
  const proposal = parseProposal(value); proposal.scene = remoteScene(proposal.scene); sceneJSON(proposal); return proposal;
}
export function parseSceneAuth(value: unknown, owner = false): SceneOwner | SceneAuth {
  const a = sceneObject(value, ['purpose','shareId','projectId','generation','epoch', ...(owner ? ['credential'] : [])]);
  if (a.purpose !== 'visual-remix' || !Number.isSafeInteger(a.epoch) || Number(a.epoch) < 1) throw new Error('SCENE_AUTH');
  const auth: SceneAuth = { purpose: 'visual-remix', shareId: sceneId(a.shareId), projectId: sceneId(a.projectId), generation: sceneId(a.generation), epoch: Number(a.epoch) };
  if (!owner) return auth;
  if (typeof a.credential !== 'string' || !/^[a-f0-9]{64}$/.test(a.credential)) throw new Error('SCENE_OWNER');
  return { ...auth, credential: a.credential };
}
export function sceneResult(requestId: string, state: SceneState): SceneResult {
  return { requestId, state, applied: state === 'applied', awaitingApply: state === 'preview', terminal: !['queued','rendering','preview'].includes(state) };
}
export function sceneToolResult(value: unknown) {
  const result = { content: [{ type: 'text' as const, text: sceneJSON(value) }] };
  // Bound the actual nested JSON-RPC response, including escaping and its id.
  sceneJSON({ jsonrpc: '2.0', id: 'x'.repeat(96), result }, SCENE_LIMITS.wireBytes);
  return result;
}

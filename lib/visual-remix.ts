// Application-owned data, never native Konva JSON or executable agent output.
export const REMIX_LIMITS = { nodes: 100, text: 20_000, assets: 10, projectBytes: 20_000_000, proposalBytes: 250_000, imageBytes: 10_000_000, imagePixels: 16_000_000, totalPixels: 32_000_000, requests: 256 } as const;
export type RasterAsset = { id: string; mime: 'image/png' | 'image/jpeg'; width: number; height: number };
type Box = { id: string; x: number; y: number; width: number; height: number; rotation: number; opacity: number };
export type SceneNode = Box & (
  | { type: 'text'; text: string; font: 'sans' | 'serif' | 'mono'; fontSize: number; fontWeight: 'normal' | 'bold'; lineHeight: number; align: 'left' | 'center' | 'right'; wrap: 'word' | 'char'; fill: string }
  | { type: 'rect'; fill: string; cornerRadius: number }
  | { type: 'ellipse'; fill: string }
  | { type: 'image'; assetId: string; crop: { x: number; y: number; width: number; height: number } }
);
export type Scene = { canvas: { width: 1080; height: 1440 }; background: string; nodes: SceneNode[]; assets: RasterAsset[]; captions: { titleCN: string; captionCN: string; titleEN: string; captionEN: string }; provenance: string; limitations: string };
export type Project = { schemaVersion: 1; projectId: string; revision: number; scene: Scene; assets: { id: string; data: string }[] };
export type Proposal = { schemaVersion: 1; requestId: string; projectId: string; generation: string; baseRevision: number; scene: Scene; explanation: string };

function fail(): never { throw new Error('INVALID_SCENE_DATA'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const v = value as Record<string, unknown>;
  if (Object.getOwnPropertyNames(v).sort().join('|') !== [...keys].sort().join('|') || Object.getOwnPropertySymbols(v).length || Object.values(Object.getOwnPropertyDescriptors(v)).some(d => !('value' in d))) fail();
  return v;
}
function str(v: unknown, max: number): string { if (typeof v !== 'string' || v.length > max || /<[!/?a-z]/i.test(v) || v.includes(String.fromCharCode(0))) fail(); return v; }
function id(v: unknown): string { if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(v)) fail(); return v; }
function num(v: unknown, min: number, max: number): number { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(); return v; }
function integer(v: unknown, min: number, max: number): number { const n = num(v, min, max); if (!Number.isSafeInteger(n)) fail(); return n; }
function choice<T extends string>(v: unknown, values: readonly T[]): T { if (typeof v !== 'string' || !values.includes(v as T)) fail(); return v as T; }
function color(v: unknown): string { if (typeof v !== 'string' || !/^#[a-f\d]{6}([a-f\d]{2})?$/i.test(v)) fail(); return v; }
function array(v: unknown, max: number): unknown[] { if (!Array.isArray(v) || v.length > max || Array.from({length:v.length},(_,i)=>i).some(i=>!Object.hasOwn(v,i))) fail(); return v; }
function unique(ids: string[]): void { if (new Set(ids).size !== ids.length) fail(); }
function json(text: string, max: number): unknown { if (typeof text !== 'string' || text.length > max || new TextEncoder().encode(text).length > max) fail(); return JSON.parse(text); }
export function parseScene(input: unknown): Scene {
  const s = object(input, ['canvas','background','nodes','assets','captions','provenance','limitations']);
  const canvas = object(s.canvas, ['width','height']);
  if (canvas.width !== 1080 || canvas.height !== 1440) fail();
  const assets = array(s.assets, REMIX_LIMITS.assets).map(value => {
    const a = object(value, ['id','mime','width','height']);
    const asset: RasterAsset = { id: id(a.id), mime: choice(a.mime, ['image/png','image/jpeg']), width: integer(a.width, 1, 16384), height: integer(a.height, 1, 16384) };
    if (asset.width * asset.height > REMIX_LIMITS.imagePixels) fail();
    return asset;
  });
  unique(assets.map(a => a.id));
  if (assets.reduce((sum, a) => sum + a.width * a.height, 0) > REMIX_LIMITS.totalPixels) fail();
  const nodes: SceneNode[] = array(s.nodes, REMIX_LIMITS.nodes).map(value => {
    if (!value || typeof value !== 'object') fail();
    const type = choice(Object.getOwnPropertyDescriptor(value, 'type')?.value, ['text','rect','ellipse','image']);
    const extra = { text: ['text','font','fontSize','fontWeight','lineHeight','align','wrap','fill'], rect: ['fill','cornerRadius'], ellipse: ['fill'], image: ['assetId','crop'] }[type];
    const n = object(value, ['id','type','x','y','width','height','rotation','opacity', ...extra]);
    const b: Box = { id: id(n.id), x: num(n.x, 0, 1080), y: num(n.y, 0, 1440), width: num(n.width, 1, 1080), height: num(n.height, 1, 1440), rotation: num(n.rotation, -180, 180), opacity: num(n.opacity, 0, 1) };
    if (b.x + b.width > 1080 || b.y + b.height > 1440) fail();
    if (type === 'text') return { ...b, type, text: str(n.text, REMIX_LIMITS.text), font: choice(n.font, ['sans','serif','mono']), fontSize: num(n.fontSize, 8, 240), fontWeight: choice(n.fontWeight, ['normal','bold']), lineHeight: num(n.lineHeight, 1, 3), align: choice(n.align, ['left','center','right']), wrap: choice(n.wrap, ['word','char']), fill: color(n.fill) };
    if (type === 'rect') return { ...b, type, fill: color(n.fill), cornerRadius: num(n.cornerRadius, 0, Math.min(b.width, b.height) / 2) };
    if (type === 'ellipse') return { ...b, type, fill: color(n.fill) };
    const a = assets.find(a => a.id === n.assetId); if (!a) fail();
    const c = object(n.crop, ['x','y','width','height']);
    const crop = { x: num(c.x, 0, a.width), y: num(c.y, 0, a.height), width: num(c.width, 1, a.width), height: num(c.height, 1, a.height) };
    if (crop.x + crop.width > a.width || crop.y + crop.height > a.height) fail();
    return { ...b, type, assetId: a.id, crop };
  });
  unique(nodes.map(n => n.id));
  const c = object(s.captions, ['titleCN','captionCN','titleEN','captionEN']);
  const captions = { titleCN: str(c.titleCN, 200), captionCN: str(c.captionCN, 4000), titleEN: str(c.titleEN, 200), captionEN: str(c.captionEN, 4000) };
  const provenance = str(s.provenance, 2000), limitations = str(s.limitations, 2000);
  if (nodes.reduce((sum, n) => sum + (n.type === 'text' ? n.text.length : 0), 0) + Object.values(captions).join('').length + provenance.length + limitations.length > REMIX_LIMITS.text) fail();
  return { canvas: { width: 1080, height: 1440 }, background: color(s.background), nodes, assets, captions, provenance, limitations };
}
export function parseProposal(input: unknown): Proposal {
  const p = object(input, ['schemaVersion','requestId','projectId','generation','baseRevision','scene','explanation']);
  if (p.schemaVersion !== 1) fail();
  return { schemaVersion: 1, requestId: id(p.requestId), projectId: id(p.projectId), generation: id(p.generation), baseRevision: integer(p.baseRevision, 0, Number.MAX_SAFE_INTEGER - 1), scene: parseScene(p.scene), explanation: str(p.explanation, 2000) };
}
export function importProposal(text: string): Proposal { return parseProposal(json(text, REMIX_LIMITS.proposalBytes)); }
export function importProject(text: string): Project {
  const p = object(json(text, REMIX_LIMITS.projectBytes), ['schemaVersion','projectId','revision','scene','assets']);
  if (p.schemaVersion !== 1) fail();
  const scene = parseScene(p.scene);
  const assets = array(p.assets, REMIX_LIMITS.assets).map(value => {
    const a = object(value, ['id','data']);
    if (typeof a.data !== 'string' || a.data.length > Math.ceil(REMIX_LIMITS.imageBytes / 3) * 4 + 32 || !/^data:image\/(png|jpeg);base64,[A-Za-z\d+/]+={0,2}$/.test(a.data)) fail();
    return { id: id(a.id), data: a.data };
  });
  unique(assets.map(a => a.id));
  if (assets.length !== scene.assets.length || assets.some(a => !scene.assets.some(s => s.id === a.id && a.data.startsWith(`data:${s.mime};base64,`)))) fail();
  return { schemaVersion: 1, projectId: id(p.projectId), revision: integer(p.revision, 0, Number.MAX_SAFE_INTEGER - 1), scene, assets };
}
export function emptyScene(): Scene { return { canvas: { width: 1080, height: 1440 }, background: '#ffffff', nodes: [], assets: [], captions: { titleCN: '', captionCN: '', titleEN: '', captionEN: '' }, provenance: '', limitations: '' }; }

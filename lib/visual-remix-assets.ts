import { REMIX_LIMITS, importProject, parseScene, type Project, type RasterAsset, type Scene } from './visual-remix.ts';

// Read dimensions BEFORE asking a browser decoder to allocate the raster.
export function rasterHeader(bytes: Uint8Array): Omit<RasterAsset, 'id'> {
  const bad = (): never => { throw new Error('INVALID_RASTER'); };
  if (bytes.length < 24 || bytes.length > REMIX_LIMITS.imageBytes) bad();
  let mime: RasterAsset['mime'], width = 0, height = 0;
  if ([137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)) {
    if (new DataView(bytes.buffer, bytes.byteOffset).getUint32(8) !== 13 || String.fromCharCode(...bytes.slice(12,16)) !== 'IHDR') bad();
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    width = view.getUint32(16); height = view.getUint32(20); mime = 'image/png';
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    mime = 'image/jpeg';
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 255) bad();
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const size = (bytes[at] << 8) | bytes[at + 1];
      if (size < 2 || at + size > bytes.length) bad();
      if ([192,193,194].includes(marker)) {
        if (size < 8) bad();
        height = (bytes[at + 3] << 8) | bytes[at + 4]; width = (bytes[at + 5] << 8) | bytes[at + 6]; break;
      }
      at += size;
    }
  } else return bad();
  if (!width || !height || width > 16384 || height > 16384 || width * height > REMIX_LIMITS.imagePixels) bad();
  return { mime, width, height };
}
export type RasterDecoder = (blob: Blob) => Promise<{ width: number; height: number; close(): void }>;
const browserDecode: RasterDecoder = blob => createImageBitmap(blob, { imageOrientation: 'none' });
export class LocalAssets {
  private readonly values = new Map<string, { descriptor: RasterAsset; blob: Blob }>();
  private readonly pending = new Map<string, number>();
  descriptors(): RasterAsset[] { return [...this.values.values()].map(v => ({ ...v.descriptor })); }
  blob(descriptor: RasterAsset): Blob {
    const v = this.values.get(descriptor.id);
    if (!v || JSON.stringify(v.descriptor) !== JSON.stringify(descriptor)) throw new Error('ASSET_NOT_APPROVED');
    return v.blob;
  }
  async add(id: string, source: Blob, signal: AbortSignal, decode: RasterDecoder = browserDecode): Promise<RasterAsset> {
    signal.throwIfAborted();
    if (!/^[a-zA-Z0-9_-]{1,96}$/.test(id) || this.values.has(id) || this.values.size >= REMIX_LIMITS.assets || source.size > REMIX_LIMITS.imageBytes) throw new Error('ASSET_LIMIT');
    const bytes = new Uint8Array(await source.arrayBuffer());
    signal.throwIfAborted();
    const descriptor: RasterAsset = { id, ...rasterHeader(bytes) };
    if (this.values.has(id) || this.pending.has(id) || this.values.size + this.pending.size >= REMIX_LIMITS.assets) throw new Error('ASSET_LIMIT');
    if (this.descriptors().reduce((s, a) => s + a.width * a.height, 0) + [...this.pending.values()].reduce((a,b) => a+b,0) + descriptor.width * descriptor.height > REMIX_LIMITS.totalPixels) throw new Error('ASSET_PIXEL_LIMIT');
    const blob = new Blob([bytes], { type: descriptor.mime });
    this.pending.set(id, descriptor.width * descriptor.height);
    let decoded: Awaited<ReturnType<RasterDecoder>> | undefined;
    try {
      decoded = await decode(blob);
      signal.throwIfAborted();
      if (decoded.width !== descriptor.width || decoded.height !== descriptor.height) throw new Error('RASTER_DIMENSION_MISMATCH');
      // Recheck after async decode: concurrent adds cannot replace an approved ID
      // or exceed the store's aggregate resource budget.
      if (this.values.has(id) || this.values.size >= REMIX_LIMITS.assets || this.descriptors().reduce((s,a) => s + a.width*a.height,0) + descriptor.width*descriptor.height > REMIX_LIMITS.totalPixels) throw new Error('ASSET_LIMIT');
      this.values.set(id, { descriptor, blob });
      return { ...descriptor };
    } finally { decoded?.close(); this.pending.delete(id); }
  }
}
export async function loadPortableProject(text: string, signal: AbortSignal, decode?: RasterDecoder): Promise<{ project: Project; assets: LocalAssets }> {
  const project = importProject(text), assets = new LocalAssets();
  for (const entry of project.assets) {
    signal.throwIfAborted();
    const raw = atob(entry.data.split(',')[1]);
    const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    const actual = await assets.add(entry.id, new Blob([bytes]), signal, decode);
    const expected = project.scene.assets.find(a => a.id === entry.id)!;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('RASTER_DIMENSION_MISMATCH');
  }
  return { project, assets };
}
export async function savePortableProject(projectId: string, revision: number, scene: Scene, store: LocalAssets): Promise<string> {
  // Normalize a copy: exporting must not mutate live state or Undo history.
  const portableScene = parseScene(scene);
  const referenced = new Set(portableScene.nodes.flatMap(node => node.type === 'image' ? [node.assetId] : []));
  portableScene.assets = portableScene.assets.filter(asset => referenced.has(asset.id));
  const assets: Project['assets'] = [];
  for (const a of portableScene.assets) {
    const bytes = new Uint8Array(await store.blob(a).arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    assets.push({ id: a.id, data: `data:${a.mime};base64,${btoa(binary)}` });
  }
  const text = JSON.stringify({ schemaVersion: 1, projectId, revision, scene: portableScene, assets });
  importProject(text); // Same limits on export and import; no unusable saved file.
  return text;
}

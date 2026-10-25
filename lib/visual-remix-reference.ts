import { sceneObject, sceneJSON, parseSceneProposal } from './visual-remix-remote.ts';
import type { Proposal, RasterAsset } from './visual-remix.ts';
// Engineering bounds for this inactive candidate, not claimed ChatGPT limits.
export const REFERENCE_LIMITS = { bytes: 1048576, edge: 2048, wireBytes: 1500000 } as const;
export type ReferenceManifest = {
    version: 1;
    sourceSHA256: string;
    sourceWidth: number;
    sourceHeight: number;
    sha256: string;
    width: number;
    height: number;
    mime: 'image/png';
    bytes: number;
};
export type ReferenceConsent = {
    confirmed: true;
    reuseCrops: boolean;
    manifest: ReferenceManifest;
};
const integer = (v: unknown, max: number) => {
    if (!Number.isSafeInteger(v) || Number(v) < 1 || Number(v) > max)
        throw new Error('REFERENCE_LIMIT');
    return Number(v);
};
export function parseReferenceManifest(value: unknown): ReferenceManifest {
    const m = sceneObject(value, ['version', 'sourceSHA256', 'sourceWidth', 'sourceHeight', 'sha256', 'width', 'height', 'mime', 'bytes']);
    if (m.version !== 1 || m.mime !== 'image/png' || typeof m.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(m.sha256) || typeof m.sourceSHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(m.sourceSHA256))
        throw new Error('REFERENCE_MANIFEST');
    const result: ReferenceManifest = { version: 1, sourceSHA256: m.sourceSHA256, sourceWidth: integer(m.sourceWidth, 16384), sourceHeight: integer(m.sourceHeight, 16384), sha256: m.sha256, width: integer(m.width, REFERENCE_LIMITS.edge), height: integer(m.height, REFERENCE_LIMITS.edge), mime: 'image/png', bytes: integer(m.bytes, REFERENCE_LIMITS.bytes) };
    if (result.sourceWidth * result.sourceHeight > 16000000 || result.width > result.sourceWidth || result.height > result.sourceHeight || Math.abs(result.width / result.height - result.sourceWidth / result.sourceHeight) > 0.01)
        throw new Error('REFERENCE_DIMENSIONS');
    return result;
}
export function parseReferenceConsent(value: unknown): ReferenceConsent {
    const c = sceneObject(value, ['confirmed', 'reuseCrops', 'manifest']);
    if (c.confirmed !== true || typeof c.reuseCrops !== 'boolean')
        throw new Error('REFERENCE_CONSENT');
    return { confirmed: true, reuseCrops: c.reuseCrops, manifest: parseReferenceManifest(c.manifest) };
}
export const sourceAsset = (m: ReferenceManifest): RasterAsset => ({ id: `reference-${m.sourceSHA256}`, mime: 'image/png', width: m.sourceWidth, height: m.sourceHeight });
export function referenceCrop(m: ReferenceManifest, asset: RasterAsset) {
    const prefix = `rc-${m.sourceSHA256}-`;
    if (!asset.id.startsWith(prefix))
        return null;
    const tail = asset.id.slice(prefix.length);
    if (!/^\d+-\d+-\d+-\d+$/.test(tail))
        throw new Error('REFERENCE_CROP');
    const [x, y, width, height] = tail.split('-').map(Number);
    if (![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || width < 1 || height < 1 || x + width > m.sourceWidth || y + height > m.sourceHeight || (width === m.sourceWidth && height === m.sourceHeight) || asset.mime !== 'image/png' || asset.width !== width || asset.height !== height)
        throw new Error('REFERENCE_CROP');
    return { x, y, width, height };
}
// Normalize before hashing/admitting. Browser ACK compares the exact normalized
// Scene, and saved projects contain materialized crop files, never a source
// image hidden behind render-time crop coordinates.
export function materializeReferenceProposal(value: unknown, consent: ReferenceConsent): Proposal {
    const p = parseSceneProposal(value), source = sourceAsset(consent.manifest);
    if (!p.scene.assets.some(a => a.id === source.id))
        return p;
    if (!consent.reuseCrops || !p.scene.assets.some(a => sceneJSON(a) === sceneJSON(source)))
        throw new Error('REFERENCE_CROP_NOT_CONSENTED');
    const assets = new Map(p.scene.assets.filter(a => a.id !== source.id).map(a => [a.id, a]));
    for (const node of p.scene.nodes) {
        if (node.type !== 'image' || node.assetId !== source.id)
            continue;
        const { x, y, width, height } = node.crop;
        const asset: RasterAsset = { id: `rc-${consent.manifest.sourceSHA256}-${x}-${y}-${width}-${height}`, mime: 'image/png', width, height };
        if (!referenceCrop(consent.manifest, asset))
            throw new Error('REFERENCE_CROP');
        const old = assets.get(asset.id);
        if (old && sceneJSON(old) !== sceneJSON(asset))
            throw new Error('REFERENCE_CROP_CONFLICT');
        assets.set(asset.id, asset);
        node.assetId = asset.id;
        node.crop = { x: 0, y: 0, width, height };
    }
    p.scene.assets = [...assets.values()];
    return parseSceneProposal(p);
}
export function referenceBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
}
export const referenceSHA256 = async (bytes: Uint8Array): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), b => b.toString(16).padStart(2, '0')).join('');

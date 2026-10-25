import { cropRaster, rasterHeader, type LocalAssets } from './visual-remix-assets.ts';
import { parseSceneProposal } from './visual-remix-remote.ts';
import { REFERENCE_LIMITS, referenceBase64, referenceSHA256, referenceCrop, type ReferenceConsent, type ReferenceManifest } from './visual-remix-reference.ts';
import type { Proposal } from './visual-remix.ts';
export type PreparedReference = {
    consent: ReferenceConsent;
    data: string;
    source: Blob;
};
// Called only after this image's fresh pixel consent. Preparing locally makes no
// request, persists no approval, and does not insert the full source as an asset.
export async function prepareSharedReference(source: Blob, reuseCrops: boolean, signal: AbortSignal): Promise<PreparedReference> {
    signal.throwIfAborted();
    const original = new Uint8Array(await source.arrayBuffer()), header = rasterHeader(original);
    const sourceSHA256 = await referenceSHA256(original);
    // Existing importer uses raw dimensions/orientation; preserve the same mapping.
    const bitmap = await createImageBitmap(source, { imageOrientation: 'none' });
    try {
        if (bitmap.width !== header.width || bitmap.height !== header.height)
            throw new Error('REFERENCE_ORIENTATION');
        for (const edge of [2048, 1536, 1200, 1024, 768, 512]) {
            signal.throwIfAborted();
            const scale = Math.min(1, edge / Math.max(header.width, header.height));
            const width = Math.max(1, Math.round(header.width * scale)), height = Math.max(1, Math.round(header.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context)
                throw new Error('REFERENCE_CANVAS');
            context.drawImage(bitmap, 0, 0, width, height);
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
            signal.throwIfAborted();
            if (!blob)
                throw new Error('REFERENCE_CANVAS');
            if (blob.size > REFERENCE_LIMITS.bytes)
                continue;
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const manifest: ReferenceManifest = { version: 1, sourceSHA256, sourceWidth: header.width, sourceHeight: header.height, sha256: await referenceSHA256(bytes), width, height, mime: 'image/png', bytes: bytes.length };
            signal.throwIfAborted();
            return { consent: { confirmed: true, reuseCrops, manifest }, data: referenceBase64(bytes), source };
        }
        throw new Error('REFERENCE_LIMIT');
    }
    finally {
        bitmap.close();
    }
}
export async function resolveReferenceCrops(value: unknown, reference: PreparedReference, assets: LocalAssets, signal: AbortSignal): Promise<Proposal> {
    const p = parseSceneProposal(value), m = reference.consent.manifest;
    if (!reference.consent.reuseCrops)
        return p;
    for (const asset of p.scene.assets) {
        signal.throwIfAborted();
        const crop = referenceCrop(m, asset);
        if (!crop)
            continue;
        if (assets.descriptors().some(a => a.id === asset.id)) {
            assets.blob(asset);
            continue;
        }
        const blob = await cropRaster(reference.source, crop, signal);
        await assets.add(asset.id, blob, signal);
    }
    signal.throwIfAborted();
    return p;
}

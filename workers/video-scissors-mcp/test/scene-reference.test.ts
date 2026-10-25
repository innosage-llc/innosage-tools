import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { randomBytes, createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { emptyScene, type Proposal } from '../../../lib/visual-remix.ts';
import { SCENE_LIMITS, type SceneOwner, type SceneAuth, type SceneSnapshot } from '../../../lib/visual-remix-remote.ts';
import { REFERENCE_LIMITS, sourceAsset, type ReferenceConsent } from '../../../lib/visual-remix-reference.ts';
import { proposalSchema } from '../../../lib/visual-remix-agent.ts';
import { fixture as providerFixture } from './fixtures/scene-client.ts';
function png(width = 400, height = 400, { extraRows = 0, filter = 0 } = {}) {
    const crc = (bytes: Buffer) => { let c = 0xffffffff; for (const b of bytes) {
        c ^= b;
        for (let n = 0; n < 8; n++)
            c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
    } const r = Buffer.alloc(4); r.writeUInt32BE((c ^ 0xffffffff) >>> 0); return r; };
    const chunk = (type: string, data: Buffer) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); return Buffer.concat([length, body, crc(body)]); };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    const rows = randomBytes((width * 4 + 1) * (height + extraRows));
    for (let row = 0; row < height + extraRows; row++)
        rows[row * (width * 4 + 1)] = filter;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const bytes = png(), sha = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
const consent: ReferenceConsent = { confirmed: true, reuseCrops: true, manifest: { version: 1, sourceSHA256: 'b'.repeat(64), sourceWidth: 1000, sourceHeight: 1000, sha256: sha(bytes), width: 400, height: 400, mime: 'image/png', bytes: bytes.length } };
const reference = { manifest: consent.manifest, data: bytes.toString('base64') };
const snapshot: SceneSnapshot = { schemaVersion: 1, projectId: 'synthetic-reference', generation: 'synthetic-generation', revision: 0, scene: emptyScene() };
type Created = {
    auth: SceneOwner;
    proof: string;
};
async function fixture() {
    const bundle = await build({ entryPoints: ['test/fixtures/scene-reference.ts'], bundle: true, format: 'esm', platform: 'browser', conditions: ['workerd'], external: ['node:*', 'cloudflare:*'], write: false });
    let egress = 0, time = Date.now();
    const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], outboundService: () => { egress++; return new Response('DENIED', { status: 403 }); } })), db = await mf.getD1Database('DB');
    for (const path of ['migrations/0001.sql', 'candidate-migrations/scene.sql', 'candidate-migrations/scene-until-revoked.sql', 'candidate-migrations/scene-reference.sql'])
        await db.exec(readFileSync(path, 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' '));
    const call = async (action: string, data: Record<string, unknown> = {}, disabled = false) => {
        const response = await mf.dispatchFetch('https://localhost/fixture', { method: 'POST', headers: { 'content-type': 'application/json', 'x-fixture-time': String(time), ...(disabled ? { 'x-fixture-disabled': 'true' } : {}) }, body: JSON.stringify({ action, ...data }) });
        return { status: response.status, ...await response.json() as {
                value: unknown;
                error?: string;
                result?: {
                    content?: {
                        type: string;
                        data?: string;
                        text?: string;
                        mimeType?: string;
                    }[];
                    tools?: {
                        name: string;
                    }[];
                };
            } };
    };
    const create = async (c: unknown = consent, leaseMs?:number) => { const r = await call('create', { snapshot, consent: c,...(leaseMs!==undefined?{leaseMs}:{}) }); assert.equal(r.status, 200, r.error); return r.value as Created; };
    const bind = async (p: Created) => { const r = await call('bind', { proof: p.proof }); assert.ok(r.value); return r.value as SceneAuth; };
    return { mf, db, call, create, bind, advance: (ms: number) => { time += ms; }, noEgress: () => assert.equal(egress, 0) };
}
test('private image bytes require fresh per-share consent and OAuth binding; native SDK image survives full bounded envelope', async () => {
    const f = await fixture();
    try {
        const p = await f.create();
        assert.equal((await f.call('upload', { auth: p.auth, reference })).value, false, 'no upload before successful lease binding');
        const remote = await f.bind(p);
        assert.equal((await f.call('upload', { auth: { ...p.auth, credential: 'a'.repeat(64) }, reference })).value, false);
        assert.equal((await f.call('upload', { auth: p.auth, reference })).value, true);
        assert.equal((await f.call('upload', { auth: p.auth, reference })).value, true, 'lost upload ACK is idempotent');
        const stored = await f.db.prepare('SELECT pixels FROM scene_references WHERE share=?').bind(p.auth.shareId).first<ArrayBuffer>('pixels');
        assert.equal(sha(new Uint8Array(stored!)), sha(bytes));
        const rpc = await f.call('rpc', { auth: remote, rpc: { jsonrpc: '2.0', id: 'image-proof', method: 'tools/call', params: { name: 'read_shared_reference', arguments: {} } } });
        assert.equal(rpc.status, 200, JSON.stringify(rpc));
        assert.deepEqual(JSON.parse(rpc.result!.content![0].text!).proposalSchema,proposalSchema,'schema arrives with native pixels, without another attachment');
        const image = rpc.result?.content?.find(c => c.type === 'image');
        assert.equal(image?.mimeType, 'image/png');
        assert.equal(sha(Buffer.from(image!.data!, 'base64')), sha(bytes));
        assert.ok(JSON.stringify(rpc).length > SCENE_LIMITS.wireBytes);
        const legacy = (await f.call('create', { snapshot })).value as Created, legacyRemote = await f.bind(legacy);
        assert.equal((await f.call('upload', { auth: legacy.auth, reference })).value, false, 'historical field consent grants no pixels');
        const denied = await f.call('read', { auth: legacyRemote });
        assert.equal((denied.value as {
            isError: boolean;
        }).isError, true);
        const list = await f.call('rpc', { auth: remote, rpc: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }, true);
        assert.ok(!list.result?.tools?.some(t => t.name === 'read_shared_reference'));
        assert.equal((await f.call('create', { snapshot, consent }, true)).status, 409, 'disabled flag rejects new image consent');
        f.noEgress();
    }
    finally {
        await f.mf.dispose();
    }
});
test('immutable image digest, decoding bounds, share isolation, freshness, expiry/revocation deny and purge', async () => {
    const f = await fixture();
    try {
        const p = await f.create(), remote = await f.bind(p), other = await f.create();
        await f.bind(other);
        assert.equal((await f.call('upload', { auth: p.auth, reference: { ...reference, manifest: { ...reference.manifest, sha256: 'c'.repeat(64) } } })).status, 409);
        const corrupt = Buffer.from(bytes);
        corrupt[50] ^= 1;
        assert.equal((await f.call('upload', { auth: p.auth, reference: { ...reference, data: corrupt.toString('base64') } })).status, 409);
        assert.equal((await f.call('create', { snapshot, consent: { ...consent, manifest: { ...consent.manifest, bytes: REFERENCE_LIMITS.bytes + 1 } } })).status, 409);
        await f.call('upload', { auth: p.auth, reference });
        assert.equal(((await f.call('read', { auth: { ...remote, shareId: other.auth.shareId } })).value as {
            isError: boolean;
        }).isError, true);
        f.advance(SCENE_LIMITS.freshnessMs + 1);
        assert.equal(((await f.call('read', { auth: remote })).value as {
            isError: boolean;
        }).isError, true);
        await f.call('sync', { auth: p.auth, snapshot });
        assert.ok((await f.call('read', { auth: remote })).value);
        await f.call('revoke', { auth: p.auth });
        assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_references WHERE share=?').bind(p.auth.shareId).first('n'), 0);
        assert.equal((await f.call('upload', { auth: p.auth, reference })).value, false);
        assert.equal(((await f.call('read', { auth: remote })).value as {
            isError: boolean;
        }).isError, true);
        await f.call('upload', { auth: other.auth, reference });
        f.advance(SCENE_LIMITS.leaseMs);
        assert.equal(((await f.call('read', { auth: { ...other.auth, credential: undefined } })).value as {
            isError: boolean;
        }).isError, true);
        await f.call('sweep');
        assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_references').first('n'), 0);
        f.noEgress();
    }
    finally {
        await f.mf.dispose();
    }
});
test('untrusted image bytes with matching SHA still require valid CRC, bounded deflate and scanline filters', async () => {
    const f = await fixture();
    try {
        const corrupt = Buffer.from(bytes);
        corrupt[50] ^= 1;
        for (const invalid of [corrupt, png(400, 400, { extraRows: 1 }), png(400, 400, { filter: 5 }), bytes.subarray(0, bytes.length - 12)]) {
            const manifest = { ...consent.manifest, sha256: sha(invalid), bytes: invalid.length };
            const p = await f.create({ ...consent, manifest });
            await f.bind(p);
            const result = await f.call('upload', { auth: p.auth, reference: { manifest, data: invalid.toString('base64') } });
            assert.equal(result.status, 409, result.error);
            assert.equal(await f.db.prepare('SELECT pixels FROM scene_references WHERE share=?').bind(p.auth.shareId).first('pixels'), null);
        }
        f.noEgress();
    }
    finally {
        await f.mf.dispose();
    }
});
test('source crop proposals become tight immutable crop assets before hashing; applied ACK remains exact and no consent is inferred', async () => {
    const f = await fixture();
    try {
        const p = await f.create(), remote = await f.bind(p);
        await f.call('upload', { auth: p.auth, reference });
        const source = sourceAsset(consent.manifest), proposal: Proposal = { schemaVersion: 1, requestId: 'crop-proposal', projectId: snapshot.projectId, generation: snapshot.generation, baseRevision: 0, explanation: 'Synthetic photo crop', scene: { ...emptyScene(), assets: [source], nodes: [{ id: 'photo', type: 'image', assetId: source.id, crop: { x: 20, y: 30, width: 80, height: 90 }, x: 40, y: 70, width: 80, height: 90, rotation: 0, opacity: 1 }] } };
        assert.ok((await f.call('propose', { auth: remote, proposal })).value);
        assert.ok((await f.call('propose', { auth: remote, proposal })).value, 'same raw source proposal normalizes identically');
        const command = (await f.call('claim', { auth: p.auth })).value as Proposal;
        assert.equal(command.scene.assets.length, 1);
        assert.equal(command.scene.assets[0].width, 80);
        assert.notEqual(command.scene.assets[0].id, source.id);
        assert.deepEqual(command.scene.nodes[0].type === 'image' && command.scene.nodes[0].crop, { x: 0, y: 0, width: 80, height: 90 });
        await f.call('report', { auth: p.auth, id: proposal.requestId, state: 'preview' });
        assert.equal((await f.call('report', { auth: p.auth, id: proposal.requestId, state: 'applied' })).value, false);
        await f.call('sync', { auth: p.auth, snapshot: { ...snapshot, revision: 1, scene: command.scene } });
        assert.equal((await f.call('report', { auth: p.auth, id: proposal.requestId, state: 'applied' })).value, true);
        const noReuse = await f.create({ ...consent, reuseCrops: false }), noReuseRemote = await f.bind(noReuse);
        await f.call('upload', { auth: noReuse.auth, reference });
        assert.equal((await f.call('propose', { auth: noReuseRemote, proposal })).status, 409);
        f.noEgress();
    }
    finally {
        await f.mf.dispose();
    }
});
test('actual local OAuth provider: exact scopes, private upload route, native image response, repeat invocation and revoke', async () => {
    const f = await providerFixture(undefined, false, true);
    try {
        const { p, t, a } = await f.link(consent);
        assert.match(a.html, /backups can retain up to 7 days/);
        assert.equal(t.refresh_token, undefined);
        assert.deepEqual(t.scope.split(' ').sort(), ['scene:propose', 'scene:read']);
        assert.equal((await f.json('/scene/browser/reference', { auth: p.auth, reference }, { Origin: 'https://untrusted.example' })).status, 403);
        const uploaded = await f.json('/scene/browser/reference', { auth: p.auth, reference });
        assert.equal(uploaded.status, 200, await uploaded.clone().text());
        assert.equal((await uploaded.json()).ok, true);
        for (let i = 0; i < 2; i++) {
            const { r, data } = await f.rpc(t.access_token, 'tools/call', { name: 'read_shared_reference', arguments: {} }, '/scene/mcp', `read-${i}`);
            assert.equal(r.status, 200);
            const image = data.result.content.find((c: {
                type: string;
            }) => c.type === 'image');
            assert.equal(sha(Buffer.from(image.data, 'base64')), sha(bytes));
            assert.equal(r.headers.get('x-visual-remix-tool'), 'read_shared_reference');
        }
        const unknown = await f.rpc(t.access_token, 'tools/call', { name: 'read_shared_reference', arguments: { url: 'https://example.invalid/private.png' } });
        assert.equal(unknown.data.result.isError, true, 'unknown URL argument rejected');
        const old = await f.link();
        const missing = await f.rpc(old.t.access_token, 'tools/call', { name: 'read_shared_reference', arguments: {} });
        assert.equal(missing.data.result.isError, true, 'existing field-only grant cannot read another share image');
        const refused = await f.json('/scene/browser/sync', { auth: p.auth, snapshot: { ...snapshot, scene: { ...emptyScene(), limitations: 'x'.repeat(17000) } } });
        assert.equal(refused.status, 400, 'larger image bound does not widen Scene routes');
        assert.equal((await f.json('/scene/browser/revoke', { auth: p.auth })).status, 200);
        assert.equal((await f.rpc(t.access_token, 'tools/call', { name: 'read_shared_reference', arguments: {} })).r.status, 401);
        assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_references WHERE share=?').bind(p.auth.shareId).first('n'), 0);
        f.noEgress();
    }
    finally {
        await f.mf.dispose();
    }
});


test('30-minute reference access expires without heartbeat extension; old payload cannot enter fresh consent',async()=>{
 const f=await fixture();try{
  const p=await f.create(consent,1800000),remote=await f.bind(p);await f.call('upload',{auth:p.auth,reference});
  f.advance(900001);assert.equal((await f.call('sync',{auth:p.auth,snapshot})).value,true);
  assert.ok(!((await f.call('read',{auth:remote})).value as {isError?:boolean}).isError);
  f.advance(900000);assert.equal((await f.call('sync',{auth:p.auth,snapshot})).value,false);
  assert.ok(((await f.call('read',{auth:remote})).value as {isError?:boolean}).isError);assert.equal((await f.call('upload',{auth:p.auth,reference})).value,false);
  await f.call('revoke',{auth:p.auth});assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_references WHERE share=?').bind(p.auth.shareId).first('n'),0);
  const fresh=await f.create(undefined,1800000),newRemote=await f.bind(fresh);
  assert.ok(((await f.call('read',{auth:newRemote})).value as {isError?:boolean}).isError,'fresh grant does not inherit bytes');
  assert.equal((await f.call('upload',{auth:fresh.auth,reference})).value,true);assert.ok(!((await f.call('read',{auth:newRemote})).value as {isError?:boolean}).isError);
  assert.ok(((await f.call('read',{auth:remote})).value as {isError?:boolean}).isError);f.noEgress();
 }finally{await f.mf.dispose();}
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { emptyScene } from '../../../lib/visual-remix.ts';
import { UNTIL_REVOKED_CONSENT } from '../../../lib/visual-remix-lifetime.ts';
import { SCENE_LIMITS, type SceneOwner, type SceneAuth } from '../../../lib/visual-remix-remote.ts';
const snapshot = () => ({ schemaVersion: 1, projectId: 'lifetime-project', generation: 'lifetime-generation', revision: 0, scene: emptyScene() });
const proposal = (requestId = 'pending') => ({ schemaVersion: 1, projectId: snapshot().projectId, generation: snapshot().generation, baseRevision: 0, requestId, explanation: 'Synthetic text and layout', scene: { ...emptyScene(), background: '#123456' } });
type Created = {
    auth: SceneOwner;
    proof: string;
    expiresAt: number | null;
    proofExpiresAt: number;
    issuedAt?: number;
    lifetime?: string;
};
async function fixture(withReferences = true) {
    const bundle = await build({ entryPoints: ['test/fixtures/scene.ts'], bundle: true, format: 'esm', platform: 'browser', conditions: ['workerd'], write: false });
    let egress = 0, time = Date.now();
    const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-13', d1Databases: ['DB'], outboundService: () => { egress++; return new Response('DENIED', { status: 403 }); } }));
    const db = await mf.getD1Database('DB');
    const sql = async (path: string) => db.exec(readFileSync(path, 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' '));
    await sql('migrations/0001.sql');
    await sql('candidate-migrations/scene.sql');
    // Model rows that genuinely predate the additive migration, not a new row
    // whose deadline was rewritten to make an expiry test pass.
    await db.prepare('INSERT INTO scene_shares(id,project,generation,credential_hash,proof_hash,proof_expires,expires,snapshot,revision,seen) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('legacy-row', 'legacy-project', 'legacy-generation', 'a'.repeat(64), 'b'.repeat(64), time + 300000, time + 900000, JSON.stringify(snapshot()), 0, time).run();
    await sql('candidate-migrations/scene-until-revoked.sql');
    if (withReferences) await sql('candidate-migrations/scene-reference.sql');
    const call = async <T = unknown>(action: string, data: Record<string, unknown> = {}, enabled = true, referencesEnabled = true) => {
        const r = await mf.dispatchFetch('https://localhost/fixture', { method: 'POST', headers: { 'content-type': 'application/json', 'x-fixture-time': String(time), 'x-fixture-reference': String(referencesEnabled), 'x-fixture-until-revoked': String(enabled) }, body: JSON.stringify({ action, ...data }) });
        return { status: r.status, ...await r.json() as {
                value: T;
                error?: string;
            } };
    };
    const create = async (extra: Record<string, unknown> = {}) => { const r = await call('create', { snapshot: snapshot(), lifetime: UNTIL_REVOKED_CONSENT, ...extra }); assert.equal(r.status, 200, r.error); return r.value as Created; };
    const bind = async (p: Created) => { const r = await call('bind', { proof: p.proof, handle: crypto.randomUUID() }); assert.ok(r.value); return r.value as SceneAuth; };
    return { mf, db, call, create, bind, advance: (ms: number) => { time += ms; }, now: () => time, noEgress: () => assert.equal(egress, 0) };
}
// Tiny valid RGBA PNG, generated locally; no user or external image is used.
function image() {
    const chunk = (type: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(type), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length); let c = 0xffffffff; for (const b of body) {
        c ^= b;
        for (let bit = 0; bit < 8; bit++)
            c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
    } crc.writeUInt32BE((c ^ 0xffffffff) >>> 0); return Buffer.concat([length, body, crc]); };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(2);
    header.writeUInt32BE(2, 4);
    header[8] = 8;
    header[9] = 6;
    const pixels = Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255]);
    const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
    const manifest = { version: 1, sourceSHA256: 'b'.repeat(64), sourceWidth: 2, sourceHeight: 2, sha256: createHash('sha256').update(bytes).digest('hex'), width: 2, height: 2, mime: 'image/png', bytes: bytes.length };
    return { consent: { confirmed: true, reuseCrops: true, manifest }, reference: { manifest, data: bytes.toString('base64') }, bytes };
}
test('explicit new lifetime is disabled by default; migrated fixed grants keep their immutable deadlines', async () => {
    const f = await fixture();
    try {
        const legacy = await f.db.prepare('SELECT expiry_policy,expires,grant_consent_version FROM scene_shares WHERE id=?').bind('legacy-row').first();
        assert.deepEqual(legacy, { expiry_policy: 'fixed', expires: f.now() + 900000, grant_consent_version: 0 });
        assert.equal((await f.call('create', { snapshot: snapshot(), lifetime: UNTIL_REVOKED_CONSENT }, false)).status, 409);
        for (const lifetime of [null, {}, { ...UNTIL_REVOKED_CONSENT, rememberBrowserControl: false }, { ...UNTIL_REVOKED_CONSENT, version: 2 }, { ...UNTIL_REVOKED_CONSENT, extra: true }])
            assert.equal((await f.call('create', { snapshot: snapshot(), lifetime })).status, 409);
        assert.equal((await f.call('create', { snapshot: snapshot(), lifetime: UNTIL_REVOKED_CONSENT, leaseMs: 1800000 })).status, 409);
        const fixed = await f.create({ lifetime: undefined }), longer = await f.create({ lifetime: undefined, leaseMs: 1800000 }), p = await f.create();
        assert.equal(fixed.expiresAt, f.now() + 900000);
        assert.equal(longer.expiresAt, f.now() + 1800000);
        assert.equal(p.expiresAt, null);
        assert.equal(p.lifetime, 'until-revoked');
        assert.equal(p.proofExpiresAt - p.issuedAt!, 300000);
        for (const [id, sql] of [[fixed.auth.shareId, "expiry_policy='until_revoked',expires=0,grant_consent_version=1"], [p.auth.shareId, 'expires=1'], ['legacy-row', `expires=${f.now() + 1800000}`]])
            await assert.rejects(f.db.prepare('UPDATE scene_shares SET ' + sql + ' WHERE id=?').bind(id).run(), /SCENE_LIFETIME_IMMUTABLE/);
        const a = await f.bind(p), old = await f.bind(fixed), recent = await f.bind(longer);
        f.advance(900001);
        assert.equal((await f.call('lease', { auth: old })).value, null);
        assert.equal((await f.call<{ expiresAt: number }>('lease', { auth: recent })).value.expiresAt, longer.expiresAt);
        f.advance(900000);
        await f.call('sweep');
        assert.equal((await f.call<{ expiresAt: number }>('lease', { auth: recent })).value, null);
        assert.deepEqual((await f.call('lease', { auth: a })).value, { expiresAt: null });
        assert.equal((await f.call('sync', { auth: p.auth, snapshot: snapshot() })).value, true);
        assert.deepEqual((await f.call('snapshot', { auth: a })).value, snapshot());
        assert.equal(await f.db.prepare('SELECT expires FROM scene_shares WHERE id=?').bind('legacy-row').first('expires'), legacy!.expires);
        f.noEgress();
    }
    finally {
        await f.mf.dispose();
    }
});
test('until-revoked pairing stays short, atomic and single-use; unpaired abandoned payloads are removed', async () => {
    const f = await fixture();
    try {
        const p = await f.create(), expired = await f.create();
        const binds = await Promise.all(['one', 'two'].map(handle => f.call<SceneAuth | null>('bind', { proof: p.proof, handle })));
        assert.equal(binds.filter(r => r.value).length, 1);
        assert.equal((await f.call('bind', { proof: p.proof, handle: 'three' })).value, null);
        f.advance(SCENE_LIMITS.proofMs + 1);
        assert.equal((await f.call('bind', { proof: expired.proof, handle: 'late' })).value, null);
        await f.call('sweep');
        assert.equal(await f.db.prepare('SELECT snapshot FROM scene_shares WHERE id=?').bind(expired.auth.shareId).first('snapshot'), null);
        assert.equal(await f.db.prepare('SELECT revoked FROM scene_shares WHERE id=?').bind(p.auth.shareId).first('revoked'), 0);
        assert.equal((await f.call('lease', { auth: { ...binds.find(r => r.value)!.value, projectId: 'other-project' } })).value, null);
        f.noEgress();
    }
    finally {
        await f.mf.dispose();
    }
});
test('inactive cache purge preserves authority, invalidates pending work and permits only matching restoration', async () => {
    const f = await fixture();
    try {
        const img = image(), p = await f.create({ referenceConsent: img.consent }), a = await f.bind(p), q = proposal();
        assert.equal((await f.call('upload', { auth: p.auth, reference: img.reference })).value, false, 'new grant requires cache generation');
        assert.equal((await f.call('upload', { auth: p.auth, reference: img.reference, cacheEpoch: 0 })).value, true);
        await f.call<{ state: string } | null>('propose', { auth: a, proposal: q });
        await f.call('claim', { auth: p.auth,cacheEpoch:0 });
        await f.call('report', { auth: p.auth, id: q.requestId, state: 'preview' });
        f.advance(1800001);
        await f.call('purge', {}, true, false);
        assert.deepEqual((await f.call('lease', { auth: a })).value, { expiresAt: null });
        assert.deepEqual((await f.call('cache', { auth: p.auth })).value, { cacheEpoch: 1 });
        const row = await f.db.prepare('SELECT epoch,snapshot,revision,snapshot_hash FROM scene_shares WHERE id=?').bind(p.auth.shareId).first();
        assert.equal(row!.epoch, 1);
        assert.equal(row!.snapshot, null);
        assert.equal(row!.revision, 0);
        assert.ok(row!.snapshot_hash);
        assert.equal(await f.db.prepare('SELECT pixels FROM scene_references WHERE share=?').bind(p.auth.shareId).first('pixels'), null);
        assert.equal(await f.db.prepare('SELECT payload FROM scene_requests WHERE share=?').bind(p.auth.shareId).first('payload'), null);
        assert.equal((await f.call<{ state: string }>('status', { auth: a, id: q.requestId })).value!.state, 'stale');
        assert.equal((await f.call('report', { auth: p.auth, id: q.requestId, state: 'applied' })).value, false);
        assert.equal((await f.call('sync', { auth: p.auth, snapshot: { ...snapshot(), scene: q.scene } })).value, false, 'same revision cannot overwrite hash after purge');
        assert.equal((await f.call('upload', { auth: p.auth, reference: img.reference, cacheEpoch: 0 })).value, false);
        assert.equal((await f.call('sync', { auth: p.auth, snapshot: snapshot() })).value, true);
        assert.equal((await f.call('upload', { auth: p.auth, reference: img.reference, cacheEpoch: 0 })).value, false, 'late upload stays rejected after fresh heartbeat');
        assert.equal((await f.call('upload', { auth: p.auth, reference: img.reference, cacheEpoch: 1 })).value, true);
        assert.equal((await f.call<{ content: { data: string }[]; isError?: boolean }>('readReference', { auth: a })).value.content[1].data, img.reference.data);
        assert.equal((await f.call<{ state: string } | null>('propose', { auth: a, proposal: q })).value!.state, 'stale', 'duplicate request never re-admitted');
        await f.call('propose',{auth:a,proposal:proposal('new-after-cache')});
        assert.equal((await f.call('claim',{auth:p.auth,cacheEpoch:0})).value,null);
        assert.ok((await f.call('claim',{auth:p.auth,cacheEpoch:1})).value);
        await f.call('report',{auth:p.auth,id:'new-after-cache',state:'stale'});
        assert.equal((await f.call('claim', { auth: p.auth,cacheEpoch:1 })).value, null);
        assert.equal(await f.db.prepare('SELECT request_count FROM scene_shares WHERE id=?').bind(p.auth.shareId).first('request_count'), 2);
        f.noEgress();
    }
    finally {
        await f.mf.dispose();
    }
});
test('revoke denies already-paired Scene/image/proposal operations and purges data without cross-project access', async () => {
    const f = await fixture();
    try {
        const img = image(), p = await f.create({ referenceConsent: img.consent }), a = await f.bind(p), q = proposal();
        await f.call('upload', { auth: p.auth, reference: img.reference, cacheEpoch: 0 });
        await f.call<{ state: string } | null>('propose', { auth: a, proposal: q });
        assert.equal((await f.call('snapshot', { auth: { ...a, projectId: 'other-project' } })).value, null);
        assert.equal((await f.call('upload', { auth: { ...p.auth, generation: 'other' }, reference: img.reference, cacheEpoch: 0 })).value, false);
        assert.equal((await f.call('revoke', { auth: p.auth })).value, true);
        assert.equal((await f.call('revoke', { auth: p.auth })).value, true);
        for (const action of ['lease', 'snapshot', 'status', 'claim', 'cache'])
            assert.equal((await f.call(action, { auth: action === 'claim' || action === 'cache' ? p.auth : a, id: q.requestId })).value, null);
        for (const action of ['sync', 'report', 'cancel'])
            assert.equal((await f.call(action, { auth: action === 'cancel' ? a : p.auth, snapshot: snapshot(), id: q.requestId, state: 'applied' })).value, false);
        assert.equal((await f.call<{ state: string } | null>('propose', { auth: a, proposal: q })).value, null);
        assert.equal((await f.call('upload', { auth: p.auth, reference: img.reference, cacheEpoch: 0 })).value, false);
        assert.equal((await f.call<{ content: { data: string }[]; isError?: boolean }>('readReference', { auth: a })).value.isError, true);
        assert.equal(await f.db.prepare('SELECT snapshot FROM scene_shares WHERE id=?').bind(p.auth.shareId).first('snapshot'), null);
        assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_references WHERE share=?').bind(p.auth.shareId).first('n'), 0);
        assert.equal(await f.db.prepare('SELECT payload FROM scene_requests WHERE share=?').bind(p.auth.shareId).first('payload'), null);
        f.noEgress();
    }
    finally {
        await f.mf.dispose();
    }
});
test('cleanup processes at most six oldest caches and never purges a fresh browser or fixed grant', async () => {
    const f = await fixture();
    try {
        const grants = [];
        for (let i = 0; i < 8; i++) {
            const p = await f.create();
            await f.bind(p);
            grants.push(p);
            f.advance(1);
        }
        const fixed = await f.create({ lifetime: undefined, leaseMs: 1800000 });
        await f.bind(fixed);
        f.advance(1800001);
        await f.call('sync', { auth: grants[0].auth, snapshot: snapshot() });
        await f.call('purge');
        assert.equal(await f.db.prepare("SELECT count(*) AS n FROM scene_shares WHERE expiry_policy='until_revoked' AND cache_epoch=1").first('n'), 6);
        assert.equal((await f.call<{ cacheEpoch: number }>('cache', { auth: grants[0].auth })).value.cacheEpoch, 0);
        assert.equal((await f.call<{ cacheEpoch: number }>('cache', { auth: grants[7].auth })).value.cacheEpoch, 0);
        await f.call('purge');
        assert.equal((await f.call<{ cacheEpoch: number }>('cache', { auth: grants[7].auth })).value.cacheEpoch, 1);
        assert.notEqual(await f.db.prepare('SELECT snapshot FROM scene_shares WHERE id=?').bind(fixed.auth.shareId).first('snapshot'), null, 'cache cleanup is separate from fixed-grant expiry sweep');
        f.noEgress();
    }
    finally {
        await f.mf.dispose();
    }
});

// A field-only installation never created the optional image schema.
test('inactive cleanup also works when the reference table was never installed',async()=>{
 const f=await fixture(false);try{const p=await f.create(),a=await f.bind(p);f.advance(1800001);assert.equal((await f.call('purge',{},true,false)).status,200);assert.deepEqual((await f.call('lease',{auth:a})).value,{expiresAt:null});assert.equal(await f.db.prepare('SELECT snapshot FROM scene_shares WHERE id=?').bind(p.auth.shareId).first('snapshot'),null);f.noEgress();}finally{await f.mf.dispose();}
});

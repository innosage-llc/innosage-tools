// Full local browser/provider integration. Historical editable fixture is NOT a
// fresh agent reconstruction or ChatGPT vision proof. No staging/egress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { fixture, origin } from './fixtures/scene-client.ts';
test('actual supplied pixels: fresh app consent -> native MCP image -> tight crop candidate -> Apply/export -> reopen and automatic local reuse', { timeout: 120000 }, async () => {
    const root = resolve('../..'), out = resolve(root, '.deploy/visual-remix/ux-20261025/reference-browser');
    await mkdir(out, { recursive: true });
    const original = await readFile(resolve(root, '../../../reference-assets/1(1).png'));
    assert.equal(createHash('sha256').update(original).digest('hex'), 'a933a808934eb8bf521b0d32c4bedb950698e76fccb62a997221e2d7b39715b5');
    const historical = JSON.parse(await readFile(resolve(root, '.deploy/visual-remix-vision/publish-bundle-803a00b/editable-scene.json'), 'utf8'));
    const f = await fixture(undefined, false, true), browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    const external: string[] = [], posts: {
        path: string;
        bytes: number;
    }[] = [], errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async (route) => {
        const r = route.request(), url = new URL(r.url());
        if (url.origin !== origin) {
            external.push(url.origin);
            return route.abort();
        }
        if (url.pathname.startsWith('/scene/')) {
            posts.push({ path: url.pathname, bytes: r.postDataBuffer()?.length ?? 0 });
            const response = await f.request(url.pathname, { method: r.method(), headers: await r.allHeaders(), body: r.postDataBuffer() ?? undefined });
            return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
        }
        try {
            const relative = decodeURIComponent(url.pathname).replace(/^\/tools\/?/, '');
            if (relative.includes('..'))
                return route.abort();
            const path = resolve(root, 'out', relative ? (extname(relative) ? relative : relative + '.html') : 'index.html');
            const body = await readFile(path);
            const type = ({ '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' } as Record<string, string>)[extname(path)] ?? 'text/html';
            return route.fulfill({ contentType: type, body });
        }
        catch {
            return route.fulfill({ status: 404, body: 'Not found' });
        }
    });
    const download = async (name: string) => { const event = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await event).path())!); };
    try {
        await page.goto(origin + '/tools/visual-remix');
        await page.getByText('Ready. Select a reference or open a saved project.', { exact: true }).waitFor();
        assert.equal(posts.length, 0);
        await page.getByLabel('Reference image', { exact: true }).setInputFiles({ name: 'private-reference.png', mimeType: 'image/png', buffer: original });
        await page.getByText('Reference ready locally.', { exact: false }).waitFor();
        assert.equal(posts.length, 0, 'selection sends no pixel or Scene request');
        const pixels = page.getByRole('checkbox', { name: /Authorize sharing a normalized PNG/ }), crops = page.getByRole('checkbox', { name: /Allow original local photo\/logo crops/ });
        assert.equal(await pixels.isChecked(), false);
        assert.equal(await crops.isChecked(), false);
        assert.equal(await crops.isDisabled(), true);
        await page.getByRole('checkbox', { name: /I authorize sharing scene/ }).check();
        await page.getByRole('checkbox', { name: /I acknowledge that shared/ }).check();
        await pixels.check();
        await crops.check();
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await page.getByLabel('Pairing Proof (single-use, valid 5 minutes)').waitFor();
        assert.equal(posts.filter(r => r.path.endsWith('/reference')).length, 0, 'pairing preparation does not upload pixels');
        const proof = await page.getByLabel('Pairing Proof (single-use, valid 5 minutes)').inputValue();
        const client = await f.client(), a = await f.authorize(client), response = await f.token(client, await f.approve(a, proof));
        assert.equal(response.status, 200);
        const token = await response.json();
        await page.getByText('Stored and available to authenticated tool', { exact: true }).waitFor({ timeout: 20000 });
        const read = await f.rpc(token.access_token, 'tools/call', { name: 'read_shared_reference', arguments: {} });
        assert.equal(read.r.status, 200);
        const image = read.data.result.content.find((c: {
            type: string;
        }) => c.type === 'image'), meta = JSON.parse(read.data.result.content[0].text);
        assert.ok(image);
        assert.equal(createHash('sha256').update(Buffer.from(image.data, 'base64')).digest('hex'), meta.manifest.sha256);
        // Decode the actual delivered derivative in the browser. Metadata alone is
        // never counted as pixel-delivery evidence; host semantic understanding is separate.
        const decoded = await page.evaluate(async ({ data }: {
            data: string;
        }) => { const b = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'image/png' })); const size = { width: b.width, height: b.height }; b.close(); return size; }, { data: image.data });
        assert.deepEqual(decoded, { width: meta.manifest.width, height: meta.manifest.height });
        const state = JSON.parse((await f.rpc(token.access_token, 'tools/call', { name: 'get_scene', arguments: {} })).data.result.content[0].text);
        const scene = structuredClone(historical.scene);
        scene.assets = [meta.sourceAsset];
        for (const n of scene.nodes)
            if (n.type === 'image')
                n.assetId = meta.sourceAsset.id;
        const proposal = { schemaVersion: 1, requestId: 'actual-source-crops', projectId: state.projectId, generation: state.generation, baseRevision: state.revision, scene, explanation: 'Local regression using historical editable Scene and exact original photo/logo crops; not fresh agent reconstruction.' };
        const queued = await f.rpc(token.access_token, 'tools/call', { name: 'propose_scene', arguments: { proposal } });
        assert.equal(JSON.parse(queued.data.result.content[0].text).state, 'queued');
        await page.getByRole('button', { name: 'Apply candidate', exact: true }).waitFor({ timeout: 20000 });
        assert.match(await page.getByText(/Applied revision/).innerText(), /0/);
        await page.screenshot({ path: resolve(out, 'pending-crop-candidate.png'), fullPage: true });
        await page.getByRole('button', { name: 'Apply candidate', exact: true }).click();
        const png = await download('Download PNG'), saved = await download('Save project'), project = JSON.parse(saved.toString());
        assert.deepEqual(project.scene.assets.map((a: {
            width: number;
            height: number;
        }) => [a.width, a.height]).sort(), [[55, 54], [84, 84]].sort());
        assert.equal(project.assets.length, 2);
        assert.equal(project.assets.some((a: {
            data: string;
        }) => a.data.includes(original.toString('base64'))), false);
        await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
        await page.getByText(/Revocation confirmed:/).waitFor();
        assert.equal((await f.rpc(token.access_token, 'tools/call', { name: 'read_shared_reference', arguments: {} })).r.status, 401);
        await page.getByLabel('Open project', { exact: true }).setInputFiles({ name: 'saved.project.json', mimeType: 'application/json', buffer: saved });
        await page.getByText('Project reopened with fresh approval identity.', { exact: false }).waitFor();
        assert.deepEqual(await download('Download PNG'), png, 'reopen needs no original pixels or reanalysis');
        // Content + layout edit automatically applies; no additional candidate Apply.
        await page.getByLabel('Layer', { exact: true }).selectOption('quote');
        await page.getByLabel('Text content', { exact: true }).fill('复用原图。\n保留真实身份。');
        await page.getByLabel('Node y', { exact: true }).fill('1040');
        await page.getByText('Local edit pending · downloads paused', { exact: true }).waitFor({ state: 'hidden' });
        const second = JSON.parse((await download('Save project')).toString());
        const quote = second.scene.nodes.find((n: {
            id: string;
        }) => n.id === 'quote');
        assert.equal(quote.text, '复用原图。\n保留真实身份。');
        assert.equal(quote.y, 1040);
        assert.equal(await page.getByRole('button', { name: 'Apply candidate', exact: true }).count(), 0);
        assert.equal(external.length, 0);
        assert.deepEqual(errors, []);
        f.noEgress();
        const receipt = { classification: 'Actual source pixels and historical Scene through local app/provider; no ChatGPT vision or fresh reconstruction proof', browser: browser.version(), sourceSHA256: meta.manifest.sourceSHA256, deliveredSHA256: meta.manifest.sha256, deliveredDimensions: decoded, deliveredBytes: Buffer.from(image.data, 'base64').length, storedCropDimensions: project.scene.assets.map((a: {
                width: number;
                height: number;
            }) => [a.width, a.height]), sourceExcluded: true, reopenPNGEqual: true, automaticContentAndLayoutReuse: true, postCounts: Object.fromEntries([...new Set(posts.map(r => r.path))].map(path => [path, posts.filter(r => r.path === path).length])), externalRequests: external.length, hostVision: 'NOT_RUN' };
        await writeFile(resolve(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
        await writeFile(resolve(out, 'publish.png'), png);
        await writeFile(resolve(out, 'portable.project.json'), saved);
        console.log(JSON.stringify(receipt));
    }
    catch (error) {
        await writeFile(resolve(out, 'failure.json'), JSON.stringify({ errors, posts, external, pageText: (await page.locator('body').innerText()).slice(0, 12000) }, null, 2));
        await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true });
        throw error;
    }
    finally {
        await browser.close();
        await f.mf.dispose();
    }
});

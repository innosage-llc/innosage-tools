import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertPromotion, assertProviderTarget, cloudflareClient, configHash, deploy,
  deploymentTag, selectDeployment, TARGETS, targetFor, treeHash, verifyRelease } from './deploy-pages.mjs';

const sha = 'a'.repeat(40);
const identity = { sourceRevision: sha, version: '0.1.1', buildHash: 'b'.repeat(64), configHash: 'c'.repeat(64) };
const candidate = { ...identity, environment: 'staging', providerEnvironment: 'preview', project: 'innosage-tools',
  branch: 'staging', deploymentId: 'verified-preview', verified: true };

test('explicit targets do not depend on Git branch and reject other projects', () => {
  assert.equal(targetFor('staging').branch, 'staging');
  assert.equal(targetFor('production').branch, 'main');
  for (const env of ['prod', 'main', '', '__proto__']) assert.throws(() => targetFor(env));
  assert.throws(() => targetFor('staging', 'another-project'));
  assertProviderTarget({ name: 'innosage-tools', production_branch: 'main' }, TARGETS.staging);
  assert.throws(() => assertProviderTarget({ name: 'innosage-tools', production_branch: 'staging' }, TARGETS.staging));
});

test('success tags follow Draft branch/version/SHA staging and versioned production convention', () => {
  assert.equal(deploymentTag('staging', '0.1.1', 'codex/tools49', sha), 'deploy/staging/codex/tools49/v0.1.1-aaaaaaa');
  assert.equal(deploymentTag('production', '0.1.1', 'detached', sha), 'deploy/production/main/v0.1.1');
  assert.throws(() => deploymentTag('staging', 'unsafe tag', 'main', sha));
});

test('provider automatic production publishing must be absent or explicitly disabled', () => {
  const project = { name: 'innosage-tools', production_branch: 'main', source: null };
  assertProviderTarget(project, TARGETS.staging);
  assertProviderTarget({ ...project, source: { config: { production_deployments_enabled: false } } }, TARGETS.staging);
  for (const source of [{ config: { production_deployments_enabled: true } }, { config: {} }]) {
    assert.throws(() => assertProviderTarget({ ...project, source }, TARGETS.staging), /automatic production/);
  }
});

test('production requires exact verified preview source, version, build and config', () => {
  assertPromotion(candidate, identity);
  for (const field of ['sourceRevision', 'version', 'buildHash', 'configHash']) {
    assert.throws(() => assertPromotion({ ...candidate, [field]: 'drift' }, identity));
  }
  for (const change of [{ verified: false }, { environment: 'production' }, { branch: 'main' },
    { providerEnvironment: 'production' }, { deploymentId: null }, { project: 'another' }]) {
    assert.throws(() => assertPromotion({ ...candidate, ...change }, identity));
  }
});

test('deployment receipt selection rejects wrong environment/branch/SHA and dirty or failed uploads', () => {
  const valid = { environment: 'preview', latest_stage: { status: 'success' },
    deployment_trigger: { metadata: { branch: 'staging', commit_hash: sha, commit_dirty: false } } };
  assert.equal(selectDeployment([valid], TARGETS.staging, sha), valid);
  for (const item of [{ ...valid, environment: 'production' }, { ...valid, latest_stage: { status: 'failure' } },
    ...[{ branch: 'main' }, { commit_hash: 'other' }, { commit_dirty: true }].map(change => ({ ...valid,
      deployment_trigger: { metadata: { ...valid.deployment_trigger.metadata, ...change } } }))]) {
    assert.equal(selectDeployment([item], TARGETS.staging, sha), undefined);
  }
});

test('API uses secret env only, fails safely, and never propagates response secrets', async () => {
  assert.throws(() => cloudflareClient({}));
  const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'test-secret-do-not-log' };
  let observed;
  const client = cloudflareClient(env, async (url, init) => {
    observed = { url, init };
    return Response.json({ success: false, errors: [{ message: env.CLOUDFLARE_API_TOKEN }] }, { status: 403 });
  });
  await assert.rejects(client(), error => error.message.includes('403') && !error.message.includes(env.CLOUDFLARE_API_TOKEN));
  assert.equal(observed.init.headers.Authorization, `Bearer ${env.CLOUDFLARE_API_TOKEN}`);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tools-deploy-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'public'));
  mkdirSync(join(root, 'out'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.1' }));
  writeFileSync(join(root, 'next.config.ts'), 'basePath=/tools');
  writeFileSync(join(root, 'wrangler.toml'), 'name="innosage-tools"');
  writeFileSync(join(root, 'public/_redirects'), '/tools/* /:splat 200');
  writeFileSync(join(root, 'out/index.html'), 'synthetic build');
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'git' && args[0] === 'rev-parse') return sha;
    if (cmd === 'git' && args[0] === 'branch') return 'main';
    return '';
  };
  const provider = { name: 'innosage-tools', production_branch: 'main', canonical_deployment: { id: 'known-good' } };
  const api = async suffix => suffix ? [{ id: 'new-deployment', url: 'https://candidate.innosage-tools.pages.dev',
    environment: 'preview', created_on: '2026-10-09T00:00:00Z', latest_stage: { status: 'success' },
    deployment_trigger: { metadata: { branch: 'staging', commit_hash: sha, commit_dirty: false } } }] : provider;
  return { root, calls, run, api, verify: async () => ({ releaseIdentity: 'PASS' }) };
}

test('staging from main still uploads preview, retains artifact, writes safe receipt and tags after verification', async t => {
  const f = fixture(t);
  const receipt = await deploy('staging', f);
  assert.equal(receipt.environment, 'staging');
  assert.equal(receipt.sourceRevision, sha);
  assert.equal(receipt.previousProductionDeploymentId, 'known-good');
  const upload = f.calls.find(([cmd]) => cmd === 'npx')[1];
  assert.equal(upload[upload.indexOf('--branch') + 1], 'staging');
  assert.ok(upload.includes('--commit-dirty=false'));
  assert.ok(f.calls.some(([cmd, args]) => cmd === 'git' && args[0] === 'push'));
  const artifact = join(f.root, '.deploy/releases', sha, 'out');
  assert.equal(treeHash(artifact), receipt.buildHash);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, '.deploy/latest-staging.json'))), receipt);
  assert.equal(configHash(f.root), receipt.configHash);
  assert.deepEqual(Object.keys(receipt).sort(), ['sourceRevision', 'version', 'buildHash', 'configHash', 'builtAt',
    'project', 'environment', 'providerEnvironment', 'branch', 'deploymentId', 'url', 'deployedAt',
    'tag', 'verified', 'checks', 'previousProductionDeploymentId'].sort());
});

test('dirty source is rejected before build/upload', async t => {
  const f = fixture(t);
  const real = f.run;
  f.run = (cmd, args) => args[0] === 'status' ? ' M app/recorder/page.tsx' : real(cmd, args);
  await assert.rejects(deploy('staging', f), /dirty-source/);
  assert.equal(f.calls.length, 0);
});

test('verification failure never creates or pushes a successful deployment tag', async t => {
  const f = fixture(t);
  f.verify = async () => { throw new Error('synthetic asset failure'); };
  await assert.rejects(deploy('staging', f), /asset failure/);
  assert.ok(!f.calls.some(([cmd, args]) => cmd === 'git' && ['tag', 'push'].includes(args[0]) && args.length > 2 && args[1] !== '--list'));
});

test('production uploads the same retained staging artifact without rebuilding', async t => {
  const f = fixture(t);
  const staged = await deploy('staging', f);
  f.calls.length = 0;
  f.api = async suffix => suffix ? [{ environment: 'production', id: 'prod', url: 'https://prod.innosage-tools.pages.dev',
    created_on: '2026-10-09T00:00:00Z', latest_stage: { status: 'success' },
    deployment_trigger: { metadata: { branch: 'main', commit_hash: sha, commit_dirty: false } } }]
    : { name: 'innosage-tools', production_branch: 'main', canonical_deployment: { id: 'known-good' } };
  const receipt = await deploy('production', f);
  assert.equal(receipt.buildHash, staged.buildHash);
  assert.ok(!f.calls.some(([cmd]) => cmd === 'npm'));
  const upload = f.calls.find(([cmd]) => cmd === 'npx')[1];
  assert.equal(upload[upload.indexOf('--branch') + 1], 'main');
});

test('missing or changed retained artifacts cannot be promoted', async t => {
  const f = fixture(t);
  await assert.rejects(deploy('production', f), /missing/);
  await deploy('staging', f);
  writeFileSync(join(f.root, '.deploy/releases', sha, 'out/index.html'), 'changed');
  f.calls.length = 0;
  await assert.rejects(deploy('production', f), /identity changed/);
  assert.ok(!f.calls.some(([cmd]) => cmd === 'npx'));
});

function responses(path, overrides = {}) {
  if (Object.hasOwn(overrides, path)) return overrides[path];
  if (path === '/tools/release.json') return Response.json(identity);
  if (path.startsWith('/tools/_next/')) return new Response('asset', { headers: { 'content-type': 'text/javascript' } });
  return new Response('<html><script src="/tools/_next/static/a.js"></script></html>', { headers: { 'content-type': 'text/html' } });
}

test('live verification checks release identity, both routes and prefixed application assets', async () => {
  const paths = [];
  const checks = await verifyRelease('https://candidate.innosage-tools.pages.dev', identity, async url => {
    paths.push(url.pathname); return responses(url.pathname);
  });
  assert.equal(checks.routes, 2);
  assert.equal(checks.assets, 2);
  assert.ok(paths.includes('/tools/recorder'));
});

test('live verification rejects missing assets, HTML fallback and wrong release identity', async () => {
  for (const overrides of [
    { '/tools/_next/static/a.js': new Response('not found', { status: 404 }) },
    { '/tools/_next/static/a.js': new Response('fallback', { headers: { 'content-type': 'text/html' } }) },
    { '/tools/release.json': Response.json({ ...identity, sourceRevision: 'wrong' }) },
  ]) await assert.rejects(verifyRelease('https://candidate.innosage-tools.pages.dev', identity, async url => responses(url.pathname, overrides)));
});

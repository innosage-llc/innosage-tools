#!/usr/bin/env node
// Tools' Pages adapter. npm entrypoints and successful-deploy tags follow Draft;
// no Firebase deployment code or private agentic-core dependency is required.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT = 'innosage-tools';
export const TARGETS = Object.freeze({
  staging: { branch: 'staging', providerEnvironment: 'preview' },
  production: { branch: 'main', providerEnvironment: 'production' },
});

export function targetFor(environment, project = PROJECT) {
  if (!Object.hasOwn(TARGETS, environment) || project !== PROJECT) {
    throw new Error('Use staging or production on the existing innosage-tools Pages project.');
  }
  return TARGETS[environment];
}

export function deploymentTag(environment, version, branch, sha) {
  targetFor(environment);
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('Invalid release version or source revision.');
  }
  const name = branch.replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/\.\.+/g, '-')
    .split('/').map(part => part.replace(/^[.-]+|[.-]+$/g, '')).filter(Boolean).join('/') || 'detached';
  return `deploy/${environment}/${environment === 'production' ? 'main' : name}/v${version}${environment === 'staging' ? `-${sha.slice(0, 7)}` : ''}`;
}

export function treeHash(directory) {
  const hash = createHash('sha256');
  function visit(relative = '') {
    for (const entry of readdirSync(join(directory, relative)).sort()) {
      const path = relative ? `${relative}/${entry}` : entry;
      if (path === 'release.json') continue;
      const full = join(directory, path);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error('Release artifacts must not contain symlinks.');
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) hash.update(path).update('\0').update(readFileSync(full)).update('\0');
      else throw new Error('Release artifacts must contain only regular files.');
    }
  }
  visit();
  return hash.digest('hex');
}

export function configHash(root) {
  const hash = createHash('sha256');
  for (const name of ['next.config.ts', 'wrangler.toml', 'public/_redirects']) {
    hash.update(name).update('\0').update(readFileSync(join(root, name))).update('\0');
  }
  hash.update(JSON.stringify(TARGETS));
  return hash.digest('hex');
}

export function assertProviderTarget(project, target) {
  if (project.name !== PROJECT || project.production_branch !== TARGETS.production.branch ||
      target.branch === project.production_branch && target.providerEnvironment !== 'production') {
    throw new Error('Pages project/production branch does not match the reviewed deployment contract.');
  }
  if (project.source && project.source.config?.production_deployments_enabled !== false) {
    throw new Error('Git-connected automatic production deployment must be disabled before this release flow is used.');
  }
}

export function assertPromotion(receipt, identity) {
  if (receipt.environment !== 'staging' || receipt.project !== PROJECT || receipt.verified !== true ||
      receipt.providerEnvironment !== 'preview' || receipt.branch !== 'staging' || !receipt.deploymentId ||
      receipt.sourceRevision !== identity.sourceRevision || receipt.version !== identity.version ||
      receipt.buildHash !== identity.buildHash || receipt.configHash !== identity.configHash) {
    throw new Error('Production requires the exact verified staging receipt and retained artifact; stage and accept any changed candidate first.');
  }
}

export function selectDeployment(deployments, target, sha) {
  return deployments.find(item => item.environment === target.providerEnvironment &&
    item.deployment_trigger?.metadata?.branch === target.branch &&
    item.deployment_trigger?.metadata?.commit_hash === sha &&
    item.deployment_trigger?.metadata?.commit_dirty === false && item.latest_stage?.status === 'success');
}

function command(root, executable, args, capture = false) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${executable} failed; no successful release tag was created.`);
  return capture ? result.stdout.trim() : '';
}

export function cloudflareClient(env = process.env, request = fetch) {
  if (!env.CLOUDFLARE_API_TOKEN || !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || '')) {
    throw new Error('The selected secret context must provide Cloudflare Pages credentials.');
  }
  return async (suffix = '', method = 'GET', body) => {
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT}${suffix}`, {
      method, headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json();
    if (!response.ok || payload.success !== true) throw new Error(`Cloudflare Pages request failed (${response.status}); check the selected operator permissions.`);
    return payload.result;
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function verifyRelease(origin, identity, request = fetch) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/') {
    throw new Error('Use the HTTPS deployment origin, without a path or credentials.');
  }
  const get = async path => {
    const response = await request(new URL(path, base), { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
    if (!response.ok) throw new Error(`Release verification failed for ${path} (HTTP ${response.status}).`);
    return response;
  };
  const manifest = await (await get('/tools/release.json')).json();
  for (const field of ['sourceRevision', 'version', 'buildHash', 'configHash']) {
    if (manifest[field] !== identity[field]) throw new Error(`Deployed release ${field} does not match the candidate.`);
  }
  let checkedAssets = 0;
  for (const path of ['/tools', '/tools/recorder']) {
    const response = await get(path);
    if (!response.headers.get('content-type')?.includes('text/html')) throw new Error(`Expected HTML at ${path}.`);
    const html = await response.text();
    const assets = [...new Set([...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css|woff2?))(?:[?#][^"]*)?"/g)].map(match => match[1]))];
    if (!assets.length) throw new Error(`No application assets found at ${path}.`);
    for (const asset of assets) {
      if (!asset.startsWith('/tools/_next/')) continue;
      const assetResponse = await get(asset);
      if (assetResponse.headers.get('content-type')?.includes('text/html')) throw new Error(`HTML fallback returned instead of ${asset}.`);
      await assetResponse.arrayBuffer();
      checkedAssets++;
    }
  }
  if (!checkedAssets) throw new Error('No prefixed Next.js application assets were verified.');
  return { routes: 2, assets: checkedAssets, releaseIdentity: 'PASS' };
}

export async function deploy(environment, options = {}) {
  const root = options.root || process.cwd();
  const run = options.run || ((executable, args, capture) => command(root, executable, args, capture));
  const git = args => run('git', args, true);
  const target = targetFor(environment, (options.env || process.env).CLOUDFLARE_PAGES_PROJECT || PROJECT);
  if (git(['status', '--porcelain'])) throw new Error('Commit product changes before deploying; dirty-source releases are not permitted.');
  const sha = git(['rev-parse', 'HEAD']);
  const branch = git(['branch', '--show-current']) || 'detached';
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const tag = deploymentTag(environment, version, branch, sha);
  const localTag = git(['tag', '--list', tag]);
  if (localTag && git(['rev-parse', `${tag}^{commit}`]) !== sha) {
    throw new Error('Local deployment version tag belongs to another source revision.');
  }
  const remoteTag = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  if (remoteTag && !remoteTag.startsWith(`${sha}\t`) && !remoteTag.includes(`${sha}`)) {
    // Annotated tag IDs are not commit IDs. Resolve the peeled remote ref below.
    const peeled = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}^{}`]);
    if (!peeled.startsWith(`${sha}\t`)) throw new Error('Deployment version tag already belongs to another source revision.');
  }
  const api = options.api || cloudflareClient(options.env || process.env);
  const project = await api();
  assertProviderTarget(project, target);
  const artifact = join(root, '.deploy', 'releases', sha, 'out');
  const manifestPath = join(artifact, 'release.json');
  if (environment === 'staging' && !existsSync(manifestPath)) {
    run('npm', ['run', 'build']);
    run('npm', ['run', 'test:seo']);
    if (git(['status', '--porcelain'])) throw new Error('Build changed product source; commit and revalidate it first.');
    mkdirSync(dirname(artifact), { recursive: true });
    cpSync(join(root, 'out'), artifact, { recursive: true });
    writeJson(manifestPath, { sourceRevision: sha, version, buildHash: treeHash(artifact),
      configHash: configHash(root), builtAt: new Date().toISOString() });
  }
  if (!existsSync(manifestPath)) throw new Error('Retained staging artifact is missing. Restore the accepted artifact or stage and accept a new candidate.');
  const identity = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (identity.sourceRevision !== sha || identity.version !== version || identity.configHash !== configHash(root) || identity.buildHash !== treeHash(artifact)) {
    throw new Error('Retained release artifact/source/config identity changed; do not promote it.');
  }
  const receiptPath = join(root, '.deploy', `latest-${environment}.json`);
  if (environment === 'production') {
    const staged = JSON.parse(readFileSync(join(root, '.deploy', 'latest-staging.json'), 'utf8'));
    assertPromotion(staged, identity);
  }
  const previousProduction = project.canonical_deployment?.id || null;
  const rollback = { capturedAt: new Date().toISOString(), project: PROJECT, previousProductionDeploymentId: previousProduction };
  if (environment === 'production' && !previousProduction) throw new Error('A known-good production rollback target is required.');
  writeJson(join(root, '.deploy', 'rollback-before-latest.json'), rollback);
  run('npx', ['--no-install', 'wrangler', 'pages', 'deploy', artifact,
    '--project-name', PROJECT, '--branch', target.branch, '--commit-hash', sha, '--commit-dirty=false']);
  const deployments = await api(`/deployments?env=${target.providerEnvironment}&per_page=20`);
  const deployed = selectDeployment(deployments, target, sha);
  if (!deployed) throw new Error('No successful deployment matches the exact source and target; no success tag created.');
  const verify = options.verify || verifyRelease;
  const checks = await verify(deployed.url, identity);
  if (environment === 'production') await verify('https://innosage.co', identity);
  const receipt = { ...identity, project: PROJECT, environment, providerEnvironment: target.providerEnvironment,
    branch: target.branch, deploymentId: deployed.id, url: deployed.url, deployedAt: deployed.created_on,
    tag, verified: true, checks, previousProductionDeploymentId: previousProduction };
  writeJson(receiptPath, receipt);
  writeJson(join(dirname(artifact), `${environment}-receipt.json`), receipt);
  if (!remoteTag) {
    if (!localTag) run('git', ['tag', '-a', tag, '-m', `Verified ${environment} deployment ${deployed.id}`, sha]);
    run('git', ['push', 'origin', `refs/tags/${tag}`]);
  }
  return receipt;
}

async function main() {
  const [mode, origin] = process.argv.slice(2);
  if (mode === 'verify-staging') {
    const receipt = JSON.parse(readFileSync('.deploy/latest-staging.json', 'utf8'));
    targetFor(receipt.environment, receipt.project);
    if (receipt.environment !== 'staging') throw new Error('Expected a staging receipt.');
    process.stdout.write(`${JSON.stringify(await verifyRelease(origin || receipt.url, receipt), null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(await deploy(mode), null, 2)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`Deployment failed: ${error.message}\n`); process.exitCode = 1; });
}

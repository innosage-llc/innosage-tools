import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { retirementClock } from './retirement-clock.ts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { emptyScene } from '../../../../lib/visual-remix.ts';
import { SCENE_FIELDS } from '../../../../lib/visual-remix-remote.ts';

export const origin = 'https://localhost', scene = origin + '/scene/mcp', video = origin + '/mcp';
export const scopes = ['scene:read','scene:propose'];
export const snapshot = () => ({ schemaVersion: 1, projectId: 'synthetic-project', generation: 'synthetic-generation', revision: 0, scene: emptyScene() });
export async function fixture(assetsDirectory?: string, withBridge = false, withReference = false, withRetirement = false,withReauthorization=false) {
  const workerRoot = fileURLToPath(new URL('../../', import.meta.url));
  const bundle = await build({ absWorkingDir: workerRoot, entryPoints: ['test/fixtures/scene-auth.ts'], plugins:withRetirement?[retirementClock]:[], bundle: true, format: 'esm', platform: 'browser', conditions: ['workerd'], external: ['node:*','cloudflare:*'], write: false });
  let egress = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], kvNamespaces: ['OAUTH_KV'], ...(withBridge ? {durableObjects:{VIDEO_BRIDGE:{className:'VideoScissorsBridgeDO',useSQLite:true}}} : {}), bindings: { EXPERIMENT_ENABLED: 'true', SCENE_REFERENCE_ENABLED:withReference?'true':'false',SCENE_RETIRED_RECLAIM_ENABLED:withRetirement?'true':'false',SCENE_REAUTH_ENABLED:withReauthorization?'true':'false' }, ...(assetsDirectory ? { assets: { directory: assetsDirectory, binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true } } } : {}), outboundService: () => { egress++; return new Response('Egress denied', { status: 403 }); } }));
  const db = await mf.getD1Database('DB');
  for (const file of ['migrations/0001.sql','candidate-migrations/scene.sql','candidate-migrations/scene-until-revoked.sql']) await db.exec(readFileSync(new URL('../../' + file, import.meta.url),'utf8').replace(/--[^\n]*/g,'').replace(/\s+/g,' '));
  if(withReference) await db.exec(readFileSync(new URL('../../candidate-migrations/scene-reference.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'').replace(/\s+/g,' '));
  if(withReauthorization)await db.exec(readFileSync(new URL('../../candidate-migrations/scene-reauthorization.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'').replace(/\s+/g,' '));
  if(withRetirement){
    await db.exec('CREATE TABLE fixture_clock(now INTEGER NOT NULL)');await db.prepare('INSERT INTO fixture_clock VALUES(?)').bind(Date.now()).run();
    const sql=readFileSync(new URL('../../candidate-migrations/scene-retained-slots.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'').replace(/\s+/g,' ');
    const clock="CAST(unixepoch('now')*1000 AS INTEGER)";assert.equal(sql.split(clock).length-1,2);await db.exec(sql.replaceAll(clock,'(SELECT now FROM fixture_clock)'));
  }
  let timeOffset=0;
  const request = async (path: string, options: RequestInit = {}) => { const headers=new Headers(options.headers); headers.set('x-fixture-time-offset',String(timeOffset));if(withRetirement)await db.prepare('UPDATE fixture_clock SET now=?').bind(Date.now()+timeOffset).run(); return mf.dispatchFetch(origin + path, { ...options, headers, redirect: 'manual' }); };
  const json = (path: string, value: unknown, headers: Record<string,string> = {}) => request(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  const form = (path: string, value: URLSearchParams, cookie = '', headers: Record<string,string> = {}) => request(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, ...headers }, body: value.toString() });
  const create = async (referenceConsent?:unknown, leaseMs?:number) => { const r = await json('/scene/browser/create', { snapshot: snapshot(), fields: SCENE_FIELDS, confirmed: true,...(leaseMs!==undefined?{leaseMs}:{}),...(referenceConsent?{referenceConsent}:{}) }); assert.equal(r.status,200,await r.clone().text()); return r.json(); };
  const client = async (old = false, redirectUri = 'https://client.example/callback') => { const r = await json('/oauth/register', { client_name: '<img src=x onerror=alert(1)>', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code','refresh_token'], response_types: ['code'] }, old ? { 'x-fixture-old': 'true' } : {}); assert.equal(r.status,201,await r.clone().text()); return r.json(); };
  const verifier = 'a'.repeat(64), challenge = Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
  const authorize = async (c: { client_id: string }, resource: string | undefined = scene, scope = scopes.join(' '), old = false, untilRevoked = false) => {
    const query = new URLSearchParams({ client_id: c.client_id, redirect_uri: 'https://client.example/callback', response_type: 'code', scope, state: 'synthetic-state', code_challenge: challenge, code_challenge_method: 'S256' });
    if (resource) query.set('resource',resource);
    const r = await request('/authorize?' + query, { headers: { ...(old?{'x-fixture-old':'true'}:{}),...(untilRevoked?{'x-fixture-until-revoked':'true'}:{}) } });
    const html = await r.text(), handle = html.match(/name="handle"[^>]*value="([^"]+)"/)?.[1] ?? '';
    return { r, html, handle, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] };
  };
  const approve = (a: { handle: string; cookie: string }, proof: string, allowed = scopes, old = false) => form('/authorize', new URLSearchParams([['handle',a.handle],['decision','approve'],['browserProof',proof],...allowed.map(s => ['scope',s])]), a.cookie, old ? { 'x-fixture-old': 'true' } : {});
  const token = async (c: { client_id: string }, response: Response, resource = scene, old = false, codeVerifier = verifier, extraHeaders:Record<string,string> = {}) => {
    assert.equal(response.status,302,await response.clone().text());
    const callback = new URL(response.headers.get('location')!); assert.equal(callback.origin,'https://client.example'); assert.equal(callback.searchParams.get('iss'),origin);
    return form('/oauth/token',new URLSearchParams({ grant_type:'authorization_code',client_id:c.client_id,code:callback.searchParams.get('code')!,code_verifier:codeVerifier,redirect_uri:'https://client.example/callback',resource }), '', {...(old?{'x-fixture-old':'true'}:{}),...extraHeaders});
  };
  const link = async (referenceConsent?:unknown, leaseMs?:number) => { const p = await create(referenceConsent,leaseMs), c = await client(), a = await authorize(c), r = await token(c,await approve(a,p.proof)); assert.equal(r.status,200,await r.clone().text()); return { p,c,a,t:await r.json() }; };
  const rpc = async (access: string, method: string, params = {}, path = '/scene/mcp', id: unknown = 1) => {
    const r = await json(path,{ jsonrpc:'2.0',id,method,params }, { Authorization:'Bearer '+access, Accept:'application/json, text/event-stream', 'MCP-Protocol-Version':'2025-06-18' });
    const body = await r.text(), data = r.headers.get('content-type')?.includes('text/event-stream') ? JSON.parse(body.split('\n').find(l=>l.startsWith('data: '))!.slice(6)) : body ? JSON.parse(body) : null;
    return { r,data,body };
  };
  return { mf,db,kv:await mf.getKVNamespace('OAUTH_KV'),request,json,form,create,client,authorize,approve,token,link,rpc, advance:(ms:number)=>{timeOffset+=ms;}, now:()=>Date.now()+timeOffset, noEgress: () => assert.equal(egress,0) };
}

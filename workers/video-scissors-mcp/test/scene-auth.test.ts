import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { emptyScene } from '../../../lib/visual-remix.ts';
import { SCENE_FIELDS } from '../../../lib/visual-remix-remote.ts';

const origin = 'https://localhost', scene = origin + '/scene/mcp', video = origin + '/mcp';
const scopes = ['scene:read','scene:propose'];
const snapshot = () => ({ schemaVersion: 1, projectId: 'synthetic-project', generation: 'synthetic-generation', revision: 0, scene: emptyScene() });
async function fixture() {
  const bundle = await build({ entryPoints: ['test/fixtures/scene-auth.ts'], bundle: true, format: 'esm', platform: 'browser', conditions: ['workerd'], external: ['node:*','cloudflare:*'], write: false });
  let egress = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], kvNamespaces: ['OAUTH_KV'], bindings: { EXPERIMENT_ENABLED: 'true' }, outboundService: () => { egress++; return new Response('Egress denied', { status: 403 }); } }));
  const db = await mf.getD1Database('DB');
  for (const file of ['migrations/0001.sql','candidate-migrations/scene.sql']) await db.exec(readFileSync(file,'utf8').replace(/--[^\n]*/g,'').replace(/\s+/g,' '));
  const request = (path: string, options: RequestInit = {}) => mf.dispatchFetch(origin + path, { ...options, redirect: 'manual' });
  const json = (path: string, value: unknown, headers: Record<string,string> = {}) => request(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  const form = (path: string, value: URLSearchParams, cookie = '', headers: Record<string,string> = {}) => request(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, ...headers }, body: value.toString() });
  const create = async () => { const r = await json('/scene/browser/create', { snapshot: snapshot(), fields: SCENE_FIELDS, confirmed: true }); assert.equal(r.status,200,await r.clone().text()); return r.json(); };
  const client = async (old = false) => { const r = await json('/oauth/register', { client_name: '<img src=x onerror=alert(1)>', redirect_uris: ['https://client.example/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code','refresh_token'], response_types: ['code'] }, old ? { 'x-fixture-old': 'true' } : {}); assert.equal(r.status,201,await r.clone().text()); return r.json(); };
  const verifier = 'a'.repeat(64), challenge = Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
  const authorize = async (c: { client_id: string }, resource: string | undefined = scene, scope = scopes.join(' '), old = false) => {
    const query = new URLSearchParams({ client_id: c.client_id, redirect_uri: 'https://client.example/callback', response_type: 'code', scope, state: 'synthetic-state', code_challenge: challenge, code_challenge_method: 'S256' });
    if (resource) query.set('resource',resource);
    const r = await request('/authorize?' + query, { headers: old ? { 'x-fixture-old': 'true' } : {} });
    const html = await r.text(), handle = html.match(/name="handle"[^>]*value="([^"]+)"/)?.[1] ?? '';
    return { r, html, handle, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] };
  };
  const approve = (a: { handle: string; cookie: string }, proof: string, allowed = scopes, old = false) => form('/authorize', new URLSearchParams([['handle',a.handle],['decision','approve'],['browserProof',proof],...allowed.map(s => ['scope',s])]), a.cookie, old ? { 'x-fixture-old': 'true' } : {});
  const token = async (c: { client_id: string }, response: Response, resource = scene, old = false, codeVerifier = verifier) => {
    assert.equal(response.status,302,await response.clone().text());
    const callback = new URL(response.headers.get('location')!); assert.equal(callback.origin,'https://client.example'); assert.equal(callback.searchParams.get('iss'),origin);
    return form('/oauth/token',new URLSearchParams({ grant_type:'authorization_code',client_id:c.client_id,code:callback.searchParams.get('code')!,code_verifier:codeVerifier,redirect_uri:'https://client.example/callback',resource }), '', old ? { 'x-fixture-old': 'true' } : {});
  };
  const link = async () => { const p = await create(), c = await client(), a = await authorize(c), r = await token(c,await approve(a,p.proof)); assert.equal(r.status,200,await r.clone().text()); return { p,c,a,t:await r.json() }; };
  const rpc = async (access: string, method: string, params = {}, path = '/scene/mcp', id: unknown = 1) => {
    const r = await json(path,{ jsonrpc:'2.0',id,method,params }, { Authorization:'Bearer '+access, Accept:'application/json, text/event-stream', 'MCP-Protocol-Version':'2025-06-18' });
    const body = await r.text(), data = r.headers.get('content-type')?.includes('text/event-stream') ? JSON.parse(body.split('\n').find(l=>l.startsWith('data: '))!.slice(6)) : body ? JSON.parse(body) : null;
    return { r,data,body };
  };
  return { mf,db,kv:await mf.getKVNamespace('OAUTH_KV'),request,json,form,create,client,authorize,approve,token,link,rpc, noEgress: () => assert.equal(egress,0) };
}

test('inactive candidate: real provider consent/PKCE, exact audiences/scopes and SDK preview-only lifecycle', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/scene/mcp',{ headers: { 'x-fixture-disabled':'true' } })).status,503);
    assert.equal((await f.request('/scene/mcp')).status,401);
    const as = await (await f.request('/.well-known/oauth-authorization-server')).json();
    assert.equal(as.issuer,origin); assert.deepEqual(as.protected_resources.sort(),[video,scene].sort());
    const rs = await (await f.request('/.well-known/oauth-protected-resource/scene/mcp')).json(); assert.equal(rs.resource,scene); assert.deepEqual(rs.scopes_supported,scopes);
    const {p,t,a} = await f.link();
    assert.match(a.cookie,/^__Host-/); assert.match(a.html,/&lt;img/); assert.doesNotMatch(a.html,/<img src=x/);
    assert.equal(t.refresh_token,undefined); assert.ok(t.expires_in <= 900 && t.expires_in >= 895);
    assert.equal((await f.request('/scene/mcp',{ headers: { Authorization:'Bearer '+t.access_token } })).status,405);
    assert.equal((await f.rpc(t.access_token,'tools/list',{},'/mcp')).r.status,401);
    const listed = await f.rpc(t.access_token,'tools/list'); assert.equal(listed.r.status,200);
    assert.deepEqual(listed.data.result.tools.map((x: { name: string }) => x.name), ['get_scene','propose_scene','proposal_status','cancel_proposal']);
    for (const tool of listed.data.result.tools) assert.deepEqual(tool.securitySchemes,[{ type:'oauth2',scopes }]);
    const shared = await f.rpc(t.access_token,'tools/call',{name:'get_scene',arguments:{}}); assert.deepEqual(JSON.parse(shared.data.result.content[0].text),snapshot());
    const proposal = { schemaVersion:1,projectId:snapshot().projectId,generation:snapshot().generation,baseRevision:0,requestId:'one',explanation:'Content and layout edit',scene:{...emptyScene(),background:'#112233'} };
    const queued = await f.rpc(t.access_token,'tools/call',{name:'propose_scene',arguments:{proposal}}); assert.equal(JSON.parse(queued.data.result.content[0].text).state,'queued');
    const [first,second] = await Promise.all([1,2].map(()=>f.json('/scene/browser/poll',{auth:p.auth}).then(r=>r.json())));
    assert.equal([first,second].filter(x=>x.command).length,1);
    assert.equal((await (await f.json('/scene/browser/report',{auth:p.auth,requestId:'one',state:'preview'})).json()).ok,true);
    const status = await f.rpc(t.access_token,'tools/call',{name:'proposal_status',arguments:{requestId:'one'}}); assert.equal(JSON.parse(status.data.result.content[0].text).awaitingApply,true);
    await f.rpc(t.access_token,'tools/call',{name:'cancel_proposal',arguments:{requestId:'one'}});
    const pending = await (await f.json('/scene/browser/poll',{auth:p.auth})).json(); assert.deepEqual(pending.cancellations,['one']);
    const before = await f.db.prepare('SELECT count(*) AS n FROM scene_requests').first('n');
    assert.equal((await f.rpc(t.access_token,'tools/call',{name:'propose_scene',arguments:{proposal:{...proposal,requestId:'too-long-id'}}},'/scene/mcp','x'.repeat(97))).r.status,400);
    assert.equal((await f.rpc(t.access_token,'tools/call',{name:'export_png',arguments:{}})).data.error.code,-32602);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_requests').first('n'),before);
    assert.equal((await f.json('/scene/browser/sync',{auth:{...p.auth,credential:'f'.repeat(64)},snapshot:snapshot()})).status,401);
    const wrongOrigin = await f.json('/scene/browser/revoke',{auth:p.auth},{Origin:'https://evil.example'}); assert.equal(wrongOrigin.status,403);
    assert.equal((await (await f.json('/scene/browser/revoke',{auth:p.auth})).json()).ok,true);
    assert.equal((await f.rpc(t.access_token,'tools/list')).r.status,401);
    assert.equal(await f.db.prepare('SELECT snapshot FROM scene_shares WHERE id=?').bind(p.auth.shareId).first('snapshot'),null);
    f.noEgress();
  } finally { await f.mf.dispose(); }
});

test('inactive candidate: missing cookie/proof, cross-purpose proof, recovered handle and lease expiration fail closed', async () => {
  const f = await fixture();
  try {
    const p = await f.create(), c = await f.client();
    const missingCookie = await f.authorize(c); assert.equal((await f.approve({...missingCookie,cookie:''},p.proof)).status,400);
    const mixed = await f.authorize(c,scene,'scene:read video:edit'); assert.equal(mixed.r.status,400);
    const v = await (await f.json('/remote/projects',{})).json();
    const cross = await f.authorize(c); assert.equal((await f.approve(cross,v.proof)).status,403);
    const forVideo = await f.authorize(c,video,'video:read video:edit'); assert.equal((await f.approve(forVideo,p.proof,['video:read','video:edit'])).status,403);
    const valid = await f.authorize(c), approved = await f.approve(valid,p.proof); assert.equal(approved.status,302);
    const replay = await f.authorize(c); assert.equal((await f.approve(replay,p.proof)).status,403);
    assert.equal((await f.token(c,approved,scene,false,'b'.repeat(64))).status,400);
    const expiring = await f.create(), auth = await f.authorize(c), approval = await f.approve(auth,expiring.proof);
    await f.db.prepare('UPDATE scene_shares SET expires=? WHERE id=?').bind(Date.now()+59000,expiring.auth.shareId).run();
    assert.equal((await f.token(c,approval)).status,400,'KV minimum TTL must never extend a short lease');
    const active = await f.link();
    await f.db.prepare('UPDATE scene_shares SET seen=? WHERE id=?').bind(Date.now()-11000,active.p.auth.shareId).run();
    assert.equal(JSON.parse((await f.rpc(active.t.access_token,'tools/call',{name:'get_scene',arguments:{}})).data.result.content[0].text).error,'BROWSER_UNAVAILABLE');
    await f.db.prepare('UPDATE scene_shares SET expires=? WHERE id=?').bind(Date.now()-1,active.p.auth.shareId).run();
    assert.equal((await f.rpc(active.t.access_token,'tools/list')).r.status,401);
    assert.equal((await f.form('/oauth/token',new URLSearchParams({grant_type:'refresh_token',client_id:active.c.client_id,refresh_token:active.t.access_token,resource:scene}))).status,400);
    f.noEgress();
  } finally { await f.mf.dispose(); }
});

test('inactive candidate: existing single-resource video access and refresh remain video-only', async () => {
  const f = await fixture();
  try {
    const s = await f.create(), v = await (await f.json('/remote/projects',{}, {'x-fixture-old':'true'})).json(), c = await f.client(true);
    // Deliberately use the same provider user id for both audiences.
    await f.db.prepare('UPDATE projects SET id=? WHERE id=?').bind(s.auth.shareId,v.project).run();
    const a = await f.authorize(c,video,'video:read video:edit',true);
    const r = await f.token(c,await f.approve(a,v.proof,['video:read','video:edit'],true),video,true); assert.equal(r.status,200);
    const token = await r.json(); assert.ok(token.refresh_token);
    // Model pre-resource records without changing encrypted props or credentials.
    const keys = await f.kv.list();
    for (const key of keys.keys.filter(k => k.name.startsWith('token:') || /^grant:[^:]+:[^:]+$/.test(k.name))) {
      const record = JSON.parse((await f.kv.get(key.name))!); delete record.audience; delete record.resource;
      await f.kv.put(key.name,JSON.stringify(record));
    }
    assert.equal((await f.rpc(token.access_token,'tools/list',{},'/mcp')).r.status,200);
    assert.equal((await f.rpc(token.access_token,'tools/list')).r.status,401);
    const refreshed = await f.form('/oauth/token',new URLSearchParams({grant_type:'refresh_token',client_id:c.client_id,refresh_token:token.refresh_token,resource:video})); assert.equal(refreshed.status,200,await refreshed.clone().text());
    const next = await refreshed.json(); assert.equal((await f.rpc(next.access_token,'tools/list',{},'/mcp')).r.status,200);
    assert.equal((await f.rpc(next.access_token,'tools/list')).r.status,401);
    const sa = await f.authorize(c), st = await f.token(c,await f.approve(sa,s.proof)); assert.equal(st.status,200);
    const sceneToken = await st.json(); assert.equal((await f.rpc(sceneToken.access_token,'tools/list')).r.status,200);
    assert.equal((await f.rpc(next.access_token,'tools/list',{},'/mcp')).r.status,200,'same-client/same-user Scene grant cannot replace video grant');
    f.noEgress();
  } finally { await f.mf.dispose(); }
});

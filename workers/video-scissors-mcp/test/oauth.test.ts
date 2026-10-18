import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
// Keep Batch1's native D1 counters/fences in the existing canonical test command.
import './batch1.test.ts';

const origin = 'https://localhost';
const metadata = { duration: 30, generation: 1, version: 1, hasOutput: false, canUndo: false, latestOperationId: null, errorCode: 'NONE' };
const auth = (p: {project: string; epoch: number; credential: string}) => ({project:p.project,epoch:p.epoch,credential:p.credential});
async function fixture() {
  const bundled = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', conditions: ['workerd'], external: ['node:*','cloudflare:*'], write: false });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], kvNamespaces: ['OAUTH_KV'], bindings: { EXPERIMENT_ENABLED: 'true' } }));
  const db = await mf.getD1Database('DB');
  await db.exec(readFileSync('migrations/0001.sql','utf8').replace(/--[^\n]*/g,'').replace(/\s+/g,' '));
  const request = (path: string, options: RequestInit = {}) => mf.dispatchFetch(origin + path, { ...options, redirect: 'manual' });
  const json = (path: string, body: unknown, extra: Record<string,string> = {}) => request(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  const form = (path: string, body: URLSearchParams, cookie = '') => request(path, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  const project = async () => { const r = await json('/remote/projects',{}); assert.equal(r.status,200); return r.json(); };
  const client = async () => {
    const r = await json('/oauth/register', { client_name: '<img src=x onerror=alert(1)>', redirect_uris: ['https://client.example/callback/dynamic-123'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code','refresh_token'], response_types: ['code'] });
    assert.equal(r.status,201); return r.json();
  };
  const verifier = 'a'.repeat(64);
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
  const authorize = async (c: {client_id: string}, scope = 'video:read video:edit', resource = origin + '/mcp') => {
    const query = new URLSearchParams({ client_id: c.client_id, redirect_uri: 'https://client.example/callback/dynamic-123', response_type: 'code', scope, resource, state: 'synthetic-state', code_challenge: challenge, code_challenge_method: 'S256' });
    const r = await request('/authorize?' + query);
    const html = await r.text();
    const handle = html.match(/name="handle"[^>]*value="([^"]+)"/)?.[1] ?? html.match(/value="([^"]+)"[^>]*name="handle"/)?.[1];
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    return { r, html, handle, cookie };
  };
  const link = async (scope = 'video:read video:edit') => {
    const p = await project(), c = await client(), a = await authorize(c,scope);
    assert.equal(a.r.status,200); assert.ok(a.handle); assert.ok(a.cookie.startsWith('__Host-'));
    const approved = await form('/authorize',new URLSearchParams([['handle',a.handle],['decision','approve'],['browserProof',p.proof],...scope.split(' ').map(s=>['scope',s])]),a.cookie);
    assert.equal(approved.status,302);
    const callback = new URL(approved.headers.get('location')!);
    assert.equal(callback.origin,'https://client.example'); assert.equal(callback.pathname,'/callback/dynamic-123');
    assert.equal(callback.searchParams.get('iss'),origin); assert.equal(callback.searchParams.get('state'),'synthetic-state');
    const token = await form('/oauth/token',new URLSearchParams({ grant_type:'authorization_code',client_id:c.client_id,code:callback.searchParams.get('code')!,code_verifier:verifier,redirect_uri:'https://client.example/callback/dynamic-123',resource:origin+'/mcp' }));
    assert.equal(token.status,200); const t = await token.json(); assert.equal(t.token_type.toLowerCase(),'bearer'); assert.equal(t.expires_in,1800);
    await json('/remote/sync',{auth:auth(p),metadata});
    return { p,c,t,a };
  };
  const rpc = async (token: string, method: string, params = {}) => {
    const r = await json('/mcp',{ jsonrpc:'2.0',id:1,method,params },{ Authorization:'Bearer '+token, Accept:'application/json, text/event-stream', 'MCP-Protocol-Version':'2025-06-18' });
    const text = await r.text();
    const data = r.headers.get('content-type')?.includes('text/event-stream') ? JSON.parse(text.split('\n').find(l=>l.startsWith('data: '))!.slice(6)) : JSON.parse(text);
    return { r, data };
  };
  return {mf,db,request,json,form,project,client,authorize,link,rpc,verifier};
}

test('official provider + stateless MCP: discovery/PKCE/resource/issuer and project-bound cut/status/Undo/cancel', async () => {
  const f = await fixture();
  try {
    const denied = await f.json('/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'});
    assert.equal(denied.status,401); assert.match(denied.headers.get('www-authenticate')!,/resource_metadata=/);
    const resourceResponse = await f.request('/.well-known/oauth-protected-resource/mcp');
    assert.equal(resourceResponse.status,200);
    const resource = await resourceResponse.json();
    assert.equal(resource.resource,origin+'/mcp'); assert.deepEqual(resource.authorization_servers,[origin]);
    const discovery = await (await f.request('/.well-known/oauth-authorization-server')).json();
    assert.equal(discovery.issuer,origin); assert.equal(discovery.authorization_response_iss_parameter_supported,true);
    assert.ok(discovery.code_challenge_methods_supported.includes('S256'));
    assert.equal(discovery.registration_endpoint,origin+'/oauth/register');
    const {p,t,a} = await f.link();
    const snapshot = await f.rpc(t.access_token,'tools/call',{name:'getproject',arguments:{}});
    assert.equal(snapshot.data.result.isError,undefined);
    assert.deepEqual(JSON.parse(snapshot.data.result.content[0].text).metadata,metadata);
    assert.doesNotMatch(a.html,/<img src=x/); assert.match(a.html,/&lt;img/); assert.match(a.html,/client\.example/);
    const listed = await f.rpc(t.access_token,'tools/list');
    assert.equal(listed.r.status,200); assert.equal(listed.data.result.tools.length,5);
    for (const tool of listed.data.result.tools) {
      assert.deepEqual(tool._meta.securitySchemes,[{type:'oauth2',scopes:['video:read','video:edit']}]);
      assert.deepEqual(tool.securitySchemes,tool._meta.securitySchemes);
    }
    const cut = await f.rpc(t.access_token,'tools/call',{name:'cut',arguments:{operationId:'one',generation:1,version:1,clips:[{start:0,end:2}]}});
    assert.equal(JSON.parse(cut.data.result.content[0].text).state,'queued');
    const poll = await f.json('/remote/poll',{auth:auth(p),metadata}); const received = await poll.json();
    assert.equal(received.command.operationId,'one'); assert.ok(received.queries<=24);
    const complete = {...metadata,version:3,hasOutput:true,canUndo:true,latestOperationId:'one'};
    const ack = {auth:auth(p),operationId:'one',state:'completed',metadata:complete};
    assert.equal((await (await f.json('/remote/report',ack)).json()).ok,true);
    assert.equal((await (await f.json('/remote/report',ack)).json()).ok,true);
    const status = await f.rpc(t.access_token,'tools/call',{name:'status',arguments:{operationId:'one'}});
    assert.equal(JSON.parse(status.data.result.content[0].text).state,'completed');
    const next = await f.rpc(t.access_token,'tools/call',{name:'undo',arguments:{operationId:'undo',generation:1,version:3,targetOperationId:'one'}});
    assert.equal(JSON.parse(next.data.result.content[0].text).state,'queued');
    await f.rpc(t.access_token,'tools/call',{name:'cancel',arguments:{operationId:'undo'}});
    assert.equal(await f.db.prepare("SELECT state FROM commands WHERE id='undo'").first('state'),'cancelled');
    assert.equal((await (await f.json('/remote/revoke',{auth:auth(p)})).json()).ok,true);
    const revoked = await f.rpc(t.access_token,'tools/call',{name:'getproject',arguments:{}});
    assert.equal(revoked.data.result.isError,true);
  } finally { await f.mf.dispose(); }
});

test('official negative PKCE/redirect/resource and native KV revoke are distinct from immediate D1 project revoke', async () => {
  const f = await fixture();
  try {
    const c = await f.client();
    assert.notEqual((await f.authorize(c,'video:read',origin+'/other')).r.status,200);
    const invalidRedirect = await f.request('/authorize?'+new URLSearchParams({client_id:c.client_id,redirect_uri:'https://evil.example/callback',response_type:'code',scope:'video:read',resource:origin+'/mcp',code_challenge:'a'.repeat(43),code_challenge_method:'S256'}));
    assert.notEqual(invalidRedirect.status,302); assert.notEqual(invalidRedirect.status,200);
    const p = await f.project(), a = await f.authorize(c);
    const approved = await f.form('/authorize',new URLSearchParams([['handle',a.handle!],['decision','approve'],['browserProof',p.proof],['scope','video:read'],['scope','video:edit']]),a.cookie);
    const callback = new URL(approved.headers.get('location')!);
    const failedPkce = await f.form('/oauth/token',new URLSearchParams({grant_type:'authorization_code',client_id:c.client_id,code:callback.searchParams.get('code')!,code_verifier:'wrong'.repeat(16),redirect_uri:'https://client.example/callback/dynamic-123',resource:origin+'/mcp'}));
    assert.equal(failedPkce.status,400);
    const {p: linked,c: client,t} = await f.link();
    const audience = await f.request('/mcp-other',{method:'POST',headers:{Authorization:'Bearer '+t.access_token,'Content-Type':'application/json'},body:'{}'});
    assert.equal(audience.status,404,'non-resource route cannot use an MCP token');
    const revoked = await f.form('/oauth/token',new URLSearchParams({token:t.access_token,token_type_hint:'access_token',client_id:client.client_id}));
    assert.equal(revoked.status,200);
    assert.equal((await f.rpc(t.access_token,'tools/list')).r.status,401);
    assert.equal(await f.db.prepare('SELECT revoked FROM projects WHERE id=?').bind(linked.project).first('revoked'),0,'native OAuth KV revocation is not falsely described as a D1 project fence');
    assert.equal((await (await f.json('/remote/revoke',{auth:auth(linked)})).json()).ok,true);
    assert.equal((await (await f.json('/remote/revoke',{auth:auth(linked)})).json()).ok,true,'lost revoke ACK is idempotent');
    const refresh=await f.form('/oauth/token',new URLSearchParams({grant_type:'refresh_token',refresh_token:t.refresh_token,client_id:client.client_id,resource:origin+'/mcp'}));
    assert.equal(refresh.status,400,'refresh cannot resurrect the revoked D1 project');
  } finally { await f.mf.dispose(); }
});

test('official consent cookie/proof boundary, origin/body/metadata negatives and read-only scope', async () => {
  const f = await fixture();
  try {
    const p = await f.project(), c = await f.client(), a = await f.authorize(c);
    assert.ok(a.handle);
    const body = new URLSearchParams({handle:a.handle,decision:'approve',browserProof:p.proof,scope:'video:read'});
    assert.notEqual((await f.form('/authorize',body)).status,302,'missing binding cookie denied');
    const fresh = await f.authorize(c);
    const replaced = new URLSearchParams({handle:fresh.handle!,decision:'approve',browserProof:p.proof,scope:'video:read',project:'other'});
    assert.equal((await f.form('/authorize',replaced,fresh.cookie)).status,400);
    const denial = await f.form('/authorize',new URLSearchParams({handle:fresh.handle!,decision:'deny'}),fresh.cookie);
    assert.equal(denial.status,302); const callback = new URL(denial.headers.get('location')!);
    assert.equal(callback.searchParams.get('error'),'access_denied'); assert.equal(callback.searchParams.get('iss'),origin);
    assert.equal((await f.json('/remote/projects',{}, {Origin:'https://evil.example'})).status,403);
    assert.equal((await f.json('/remote/projects',{filename:'never-forward.mp4'})).status,400);
    assert.equal((await f.request('/remote/projects',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'x'.repeat(16385)})).status,400);
    assert.equal((await f.authorize(c,'video:read')).r.status,400,'prototype has no read-only connection mode');
    const limited = await f.authorize(c);
    assert.equal((await f.form('/authorize',new URLSearchParams({handle:limited.handle!,decision:'approve',browserProof:p.proof,scope:'video:read'}),limited.cookie)).status,400,'unchecked edit permission is never silently added');
    const linked = await f.link();
    const downscoped = await f.form('/oauth/token',new URLSearchParams({grant_type:'refresh_token',refresh_token:linked.t.refresh_token,client_id:linked.c.client_id,resource:origin+'/mcp',scope:'video:read'}));
    assert.equal(downscoped.status,200); const reduced = await downscoped.json();
    const denied = await f.rpc(reduced.access_token,'tools/call',{name:'cut',arguments:{operationId:'forbidden',generation:1,version:1,clips:[{start:0,end:2}]}});
    assert.equal(denied.r.status,403); assert.match(denied.r.headers.get('www-authenticate')!,/video:edit/);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM commands').first('n'),0);
    await f.db.prepare('UPDATE experiment SET dcr=20,oauth=20').run();
    assert.equal((await f.json('/oauth/register',{client_name:'bounded',redirect_uris:['https://client.example/callback']})).status,400);
    assert.equal((await f.authorize(c)).r.status,400);
    assert.equal(await f.db.prepare('SELECT dcr FROM experiment').first('dcr'),20);
    assert.equal(await f.db.prepare('SELECT oauth FROM experiment').first('oauth'),20);
  } finally { await f.mf.dispose(); }
});

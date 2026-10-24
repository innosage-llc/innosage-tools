import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyScene } from '../../../lib/visual-remix.ts';
import { fixture, origin, video, scene, scopes, snapshot } from './fixtures/scene-client.ts';

function assertSceneReauthorization(response: Response) {
  assert.equal(response.status,401);
  const challenge = response.headers.get('www-authenticate')!;
  assert.match(challenge,/^Bearer /);
  assert.ok(challenge.includes('error="invalid_token"'));
  assert.ok(challenge.includes(`resource_metadata="${origin}/.well-known/oauth-protected-resource/scene/mcp"`));
  assert.ok(challenge.includes(`scope="${scopes.join(' ')}"`));
  assert.equal(response.headers.get('cache-control'),'no-store');
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
    assert.equal(a.r.headers.get('referrer-policy'),'same-origin');
    assert.match(a.r.headers.get('content-security-policy')!,/default-src 'none'/);
    assert.doesNotMatch(a.r.headers.get('content-security-policy')!,/form-action/);
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
    for (const id of ['\u0000'.repeat(96), '\"'.repeat(96), '']) assert.equal((await f.rpc(t.access_token,'tools/call',{name:'propose_scene',arguments:{proposal:{...proposal,requestId:'escaped-id'}}},'/scene/mcp',id)).r.status,400);
    for (const id of ['safe_'.repeat(19)+'x', Number.MAX_SAFE_INTEGER]) assert.equal((await f.rpc(t.access_token,'tools/list',{},'/scene/mcp',id)).r.status,200);
    assert.equal((await f.rpc(t.access_token,'tools/call',{name:'export_png',arguments:{}})).data.error.code,-32602);
    assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_requests').first('n'),before);
    assert.equal((await f.json('/scene/browser/sync',{auth:{...p.auth,credential:'f'.repeat(64)},snapshot:snapshot()})).status,401);
    const wrongOrigin = await f.json('/scene/browser/revoke',{auth:p.auth},{Origin:'https://evil.example'}); assert.equal(wrongOrigin.status,403);
    assert.equal((await (await f.json('/scene/browser/revoke',{auth:p.auth})).json()).ok,true);
    assertSceneReauthorization((await f.rpc(t.access_token,'tools/list')).r);
    assert.equal(await f.db.prepare('SELECT snapshot FROM scene_shares WHERE id=?').bind(p.auth.shareId).first('snapshot'),null);
    f.noEgress();
  } finally { await f.mf.dispose(); }
});

test('inactive candidate: missing cookie/proof, cross-purpose proof, recovered handle and lease expiration fail closed', async () => {
  const f = await fixture();
  try {
    const p = await f.create(), c = await f.client();
    const missingCookie = await f.authorize(c); assert.equal((await f.approve({...missingCookie,cookie:''},p.proof)).status,400);
    const nullOrigin = await f.authorize(c);
    assert.equal((await f.form('/authorize',new URLSearchParams([['handle',nullOrigin.handle],['decision','approve'],['browserProof',p.proof],...scopes.map(s=>['scope',s])]),nullOrigin.cookie,{Origin:'null'})).status,403);
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
    assertSceneReauthorization((await f.rpc(active.t.access_token,'tools/list')).r);
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
    assertSceneReauthorization((await f.rpc(token.access_token,'tools/list')).r);
    const refreshed = await f.form('/oauth/token',new URLSearchParams({grant_type:'refresh_token',client_id:c.client_id,refresh_token:token.refresh_token,resource:video})); assert.equal(refreshed.status,200,await refreshed.clone().text());
    const next = await refreshed.json(); assert.equal((await f.rpc(next.access_token,'tools/list',{},'/mcp')).r.status,200);
    assert.equal((await f.rpc(next.access_token,'tools/list')).r.status,401);
    const sa = await f.authorize(c), st = await f.token(c,await f.approve(sa,s.proof)); assert.equal(st.status,200);
    const sceneToken = await st.json(); assert.equal((await f.rpc(sceneToken.access_token,'tools/list')).r.status,200);
    assert.equal((await f.rpc(next.access_token,'tools/list',{},'/mcp')).r.status,200,'same-client/same-user Scene grant cannot replace video grant');
    f.noEgress();
  } finally { await f.mf.dispose(); }
});


test('recovery: same client can manually authorize a new share while the expired grant stays rejected',async()=>{
 const f=await fixture();
 try{
  const first=await f.link();assert.equal((await f.rpc(first.t.access_token,'tools/call',{name:'get_scene',arguments:{}})).r.status,200);
  await f.db.prepare('UPDATE scene_shares SET expires=? WHERE id=?').bind(Date.now()-1,first.p.auth.shareId).run();
  const expired=await f.rpc(first.t.access_token,'tools/call',{name:'get_scene',arguments:{}});assertSceneReauthorization(expired.r);
  assert.match(expired.r.headers.get('x-visual-remix-request-id')!,/^[a-f0-9-]{36}$/);
  assert.equal(expired.r.headers.get('x-visual-remix-version'),'0.1.6');assert.equal(expired.r.headers.get('x-visual-remix-revision'),'a'.repeat(40));assert.equal(expired.r.headers.get('x-visual-remix-tool'),'get_scene');
  const next=await f.create(),a=await f.authorize(first.c),tr=await f.token(first.c,await f.approve(a,next.proof));assert.equal(tr.status,200);const token=await tr.json();assert.equal(token.refresh_token,undefined);assert.ok(token.expires_in<=900);
  const read=await f.rpc(token.access_token,'tools/call',{name:'get_scene',arguments:{}});assert.equal(read.r.status,200);assert.equal(JSON.parse(read.data.result.content[0].text).revision,0);
  assertSceneReauthorization((await f.rpc(first.t.access_token,'tools/call',{name:'get_scene',arguments:{}})).r);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_requests').first('n'),0);f.noEgress();
 }finally{await f.mf.dispose();}
});

test('recovery: removed lifetime test quotas retain accounting and all consent and token checks',async()=>{
 const f=await fixture();
 try{
  const p=await f.create(),c=await f.client();await f.db.prepare('UPDATE experiment SET oauth=20,http=2000 WHERE singleton=1').run();await f.db.prepare('UPDATE scene_budget SET http=2000 WHERE singleton=1').run();
  const a=await f.authorize(c);assert.equal(a.r.status,200);assert.ok(a.handle);assert.equal(await f.db.prepare('SELECT oauth FROM experiment WHERE singleton=1').first('oauth'),21);assert.equal(await f.db.prepare('SELECT consent_hash FROM scene_shares WHERE id=?').bind(p.auth.shareId).first('consent_hash'),null,'rendering consent is not a grant');
  const tr=await f.token(c,await f.approve(a,p.proof));assert.equal(tr.status,200);const token=await tr.json();assert.equal(token.refresh_token,undefined);assert.ok(token.expires_in<=900);
  assert.equal((await f.rpc(token.access_token,'tools/call',{name:'get_scene',arguments:{}})).r.status,200);assert.ok(Number(await f.db.prepare('SELECT http FROM scene_budget WHERE singleton=1').first('http'))>2000);
  assert.equal((await f.rpc(token.access_token,'tools/list',{},'/mcp')).r.status,401,'audience fences survive quota removal');f.noEgress();
 }finally{await f.mf.dispose();}
});

test('recovery: lease loss after outer validation returns an SDK auth hint and never a completed edit',async()=>{
 const f=await fixture();
 try{
  // Fixture dispatches directly to the actual SDK handler with an expired/missing
  // binding, deterministically modeling the post-validation lease race.
  const r=await f.json('/scene/mcp',{jsonrpc:'2.0',id:'race',method:'tools/call',params:{name:'get_scene',arguments:{}}},{'x-fixture-lease-race':'true',Accept:'application/json, text/event-stream'});assert.equal(r.status,200);const raw=await r.text(),body=r.headers.get('content-type')?.includes('text/event-stream')?JSON.parse(raw.split('\n').find(l=>l.startsWith('data: '))!.slice(6)):JSON.parse(raw);
  assert.equal(body.result.isError,true);assert.match(body.result.content[0].text,/no proposal was delivered/);const challenge=body.result._meta['mcp/www_authenticate'][0];assert.ok(challenge.includes('error="invalid_token"'));assert.match(challenge,/error_description=/);assert.ok(challenge.includes('scope="scene:read scene:propose"'));assert.ok(challenge.includes(origin+'/.well-known/oauth-protected-resource/scene/mcp'));assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_requests').first('n'),0);f.noEgress();
 }finally{await f.mf.dispose();}
});


test('recovery diagnostics preserve the enabled candidate video WebSocket upgrade and one-use proof',async()=>{
 const f=await fixture(undefined,true);
 try{
  const p=await (await f.json('/remote/projects',{})).json(),auth={project:p.project,epoch:p.epoch,credential:p.credential};
  const ticket=await (await f.json('/remote/bridge/join',{auth})).json();
  const connect=()=>f.request(`/remote/bridge/${p.project}/${p.epoch}`,{headers:{Origin:origin,Upgrade:'websocket','Sec-WebSocket-Protocol':`video-scissors-wakeup.v1, join.${ticket.proof}`}});
  const response=await connect();assert.equal(response.status,101);assert.equal(response.headers.get('sec-websocket-protocol'),'video-scissors-wakeup.v1');assert.ok(response.webSocket);response.webSocket.accept();response.webSocket.close(1000,'local-review-regression');
  assert.equal((await connect()).status,401,'diagnostics never permit reuse of the join proof');f.noEgress();
 }finally{await f.mf.dispose();}
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, origin, scopes, snapshot } from './fixtures/scene-client.ts';

// Real local provider/D1/SDK. These checks do not prove ChatGPT selection or resume.
test('authenticated profile is designated, strict and stable for its independently authorized share', async () => {
 const f=await fixture();try {
  const {p,t}=await f.link(),listed=await f.rpc(t.access_token,'tools/list');
  const tool=listed.data.result.tools.find((x:{name:string})=>x.name==='get_profile');
  assert.ok(tool,'Scene needs a designated profile tool');assert.equal(tool._meta['openai/profile'],true);
  assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.inputSchema.additionalProperties,false);assert.deepEqual(tool.inputSchema.properties,{});
  assert.equal(tool.outputSchema.additionalProperties,false);assert.deepEqual(tool.outputSchema.required,['id']);assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes}]);
  const first=await f.rpc(t.access_token,'tools/call',{name:'get_profile',arguments:{}});assert.equal(first.r.status,200);assert.equal(first.data.result.isError,false);
  const profile=first.data.result.structuredContent;assert.equal(profile.id,p.auth.shareId);assert.match(profile.id,/\S/);assert.ok(Object.keys(profile).every(k=>['id','name','email','nickname'].includes(k)));assert.equal(profile.email,undefined);
  assert.deepEqual(JSON.parse(first.data.result.content[0].text),profile);
  assert.deepEqual((await f.rpc(t.access_token,'tools/call',{name:'get_profile',arguments:{}})).data.result.structuredContent,profile);
  const selector=await f.rpc(t.access_token,'tools/call',{name:'get_profile',arguments:{shareId:'other'}});assert.ok(selector.data.result?.isError||selector.data.error);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_requests').first('n'),0);f.noEgress();
 }finally{await f.mf.dispose();}
});

test('profile uses live authority rather than browser freshness; revoke challenges without a placeholder',async()=>{
 const f=await fixture();try {
  const {p,t}=await f.link(),profile=async()=>(await f.rpc(t.access_token,'tools/call',{name:'get_profile',arguments:{}})).data.result;
  const first=await profile();assert.equal(first.structuredContent?.id,p.auth.shareId);f.advance(11000);assert.deepEqual((await profile()).structuredContent,first.structuredContent);
  const stale=await f.rpc(t.access_token,'tools/call',{name:'get_scene',arguments:{}});assert.equal(JSON.parse(stale.data.result.content[0].text).error,'BROWSER_UNAVAILABLE');assert.equal(stale.data.result._meta?.['mcp/www_authenticate'],undefined);
  await f.json('/scene/browser/sync',{auth:p.auth,snapshot:{...snapshot(),revision:1}});assert.deepEqual((await profile()).structuredContent,first.structuredContent);
  await f.json('/scene/browser/revoke',{auth:p.auth});const denied=await f.rpc(t.access_token,'tools/call',{name:'get_profile',arguments:{}});
  assert.equal(denied.r.status,401);assert.ok(denied.r.headers.get('www-authenticate')!.includes(origin+'/.well-known/oauth-protected-resource/scene/mcp'));assert.equal(denied.data?.result?.structuredContent,undefined);f.noEgress();
 }finally{await f.mf.dispose();}
});

test('same-project shares stay distinct; a newly executed read is not automatic host continuation',async()=>{
 const f=await fixture();try {
  const one=await f.link(),two=await f.create();assert.equal(one.p.auth.projectId,two.auth.projectId);
  const a=await f.authorize(one.c),exchange=await f.token(one.c,await f.approve(a,two.proof));assert.equal(exchange.status,200);const token=await exchange.json();
  const first=(await f.rpc(one.t.access_token,'tools/call',{name:'get_profile',arguments:{}})).data.result.structuredContent;
  const second=(await f.rpc(token.access_token,'tools/call',{name:'get_profile',arguments:{}})).data.result.structuredContent;
  assert.equal(first?.id,one.p.auth.shareId);assert.equal(second?.id,two.auth.shareId);assert.notEqual(first.id,second.id);
  assert.equal(token.refresh_token,undefined);assert.ok(token.expires_in<=900);await f.json('/scene/browser/revoke',{auth:one.p.auth});
  const request={name:'get_scene',arguments:{}};assert.equal((await f.rpc(one.t.access_token,'tools/call',request,'/scene/mcp','original-read')).r.status,401);
  // Explicit harness re-execution, never relabeled as a resumed host execution.
  const read=await f.rpc(token.access_token,'tools/call',request,'/scene/mcp','original-read');assert.equal(read.r.status,200);assert.equal(read.data.id,'original-read');assert.equal(JSON.parse(read.data.result.content[0].text).revision,0);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_requests').first('n'),0);assert.equal((await f.rpc(token.access_token,'tools/list',{},'/mcp')).r.status,401);f.noEgress();
 }finally{await f.mf.dispose();}
});

test('invalid-bearer challenges use the active Scene origin',async()=>{
 const f=await fixture();try {
  for(const host of [origin,'https://alternate-scene.example']) {
   const r=await f.mf.dispatchFetch(host+'/scene/mcp',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer not-a-token'},body:JSON.stringify({jsonrpc:'2.0',id:'read',method:'tools/call',params:{name:'get_scene',arguments:{}}})});
   assert.equal(r.status,401);const h=r.headers.get('www-authenticate')!;assert.ok(h.includes(host+'/.well-known/oauth-protected-resource/scene/mcp'));assert.ok(h.includes('error="invalid_token"'));assert.ok(h.includes('scope="'+scopes.join(' ')+'"'));
  }f.noEgress();
 }finally{await f.mf.dispose();}
});

test('exceptional context and post-validation profile races retain origin-bound auth recovery',async()=>{
 const f=await fixture();try {
  for(const host of [origin,'https://alternate-scene.example']) {
   const response=await f.mf.dispatchFetch(host+'/__fixture/auth-context');
   assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');
   const challenge=response.headers.get('www-authenticate')!;
   assert.ok(challenge.includes(host+'/.well-known/oauth-protected-resource/scene/mcp'));assert.ok(challenge.includes('error="invalid_token"'));assert.ok(challenge.includes('error_description='));
  }
  // Test-only dispatch invokes the real SDK handler after authority loss.
  const response=await f.json('/scene/mcp',{jsonrpc:'2.0',id:'profile-race',method:'tools/call',params:{name:'get_profile',arguments:{}}},{'x-fixture-lease-race':'true',Accept:'application/json, text/event-stream'});
  const text=await response.text(),body=response.headers.get('content-type')?.includes('text/event-stream')?JSON.parse(text.split('\n').find(x=>x.startsWith('data: '))!.slice(6)):JSON.parse(text);
  assert.equal(response.status,200);assert.equal(body.result.isError,true);assert.equal(body.result.structuredContent,undefined);
  assert.ok(body.result._meta['mcp/www_authenticate'][0].includes(origin+'/.well-known/oauth-protected-resource/scene/mcp'));
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_requests').first('n'),0);f.noEgress();
 }finally{await f.mf.dispose();}
});

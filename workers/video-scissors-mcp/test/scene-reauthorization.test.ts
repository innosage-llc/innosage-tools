import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture,scene,scopes,snapshot } from './fixtures/scene-client.ts';
import { SCENE_FIELDS } from '../../../lib/visual-remix-remote.ts';
import { UNTIL_REVOKED_CONSENT } from '../../../lib/visual-remix-lifetime.ts';
const hash=async(v:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))).toString('hex');
type F=Awaited<ReturnType<typeof fixture>>;
async function requestId(f:F,handle:string){const id=await f.db.prepare('SELECT id FROM scene_reauthorizations WHERE handle_hash=?').bind(await hash(handle)).first<string>('id');assert.ok(id);return id;}
async function approve(f:F,a:{handle:string;cookie:string},proof:string,id:string){return f.form('/authorize',new URLSearchParams([['handle',a.handle],['decision','approve'],['browserProof',proof],['reauthRequestId',id],...scopes.map(s=>['scope',s])]),a.cookie);}
async function issue(f:F,auth:unknown,id:string){const r=await f.json('/scene/browser/reauth/issue',{auth,requestId:id,confirmed:true});assert.equal(r.status,200,await r.clone().text());return r.json();}
async function until(f:F){const r=await f.json('/scene/browser/create',{snapshot:snapshot(),fields:SCENE_FIELDS,confirmed:true,lifetime:UNTIL_REVOKED_CONSENT},{'x-fixture-until-revoked':'true'});assert.equal(r.status,200);const p=await r.json(),c=await f.client(),a=await f.authorize(c,scene,scopes.join(' '),false,true),tr=await f.token(c,await f.approve(a,p.proof));assert.equal(tr.status,200);return{p,c,t:await tr.json()};}

test('explicit active-editor reauthorization keeps the same share/profile after OAuth expiry, without refresh or write replay',async()=>{
 const f=await fixture(undefined,false,false,false,true);try{
  const {p,c,t}=await until(f),initial=await f.db.prepare('SELECT consent_hash,expires,epoch FROM scene_shares WHERE id=?').bind(p.auth.shareId).first();
  const profile=(await f.rpc(t.access_token,'tools/call',{name:'get_profile',arguments:{}})).data.result.structuredContent;
  f.advance(1801000);assert.equal((await f.rpc(t.access_token,'tools/call',{name:'get_scene',arguments:{}})).r.status,401);
  assert.equal((await f.json('/scene/browser/sync',{auth:p.auth,snapshot:snapshot()})).status,200);
  const a=await f.authorize(c,scene,scopes.join(' '),false,true),id=await requestId(f,a.handle);
  const info=await f.json('/scene/browser/reauth/describe',{auth:p.auth,requestId:id});assert.equal(info.status,200);assert.equal((await info.json()).clientId,c.client_id);
  const proof=await issue(f,p.auth,id),authorized=await approve(f,a,proof.proof,id),tr=await f.token(c,authorized);assert.equal(tr.status,200);const token=await tr.json();assert.equal(token.refresh_token,undefined);assert.ok(token.expires_in<=1800);
  assert.deepEqual((await f.rpc(token.access_token,'tools/call',{name:'get_profile',arguments:{}})).data.result.structuredContent,profile);
  const read=await f.rpc(token.access_token,'tools/call',{name:'get_scene',arguments:{}},'/scene/mcp','original-read');assert.equal(read.r.status,200);assert.equal(read.data.id,'original-read');assert.equal(JSON.parse(read.data.result.content[0].text).revision,0);
  assert.deepEqual(await f.db.prepare('SELECT consent_hash,expires,epoch FROM scene_shares WHERE id=?').bind(p.auth.shareId).first(),initial);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_shares').first('n'),1);assert.equal(await f.db.prepare('SELECT shares FROM scene_budget').first('shares'),1);assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_requests').first('n'),0);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_consent_bindings').first('n'),1);assert.equal(await f.db.prepare('SELECT state FROM scene_reauthorizations WHERE id=?').bind(id).first('state'),'consumed');f.noEgress();
 }finally{await f.mf.dispose();}
});

test('fixed deadlines stay fixed; one proof is atomically issued and consumed only for its request/client/handle',async()=>{
 const f=await fixture(undefined,false,false,false,true);try{
  const {p,c}=await f.link();f.advance(11000);await f.json('/scene/browser/sync',{auth:p.auth,snapshot:snapshot()});
  const a=await f.authorize(c),id=await requestId(f,a.handle);
  const attempts=await Promise.all([1,2].map(()=>f.json('/scene/browser/reauth/issue',{auth:p.auth,requestId:id,confirmed:true})));assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);const proof=await attempts.find(r=>r.status===200)!.json();
  const raw={requestId:id,proof:proof.proof,handle:a.handle,clientId:c.client_id,resource:scene};
  for(const change of [{clientId:'other'},{handle:'other'},{resource:'https://localhost/mcp'},{requestId:'other'}]){const r=await f.json('/__fixture/reauth-consume',{...raw,...change});assert.equal((await r.json()).value,null);}
  const tr=await f.token(c,await approve(f,a,proof.proof,id));assert.equal(tr.status,200);const token=await tr.json();assert.equal(token.refresh_token,undefined);assert.ok(token.expires_in<900);assert.equal(await f.db.prepare('SELECT expires FROM scene_shares WHERE id=?').bind(p.auth.shareId).first('expires'),p.expiresAt);
  assert.equal((await(await f.json('/__fixture/reauth-consume',raw)).json()).value,null);
  await f.json('/scene/browser/revoke',{auth:p.auth});assert.equal((await f.rpc(token.access_token,'tools/call',{name:'get_profile',arguments:{}})).r.status,401);f.noEgress();
 }finally{await f.mf.dispose();}
});

test('stale/restored owner, absent fresh consent, wrong binding and concurrent different-share approval cannot acquire a proof',async()=>{
 const f=await fixture(undefined,false,false,false,true);try{
  const one=await f.link(),two=await f.link(),a=await f.authorize(one.c),id=await requestId(f,a.handle);
  assert.equal((await f.json('/scene/browser/reauth/issue',{auth:one.p.auth,requestId:id,confirmed:false})).status,400);
  assert.equal((await f.json('/scene/browser/reauth/issue',{auth:{...one.p.auth,credential:'f'.repeat(64)},requestId:id,confirmed:true})).status,401);
  f.advance(11000);assert.equal((await f.json('/scene/browser/reauth/describe',{auth:one.p.auth,requestId:id})).status,409);
  await f.json('/scene/browser/sync',{auth:one.p.auth,snapshot:snapshot()});await f.json('/scene/browser/sync',{auth:two.p.auth,snapshot:snapshot()});
  const races=await Promise.all([one.p.auth,two.p.auth].map(auth=>f.json('/scene/browser/reauth/issue',{auth,requestId:id,confirmed:true})));assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  const winner=races[0].status===200?one:two,loser=winner===one?two:one;assert.equal((await f.json('/scene/browser/reauth/describe',{auth:loser.p.auth,requestId:id})).status,409);
  await f.json('/scene/browser/revoke',{auth:winner.p.auth});const proof=await races.find(r=>r.status===200)!.json();assert.equal((await approve(f,a,proof.proof,id)).status,403);assert.equal(await f.db.prepare('SELECT proof_hash FROM scene_reauthorizations WHERE id=?').bind(id).first('proof_hash'),null);f.noEgress();
 }finally{await f.mf.dispose();}
});

test('expired and collected reauthorization requests cannot be resurrected by an already-read provider consent',async()=>{
 const f=await fixture(undefined,false,false,false,true);try{
  const {p,c}=await f.link(),a=await f.authorize(c),id=await requestId(f,a.handle),proof=await issue(f,p.auth,id);
  const form=new URLSearchParams([['handle',a.handle],['decision','approve'],['browserProof',proof.proof],['reauthRequestId',id],...scopes.map(s=>['scope',s])]);
  const pending=f.form('/authorize',form,a.cookie,{'x-fixture-hold-consent':'true'});
  let held=false;for(let i=0;i<100;i++){held=(await(await f.request('/__fixture/consent-held')).json()).held;if(held)break;await new Promise(r=>setTimeout(r,5));}assert.ok(held);
  f.advance(300001);await f.request('/__fixture/reauth-purge');assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_reauthorizations').first('n'),0);await f.request('/__fixture/release-consent');assert.equal((await pending).status,403);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_shares').first('n'),1);assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_requests').first('n'),0);f.noEgress();
 }finally{await f.mf.dispose();}
});

test('short transaction storage is bounded and ages out without changing grant capacity or consent tombstones',async()=>{
 const f=await fixture(undefined,false,false,false,true);try{
  const {p,c}=await f.link();for(let i=0;i<25;i++)assert.equal((await f.authorize(c)).r.status,200);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_reauthorizations').first('n'),20);assert.equal(await f.db.prepare('SELECT shares FROM scene_budget').first('shares'),1);
  f.advance(300001);const next=await f.authorize(c);assert.equal(next.r.status,200);assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_reauthorizations').first('n'),1);
  assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_consent_bindings').first('n'),1);assert.equal(await f.db.prepare('SELECT revoked FROM scene_shares WHERE id=?').bind(p.auth.shareId).first('revoked'),0);f.noEgress();
 }finally{await f.mf.dispose();}
});

test('inactive route stays absent; active consent script is nonce-bound and request identity cannot be rewritten',async()=>{
 const off=await fixture();try{
  const {p,c}=await off.link(),a=await off.authorize(c);
  assert.equal((await off.json('/scene/browser/reauth/issue',{auth:p.auth,requestId:'unknown',confirmed:true})).status,404);
  assert.ok(!a.html.includes('new BroadcastChannel'));assert.ok(!a.r.headers.get('content-security-policy')?.includes('script-src'));off.noEgress();
 }finally{await off.mf.dispose();}
 const f=await fixture(undefined,false,false,false,true);try{
  const {p,c}=await f.link(),a=await f.authorize(c),id=await requestId(f,a.handle);
  const nonce=a.r.headers.get('content-security-policy')?.match(/script-src 'nonce-([^']+)'/)?.[1];assert.ok(nonce);assert.ok(a.html.includes('<script nonce="'+nonce+'">'));
  assert.ok(!a.html.includes('<img src=x onerror=alert(1)>'));assert.ok(a.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  for(const [field,value]of [['client_id','other-client'],['handle_hash','other-handle'],['resource','https://other/scene/mcp'],['expires',f.now()+400000]]as const){
   await assert.rejects(f.db.prepare('UPDATE scene_reauthorizations SET '+field+'=? WHERE id=?').bind(value,id).run(),/SCENE_REAUTH_IMMUTABLE/);
  }
  const proof=await issue(f,p.auth,id);await approve(f,a,proof.proof,id);
  await assert.rejects(f.db.prepare("UPDATE scene_reauthorizations SET state='issued',proof_hash=?,proof_expires=expires WHERE id=?").bind('f'.repeat(64),id).run(),/SCENE_REAUTH_IMMUTABLE/);f.noEgress();
 }finally{await f.mf.dispose();}
});

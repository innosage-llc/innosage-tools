import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { retirementClock } from './fixtures/retirement-clock.ts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { emptyScene } from '../../../lib/visual-remix.ts';
import { UNTIL_REVOKED_CONSENT } from '../../../lib/visual-remix-lifetime.ts';
import { type SceneOwner, type SceneAuth } from '../../../lib/visual-remix-remote.ts';
const quarantine=1800000;
const snapshot=()=>({schemaVersion:1,projectId:'retirement-project',generation:'retirement-generation',revision:0,scene:emptyScene()});
const proposal=(requestId:string)=>({schemaVersion:1,projectId:snapshot().projectId,generation:snapshot().generation,baseRevision:0,requestId,explanation:'Synthetic retained-slot edit',scene:{...emptyScene(),background:'#123456'}});
type Created={auth:SceneOwner;proof:string};
async function fixture(legacyRows=0,withReferences=true){
 const bundle=await build({entryPoints:['test/fixtures/scene.ts'],plugins:[retirementClock],bundle:true,format:'esm',platform:'browser',conditions:['workerd'],write:false});
 let time=Date.now(),egress=0;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-13',d1Databases:['DB'],outboundService:()=>{egress++;return new Response('DENIED',{status:403});}})),db=await mf.getD1Database('DB');
 const sql=(name:string)=>readFileSync(name,'utf8').replace(/--[^\n]*/g,'').replace(/\s+/g,' ');
 await db.exec(sql('migrations/0001.sql'));await db.exec(sql('candidate-migrations/scene.sql'));
 for(let i=0;i<legacyRows;i++)await db.prepare('INSERT INTO scene_shares(id,project,generation,credential_hash,proof_expires,expires,snapshot,revision,seen,revoked,epoch) VALUES(?,?,?,?,?,?,?,?,?,1,2)').bind('old-'+i,'old-project','old-generation','a'.repeat(64),time-100000,time-1,null,0,time-200000).run();
 await db.exec(sql('candidate-migrations/scene-until-revoked.sql'));
 if(withReferences)await db.exec(sql('candidate-migrations/scene-reference.sql'));
 // Only the local test clock is substituted; admission/deletion predicates and
 // triggers remain the production SQL. A separate test executes the real clock.
 await db.exec('CREATE TABLE fixture_clock(now INTEGER NOT NULL)');await db.prepare('INSERT INTO fixture_clock VALUES(?)').bind(time).run();
 const migration=sql('candidate-migrations/scene-retained-slots.sql'),clock="CAST(unixepoch('now')*1000 AS INTEGER)";
 assert.equal(migration.split(clock).length-1,2);await db.exec(migration.replaceAll(clock,'(SELECT now FROM fixture_clock)'));
 const call=async<T=unknown>(action:string,data:Record<string,unknown>={},enabled=true,referencesEnabled=withReferences)=>{
  await db.prepare('UPDATE fixture_clock SET now=?').bind(time).run();
  const r=await mf.dispatchFetch('https://localhost/fixture',{method:'POST',headers:{'content-type':'application/json','x-fixture-time':String(time),'x-fixture-until-revoked':'true','x-fixture-reference':String(referencesEnabled),'x-fixture-retirement':String(enabled)},body:JSON.stringify({action,...data})});
  return {status:r.status,...await r.json() as {value:T;error?:string}};
 };
 const create=async()=>{const r=await call<Created>('create',{snapshot:snapshot(),lifetime:UNTIL_REVOKED_CONSENT});assert.equal(r.status,200,r.error);return r.value;};
 const bind=async(p:Created)=>{const r=await call<SceneAuth>('bind',{proof:p.proof,handle:crypto.randomUUID()});assert.ok(r.value);return r.value;};
 return{mf,db,call,create,bind,advance:(ms:number)=>{time+=ms;},now:()=>time,noEgress:()=>assert.equal(egress,0)};
}

test('old revoked rows start quarantine now; twenty retained slots deny concurrent overflow without resetting telemetry',async()=>{
 const f=await fixture(19);try{
  assert.equal(await f.db.prepare('SELECT min(retired_at) AS t FROM scene_shares').first('t'),f.now());
  const p=await f.create();await f.bind(p);assert.equal(await f.db.prepare('SELECT shares FROM scene_budget').first('shares'),20);
  assert.equal((await f.call('create',{snapshot:snapshot(),lifetime:UNTIL_REVOKED_CONSENT})).status,409);
  f.advance(quarantine-1);await f.call('reclaim');assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_shares').first('n'),20);
  f.advance(1);await f.call('reclaim');assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_shares').first('n'),17,'one sweep reclaims at most three');
  const races=await Promise.all(Array.from({length:5},()=>f.call('create',{snapshot:snapshot(),lifetime:UNTIL_REVOKED_CONSENT},false)));
  assert.equal(races.filter(r=>r.status===200).length,3);assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_shares').first('n'),20);assert.equal(await f.db.prepare('SELECT shares FROM scene_budget').first('shares'),23,'historical admitted creations are never reset');
  assert.ok(await f.db.prepare('SELECT id FROM scene_shares WHERE id=? AND revoked=0').bind(p.auth.shareId).first());f.noEgress();
 }finally{await f.mf.dispose();}
});

test('revoke is immediate but capacity is quarantined; active indefinite grants survive and absent recovery never authenticates a mismatched existing row',async()=>{
 const f=await fixture();try{
  const p=await f.create(),remote=await f.bind(p),active=await f.create(),a=await f.bind(active);
  assert.deepEqual((await f.call('revokeOutcome',{auth:{...p.auth,credential:'f'.repeat(64)}})).value,{ok:false});
  for(const auth of [{...p.auth,projectId:'wrong'},{...p.auth,generation:'wrong'},{...p.auth,epoch:99}])assert.deepEqual((await f.call('revokeOutcome',{auth})).value,{ok:false});
  assert.deepEqual((await f.call('revokeOutcome',{auth:p.auth})).value,{ok:true});
  const retired=await f.db.prepare('SELECT retired_at FROM scene_shares WHERE id=?').bind(p.auth.shareId).first('retired_at');assert.equal(retired,f.now());
  await assert.rejects(f.db.prepare('UPDATE scene_shares SET retired_at=retired_at-1 WHERE id=?').bind(p.auth.shareId).run(),/RETIREMENT_IMMUTABLE/);
  await assert.rejects(f.db.prepare('UPDATE scene_shares SET revoked=0 WHERE id=?').bind(p.auth.shareId).run(),/RETIREMENT_TERMINAL|CHECK constraint/);
  f.advance(quarantine-1);await f.call('reclaim');assert.ok(await f.db.prepare('SELECT id FROM scene_shares WHERE id=?').bind(p.auth.shareId).first());
  f.advance(1);await f.call('reclaim');assert.equal(await f.db.prepare('SELECT id FROM scene_shares WHERE id=?').bind(p.auth.shareId).first(),null);
  assert.deepEqual((await f.call('revokeOutcome',{auth:p.auth})).value,{ok:true,state:'already_absent'});
  assert.deepEqual((await f.call('revokeOutcome',{auth:p.auth},false)).value,{ok:true,state:'already_absent'},'recovery remains available when new reclamation is disabled');
  assert.equal((await f.call('lease',{auth:remote})).value,null);assert.equal((await f.call('sync',{auth:p.auth,snapshot:snapshot()})).value,false);assert.equal((await f.call('bind',{proof:p.proof,handle:'old-replay'})).value,null);
  assert.deepEqual((await f.call('lease',{auth:a})).value,{expiresAt:null});assert.equal((await f.call('sync',{auth:active.auth,snapshot:snapshot()})).value,true);f.noEgress();
 }finally{await f.mf.dispose();}
});

test('more than twenty lifetime creates reuse only retired slots while all stored child records remain bounded',async()=>{
 const f=await fixture();try{
  let completed=0;
  while(completed<45){
   let r=await f.call<Created>('create',{snapshot:snapshot(),lifetime:UNTIL_REVOKED_CONSENT});
   if(r.status!==200){assert.match(r.error!,/SCENE_SHARE_BUDGET/);f.advance(quarantine);r=await f.call<Created>('create',{snapshot:snapshot(),lifetime:UNTIL_REVOKED_CONSENT});}
   assert.equal(r.status,200,r.error);const p=r.value,a=await f.bind(p),q=proposal('request-'+completed);
   assert.equal((await f.call('propose',{auth:a,proposal:q})).status,200);await f.call('cancel',{auth:a,id:q.requestId});
   await f.db.prepare('INSERT INTO scene_references(share,epoch,consent,pixels) VALUES(?,1,?,?)').bind(p.auth.shareId,'{}',new Uint8Array([1,2,3])).run();
   assert.deepEqual((await f.call('revokeOutcome',{auth:p.auth})).value,{ok:true});completed++;
   for(const [table,max]of [['scene_shares',20],['scene_requests',320],['scene_consent_bindings',20],['scene_references',20]] as const)assert.ok(Number(await f.db.prepare('SELECT count(*) AS n FROM '+table).first('n'))<=max,table);
  }
  assert.equal(await f.db.prepare('SELECT shares FROM scene_budget').first('shares'),45);f.advance(quarantine);for(let i=0;i<7;i++)await f.call('reclaim');
  for(const table of ['scene_shares','scene_requests','scene_consent_bindings','scene_references'])assert.equal(await f.db.prepare('SELECT count(*) AS n FROM '+table).first('n'),0,table);f.noEgress();
 }finally{await f.mf.dispose();}
});

test('reclamation stays disabled by default, works without an image table, and keeps the sixteen-request guard',async()=>{
 const f=await fixture(0,false);try{
  const p=await f.create(),a=await f.bind(p);
  for(let i=0;i<16;i++){assert.equal((await f.call('propose',{auth:a,proposal:proposal('budget-'+i)})).status,200);await f.call('cancel',{auth:a,id:'budget-'+i});}
  assert.equal((await f.call('propose',{auth:a,proposal:proposal('over-budget')})).status,409);await f.call('revoke',{auth:p.auth});f.advance(quarantine);
  await f.call('reclaim',{},false);assert.ok(await f.db.prepare('SELECT id FROM scene_shares WHERE id=?').bind(p.auth.shareId).first());await f.call('reclaim');assert.equal(await f.db.prepare('SELECT id FROM scene_shares WHERE id=?').bind(p.auth.shareId).first(),null);f.noEgress();
 }finally{await f.mf.dispose();}
});

test('the production migration uses database time rather than inventing old retirement timestamps',async()=>{
 const bundle=await build({entryPoints:['test/fixtures/scene.ts'],bundle:true,format:'esm',platform:'browser',write:false});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-13',d1Databases:['DB']}));
 try{
  const db=await mf.getD1Database('DB'),sql=(p:string)=>readFileSync(p,'utf8').replace(/--[^\n]*/g,'').replace(/\s+/g,' ');
  await db.exec(sql('candidate-migrations/scene.sql'));const before=Date.now();await db.prepare('INSERT INTO scene_shares(id,project,generation,credential_hash,proof_expires,expires,revision,seen,revoked) VALUES(?,?,?,?,?,?,0,0,1)').bind('old','project','generation','a'.repeat(64),1,2).run();
  await db.exec(sql('candidate-migrations/scene-until-revoked.sql'));await db.exec(sql('candidate-migrations/scene-retained-slots.sql'));const recorded=Number(await db.prepare('SELECT retired_at FROM scene_shares').first('retired_at'));assert.ok(recorded>=before-1000&&recorded<=Date.now());
  const response=await mf.dispatchFetch('https://localhost/fixture',{method:'POST',headers:{'content-type':'application/json','x-fixture-time':String(Date.now()+86400000),'x-fixture-retirement':'true'},body:JSON.stringify({action:'reclaim'})});assert.equal(response.status,200);assert.equal(await db.prepare('SELECT count(*) AS n FROM scene_shares').first('n'),1,'a leading Worker clock cannot shorten the database quarantine');
 }finally{await mf.dispose();}
});


test('collection removes legacy retired image rows even when new image access is disabled',async()=>{
 const f=await fixture();try{
  const p=await f.create();await f.bind(p);await f.call('revoke',{auth:p.auth});
  // Model a stale legacy child, never expose these synthetic bytes via a read.
  await f.db.prepare('INSERT INTO scene_references(share,epoch,consent,pixels) VALUES(?,?,?,?)').bind(p.auth.shareId,p.auth.epoch+1,'{}',new Uint8Array([1,2,3])).run();
  f.advance(quarantine);assert.equal((await f.call('reclaim',{},true,false)).status,200);assert.equal(await f.db.prepare('SELECT count(*) AS n FROM scene_references').first('n'),0);assert.equal(await f.db.prepare('SELECT id FROM scene_shares WHERE id=?').bind(p.auth.shareId).first(),null);f.noEgress();
 }finally{await f.mf.dispose();}
});

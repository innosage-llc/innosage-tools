// Offline targeted evidence checks; never starts a server or reruns a fixture.
import {readFileSync,readdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const read=p=>JSON.parse(readFileSync(resolve(here,p)));
const gz=p=>gunzipSync(readFileSync(resolve(here,p))).toString();
const frozen=read('freeze.json'),oracle=read('oracle.json');
assert.equal(sha(readFileSync(resolve(here,'run.mjs'))),frozen.harnessSha256);
assert.equal(sha(readFileSync(resolve(here,'oracle.json'))),frozen.oracleSha256);
for(const id of ['T10','T100','H100','setup-sandbox-denied-T10']){
 const receipt=read(`evidence/${id}/receipt.json`),packed=readFileSync(resolve(here,receipt.console.path)),raw=gunzipSync(packed);
 assert.equal(sha(packed),receipt.console.gzipSha256);assert.equal(sha(raw),receipt.console.originalSha256);
 assert.equal(raw.length,receipt.console.originalBytes);
 console.log(`PASS ${id}: console gzip restores exact original bytes ${receipt.console.originalSha256}`);
}
for(const id of ['T10','T100','H100']){
 const base=`evidence/${id}`,receipt=read(`${base}/receipt.json`),result=read(`${base}/result.json`);
 const raw=gz(`${base}/events.jsonl.gz`),events=raw.trim().split('\n').map(x=>JSON.parse(x));
 assert.equal(sha(raw),receipt.rawEventSha256);assert.equal(receipt.resultSha256,sha(readFileSync(resolve(here,`${base}/result.json`))));
 assert.equal(receipt.code,0);assert.equal(receipt.timedOut,false);assert(receipt.elapsedMs<180000);assert(receipt.admitted<=1000);
 assert.equal(receipt.sourceUnchanged,true);assert.equal(receipt.harnessSha256,frozen.harnessSha256);assert.equal(receipt.oracleSha256,frozen.oracleSha256);
 const before=JSON.parse(gz(`${base}/sources-pre.json.gz`)),after=JSON.parse(gz(`${base}/sources-post.json.gz`));
 assert.equal(before.length,24);assert.equal(after.length,before.length);
 for(let i=0;i<before.length;i++){assert.equal(sha(before[i].body),before[i].sha256);assert.equal(sha(after[i].body),after[i].sha256);assert.equal(before[i].sha256,after[i].sha256);}
 const admissions=events.filter(x=>x.type==='admit'),responses=events.filter(x=>x.type==='response');
 assert.equal(admissions.length,receipt.admitted);assert.equal(responses.length,receipt.observed);assert.equal(receipt.admitted,receipt.observed);
 assert.equal(new Set(admissions.map(x=>x.n)).size,admissions.length);
 const allowed=events.find(x=>x.type==='config').config.googleDrive.apiEndpoint;
 for(const a of admissions){assert.equal(new URL(a.url).origin,allowed);assert.equal(responses.filter(r=>r.n===a.n).length,1);}
 for(const r of responses){assert([200,412].includes(r.status));assert.equal(typeof r.body,'string');if(r.status===412){assert.equal(admissions.find(a=>a.n===r.n).method,'PUT');assert(r.url.includes('/upload/drive/v2/files/'));}}
 const phaseNames=readdirSync(resolve(here,base)).filter(x=>/^phase-\d+\.json(?:\.gz)?$/.test(x)).sort();
 const phases=phaseNames.map(n=>n.endsWith('.gz')?JSON.parse(gz(`${base}/${n}`)):read(`${base}/${n}`));
 for(const r of responses.filter(x=>x.status===412)){const f=phases.flatMap(p=>p.inventory).find(f=>r.url.includes(`/files/${f.id}?`));assert.equal(f.name,'transaction.json');}
 assert.equal(phases.length,result.phases.length);assert.equal(phases.at(-1).nativeRequests.length,receipt.admitted);
 for(const p of phases)for(const f of p.inventory){assert.equal(typeof f.rawBody,'string');assert(Array.isArray(f.parents));assert.equal(typeof f.visible,'boolean');}
 assert(events.some(x=>x.type==='cleanup-complete'));assert(!events.some(x=>['native-error','fetch-error','hard-stop'].includes(x.type)));
 const rounds=events.filter(x=>x.type==='round-complete');
 if(id!=='H100'){
   assert.equal(rounds.filter(x=>x.role==='receiver').length,2);
   assert.equal(result.comparison.actualCount,id==='T10'?16:30);
   assert.equal(result.status,id==='T10'?'FAIL':'PASS');
 }else{
   assert.equal(result.status,'FAIL');assert.deepEqual(result.restartComparison.mismatchedIds,['visibility0']);assert.deepEqual(result.initialCheckpointComparison.mismatchedIds,['visibility0']);
   assert.deepEqual(result.freshComparison.missingIds,[]);assert.deepEqual(result.freshComparison.mismatchedIds,[]);
   assert(result.oldRemote.modifiedTime<result.hiddenCheckpoint.modifiedTime);assert(result.hiddenLowerBounds.some(x=>x>result.oldRemote.modifiedTime));
   const receiver=phases.flatMap(p=>p.replicas.filter(r=>r.role==='receiver'));assert.equal(new Set(receiver.map(r=>r.name)).size,1);
   const fresh=phases.at(-1).replicas.find(r=>r.role==='fresh-diagnostic');assert.notEqual(fresh.name,receiver[0].name);
   const cp=phases.find(p=>p.phase==='same-id-initialCheckpoint-round2').replicas.find(r=>r.role==='receiver');assert.deepEqual(cp.config.pull.initialCheckpoint,oracle.initialCheckpoint);
   const restored=phases.find(p=>p.phase==='restored-before-restart').inventory.find(f=>f.id===result.oldRemote.id);
   assert.equal(restored.visible,true);
   assert.equal(restored.parsedDocument.body,oracle.cases.H100.latest[0].body);
   const hidden=phases.find(p=>p.phase==='hidden-old-round2').inventory.find(f=>f.id===result.oldRemote.id);
   assert.equal(hidden.visible,false);assert.equal(hidden.rawBody,restored.rawBody);assert.equal(hidden.modifiedTime,restored.modifiedTime);
   const freshEvents=events.filter(x=>x.requestPhase?.startsWith('fresh-diagnostic')&&x.type==='response');
   assert(freshEvents.some(x=>{try{return JSON.parse(x.body).body===oracle.cases.H100.latest[0].body;}catch{return false;}}));
 }
 console.log(`PASS ${id}: capture/source/caps/controls; actual criterion ${result.status}; ${receipt.admitted} admitted and observed`);
}

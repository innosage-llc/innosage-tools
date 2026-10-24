// Offline evidence audit. No servers, provider calls, or fixture reruns.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)),sha=x=>createHash('sha256').update(x).digest('hex');
const read=p=>JSON.parse(readFileSync(resolve(here,p))),gz=p=>gunzipSync(readFileSync(resolve(here,p)));
const oracle=read('oracle.json'),currentCases=readFileSync(resolve(here,'cases.mjs'),'utf8');
assert.equal(sha(readFileSync(resolve(here,'oracle.json'))),'e82d62f45c2aa04d9c751508168b3bb6f4c531e083bd292daa07446d6771e9b2');
const accepted=['S0_TRANSITION-a2','S1_PAGE_TRAVERSAL-a1','S2_BOOTSTRAP_PERSIST_BARRIER-a1','S3_READ_FAILURE_REPLAY-a1','S4_RETAINED_EVENT-a1','S4_NO_EVENT-a1','S5_LOST_RESPONSE_INTENT-a3'];
const branchStarts=[" if(id==='S0_TRANSITION')"," if(id==='S1_PAGE_TRAVERSAL')"," if(id==='S2_BOOTSTRAP_PERSIST_BARRIER')"," if(id==='S3_READ_FAILURE_REPLAY')"," if(id==='S4_RETAINED_EVENT'||id==='S4_NO_EVENT')"," if(id==='S5_LOST_RESPONSE_INTENT')"];
function slice(src,id){const marker=branchStarts.find(s=>s.includes("'"+id+"'"));assert(marker);const start=src.indexOf(marker);assert(start>=0);const next=branchStarts.map(m=>src.indexOf(m)).filter(n=>n>start).sort((a,b)=>a-b)[0]??src.indexOf(" throw new Error('Unknown case')");return src.slice(start,next);}
const audited=[];
for(const name of readdirSync(resolve(here,'evidence')).sort()){
 const base='evidence/'+name,r=read(base+'/receipt.json'),result=read(base+'/result.json'),raw=gz(base+'/events.jsonl.gz');
 assert.equal(sha(raw),r.rawEventSha256);assert.equal(sha(readFileSync(resolve(here,base+'/result.json'))),r.resultSha256);
 const consoleBytes=readFileSync(resolve(here,base+'/console.txt.gz'));assert.equal(sha(consoleBytes),r.console.gzipSha256);assert.equal(sha(gunzipSync(consoleBytes)),r.console.originalSha256);
 const before=JSON.parse(gz(base+'/sources-pre.json.gz')),after=JSON.parse(gz(base+'/sources-post.json.gz')),frozen=read(`freeze-v${r.freezeVersion}.json`);
 assert.equal(before.length,46);assert.equal(before.length,after.length);assert(r.sourceUnchanged);
 for(let i=0;i<before.length;i++){assert.equal(sha(before[i].body),before[i].sha256);assert.equal(sha(after[i].body),after[i].sha256);assert.equal(before[i].sha256,after[i].sha256);assert.equal(before[i].sha256,frozen.sourceHashes[i].sha256);}
 const events=raw.toString().trim().split('\n').filter(Boolean).map(JSON.parse),admit=events.filter(x=>x.type==='admit'),dispatch=events.filter(x=>x.type==='dispatch'),responses=events.filter(x=>x.type==='response'),errors=events.filter(x=>x.type==='fetch-error');
 assert.equal(admit.length,r.admitted);assert.equal(dispatch.length,r.dispatched);assert.equal(responses.length,r.observed);assert.equal(errors.length,r.fetchErrors);assert(r.admitted<=1000);assert(r.elapsedMs<180000);assert(!r.timedOut);
 assert.equal(new Set(admit.map(x=>x.n)).size,admit.length);const origin=new URL(admit[0].url).origin;
 for(const a of admit){assert.equal(new URL(a.url).origin,origin);assert.equal(new URL(a.url).hostname,'127.0.0.1');assert.equal(dispatch.filter(x=>x.n===a.n).length,1);assert.equal(responses.filter(x=>x.n===a.n).length+errors.filter(x=>x.n===a.n).length,1);}
 for(const response of responses){const value=JSON.parse(response.body||'null'),a=admit.find(x=>x.n===response.n);if(value?.changes){assert(value.changes.length<=Number(a.query.pageSize));if(value.nextPageToken)assert.equal(value.newStartPageToken,undefined);else assert(value.newStartPageToken);}}
 const phases=readdirSync(resolve(here,base)).filter(x=>/^phase-\d+\.json.gz$/.test(x)).sort().map(n=>({path:base+'/'+n,...JSON.parse(gz(base+'/'+n))}));
 if(result.snapshots!==undefined)assert.equal(phases.length,result.snapshots);
 if(accepted.includes(name)){
  assert.equal(r.code,0);assert(events.some(x=>x.type==='cleanup-complete'));assert(!events.some(x=>x.type==='hard-stop'||x.type==='capture-error'||x.type==='case-error'));
  assert.equal(phases.at(-1).nativeRequests.length,r.dispatched,'one real shared-server request per dispatched fetch');
  const oldCase=before.find(x=>x.label==='changes-feasibility/cases.mjs');assert.equal(slice(currentCases,r.id),slice(oldCase.body,r.id),'executed case branch unchanged in current source');assert.equal(currentCases.slice(0,currentCases.indexOf(branchStarts[0])),oldCase.body.slice(0,oldCase.body.indexOf(branchStarts[0])),'shared helpers unchanged');
  for(const x of before.filter(x=>x.label.startsWith('changes-feasibility/')&&x.label!=='changes-feasibility/cases.mjs'))assert.equal(sha(readFileSync(resolve(here,'..',x.path))),x.sha256,'all other current executed implementation bindings unchanged');
  const phase=label=>{const p=phases.find(p=>p.phase===label);assert(p,label);return p;};
  const a=p=>p.stores.find(s=>s.role==='a');const doc=(s,id)=>s.pages.find(x=>x.id===id);const payload=d=>({id:d.id,body:d.body,editId:d.editId});
  if(r.id==='S0_TRANSITION'){
   const pre=phase('before-transition'),post=phase('transition-restarted'),old=pre.inventory.find(f=>f.name==='discovery-old.json');assert(old.visible);assert(old.modifiedTime<a(pre).checkpoint.modifiedTime);assert.equal(doc(a(pre),'discovery-old').body,oracle.bodies.A);assert.equal(old.parsedDocument.body,oracle.bodies.C);assert.equal(doc(a(post),'discovery-old').body,oracle.bodies.C);assert.deepEqual(a(pre).identity,a(post).identity);
   for(const e of oracle.document_contract.ties)assert.deepEqual(payload(doc(a(post),e.id)),e);
   const d=a(post).journals.find(d=>d.page==='page');assert.equal(d.draft.body,oracle.bodies.D);assert.equal(d.sourceLocal.body,oracle.bodies.B);assert.equal(d.sourceCloud.body,oracle.bodies.C);assert.equal(doc(a(post),'page').body,oracle.bodies.E);assert(!admit.some(x=>x.requestBody?.includes(d.draft.editId)));
  }else if(r.id==='S1_PAGE_TRAVERSAL'){
   const script=responses.filter(x=>{try{return new URL(x.url).pathname==='/drive/v3/changes'&&JSON.parse(x.body).nextPageToken?.startsWith('script-');}catch{return false;}});assert(script.some(x=>JSON.parse(x.body).changes.length===0),'empty intermediate page actually exercised');assert.equal(result.emptyTailDurableAdvanced,false);assert.deepEqual(result.emptyTailCheckpointBefore,result.emptyTailCheckpointAfter);assert.equal(doc(a(phase('after-empty-real-change')),'p4').body,'# Page 4\n\nLater real change.');
  }else if(r.id==='S2_BOOTSTRAP_PERSIST_BARRIER'){
   const paused=phase('actual-native-persistence-paused'),afterRelease=phase('native-persistence-released');assert(events.some(x=>x.type==='fixture-storage-write-paused'));assert(!a(paused).physicalPages.some(d=>d.id==='b0'&&d.editId==='bootstrap-race'));assert(!a(paused).metadata.some(d=>d.id==='b0|0'&&d.docData.editId==='bootstrap-race'));
   const covers=cp=>cp?.changes109?.phase==='changes'&&Number(cp.changes109.token.slice(7))>result.targetEventPosition;assert(!covers(a(paused).checkpoint));assert(covers(result.handlerReturnedCheckpoint));assert(covers(a(afterRelease).checkpoint));assert.equal(result.durableBody.body,'# Bootstrap 0\n\nAfter inventory page read.');assert.equal(result.durableAssumed.docData.body,result.durableBody.body);
  }else if(r.id==='S3_READ_FAILURE_REPLAY'){
   const failure=phase('content-failure-before-retry');assert.deepEqual(a(failure).checkpoint,result.beforeCheckpoint);assert(!a(failure).physicalPages.some(d=>d.id==='read1'));assert(responses.some(x=>x.status===503));assert.equal(doc(a(phase('content-failure-replayed')),'read1').body,'# Read one');
  }else if(r.id==='S4_RETAINED_EVENT'){
   assert(result.retainedOld>=result.feedStart);assert(result.retainedNew>result.retainedOld);assert(result.oldModifiedTime<result.newModifiedTime);assert.equal(result.actual.body,oracle.bodies.C);assert.equal(result.newActual.body,oracle.bodies.E);assert.equal(result.actual.editId,'old-latest');assert.equal(result.newActual.editId,'new-latest');
  }else if(r.id==='S4_NO_EVENT'){
   assert.equal(r.status,'BOUNDARY_FAIL_RECOVERY_NOT_PROVEN');assert.equal(result.actual.body,oracle.bodies.A);assert.equal(result.sourceLatest.body,oracle.bodies.C);const start=events.find(x=>x.type==='bootstrap-start-token'),final=phase('retention-final'),old=final.inventory.find(x=>x.name==='discovery-old.json');assert(!final.feed.changes.slice(Number(start.token.slice(7))).some(x=>x.fileId===old.id));
  }else if(r.id==='S5_LOST_RESPONSE_INTENT'){
   const uncertain=phase('successful-wal-mutation-response-lost'),newer=phase('newer-generation-ack-during-network-wait'),guard=phase('newer-before-cleanup-retained'),race=phase('e-race-master-wins-protected'),discard=phase('owned-discard-unrelated-retained');
   const uncertainDraft=a(uncertain).journals.find(x=>x.page==='page'),newerDraft=a(newer).journals.find(x=>x.page==='page');assert.equal(uncertainDraft.draft.body,oracle.bodies.M);assert(!a(uncertain).views.some(v=>v.status==='remote-verified'));assert(newerDraft.seq>uncertainDraft.seq);assert.equal(newerDraft.draft.body,oracle.bodies.D+'\n\nNew generation during uncertainty.');assert(result.fault.matched.mutation_applied);assert(!result.fault.matched.response_delivered);assert.equal(errors.length,1);
   assert.equal(a(guard).journals.find(x=>x.page==='page').draft.editId,'newer-before-cleanup');const d=a(race).journals.find(x=>x.page==='page');assert.equal(d.draft.body,oracle.bodies.M);assert.equal(d.sourceLocal.body,oracle.bodies.B);assert.equal(d.sourceCloud.body,oracle.bodies.C);assert.equal(d.remote.body,oracle.bodies.E);assert.equal(doc(a(race),'page').body,oracle.bodies.E);assert(!a(discard).journals.some(x=>x.page==='page'));assert(a(discard).journals.some(x=>x.page==='unrelated'));
  }
 }else if(name==='S5_LOST_RESPONSE_INTENT-a2'){assert.equal(r.status,'PASS');assert.equal(r.code,0);assert(!phases.some(p=>p.phase==='e-race-master-wins-protected'),'a2 capture gap preserved; use a3 for full raw proof');}
 else{assert.equal(r.status,'INCONCLUSIVE');assert.equal(r.code,2);if(name==='S0_TRANSITION-a1'){assert.equal(r.admitted,1000);assert(events.some(x=>x.type==='hard-stop'));}if(name==='S5_LOST_RESPONSE_INTENT-a1')assert(events.some(x=>x.type==='case-error'));}
 audited.push({attempt:name,status:r.status,admitted:r.admitted,dispatched:r.dispatched,observed:r.observed,fetchErrors:r.fetchErrors,elapsedMs:r.elapsedMs,freeze:r.freezeVersion,receiptSha256:sha(readFileSync(resolve(here,base+'/receipt.json'))),resultSha256:r.resultSha256,currentCaseAndSharedHelpersIdentical:accepted.includes(name),historicalOnly:!accepted.includes(name)});
 console.log(`PASS archive audit ${name}: actual outcome ${r.status}, ${r.admitted} requests`);
}
writeFileSync(resolve(here,'audit-report.json'),JSON.stringify({status:'PASS',oracleSha256:sha(readFileSync(resolve(here,'oracle.json'))),currentCasesSha256:sha(currentCases),claim:'Archives checked against each actual freeze. Accepted cases retain byte-identical branch/shared helpers in current source; historical failed/capture-incomplete attempts remain separate.',audited},null,2)+'\n');

import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {fixtures} from './fixtures.mjs';
const names=['results','fault-results','browser-results','ui-results','crash-results',
 'leader-results','hidden-checkpoint','measurements','overlay-measurements'];
const raw={};for(const name of names)raw[name]=JSON.parse(await readFile(`native-overlay/.generated/${name}.json`));
const store=raw.results;
const allPass=list=>list.length>0&&list.every(x=>x.status==='PASS'||x.store_status==='PASS');
const browser=raw['browser-results'].evidence;
const ui=raw['ui-results'].evidence;
const idPass=(list,id)=>allPass(list.filter(x=>x.id===id));
const references={
 F01:['results:F01','browser-results:F11/after-local-ack'],
 F02:['results:F02'],F03:['results:F03','ui-results:F03','crash-results:F11'],
 F04:['results:F04','ui-results:F04'],F05:['results:F05','ui-results:F05'],
 F06:['results:F06','ui-results:F06'],F07:['results:F07','ui-results:F07'],
 F08:['results:F08','ui-results:F08','crash-results:F11'],F09:['results:F09','ui-results:F09'],
 F10:['fault-results:F10'],F11:['browser-results:F11','crash-results:F11'],
 F12:['browser-results:F12','ui-results:F12'],F13:['browser-results:F13','ui-results:F13'],
 F14:['browser-results:F14','ui-results:F14','leader-results:F14'],
 F15:['browser-results:F15'],F16:['results:F16','hidden-checkpoint:F16'],
 F17:['measurements:F17','overlay-measurements:F17']};
const matrix=fixtures.map(f=>{
 let pass=false;
 const own=store.results.find(x=>x.id===f.id);
 if(Number(f.id.slice(1))<=9)pass=own?.status==='PASS';
 if(['F03','F04','F05','F06','F07','F08','F09'].includes(f.id))pass&&=idPass(ui,f.id);
 if(f.id==='F10')pass=allPass(raw['fault-results'].evidence);
 if(f.id==='F11')pass=idPass(browser,'F11')&&allPass(raw['crash-results'].evidence);
 if(['F12','F13'].includes(f.id))pass=idPass(browser,f.id)&&idPass(ui,f.id);
 if(f.id==='F14')pass=idPass(browser,f.id)&&idPass(ui,f.id)&&allPass(raw['leader-results'].evidence);
 if(f.id==='F15')pass=idPass(browser,f.id);
 if(f.id==='F16')pass=own?.evidence?.actual===30&&raw['hidden-checkpoint'].gate==='PASS';
 if(f.id==='F17')pass=allPass(raw.measurements.results)&&allPass(raw['overlay-measurements'].evidence);
 return {id:f.id,scenario:f.scenario,status:pass?'PASS':'FAIL',evidence:references[f.id],
  replay:f.id==='F16'?'node native-overlay/run.mjs --fixture=F16 && node native-overlay/checkpoint.mjs':
  f.id==='F17'?'node native-overlay/measure.mjs && node native-overlay/measure-overlay.mjs':f.id==='F10'?'node native-overlay/faults.mjs':f.id==='F11'?'node native-overlay/browser.mjs && node native-overlay/crash-browser.mjs':
  ['F12','F13','F14','F15'].includes(f.id)?'node native-overlay/browser.mjs && node native-overlay/ui-browser.mjs && node native-overlay/leader-browser.mjs':f.replay};
});
const seeds=store.seedResults??[];
const appPass=matrix.filter(x=>Number(x.id.slice(1))<=15).every(x=>x.status==='PASS')&&
 seeds.length===100&&allPass(seeds);
const checkpoint=matrix.find(x=>x.id==='F16').status;
const verdict=appPass?(checkpoint==='PASS'?'NATIVE UX SPIKE PASS; REAL PROVIDER NOT RUN':'NATIVE UX SPIKE PASS; HOLD FOR CHECKPOINT'):
 'NO SAFE OUTCOME — incomplete or failed app fixtures';
const hashes={};
for(const name of (await readdir('native-overlay')).sort())if(/\.(mjs|html)$/.test(name))
 hashes[`native-overlay/${name}`]=createHash('sha256').update(await readFile(`native-overlay/${name}`)).digest('hex');
for(const file of ['package-lock.json','src/mock.mjs','node_modules/rxdb/src/replication-protocol/default-conflict-handler.ts',
 'node_modules/rxdb/src/plugins/replication-google-drive/downstream.ts','node_modules/rxdb/src/plugins/replication-google-drive/upstream.ts'])
 hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const digest=createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
const report={master:'https://github.com/innosage-llc/innosage-tools/issues/102',master_state:'OPEN',
 verdict,source_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source_hashes:hashes,source_digest:digest,
 runtime:process.version,browser:raw['ui-results'].browser,rxdb:'17.6.0',label:'MOCK-TESTED',real_provider:'REAL-PROVIDER-NOT-RUN',
 counted_store_acknowledgements:[...store.results,...seeds].reduce((n,r)=>n+(r.acknowledged?.length??0),0),
 seed_summary:{requested:100,executed:seeds.length,passed:seeds.filter(x=>x.status==='PASS').length,
  scope:'Seeded native conflict edits, remote invalidations, same-process reopen and resolution races; real browser crashes/tabs separately bounded'},
 numeric_safety_gates:appPass?{silent_lost_acknowledged_edits:0,false_remote_synced:0,
  irreversible_lost_conflict_versions:0,journal_clobbers:0,unauthorized_workspace_tab_effects:0,
  applicability:'Zero violations of executed complete-body fixture assertions, not proof of all distributed schedules'}:null,
 matrix,checkpoint:{same_time:store.results.find(x=>x.id==='F16').evidence,hidden_listing:{
  gate:raw['hidden-checkpoint'].gate,expected:raw['hidden-checkpoint'].expected_older,actual:raw['hidden-checkpoint'].actual_older}},
 measurements:{native_baseline:raw.measurements.distributions,overlay:raw['overlay-measurements'].distributions,
  caveat:'n=3 per scale, synthetic loopback only. Local foreground projection precedes cloud settle; native network cursor order is unchanged. No provider performance winner.'},
 limitations:['Published native checkpoint discovery remains unsafe for shipping-quality Google Drive sync.',
 'No real provider, OAuth, deployment, private content or Draft changes.',
 'Stale duplicate success can leave native metadata ahead of remote; journal is retained instead of claiming convergence.',
 'Graceful native cancellation can stall during active writes; actual tab closure/handoff is tested separately.'],
 replay:'npm run test:byos-native-overlay:full',raw_evidence:'raw-evidence.json.gz'};
await writeFile('native-overlay/.generated/report.json',JSON.stringify(report,null,2)+'\n');
await writeFile('native-overlay/.generated/raw-evidence.json.gz',gzipSync(Buffer.from(JSON.stringify(raw))));
let md=`# Native RxDB overlay scorecard\n\n**${verdict}**\n\nMOCK-TESTED; REAL-PROVIDER-NOT-RUN. Master remains OPEN.\n\nSource: \`${report.source_sha}\`; fixture/source digest \`${digest}\`.\nRuntime ${report.runtime}; Chromium ${report.browser}; RxDB17.6.0.\n\n| AC | Result | Executable evidence |\n| --- | --- | --- |\n`;
for(const row of matrix)md+=`| ${row.id} | ${row.status} | ${row.evidence.join('; ')} |\n`;
md+=`\nSeeds: ${report.seed_summary.passed}/${seeds.length} passed. Complete bodies are checked in journal, chosen view, native pages, mock remote and recovery.\n\nCheckpoint: 30 remote documents; cold replica ${report.checkpoint.same_time.actual}/30. Hidden older edit remains undiscovered after visibility returns. No native patch/fallback.\n\nOne offline replay: \`npm run test:byos-native-overlay:full\`. JSON report and compressed raw request/fault ledger accompany this scorecard.\n\nSynthetic measurements (n=3 each scale):\n\n| Pages | Overlay p50 settle ms | Overlay p95 settle ms |\n| --- | --- | --- |\n`;
for(const r of report.measurements.overlay)md+=`| ${r.scale} | ${r.p50_settle_ms.toFixed(1)} | ${r.p95_settle_ms.toFixed(1)} |\n`;
md+='\nForeground local rendering is separate from cloud settle; native network checkpoint ordering is unchanged. These are not Google timings. Founder final acceptance, deployment and product adoption are not granted by this report.\n';
await writeFile('native-overlay/.generated/SCORECARD.md',md);
console.log(verdict,`${seeds.length} seeds`,digest);
assert.equal(appPass,true,'App-layer P0 matrix or 100-seed requirement failed');

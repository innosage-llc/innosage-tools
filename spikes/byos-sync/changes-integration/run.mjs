import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync,readdirSync,openSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,relative} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)),spike=resolve(here,'..'),product=resolve(spike,'../..'),hub=resolve(product,'../..');
const sha=b=>createHash('sha256').update(b).digest('hex'),json=x=>JSON.stringify(x,null,2)+'\n';
const oraclePath=resolve(hub,'docs/sessions/20261025-tools-111-integration/master-team-v4/oracle-v1.json');
const oracleSha='8a18ea549ca412a303d3b0aee84aa7846bc0ee1107cd69328d7252c52f1b407c';
export function admit(url,allowed,count,reserve=1){const u=new URL(url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||!allowed.includes(u.origin))throw new Error('NON_LOOPBACK_BLOCKED '+u.origin);if(count+reserve>1000)throw new Error('REQUEST_CAP_BEFORE_DISPATCH');return count+reserve;}
function snapshot(){const binding=JSON.parse(readFileSync(resolve(here,'binding.json')));return binding.inputs.map(path=>{const body=readFileSync(resolve(spike,path));return {path,sha256:sha(body),body:body.toString()};});}
function frozen(){return JSON.parse(readFileSync(resolve(here,readdirSync(here).filter(x=>/^freeze-v\d+\.json$/.test(x)).sort().at(-1))));}
async function freeze(){
 assert.equal(sha(readFileSync(oraclePath)),oracleSha);mkdirSync(resolve(here,'.generated'),{recursive:true});
 const {build}=await import('esbuild');const entry=resolve(spike,'native-overlay/page-store.mjs'),wrapper=resolve(here,'factory.mjs');
 const plugin={name:'only-pagestore-drive-factory',setup(b){b.onResolve({filter:/^rxdb\/plugins\/replication-google-drive$/},a=>a.importer===entry?{path:wrapper}:undefined);}};
 const node=await build({entryPoints:[resolve(here,'runtime.mjs')],bundle:true,platform:'node',packages:'external',format:'cjs',outfile:resolve(here,'.generated/runtime.cjs'),metafile:true,plugins:[plugin]});
 const browser=await build({entryPoints:[resolve(here,'browser-entry.mjs')],bundle:true,platform:'browser',format:'esm',target:'es2022',define:{global:'globalThis'},outfile:resolve(here,'.generated/ui.js'),metafile:true,plugins:[plugin]});
 for(const output of [node,browser])assert(Object.keys(output.metafile.inputs).some(x=>x.endsWith('changes-integration/factory.mjs')));
 const original=readFileSync(resolve(spike,'src/mock.mjs'),'utf8');
 const sig='sameTime = false,\n} = {}) {',anchor='    const match = u.pathname.match(';
 assert.equal(original.split(sig).length,2);assert.equal(original.split(anchor).length,2);
 const extended=original.replace(sig,'sameTime = false,\n  extension = async () => false,\n} = {}) {').replace(anchor,'    if (await extension({req,res,u,body,files,create,control,finish,entry,meta})) return;\n'+anchor);
 writeFileSync(resolve(here,'.generated/mock.mjs'),extended);
 const require=createRequire(import.meta.url);require('./.generated/runtime.cjs');
 const sourceInputs=[...new Set([...Object.keys(browser.metafile.inputs),...Object.keys(node.metafile.inputs)].filter(x=>!x.startsWith('(disabled):')).map(x=>relative(spike,resolve(x))).concat(Object.keys(require.cache).filter(x=>x.startsWith(spike+'/node_modules/')).map(x=>relative(spike,x))))];
 const owned=readdirSync(here).filter(x=>/\.(mjs|json)$/.test(x)&&!x.startsWith('freeze-')&&!['binding.json','report.json'].includes(x)).map(x=>'changes-integration/'+x);
 const inputs=[...new Set([...sourceInputs,...owned,'native-overlay/index.html','src/mock.mjs','changes-feasibility/provider.mjs','native-overlay/fixtures.mjs','package.json','package-lock.json','changes-integration/.generated/mock.mjs','changes-integration/.generated/runtime.cjs','changes-integration/.generated/ui.js',relative(spike,oraclePath)])].sort();
 const binding={protocol:'tools111-factory-binding-v1',pageStoreSha256:sha(readFileSync(entry)),adapterSha256:sha(readFileSync(resolve(spike,'changes-feasibility/adapter.mjs'))),factorySha256:sha(readFileSync(wrapper)),node, browser,inputs,scope:'Only PageStore replication-google-drive import is redirected. Same public native helpers, exact PageStore save/resolve/verify, unchanged UI/controller; one adapter source Node/browser. Fixture-only mock extension identical to #109 two-anchor generation; original source unmodified.'};
 writeFileSync(resolve(here,'binding.json'),json(binding));
 const sources=snapshot();sources.push({path:'changes-integration/binding.json',sha256:sha(readFileSync(resolve(here,'binding.json'))),body:readFileSync(resolve(here,'binding.json'),'utf8')});
 const version=String(readdirSync(here).filter(x=>/^freeze-v\d+\.json$/.test(x)).length+1).padStart(3,'0'),archive=`sources-v${version}.json.gz`;
 writeFileSync(resolve(here,archive),gzipSync(json(sources)));
 const receipt={version,at:new Date().toISOString(),oracleSha256:oracleSha,fixtureSha256:sha(readFileSync(resolve(here,'fixture.json'))),sourceHashes:sources.map(({path,sha256})=>({path,sha256})),archive,archiveSha256:sha(readFileSync(resolve(here,archive))),requested:'gpt-6.1-sol/high',hostRouted:'UNKNOWN',providerObserved:'UNKNOWN',usageCost:'UNKNOWN'};
 writeFileSync(resolve(here,`freeze-v${version}.json`),json(receipt));console.log(json({version,sourceEntries:sources.length,archiveSha256:receipt.archiveSha256,oracleSha}));
}
async function parent(id,attempt){
 assert(/^[a-z0-9-]+$/.test(attempt));const start=performance.now(),at=new Date().toISOString();
 const dir=resolve(here,'evidence',id+'-'+attempt);assert(!existsSync(dir),'Preserve attempts; choose new label');mkdirSync(dir,{recursive:true});
 const freeze=frozen(),pre=snapshot();pre.push({path:'changes-integration/binding.json',sha256:sha(readFileSync(resolve(here,'binding.json'))),body:readFileSync(resolve(here,'binding.json'),'utf8')});
 assert.deepEqual(pre.map(({path,sha256})=>({path,sha256})),freeze.sourceHashes,'Freeze changed bytes before execution');
 writeFileSync(resolve(dir,'sources-pre.json.gz'),gzipSync(json(pre)));
 const fd=openSync(resolve(dir,'console.txt'),'wx');const proc=spawn(process.execPath,[resolve(here,'execute.mjs'),id,dir],{cwd:spike,stdio:['ignore',fd,fd],detached:true});let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;try{process.kill(-proc.pid,'SIGKILL');}catch{}},Math.max(1,179000-(performance.now()-start)));
 const outcome=await new Promise(r=>{proc.once('error',error=>r({error:String(error)}));proc.once('exit',(code,signal)=>r({code,signal}));});clearTimeout(timer);closeSync(fd);
 const post=snapshot();post.push({path:'changes-integration/binding.json',sha256:sha(readFileSync(resolve(here,'binding.json'))),body:readFileSync(resolve(here,'binding.json'),'utf8')});
 const sourceUnchanged=pre.every((x,i)=>x.sha256===post[i].sha256);writeFileSync(resolve(dir,'sources-post.json.gz'),gzipSync(json(post)));
 const result=existsSync(resolve(dir,'result.json'))?JSON.parse(readFileSync(resolve(dir,'result.json'))):null;
 const events=existsSync(resolve(dir,'events.jsonl'))?readFileSync(resolve(dir,'events.jsonl')):Buffer.alloc(0);writeFileSync(resolve(dir,'events.jsonl.gz'),gzipSync(events));
 const receipt={id,attempt,startedAt:at,elapsedMs:performance.now()-start,...outcome,timedOut,sourceUnchanged,limits:{requests:1000,wallMs:180000},watchdog:'External parent 179s from invocation start, including source/setup; SIGKILL only detached task-owned child process group. No storage deletion.',freezeVersion:freeze.version,oracleSha256:oracleSha,sourceHashes:freeze.sourceHashes,rawEventSha256:sha(events),resultSha256:result?sha(readFileSync(resolve(dir,'result.json'))):null,baseHead:execFileSync('git',['rev-parse','HEAD'],{cwd:product,encoding:'utf8'}).trim(),status:timedOut||!sourceUnchanged||!result||outcome.code!==0?'INCONCLUSIVE':result.status,result,requested:'gpt-6.1-sol/high',hostRouted:'UNKNOWN',providerObserved:'UNKNOWN',usageCost:'UNKNOWN'};
 writeFileSync(resolve(dir,'receipt.json'),json(receipt));console.log(json({id,attempt,status:receipt.status,elapsedMs:receipt.elapsedMs,result,outcome}));if(receipt.status!=='PASS')process.exitCode=2;
}
const mode=resolve(process.argv[1])===fileURLToPath(import.meta.url)?process.argv[2]:'import';
if(mode==='import'){}
else if(mode==='--freeze')await freeze();
else if(mode==='--self-check'){assert.equal(admit('http://127.0.0.1:1/x',['http://127.0.0.1:1'],999),1000);assert.throws(()=>admit('http://127.0.0.1:1/x',['http://127.0.0.1:1'],1000),/REQUEST_CAP/);assert.throws(()=>admit('https://example.com',[],0),/NON_LOOPBACK/);console.log('PASS strict predispatch origin and cap guards');}
else if(['I1','I2','I3_CRASH','I3_TABS'].includes(mode))await parent(mode,process.argv[3]??'a1');
else throw new Error('Use --freeze | --self-check | I1 | I2 | I3_CRASH | I3_TABS [attempt]');

import {build} from 'esbuild';
import {chromium} from 'playwright';
import http from 'node:http';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
await mkdir('native-overlay/.generated',{recursive:true});
await build({entryPoints:['native-overlay/browser-entry.mjs'],bundle:true,
 outfile:'native-overlay/.generated/browser.js',platform:'browser',format:'iife',define:{global:'globalThis'}});
const bundle=await readFile('native-overlay/.generated/browser.js');
const server=http.createServer((req,res)=>{
 res.setHeader('Content-Type',req.url==='/bundle.js'?'application/javascript':'text/html');
 res.end(req.url==='/bundle.js'?bundle:'<!doctype html><title>Native overlay store fixture</title><script src="/bundle.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const evidence=[];
const context=async(noBroadcast=false,noLocks=false)=>{
 const c=await browser.newContext();
 await c.route('**/*',r=>new URL(r.request().url()).origin===url?r.continue():r.abort());
 if(noBroadcast)await c.addInitScript(()=>{delete window.BroadcastChannel;});
 if(noLocks)await c.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined}));
 return c;
};
const open=async(c,workspace,session)=>{
 const p=await c.newPage();await p.goto(url);
 await p.evaluate(opts=>window.openTest(opts),{workspace,session});return p;
};
const view=p=>p.evaluate(()=>window.store.view('page'));
const save=(p,body)=>p.evaluate(body=>window.store.save('page',body),body);
const until=async(fn,message)=>{
 const start=Date.now();while(Date.now()-start<8000){if(await fn())return;
  await new Promise(r=>setTimeout(r,25));}throw new Error(message);
};
const crash=async(c,p)=>{
 const session=await c.newCDPSession(p);
 await Promise.race([session.send('Page.crash').catch(()=>{}),new Promise(r=>p.once('crash',r))]);
 await p.close().catch(()=>{});
};
try{
 const c=await context();const workspace='tabs'+crypto.randomUUID().replaceAll('-','');
 const a=await open(c,workspace,'a'),b=await open(c,workspace,'b');
 await save(a,'# A\n\nClean refresh exact body.');
 await until(async()=>(await view(b)).body==='# A\n\nClean refresh exact body.','clean tab did not refresh');
 assert.equal((await view(b)).warning,false);
 evidence.push({id:'F12',store_status:'PASS',ui_status:'NOT_RUN',view:await view(b)});
 await save(b,'# B\n\nIndependent dirty tab B.');
 await save(a,'# A2\n\nIndependent dirty tab A.');
 await until(async()=>(await view(b)).warning,'dirty tab warning absent');
 assert.equal((await view(b)).body,'# B\n\nIndependent dirty tab B.');
 const both=await view(b);assert.equal(both.drafts.length,2);
 evidence.push({id:'F13',store_status:'PASS',ui_status:'NOT_RUN',view:both});
 await a.evaluate(()=>window.store.close());await a.close();
 const again=await open(c,workspace,'a');
 assert.equal((await view(again)).body,'# A2\n\nIndependent dirty tab A.');
 assert.equal((await view(b)).body,'# B\n\nIndependent dirty tab B.');
 // A duplicated session identity must fail closed rather than share a draft key.
 const duplicate=await open(c,workspace,'b');
 assert.equal((await view(duplicate)).writer,false);
 await assert.rejects(()=>save(duplicate,'clobber'),/Writer disabled/);
 await assert.rejects(()=>duplicate.evaluate(()=>window.store.verify('page')),/Writer disabled/);
 evidence.push({id:'F14',store_status:'PASS',native_leader_handoff:'NOT_RUN',
  ui_status:'NOT_RUN',same_session_duplicate:'writer disabled',view:await view(again)});
 const other=await open(c,workspace+'other','b');
 assert.equal((await view(other)).body,'');
 await save(other,'# Foreign workspace body');
 assert.equal((await view(b)).body,'# B\n\nIndependent dirty tab B.');
 assert.equal((await view(other)).body,'# Foreign workspace body');
 await c.close();
 for(const noLocks of [false,true]){
  const fallback=await context(true,noLocks),scope='fallback'+crypto.randomUUID().replaceAll('-','');
  const p=await open(fallback,scope,'a'),q=await open(fallback,scope,'b');
  if(noLocks){assert.equal((await view(p)).writer,false);
   await assert.rejects(()=>save(p,'unsafe'),/Writer disabled/);
  }else{
   await save(p,'# Native fallback\n\nNo window.BroadcastChannel.');
   await until(async()=>(await view(q)).body.includes('No window.BroadcastChannel.'),'native fallback failed');
   assert.equal((await view(q)).warning,false);
  }
  evidence.push({id:'F15',store_status:'PASS',noBroadcast:true,noLocks,
   behavior:noLocks?'write disabled':'native RxDB fallback reactive refresh',view:await view(q)});
  await fallback.close();
 }
 for(const boundary of ['journal-committed','page-written','after-local-ack']){
  const c=await context(),workspace='crash'+crypto.randomUUID().replaceAll('-','');
  let p=await open(c,workspace,'a');
  const expected=`# Crash ${boundary}\n\nComplete native IndexedDB protected intent.`;
  if(boundary!=='after-local-ack')await p.evaluate(b=>{window.holdBoundary=b;},boundary);
  const pending=save(p,expected).catch(()=>{});
  if(boundary==='after-local-ack')await pending;
  else await until(()=>p.evaluate(b=>window.boundaries.some(x=>x.boundary===b),boundary),'boundary not hit');
  const before=await view(p);assert.equal(before.journal.draft.body,expected);
  await crash(c,p);p=await open(c,workspace,'a');
  const after=await view(p);assert.equal(after.body,expected);assert.equal(after.journal.draft.body,expected);
  assert.notEqual(after.status,'remote-verified');
  evidence.push({id:'F11',boundary,store_status:'PASS',remote_boundaries:'NOT_RUN',before,after});
  await c.close();
 }
} catch(error){evidence.push({status:'FAIL',error:error.stack});process.exitCode=1;}
finally{
 await writeFile('native-overlay/.generated/browser-results.json',JSON.stringify({
 browser:browser.version(),environment:'native Chromium IndexedDB; store API only',
 ui_status:'NOT_RUN — canonical UI route blocked',mock_only:true,evidence},null,2)+'\n');
 console.log(evidence.map(x=>`${x.id??'ERROR'} ${x.store_status??x.status} ${x.boundary??''}`).join('\n'));
 await browser.close();await new Promise(r=>server.close(r));
}

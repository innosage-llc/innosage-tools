import {chromium} from 'playwright';
import {mock} from '../src/mock.mjs';
import {uiServer} from './ui-server.mjs';
import {bodies as T} from './fixtures.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const server=await uiServer(),browser=await chromium.launch({headless:true}),evidence=[];
try{
 for(const boundary of ['resolution-journal','resolution-written','remote-read','before-cleanup','after-cleanup']){
  const m=await mock(),scope='cr'+crypto.randomUUID().replaceAll('-','');
  const contexts=[await browser.newContext(),await browser.newContext()];
  const open=async(index)=>{
   const c=contexts[index];await c.route('**/*',r=>[server.url,m.url].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
   const p=await c.newPage();await p.goto(`${server.url}/?workspace=${scope}&session=${index?'b':'a'}`);
   await p.waitForFunction(()=>window.spike?.ready);return p;
  };
  let a,b;
  const connect=p=>p.evaluate(url=>window.spike.store.connect(url,{live:false,transactionTimeout:50,retryTime:1000}),m.url);
  const save=(p,body)=>p.evaluate(body=>window.spike.store.save('page',body),body);
  const sync=p=>p.evaluate(()=>window.spike.store.sync());
  const verify=p=>p.evaluate(()=>window.spike.store.verify('page'));
  try{
   a=await open(0);await save(a,T.A);await connect(a);await verify(a);
   b=await open(1);await connect(b);await sync(b);
   await save(a,T.B);await save(b,T.C);await sync(b);await verify(b);await sync(a);
   await a.evaluate(boundary=>{
    window.boundaryHit=false;window.spike.store.hook=async name=>{
     if(name===boundary){window.boundaryHit=true;await new Promise(()=>{});}
    };
   },boundary);
   const resolution=a.evaluate(body=>window.spike.store.resolve('page','merge',body),T.M).catch(()=>{});
   if(!boundary.startsWith('resolution-')){await resolution;verify(a).catch(()=>{});}
   await a.waitForFunction(()=>window.boundaryHit);
   const before=await a.evaluate(()=>window.spike.store.view('page'));
   if(boundary!=='after-cleanup'){
    assert.equal(before.journal.draft.body,T.M);assert.equal(before.journal.sourceLocal.body,T.B);
    assert.equal(before.journal.sourceCloud.body,T.C);
   }else assert.equal(before.journal,null);
   const session=await contexts[0].newCDPSession(a);
   await Promise.race([session.send('Page.crash').catch(()=>{}),new Promise(r=>a.once('crash',r))]);
   await a.close().catch(()=>{});a=await open(0);
   const recovered=await a.evaluate(()=>window.spike.store.view('page'));
   if(boundary==='after-cleanup')assert.equal(recovered.body,T.M);
   else {assert.equal(recovered.journal.draft.body,T.M);assert.equal(recovered.journal.sourceLocal.body,T.B);
    assert.equal(recovered.journal.sourceCloud.body,T.C);}
   // Native WAL / stale lock recovery proceeds via stock plugin only.
   await connect(a);await sync(a);await verify(a);
   const after=await a.evaluate(()=>window.spike.store.view('page'));
   assert.equal(after.body,T.M);
   evidence.push({id:'F11',boundary,status:'PASS',before,recovered,after,requests:m.requests,faults:m.faults});
   console.log(boundary,'PASS');
  }catch(error){evidence.push({id:'F11',boundary,status:'FAIL',error:String(error),requests:m.requests});process.exitCode=1;}
  finally{for(const c of contexts)await c.close();await m.close();}
 }
}finally{
 await writeFile('native-overlay/.generated/crash-results.json',JSON.stringify({browser:browser.version(),
  mode:'real Chromium renderer crash; native IndexedDB and native mock Drive; manual live:false fault-boundary harness',evidence},null,2)+'\n');
 await browser.close();await server.close();
}

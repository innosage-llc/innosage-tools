import {chromium} from 'playwright';
import {mock} from '../src/mock.mjs';
import {uiServer} from './ui-server.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const server=await uiServer(),m=await mock(),browser=await chromium.launch({headless:true}),c=await browser.newContext();
const evidence=[],uploads=[];
process.once('SIGTERM',async()=>{await browser.close();await m.close();await server.close();process.exit(1);});
const scope='leader'+crypto.randomUUID().replaceAll('-','');
await c.route('**/*',r=>{
 const req=r.request(),u=new URL(req.url());
 if(![server.url,m.url].includes(u.origin))return r.abort();
 const target=[...m.files.values()].find(f=>u.pathname.endsWith('/'+f.id)&&f.name==='page.json');
 if(target&&req.method()==='PUT'){
  try{const d=JSON.parse(req.postData());if(d.editId)uploads.push(d.editId);}catch{}
 }
 return r.continue();
});
const open=async session=>{const p=await c.newPage();await p.goto(`${server.url}/?workspace=${scope}&session=${session}`);
 await p.waitForFunction(()=>window.spike?.ready);return p;};
try{
 const a=await open('a'),b=await open('b');console.log('stage opened');
 await a.evaluate(()=>window.spike.store.save('page','# Initial A'));
 await a.evaluate(url=>window.spike.store.connect(url),m.url);
 await a.evaluate(()=>window.spike.store.verify('page'));console.log('stage verified baseline');
 await b.evaluate(()=>window.spike.store.db.requestIdlePromise());
 assert.equal(await b.evaluate(()=>window.spike.store.page('page').then(p=>p?.body)),'# Initial A');
 await b.evaluate(url=>{
  window.created=0;window.spike.store.hook=async name=>{if(name==='native-created')window.created++;};
  window.connection=window.spike.store.connect(url).catch(e=>{window.connectionError=String(e);});
 },m.url);
 assert.equal(await a.evaluate(()=>window.spike.store.db.isLeader()),true);
 assert.equal(await b.evaluate(()=>!!window.spike.store.replication),false);
 await a.evaluate(()=>window.spike.store.save('page','# Independent A\n\nFull A draft.'));
 await b.evaluate(()=>window.spike.store.save('page','# Independent B\n\nFull B draft.'));
 console.log('stage both drafts saved');
 const before=await b.evaluate(()=>window.spike.store.view('page'));
 assert.deepEqual(new Set(before.drafts.map(x=>x.body)),new Set(['# Independent A\n\nFull A draft.','# Independent B\n\nFull B draft.']));
 console.log('stage closing owner tab');await a.close();console.log('stage owner tab closed');
 await b.waitForFunction(()=>window.created===1&&!!window.spike.store.replication?.wasStarted,{},{timeout:90000});console.log('stage new owner started');
 await b.evaluate(()=>window.spike.store.sync());
 assert.equal(await b.evaluate(()=>window.spike.store.db.isLeader()),true);
 const reopened=await open('a');
 assert.equal(await reopened.evaluate(()=>window.spike.store.view('page').then(v=>v.body)),'# Independent A\n\nFull A draft.');
 assert.equal(await b.evaluate(()=>window.spike.store.view('page').then(v=>v.body)),'# Independent B\n\nFull B draft.');
 assert.ok(uploads.every((id,index)=>uploads.indexOf(id)===index));
 evidence.push({id:'F14',status:'PASS',mode:'native live:true / multiInstance:true / elected owner handoff',
  before,after:await b.evaluate(()=>window.spike.store.view('page')),native_initializations_in_follower:await b.evaluate(()=>window.created),uploads});
}catch(error){evidence.push({id:'F14',status:'FAIL',error:String(error),uploads});process.exitCode=1;}
finally{
 console.log(evidence.map(x=>`${x.id} ${x.status} ${x.error??''}`).join('\n'));
 await writeFile('native-overlay/.generated/leader-results.json',JSON.stringify({browser:browser.version(),evidence,requests:m.requests},null,2)+'\n');
 await c.close();await browser.close();await m.close();await server.close();
}

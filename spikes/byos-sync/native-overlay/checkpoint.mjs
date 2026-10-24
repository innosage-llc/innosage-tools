import 'fake-indexeddb/auto';
import {rxReplica} from '../src/candidates.mjs';
import {mock} from '../src/mock.mjs';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const m=await mock(),original=globalThis.fetch;
globalThis.fetch=(input,init)=>{
 if(new URL(typeof input==='string'?input:input.url).origin!==m.url)
  throw new Error('NON_LOOPBACK_FETCH_BLOCKED');
 return original(input,init);
};
const suffix=crypto.randomUUID().replaceAll('-',''),a=await rxReplica('va'+suffix,m),b=await rxReplica('vb'+suffix,m);
try{
 const pages=[0,1].map(i=>({id:'visibility'+i,parentId:null,body:`# Original ${i}`,editIds:[`initial-${i}`]}));
 await a.putAll(pages);await a.sync();await a.sync();await b.sync();await b.sync();
 for(const i of [0,1]){await a.put({...pages[i],body:`# Latest ${i}\n\nExact new intent.`,editIds:[`latest-${i}`]});
  await a.sync();await a.sync();}
 const older=[...m.files.values()].find(f=>f.name==='visibility0.json');
 m.control.hiddenIds=[older.id];await b.sync();await b.sync();
 const hidden=await b.read();assert.equal(hidden.find(p=>p.id==='visibility1').body,'# Latest 1\n\nExact new intent.');
 m.control.hiddenIds=[];await b.sync();await b.sync();
 const after=await b.read();
 const undiscovered=after.find(p=>p.id==='visibility0').body!=='# Latest 0\n\nExact new intent.';
 const report={id:'F16',scenario:'adversarial hidden listing',label:'MOCK-TESTED',
  gate:undiscovered?'NATIVE CHECKPOINT BLOCKER / HOLD':'PASS',hidden,after,
  expected_older:'# Latest 0\n\nExact new intent.',actual_older:after.find(p=>p.id==='visibility0').body,
  upstream_repair_proposal:'Separately authorize upstream cursor repair: use provider change tokens or pagination plus a stable compound cursor/tie boundary and replay hidden-visibility regressions. Fixed overfetch cannot repair discovery of older invisible files; do not fork native transport here.',
  requests:m.requests};
 await writeFile('native-overlay/.generated/hidden-checkpoint.json',JSON.stringify(report,null,2)+'\n');
 console.log(report.gate,report.actual_older);
}finally{await a.close();await b.close();await m.close();globalThis.fetch=original;}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { VideoScissorsController } from '../../../lib/video-scissors.ts';
import { VideoScissorsRemoteAdapter } from '../../../lib/video-scissors-remote.ts';

for (const afterCommit of [false,true]) test(`real Workers/D1 + adapter: lost ACK ${afterCommit?'after':'before'} commit recovers without compute replay`, async () => {
  const bundled=await build({entryPoints:['test/fixture-worker.ts'],bundle:true,format:'esm',platform:'browser',write:false,loader:{'.sql':'text'}});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-13',d1Databases:['DB']}));
  const db=await mf.getD1Database('DB');
  await db.exec(readFileSync('migrations/0001.sql','utf8').replace(/--[^\n]*/g,'').replace(/\s+/g,' '));
  const call=async(action:string,body:object={})=>{
    const r=await mf.dispatchFetch('http://fixture.local/',{method:'POST',body:JSON.stringify({action,...body})});
    assert.equal(r.status,200);return r.json();
  };
  let computes=0,reports=0,claims=0;
  const controller=new VideoScissorsController({renderer:{inspect:async()=>({duration:30,width:64,height:64,framesPerSecond:10,videoCodec:'h264',audioCodec:'aac'}),render:async()=>{computes++;return new Blob(['synthetic']);}},createObjectURL:()=> 'blob:synthetic',revokeObjectURL:()=>{}});
  await controller.selectSource(Object.assign(new Blob(['synthetic']),{name:'NEVER_FORWARD.mp4',lastModified:0}) as File);
  const auth=await call('create');await call('bind',{auth,proof:auth.proof,handle:'ack-consent'});
  const adapter=new VideoScissorsRemoteAdapter(controller,{
    publish:async metadata=>{assert.equal(await call('sync',{auth,metadata}),true);},
    claim:async metadata=>{claims++;return call('claim',{auth,metadata});},
    report:async(id,result)=>{
      reports++;
      const ack=()=>call('report',{auth,id,state:result.status,metadata:result.metadata});
      if(reports===1){if(afterCommit)assert.equal(await ack(),true);throw Error('ACK_LOST');}
      assert.equal(await ack(),true);
    },cancellation:async()=>false,revoke:async()=>{await call('revoke',{auth});},
  });
  try{
    await adapter.flushMetadata();
    const command=(id:string)=>({kind:'cut',operationId:id,generation:adapter.metadata().generation,version:adapter.metadata().version,clips:[{start:0,end:2}]});
    await call('admit',{auth,command:command('first')});
    await assert.rejects(adapter.pollOnce(),/ACK_LOST/);
    assert.equal(computes,1);assert.equal(claims,1);
    assert.equal(await db.prepare("SELECT state FROM commands WHERE id='first'").first('state'),afterCommit?'completed':'claimed');
    await adapter.pollOnce(); // saved terminal report first, then empty claim
    assert.equal(computes,1);assert.equal(reports,2);
    assert.equal(await db.prepare("SELECT state FROM commands WHERE id='first'").first('state'),'completed');
    await call('admit',{auth,command:command('next')});await adapter.pollOnce();
    assert.equal(computes,2);assert.equal(reports,3);
    assert.equal(await db.prepare("SELECT state FROM commands WHERE id='next'").first('state'),'completed');
  }finally{await adapter.dispose();controller.dispose();await mf.dispose();}
});

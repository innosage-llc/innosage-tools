// Isolated iframe contract test. This is deliberately NOT a real ChatGPT proof.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require=createRequire(new URL('../workers/video-scissors-mcp/package.json',import.meta.url));
const {build}=require('esbuild');
const bundled=await build({entryPoints:['workers/video-scissors-mcp/src/CoverPickerView.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {renderCoverPicker}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const html=renderCoverPicker();const requests=[];const errors=[];
const host=`<!doctype html><meta charset="utf-8"><iframe title="Preset gallery" src="/gallery" style="width:100%;height:640px;border:0"></iframe><script>
window.calls=[];window.complete=false;window.mode='normal';window.supported=true;window.initializations=[];
window.addEventListener('message',event=>{
 const m=event.data;if(!m||m.jsonrpc!=='2.0')return;
 const reply=result=>event.source.postMessage({jsonrpc:'2.0',id:m.id,result},'*');
 if(m.method==='ui/initialize'){
  window.initializations.push(m.params);
  // Stable MCP Apps2026-01-26 requires appCapabilities. The real host rejected
  // the old capabilities alias before clicks; never accept that alias here.
  if(!m.params?.appCapabilities||typeof m.params.appCapabilities!=='object'||Array.isArray(m.params.appCapabilities)){
   window.initializeError=[{expected:'object',code:'invalid_type',path:['params','appCapabilities'],message:'Invalid input'}];
   return event.source.postMessage({jsonrpc:'2.0',id:m.id,error:{code:-32602,message:JSON.stringify(window.initializeError)}},'*');
  }
  return reply({protocolVersion:'2026-01-26',hostCapabilities:window.supported?{serverTools:{}}:{},hostInfo:{name:'offline-contract',version:'1'},hostContext:{}});
 }
 if(m.method!=='tools/call')return;
 window.calls.push(m.params);const name=m.params.name;
 const tool=data=>reply({content:[{type:'text',text:JSON.stringify(data)}]});
 if(name==='getproject')return tool({metadata:{generation:1,version:2}});
 if(name==='applycoverpreset'){window.applied=m.params.arguments;if(window.mode==='uncertain')return;return tool({operationId:m.params.arguments.operationId,state:'queued'});}
 if(name==='status'){if(window.mode==='missing')return tool(null);return tool({operationId:m.params.arguments.operationId,state:window.complete?'completed':'queued',metadata:{generation:1,version:3}});}
});
</script>`;
const server=createServer((q,r)=>{requests.push(q.url);r.setHeader('Content-Type','text/html; charset=utf-8');
 if(q.url==='/gallery-legacy')return r.end(html.replace('appCapabilities: {}','capabilities: {}'));
 if(q.url==='/legacy')return r.end(host.replace('src="/gallery"','src="/gallery-legacy"'));
 r.end(q.url==='/gallery'?html:host);
});
await new Promise(y=>server.listen(0,'127.0.0.1',y));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.VIDEO_SCISSORS_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const context=await browser.newContext({viewport:{width:620,height:760}});const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>assert.ok(r.url().startsWith(origin),'no external network'));
 // Negative control reproduces the recording's initialization error BEFORE
 // Clean white/Lavender/Ocean clicks; rendering alone must never count as PASS.
 await page.goto(origin+'/legacy');const frame=page.frameLocator('iframe');
 await page.waitForFunction(()=>window.initializeError);
 assert.match(await frame.getByRole('status').innerText(),/appCapabilities/);
 assert.equal(await frame.getByRole('button',{name:'Apply Cover Preset'}).isDisabled(),true);
 for(const name of ['Clean white','Lavender','Ocean gradient'])await frame.getByText(name,{exact:true}).click({force:true});
 assert.equal(await frame.getByRole('radio',{name:'Midnight black'}).isChecked(),true);
 assert.equal((await page.evaluate(()=>window.calls)).length,0);
 await page.goto(origin);
 await frame.getByRole('button',{name:'Apply Cover Preset'}).waitFor();
 await page.waitForFunction(()=>window.initializeError||window.calls.some(c=>c.name==='getproject'));
 assert.equal(await page.evaluate(()=>window.initializeError),undefined,'real-host required appCapabilities request accepted');
 const init=await page.evaluate(()=>window.initializations[0]);
 assert.deepEqual(Object.keys(init).sort(),['protocolVersion','appInfo','appCapabilities'].sort());
 assert.deepEqual(init.appCapabilities,{});
 assert.equal(await frame.getByRole('radio').count(),6);
 for(const name of ['Midnight black','Clean white','Sage mist','Ocean gradient','Lavender','Sunrise']){
  await frame.getByRole('radio',{name}).check();
  assert.equal(await frame.getByRole('radio',{name}).isChecked(),true);
 }
 await frame.getByRole('radio',{name:'Sage mist'}).check();
 assert.equal((await page.evaluate(()=>window.calls.filter(c=>c.name==='applycoverpreset'))).length,0,'selection is nonmutating');
 await frame.getByRole('button',{name:'Apply Cover Preset'}).click();
 await page.waitForFunction(()=>window.calls.some(c=>c.name==='status'));
 assert.match(await frame.getByRole('status').innerText(),/pending|queued/i);
 assert.equal(await frame.getByRole('button',{name:'Apply Cover Preset'}).isDisabled(),true);
 assert.equal(await page.evaluate(()=>window.applied.presetId),'sage-mist');
 assert.deepEqual(Object.keys(await page.evaluate(()=>window.applied)).sort(),['operationId','generation','version','presetId'].sort());
 await page.evaluate(()=>window.complete=true);
 await frame.getByRole('status').filter({hasText:/download/i}).waitFor();
 mkdirSync('.deploy/video-scissors-covers',{recursive:true});
 await page.screenshot({path:'.deploy/video-scissors-covers/gallery-offline.png',fullPage:true});
 // Lost apply response is uncertain: no fresh mutation, reconcile exact ID.
 await page.reload();await page.waitForFunction(()=>window.calls.some(c=>c.name==='getproject'));
 await page.evaluate(()=>window.mode='uncertain');
 await frame.getByRole('button',{name:'Apply Cover Preset'}).click();
 await frame.getByRole('button',{name:'Reconnect',exact:true}).waitFor({state:'visible'});
 await page.waitForTimeout(9000);
 assert.equal(await frame.getByRole('button',{name:'Apply Cover Preset'}).isDisabled(),true,'uncertain mutation remains locked');
 const id=await page.evaluate(()=>window.applied.operationId);
 await page.evaluate(()=>{window.complete=true;window.mode='normal';});
 await frame.getByRole('button',{name:'Reconnect',exact:true}).click();
 await frame.getByRole('status').filter({hasText:/download/i}).waitFor();
 assert.equal((await page.evaluate(()=>window.calls.filter(c=>c.name==='applycoverpreset'))).length,1,'reconnect never repeats mutation');
 assert.ok((await page.evaluate(()=>window.calls.filter(c=>c.name==='status'))).every(c=>c.arguments.operationId===id));
 // No tools capability: keep Apply disabled.
 await page.route('**/gallery',route=>route.fulfill({contentType:'text/html',body:html}));
 await page.addInitScript(()=>{window.addEventListener('DOMContentLoaded',()=>{window.supported=false;});});
 await page.reload();await page.waitForTimeout(500);
 assert.equal(await frame.getByRole('button',{name:'Apply Cover Preset'}).isDisabled(),true,'unsupported host remains disabled');
 assert.deepEqual(errors,[]);
 writeFileSync('.deploy/video-scissors-covers/gallery-evidence.json',JSON.stringify({hostProof:false,passed:['legacy appCapabilities validation rejection before clicks','strict initialize wire shape','all six card selections','selection nonmutating','explicit bounded apply','pending vs completed','uncertain delivery locked','same-ID status recovery','capability absence'],requests,errors},null,2));
 console.log('Offline gallery contract passed (not real ChatGPT host proof).');
}finally{await browser.close();await new Promise(y=>server.close(y));}

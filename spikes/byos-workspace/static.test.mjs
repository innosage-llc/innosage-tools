import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {buildAssets} from './server.mjs';
const integrity=x=>'sha256-'+createHash('sha256').update(x).digest('base64');
test('staging static shell pins its own complete assets and worker scope',async()=>{
 const {html,bytes,worker}=await buildAssets({real:true,base:'/byos-workspace/'});
 assert(html.includes('src="/byos-workspace/app.mjs?revision='));
 assert(html.includes('integrity="'+integrity(bytes)+'"'));
 const assets=JSON.parse(worker.match(/const assets = (.*);/)[1]);
 assert.equal(assets[0].url,'/byos-workspace/');assert.equal(assets[0].integrity,integrity(html));
 assert.equal(assets[1].integrity,integrity(bytes));
 assert(worker.includes('["/byos-workspace/","/byos-workspace/index.html"]'));
 assert(!worker.includes("['/byos-demo/'"));
 assert(Buffer.from(bytes).toString().includes('Existing approved #113 account/folder binding required'));
 await assert.rejects(buildAssets({base:'/../'}),/Invalid static base/);
});

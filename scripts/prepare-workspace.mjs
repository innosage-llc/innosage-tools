// Build only: no auth, provider traffic or deployment. Existing-binding gate stays in bundle.
import {mkdir,writeFile} from 'node:fs/promises';
import {buildAssets} from '../spikes/byos-workspace/server.mjs';
const target='public/byos-workspace';
const {html,bytes,worker}=await buildAssets({real:true,base:'/byos-workspace/'});
await mkdir(target,{recursive:true});
await writeFile(target+'/index.html',html);
await writeFile(target+'/app.mjs',bytes);
await writeFile(target+'/sw.js',worker);
console.log('Prepared isolated workspace candidate; original binding required.');

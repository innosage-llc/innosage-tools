import {build} from 'esbuild';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {mock} from '../src/mock.mjs';
export async function uiServer() {
 await build({entryPoints:['native-overlay/ui.mjs'],bundle:true,format:'esm',platform:'browser',
  outfile:'native-overlay/.generated/ui.js',define:{global:'globalThis'},target:'es2022'});
 const js=await readFile('native-overlay/.generated/ui.js'),html=await readFile('native-overlay/index.html');
 const server=http.createServer((req,res)=>{
  const script=req.url.split('?')[0]==='/ui-bundle.js';
  res.setHeader('Content-Type',script?'application/javascript':'text/html');res.end(script?js:html);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};
}
if(process.argv[1]?.endsWith('/ui-server.mjs')){
 const server=await uiServer(),remote=await mock();
 console.log('OFFLINE SPIKE / NOT SAFE FOR PRODUCT; loopback mock only.');
 for(const session of ['a','b'])console.log(`${server.url}/?workspace=demo&session=${session}&endpoint=${encodeURIComponent(remote.url)}`);
 console.log('Use two tabs for same-browser checks; stop with Ctrl-C.');
 const stop=async()=>{await remote.close();await server.close();process.exit();};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
}

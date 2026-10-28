import http from 'node:http';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from '../byos-sync/node_modules/esbuild/lib/main.js';
import {mock} from '../byos-sync/src/mock.mjs';
export async function buildAssets({real=false,base='/',idleTest=false}={}) {
  if(real&&idleTest)throw new Error('Test provider cannot replace real binding');
  if(!/^\/(?:[a-z0-9-]+\/)*$/.test(base))throw new Error('Invalid static base');
  const bundle=await build({entryPoints:[fileURLToPath(new URL('app.mjs',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',define:{global:'globalThis'},target:'es2022',...(real?{inject:[fileURLToPath(new URL('../byos-sync/real-drive/transport.mjs',import.meta.url))],plugins:[{name:'strict-existing-real-provider',setup(build){build.onResolve({filter:/^\.\/provider\.mjs$/},()=>({path:fileURLToPath(new URL('real-provider.mjs',import.meta.url))}));}}]}:idleTest?{plugins:[{name:'idle-loopback-fixture',setup(build){build.onResolve({filter:/^\.\/provider\.mjs$/},()=>({path:fileURLToPath(new URL('idle-test-provider.mjs',import.meta.url))}));}}]}:{})});
  const bytes=bundle.outputFiles[0].contents;
  const digest=value=>createHash('sha256').update(value).digest();
  const bundleUrl=base+'app.mjs?revision='+digest(bytes).toString('hex');
  const css=await readFile(new URL('style.css',import.meta.url),'utf8');
  let html=(await readFile(new URL('index.html',import.meta.url),'utf8'))
    .replace('<link rel="stylesheet" href="./style.css">','<style>'+css+'</style>')
    .replace('src="./app.mjs"',`src="${bundleUrl}" integrity="sha256-${digest(bytes).toString('base64')}"`);
  if(real)html=html.replace('OFFLINE / NATIVE MOCK ONLY (NO REAL PROVIDER AUTH)','REAL DRIVE CANDIDATE — ORIGINAL ACCOUNT/FOLDER REQUIRED');
  const assets=[{url:base,integrity:'sha256-'+digest(html).toString('base64'),type:'text/html'},
    {url:bundleUrl,integrity:'sha256-'+digest(bytes).toString('base64'),type:'javascript'}];
  const worker=(await readFile(new URL('../byos-sync/real-drive/shell-worker.js',import.meta.url),'utf8'))
    .replace('__BYOS_SHELL_ASSETS__',JSON.stringify(assets))
    .replace('__BYOS_SHELL_CACHE__',JSON.stringify('workspace142-shell-'+digest(JSON.stringify(assets)).toString('hex')))
    .replace("['/byos-demo/', '/byos-demo/index.html']",JSON.stringify([base,base+'index.html']));
  return {html,bytes,css,worker};
}
export async function serve(port=0,{real=false,idleTest=false}={}) {
  const {html,bytes,css,worker}=await buildAssets({real,idleTest});
  const server=http.createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    if(!['/','/index.html','/app.mjs','/style.css','/sw.js'].includes(path)){res.writeHead(404);res.end();return;}
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type',['/app.mjs','/sw.js'].includes(path)?'text/javascript':path==='/style.css'?'text/css':'text/html');
    res.setHeader('Content-Security-Policy',real?"default-src 'self'; connect-src 'self' https://www.googleapis.com https://accounts.google.com; style-src 'self' 'unsafe-inline'; script-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; object-src 'none'":"default-src 'self'; connect-src http://127.0.0.1:*; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-src 'none'");
    res.end(path==='/app.mjs'?bytes:path==='/sw.js'?worker:path==='/style.css'?css:html);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const real=process.argv.includes('--real');
  const remote=real?null:await mock(),server=await serve(Number(process.env.PORT??4142),{real});
  console.log(real?'REAL CANDIDATE: requires original approved browser origin/binding and explicit fixture authority; no new folder.':'OFFLINE/native mock only; no Google provider receipts.');
  console.log(real?server.url:`${server.url}/?workspace=workspace142&endpoint=${encodeURIComponent(remote.url)}`);
  const stop=async()=>{await server.close();if(remote)await remote.close();process.exit();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}

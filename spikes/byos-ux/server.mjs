import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const allowed=new Set(['index.html','styles.css','app.mjs','model.mjs','storage.mjs']);
export async function serve(port=0) {
  const server=http.createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(!allowed.has(path)){res.writeHead(404);res.end();return;}
    try {const bytes=await readFile(new URL(path,import.meta.url));res.setHeader('Content-Type',path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');
      res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'none'; style-src 'self'; script-src 'self'; frame-src 'none'; object-src 'none'");res.end(bytes);
    }catch{res.writeHead(500);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {const server=await serve(Number(process.env.PORT??4136));console.log(`SIMULATION only: ${server.url}`);}

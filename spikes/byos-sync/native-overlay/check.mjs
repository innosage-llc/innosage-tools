import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url));
const stages=[['run.mjs'],['faults.mjs']];
for(const [file,...args]of stages){
 console.log(`\nNative overlay stage: ${file}`);
 const run=spawnSync(process.execPath,['native-overlay/'+file,...args],{cwd,stdio:'inherit',
  timeout:file==='run.mjs'?600000:180000});
 if(run.error||run.status!==0){console.error(file,run.error?.message??`exit ${run.status}`);process.exit(1);}
}

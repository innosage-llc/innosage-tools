import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url));
const full=process.argv.includes('--full');
const seedArg=process.argv.find(x=>x.startsWith('--seeds='));
const seeds=seedArg?Number(seedArg.split('=')[1]):full?100:0;
if(!Number.isInteger(seeds)||seeds<0||seeds>100)throw new Error('Seed budget must be 0–100');
const stages=[['run.mjs',...(seeds?[`--seeds=${seeds}`]:[])],['faults.mjs'],
 ...(full?[['browser.mjs'],['ui-browser.mjs'],['crash-browser.mjs'],['leader-browser.mjs'],
 ['checkpoint.mjs'],['measure.mjs'],['measure-overlay.mjs'],['report.mjs']]:[])];
for(const [file,...args]of stages){
 console.log(`\nNative overlay stage: ${file}`);
 const run=spawnSync(process.execPath,['native-overlay/'+file,...args],{cwd,stdio:'inherit',
  timeout:file==='run.mjs'?600000:180000});
 if(run.error||run.status!==0){console.error(file,run.error?.message??`exit ${run.status}`);process.exit(1);}
}

// Test-only reuse of the accepted #109 Changes fixture; no Google traffic.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {provider} from '../byos-sync/changes-feasibility/provider.mjs';
export async function mockProvider() {
  let source=await readFile(new URL('../byos-sync/src/mock.mjs',import.meta.url),'utf8');
  const signature='sameTime = false,\n} = {}) {',anchor='    const match = u.pathname.match(';
  assert.equal(source.split(signature).length,2);assert.equal(source.split(anchor).length,2);
  source=source.replace(signature,'sameTime = false,\n extension = async () => false,\n} = {}) {')
    .replace(anchor,'    if(await extension({req,res,u,body,files,create,control,finish,entry,meta}))return;\n'+anchor);
  const dir=new URL('.generated/',import.meta.url);await mkdir(dir,{recursive:true});
  const file=new URL('mock.mjs',dir);await writeFile(file,source);
  const {mock}=await import(file.href);const fixture=provider();
  const remote=await mock({extension:context=>fixture.route(context)});fixture.attach(remote);
  return {...remote,fixture};
}

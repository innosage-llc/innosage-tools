import {createRequire} from 'node:module';
import {build} from '../byos-sync/node_modules/esbuild/lib/main.js';
import {mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const require = createRequire(new URL('../byos-sync/package.json',import.meta.url));
await mkdir('spikes/byos-workspace/.generated',{recursive:true});
await build({entryPoints:['spikes/byos-workspace/native-test-entry.mjs'],bundle:true,packages:'external',platform:'node',format:'cjs',outfile:'spikes/byos-sync/native-overlay/.generated/workspace-store.cjs'});
await build({entryPoints:['spikes/byos-workspace/real-store.mjs'],bundle:true,platform:'browser',format:'esm',define:{global:'globalThis'},inject:['spikes/byos-sync/real-drive/transport.mjs'],outfile:'spikes/byos-workspace/.generated/real-store.js'});
// Native fixture files share the generated loopback module; serialize test files.
const prepared=['prepared-wal','conditional-upload','prepared-drive-io','prepared-drain','prepared-session','prepared-recovery','prepared-native'].map(name=>'spikes/byos-workspace/'+name+'.test.mjs');
const result=spawnSync(process.execPath,['--test','--test-concurrency=1','spikes/byos-workspace/workspace.test.mjs','spikes/byos-workspace/binding.test.mjs','spikes/byos-workspace/foreground.test.mjs','spikes/byos-workspace/idle-drain.test.mjs','spikes/byos-workspace/foreground-native.test.mjs','spikes/byos-workspace/static.test.mjs',...prepared],{stdio:'inherit',env:{...process.env,WORKSPACE_REQUIRE_ROOT:require.resolve('fake-indexeddb/auto')}});
process.exitCode=result.status??1;

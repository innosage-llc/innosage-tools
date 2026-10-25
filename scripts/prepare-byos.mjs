import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const require=createRequire(new URL('../spikes/byos-sync/package.json',import.meta.url));
const {build}=require('esbuild');
const root=resolve('spikes/byos-sync');
await mkdir('public/byos-demo',{recursive:true});
await build({entryPoints:[root+'/real-drive/browser.mjs'],bundle:true,format:'esm',platform:'browser',outfile:'public/byos-demo/app.js',define:{global:'globalThis'},target:'es2022',minify:true,inject:[root+'/real-drive/transport.mjs'],plugins:[{name:'existing-ui-provider',setup(b){b.onResolve({filter:/^\.\/page-store\.mjs$/},a=>a.importer.endsWith('/native-overlay/ui.mjs')?{path:root+'/real-drive/store.mjs'}:null);}}]});
let html=await readFile(root+'/native-overlay/index.html','utf8');
html=html.replaceAll('Native RxDB Overlay','Google Drive Markdown demo').replace('OFFLINE SPIKE / NOT FOR PRODUCT','RESEARCH DEMO — EXPLICIT SYNC ONLY');
html=html.replace('<div id="writer-notice"',`<section class="panel">
<p>Dedicated disposable account only. This demo can create and update its isolated My Drive folder. Local saves work before authorization. Reload requires reauthorization; content stays in IndexedDB.</p>
<p>Open this workspace in the second independent browser profile: <code id="workspace-link"></code></p>
<label for="oauth-client">Public Web OAuth Client ID</label><input id="oauth-client" size="65" autocomplete="off">
<label><input type="checkbox" id="test-account"> I am using the approved disposable test account, not personal Drive data.</label>
<button id="authorize-btn">Authorize test account</button><button id="disconnect-btn">Disconnect</button>
<p id="connection-status" role="status">Not authorized. Local editing is available.</p>
<p>Use the same OAuth client and workspace in both profiles. A duplicate tab in one profile is read-only while its writer is open. No background synchronization.</p>
</section><div id="writer-notice"`);
html=html.replace('src="/ui-bundle.js"','src="/tools/byos-demo/app.js"');
await writeFile('public/byos-demo/index.html',html);
console.log('Prepared existing BYOS editor + explicit Google provider binding.');

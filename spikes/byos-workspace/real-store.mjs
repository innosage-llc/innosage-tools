/** Existing #113 real-provider binding, with a stricter no-new-folder entry gate.
 * This module does not acquire credentials or broaden OAuth scopes.
 * Build with the SAME existing real-drive/transport.mjs fetch injection as #113.
 */
import {openPageStore as openReal} from '../byos-sync/real-drive/store.mjs';
import {forbidFolderCreation} from '../byos-sync/real-drive/transport.mjs';
import {workspace,bindingKey,clientId,preflight} from '../byos-sync/real-drive/config.mjs';
import {createChangesReplication} from '../byos-sync/changes-feasibility/adapter.mjs';
import {preparedRealController} from './prepared-real.mjs';
export async function openBoundRealStore(options) {
  if (options.workspace !== workspace) throw new Error('Workspace URL/binding mismatch');
  const binding=JSON.parse(localStorage.getItem(bindingKey)??'null');
  if (!binding?.account || !binding?.folderId || !binding.clientId || binding.clientId!==clientId())
    throw new Error('Existing approved #113 account/folder binding required; no new folder or consent is permitted');
  forbidFolderCreation();
  const expectedBinding=Object.freeze({...binding});
  const preparedMode=new URLSearchParams(location.search).get('prepared')==='1';
  let prepared;
  const store=await openReal({...options,providerPreflight:()=>preflight({allowCreate:false,expectedBinding}),
    ...(preparedMode?{replicationFactory:options=>createChangesReplication(options,{transactionRunner:(...args)=>prepared.transactionRunner(...args)})}:{}),
  });
  if(preparedMode){prepared=preparedRealController(store);store.preparedController=prepared;}
  return store;
}

/** Existing #113 real-provider binding, with a stricter no-new-folder entry gate.
 * This module does not acquire credentials or broaden OAuth scopes.
 * Build with the SAME existing real-drive/transport.mjs fetch injection as #113.
 */
import {openPageStore as openReal,diagnosticFactory} from '../byos-sync/real-drive/store.mjs';
import {forbidFolderCreation,isAuthorized,requirePinnedWorkspaceActions,withPinnedWorkspaceAction} from '../byos-sync/real-drive/transport.mjs';
import {workspace,bindingKey,preflight} from '../byos-sync/real-drive/config.mjs';
import {createChangesReplication} from '../byos-sync/changes-feasibility/adapter.mjs';
import {preparedRealController} from './prepared-real.mjs';
import {createWorkspaceConnection,assertDriveLayout} from './workspace-connection.mjs';
import {initDriveStructure} from '../byos-sync/real-drive/prepared-primitives.mjs';
export async function openBoundRealStore(options) {
  if (workspace && options.workspace !== workspace) throw new Error('Workspace URL/binding mismatch');
  const connection=createWorkspaceConnection({workspace:options.workspace,initialize:initDriveStructure});
  forbidFolderCreation();
  const expectedBinding=connection.kind==='legacy'?Object.freeze({...JSON.parse(localStorage.getItem(bindingKey))}):null;
  const providerPreflight=async()=>{const result=expectedBinding?await preflight({allowCreate:false,expectedBinding}):await connection.preflight();if(!expectedBinding&&store.replication)assertDriveLayout(connection.pinnedLayout(),store.replication.driveStructure);return result;};
  const preparedMode=new URLSearchParams(location.search).get('prepared')==='1';
  let prepared;
  const store=await openReal({...options,providerPreflight,
    ...((preparedMode||!expectedBinding)?{replicationFactory:async config=>{const state=await (preparedMode?createChangesReplication({...config,autoStart:false},{transactionRunner:(...args)=>prepared.transactionRunner(...args)}):diagnosticFactory({...config,autoStart:false}));if(!expectedBinding){try{assertDriveLayout(connection.pinnedLayout(),state.driveStructure);}catch(error){await state.pause();throw error;}}return state;}}:{}),
  });
  store.workspaceConnection=connection;
  if(connection.kind!=='legacy'){
    requirePinnedWorkspaceActions(()=>connection.pinnedLayout());
    const operation=store.runOperation.bind(store);
    store.runOperation=(...args)=>isAuthorized()?withPinnedWorkspaceAction(()=>operation(...args)):operation(...args);
  }
  if(preparedMode){prepared=preparedRealController(store);store.preparedController=prepared;}
  return store;
}

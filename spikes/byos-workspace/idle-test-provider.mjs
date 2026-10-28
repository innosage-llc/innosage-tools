// Build-only browser test fixture: the approved Changes adapter, loopback only.
import {openPageStore as openNative} from '../byos-sync/native-overlay/page-store.mjs';
import {createChangesReplication} from '../byos-sync/changes-feasibility/adapter.mjs';
export async function openPageStore(options){
 const endpoint=new URL(new URLSearchParams(location.search).get('endpoint'));
 if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1')throw Error('Test fixture requires loopback');
 const store=await openNative(options);
 store.connectionProvider=async()=>({factory:createChangesReplication,googleDrive:{apiEndpoint:endpoint.origin,authToken:'synthetic',oauthClientId:'synthetic',folderPath:options.workspace,transactionTimeout:50}});
 return store;
}
export async function configureProvider(store){return {real:false,canSync:()=>!!store.replication};}

import {API,driveFetch,begin,withApprovedWorkspaceFolders} from '../byos-sync/real-drive/transport.mjs';
export const DEFAULT_CLIENT='217813536818-23lu1pe0jtle03id1is5sklhnji5tr8t.apps.googleusercontent.com';
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const CLIENT=/^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/;
const FOLDER='application/vnd.google-apps.folder';
const read=(storage,key)=>{try{return JSON.parse(storage.getItem(key)??'null');}catch{return {invalid:true};}};
const same=(a,b)=>!!a&&!!b&&['account','clientId','folderId','workspaceId'].every(k=>a[k]===b[k]);
export function loadWorkspaceBinding(workspace,storage=localStorage){
 const managed=read(storage,'byos142-binding:'+workspace),legacy=read(storage,'byos113-binding:'+workspace);
 if(managed&&legacy)return {kind:'invalid',binding:null};
 const b=managed??legacy;
 if(!b)return {kind:'missing',binding:null};
 if(b.invalid||!b.account||!b.folderId||!CLIENT.test(b.clientId??'')||(managed&&b.workspaceId!==workspace)||(!managed&&storage.getItem('byos113-client-id')!==b.clientId))return {kind:'invalid',binding:null};
 return {kind:managed?'managed':'legacy',binding:Object.freeze({...b,workspaceId:workspace})};
}
export async function browserSetupLock(workspace,action){
 if(!globalThis.navigator?.locks)throw Error('EXCLUSIVE_WORKSPACE_SETUP_LOCK_UNAVAILABLE');
 return navigator.locks.request('byos142-setup:'+workspace,{mode:'exclusive',ifAvailable:true},lock=>{if(!lock)throw Error('WORKSPACE_SETUP_ALREADY_ACTIVE');return action();});
}
export function assertDriveLayout(layout,actual){if(!layout||!actual||actual.rootFolderId!==layout.rootId||actual.docsFolderId!==layout.docsId||actual.signalingFolderId!==layout.signalingId)throw Error('MANAGED_NATIVE_LAYOUT_CHANGED');}
export function createWorkspaceConnection({workspace,storage=localStorage,request=driveFetch,initialize,withSetupLock=browserSetupLock}){
 const initial=loadWorkspaceBinding(workspace,storage);let binding=initial.binding,kind=initial.kind,layout=null;
 const key='byos142-binding:'+workspace,setupKey='byos142-setup:'+workspace;
 const check=()=>{if(!binding||!same(binding,loadWorkspaceBinding(workspace,storage).binding))throw Error('WORKSPACE_BINDING_MISSING_OR_CHANGED');};
 async function api(path,params={},body){
  const response=await request(API+path+'?'+new URLSearchParams(params),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  if(!response.ok)throw Error('DRIVE_HTTP_'+response.status);
  return response.json();
 }
 async function account(){const data=await api('/drive/v3/about',{fields:'user(permissionId)'});if(!data.user?.permissionId)throw Error('ACCOUNT_IDENTITY_UNAVAILABLE');return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data.user.permissionId)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 const validFolder=file=>file&&file.ownedByMe===true&&!file.driveId&&file.mimeType===FOLDER&&UUID.test(file.appProperties?.byos113??'')&&file.name==='InnoSage_BYOS_'+file.appProperties.byos113;
 async function list(name=null){
  const files=[];let pageToken;
  for(let page=0;page<5;page++){
   const data=await api('/drive/v3/files',{q:"'root' in parents and trashed = false and mimeType = '"+FOLDER+"' and "+(name?"name = '"+name+"'":"name contains 'InnoSage_BYOS_'"),spaces:'drive',corpora:'user',pageSize:'100',fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,driveId,ownedByMe,appProperties)',...(pageToken?{pageToken}:{})});
   if(data.incompleteSearch||!Array.isArray(data.files))throw Error('INCOMPLETE_FOLDER_DISCOVERY');files.push(...data.files);pageToken=data.nextPageToken;if(!pageToken)return files;
  }throw Error('FOLDER_DISCOVERY_BUDGET');
 }
 async function pin(expected,current=()=>{}){
  current();const observed=await account();current();if(observed!==expected.account)throw Error('ACCOUNT_CHANGED_NO_WRITE');
  const files=await list('InnoSage_BYOS_'+expected.workspaceId);current();
  if(files.length!==1||!validFolder(files[0])||files[0].id!==expected.folderId)throw Error('BOUND_FOLDER_UNAVAILABLE_OR_AMBIGUOUS');
  return files[0];
 }
 async function compatibleStructure(rootId,current=()=>{}){
  const data=await api('/drive/v3/files',{q:"'"+rootId+"' in parents and trashed = false",pageSize:'100',fields:'nextPageToken,incompleteSearch,files(id,name,mimeType)'});current();
  if(data.nextPageToken||data.incompleteSearch||!Array.isArray(data.files))throw Error('INCOMPLETE_WORKSPACE_STRUCTURE');
  for(const name of ['docs','signaling'])if(data.files.filter(f=>f.name===name&&f.mimeType===FOLDER).length!==1)throw Error('WORKSPACE_STRUCTURE_NOT_READY');
  for(const name of ['rxdb.json','transaction.json','rxdb-wal.json'])if(!data.files.some(f=>f.name===name&&f.mimeType==='application/json'))throw Error('WORKSPACE_STRUCTURE_NOT_READY');
  layout=Object.freeze({workspaceId:workspace,rootId,docsId:data.files.find(f=>f.name==='docs').id,signalingId:data.files.find(f=>f.name==='signaling').id});
 }
 function commit(candidate){
  if(binding||kind==='invalid'||read(storage,key)||read(storage,'byos113-binding:'+workspace))throw Error('REBINDING_NOT_ALLOWED');
  const approved=Object.freeze({...candidate,workspaceId:workspace});storage.setItem(key,JSON.stringify(approved));binding=approved;kind='managed';
 }
 return {
  get kind(){return kind;},get binding(){return binding;},get ready(){return !!binding;},
  pinnedLayout(){check();return layout;},
  get clientId(){return binding?.clientId||storage.getItem('byos142-client:'+workspace)||DEFAULT_CLIENT;},
  get ownsNewWorkspace(){return UUID.test(workspace)&&read(storage,'byos142-new:'+workspace)?.workspaceId===workspace;},
  async preflight(){check();const expected=binding;await pin(expected,check);await compatibleStructure(expected.folderId,check);check();return {googleDrive:{apiEndpoint:API,authToken:'ephemeral-managed',oauthClientId:expected.clientId,space:'drive',folderPath:'InnoSage_BYOS_'+workspace,transactionTimeout:60000}};},
  async discover(clientId,current){if(!CLIENT.test(clientId))throw Error('PUBLIC_CLIENT_ID_INVALID');current();begin('workspace-account-discovery');const identity=await account();current();const files=await list();current();const valid=files.filter(validFolder);const ids=new Set();for(const file of valid){if(ids.has(file.appProperties.byos113))throw Error('AMBIGUOUS_WORKSPACE_FOLDERS');ids.add(file.appProperties.byos113);}return {account:identity,clientId,folders:valid.map(f=>({account:identity,clientId,folderId:f.id,workspaceId:f.appProperties.byos113,name:f.name}))};},
  async assertEmptyDocs(current){
   check();current();begin('workspace-demo-inventory');await pin(binding,current);
   const children=await api('/drive/v3/files',{q:"'"+binding.folderId+"' in parents and trashed = false",pageSize:'100',fields:'nextPageToken,incompleteSearch,files(id,name,mimeType)'});current();
   if(children.nextPageToken||children.incompleteSearch)throw Error('INCOMPLETE_WORKSPACE_STRUCTURE');
   const docs=children.files?.filter(f=>f.name==='docs'&&f.mimeType===FOLDER);if(docs?.length!==1)throw Error('WORKSPACE_STRUCTURE_NOT_READY');
   const data=await api('/drive/v3/files',{q:"'"+docs[0].id+"' in parents and trashed = false",pageSize:'1',fields:'nextPageToken,incompleteSearch,files(id)'});current();check();
   if(data.nextPageToken||data.incompleteSearch||!Array.isArray(data.files)||data.files.length)throw Error('DEMO_REQUIRES_EMPTY_DRIVE_DOCS_NO_OVERWRITE');
  },
  async select(candidate,{empty,current,emptyNow=async()=>empty}){
   if(candidate.workspaceId!==workspace)throw Error('OPEN_SELECTED_WORKSPACE_FIRST');if(!empty)throw Error('LOCAL_NOTES_EXIST_CANNOT_ATTACH_ANOTHER_DESTINATION');
   if(binding||kind!=='missing')throw Error('REBINDING_NOT_ALLOWED');begin('workspace-select-existing');await pin(candidate,current);await compatibleStructure(candidate.folderId,current);if(!await emptyNow())throw Error('LOCAL_NOTES_CHANGED_DURING_CONNECTION');current();commit(candidate);
  },
  async create({account:identity,clientId,current,confirmed}){
   return withSetupLock(workspace,async()=>{
   if(loadWorkspaceBinding(workspace,storage).kind!=='missing')throw Error('SETUP_BINDING_CHANGED');
   if(typeof initialize!=='function')throw Error('NATIVE_SETUP_UNAVAILABLE');
   if(!confirmed||!this.ownsNewWorkspace||kind!=='missing'||binding||!CLIENT.test(clientId))throw Error('NEW_WORKSPACE_SETUP_NOT_APPROVED');
   current();begin('workspace-explicit-setup');const old=read(storage,setupKey);
   if(old&&['account','clientId','workspaceId'].some(k=>old[k]!==({account:identity,clientId,workspaceId:workspace})[k]))throw Error('SETUP_IDENTITY_CHANGED');
   const journal=old??{account:identity,clientId,workspaceId:workspace,phase:'new'};
   if(journal.phase==='bootstrap-uncertain')throw Error('SETUP_OUTCOME_UNCERTAIN_PRESERVED_NO_BLIND_RETRY');
   const assert=()=>{current();if(binding||kind!=='missing'||loadWorkspaceBinding(workspace,storage).kind!=='missing')throw Error('SETUP_BINDING_CHANGED');};
   if(await account()!==identity)throw Error('ACCOUNT_CHANGED_NO_WRITE');assert();
   await withApprovedWorkspaceFolders({workspace,current:assert},async capability=>{
    const found=await list('InnoSage_BYOS_'+workspace);assert();
    if(found.length>1||found.some(f=>!validFolder(f)))throw Error('WORKSPACE_NAME_AMBIGUOUS');
    let root=found[0];
    if(root){if(!journal.rootId||root.id!==journal.rootId)throw Error('UNAPPROVED_EXISTING_DESTINATION');}
    else{
     if(journal.phase!=='new')throw Error('ROOT_WRITE_OUTCOME_UNCERTAIN_NO_BLIND_RETRY');
     const ids=await api('/drive/v3/files/generateIds',{count:'1',space:'drive',type:'files'});assert();if(!ids.ids?.[0])throw Error('SETUP_ID_UNAVAILABLE');
     journal.rootId=ids.ids[0];journal.phase='root-writing';storage.setItem(setupKey,JSON.stringify(journal));
     await api('/drive/v3/files',{fields:'id'},{id:journal.rootId,name:'InnoSage_BYOS_'+workspace,mimeType:FOLDER,parents:['root'],appProperties:{byos113:workspace}});assert();
     const confirmedRoots=await list('InnoSage_BYOS_'+workspace);assert();if(confirmedRoots.length!==1||!validFolder(confirmedRoots[0])||confirmedRoots[0].id!==journal.rootId)throw Error('SETUP_ROOT_NOT_CONFIRMED');root=confirmedRoots[0];
    }
    capability.setRoot(root.id);journal.phase='bootstrap-uncertain';storage.setItem(setupKey,JSON.stringify(journal));
    const initialized=await initialize({apiEndpoint:API,authToken:'ephemeral-managed',oauthClientId:clientId,space:'drive',folderPath:'InnoSage_BYOS_'+workspace,transactionTimeout:60000});assert();
    const candidate={account:identity,clientId,workspaceId:workspace,folderId:root.id};await pin(candidate,assert);await compatibleStructure(root.id,assert);assertDriveLayout(layout,initialized);assert();commit(candidate);journal.phase='complete';storage.setItem(setupKey,JSON.stringify(journal));
   });
   });
  }
 };
}

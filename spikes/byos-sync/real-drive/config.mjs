import {API,driveFetch,failure} from './transport.mjs';
const params=new URLSearchParams(location.search);
export const workspace=params.get('workspace');
export const bindingKey=`byos113-binding:${workspace}`;
export function clientId(){return localStorage.getItem('byos113-client-id')??'';}
export function setClientId(value){
 if(!/^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value))throw new Error('Invalid public OAuth Client ID');
 const old=JSON.parse(localStorage.getItem(bindingKey)??'null');
 if(old&&old.clientId!==value)throw new Error('This local workspace is bound to another OAuth client. Keep its identity and journals.');
 localStorage.setItem('byos113-client-id',value);
}
async function request(path,params={},body){
 const r=await driveFetch(API+path+'?'+new URLSearchParams(params),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
 if(!r.ok)throw failure(`DRIVE_HTTP_${r.status}`,r.status);
 return r.json();
}
export async function preflight({allowCreate=true,expectedBinding=null}={}){
 const assertBinding=()=>{
  const current=JSON.parse(localStorage.getItem(bindingKey)??'null');
  if(!allowCreate&&!current)throw new Error('Existing workspace binding required; folder creation disabled');
  if(expectedBinding&&(!current||['account','clientId','folderId'].some(key=>current[key]!==expectedBinding[key])||clientId()!==expectedBinding.clientId))throw new Error('Original workspace binding changed; no provider action permitted');
 };
 assertBinding();
 if(!/^[a-f0-9-]{36}$/.test(workspace??''))throw new Error('A dedicated workspace UUID is required');
 const id=clientId();if(!id)throw new Error('Configure public OAuth Client ID');
 const user=await request('/drive/v3/about',{fields:'user(permissionId)'});
 assertBinding();
 if(!user.user?.permissionId)throw new Error('Account identity unavailable');
 const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(user.user.permissionId)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const old=JSON.parse(localStorage.getItem(bindingKey)??'null');
 if(old&&(old.account!==account||old.clientId!==id))throw new Error('Account/client changed. Existing workspace and drafts retained; reconnect original account.');
 const name=`InnoSage_BYOS_${workspace}`;
 const query={q:`'root' in parents and name = '${name}' and trashed = false`,corpora:'user',spaces:'drive',pageSize:'100',fields:'nextPageToken,incompleteSearch,files(id,mimeType,driveId,ownedByMe,appProperties)'};
 const list=await request('/drive/v3/files',query);
 assertBinding();
 if(list.incompleteSearch||list.nextPageToken||!Array.isArray(list.files)||list.files.length>1)throw new Error('Workspace folder discovery incomplete or ambiguous');
 let folder=list.files[0];
 if(old&&!folder)throw new Error('Bound folder unavailable; preserve local identity and retry access');
 if(!folder&&!allowCreate)throw new Error('Existing folder unavailable; creation disabled');
 if(!folder){folder=await request('/drive/v3/files',{fields:'id,mimeType,driveId,ownedByMe,appProperties'},{name,mimeType:'application/vnd.google-apps.folder',parents:['root'],appProperties:{byos113:workspace}});
  const confirmed=await request('/drive/v3/files',query);
  if(confirmed.incompleteSearch||confirmed.nextPageToken||confirmed.files?.length!==1||confirmed.files[0].id!==folder.id)throw new Error('Concurrent folder initialization detected; local data retained. Initialize A before B.');
 }
 if(!folder.id||folder.driveId||!folder.ownedByMe||folder.mimeType!=='application/vnd.google-apps.folder'||folder.appProperties?.byos113!==workspace||(old&&old.folderId!==folder.id))throw new Error('Unsupported or changed folder; only this app-owned My Drive folder is allowed');
 assertBinding();
 localStorage.setItem(bindingKey,JSON.stringify({account,clientId:id,folderId:folder.id}));
 return {googleDrive:{apiEndpoint:API,authToken:'ephemeral-managed',oauthClientId:id,space:'drive',folderPath:name,transactionTimeout:60000}};
}

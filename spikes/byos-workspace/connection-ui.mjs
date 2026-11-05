import {authorize,forget,SCOPE,isAuthorized,beginExperiment,haltExperiment,experimentHealthy,experimentEvidence,onExperimentChange} from '../byos-sync/real-drive/transport.mjs';
import {CLIENT} from './workspace-connection.mjs';
export async function configureConnection(store,{changed=()=>{},snapshotLocal=()=>({})}={}){
 const connection=store.workspaceConnection;let epoch=0,discovery=null,busy=false,reloadRequired=false;
 const section=document.createElement('section');section.className='panel connection-panel';section.setAttribute('aria-label','Google Drive connection');
 const heading=document.createElement('h2');heading.textContent='Google Drive';
 const message=document.createElement('p');message.id='drive-connection-status';message.setAttribute('role','status');
 const info=document.createElement('p');info.textContent='Local editing works without Google. A workspace link does not carry a Google login or folder permission. Tokens stay in memory. Connect only when you choose to use Drive. The default OAuth app is currently in Testing and accepts only its approved test users. Other accounts need an eligible public OAuth client registered for this origin (Connection settings).';
 const clientLabel=document.createElement('label');clientLabel.textContent='Public Google OAuth client ID';
 const client=document.createElement('input');client.id='connection-client';client.type='text';client.value=connection.clientId;client.readOnly=connection.ready;clientLabel.append(client);
 const connect=document.createElement('button');connect.className='btn';connect.id='connect-drive';connect.textContent='Connect Google Drive';
 const disconnect=document.createElement('button');disconnect.className='btn';disconnect.textContent='Disconnect';
 const fresh=document.createElement('button');fresh.className='btn';fresh.textContent='New workspace for my Google account';fresh.id='new-account-workspace';
 const choices=document.createElement('select');choices.id='drive-workspace-choice';choices.setAttribute('aria-label','Compatible Drive workspace');
 const choose=document.createElement('button');choose.className='btn';choose.textContent='Use selected Drive workspace';
 const confirmLabel=document.createElement('label');const confirm=document.createElement('input');confirm.type='checkbox';confirm.id='confirm-new-drive-workspace';
 confirmLabel.append(confirm,document.createTextNode(` Create a new dedicated InnoSage_BYOS_${store.workspace} folder, its docs/signaling folders and native sync metadata. This does not upload page content; Sync is a separate action.`));
 const create=document.createElement('button');create.className='btn';create.textContent='Create dedicated Drive workspace';
 const reopen=document.createElement('button');reopen.className='btn';reopen.textContent='Open connected workspace';reopen.hidden=true;
 const detail=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Connection settings';detail.append(summary,clientLabel);
 section.append(heading,message,info,connect,disconnect,fresh,detail,choices,choose,confirmLabel,create,reopen);document.querySelector('main').prepend(section);
 function note(text){message.textContent=text;changed();}
 function controls(){connect.disabled=busy||!store.writer;fresh.disabled=busy||!!store.operation?.pending;choose.disabled=busy||!discovery||connection.ready;create.disabled=busy||!discovery||!connection.ownsNewWorkspace||connection.ready;choices.hidden=!discovery||connection.ready;choose.hidden=choices.hidden;confirmLabel.hidden=!connection.ownsNewWorkspace||connection.ready;create.hidden=confirmLabel.hidden;reopen.hidden=!reloadRequired;}
 function ready(){return connection.ready&&!reloadRequired;}
 function current(attempt){if(attempt!==epoch||!isAuthorized()||!store.writer)throw Error('CONNECTION_CHANGED_LOCAL_NOTES_RETAINED');}
 const noUnsavedNavigation=()=>{if(document.querySelector('#local-save-status')?.dataset.state==='pending'){note('Wait for the local save before opening another workspace. Your notes stay here.');return false;}return true;};
 function openWorkspace(id,prepared=false){if(!noUnsavedNavigation())return;const url=new URL(location.pathname,location.origin);url.searchParams.set('workspace',id);if(prepared)url.searchParams.set('prepared','1');location.assign(url);}
 fresh.onclick=()=>{if(busy||store.operation?.pending||!noUnsavedNavigation())return;const id=crypto.randomUUID();localStorage.setItem('byos142-new:'+id,JSON.stringify({workspaceId:id,createdAt:new Date().toISOString()}));if(CLIENT.test(client.value.trim()))localStorage.setItem('byos142-client:'+id,client.value.trim());openWorkspace(id);};
 reopen.onclick=()=>openWorkspace(store.workspace);
 client.oninput=()=>{if(connection.ready)return;epoch++;forget();discovery=null;controls();note('Client changed. Choose Connect Google Drive again; local notes are retained.');};
 connect.onclick=async()=>{
  if(busy||!store.writer)return;
  if(store.authorityUsed){note('Reload this workspace to renew or change authorization. Local notes are retained.');return;}
  const clientId=client.value.trim();if(!CLIENT.test(clientId)){note('Enter a public web OAuth client ID. Never enter a client secret. The client must allow this staging origin.');return;}
  if(connection.ready&&clientId!==connection.binding.clientId){note('This workspace is pinned to its original OAuth client. Use a new workspace for another client.');return;}
  const attempt=++epoch;discovery=null;forget();controls();
  try{
   if(!window.google?.accounts?.oauth2){await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.onload=resolve;script.onerror=()=>reject(Error('GOOGLE_SIGN_IN_LIBRARY_UNAVAILABLE'));document.head.append(script);});if(attempt!==epoch)return;connect.textContent='Continue with Google';note('Google sign-in is ready. Click Continue with Google to choose your account and review Google consent.');return;}
   const oauth=window.google.accounts.oauth2;
   const token=oauth.initTokenClient({client_id:clientId,scope:SCOPE,include_granted_scopes:false,callback:async response=>{
    if(attempt!==epoch)return;
    if(store.authorityUsed||response.error||!oauth.hasGrantedAllScopes(response,SCOPE)){forget();note('Google authorization was not completed. Local editing and saved notes remain available.');return;}
    try{
     authorize(response.access_token,Number(response.expires_in));busy=true;controls();
     const result=await connection.discover(clientId,()=>current(attempt));current(attempt);
     if(connection.ready&&result.account!==connection.binding.account)throw Error('WRONG_GOOGLE_ACCOUNT_ORIGINAL_WORKSPACE_RETAINED');
     discovery=result;choices.textContent='';for(const folder of result.folders){const option=document.createElement('option');option.value=folder.workspaceId;option.textContent=folder.name;choices.append(option);}
     if(connection.ready){store.state='pending';store.notify();note('Drive authorization ready for this pinned workspace. Page content is not yet independently verified; use Sync or the prepared experiment.');}
     else note(`Google account ${result.account.slice(0,8)} selected. ${result.folders.length} compatible app workspaces found. Choose one, or open a new workspace to create your own dedicated Drive folder. No folder or page has been created or uploaded.`);
    }catch(error){if(attempt!==epoch)return;forget();discovery=null;note('Connection paused: '+error.message+'. Local notes retained. Google may require an eligible OAuth app/test account or registered origin; no provider settings were changed.');}
    finally{if(attempt===epoch){busy=false;controls();changed();}}
   },error_callback:()=>{if(attempt!==epoch)return;forget();discovery=null;busy=false;controls();note('Google authorization cancelled or unavailable. Local editing still works.');}});
   token.requestAccessToken({prompt:'select_account'});
  }catch(error){if(attempt===epoch)note('Connection unavailable: '+error.message+'. Local editing still works.');}
 };
 disconnect.onclick=()=>{epoch++;forget();discovery=null;busy=false;store.state='reauth-required';controls();store.notify();void store.disconnect().catch(()=>{});note('Disconnected. Local notes and pinned destination are retained. Reload before connecting again.');};
 choose.onclick=async()=>{
  if(busy||!discovery||connection.ready)return;const candidate=discovery.folders.find(f=>f.workspaceId===choices.value);if(!candidate)return;
  if(candidate.workspaceId!==store.workspace){note('Opening another workspace keeps local notes in this browser under the current link. Connect again there to confirm the selected destination.');openWorkspace(candidate.workspaceId);return;}
  const attempt=epoch,initial=snapshotLocal();busy=true;controls();
  const selectionCurrent=()=>{current(attempt);const now=snapshotLocal();if(now.dirty||now.pending||['inputEpoch','databaseEpoch','localMutationEpoch'].some(k=>now[k]!==initial[k]))throw Error('LOCAL_STATE_CHANGED_DURING_CONNECTION');};
  const emptyNow=async()=>!(await store.db.pages.count().exec())&&!(await store.db.localDrafts.count().exec());
  try{selectionCurrent();const empty=await emptyNow();selectionCurrent();await connection.select(candidate,{empty,current:selectionCurrent,emptyNow});reloadRequired=true;note('Existing app workspace selected and identity checked. Open connected workspace, then reconnect to receive its pages. No page content was uploaded.');}
  catch(error){note('Destination not attached: '+error.message+'. Existing local notes retained.');}finally{busy=false;controls();changed();}
 };
 create.onclick=async()=>{
  if(busy||!discovery||connection.ready)return;if(!confirm.checked){note('Confirm the exact dedicated folder and native metadata creation first.');return;}
  const attempt=epoch;busy=true;controls();store.authorityUsed=true;
  try{await connection.create({...discovery,confirmed:confirm.checked,current:()=>current(attempt)});current(attempt);store.state='pending';store.notify();note('Dedicated Drive workspace created and pinned. Local pages have not been uploaded. Sync explicitly, or prepare the 26-page demo separately.');}
  catch(error){note('Setup paused: '+error.message+'. Local notes and setup identity retained; no blind folder retry. Reload to inspect or reconnect.');}finally{busy=false;controls();changed();}
 };
 document.getElementById('offline-badge').textContent='LOCAL EDITOR · GOOGLE DRIVE CONNECTS ONLY WITH YOUR CONSENT';
 note(connection.kind==='invalid'?'Local only — saved connection metadata is invalid or incomplete. It was preserved. Use the original browser to recover that workspace, or start a new workspace for your account.':connection.ready?'Local editor ready. Pinned Drive workspace needs Google authorization; no cloud request has started.':'Local only — Google Drive is not connected in this browser. Click New root to write locally. To see another device’s Drive pages, connect and select its compatible workspace; a link alone does not grant access.');controls();
 return {real:true,localAutosave:true,get bindingReady(){return ready();},get managedConnection(){return connection.kind==='managed';},canSync:()=>ready()&&isAuthorized(),canInitializeDemo:()=>ready()&&connection.kind==='managed'&&connection.ownsNewWorkspace,assertEmptyDrive:()=>{const attempt=epoch;return connection.assertEmptyDocs(()=>current(attempt));},prepared:store.preparedController??null,beginExperiment,haltExperiment,experimentHealthy,experimentEvidence,onExperimentChange};
}

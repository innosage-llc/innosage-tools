// Explicit build-only route. Never selected by a query parameter.
export {openBoundRealStore as openPageStore} from './real-store.mjs';
import {clientId,workspace,bindingKey} from '../byos-sync/real-drive/config.mjs';
import {authorize,forget,SCOPE,isAuthorized,beginExperiment,haltExperiment,experimentHealthy,experimentEvidence,onExperimentChange} from '../byos-sync/real-drive/transport.mjs';

/** Same existing #113 OAuth flow/scope; a pre-existing binding is mandatory. */
export async function configureProvider(store, {changed=()=>{}} = {}) {
  const binding=JSON.parse(localStorage.getItem(bindingKey)??'null');
  if(!binding?.folderId||binding.clientId!==clientId()) throw new Error('Original approved account/folder binding unavailable');
  const section=document.createElement('section');section.className='panel';
  const label=document.createElement('label');const check=document.createElement('input');check.type='checkbox';
  label.append(check,document.createTextNode(' Use only the existing approved disposable account, workspace and folder. No new account/folder/permission grant.'));
  const button=document.createElement('button');button.textContent='Reauthorize existing test account';button.className='btn';
  const disconnect=document.createElement('button');disconnect.textContent='Disconnect';disconnect.className='btn';
  const message=document.createElement('p');message.setAttribute('role','status');message.textContent='Not authorized. Local editing works. Existing folder binding required for every cloud action.';
  section.append(label,button,disconnect,message);document.querySelector('main').prepend(section);
  let authorizationEpoch=0;
  button.onclick=async()=>{
    if(!check.checked){message.textContent='Confirm the existing approved disposable test account first.';return;}
    if(store.authorityUsed){message.textContent='Reload to reauthorize; existing local data and identity are retained.';return;}
    const attempt=++authorizationEpoch;
    try{
      const current=JSON.parse(localStorage.getItem(bindingKey)??'null');
      if(!current||['account','clientId','folderId'].some(key=>current[key]!==binding[key])||clientId()!==binding.clientId)throw new Error('Original binding changed; stop and restore original context.');
      if(!window.google?.accounts?.oauth2){
        await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.onload=resolve;script.onerror=()=>reject(new Error('Existing sign-in library unavailable'));document.head.append(script);});
        message.textContent='Sign-in ready. Click again to reauthorize the existing account only.';return;
      }
      const oauth=window.google.accounts.oauth2;
      const token=oauth.initTokenClient({client_id:binding.clientId,scope:SCOPE,include_granted_scopes:false,
        callback:response=>{
          if(attempt!==authorizationEpoch)return;
          if(store.authorityUsed||response.error||!oauth.hasGrantedAllScopes(response,SCOPE)){
            forget();message.textContent='Authorization unavailable; local drafts retained.';changed();return;
          }
          try{authorize(response.access_token,Number(response.expires_in));store.state='pending';store.notify();message.textContent='Authorized in memory. Every cloud action checks the original account/client/folder. Foreground sync requires explicit opt-in.';changed();}
          catch{forget();message.textContent='Authorization incomplete; local drafts retained.';changed();}
        },error_callback:()=>{if(attempt!==authorizationEpoch)return;message.textContent='Authorization cancelled/unavailable; local drafts retained.';}});
      token.requestAccessToken({prompt:'select_account'});
    }catch(error){message.textContent=error.message;}
  };
  disconnect.onclick=()=>{authorizationEpoch++;forget();store.state='reauth-required';store.notify();message.textContent='Disconnected; local drafts retained. Reload to reauthorize original account.';changed();void store.disconnect().catch(()=>{});};
  document.getElementById('offline-badge').textContent='REAL DRIVE CANDIDATE — EXISTING APPROVED DISPOSABLE WORKSPACE ONLY';
  return {real:true,workspace,prepared:store.preparedController??null,canSync:isAuthorized,beginExperiment,haltExperiment,experimentHealthy,experimentEvidence,onExperimentChange};
}

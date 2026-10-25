import '../native-overlay/browser-runtime.mjs';
import {authorize,forget,isAuthorized} from './transport.mjs';
import {clientId,setClientId,store,snapshot,workspace} from './store.mjs';
// Durable nonsecret writer identity; duplicate tabs are refused by existing
// Web Locks. A fresh profile has a distinct identity and IndexedDB database.
const url=new URL(location.href);
if(!/^[a-f0-9-]{36}$/.test(workspace??'')){
 url.searchParams.set('workspace',crypto.randomUUID());location.replace(url);
}else{
 url.searchParams.delete('endpoint');
 const key=`byos113-session:${workspace}`;
 let session=localStorage.getItem(key);
 if(!session){session=crypto.randomUUID();localStorage.setItem(key,session);}
 url.searchParams.set('session',session);history.replaceState(null,'',url);
 await import('../native-overlay/ui.mjs');
 // Existing controller is reused; do not expose credential-bearing native state.
 delete window.spike.store;
 window.byos={snapshot};
 const client=document.getElementById('oauth-client');client.value=clientId();
 const message=document.getElementById('connection-status');
 document.getElementById('workspace-link').textContent=location.origin+location.pathname+'?workspace='+workspace;
 document.getElementById('authorize-btn').onclick=async()=>{
  if(!document.getElementById('test-account').checked){message.textContent='Confirm the dedicated disposable test account first.';return;}
  if(store().authorityUsed){message.textContent='Reload this page to reauthorize. Local content and identity are retained.';return;}
  try{
   setClientId(client.value.trim());
   if(!window.google?.accounts?.oauth2){await new Promise((resolve,reject)=>{
    const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.onload=resolve;s.onerror=()=>reject(new Error('Google sign-in library unavailable'));document.head.append(s);
   });message.textContent='Google sign-in is ready. Click Authorize test account again to open consent.';return;}
   const oauth=window.google.accounts.oauth2;
   const tokenClient=oauth.initTokenClient({client_id:clientId(),scope:'https://www.googleapis.com/auth/drive.file',include_granted_scopes:false,
    callback:async response=>{
     try{
      if(store().authorityUsed)throw new Error('Reload required before replacing authorization');
      if(response.error||!oauth.hasGrantedAllScopes(response,'https://www.googleapis.com/auth/drive.file'))throw new Error('Drive file permission not granted');
      authorize(response.access_token,Number(response.expires_in));
      store().state='pending';store().notify();message.textContent='Authorized in memory. Sync explicitly to create/use the isolated test folder.';
     }catch{forget();message.textContent='Authorization incomplete; local drafts retained.';}
    },error_callback:()=>{message.textContent='Authorization cancelled or unavailable; local drafts retained.';}});
   tokenClient.requestAccessToken({prompt:'select_account'});
  }catch(e){message.textContent=e.message;}
 };
 document.getElementById('disconnect-btn').onclick=()=>{forget();store().state='reauth-required';store().notify();message.textContent='Disconnected. Reload and reauthorize to sync; local content and identity are retained.';void store().disconnect().catch(()=>{});};
 setInterval(()=>{if(!isAuthorized()&&store().replication){store().state='reauth-required';store().notify();}},1000);
}

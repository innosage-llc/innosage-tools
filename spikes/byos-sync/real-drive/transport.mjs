import {readVersionedMedia} from './media-validator.mjs';
// Build-time fetch injection for the isolated demo bundle only. Native replication
// and its transaction/CAS code are unchanged. No bearer enters native options.
export const API='https://www.googleapis.com';
export const SCOPE='https://www.googleapis.com/auth/drive.file';
let token=null,expires=0,deadline=0,count=0;
const observations=[];
export function authorize(value,seconds){
 if(typeof value!=='string'||!value||!Number.isFinite(seconds)||seconds<=0)throw new Error('AUTH_INVALID');
 token=value;expires=Date.now()+seconds*1000;
}
export function forget(){token=null;expires=0;}
export function isAuthorized(){return !!token&&Date.now()<expires;}
export function begin(){deadline=Date.now()+180000;count=0;}
export function evidence(){return {authorized:isAuthorized(),requests:observations.slice(),operationRequests:count};}
export function failure(code,status){const e=new Error(code);e.parameters={status};return e;}
export async function driveFetch(input,init={}){
 const url=new URL(typeof input==='string'?input:input.url);
 if(url.origin!==API) return globalThis.fetch(input,init);
 if((init.method??'GET')==='GET'&&/^\/drive\/v2\/files\/[^/]+$/.test(url.pathname)&&url.searchParams.get('alt')==='media')return readVersionedMedia(url,init,dispatch);
 return dispatch(url,init);
}
async function dispatch(url,init={}){
 if(!isAuthorized())throw failure('REAUTHORIZE_REQUIRED',401);
 if(Date.now()>deadline||count>=1000)throw failure('REQUEST_BUDGET_EXHAUSTED',429);
 count++;
 const headers=new Headers(init.headers);headers.set('Authorization',`Bearer ${token}`);
 const method=init.method??'GET';
 const row={method,path:url.pathname.replace(/\/files\/[^/]+/g,'/files/<id>'),status:null,pageTokenPresent:url.searchParams.has('pageToken'),alt:url.searchParams.get('alt'),revisionIdPresent:url.searchParams.has('revisionId'),fields:url.searchParams.get('fields'),spaces:url.searchParams.get('spaces'),corpora:url.searchParams.get('corpora')};
 observations.push(row);if(observations.length>2000)observations.shift();
 try{
  const r=await globalThis.fetch(url,{...init,headers,redirect:'error',signal:AbortSignal.timeout(20000)});
  row.status=r.status;row.etagVisible=r.headers.has('ETag');row.dateVisible=r.headers.has('Date');
  if(r.ok&&['/drive/v3/files','/drive/v3/changes'].includes(url.pathname)&&method==='GET'){const data=await r.clone().json();row.page={files:data.files?.length,changes:data.changes?.length,nextPageToken:!!data.nextPageToken,newStartPageToken:!!data.newStartPageToken,incompleteSearch:data.incompleteSearch===true};}
  if(r.status===401){forget();throw failure('REAUTHORIZE_REQUIRED',401);}
  return r;
 }catch(e){row.status??='NETWORK_ERROR';throw e;}
}
export {driveFetch as fetch};

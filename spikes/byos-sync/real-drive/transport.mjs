import {readVersionedMedia} from './media-validator.mjs';
import {metadataSummary} from './diagnostics.mjs';
// Build-time fetch injection for the isolated demo bundle only. Native replication
// and its transaction/CAS code are unchanged. No bearer enters native options.
export const API='https://www.googleapis.com';
export const SCOPE='https://www.googleapis.com/auth/drive.file';
let token=null,expires=0,deadline=0,count=0;
const observations=[];
const fileAliases=new Map();
let requestSequence=0,operationId=null,operationStart=0,progress=()=>{};
export function onProgress(callback){progress=callback;}
export function authorize(value,seconds){
 if(typeof value!=='string'||!value||!Number.isFinite(seconds)||seconds<=0)throw new Error('AUTH_INVALID');
 token=value;expires=Date.now()+seconds*1000;
}
export function forget(){token=null;expires=0;}
export function isAuthorized(){return !!token&&Date.now()<expires;}
export function begin(id=null){deadline=Date.now()+180000;count=0;operationId=id;operationStart=performance.now();}
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
 const fileId=url.pathname.match(/\/files\/([^/]+)$/)?.[1];
 if(fileId&&!fileAliases.has(fileId)&&fileAliases.size<2000)fileAliases.set(fileId,`file-${fileAliases.size+1}`);
 const clockOrigin=operationStart;
 const row={operationId,startedMs:performance.now()-clockOrigin,sequence:++requestSequence,fileAlias:fileId?(fileAliases.get(fileId)??'untracked'):null,method,path:url.pathname.replace(/\/files\/[^/]+/g,'/files/<id>'),status:null,pageTokenPresent:url.searchParams.has('pageToken'),alt:url.searchParams.get('alt'),revisionIdPresent:url.searchParams.has('revisionId'),fields:url.searchParams.get('fields'),spaces:url.searchParams.get('spaces'),corpora:url.searchParams.get('corpora')};
 observations.push(row);if(observations.length>2000)observations.shift();progress(count);
 try{
  const r=await globalThis.fetch(url,{...init,headers,redirect:'error',signal:AbortSignal.timeout(20000)});
  row.headersMs=performance.now()-clockOrigin;row.status=r.status;row.etagVisible=r.headers.has('ETag');row.dateVisible=r.headers.has('Date');
  if(r.ok&&method==='GET'&&/^\/drive\/v2\/files\/[^/]+$/.test(url.pathname)&&!url.searchParams.has('alt')){
   try{row.metadataValidators=metadataSummary(r.headers.get('ETag'),await r.clone().json());}catch{row.metadataValidators={unavailable:true};}
  }
  if(r.ok&&['/drive/v3/files','/drive/v3/changes'].includes(url.pathname)&&method==='GET'){const data=await r.clone().json();row.page={files:data.files?.length,changes:data.changes?.length,nextPageToken:!!data.nextPageToken,newStartPageToken:!!data.newStartPageToken,incompleteSearch:data.incompleteSearch===true};}
  if(r.status===401){forget();throw failure('REAUTHORIZE_REQUIRED',401);}
  return timedBody(r,row,clockOrigin);
 }catch(e){row.endedMs=performance.now()-clockOrigin;row.status??='NETWORK_ERROR';throw e;}
}
function timedBody(response,row,clockOrigin){
 return new Proxy(response,{get(target,key){
  if(key==='clone')return ()=>timedBody(target.clone(),row,clockOrigin);
  const value=Reflect.get(target,key,target);
  if(['json','text','arrayBuffer','blob','formData','bytes'].includes(key)&&typeof value==='function')return async(...args)=>{
   try{return await value.apply(target,args);}finally{row.bodyCompletedMs=performance.now()-clockOrigin;}
  };
  return typeof value==='function'?value.bind(target):value;
 }});
}
export {driveFetch as fetch};

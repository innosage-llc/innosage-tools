import {completeRecord,validEtag,protocolError} from './prepared-wal.mjs';

const MAX_BYTES=8*1024*1024;
const sha256=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
/**
 * Single-attempt IO, injected with the existing in-memory-authorized transport.
 * `fetchOnce` MUST be the bounded raw request path, not another retry wrapper.
 * It calls preparedGuard immediately before physical fetch and calls
 * preparedOnDispatched only after invoking that fetch (no intervening observer).
 * File descriptors are frozen from the approved existing-folder inventory.
 */
export function createPreparedDriveIO({apiEndpoint,fetchOnce,files,assertCanRequest,assertCanWrite,now=()=>performance.now(),event=()=>{},phase=()=> 'preparation',identify=()=>({})}) {
  const origin=new URL(apiEndpoint).origin;
  const bindings=new Map([...files].map(([id,value])=>[id,Object.freeze({...value})]));
  const descriptor=id=>{
    const value=bindings.get(id);
    if(!value||!['page','wal','lease'].includes(value.role)||!value.name||!value.parentId)throw protocolError('UNAPPROVED_FILE');
    return value;
  };
  const raw=async(id,{method='GET',media=false,revisionId,body,etag,beforeDispatch,onDispatched,annotation={}}={})=>{
    const binding=descriptor(id);
    const url=new URL((method==='PUT'?'/upload':'')+'/drive/v2/files/'+encodeURIComponent(id),origin);
    if(method==='PUT'){url.searchParams.set('uploadType','media');url.searchParams.set('fields','id');}
    else if(media){url.searchParams.set('alt','media');if(revisionId)url.searchParams.set('revisionId',revisionId);}
    else url.searchParams.set('fields','id,title,parents,mimeType,fileSize,etag,version,headRevisionId,modifiedDate');
    url.searchParams.set('supportsAllDrives','true');
    const headers={'Accept':'application/json'};
    if(method==='PUT'){
      if(!validEtag(etag))throw protocolError('INVALID_CAS_VALIDATOR');
      headers['If-Match']=etag;headers['Content-Type']='application/json; charset=UTF-8';
    }
    const request={method,headers,cache:'no-store',redirect:'error',...(method==='PUT'?{body}: {})};
    assertCanRequest();
    const started={...annotation,type:method==='PUT'&&binding.role==='page'?'page-put-start':'request-start',phase:phase(),role:binding.role,method};
    // Observation may reenter. The gates run AFTER it, at the physical boundary.
    event({...started,type:'request-admission',atMs:now()});
    let dispatched=false;
    request.preparedGuard=()=>{assertCanRequest();if(method==='PUT'){assertCanWrite(binding,id);beforeDispatch?.();}};
    request.preparedOnDispatched=()=>{dispatched=true;const receipt={...started,atMs:now()};onDispatched?.(receipt);event(receipt);};
    request.preparedTrace={role:binding.role,phase:started.phase,...annotation};
    request.preparedGuard();
    let response;
    try{response=await fetchOnce(url.toString(),request);}
    catch(cause){
      if(!dispatched){event({...started,type:'request-cancelled',atMs:now(),reason:cause.code??cause.message});throw cause;}
      event({...started,type:'request-error',atMs:now(),category:'network',uncertain:method==='PUT'});throw Object.assign(protocolError('REQUEST_OUTCOME_UNCERTAIN',{cause}),{network:true,ambiguous:method==='PUT'});
    }
    if(!dispatched)throw protocolError('MISSING_PHYSICAL_DISPATCH_RECEIPT');
    event({...started,type:method==='PUT'&&binding.role==='page'?'page-put-response':'request-response',atMs:now(),status:response.status});
    if(!response.ok){
      let reason;try{const data=await response.clone().json();reason=data?.error?.errors?.[0]?.reason??data?.error?.status;}catch{}
      throw Object.assign(protocolError('DRIVE_HTTP_'+response.status),{status:response.status,reason,retryAfter:response.headers.get('Retry-After')??undefined});
    }
    return response;
  };
  const readFile=async id=>{
    const binding=descriptor(id);
    const metadataResponse=await raw(id);let metadata;
    try{metadata=await metadataResponse.json();}catch{throw protocolError('INVALID_FILE_METADATA');}
    if(metadata.id!==id||metadata.title!==binding.name||metadata.mimeType!=='application/json'||
      !Array.isArray(metadata.parents)||!metadata.parents.some(parent=>parent.id===binding.parentId)||
      !validEtag(metadata.etag)||typeof metadata.version!=='string'||!/^\d+$/.test(metadata.version)||
      typeof metadata.fileSize!=='string'||!/^\d+$/.test(metadata.fileSize)||BigInt(metadata.fileSize)>BigInt(MAX_BYTES)||
      (metadata.fileSize!=='0'&&!(typeof metadata.headRevisionId==='string'&&metadata.headRevisionId.length)))throw protocolError('FILE_BINDING_OR_VERSION_INVALID');
    const response=await raw(id,{media:true,revisionId:metadata.headRevisionId});let bytes;
    try{bytes=await response.arrayBuffer();}catch(cause){throw Object.assign(protocolError('READ_BODY_UNCERTAIN',{cause}),{network:true});}
    if(BigInt(bytes.byteLength)!==BigInt(metadata.fileSize))throw protocolError('REVISION_BODY_SIZE_MISMATCH');
    let value;try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);value=text.length?JSON.parse(text):null;}catch{throw protocolError('INVALID_FILE_CONTENT');}
    return {value,etag:metadata.etag,version:metadata.version,revision:metadata.headRevisionId??null,
      serverDateMs:Date.parse(metadataResponse.headers.get('Date')),modifiedDateMs:Date.parse(metadata.modifiedDate)};
  };
  const putFile=async(id,etag,value,{beforeDispatch,onDispatched,annotation={}}={})=>{
    const binding=descriptor(id);
    let target=value;
    if(binding.role==='page'){
      target=completeRecord(value);
      if(target.id!==binding.pageId)throw protocolError('PAGE_FILE_BINDING_MISMATCH');
    }
    const text=target===null?'':JSON.stringify(target);
    if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>MAX_BYTES)throw protocolError('INVALID_WRITE_BODY');
    const bodyHash=await sha256(text);
    const attribution=binding.role==='page'?{page:target.id,editId:target.editId,...identify(target),bodyHash}:{};
    const response=await raw(id,{method:'PUT',body:text,etag,beforeDispatch,onDispatched,annotation:{...annotation,...attribution}});
    let ack;try{ack=await response.json();}catch(cause){throw Object.assign(protocolError('WRITE_ACK_UNCERTAIN',{cause}),{ambiguous:true});}
    if(response.status!==200||ack.id!==id)throw Object.assign(protocolError('WRITE_ACK_IDENTITY_MISMATCH'),{ambiguous:true});
    return {status:response.status,bodyHash};
  };
  return {
    readFile,putFile,
    async readPage(id){const binding=descriptor(id);if(binding.role!=='page')throw protocolError('NOT_A_PAGE_FILE');const result=await readFile(id);const record=completeRecord(result.value);if(record.id!==binding.pageId)throw protocolError('PAGE_FILE_BINDING_MISMATCH');return {...result,record};},
    writePage:(id,etag,target,options)=>putFile(id,etag,target,options),
    assertCanWrite,
  };
}

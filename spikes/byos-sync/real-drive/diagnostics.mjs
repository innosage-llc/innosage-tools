// Diagnostic outputs are allowlists, never raw errors, metadata or validators.
const strong=value=>typeof value==='string'&&/^"[\x21\x23-\x7e\x80-\xff]+"$/.test(value);
const messages=new Set(['MEDIA_METADATA_UNSUPPORTED','MEDIA_RANGE_UNSUPPORTED','MEDIA_REVISION_NOT_CURRENT','MEDIA_SIZE_MISMATCH','MEDIA_VERSION_CHANGED','SYNC_BUDGET_EXHAUSTED','REQUEST_BUDGET_EXHAUSTED','REAUTHORIZE_REQUIRED']);
export function metadataSummary(header,body){
 const json=body?.etag;
 return {httpPresent:typeof header==='string',jsonPresent:typeof json==='string',httpStrong:strong(header),jsonStrong:strong(json),equal:typeof header==='string'&&typeof json==='string'?header===json:null,
  shape:{id:typeof body?.id==='string',version:typeof body?.version==='string'&&/^\d+$/.test(body.version),size:typeof body?.fileSize==='string'&&/^\d+$/.test(body.fileSize),zeroSize:body?.fileSize==='0',revision:typeof body?.headRevisionId==='string'&&!!body.headRevisionId,jsonMime:body?.mimeType==='application/json'}};
}
export function errorSummary(error,depth=0){
 const code=typeof error?.code==='string'&&/^(GDR\d{1,2}|RC_PULL|RC_PUSH|RC_START|RC_PUSH_AWAIT|SNH)$/.test(error.code)?error.code:messages.has(error?.message)?error.message:error?.name==='TypeError'?'NETWORK_TYPE_ERROR':'UNKNOWN';
 const p=error?.parameters;
 const status=[p?.status,p?.response?.status,p?.args?.status].find(v=>Number.isInteger(v)&&v>=100&&v<=599)??null;
 const direction=['pull','push'].includes(p?.direction)?p.direction:null;
 return {code,status,direction,nested:depth<2&&Array.isArray(p?.errors)?p.errors.slice(0,4).map(e=>errorSummary(e,depth+1)):[]};
}

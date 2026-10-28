import {conditionalUpload} from './conditional-upload.mjs';
import {protocolError,validEtag} from './prepared-wal.mjs';

// Object order is immaterial, but every property/array element is retained.
function canonical(value) {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
export const sameJson=(a,b)=>canonical(a)===canonical(b);

/** Exact snapshot-bound mutation for the existing WAL/lease, with one retry owner. */
export async function conditionalFileMutation({fileId,snapshot,target,io,canDispatch,budget,clock,onState,policy}) {
  if(!validEtag(snapshot?.etag))throw protocolError('INVALID_FILE_SNAPSHOT');
  // Freeze before any observer/await; subsequent caller mutation has no effect.
  const row={fileId,expectedEtag:snapshot.etag,base:structuredClone(snapshot.value),target:structuredClone(target)};
  const result=await conditionalUpload({row,canDispatch,budget,clock,onState,policy,recordsEqual:sameJson,io:{
    async readPage(id){const observed=await io.readFile(id);if(!validEtag(observed.etag))throw protocolError('INVALID_FILE_SNAPSHOT');return {...observed,record:observed.value};},
    writePage:(id,etag,value,options)=>io.putFile(id,etag,value,options),
  }});
  return {...result.observed,value:result.observed.record};
}

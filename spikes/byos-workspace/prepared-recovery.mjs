import {validateWal,auditLegacyRow,sameRecord,recoveryDecision,protocolError} from './prepared-wal.mjs';
import {conditionalUpload} from './conditional-upload.mjs';
import {conditionalFileMutation} from './prepared-mutation.mjs';

async function boundedMap(values,fn){
  const results=[];
  for(let offset=0;offset<values.length;offset+=5){
    // Drain every started request before surfacing a failure. Promise.all alone
    // would abandon sibling writes when the first one rejects.
    const settled=await Promise.allSettled(values.slice(offset,offset+5).map(fn));
    for(const item of settled)if(item.status==='fulfilled')results.push(item.value);
    const failed=settled.find(item=>item.status==='rejected');if(failed)throw failed.reason;
  }
  return results;
}

/** Recovery is a separate measured phase, never a formal A–Z sample or journal ACK.
 * Caller holds the same native transaction lease and closes all other entrypoints.
 * Existing arrays are audited before any mutation; no native fresh-ETag replay.
 */
export async function recoverTransactionWal({snapshot,fileId,context,io,budget,clock,canDispatch,onState=()=>{},policy}) {
  if(snapshot.value===null)return {recovered:0,snapshot};
  let rows;
  if(Array.isArray(snapshot.value)){
    if(snapshot.value.length>26)throw protocolError('LEGACY_WAL_OUTSIDE_BOUNDED_FIXTURE');
    const seen=new Set();
    for(const row of snapshot.value){const id=row?.newDocumentState?.id;if(seen.has(id))throw protocolError('LEGACY_WAL_IDENTITY_INVALID');seen.add(id);}
    rows=await boundedMap(snapshot.value,async(row)=>{
      const id=row?.newDocumentState?.id,binding=context.fileIds.get(id);
      if(!context.allowedIds.has(id)||!binding)throw protocolError('LEGACY_WAL_IDENTITY_INVALID');
      const observed=await io.readPage(binding);
      return auditLegacyRow(row,observed,binding,snapshot.value.indexOf(row)+1,context.allowedIds,context.fileIds);
    });
  }else rows=validateWal(snapshot.value,context).rows;
  // Validate all complete records first. Every later mutation retains its
  // original validator; an intervening edit is a conflict, not a fresh baseline.
  const plans=await boundedMap(rows,async row=>{
    const observed=await io.readPage(row.fileId),decision=recoveryDecision(row,observed);
    if(decision==='conflict')throw protocolError('RECOVERY_CONFLICT',{row,observed});
    return {row,decision};
  });
  await boundedMap(plans,async({row,decision})=>{
    if(decision==='already-applied')return;
    await conditionalUpload({row,io:{readPage:id=>io.readPage(id),writePage:(id,etag,value,options)=>io.writePage(id,etag,value,{...options,annotation:{generation:row.generation}})},budget,clock,canDispatch,policy,onState:state=>onState({phase:'recovery',...state})});
  });
  await boundedMap(rows,async row=>{
    const observed=await io.readPage(row.fileId);
    if(!sameRecord(observed.record,row.target))throw protocolError('RECOVERY_READBACK_MISMATCH',{row,observed});
  });
  const cleared=await conditionalFileMutation({fileId,snapshot,target:null,io,budget,clock,canDispatch,policy,onState:state=>onState({phase:'recovery-clear',...state})});
  return {recovered:rows.length,snapshot:cleared,rows};
}

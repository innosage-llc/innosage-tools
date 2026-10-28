import {conditionalUpload} from './conditional-upload.mjs';
import {conditionalFileMutation,sameJson} from './prepared-mutation.mjs';
import {WAL_FORMAT,WAL_VERSION,validateWal,validateIntent,completeRecord,sameRecord,validEtag,protocolError} from './prepared-wal.mjs';

/**
 * One already elected owner. Admission must pause AND drain the native owner,
 * freeze inventory, and keep its runOperation gate closed for this session.
 * This module neither creates a native owner nor modifies native checkpoints.
 */
export class PreparedSession {
  constructor({workspace,runId,baselines,wal,lease,io,budget,clock,reconcile,retire,event=()=>{},policy,leaseMs=60000,requestMs=20000}) {
    if(!(baselines instanceof Map)||baselines.size!==26)throw protocolError('INVALID_PREPARED_FIXTURE');
    this.baselines=new Map([...baselines].map(([id,value])=>[id,structuredClone(value)]));
    this.context={workspace,allowedIds:new Set(baselines.keys()),fileIds:new Map([...baselines].map(([id,b])=>[id,b.fileId]))};
    for(const [id,b] of this.baselines){if(completeRecord(b.record).id!==id||!validEtag(b.etag))throw protocolError('INVALID_PREPARED_BASELINE');}
    if(!validEtag(wal?.etag)||!validEtag(lease?.etag)||!wal.fileId||!lease.fileId||wal.fileId===lease.fileId||
      this.context.fileIds.size!==new Set(this.context.fileIds.values()).size||
      [...this.context.fileIds.values()].some(id=>id===wal.fileId||id===lease.fileId))throw protocolError('INVALID_PREPARED_BINDINGS');
    if(wal.value!==null&&(!Array.isArray(wal.value)||wal.value.length))throw protocolError('WAL_RECOVERY_REQUIRED');
    if(!Number.isFinite(lease.acquiredAt)||lease.acquiredAt>clock.now()||!lease.value||Array.isArray(lease.value))throw protocolError('INVALID_PREPARED_LEASE');
    Object.assign(this,{workspace,runId,io,budget,clock,reconcile,retire,event,policy,leaseMs,requestMs});
    this.wal=structuredClone(wal);this.lease=structuredClone(lease);this.rows=new Map();this.confirmed=new Map();this.attempted=new Map();this.inflight=new Set();this.protecting=false;this.finishing=false;this.finished=false;this.halted=null;
    // Start the conservative lease clock BEFORE its acquisition request, not at
    // its response. In-flight aborts are not proof of server-side cancellation.
    this.writeUntil=lease.acquiredAt+leaseMs-requestMs;
    validateWal({format:WAL_FORMAT,version:WAL_VERSION,workspace,runId,rows:[]},this.context);
  }
  baseline(id){const baseline=this.baselines.get(id);if(!baseline)throw protocolError('UNAPPROVED_PAGE');return structuredClone(baseline);}
  assertWrite(){this.budget.assertCanRequest();if(this.halted||this.finished||this.clock.now()>=this.writeUntil)throw protocolError(this.halted?'PREPARED_SESSION_HALTED':'LEASE_WRITE_WINDOW_EXHAUSTED');}
  remainingMs(){return Math.min(this.budget.remainingMs(),this.writeUntil-this.clock.now());}
  mutationBudget(){return {assertCanRequest:()=>this.assertWrite(),remainingMs:()=>this.remainingMs()};}
  async protect(rows,current=()=>true){
    this.assertWrite();if(this.protecting||this.finishing||this.inflight.size&&rows.some(row=>this.inflight.has(row.target.id)&&!sameJson(this.rows.get(row.target.id),row)))throw protocolError('WAL_PROTECTION_OVERLAP');
    const wal=validateWal({format:WAL_FORMAT,version:WAL_VERSION,workspace:this.workspace,runId:this.runId,rows},this.context);
    const next=new Map(wal.rows.map(row=>[row.target.id,row]));
    for(const [id,old] of this.rows){
      const replacement=next.get(id);
      if(!replacement)throw protocolError('WAL_OBLIGATION_DROPPED');
      if(sameJson(old,replacement))continue;
      if(this.attempted.get(id)!==old.generation&&replacement.generation>old.generation&&sameRecord(replacement.base,old.base)&&replacement.expectedEtag===old.expectedEtag)continue;
      const confirmed=this.confirmed.get(id);
      if(!confirmed||!sameRecord(confirmed.record,old.target)||!sameRecord(replacement.base,confirmed.record)||replacement.expectedEtag!==confirmed.etag||replacement.generation<=old.generation)throw protocolError('UNCONFIRMED_WAL_PREDECESSOR');
    }
    this.protecting=true;this.publishingRows=next;
    try{
      const observed=await conditionalFileMutation({fileId:this.wal.fileId,snapshot:this.wal,target:wal,io:this.io,canDispatch:()=>{this.assertWrite();return current();},budget:this.mutationBudget(),clock:this.clock,policy:this.policy,onState:state=>this.event({type:'wal-state',...state})});
      this.wal={...observed,fileId:this.wal.fileId};this.rows=next;
    }finally{this.protecting=false;this.publishingRows=null;}
  }
  async upload(input,{canDispatch,onState=()=>{},onDispatched=()=>{}}){
    this.assertWrite();const row=validateIntent(input,this.context.allowedIds,this.context.fileIds),id=row.target.id;
    const protectedNow=()=>sameJson(this.rows.get(id),row)&&(!this.publishingRows||sameJson(this.publishingRows.get(id),row));
    if(this.finishing||this.inflight.has(id)||!protectedNow())throw protocolError('PAGE_NOT_EXCLUSIVELY_PROTECTED');
    this.inflight.add(id);
    try{
      const result=await conditionalUpload({row,io:{readPage:file=>this.io.readPage(file),writePage:(file,etag,value,options)=>this.io.writePage(file,etag,value,{...options,annotation:{generation:row.generation},onDispatched:receipt=>{this.attempted.set(id,row.generation);onDispatched(receipt);}})},
        canDispatch:()=>{this.assertWrite();return canDispatch(row)&&protectedNow();},budget:this.mutationBudget(),clock:this.clock,policy:this.policy,onState});
      this.confirmed.set(id,{record:structuredClone(result.observed.record),etag:result.observed.etag});return result;
    }finally{this.inflight.delete(id);}
  }
  async finish(current){
    this.assertWrite();if(this.finishing||this.protecting||this.inflight.size||this.rows.size!==26||!current())throw protocolError('PREPARED_COMPLETION_NOT_QUIESCENT');
    for(const [id,row] of this.rows)if(!this.confirmed.has(id)||!sameRecord(this.confirmed.get(id).record,row.target))throw protocolError('PREPARED_GENERATION_UNVERIFIED');
    this.finishing=true;
    const stillCurrent=()=>{this.assertWrite();return current()&&!this.inflight.size&&!this.protecting;};
    try{
      const clear=await conditionalFileMutation({fileId:this.wal.fileId,snapshot:this.wal,target:null,io:this.io,canDispatch:stillCurrent,budget:this.mutationBudget(),clock:this.clock,policy:this.policy,onState:state=>this.event({type:'wal-clear-state',...state})});
      this.wal={...clear,fileId:this.wal.fileId};
      const release=await conditionalFileMutation({fileId:this.lease.fileId,snapshot:this.lease,target:null,io:this.io,canDispatch:stillCurrent,budget:this.mutationBudget(),clock:this.clock,policy:this.policy,onState:state=>this.event({type:'lease-release-state',...state})});
      this.lease={...release,fileId:this.lease.fileId};this.released=true;
      if(!current())throw protocolError('GENERATION_CHANGED_AFTER_RELEASE');
      // Native metadata must converge through its own protocol. Caller must keep
      // newer journal generations out of replication during this bounded step.
      await this.reconcile(current,new Map(this.confirmed));
      if(!current())throw protocolError('GENERATION_CHANGED_DURING_RECONCILIATION');
      await this.retire(new Map(this.rows),current);
      if(!current())throw protocolError('GENERATION_CHANGED_DURING_RETIREMENT');
      this.finished=true;
    }catch(error){this.halt(error.code??error.message);throw error;}
    finally{this.finishing=false;}
  }
  halt(reason){this.halted??=reason;this.event({type:'session-halted',reason:this.halted,walRetained:this.wal.value!==null,leaseReleased:!!this.released});}
}

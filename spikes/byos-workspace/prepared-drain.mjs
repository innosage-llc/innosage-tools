import {completeRecord,sameRecord} from './prepared-wal.mjs';

/** Per-page timers over one exclusively owned, already prepared transaction. */
export class PreparedDrain {
  constructor({ids,save,session,check,available=()=>true,canAudit=()=>true,changed=()=>{},clock=globalThis,now=()=>performance.now(),idleMs=5000,maxMs=180000,onsetToleranceMs=100}) {
    if(ids.length!==26||new Set(ids).size!==26)throw Error('Exactly 26 distinct fixture pages required');
    Object.assign(this,{save,session,check,available,canAudit,changed,clock,now,idleMs,maxMs,onsetToleranceMs});
    this.entries=new Map(ids.map(id=>[id,{id,generation:0,saved:0,verified:0,verifiedEditId:null,lastInput:null,record:null,protectedRow:null,confirmed:null,saving:false,inflight:null,status:'pending',attempt:0,timer:null,firstUploadAtMs:null}]));
    this.started=now();this.events=[];this.walRows=new Map();this.publishing=false;this.publishAgain=false;this.finalizing=false;this.ready=false;this.halted=null;this.stopped=false;this.strict=true;
    this.deadlineTimer=clock.setTimeout(()=>this.fail('RUN_TIME_BUDGET_EXHAUSTED'),maxMs);
  }
  event(type,detail={}){this.events.push({type,atMs:this.now(),...detail});this.changed();}
  current(row){const entry=this.entries.get(row.target.id);return !!entry&&entry.generation===row.generation&&entry.saved===row.generation&&entry.record&&sameRecord(entry.record,row.target);}
  input(id){
    const entry=this.entries.get(id);if(!entry){this.fail('INPUT_OUTSIDE_FIXTURE');return;}
    if(this.ready)this.fail('NEW_INPUT_AFTER_COMPLETED_SESSION');
    entry.generation++;entry.lastInput=this.now();entry.verified=0;entry.verifiedEditId=null;entry.firstUploadAtMs=null;entry.status='pending';entry.attempt=0;entry.nextRetryAt=null;entry.stopReason=null;this.ready=false;
    this.event('input',{id,generation:entry.generation});this.arm(entry);
    // Autosave begins immediately, including final page Z. UI owns commit
    // deduplication for same-buffer-generation navigation/save overlap.
    Promise.resolve().then(()=>this.save(id)).catch(error=>this.fail('LOCAL_SAVE_FAILED: '+error.message));
  }
  saved(id,generation,value,sequence){
    const entry=this.entries.get(id);if(!entry||entry.generation!==generation)return;
    if(entry.saved===generation&&Number.isSafeInteger(sequence)&&Number.isSafeInteger(entry.savedSequence)&&sequence<entry.savedSequence)return;
    let record;try{record=completeRecord({...value,_deleted:false});if(record.id!==id)throw Error('Saved page identity mismatch');}catch(error){this.fail('INVALID_LOCAL_ACK: '+error.message);return;}
    if(entry.saved===generation&&entry.record&&sameRecord(entry.record,record))return;
    entry.saved=generation;entry.savedSequence=sequence;entry.record=record;entry.verified=0;entry.verifiedEditId=null;entry.firstUploadAtMs=null;entry.onsetLatenessMs=null;this.ready=false;
    this.event('durable',{id,generation,editId:record.editId});this.queueProtect();
  }
  arm(entry){
    if(entry.timer!==null)this.clock.clearTimeout(entry.timer);
    if(this.halted||this.stopped)return;
    entry.timer=this.clock.setTimeout(()=>{
      entry.timer=null;
      if(this.now()<entry.lastInput+this.idleMs){this.arm(entry);return;}
      this.event('eligible',{id:entry.id,generation:entry.generation,eligibleAtMs:entry.lastInput+this.idleMs});
      this.maybeDispatch(entry);
      if(!entry.inflight&&entry.verified!==entry.generation)this.event('deadline-waiting-for-protection',{id:entry.id,generation:entry.generation});
    },Math.max(0,entry.lastInput+this.idleMs-this.now()));
  }
  active(){return !this.halted&&!this.stopped&&!this.ready&&this.now()-this.started<this.maxMs;}
  queueProtect(){
    this.publishAgain=true;if(this.publishing||this.finalizing||!this.active())return;
    this.publishing=true;
    void this.publishLoop().catch(error=>this.fail('WAL_PROTECTION_FAILED: '+error.message)).finally(()=>{this.publishing=false;void this.audit();this.changed();});
  }
  async publishLoop(){
    while(this.publishAgain&&this.active()&&!this.finalizing){
      this.publishAgain=false;const next=new Map(this.walRows);let dirty=false;
      for(const entry of this.entries.values()){
        if(!entry.generation||entry.saved!==entry.generation||!entry.record||entry.inflight)continue;
        if(entry.protectedRow&&this.current(entry.protectedRow))continue;
        const baseline=entry.confirmed??this.session.baseline(entry.id);
        const row={generation:entry.generation,fileId:baseline.fileId,expectedEtag:baseline.etag,base:structuredClone(baseline.record),target:structuredClone(entry.record)};
        next.set(entry.id,row);dirty=true;
      }
      if(!dirty)continue;
      const rows=[...next.values()].map(row=>structuredClone(row));
      this.event('wal-publish-start',{generations:rows.map(row=>({id:row.target.id,generation:row.generation,editId:row.target.editId}))});
      await this.session.protect(rows,()=>this.active());
      this.walRows=next;
      for(const row of rows){const entry=this.entries.get(row.target.id);entry.protectedRow=row;if(this.current(row))this.event('wal-protected',{id:entry.id,generation:row.generation,editId:row.target.editId});}
      for(const entry of this.entries.values())this.maybeDispatch(entry);
    }
  }
  maybeDispatch(entry){
    if(!this.active()||this.finalizing||!this.available()||entry.inflight||!entry.protectedRow||!this.current(entry.protectedRow)||this.now()<entry.lastInput+this.idleMs)return;
    if(entry.verified===entry.generation&&entry.verifiedEditId===entry.record.editId)return;
    const row=structuredClone(entry.protectedRow);entry.status='uploading';
    const canDispatch=()=>this.active()&&!this.finalizing&&this.available()&&this.current(row);
    // Invocation event is not counted as physical upload onset.
    this.event('upload-requested',{id:entry.id,generation:row.generation,editId:row.target.editId});
    entry.inflight=Promise.resolve().then(()=>this.session.upload(row,{
      canDispatch,
      onState:state=>{if(this.current(row)){entry.status=state.state;entry.attempt=state.attempt??entry.attempt;entry.nextRetryAt=state.nextRetryAt??null;entry.stopReason=state.stopReason??null;}this.event('upload-state',{id:entry.id,generation:row.generation,...state});},
      onDispatched:receipt=>{
        this.event('page-upload-start',{id:entry.id,generation:row.generation,editId:row.target.editId,...receipt});
        if(this.current(row)&&entry.firstUploadAtMs===null){entry.firstUploadAtMs=receipt.atMs;entry.onsetLatenessMs=receipt.atMs-(entry.lastInput+this.idleMs);}
      },
    })).then(result=>{
      if(!sameRecord(result.observed.record,row.target))throw Error('Independent upload readback mismatch');
      entry.confirmed={fileId:row.fileId,etag:result.observed.etag,record:structuredClone(result.observed.record)};
      this.event('generation-confirmed',{id:entry.id,generation:row.generation,editId:row.target.editId});
      if(this.current(row)){if(entry.firstUploadAtMs===null)throw Error('ACTUAL_UPLOAD_RECEIPT_MISSING');entry.verified=row.generation;entry.verifiedEditId=row.target.editId;entry.status='verified';}
    }).catch(error=>{
      if(error.code==='SUPERSEDED_BEFORE_DISPATCH')return;
      entry.status=error.details?.state??(['auth-required','conflict'].includes(entry.status)?entry.status:'failed');this.fail('UPLOAD_FAILED: '+error.message);
    }).finally(()=>{entry.inflight=null;this.queueProtect();void this.audit();this.changed();});
  }
  wake(){if(!this.active())return;this.queueProtect();for(const entry of this.entries.values())if(entry.generation)this.maybeDispatch(entry);void this.audit();}
  stamp(){return [...this.entries.values()].map(e=>`${e.generation}:${e.record?.editId??''}`).join('|');}
  complete(){return this.active()&&this.canAudit()&&!this.publishing&&![...this.entries.values()].some(e=>e.inflight||!e.generation||e.saved!==e.generation||e.verified!==e.generation||e.verifiedEditId!==e.record?.editId);}
  async audit(){
    if(this.finalizing||!this.complete())return;
    this.finalizing=true;const stamp=this.stamp();const stillCurrent=()=>this.complete()&&stamp===this.stamp();
    try{
      await this.session.finish(stillCurrent);
      if(!stillCurrent())throw Error('Generation changed during completion; current local intent retained');
      if(!await this.check()||!stillCurrent())throw Error('Final state not verified');
      this.ready=true;this.clock.clearTimeout(this.deadlineTimer);this.event('safe-to-close',{onsetTargetMet:[...this.entries.values()].every(e=>e.firstUploadAtMs!==null&&e.onsetLatenessMs>=0&&e.onsetLatenessMs<=this.onsetToleranceMs)});
    }catch(error){this.fail('FINALIZATION_FAILED: '+error.message);}
    finally{this.finalizing=false;this.changed();}
  }
  fail(reason){if(this.halted)return;this.halted=reason;this.ready=false;this.clock.clearTimeout(this.deadlineTimer);for(const entry of this.entries.values())if(entry.timer!==null){this.clock.clearTimeout(entry.timer);entry.timer=null;}this.session.halt?.(reason);this.event('halt',{reason});}
  stop(){this.stopped=true;this.ready=false;this.clock.clearTimeout(this.deadlineTimer);for(const entry of this.entries.values())if(entry.timer!==null)this.clock.clearTimeout(entry.timer);this.session.halt?.('STOPPED');this.event('stop');}
  snapshot(){return {state:this.halted?'failed':this.stopped?'stopped':this.ready?'safe-to-close':this.finalizing?'finalizing':'active',reason:this.halted,ready:this.ready,flight:this.publishing||this.finalizing||[...this.entries.values()].some(e=>!!e.inflight),pages:[...this.entries.values()].map(({id,generation,saved,verified,lastInput,status,attempt,nextRetryAt,stopReason,firstUploadAtMs,onsetLatenessMs,record})=>({id,generation,saved,verified,lastInput,status,attempt,nextRetryAt,stopReason,firstUploadAtMs,onsetLatenessMs,editId:record?.editId??null}))};}
}

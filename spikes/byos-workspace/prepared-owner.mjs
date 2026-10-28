import {PreparedSession} from './prepared-session.mjs';
import {conditionalFileMutation} from './prepared-mutation.mjs';
import {recoverTransactionWal} from './prepared-recovery.mjs';
import {completeRecord,sameRecord,protocolError,WAL_FORMAT,WAL_VERSION,validateWal} from './prepared-wal.mjs';

/** Orchestrates the existing PageStore operation and native owner. IO/inventory
 * are provided by the existing authorized provider; this is not a second engine.
 */
export class PreparedOwner {
  constructor({store,inventory,createIO,clock,budget,event=()=>{},assertDrained,policy}) {
    Object.assign(this,{store,inventory,createIO,clock,budget,event,assertDrained,policy});
    this.mode='idle';this.transactionQueue=Promise.resolve();this.context=null;this.session=null;
  }
  assertRequest(){this.budget.assertCanRequest();if(this.mode==='halted')throw protocolError('PREPARED_OWNER_HALTED');if(!this.store.writer||this.store.closed||!this.store.db.isLeader())throw protocolError('PREPARED_OWNERSHIP_LOST');}
  async ioForLease(bindings,{acquire=true}={}){
    let acquiring=acquire,lease=null;
    const assertWrite=(binding)=>{
      this.assertRequest();
      if(acquiring){if(binding?.role!=='lease')throw protocolError('LEASE_ACQUISITION_ONLY');return;}
      if(!lease||this.clock.now()>=lease.acquiredAt+40000)throw protocolError('LEASE_WRITE_WINDOW_EXHAUSTED');
    };
    const io=this.createIO({bindings,assertCanRequest:()=>this.assertRequest(),assertCanWrite:assertWrite});
    const previous=await io.readFile(bindings.leaseId);
    // Provider Date has second precision. Add a second to the native 60s lease;
    // client clocks and aborted requests never establish an expired owner.
    if(previous.value!==null&&(!Number.isFinite(previous.serverDateMs)||!Number.isFinite(previous.modifiedDateMs)||previous.serverDateMs-previous.modifiedDateMs<61000))
      throw protocolError('EXISTING_LEASE_REQUIRES_VERIFIED_EXPIRY');
    const acquiredAt=this.clock.now();
    const target={createdAtClientTime:this.clock.wallNow(),preparedRunId:crypto.randomUUID()};
    const observed=await conditionalFileMutation({fileId:bindings.leaseId,snapshot:previous,target,io,budget:this.budget,clock:this.clock,policy:this.policy,canDispatch:()=>{this.assertRequest();return acquiring;},onState:state=>this.event({type:'lease-acquire-state',...state})});
    lease={...observed,fileId:bindings.leaseId,acquiredAt};acquiring=false;
    this.event({type:'lease-acquired',atMs:this.clock.now(),leaseClockStartedAtMs:acquiredAt,writeCutoffMs:acquiredAt+40000,reclaimed:previous.value!==null});
    return {io,lease,budget:{assertCanRequest:()=>{this.assertRequest();if(this.clock.now()>=acquiredAt+40000)throw protocolError('LEASE_WRITE_WINDOW_EXHAUSTED');},remainingMs:()=>Math.min(this.budget.remainingMs(),acquiredAt+40000-this.clock.now())}};
  }
  async release(owned,current=()=>true){
    await conditionalFileMutation({fileId:owned.lease.fileId,snapshot:owned.lease,target:null,io:owned.io,budget:owned.budget,clock:this.clock,policy:this.policy,canDispatch:current,onState:state=>this.event({type:'lease-release-state',...state})});
  }
  runTransaction(googleDrive,structure,primaryPath,fn,runAfter){
    const task=this.transactionQueue.then(async()=>{
      if(this.mode!=='reconciling'||primaryPath!=='id'||!this.context)throw protocolError('PREPARED_TRANSACTION_ENTRY_CLOSED');
      const owned=await this.ioForLease(this.bindings);
      try{
        const snapshot=await owned.io.readFile(this.bindings.walId);
        await recoverTransactionWal({snapshot,fileId:this.bindings.walId,context:this.context,io:owned.io,budget:owned.budget,clock:this.clock,policy:this.policy,canDispatch:()=>this.mode==='reconciling',onState:this.event});
        const result=await fn();
        // A callback may publish native-array WAL. Read and safely replay that
        // array before releasing; never leave a fresh-ETag native replay path.
        const after=await owned.io.readFile(this.bindings.walId);
        await recoverTransactionWal({snapshot:after,fileId:this.bindings.walId,context:this.context,io:owned.io,budget:owned.budget,clock:this.clock,policy:this.policy,canDispatch:()=>this.mode==='reconciling',onState:this.event});
        await this.release(owned,()=>this.mode==='reconciling');if(runAfter)await runAfter();return result;
      }catch(error){this.mode='halted';this.event({type:'transaction-halted',reason:error.code??error.message});throw error;}
    });
    this.transactionQueue=task.catch(()=>{});return task;
  }
  async prepare(ids){
    if(this.mode!=='idle'||!this.store.writer||!this.store.replication||!this.store.operation?.pending)throw protocolError('PREPARED_OWNER_ADMISSION_REQUIRED');
    if(ids.length!==26||new Set(ids).size!==26)throw protocolError('INVALID_PREPARED_FIXTURE');
    this.mode='preparing';
    try{
      const replication=this.store.replication;
      await replication.pause();
      if(replication.internalReplicationState)await replication.awaitInSync();
      await this.transactionQueue;await this.assertDrained();
      if((await this.store.db.localDrafts.find().exec()).length)throw protocolError('PREPARATION_RECOVERY_REQUIRED');
      this.bindings=await this.inventory(ids,replication.googleDrive,replication.driveStructure);
      this.context={workspace:this.store.workspace,allowedIds:new Set(ids),fileIds:this.bindings.fileIds};
      // Read full baseline before taking the lease; stored validators fence any
      // intervening change. No page mutation happens during this warm read.
      const readIO=this.createIO({bindings:this.bindings,assertCanRequest:()=>this.assertRequest(),assertCanWrite:()=>{throw protocolError('PREPARATION_READ_ONLY');}});
      const baselines=new Map();
      for(let offset=0;offset<ids.length;offset+=5){
        await Promise.all(ids.slice(offset,offset+5).map(async id=>{
          const fileId=this.bindings.fileIds.get(id),remote=await readIO.readPage(fileId),local=await this.store.page(id);
          if(!local||!sameRecord(remote.record,{...local,_deleted:false}))throw protocolError('WARM_BASELINE_MISMATCH',{id,remote,local});
          baselines.set(id,{fileId,record:completeRecord(remote.record),etag:remote.etag});
        }));
      }
      await this.assertDrained();
      if((await this.store.db.localDrafts.find().exec()).length)throw protocolError('LOCAL_GENERATION_CHANGED_DURING_PREPARATION');
      const owned=await this.ioForLease(this.bindings);
      const wal=await owned.io.readFile(this.bindings.walId);
      if(wal.value!==null&&(!Array.isArray(wal.value)||wal.value.length))throw protocolError('PREPARATION_RECOVERY_REQUIRED');
      this.mode='prepared';
      this.session=new PreparedSession({workspace:this.store.workspace,runId:crypto.randomUUID(),baselines,wal:{...wal,fileId:this.bindings.walId},lease:owned.lease,io:owned.io,budget:this.budget,clock:this.clock,policy:this.policy,event:this.event,
        reconcile:async(current,confirmed)=>{
          await this.store.holdPreparedGenerations(confirmed,current);
          this.mode='reconciling';await this.store._sync({materialize:false});
          await this.transactionQueue;await this.assertDrained();
          if(!current())throw protocolError('NEW_INPUT_DURING_NATIVE_RECONCILIATION');
        },retire:async(rows,current)=>{await this.store.retirePreparedGenerations(rows,current);this.mode='complete';}});
      return this.session;
    }catch(error){this.mode='halted';this.event({type:'preparation-halted',reason:error.code??error.message});throw error;}
  }
  async recover(ids,stillCurrent=()=>true){
    if(this.mode!=='idle'||!this.store.operation?.pending||ids.length!==26||new Set(ids).size!==26)throw protocolError('RECOVERY_ADMISSION_REQUIRED');
    this.mode='recovering';
    try{
      const replication=this.store.replication;await replication.pause();
      if(replication.internalReplicationState)await replication.awaitInSync();
      await this.transactionQueue;await this.assertDrained();
      const journals=await this.store.db.localDrafts.find().exec(),frozen=new Map();
      if(journals.length!==26)throw protocolError('RECOVERY_REQUIRES_EXACT_26_PENDING_INTENTS');
      for(const doc of journals){const row=doc.toJSON();if(row.session!==this.store.session||row.state!=='pending'||!ids.includes(row.page)||frozen.has(row.page)||!row.base)throw protocolError('RECOVERY_JOURNAL_NOT_SAFE');frozen.set(row.page,structuredClone(row));}
      this.event({type:'recovery-local-oracle',journals:[...frozen.values()]});
      const current=()=>this.mode!=='halted'&&this.store.writer&&!this.store.closed&&stillCurrent();
      const checkJournals=async()=>{
        if(!current())throw protocolError('RECOVERY_OWNERSHIP_CHANGED');
        for(const [id,old] of frozen){const latest=await this.store.draft(id);if(!latest||latest.seq!==old.seq||latest.state!=='pending'||!sameRecord({...latest.draft,_deleted:false},{...old.draft,_deleted:false}))throw protocolError('RECOVERY_LOCAL_GENERATION_CHANGED');}
      };
      this.bindings=await this.inventory(ids,replication.googleDrive,replication.driveStructure);
      this.context={workspace:this.store.workspace,allowedIds:new Set(ids),fileIds:this.bindings.fileIds};
      const owned=await this.ioForLease(this.bindings);
      const original=await owned.io.readFile(this.bindings.walId);
      this.event({type:'recovery-wal-oracle',snapshot:structuredClone(original)});
      const prior=await recoverTransactionWal({snapshot:original,fileId:this.bindings.walId,context:this.context,io:owned.io,budget:owned.budget,clock:this.clock,policy:this.policy,canDispatch:current,onState:this.event});
      await checkJournals();
      const rows=[];
      for(let offset=0;offset<ids.length;offset+=5){
        const settled=await Promise.allSettled(ids.slice(offset,offset+5).map(async id=>{
          const journal=frozen.get(id),fileId=this.bindings.fileIds.get(id),observed=await owned.io.readPage(fileId);
          const base=completeRecord({...journal.base,_deleted:false}),target=completeRecord({...journal.draft,_deleted:false});
          const previous=(prior.rows??[]).find(row=>row.target.id===id)?.target;
          if(!sameRecord(observed.record,base)&&!sameRecord(observed.record,target)&&!(previous&&sameRecord(observed.record,previous)))throw protocolError('RECOVERY_LOCAL_REMOTE_CONFLICT',{id,base,target,observed});
          return {fileId,expectedEtag:observed.etag,base:observed.record,target,generation:journal.seq};
        }));
        const failed=settled.find(item=>item.status==='rejected');if(failed)throw failed.reason;
        rows.push(...settled.map(item=>item.value));
      }
      await checkJournals();
      const wal=validateWal({format:WAL_FORMAT,version:WAL_VERSION,workspace:this.store.workspace,runId:crypto.randomUUID(),rows},this.context);
      const protectedWal=await conditionalFileMutation({fileId:this.bindings.walId,snapshot:prior.snapshot,target:wal,io:owned.io,budget:owned.budget,clock:this.clock,policy:this.policy,canDispatch:current,onState:this.event});
      await recoverTransactionWal({snapshot:protectedWal,fileId:this.bindings.walId,context:this.context,io:owned.io,budget:owned.budget,clock:this.clock,policy:this.policy,canDispatch:current,onState:this.event});
      await this.release(owned,current);await checkJournals();
      const confirmed=new Map(rows.map(row=>[row.target.id,{record:row.target}]));
      await this.store.holdPreparedGenerations(confirmed,current);
      this.mode='reconciling';await this.store._sync({materialize:false});await this.transactionQueue;await this.assertDrained();
      await checkJournals();await this.store.retirePreparedGenerations(new Map(rows.map(row=>[row.target.id,row])),current);
      this.mode='complete';this.event({type:'recovery-complete',pages:26,formalSample:false});
      return {recovered:26,formalSample:false};
    }catch(error){this.mode='halted';this.event({type:'recovery-halted',reason:error.code??error.message});throw error;}
  }
  halt(reason){this.mode='halted';this.session?.halt(reason);}
}

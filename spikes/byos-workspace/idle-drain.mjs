// Isolated opt-in experiment. Eligibility is per page; native transport is workspace-wide.
export class IdleDrain {
  constructor({ids,save,sync,verify,check,available,canAudit=()=>true,changed=()=>{},clock=globalThis,now=()=>performance.now(),idleMs=5000,maxSyncs=26,maxVerifies=52,maxMs=1500000}) {
    if(ids.length!==26||new Set(ids).size!==26)throw Error('Exactly 26 distinct fixture pages required');
    Object.assign(this,{save,sync,verify,check,available,canAudit,changed,clock,now,idleMs,maxSyncs,maxVerifies,maxMs});
    this.entries=new Map(ids.map(id=>[id,{id,generation:0,saved:0,verified:0,lastInput:null,saving:false}]));
    this.started=now();this.events=[];this.syncs=0;this.verifies=0;this.flight=false;this.checking=false;this.auditRequested=false;this.halted=null;this.stopped=false;this.ready=false;this.timer=null;
    this.deadlineTimer=clock.setTimeout(()=>this.fail('RUN_TIME_BUDGET_EXHAUSTED'),maxMs);
  }
  event(type,detail={}) {this.events.push({type,atMs:this.now(),...detail});this.changed();}
  input(id) {
    const row=this.entries.get(id);if(!row||this.stopped||this.halted)return;
    if(this.ready)this.deadlineTimer=this.clock.setTimeout(()=>this.fail('RUN_TIME_BUDGET_EXHAUSTED'),Math.max(0,this.started+this.maxMs-this.now()));
    row.generation++;row.lastInput=this.now();this.ready=false;this.event('input',{id,generation:row.generation});this.wake();
  }
  saved(id,generation) {
    const row=this.entries.get(id);if(!row||generation!==row.generation||row.saved===generation)return;
    row.saved=generation;this.event('durable',{id,generation});this.wake();
  }
  fail(reason) {if(this.halted)return;this.halted=reason;this.ready=false;this.cancel();this.event('halt',{reason:this.halted});}
  cancel(){if(this.timer!==null)this.clock.clearTimeout(this.timer);this.timer=null;}
  stop(){this.stopped=true;this.ready=false;this.cancel();this.clock.clearTimeout(this.deadlineTimer);this.event('stop');}
  snapshot(){return {state:this.halted?'halted':this.stopped?'stopped':this.ready?'safe-to-close':this.flight?'cloud-active':'waiting',reason:this.halted,syncs:this.syncs,verifies:this.verifies,ready:this.ready,flight:this.flight,pages:[...this.entries.values()].map(({saving,...row})=>({...row,saving}))};}
  wake(){
    this.cancel();if(this.stopped||this.halted)return;
    if(this.now()-this.started>=this.maxMs){this.fail('RUN_TIME_BUDGET_EXHAUSTED');return;}
    const pending=[...this.entries.values()].filter(r=>r.generation&&r.saved<r.generation&&!r.saving);
    const deadlines=pending.map(r=>Math.max(0,r.lastInput+this.idleMs-this.now()));
    const cloud=[...this.entries.values()].filter(r=>r.generation&&r.saved===r.generation&&r.verified!==r.generation);
    if(!this.flight)deadlines.push(...cloud.map(r=>Math.max(0,r.lastInput+this.idleMs-this.now())));
    if(deadlines.length)this.timer=this.clock.setTimeout(()=>{this.timer=null;void this.tick();},Math.min(...deadlines));
  }
  async tick(){
    if(this.stopped||this.halted)return;
    if(this.now()-this.started>=this.maxMs){this.fail('RUN_TIME_BUDGET_EXHAUSTED');return;}
    for(const row of this.entries.values())if(row.generation&&this.now()>=row.lastInput+this.idleMs&&row.eligible!==row.generation){row.eligible=row.generation;this.event('eligible',{id:row.id,generation:row.generation,eligibleAtMs:row.lastInput+this.idleMs});}
    // Local persistence never queues behind cloud operations.
    for(const row of this.entries.values()) {
      if(!row.generation||row.saving||row.saved===row.generation||this.now()<row.lastInput+this.idleMs)continue;
      const generation=row.generation;row.saving=true;
      try {await this.save(row.id);if(row.generation===generation)this.saved(row.id,generation);}
      catch(error){this.fail('LOCAL_SAVE_FAILED: '+error.message);}
      finally{row.saving=false;}
      if(this.halted||this.stopped)return;
    }
    if(this.flight){this.wake();return;}
    const batch=[...this.entries.values()].filter(r=>r.generation&&r.saved===r.generation&&r.verified!==r.generation&&this.now()>=r.lastInput+this.idleMs).map(r=>({id:r.id,generation:r.generation}));
    if(!batch.length){await this.audit();this.wake();return;}
    if(!this.available()){this.event('paused');return;} // explicit foreground/auth/online events wake; no polling
    if(this.syncs>=this.maxSyncs){this.fail('SYNC_COUNT_BUDGET_EXHAUSTED');return;}
    this.flight=true;this.ready=false;this.syncs++;this.event('sync-start',{batch});this.wake();
    try {
      await this.sync();this.event('sync-end');
      for(const item of batch){
        if(this.stopped||this.halted)break;
        const row=this.entries.get(item.id);if(row.generation!==item.generation||row.saved!==item.generation)continue;
        if(this.verifies>=this.maxVerifies)throw Error('VERIFY_COUNT_BUDGET_EXHAUSTED');
        this.verifies++;this.event('verify-start',item);await this.verify(item.id);
        if(row.generation===item.generation&&row.saved===item.generation){row.verified=item.generation;this.event('verified',item);}
      }
    } catch(error){this.fail('CLOUD_UNCERTAIN: '+error.message);}
    finally{this.flight=false;}
    await this.audit();
    this.wake();this.changed();
  }
  completeLocally(){
    return this.now()-this.started<this.maxMs&&this.canAudit()&&!this.flight&&!this.halted&&!this.stopped&&[...this.entries.values()].every(r=>r.generation&&r.saved===r.generation&&r.verified===r.generation&&!r.saving);
  }
  async audit(){
    this.auditRequested=true;
    if(this.checking)return;
    this.checking=true;
    try {
      while(this.auditRequested){
        this.auditRequested=false;
        if(!this.completeLocally())break;
        const stamp=[...this.entries.values()].map(r=>r.generation).join(',');
        const clean=await this.check();
        // Both true and false from an old generation are discarded.
        if(!this.completeLocally()||stamp!==[...this.entries.values()].map(r=>r.generation).join(','))continue;
        if(!clean){this.fail('FINAL_STATE_NOT_VERIFIED');break;}
        if(!this.ready){this.ready=true;this.clock.clearTimeout(this.deadlineTimer);this.event('safe-to-close');}
      }
    }catch(error){this.fail('FINAL_CHECK_FAILED: '+error.message);}
    finally{this.checking=false;}
  }
}

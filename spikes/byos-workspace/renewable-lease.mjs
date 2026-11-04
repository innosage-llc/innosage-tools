import {conditionalFileMutation} from './prepared-mutation.mjs';
import {protocolError} from './prepared-wal.mjs';

/** Same native lease, same owner, refreshed only after snapshot-bound CAS and
 * full independent readback. A refresh never extends unconfirmed authority.
 * The shared snapshot is also the only validator used by final release.
 */
export class RenewableLease {
  constructor({lease,io,clock,budget,event=()=>{},onFailure=()=>{},intervalMs=20000}){
    Object.assign(this,{lease,io,clock,budget,event,onFailure,intervalMs});
    this.state='active';this.flight=null;this.timer=null;this.failure=null;this.uncertain=false;
    this.schedule();
  }
  assertWrite(binding){
    this.budget.assertCanRequest();
    if(this.failure)throw protocolError(this.failure);
    if(this.state==='closed'||(this.state==='closing'&&binding?.role!=='lease'))throw protocolError('LEASE_AUTHORITY_CLOSED');
    if(this.uncertain&&binding?.role!=='lease')throw protocolError('LEASE_RENEWAL_UNCERTAIN');
    if(this.clock.now()>=this.lease.acquiredAt+40000)throw protocolError('LEASE_OWNERSHIP_NOT_FRESH');
  }
  remainingMs(){return Math.min(this.budget.remainingMs(),this.lease.acquiredAt+40000-this.clock.now());}
  schedule(){
    if(this.state!=='active'||this.failure)return;
    this.timer=this.clock.setTimeout(()=>{this.timer=null;void this.refresh().catch(()=>{});},Math.max(0,this.lease.acquiredAt+this.intervalMs-this.clock.now()));
  }
  refresh(){
    if(this.flight)return this.flight;
    if(this.state!=='active')return Promise.reject(protocolError('LEASE_AUTHORITY_CLOSED'));
    this.cancelTimer();
    const task=(async()=>{
      this.assertWrite({role:'lease'});
      const started=this.clock.now(),previous=structuredClone(this.lease);
      const target={...previous.value,renewalId:crypto.randomUUID()};
      this.event({type:'lease-renew-start',atMs:started});
      const observed=await conditionalFileMutation({fileId:previous.fileId,snapshot:previous,target,io:this.io,clock:this.clock,
        budget:{assertCanRequest:()=>this.assertWrite({role:'lease'}),remainingMs:()=>this.remainingMs()},
        canDispatch:()=>{this.assertWrite({role:'lease'});return true;},
        onState:state=>{if(state.uncertain)this.uncertain=true;this.event({type:'lease-renew-state',...state});}});
      // A successful response/unchanged content alone does not prove that native
      // peers' provider-time expiry moved forward. Refuse to invent freshness.
      if(!Number.isFinite(observed.modifiedDateMs)||!Number.isFinite(previous.modifiedDateMs)||observed.modifiedDateMs<=previous.modifiedDateMs||observed.etag===previous.etag||
        typeof observed.version!=='string'||!/^\d+$/.test(observed.version)||typeof previous.version!=='string'||!/^\d+$/.test(previous.version)||BigInt(observed.version)<=BigInt(previous.version))
        throw protocolError('LEASE_REFRESH_NOT_PROVEN');
      if(this.state==='closed')throw protocolError('LEASE_AUTHORITY_CLOSED');
      Object.assign(this.lease,observed,{fileId:previous.fileId,acquiredAt:started});
      this.uncertain=false;
      this.event({type:'lease-renew-confirmed',atMs:this.clock.now(),leaseClockStartedAtMs:started,writeCutoffMs:started+40000});
    })();
    const joined=task.catch(error=>{this.failure=error.code??error.message;this.cancelTimer();this.event({type:'lease-renew-failed',reason:this.failure});this.onFailure(this.failure);throw error;})
      .finally(()=>{if(this.flight===joined)this.flight=null;this.schedule();});
    this.flight=joined;joined.catch(()=>{});
    return joined;
  }
  cancelTimer(){if(this.timer!==null)this.clock.clearTimeout(this.timer);this.timer=null;}
  async beginRelease(){
    if(this.state!=='active')throw protocolError('LEASE_AUTHORITY_CLOSED');
    this.state='closing';this.cancelTimer();
    if(this.flight)await this.flight;
    this.assertWrite({role:'lease'});
    return this.lease;
  }
  close(){this.state='closed';this.cancelTimer();}
}

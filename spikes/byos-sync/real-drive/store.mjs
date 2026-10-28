import {openPageStore as openNative} from '../native-overlay/page-store.mjs';
import {createChangesReplication} from '../changes-feasibility/adapter.mjs';
import {API,begin,isAuthorized,failure,evidence,onProgress,haltExperiment} from './transport.mjs';
import {errorSummary} from './diagnostics.mjs';
let active,lastRemote=null;
const errors=[];let errorSequence=0;
function recordError(error){haltExperiment("NATIVE_ERROR");const requests=evidence().requests;errors.push({sequence:++errorSequence,afterRequest:requests.at(-1)?.sequence??null,...errorSummary(error)});if(errors.length>32)errors.shift();}
const diagnosticFactory=options=>createChangesReplication(options,{onCreated:state=>{state.error$.subscribe(recordError);}});
import {preflight,workspace,bindingKey} from './config.mjs';
export {clientId,setClientId,workspace} from './config.mjs';
const params=new URLSearchParams(location.search);
export async function openPageStore(options){
 const providerPreflight=options.providerPreflight??preflight;
 active=await openNative({...options,hook:async(name,row)=>{if(name==='remote-read')lastRemote=row;},connectionProvider:async()=>({...await providerPreflight(),factory:options.replicationFactory??diagnosticFactory})});
 active.explicitSync=true;
 const runOperation=active.runOperation.bind(active);
 let halted=false;
 onProgress(count=>{if(active.operation?.pending){active.operation.requestCount=count;active.notify();}});
 active.runOperation=(kind,key,fn)=>runOperation(kind,key,async()=>{
  if(halted)throw new Error('Previous cloud action timed out; reload and reauthorize. Local content retained.');
  if(!isAuthorized()){active.state='reauth-required';active.notify();throw failure('REAUTHORIZE_REQUIRED',401);}
  active.authorityUsed=true;
  begin(active.operation.id);
  let timer;
  try {
   return await Promise.race([(async()=>{
    // Revalidate account/client/root binding per explicit action. Reuse the
    // existing native state/metadata/checkpoints instead of recreating folders.
    active.phase('preflight');
    if(!active.replication){
      active.phase('initializing');
      await active.connect(API,{live:true,autoStart:false});
    }else await providerPreflight();
    return fn();
   })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('SYNC_BUDGET_EXHAUSTED',429)),180000);})]);
  }catch(e){
   haltExperiment(e.message||"NATIVE_OPERATION_FAILED");
   recordError(e);if(e.message==='SYNC_BUDGET_EXHAUSTED')halted=true;
   if(active.replication)await active.replication.pause();
   active.state=e.parameters?.status===401?'reauth-required':'blocked';active.notify();throw e;
  }finally{clearTimeout(timer);}
 });
 return active;
}
export function store(){return active;}
export async function snapshot(){
 const v=await active.view(params.get('page')||'page');
 return {workspace,session:active.session,view:v,binding:JSON.parse(localStorage.getItem(bindingKey)??'null'),busy:!!active.operationBusy,lastRemote,checkpoint:active.replication?.internalReplicationState?.lastCheckpointDoc?.down?.checkpointData??null,transport:evidence(),errors:structuredClone(errors)};
}

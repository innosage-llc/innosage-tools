import {openPageStore as openNative} from '../native-overlay/page-store.mjs';
import {createChangesReplication} from '../changes-feasibility/adapter.mjs';
import {API,begin,isAuthorized,failure,evidence} from './transport.mjs';
let active,lastRemote=null;
import {preflight,workspace,bindingKey} from './config.mjs';
export {clientId,setClientId,workspace} from './config.mjs';
const params=new URLSearchParams(location.search);
export async function openPageStore(options){
 active=await openNative({...options,hook:async(name,row)=>{if(name==='remote-read')lastRemote=row;},connectionProvider:async()=>({...await preflight(),factory:createChangesReplication})});
 const sync=active.sync.bind(active);
 let operation,halted=false;
 active.sync=async()=>{
  if(halted)throw new Error('Previous sync timed out; reload and reauthorize. Local content retained.');
  if(operation)return operation;
  active.operationBusy=true;
  operation=(async()=>{
   if(!isAuthorized()){active.state='reauth-required';active.notify();throw failure('REAUTHORIZE_REQUIRED',401);}
   active.authorityUsed=true;
   begin();
   let timer;
   try{
    await Promise.race([(async()=>{
     if(!active.replication)await active.connect(API,{live:false});
     await sync();
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('SYNC_BUDGET_EXHAUSTED',429)),180000);})]);
   }catch(e){if(e.message==='SYNC_BUDGET_EXHAUSTED'){halted=true;}active.state=e.parameters?.status===401?'reauth-required':'blocked';active.notify();throw e;}
   finally{clearTimeout(timer);}
  })();
  try{return await operation;}finally{operation=null;active.operationBusy=false;}
 };
 return active;
}
export function store(){return active;}
export async function snapshot(){
 const v=await active.view(params.get('page')||'page');
 return {workspace,session:active.session,view:v,binding:JSON.parse(localStorage.getItem(bindingKey)??'null'),busy:!!active.operationBusy,lastRemote,checkpoint:active.replication?.internalReplicationState?.lastCheckpointDoc?.down?.checkpointData??null,transport:evidence()};
}

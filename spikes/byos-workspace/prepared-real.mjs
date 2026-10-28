import {PreparedOwner} from './prepared-owner.mjs';
import {createPreparedDriveIO} from './prepared-drive-io.mjs';
import {getDocumentFiles} from '../byos-sync/real-drive/prepared-primitives.mjs';
import {API,preparedRequestOnce,evidence,experimentEvidence,isAuthorized} from '../byos-sync/real-drive/transport.mjs';
import {protocolError} from './prepared-wal.mjs';

export function preparedRealController(store){
  let owner=null;const events=[];
  const clock={now:()=>performance.now(),wallNow:()=>Date.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),random:()=>Math.random()};
  const event=row=>events.push({atMs:clock.now(),...row});
  const transactionRunner=(...args)=>{if(!owner)throw protocolError('PREPARED_ACTION_REQUIRED');return owner.runTransaction(...args);};
  async function inventory(ids,googleDrive,structure){
    const response=await getDocumentFiles(googleDrive,structure,ids);
    if(response.nextPageToken||response.incompleteSearch||!Array.isArray(response.files)||response.files.length!==26)throw protocolError('FIXTURE_INVENTORY_INCOMPLETE');
    const fileIds=new Map(),files=new Map();
    for(const item of response.files){
      const id=ids.find(id=>item.name===id+'.json');
      if(!id||fileIds.has(id)||files.has(item.id)||item.mimeType!=='application/json'||!item.parents?.includes(structure.docsFolderId))throw protocolError('FIXTURE_FILE_BINDING_INVALID');
      fileIds.set(id,item.id);files.set(item.id,{role:'page',pageId:id,name:item.name,parentId:structure.docsFolderId});
    }
    const walId=structure.walFile.fileId,leaseId=structure.transactionFile.fileId;
    if(files.has(walId)||files.has(leaseId)||walId===leaseId)throw protocolError('FIXTURE_FILE_BINDING_INVALID');
    files.set(walId,{role:'wal',name:'rxdb-wal.json',parentId:structure.rootFolderId});
    files.set(leaseId,{role:'lease',name:'transaction.json',parentId:structure.rootFolderId});
    return {fileIds,files,walId,leaseId};
  }
  function beginOwner(){
    const started=clock.now();
    const budget={remainingMs:()=>180000-(clock.now()-started),assertCanRequest(){
      if(clock.now()-started>=180000||evidence().operationRequests>=1000)throw protocolError('PREPARED_OPERATION_BUDGET_EXHAUSTED');
      if(!isAuthorized())throw Object.assign(protocolError('REAUTHORIZE_REQUIRED'),{status:401});
      if(experimentEvidence()?.halted)throw protocolError('PREPARED_TRANSPORT_HALTED');
    }};
    owner=new PreparedOwner({store,inventory,clock,budget,event,
      assertDrained:async()=>{if(experimentEvidence()?.active)throw protocolError('PREPARED_TRANSPORT_NOT_DRAINED');},
      createIO:({bindings,...guards})=>createPreparedDriveIO({apiEndpoint:API,fetchOnce:preparedRequestOnce,files:bindings.files,...guards,now:clock.now,event,phase:()=>owner.mode}),
    });return owner;
  }
  function prepare(ids){
    if(store.operation?.pending)throw protocolError('PREPARED_OPERATION_ALREADY_ACTIVE');
    let admit,rejectAdmission,complete,rejectCompletion;
    const admission=new Promise((resolve,reject)=>{admit=resolve;rejectAdmission=reject;});
    const completion=new Promise((resolve,reject)=>{complete=resolve;rejectCompletion=reject;});
    // Attach rejection handling before any network callback can fail.
    completion.catch(()=>{});
    const active=beginOwner();
    const operation=store.runOperation('prepared-idle',null,async()=>{
      const session=await active.prepare(ids),finish=session.finish.bind(session),halt=session.halt.bind(session);
      session.finish=async current=>{await finish(current);complete();};
      session.halt=reason=>{halt(reason);active.mode='halted';rejectCompletion(protocolError(reason));};
      admit(session);return completion;
    });
    operation.catch(error=>{active.halt(error.code??error.message);rejectAdmission(error);rejectCompletion(error);});
    return admission;
  }
  async function recover(ids,current){
    if(store.operation?.pending)throw protocolError('PREPARED_OPERATION_ALREADY_ACTIVE');
    const active=beginOwner();
    try{return await store.runOperation('prepared-recovery',null,()=>active.recover(ids,current));}
    catch(error){active.halt(error.code??error.message);throw error;}
  }
  return {transactionRunner,prepare,recover,events,owner:()=>owner};
}

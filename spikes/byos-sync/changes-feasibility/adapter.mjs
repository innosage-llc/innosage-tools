// Approved changed adapter hypothesis. Public pinned native primitives only.
import {replicateRxCollection,startReplicationOnLeaderShip} from 'rxdb/plugins/replication';
import {initDriveStructure,runInTransaction,handleUpstreamBatch,fetchDocumentContents} from 'rxdb/plugins/replication-google-drive';
export const TAG='tools109-changes-v1';
export async function createChangesReplication(options,{event=()=>{},batchSize=options.pull.batchSize,onCreated=()=>{}}={}){
 const googleDrive={apiEndpoint:'https://www.googleapis.com',transactionTimeout:60000,space:'drive',folderPath:'',...options.googleDrive};
 const driveStructure=await initDriveStructure(googleDrive);
 const headers={Authorization:`Bearer ${googleDrive.authToken}`};
 async function get(path,params){const url=googleDrive.apiEndpoint+path+'?'+new URLSearchParams(params);const r=await fetch(url,{headers});if(!r.ok){const error=new Error(`CHANGES_HTTP_${r.status}`);error.parameters={status:r.status};throw error;}return r.json();}
 async function pullHandler(checkpoint,capacity){
  return runInTransaction(googleDrive,driveStructure,'id',async()=>{
   let cursor=checkpoint?.changes109?.tag===TAG?structuredClone(checkpoint.changes109):null;
   if(!cursor){const start=await get('/drive/v3/changes/startPageToken',{spaces:googleDrive.space,supportsAllDrives:'true'});cursor={tag:TAG,phase:'inventory',startToken:start.startPageToken,inventoryPageToken:null};event({type:'bootstrap-start-token',token:cursor.startToken,legacyCheckpoint:checkpoint??null});}
   const documents=new Map();
   while(documents.size<capacity){
    const remaining=capacity-documents.size;
    let files,terminal=false;
    if(cursor.phase==='inventory'){
     const page=await get('/drive/v3/files',{q:`'${driveStructure.docsFolderId}' in parents and trashed = false`,pageSize:String(remaining),...(cursor.inventoryPageToken?{pageToken:cursor.inventoryPageToken}:{}),orderBy:'name',fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,modifiedTime,size)',spaces:googleDrive.space,supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
     // An explicit incomplete inventory is not a verified bootstrap. Fail before
     // returning documents or a cursor; native retry retains its durable checkpoint.
     if(page.incompleteSearch===true)throw new Error('INCOMPLETE_INVENTORY_SEARCH');
     files=page.files;cursor.inventoryPageToken=page.nextPageToken??null;
     if(!page.nextPageToken)cursor={tag:TAG,phase:'changes',token:cursor.startToken};
    }else{
     const page=await get('/drive/v3/changes',{pageToken:cursor.token,pageSize:String(remaining),spaces:googleDrive.space,fields:'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,parents,modifiedTime,size))',supportsAllDrives:'true',includeItemsFromAllDrives:'true',includeRemoved:'true'});
     if(page.changes.length>remaining)throw new Error('PROVIDER_EXCEEDED_REQUEST_MAX');
     files=[];
     for(const change of page.changes){
      if(change.removed){if(change.file?.parents?.includes(driveStructure.docsFolderId))throw new Error('AMBIGUOUS_REMOVAL_OR_ACCESS_LOSS');continue;}
      if(change.file&&change.file.id!==change.fileId)throw new Error('CHANGE_FILE_ID_MISMATCH');
      if(change.file)files.push(change.file);
     }
     if(page.nextPageToken){cursor={tag:TAG,phase:'changes',token:page.nextPageToken};}
     else{if(!page.newStartPageToken)throw new Error('MISSING_TERMINAL_TOKEN');cursor={tag:TAG,phase:'changes',token:page.newStartPageToken};terminal=true;}
    }
    if(!Array.isArray(files)||files.length>remaining)throw new Error('INVALID_OR_OVERSIZED_PROVIDER_PAGE');
    const relevant=files.filter(f=>f.parents?.includes(driveStructure.docsFolderId)&&f.name?.endsWith('.json')&&!['transaction.json','rxdb-wal.json'].includes(f.name));
    if(relevant.length){
     const contents=await fetchDocumentContents(googleDrive,relevant.map(f=>f.id));
     for(let i=0;i<relevant.length;i++){
      const doc=contents.byId[relevant[i].id];
      if(!doc||doc.id+'.json'!==relevant[i].name||typeof doc.body!=='string'||typeof doc.editId!=='string'||typeof doc._deleted!=='boolean')throw new Error('MISSING_OR_INVALID_REQUIRED_BODY');
      documents.set(doc.id,doc);
     }
    }
    event({type:'adapter-page',remaining,returned:files.length,relevant:relevant.length,accumulated:documents.size,handlerCursor:structuredClone(cursor),terminal,durable:false});
    if(terminal)break;
   }
   const result={documents:[...documents.values()],checkpoint:{changes109:cursor}};
   event({type:'pull-return',result:structuredClone(result),durable:false});return result;
  });
 }
 const state=replicateRxCollection({replicationIdentifier:options.replicationIdentifier,collection:options.collection,deletedField:'_deleted',pull:{batchSize,handler:pullHandler},push:{batchSize:options.push.batchSize,handler:rows=>runInTransaction(googleDrive,driveStructure,'id',()=>handleUpstreamBatch(googleDrive,driveStructure,'id',rows))},live:options.live,retryTime:options.retryTime,waitForLeadership:options.waitForLeadership,autoStart:false});
 // Fixture facade exposes unchanged published verification helpers' inputs only.
 state.googleDrive=googleDrive;state.driveStructure=driveStructure;
 event({type:'adapter-created',replicationIdentifier:state.replicationIdentifier,deletedField:state.deletedField,metaInfo:await state.metaInfoPromise,autoStart:state.autoStart,config:{googleDrive,pullBatchSize:batchSize,pushBatchSize:options.push.batchSize,live:options.live,retryTime:options.retryTime,waitForLeadership:options.waitForLeadership}});
 state.error$.subscribe(error=>event({type:'native-adapter-error',error:String(error),parameters:error.parameters??null}));
 await onCreated(state);
 // Construction stays gated until metadata/instrumentation are ready. Match the
 // native factory: expose state before non-live settlement so consumers can
 // observe errors while initial replication is still retrying.
 state.autoStart=true;
 startReplicationOnLeaderShip(options.waitForLeadership,state);
 return state;
}

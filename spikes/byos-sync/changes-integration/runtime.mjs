import '../native-overlay/browser-runtime.mjs';
import {getRxStorageDexie} from 'rxdb/plugins/storage-dexie';
import {prepareQuery,normalizeMangoQuery} from 'rxdb';
export {openPageStore} from '../native-overlay/page-store.mjs';
export async function inspect(store,priorIdentity=null){
 const r=globalThis.__integration?.latest.get(store.db.name);
 let metadata=[],identity={databaseName:store.db.name,collectionName:store.db.pages.name};
 if(r||priorIdentity){
  const info=r?await r.metaInfoPromise:{collectionName:priorIdentity.metaCollection,schema:priorIdentity.metaSchema};
  identity=r?{...identity,replicationIdentifier:r.replicationIdentifier,deletedField:r.deletedField,metaCollection:info.collectionName,metaSchema:info.schema,logicalIdentifier:r.internalReplicationState?.input.identifier}:{...priorIdentity,...identity};
  const instance=await getRxStorageDexie().createStorageInstance({databaseInstanceToken:store.db.token,databaseName:store.db.name,collectionName:info.collectionName,schema:info.schema,multiInstance:false,options:store.db.instanceCreationOptions??{},password:store.db.password,devMode:false});
  try{metadata=(await instance.query(prepareQuery(info.schema,normalizeMangoQuery(info.schema,{selector:{}})))).documents;}
  finally{await instance.close();}
 }
 const pages=(await store.db.pages.find().exec()).map(d=>d.toJSON());
 return {identity,metadata,checkpoint:metadata.find(d=>d.id==='down|1')?.checkpointData??null,pages,physicalPages:await store.db.pages.storageInstance.findDocumentsById(pages.map(d=>d.id),true),journals:(await store.db.localDrafts.find().exec()).map(d=>d.toJSON()),views:await Promise.all([...new Set(['page',...pages.map(d=>d.id)])].map(id=>store.view(id))),state:store.state,writer:store.writer,leader:store.db.isLeader(),events:structuredClone(globalThis.__integration?.events??[])};
}
if(typeof window!=='undefined')window.integrationInspect=inspect;

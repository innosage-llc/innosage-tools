// Test binding only: unchanged PageStore imports these same public helpers.
export {runInTransaction,getDocumentFiles,fetchDocumentContents} from 'rxdb/plugins/replication-google-drive';
import {replicateGoogleDrive as stock} from 'rxdb/plugins/replication-google-drive';
import {createChangesReplication} from '../changes-feasibility/adapter.mjs';
export async function replicateGoogleDrive(options) {
 const capture=globalThis.__integration??={events:[],latest:new Map(),mode:'changes'};
 const record=row=>capture.events.push({at:Date.now(),...row});
 record({type:'factory',database:options.collection.database.name,config:{replicationIdentifier:options.replicationIdentifier,googleDrive:options.googleDrive,live:options.live,retryTime:options.retryTime,waitForLeadership:options.waitForLeadership,pull:options.pull,push:options.push},mode:capture.mode});
 if(capture.mode==='stock'){
  const r=await stock(options);capture.latest.set(options.collection.database.name,r);return r;
 }
 return createChangesReplication(options,{event:record,onCreated:r=>{
  record({type:'created-before-start',database:options.collection.database.name,wasStarted:r.wasStarted,autoStart:r.autoStart});
  const start=r.start.bind(r);r.start=(...args)=>{record({type:'actual-native-start',database:options.collection.database.name,wasStarted:r.wasStarted});return start(...args);};
  capture.latest.set(options.collection.database.name,r);
 }});
}

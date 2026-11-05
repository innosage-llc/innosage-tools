import test from 'node:test';
import assert from 'node:assert/strict';
import {authorize,begin,forget} from '../byos-sync/real-drive/transport.mjs';
test('strict existing-binding preflight never creates folders, including removal during await',async()=>{
 const workspace='12345678-1234-1234-1234-123456789abc';
 globalThis.location={search:'?workspace='+workspace};const values=new Map();
 globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const {preflight,setClientId,bindingKey}=await import('../byos-sync/real-drive/config.mjs');
 const id='123-example.apps.googleusercontent.com';setClientId(id);
 const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('synthetic-account')))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const binding={account,clientId:id,folderId:'existing'};
 const original=globalThis.fetch;const calls=[];let removeDuring=false,folderMissing=false;
 globalThis.fetch=async(url,options)=>{
  calls.push(options.method??'GET');assert.equal(options.method??'GET','GET');
  if(String(url).includes('/about')){if(removeDuring)values.delete(bindingKey);return Response.json({user:{permissionId:'synthetic-account'}});}
  return Response.json({files:folderMissing?[]:[{id:'existing',ownedByMe:true,mimeType:'application/vnd.google-apps.folder',appProperties:{byos113:workspace}}]});
 };
 try {
  authorize('synthetic',60);begin();
  await assert.rejects(preflight({allowCreate:false,expectedBinding:binding}),/binding required/);assert.equal(calls.length,0);
  values.set(bindingKey,JSON.stringify(binding));await preflight({allowCreate:false,expectedBinding:binding});assert.deepEqual(calls,['GET','GET']);
  removeDuring=true;calls.length=0;await assert.rejects(preflight({allowCreate:false,expectedBinding:binding}),/binding required|binding changed/);assert.deepEqual(calls,['GET']);
  removeDuring=false;values.set(bindingKey,JSON.stringify(binding));folderMissing=true;calls.length=0;
  await assert.rejects(preflight({allowCreate:false,expectedBinding:binding}),/unavailable/);assert.deepEqual(calls,['GET','GET']);
  assert.equal(values.get(bindingKey),JSON.stringify(binding));
 }finally{globalThis.fetch=original;forget();}
});
test('strict transport rejects all native folder creation before dispatch; document writes remain available',async()=>{
 const {forbidFolderCreation,driveFetch}=await import('../byos-sync/real-drive/transport.mjs');
 const original=globalThis.fetch;let dispatched=0;globalThis.fetch=async()=>{dispatched++;return Response.json({id:'synthetic-file'});};
 try{
  authorize('synthetic',60);begin();forbidFolderCreation();
  for(const version of [2,3])await assert.rejects(driveFetch(`https://www.googleapis.com/drive/v${version}/files`,{method:'POST',body:JSON.stringify({name:'docs',mimeType:'application/vnd.google-apps.folder',parents:['existing']})}),/FOLDER_CREATION_DISABLED/);
  assert.equal(dispatched,0);
  await driveFetch('https://www.googleapis.com/drive/v3/files',{method:'POST',body:JSON.stringify({name:'page.json',mimeType:'application/json',parents:['existing-docs']})});
  assert.equal(dispatched,1);
 }finally{globalThis.fetch=original;forget();}
});
test('explicit workspace bootstrap permits only its exact folder tree and closes capability',async()=>{
 const {forbidFolderCreation,withApprovedWorkspaceFolders,driveFetch}=await import('../byos-sync/real-drive/transport.mjs');const original=globalThis.fetch;let calls=0,current=true;const ws='12345678-1234-1234-1234-123456789abc';
 globalThis.fetch=async()=>{calls++;return Response.json({id:'root-new'});};const post=metadata=>driveFetch('https://www.googleapis.com/drive/v3/files',{method:'POST',body:JSON.stringify({mimeType:'application/vnd.google-apps.folder',...metadata})});
 try{authorize('synthetic',60);begin();forbidFolderCreation();await withApprovedWorkspaceFolders({workspace:ws,current:()=>{if(!current)throw Error('cancelled');}},async cap=>{
 await assert.rejects(post({name:'personal',parents:['root']}),/FOLDER_CREATION_DISABLED/);
 await post({name:'InnoSage_BYOS_'+ws,parents:['root'],appProperties:{byos113:ws}});cap.setRoot('root-new');
 await assert.rejects(post({name:'docs',parents:['other-root']}),/FOLDER_CREATION_DISABLED/);await post({name:'docs',parents:['root-new']});current=false;await assert.rejects(post({name:'signaling',parents:['root-new']}),/cancelled/);
 });current=true;await assert.rejects(post({name:'docs',parents:['root-new']}),/FOLDER_CREATION_DISABLED/);assert.equal(calls,2);
 }finally{globalThis.fetch=original;forget();}
});
test('native bootstrap cannot write control metadata or body into a re-resolved different root',async()=>{
 const {forbidFolderCreation,withApprovedWorkspaceFolders,driveFetch}=await import('../byos-sync/real-drive/transport.mjs');const original=globalThis.fetch;let writes=0;
 globalThis.fetch=async(url,options)=>{if(options.method==='POST'){writes++;return Response.json({id:'own-control'});}if(options.method==='PUT'){writes++;return Response.json({});}return Response.json({id:'other-control',title:'rxdb.json',mimeType:'application/json',parents:[{id:'other-root'}]});};
 try{authorize('synthetic',60);begin();forbidFolderCreation();await withApprovedWorkspaceFolders({workspace:'12345678-1234-1234-1234-123456789abc',current:()=>{}},async cap=>{
 cap.setRoot('expected-root');
 await assert.rejects(driveFetch('https://www.googleapis.com/drive/v3/files',{method:'POST',body:JSON.stringify({name:'rxdb.json',mimeType:'application/json',parents:['other-root']})}),/CONTROL_CREATE_NOT_ALLOWED/);
 await driveFetch('https://www.googleapis.com/drive/v3/files',{method:'POST',body:JSON.stringify({name:'rxdb.json',mimeType:'application/json',parents:['expected-root']})});
 await assert.rejects(driveFetch('https://www.googleapis.com/drive/v2/files/other-control'),/CONTROL_IDENTITY_CHANGED/);
 await assert.rejects(driveFetch('https://www.googleapis.com/upload/drive/v2/files/other-control?uploadType=media',{method:'PUT',headers:{'If-Match':'"etag"'},body:JSON.stringify({replicationIdentifier:'test'})}),/CONTROL_WRITE_NOT_ALLOWED/);
 });assert.equal(writes,1);
 }finally{globalThis.fetch=original;forget();}
});

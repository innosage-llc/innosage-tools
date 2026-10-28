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

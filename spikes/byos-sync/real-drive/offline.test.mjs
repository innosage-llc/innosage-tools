import test from 'node:test';
import assert from 'node:assert/strict';
import {API,authorize,forget,begin,driveFetch,evidence} from './transport.mjs';

test('ephemeral auth, fixed receiver, sanitized evidence and 401 stop',async()=>{
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return new Response('{}',{status:calls.length===2?401:200});};
 try{
  forget();begin();await assert.rejects(driveFetch(API+'/drive/v3/files'),/REAUTHORIZE/);assert.equal(calls.length,0);
  authorize('SYNTHETIC_TEST_SECRET',60);begin();await driveFetch(API+'/drive/v3/files/secret-file?q=private-query');
  assert.equal(calls[0].options.headers.get('Authorization'),'Bearer SYNTHETIC_TEST_SECRET');assert.equal(calls[0].options.redirect,'error');
  assert.doesNotMatch(JSON.stringify(evidence()),/SYNTHETIC_TEST_SECRET|secret-file|private-query/);
  await assert.rejects(driveFetch(API+'/drive/v3/files'),/REAUTHORIZE/);
  await assert.rejects(driveFetch(API+'/drive/v3/files'),/REAUTHORIZE/);assert.equal(calls.length,2);
 }finally{globalThis.fetch=original;forget();}
});

test('expired auth and request cap reject before dispatch',async()=>{
 const original=globalThis.fetch;let n=0;globalThis.fetch=async()=>{n++;return new Response('{}');};
 try{
  authorize('synthetic',0.001);begin();await new Promise(r=>setTimeout(r,5));await assert.rejects(driveFetch(API+'/drive/v3/files'),/REAUTHORIZE/);assert.equal(n,0);
  authorize('synthetic',60);begin();for(let i=0;i<1000;i++)await driveFetch(API+'/drive/v3/files');
  await assert.rejects(driveFetch(API+'/drive/v3/files'),/BUDGET/);assert.equal(n,1000);
 }finally{globalThis.fetch=original;forget();}
});

test('real folder/account guard fails before native writes on identity drift or incomplete inventory',async()=>{
 globalThis.location={search:'?workspace=12345678-1234-1234-1234-123456789abc'};
 const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 const {preflight,setClientId,bindingKey}=await import('./config.mjs');
 setClientId('123-example.apps.googleusercontent.com');
 const original=globalThis.fetch;let calls=[];let list={files:[],incompleteSearch:true};
 globalThis.fetch=async(url,opts)=>{calls.push(opts.method??'GET');return Response.json(String(url).includes('/about')?{user:{permissionId:'synthetic-account'}}:list);};
 try{
  authorize('synthetic',60);begin();await assert.rejects(preflight(),/incomplete/);assert.deepEqual(calls,['GET','GET']);
  values.set(bindingKey,JSON.stringify({account:'other',clientId:'123-example.apps.googleusercontent.com',folderId:'kept'}));calls=[];
  await assert.rejects(preflight(),/Account\/client changed/);assert.deepEqual(calls,['GET']);
  assert.throws(()=>setClientId('999-other.apps.googleusercontent.com'),/another OAuth/);
  values.delete(bindingKey);list={files:[{id:'x',ownedByMe:true,driveId:'shared',mimeType:'application/vnd.google-apps.folder',appProperties:{byos113:'12345678-1234-1234-1234-123456789abc'}}]};
  calls=[];await assert.rejects(preflight(),/Unsupported/);assert.deepEqual(calls,['GET','GET']);
 }finally{globalThis.fetch=original;forget();}
});

test('browser polling awaits false async results instead of treating Promises as PASS',async()=>{
 const {until}=await import('./wait.mjs');let attempts=0;
 await until({evaluate:async()=>{attempts++;return attempts>=3;}},()=>true,null,{timeout:1000});assert.equal(attempts,3);
 await assert.rejects(until({evaluate:async()=>false},()=>true,null,{timeout:60}),/not reached/);
});

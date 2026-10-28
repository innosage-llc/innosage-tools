import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverTransactionWal} from './prepared-recovery.mjs';
import {WAL_FORMAT,WAL_VERSION} from './prepared-wal.mjs';
const doc=g=>({id:'A',body:'complete-'+g,editId:'A-'+g,_deleted:false});
function fixture({legacy=false}={}){
  const context={workspace:'workspace',allowedIds:new Set(['A']),fileIds:new Map([['A','fileA']])};
  const row={generation:1,fileId:'fileA',base:doc(0),target:doc(1),expectedEtag:'"v0"'};
  const wal=legacy?[{assumedMasterState:doc(0),newDocumentState:doc(1)}]:{format:WAL_FORMAT,version:WAL_VERSION,workspace:'workspace',runId:'run',rows:[row]};
  const snapshot={value:wal,etag:'"wal0"'},files=new Map([['wal',structuredClone(snapshot)],['fileA',{value:doc(0),etag:'"v0"'}]]),writes=[];
  let time=0;
  const io={readFile:async id=>structuredClone(files.get(id)),putFile:async(id,etag,value,{beforeDispatch})=>{beforeDispatch();writes.push({id,etag,value});if(files.get(id).etag!==etag)throw Object.assign(Error('CAS'),{status:412});files.set(id,{value:structuredClone(value),etag:'"next"'});},readPage:async id=>{const value=await io.readFile(id);return {...value,record:value.value};},writePage:(...args)=>io.putFile(...args)};
  return {files,writes,io,args:{snapshot,fileId:'wal',context,io,budget:{assertCanRequest(){assert(time<30000);},remainingMs:()=>30000-time},clock:{now:()=>time,sleep:async ms=>{time+=ms;}},canDispatch:()=>true}};
}
test('versioned and legacy WAL recovery preserve full records and clear only original WAL validator',async()=>{
  for(const legacy of [false,true]){const f=fixture({legacy});const result=await recoverTransactionWal(f.args);assert.equal(result.recovered,1);assert.deepEqual(f.files.get('fileA').value,doc(1));assert.equal(f.files.get('wal').value,null);assert.equal(f.writes[0].etag,'"v0"');assert.equal(f.writes[1].etag,'"wal0"');}
});
test('external edit before recovery retains WAL and both full versions without writing',async()=>{
  for(const legacy of [false,true]){const f=fixture({legacy});f.files.set('fileA',{value:doc(9),etag:'"external"'});await assert.rejects(recoverTransactionWal(f.args),/CONFLICT/);assert.equal(f.writes.length,0);assert(f.files.get('wal').value);}
});
test('race after recovery audit uses stored CAS rather than overwriting fresh ETag',async()=>{
  const f=fixture(),write=f.io.writePage;f.io.writePage=async(...args)=>{f.files.set('fileA',{value:doc(9),etag:'"external"'});return write(...args);};
  await assert.rejects(recoverTransactionWal(f.args),/UPLOAD_CONFLICT/);assert.deepEqual(f.files.get('fileA').value,doc(9));assert(f.files.get('wal').value);
});
test('lost successful content response reconciles without duplicate mutation before WAL cleanup',async()=>{
  const f=fixture(),write=f.io.writePage;f.io.writePage=async(...args)=>{await write(...args);throw Object.assign(Error('lost'),{network:true});};
  await recoverTransactionWal(f.args);assert.equal(f.writes.filter(w=>w.id==='fileA').length,1);assert.equal(f.files.get('wal').value,null);
});
test('unknown version and ambiguous legacy creation fail closed',async()=>{
  const f=fixture();f.args.snapshot.value.version=2;await assert.rejects(recoverTransactionWal(f.args),/UNKNOWN_WAL_VERSION/);assert.equal(f.writes.length,0);
  const g=fixture({legacy:true});delete g.args.snapshot.value[0].assumedMasterState;await assert.rejects(recoverTransactionWal(g.args),/UNSAFE_LEGACY_CREATE/);assert.equal(g.writes.length,0);
});

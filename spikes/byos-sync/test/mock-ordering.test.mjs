import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mock} from '../src/mock.mjs';
test('Drive createdTime desc selects newest page before native signaling reverses it',async()=>{
 const m=await mock();
 try{
  for(const id of ['first','second','third'])m.create({id,name:id+'.json',parents:['signal']});
  const params=new URLSearchParams({q:"'signal' in parents and trashed = false",orderBy:'createdTime desc',
   pageSize:'2',fields:'files(id,name,createdTime),nextPageToken'});
  const list=await(await fetch(m.url+'/drive/v3/files?'+params)).json();
  assert.deepEqual(list.files.map(f=>f.id),['third','second']);
  assert.equal(list.nextPageToken,'2');
  assert.deepEqual([...list.files].reverse().map(f=>f.id),['second','third']);
  params.set('orderBy','createdTime asc');
  const ascending=await(await fetch(m.url+'/drive/v3/files?'+params)).json();
  assert.deepEqual(ascending.files.map(f=>f.id),['first','second']);
 }finally{await m.close();}
});

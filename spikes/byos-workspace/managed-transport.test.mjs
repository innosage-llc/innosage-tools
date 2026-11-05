import test from'node:test';import assert from'node:assert/strict';
import{authorize,forget,begin,driveFetch,requirePinnedWorkspaceActions,withPinnedWorkspaceAction,onProgress}from'../byos-sync/real-drive/transport.mjs';
import{assertDriveLayout}from'./workspace-connection.mjs';
const workspaceId='12345678-1234-1234-1234-123456789abc',layout={workspaceId,rootId:'root',docsId:'docs',signalingId:'signal'};
const page={id:'w142_one',body:JSON.stringify({format:'innosage-workspace-page',version:1,workspaceId,id:'w142_one',title:'One',parentId:null,order:0,markdown:'# one'}),editId:'session/1/id',_deleted:false};
const multipart=(meta,data)=>({headers:{'Content-Type':'multipart/related; boundary="native_test"'},body:'\r\n--native_test\r\nContent-Type: application/json\r\n\r\n'+JSON.stringify(meta)+'\r\n--native_test\r\nContent-Type: application/json\r\n\r\n'+JSON.stringify(data)+'\r\n--native_test--'});
test('managed action admits native multipart/GET-batch/CAS only for pinned identity and fences late auth/layout changes',async()=>{
 const original=globalThis.fetch,calls=[];let live=layout,lateResolve,hold=false;
 requirePinnedWorkspaceActions(()=>live);
 globalThis.fetch=async(url,options)=>{const u=new URL(url);calls.push({path:u.pathname,method:options.method??'GET'});if(hold&&u.pathname.endsWith('/late'))return new Promise(r=>lateResolve=r);if((options.method??'GET')==='GET'){if(u.searchParams.has('fields'))assert(u.searchParams.get('fields').includes('parents'));return Response.json({id:u.pathname.split('/').at(-1),title:'w142_one.json',mimeType:'application/json',parents:[{id:'docs'}]});}return Response.json({id:'created'});};
 const write=(id,data=page)=>driveFetch('https://www.googleapis.com/upload/drive/v2/files/'+id+'?uploadType=media',{method:'PUT',headers:{'If-Match':'"etag"'},body:JSON.stringify(data)});
 try{
  authorize('synthetic',60);begin();await assert.rejects(write('file'),/CLOUD_ACTION_REQUIRED/);assert.equal(calls.length,0);
  await withPinnedWorkspaceAction(async()=>{
   await driveFetch('https://www.googleapis.com/drive/v2/files/file?fields=id,title');await write('file');
   const own=multipart({name:'w142_one.json',mimeType:'application/json',parents:['docs']},page);
   await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',{method:'POST',...own});
   await assert.rejects(driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',{method:'POST',...multipart({name:'w142_one.json',mimeType:'application/json',parents:['other-docs']},page)}),/DESTINATION_MISMATCH/);
   await assert.rejects(write('file',{...page,body:JSON.stringify({...JSON.parse(page.body),workspaceId:'different'})}),/WORKSPACE_MISMATCH/);
   const batch={method:'POST',headers:{'Content-Type':'multipart/mixed; boundary=batch_test'},body:'--batch_test\r\nContent-Type: application/http\r\nContent-ID: <item-0>\r\n\r\nGET /drive/v3/files/file?fields=id,name HTTP/1.1\r\n\r\n--batch_test--'};
   await driveFetch('https://www.googleapis.com/batch/drive/v3',batch);await assert.rejects(driveFetch('https://www.googleapis.com/batch/drive/v3',{...batch,body:batch.body.replace('GET /','DELETE /')}),/BATCH_READ_ONLY/);
  });
  let late;await withPinnedWorkspaceAction(async()=>{hold=true;late=driveFetch('https://www.googleapis.com/drive/v2/files/late');void late.catch(()=>{});await Promise.resolve();});lateResolve(Response.json({id:'late',title:'w142_one.json',mimeType:'application/json',parents:[{id:'docs'}]}));await assert.rejects(late,/ACTION_CLOSED/);hold=false;
  await withPinnedWorkspaceAction(async()=>{await driveFetch('https://www.googleapis.com/drive/v2/files/file');const before=calls.length;onProgress(()=>{onProgress(()=>{});authorize('replacement',60);});await assert.rejects(write('file'),/AUTHORIZATION_CHANGED/);assert.equal(calls.length,before);});
  await withPinnedWorkspaceAction(async()=>{await driveFetch('https://www.googleapis.com/drive/v2/files/file');const before=calls.length;onProgress(()=>{onProgress(()=>{});live={...layout,docsId:'replacement-docs'};});await assert.rejects(write('file'),/LAYOUT_CHANGED/);assert.equal(calls.length,before);});
 }finally{globalThis.fetch=original;onProgress(()=>{});forget();}
});
test('native factory and reused replication must match all pinned root/child identities',()=>{const actual={rootFolderId:'root',docsFolderId:'docs',signalingFolderId:'signal'};assertDriveLayout(layout,actual);for(const key of Object.keys(actual))assert.throws(()=>assertDriveLayout(layout,{...actual,[key]:'other'}),/NATIVE_LAYOUT_CHANGED/);assert.throws(()=>assertDriveLayout({...layout,docsId:'new-docs'},actual),/NATIVE_LAYOUT_CHANGED/);});

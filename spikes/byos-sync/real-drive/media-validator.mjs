// A File metadata snapshot binds a file CAS validator to a content revision.
// Return that ORIGINAL validator with its pinned bytes. Subsequent changes are
// handled by native If-Match/412, just as after an atomic body+ETag read.
// No freshness reread, read retry, write or later-validator substitution.
// Contract: https://developers.google.com/workspace/drive/api/reference/rest/v2/files
// revisionId: https://developers.google.com/workspace/drive/api/reference/rest/v2/files/get
const strongEtag=value=>typeof value==='string'&&/^"[\x21\x23-\x7e\x80-\xff]+"$/.test(value);
function reject(code){throw new Error(code);}
function checked(meta,id){
 if(meta.id!==id||!strongEtag(meta.etag)||typeof meta.version!=='string'||!/^\d+$/.test(meta.version)||
    typeof meta.fileSize!=='string'||!/^\d+$/.test(meta.fileSize)||meta.mimeType!=='application/json'||
    (BigInt(meta.fileSize)!==0n&&!(typeof meta.headRevisionId==='string'&&meta.headRevisionId)))reject('MEDIA_METADATA_UNSUPPORTED');
 return meta;
}
export async function readVersionedMedia(url,init,dispatch){
 const id=decodeURIComponent(url.pathname.split('/').at(-1));
 if(new Headers(init.headers).has('Range'))reject('MEDIA_RANGE_UNSUPPORTED');
 const metadataUrl=new URL(url);metadataUrl.searchParams.delete('alt');metadataUrl.searchParams.delete('revisionId');metadataUrl.searchParams.delete('fields');
 const options={...init,cache:'no-store'};
 const first=await dispatch(metadataUrl,options);if(!first.ok)return first;
 const snapshot=checked(await first.json(),id);
 if(url.searchParams.has('revisionId')&&url.searchParams.get('revisionId')!==snapshot.headRevisionId)reject('MEDIA_REVISION_NOT_CURRENT');
 const downloadUrl=new URL(url);
 if(snapshot.headRevisionId)downloadUrl.searchParams.set('revisionId',snapshot.headRevisionId);
 const media=await dispatch(downloadUrl,options);if(!media.ok)return media;
 const bytes=await media.arrayBuffer();
 // Without a revision, a zero-size snapshot still identifies exactly one body:
 // empty bytes. A concurrent nonempty download fails this same size check.
 if(BigInt(bytes.byteLength)!==BigInt(snapshot.fileSize))reject('MEDIA_SIZE_MISMATCH');
 const headers=new Headers(media.headers);headers.set('ETag',snapshot.etag);
 return new Response(bytes,{status:media.status,statusText:media.statusText,headers});
}

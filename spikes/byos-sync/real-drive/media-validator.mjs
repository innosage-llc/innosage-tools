// Drive's media representation need not expose the file-level CAS validator.
// Correlate bytes to an explicit revision between two fresh metadata reads.
// Never change a PUT/If-Match, retry a write, or invent a validator/body.
// Contract: https://developers.google.com/workspace/drive/api/reference/rest/v2/files
// revisionId: https://developers.google.com/workspace/drive/api/reference/rest/v2/files/get
const strongEtag=value=>typeof value==='string'&&/^"[\x21\x23-\x7e\x80-\xff]+"$/.test(value);
function reject(code){throw new Error(code);}
function checked(meta,id){
 if(meta.id!==id||!strongEtag(meta.etag)||typeof meta.version!=='string'||!/^\d+$/.test(meta.version)||
    typeof meta.fileSize!=='string'||!/^\d+$/.test(meta.fileSize)||meta.mimeType!=='application/json'||
    (meta.fileSize!=='0'&&!(typeof meta.headRevisionId==='string'&&meta.headRevisionId)))reject('MEDIA_METADATA_UNSUPPORTED');
 return meta;
}
export async function readVersionedMedia(url,init,dispatch){
 const id=decodeURIComponent(url.pathname.split('/').at(-1));
 if(new Headers(init.headers).has('Range'))reject('MEDIA_RANGE_UNSUPPORTED');
 const metadataUrl=new URL(url);metadataUrl.searchParams.delete('alt');metadataUrl.searchParams.delete('revisionId');metadataUrl.searchParams.delete('fields');
 const options={...init,cache:'no-store'};
 const first=await dispatch(metadataUrl,options);if(!first.ok)return first;
 const before=checked(await first.json(),id);
 if(url.searchParams.has('revisionId')&&url.searchParams.get('revisionId')!==before.headRevisionId)reject('MEDIA_REVISION_NOT_CURRENT');
 const downloadUrl=new URL(url);
 if(before.headRevisionId)downloadUrl.searchParams.set('revisionId',before.headRevisionId);
 const media=await dispatch(downloadUrl,options);if(!media.ok)return media;
 const bytes=await media.arrayBuffer();
 if(BigInt(bytes.byteLength)!==BigInt(before.fileSize))reject('MEDIA_SIZE_MISMATCH');
 const final=await dispatch(metadataUrl,options);if(!final.ok)return final;
 const after=checked(await final.json(),id);
 for(const key of ['etag','version','headRevisionId','fileSize','mimeType'])if(before[key]!==after[key])reject('MEDIA_VERSION_CHANGED');
 const headers=new Headers(media.headers);headers.set('ETag',before.etag);
 return new Response(bytes,{status:media.status,statusText:media.statusText,headers});
}

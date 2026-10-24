// Fixture-only provider: opaque tokens encode scripted feed positions, never timestamps.
import assert from 'node:assert/strict';
export function provider({event=()=>{}}={}){
 const changes=[],versions=new Map(),omitted=new Set();let m,serial=0;
 const state={pages:null,pagesPrefix:'script',inventoryLimit:2,onInventory:null,omitIds:omitted,recording:true};
 const token=n=>'opaque-'+String(n).padStart(6,'0');
 const index=t=>{assert(/^opaque-\d{6}$/.test(t),'unknown opaque token');return Number(t.slice(7));};
 const metadata=f=>({id:f.id,name:f.name,mimeType:f.mimeType,parents:[...f.parents],modifiedTime:f.modifiedTime,size:String(f.body.length)});
 function refresh(){if(!m)return;for(const f of m.files.values())if(versions.get(f.id)!==f.version){versions.set(f.id,f.version);if(state.recording&&!omitted.has(f.id)){changes.push({fileId:f.id,removed:false,file:metadata(f)});event({type:'fixture-retained-mutation',position:changes.length-1,token:token(changes.length-1),fileId:f.id,name:f.name,version:f.version,rawBody:f.body.toString()});}}}
 function append(fileId,{removed=false}={}){const f=m.files.get(fileId);assert(f);changes.push({fileId,removed,file:metadata(f)});event({type:'fixture-append-event',position:changes.length-1,fileId,removed});}
 async function route({req,u,files,finish}){
  refresh();
  if(req.method==='GET'&&u.pathname==='/drive/v3/changes/startPageToken'){finish(200,{startPageToken:token(changes.length)});return true;}
  if(req.method==='GET'&&u.pathname==='/drive/v3/changes'){
   const maximum=Number(u.searchParams.get('pageSize'));assert(maximum>0);
   const input=u.searchParams.get('pageToken');
   if(state.pages){
    const match=(input===state.scriptStartToken?`${state.pagesPrefix}-0-0`:input).match(new RegExp('^'+state.pagesPrefix+'-(\\d+)-(\\d+)$'));
    if(match){let p=Number(match[1]),offset=Number(match[2]);const all=state.pages[p],out=all.slice(offset,offset+maximum);offset+=out.length;
     let next;if(offset<all.length)next=`${state.pagesPrefix}-${p}-${offset}`;else if(p+1<state.pages.length)next=`${state.pagesPrefix}-${p+1}-0`;
     finish(200,{changes:out,...(next?{nextPageToken:next}:{newStartPageToken:token(changes.length)})});return true;}
   }
   const start=index(input),page=changes.slice(start,start+maximum);assert(start<=changes.length);
   finish(200,{changes:page,...(start+page.length<changes.length?{nextPageToken:token(start+page.length)}:{newStartPageToken:token(changes.length)})});return true;
  }
  if(req.method==='GET'&&u.pathname==='/drive/v3/files'&&u.searchParams.get('orderBy')==='name'){
   const q=u.searchParams.get('q'),parent=q.match(/'([^']+)' in parents/)?.[1];
   const all=[...files.values()].filter(f=>f.parents.includes(parent)&&!m.control.hiddenIds.includes(f.id)).sort((a,b)=>a.name.localeCompare(b.name));
   const start=Number(u.searchParams.get('pageToken')??0),size=Math.min(state.inventoryLimit,Number(u.searchParams.get('pageSize'))),page=all.slice(start,start+size).map(metadata);
   if(state.onInventory){const fn=state.onInventory;state.onInventory=null;await fn({page,parent});refresh();}
   finish(200,{files:page,...(start+page.length<all.length?{nextPageToken:String(start+page.length)}:{})});return true;
  }
  return false;
 }
 return {state,changes,versions,token,index,metadata,refresh,append,route,attach(mock){m=mock;refresh();},snapshot(){refresh();return {changes:structuredClone(changes),versions:[...versions],omitted:[...omitted],scriptedPages:structuredClone(state.pages)};},update(id,doc){const f=m.files.get(id);assert(f);f.body=Buffer.from(JSON.stringify(doc));f.version++;f.modifiedTime=new Date(Date.now()+1000+(++serial)).toISOString();refresh();return f;}};
}

import {Simulation,catalog} from './model.mjs';
import {browserStorage} from './storage.mjs';
const $=id=>document.getElementById(id);
let sim,storage,active='page-1',offset=0,items=[],rendering=false;
const size=Number(new URLSearchParams(location.search).get('size'))===10000?10000:12;
$('catalog').value=String(size);
const workspace=new URLSearchParams(location.search).get('workspace')??'demo';
let releaseOwner;
// Single browser writer per fixture database. Separate tabs cannot overwrite it.
async function start(count) {
  $('editor').disabled=true;
  sim?.close();storage?.close();releaseOwner?.();
  let grant;const granted=new Promise(r=>grant=r);
  if(!navigator.locks) throw new Error('Browser writer locks unavailable; editing disabled');
  navigator.locks.request(`byos-ux-136-${workspace}-${count}`,{ifAvailable:true},async lock=>{
    grant(!!lock);if(lock)await new Promise(r=>releaseOwner=r);
  });
  if(!await granted)throw new Error('Workspace already open in another tab; close that tab first');
  storage=await browserStorage(`${workspace}-${count}`);
  sim=new Simulation(storage,{changed:render});items=catalog(count);offset=0;active='page-1';
  await sim.open();sim.latency=$('latency').value==='never'?'never':Number($('latency').value);
  sim.setFault($('fault').value);nav();load();$('editor').disabled=false;
  window.ux={sim,storage,snapshot:()=>sim.view(active),active:()=>active};
}
function nav(){
  $('catalogInfo').textContent=`${items.length.toLocaleString()} synthetic pages • metadata only; 20 navigation rows at a time`;
  $('pages').replaceChildren(...items.slice(offset,offset+20).map(item=>{const button=document.createElement('button');button.textContent=item.title;button.dataset.page=item.id;button.setAttribute('aria-current',String(item.id===active));button.onclick=()=>{active=item.id;load();nav();};return button;}));
}
function load(){const row=sim.row(active);$('editor').value=row.draft.body;$('pageTitle').textContent=active;render();}
function render(){
  if(!sim||rendering)return;rendering=true;
  try{
    const v=sim.view(active);
    $('localStatus').textContent=({untouched:'No edit yet',pending:'Saving locally…',saved:'Locally saved — this browser only',failed:'NOT SAVED — local commit failed'})[v.local];
    $('cloudStatus').textContent=`SIMULATED cloud: ${v.cloud} • current edit ${v.draft.editId}`;
    $('pendingCount').textContent=`${v.pendingPages} distinct pending pages`;
    $('operation').textContent=v.flight?`SIMULATED ${v.flight.stalled?'STALLED — cancel / recover, then retry':'sending'}: ${v.flight.id} (${v.flight.editId}). Editing remains available.`:'No simulated operation in flight';
    $('resolution').hidden=!v.conflict;
    $('localBody').textContent=v.draft.body;$('remoteBody').textContent=v.conflict?.remote.body??'';
    $('history').textContent=JSON.stringify(v.history,null,2);
    $('error').textContent=v.error??'';
    $('destination').textContent=JSON.stringify(sim.destination(active)??'No confirmed version on simulated second device',null,2);
    const h=sim.handoffRequested?sim.handoff():null;
    $('handoffStatus').textContent=h?`${h.state}\n${h.localProtected}/${h.pages} locally protected\n${h.confirmed}/${h.pages} simulated-cloud confirmed\n${h.pending} pending • ${h.conflicts} conflicts • ${h.errors} errors`:'Prepare explicitly. Local save alone cannot confirm another device.';
  }finally{rendering=false;}
}
const run=fn=>Promise.resolve().then(fn).catch(error=>{$('error').textContent=error.message;});
$('editor').addEventListener('input',()=>{const id=active,body=$('editor').value;run(()=>sim.edit(id,body));});
$('catalog').onchange=()=>run(()=>start(Number($('catalog').value)));
$('nextPages').onclick=()=>{offset=(offset+20)%items.length;nav();};
$('latency').onchange=()=>{sim.latency=$('latency').value==='never'?'never':Number($('latency').value);render();};
$('fault').onchange=()=>sim.setFault($('fault').value);
$('retry').onclick=()=>run(async()=>{$('fault').value='none';await sim.retry();});
$('cancel').onclick=()=>{sim.cancel();$('fault').value=sim.fault;};
$('late').onclick=()=>run(()=>sim.late());
$('failLocal').onclick=()=>{sim.failNext=true;$('error').textContent='SIMULATED next local commit will fail; type to exercise.';};
$('conflict').onclick=()=>run(()=>sim.conflict(active,'# Simulated remote body\n\nComplete conflicting content. Nothing was read from Google Drive.'));
$('handoff').onclick=()=>{sim.handoff();render();};
for(const [id,action] of [['useCloud','cloud'],['keepLocal','local'],['merge','merge']])$(id).onclick=()=>run(async()=>{const page=active;const task=sim.resolve(page,action,$('mergeBody').value);load();await task;});
window.addEventListener('pagehide',()=>{sim?.close();storage?.close();releaseOwner?.();});
await run(()=>start(size));

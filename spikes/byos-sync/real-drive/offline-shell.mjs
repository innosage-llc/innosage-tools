// Browser boundary only. Local intent stays in the existing PageStore/IndexedDB.
export async function prepareOfflineShell({base='/byos-demo/',bundlePath='/byos-demo/app.js'}={}) {
 const status=document.getElementById('offline-status');
 if(location.pathname!==base&&location.pathname!==base+'index.html')return {status:'not-installed'};
 if(!('serviceWorker' in navigator)){status.textContent='Offline reopen is unavailable in this browser; local saves remain durable.';return {status:'unavailable'};}
 let timer;
 try{
  const readiness=(async()=>{
  await navigator.serviceWorker.register(base+'sw.js',{scope:base,updateViaCache:'none'});
  const registration=await navigator.serviceWorker.ready;
  if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
  return registration;
  })();
  const registration=await Promise.race([readiness,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Offline installation unavailable')),10000);})]);
  clearTimeout(timer);
  const version=await new Promise((resolve,reject)=>{
   const channel=new MessageChannel(),timer=setTimeout(()=>reject(new Error('Offline readiness unavailable')),5000);
   channel.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data);};
   registration.active.postMessage('BYOS_OFFLINE_SHELL',[channel.port2]);
  });
  const loaded=new URL([...document.scripts].find(s=>s.src.includes(bundlePath)).src);
  const matching=loaded.pathname+loaded.search===version.bundle;
  status.textContent=matching?'Offline editor ready. Reopening retains local text; Google authorization requires connectivity.':'Offline shell update pending. Existing tabs keep their loaded version; reopening offline uses the previous complete shell.';
  return {status:matching?'ready':'update-pending',...version};
 }catch{
  status.textContent='Offline shell not ready. Local saves remain durable; reconnect before reopening.';
  return {status:'unavailable'};
 }finally{clearTimeout(timer);}
}

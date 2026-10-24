import './browser-runtime.mjs';
// Test adapter only; no product UI or alternate UI-provider route.
import {openPageStore} from './page-store.mjs';
window.boundaries=[];
window.openTest=async options=>{
 window.store=await openPageStore({...options,hook:async(boundary,row)=>{
  window.boundaries.push({boundary,row});
  if(window.holdBoundary===boundary) await new Promise(()=>{});
 }});
 return {writer:window.store.writer};
};

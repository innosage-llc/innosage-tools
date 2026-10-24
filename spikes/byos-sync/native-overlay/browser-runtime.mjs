// Published RxDB's live Drive signaling requires process.nextTick in browser
// bundles (RC7). Minimal scheduling polyfill, not a replication modification.
globalThis.process ??= {env:{}};
globalThis.process.nextTick ??= (fn,...args)=>queueMicrotask(()=>fn(...args));

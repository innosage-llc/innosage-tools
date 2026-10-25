// Separate database namespace; no existing demo identity/storage is touched.
export async function browserStorage(name) {
  const db = await new Promise((resolve,reject)=>{
    const request=indexedDB.open(`byos-ux-136-${name}`,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('journal',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
  });
  return {
    identity:crypto.randomUUID(),
    async all() {return new Promise((resolve,reject)=>{const req=db.transaction('journal').objectStore('journal').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});},
    async put(row) {return new Promise((resolve,reject)=>{
      const tx=db.transaction('journal','readwrite',{durability:'strict'});
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Local commit aborted'));
      tx.objectStore('journal').put(structuredClone(row));
    });},
    close:()=>db.close()
  };
}

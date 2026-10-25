import { parseSceneAuth, sceneJSON, sceneObject, type SceneOwner } from './visual-remix-remote.ts';

// Existing browser-owner capability only. This is not a revoke-only secret.
// No Scene, pixels, pairing proof or host OAuth credentials enter this record.
export type SceneControl = { version: 1; lifetime: 'until-revoked'; createdAt: number; auth: SceneOwner };
export type SceneControlStore = {
  read(): Promise<SceneControl | null>;
  save(control: SceneControl): Promise<void>;
  clear(auth: SceneOwner): Promise<void>;
};
const key = 'active';
export function parseSceneControl(value: unknown): SceneControl {
  const v = sceneObject(value, ['version', 'lifetime', 'createdAt', 'auth']);
  if (v.version !== 1 || v.lifetime !== 'until-revoked' || !Number.isSafeInteger(v.createdAt) || Number(v.createdAt) <= 0) throw new Error('SCENE_CONTROL_RECORD');
  const auth = parseSceneAuth(v.auth, true) as SceneOwner;
  const result: SceneControl = { version: 1, lifetime: 'until-revoked', createdAt: Number(v.createdAt), auth };
  sceneJSON(result, 2048);
  return result;
}
const sameOwner = (a: SceneOwner, b: SceneOwner) => sceneJSON(a) === sceneJSON(b);

// One record per origin, compare-and-set on a single IndexedDB transaction.
// Another tab cannot replace an existing revocation handle with its own grant.
export function createBrowserSceneControlStore(factory: IDBFactory = globalThis.indexedDB): SceneControlStore {
  const run = <T>(write: boolean, operate: (store: IDBObjectStore, current: SceneControl | null, finish: (value: T) => void) => void): Promise<T> => new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('SCENE_CONTROL_STORAGE_UNAVAILABLE')); return; }
    const opening = factory.open('visual-remix-control-v1', 1);
    let settled = false;
    const fail = () => { settled = true; reject(new Error('SCENE_CONTROL_STORAGE')); };
    opening.onerror = fail;
    opening.onblocked = fail;
    opening.onupgradeneeded = () => { opening.result.createObjectStore('control'); };
    opening.onsuccess = () => {
      const db = opening.result;
      if (settled) { db.close(); return; }
      let tx:IDBTransaction;
      try { tx=db.transaction('control', write ? 'readwrite' : 'readonly'); }
      catch { db.close();fail();return; }
      let result: T;
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = tx.onerror = () => { db.close(); fail(); };
      const store = tx.objectStore('control'), request = store.get(key);
      request.onsuccess = () => {
        try { operate(store, request.result === undefined ? null : parseSceneControl(request.result), value => { result = value; }); }
        catch { tx.abort(); }
      };
    };
  });
  return {
    read: () => run(false, (_store, current, finish) => finish(current)),
    save: value => {
      const control = parseSceneControl(value);
      return run<void>(true, (store, current, finish) => {
        if (current && !sameOwner(current.auth, control.auth)) throw new Error('SCENE_CONTROL_EXISTS');
        store.put(control, key); finish(undefined);
      });
    },
    clear: auth => run<void>(true, (store, current, finish) => {
      if (current && !sameOwner(current.auth, auth)) throw new Error('SCENE_CONTROL_MISMATCH');
      if (current) store.delete(key);
      finish(undefined);
    }),
  };
}

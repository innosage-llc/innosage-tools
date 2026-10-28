export {openPageStore} from '../byos-sync/native-overlay/page-store.mjs';
export async function configureProvider(store) { return {real:false, canSync:()=>!!store.replication}; }

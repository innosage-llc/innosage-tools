import { createRxDatabase, addRxPlugin } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { RxDBLeaderElectionPlugin } from 'rxdb/plugins/leader-election';
import { replicateGoogleDrive, runInTransaction, getDocumentFiles,
  fetchDocumentContents } from 'rxdb/plugins/replication-google-drive';

addRxPlugin(RxDBLeaderElectionPlugin);
const LIMIT = 256 * 1024;
const pageSchema = {version:0, primaryKey:'id', type:'object', properties:{
  id:{type:'string',maxLength:100},body:{type:'string',maxLength:LIMIT},
  editId:{type:'string',maxLength:200}},required:['id','body','editId']};
const draftSchema = {version:0,primaryKey:'id',type:'object',properties:{
  id:{type:'string',maxLength:300},page:{type:'string',maxLength:100},
  session:{type:'string',maxLength:100},seq:{type:'integer',minimum:1,maximum:1e9,multipleOf:1},
  state:{type:'string'},draft:{type:'object'},base:{type:['object','null']},
  remote:{type:['object','null']},sourceLocal:{type:['object','null']},
  sourceCloud:{type:['object','null']},sourceExternal:{type:['object','null']}},
required:['id','page','session','seq','state','draft','base','remote','sourceLocal','sourceCloud']};
const copy = value => value == null ? null : structuredClone(value);
export const content = p => p ? {id:p.id,body:p.body,editId:p.editId} : null;
export const same = (a,b) => JSON.stringify(content(a)) === JSON.stringify(content(b));
const nodeOwners = new Set();
const key = (page,session) => `${page}:${session}`;
const valid = (v,name) => {
  if (!/^[a-zA-Z0-9_-]{1,90}$/.test(v)) throw new Error(`Invalid ${name}`);
  return v;
};

/** Two native collections only. No conflict handler or transport override. */
export async function openPageStore({workspace,session,multiInstance=true,hook=async()=>{},connectionProvider=null}) {
  valid(workspace,'workspace'); valid(session,'session');
  const db = await createRxDatabase({name:'overlay'+Array.from(workspace)
    .map(c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join(''),
    storage:getRxStorageDexie(),multiInstance});
  await db.addCollections({pages:{schema:pageSchema},localDrafts:{schema:draftSchema}});
  const store=new PageStore(db,workspace,session,hook);
  store.connectionProvider=connectionProvider;
  // A duplicated browser tab may inherit sessionStorage. Refuse its shared
  // writer identity instead of allowing a second owner to clobber that journal.
  const ownerKey=`overlay:${workspace}:${session}`;
  if(globalThis.navigator?.locks) {
    let grant;
    const granted=new Promise(r=>{grant=r;});
    store.lockTask=navigator.locks.request(ownerKey,{ifAvailable:true},async lock=>{
      store.writer=!!lock; grant();
      if(lock) await new Promise(r=>{store.releaseOwner=r;});
    });
    await granted;
  } else if(typeof window==='undefined') {
    store.writer=!nodeOwners.has(ownerKey);
    if(store.writer) {nodeOwners.add(ownerKey);store.releaseOwner=()=>nodeOwners.delete(ownerKey);}
  } else store.writer=false;
  return store;
}

export class PageStore {
  constructor(db,workspace,session,hook) {
    Object.assign(this,{db,workspace,session,hook});
    this.queue = Promise.resolve(); this.operation = null; this.operationSequence = 0; this.replication = null; this.state = 'clean';
    this.subs = []; this.listeners = new Map(); this.closed = false; this.verified = new Map(); this.notificationVersions = new Map(); this.remoteRefreshes = new Map();
    // Reactive reads are RxDB-native and workspace-scoped by database identity.
    for (const collection of [db.pages,db.localDrafts])
      this.subs.push(collection.$.subscribe(() => this.notify()));
  }
  serial(fn) {
    const task = this.queue.then(fn);
    this.queue = task.catch(() => {});
    return task;
  }
  async page(id) { return content((await this.db.pages.findOne(id).exec())?.toJSON()); }
  async draft(id) { return (await this.db.localDrafts.findOne(key(id,this.session)).exec())?.toJSON() ?? null; }
  async view(id) {
    const [p,d,all] = await Promise.all([this.page(id),this.draft(id),
      this.db.localDrafts.find({selector:{page:id}}).exec()]);
    const competing = d && all.some(other=>other.session!==this.session && !same(other.draft,d.draft));
    const diverged = d && ((!same(p,d.draft)&&!same(p,d.base)) || competing);
    return {body:d?.draft.body ?? p?.body ?? '',
      status:['blocked','reauth-required'].includes(this.state)?this.state:d?.state==='needs-resolution'||diverged ? 'needs-resolution' : d ?
        (['blocked','reauth-required'].includes(this.state)?this.state:'local-saved') : this.verified.has(id)&&same(p,this.verified.get(id))?'remote-verified':this.state,
      warning:!this.writer||!!(d?.state==='needs-resolution'||diverged),
      writer:this.writer,
      local:d?.draft.body ?? null,cloud:d?.remote?.body ?? null,
      drafts:all.map(x=>({session:x.session,body:x.draft.body,state:x.state,seq:x.seq,external:x.sourceExternal?.body??null})),
      page:p,journal:copy(d),operation:this.operation ? {...this.operation,promise:undefined,key:undefined,elapsedMs:this.operation.pending?performance.now()-this.operation.startedAt:this.operation.elapsedMs} : null};
  }
  subscribe(id,callback) {
    if (!this.listeners.has(id)) this.listeners.set(id,new Set());
    this.listeners.get(id).add(callback);
    this.notify();
    return () => this.listeners.get(id)?.delete(callback);
  }
  notify() {
    if(this.closed) return;
    for(const [id,listeners] of this.listeners) {
      const version=(this.notificationVersions.get(id)??0)+1;
      this.notificationVersions.set(id,version);
      this.view(id).then(v=>{
        if(version!==this.notificationVersions.get(id)||this.closed)return;
        for(const cb of listeners)cb(v);
      }).catch(()=>{});
    }
  }
  phase(phase) {
    if(this.operation?.pending){this.operation.phase=phase;this.notify();}
  }
  runOperation(kind,key,fn) {
    if(this.operation?.pending) {
      if(this.operation.kind===kind&&this.operation.key===key)return this.operation.promise;
      return Promise.reject(new Error('Another cloud action is running; local editing and saving remain available'));
    }
    const operation={id:++this.operationSequence,kind,key,phase:'preflight',pending:true,
      startedAt:performance.now(),requestCount:0};
    this.operation=operation;this.operationBusy=true;
    // Publish before the first asynchronous authorization/leadership/network wait.
    this.notify();
    operation.promise=Promise.resolve().then(fn).then(value=>{
      operation.phase='complete';return value;
    },error=>{operation.phase='failed';throw error;}).finally(()=>{
      operation.pending=false;operation.elapsedMs=performance.now()-operation.startedAt;
      this.operationBusy=false;this.notify();
    });
    return operation.promise;
  }
  async save(id,body,options={}) {
    valid(id,'page');
    if(!this.writer) throw new Error('Writer disabled: session already owned or safe ownership unavailable');
    if(typeof body!=='string'||body.length>LIMIT) throw new Error('Draft body limit exceeded');
    return this.serial(async()=>{
      const [old,p,peers] = await Promise.all([this.draft(id),this.page(id),
        this.db.localDrafts.find({selector:{page:id}}).exec()]);
      const expected=Object.hasOwn(options,'base')?content(options.base):p;
      if(expected&&expected.id!==id)throw new Error('Edit baseline page mismatch');
      const conflict = old ? (peers.some(peer=>peer.session!==this.session && !same(peer.draft,old.draft)) || old.state==='needs-resolution' ||
        (!same(p,old.draft)&&!same(p,old.base))) : !same(p,expected);
      const seq=(old?.seq ?? 0)+1;
      const draft={id,body,editId:`${this.session}/${seq}/${crypto.randomUUID()}`};
      // During prepared final reconciliation, newer edits remain journal-only.
      // Rebase only onto our independently confirmed exact predecessor, never
      // onto a newly received external record. The original journal is retained
      // until this new full draft has durably replaced it.
      const held=this.preparedHoldBases?.get(id);
      const heldBase=held&&same(p,held)&&old&&(same(old.draft,held)||same(old.base,held));
      const row={id:key(id,this.session),page:id,session:this.session,seq,
        state:conflict?'needs-resolution':'pending',draft,base:heldBase?copy(held):old?old.base:expected,
        remote:old?.remote??null,sourceLocal:old?.sourceLocal??(conflict?(old?.draft??draft):null),
        sourceCloud:old?.sourceCloud??null,
        sourceExternal:old?.sourceExternal??(conflict?copy(p):null)};
      await this.hook('before-journal-update',copy(row));
      const journalDoc=await this.db.localDrafts.findOne(row.id).exec();
      const committed=journalDoc ? await journalDoc.incrementalModify(current=>{
        const protectedConflict=current.state==='needs-resolution';
        return {...row,seq:current.seq+1,state:protectedConflict?'needs-resolution':row.state,
          remote:current.remote,sourceLocal:current.sourceLocal??row.sourceLocal,
          sourceCloud:current.sourceCloud??row.sourceCloud,sourceExternal:current.sourceExternal??row.sourceExternal};
      }) : await this.db.localDrafts.insert(row);
      const saved=committed.toJSON();
      await this.hook('journal-committed',copy(saved));
      // Never write an unresolved branch back into the replicated collection.
      if(saved.state!=='needs-resolution'&&!this.preparedHoldBases) {
        const pageDoc=await this.db.pages.findOne(id).exec();
        let advanced=false,capturedExternal=null;
        if(pageDoc) await pageDoc.incrementalModify(current=>{
          // RxDB retries this callback on a storage revision conflict. Do not
          // rebase an unresolved branch implicitly onto a newly received page.
          if(!same(current,p)){advanced=true;capturedExternal??=content(current);return current;}
          return {...current,...draft};
        });
        else {
          try {await this.db.pages.insert(draft);}
          catch(error){if(error.code==='CONFLICT'){advanced=true;
            capturedExternal=content(error.parameters?.writeError?.documentInDb)??await this.page(id);
          }else throw error;}
        }
        if(advanced) await committed.incrementalModify(current=>({...current,
          state:'needs-resolution',sourceLocal:current.sourceLocal??copy(current.draft),
          sourceExternal:current.sourceExternal??copy(capturedExternal)}));
        await this.hook('page-written',copy(saved));
      }
      if(!['blocked','reauth-required'].includes(this.state))this.state='local-saved'; this.notify();
      return this.view(id);
    });
  }
  async captureMaster(master) {
    const page=await this.page(master.id);
    // Signals are intentionally ignored as authority. Call only with independently
    // read remote data or current local collection state, never event arrival order.
    const rows=await this.db.localDrafts.find({selector:{page:master.id}}).exec();
    for(const row of rows) await row.incrementalModify(d=>{
      if(same(master,d.draft)||(d.state==='pending'&&same(master,d.base)&&same(page,master))) return d;
      return {...d,state:'needs-resolution',remote:copy(master),
        sourceLocal:d.sourceLocal??copy(d.draft),sourceCloud:d.sourceCloud??copy(master)};
    });
  }
  async holdPreparedGenerations(confirmed,current) {
    return this.serial(async()=>{
      if(!this.writer||this.preparedHoldBases||!current())throw new Error('Prepared reconciliation admission changed');
      const held=new Map();
      for(const [id,observed] of confirmed){
        const page=await this.page(id),draft=await this.draft(id);
        if(!current()||!same(page,observed.record)||!draft||draft.state!=='pending'||!same(draft.draft,observed.record))
          throw new Error('Prepared generation does not match local page and journal');
        held.set(id,content(observed.record));
      }
      if(!current())throw new Error('Prepared generation advanced during admission');
      this.preparedHoldBases=held;
    });
  }
  async retirePreparedGenerations(rows,current) {
    return this.serial(async()=>{
      if(!this.writer||!this.preparedHoldBases||!current())throw new Error('Prepared retirement is not authorized by current generation');
      for(const [id,row] of rows){
        const doc=await this.db.localDrafts.findOne(key(id,this.session)).exec();
        if(!current()||!doc||doc.state!=='pending'||!same(doc.draft,row.target)||!same(await this.page(id),row.target))
          throw new Error('Prepared page advanced; journal retained');
        const initial=doc.toJSON();await this.hook('before-prepared-cleanup',copy(initial));
        const latest=await this.db.localDrafts.findOne(initial.id).exec();
        if(!current()||!latest||latest.seq!==initial.seq||!same(latest.draft,row.target)||!same(await this.page(id),row.target))
          throw new Error('Prepared generation advanced during cleanup');
        await latest.remove();this.verified.set(id,content(row.target));
      }
      if(!current())throw new Error('Prepared completion changed');
      this.preparedHoldBases=null;this.state='clean';this.notify();
    });
  }
  async connect(endpoint,options={}) {
    if(this.connecting) return this.connecting;
    this.connecting=this._connect(endpoint,options);
    try{return await this.connecting;}catch(error){this.failure(error);throw error;}finally{this.connecting=null;}
  }
  async _connect(endpoint,{live=true,transactionTimeout=60000,retryTime=5000,autoStart=true}={}) {
    const url=new URL(endpoint);
    if(!this.connectionProvider&&(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password))
      throw new Error('Offline spike permits only HTTP 127.0.0.1 mock transport');
    if(this.replication) return;
    this.connection={endpoint,options:{live,transactionTimeout,retryTime,autoStart}};
    // Plugin initializes Drive folders BEFORE its own leadership gate.
    // Wait here so only the native elected owner initializes/replicates.
    await this.db.waitForLeadership();
    if(this.closed) return;
    const provider=this.connectionProvider ? await this.connectionProvider() : null;
    this.replication=await (provider?.factory??replicateGoogleDrive)({collection:this.db.pages,
      replicationIdentifier:'native-overlay',googleDrive:provider?.googleDrive??{apiEndpoint:url.origin,
        authToken:'synthetic',oauthClientId:'synthetic',folderPath:this.workspace,transactionTimeout},
      pull:{batchSize:10},push:{batchSize:100},live,autoStart,toggleOnDocumentVisible:!this.explicitSync,waitForLeadership:true,retryTime,
      signalingOptions:{config:{iceServers:[]}}});
    await this.hook('native-created',{workspace:this.workspace});
    this.subs.push(this.replication.error$.subscribe(error=>{
      const status=error.parameters?.status ?? error.parameters?.response?.status;
      this.state=status===401?'reauth-required':'blocked'; this.notify();
    }));
    if(!live&&autoStart) await this.replication.awaitInitialReplication();
    // Event streams invalidate UI only. They never retire or create draft copies.
    this.subs.push(this.replication.sent$.subscribe(()=>this.notify()));
    for(const signal of ['conflict$','received$'])
      this.subs.push(this.replication[signal].subscribe(event=>{
        this.notify();
        const id=event.id??event.input?.realMasterState?.id;
        if(typeof id==='string')this.refreshConflict(id);
      }));
  }
  refreshConflict(id) {
    // Native events are invalidations only. One in-flight read and trailing bit
    // per page; no history, retry timer or cleanup. Pending classification requires
    // native settlement and page=Master distinct from both draft and captured base.
    if(this.closed)return;
    // Explicit cycles materialize once at their owned boundary. Native events
    // remain invalidations and must not start competing background transactions.
    if(this.explicitSync)return;
    const active=this.remoteRefreshes.get(id);
    if(active){active.dirty=true;return;}
    const ticket={dirty:true};this.remoteRefreshes.set(id,ticket);
    ticket.promise=(async()=>{
      while(ticket.dirty&&!this.closed){
        ticket.dirty=false;
        let rows=await this.db.localDrafts.find({selector:{page:id}}).exec();
        if(!rows.length)continue;
        if(rows.some(row=>row.state==='pending'))await this.replication.awaitInSync();
        rows=await this.serial(async()=>{
          const page=await this.page(id);
          return (await this.db.localDrafts.find({selector:{page:id}}).exec())
            .filter(row=>row.state==='needs-resolution'||(row.state==='pending'&&!same(page,row.draft)));
        });
        if(!rows.length)continue;
        await this.withRemote(id,master=>this.serial(async()=>{
          const page=await this.page(id);
          for(const row of rows)await row.incrementalModify(current=>{
            const initial=current.state==='pending'&&same(page,master)&&
              !same(master,current.draft)&&!same(master,current.base);
            if((current.state!=='needs-resolution'&&!initial)||same(current.remote,master))return current;
            return {...current,state:'needs-resolution',remote:copy(master),
              sourceLocal:current.sourceLocal??copy(current.draft),sourceCloud:current.sourceCloud??copy(master)};
          });
        }));
        if(['blocked','reauth-required'].includes(this.state))this.state='pending';
        this.notify();
      }
    })().catch(error=>{
      this.failure(error);if(this.state!=='reauth-required')this.state='blocked';this.notify();
    }).finally(()=>{
      this.remoteRefreshes.delete(id);
      if(ticket.dirty&&!this.closed)this.refreshConflict(id);
    });
  }
  failure(error) {
    const status=error?.parameters?.status;
    if(status||error instanceof TypeError) {this.state=status===401?'reauth-required':'blocked';this.notify();}
  }
  async disconnect() {
    if(this.replication)await this.replication.cancel();
    this.replication=null;
  }
  sync() { return this.runOperation('sync',null,()=>this._sync()); }
  async _sync({materialize=true}={}) {
    if(!this.replication) throw new Error('No native sync owner in this tab');
    if(this.replication.isStopped()) {
      this.replication=null;
      await this.connect(this.connection.endpoint,this.connection.options);
    }
    this.phase('synchronizing');this.state='syncing';this.notify();
    const r=this.replication;
    try {
      if(this.explicitSync)await r.start();
      else r.reSync();
      await r.awaitInitialReplication();
      await r.awaitInSync();
    } finally {
      if(this.explicitSync) {
        // Public native lifecycle only. Drain already-dispatched work before
        // reporting completion; paused local saves are picked up by next start.
        await r.pause();
        if(r.internalReplicationState)await r.awaitInSync();
      }
    }
    if(materialize) {
      this.phase('reading');
      const ids=new Set((await this.db.localDrafts.find().exec()).map(d=>d.page));
      for(const id of ids)await this.withRemote(id,master=>this.serial(()=>this.captureMaster(master)));
    }
    this.state='pending';this.notify();
  }
  async remote(id) { return this.withRemote(id,remote=>copy(remote)); }
  async withRemote(id,fn) {
    const r=this.replication;
    if(!r) throw new Error('Remote verification requires native sync owner');
    // Published native transaction first drains WAL. This is verification only:
    // no custom replication, direct document writes, or assumed-master mutation.
    let callbackFailed=false,callbackError;
    const result=await (r.runInTransaction??runInTransaction)(r.googleDrive,r.driveStructure,'id',async()=>{
      // Published runInTransaction has no finally-release for callback errors.
      // Our callback performs reads/local checks only. Let the native transaction
      // release its own CAS lease before surfacing an app/body/guard failure.
      try {
        const files=await getDocumentFiles(r.googleDrive,r.driveStructure,[id]);
        if(files.files.length!==1)throw new Error('Remote document missing or ambiguous');
        const docs=await fetchDocumentContents(r.googleDrive,[files.files[0].id]);
        const remote=content(docs.ordered[0]);
        if(remote?.id!==id)throw new Error('Remote document identity mismatch');
        return await fn(remote);
      }catch(error){callbackFailed=true;callbackError=error;}
    }).catch(error=>{this.failure(error);throw error;});
    if(callbackFailed){this.failure(callbackError);throw callbackError;}
    return result;
  }

  verify(id) { return this.runOperation('verify',id,()=>this._verify(id)); }
  async _verify(id) {
    if(!this.writer) throw new Error('Writer disabled: verification retirement requires session ownership');
    await this._sync({materialize:false});
    this.phase('verifying');
    await this.withRemote(id,remote=>this.serial(async()=>{
      await this.hook('remote-read',copy(remote));
      const d=await this.draft(id);
      if(d && same(remote,d.draft)) {
        await this.hook('before-cleanup',copy(d));
        // Same-session mutations are serialized. Other tab sessions use other keys.
        const current=await this.db.localDrafts.findOne(d.id).exec();
        if(!current||current.seq!==d.seq||!same(current.draft,d.draft))
          throw new Error('Draft advanced; verification cannot retire it');
        await current.remove();
        await this.hook('after-cleanup',copy(d));
        this.verified.set(id,copy(remote)); this.state='clean';
      } else if(d) await this.captureMaster(remote);
      else this.state='clean';
      this.notify();
    }));
    return this.view(id);
  }
  resolve(id,action,mergedBody) {
    // Capture before any outer authorization/preflight wait. A newer Save is
    // serialized after this read and must invalidate this choice, not become it.
    const intended=this.serial(()=>this.draft(id));
    return this.runOperation('resolve-'+action,JSON.stringify([id,mergedBody]),()=>this._resolve(id,action,mergedBody,intended));
  }
  async _resolve(id,action,mergedBody,intended) {
    if(!this.writer) throw new Error('Writer disabled: session ownership required');
    if(!['cloud','local','merge'].includes(action)) throw new Error('Unknown resolution');
    if(action==='merge'&&(typeof mergedBody!=='string'||mergedBody.length>LIMIT))
      throw new Error('Invalid merged body');
    const initial=await intended;
    if(!initial)throw new Error('No protected draft for this session');
    await this._sync({materialize:false});
    this.phase('reading');
    const remote=await this.remote(id);
    // Retain the second native settlement and all original baseline/sequence
    // guards. Only redundant journal materialization is omitted.
    await this._sync({materialize:false});
    this.phase('resolving');
    if(action==='cloud') {
      await this.withRemote(id,newest=>this.serial(async()=>{
        if(!same(newest,remote)||!same(await this.page(id),newest))
          throw new Error('Master advanced; draft retained for review');
        const current=await this.db.localDrafts.findOne(initial.id).exec();
        if(!current||current.seq!==initial.seq||!same(current.draft,initial.draft))
          throw new Error('Draft advanced; discard requires review');
        await this.hook('before-cloud-discard',copy(initial),{remote:copy(newest)});
        const afterHook=await this.db.localDrafts.findOne(initial.id).exec();
        if(!afterHook||afterHook.seq!==initial.seq||!same(afterHook.draft,initial.draft)||!same(await this.page(id),newest))
          throw new Error('Generation advanced during discard validation; draft retained');
        await afterHook.remove();
      }));
      this.state='clean';this.notify();return this.view(id);
    }
    return this.serial(async()=>{
      const old=await this.draft(id);
      if(!old||old.seq!==initial.seq||!same(old.draft,initial.draft))
        throw new Error('Draft advanced; resolution requires review');
      if(!same(await this.page(id),remote))throw new Error('Master not yet pulled; draft retained');
      const draft={id,body:action==='merge'?mergedBody:old.draft.body,
        editId:`${this.session}/${old.seq+1}/${crypto.randomUUID()}`};
      const row={...old,seq:old.seq+1,state:'pending',draft,base:remote,remote,
        sourceLocal:old.sourceLocal??old.draft,sourceCloud:old.sourceCloud??remote};
      await this.db.localDrafts.upsert(row);
      await this.hook('resolution-journal',copy(row));
      const pageDoc=await this.db.pages.findOne(id).exec();
      let masterAdvanced=false;
      if(!pageDoc)masterAdvanced=true;
      else await pageDoc.incrementalModify(current=>{
        if(!same(current,remote)){masterAdvanced=true;return current;}
        return {...current,...draft};
      });
      if(masterAdvanced) await (await this.db.localDrafts.findOne(row.id).exec())
        .incrementalModify(current=>({...current,state:'needs-resolution'}));
      await this.hook('resolution-written',copy(row));
      this.state='pending'; this.notify(); return this.view(id);
    });
  }
  async close() {
    this.closed=true;
    for(const s of this.subs)s.unsubscribe();
    if(this.replication) await this.replication.cancel();
    await this.db.close();
    this.releaseOwner?.();
    await this.lockTask;
  }
}

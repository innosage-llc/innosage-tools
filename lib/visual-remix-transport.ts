import { parseUntilRevokedConsent, type UntilRevokedConsent } from './visual-remix-lifetime.ts';
import { parseSceneControl, type SceneControlStore } from './visual-remix-control-store.ts';
import { REFERENCE_LIMITS } from './visual-remix-reference.ts';
import type { PreparedReference } from './visual-remix-reference-browser.ts';
import type { Proposal } from './visual-remix.ts';
import { VisualRemixOfflineBridge, SCENE_SHARE_FIELDS } from './visual-remix-bridge.ts';
import { VisualRemixController } from './visual-remix-controller.ts';
import { SCENE_LIMITS, parseSceneAuth, parseSceneProposal, parseSceneSnapshot, sceneJSON, sceneObject, type SceneOwner, type SceneSnapshot, type SceneState } from './visual-remix-remote.ts';
import type { SceneSharingState } from './visual-remix-sharing-view.ts';
import { SCENE_REAUTH_CHANNEL, type SceneReauthorizationPrompt } from './visual-remix-reauth-contract.ts';
import { SCENE_SCOPES } from './visual-remix-remote.ts';

type Frame = { snapshot: SceneSnapshot; states: [string, SceneState][] };
type Share = { auth: SceneOwner; proof: string; expiresAt: number|null; proofExpiresAt: number; lifetime?:'until-revoked'; cacheEpoch:number };
class SceneHttpError extends Error {
  readonly diagnostic: NonNullable<SceneSharingState['diagnostic']>;
  constructor(response: Response) {
    super('SCENE_HTTP_' + response.status);
    const safe = (name: string, pattern: RegExp) => { const value = response.headers.get(name); return value && pattern.test(value) ? value : undefined; };
    this.diagnostic = { status:response.status, requestId:safe('X-Visual-Remix-Request-Id',/^[a-f0-9-]{36}$/), version:safe('X-Visual-Remix-Version',/^\d{1,3}\.\d{1,3}\.\d{1,3}$/), revision:safe('X-Visual-Remix-Revision',/^[a-f0-9]{40}$/) };
  }
}
const recovery = (error?: unknown) => error instanceof SceneHttpError && error.diagnostic.status === 401
  ? 'Browser ownership expired or was revoked. Disconnect, create a fresh share and manually reconnect the host.'
  : error instanceof SceneHttpError && error.diagnostic.status === 429
  ? 'A service or storage limit was reached. Stop retrying and report the connection diagnostic.'
  : 'Disconnect to confirm service revocation; a new share requires fresh manual host authorization.';
type Sender = (path: string, init: RequestInit) => Promise<Response>;
type ReauthorizationChannel=Pick<BroadcastChannel,'onmessage'|'postMessage'|'close'>;

// Only instantiated behind the product build gate and explicit user consent.
// No configurable destination, host credential persistence, Apply or export. Only a
// freshly consented reference derivative can enter the dedicated image route.
export class VisualRemixTransport {
  private reference: PreparedReference | null = null;
  private referenceUploaded = false;
  private readonly preparing = new Map<string,AbortController>();
  private readonly preparationStates = new Map<string,SceneState>();
  private materialize: ((proposal: unknown, reference: PreparedReference, signal: AbortSignal) => Promise<Proposal>) | null = null;
  private bridge: VisualRemixOfflineBridge | null = null;
  private owner: Share | null = null;
  private creating = false;
  private controlStored=false;
  private disconnecting:{owner:Share|null;promise:Promise<void>}|null=null;
  private restorePromise:Promise<void>|null=null;
  private lastSyncAt=0;
  private suspensionReset=false;
  private stopped = true;
  private disposed = false;
  private pumping = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly issued = new Set<string>();
  private readonly acknowledged = new Map<string, SceneState>();
  private frames: Frame[] = [];
  private fingerprint = '';
  private state: SceneSharingState;
  private reauthorizationChannel:ReauthorizationChannel|null=null;
  private reauthorizationPrompt:SceneReauthorizationPrompt|undefined;
  private reauthorizationLookup:string|null=null;
  constructor(private readonly controller: VisualRemixController, private readonly available: boolean,
    private readonly changed: (state: SceneSharingState) => void, private readonly renderChanged: () => void,
    private readonly send: Sender = (path, init) => fetch(path, init), private readonly now: () => number = Date.now,
    private readonly options:{untilRevoked?:boolean;controlStore?:SceneControlStore;reauthorization?:boolean;reauthorizationChannel?:()=>ReauthorizationChannel} = {}) {
    this.state = { available, canConnect: available && !options.untilRevoked, canDisconnect: false, phase: options.untilRevoked?'connecting':'disconnected', untilRevokedAvailable:!!options.untilRevoked };
    if(available&&options.reauthorization){
      try {
        this.reauthorizationChannel=options.reauthorizationChannel?.()??(typeof BroadcastChannel!=='undefined'?new BroadcastChannel(SCENE_REAUTH_CHANNEL):null);
        if(this.reauthorizationChannel)this.reauthorizationChannel.onmessage=event=>{void this.receiveReauthorization(event.data);};
      }catch{this.reauthorizationChannel=null;}
    }
  }
  snapshot(): SceneSharingState { return { ...this.state }; }
  private publish(value: Omit<SceneSharingState, 'available'>): void {
    if(value.phase!=='connected'||this.disposed||!this.bound())this.reauthorizationPrompt=undefined;
    this.state = { available: this.available, untilRevokedAvailable:!!this.options.untilRevoked, ...value,reauthorizationPrompt:this.reauthorizationPrompt };
    if (!this.disposed) this.changed(this.snapshot());
  }
  private activeReauthorizationOwner():Share|null {
    return this.options.reauthorization&&!this.disposed&&!this.stopped&&this.bridge&&this.state.phase==='connected'&&this.bound()?this.owner:null;
  }
  private async receiveReauthorization(input:unknown):Promise<void>{
    const owner=this.activeReauthorizationOwner();if(!owner||!this.reauthorizationChannel)return;
    let id:string;
    try {sceneJSON(input,512);const message=sceneObject(input,['type','requestId']);if(message.type!=='scene-reauth-request')return;id=String(message.requestId);if(!/^[a-zA-Z0-9_-]{1,96}$/.test(id))return;}catch{return;}
    if(this.reauthorizationPrompt&&this.now()>=this.reauthorizationPrompt.expiresAt)this.reauthorizationPrompt=undefined;
    if(this.reauthorizationPrompt||this.reauthorizationLookup)return;
    this.reauthorizationLookup=id;const started=this.now();
    try {
      const value=sceneObject(await this.call('reauth/describe',{auth:owner.auth,requestId:id}),['requestId','clientId','clientName','redirectHost','resource','scopes','expiresAt','issuedAt','state']);
      if(this.activeReauthorizationOwner()!==owner)return;
      const remaining=Number(value.expiresAt)-Number(value.issuedAt),resource=typeof value.resource==='string'?new URL(value.resource):null;
      if(value.requestId!==id||!Number.isSafeInteger(value.expiresAt)||!Number.isSafeInteger(value.issuedAt)||remaining<=0||remaining>SCENE_LIMITS.proofMs||this.now()>=started+remaining||!resource||resource.pathname!=='/scene/mcp'||resource.search||resource.hash||resource.username||resource.password||typeof location!=='undefined'&&resource.origin!==location.origin||!Array.isArray(value.scopes)||value.scopes.length!==SCENE_SCOPES.length||!SCENE_SCOPES.every(scope=>(value.scopes as unknown[]).includes(scope))||typeof value.clientId!=='string'||!value.clientId||value.clientId.length>2048||typeof value.clientName!=='string'||value.clientName.length>128||typeof value.redirectHost!=='string'||value.redirectHost.length>256||!['pending','issued','consumed','revoked'].includes(String(value.state)))throw new Error('SCENE_REAUTH_RESPONSE');
      this.reauthorizationPrompt={requestId:id,clientId:value.clientId,clientName:value.clientName,redirectHost:value.redirectHost,resource:resource.href,expiresAt:started+remaining,state:value.state==='pending'?'pending':'error',...(value.state==='pending'?{}:{error:'This authorization request was already prepared or consumed. Check its OAuth window; do not blindly issue another proof.'})};
      this.publish({...this.state});
    }catch{
      if(this.activeReauthorizationOwner()===owner){this.reauthorizationPrompt={requestId:id,clientId:'',clientName:'Authorization unavailable',redirectHost:'',resource:'',expiresAt:started+SCENE_LIMITS.proofMs,state:'error',error:'Could not verify this reconnect request. Keep the original editor active and check the OAuth window; no proof was issued.'};this.publish({...this.state});}
    }finally{if(this.reauthorizationLookup===id)this.reauthorizationLookup=null;}
  }
  async approveReauthorization(requestId:string,confirmed:boolean):Promise<void>{
    const owner=this.activeReauthorizationOwner(),prompt=this.reauthorizationPrompt;
    if(!confirmed||!owner||!prompt||prompt.requestId!==requestId||prompt.state!=='pending'||this.now()>=prompt.expiresAt||!this.reauthorizationChannel)return;
    prompt.state='issuing';this.publish({...this.state});const started=this.now();
    try {
      // Never retry proof issuance: a lost response may conceal a committed proof.
      const value=sceneObject(await this.call('reauth/issue',{auth:owner.auth,requestId,confirmed:true}),['requestId','proof','expiresAt','issuedAt']);
      if(this.activeReauthorizationOwner()!==owner||this.reauthorizationPrompt!==prompt)return;
      const remaining=Number(value.expiresAt)-Number(value.issuedAt);
      if(value.requestId!==requestId||typeof value.proof!=='string'||!/^[a-f0-9]{64}$/.test(value.proof)||!Number.isSafeInteger(value.expiresAt)||!Number.isSafeInteger(value.issuedAt)||remaining<=0||remaining>SCENE_LIMITS.proofMs||this.now()>=started+remaining)throw new Error('SCENE_REAUTH_RESPONSE');
      this.reauthorizationChannel.postMessage({type:'scene-reauth-proof',requestId,proof:value.proof});
      prompt.state='sent';this.publish({...this.state});
    }catch{
      if(this.activeReauthorizationOwner()===owner&&this.reauthorizationPrompt===prompt){prompt.state='error';prompt.error='Proof preparation or delivery is unconfirmed. Check or cancel this OAuth window; do not blindly reissue or create another share.';this.publish({...this.state});}
    }
  }
  dismissReauthorization():void{this.reauthorizationPrompt=undefined;this.publish({...this.state});}
  restoreControl():Promise<void> {
    if(!this.options.untilRevoked || this.disposed)return Promise.resolve();
    if(!this.restorePromise)this.restorePromise=(async()=>{
      try {
        if(!this.options.controlStore)throw new Error('SCENE_CONTROL_STORAGE_UNAVAILABLE');
        const saved=await this.options.controlStore.read();
        if(this.disposed || this.owner || this.creating)return;
        if(saved){
          const record=parseSceneControl(saved);
          this.owner={auth:record.auth,proof:'',expiresAt:null,proofExpiresAt:0,lifetime:'until-revoked',cacheEpoch:0};this.controlStored=true;
          this.publish({phase:'recovery',canConnect:false,canDisconnect:true,lifetime:'until-revoked',expiresAt:null,notice:'Saved browser control found. This does not reconnect or share your current Scene. Disconnect the previous grant before a fresh connection. Local work is preserved.'});
        }else this.publish({phase:'disconnected',canConnect:this.available,canDisconnect:false});
      }catch{if(!this.disposed)this.publish({phase:'error',canConnect:false,canDisconnect:false,error:'Saved browser control could not be read. Local editing and exports still work. Do not create another permanent grant until recovery is resolved.'});}
    })();
    return this.restorePromise;
  }
  private openBridge(expiresAt:number|null):VisualRemixOfflineBridge {
    const local=this.controller.snapshot(),base={purpose:'visual-remix' as const,confirmed:true as const,projectId:local.projectId,generation:local.generation,fields:SCENE_SHARE_FIELDS};
    return new VisualRemixOfflineBridge(this.controller,expiresAt===null?{...base,expiresAt:null,lifetime:'until-revoked'}:{...base,expiresAt},this.now);
  }
  private resetPending(forget=true):void {
    for(const abort of this.preparing.values())abort.abort();this.preparing.clear();this.bridge?.revoke();
    if(forget){this.preparationStates.clear();this.issued.clear();this.acknowledged.clear();this.referenceUploaded=false;}
    else for(const id of this.issued){
      const state=this.preparationStates.get(id)??this.controller.status(id);
      this.preparationStates.set(id,state && !['rendering','preview'].includes(state)?state:'canceled');
    }
    this.frames=[];this.fingerprint='';
    if(this.owner)this.bridge=this.openBridge(this.owner.expiresAt);
    this.renderChanged();
  }
  private acceptCache(value:unknown):boolean {
    if(!this.owner?.lifetime)return false;
    if(!Number.isSafeInteger(value) || Number(value)<this.owner.cacheEpoch)throw new Error('SCENE_CACHE_GENERATION');
    if(Number(value)===this.owner.cacheEpoch)return false;
    this.owner.cacheEpoch=Number(value);this.resetPending();this.notifyLocalChange();return true;
  }
  private async call(path: string, data: unknown, retry = false): Promise<unknown> {
    const body = sceneJSON(data, path === 'reference' ? REFERENCE_LIMITS.wireBytes : SCENE_LIMITS.wireBytes);
    for (let attempt = 0; ; attempt++) {
      const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), path === 'create' || path === 'reference' ? 15000 : 5000);
      let retryable = true;
      try {
        const response = await this.send('/scene/browser/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: abort.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
        if (!response.ok) { retryable = response.status >= 500; throw new SceneHttpError(response); }
        if (response.headers.get('content-type')?.split(';')[0] !== 'application/json') { retryable = false; throw new Error('SCENE_TRANSPORT'); }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('SCENE_RESPONSE');
        const parts: Uint8Array[] = []; let count = 0;
        try {
          for (;;) { const { done, value } = await reader.read(); if (done) break; count += value.byteLength; if (count > SCENE_LIMITS.wireBytes) { await reader.cancel(); throw new Error('SCENE_RESPONSE'); } parts.push(value); }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(count); let offset = 0;
        for (const part of parts) { bytes.set(part, offset); offset += part.length; }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch (error) { if (!retry || !retryable || attempt >= 1) throw error; }
      finally { clearTimeout(timeout); }
    }
  }
  async connect(confirmed: boolean, reference?: PreparedReference, materialize?: (proposal: unknown, reference: PreparedReference, signal: AbortSignal) => Promise<Proposal>, lifetime?:UntilRevokedConsent): Promise<void> {
    if (!confirmed || !this.available || !this.state.canConnect || this.disposed) throw new Error('SCENE_SHARE_NOT_CONFIRMED');
    const until=lifetime!==undefined;
    if(until){parseUntilRevokedConsent(lifetime);if(!this.options.untilRevoked || !this.options.controlStore)throw new Error('SCENE_LIFETIME_NOT_AVAILABLE');}
    this.reference = reference ?? null; this.referenceUploaded = false; this.materialize = materialize ?? null;
    const startedAt = this.now(), expiresAt = until?null:startedAt + SCENE_LIMITS.leaseMs;
    const proofExpiresAt = startedAt + SCENE_LIMITS.proofMs;
    const bridge = this.openBridge(expiresAt);
    let snapshot: SceneSnapshot;
    try { snapshot = parseSceneSnapshot(bridge.getScene()); } catch (error) { bridge.revoke(); throw error; }
    this.bridge = bridge; this.stopped = false; this.creating = true;this.lastSyncAt=startedAt;this.suspensionReset=false;
    this.publish({ phase:'connecting', canConnect:false, canDisconnect:true });
    try {
      // Never retry creation: a lost response can conceal a committed share.
      const value = sceneObject(await this.call('create', { snapshot, fields:SCENE_SHARE_FIELDS, confirmed:true, ...(until?{lifetime}:{leaseMs:SCENE_LIMITS.leaseMs}), ...(reference ? {referenceConsent:reference.consent} : {}) }), until?['auth','proof','expiresAt','proofExpiresAt','lifetime','issuedAt']:['auth','proof','expiresAt','proofExpiresAt']);
      const auth = parseSceneAuth(value.auth,true) as SceneOwner;
      if (auth.projectId !== snapshot.projectId || auth.generation !== snapshot.generation) throw new Error('SCENE_BINDING');
      // Retain validated ownership only for explicit Disconnect if confirmation fails.
      this.owner = { auth, proof:'', expiresAt, proofExpiresAt,cacheEpoch:0,...(until?{lifetime:'until-revoked' as const}:{}) };
      if(until){
        try {await this.options.controlStore!.save({version:1,lifetime:'until-revoked',createdAt:startedAt,auth});this.controlStored=true;}
        catch {
          this.creating=false;await this.disconnect('Browser control could not be retained. The new grant must be revoked before continuing.');
          if(!this.owner){this.restorePromise=null;await this.restoreControl();}
          return;
        }
      }
      this.creating = false;
      // Honor cancellation/disposal even when the rest of confirmation is invalid.
      if (this.stopped || this.disposed || !this.bound()) { await this.disconnect(); return; }
      if (typeof value.proof !== 'string' || !/^[a-f0-9]{64}$/.test(value.proof) ||
        !(until ? value.expiresAt===null && value.lifetime==='until-revoked' && Number.isSafeInteger(value.issuedAt) && Number(value.proofExpiresAt)-Number(value.issuedAt)===SCENE_LIMITS.proofMs : Number.isSafeInteger(value.expiresAt) && Number(value.expiresAt)>=SCENE_LIMITS.leaseMs && Number(value.expiresAt)-Number(value.proofExpiresAt)===SCENE_LIMITS.leaseMs-SCENE_LIMITS.proofMs) ||
        !Number.isSafeInteger(value.proofExpiresAt) || Number(value.proofExpiresAt) < SCENE_LIMITS.proofMs ||
        this.now() >= proofExpiresAt) throw new Error('SCENE_BINDING');
      // The server enforces its own fixed-duration leases. Starting this browser's
      // deadlines before create is conservative without assuming clock agreement.
      this.owner.proof = value.proof;
      this.creating = false;
      if (this.stopped || this.disposed || !this.bound()) { await this.disconnect(); return; }
      this.publish({ phase:'awaiting-consent', proof:value.proof, expiresAt:this.owner.expiresAt, lifetime:this.owner.lifetime, canConnect:false, canDisconnect:true });
      this.notifyLocalChange(); this.schedule();
    } catch (error) {
      this.creating = false; this.stopped = true; bridge.revoke();
      const detail = error instanceof Error && /^SCENE_HTTP_\d{3}$/.test(error.message) ? ` (service returned HTTP ${error.message.slice(-3)})` : error instanceof Error && error.name === 'AbortError' ? ' (request timed out)' : '';
      this.publish({ phase:'error', canConnect:false, canDisconnect:!!this.owner, diagnostic:error instanceof SceneHttpError ? error.diagnostic : undefined, error:`Sharing could not be confirmed${detail}. ${recovery(error)} A share may exist; ${until?'newly consented access lasts until revoke, while inactive cached content is cleaned separately':'access is lease-limited but stored content can remain until cleanup'}. Use Disconnect when available. No automatic reconnect or revocation claim.` });
    }
  }
  private bound(): boolean {
    const state = this.controller.snapshot();
    return !!this.owner && !state.loading && state.projectId === this.owner.auth.projectId && state.generation === this.owner.auth.generation && (this.owner.expiresAt===null || this.now() < this.owner.expiresAt);
  }
  notifyLocalChange(): void {
    if (this.stopped || !this.bridge || !this.owner) return;
    if (!this.bound()) { void this.disconnect(this.expirationNotice()); return; }
    if(this.owner.lifetime && !this.suspensionReset && this.now()-this.lastSyncAt>=SCENE_LIMITS.leaseMs){this.suspensionReset=true;this.resetPending(false);}
    let frame: Frame;
    try { frame = { snapshot:parseSceneSnapshot(this.bridge.getScene()), states:[] }; } catch { this.fail(); return; }
    for (const id of this.issued) {
      const status = this.preparationStates.get(id) ?? this.controller.status(id);
      if (status && status !== 'rendering') frame.states.push([id,status]);
    }
    const fingerprint = sceneJSON(frame, SCENE_LIMITS.wireBytes);
    if (fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint;
    if (this.frames.length >= 64) { this.fail(); return; }
    this.frames.push(frame); void this.pump();
  }
  refresh(): void {
    // Wake an existing, unexpired consent session only. Never reconnect/create
    // or extend its proof/lease when the browser regains foreground focus.
    if (this.stopped || !this.owner) return;
    this.fingerprint = ''; this.notifyLocalChange();
  }
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(() => { this.timer = null; if (this.owner && this.state.phase === 'awaiting-consent' && this.now() >= this.owner.proofExpiresAt) { void this.disconnect('Pairing proof expired. Create a fresh share and manually reconnect the host; no automatic reconnection.'); return; } this.fingerprint = ''; this.notifyLocalChange(); this.schedule(); }, 3000);
  }
  private expirationNotice(): string {
    return this.owner && this.owner.expiresAt!==null && this.now() >= this.owner.expiresAt
      ? 'Sharing lease expired. Create a fresh share and manually reconnect the host; saved local work is preserved.'
      : 'The local project changed. Create a fresh share and manually reconnect the host.';
  }
  private fail(error?: unknown): void {
    for(const abort of this.preparing.values()) abort.abort(); this.preparing.clear();
    this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; this.frames = [];
    this.bridge?.revoke(); this.renderChanged();
    this.publish({ phase:'error', canConnect:false, canDisconnect:!!this.owner, reauthorizationRequired:error instanceof SceneHttpError && error.diagnostic.status===401 || !!this.owner && this.owner.expiresAt!==null && this.now()>=this.owner.expiresAt, diagnostic:error instanceof SceneHttpError ? error.diagnostic : undefined, error:`Connection stopped. Local edits and exports are preserved. ${recovery(error)} Expiration alone does not guarantee physical deletion.` });
  }
  private async pump(): Promise<void> {
    if (this.pumping || this.stopped || !this.owner) return;
    this.pumping = true; const startedOwner = this.owner;
    try {
      while (!this.stopped && this.frames.length) {
        const owner: Share = this.owner, frame: Frame = this.frames.shift()!;
        if (!this.bound()) { await this.disconnect(this.expirationNotice()); break; }
        const synced = sceneObject(await this.call('sync', { auth:owner.auth, snapshot:frame.snapshot },true), owner.lifetime?['ok','cacheEpoch']:['ok']);
        if (this.stopped || this.owner !== owner) return;
        if (synced.ok !== true) throw new Error('SCENE_SYNC');
        this.lastSyncAt=this.now();this.suspensionReset=false;
        if(owner.lifetime && this.acceptCache(synced.cacheEpoch))continue;
        for (const [requestId,state] of frame.states) {
          if (this.acknowledged.get(requestId) === state) continue;
          const result = sceneObject(await this.call('report',{auth:owner.auth,requestId,state},true),['ok']);
          if (this.stopped || this.owner !== owner) return;
          if (result.ok !== true) throw new Error('SCENE_REPORT');
          this.acknowledged.set(requestId,state);
        }
        if (this.stopped) break;
        // Claim is not replayed after uncertain delivery.
        const polled = sceneObject(await this.call('poll', { auth:owner.auth,...(owner.lifetime?{cacheEpoch:owner.cacheEpoch}:{}) }), owner.lifetime?['command','cancellations','connected','cacheEpoch']:['command','cancellations','connected']);
        if (this.stopped || this.owner !== owner) return;
        if(owner.lifetime && this.acceptCache(polled.cacheEpoch))continue;
        if (!Array.isArray(polled.cancellations) || polled.cancellations.length > SCENE_LIMITS.requests || typeof polled.connected !== 'boolean') throw new Error('SCENE_POLL');
        if (polled.connected && this.reference && !this.referenceUploaded) {
          this.publish({phase:'connected',canConnect:false,canDisconnect:true,expiresAt:owner.expiresAt,lifetime:owner.lifetime,reference:'uploading'});
          const uploaded=sceneObject(await this.call('reference',{auth:owner.auth,reference:{manifest:this.reference.consent.manifest,data:this.reference.data},...(owner.lifetime?{cacheEpoch:owner.cacheEpoch}:{})},true),['ok']);
          if(this.stopped || this.owner!==owner || !this.bound()) return;
          if(uploaded.ok!==true) throw new Error('REFERENCE_UPLOAD');
          this.referenceUploaded=true;
          this.publish({phase:'connected',canConnect:false,canDisconnect:true,expiresAt:owner.expiresAt,lifetime:owner.lifetime,reference:'ready'});
        } else if (polled.connected && this.state.phase === 'awaiting-consent') this.publish({phase:'connected',canConnect:false,canDisconnect:true,expiresAt:owner.expiresAt,lifetime:owner.lifetime});
        for (const id of polled.cancellations) if (typeof id === 'string' && this.issued.has(id)) {
          const preparing=this.preparing.get(id);
          if(preparing) {preparing.abort();this.preparationStates.set(id,'canceled');}
          else if(!this.preparationStates.has(id)) this.bridge!.cancelProposal(id);
          this.renderChanged();
        }
        if (polled.command) {
          const proposal = parseSceneProposal(polled.command);
          if (this.issued.has(proposal.requestId) || this.issued.size >= SCENE_LIMITS.requests) throw new Error('SCENE_CLAIM_REPLAY');
          this.issued.add(proposal.requestId);
          const commandBridge=this.bridge!,commandEpoch=owner.cacheEpoch;
          const prepareAbort=new AbortController();this.preparing.set(proposal.requestId,prepareAbort);
          // Rendering is intentionally separate so heartbeat and cancel continue.
          const rendering = async () => {
            const resolved = this.reference && this.materialize ? await this.materialize(proposal,this.reference,prepareAbort.signal) : proposal;
            if(prepareAbort.signal.aborted || this.stopped || this.owner!==owner || this.bridge!==commandBridge || owner.cacheEpoch!==commandEpoch || !this.bound()) return;
            this.preparing.delete(proposal.requestId);
            await commandBridge.proposeScene(sceneJSON(resolved));
          };
          void rendering().catch(() => {if(this.owner===owner && this.bridge===commandBridge && owner.cacheEpoch===commandEpoch && !this.stopped && !prepareAbort.signal.aborted) this.preparationStates.set(proposal.requestId,'failed');}).finally(()=>{
            this.preparing.delete(proposal.requestId);
            if(this.owner===owner && this.bridge===commandBridge && owner.cacheEpoch===commandEpoch && !this.stopped) {this.renderChanged();this.notifyLocalChange();}
          });
          this.renderChanged();
        }
        this.notifyLocalChange();
      }
    } catch (error) { if (!this.stopped && this.owner === startedOwner) this.fail(error); }
    finally { this.pumping = false; if (!this.stopped && this.frames.length) void this.pump(); }
  }
  disconnect(reason?:string):Promise<void> {
    const owner=this.owner;
    if(this.disconnecting?.owner===owner)return this.disconnecting.promise;
    let resolve!:()=>void,reject!:(error:unknown)=>void;
    const promise=new Promise<void>((ok,fail)=>{resolve=ok;reject=fail;});
    const operation={owner,promise};this.disconnecting=operation;
    const clear=()=>{if(this.disconnecting===operation)this.disconnecting=null;};
    void this.disconnectOwner(owner,reason).then(()=>{clear();resolve();},error=>{clear();reject(error);});
    return promise;
  }
  private async disconnectOwner(owner:Share|null,reason?:string):Promise<void> {
    if(this.owner!==owner)return;
    const remembered=this.controlStored;
    const notice = reason ?? this.state.notice;
    const reauthorizationRequired = this.state.reauthorizationRequired || !!owner && (owner.expiresAt!==null && this.now()>=owner.expiresAt || this.state.phase==='awaiting-consent' && this.now()>=owner.proofExpiresAt);
    for(const abort of this.preparing.values()) abort.abort(); this.preparing.clear();
    this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; this.frames = []; this.bridge?.revoke();
    if(!this.disposed)this.renderChanged();
    this.publish({ phase:'revoking',canConnect:false,canDisconnect:false });
    if (this.creating) return; // Late create response owns cleanup; never adopt it.
    if (!owner) { this.publish({phase:'disconnected',canConnect:this.available,canDisconnect:false,revocationConfirmed:false,notice,reauthorizationRequired}); return; }
    try {
      const raw=await this.call('revoke', { auth:owner.auth },true);
      const result=sceneObject(raw,typeof raw==='object' && raw!==null && Object.hasOwn(raw,'state')?['ok','state']:['ok']);
      const absent=result.state==='already_absent';
      if(this.owner!==owner)return;
      if (result.ok !== true || result.state!==undefined && !absent) throw new Error('SCENE_REVOKE');
      if(remembered){
        await this.options.controlStore!.clear(owner.auth);
        if(this.owner!==owner)return;
        this.controlStored=false;
      }
      this.owner = null; this.bridge = null; this.reference = null; this.materialize = null; this.referenceUploaded=false; this.preparationStates.clear(); this.issued.clear(); this.acknowledged.clear(); this.fingerprint = '';
      this.publish({phase:'disconnected',canConnect:this.available,canDisconnect:false,revocationConfirmed:!absent,notice:absent?'Already absent: the service has no current grant for this ID. Saved device control was cleared; local work is preserved.':notice,reauthorizationRequired});
    } catch {
      if(this.owner!==owner)return;
      this.publish({phase:'error',canConnect:false,canDisconnect:true,notice,reauthorizationRequired,error:'Revocation is unconfirmed. Retry Disconnect. Existing service content may remain until a successful revoke or later cleanup.'});
    }
  }
  prepareReauthorization(): boolean {
    if(this.disposed || this.state.phase!=='disconnected' || !this.state.canConnect || this.owner || this.creating)return false;
    this.publish({...this.state,reauthorizationRequired:false});return true;
  }
  dispose(): void {
    this.disposed = true;
    this.reauthorizationChannel?.close();this.reauthorizationChannel=null;this.reauthorizationPrompt=undefined;
    if(this.owner?.lifetime && !this.creating){
      for(const abort of this.preparing.values())abort.abort();this.preparing.clear();this.stopped=true;
      if(this.timer)clearTimeout(this.timer);this.timer=null;this.frames=[];this.bridge?.revoke();
      return; // Explicit until-revoked consent survives local teardown.
    }
    void this.disconnect();
  }
}

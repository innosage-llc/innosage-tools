import { SceneReferenceStore } from './reference';
import { parseUntilRevokedConsent, UNTIL_REVOKED_MODE } from '../../../../lib/visual-remix-lifetime';
import { liveGrant, liveLifetime, grantArgs, SCENE_CACHE_MS } from './lifetime';
import { parseReferenceConsent, materializeReferenceProposal, referenceCrop } from '../../../../lib/visual-remix-reference';
import { digest } from '../mailbox';
import { SCENE_FIELDS, SCENE_LIMITS, parseSceneAuth, parseSceneProposal, parseSceneSnapshot, sceneId, sceneJSON, sceneResult, sceneToolResult, type SceneAuth, type SceneOwner, type SceneSnapshot, type SceneState } from '../../../../lib/visual-remix-remote';

const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
const live = liveGrant;
const remote = live + ' AND s.consent_hash IS NOT NULL';
const args = grantArgs;
type RequestRow = { id: string; state: SceneState; payload: string | null; payload_hash: string; cancel_requested: number; base_revision: number };

// Inactive candidate. No entrypoint imports this module; no migration runs here.
export class SceneMailbox {
  private readonly db: D1DatabaseSession;
  constructor(db: D1Database, private readonly now: () => number = Date.now, private readonly referencesEnabled = false, private readonly allowUntilRevoked = false) { this.db = db.withSession('first-primary'); }
  async spend(): Promise<void> {
    const row = await this.db.prepare('UPDATE scene_budget SET http=http+1 WHERE singleton=1 RETURNING singleton').first();
    if (!row) throw new Error('SCENE_HTTP_BUDGET');
  }
  async sweepExpired(): Promise<void> {
    // Fixed deadlines are immutable. A never-paired new grant is abandoned when
    // its short proof expires; an established until-revoked grant never times out.
    await this.db.prepare("UPDATE scene_shares SET revoked=1,epoch=epoch+1 WHERE revoked=0 AND ((expiry_policy='fixed' AND expires<=?) OR (expiry_policy='until_revoked' AND consent_hash IS NULL AND proof_expires<=?))").bind(this.now(),this.now()).run();
  }
  async purgeInactiveCache():Promise<void>{
    // Payload cache lifetime is separate from authority. Each D1 batch is atomic
    // and fences seen/cache generation again so a fresh browser sync wins safely.
    const cutoff=this.now()-SCENE_CACHE_MS;
    // Turning image access off must never disable erasure of already-stored
    // images. The reference schema remains optional for non-image installations.
    const hasReferences=!!await this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scene_references'").first();
    const pixels=hasReferences?' OR EXISTS(SELECT 1 FROM scene_references r WHERE r.share=s.id AND r.pixels IS NOT NULL)':'';
    // Six rows bound each cleanup to <=21 D1 statements including expiry. Oldest
    // caches go first; backlog/provider failure can delay physical removal.
    const rows=await this.db.prepare("SELECT s.id,s.epoch,s.cache_epoch FROM scene_shares s WHERE s.revoked=0 AND s.expiry_policy='until_revoked' AND s.consent_hash IS NOT NULL AND s.seen<=? AND (s.snapshot IS NOT NULL OR EXISTS(SELECT 1 FROM scene_requests q WHERE q.share=s.id AND q.payload IS NOT NULL)"+pixels+') ORDER BY s.seen LIMIT 6').bind(cutoff).all<{id:string;epoch:number;cache_epoch:number}>();
    for(const row of rows.results){
      const fence="s.id=? AND s.epoch=? AND s.cache_epoch=? AND s.revoked=0 AND s.expiry_policy='until_revoked' AND s.consent_hash IS NOT NULL AND s.seen<=?";
      const values=[row.id,row.epoch,row.cache_epoch,cutoff],statements:D1PreparedStatement[]=[];
      if(hasReferences)statements.push(this.db.prepare('UPDATE scene_references SET pixels=NULL WHERE share=? AND epoch=? AND EXISTS(SELECT 1 FROM scene_shares s WHERE '+fence+')').bind(row.id,row.epoch,...values));
      statements.push(this.db.prepare("UPDATE scene_requests SET payload=NULL,cancel_requested=CASE WHEN state IN ('queued','rendering','preview') THEN 1 ELSE cancel_requested END,state=CASE WHEN state IN ('queued','rendering','preview') THEN 'stale' ELSE state END WHERE share=? AND epoch=? AND EXISTS(SELECT 1 FROM scene_shares s WHERE "+fence+')').bind(row.id,row.epoch,...values));
      statements.push(this.db.prepare('UPDATE scene_shares AS s SET snapshot=NULL,cache_epoch=cache_epoch+1 WHERE '+fence).bind(...values));
      await this.db.batch(statements);
    }
  }
  async create(input: unknown, fields: unknown, confirmed: unknown, reference?: unknown, duration?: unknown, lifetime?: unknown) {
    // Legacy clients disclosed 15min. Never silently upgrade their consent.
    if(duration !== undefined && duration !== SCENE_LIMITS.leaseMs) throw new Error('SCENE_DURATION_CONSENT');
    const until=lifetime!==undefined;
    if(until){
      if(!this.allowUntilRevoked)throw new Error('SCENE_UNTIL_REVOKED_NOT_ENABLED');
      parseUntilRevokedConsent(lifetime);
      if(duration!==undefined)throw new Error('SCENE_LIFETIME_CONFLICT');
    }
    const leaseMs = duration === SCENE_LIMITS.leaseMs ? SCENE_LIMITS.leaseMs : SCENE_LIMITS.legacyLeaseMs;
    if (reference !== undefined && !this.referencesEnabled) throw new Error('REFERENCE_NOT_ENABLED');
    const consent = reference === undefined ? null : parseReferenceConsent(reference);
    if (confirmed !== true || !Array.isArray(fields) || fields.length !== SCENE_FIELDS.length || new Set(fields).size !== fields.length || !SCENE_FIELDS.every(f => fields.includes(f))) throw new Error('SCENE_SHARE_CONSENT');
    const snapshot = parseSceneSnapshot(input), value = sceneJSON(snapshot); sceneToolResult(snapshot);
    const id = crypto.randomUUID(), credential = secret(), proof = secret(), now = this.now();
    const insert = this.db.prepare('INSERT INTO scene_shares(id,project,generation,credential_hash,proof_hash,proof_expires,expires,snapshot,revision,seen,expiry_policy,grant_consent_version,snapshot_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, snapshot.projectId, snapshot.generation, await digest(credential), await digest(proof), now + SCENE_LIMITS.proofMs, until?0:now + leaseMs, value, snapshot.revision, now,until?'until_revoked':'fixed',until?1:0,await digest(value));
    if (consent) await this.db.batch([insert,this.db.prepare('INSERT INTO scene_references(share,epoch,consent) VALUES(?,1,?)').bind(id,sceneJSON(consent))]);
    else await insert.run();
    const result={ auth: { purpose: 'visual-remix' as const, shareId: id, projectId: snapshot.projectId, generation: snapshot.generation, epoch: 1, credential }, proof, expiresAt: until?null:now + leaseMs, proofExpiresAt: now + SCENE_LIMITS.proofMs };
    return until?{...result,lifetime:UNTIL_REVOKED_MODE,issuedAt:now}:result;
  }
  referenceStore(): SceneReferenceStore {
    if (!this.referencesEnabled) throw new Error('REFERENCE_NOT_ENABLED');
    return new SceneReferenceStore(this.db,this.now);
  }
  async bindFromProof(proof: string, handle: string): Promise<SceneAuth | null> {
    if (!/^[a-f0-9]{64}$/.test(proof) || !handle || handle.length > 1024) return null;
    const row = await this.db.prepare(`UPDATE scene_shares AS s SET consent_hash=?,proof_hash=NULL WHERE proof_hash=? AND proof_expires>? AND ${liveLifetime} AND revoked=0 AND consent_hash IS NULL RETURNING id,project,generation,epoch`)
      .bind(await digest(handle), await digest(proof), this.now(), this.now()).first<{ id: string; project: string; generation: string; epoch: number }>();
    return row ? { purpose: 'visual-remix', shareId: row.id, projectId: row.project, generation: row.generation, epoch: row.epoch } : null;
  }
  async lease(input: SceneAuth): Promise<{ expiresAt: number|null } | null> {
    const a = parseSceneAuth(input), row = await this.db.prepare(`SELECT s.expires,s.expiry_policy FROM scene_shares s WHERE ${remote}`).bind(...args(a, this.now())).first<{ expires: number;expiry_policy:string }>();
    return row ? { expiresAt: row.expiry_policy==='until_revoked'?null:row.expires } : null;
  }
  async cacheState(input: SceneOwner):Promise<{cacheEpoch:number}|null>{
    const a=parseSceneAuth(input,true) as SceneOwner;
    const row=await this.db.prepare(`SELECT s.cache_epoch FROM scene_shares s WHERE ${live} AND s.credential_hash=? AND s.expiry_policy='until_revoked'`).bind(...args(a,this.now()),await digest(a.credential)).first<{cache_epoch:number}>();
    return row?{cacheEpoch:row.cache_epoch}:null;
  }
  async owner(input: SceneOwner): Promise<boolean> {
    const a = parseSceneAuth(input, true) as SceneOwner;
    return !!await this.db.prepare(`SELECT s.id FROM scene_shares s WHERE ${live} AND s.credential_hash=?`).bind(...args(a, this.now()), await digest(a.credential)).first();
  }
  async snapshot(input: SceneAuth): Promise<SceneSnapshot | null> {
    const a = parseSceneAuth(input), row = await this.db.prepare(`SELECT s.snapshot FROM scene_shares s WHERE ${remote} AND s.seen>=? AND s.snapshot IS NOT NULL`)
      .bind(...args(a, this.now()), this.now() - SCENE_LIMITS.freshnessMs).first<{ snapshot: string }>();
    return row ? parseSceneSnapshot(JSON.parse(row.snapshot)) : null;
  }
  async proposalRejection(input: SceneAuth, value: unknown) {
    const a = parseSceneAuth(input), p = parseSceneProposal(value);
    const row = await this.db.prepare(`SELECT s.revision,s.seen,s.snapshot IS NOT NULL AS present FROM scene_shares s WHERE ${remote}`).bind(...args(a,this.now())).first<{revision:number;seen:number;present:number}>();
    const error = !row ? 'SHARE_UNAVAILABLE' : !row.present || row.seen < this.now()-SCENE_LIMITS.freshnessMs ? 'BROWSER_UNAVAILABLE' : row.revision !== p.baseRevision ? 'STALE_REVISION' : 'PROPOSAL_NOT_ADMITTED';
    return {error,requestId:p.requestId,admitted:false,applied:false,recovery:error === 'STALE_REVISION' ? 'Read get_scene again and rebuild against the returned revision. Do not guess a revision or poll this rejected request.' : error === 'SHARE_UNAVAILABLE' ? 'Stop and request a fresh manual connection. No edit was applied.' : 'Bring the existing editor into a visible window and wait for its heartbeat, then read get_scene. A rejected, unchanged proposal may reuse this requestId; never blindly resend an uncertain submission or poll a rejected request.'};
  }
  async sync(input: SceneOwner, value: unknown): Promise<boolean> {
    const a = parseSceneAuth(input, true) as SceneOwner, snapshot = parseSceneSnapshot(value); sceneToolResult(snapshot);
    if (snapshot.projectId !== a.projectId || snapshot.generation !== a.generation) return false;
    const text = sceneJSON(snapshot);
    const hash=await digest(text);
    const row = await this.db.prepare(`UPDATE scene_shares AS s SET snapshot=?,snapshot_hash=?,revision=?,seen=? WHERE ${live} AND s.credential_hash=? AND s.revision<=? AND (s.revision<? OR s.snapshot=? OR (s.expiry_policy='until_revoked' AND s.snapshot IS NULL AND s.snapshot_hash=?)) RETURNING id`)
      .bind(text,hash, snapshot.revision, this.now(), ...args(a, this.now()), await digest(a.credential), snapshot.revision, snapshot.revision, text,hash).first();
    return !!row;
  }
  async status(input: SceneAuth, requestId: string) {
    const a = parseSceneAuth(input), id = sceneId(requestId), row = await this.db.prepare(`SELECT r.id,r.state FROM scene_requests r JOIN scene_shares s ON s.id=r.share WHERE ${remote} AND r.epoch=s.epoch AND r.id=?`)
      .bind(...args(a, this.now()), id).first<{ id: string; state: SceneState }>();
    return row ? sceneResult(row.id, row.state) : null;
  }
  async propose(input: SceneAuth, value: unknown) {
    const a = parseSceneAuth(input);
    const consent = this.referencesEnabled ? await new SceneReferenceStore(this.db,this.now).consent(a) : null;
    const p = consent ? materializeReferenceProposal(value,consent) : parseSceneProposal(value), payload = sceneJSON(p), hash = await digest(payload);
    // Also check the future browser command envelope before committing admission.
    sceneJSON({ auth: { ...a, credential: 'x'.repeat(64) }, command: p }, SCENE_LIMITS.wireBytes);
    if (p.projectId !== a.projectId || p.generation !== a.generation) throw new Error('SCENE_BINDING');
    const old = await this.db.prepare(`SELECT r.id,r.state,r.payload_hash FROM scene_requests r JOIN scene_shares s ON s.id=r.share WHERE ${remote} AND r.epoch=s.epoch AND r.id=?`)
      .bind(...args(a, this.now()), p.requestId).first<RequestRow>();
    if (old) { if (old.payload_hash !== hash) throw new Error('SCENE_REQUEST_CONFLICT'); return sceneResult(old.id, old.state); }
    const snapshot = await this.snapshot(a);
    if (!snapshot || snapshot.revision !== p.baseRevision) return null;
    if (p.scene.assets.some(asset => !snapshot.scene.assets.some(approved => sceneJSON(approved) === sceneJSON(asset)) && !(consent?.reuseCrops && referenceCrop(consent.manifest,asset)))) throw new Error('UNSHARED_SCENE_ASSET');
    const row = await this.db.prepare(`INSERT INTO scene_requests(share,id,epoch,payload_hash,payload,base_revision,state)
      SELECT s.id,?,s.epoch,?,?,?,'queued' FROM scene_shares s WHERE ${remote} AND s.revision=? AND s.seen>=?
      ON CONFLICT(share,id) DO NOTHING RETURNING id,state,payload_hash`)
      .bind(p.requestId, hash, payload, p.baseRevision, ...args(a, this.now()), p.baseRevision, this.now() - SCENE_LIMITS.freshnessMs).first<RequestRow>();
    if (row) return sceneResult(row.id, row.state);
    // A simultaneous identical admission may have won the primary-key race.
    const raced = await this.db.prepare(`SELECT r.id,r.state,r.payload_hash FROM scene_requests r JOIN scene_shares s ON s.id=r.share WHERE ${remote} AND r.epoch=s.epoch AND r.id=?`)
      .bind(...args(a, this.now()), p.requestId).first<RequestRow>();
    if (raced && raced.payload_hash !== hash) throw new Error('SCENE_REQUEST_CONFLICT');
    return raced ? sceneResult(raced.id, raced.state) : null;
  }
  async claim(input: SceneOwner): Promise<unknown | null> {
    const a = parseSceneAuth(input, true) as SceneOwner;
    const row = await this.db.prepare(`UPDATE scene_requests SET state='rendering' WHERE share=? AND epoch=? AND state='queued' AND id=(SELECT id FROM scene_requests WHERE share=? AND state='queued' LIMIT 1)
      AND EXISTS(SELECT 1 FROM scene_shares s WHERE ${remote} AND s.credential_hash=?) RETURNING payload`)
      .bind(a.shareId, a.epoch, a.shareId, ...args(a, this.now()), await digest(a.credential)).first<{ payload: string }>();
    return row ? parseSceneProposal(JSON.parse(row.payload)) : null;
  }
  async cancel(input: SceneAuth, requestId: string): Promise<boolean> {
    const a = parseSceneAuth(input), id = sceneId(requestId);
    return !!await this.db.prepare(`UPDATE scene_requests SET cancel_requested=1,state=CASE WHEN state='queued' THEN 'canceled' ELSE state END
      WHERE share=? AND epoch=? AND id=? AND state IN ('queued','rendering','preview') AND EXISTS(SELECT 1 FROM scene_shares s WHERE ${remote}) RETURNING id`)
      .bind(a.shareId, a.epoch, id, ...args(a, this.now())).first();
  }
  async cancellations(input: SceneOwner): Promise<string[]> {
    const a = parseSceneAuth(input, true) as SceneOwner;
    const rows = await this.db.prepare(`SELECT r.id FROM scene_requests r JOIN scene_shares s ON s.id=r.share WHERE ${remote} AND s.credential_hash=? AND r.epoch=s.epoch AND r.cancel_requested=1 AND r.state IN ('rendering','preview') LIMIT 16`)
      .bind(...args(a, this.now()), await digest(a.credential)).all<{ id: string }>();
    return rows.results.map(row => row.id);
  }
  async report(input: SceneOwner, requestId: string, state: SceneState): Promise<boolean> {
    if (!['preview','applied','stale','canceled','revoked','failed'].includes(state)) throw new Error('SCENE_RESULT');
    const a = parseSceneAuth(input, true) as SceneOwner, id = sceneId(requestId);
    const row = await this.db.prepare(`UPDATE scene_requests SET state=? WHERE share=? AND epoch=? AND id=?
      AND (state=? OR state='rendering' OR (state='preview' AND ?!='preview'))
      AND EXISTS(SELECT 1 FROM scene_shares s WHERE ${remote} AND s.credential_hash=?
        AND (?!='applied' OR scene_requests.state='applied' OR (s.revision=scene_requests.base_revision+1 AND json_extract(s.snapshot,'$.scene')=json_extract(scene_requests.payload,'$.scene')))) RETURNING id`)
      .bind(state, a.shareId, a.epoch, id, state, state, ...args(a, this.now()), await digest(a.credential), state).first();
    return !!row;
  }
  async revoke(input: SceneOwner): Promise<boolean> {
    const a = parseSceneAuth(input, true) as SceneOwner, hash = await digest(a.credential);
    const row = await this.db.prepare('UPDATE scene_shares SET revoked=1,epoch=epoch+1 WHERE id=? AND project=? AND generation=? AND epoch=? AND credential_hash=? AND revoked=0 RETURNING id')
      .bind(a.shareId, a.projectId, a.generation, a.epoch, hash).first();
    if (row) return true;
    return !!await this.db.prepare('SELECT id FROM scene_shares WHERE id=? AND project=? AND generation=? AND epoch=? AND credential_hash=? AND revoked=1')
      .bind(a.shareId, a.projectId, a.generation, a.epoch + 1, hash).first();
  }
}

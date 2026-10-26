import { digest } from '../mailbox';
import { liveGrant, liveLifetime, grantArgs } from './lifetime';
import { SCENE_LIMITS, SCENE_SCOPES, parseSceneAuth, sceneId, type SceneAuth, type SceneOwner } from '../../../../lib/visual-remix-remote';

type RequestRow={id:string;client_id:string;client_name:string;redirect_host:string;resource:string;expires:number;state:'pending'|'issued'|'consumed'|'revoked'};
const randomProof=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
// No API accepts a consent handle for insertion: only the server's fresh
// beginConsent result can create a short request. Expired IDs are never reused.
export class SceneReauthorizationStore {
 private readonly db:D1DatabaseSession;
 constructor(db:D1Database,private readonly now:()=>number=Date.now){this.db=db.withSession('first-primary');}
 async purgeExpired():Promise<void>{await this.db.prepare('DELETE FROM scene_reauthorizations WHERE expires<=?').bind(this.now()).run();}
 async purgeExpiredIfPresent():Promise<void>{if(await this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scene_reauthorizations'").first())await this.purgeExpired();}
 async create(handle:string,client:{clientId:string;clientName:string;redirectHost:string},resource:string){
  if(!handle||handle.length>4096||!client.clientId||client.clientId.length>2048||new URL(resource).pathname!=='/scene/mcp'||resource.length>512)throw new Error('SCENE_REAUTH_REQUEST');
  await this.purgeExpired();const id=crypto.randomUUID(),now=this.now(),expires=now+SCENE_LIMITS.proofMs;
  await this.db.prepare('INSERT INTO scene_reauthorizations(id,handle_hash,client_id,client_name,redirect_host,resource,created,expires) VALUES(?,?,?,?,?,?,?,?)').bind(id,await digest(handle),client.clientId,client.clientName.slice(0,128),client.redirectHost.slice(0,256),resource,now,expires).run();
  return{requestId:id,expiresAt:expires};
 }
 private ownerFence(){return liveGrant+" AND s.consent_hash IS NOT NULL AND s.snapshot IS NOT NULL AND s.seen>=? AND s.credential_hash=?";}
 async describe(input:SceneOwner,id:unknown,resource:string){
  const a=parseSceneAuth(input,true)as SceneOwner,now=this.now();
  const r=await this.db.prepare('SELECT r.id,r.client_id,r.client_name,r.redirect_host,r.resource,r.expires,r.state FROM scene_reauthorizations r WHERE r.id=? AND r.resource=? AND r.expires>? AND (r.state=\'pending\' OR (r.share=? AND r.epoch=?)) AND EXISTS(SELECT 1 FROM scene_shares s WHERE '+this.ownerFence()+')').bind(sceneId(id),resource,now,a.shareId,a.epoch,...grantArgs(a,now),now-SCENE_LIMITS.freshnessMs,await digest(a.credential)).first<RequestRow>();
  return r?{requestId:r.id,clientId:r.client_id,clientName:r.client_name,redirectHost:r.redirect_host,resource:r.resource,scopes:[...SCENE_SCOPES],expiresAt:r.expires,issuedAt:now,state:r.state}:null;
 }
 async issue(input:SceneOwner,id:unknown,resource:string,confirmed:unknown){
  if(confirmed!==true)throw new Error('SCENE_REAUTH_CONSENT');
  const a=parseSceneAuth(input,true)as SceneOwner,now=this.now(),proof=randomProof();
  const r=await this.db.prepare("UPDATE scene_reauthorizations SET share=?,epoch=?,proof_hash=?,proof_expires=expires,state='issued' WHERE id=? AND resource=? AND state='pending' AND expires>? AND EXISTS(SELECT 1 FROM scene_shares s WHERE "+this.ownerFence()+') RETURNING expires').bind(a.shareId,a.epoch,await digest(proof),sceneId(id),resource,now,...grantArgs(a,now),now-SCENE_LIMITS.freshnessMs,await digest(a.credential)).first<{expires:number}>();
  return r?{requestId:sceneId(id),proof,expiresAt:r.expires,issuedAt:now}:null;
 }
 async consume(id:unknown,proof:string,handle:string,clientId:string,resource:string):Promise<SceneAuth|null>{
  if(!/^[a-f0-9]{64}$/.test(proof)||!handle||handle.length>4096)return null;
  const now=this.now();
  // Keep original consent_hash/tombstones untouched. This short request is the
  // atomic proof + client + handle binding and cannot be created from a replay.
  const r=await this.db.prepare("UPDATE scene_reauthorizations AS r SET state='consumed',proof_hash=NULL WHERE r.id=? AND r.handle_hash=? AND r.client_id=? AND r.resource=? AND r.state='issued' AND r.proof_hash=? AND r.proof_expires>? AND r.expires>? AND EXISTS(SELECT 1 FROM scene_shares s WHERE s.id=r.share AND s.epoch=r.epoch AND s.revoked=0 AND s.consent_hash IS NOT NULL AND "+liveLifetime+') RETURNING share,epoch').bind(sceneId(id),await digest(handle),clientId,resource,await digest(proof),now,now,now).first<{share:string;epoch:number}>();
  if(!r)return null;
  const s=await this.db.prepare('SELECT s.id,s.project,s.generation,s.epoch FROM scene_shares s WHERE s.id=? AND s.epoch=? AND s.revoked=0 AND '+liveLifetime).bind(r.share,r.epoch,this.now()).first<{id:string;project:string;generation:string;epoch:number}>();
  return s?parseSceneAuth({purpose:'visual-remix',shareId:s.id,projectId:s.project,generation:s.generation,epoch:s.epoch})as SceneAuth:null;
 }
}

import { SCENE_OAUTH_SECONDS } from './lifetime';

// A safety/replay quarantine, not a cumulative task budget. Reclamation never
// touches an active grant, including an inactive until-revoked one.
export const SCENE_RETIREMENT_MS = SCENE_OAUTH_SECONDS * 1000;
export class SceneRetirementStore {
  constructor(private readonly db:D1DatabaseSession){}
  async reclaim():Promise<void>{
    const clock=await this.db.prepare("SELECT CAST(unixepoch('now')*1000 AS INTEGER) AS now").first<{now:number}>();
    if(!clock || !Number.isSafeInteger(clock.now))throw new Error('SCENE_RETIREMENT_CLOCK');
    const cutoff=clock.now-SCENE_RETIREMENT_MS;
    const hasReferences=!!await this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scene_references'").first();
    const rows=await this.db.prepare('SELECT id,epoch,retired_at FROM scene_shares WHERE revoked=1 AND retired_at IS NOT NULL AND retired_at<=? ORDER BY retired_at,id LIMIT 3').bind(cutoff).all<{id:string;epoch:number;retired_at:number}>();
    for(const row of rows.results){
      const fence='s.id=? AND s.epoch=? AND s.revoked=1 AND s.retired_at=? AND s.retired_at<=?';
      const values=[row.id,row.epoch,row.retired_at,cutoff],batch:D1PreparedStatement[]=[];
      // One atomic D1 batch, all children first. Recheck the retired binding in
      // every mutation. Optional image access flags never disable erasure.
      if(hasReferences)batch.push(this.db.prepare('DELETE FROM scene_references WHERE share=? AND EXISTS(SELECT 1 FROM scene_shares s WHERE '+fence+')').bind(row.id,...values));
      batch.push(this.db.prepare('DELETE FROM scene_requests WHERE share=? AND EXISTS(SELECT 1 FROM scene_shares s WHERE '+fence+')').bind(row.id,...values));
      batch.push(this.db.prepare('DELETE FROM scene_consent_bindings WHERE share=? AND EXISTS(SELECT 1 FROM scene_shares s WHERE '+fence+')').bind(row.id,...values));
      batch.push(this.db.prepare('DELETE FROM scene_shares AS s WHERE '+fence).bind(...values));
      await this.db.batch(batch);
    }
  }
}

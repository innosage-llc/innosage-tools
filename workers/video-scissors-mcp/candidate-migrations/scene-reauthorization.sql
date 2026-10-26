-- Additive, inactive until the exact reviewed staging reauthorization flag.
-- Short transaction/proof state only; no Scene/image/owner credential payloads.
CREATE TABLE scene_reauthorizations (
  id TEXT PRIMARY KEY, handle_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL CHECK(length(client_id)<=2048),
  client_name TEXT NOT NULL CHECK(length(client_name)<=128),
  redirect_host TEXT NOT NULL CHECK(length(redirect_host)<=256),
  resource TEXT NOT NULL CHECK(length(resource)<=512),
  created INTEGER NOT NULL, expires INTEGER NOT NULL CHECK(expires>created AND expires-created<=300000),
  share TEXT REFERENCES scene_shares(id) ON DELETE CASCADE, epoch INTEGER,
  proof_hash TEXT UNIQUE, proof_expires INTEGER,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','issued','consumed','revoked')),
  CHECK((state='pending' AND share IS NULL AND epoch IS NULL AND proof_hash IS NULL) OR
    (state='issued' AND share IS NOT NULL AND epoch>0 AND proof_hash IS NOT NULL AND proof_expires IS NOT NULL AND proof_expires<=expires) OR
    (state IN ('consumed','revoked') AND share IS NOT NULL AND epoch>0 AND proof_hash IS NULL))
);
CREATE TRIGGER scene_reauthorization_capacity BEFORE INSERT ON scene_reauthorizations BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM scene_reauthorizations)>=20 THEN RAISE(ABORT,'SCENE_REAUTH_CAPACITY') END;
END;
CREATE TRIGGER scene_reauthorization_identity BEFORE UPDATE ON scene_reauthorizations
WHEN NEW.id!=OLD.id OR NEW.handle_hash!=OLD.handle_hash OR NEW.client_id!=OLD.client_id OR
 NEW.client_name!=OLD.client_name OR NEW.redirect_host!=OLD.redirect_host OR NEW.resource!=OLD.resource OR
 NEW.created!=OLD.created OR NEW.expires!=OLD.expires OR
 (OLD.share IS NOT NULL AND (NEW.share IS NOT OLD.share OR NEW.epoch IS NOT OLD.epoch)) OR
 (OLD.state IN ('consumed','revoked') AND NEW.state NOT IN ('consumed','revoked'))
BEGIN SELECT RAISE(ABORT,'SCENE_REAUTH_IMMUTABLE'); END;
CREATE TRIGGER scene_reauthorization_revoke AFTER UPDATE OF revoked ON scene_shares WHEN NEW.revoked=1 BEGIN
  UPDATE scene_reauthorizations SET state='revoked',proof_hash=NULL WHERE share=NEW.id;
END;

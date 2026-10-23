-- INACTIVE: not in migrations/. Explicit reviewed activation is required.
-- No video table, trigger, binding or existing cumulative counter is changed.
CREATE TABLE scene_budget (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), shares INTEGER NOT NULL DEFAULT 0,
  http INTEGER NOT NULL DEFAULT 0
);
INSERT INTO scene_budget(singleton) VALUES(1);
CREATE TABLE scene_shares (
  id TEXT PRIMARY KEY, project TEXT NOT NULL, generation TEXT NOT NULL,
  epoch INTEGER NOT NULL DEFAULT 1, credential_hash TEXT NOT NULL,
  proof_hash TEXT UNIQUE, proof_expires INTEGER NOT NULL, expires INTEGER NOT NULL,
  consent_hash TEXT UNIQUE, revoked INTEGER NOT NULL DEFAULT 0,
  snapshot TEXT CHECK(snapshot IS NULL OR length(CAST(snapshot AS BLOB))<=12288), revision INTEGER NOT NULL, seen INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER scene_share_budget BEFORE INSERT ON scene_shares BEGIN
  UPDATE scene_budget SET shares=shares+1 WHERE singleton=1 AND shares<20;
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'SCENE_SHARE_BUDGET') END;
END;
CREATE TABLE scene_consent_bindings (
  handle_hash TEXT PRIMARY KEY, share TEXT NOT NULL REFERENCES scene_shares(id), epoch INTEGER NOT NULL
);
CREATE TRIGGER scene_bind_consent AFTER UPDATE OF consent_hash ON scene_shares
WHEN NEW.consent_hash IS NOT NULL AND OLD.consent_hash IS NULL BEGIN
  INSERT INTO scene_consent_bindings VALUES(NEW.consent_hash,NEW.id,NEW.epoch);
END;
CREATE TABLE scene_requests (
  share TEXT NOT NULL REFERENCES scene_shares(id), id TEXT NOT NULL, epoch INTEGER NOT NULL,
  payload_hash TEXT NOT NULL, payload TEXT CHECK(payload IS NULL OR length(CAST(payload AS BLOB))<=12288), base_revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','rendering','preview','applied','stale','canceled','revoked','failed')),
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(share,id)
);
CREATE UNIQUE INDEX scene_one_active ON scene_requests(share) WHERE state IN ('queued','rendering','preview');
CREATE TRIGGER scene_request_budget BEFORE INSERT ON scene_requests
WHEN NOT EXISTS(SELECT 1 FROM scene_requests WHERE share=NEW.share AND id=NEW.id) BEGIN
  UPDATE scene_shares SET request_count=request_count+1 WHERE id=NEW.share AND request_count<16;
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'SCENE_REQUEST_BUDGET') END;
END;
CREATE TRIGGER scene_purge_content AFTER UPDATE OF revoked ON scene_shares
WHEN NEW.revoked=1 BEGIN
  UPDATE scene_shares SET snapshot=NULL,proof_hash=NULL WHERE id=NEW.id;
  UPDATE scene_requests SET payload=NULL,state=CASE WHEN state IN ('queued','rendering','preview') THEN 'revoked' ELSE state END WHERE share=NEW.id;
END;

-- INACTIVE proposal: changes a classified security/retention boundary.
-- Requires exact staging migration approval. Never reset historical counters.
ALTER TABLE scene_shares ADD COLUMN retired_at INTEGER CHECK(retired_at IS NULL OR (revoked=1 AND retired_at>=0));
-- Old revocation times are unknown. Start their quarantine at migration time.
UPDATE scene_shares SET retired_at=CAST(unixepoch('now')*1000 AS INTEGER) WHERE revoked=1 AND retired_at IS NULL;
CREATE TRIGGER scene_retirement_stamp AFTER UPDATE OF revoked ON scene_shares
WHEN OLD.revoked=0 AND NEW.revoked=1 AND NEW.retired_at IS NULL BEGIN
  UPDATE scene_shares SET retired_at=CAST(unixepoch('now')*1000 AS INTEGER) WHERE id=NEW.id AND retired_at IS NULL;
END;
CREATE TRIGGER scene_retirement_immutable BEFORE UPDATE OF retired_at ON scene_shares
WHEN OLD.retired_at IS NOT NULL AND (NEW.retired_at IS NULL OR NEW.retired_at!=OLD.retired_at) BEGIN
  SELECT RAISE(ABORT,'SCENE_RETIREMENT_IMMUTABLE');
END;
CREATE TRIGGER scene_retirement_terminal BEFORE UPDATE OF revoked ON scene_shares
WHEN OLD.revoked=1 AND NEW.revoked!=1 BEGIN
  SELECT RAISE(ABORT,'SCENE_RETIREMENT_TERMINAL');
END;
DROP TRIGGER scene_share_budget;
CREATE TRIGGER scene_share_budget BEFORE INSERT ON scene_shares BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM scene_shares)>=20 THEN RAISE(ABORT,'SCENE_SHARE_BUDGET') END;
  UPDATE scene_budget SET shares=shares+1 WHERE singleton=1;
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'SCENE_SHARE_BUDGET') END;
END;

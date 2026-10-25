-- INACTIVE additive migration. Existing rows remain fixed with unchanged expiry.
-- Apply only after exact candidate review/approval; never normal auto-migrations.
ALTER TABLE scene_shares ADD COLUMN expiry_policy TEXT NOT NULL DEFAULT 'fixed'
  CHECK(expiry_policy IN ('fixed','until_revoked'));
ALTER TABLE scene_shares ADD COLUMN grant_consent_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scene_shares ADD COLUMN snapshot_hash TEXT;
ALTER TABLE scene_shares ADD COLUMN cache_epoch INTEGER NOT NULL DEFAULT 0 CHECK(cache_epoch>=0);
CREATE TRIGGER scene_lifetime_insert BEFORE INSERT ON scene_shares BEGIN
  SELECT CASE WHEN NOT (
    (NEW.expiry_policy='fixed' AND NEW.expires>0 AND NEW.grant_consent_version=0) OR
    (NEW.expiry_policy='until_revoked' AND NEW.expires=0 AND NEW.grant_consent_version=1 AND NEW.snapshot_hash IS NOT NULL)
  ) THEN RAISE(ABORT,'SCENE_LIFETIME_CONSENT') END;
END;
CREATE TRIGGER scene_lifetime_immutable BEFORE UPDATE OF expiry_policy,expires,grant_consent_version ON scene_shares
WHEN NEW.expiry_policy!=OLD.expiry_policy OR NEW.expires!=OLD.expires OR NEW.grant_consent_version!=OLD.grant_consent_version BEGIN
  SELECT RAISE(ABORT,'SCENE_LIFETIME_IMMUTABLE');
END;

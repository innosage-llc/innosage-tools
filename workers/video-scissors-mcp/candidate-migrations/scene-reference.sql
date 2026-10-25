-- INACTIVE: explicit review and staging activation required. Existing D1 only.
-- One immutable reference derivative per freshly consented lease. No URLs.
CREATE TABLE scene_references (
  share TEXT PRIMARY KEY REFERENCES scene_shares(id), epoch INTEGER NOT NULL,
  consent TEXT NOT NULL CHECK(length(CAST(consent AS BLOB))<2048),
  pixels BLOB CHECK(pixels IS NULL OR length(pixels)<=1048576)
);
CREATE TRIGGER scene_reference_purge AFTER UPDATE OF revoked ON scene_shares
WHEN NEW.revoked=1 BEGIN
  DELETE FROM scene_references WHERE share=NEW.id;
END;

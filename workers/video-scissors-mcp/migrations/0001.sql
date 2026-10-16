CREATE TABLE experiment (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), started INTEGER NOT NULL,
  http INTEGER NOT NULL DEFAULT 0, oauth INTEGER NOT NULL DEFAULT 0, dcr INTEGER NOT NULL DEFAULT 0,
  projects INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE projects (
  id TEXT PRIMARY KEY, credential_hash TEXT NOT NULL, proof_hash TEXT,
  proof_expires INTEGER NOT NULL, epoch INTEGER NOT NULL DEFAULT 1,
  expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
  consent_hash TEXT UNIQUE, metadata TEXT NOT NULL DEFAULT '{"duration":0,"generation":0,"version":0,"hasOutput":false,"canUndo":false,"latestOperationId":null,"errorCode":"NONE"}'
);
CREATE UNIQUE INDEX possession_proof ON projects(proof_hash) WHERE proof_hash IS NOT NULL;
CREATE TRIGGER project_budget BEFORE INSERT ON projects BEGIN
  UPDATE experiment SET projects=projects+1 WHERE singleton=1 AND projects<20;
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'PROJECT_BUDGET') END;
END;
CREATE TABLE consent_bindings (
  handle_hash TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id),
  epoch INTEGER NOT NULL, expires INTEGER NOT NULL
);
-- Never erase/overwrite handle tombstones during the cumulative experiment.
CREATE TRIGGER bind_consent AFTER UPDATE OF consent_hash ON projects
WHEN NEW.consent_hash IS NOT NULL AND OLD.consent_hash IS NULL BEGIN
  INSERT INTO consent_bindings VALUES(NEW.consent_hash,NEW.id,NEW.epoch,NEW.expires);
END;
CREATE TABLE commands (
  project TEXT NOT NULL REFERENCES projects(id), id TEXT NOT NULL,
  epoch INTEGER NOT NULL, generation INTEGER NOT NULL, version INTEGER NOT NULL,
  payload_hash TEXT NOT NULL, payload TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','claimed','completed','failed','cancelled','stale')),
  owner_hash TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0,
  deadline INTEGER NOT NULL, result_metadata TEXT,
  PRIMARY KEY(project,id)
);
CREATE UNIQUE INDEX one_active ON commands(project) WHERE state IN ('queued','claimed');
CREATE INDEX pending ON commands(project,state);
CREATE TRIGGER report_metadata AFTER UPDATE OF state ON commands
WHEN NEW.result_metadata IS NOT NULL AND NEW.state IN ('completed','failed','cancelled','stale') BEGIN
  UPDATE projects SET metadata=NEW.result_metadata WHERE id=NEW.project
    AND json_extract(NEW.result_metadata,'$.generation') >= json_extract(metadata,'$.generation')
    AND json_extract(NEW.result_metadata,'$.version') >= json_extract(metadata,'$.version');
END;

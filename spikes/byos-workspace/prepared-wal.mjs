// Workspace-only prepared upload protocol. No credentials or network access here.
// A versioned object deliberately fails closed in the older native array reader.
export const WAL_FORMAT = 'tools142-prepared-wal';
export const WAL_VERSION = 1;
const etagPattern = /^"[\x21\x23-\x7e\x80-\xff]+"$/;
const identityPattern = /^[a-zA-Z0-9_-]{1,200}$/;
export function protocolError(code, details = {}) {
  return Object.assign(new Error(code), {code, details});
}
function requireValue(condition, code) { if (!condition) throw protocolError(code); }
export function completeRecord(value) {
  requireValue(value && identityPattern.test(value.id), 'INVALID_RECORD_ID');
  requireValue(typeof value.body === 'string' && value.body.length <= 256 * 1024, 'INVALID_RECORD_BODY');
  requireValue(typeof value.editId === 'string' && value.editId.length > 0 && value.editId.length <= 200, 'INVALID_RECORD_GENERATION');
  requireValue(value._deleted === false, 'UNSUPPORTED_RECORD_DELETION');
  requireValue(!value._attachments || Object.keys(value._attachments).length === 0, 'UNSUPPORTED_RECORD_ATTACHMENTS');
  return {id: value.id, body: value.body, editId: value.editId, _deleted: false};
}
export function sameRecord(a, b) {
  if (!a || !b) return a === b;
  return JSON.stringify(completeRecord(a)) === JSON.stringify(completeRecord(b));
}
export function validEtag(value) { return typeof value === 'string' && etagPattern.test(value); }
export function validateIntent(input, allowedIds, fileIds) {
  requireValue(input && Number.isSafeInteger(input.generation) && input.generation > 0, 'INVALID_INTENT_GENERATION');
  requireValue(identityPattern.test(input.fileId), 'INVALID_FILE_ID');
  requireValue(validEtag(input.expectedEtag), 'INVALID_EXPECTED_ETAG');
  const base = completeRecord(input.base), target = completeRecord(input.target);
  requireValue(base.id === target.id && allowedIds.has(target.id), 'INTENT_OUTSIDE_FIXTURE');
  requireValue(fileIds instanceof Map && fileIds.get(target.id) === input.fileId, 'FILE_BINDING_MISMATCH');
  requireValue(base.editId !== target.editId || sameRecord(base, target), 'EDIT_ID_REUSED_FOR_DIFFERENT_RECORD');
  return {generation: input.generation, fileId: input.fileId, expectedEtag: input.expectedEtag, base, target};
}
export function validateWal(value, {workspace, allowedIds, fileIds}) {
  requireValue(value?.format === WAL_FORMAT && value.version === WAL_VERSION, 'UNKNOWN_WAL_VERSION');
  requireValue(value.workspace === workspace, 'WAL_WORKSPACE_MISMATCH');
  requireValue(typeof value.runId === 'string' && identityPattern.test(value.runId), 'INVALID_WAL_RUN');
  requireValue(Array.isArray(value.rows) && value.rows.length <= 26, 'INVALID_WAL_ROWS');
  const rows = value.rows.map(row => validateIntent(row, allowedIds, fileIds));
  requireValue(new Set(rows.map(row => row.target.id)).size === rows.length, 'DUPLICATE_WAL_PAGE');
  requireValue(new Set(rows.map(row => row.fileId)).size === rows.length, 'DUPLICATE_WAL_FILE');
  return {format: WAL_FORMAT, version: WAL_VERSION, workspace, runId: value.runId, rows};
}
export function recoveryDecision(row, observed) {
  requireValue(observed && validEtag(observed.etag), 'UNVERIFIABLE_REMOTE_RECORD');
  const remote = completeRecord(observed.record);
  requireValue(remote.id === row.target.id, 'REMOTE_IDENTITY_MISMATCH');
  if (sameRecord(remote, row.target)) return 'already-applied';
  if (observed.etag === row.expectedEtag && sameRecord(remote, row.base)) return 'write-with-stored-etag';
  return 'conflict';
}

/**
 * Caller owns the single lease and closes dispatch gates during recovery.
 * IO must use one physical attempt per write, exact ETags, bounded requests and
 * independent revision-bound reads. A thrown/uncertain write never clears WAL.
 * This function never retires a local journal or manufactures native metadata.
 */
export async function recoverPreparedWal(snapshot, context, io) {
  requireValue(validEtag(snapshot?.etag), 'INVALID_WAL_ETAG');
  const wal = validateWal(snapshot.value, context);
  const plans = [];
  // Validate every row before any mutation. A CAS still protects the later race.
  for (const row of wal.rows) {
    const observed = await io.readPage(row.fileId);
    const decision = recoveryDecision(row, observed);
    if (decision === 'conflict') throw protocolError('RECOVERY_CONFLICT', {row, observed});
    plans.push({row, decision});
  }
  for (const {row, decision} of plans) {
    if (decision === 'write-with-stored-etag') {
      io.assertCanWrite();
      await io.writePage(row.fileId, row.expectedEtag, structuredClone(row.target));
    }
    const confirmed = await io.readPage(row.fileId);
    if (!sameRecord(confirmed.record, row.target)) throw protocolError('RECOVERY_READBACK_MISMATCH', {row, confirmed});
  }
  io.assertCanWrite();
  // Never substitute a freshly fetched WAL validator for this verified snapshot.
  await io.clearWal(snapshot.etag);
  return {recovered: plans.length, writes: plans.filter(p => p.decision === 'write-with-stored-etag').length};
}

// A native-array WAL has no original ETag. Only an existing exact baseline (or
// exact target) may be admitted; ambiguous/missing-file creates fail closed.
export function auditLegacyRow(row, observed, fileId, generation, allowedIds, fileIds) {
  requireValue(row?.assumedMasterState && observed?.record, 'UNSAFE_LEGACY_CREATE_OR_MISSING_RECORD');
  const base = completeRecord(row.assumedMasterState), target = completeRecord(row.newDocumentState);
  if (!sameRecord(observed.record, base) && !sameRecord(observed.record, target))
    throw protocolError('LEGACY_WAL_CONFLICT', {base, target, observed});
  return validateIntent({base, target, fileId, generation, expectedEtag: observed.etag}, allowedIds, fileIds);
}

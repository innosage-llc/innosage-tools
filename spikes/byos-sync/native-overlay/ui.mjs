import './browser-runtime.mjs';
import { openPageStore } from './page-store.mjs';

const params = new URLSearchParams(window.location.search);
const workspace = params.get('workspace') || 'demo';
let session = params.get('session');
if (!session) {
  try {
    session = sessionStorage.getItem('spike_session');
    if (!session) {
      session = crypto.randomUUID();
      sessionStorage.setItem('spike_session', session);
    }
  } catch {
    session = crypto.randomUUID();
  }
}
const page = params.get('page') || 'page';
const endpoint = params.get('endpoint');

const editor = document.getElementById('editor');
const saveBtn = document.getElementById('save-btn');
const syncBtn = document.getElementById('sync-btn');
const verifyBtn = document.getElementById('verify-btn');
const statusEl = document.getElementById('status');
const operationProgressEl = document.getElementById('operation-status');
const warningEl = document.getElementById('warning');
const writerNotice = document.getElementById('writer-notice');
const localPre = document.getElementById('local-body');
const cloudPre = document.getElementById('cloud-body');
const useCloudBtn = document.getElementById('use-cloud-btn');
const keepLocalBtn = document.getElementById('keep-local-btn');
const mergeManualBtn = document.getElementById('merge-manual-btn');
const mergeSection = document.getElementById('manual-merge-section');
const mergeEditor = document.getElementById('merge-editor');
const commitMergeBtn = document.getElementById('commit-merge-btn');
const recoveryArea = document.getElementById('recovery-area');

let dirty = false;
let dirtyBaseline = null;
let dirtyBaselinePage = null;
let inputGeneration = 0;
let currentView = null;
let manualWarning = null;

let activeOperation = null;
let opTimer = null;

function isOperationPending() {
  return !!(activeOperation && activeOperation.pending);
}

function getElapsedSeconds(op) {
  if (!op) return 0;
  const fromLocal = op.startedAt ? Math.floor((Date.now() - op.startedAt) / 1000) : 0;
  const fromBackend = (typeof op.elapsedMs === 'number' && !isNaN(op.elapsedMs)) ? Math.floor(op.elapsedMs / 1000) : 0;
  return Math.max(fromLocal, fromBackend);
}

function renderOperationProgress() {
  if (!operationProgressEl || !activeOperation) return;
  const op = activeOperation;
  const sec = op.pending ? getElapsedSeconds(op) : (op.finalElapsedSec ?? getElapsedSeconds(op));
  const req = op.requestCount ?? 0;
  const kind = op.kind || 'operation';
  const phase = op.phase || (op.pending ? 'initializing' : 'complete');

  let text = `Operation: ${kind} | Phase: ${phase} | Elapsed: ${sec}s | Requests: ${req}`;
  if (op.error) {
    text += ` | Error: ${op.error}`;
  }
  operationProgressEl.textContent = text;
}

function startOperationTimer() {
  stopOperationTimer();
  opTimer = setInterval(() => {
    if (activeOperation && activeOperation.pending) {
      renderOperationProgress();
    }
  }, 1000);
}

function stopOperationTimer() {
  if (opTimer) {
    clearInterval(opTimer);
    opTimer = null;
  }
}

function updateAriaBusy(busy) {
  const busyStr = busy ? 'true' : 'false';
  if (syncBtn) syncBtn.setAttribute('aria-busy', busyStr);
  if (verifyBtn) verifyBtn.setAttribute('aria-busy', busyStr);
  if (useCloudBtn) useCloudBtn.setAttribute('aria-busy', busyStr);
  if (keepLocalBtn) keepLocalBtn.setAttribute('aria-busy', busyStr);
  if (mergeManualBtn) mergeManualBtn.setAttribute('aria-busy', busyStr);
  if (commitMergeBtn) commitMergeBtn.setAttribute('aria-busy', busyStr);
  if (operationProgressEl) operationProgressEl.setAttribute('aria-busy', busyStr);
}

function updateControlsDisabled() {
  const isWriter = currentView ? currentView.writer !== false : true;
  const pending = isOperationPending();

  // Keep editor and Save locally available; only writer role disables them
  if (editor) editor.disabled = !isWriter;
  if (saveBtn) saveBtn.disabled = !isWriter;
  if (mergeEditor) mergeEditor.disabled = !isWriter;

  if (writerNotice) {
    writerNotice.textContent = isWriter ? '' : 'Writes disabled (non-writer session or ownership unavailable)';
    writerNotice.hidden = isWriter;
  }

  // Cloud action controls disabled for whole operation, restored respecting writer
  if (syncBtn) syncBtn.disabled = pending;
  if (verifyBtn) verifyBtn.disabled = pending;
  if (useCloudBtn) useCloudBtn.disabled = pending || !isWriter;
  if (keepLocalBtn) keepLocalBtn.disabled = pending || !isWriter;
  if (mergeManualBtn) mergeManualBtn.disabled = pending || !isWriter;
  if (commitMergeBtn) commitMergeBtn.disabled = pending || !isWriter;
}

function finishOperation(errorMsg) {
  if (!activeOperation) return;
  stopOperationTimer();
  activeOperation.pending = false;
  activeOperation.uiPending = false;
  if (errorMsg) {
    activeOperation.phase = 'failed';
    activeOperation.error = errorMsg;
    if (operationProgressEl) operationProgressEl.dataset.error = 'true';
  } else {
    activeOperation.phase = 'complete';
    if (operationProgressEl) operationProgressEl.dataset.error = 'false';
  }
  activeOperation.finalElapsedSec = getElapsedSeconds(activeOperation);
  renderOperationProgress();
  updateAriaBusy(false);
  updateControlsDisabled();
}

function handleViewOperation(op) {
  if (!op) return;
  // A delayed view of the previous action must not overwrite a new click's
  // pending phase, counters or error. Bind updates to the backend operation ID.
  if (activeOperation?.uiPending && op.id <= activeOperation.priorBackendId) return;
  if (!activeOperation) {
    if (op.pending) {
      activeOperation = {
        kind: op.kind,
        phase: op.phase,
        pending: true,
        elapsedMs: op.elapsedMs ?? 0,
        requestCount: op.requestCount ?? 0,
        startedAt: Date.now() - (op.elapsedMs ?? 0),
        uiPending: false,
        error: null
      };
      if (operationProgressEl) {
        operationProgressEl.hidden = false;
        operationProgressEl.dataset.error = 'false';
      }
      updateControlsDisabled();
      updateAriaBusy(true);
      renderOperationProgress();
      startOperationTimer();
    }
    return;
  }

  if (op.kind) activeOperation.kind = op.kind;
  if (op.phase) activeOperation.phase = op.phase;
  if (typeof op.requestCount === 'number') activeOperation.requestCount = op.requestCount;
  if (typeof op.elapsedMs === 'number') activeOperation.elapsedMs = op.elapsedMs;

  // A whole operation pending flag must not clear at an intermediate sync/view update
  if (!activeOperation.uiPending) {
    if (op.pending === false || op.phase === 'complete' || op.phase === 'failed') {
      finishOperation(op.phase === 'failed' ? (activeOperation.error || op.error || 'Operation failed') : null);
      return;
    }
  }

  renderOperationProgress();
}

async function runCloudAction(kind, actionFn) {
  // Guard same-tick repeated clicks at UI entry and conflicting cloud actions
  if (isOperationPending()) {
    return;
  }

  const startedAt = Date.now();
  activeOperation = {
    kind,
    phase: 'preflight',
    pending: true,
    elapsedMs: 0,
    requestCount: 0,
    startedAt,
    uiPending: true,
    priorBackendId: currentView?.operation?.id ?? 0,
    error: null
  };

  // Immediate visibility before awaiting anything
  if (operationProgressEl) {
    operationProgressEl.hidden = false;
    operationProgressEl.dataset.error = 'false';
  }
  updateControlsDisabled();
  updateAriaBusy(true);
  renderOperationProgress();
  startOperationTimer();

  try {
    await actionFn();
    // The public store promise covers the whole action. Its returned view can
    // precede the final async subscription notification, so do not wait on a
    // possibly stale pending view after that promise has settled.
    activeOperation.uiPending = false;
    finishOperation(null);
  } catch (err) {
    activeOperation.uiPending = false;
    const msg = err && err.message ? err.message : String(err);
    finishOperation(msg);
  }
}

function showError(err) {
  const msg = err && err.message ? err.message : String(err);
  statusEl.textContent = `Error: ${msg}`;
  statusEl.dataset.error = 'true';
}

function applyView(v) {
  if (!v) return;
  currentView = v;

  if (statusEl.dataset.error !== 'true') {
    statusEl.textContent = dirty ? 'Edited — not saved locally' : (v.status || '');
  }

  const warnings = [];
  if (v.warning) warnings.push('Review needed: protected local draft retained');
  if (dirty && v.body != null && v.body !== dirtyBaseline && v.body !== editor.value) {
    warnings.push('Review needed: external change detected; local edits retained');
  }
  if (manualWarning) warnings.push(manualWarning);

  if (warnings.length) {
    warningEl.textContent = warnings.join(' | ');
    warningEl.hidden = false;
  } else {
    warningEl.textContent = '';
    warningEl.hidden = true;
  }

  if (!dirty) {
    const nextBody = v.body ?? '';
    if (editor.value !== nextBody) editor.value = nextBody;
  }

  localPre.textContent = v.local ?? '';
  cloudPre.textContent = v.cloud ?? '';

  updateControlsDisabled();
  renderDrafts(v.drafts);

  if (v.operation) {
    handleViewOperation(v.operation);
  }
}

function renderDrafts(drafts) {
  if (!recoveryArea) return;
  recoveryArea.textContent = '';
  if (Array.isArray(drafts) && drafts.length) {
    for (const d of drafts) {
      const card = document.createElement('div');
      card.className = 'draft-card';
      const meta = document.createElement('div');
      meta.className = 'draft-meta';
      meta.textContent = `Session: ${d.session} | Seq: ${d.seq} | State: ${d.state}`;
      const pre = document.createElement('pre');
      pre.textContent = d.body ?? '';
      card.appendChild(meta);
      card.appendChild(pre);
      if (d.external) {
        const captured = document.createElement('pre');
        captured.textContent = 'Captured other-tab version\n' + d.external;
        card.appendChild(captured);
      }
      recoveryArea.appendChild(card);
    }
  } else {
    recoveryArea.textContent = 'No draft sessions';
  }
}

editor.addEventListener('input', () => {
  if (!dirty) {
    dirtyBaseline = currentView?.body ?? '';
    dirtyBaselinePage = structuredClone(currentView?.page ?? null);
  }
  dirty = true;
  inputGeneration++;
  statusEl.textContent = 'Edited — not saved locally';
});

saveBtn.addEventListener('click', async () => {
  const savedText = editor.value;
  const generation = inputGeneration;
  try {
    statusEl.dataset.error = 'false';
    const v = await store.save(page, savedText, { base: dirty ? dirtyBaselinePage : (currentView?.page ?? null) });
    window.spike.lastSaveAcknowledgement = { page, body: savedText };
    if (inputGeneration === generation) {
      dirty = false;
      manualWarning = null;
    }
    applyView(v);
  } catch (err) {
    showError(err);
  }
});

syncBtn.addEventListener('click', () => {
  runCloudAction('sync', async () => {
    await store.sync();
    const v = await store.view(page);
    applyView(v);
  });
});

verifyBtn.addEventListener('click', () => {
  runCloudAction('verify', async () => {
    await store.verify(page);
    const v = await store.view(page);
    applyView(v);
  });
});

async function resolveWith(type, body) {
  const kind = `resolve-${type}`;
  runCloudAction(kind, async () => {
    const generation = inputGeneration;
    const localText = editor.value;
    if (type === 'local' && dirty) {
      await store.save(page, localText, { base: dirtyBaselinePage });
    }
    const v = await store.resolve(page, type, body);
    if (inputGeneration === generation) {
      dirty = false;
      dirtyBaseline = null;
      manualWarning = null;
    } else {
      manualWarning = 'Resolution preserved newer unsaved editor input';
    }
    applyView(v);
  });
}

useCloudBtn.addEventListener('click', () => resolveWith('cloud'));
keepLocalBtn.addEventListener('click', () => resolveWith('local'));

mergeManualBtn.addEventListener('click', () => {
  if (isOperationPending()) return;
  mergeSection.hidden = false;
  mergeEditor.value = (currentView && currentView.local != null) ? currentView.local : editor.value;
});

commitMergeBtn.addEventListener('click', () => {
  if (isOperationPending()) return;
  mergeSection.hidden = true;
  resolveWith('merge', mergeEditor.value);
});

let store;
try {
  store = await openPageStore({ workspace, session });
  store.subscribe(page, (v) => {
    statusEl.dataset.error = 'false';
    applyView(v);
  });
  const initialView = await store.view(page);
  applyView(initialView);
  if (endpoint) {
    store.connect(endpoint).catch((err) => showError(err));
  }
} catch (err) {
  showError(err);
}

window.spike = { store, ready: !!store };
window.addEventListener('beforeunload', () => {
  stopOperationTimer();
  if (store && typeof store.close === 'function') store.close();
});

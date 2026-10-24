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

  const isWriter = v.writer !== false;
  editor.disabled = !isWriter;
  saveBtn.disabled = !isWriter;
  useCloudBtn.disabled = !isWriter;
  keepLocalBtn.disabled = !isWriter;
  mergeManualBtn.disabled = !isWriter;
  commitMergeBtn.disabled = !isWriter;
  mergeEditor.disabled = !isWriter;
  if (writerNotice) {
    writerNotice.textContent = isWriter ? '' : 'Writes disabled (non-writer session or ownership unavailable)';
    writerNotice.hidden = isWriter;
  }

  renderDrafts(v.drafts);
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
  if (!dirty) {dirtyBaseline = currentView?.body ?? '';
    dirtyBaselinePage = structuredClone(currentView?.page ?? null);}
  dirty = true;
  inputGeneration++;
  statusEl.textContent = 'Edited — not saved locally';
});

saveBtn.addEventListener('click', async () => {
  const savedText = editor.value;
  const generation = inputGeneration;
  try {
    statusEl.dataset.error = 'false';
    const v = await store.save(page, savedText, {base:dirty ? dirtyBaselinePage : (currentView?.page ?? null)});
    window.spike.lastSaveAcknowledgement = {page, body:savedText};
    if (inputGeneration === generation) {
      dirty = false;
      manualWarning = null;
    }
    applyView(v);
  } catch (err) {
    showError(err);
  }
});

syncBtn.addEventListener('click', async () => {
  try {
    statusEl.dataset.error = 'false';
    await store.sync();
    const v = await store.view(page);
    applyView(v);
  } catch (err) {
    showError(err);
  }
});

verifyBtn.addEventListener('click', async () => {
  try {
    statusEl.dataset.error = 'false';
    const v = await store.verify(page);
    applyView(v);
  } catch (err) {
    showError(err);
  }
});

async function resolveWith(type, body) {
  const generation = inputGeneration;
  const localText = editor.value;
  try {
    statusEl.dataset.error = 'false';
    if (type === 'local' && dirty) await store.save(page, localText, {base:dirtyBaselinePage});
    const v = await store.resolve(page, type, body);
    if (inputGeneration === generation) {
      dirty = false;
      dirtyBaseline = null;
      manualWarning = null;
    } else manualWarning = 'Resolution preserved newer unsaved editor input';
    applyView(v);
  } catch (err) { showError(err); }
}

useCloudBtn.addEventListener('click', () => resolveWith('cloud'));
keepLocalBtn.addEventListener('click', () => resolveWith('local'));

mergeManualBtn.addEventListener('click', () => {
  mergeSection.hidden = false;
  mergeEditor.value = (currentView && currentView.local != null) ? currentView.local : editor.value;
});

commitMergeBtn.addEventListener('click', () => {
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
  if (store && typeof store.close === 'function') store.close();
});

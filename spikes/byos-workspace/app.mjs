import '../byos-sync/native-overlay/browser-runtime.mjs';
import { openPageStore, configureProvider } from './provider.mjs';
import { Workspace } from './workspace.mjs';
import { ForegroundRun } from './foreground.mjs';
import {prepareOfflineShell} from '../byos-sync/real-drive/offline-shell.mjs';

// --- Configuration & Safe Parameter Extraction ---
const params = new URLSearchParams(window.location.search);
const safeIdPattern = /^[a-zA-Z0-9_-]{1,90}$/;

const rawWorkspace = params.get('workspace') || 'demo';
const workspace = safeIdPattern.test(rawWorkspace) ? rawWorkspace : 'demo';

let session = params.get('session');
if (!session || !safeIdPattern.test(session)) {
  const storageKey = `byos_workspace_session_${workspace}`;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored && safeIdPattern.test(stored)) {
      session = stored;
    } else {
      session = 's_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      localStorage.setItem(storageKey, session);
    }
  } catch {
    session = 's_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }
}

const rawEndpoint = params.get('endpoint');
let validEndpoint = null;
if (rawEndpoint) {
  try {
    const parsed = new URL(rawEndpoint);
    if (parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && !parsed.username && !parsed.password) {
      validEndpoint = rawEndpoint;
    } else {
      console.warn('Endpoint ignored: mock transport permits only HTTP 127.0.0.1');
    }
  } catch {
    console.warn('Invalid endpoint URL parameter');
  }
}

// --- DOM References ---
const wsLabel = document.getElementById('ws-label');
const sessionLabel = document.getElementById('session-label');
const pageCountEl = document.getElementById('page-count');
const discoveryStatusEl = document.getElementById('discovery-status');
const treeContainer = document.getElementById('tree');
const recoveryTreeGroup = document.getElementById('recovery-tree-group');
const recoveryTreeList = document.getElementById('recovery-tree-list');

const newRootBtn = document.getElementById('new-root-btn');
const newChildBtn = document.getElementById('new-child-btn');

const writerNoticeEl = document.getElementById('writer-notice');
const statusEl = document.getElementById('status');
const operationStatusEl = document.getElementById('operation-status');

const titleInput = document.getElementById('page-title');
const parentSelect = document.getElementById('page-parent');
const orderInput = document.getElementById('page-order');
const editorTextarea = document.getElementById('editor');

const metaPageIdEl = document.getElementById('meta-page-id');
const metaEditIdEl = document.getElementById('meta-edit-id');
const metaGenerationEl = document.getElementById('meta-generation');
const metaDurabilityEl = document.getElementById('meta-durability');
const metaVerifiedEl = document.getElementById('meta-verified');

const saveBtn = document.getElementById('save-btn');
const syncBtn = document.getElementById('sync-btn');
const verifyBtn = document.getElementById('verify-btn');
const foregroundStartBtn = document.getElementById('foreground-start-btn');
const foregroundStopBtn = document.getElementById('foreground-stop-btn');
const foregroundStatusEl = document.getElementById('foreground-status');

const conflictSection = document.getElementById('conflict-section');
const conflictWarningEl = document.getElementById('conflict-warning');
const conflictLocalPreview = document.getElementById('conflict-local-preview');
const conflictCloudPreview = document.getElementById('conflict-cloud-preview');
const useCloudBtn = document.getElementById('use-cloud-btn');
const keepLocalBtn = document.getElementById('keep-local-btn');
const toggleMergeBtn = document.getElementById('toggle-merge-btn');
const mergePanel = document.getElementById('merge-panel');
const mergeEditor = document.getElementById('merge-editor');
const commitMergeBtn = document.getElementById('commit-merge-btn');

const refreshHandoffBtn = document.getElementById('refresh-handoff-btn');
const handoffDetailsEl = document.getElementById('handoff-details');
const recoveryContentEl = document.getElementById('recovery-content');

// Header labels
wsLabel.textContent = workspace;
sessionLabel.textContent = session;

// --- State Variables ---
let store = null;
let controller = null;
let selectedPageId = null;
let currentRead = null;
let currentView = null;
let currentCatalog = null;

/**
 * In-memory buffers per page:
 * Map<id, {
 *   title: string,
 *   parentId: string | null,
 *   order: number,
 *   markdown: string,
 *   nativeBaseline: object | null,
 *   generation: number,
 *   dirty: boolean
 * }>
 */
const pageBuffers = new Map();
const collapsedNodes = new Set();
let refreshTicket = 0;

let activeOperation = null;
let opTimer = null;
let cloudActionBusy = false;
let renderedPageId = null;
let foreground = null;
let providerInfo = null;

function renderForeground() {
  if (!foreground) foregroundStatusEl.textContent = 'Off — use explicit Sync and Verify.';
  else {
    const snapshot = foreground.snapshot();
    const labels = {
      idle:'Waiting for the next local save. Sync completion is not verification.',
      queued:'Saved changes queued for foreground sync.',
      'in-flight':'Sync running; local editing and saving remain available.',
      hidden:'Paused while this tab is hidden; saved changes retained.',
      offline:'Offline; saved changes retained.',
      'authorization-needed':'Authorization needed; saved changes retained.',
      'read-only':'Writer unavailable; saved changes retained.',
      'cloud-action-active':'Waiting for the current cloud action.',
      'budget-exhausted':'Two-sync limit reached. Use explicit Sync and Verify for further work.',
      halted:'Stopped after an error; cloud outcome uncertain. No automatic retry.',
      stopped:'Future syncs stopped. Already-started work may still finish.'
    };
    foregroundStatusEl.textContent = `${labels[snapshot.state]} Runs: ${snapshot.dispatches}/2. Verification and destination observation remain separate.`;
    foregroundStatusEl.dataset.state = snapshot.state;
    foregroundStatusEl.dataset.dispatches = String(snapshot.dispatches);
  }
  updateWriterControls();
}
function wakeForeground() { foreground?.wake(); renderForeground(); }

// --- Operation Progress & Timer ---
function renderOperationStatus() {
  if (!activeOperation) {
    operationStatusEl.textContent = 'Ready (no cloud operation active)';
    operationStatusEl.removeAttribute('aria-busy');
    updateButtonsAriaBusy(false);
    return;
  }

  const op = store?.operation ?? activeOperation;
  const elapsedSec = op.pending
    ? (op.startedAt ? Math.max(0, Math.floor((performance.now() - op.startedAt) / 1000)) : 0)
    : (typeof op.elapsedMs === 'number' ? Math.max(0, Math.floor(op.elapsedMs / 1000)) : 0);

  const phase = op.phase || (op.pending ? 'running' : 'complete');
  const authorityNotice = store?.state === 'reauth-required' ? ' | Authorization needed; local drafts retained' : store?.state === 'blocked' ? ' | Cloud blocked/uncertain; local drafts retained' : '';
  const reqCount = typeof op.requestCount === 'number' ? op.requestCount : 0;
  operationStatusEl.textContent = `Operation: ${op.kind || 'op'} | Phase: ${phase} | Elapsed: ${elapsedSec}s | Requests: ${reqCount}${authorityNotice}`;

  if (op.pending) {
    operationStatusEl.setAttribute('aria-busy', 'true');
    updateButtonsAriaBusy(true);
  } else {
    operationStatusEl.removeAttribute('aria-busy');
    updateButtonsAriaBusy(false);
  }
}

function startOperationTimer() {
  stopOperationTimer();
  opTimer = setInterval(() => {
    if (activeOperation && activeOperation.pending) {
      renderOperationStatus();
    }
  }, 500);
}

function stopOperationTimer() {
  if (opTimer) {
    clearInterval(opTimer);
    opTimer = null;
  }
}

function updateButtonsAriaBusy(busy) {
  const busyStr = busy ? 'true' : 'false';
  syncBtn.setAttribute('aria-busy', busyStr);
  verifyBtn.setAttribute('aria-busy', busyStr);
  useCloudBtn.setAttribute('aria-busy', busyStr);
  keepLocalBtn.setAttribute('aria-busy', busyStr);
  commitMergeBtn.setAttribute('aria-busy', busyStr);
}

// --- Status Updates ---
function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.setAttribute('data-error', isError ? 'true' : 'false');
  if (isError) {
    statusEl.classList.add('error');
  } else {
    statusEl.classList.remove('error');
  }
}

// --- Baseline Extraction ---
function extractNativeBaseline(readResult) {
  if (!readResult) return null;
  if (readResult.baseline) {
    return {
      id: readResult.baseline.id,
      body: readResult.baseline.body,
      editId: readResult.baseline.editId
    };
  }
  if (readResult.view && readResult.view.page) {
    return {
      id: readResult.view.page.id,
      body: readResult.view.page.body,
      editId: readResult.view.page.editId
    };
  }
  if (readResult.view && readResult.view.journal && readResult.view.journal.draft) {
    return {
      id: readResult.view.journal.draft.id,
      body: readResult.view.journal.draft.body,
      editId: readResult.view.journal.draft.editId
    };
  }
  if (readResult.page) {
    const keys = ['format', 'version', 'workspaceId', 'id', 'title', 'parentId', 'order', 'markdown'];
    const envelope = Object.fromEntries(keys.map(k => [k, readResult.page[k]]));
    return {
      id: readResult.page.id,
      body: JSON.stringify(envelope),
      editId: readResult.page.editId || 'initial'
    };
  }
  return null;
}

// --- Buffer Helpers ---
function getOrCreateBuffer(id, pageData, nativeBaseline) {
  let buf = pageBuffers.get(id);
  if (!buf) {
    buf = {
      title: pageData ? pageData.title : 'Untitled',
      parentId: pageData ? pageData.parentId : null,
      order: pageData && typeof pageData.order === 'number' ? pageData.order : 0,
      markdown: pageData ? pageData.markdown : '',
      nativeBaseline: nativeBaseline || null,
      generation: 0,
      saveAttempt: 0,
      dirty: false
    };
    pageBuffers.set(id, buf);
  } else if (nativeBaseline && !buf.nativeBaseline) {
    buf.nativeBaseline = nativeBaseline;
  }
  return buf;
}

// --- Writer Controls ---
function updateWriterControls() {
  const hasWriter = !!(store && store.writer);
  const cloudBusy = cloudActionBusy || !!store?.operation?.pending || !!foreground?.flight;
  if (!hasWriter) {
    writerNoticeEl.textContent = 'Writer disabled: session already owned or safe ownership unavailable. This tab is in read-only mode.';
    writerNoticeEl.style.display = 'block';
  } else {
    writerNoticeEl.textContent = '';
    writerNoticeEl.style.display = 'none';
  }

  titleInput.disabled = !hasWriter;
  parentSelect.disabled = !hasWriter;
  orderInput.disabled = !hasWriter;
  editorTextarea.disabled = !hasWriter;
  saveBtn.disabled = !hasWriter;
  newRootBtn.disabled = !hasWriter;
  newChildBtn.disabled = !hasWriter;
  syncBtn.disabled = cloudBusy;
  verifyBtn.disabled = !hasWriter || cloudBusy;
  useCloudBtn.disabled = !hasWriter || cloudBusy;
  keepLocalBtn.disabled = !hasWriter || cloudBusy;
  commitMergeBtn.disabled = !hasWriter || cloudBusy;
  foregroundStartBtn.disabled = !hasWriter || !controller || !!foreground || cloudBusy;
  foregroundStopBtn.disabled = !foreground || foreground.stopped || foreground.halted;
}

// --- Deterministic Sorting ---
function deterministicSort(a, b) {
  const ordA = typeof a.order === 'number' ? a.order : 0;
  const ordB = typeof b.order === 'number' ? b.order : 0;
  if (ordA !== ordB) return ordA - ordB;
  return (a.id || '').localeCompare(b.id || '');
}

// --- Tree Analysis (Cycles, Orphans, Invalid) ---
function analyzeCatalogTree(pages, issues) {
  const byId = new Map(pages.map(p => [p.id, p]));
  const invalidEnvelopeIds = new Set();

  for (const issue of issues) {
    if (typeof issue === 'string' && issue.startsWith('invalid-envelope:')) {
      invalidEnvelopeIds.add(issue.slice('invalid-envelope:'.length));
    }
  }

  const quarantine = new Map(); // pageId -> { page, reason }

  for (const page of pages) {
    if (invalidEnvelopeIds.has(page.id)) {
      quarantine.set(page.id, { page, reason: 'Invalid envelope format' });
      continue;
    }

    const seen = new Set([page.id]);
    let currentParent = page.parentId;
    let foundIssue = null;

    while (currentParent !== null) {
      if (seen.has(currentParent)) {
        foundIssue = `Cyclic loop references ${currentParent}`;
        break;
      }
      seen.add(currentParent);
      if (!byId.has(currentParent)) {
        foundIssue = `Orphan: parent ${currentParent} not found`;
        break;
      }
      currentParent = byId.get(currentParent).parentId;
    }

    if (foundIssue) {
      quarantine.set(page.id, { page, reason: foundIssue });
    }
  }

  return { byId, quarantine };
}

// --- Render Sidebar Tree ---
function renderTree(catalog) {
  pageCountEl.textContent = catalog.countLabel || `${catalog.pages.length} locally known pages; remote total unknown`;
  discoveryStatusEl.textContent = `Discovery: ${catalog.discovery || 'local-only'}`;

  const { byId, quarantine } = analyzeCatalogTree(catalog.pages, catalog.issues || []);

  // 1. Quarantined / Recovery Items
  if (quarantine.size > 0) {
    recoveryTreeGroup.style.display = 'block';
    recoveryTreeList.textContent = '';

    const sortedQuarantine = Array.from(quarantine.values())
      .map(entry => entry.page)
      .sort(deterministicSort);

    for (const page of sortedQuarantine) {
      const reason = quarantine.get(page.id).reason;
      const row = document.createElement('div');
      row.className = 'recovery-item-row' + (page.id === selectedPageId ? ' selected' : '');
      row.onclick = () => selectPage(page.id);

      const header = document.createElement('div');
      header.className = 'recovery-item-header';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'recovery-item-title';
      titleSpan.textContent = page.title || '(Untitled)';
      header.appendChild(titleSpan);

      const issueBadge = document.createElement('span');
      issueBadge.className = 'recovery-item-issue';
      issueBadge.textContent = reason;
      header.appendChild(issueBadge);

      row.appendChild(header);

      const idSpan = document.createElement('span');
      idSpan.className = 'recovery-item-id';
      idSpan.textContent = page.id;
      row.appendChild(idSpan);

      recoveryTreeList.appendChild(row);
    }
  } else {
    recoveryTreeGroup.style.display = 'none';
    recoveryTreeList.textContent = '';
  }

  for (const invalid of catalog.invalid ?? []) {
    recoveryTreeGroup.style.display = 'block';
    const item = document.createElement('details');
    item.className = 'invalid-envelope-recovery';
    const summary = document.createElement('summary');
    summary.textContent = `${invalid.id}: unreadable envelope — raw protected recovery`;
    const raw = document.createElement('pre');
    raw.textContent = JSON.stringify(invalid, null, 2);
    item.append(summary, raw); recoveryTreeList.append(item);
  }

  // 2. Healthy / Standard Hierarchy
  treeContainer.textContent = '';
  const validPages = catalog.pages.filter(p => !quarantine.has(p.id));

  const childrenMap = new Map();
  for (const p of validPages) {
    const parent = p.parentId;
    if (!childrenMap.has(parent)) {
      childrenMap.set(parent, []);
    }
    childrenMap.get(parent).push(p);
  }

  for (const list of childrenMap.values()) {
    list.sort(deterministicSort);
  }

  function renderBranch(parentId, containerEl) {
    const children = childrenMap.get(parentId) || [];
    for (const child of children) {
      const nodeEl = document.createElement('div');
      nodeEl.className = 'tree-node';

      const rowEl = document.createElement('div');
      rowEl.className = 'tree-row' + (child.id === selectedPageId ? ' selected' : '');
      rowEl.setAttribute('role', 'treeitem');
      rowEl.setAttribute('aria-selected', child.id === selectedPageId ? 'true' : 'false');

      const grandChildren = childrenMap.get(child.id) || [];
      const hasChildren = grandChildren.length > 0;

      if (hasChildren) {
        const isCollapsed = collapsedNodes.has(child.id);
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'tree-toggle-btn';
        toggleBtn.textContent = isCollapsed ? '+' : '−';
        toggleBtn.title = isCollapsed ? 'Expand' : 'Collapse';
        toggleBtn.onclick = (e) => {
          e.stopPropagation();
          if (collapsedNodes.has(child.id)) {
            collapsedNodes.delete(child.id);
          } else {
            collapsedNodes.add(child.id);
          }
          renderTree(catalog);
        };
        rowEl.appendChild(toggleBtn);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'tree-toggle-spacer';
        rowEl.appendChild(spacer);
      }

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tree-title-text';
      titleSpan.textContent = child.title || '(Untitled)';
      rowEl.appendChild(titleSpan);

      const idBadge = document.createElement('span');
      idBadge.className = 'tree-id-badge';
      idBadge.textContent = child.id.slice(0, 10) + '…';
      rowEl.appendChild(idBadge);

      rowEl.onclick = () => selectPage(child.id);
      nodeEl.appendChild(rowEl);

      if (hasChildren && !collapsedNodes.has(child.id)) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children';
        childrenContainer.setAttribute('role', 'group');
        renderBranch(child.id, childrenContainer);
        nodeEl.appendChild(childrenContainer);
      }

      containerEl.appendChild(nodeEl);
    }
  }

  renderBranch(null, treeContainer);
}

// --- Parent Select Dropdown Population ---
function populateParentSelect(catalog, currentId, selectedParentId) {
  parentSelect.textContent = '';

  const rootOption = document.createElement('option');
  rootOption.value = '';
  rootOption.textContent = '(None - Root)';
  parentSelect.appendChild(rootOption);

  if (!catalog || !catalog.pages) return;

  const { byId } = analyzeCatalogTree(catalog.pages, catalog.issues || []);

  function isDescendant(candidateId, targetId) {
    let curr = candidateId;
    const visited = new Set();
    while (curr !== null) {
      if (curr === targetId) return true;
      if (visited.has(curr)) break;
      visited.add(curr);
      if (!byId.has(curr)) break;
      curr = byId.get(curr).parentId;
    }
    return false;
  }

  const sortedCandidates = [...catalog.pages].sort(deterministicSort);

  for (const page of sortedCandidates) {
    if (page.id === currentId) continue; // cannot be parent of self
    if (currentId && isDescendant(page.id, currentId)) continue; // avoid cycle locally

    const opt = document.createElement('option');
    opt.value = page.id;
    opt.textContent = `${page.title || '(Untitled)'} (${page.id})`;
    if (page.id === selectedParentId) {
      opt.selected = true;
    }
    parentSelect.appendChild(opt);
  }

  parentSelect.value = selectedParentId || '';
}

// --- Render Editor Area ---
function renderEditorArea(readResult, catalog) {
  if (!readResult || !readResult.page) {
    renderEmptyEditor();
    return;
  }

  const page = readResult.page;
  const baseline = extractNativeBaseline(readResult);
  const buffer = getOrCreateBuffer(page.id, page, baseline);

  // Active typing buffers survive subscription refresh; no notification overwrites dirty text/metadata
  if (!buffer.dirty) {
    titleInput.value = page.title || '';
    orderInput.value = typeof page.order === 'number' ? page.order : 0;
    editorTextarea.value = page.markdown || '';
    buffer.title = titleInput.value;
    buffer.parentId = page.parentId || null;
    buffer.order = parseInt(orderInput.value, 10) || 0;
    buffer.markdown = editorTextarea.value;
    buffer.nativeBaseline = baseline || buffer.nativeBaseline;
  }

  // A returning dirty page renders its own captured input, never another page's DOM.
  if (buffer.dirty && renderedPageId !== page.id) {
    titleInput.value = buffer.title;
    orderInput.value = buffer.order;
    editorTextarea.value = buffer.markdown;
  }
  renderedPageId = page.id;
  populateParentSelect(catalog, page.id, buffer.parentId);

  // Metadata tags
  metaPageIdEl.textContent = `ID: ${page.id}`;
  metaEditIdEl.textContent = `Edit ID: ${page.editId || '(none)'}`;
  metaGenerationEl.textContent = `Input Gen: ${buffer.generation}`;

  if (readResult.view && readResult.view.journal) {
    metaDurabilityEl.textContent = `Durability: Journal draft (seq ${readResult.view.journal.seq}, ${readResult.view.journal.state})`;
  } else if (readResult.baseline) {
    metaDurabilityEl.textContent = 'Durability: Committed page (Dexie pages)';
  } else {
    metaDurabilityEl.textContent = 'Durability: Local store';
  }

  // Any dirty buffer invalidates displayed cloud-verified even if old record verified
  const effectiveCloudVerified = !buffer.dirty && !!readResult.cloudVerified;
  if (effectiveCloudVerified) {
    metaVerifiedEl.textContent = 'Cloud Verified: YES';
    metaVerifiedEl.style.color = 'var(--success-text)';
  } else if (buffer.dirty) {
    metaVerifiedEl.textContent = 'Cloud Verified: NO (dirty local buffer)';
    metaVerifiedEl.style.color = 'var(--warn-text)';
  } else {
    metaVerifiedEl.textContent = 'Cloud Verified: NO';
    metaVerifiedEl.style.color = 'var(--text-muted)';
  }

  // Conflict / Resolution Section
  const view = readResult.view;
  const needsResolution = view && (view.status === 'needs-resolution' || (view.journal && view.journal.state === 'needs-resolution') || view.warning);

  if (needsResolution) {
    conflictSection.style.display = 'flex';
    conflictWarningEl.textContent = 'This page has diverged or requires explicit resolution. Merges require full serialized JSON envelope.';

    conflictLocalPreview.textContent = view.journal && view.journal.draft ? view.journal.draft.body : (view.local || '(none)');
    conflictCloudPreview.textContent = view.journal && view.journal.remote ? view.journal.remote.body : (view.cloud || '(none)');

    // Pre-fill merge editor template if empty or previous
    if (!mergeEditor.value.trim() || mergeEditor.dataset.forPage !== page.id) {
      const template = {
        format: 'innosage-workspace-page',
        version: 1,
        workspaceId: workspace,
        id: page.id,
        title: buffer.title || page.title,
        parentId: buffer.parentId,
        order: buffer.order,
        markdown: buffer.markdown
      };
      mergeEditor.value = JSON.stringify(template, null, 2);
      mergeEditor.dataset.forPage = page.id;
    }
  } else {
    conflictSection.style.display = 'none';
    mergePanel.style.display = 'none';
  }
}

function renderEmptyEditor() {
  titleInput.value = '';
  parentSelect.textContent = '';
  const opt = document.createElement('option');
  opt.value = '';
  opt.textContent = '(No page selected)';
  parentSelect.appendChild(opt);
  orderInput.value = 0;
  editorTextarea.value = '';

  metaPageIdEl.textContent = 'ID: -';
  metaEditIdEl.textContent = 'Edit ID: -';
  metaGenerationEl.textContent = 'Input Gen: 0';
  metaDurabilityEl.textContent = 'Durability: -';
  metaVerifiedEl.textContent = 'Cloud Verified: -';

  conflictSection.style.display = 'none';
  mergePanel.style.display = 'none';
}

// --- Destination Handoff Display ---
async function renderHandoff() {
  if (!controller) return;
  try {
    const handoff = await controller.handoff();
    handoffDetailsEl.textContent = '';

    const statusRow = document.createElement('div');
    statusRow.className = 'handoff-status-row';

    const completeBadge = document.createElement('span');
    completeBadge.className = 'badge-incomplete';
    completeBadge.setAttribute('data-testid', 'handoff-complete');
    completeBadge.textContent = handoff.complete ? 'COMPLETE' : 'INCOMPLETE (DESTINATION UNVERIFIED)';
    statusRow.appendChild(completeBadge);

    const healthyBadge = document.createElement('span');
    healthyBadge.className = handoff.healthy ? 'badge-healthy' : 'badge-unhealthy';
    healthyBadge.textContent = handoff.healthy ? 'Workspace Healthy' : 'Tree Issues / Unresolved Drafts Present';
    statusRow.appendChild(healthyBadge);

    handoffDetailsEl.appendChild(statusRow);

    const reasonPara = document.createElement('p');
    reasonPara.className = 'handoff-reason';
    reasonPara.textContent = handoff.reason || 'Always incomplete: destination must independently read matching full records/tree.';
    handoffDetailsEl.appendChild(reasonPara);

    const table = document.createElement('table');
    table.className = 'handoff-table';
    table.setAttribute('data-testid', 'handoff-generations');

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    for (const heading of ['Page ID', 'Edit ID (Generation)', 'Destination / Cloud Verified']) {
      const th = document.createElement('th');
      th.textContent = heading;
      trHead.appendChild(th);
    }
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const gen of handoff.generations || []) {
      const tr = document.createElement('tr');

      const tdId = document.createElement('td');
      tdId.textContent = gen.id;
      tr.appendChild(tdId);

      const tdEdit = document.createElement('td');
      tdEdit.textContent = gen.editId || '(none)';
      tr.appendChild(tdEdit);

      const tdVer = document.createElement('td');
      const buf = pageBuffers.get(gen.id);
      const isDirty = buf && buf.dirty;
      const verText = (!isDirty && gen.cloudVerified) ? 'Verified' : (isDirty ? 'Unverified (dirty local buffer)' : 'Not verified');
      tdVer.textContent = verText;
      tr.appendChild(tdVer);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    handoffDetailsEl.appendChild(table);
  } catch (err) {
    handoffDetailsEl.textContent = 'Handoff check error: ' + err.message;
  }
}

// --- Raw Journals & Recovery Panel ---
function renderRecoveryPanel(catalog, readResult) {
  recoveryContentEl.textContent = '';

  const notice = document.createElement('div');
  notice.className = 'notice-box warn';
  notice.textContent = '⚠️ Existing pending journals do not imply cloud success. Destination verification requires independent read.';
  recoveryContentEl.appendChild(notice);

  // Current generation section
  const currentCard = document.createElement('div');
  currentCard.className = 'recovery-card';

  const cardTitle = document.createElement('h4');
  cardTitle.textContent = `Current Generation Details (Page: ${selectedPageId || 'none'})`;
  currentCard.appendChild(cardTitle);

  const buf = selectedPageId ? pageBuffers.get(selectedPageId) : null;
  const genDetails = [
    `Selected Page: ${selectedPageId || 'none'}`,
    `In-Memory Input Generation: ${buf ? buf.generation : 0}`,
    `Buffer Dirty: ${buf ? (buf.dirty ? 'true (unsaved edits in memory)' : 'false') : 'none'}`,
    `Page Edit ID: ${readResult && readResult.page ? readResult.page.editId : 'none'}`,
    `Baseline Edit ID: ${buf && buf.nativeBaseline ? buf.nativeBaseline.editId : (readResult && readResult.baseline ? readResult.baseline.editId : 'none')}`,
    `Cloud Verified: ${(!buf || !buf.dirty) && readResult && readResult.cloudVerified ? 'true' : 'false'}`
  ];

  for (const line of genDetails) {
    const p = document.createElement('div');
    p.textContent = line;
    currentCard.appendChild(p);
  }
  recoveryContentEl.appendChild(currentCard);

  // Raw Journal Details for Current Page
  if (readResult && readResult.view && readResult.view.journal) {
    const journalCard = document.createElement('div');
    journalCard.className = 'recovery-card';
    const jTitle = document.createElement('h4');
    jTitle.textContent = `Active Journal Metadata (${readResult.view.journal.id})`;
    journalCard.appendChild(jTitle);

    const pre = document.createElement('pre');
    pre.className = 'recovery-pre';
    pre.textContent = JSON.stringify(readResult.view.journal, null, 2);
    journalCard.appendChild(pre);

    recoveryContentEl.appendChild(journalCard);
  }

  // All Peer Drafts
  if (readResult && readResult.view && readResult.view.drafts && readResult.view.drafts.length > 0) {
    const draftsCard = document.createElement('div');
    draftsCard.className = 'recovery-card';
    const dTitle = document.createElement('h4');
    dTitle.textContent = `All Peer Drafts for Current Page (${readResult.view.drafts.length})`;
    draftsCard.appendChild(dTitle);

    const pre = document.createElement('pre');
    pre.className = 'recovery-pre';
    pre.textContent = JSON.stringify(readResult.view.drafts, null, 2);
    draftsCard.appendChild(pre);

    recoveryContentEl.appendChild(draftsCard);
  }

  // All Decoded Pages in Catalog
  if (catalog && catalog.pages) {
    const catalogCard = document.createElement('div');
    catalogCard.className = 'recovery-card';
    const cTitle = document.createElement('h4');
    cTitle.textContent = `All Catalog Envelopes (${catalog.pages.length})`;
    catalogCard.appendChild(cTitle);

    const pre = document.createElement('pre');
    pre.className = 'recovery-pre';
    pre.textContent = JSON.stringify(catalog.pages, null, 2);
    catalogCard.appendChild(pre);

    recoveryContentEl.appendChild(catalogCard);
  }
}

// --- Schedule Monotonic Refresh ---
async function scheduleRefresh(pageIdToSelect) {
  const ticket = ++refreshTicket;
  try {
    const catalog = await controller.catalog();
    if (ticket !== refreshTicket) return null; // Stale ticket

    currentCatalog = catalog;

    let nextPageId = pageIdToSelect ?? selectedPageId;
    if (!nextPageId || !catalog.pages.some(page => page.id === nextPageId))
      nextPageId = catalog.pages[0]?.id ?? null;
    let readResult = null;
    if (nextPageId) {
      try { readResult = await controller.read(nextPageId); }
      catch (error) { console.warn('Read error for', nextPageId, error); }
    }
    if (ticket !== refreshTicket) return null;
    // Until data is ready, inputs still belong to the old selected page. New
    // input while loading cancels navigation; identity/DOM switch together.
    if (nextPageId !== selectedPageId && pageBuffers.get(selectedPageId)?.dirty) {
      renderTree(catalog);
      setStatus('Input changed while loading the next page; save before switching.', false);
      return null;
    }
    selectedPageId = nextPageId;

    currentRead = readResult;
    currentView = readResult ? readResult.view : null;

    if (currentView && currentView.operation) {
      activeOperation = currentView.operation;
      renderOperationStatus();
      if (activeOperation.pending) {
        startOperationTimer();
      } else {
        stopOperationTimer();
      }
    }

    renderTree(catalog);
    if (selectedPageId && readResult) {
      renderEditorArea(readResult, catalog);
    } else {
      renderEmptyEditor();
    }

    await renderHandoff();
    if (ticket !== refreshTicket) return null;

    renderRecoveryPanel(catalog, readResult);
    updateWriterControls();
    return {ticket, pageId:selectedPageId, readResult};
  } catch (err) {
    if (ticket !== refreshTicket) return null;
    setStatus(`Refresh error: ${err.message}`, true);
    return null;
  }
}

// --- Local Save Action ---
async function saveCurrentPageLocally() {
  if (!selectedPageId) return;
  if (!store || !store.writer) {
    throw new Error('Writer disabled: session already owned or safe ownership unavailable');
  }

  const savingPageId = selectedPageId;
  const buffer = pageBuffers.get(savingPageId);
  if (!buffer) return;

  if (!buffer.nativeBaseline) {
    throw new Error('An explicit edit baseline is required for saving');
  }

  buffer.saveAttempt++;
  const savingGen = buffer.generation;
  const patch = {
    title: buffer.title,
    parentId: buffer.parentId,
    order: buffer.order,
    markdown: buffer.markdown
  };

  setStatus(`[Page: ${selectedPageId} | Gen: ${savingGen}] Saving locally...`, false);

  // Local commit only; no cloud operation awaits in save/navigation
  const saveResult = await controller.save(savingPageId, patch, buffer.nativeBaseline);
  foreground?.saved();

  // Pending save completion only clears matching generation
  if (buffer.generation === savingGen) {
    buffer.dirty = false;
    buffer.nativeBaseline = extractNativeBaseline(saveResult) || buffer.nativeBaseline;
    setStatus(`[Page: ${selectedPageId} | Gen: ${savingGen}] Locally saved (durable in Dexie)`, false);
  } else {
    // Newer edits occurred during save
    buffer.nativeBaseline = extractNativeBaseline(saveResult) || buffer.nativeBaseline;
    setStatus(`[Page: ${selectedPageId} | Gen: ${buffer.generation}] Saved gen ${savingGen}; newer edits pending`, false);
  }

  await scheduleRefresh();
  return saveResult;
}

// --- Page Selection & Navigation ---
async function selectPage(targetId) {
  if (targetId === selectedPageId) return;

  // Save on page switch must await local commit before navigation
  if (selectedPageId && pageBuffers.has(selectedPageId)) {
    const currentBuf = pageBuffers.get(selectedPageId);
    if (currentBuf.dirty) {
      try {
        await saveCurrentPageLocally();
        if (currentBuf.dirty) {
          setStatus('Newer input is still unsaved; remain here and save before switching.', false);
          return;
        }
      } catch (err) {
        // Failed save stays selected preserves input; never clear on failure
        setStatus(`[Page: ${selectedPageId} | Gen: ${currentBuf.generation}] Save failed before navigation: ${err.message}`, true);
        return; // Abort navigation!
      }
    }
  }

  await scheduleRefresh(targetId);
}

// --- Event Listeners for Typing Buffers ---
titleInput.addEventListener('input', () => {
  if (!selectedPageId) return;
  const buffer = getOrCreateBuffer(selectedPageId);
  buffer.title = titleInput.value;
  buffer.generation++;
  buffer.dirty = true;
  metaGenerationEl.textContent = `Input Gen: ${buffer.generation}`;
  metaVerifiedEl.textContent = 'Cloud Verified: NO (dirty local buffer)';
  metaVerifiedEl.style.color = 'var(--warn-text)';
  setStatus(`[Page: ${selectedPageId} | Gen: ${buffer.generation}] Unsaved changes`, false);
});

parentSelect.addEventListener('change', () => {
  if (!selectedPageId) return;
  const buffer = getOrCreateBuffer(selectedPageId);
  const val = parentSelect.value.trim();
  buffer.parentId = val ? val : null;
  buffer.generation++;
  buffer.dirty = true;
  metaGenerationEl.textContent = `Input Gen: ${buffer.generation}`;
  metaVerifiedEl.textContent = 'Cloud Verified: NO (dirty local buffer)';
  metaVerifiedEl.style.color = 'var(--warn-text)';
  setStatus(`[Page: ${selectedPageId} | Gen: ${buffer.generation}] Unsaved reparenting`, false);
});

orderInput.addEventListener('input', () => {
  if (!selectedPageId) return;
  const buffer = getOrCreateBuffer(selectedPageId);
  const parsed = parseInt(orderInput.value, 10);
  buffer.order = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  buffer.generation++;
  buffer.dirty = true;
  metaGenerationEl.textContent = `Input Gen: ${buffer.generation}`;
  metaVerifiedEl.textContent = 'Cloud Verified: NO (dirty local buffer)';
  metaVerifiedEl.style.color = 'var(--warn-text)';
  setStatus(`[Page: ${selectedPageId} | Gen: ${buffer.generation}] Unsaved order change`, false);
});

editorTextarea.addEventListener('input', () => {
  if (!selectedPageId) return;
  const buffer = getOrCreateBuffer(selectedPageId);
  buffer.markdown = editorTextarea.value;
  buffer.generation++;
  buffer.dirty = true;
  metaGenerationEl.textContent = `Input Gen: ${buffer.generation}`;
  metaVerifiedEl.textContent = 'Cloud Verified: NO (dirty local buffer)';
  metaVerifiedEl.style.color = 'var(--warn-text)';
  setStatus(`[Page: ${selectedPageId} | Gen: ${buffer.generation}] Unsaved markdown edits`, false);
});

// --- Action Handlers ---
saveBtn.addEventListener('click', async () => {
  try {
    await saveCurrentPageLocally();
  } catch (err) {
    const gen = (selectedPageId && pageBuffers.get(selectedPageId)) ? pageBuffers.get(selectedPageId).generation : 0;
    setStatus(`[Page: ${selectedPageId} | Gen: ${gen}] Save failed: ${err.message}`, true);
  }
});

newRootBtn.addEventListener('click', async () => {
  if (!store || !store.writer) return;
  try {
    setStatus('Creating new root page...', false);
    const result = await controller.create({
      title: 'New Project',
      parentId: null,
      order: 0,
      markdown: '# New Project\n\n- Scope\n'
    });
    foreground?.saved();
    await selectPage(result.page.id);
    setStatus(`[Page: ${result.page.id} | Gen: 0] Created new root page`, false);
  } catch (err) {
    setStatus(`Create root failed: ${err.message}`, true);
  }
});

newChildBtn.addEventListener('click', async () => {
  if (!store || !store.writer) return;
  try {
    const parentId = selectedPageId || null;
    setStatus(`Creating new child under ${parentId || 'root'}...`, false);
    const result = await controller.create({
      title: 'New Child Page',
      parentId: parentId,
      order: 0,
      markdown: '# New Child Page\n\nNotes...\n'
    });
    foreground?.saved();
    if (parentId) collapsedNodes.delete(parentId);
    await selectPage(result.page.id);
    setStatus(`[Page: ${result.page.id} | Gen: 0] Created child under ${parentId || 'root'}`, false);
  } catch (err) {
    setStatus(`Create child failed: ${err.message}`, true);
  }
});

// Bind all late completions to the page/buffer generation captured at click.
async function cloudAction(kind, action, foregroundOwner = null) {
  if (cloudActionBusy || (foreground?.flight && foregroundOwner !== foreground) || store?.operation?.pending) {
    if (foregroundOwner) throw new Error('Another cloud action is running');
    return;
  }
  cloudActionBusy = true;
  const actionStartedAt = performance.now();
  activeOperation = {kind, pending:true, startedAt:performance.now()};
  updateWriterControls(); startOperationTimer(); renderOperationStatus();
  try { return await action(); }
  catch (error) { foreground?.halt(); throw error; }
  finally {
    cloudActionBusy = false;
    activeOperation = store?.operation ?? {...activeOperation, pending:false, elapsedMs:performance.now()-actionStartedAt};
    stopOperationTimer(); renderOperationStatus(); updateWriterControls();
    wakeForeground();
  }
}
function captureInput() {
  const id = selectedPageId, buffer = pageBuffers.get(id);
  return {id, buffer, generation:buffer?.generation, saveAttempt:buffer?.saveAttempt};
}
function unchanged(input) {
  return pageBuffers.get(input.id) === input.buffer && input.buffer?.generation === input.generation && input.buffer?.saveAttempt === input.saveAttempt;
}
syncBtn.addEventListener('click', () => cloudAction('sync', async () => {
  try { setStatus('Sync started; local editing remains available.', false); await controller.sync(); await scheduleRefresh(); setStatus('Sync finished; verification and destination observation remain separate.', false); }
  catch (error) { foreground?.halt(); setStatus(`Sync failed: ${error.message}`, true); }
}));
verifyBtn.addEventListener('click', () => cloudAction('verify', async () => {
  const input = captureInput();
  if (!input.id) return;
  if (input.buffer?.dirty) { setStatus('Save current input locally before verifying it.', false); return; }
  try {
    const result = await controller.verify(input.id);
    const refresh = await scheduleRefresh();
    const latest = refresh?.readResult;
    if (refresh?.ticket === refreshTicket && refresh?.pageId === input.id && selectedPageId === input.id && unchanged(input) && !input.buffer?.dirty && result?.cloudVerified && latest?.cloudVerified &&
        latest.baseline?.id === result.baseline?.id && latest.baseline?.editId === result.baseline?.editId && latest.baseline?.body === result.baseline?.body && latest.page?.editId === result.page?.editId)
      setStatus(`[Page: ${input.id} | Gen: ${input.generation}] Exact saved generation cloud verified. Destination observation remains incomplete.`, false);
    else setStatus(`[Page: ${input.id}] Older saved-generation verification finished; current input is not confirmed by this completion.`, false);
  } catch (error) { foreground?.halt(); setStatus(`[Page: ${input.id}] Verify failed: ${error.message}`, true); }
}));
async function resolveInput(action, merged) {
  const input = captureInput(); if (!input.id || !store?.writer) return;
  try {
    if (action === 'local' && input.buffer?.dirty) await saveCurrentPageLocally();
    await controller.resolve(input.id, action, merged);
    if (action !== 'cloud') foreground?.saved();
    if (action !== 'local' && unchanged(input)) pageBuffers.delete(input.id);
    await scheduleRefresh();
    setStatus(`[Page: ${input.id}] Resolution finished; newer input, if present, remains unsaved and preserved.`, false);
  } catch (error) { foreground?.halt(); setStatus(`[Page: ${input.id}] Resolution failed: ${error.message}`, true); }
}
useCloudBtn.addEventListener('click', () => cloudAction('resolve-cloud', () => resolveInput('cloud')));
keepLocalBtn.addEventListener('click', () => cloudAction('resolve-local', () => resolveInput('local')));
toggleMergeBtn.addEventListener('click', () => {
  mergePanel.style.display = mergePanel.style.display === 'none' ? 'flex' : 'none';
});
commitMergeBtn.addEventListener('click', () => cloudAction('resolve-merge', async () => {
  const merged = mergeEditor.value;
  try { JSON.parse(merged); } catch (error) { setStatus(`Invalid complete merge envelope: ${error.message}`, true); return; }
  await resolveInput('merge', merged);
}));

refreshHandoffBtn.addEventListener('click', async () => {
  await renderHandoff();
});

foregroundStartBtn.addEventListener('click', async () => {
  if (foreground || !controller || !store?.writer || cloudActionBusy || store.operation?.pending) return;
  foreground = new ForegroundRun({store, sync:()=>cloudAction('foreground-sync', async () => {
    await controller.sync(); await scheduleRefresh();
  }, foreground)}, {
    authorized:()=>!!providerInfo?.canSync(), visible:()=>document.visibilityState === 'visible',
    online:()=>navigator.onLine, busy:()=>cloudActionBusy, changed:renderForeground
  });
  renderForeground();
  try {
    // Existing journal entries are already durable. Starting never saves typing.
    const catalog = await controller.catalog();
    if (catalog.pendingCount) foreground.saved();
  } catch (error) { foreground.stop(); setStatus(`Foreground run stopped: ${error.message}`, true); }
});
foregroundStopBtn.addEventListener('click', () => foreground?.stop());
document.addEventListener('visibilitychange', wakeForeground);
window.addEventListener('online', wakeForeground);
window.addEventListener('offline', wakeForeground);
window.addEventListener('pagehide', () => foreground?.stop());

// --- Initialization ---
async function init() {
  try {
    setStatus('Initializing PageStore Dexie DB...', false);
    store = await openPageStore({ workspace, session });

    // Enforce explicitSync BEFORE optional connect
    store.explicitSync = true;

    if (validEndpoint && document.getElementById('offline-badge').textContent.includes('OFFLINE')) {
      try {
        setStatus(`Connecting to mock endpoint: ${validEndpoint}...`, false);
        await store.connect(validEndpoint, { live: true, autoStart: false });
      } catch (connErr) {
        console.warn('Initial mock connect failed:', connErr);
        setStatus(`Initial connect warning: ${connErr.message}`, true);
      }
    }

    const provider = await configureProvider(store, {changed:wakeForeground});
    providerInfo = provider;
    controller = new Workspace(store);

    // Permitted only loopback offline prototype without credentials
    if (!provider.real) window.workspaceDemo = {workspace:controller,store,ready:true};
    else {window.workspaceRealReady = true;window.workspaceRealSnapshot = async()=>({catalog:await controller.catalog(),current:selectedPageId?await controller.read(selectedPageId):null});}
    void prepareOfflineShell({base:'/',bundlePath:'/app.mjs'}).then(result=>{if(window.workspaceDemo)window.workspaceDemo.offlineShell=result;});

    updateWriterControls();

    // Controller invalidation subscription with monotonic refresh ticket
    controller.subscribe(() => {
      scheduleRefresh();
    });

    await scheduleRefresh();
    setStatus(provider.real?'Real Drive candidate ready; local editing works before existing-account reauthorization.':'Workspace prototype ready (offline/native mock)', false);
  } catch (err) {
    console.error('Initialization error:', err);
    setStatus(`Fatal initialization error: ${err.message}`, true);
  }
}

// Start application
init();

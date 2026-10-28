import {PREFIX, encode, decode, treeIssues, makePage} from './envelope.mjs';

/** Projection/controller only; native PageStore remains the sole sync owner. */
export class Workspace {
  constructor(store) {
    this.store = store;
    this.queue = Promise.resolve();
    this.listeners = new Set();
    this.discovery = 'local-only';
    this.observed = new Map();
    // Validate the exact independently read candidate inside the native
    // sequence/CAS discard boundary, before any protected journal is removed.
    this.previousHook = store.hook;
    this.guardedHook = async (name, row, context) => {
      if (name === 'before-cloud-discard' && row.page.startsWith(PREFIX)) {
        const selected = decode(context?.remote, store.workspace);
        if (selected.id !== row.page) throw new Error('Cloud choice target identity mismatch');
        const catalog = await this.catalog();
        const candidate = catalog.pages.filter(page => page.id !== selected.id);
        candidate.push(selected);
        if (catalog.invalid.some(record => record.id !== selected.id) || treeIssues(candidate).length)
          throw new Error('Cloud choice has invalid/incomplete tree; protected local intent retained');
      }
      return this.previousHook(name, row, context);
    };
    store.hook = this.guardedHook;
    this.subscriptions = [store.db.pages.$, store.db.localDrafts.$].map(stream => stream.subscribe(() => {
      for (const listener of this.listeners) listener();
    }));
  }
  serial(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async catalog() {
    const records = await this.store.db.pages.find().exec();
    const journals = await this.store.db.localDrafts.find().exec();
    const selected = new Map(records.filter(row => row.id.startsWith(PREFIX)).map(row => [row.id, row.toJSON()]));
    // Retain orphaned journal-only pages after a failed second local write.
    for (const row of journals) if (row.page.startsWith(PREFIX) && row.session === this.store.session) selected.set(row.page, row.draft);
    const pages = [], issues = [], invalid = [];
    for (const [id, row] of selected) {
      try { pages.push(decode(row, this.store.workspace)); } catch {
        issues.push(`invalid-envelope:${id}`);
        invalid.push({id, record: JSON.parse(JSON.stringify(row)), journals: journals.filter(d => d.page === id).map(d => d.toJSON())});
      }
    }
    issues.push(...treeIssues(pages));
    const pending = journals.filter(row => row.page.startsWith(PREFIX));
    const unresolved = pending.filter(row => row.state === 'needs-resolution');
    return {pages, issues, invalid, pendingIds: [...new Set(pending.map(row => row.page))], knownCount: selected.size, discovery: this.discovery,
      // Never announce a remote total, including after sync: local changes can
      // coexist with incomplete initial inventory and another device's updates.
      countLabel: `${selected.size} locally known pages (${invalid.length} unreadable); remote total unknown`,
      pendingCount: pending.length, unresolvedCount: unresolved.length,
      healthy: issues.length === 0 && unresolved.length === 0};
  }
  async read(id) {
    if (!id.startsWith(PREFIX)) throw new Error('Outside workspace prototype namespace');
    const view = await this.store.view(id);
    const record = view.journal?.draft ?? view.page;
    return {page: record ? decode(record, this.store.workspace) : null, baseline: view.page, view,
      // Per-record full generation equality only, never global PageStore.state.
      cloudVerified: !!record && view.drafts.length === 0 && !view.journal && this.store.verified.has(id) &&
        this.store.verified.get(id).body === record.body && this.store.verified.get(id).editId === record.editId,
      destinationObserved: !!record && this.observed.get(id) === record.editId};
  }
  create(options) {
    return this.serial(async () => {
      const page = makePage({...options, workspaceId: this.store.workspace});
      const catalog = await this.catalog();
      if (catalog.pages.some(other => other.id === page.id)) throw new Error('Page already exists');
      if (!catalog.healthy || treeIssues([...catalog.pages, page]).length) throw new Error('Invalid or unresolved tree; create refused');
      const view = await this.store.save(page.id, encode(page), {base: null});
      return {page: decode(view.journal.draft, this.store.workspace), baseline: view.page, view};
    });
  }
  save(id, patch, baseline) {
    return this.serial(async () => {
      if (!baseline) throw new Error('An explicit edit baseline is required');
      const current = await this.read(id);
      const source = decode(current.view.journal?.draft ?? baseline, this.store.workspace);
      // Patch the captured edit baseline, never silently rebase a dirty editor.
      const page = makePage({...source, ...patch, id});
      const catalog = await this.catalog();
      const candidate = catalog.pages.map(other => other.id === id ? page : other);
      const structuralChange = page.parentId !== current.page.parentId || page.order !== current.page.order;
      if (structuralChange && treeIssues(candidate).length)
        throw new Error('Invalid tree change; full draft retained by editor');
      if (!current.page) throw new Error('Page unavailable');
      const view = await this.store.save(id, encode(page), {base: baseline});
      this.observed.delete(id);
      return {page: decode(view.journal.draft, this.store.workspace), baseline: view.page, view};
    });
  }
  async sync() {
    this.discovery = 'synchronizing; remote total unknown';
    try { await this.store.sync(); this.discovery = 'last explicit sync completed; remote total unknown'; }
    catch (error) { this.discovery = 'incomplete/error; remote total unknown'; throw error; }
    return this.catalog();
  }
  async verify(id) {
    await this.store.verify(id);
    const result = await this.read(id);
    const catalog = await this.catalog();
    if (!catalog.healthy) throw new Error('Tree unresolved; no workspace confirmation');
    if (!result.cloudVerified) throw new Error('Current generation not independently verified');
    return result;
  }
  async resolve(id, action, mergedEnvelope) {
    if (action === 'merge') {
      const parsed = decode({id, body: mergedEnvelope}, this.store.workspace);
      const catalog = await this.catalog();
      if (treeIssues(catalog.pages.map(page => page.id === id ? parsed : page)).length) throw new Error('Merged tree invalid');
    }
    await this.store.resolve(id, action, mergedEnvelope);
    this.observed.delete(id);
    // Incoming cloud choice can expose broken links; report, never repair
    // implicitly or assert a multi-record transaction.
    return {record: await this.read(id), catalog: await this.catalog()};
  }
  async handoff() {
    const catalog = await this.catalog();
    const pending = new Set(catalog.pendingIds);
    const generations = catalog.pages.map(page => {
      const {editId, ...envelope} = page;
      const verified = this.store.verified.get(page.id);
      return {id: page.id, editId, cloudVerified: !pending.has(page.id) &&
        verified?.editId === editId && verified?.body === encode(envelope)};
    });
    return {complete: false, reason: 'Destination must independently read every matching full record and tree; no destination receipt supplied',
      healthy: catalog.healthy, generations};
  }
  close() {
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    if (this.store.hook === this.guardedHook) this.store.hook = this.previousHook;
  }
}

/** Isolated #142 wire format. Native PageStore protects these exact bytes. */
export const FORMAT = 'innosage-workspace-page';
export const PREFIX = 'w142_';
const keys = ['format', 'version', 'workspaceId', 'id', 'title', 'parentId', 'order', 'markdown'];
export function validate(page) {
  if (!page || Object.keys(page).sort().join() !== [...keys].sort().join() ||
      page.format !== FORMAT || page.version !== 1 ||
      typeof page.workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,90}$/.test(page.workspaceId) ||
      !/^w142_[a-zA-Z0-9_-]{1,70}$/.test(page.id) ||
      typeof page.title !== 'string' || !page.title.trim() || page.title.length > 200 ||
      !(page.parentId === null || /^w142_[a-zA-Z0-9_-]{1,70}$/.test(page.parentId)) ||
      !Number.isSafeInteger(page.order) || page.order < 0 ||
      typeof page.markdown !== 'string') throw new Error('Invalid workspace page envelope');
  return page;
}
export function encode(page) {
  validate(page);
  const body = JSON.stringify(Object.fromEntries(keys.map(key => [key, page[key]])));
  if (body.length > 256 * 1024) throw new Error('Protected page envelope limit exceeded');
  return body;
}
export function decode(record, workspaceId) {
  const page = validate(JSON.parse(record.body));
  if ((workspaceId && page.workspaceId !== workspaceId) || page.id !== record.id) throw new Error('Envelope/native identity mismatch');
  return { ...page, editId: record.editId };
}
export function treeIssues(pages) {
  const byId = new Map(pages.map(page => [page.id, page]));
  const issues = [];
  if (byId.size !== pages.length) issues.push('duplicate-id');
  for (const page of pages) {
    const seen = new Set([page.id]);
    let parent = page.parentId;
    while (parent !== null) {
      if (seen.has(parent)) { issues.push(`cycle:${page.id}`); break; }
      seen.add(parent);
      if (!byId.has(parent)) { issues.push(`orphan:${page.id}`); break; }
      parent = byId.get(parent).parentId;
    }
  }
  return issues;
}
export function makePage({workspaceId, id = PREFIX + crypto.randomUUID(), title = 'Untitled', parentId = null, order = 0, markdown = ''} = {}) {
  return validate({format: FORMAT, version: 1, workspaceId, id, title, parentId, order, markdown});
}

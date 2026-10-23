// Complete immutable revisions. No clock, listing cursor, or replica arrival order
// participates in identity or conflict resolution.
export const NAMESPACE = "byos-remediation-v1";
export const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
export async function hash(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
const id = (v) => typeof v === "string" && /^[a-zA-Z0-9:_-]{1,160}$/.test(v);
const exactKeys = (o, keys) =>
  o &&
  typeof o === "object" &&
  !Array.isArray(o) &&
  Object.keys(o).sort().join() === keys.sort().join();
export function validateShape(r) {
  if (
    !exactKeys(r, [
      "revisionId",
      "pageId",
      "incarnation",
      "parents",
      "supersedes",
      "kind",
      "body",
      "metadata",
      "parent",
      "hash",
    ]) ||
    ![r.revisionId, r.pageId, r.incarnation].every(id) ||
    !["put", "delete"].includes(r.kind) ||
    typeof r.body !== "string" ||
    !exactKeys(r.metadata, ["title", "updatedAt"]) ||
    typeof r.metadata.title !== "string" ||
    !Number.isSafeInteger(r.metadata.updatedAt) ||
    ![r.parents, r.supersedes].every(
      (a) => Array.isArray(a) && a.every(id) && new Set(a).size === a.length,
    ) ||
    r.parents.includes(r.revisionId) ||
    r.supersedes.includes(r.incarnation) ||
    !(
      r.parent === null ||
      (exactKeys(r.parent, ["pageId", "incarnation"]) &&
        id(r.parent.pageId) &&
        id(r.parent.incarnation))
    ) ||
    !/^[a-f0-9]{64}$/.test(r.hash)
  )
    throw new Error("INTEGRITY: invalid revision schema");
}
export async function revision({
  revisionId = crypto.randomUUID(),
  pageId,
  incarnation = "initial",
  parents = [],
  supersedes = [],
  kind = "put",
  body = "",
  metadata = { title: pageId, updatedAt: 0 },
  parent = null,
}) {
  const payload = {
    revisionId,
    pageId,
    incarnation,
    parents: [...parents].sort(),
    supersedes: [...supersedes].sort(),
    kind,
    body,
    metadata,
    parent,
  };
  const r = { ...payload, hash: await hash(payload) };
  validateShape(r);
  return r;
}
export async function validateRevisions(revisions, { complete = false } = {}) {
  if (!Array.isArray(revisions))
    throw new Error("INTEGRITY: revisions must be an array");
  const map = new Map();
  for (const r of revisions) {
    validateShape(r);
    const { hash: expected, ...payload } = r;
    if ((await hash(payload)) !== expected)
      throw new Error("INTEGRITY: payload hash mismatch");
    if (
      map.has(r.revisionId) &&
      canonical(map.get(r.revisionId)) !== canonical(r)
    )
      throw new Error("INTEGRITY: revision ID collision");
    map.set(r.revisionId, r);
  }
  const missing = new Set(),
    visiting = new Set(),
    visited = new Set();
  const visit = (r) => {
    if (visiting.has(r.revisionId)) throw new Error("INTEGRITY: causal cycle");
    if (visited.has(r.revisionId)) return;
    visiting.add(r.revisionId);
    for (const p of r.parents) {
      const parent = map.get(p);
      if (!parent) {
        missing.add(p);
        continue;
      }
      if (
        parent.pageId !== r.pageId ||
        (parent.incarnation !== r.incarnation &&
          !r.supersedes.includes(parent.incarnation))
      )
        throw new Error("INTEGRITY: invalid causal parent");
      visit(parent);
    }
    for (const old of r.supersedes) {
      if (
        !r.parents.some(
          (p) =>
            map.get(p)?.incarnation === old && map.get(p)?.kind === "delete",
        )
      )
        throw new Error(
          "INCOMPLETE: recreation must reference an old tombstone",
        );
    }
    visiting.delete(r.revisionId);
    visited.add(r.revisionId);
  };
  for (const r of map.values()) visit(r);
  if (complete && missing.size)
    throw new Error("INCOMPLETE: missing causal parents");
  return {
    revisions: [...map.values()].sort((a, b) =>
      a.revisionId.localeCompare(b.revisionId),
    ),
    missing: [...missing].sort(),
  };
}
export function project(revisions) {
  const pages = new Map(),
    known = new Set(revisions.map((r) => r.revisionId));
  for (const r of revisions) {
    if (!pages.has(r.pageId))
      pages.set(r.pageId, {
        pageId: r.pageId,
        revisions: [],
        incarnations: Object.create(null),
        incomplete: false,
      });
    const p = pages.get(r.pageId);
    p.revisions.push(r);
    p.incomplete ||= r.parents.some((id) => !known.has(id));
  }
  for (const p of pages.values()) {
    const superseded = new Set(p.revisions.flatMap((r) => r.supersedes));
    const referenced = new Set(p.revisions.flatMap((r) => r.parents));
    for (const r of p.revisions) {
      const group = (p.incarnations[r.incarnation] ??= {
        heads: [],
        superseded: superseded.has(r.incarnation),
      });
      if (!referenced.has(r.revisionId)) group.heads.push(r);
    }
    p.active = Object.entries(p.incarnations)
      .filter(([, g]) => !g.superseded)
      .map(([i]) => i)
      .sort();
    p.heads = p.active
      .flatMap((i) => p.incarnations[i].heads)
      .sort((a, b) => a.revisionId.localeCompare(b.revisionId));
    p.conflict = p.heads.length > 1;
    p.deleted = p.heads.some((r) => r.kind === "delete");
    p.suppressed = false;
  }
  // Delete wins visibility only. Full child and old-incarnation bodies remain in
  // revisions/heads for recovery. Parent cycles/missing parents are incomplete.
  const visit = (p, chain = new Set()) => {
    if (chain.has(p.pageId)) {
      p.incomplete = true;
      return false;
    }
    const next = new Set(chain).add(p.pageId);
    for (const r of p.heads)
      if (r.parent) {
        const parent = pages.get(r.parent.pageId);
        if (!parent) {
          p.incomplete = true;
          p.suppressed = true;
          continue;
        }
        if (
          !visit(parent, next) ||
          parent.deleted ||
          parent.suppressed ||
          !parent.active.includes(r.parent.incarnation)
        )
          p.suppressed = true;
      }
    return !p.incomplete;
  };
  for (const p of pages.values()) visit(p);
  return [...pages.values()].sort((a, b) => a.pageId.localeCompare(b.pageId));
}
export function snapshot(revisions) {
  return { namespace: NAMESPACE, format: 1, revisions };
}
export async function decodeSnapshot(value) {
  if (
    !exactKeys(value, ["namespace", "format", "revisions"]) ||
    value.namespace !== NAMESPACE ||
    value.format !== 1
  )
    throw new Error("INTEGRITY: unknown snapshot format or namespace");
  return (await validateRevisions(value.revisions, { complete: true }))
    .revisions;
}

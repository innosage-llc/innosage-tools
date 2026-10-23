export function fullVersions(value) {
  if (!value || typeof value !== "object") return [];
  const found =
    typeof value.body === "string" && Array.isArray(value.editIds)
      ? [value]
      : [];
  return found.concat(Object.values(value).flatMap(fullVersions));
}
export function intentOracle(expected, replicas, conflicts = []) {
  const unique = [...new Set(expected)];
  const holds = (pages, id) =>
    pages.some((p) => p.editIds?.includes(id) && p.body?.includes(id));
  const applied = unique.filter((id) =>
    replicas.every((pages) => holds(pages, id)),
  );
  const durable = unique.filter(
    (id) => !applied.includes(id) && holds(fullVersions(conflicts), id),
  );
  const pending = unique.filter(
    (id) =>
      !applied.includes(id) &&
      !durable.includes(id) &&
      replicas.some((pages) => holds(pages, id)),
  );
  const lost = unique.filter(
    (id) =>
      !applied.includes(id) && !durable.includes(id) && !pending.includes(id),
  );
  return {
    acknowledged_edit_count: unique.length,
    merged_or_applied_count: applied.length,
    durably_preserved_conflict_count: durable.length,
    durable_unpropagated_count: pending.length,
    silent_lost_edit_count: lost.length,
    intent_preservation_rate: unique.length
      ? (applied.length + durable.length) / unique.length
      : null,
    applied_ids: applied,
    durable_conflict_ids: durable,
    durable_unpropagated_ids: pending,
    lost_ids: lost,
  };
}
export const canonical = (pages) =>
  JSON.stringify(
    pages
      .map(({ id, parentId, body, editIds }) => ({
        id,
        parentId,
        body,
        editIds,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );

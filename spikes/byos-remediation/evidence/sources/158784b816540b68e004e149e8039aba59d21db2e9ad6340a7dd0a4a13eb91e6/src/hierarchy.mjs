import "fake-indexeddb/auto";
import { openStore } from "./store.mjs";
import { revision, canonical } from "./revisions.mjs";

// These two witnesses first run against the integrated foundation, then remain
// regression checks for visible recovery of full bodies hidden by deletion.
export async function hierarchyWitnesses() {
  const results = [];
  for (const scenario of ["parent-delete-single-head-child-edit", "recreate-stale-old-incarnation-edit"]) {
    const store = await openStore(`hierarchy${Date.now()}${results.length}`);
    try {
      const root = await revision({ revisionId: "root", pageId: "parent", body: "Parent full original" });
      const deletion = await revision({ revisionId: "deleted", pageId: "parent", parents: ["root"], kind: "delete", body: "Parent tombstone retains full original" });
      const child = await revision({ revisionId: "child", pageId: "child", parent: { pageId: "parent", incarnation: "initial" }, body: "Child original" });
      const edit = await revision(scenario.startsWith("parent-delete")
        ? { ...child, revisionId: "child-edit", parents: ["child"], body: "Acknowledged complete concurrent child edit" }
        : { ...root, revisionId: "stale-edit", parents: ["root"], body: "Acknowledged complete stale old-incarnation edit" });
      const recreated = await revision({ revisionId: "recreated", pageId: "parent", incarnation: "second", supersedes: ["initial"], parents: ["deleted"], body: "Explicit new incarnation" });
      await store.append(scenario.startsWith("parent-delete") ? [root, child, edit, deletion] : [root, deletion, recreated, edit]);
      const status = await store.status("offline"), records = await store.read();
      const bodiesRetained = records.some((r) => canonical(r) === canonical(edit));
      const recoveryExposed = status.projection.some((p) => p.recovery?.some((item) => canonical(item.revision) === canonical(edit)));
      results.push({ scenario, expected: { fullBodyRetained: true, visibleRecovery: true, local: "recovery-needed" }, observed: { fullBodyRetained: bodiesRetained, visibleRecovery: recoveryExposed, local: status.local }, acknowledged: edit, projection: status.projection, passed: bodiesRetained && recoveryExposed && status.local === "recovery-needed" });
    } finally { await store.close(); }
  }
  return { passed: results.every((r) => r.passed), results };
}

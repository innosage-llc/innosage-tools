import { sourceManifest } from "./manifest.mjs";
const source_manifest = await sourceManifest();
import { mock, CONTRACT } from "./mock.mjs";
import { replica, intercept } from "./candidates.mjs";
import { fixture, pins } from "./trial.mjs";
import { canonical, intentOracle } from "./oracle.mjs";
import { measure } from "./metrics.mjs";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
const results = [];
for (const [engine, provider] of [
  ["rxdb", "drive"],
  ["selfstore", "drive"],
  ["selfstore", "webdav"],
])
  for (const scenario of [
    "parent-child-stale-replay",
    "clock-skew-different-pages",
    "concurrent-reconnect",
    "repeated-sync-idempotence",
    "duplicate-response",
    "reordered-response",
    ...(engine === "rxdb" ? ["visibility-delay"] : []),
    ...(provider === "webdav" ? ["missing-etag"] : []),
  ]) {
    const m = await mock({ seed: 84, network: "normal" }),
      undo = intercept(m),
      suffix = randomUUID().replaceAll("-", "");
    let a, b;
    const r = {
      engine,
      ...pins[engine],
      provider,
      scenario,
      seed: 84,
      scale: 10,
      network: "normal",
      mock_contract: CONTRACT,
      policy: "default",
      replay: "node src/extra.mjs",
      status: "ERROR",
      attempts: 1,
      completed_runs: 0,
      failed_runs: 0,
      timed_out_runs: 0,
    };
    try {
      a = await replica(engine, "a" + suffix, m, provider);
      b = await replica(engine, "b" + suffix, m, provider);
      const pages = fixture(10);
      await a.putAll(pages);
      await a.sync();
      await b.sync();
      await a.sync();
      m.control.offline = true;
      if (scenario === "parent-child-stale-replay") {
        await a.remove(pages[0].id);
        await a.remove(pages[1].id);
        await b.put({
          ...pages[2],
          body: "stale-unrelated-edit",
          editIds: ["stale-unrelated-edit"],
        });
      } else if (scenario !== "repeated-sync-idempotence") {
        const originalNow = Date.now;
        try {
          if (scenario.startsWith("clock"))
            Date.now = () => originalNow() + 300000;
          await a.put({ ...pages[0], body: "extra-A", editIds: ["extra-A"] });
          if (scenario.startsWith("clock"))
            Date.now = () => originalNow() - 300000;
          await b.put({ ...pages[1], body: "extra-B", editIds: ["extra-B"] });
        } finally {
          Date.now = originalNow;
        }
      }
      m.control.offline = false;
      if (scenario === "missing-etag") m.control.omitEtag = true;
      if (scenario === "duplicate-response")
        m.faults.push({ method: "GET", kind: "duplicate-response" });
      if (scenario === "reordered-response")
        m.faults.push({ method: "GET", kind: "reorder" });
      if (scenario === "visibility-delay") {
        for (let i = 0; i < 3; i++) {
          await a.sync();
          await b.sync();
        }
        const settled = [await a.read(), await b.read()];
        r.visibility_precondition =
          canonical(settled[0]) === canonical(settled[1]) &&
          intentOracle(["extra-A", "extra-B"], settled)
            .merged_or_applied_count === 2;
        if (!r.visibility_precondition)
          throw new Error("Visibility fixture not settled");
        // New unsuperseded intent IDs prevent old baseline content from passing.
        for (const [i, id] of [
          [0, "visibility-first-new-intent"],
          [1, "visibility-second-new-intent"],
        ]) {
          m.control.offline = true;
          await a.put({ ...pages[i], body: id, editIds: [id] });
          m.control.offline = false;
          await a.sync();
          await a.sync();
        }
        const changed = [...m.files.values()]
          .filter((f) =>
            [pages[0].id + ".json", pages[1].id + ".json"].includes(f.name),
          )
          .sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime));
        const [older, newer] = changed;
        r.visibility_remote_order = changed.map((f) => ({
          id: f.id,
          name: f.name,
          modifiedTime: f.modifiedTime,
          document: JSON.parse(f.body.toString()),
        }));
        m.control.hiddenIds = [older.id];
        const requestStart = m.requests.length;
        await b.sync();
        await b.sync();
        const hiddenState = await b.read();
        const olderIntent = JSON.parse(older.body.toString()).editIds[0];
        const newerIntent = JSON.parse(newer.body.toString()).editIds[0];
        r.visibility_hidden_state = hiddenState.filter((p) =>
          [pages[0].id, pages[1].id].includes(p.id),
        );
        r.visibility_checkpoint_queries = m.requests
          .slice(requestStart)
          .filter(
            (q) => q.method === "GET" && q.query.q?.includes("modifiedTime"),
          )
          .map((q) => q.query.q);
        r.visibility_exercised =
          older.modifiedTime < newer.modifiedTime &&
          !hiddenState.some(
            (p) =>
              p.body.includes(olderIntent) && p.editIds.includes(olderIntent),
          ) &&
          hiddenState.some(
            (p) =>
              p.body.includes(newerIntent) && p.editIds.includes(newerIntent),
          ) &&
          r.visibility_checkpoint_queries.some((q) => {
            const time = q.match(/modifiedTime >= '([^']+)'/)?.[1];
            return time && time >= newer.modifiedTime;
          });
        m.control.hiddenIds = [];
      }
      if (["concurrent-reconnect", "reordered-response"].includes(scenario))
        await Promise.all([a.sync(), b.sync()]);
      for (let i = 0; i < 3; i++) {
        await a.sync();
        await b.sync();
      }
      await a.close();
      await b.close();
      a = await replica(engine, "a" + suffix, m, provider);
      b = await replica(engine, "b" + suffix, m, provider);
      const states = [await a.read(), await b.read()];
      r.equal = canonical(states[0]) === canonical(states[1]);
      if (scenario === "parent-child-stale-replay") {
        r.deleted_parent_absent = states.every(
          (ps) => !ps.some((p) => p.id === pages[0].id),
        );
        r.deleted_child_absent = states.every(
          (ps) => !ps.some((p) => p.id === pages[1].id),
        );
        Object.assign(r, intentOracle(["stale-unrelated-edit"], states));
        r.status =
          r.equal &&
          r.deleted_parent_absent &&
          r.deleted_child_absent &&
          r.silent_lost_edit_count === 0
            ? "PASS"
            : "FAIL";
      } else if (scenario === "repeated-sync-idempotence")
        r.status =
          r.equal && states.every((ps) => canonical(ps) === canonical(pages))
            ? "PASS"
            : "FAIL";
      else {
        Object.assign(
          r,
          intentOracle(
            scenario === "visibility-delay"
              ? ["visibility-first-new-intent", "visibility-second-new-intent"]
              : ["extra-A", "extra-B"],
            states,
          ),
        );
        if (scenario === "visibility-delay")
          r.visibility_after_reveal = states.map((ps) =>
            ps.filter((p) => [pages[0].id, pages[1].id].includes(p.id)),
          );
        r.status = r.equal && r.silent_lost_edit_count === 0 ? "PASS" : "FAIL";
      }
      if (scenario === "visibility-delay" && !r.visibility_exercised)
        r.status = "NOT_EXERCISED";
      r.completed_runs = 1;
      r.failed_runs = r.status === "PASS" ? 0 : 1;
    } catch (e) {
      r.error = e.message;
      r.failed_runs = 1;
    } finally {
      try {
        await a?.close();
        await b?.close();
      } catch {}
      undo();
      await m.close();
    }
    r.measurements = measure(m.requests, provider);
    r.unsupported = m.unsupported;
    r.faults = m.faults;
    r.replayed_responses = m.requests.filter((q) => q.replayed_response).length;
    r.response_order_inversions = m.requests.filter(
      (q, i) =>
        i > 0 && q.completion_order < m.requests[i - 1].completion_order,
    ).length;
    r.native_conditional_write_requests = m.requests.filter(
      (q) => ["PUT", "PATCH"].includes(q.method) && q.if_match,
    ).length;
    r.assumption =
      scenario === "visibility-delay"
        ? "ADVERSARIAL HYPOTHESIS: older changed file hidden for one pull, then revealed; not asserted Google behavior"
        : null;
    results.push(r);
    console.log(engine, provider, scenario, r.status);
    await writeFile(
      "evidence/extra.json",
      JSON.stringify({ source_manifest, results }, null, 2) + "\n",
    );
  }

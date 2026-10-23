import { mock, CONTRACT, NETWORKS } from "./mock.mjs";
import { replica, intercept } from "./candidates.mjs";
import { intentOracle, canonical } from "./oracle.mjs";
import { measure } from "./metrics.mjs";
import { randomUUID } from "node:crypto";
export const pins = {
  rxdb: {
    version: "17.6.0",
    commit: "9d60a86373730211c291f8c25668fca7aa531887",
    adapter: "replicateGoogleDrive + Dexie",
  },
  selfstore: {
    version: "1.8.29",
    commit: "d5900893187e8832dc5cba510a928819b2042236",
    adapter: "native driveTarget.adopt / webdavTarget.connect + indexedDbCache",
  },
};
export const fixture = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    parentId: i ? "00000000-0000-4000-8000-000000000000" : null,
    body: `# Synthetic page ${i}\n${"Markdown fixture. ".repeat(8)}\ncreate-${i}`,
    editIds: [`create-${i}`],
  }));
export async function trial({
  engine = "rxdb",
  provider = "drive",
  scenario = "single-edit",
  scale = 10,
  seed = 1,
  network = "fast",
  policy = "default",
  suite = "fixed",
} = {}) {
  const m = await mock({
      seed,
      network,
      sameTime: scenario === "same-time-boundary",
    }),
    undo = intercept(m),
    start = performance.now();
  let a, b, c;
  const suffix = randomUUID().replaceAll("-", ""),
    names = ["a" + suffix, "b" + suffix];
  let ack = [],
    phases = {},
    observations = {},
    error = null,
    completed = false;
  const output = {
    engine,
    ...pins[engine],
    provider,
    policy,
    mock_contract: CONTRACT,
    scenario,
    scale,
    seed,
    network,
    suite,
    network_input: NETWORKS[network],
    timing_configuration: {
      rxdb_transaction_timeout_ms: 50,
      rxdb_retry_ms: 20,
      selfstore_debounce_ms: 2147483647,
      trigger: "explicit foreground sync; live signaling disabled",
      note: "Default conflict policy; accelerated retry/lease timings and explicit save triggers are harness configuration",
    },
    confidence: "LOW_CONFIDENCE",
    label: "MOCK-TESTED",
    attempts: 1,
    completed_runs: 0,
    failed_runs: 0,
    timed_out_runs: 0,
    replay: `node src/run.mjs --engine=${engine} --provider=${provider} --scenario=${scenario} --scale=${scale} --seed=${seed} --network=${network} --policy=${policy} --suite=${suite}`,
  };
  const progressTimer = process.send
    ? setInterval(
        () =>
          process.send?.({
            progress: {
              ...output,
              acknowledged_edit_count: ack.length,
              measurements: measure(m.requests, provider),
              faults: m.faults,
              observations: { ...observations },
              runtime_ms: performance.now() - start,
            },
          }),
        1000,
      )
    : null;
  const phase = (name, at, req) =>
    (phases[name] = {
      duration_ms: performance.now() - at,
      requests: m.requests.slice(req).map((r) => ({ ...r })),
    });
  try {
    a = await replica(engine, names[0], m, provider, policy);
    b = await replica(engine, names[1], m, provider, policy);
    const pages = fixture(scale);
    await a.putAll(pages);
    let at = performance.now(),
      req = m.requests.length;
    await a.sync();
    const hydrateAt = performance.now();
    await b.sync();
    observations.cold_hydration_ms = performance.now() - hydrateAt;
    await a.sync();
    phase("cold", at, req);
    observations.initial_equal =
      canonical(await a.read()) === canonical(await b.read());
    observations.initial_count = (await b.read()).length;
    if (scenario === "same-time-boundary") {
      ack = pages.map((p) => p.editIds[0]); // Separate boundary completeness probe, initial writes were acknowledged.
      const ids = awaitedIds(await b.read());
      observations.missing_pages = pages.filter((p) => !ids.has(p.id)).length;
    } else {
      const editRequestStart = m.requests.length,
        editStart = performance.now();
      const idA = `edit-${seed}-A`,
        idB = `edit-${seed}-B`;
      const indexA = suite === "seeded" ? seed % scale : 0,
        indexB =
          scenario === "different-pages"
            ? (indexA + 1 + (seed % (scale - 1))) % scale
            : indexA;
      observations.operation_schedule = {
        indexA,
        indexB,
        first_sync: suite === "seeded" && seed % 3 === 0 ? "B" : "A",
      };
      let pA = {
        ...pages[indexA],
        body: pages[indexA].body + "\n" + idA,
        editIds: [idA],
      };
      let pB = {
        ...pages[indexB],
        body: pages[indexB].body + "\n" + idB,
        editIds: [idB],
      };
      if (scenario !== "single-edit") m.control.offline = true;
      if (scenario === "delete-recreate") {
        await a.remove(pages[0].id);
        await a.put(pA);
        ack = [idA];
        await b.put(pB);
        ack.push(idB);
      } else {
        await a.put(pA);
        ack = [idA];
        if (["same-page", "different-pages"].includes(scenario)) {
          await b.put(pB);
          ack.push(idB);
        }
      }
      if (scenario === "restart-offline") {
        await a.close();
        a = await replica(engine, names[0], m, provider, policy);
        observations.pending_survives_restart = (await a.read()).some((p) =>
          p.editIds.includes(idA),
        );
      }
      const acknowledgedAt = performance.now();
      m.control.offline = false;
      const reconnectAt = performance.now();
      const faultMatch =
        provider === "webdav"
          ? { method: "PUT", fileId: "dav" }
          : engine === "rxdb"
            ? {
                method: "PUT",
                fileId: [...m.files.values()].find(
                  (f) =>
                    f.name ===
                    (scenario.includes("wal-")
                      ? "rxdb-wal.json"
                      : pA.id + ".json"),
                )?.id,
                fileName: scenario.includes("wal-")
                  ? "rxdb-wal.json"
                  : pA.id + ".json",
                bodyContains: idA,
              }
            : { method: "PATCH", fileId: "selfstore" };
      if (scenario === "revoked-401") m.control.status = 401;
      observations.durable_before_recovery = (
        await Promise.all([a.read(), b.read()])
      ).map((ps) => ps.filter((p) => p.editIds.some((id) => ack.includes(id))));
      if (scenario.startsWith("fault-")) {
        const f = scenario.slice(6).replace(/^wal-/, "");
        m.faults.push(
          /^\d+$/.test(f)
            ? { ...faultMatch, status: Number(f) }
            : { ...faultMatch, kind: f },
        );
      }
      at = scenario === "single-edit" ? acknowledgedAt : reconnectAt;
      req = editRequestStart;
      observations.bytes_of_user_changes =
        Buffer.byteLength(JSON.stringify(pA)) +
        (ack.length > 1 ? Buffer.byteLength(JSON.stringify(pB)) : 0);
      observations.change_bytes_definition =
        "UTF-8 full serialized changed records (not total workspace), including retained Markdown";
      observations.local_edit_and_flush_ms = acknowledgedAt - editStart;
      for (let i = 0; i < 3; i++) {
        if (suite === "seeded" && seed % 3 === 0) {
          await b.sync();
          await a.sync();
        } else {
          await a.sync();
          await b.sync();
        }
      }
      phase("incremental", at, req);
      observations.reconnect_recovery_ms =
        scenario === "single-edit" ? null : phases.incremental.duration_ms;
    }
    const before = [await a.read(), await b.read()];
    observations.equal_before_restart =
      canonical(before[0]) === canonical(before[1]);
    observations.status_before_restart = [a.status(), b.status()];
    observations.conflicts_before_restart = [
      await a.conflicts(),
      await b.conflicts(),
    ];
    await a.close();
    await b.close();
    a = await replica(engine, names[0], m, provider, policy);
    b = await replica(engine, names[1], m, provider, policy);
    const after = [await a.read(), await b.read()],
      durable = [await a.conflicts(), await b.conflicts()];
    observations.after_restart = after;
    observations.conflicts_after_restart = durable;
    Object.assign(output, intentOracle(ack, after, durable));
    output.equal = canonical(after[0]) === canonical(after[1]);
    output.false_synced_count =
      engine === "rxdb"
        ? null
        : output.silent_lost_edit_count > 0
          ? observations.status_before_restart.filter(
              (s) => s.state === "saved",
            ).length
          : 0;
    output.status =
      scenario === "revoked-401" &&
      output.durable_unpropagated_count > 0 &&
      observations.status_before_restart.some((s) => s.action === "reconnect")
        ? "BLOCKED"
        : output.silent_lost_edit_count === 0 &&
            output.equal &&
            observations.initial_equal &&
            m.unsupported.length === 0 &&
            (!scenario.startsWith("fault-") ||
              m.faults.some(
                (f) =>
                  f.used &&
                  f.matched &&
                  (f.kind !== "unknown-success" || f.matched.mutation_applied),
              ))
          ? "PASS"
          : "FAIL";
    completed = true;
  } catch (e) {
    error = { name: e.name, message: e.message, stack: e.stack };
    output.status = "ERROR";
    if (scenario === "revoked-401") {
      try {
        await a?.close();
        await b?.close();
        a = await replica(engine, names[0], m, provider, policy);
        b = await replica(engine, names[1], m, provider, policy);
        const restored = [await a.read(), await b.read()];
        observations.after_error_restart = restored.map((ps) =>
          ps.filter((p) => p.editIds.some((id) => ack.includes(id))),
        );
        Object.assign(
          output,
          intentOracle(ack, restored, [
            await a.conflicts(),
            await b.conflicts(),
          ]),
        );
        output.status =
          output.silent_lost_edit_count === 0 ? "BLOCKED" : "FAIL";
        output.blocked_state =
          "Native 401 error; local pending edit durably survives reopen; application reauth UI UNKNOWN";
        completed = true;
      } catch (reopenError) {
        observations.reopen_error = reopenError.message;
      }
    }
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    try {
      await a?.close();
      await b?.close();
      await c?.close();
    } catch {}
    undo();
    await m.close();
  }
  output.completed_runs = completed ? 1 : 0;
  output.failed_runs = ["PASS", "BLOCKED"].includes(output.status) ? 0 : 1;
  output.runtime_ms = performance.now() - start;
  output.phases = phases;
  output.observations = observations;
  output.error = error;
  output.requests = m.requests;
  output.faults = m.faults;
  output.injected_failures =
    m.faults.filter((f) => f.used).length +
    (scenario === "revoked-401" ? 1 : 0);
  output.recovered_within_bounded_test_count =
    output.status === "PASS" ? output.injected_failures : 0;
  output.unrecovered_count =
    output.status === "BLOCKED"
      ? 0
      : output.injected_failures - output.recovered_within_bounded_test_count;
  output.retry_count =
    "UNKNOWN: repeated endpoint calls include ordinary polls";
  output.unsupported = m.unsupported;
  output.remote_objects = m.files.size;
  output.remote_bytes = [...m.files.values()].reduce(
    (s, f) => s + f.body.length,
    0,
  );
  output.same_page_conflict_count = scenario === "same-page" ? 1 : 0;
  output.auto_merged_count = 0;
  output.durable_manual_conflict_count =
    output.durably_preserved_conflict_count ?? null;
  output.silent_overwrite_count = output.silent_lost_edit_count ?? null;
  return output;
}
function awaitedIds(pages) {
  return new Set(pages.map((p) => p.id));
}

import { readFile, writeFile } from "node:fs/promises";
const extras = JSON.parse(
  await readFile("evidence/extra.json", "utf8"),
).results;
const browser = JSON.parse(
  await readFile("evidence/browser-smoke.json", "utf8"),
).results;
const input = JSON.parse(await readFile("evidence/results.json", "utf8")),
  rows = input.results;
const combinations = [
  ["rxdb", "drive"],
  ["selfstore", "drive"],
  ["selfstore", "webdav"],
];
const fmt = (v) =>
  typeof v === "number"
    ? Number(v.toFixed(2)).toLocaleString("en-US")
    : (v ?? "UNKNOWN");
const sample = (e, p, n) =>
  rows.find(
    (r) =>
      r.engine === e &&
      r.provider === p &&
      r.scale === n &&
      r.scenario === "single-edit" &&
      r.network === "normal",
  );
const conflicts = (e, p) =>
  rows.find(
    (r) =>
      r.engine === e &&
      r.provider === p &&
      r.scenario === "same-page" &&
      r.seed === 84 &&
      r.policy === "default",
  );
const header = [
  "Metric / units",
  "RxDB → Drive",
  "selfstore → Drive",
  "selfstore → WebDAV",
];
const table = [header];
function row(label, fn) {
  table.push([label, ...combinations.map(([e, p]) => fn(e, p))]);
}
row("Default same-page safety (n=1)", (e, p) => {
  const r = conflicts(e, p);
  return `${r?.status ?? "NOT_RUN"}; ${r?.merged_or_applied_count ?? "?"}/${r?.acknowledged_edit_count ?? "?"} applied; ${r?.durably_preserved_conflict_count ?? "?"} durable conflict; ${r?.silent_lost_edit_count ?? "?"} lost`;
});
row("Native false-Synced observations, same-page", (e, p) =>
  fmt(conflicts(e, p)?.false_synced_count),
);
row("Eligible converged / attempts (fixed; blocked auth excluded)", (e, p) => {
  const rs = rows.filter(
    (r) =>
      r.engine === e &&
      r.provider === p &&
      r.suite !== "seeded" &&
      r.scenario !== "revoked-401",
  );
  return `${rs.filter((r) => r.status === "PASS").length} / ${rs.length}`;
});
row("Faults injected / recovered / BLOCKED / unrecovered", (e, p) => {
  const rs = rows.filter(
    (r) =>
      r.engine === e &&
      r.provider === p &&
      (r.scenario.startsWith("fault-") || r.scenario === "revoked-401"),
  );
  const injected = rs.reduce(
    (s, r) =>
      s + (r.injected_failures ?? r.faults?.filter((f) => f.used).length ?? 0),
    0,
  );
  return `${injected} / ${rs.reduce((s, r) => s + (r.recovered_within_bounded_test_count ?? 0), 0)} / ${rs.filter((r) => r.status === "BLOCKED").length} / ${rs.filter((r) => ["ERROR", "FAIL", "TIMEOUT"].includes(r.status)).length}`;
});
row("Pending edit survives client reopen (n=1)", (e, p) =>
  String(
    rows.find(
      (r) =>
        r.engine === e && r.provider === p && r.scenario === "restart-offline",
    )?.observations?.pending_survives_restart ?? "UNKNOWN",
  ),
);
row("Offline different-page recovery ms (fast / degraded; n=1 each)", (e, p) =>
  ["fast", "degraded"]
    .map((net) =>
      fmt(
        rows.find(
          (r) =>
            r.engine === e &&
            r.provider === p &&
            r.scenario === "different-pages" &&
            r.seed === 84 &&
            r.network === net &&
            r.suite !== "seeded",
        )?.observations?.reconnect_recovery_ms,
      ),
    )
    .join(" / "),
);
row("Default conflict policy / manual durable archives", (e, p) =>
  e === "rxdb"
    ? "master wins / NOT_RUN"
    : "LWW / 0 of 2 edits archived in manual probe",
);
row(
  "Retry count / backoff / detection lag",
  () => "UNKNOWN / native policy, not measured / manual trigger",
);
for (const n of [10, 1000]) {
  row(`${n} pages: cold cycle HTTP requests / bytes ↑↓`, (e, p) => {
    const r = sample(e, p, n),
      m = r?.phases?.cold?.measurements;
    return m
      ? `${m.requests} / ${m.bytes_up} / ${m.bytes_down}`
      : (r?.status ?? "NOT_RUN");
  });
  row(`${n} pages: B hydration ms / cold cycle ms (n=1)`, (e, p) => {
    const r = sample(e, p, n);
    return `${fmt(r?.observations?.cold_hydration_ms)} / ${fmt(r?.phases?.cold?.duration_ms)}`;
  });
  row(`${n} pages: single-edit requests / bytes ↑↓`, (e, p) => {
    const m = sample(e, p, n)?.phases?.incremental?.measurements;
    return m ? `${m.requests} / ${m.bytes_up} / ${m.bytes_down}` : "UNKNOWN";
  });
  row(
    `${n} pages: known quota units + UNKNOWN-weight requests (edit)`,
    (e, p) => {
      const m = sample(e, p, n)?.phases?.incremental?.measurements;
      return p === "webdav"
        ? "N/A"
        : `${fmt(m?.known_quota_units)} + ${fmt(m?.unknown_quota_requests)} UNKNOWN`;
    },
  );
  row(`${n} pages: post-ACK settle ms / transfer amplification ×`, (e, p) => {
    const r = sample(e, p, n),
      m = r?.phases?.incremental?.measurements;
    return `${fmt(r?.phases?.incremental?.duration_ms)} / ${m ? fmt((m.bytes_up + m.bytes_down) / r.observations.bytes_of_user_changes) : "UNKNOWN"}`;
  });
}
row("Seeded trials: PASS / FAIL / ERROR / TIMEOUT (n)", (e, p) => {
  const rs = rows.filter(
    (r) => r.engine === e && r.provider === p && r.suite === "seeded",
  );
  return `${["PASS", "FAIL", "ERROR", "TIMEOUT"].map((s) => rs.filter((r) => r.status === s).length).join(" / ")} (${rs.length})`;
});
row("Fixed completed / failed / timed-out attempts", (e, p) => {
  const rs = rows.filter(
    (r) => r.engine === e && r.provider === p && r.suite !== "seeded",
  );
  return `${rs.reduce((s, r) => s + (r.completed_runs ?? 0), 0)} / ${rs.reduce((s, r) => s + (r.failed_runs ?? 0), 0)} / ${rs.reduce((s, r) => s + (r.timed_out_runs ?? 0), 0)}`;
});
row(
  "30 normal timed-trial distributions / ranking",
  () => "NOT_RUN — hard safety failure; P50/P95 not estimated",
);
const markdown = (t) =>
  t
    .map(
      (r, i) =>
        "| " +
        r.join(" | ") +
        " |" +
        (i === 0 ? "\n| " + r.map(() => "---").join(" | ") + " |" : ""),
    )
    .join("\n");
let out =
  "# Offline BYOS decision scorecard\n\n**NO SAFE WINNER.** Both default conflict policies lose one acknowledged concurrent same-page edit after native replica reopen. No candidate is ranked for adoption. All measurements below are **MOCK-TESTED**, synthetic loopback, **LOW_CONFIDENCE n=1** diagnostics after the correctness gate; no observed Google latency, provider validation or pricing is implied.\n\n";
out +=
  "## Engine comparison — equivalent mock Google Drive\n\n" +
  markdown(table.map((r) => r.slice(0, 3))) +
  "\n\n";
out +=
  "## Provider comparison — same selfstore engine\n\n" +
  markdown(table.map((r) => [r[0], r[2], r[3]])) +
  "\n\n";
out +=
  "Input: [results.json](evidence/results.json); regenerate with `npm run report`. Each raw attempt records source pins, scenario, scale, seed, synthetic transport, replay, status, measured request mix, units and denominators. Per-method unknown weights are never zero. Counts include native retry attempts; a request is not automatically classified as a retry merely because method/path repeats.\n\n";
out +=
  "Online duration starts after explicit local flush acknowledges durability; selfstore may already upload during that flush, so its local-edit-plus-flush time is separately recorded. Cold cycle starts after replica/target construction and includes A upload + B hydration + A sync; it excludes target bootstrap, while total-trial request counters retain bootstrap. RxDB non-live replication reinitializes on each foreground cycle; these diagnostics cannot rank persistent background polling cost; B hydration is separately timed. Offline duration starts after restoring connectivity. All runs use foreground sync triggers and three settling rounds, not production background detection. Transfer amplification denominator = UTF-8 serialized changed record(s); bytes are HTTP entity bodies, excluding headers/TLS.\n\n";
out +=
  "The 100 seeded trials per combination vary edited document, reconnect order and deterministic jitter. They are a bounded operation-schedule property suite, not arbitrary distributed histories or clock-skew fuzzing. Same-time checkpoint failure can leave edits durable on A but unpropagated to B; this is a convergence failure, not silent loss. Browser evidence proves native selfstore IndexedDB and RxDB Dexie across abrupt renderer crash/reopen in two isolated Chromium contexts; selfstore also retains an offline pending WebDAV edit. It does not prove OS/browser process crash recovery.\n\n";
out +=
  "Recommendation: **HOLD / NO SAFE WINNER**. Retain Google Drive as preferred eventual provider and WebDAV as a secondary option, but first require durable conflict-version preservation and retest. selfstore manual policy is separately tested and must not be mistaken for a durable archive. RxDB needs a checkpoint/pagination repair upstream. The optional rclone bridge is architecture-only and adds an operated/authenticated gateway.\n\n";
out +=
  "See [README](README.md) for fidelity, omitted scenarios, source-level boundaries and replay. Real-provider validation is **REAL-PROVIDER-NOT-RUN**.\n";
out +=
  "\nSupplemental native edge suite: " +
  extras.filter((r) => r.status === "PASS").length +
  "/" +
  extras.length +
  " PASS (parent/child deletion and stale replay, ±5min wall clocks, concurrent reconnect, repeated sync, cached duplicate/reordered response, visibility hypothesis, missing WebDAV ETag). Browser tests: " +
  browser.map((r) => r.engine + ": " + r.status).join(", ") +
  ". See [extra.json](evidence/extra.json) and [browser-smoke.json](evidence/browser-smoke.json).\n";
await writeFile("SCORECARD.md", out);
console.log("Wrote SCORECARD.md from " + rows.length + " attempts.");

// A compact decision page; detailed metric definitions remain in SCORECARD.md.
const compactRows = [
  [
    "Metric (10 / 1000 pages unless stated)",
    "RxDB 17.6.0 → Drive",
    "selfstore 1.8.29 → Drive",
    "selfstore 1.8.29 → WebDAV",
  ],
];
const addCompact = (name, fn) =>
  compactRows.push([name, ...combinations.map(([e, p]) => fn(e, p))]);
addCompact("Same-page hard gate; lost / ACK (n=1)", (e, p) => {
  const r = conflicts(e, p);
  return `${r.status}; ${r.silent_lost_edit_count}/${r.acknowledged_edit_count}`;
});
addCompact("One-edit HTTP requests (n=1 each)", (e, p) =>
  [10, 1000]
    .map((n) =>
      fmt(sample(e, p, n)?.phases?.incremental?.measurements?.requests),
    )
    .join(" / "),
);
addCompact("One-edit payload up+down bytes", (e, p) =>
  [10, 1000]
    .map((n) => {
      const m = sample(e, p, n)?.phases?.incremental?.measurements;
      return m ? fmt(m.bytes_up + m.bytes_down) : "UNKNOWN";
    })
    .join(" / "),
);
addCompact("One-edit known quota + unknown-weight requests", (e, p) =>
  p === "webdav"
    ? "N/A"
    : [10, 1000]
        .map((n) => {
          const m = sample(e, p, n)?.phases?.incremental?.measurements;
          return `${fmt(m?.known_quota_units)} + ${fmt(m?.unknown_quota_requests)}?`;
        })
        .join(" / "),
);
addCompact("Post-ACK foreground settle ms (n=1 each)", (e, p) =>
  [10, 1000]
    .map((n) => fmt(sample(e, p, n)?.phases?.incremental?.duration_ms))
    .join(" / "),
);
addCompact("Seed cases converged / attempts", (e, p) => {
  const rs = rows.filter(
    (r) => r.engine === e && r.provider === p && r.suite === "seeded",
  );
  return `${rs.filter((r) => r.status === "PASS").length}/${rs.length}`;
});
addCompact("Fault attempts PASS / BLOCKED / TIMEOUT", (e, p) => {
  const rs = rows.filter(
    (r) =>
      r.engine === e &&
      r.provider === p &&
      (r.scenario.startsWith("fault-") || r.scenario === "revoked-401"),
  );
  return ["PASS", "BLOCKED", "TIMEOUT"]
    .map((s) => rs.filter((r) => r.status === s).length)
    .join(" / ");
});
let summary =
  "# BYOS decision — NO SAFE WINNER\n\n**HOLD.** Both engines lose one concurrent acknowledged edit after reopen. Selfstore manual mode preserves no full conflict archive. No safety-qualified engine is ranked.\n\n**Engine comparison — same mock Google Drive**\n\n" +
  markdown(compactRows.map((r) => r.slice(0, 3))) +
  "\n\n**Provider comparison — same selfstore engine**\n\n" +
  markdown(compactRows.map((r) => [r[0], r[2], r[3]])) +
  "\n\n**Limits:** MOCK-TESTED synthetic normal8±2ms/request; n1 diagnostics are LOW_CONFIDENCE, with P50/P95 and30-trial ranking NOT_RUN after safety failure. Payload bytes exclude headers/TLS. Quota is known subtotal plus UNKNOWN requests, never total/billing. Lifecycle differs: RxDB reinitializes native non-live replication each cycle; selfstore retains its adopted target. No latency/cost ratio or real-provider claim is justified.\n\n**Next:** require durable conflict recovery and repair/retest RxDB same-time checkpoint stall (16/30 propagated,14 still locally durable). Keep Drive preferred and native WebDAV secondary; rclone is architecture-only. Then seek separate authorization for the smallest disposable-account smoke.\n\n[Detailed numeric scorecard](SCORECARD.md) · [Raw attempts](evidence/results.json) · [Supplemental probes](evidence/extra.json) · [Browser crash/CORS](evidence/browser-smoke.json) · [Full-fixture checks](evidence/fixture-check.json) · [Replay/provenance](README.md). Regenerate both tables: `npm run report`.\n";
await writeFile("SUMMARY.md", summary);

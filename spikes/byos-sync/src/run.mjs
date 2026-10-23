import { sourceManifest } from "./manifest.mjs";
import { compact } from "./metrics.mjs";
import { fork } from "node:child_process";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((x) => x.startsWith("--"))
    .map((x) => x.slice(2).split("=")),
);
const configs = [];
const source_manifest = await sourceManifest();
if (args.engine)
  configs.push({
    engine: args.engine,
    provider: args.provider ?? "drive",
    scenario: args.scenario ?? "same-page",
    scale: Number(args.scale ?? 10),
    seed: Number(args.seed ?? 1),
    network: args.network ?? "fast",
    policy: args.policy ?? "default",
    suite: args.suite ?? "fixed",
  });
else
  for (const [engine, provider] of [
    ["rxdb", "drive"],
    ["selfstore", "drive"],
    ["selfstore", "webdav"],
  ])
    for (const scenario of [
      "single-edit",
      "same-page",
      "different-pages",
      "restart-offline",
      "delete-recreate",
      "fault-401",
      "fault-403",
      "fault-429",
      "fault-500",
      "fault-drop-before",
      "fault-unknown-success",
      "fault-timeout",
      "fault-delayed-response",
      "revoked-401",
      ...(engine === "rxdb"
        ? ["same-time-boundary", "fault-wal-unknown-success"]
        : []),
    ])
      configs.push({
        engine,
        provider,
        scenario,
        scale: scenario === "same-time-boundary" ? 30 : 10,
        seed: 84,
        network: "fast",
        policy: "default",
      });
if (!args.engine) {
  for (const provider of ["drive", "webdav"])
    configs.push({
      engine: "selfstore",
      provider,
      scenario: "same-page",
      scale: 10,
      seed: 84,
      network: "fast",
      policy: "manual",
    });
  for (const [engine, provider] of [
    ["rxdb", "drive"],
    ["selfstore", "drive"],
    ["selfstore", "webdav"],
  ])
    for (const scale of [10, 1000])
      configs.push({
        engine,
        provider,
        scenario: "single-edit",
        scale,
        seed: 84,
        network: "normal",
        policy: "default",
      });
  for (const [engine, provider] of [
    ["rxdb", "drive"],
    ["selfstore", "drive"],
    ["selfstore", "webdav"],
  ])
    configs.push({
      engine,
      provider,
      scenario: "different-pages",
      scale: 10,
      seed: 84,
      network: "degraded",
      policy: "default",
    });
  for (let seed = 1; seed <= Number(args.seeds ?? 100); seed++)
    for (const [engine, provider] of [
      ["rxdb", "drive"],
      ["selfstore", "drive"],
      ["selfstore", "webdav"],
    ])
      configs.push({
        engine,
        provider,
        scenario: seed % 2 ? "same-page" : "different-pages",
        scale: 10,
        seed,
        network: "fast",
        policy: "default",
        suite: "seeded",
      });
}
export async function runOne(config) {
  return new Promise((resolve) => {
    const child = fork(
      fileURLToPath(new URL("./worker.mjs", import.meta.url)),
      [JSON.stringify(config)],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    let stderr = "",
      result,
      progress;
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("message", (r) => {
      if (r.progress) progress = r.progress;
      else result = r;
    });
    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
        result = {
          ...progress,
          ...config,
          status: "TIMEOUT",
          completed_runs: 0,
          failed_runs: 0,
          timed_out_runs: 1,
          error: {
            message:
              "Per-process bounded deadline exceeded (30s; 180s for 1000 pages)",
          },
          measurements:
            progress?.measurements ??
            "UNKNOWN: child terminated before first progress receipt",
          partial_receipt: true,
        };
      },
      config.scale === 1000
        ? 180000
        : config.scenario === "fault-timeout"
          ? 40000
          : 30000,
    );
    child.on("exit", () => {
      clearTimeout(timer);
      resolve({
        ...result,
        ...config,
        stderr: stderr.slice(-1500),
        status: result?.status ?? "ERROR",
      });
    });
  });
}
const results = [];
for (const config of configs) {
  const r = await runOne({ ...config, source_digest: source_manifest.digest });
  results.push(args.trace ? r : compact(r));
  console.log(
    `${results.length}/${configs.length} ${config.engine}/${config.provider} ${config.scenario} ${config.scale} seed=${config.seed}: ${r.status} lost=${r.silent_lost_edit_count ?? "UNKNOWN"}`,
  );
  await mkdir("evidence", { recursive: true });
  await writeFile(
    args.output ?? "evidence/results.json",
    JSON.stringify(
      {
        harness_version: "1.0.0",
        source_manifest,
        measurement_contract: {
          bytes: "HTTP entity-body payload bytes; excludes headers/TLS",
          duration: "real Node runtime plus synthetic HTTP request delays",
          percentiles: "NOT_ESTIMATED for safety-gated n1 diagnostics",
          confidence: "MOCK-TESTED; REAL-PROVIDER-NOT-RUN",
        },
        generated_at: new Date().toISOString(),
        environment: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
        },
        results,
      },
      null,
      2,
    ) + "\n",
  );
}

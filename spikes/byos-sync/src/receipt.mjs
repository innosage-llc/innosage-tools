import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sourceManifest } from "./manifest.mjs";
const final = await sourceManifest(),
  artifacts = {};
const allowed = new Set(["src/report.mjs", "src/receipt.mjs"]);
for (const file of [
  "results.json",
  "extra.json",
  "browser-smoke.json",
  "fixture-check.json",
]) {
  const bytes = await readFile("evidence/" + file),
    data = JSON.parse(bytes),
    captured = data.source_manifest;
  if (!captured) throw new Error("Missing measured source manifest: " + file);
  const drift = Object.keys(final.files).filter(
    (path) => captured.files[path] !== final.files[path],
  );
  // extra.mjs is a standalone entrypoint, never imported by run/browser/fixture.
  // Its own evidence must match it exactly; other artifacts retain historical hashes.
  const independentEntryDrift = file === "extra.json" ? [] : ["src/extra.mjs"];
  if (
    drift.some(
      (path) => !allowed.has(path) && !independentEntryDrift.includes(path),
    )
  )
    throw new Error(
      "Runtime source drift invalidates " + file + ": " + drift.join(","),
    );
  artifacts[file] = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    captured_source_digest: captured.digest,
    report_only_drift: drift.filter((path) => allowed.has(path)),
    nonexecuted_independent_entrypoint_drift: drift.filter((path) =>
      independentEntryDrift.includes(path),
    ),
    attempts: data.results.length,
    status_counts: Object.fromEntries(
      [...new Set(data.results.map((r) => r.status))]
        .sort()
        .map((status) => [
          status,
          data.results.filter((r) => r.status === status).length,
        ]),
    ),
  };
}
await writeFile(
  "evidence/provenance.json",
  JSON.stringify(
    {
      final_source_manifest: final,
      artifacts,
      pins: {
        rxdb: {
          version: "17.6.0",
          commit: "9d60a86373730211c291f8c25668fca7aa531887",
        },
        selfstore: {
          version: "1.8.29",
          commit: "d5900893187e8832dc5cba510a928819b2042236",
        },
        indexeddb_emulator: "fake-indexeddb6.2.4",
        browser_automation: "playwright1.62.1",
      },
      shared_contract: {
        classification: "MOCK-TESTED",
        real_provider: "NOT_RUN",
        synthetic_data_only: true,
        body_bytes: "HTTP entity bodies, excludes headers and TLS",
        seeded_cases:
          "100 fixture/order variations per combination, not exhaustive fuzz",
        browser:
          "one attempt per named assertion, two isolated contexts; deterministic non-random fixture, seed NOT_APPLICABLE",
        all_fees: "UNKNOWN",
      },
      commands: [
        "npm ci --ignore-scripts (network bootstrap only)",
        "npm test",
        "node src/run.mjs --seeds=100 --output=evidence/results.json",
        "node src/extra.mjs",
        "node src/browser-smoke.mjs",
        "node src/fixture-check.mjs",
        "npm run report",
        "node src/receipt.mjs",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log("Provenance verified: no runtime source drift.");

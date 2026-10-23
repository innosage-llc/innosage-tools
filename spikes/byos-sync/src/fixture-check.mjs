import { mock } from "./mock.mjs";
import { replica, intercept } from "./candidates.mjs";
import { fixture, pins } from "./trial.mjs";
import { matchesFixture } from "./fixture-oracle.mjs";
import { sourceManifest } from "./manifest.mjs";
import { randomUUID, createHash } from "node:crypto";
import { canonical } from "./oracle.mjs";
import { writeFile } from "node:fs/promises";
const source_manifest = await sourceManifest(),
  results = [];
const digest = (pages) =>
  createHash("sha256").update(canonical(pages)).digest("hex");
for (const [engine, provider] of [
  ["rxdb", "drive"],
  ["selfstore", "drive"],
  ["selfstore", "webdav"],
])
  for (const scale of [10, 1000]) {
    const m = await mock({ seed: 84, network: "fast" }),
      undo = intercept(m),
      suffix = randomUUID().replaceAll("-", "");
    let a, b;
    const r = {
      engine,
      ...pins[engine],
      provider,
      scale,
      scenario: "full-fixture-and-retained-sibling-verification",
      seed: 84,
      network: "fast",
      mock_contract: "byos-loopback-v1",
      policy: "default",
      attempts: 1,
      completed_runs: 0,
      failed_runs: 0,
      timed_out_runs: 0,
      replay: "node src/fixture-check.mjs",
    };
    try {
      a = await replica(engine, "a" + suffix, m, provider);
      b = await replica(engine, "b" + suffix, m, provider);
      const expected = fixture(scale);
      await a.putAll(expected);
      await a.sync();
      await b.sync();
      await a.sync();
      r.initial_full_fixture = matchesFixture(
        [await a.read(), await b.read()],
        expected,
      );
      expected[0] = {
        ...expected[0],
        body: "fixture-updated",
        editIds: ["fixture-updated"],
      };
      await a.put(expected[0]);
      for (let i = 0; i < 3; i++) {
        await a.sync();
        await b.sync();
      }
      await a.close();
      await b.close();
      a = await replica(engine, "a" + suffix, m, provider);
      b = await replica(engine, "b" + suffix, m, provider);
      const restored = [await a.read(), await b.read()];
      r.after_edit_and_reopen_full_fixture = matchesFixture(restored, expected);
      r.expected_digest = digest(expected);
      r.actual_digests = restored.map(digest);
      r.expected_retained_unedited_pages = scale - 1;
      r.actual_counts = restored.map((ps) => ps.length);
      r.status =
        r.initial_full_fixture && r.after_edit_and_reopen_full_fixture
          ? "PASS"
          : "FAIL";
      r.completed_runs = 1;
      r.failed_runs = r.status === "PASS" ? 0 : 1;
    } catch (e) {
      r.status = "ERROR";
      r.error = e.message;
      r.failed_runs = 1;
    } finally {
      await a?.close();
      await b?.close();
      undo();
      await m.close();
    }
    results.push(r);
    console.log(engine, provider, scale, r.status);
    await writeFile(
      "evidence/fixture-check.json",
      JSON.stringify({ source_manifest, results }, null, 2) + "\n",
    );
  }

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { root, session, digest } from "./evidence.mjs";

const required = ["A1", "A2", "A3"];
const recordedResults = [
  "PASS",
  "FAIL",
  "BLOCKED",
  "TIMEOUT",
  "ERROR",
  "NOT_RUN",
];
const ref = ({ attempt, result, evidence, evidenceSha256, sourceDigest }) => ({
  attempt,
  result,
  evidence,
  evidenceSha256,
  sourceDigest,
});
function a3Metrics(output) {
  if (
    !output ||
    !Array.isArray(output.results) ||
    output.results.length === 0 ||
    !Number.isSafeInteger(output.stateObservationCount) ||
    output.stateObservationCount <= 0 ||
    !Number.isSafeInteger(output.falseStateCount) ||
    output.falseStateCount !== 0 ||
    output.results.some(
      (r) =>
        !Array.isArray(r.requests) ||
        r.requests.some(
          (q) => typeof q.method !== "string" || typeof q.path !== "string",
        ),
    )
  )
    throw new Error(
      "Latest passing A3 evidence lacks valid zero-false-state observations or request data",
    );
  const methods = {};
  let requestCount = 0;
  for (const r of output.results)
    for (const request of r.requests) {
      const key = `${request.method} ${request.path}`;
      methods[key] = (methods[key] ?? 0) + 1;
      requestCount++;
    }
  return {
    evidenceHashVerified: true,
    scenarios: output.results.length,
    stateObservations: output.stateObservationCount,
    falseStateCount: output.falseStateCount,
    requestCount,
    methods,
    quotaWeights: "UNKNOWN",
    providerCost: "UNKNOWN",
  };
}

// Latest means append order in the ledger, including non-PASS results. The loader
// is injected so regression fixtures never alter the real ledger or raw evidence.
export async function buildReport(records, loadEvidence) {
  const latest = new Map(
    required.map((id) => [id, records.findLast((r) => r.attempt === id)]),
  );
  const current = [];
  let metrics = null;
  for (const attempt of required) {
    const record = latest.get(attempt);
    if (!record) {
      current.push({
        attempt,
        result: "MISSING",
        evidenceHashVerified: false,
        reason: "No recorded result for required witness",
      });
      continue;
    }
    const item = {
      ...ref(record),
      recordedResult: record.result,
      evidenceHashVerified: false,
    };
    try {
      if (
        !recordedResults.includes(record.result) ||
        typeof record.evidence !== "string" ||
        !/^[a-f0-9]{64}$/.test(record.evidenceSha256) ||
        !/^[a-f0-9]{64}$/.test(record.sourceDigest)
      )
        throw new Error("Invalid latest ledger record");
      const bytes = await loadEvidence(record.evidence);
      if (digest(bytes) !== record.evidenceSha256)
        throw new Error("Latest evidence hash mismatch");
      item.evidenceHashVerified = true;
      const data = JSON.parse(bytes.toString());
      if (!data || typeof data !== "object")
        throw new Error("Invalid latest evidence JSON");
      // Initial A1/A2 raw artifacts predate the enveloped runner format. Their
      // exact bytes are still mandatory; later envelopes must agree with ledger.
      if (
        !Array.isArray(data) &&
        "id" in data &&
        (data.id !== attempt ||
          data.result !== record.result ||
          data.source?.sourceDigest !== record.sourceDigest)
      )
        throw new Error("Latest evidence envelope disagrees with ledger");
      if (attempt === "A3" && record.result === "PASS")
        metrics = a3Metrics(data.output);
    } catch (error) {
      item.result = "INVALID_EVIDENCE";
      item.reason =
        error.code === "ENOENT"
          ? "Latest evidence file is missing"
          : error.message;
    }
    current.push(item);
  }
  const foundationPass = current.every((r) => r.result === "PASS");
  const historicalPasses = records
    .filter(
      (r) =>
        required.includes(r.attempt) &&
        r.result === "PASS" &&
        r !== latest.get(r.attempt),
    )
    .map(ref);
  const summary = {
    status: foundationPass
      ? "FOUNDATION_PASS_FULL_ACCEPTANCE_PENDING"
      : "FOUNDATION_NOT_PASS",
    foundationPass,
    baselineCommit: "496e9a8a1b605c81e71026d0ab217e6ccb9f41a4",
    latestSelection:
      "Last ledger entry for each required witness, regardless of result",
    current,
    historicalPasses,
    historicalPassPolicy:
      "Historical recorded PASS entries are separate; they never substitute for latest evidence and are not revalidated by this report",
    attempts: records.map(ref),
    a3: metrics ?? {
      evidenceHashVerified: false,
      status: "UNAVAILABLE_FROM_LATEST_A3",
      quotaWeights: "UNKNOWN",
      providerCost: "UNKNOWN",
    },
    fullSafety: "NOT_RUN",
    rendererCrashes: "NOT_RUN",
    responseOrderInversion: "NOT_RUN",
    normalDiagnostics: "NOT_RUN",
    latencyPercentiles: "INELIGIBLE_UNTIL_HARD_GATES",
    independentReview: "PENDING",
    nativeGates: "LEAD_OWNED",
    deployment: "NOT_AUTHORIZED",
  };
  const evidenceLink = (r) =>
    typeof r.evidence === "string"
      ? `[raw](${r.evidence.replace("spikes/byos-remediation/", "")})`
      : "Missing";
  const currentTable = current
    .map(
      (r) =>
        `| ${r.attempt} | ${r.result} | ${r.sourceDigest?.slice(0, 12) ?? "Missing"} | ${evidenceLink(r)} | ${r.reason ?? "—"} |`,
    )
    .join("\n");
  const history = historicalPasses.length
    ? historicalPasses
        .map(
          (r) =>
            `| ${r.attempt} | Recorded historical PASS | ${r.sourceDigest.slice(0, 12)} | ${evidenceLink(r)} |`,
        )
        .join("\n")
    : "| — | No superseded PASS entries | — | — |";
  const headline = foundationPass
    ? "Latest hash-verified evidence passes all required focused A1–A3 witnesses. Full R1–R7 acceptance remains pending."
    : `Foundation acceptance is NOT PASS. Latest required evidence: ${current.map((r) => `${r.attempt} ${r.result}`).join("; ")}. Historical success cannot replace missing, failed or invalid current evidence.`;
  const metricsText = metrics
    ? `Latest valid A3 evidence sampled ${metrics.stateObservations} states across ${metrics.scenarios} provider/scenario cases, with ${metrics.falseStateCount} false local/remote/pending observations under the documented exact-set contract. Requests: ${metrics.requestCount}. These A3 observations do not override other required witness results.`
    : "Latest A3 metrics are unavailable; no counts or recovery claim are inferred from an older PASS.";
  const delayNote =
    "Historical A3 raw/source labels `reordered-get` and mock `reorder` exercised only a single sequential GET delayed 250 ms. Current source calls this `delayed-get` / `delayed-response`. Actual response-order inversion is NOT RUN and remains R5 work; historical bytes are preserved.";
  const limits =
    "Full 10/1,000-page/100-seed safety and real renderer crashes: NOT RUN. Normal repeated diagnostics: NOT RUN; percentile comparison INELIGIBLE until hard gates pass. Quota weights and provider cost are UNKNOWN. Custom transport requires complete coherent GET/strong ETag/If-Match semantics; live providers were not tested. Independent review, native gates and integration remain required. No deployment or Master closure.";
  return {
    summary,
    scorecard: `# Remediation foundation scorecard\n\n**${headline}**\n\n| Latest witness | Result | Source hash prefix | Evidence | Reason |\n| --- | --- | --- | --- | --- |\n${currentTable}\n\n${metricsText}\n\n${delayNote}\n\nHistorical recorded PASS entries (not current acceptance; not revalidated here):\n\n| Witness | Historical status | Source hash prefix | Evidence |\n| --- | --- | --- | --- |\n${history}\n\n${limits}\n\nEndpoint/method counts and complete ledger references are in the [machine summary](evidence/foundation-summary.json). [Original baseline scorecard](../byos-sync/SCORECARD.md) remains unchanged.\n`,
    overview: `# Remediation foundation result\n\n${headline}\n\n${metricsText}\n\n${delayNote}\n\nSee [scorecard](SCORECARD.md), [contract and replay](README.md), and [attempt ledger](../../docs/sessions/20261023-byos-remediation/attempts.md).\n\n${limits}\n`,
  };
}

async function main() {
  const text = await readFile(path.join(session, "attempts.jsonl"), "utf8");
  const records = text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const report = await buildReport(records, (file) =>
    readFile(path.resolve(root, "../..", file)),
  );
  await writeFile(
    path.join(root, "evidence/foundation-summary.json"),
    JSON.stringify(report.summary, null, 2) + "\n",
  );
  await writeFile(path.join(root, "SCORECARD.md"), report.scorecard);
  await writeFile(path.join(root, "SUMMARY.md"), report.overview);
  console.log(
    JSON.stringify({
      status: report.summary.status,
      current: report.summary.current,
      a3: report.summary.a3,
    }),
  );
  if (!report.summary.foundationPass) process.exitCode = 1;
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await main();

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { root, session, digest } from "./evidence.mjs";
const records = (await readFile(path.join(session, "attempts.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const table = records
  .map(
    (r) =>
      `| ${r.attempt} | ${r.result} | ${r.sourceDigest.slice(0, 12)} | [raw](${r.evidence.replace("spikes/byos-remediation/", "")}) |`,
  )
  .join("\n");
const a3 = records.findLast((r) => r.attempt === "A3" && r.result === "PASS");
let output,
  verifiedHash = false;
if (a3) {
  const bytes = await readFile(path.resolve(root, "../..", a3.evidence));
  verifiedHash = digest(bytes) === a3.evidenceSha256;
  if (!verifiedHash) throw new Error("Evidence hash mismatch");
  output = JSON.parse(bytes).output;
}
const requestCount =
  output?.results.reduce((n, r) => n + r.requests.length, 0) ?? 0;
const methods = {};
for (const r of output?.results ?? [])
  for (const request of r.requests) {
    const key = `${request.method} ${request.path}`;
    methods[key] = (methods[key] ?? 0) + 1;
  }
const summary = {
  status: "FOUNDATION_ONLY_FULL_ACCEPTANCE_PENDING",
  baselineCommit: "496e9a8a1b605c81e71026d0ab217e6ccb9f41a4",
  attempts: records.map(
    ({ attempt, result, evidence, evidenceSha256, sourceDigest }) => ({
      attempt,
      result,
      evidence,
      evidenceSha256,
      sourceDigest,
    }),
  ),
  a3: {
    evidenceHashVerified: verifiedHash,
    scenarios: output?.results.length ?? 0,
    stateObservations: output?.stateObservationCount ?? 0,
    falseStateCount: output?.falseStateCount ?? "NOT_RUN",
    requestCount,
    methods,
    quotaWeights: "UNKNOWN",
    providerCost: "UNKNOWN",
  },
  fullSafety: "NOT_RUN",
  rendererCrashes: "NOT_RUN",
  normalDiagnostics: "NOT_RUN",
  latencyPercentiles: "INELIGIBLE_UNTIL_HARD_GATES",
  independentReview: "PENDING",
  nativeGates: "LEAD_OWNED",
  deployment: "NOT_AUTHORIZED",
};
await writeFile(
  path.join(root, "evidence/foundation-summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
await writeFile(
  path.join(root, "SCORECARD.md"),
  `# Remediation foundation scorecard\n\n**Partial progress; no adoption or full R1–R7 acceptance claim.**\n\n| Witness | Result | Source hash prefix | Evidence |\n| --- | --- | --- | --- |\n${table}\n\nA3 sampled ${summary.a3.stateObservations} states across ${summary.a3.scenarios} provider/scenario cases, with ${summary.a3.falseStateCount} false local/remote/pending observations under the documented exact-set contract. It retained complete acknowledged bodies and recovered within the declared bounded stable-transport cycle. Permanent denial correctly remained blocked before access was restored in the fixture.\n\nRequests: ${requestCount}; endpoint/method counts and all raw failed/blocked outcomes are retained in [machine summary](evidence/foundation-summary.json) and raw runs. Quota weights and cost are UNKNOWN. These are correctness diagnostics, not normal-network latency measurements. Full 10/1,000-page/100-seed safety and real renderer crashes: NOT RUN. Normal repeated diagnostics: NOT RUN; percentile comparison INELIGIBLE until hard gates pass.\n\n[Original baseline scorecard](../byos-sync/SCORECARD.md) remains unchanged. Custom transport requires complete coherent GET/strong ETag/If-Match semantics; live providers were not tested.\n`,
);
await writeFile(
  path.join(root, "SUMMARY.md"),
  `# Remediation foundation result\n\nThe immutable-revision/custom-CAS route passes focused A1–A3 witnesses. Both complete concurrent bodies survive reopened local stores and a cold third replica; real competing conditional writes force a 412/reload; local ACK remains independent of held remote work. Exact-set receipts keep interrupted/failed verification unknown and later local edits pending. Thirty equal-time edits restore through a known fixed object despite synthetic listing omission, replacing the native checkpoint algorithm.\n\nA3: ${summary.a3.scenarios} cases, ${summary.a3.stateObservations} sampled states, ${summary.a3.falseStateCount} false-state observations. See [scorecard](SCORECARD.md), [contract and replay](README.md), and [attempt ledger](../../docs/sessions/20261023-byos-remediation/attempts.md).\n\nThis foundation increment does not satisfy full R5/R6/R7. The next increment must establish the complete safety matrix, real IndexedDB renderer-crash boundaries and repeated quantitative comparison before adoption acceptance. Independent review and delivery gates remain required. No live provider, deployment or Master closure.\n`,
);
console.log(JSON.stringify(summary.a3));

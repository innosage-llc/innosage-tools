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

// Trial combinations and distinct seeds are separate acceptance denominators.
// This analyzes recorded JSON only; it never starts a replica or transport.
export function safetyCoverage(output) {
  const rows = Array.isArray(output?.results) ? output.results : [];
  const valid = rows.filter((r) =>
    r && ["drive", "webdav"].includes(r.provider) &&
    [10, 1000].includes(r.scale) &&
    Number.isSafeInteger(r.seed) && r.seed > 0,
  );
  const distinctSeeds = new Set(valid.map((r) => r.seed)).size;
  const distinctCombinations = new Set(valid.map((r) => `${r.provider}:${r.scale}:${r.seed}`)).size;
  const cells = Object.fromEntries(["drive", "webdav"].flatMap((provider) =>
    [10, 1000].map((scale) => [
      `${provider}:${scale}`,
      valid.filter((r) => r.provider === provider && r.scale === scale).length,
    ]),
  ));
  const passedTrials = rows.filter((r) => r?.status === "PASS").length;
  const inversionVerified = ["drive", "webdav"].every((provider) => {
    const row = output?.inversions?.find((r) => r.provider === provider);
    const first = row?.receipts?.find((r) => r.operation === 1);
    const second = row?.receipts?.find((r) => r.operation === 2);
    return row?.passed === true && first?.method === "GET" && second?.method === "GET" &&
      first.status === 200 && second.status === 200 &&
      Number.isSafeInteger(first.deliveryOrder) && Number.isSafeInteger(second.deliveryOrder) &&
      second.deliveryOrder > 0 && first.deliveryOrder > second.deliveryOrder &&
      typeof first.capturedEtag === "string" && /^"[^"\r\n]+"$/.test(first.capturedEtag) &&
      first.capturedEtag === second.capturedEtag &&
      /^[a-f0-9]{64}$/.test(first.capturedBodySha256) && first.capturedBodySha256 === second.capturedBodySha256 &&
      row.requests?.some((r) => r.status === 412 && r.if_match === first.capturedEtag) === true;
  });
  const complete = output?.passed === true && rows.length >= 100 &&
    valid.length === rows.length && distinctSeeds >= 100 &&
    distinctCombinations === rows.length && passedTrials === rows.length &&
    Object.values(cells).every((count) => count > 0);
  return {
    status: complete ? "SEED_COVERAGE_MET_BROWSER_AND_OTHER_R5_GATES_SEPARATE" : "PARTIAL_OR_FAILED_SEED_COVERAGE",
    seedCoverageMet: complete,
    trialCount: rows.length,
    passedTrials,
    nonPassingTrials: rows.length - passedTrials,
    invalidTrialIdentities: rows.length - valid.length,
    distinctCombinations,
    distinctSeeds,
    minimumDistinctSeeds: 100,
    cells,
    inversionVerified,
    fullR5Acceptance: false,
  };
}
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
  const a5 = records.findLast((r) => r.attempt === "A5");
  let safety = { status: "NOT_RUN", seedCoverageMet: false, fullR5Acceptance: false };
  if (a5) {
    try {
      if (!recordedResults.includes(a5.result) || typeof a5.evidence !== "string" ||
          !/^[a-f0-9]{64}$/.test(a5.evidenceSha256) || !/^[a-f0-9]{64}$/.test(a5.sourceDigest))
        throw new Error("Invalid latest A5 ledger record");
      const bytes = await loadEvidence(a5.evidence);
      if (digest(bytes) !== a5.evidenceSha256) throw new Error("Latest A5 evidence hash mismatch");
      const data = JSON.parse(bytes.toString());
      if (data.id !== "A5" || data.result !== a5.result || data.source?.sourceDigest !== a5.sourceDigest)
        throw new Error("Latest A5 envelope disagrees with ledger");
      safety = { ...safetyCoverage(data.output), recordedResult: a5.result, evidence: a5.evidence, evidenceHashVerified: true };
      if (a5.result !== "PASS") {
        safety.seedCoverageMet = false;
        safety.status = "RECORDED_RUN_NOT_PASS";
      }
    } catch (error) {
      safety = { status: "INVALID_EVIDENCE", reason: error.message, seedCoverageMet: false, fullR5Acceptance: false };
    }
  }
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
    safetyCoverage: safety,
    fullSafety: safety.status === "NOT_RUN" ? "NOT_RUN" : "INCOMPLETE_R5",
    rendererCrashes: "NOT_RUN",
    responseOrderInversion: safety.inversionVerified ? "MOCK_TESTED_TWO_PROVIDERS_APPLICATION_DELIVERY" : "NOT_RUN",
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
    "Historical A3 raw/source labels `reordered-get` and mock `reorder` exercised only a single sequential GET delayed 250 ms. Current source calls this `delayed-get` / `delayed-response`. " +
    (safety.inversionVerified
      ? "Separate hash-verified A5 receipts demonstrate application delivery inversion of coherent captured HTTP responses on both mock providers, including the resulting 412. This does not relabel the historical delay witness."
      : "Actual response-order inversion is NOT RUN and remains R5 work; historical bytes are preserved.");
  const limits =
    "Full 10/1,000-page/100-seed safety and real renderer crashes: NOT RUN. Normal repeated diagnostics: NOT RUN; percentile comparison INELIGIBLE until hard gates pass. Quota weights and provider cost are UNKNOWN. Custom transport requires complete coherent GET/strong ETag/If-Match semantics; live providers were not tested. Independent review, native gates and integration remain required. No deployment or Master closure.";
  const safetyText = safety.trialCount === undefined
    ? `Additional safety evidence: ${safety.status}. Full R5 remains incomplete.`
    : `Latest A5: ${safety.passedTrials}/${safety.trialCount} passing trial combinations, ${safety.distinctSeeds} distinct seeds (required minimum ${safety.minimumDistinctSeeds}). Seed coverage: ${safety.seedCoverageMet ? "MET" : "NOT MET"}. This does not establish the separate browser and other R5 gates. Historical raw results are unchanged.`;
  return {
    summary,
    scorecard: `# Remediation foundation scorecard\n\n**${headline}**\n\n| Latest witness | Result | Source hash prefix | Evidence | Reason |\n| --- | --- | --- | --- | --- |\n${currentTable}\n\n${metricsText}\n\n${safetyText}\n\n${delayNote}\n\nHistorical recorded PASS entries (not current acceptance; not revalidated here):\n\n| Witness | Historical status | Source hash prefix | Evidence |\n| --- | --- | --- | --- |\n${history}\n\n${limits}\n\nEndpoint/method counts and complete ledger references are in the [machine summary](evidence/foundation-summary.json). [Original baseline scorecard](../byos-sync/SCORECARD.md) remains unchanged.\n`,
    overview: `# Remediation foundation result\n\n${headline}\n\n${metricsText}\n\n${safetyText}\n\n${delayNote}\n\nSee [scorecard](SCORECARD.md), [contract and replay](README.md), and [attempt ledger](../../docs/sessions/20261023-byos-remediation/attempts.md).\n\n${limits}\n`,
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
  const { buildDecision } = await import("./decision.mjs");
  const decision = await buildDecision(records,
    (file) => readFile(path.resolve(root, "../..", file)),
    (file) => readFile(path.resolve(root, file)), report.summary);
  // This compatibility file is foundation lineage only. Current R5/R6 status
  // belongs to the fully validated decision, never obsolete NOT_RUN defaults.
  Object.assign(report.summary, {
    scope: "A1–A3 foundation lineage; current acceptance in decision-summary.json",
    fullSafety: decision.summary.safety ? "PASS_OFFLINE" : "NOT_ACCEPTED",
    rendererCrashes: decision.summary.safety ? "PASS_12_NATIVE_INDEXEDDB_RENDERER_CASES" : "NOT_ACCEPTED",
    normalDiagnostics: decision.summary.cells ? "PASS_120_PAIRED_TRIALS" : "NOT_ACCEPTED",
    latencyPercentiles: decision.summary.cells ? "ELIGIBLE_SYNTHETIC_ONLY" : "INELIGIBLE_UNTIL_HARD_GATES",
  });
  await writeFile(
    path.join(root, "evidence/foundation-summary.json"),
    JSON.stringify(report.summary, null, 2) + "\n",
  );
  await writeFile(path.join(root, "evidence/decision-summary.json"), JSON.stringify(decision.summary, null, 2) + "\n");
  await writeFile(path.join(root, "SCORECARD.md"), decision.scorecard);
  await writeFile(path.join(root, "SUMMARY.md"), decision.overview);
  console.log(
    JSON.stringify({
      status: decision.summary.decision,
      gaps: decision.summary.gaps,
    }),
  );
  if (!decision.summary.passed) process.exitCode = 1;
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await main();

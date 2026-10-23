import { archiveSources, saveRun } from "./evidence.mjs";
const stages = {
  A6: { module: "./browser.mjs", run: "browserMatrix", hypothesis: "Complete acknowledged revisions and truthful pending/conflict state survive real Chromium IndexedDB renderer crashes at six observed persistence/transport boundaries on both mock providers" },
  A5: { module: "./safety.mjs", run: "safetyMatrix", hypothesis: "The immutable-CAS route retains complete acknowledged intent, truthful state and visible recovery across 100 seeded hierarchical trials at 10/1000 pages and both providers, including actual response delivery inversion" },
  A4: { module: "./hierarchy.mjs", run: "hierarchyWitnesses", hypothesis: "Deletion and incarnation suppression must expose every retained acknowledged body as visible recovery-needed, including a single child head and stale old-incarnation head" },
};
const id = process.argv[2]?.toUpperCase();
if (!stages[id]) throw new Error(`Unimplemented stage ${id}`);
const source = await archiveSources();
let output, error;
try {
  output = await (await import(stages[id].module))[stages[id].run]();
  if (output.passed === false) error = { message: "Acceptance witness failed; see full actual observations" };
} catch (e) { error = { message: e.message, stack: e.stack }; output = e.evidence; }
const receipt = await saveRun({ id, hypothesis: stages[id].hypothesis, command: `node spikes/byos-remediation/src/run-stage.mjs ${process.argv.slice(2).join(" ")}`, source, result: error ? "FAIL" : "PASS", output, error, kind: process.argv.includes("--validation") ? "validation" : "hypothesis", progress: error ? "Observed acceptance gap retained; no PASS credit" : "Stage passed; see raw criteria coverage and remaining report gates", nextDecision: error ? "Repair observed in-scope gap and retain failed evidence" : "Continue remaining R1–R6 acceptance work" });
console.log(JSON.stringify(receipt));
if (error) { console.error(error); process.exitCode = 1; }

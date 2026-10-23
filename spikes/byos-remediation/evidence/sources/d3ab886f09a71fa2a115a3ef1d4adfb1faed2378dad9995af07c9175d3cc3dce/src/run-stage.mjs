import { archiveSources, saveRun } from "./evidence.mjs";
const stages = {
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
const receipt = await saveRun({ id, hypothesis: stages[id].hypothesis, command: `node spikes/byos-remediation/src/run-stage.mjs ${id}`, source, result: error ? "FAIL" : "PASS", output, error, kind: process.argv.includes("--validation") ? "validation" : "hypothesis", progress: error ? "Observed acceptance gap retained; no PASS credit" : "Stage passed; see raw criteria coverage and remaining report gates", nextDecision: error ? "Repair observed in-scope gap and retain failed evidence" : "Continue remaining R1–R6 acceptance work" });
console.log(JSON.stringify(receipt));
if (error) { console.error(error); process.exitCode = 1; }

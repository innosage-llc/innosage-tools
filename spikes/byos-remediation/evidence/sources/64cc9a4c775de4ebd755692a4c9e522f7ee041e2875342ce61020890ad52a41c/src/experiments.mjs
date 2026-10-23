import { a1, a2, a3 } from "./focused.mjs";
import { archiveSources, saveRun } from "./evidence.mjs";
const experiments = {
  A1: { run: a1, hypothesis: "Immutable complete revisions preserve concurrent acknowledged bodies through reopen, with recoverable conflicts and strict content identity" },
  A2: { run: a2, hypothesis: "Coherent GET validators plus conditional snapshot union recover competing writes and never put the local ACK behind held network work" },
  A3: { run: a3, hypothesis: "Exact-set readback receipts and bounded retries retain acknowledged full bodies and truthful state through faults; direct snapshots remove timestamp/listing cursor stranding" },
};
const mode = process.argv[2] ?? "focused";
const selected = mode === "focused" ? Object.keys(experiments) : [mode.toUpperCase()];
for (const id of selected) {
  if (!experiments[id]) throw new Error(`Unknown implemented experiment: ${id}`);
  const source = await archiveSources();
  let output, error;
  try { output = await experiments[id].run(); } catch (e) { error = { message: e.message, stack: e.stack }; }
  const record = await saveRun({ id, hypothesis: experiments[id].hypothesis, command: `npm --prefix spikes/byos-remediation run focused -- ${id}`, source, result: error ? "FAIL" : "PASS", output, error,
    progress: error ? "Unresolved witness; inspect raw failure. No acceptance credit." : "Focused witness passed. Full R1-R7 acceptance remains incomplete.",
    nextDecision: error ? "Repair within authorized scope and preserve this failed source/result" : id === "A3" ? "Freeze foundation for independent Astra HIGH review; resume larger matrix afterward" : "Continue next focused witness",
    kind: mode === "focused" ? "validation" : "hypothesis" });
  console.log(JSON.stringify(record));
  if (error) { console.error(error); process.exitCode = 1; break; }
}

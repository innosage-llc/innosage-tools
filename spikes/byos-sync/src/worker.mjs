import { trial } from "./trial.mjs";
const config = JSON.parse(process.argv[2]);
let result;
try {
  result = await trial(config);
} catch (e) {
  result = {
    ...config,
    status: "ERROR",
    error: { message: e.message, stack: e.stack },
    completed_runs: 0,
    failed_runs: 1,
    timed_out_runs: 0,
  };
}
await new Promise((resolve, reject) =>
  process.send(result, (e) => (e ? reject(e) : resolve())),
);
process.disconnect();

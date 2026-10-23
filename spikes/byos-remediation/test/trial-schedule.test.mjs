import test from "node:test";
import assert from "node:assert/strict";
import { safetySchedule, trialPlan } from "../src/trial-schedule.mjs";

test("the planned matrix uses 100 distinct seeds with both providers and scales", () => {
  const rows = safetySchedule();
  assert.equal(rows.length, 100);
  assert.equal(new Set(rows.map((r) => r.seed)).size, 100);
  for (const provider of ["drive", "webdav"]) for (const scale of [10, 1000]) {
    assert.equal(rows.filter((r) => r.provider === provider && r.scale === scale).length, 25);
  }
  assert.deepEqual(safetySchedule(), rows);
});

test("seeded page choices stay distinct and in bounds and vary the recovery order", () => {
  const orders = new Set();
  for (const row of safetySchedule()) {
    const [a, b] = row.differentPageIndices;
    assert.notEqual(a, b);
    assert.ok(a >= 5 && b >= 5 && a < row.scale - 1 && b < row.scale - 1);
    assert.deepEqual(trialPlan(row.provider, row.scale, row.seed), row);
    orders.add(row.recoveryOrder.join());
  }
  assert.equal(orders.size, 2);
  assert.throws(() => trialPlan("real-provider", 1000, 1), /Invalid/);
});

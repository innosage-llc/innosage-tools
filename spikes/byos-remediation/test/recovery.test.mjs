import test from "node:test";
import assert from "node:assert/strict";
import { hierarchyWitnesses } from "../src/hierarchy.mjs";
import { lifecycleWitness } from "../src/safety.mjs";

test("suppressed child and stale incarnation retain full visible recovery", async () => {
  const result = await hierarchyWitnesses();
  assert.equal(result.passed, true); assert.equal(result.results.length, 2);
});
for (const provider of ["drive", "webdav"]) test(`${provider}: delete/edit, recreation and explicit manual resolution survive reopen`, async () => {
  const result = await lifecycleWitness(provider);
  assert.equal(result.passed, true); assert.equal(result.expected.length, 7);
});

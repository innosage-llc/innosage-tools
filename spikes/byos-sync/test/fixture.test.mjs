import test from "node:test";
import assert from "node:assert/strict";
import { matchesFixture } from "../src/fixture-oracle.mjs";
const fixture = [
  { id: "parent", parentId: null, body: "one", editIds: [] },
  { id: "child", parentId: "parent", body: "two", editIds: [] },
];
test("equal replicas missing the same baseline page do not match fixture", () => {
  assert.equal(matchesFixture([[fixture[0]], [fixture[0]]], fixture), false);
});
test("full fixture matching checks stable identity, parent relationship and Markdown", () => {
  for (const key of ["id", "parentId", "body"]) {
    const altered = structuredClone(fixture);
    altered[1][key] = "incorrect";
    assert.equal(matchesFixture([altered, altered], fixture), false);
  }
  assert.equal(matchesFixture([fixture, fixture], fixture), true);
});

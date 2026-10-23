import test from "node:test";
import assert from "node:assert/strict";
import { measure } from "../src/metrics.mjs";
test("unknown media and v2 weights cannot become zero quota", () => {
  const r = measure(
    [
      {
        method: "GET",
        path: "/drive/v3/files/x",
        query: { alt: "media" },
        status: 200,
        bytes_up: 0,
        bytes_down: 10,
      },
      {
        method: "GET",
        path: "/drive/v3/files",
        query: {},
        status: 200,
        bytes_up: 0,
        bytes_down: 20,
      },
    ],
    "drive",
  );
  assert.equal(r.known_quota_units, 100);
  assert.equal(r.unknown_quota_requests, 1);
  assert.equal(
    r.by_method_endpoint["GET v3.files.get.media"].quota_weight,
    "UNKNOWN",
  );
});
test("WebDAV does not inherit Drive quota accounting", () => {
  assert.equal(measure([], "webdav").known_quota_units, "NOT_APPLICABLE");
});

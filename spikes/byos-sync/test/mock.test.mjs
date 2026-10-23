import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "../src/mock.mjs";
test("Drive fields, pagination, conditional writes and fail-closed API subset", async () => {
  const m = await mock({ sameTime: true });
  try {
    for (let i = 0; i < 4; i++)
      m.create(
        { name: `p${i}`, parents: ["docs"], mimeType: "application/json" },
        Buffer.from("{}"),
      );
    const first = await (
      await fetch(
        m.url +
          "/drive/v3/files?pageSize=2&fields=nextPageToken,files(id,name)&q=" +
          encodeURIComponent("'docs' in parents"),
      )
    ).json();
    assert.equal(first.files.length, 2);
    assert.equal(first.nextPageToken, "2");
    assert.deepEqual(Object.keys(first.files[0]), ["id", "name"]);
    const f = first.files[0].id;
    const before = await fetch(m.url + `/drive/v2/files/${f}`);
    const etag = before.headers.get("etag");
    assert.equal(
      (
        await fetch(m.url + `/upload/drive/v2/files/${f}?uploadType=media`, {
          method: "PUT",
          headers: { "If-Match": "wrong" },
          body: "new",
        })
      ).status,
      412,
    );
    assert.equal(
      (
        await fetch(m.url + `/upload/drive/v2/files/${f}?uploadType=media`, {
          method: "PUT",
          headers: { "If-Match": etag },
          body: "new",
        })
      ).status,
      200,
    );
    assert.equal((await fetch(m.url + "/drive/v3/changes")).status, 501);
    assert.equal(m.unsupported.length, 1);
  } finally {
    await m.close();
  }
});
test("WebDAV unknown-success commits bytes while caller sees transport failure", async () => {
  const m = await mock();
  try {
    m.faults.push({ method: "PUT", kind: "unknown-success" });
    await assert.rejects(
      fetch(m.url + "/dav/backup.zip", { method: "PUT", body: "acknowledged" }),
    );
    assert.equal(
      await (await fetch(m.url + "/dav/backup.zip")).text(),
      "acknowledged",
    );
  } finally {
    await m.close();
  }
});

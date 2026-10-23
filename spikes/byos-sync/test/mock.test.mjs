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
test("payload fault excludes lease and records actual mutation before lost response", async () => {
  const m = await mock();
  try {
    const lease = m.create({ name: "transaction.json" });
    const page = m.create({ name: "page-id" });
    const fault = {
      method: "PUT",
      fileId: page.id,
      fileName: page.name,
      bodyContains: "unique-intent",
      kind: "unknown-success",
    };
    m.faults.push(fault);
    const write = (id, body) =>
      fetch(m.url + `/upload/drive/v2/files/${id}?uploadType=media`, {
        method: "PUT",
        body,
      });
    await write(lease.id, "unique-intent");
    await write(page.id, "unrelated");
    assert.equal(fault.used, undefined);
    await assert.rejects(write(page.id, "unique-intent"));
    assert.equal(fault.matched.file_id, page.id);
    assert.equal(fault.matched.mutation_applied, true);
    assert.equal(fault.matched.response_delivered, false);
    assert.equal(page.body.toString(), "unique-intent");
  } finally {
    await m.close();
  }
});
test("pre-write barrier cannot be credited as remote mutation", async () => {
  const m = await mock();
  try {
    m.create({ id: "dav" }, Buffer.from("baseline"));
    const fault = { method: "PUT", fileId: "dav", kind: "hold-before-write" };
    m.faults.push(fault);
    const request = fetch(m.url + "/dav/backup.zip", {
      method: "PUT",
      body: "new",
      signal: AbortSignal.timeout(100),
    }).catch(() => {});
    await request;
    assert.equal(fault.used, true);
    assert.equal(fault.matched.mutation_applied, false);
    assert.equal(m.files.get("dav").body.toString(), "baseline");
  } finally {
    await m.close();
  }
});

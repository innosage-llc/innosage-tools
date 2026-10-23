import { mock } from "./mock.mjs";
import { replica, intercept } from "./candidates.mjs";
const m = await mock();
const undo = intercept(m);
let a, b;
try {
  a = await replica(
    process.argv[2] ?? "selfstore",
    "testa" + Date.now(),
    m,
    "drive",
  );
  b = await replica(
    process.argv[2] ?? "selfstore",
    "testb" + Date.now(),
    m,
    "drive",
  );
  await a.put({ id: "page0001", parentId: null, body: "hi", editIds: ["e1"] });
  if (a.connect) await a.connect();
  await a.sync();
  if (b.connect) await b.connect();
  await b.sync();
  console.log(
    JSON.stringify(
      {
        a: await a.read(),
        b: await b.read(),
        status: a.status(),
        requests: m.requests,
        unsupported: m.unsupported,
      },
      null,
      2,
    ),
  );
} finally {
  await a?.close();
  await b?.close();
  undo();
  await m.close();
}

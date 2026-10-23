import http from "node:http";
export const CONTRACT = "byos-loopback-v2";
export const NETWORKS = {
  fast: { rtt: 0, jitter: 0 },
  normal: { rtt: 8, jitter: 2 },
  degraded: { rtt: 35, jitter: 10 },
};
export async function mock({
  seed = 1,
  network = "fast",
  sameTime = false,
} = {}) {
  const control = {
    offline: false,
    cors: true,
    omitEtag: false,
    hiddenIds: [],
  };
  const responseCache = new Map();
  let completion = 0;
  const epoch = Date.now();
  let serial = 0,
    tick = 0,
    rng = seed >>> 0;
  const files = new Map(),
    requests = [],
    faults = [],
    unsupported = [];
  const random = () => {
    rng = (1664525 * rng + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const stamp = () => new Date(epoch + (sameTime ? 0 : ++tick)).toISOString();
  const meta = (f) => ({
    id: f.id,
    name: f.name,
    title: f.name,
    mimeType: f.mimeType,
    parents: f.parents,
    trashed: false,
    createdTime: f.createdTime,
    createdDate: f.createdTime,
    modifiedTime: f.modifiedTime,
    modifiedDate: f.modifiedTime,
    size: String(f.body.length),
    fileSize: String(f.body.length),
    version: String(f.version),
    etag: `"${f.version}"`,
  });
  function create(m = {}, body = Buffer.alloc(0)) {
    const date = stamp();
    const f = {
      id: m.id ?? `f${++serial}`,
      name: m.name ?? "backup.zip",
      mimeType: m.mimeType ?? "application/octet-stream",
      parents: m.parents ?? [],
      body,
      version: 1,
      createdTime: date,
      modifiedTime: date,
    };
    files.set(f.id, f);
    return f;
  }
  const server = http.createServer(async (req, res) => {
    const start = performance.now(),
      chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks),
      u = new URL(req.url, "http://localhost");
    const entry = {
      method: req.method,
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      bytes_up: body.length,
      bytes_down: 0,
      status: null,
      if_match: req.headers["if-match"] ?? null,
    };
    requests.push(entry);
    const preset = NETWORKS[network];
    await new Promise((r) =>
      setTimeout(
        r,
        Math.max(0, preset.rtt + (random() * 2 - 1) * preset.jitter),
      ),
    );
    const objectId =
      u.pathname === "/dav/backup.zip"
        ? "dav"
        : u.pathname.match(/\/files\/([^/]+)$/)?.[1];
    const object = files.get(objectId);
    let fault = faults.find(
      (f) =>
        !f.used &&
        (!f.method || f.method === req.method) &&
        (!f.path || u.pathname.includes(f.path)) &&
        (!f.fileId || f.fileId === objectId) &&
        (!f.fileName || f.fileName === object?.name) &&
        (!f.bodyContains || body.includes(f.bodyContains)),
    );
    if (fault) {
      fault.used = true;
      fault.matched = {
        file_id: objectId ?? null,
        file_name: object?.name ?? null,
        method: req.method,
        path: u.pathname,
        operation: ["PUT", "PATCH"].includes(req.method)
          ? "payload-update"
          : req.method.toLowerCase(),
        version_before: object?.version ?? null,
        mutation_applied: false,
        response_delivered: false,
        request_body_bytes: body.length,
      };
    }
    const mutated = (f) => {
      if (fault)
        Object.assign(fault.matched, {
          mutation_applied: true,
          version_after: f.version,
          stored_body_matches_request: f.body.equals(body),
        });
    };
    const finish = (status, data = "", headers = {}) => {
      const responseKey = req.method + req.url;
      responseCache.set(responseKey, { status, data, headers });
      headers = { ...headers };
      if (control.omitEtag) {
        delete headers.ETag;
        delete headers.etag;
      }
      if (fault) fault.matched.response_delivered = true;
      entry.completion_order = ++completion;
      const bytes = Buffer.isBuffer(data)
        ? data
        : Buffer.from(typeof data === "string" ? data : JSON.stringify(data));
      entry.status = status;
      entry.bytes_down = req.method === "HEAD" ? 0 : bytes.length;
      entry.duration_ms = performance.now() - start;
      res.writeHead(status, {
        Date: new Date(Date.now() + tick).toUTCString(),
        "content-type": "application/json",
        ...(control.cors ? { "access-control-allow-origin": "*" } : {}),
        "access-control-expose-headers": "ETag,Date,Last-Modified",
        "access-control-allow-methods":
          "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
        "access-control-allow-headers": "Authorization,Content-Type,If-Match",
        ...headers,
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
    };
    if (control.status)
      return finish(control.status, {
        error: "persistent synthetic access revoked",
      });
    if (control.offline) return finish(503, { error: "synthetic offline" });
    if (fault?.status)
      return finish(fault.status, {
        error: {
          message: fault.status === 403 ? "rateLimitExceeded" : "injected",
        },
      });
    if (fault?.kind === "drop-before") {
      entry.status = "DROPPED";
      return req.socket.destroy();
    }
    if (["timeout", "hold-before-write"].includes(fault?.kind)) {
      entry.status = "NO_RESPONSE";
      return;
    }
    if (["delayed-response", "reorder"].includes(fault?.kind))
      await new Promise((r) => setTimeout(r, 250));
    if (fault?.kind === "duplicate-response") {
      const cached = responseCache.get(req.method + req.url);
      if (cached) {
        entry.replayed_response = true;
        return finish(cached.status, cached.data, cached.headers);
      }
      entry.replay_cache_miss = true;
    }
    const project = (m, list = false) => {
      const fields = u.searchParams.get("fields");
      if (!fields) return m;
      const wanted = list ? fields.match(/files\(([^)]+)\)/)?.[1] : fields;
      return wanted
        ? Object.fromEntries(
            wanted
              .split(",")
              .map((k) => k.trim())
              .filter((k) => k in m)
              .map((k) => [k, m[k]]),
          )
        : m;
    };
    const send = (...args) => {
      if (fault?.kind === "hold-after-write") {
        entry.status = "HELD_AFTER_WRITE";
      } else if (fault?.kind === "unknown-success") {
        entry.status = "DROPPED_AFTER_WRITE";
        req.socket.destroy();
      } else finish(...args);
    };
    if (req.method === "OPTIONS") return finish(204);
    if (u.pathname === "/dav/backup.zip") {
      let f = files.get("dav");
      if (req.method === "PUT") {
        if (
          f &&
          req.headers["if-match"] &&
          req.headers["if-match"] !== meta(f).etag
        )
          return finish(412);
        if (!f) f = create({ id: "dav" });
        f.body = body;
        f.version++;
        f.modifiedTime = stamp();
        mutated(f);
        return send(204, "", { ETag: meta(f).etag });
      }
      if (["GET", "HEAD"].includes(req.method)) {
        if (!f) return finish(404);
        return send(200, f.body, {
          ETag: meta(f).etag,
          "Last-Modified": new Date(f.modifiedTime).toUTCString(),
          "content-type": f.mimeType,
        });
      }
    }
    const match = u.pathname.match(
      /^\/(upload\/)?drive\/(v2|v3)\/files(?:\/([^/]+))?$/,
    );
    if (match) {
      const [, upload, version, id] = match;
      let f = files.get(id);
      if (req.method === "GET" && !id && !upload) {
        let list = [...files.values()].filter(
          (f) => !control.hiddenIds.includes(f.id),
        );
        const q = u.searchParams.get("q") ?? "";
        const names = [...q.matchAll(/name\s*=\s*'([^']*)'/g)].map((m) => m[1]),
          parent = q.match(/'([^']+)' in parents/),
          mime = q.match(/mimeType\s*=\s*'([^']+)'/),
          after = q.match(/modifiedTime\s*>=\s*'([^']+)'/);
        if (names.length) list = list.filter((f) => names.includes(f.name));
        if (parent) list = list.filter((f) => f.parents.includes(parent[1]));
        if (mime) list = list.filter((f) => f.mimeType === mime[1]);
        if (after) list = list.filter((f) => f.modifiedTime >= after[1]);
        const order = u.searchParams.get("orderBy") ?? "";
        list.sort((a, b) =>
          order.includes("modifiedTime")
            ? a.modifiedTime.localeCompare(b.modifiedTime) ||
              a.name.localeCompare(b.name)
            : a.createdTime.localeCompare(b.createdTime),
        );
        const page = Number(u.searchParams.get("pageToken") ?? 0),
          size = Math.min(1000, Number(u.searchParams.get("pageSize") ?? 100));
        const out = {
          files: list
            .slice(page, page + size)
            .map((f) => project(meta(f), true)),
        };
        if (
          page + size < list.length &&
          (u.searchParams.get("fields") ?? "").includes("nextPageToken")
        )
          out.nextPageToken = String(page + size);
        return send(200, out);
      }
      if (req.method === "POST" && !id) {
        let m,
          b = Buffer.alloc(0);
        if (upload) {
          const boundary = req.headers["content-type"]
            ?.match(/boundary=([^;]+)/)?.[1]
            ?.replace(/^"|"$/g, "");
          if (!boundary) return finish(400, "missing boundary");
          const parts = body.toString().split(`--${boundary}`).slice(1, -1);
          m = JSON.parse(parts[0].split("\r\n\r\n")[1].trim());
          b = Buffer.from(
            parts[1]
              .split("\r\n\r\n")
              .slice(1)
              .join("\r\n\r\n")
              .replace(/\r\n$/, ""),
          );
        } else m = JSON.parse(body);
        f = create(m, b);
        return send(200, project(meta(f)), { ETag: meta(f).etag });
      }
      if (id && !f) return finish(404);
      if (req.method === "GET" && id && !upload)
        return send(
          200,
          u.searchParams.get("alt") === "media" ? f.body : project(meta(f)),
          {
            ETag: meta(f).etag,
            "content-type":
              u.searchParams.get("alt") === "media"
                ? f.mimeType
                : "application/json",
          },
        );
      if (
        id &&
        upload &&
        ((version === "v2" && req.method === "PUT") ||
          (version === "v3" && req.method === "PATCH"))
      ) {
        if (req.headers["if-match"] && req.headers["if-match"] !== meta(f).etag)
          return finish(412);
        f.body = body;
        f.version++;
        f.modifiedTime = stamp();
        mutated(f);
        return send(200, project(meta(f)), { ETag: meta(f).etag });
      }
      if (id && req.method === "DELETE") {
        if (req.headers["if-match"] && req.headers["if-match"] !== meta(f).etag)
          return finish(412);
        files.delete(id);
        return send(204);
      }
    }
    unsupported.push(`${req.method} ${req.url}`);
    finish(501, { error: "UNIMPLEMENTED_API" });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    control,
    url: `http://127.0.0.1:${server.address().port}`,
    files,
    requests,
    faults,
    unsupported,
    create,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  };
}

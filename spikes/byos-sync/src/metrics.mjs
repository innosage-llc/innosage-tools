import { readFileSync } from "node:fs";
const profile = JSON.parse(
  readFileSync(new URL("../quota-profile.json", import.meta.url)),
);
export function endpoint(r) {
  if (r.path.startsWith("/dav/")) return "webdav.object";
  const v = r.path.includes("/v2/") ? "v2" : "v3";
  let method =
    r.method === "GET"
      ? r.path.endsWith("/files")
        ? "list"
        : r.query.alt === "media"
          ? "get.media"
          : "get.metadata"
      : ["PUT", "PATCH"].includes(r.method)
        ? "update"
        : r.method === "POST"
          ? "create"
          : r.method.toLowerCase();
  return `${v}.files.${method}`;
}
export function measure(requests, provider) {
  const groups = {};
  for (const r of requests) {
    const key = r.method + " " + endpoint(r);
    const g = (groups[key] ??= {
      requests: 0,
      bytes_up: 0,
      bytes_down: 0,
      statuses: {},
      conditional_requests: 0,
      quota_weight:
        provider === "webdav"
          ? "NOT_APPLICABLE"
          : (profile.weights[endpoint(r)] ?? "UNKNOWN"),
    });
    g.requests++;
    g.bytes_up += r.bytes_up;
    g.bytes_down += r.bytes_down;
    g.statuses[r.status] = (g.statuses[r.status] ?? 0) + 1;
    g.conditional_requests += Number(!!r.if_match);
  }
  const values = Object.values(groups);
  return {
    requests: requests.length,
    by_method_endpoint: groups,
    bytes_up: values.reduce((s, g) => s + g.bytes_up, 0),
    bytes_down: values.reduce((s, g) => s + g.bytes_down, 0),
    known_quota_units:
      provider === "webdav"
        ? "NOT_APPLICABLE"
        : values.reduce(
            (s, g) =>
              s +
              (typeof g.quota_weight === "number"
                ? g.requests * g.quota_weight
                : 0),
            0,
          ),
    unknown_quota_requests:
      provider === "webdav"
        ? "NOT_APPLICABLE"
        : values
            .filter((g) => g.quota_weight === "UNKNOWN")
            .reduce((s, g) => s + g.requests, 0),
    quota_profile: provider === "webdav" ? "NOT_APPLICABLE" : profile.id,
  };
}
export function compact(r) {
  if (!r.requests) return r;
  r.measurements = measure(r.requests, r.provider);
  for (const p of Object.values(r.phases ?? {})) {
    p.measurements = measure(p.requests, r.provider);
    delete p.requests;
  }
  if (
    r.seed !== 84 ||
    !["same-page", "same-time-boundary", "restart-offline"].includes(r.scenario)
  ) {
    delete r.observations?.after_restart;
    delete r.observations?.conflicts_before_restart;
    delete r.observations?.conflicts_after_restart;
  }
  delete r.requests;
  delete r.stderr;
  return r;
}

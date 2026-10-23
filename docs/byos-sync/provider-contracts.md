# Provider contracts and limits

Retrieved 2026-10-23. Labels distinguish SOURCE-VERIFIED contracts, MOCK-TESTED observations, INFERRED architecture judgments and REAL-PROVIDER-NOT-RUN limitations.

## Google Drive quota profile

[Official limits](https://developers.google.com/workspace/drive/api/guides/limits), updated 2026-09-11: new projects from 2026-05-01 have 1,000,000 units/project/minute, 325,000 units/user/project/minute, a 400,000,000-unit daily billing threshold and 1 TB daily project egress threshold. Projects active November 2025–April 2026 retain prior quotas; their actual configured values are UNKNOWN here.

Explicit method examples: files.get 5; files.list 100; files.download 200; files.update 50; files.generateIds 5 quota units/request. Exact unlisted method and media/v2 mappings remain UNKNOWN rather than inferred from HTTP verbs. Report known subtotals and unknown-weight request counts separately; a partial subtotal is not a total. WebDAV does not consume Drive quota units. Request counts and bytes remain separate measurements.

403 rate-limit and 429 responses warrant bounded exponential backoff with jitter. Billing prices and monetary extrapolations are UNKNOWN. No project quota, bill, real Drive latency or actual provider traffic is measured.

## Mock fidelity boundaries

The harness implements the bounded matrix below. Raw per-attempt `by_method_endpoint` counters determine which routes an actual candidate used; support in the mock alone is not execution evidence. Unsupported routes return 501 and invalidate a core trial. Injected visibility delay, duplicate/drop/reorder, uncertain write acknowledgement and clock anomalies are adversarial hypotheses, not assertions that Google exhibits them. A successful loopback conditional-write test does not establish Google concurrency semantics or OAuth interoperability.

| Mock route / contract | Native caller / modeled behavior | Fidelity limit |
| --- | --- | --- |
| `GET /drive/v3/files` | RxDB directory/document listing; name, parent, MIME and modifiedTime filters; ordered results; pageSize, numeric pageToken and requested field projection | Bounded query parser; not full Drive conformance. Equal-time checkpoint behavior comes from the native RxDB caller. |
| `POST /drive/v3/files`, `POST /upload/drive/v3/files` | RxDB metadata and multipart file creation | Synthetic IDs and timestamps; no actual OAuth, scopes, permissions or account limits. |
| `GET /drive/v2/files/:id`, `GET /drive/v3/files/:id` | Native metadata/media reads; ETag, Date and selected metadata fields | Body-byte counts exclude headers/TLS. Exact media/v2 quota weight UNKNOWN. |
| `PUT /upload/drive/v2/files/:id`, `PATCH /upload/drive/v3/files/:id` | RxDB/selfstore native media writes; mock If-Match mismatch returns 412 | Conditional interoperability with real Drive is unverified; implemented as HTTP/upstream contract assumption. |
| `DELETE /drive/v2/files/:id` or `/drive/v3/files/:id` | Bounded file removal with conditional check when supplied | Whether a candidate uses this route is recorded by actual request counters. Page tombstones are engine data, distinct from deleting remote files. |
| `GET`, `HEAD`, `PUT`, `OPTIONS /dav/backup.zip` | selfstore native WebDAV snapshot target; ETag/If-Match, Last-Modified and CORS headers | Single synthetic object; no PROPFIND/LOCK server, TLS, real credentials or operator availability test. Missing ETag/CORS are separate probes. |
| Injected 401 / rate-limit 403 / 429 / 500; no response, drop-before-write, unknown-success write | Controlled fault schedule with used/not-used receipt and bounded outcome | Synthetic failure timing/payloads; no empirical provider failure rates or quota-saturation result. |

The implemented request/response details are auditable in [mock.mjs](../../spikes/byos-sync/src/mock.mjs) and the unmodified package adapters are identified in [source-screen.md](source-screen.md). Source contract references and the local response model are **SOURCE-VERIFIED**; runtime observations are **MOCK-TESTED** only. All real-provider paths remain **REAL-PROVIDER-NOT-RUN**.

[HTTP conditional request semantics](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match) and [WebDAV](https://www.rfc-editor.org/rfc/rfc4918) define the standards context for ETag/If-Match tests. An upstream adapter's use of a header establishes its dependency on that behavior; it does not prove a real server honors it. Keep missing-conditionals and browser CORS capability as explicit compatibility probes.

[Drive change tracking](https://developers.google.com/workspace/drive/api/guides/manage-changes) is a separate API design from modifiedTime listing. Compare each engine's actual code path; do not substitute a change-feed algorithm into an upstream candidate.

## Native WebDAV versus a Drive gateway

[rclone serve WebDAV](https://rclone.org/commands/rclone_serve_webdav/) exposes a configured remote through an additional HTTP server. Its ETag behavior and CORS/TLS/authentication configuration are operator concerns. This is an external gateway, not a native Google Drive WebDAV endpoint. Architecture-only assessment: a Drive gateway adds an availability dependency, credentials, deployment, cache/conditional-write semantics and unknown hosting cost; it does not remove underlying Drive quota consumption. No gateway was deployed or benchmarked.

For the same selfstore engine, compare native mock Drive and native mock WebDAV with identical data and latency inputs. Their client-side protocol overhead is measurable; real provider service latency, availability and total cost remain unknown.

## Future real-provider smoke — proposal only, NOT RUN

After separate authorization, use one dedicated test account and an isolated synthetic folder/app-data namespace, with the least applicable OAuth scope. Confirm consent/revocation and documented per-request quotas; set explicit request/byte/time budgets before running. Exercise two isolated browser profiles through one create/update/reload journey, one concurrent same-page edit with durable recovery inspection, and one offline/auth-expiry failure. Capture exact package/config versions, actual request mix and final state, then remove only the specifically authorized synthetic fixture using an agreed recoverable cleanup procedure. Stop on unexpected provider calls, loss, budget exhaustion or auth mismatch. This plan grants no live execution permission.

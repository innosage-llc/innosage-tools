# Use a revision-bound OCC snapshot, not after-read freshness

## Actual corrected-version trial retained
On3050957, routine selection of the sole existing account renewed the same
client/drive.file session without new credentials, permissions or security bypass.
Same-origin reload retained complete acknowledged Markdown, journal and original
session/editID. One A Verify still hit the AFTER guard: transaction role showed
version-only drift and also ETag/revision/size drift consistent with native contention; its cause was not independently proven.
Normal Disconnect stopped dispatches; final186 =GET200163,POST2006,PUT20016,
PUT4121. busy=false,reauth-required,local body=protected journal; no remote verified
body/checkpoint or B sync. No induced offline errors in this trial. Before/after
stable-origin release checks matched3050957. Prior real failures remain HOLD.

## Correct mechanism and sources
The previous bridge imposed freshness after a read, stronger than snapshot
consistency. An atomic body+ETag response can also become stale immediately.
A single File metadata response binds strong file ETag E1 to head revision R1,
size and MIME. Download exactly R1, verify byte length, return E1 unchanged.
If the file later changes, native If-Match:E1 yields412. Do not reread/adopt E2,
retry the read, alter native writes or infer the snapshot is always current.

- https://developers.google.com/workspace/drive/api/reference/rest/v2/files
- https://developers.google.com/workspace/drive/api/reference/rest/v2/files/get
- https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match

For size-zero snapshots, actual empty bytes identify the unique empty body even
without a head revision. A concurrent nonempty download rejects by length; return
only the original E0, never a later validator. Unsupported identity/validator/
size/version/MIME, required nonempty revision, range, mismatched caller revision
and failed downloads still fail closed. Keep no-store and existing request budgets.
Each guarded media read now uses two requests rather than three.

Independent source-first assessment supports this standard OCC mechanism. It
inherits native lease/ownership/fencing limitations; no general lease guarantee,
new engine, native fork, dependency change or stronger production claim.

## Evidence/oracle correction, explicitly recorded
Old after-read drift and strict-zero version tests remain in historical3050957
source/results and private copies. They asserted extra freshness requirements;
that is not required to correlate bytes with the ORIGINAL validator. They are
superseded, not retroactively green. Three new snapshot assertions failed on the
old bridge (extra reread, legitimate concurrent update, empty snapshot) then passed.

Focused current tests cover original E1/R1 pairing with two requests; real-like
concurrent E2/R2 followed by exact installed native stale PUT412 (no retry, E2 body
unchanged); headless empty0/'00'; empty->nonempty rejection; unsupported metadata,
wrong revision/range/length and failed downloads without fallback. Existing native
acquisition one-owner/one-retry tests remain.16 focused tests PASS. Existing native mock integration PASS694dispatches with complete bodies/conflicts/checkpoint assertions. Source/security review PASS; native gates and actual corrected-source qualification follow.

Authoritative main also contains preexisting Visual Remix PR119 (dc115e5),
preserved as the new baseline. This change edits only BYOS paths and this guide;
no owner84/85 session/worktree is used. Shared staging writes will be checked for
concurrent deployment before dispatch; do not roll back unrelated integrated work.

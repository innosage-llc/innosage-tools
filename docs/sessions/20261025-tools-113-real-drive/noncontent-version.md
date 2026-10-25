# Contract correction: file version is not a content-change oracle

## Exact observed failure (not rewritten)
Founder authorized both fixed-origin profiles on1953de9. One A Verify remote
captured RC_PUSH -> MEDIA_VERSION_CHANGED at request57, role=wal:
version increased; file ETag/headRevisionId/fileSize/MIME stayed equal. Complete
acknowledged Markdown remained identical to the protected journal/editID. No
remote verification/checkpoint/B sync. Lead set A offline to stop live retries;
final166 observations:GET200114,POST2003,PUT2002,PUT4121,GET_NETWORK_ERROR46.
The46 offline errors were induced client-side, not Google failures. busy=false,
status=blocked; old tabs and all historical negative traces remain intact.

## Applicable primary contract and review
https://developers.google.com/workspace/drive/api/reference/rest/v2/files
Defines version as reflecting every server change including invisible changes;
headRevisionId identifies content's head revision, and etag is the file validator.
Therefore an increased version alone with equal pinned content/CAS identity does
not demonstrate changed bytes. Independent source-first assessment supports the
narrow correction below. No claim about what hidden server change occurred.

## App-owned correlation rule correction
Nonempty reads still require checked metadata, strong file ETag, explicit head
revision download, exact byte length, matching ETag/headRevisionId/size/MIME in
fresh before/after samples. Permit only a nondecreasing version for that path.
Reject decreases, any other identity drift, unsupported metadata and size errors.
Zero-byte bootstrap retains exact version equality (no content revision to pin).
No later-validator substitution, new read retries, writes or requests. Native
RxDB17.6.0, native lease/CAS/If-Match/conflict policy and dependencies unchanged.
This does not solve arbitrary native lease fencing; it inherits those limitations.

## Historical fixture assumption correction
The original test at1953de9 called version-only drift with unchanged ETag and
headRevisionId an ABA counterexample. It did not demonstrate changed content or
a changed pinned revision. Preserve its historical source/result; do not treat
it as an authoritative provider contract. Its current replacement requires a
new head revision even if bytes and ETag are restored; that remains rejected.
The separate new version-only-success regression first failed on1953de9 with
MEDIA_VERSION_CHANGED (retained /tmp/tools113-version-red.log), then passed on
the correction. Original test source is retained privately and in Git history.
No prior real attempt is retroactively green.

21 focused tests PASS, including permitted nonempty version-only increase;
rejected decrease/head/ETag/size/MIME drift and empty-file version drift;
unchanged stale conditional PUT412. Existing native mock integration also run.
Actual corrected-source Google qualification remains necessary after review,
repository gates and exact staging integration; no new live retry yet.

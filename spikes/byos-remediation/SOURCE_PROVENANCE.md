# Source archive verification

File entries in every `evidence/sources/<digest>/manifest.json` are SHA-256 of
exact file bytes. The directory name is an aggregate hash of that manifest's
serialization, not the hash of the pretty-printed manifest file itself.

Two aggregate encodings were used and are retained unchanged:

- Initial A1 `abb9baba1f0fd4fcfca5fa555d0e8cc4d01cea1cda964a6595979ac3a83d545f`
  and A2 `da02ed0ad96e153e470f30439c96a36c9db352d5a71f056f5613790a8d23e98f`:
  UTF-8 bytes of Python `json.dumps(manifest, sort_keys=True)` with its default
  separators (a space after comma/colon) and ASCII escaping, with no newline.
- A3 and subsequent `archiveSources()` snapshots: UTF-8 bytes of JavaScript
  `JSON.stringify(manifest)` preserving the manifest's insertion order, compact
  separators, with no newline. Keys and hash values are ASCII in these manifests.
  The Python equivalent below is exact for these string-to-string manifests.

From the product root, this verifies each aggregate and every dependency/source
file hash without modifying any archive or raw evidence:

```sh
python3 - <<'PY'
from pathlib import Path
import hashlib, json
root = Path('spikes/byos-remediation')
legacy = {
    'abb9baba1f0fd4fcfca5fa555d0e8cc4d01cea1cda964a6595979ac3a83d545f',
    'da02ed0ad96e153e470f30439c96a36c9db352d5a71f056f5613790a8d23e98f',
}
for archive in sorted((root / 'evidence/sources').iterdir()):
    manifest = json.loads((archive / 'manifest.json').read_text())
    serialized = (json.dumps(manifest, sort_keys=True) if archive.name in legacy
                  else json.dumps(manifest, separators=(',', ':'), ensure_ascii=False))
    assert hashlib.sha256(serialized.encode('utf-8')).hexdigest() == archive.name
    for name, expected in manifest.items():
        if name == '../byos-sync/src/mock.mjs':
            archived = archive / 'dependencies/byos-sync/mock.mjs'
            source = archived if archived.exists() else root / name
        elif name.startswith('../byos-sync/'):
            source = root / name
        else:
            source = archive / name
        assert hashlib.sha256(source.read_bytes()).hexdigest() == expected, source
    print(archive.name, 'PASS')
PY
```

The A1/A2 archives record the unchanged baseline mock hash but predate copying
that dependency into each archive. Later snapshots also record the baseline
lockfile hash. If the baseline files are unavailable or changed, restore the
manifest-matching files from baseline commit
`496e9a8a1b605c81e71026d0ab217e6ccb9f41a4` before verification/replay. Do not
silently substitute current files with different hashes. Archive replay must use
the original sibling directory layout described in [README](README.md).

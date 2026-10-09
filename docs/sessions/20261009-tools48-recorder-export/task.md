# Tools #48 recorder export

Founder approved implementation after #49 staging exposed mismatched WebM/M4A
and missing duration on streamed files. Parent Epic #47; sibling #49 remains open.
No production permission, user audio, server processing or issue closure.

- Unify encoder/picker/extension; explicit native AAC before honest WebM/Opus.
- Serialize final writes, surface failure, wait for close before Saved.
- Bound WebM header processing to 64 KiB and patch Duration without remuxing.
- Direct disk pending writes capped at 16 MiB; download buffer capped at 256 MiB.
- Validate synthetic duration/seek, pause/repeat/error cases and native gates.
- Merge through repository workflow, deploy exact staging revision, then Founder
  acceptance; no repeated version bump (prepared version 0.1.1).

Status: VERIFYING. UI worker complete; independent library/UI review PASS after
repairing immediate source release and oversized single browser chunks. Ten
focused tests, TypeScript and targeted ESLint pass. Local Chrome 145/macOS 26.5.2
real UI recordings: AAC disk 60.351542 s, WebM disk 60.394799 s, pause/download
AAC 6.587250 s and WebM 6.610700 s (6 s active + 2 s pause); all errors <1 s.
ffprobe confirms one audio stream AAC/MP4 or Opus/WebM; reopened browser playback
and beginning/middle/end seeks pass. Native desktop-player checks ongoing.
Disk automation injects an OPFS picker: actual writable stream, not OS-dialog
acceptance. Historical #15/#17 overlap inspected, not merged. Native full gate,
PR/merge, final staging and bounded longer synthetic soak still pending.

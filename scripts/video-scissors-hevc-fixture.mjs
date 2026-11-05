// Only public synthetic media. macOS AVFoundation supplies HEVC; no dependency,
// remote service or private input. Presets do not upscale the 640×360 demo.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
assert.equal(process.platform, 'darwin', 'HEVC fixtures require macOS AVFoundation');
const directory = resolve('.deploy/video-scissors-hevc');
mkdirSync(directory, { recursive: true });
for (const [command, args] of [
  ['/usr/bin/avconvert', ['--source', resolve('public/video-scissors/demo.mp4'), '--preset', 'PresetHEVCHighestQuality', '--duration', '3', '--output', resolve(directory, 'hevc-aac-640x360.mp4'), '--replace']],
  ['/usr/bin/swift', [resolve('scripts/video-scissors-hevc-fixture.swift'), resolve(directory, 'hevc-silent-2160x3842.mp4')]],
]) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
}
console.log('Generated local HEVC/AAC 640×360 and silent HEVC 2160×3842 fixtures in .deploy/video-scissors-hevc');

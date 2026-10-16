import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public/video-scissors/ffmpeg');
const ffmpegEsm = join(root, 'node_modules/@ffmpeg/ffmpeg/dist/esm');
const coreEsm = join(root, 'node_modules/@ffmpeg/core/dist/esm');
mkdirSync(target, { recursive: true });

const runtimeFiles = readdirSync(ffmpegEsm).filter((name) => name.endsWith('.js'));
if (!runtimeFiles.includes('worker.js')) throw new Error('Locked @ffmpeg/ffmpeg worker.js is missing.');
for (const name of runtimeFiles) cpSync(join(ffmpegEsm, name), join(target, name));
cpSync(join(coreEsm, 'ffmpeg-core.js'), join(target, 'ffmpeg-core.js'));
const wasm = readFileSync(join(coreEsm, 'ffmpeg-core.wasm'));
writeFileSync(join(target, 'core.wasm.gz'), gzipSync(wasm, { level: 9 }));
console.log(`Prepared local FFmpeg runtime (${runtimeFiles.length + 2} files; WASM compressed).`);

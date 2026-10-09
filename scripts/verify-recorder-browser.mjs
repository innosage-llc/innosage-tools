// Optional live acceptance harness; requires agent-browser and FFmpeg on PATH.
// Uses synthetic WebAudio only. Disk mode uses a real OPFS writable stream with
// an injected picker, NOT proof of the operating-system save dialog.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const endpoint = process.argv[2];
if (!endpoint) throw new Error('Usage: node scripts/verify-recorder-browser.mjs <recorder-url> [aac|webm] [seconds]');
const codec = process.argv[3] || 'aac';
assert.ok(['aac', 'webm'].includes(codec));
const seconds = Number(process.argv[4] || 60);
assert.ok(Number.isFinite(seconds) && seconds >= 2 && seconds <= 600);
const directory = mkdtempSync(join(tmpdir(), `tools-recorder-${codec}-`));
const session = `tools48-${codec}-acceptance`;
const browser = (...args) => execFileSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 90_000 });
const evaluate = source => {
  const raw = execFileSync('agent-browser', ['--session', session, 'eval', '--stdin'], { input: source, encoding: 'utf8', timeout: 90_000 });
  return JSON.parse(raw);
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const reports = [];
try {
  for (const [mode, length, pause] of [['disk', seconds, false], ['download', 3, true]]) {
    browser('open', endpoint);
    browser('snapshot', '-i');
    const setup = evaluate(`(async()=>{
      const supported=MediaRecorder.isTypeSupported.bind(MediaRecorder);
      if(${JSON.stringify(codec)}==='webm') MediaRecorder.isTypeSupported=mime=>!mime.includes('mp4')&&supported(mime);
      window.__tone=new AudioContext();await window.__tone.resume();
      const dest=window.__tone.createMediaStreamDestination();window.__osc=window.__tone.createOscillator();
      window.__osc.frequency.value=440;window.__osc.connect(dest);window.__osc.start();
      navigator.mediaDevices.getUserMedia=async()=>dest.stream.clone();
      navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audioinput',deviceId:'synthetic',label:'Synthetic tone'}];
      if(${JSON.stringify(mode)}==='disk'){
        const root=await navigator.storage.getDirectory();window.__saved=await root.getFileHandle('synthetic.${codec === 'aac' ? 'm4a' : 'webm'}',{create:true});
        window.showSaveFilePicker=async()=>window.__saved;
      }else window.showSaveFilePicker=undefined;
      return {ua:navigator.userAgent,aac:supported('audio/mp4;codecs=mp4a.40.2')};
    })()`);
    if (codec === 'aac') assert.ok(setup.aac, 'AAC unavailable: exercise honest WebM fallback instead');
    browser('click', 'button:has-text("Start Recording")');
    browser('wait', 'button[aria-label="Stop recording"]');
    await wait(length * 1000);
    if (pause) {
      browser('click', 'button[aria-label="Pause recording"]');
      await wait(2000);
      browser('click', 'button[aria-label="Resume recording"]');
      await wait(length * 1000);
    }
    const file = join(directory, `${codec}-${mode}.${codec === 'aac' ? 'm4a' : 'webm'}`);
    if (mode === 'download') browser('download', 'button[aria-label="Stop recording"]', file);
    else browser('click', 'button[aria-label="Stop recording"]');
    browser('wait', 'text=Recording Finalized');
    const summary = browser('get', 'text', 'main');
    assert.match(summary, mode === 'disk' ? /location you chose/ : /download/);
    evaluate(`window.__osc.stop();window.__tone.close();true`);
    if (mode === 'disk') {
      evaluate(`(async()=>{const file=await window.__saved.getFile();const link=document.createElement('a');link.id='synthetic-export';link.textContent='Download synthetic recording';link.href=URL.createObjectURL(file);link.download=file.name;document.body.appendChild(link);return true;})()`);
      browser('download', '#synthetic-export', file);
    }
    const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name,duration,size:stream=codec_name,codec_type', '-of', 'json', file], { encoding: 'utf8' }));
    assert.equal(metadata.streams.length, 1); assert.equal(metadata.streams[0].codec_type, 'audio');
    assert.equal(metadata.streams[0].codec_name, codec === 'aac' ? 'aac' : 'opus');
    const duration = Number(metadata.format.duration);
    const expected = pause ? length * 2 : length;
    assert.ok(duration > 0 && Number.isFinite(duration));
    assert.ok(Math.abs(duration - expected) <= 1, `duration ${duration} vs ${expected}`);
    execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { timeout: 60_000 });
    // Reopen the actual saved bytes, not the recording stream. agent-browser
    // upload goes through the file input; content stays on the local test machine.
    evaluate(`(()=>{const input=document.createElement('input');input.type='file';input.id='reopen-recording';document.body.appendChild(input);return true})()`);
    browser('upload', '#reopen-recording', file);
    const playback = evaluate(`(async()=>{
      const audio=document.createElement('audio');audio.controls=true;document.body.appendChild(audio);
      audio.src=URL.createObjectURL(document.querySelector('#reopen-recording').files[0]);
      await new Promise((r,j)=>{audio.onloadedmetadata=r;audio.onerror=()=>j(Error('decode failed'))});
      if(!Number.isFinite(audio.duration)||audio.duration<=0)throw Error('nonfinite duration');
      const seeks=[];for(const target of [audio.duration*.5,.1,audio.duration-.25]){
        await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('seek timeout')),5000);audio.onseeked=()=>{clearTimeout(timer);r()};audio.currentTime=target;});
        await audio.play();await new Promise(r=>setTimeout(r,80));audio.pause();
        seeks.push({target,actual:audio.currentTime});
      }return {duration:audio.duration,seeks};
    })()`);
    for (const seek of playback.seeks) assert.ok(Math.abs(seek.actual - seek.target) < .5);
    reports.push({ codec, mode, synthetic: true, expectedSeconds: expected, duration, errorSeconds: Math.abs(duration - expected), bytes: Number(metadata.format.size), playback, browser: setup.ua, diskPicker: mode === 'disk' ? 'injected-real-OPFS' : 'not-used', ffmpegDecode: 'PASS' });
    console.log(JSON.stringify(reports.at(-1)));
  }
} finally { browser('close'); }
console.log(JSON.stringify({ reports, syntheticFiles: directory, result: 'PASS' }));

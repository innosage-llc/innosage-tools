// Public-safe synthetic input: red/440 Hz, green/880 Hz, blue/1320 Hz, 20s each.
// No recordings, user media or external downloads are used.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const output = resolve(process.argv[2] || 'public/video-scissors/demo.mp4');
mkdirSync(dirname(output), { recursive: true });
const video = 'color=c=red:s=640x360:r=24:d=60';
const audio = 'aevalsrc=sin(2*PI*if(lt(t\\,20)\\,440\\,if(lt(t\\,40)\\,880\\,1320))*t):s=48000:d=60';
const filter = "drawbox=c=green:t=fill:enable='gte(t,20)*lt(t,40)',drawbox=c=blue:t=fill:enable='gte(t,40)',drawtext=text='SYNTHETIC - original %{pts\\:hms}':fontsize=30:fontcolor=white:x=(w-tw)/2:y=(h-th)/2";
const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', video, '-f', 'lavfi', '-i', audio, '-vf', filter,
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-shortest', output],
  { stdio: 'inherit' });
if (result.error || result.status !== 0) process.exit(1);
console.log('Synthetic 60-second video generated.');

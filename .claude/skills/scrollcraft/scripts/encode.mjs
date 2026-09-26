#!/usr/bin/env node
/* Encode a clip so it SCRUBS rather than plays.
   Seeking lands on keyframes. A normally-encoded clip has one every ~2s, which
   gives roughly 15 usable positions across a whole act — the page appears to
   stutter and stick. So: every frame a keyframe, no B-frames.
   Cost: roughly 3–5x the file size. Keep scrubbed clips to 4–8 seconds. */
import { execFileSync, execFile } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('usage: node encode.mjs <in> <out.mp4> [--width 1600] [--fps 30] [--crf 22]');
  process.exit(1);
}
const [input, output] = args;
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i > -1 ? args[i + 1] : dflt; };

function findFfmpeg() {
  const candidates = [process.env.SCROLLCRAFT_FFMPEG, 'ffmpeg', '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'].filter(Boolean);
  for (const c of candidates) {
    try {
      const f = execFileSync(c, ['-hide_banner', '-filters'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const e = execFileSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (/(^|\n)\s\S+\s+scale\s/.test(f) && /libx264/.test(e)) return c;
    } catch {}
  }
  return null;
}

const ffmpeg = findFfmpeg();
if (!ffmpeg) {
  console.error('No usable ffmpeg.\n' +
    'A stripped build (no `scale` filter) will report this as a syntax error in the\n' +
    'command, which is why this checks capability rather than presence.\n' +
    'Install a full ffmpeg, or set SCROLLCRAFT_FFMPEG. Run: node scripts/doctor.mjs');
  process.exit(1);
}

const ff = [
  '-y', '-i', input, '-an',
  '-vf', `scale=${opt('width', '1600')}:-2,fps=${opt('fps', '30')}`,
  '-c:v', 'libx264', '-profile:v', 'high', '-crf', opt('crf', '22'),
  '-g', '1', '-keyint_min', '1', '-sc_threshold', '0', '-bf', '0',
  '-movflags', '+faststart',
  output,
];
console.log(`${path.basename(ffmpeg)} ${ff.join(' ')}`);
execFile(ffmpeg, ff, (err, _o, stderr) => {
  if (err) { console.error(stderr.split('\n').slice(-16).join('\n')); process.exit(1); }
  console.log(`\nwrote ${output} — every frame a keyframe, so it seeks anywhere.`);
});

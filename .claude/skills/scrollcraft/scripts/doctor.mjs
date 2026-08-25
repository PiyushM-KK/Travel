#!/usr/bin/env node
/* Preflight. Run this FIRST, always.
   The three most common setup faults all surface later as errors that point at
   the wrong thing:
     - a stripped ffmpeg reports a missing filter as a syntax error in your command
     - a missing WebP muxer reports as a bad filename
     - playwright-core resolving from the wrong directory reports as a missing browser
   So each check below tests the CAPABILITY, not the presence of a binary. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolveWorkspace } from './workspace.mjs';

const OK = '\x1b[32m  ok  \x1b[0m';
const WARN = '\x1b[33m warn \x1b[0m';
const FAIL = '\x1b[31m fail \x1b[0m';
let hardFail = false;

const line = (state, name, detail) => console.log(`[${state}] ${name.padEnd(22)} ${detail || ''}`);

/* ------------------------------------------------------------------ node */
{
  const major = +process.versions.node.split('.')[0];
  if (major >= 18) line(OK, 'node', `v${process.versions.node}`);
  else { line(FAIL, 'node', `v${process.versions.node} — need 18+`); hardFail = true; }
}

/* ---------------------------------------------------------------- ffmpeg */
const FFMPEG_CANDIDATES = [
  process.env.SCROLLCRAFT_FFMPEG,
  'ffmpeg',
  '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg',
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
].filter(Boolean);

function probeFfmpeg(bin) {
  try {
    const filters = execFileSync(bin, ['-hide_banner', '-filters'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const count = filters.split('\n').filter((l) => /^\s\S\S\S?\s+\S+\s+/.test(l)).length;
    const hasScale = /(^|\n)\s\S+\s+scale\s/.test(filters);
    const encoders = execFileSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const hasX264 = /libx264/.test(encoders);
    const hasWebp = /libwebp/.test(encoders);
    return { bin, count, hasScale, hasX264, hasWebp };
  } catch { return null; }
}

{
  let found = null;
  for (const c of FFMPEG_CANDIDATES) {
    const r = probeFfmpeg(c);
    if (r && r.hasScale && r.hasX264) { found = r; break; }
    if (r && !found) found = r;               // remember a stripped one to explain it
  }
  if (!found) {
    line(WARN, 'ffmpeg', 'not found — only needed to encode video for scrubbing');
    console.log('        a page built from stills needs no ffmpeg at all.');
  } else if (!found.hasScale || !found.hasX264) {
    line(WARN, 'ffmpeg', `stripped build at ${found.bin} (${found.count} filters, scale=${found.hasScale}, libx264=${found.hasX264})`);
    console.log('        This build CANNOT encode scrub-ready video. It will report a missing');
    console.log('        filter as a syntax error in your command. Install a full ffmpeg, or set');
    console.log('        SCROLLCRAFT_FFMPEG to one. Stills-only builds are unaffected.');
  } else {
    line(OK, 'ffmpeg', `${found.bin} (${found.count} filters, scale + libx264)`);
    if (!found.hasWebp) console.log('        note: no libwebp — .webp output will report as a bad filename.');
  }
}

/* ------------------------------------------------------- playwright-core */
let chromePath = null;
{
  const require = createRequire(path.join(process.cwd(), 'noop.js'));
  let pw = null;
  try { pw = require.resolve('playwright-core'); }
  catch {
    try { pw = createRequire(import.meta.url).resolve('playwright-core'); } catch {}
  }
  if (!pw) {
    line(WARN, 'playwright-core', 'not installed — the verification pass cannot run');
    console.log('        npm i playwright-core   (in the build folder, or the project root)');
  } else {
    line(OK, 'playwright-core', path.relative(process.cwd(), pw) || pw);
  }
}

/* ---------------------------------------------------------------- chrome */
{
  const candidates = [
    process.env.SCROLLCRAFT_CHROME,
    '/opt/pw-browsers/chromium',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    let exe = c;
    if (fs.statSync(c).isDirectory()) {
      const inner = ['chrome-linux/chrome', 'chrome-linux/headless_shell', 'chrome'].map((r) => path.join(c, r));
      exe = inner.find((p) => fs.existsSync(p)) || null;
      if (!exe) continue;
    }
    chromePath = exe;
    break;
  }
  if (chromePath) line(OK, 'chrome', chromePath);
  else {
    line(WARN, 'chrome', 'not found — set SCROLLCRAFT_CHROME, or let playwright download one');
  }
}

/* ------------------------------------------------------------- workspace */
{
  const ws = resolveWorkspace();
  const exists = fs.existsSync(ws.dir);
  line(exists ? OK : WARN, 'workspace', `${ws.dir}  (${ws.via})`);
  if (!exists) console.log('        node scripts/workspace.mjs --ensure');
  else {
    const reg = path.join(ws.dir, 'FINGERPRINTS.md');
    const rows = fs.existsSync(reg)
      ? fs.readFileSync(reg, 'utf8').split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-+/.test(l) && !/\| Grammar \|/.test(l)).length
      : 0;
    line(OK, 'registry', `${rows} build${rows === 1 ? '' : 's'} recorded`);
  }
}

console.log('');
if (hardFail) { console.log('Blocked. Fix the failures above before building.'); process.exit(1); }
console.log('Ready. Warnings above only limit what you can build, not whether you can build.');

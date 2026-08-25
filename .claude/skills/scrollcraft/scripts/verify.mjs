#!/usr/bin/env node
/* ============================================================================
   scrollcraft verification pass

   Walks the finished page at every scroll position in a headless browser,
   waits for the video playhead to settle, and reports:

     1. dead scroll        — scroll that changes nothing on screen
     2. cues that never arrive — copy the reader can only ever see faded
     3. contrast, measured on the COMPOSITED page, per line, at the brightest
        frame that ever passes under that line, with the direction picked per
        line so light-on-dark and dark-on-light are both graded correctly
     4. legs stuck on a poster — a clip that silently never decoded, which
        looks exactly like a paused film

   Then it writes a contact sheet, because a machine can prove a page works and
   cannot tell you it means anything.

   usage: node verify.mjs <url> [--out verify-out] [--steps 40] [--settle 900]
                                [--width 1440] [--height 900]
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--'));
if (!url) { console.error('usage: node verify.mjs <url> [--out dir] [--steps n] [--settle ms]'); process.exit(1); }
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i > -1 ? argv[i + 1] : d; };

const OUT = path.resolve(opt('out', 'verify-out'));
const STEPS = +opt('steps', 40);
const SETTLE = +opt('settle', 900);
const VW = +opt('width', 1440);
const VH = +opt('height', 900);

/* ------------------------------------------------------------- playwright */
function loadPlaywright() {
  for (const base of [path.join(process.cwd(), 'noop.js'), import.meta.url]) {
    try { return createRequire(base)('playwright-core'); } catch {}
  }
  console.error('playwright-core is not installed.\n' +
    '  npm i playwright-core\n' +
    'Note: it must resolve from a directory this script can see — resolving from the\n' +
    'wrong directory reports as a missing BROWSER, not a missing module.');
  process.exit(1);
}
function findChrome() {
  const c = [process.env.SCROLLCRAFT_CHROME, '/opt/pw-browsers/chromium',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch {} }
  return undefined;
}

/* =============================== in-page: what the reader is actually shown */
const COLLECT = function () {
  function effOpacity(el) {
    let o = 1, n = el;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
      o *= parseFloat(cs.opacity);
      n = n.parentElement;
    }
    return o;
  }
  function keyFor(el, text) {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 6) {
      const p = n.parentElement;
      const i = p ? Array.prototype.indexOf.call(p.children, n) : 0;
      parts.unshift(n.tagName.toLowerCase() + i);
      n = p;
    }
    return parts.join('>') + '#' + text.slice(0, 28).replace(/\s+/g, ' ').trim();
  }

  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue;
    if (!text || !text.trim() || text.trim().length < 2) continue;
    const el = node.parentElement;
    if (!el || el.closest('.sc-vh, script, style, noscript')) continue;
    const cs = getComputedStyle(el);
    const op = effOpacity(el);
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects());
    for (const r of rects) {
      if (r.width < 6 || r.height < 6) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      out.push({
        key: keyFor(el, text),
        text: text.trim().slice(0, 60),
        opacity: op,
        color: cs.color,
        size: parseFloat(cs.fontSize),
        weight: +cs.fontWeight || 400,
        rect: { x: Math.max(0, r.left), y: Math.max(0, r.top),
                w: Math.min(innerWidth, r.right) - Math.max(0, r.left),
                h: Math.min(innerHeight, r.bottom) - Math.max(0, r.top) },
      });
    }
  }

  const videos = Array.from(document.querySelectorAll('video')).map((v) => ({
    src: (v.currentSrc || v.getAttribute('src') || '').split('/').pop(),
    scrubbed: v.hasAttribute('data-sc-scrub'),
    readyState: v.readyState,
    currentTime: v.currentTime,
    duration: isFinite(v.duration) ? v.duration : null,
  }));

  return { lines: out, videos, scrollY: window.pageYOffset };
};

/* ============ in-page (helper tab): measure the composited pixels behind text */
const ANALYSE = function (payload) {
  const { dataUrl, cleanUrl, boxes, dpr } = payload;
  const load = (src) => new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src;
  });
  return Promise.all([load(dataUrl), load(cleanUrl)]).then(function (imgs) {
    const img = imgs[0], clean = imgs[1];
    return new Promise((resolve) => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      // the same frame with every glyph made transparent. Sampling THIS is the
      // only way to know what is behind a line: antialiased glyph edges span the
      // whole range between ink and ground, so any attempt to filter glyphs out
      // of a normal screenshot grades large type against its own halo.
      const cc = document.createElement('canvas');
      cc.width = clean.width; cc.height = clean.height;
      const cctx = cc.getContext('2d', { willReadFrequently: true });
      cctx.drawImage(clean, 0, 0);

      /* ---- a 64x64 grayscale signature, for dead-scroll detection ---- */
      const sc = document.createElement('canvas');
      sc.width = 64; sc.height = 64;
      const sctx = sc.getContext('2d');
      sctx.drawImage(img, 0, 0, 64, 64);
      const sd = sctx.getImageData(0, 0, 64, 64).data;
      const sig = new Array(64 * 64);
      for (let i = 0, j = 0; i < sd.length; i += 4, j++) {
        sig[j] = (sd[i] * 0.2126 + sd[i + 1] * 0.7152 + sd[i + 2] * 0.0722) | 0;
      }

      const srgb = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const lum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
      const ratio = (a, b) => { const hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05); };

      const results = boxes.map((box) => {
        const x = Math.round(box.rect.x * dpr), y = Math.round(box.rect.y * dpr);
        const w = Math.max(1, Math.round(box.rect.w * dpr)), h = Math.max(1, Math.round(box.rect.h * dpr));
        if (x + w > cc.width || y + h > cc.height || w < 2 || h < 2) return null;
        const d = cctx.getImageData(x, y, w, h).data;

        const m = box.color.match(/[\d.]+/g) || [0, 0, 0];
        const tLum = lum(+m[0], +m[1], +m[2]);

        const px = [];
        for (let i = 0; i < d.length; i += 4) px.push([lum(d[i], d[i + 1], d[i + 2]), d[i], d[i + 1], d[i + 2]]);
        if (px.length < 8) return null;
        px.sort((a, b) => a[0] - b[0]);

        const median = px[px.length >> 1][0];
        const lightOnDark = tLum > median;
        // the WORST ground under this line: for light ink the brightest pixel
        // that ever sits behind it, for dark ink the darkest. 96th percentile so
        // a single stray pixel does not decide the grade.
        const pick = lightOnDark
          ? px[Math.min(px.length - 1, Math.floor(px.length * 0.96))]
          : px[Math.max(0, Math.floor(px.length * 0.04))];

        const bg = { r: pick[1], g: pick[2], b: pick[3] };
        const cr = ratio(tLum, pick[0]);
        const large = box.size >= 24 || (box.size >= 19 && box.weight >= 700);
        return {
          key: box.key, text: box.text, contrast: cr,
          required: large ? 3 : 4.5,
          direction: lightOnDark ? 'light-on-dark' : 'dark-on-light',
          bg: `rgb(${bg.r},${bg.g},${bg.b})`, color: box.color,
          size: box.size, rect: box.rect,
        };
      }).filter(Boolean);

      resolve({ sig, results });
    });
  }).catch(() => ({ sig: null, results: [] }));
};

/* ===================================================================== main */
const { chromium } = loadPlaywright();

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage', '--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const helper = await ctx.newPage();
await helper.goto('about:blank');

const pageErrors = [];      // real script failures. These are the page's fault.
const assetFailures = [];   // resources that did not load. Often the network.
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('requestfailed', (r) => assetFailures.push(`${r.url()} (${(r.failure() || {}).errorText || 'failed'})`));
page.on('response', (r) => { if (r.status() >= 400) assetFailures.push(`${r.url()} (HTTP ${r.status()})`); });

console.log(`\nwalking ${url}  (${VW}x${VH}, ${STEPS} steps, ${SETTLE}ms settle)\n`);
await page.goto(url, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(1200);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });

const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
const maxScroll = Math.max(1, docHeight - VH);

const maxOpacity = new Map();      // key -> highest opacity ever reached
const lineText = new Map();
const worstContrast = new Map();   // key -> worst measurement across the walk
const signatures = [];
const frames = [];
const videoTrack = new Map();

for (let i = 0; i < STEPS; i++) {
  const y = Math.round((i / (STEPS - 1)) * maxScroll);
  await page.evaluate((yy) => window.scrollTo(0, yy), y);

  // settle: two frames, the engine's own settled(), any in-flight video seek,
  // then the CSS transition window for cues
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const t0 = performance.now();
    while (window.scrollcraft && !window.scrollcraft.settled() && performance.now() - t0 < 2000) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const seeking = Array.from(document.querySelectorAll('video')).filter((v) => v.seeking);
    await Promise.all(seeking.map((v) => new Promise((r) => {
      const done = () => { v.removeEventListener('seeked', done); r(); };
      v.addEventListener('seeked', done); setTimeout(done, 1200);
    })));
  });
  await page.waitForTimeout(SETTLE);

  const state = await page.evaluate(COLLECT);
  const shot = await page.screenshot({ type: 'png' });
  // second pass: same frame, every glyph transparent. Element backgrounds,
  // borders and scrims stay, because those ARE the background of the line.
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.id = '__sc_noink';
    st.textContent = '*,*::before,*::after{color:transparent!important;' +
      '-webkit-text-fill-color:transparent!important;text-shadow:none!important;' +
      'text-decoration-color:transparent!important;caret-color:transparent!important}';
    document.head.appendChild(st);
  });
  const cleanShot = await page.screenshot({ type: 'png' });
  await page.evaluate(() => { const n = document.getElementById('__sc_noink'); if (n) n.remove(); });
  const file = `frames/f${String(i).padStart(3, '0')}.png`;
  fs.writeFileSync(path.join(OUT, file), shot);

  const { sig, results } = await helper.evaluate(ANALYSE, {
    dataUrl: 'data:image/png;base64,' + shot.toString('base64'),
    cleanUrl: 'data:image/png;base64,' + cleanShot.toString('base64'),
    boxes: state.lines, dpr: 1,
  });

  for (const l of state.lines) {
    maxOpacity.set(l.key, Math.max(maxOpacity.get(l.key) || 0, l.opacity));
    lineText.set(l.key, l.text);
  }
  for (const r of results) {
    // only grade a line the reader can actually see at this moment
    const line = state.lines.find((l) => l.key === r.key);
    if (!line || line.opacity < 0.85) continue;
    const prev = worstContrast.get(r.key);
    if (!prev || r.contrast < prev.contrast) worstContrast.set(r.key, { ...r, atY: y, frame: i });
  }
  for (const v of state.videos) {
    const t = videoTrack.get(v.src) || { src: v.src, scrubbed: v.scrubbed, maxReady: 0, times: new Set(), duration: v.duration };
    t.maxReady = Math.max(t.maxReady, v.readyState);
    t.times.add(Math.round(v.currentTime * 100) / 100);
    videoTrack.set(v.src, t);
  }

  signatures.push(sig);
  frames.push({ i, y, file, pct: maxScroll ? y / maxScroll : 0 });
  process.stdout.write(`\r  frame ${i + 1}/${STEPS}  y=${y}`);
}
process.stdout.write('\n\n');

/* ------------------------------------------------------------ 1. dead scroll */
function mad(a, b) {
  if (!a || !b) return 999;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}
const deadRuns = [];
let runStart = null;
for (let i = 1; i < signatures.length; i++) {
  const same = mad(signatures[i - 1], signatures[i]) < 0.6;
  if (same && runStart === null) runStart = i - 1;
  if (!same && runStart !== null) { deadRuns.push([runStart, i - 1]); runStart = null; }
}
if (runStart !== null) deadRuns.push([runStart, signatures.length - 1]);
const deadFindings = deadRuns
  .filter(([a, b]) => b - a >= 2)
  .map(([a, b]) => ({
    fromY: frames[a].y, toY: frames[b].y,
    pct: ((b - a) / (STEPS - 1)) * 100,
    frames: [a, b],
  }));

/* ----------------------------------------------- 2. cues that never arrive */
const fadedFindings = [...maxOpacity.entries()]
  .filter(([, o]) => o < 0.98)
  .map(([k, o]) => ({ key: k, text: lineText.get(k), max: o }))
  .sort((a, b) => a.max - b.max);

/* ------------------------------------------------------------ 3. contrast */
const contrastFindings = [...worstContrast.values()]
  .filter((r) => r.contrast < r.required)
  .sort((a, b) => a.contrast - b.contrast);

/* ------------------------------------------------------- 4. stuck posters */
const videoFindings = [...videoTrack.values()]
  .filter((v) => v.scrubbed)
  .filter((v) => v.maxReady < 3 || v.times.size <= 1)
  .map((v) => ({ src: v.src, readyState: v.maxReady, distinctTimes: v.times.size }));

/* ------------------------------------------------------------- the report */
const R = (n) => n.toFixed(2);
let fails = 0;
const say = (bad, label, body) => {
  if (bad) fails++;
  console.log(`${bad ? '\x1b[31mFAIL\x1b[0m' : '\x1b[32m ok \x1b[0m'}  ${label}`);
  if (body) console.log(body);
};

say(videoFindings.length > 0, `scrubbed video decoded (${videoTrack.size} clip${videoTrack.size === 1 ? '' : 's'})`,
  videoFindings.map((v) => `      ${v.src}: readyState peaked at ${v.readyState}, ${v.distinctTimes} distinct playhead position(s)\n` +
    `      This is a clip that never decoded. On screen it looks exactly like a paused film.`).join('\n') || null);

say(fadedFindings.length > 0, `every cue reaches full opacity (${maxOpacity.size} lines tracked)`,
  fadedFindings.slice(0, 12).map((f) => `      ${R(f.max)}  "${f.text}"`).join('\n') || null);

say(contrastFindings.length > 0, `contrast on the composited page (${worstContrast.size} lines graded)`,
  contrastFindings.slice(0, 12).map((f) =>
    `      ${R(f.contrast)}:1 (needs ${f.required}) ${f.direction}  ${f.color} on ${f.bg}  at y=${f.atY}\n` +
    `      "${f.text}"`).join('\n') || null);

const bigDead = deadFindings.filter((d) => d.pct > 12);
say(bigDead.length > 0, `no dead scroll (${deadFindings.length} still run${deadFindings.length === 1 ? '' : 's'} found)`,
  deadFindings.map((d) => `      ${d.pct.toFixed(1)}% of the page unchanged, y=${d.fromY}→${d.toY} (frames ${d.frames[0]}–${d.frames[1]})` +
    (d.pct > 12 ? '  <- too long to be a deliberate rest' : '  (short enough to be a deliberate rest — your call)')).join('\n') || null);

say(pageErrors.length > 0, 'no script errors',
  pageErrors.slice(0, 6).map((e) => '      ' + e.split('\n')[0]).join('\n') || null);

const uniqueAssets = [...new Set(assetFailures)];
if (uniqueAssets.length) {
  console.log(`\x1b[33mwarn\x1b[0m  ${uniqueAssets.length} resource(s) did not load`);
  uniqueAssets.slice(0, 8).forEach((a) => console.log('      ' + a));
  console.log('      An external font or asset failing here may be this machine, not the page.');
  console.log('      A missing LOCAL file is the page, and will look identical in this list.');
}

/* ---------------------------------------------------------- contact sheet */
const sheet = `<!doctype html><meta charset="utf-8"><title>contact sheet</title>
<style>
 body{margin:0;background:#14181d;color:#e8eef5;font:14px/1.5 system-ui,sans-serif;padding:32px}
 h1{font-size:20px;letter-spacing:-.02em;margin:0 0 4px} .sub{color:#93a3b5;margin:0 0 28px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px}
 figure{margin:0} img{width:100%;display:block;border-radius:8px;border:1px solid #2a323d;background:#000}
 figcaption{font-size:12px;color:#93a3b5;padding-top:8px;display:flex;justify-content:space-between}
 .bad{color:#ff8a80} .flag{display:block;color:#ffb26b;font-size:11.5px;padding-top:2px}
</style>
<h1>${url}</h1>
<p class="sub">${STEPS} frames · ${VW}×${VH} · ${fails === 0 ? 'no automated failures' : fails + ' check(s) failed'} ·
scroll it yourself before you believe any of this.</p>
<div class="grid">
${frames.map((f) => {
  const flags = [];
  if (deadFindings.some((d) => f.i >= d.frames[0] && f.i <= d.frames[1] && d.pct > 12)) flags.push('dead scroll');
  const c = contrastFindings.filter((x) => x.frame === f.i);
  if (c.length) flags.push(`${c.length} contrast failure${c.length === 1 ? '' : 's'}`);
  return `<figure><img src="${f.file}" loading="lazy" alt="frame at y=${f.y}">
  <figcaption><span>frame ${f.i}</span><span${flags.length ? ' class="bad"' : ''}>y=${f.y} · ${(f.pct * 100).toFixed(0)}%</span></figcaption>
  ${flags.map((x) => `<span class="flag">${x}</span>`).join('')}</figure>`;
}).join('\n')}
</div>`;
fs.writeFileSync(path.join(OUT, 'contact-sheet.html'), sheet);

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({
  url, viewport: [VW, VH], steps: STEPS, docHeight,
  dead: deadFindings, faded: fadedFindings,
  contrast: contrastFindings, video: videoFindings, pageErrors,
  assetFailures: [...new Set(assetFailures)],
}, null, 2));

console.log(`\ncontact sheet: ${path.join(OUT, 'contact-sheet.html')}`);
console.log('Open it. A machine can prove the page works; it cannot tell you it means anything.\n');

await browser.close();
process.exit(fails ? 1 : 0);

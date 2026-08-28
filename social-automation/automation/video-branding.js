/**
 * video-branding.js — turn a raw AI travel clip into a BRANDED 1080x1920 Reel with ffmpeg:
 * Skyline logo, a per-scene "EXPLORE <PLACE>" label timed to each cut, a bottom CTA bar (WhatsApp +
 * handle + tagline), and an honest "AI-generated · illustrative" credit. Output is always 1080x1920 so
 * it's Instagram-Reels-ready whether the source is 4K or 1080p (no separate downscale).
 *
 * Everything shells out to ffmpeg through an injectable `run(bin,args)` so the pure string-building
 * (buildBrandFilter) and the cut math (resolveCuts) are unit-testable with no ffmpeg installed.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

/** Default runner: execFile → { stdout, stderr }. Rejects only on spawn failure (ffmpeg's nonzero exit
 *  on `-f null` still yields stderr we need). 64MB buffer for ffmpeg's chatty stderr. */
function defaultRun(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.code === undefined) return reject(err); // spawn failure (ENOENT etc.)
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || ""), code: err ? err.code : 0 });
    });
  });
}

/** Detect scene-cut timestamps (seconds) via ffmpeg's scene filter. Returns ascending numbers. */
async function detectCuts(videoPath, opts = {}) {
  const ffmpeg = opts.ffmpeg || process.env.FFMPEG_PATH || "ffmpeg";
  const run = opts.run || defaultRun;
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : 0.25;
  const { stderr } = await run(ffmpeg, ["-hide_banner", "-i", videoPath, "-filter:v", `select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"]);
  return [...String(stderr).matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1])).filter(Number.isFinite).sort((a, b) => a - b);
}

/**
 * Reconcile detected cuts to exactly (sceneCount - 1) interior cut times. If detection gave the right
 * number, use it; otherwise fall back to EVEN splits over `duration` (so the labels are still sensibly
 * timed even when the detector under/over-fires). Returns ascending interior times.
 */
function resolveCuts(rawCuts, sceneCount, duration) {
  const need = Math.max(0, sceneCount - 1);
  const clean = (rawCuts || []).filter((t) => Number.isFinite(t) && t > 0.2 && t < duration - 0.2).sort((a, b) => a - b);
  if (clean.length === need) return clean;
  const even = [];
  for (let i = 1; i < sceneCount; i++) even.push(Math.round((duration * i / sceneCount) * 1000) / 1000);
  return even;
}

// Neutralise any character that could break OUT of a drawtext `text=` field and inject extra filtergraph
// options/filters (ffmpeg treats : ' [ ] ; , \ % and newlines as syntax). Today every interpolated value
// is static config (place names, the business phone), but this makes buildBrandFilter safe even if a
// future caller feeds it data-driven labels (e.g. from Airtable). Our real strings contain none of these,
// so it's lossless in practice. Legit punctuation we keep (· + @ - . spaces) passes through untouched.
function fgClean(s) {
  return String(s == null ? "" : s).replace(/[:'\[\];,\\%\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

/** Build the ffmpeg filtergraph string (1080x1920 canvas) for the branded overlay. Pure — testable. */
function buildBrandFilter(opts = {}) {
  const { scenes, cuts, fontDir = "assets/fonts" } = opts;
  const phone = fgClean(opts.phone || "+91 88660 50291");
  const handle = fgClean(opts.handle || "@skylinetravelplanner");
  const tagline = fgClean(opts.tagline || "Your Journey · Our Passion");
  const B = `${fontDir}/Poppins-Bold.ttf`, S = `${fontDir}/Poppins-SemiBold.ttf`, R = `${fontDir}/Poppins-Regular.ttf`;
  const p = [];
  p.push("[0:v]scale=1080:1920:flags=lanczos[base]");
  p.push("[base]drawbox=x=0:y=0:w=1080:h=330:color=black@0.28:t=fill,drawbox=x=0:y=1800:w=1080:h=120:color=black@0.58:t=fill,drawbox=x=32:y=40:w=330:h=104:color=white@0.95:t=fill[bgx]");
  p.push("[1:v]scale=270:-1[lg]");
  p.push("[bgx][lg]overlay=62:55[v1]");
  p.push(`[v1]drawbox=x=40:y=188:w=6:h=108:color=0xF4A21E:t=fill,drawtext=fontfile=${S}:text=EXPLORE:fontcolor=0xF4A21E:fontsize=27:x=62:y=188:shadowcolor=black@0.6:shadowx=2:shadowy=2[v2]`);
  let cur = "v2";
  scenes.forEach((sc, i) => {
    const start = i === 0 ? 0 : cuts[i - 1];
    const end = i === scenes.length - 1 ? null : cuts[i];
    const en = end == null ? `gte(t,${start})` : `between(t,${start},${end})`;
    const label = fgClean(sc.label).toUpperCase();
    const fsz = label.length > 9 ? 60 : 75; // shrink long names (e.g. MEGHALAYA)
    const nxt = `nm${i}`;
    p.push(`[${cur}]drawtext=fontfile=${B}:text=${label}:fontcolor=white:fontsize=${fsz}:x=60:y=218:shadowcolor=black@0.75:shadowx=2:shadowy=3:enable='${en}'[${nxt}]`);
    cur = nxt;
  });
  p.push(`[${cur}]drawtext=fontfile=${S}:text=Tailor-made India trips · planned with you on WhatsApp:fontcolor=white:fontsize=26:x=40:y=1823:shadowcolor=black@0.6:shadowx=1:shadowy=2[c1]`);
  p.push(`[c1]drawtext=fontfile=${S}:text=WhatsApp ${phone}:fontcolor=0x25D366:fontsize=27:x=40:y=1868:shadowcolor=black@0.6:shadowx=1:shadowy=2[c2]`);
  p.push(`[c2]drawtext=fontfile=${R}:text=·  ${handle}  ·  ${tagline}:fontcolor=white@0.9:fontsize=23:x=455:y=1870:shadowcolor=black@0.6:shadowx=1:shadowy=2[c3]`);
  p.push(`[c3]drawtext=fontfile=${R}:text=AI-generated · illustrative:fontcolor=white@0.62:fontsize=15:x=w-tw-20:y=1783[vout]`);
  return p.join(";\n");
}

/**
 * Render the branded Reel. inputPath = raw clip, logoPath = Skyline logo, scenes = [{label}] (in order),
 * cuts = interior cut times. Writes outPath (1080x1920 H.264 + AAC, faststart). Returns outPath.
 */
async function brandVideo(opts = {}) {
  const { inputPath, logoPath, outPath, scenes, cuts } = opts;
  const ffmpeg = opts.ffmpeg || process.env.FFMPEG_PATH || "ffmpeg";
  const run = opts.run || defaultRun;
  const cwd = opts.cwd || process.cwd(); // fontDir is relative to here
  const filter = buildBrandFilter({ scenes, cuts, fontDir: opts.fontDir, phone: opts.phone, handle: opts.handle, tagline: opts.tagline });
  const filterFile = opts.filterFile || path.join(os.tmpdir(), `vbrand-${scenes.map((s) => s.label).join("-")}-${cuts.join("_")}.txt`);
  fs.writeFileSync(filterFile, filter, "utf8");
  try {
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", inputPath, "-i", logoPath,
      "-/filter_complex", filterFile, "-map", "[vout]", "-map", "0:a?",
      "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outPath];
    const r = await run(ffmpeg, args, { cwd });
    if (opts.run) { /* test runner: trust it */ }
    else if (!fs.existsSync(outPath)) throw new Error("ffmpeg produced no output" + (r && r.stderr ? ": " + String(r.stderr).slice(-400) : ""));
    return outPath;
  } finally {
    if (!opts.keepFilter) { try { fs.unlinkSync(filterFile); } catch { /* best-effort */ } }
  }
}

module.exports = { detectCuts, resolveCuts, buildBrandFilter, brandVideo, defaultRun, fgClean };

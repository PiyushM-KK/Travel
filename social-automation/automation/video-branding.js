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
/**
 * Were REAL scene cuts detected, or would resolveCuts have to invent them? This matters for honesty, not
 * cosmetics: text-to-video models return ONE continuous shot, so falling back to even splits stamps three
 * different place names over thirds of a single location - telling the viewer they are seeing places that
 * are not in the footage. Callers must check this before labelling a clip with more than one destination.
 */
function hasRealCuts(rawCuts, sceneCount, duration) {
  const need = Math.max(0, sceneCount - 1);
  const clean = (rawCuts || []).filter((t) => Number.isFinite(t) && t > 0.2 && t < duration - 0.2);
  return clean.length === need;
}

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

/** Probe a clip's duration in seconds via ffprobe (ships with ffmpeg). 0 if unreadable. */
async function probeDuration(file, opts = {}) {
  const bin = opts.ffprobe || process.env.FFPROBE_PATH || "ffprobe";
  const run = opts.run || defaultRun;
  try {
    const { stdout } = await run(bin, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
    const n = parseFloat(String(stdout).trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

/**
 * Which spelling of "read the filtergraph from a FILE" does this ffmpeg understand?
 *
 * NOT a cosmetic difference, and not a typo (I mis-diagnosed it as one): ffmpeg 7 REMOVED
 * `-filter_complex_script FILE` in favour of the generic `-/filter_complex FILE` form. ffmpeg rejects the
 * entire argument list when it meets the wrong one, so the GitHub runner (pre-7, needs the _script form)
 * and a modern local box (9.x, needs the -/ form) each fail on the other's flag. Detect and pick.
 */
async function filterFileFlag(ffmpeg, run) {
  try {
    const r = await run(ffmpeg, ["-hide_banner", "-version"]);
    const text = String((r && r.stdout) || "") + String((r && r.stderr) || "");
    const m = /ffmpeg version n?(\d+)/i.exec(text);
    return m && Number(m[1]) >= 7 ? "-/filter_complex" : "-filter_complex_script";
  } catch { return "-filter_complex_script"; }
}

/**
 * Concatenate per-destination clips into ONE 1080x1920 montage, and return the EXACT cut boundaries.
 *
 * This is what makes a montage honest. A text-to-video model returns one continuous shot no matter how
 * the prompt is worded, so a single generation can never show three places - scene detection then finds
 * nothing and the labels get guessed. Generating one clip PER destination and joining them here means we
 * KNOW where each place starts and ends, so "EXPLORE LADAKH" is always over Ladakh footage.
 *
 * Every input is cover-cropped and normalised to a common size/fps/SAR first: ffmpeg's concat filter
 * requires identical geometry and will otherwise produce a garbled result rather than an error.
 */
async function concatClips(files, outPath, opts = {}) {
  const ffmpeg = opts.ffmpeg || process.env.FFMPEG_PATH || "ffmpeg";
  const run = opts.run || defaultRun;
  const fps = opts.fps || 24;
  if (!Array.isArray(files) || files.length === 0) throw new Error("concatClips needs at least one clip");

  const norm = files.map((_, i) =>
    `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1,fps=${fps}[c${i}]`);
  const chain = files.map((_, i) => `[c${i}]`).join("");
  const graph = `${norm.join(";")};${chain}concat=n=${files.length}:v=1:a=0[vout]`;

  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const f of files) args.push("-i", f);
  args.push("-filter_complex", graph, "-map", "[vout]",
    "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath);
  const r = await run(ffmpeg, args, { cwd: opts.cwd });
  if (!opts.run && !fs.existsSync(outPath)) {
    throw new Error("concat produced no output" + (r && r.stderr ? ": " + String(r.stderr).slice(-400) : ""));
  }

  // Interior boundaries = cumulative durations, so they line up with the labels exactly.
  const durs = [];
  for (const f of files) durs.push(await probeDuration(f, opts));
  const cuts = [];
  let acc = 0;
  for (let i = 0; i < durs.length - 1; i++) { acc += durs[i]; if (acc > 0) cuts.push(Math.round(acc * 1000) / 1000); }
  const total = durs.reduce((a, b) => a + b, 0);
  return { outPath, cuts, duration: Math.round(total * 1000) / 1000 };
}

/** Build the ffmpeg filtergraph string (1080x1920 canvas) for the branded overlay. Pure — testable. */
function buildBrandFilter(opts = {}) {
  const { scenes, cuts, fontDir = "assets/fonts" } = opts;
  const phone = fgClean(opts.phone || "+91 88660 50291");
  const handle = fgClean(opts.handle || "@skylinetravelplanner");
  const tagline = fgClean(opts.tagline || "Your Journey · Our Passion");
  const B = `${fontDir}/Poppins-Bold.ttf`, S = `${fontDir}/Poppins-SemiBold.ttf`, R = `${fontDir}/Poppins-Regular.ttf`;
  const p = [];
  // COVER-CROP, never a plain scale=1080:1920 - that squeezes a 16:9 source into a 9:16 frame and
  // stretches everything vertically (same bug class as the stretched website images). Scale so both
  // dimensions cover the canvas, then centre-crop, and reset SAR so no player re-stretches it.
  p.push("[0:v]scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1[base]");
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
    // PRICE - drawn ONLY when the caller resolved a REAL package price for this destination. Never
    // invented, and omitted entirely where no package exists (Ladakh has none), because a made-up figure
    // on a client's ad is far worse than no figure. Wording matches the website's own convention.
    // fgClean STRIPS commas (they separate filters), which would turn "₹21,500" into "₹21 500". A price
    // needs its thousands separator, so protect it across the clean and escape it for drawtext instead.
    const price = sc.price
      ? fgClean(String(sc.price).replace(/,/g, "")).replace(//g, "\\,")
      : "";
    if (price) {
      const pn = `pr${i}`;
      p.push(`[${cur}]drawtext=fontfile=${S}:text=From ${price} per person*:fontcolor=0xF4A21E:fontsize=26:x=62:y=298:shadowcolor=black@0.7:shadowx=2:shadowy=2:enable='${en}'[${pn}]`);
      cur = pn;
    }
  });
  const anyPrice = scenes.some((sc) => sc.price);
  p.push(`[${cur}]drawtext=fontfile=${S}:text=Tailor-made India trips · planned with you on WhatsApp:fontcolor=white:fontsize=26:x=40:y=1823:shadowcolor=black@0.6:shadowx=1:shadowy=2[c1]`);
  p.push(`[c1]drawtext=fontfile=${S}:text=WhatsApp ${phone}:fontcolor=0x25D366:fontsize=27:x=40:y=1868:shadowcolor=black@0.6:shadowx=1:shadowy=2[c2]`);
  p.push(`[c2]drawtext=fontfile=${R}:text=·  ${handle}  ·  ${tagline}:fontcolor=white@0.9:fontsize=23:x=455:y=1870:shadowcolor=black@0.6:shadowx=1:shadowy=2[c3]`);
  // The asterisk on the price is explained here; the website carries the same indicative wording.
  const credit = fgClean(anyPrice ? "AI-generated · illustrative · *prices indicative, per person" : "AI-generated · illustrative");
  p.push(`[c3]drawtext=fontfile=${R}:text=${credit}:fontcolor=white@0.62:fontsize=15:x=w-tw-20:y=1783[vout]`);
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
  let filter = buildBrandFilter({ scenes, cuts, fontDir: opts.fontDir, phone: opts.phone, handle: opts.handle, tagline: opts.tagline });

  // MUSIC BED. No video model enabled on this account generates audio (Kling and MiniMax have no audio
  // field; Veo 3.1 / Sora 2, which do, are model_not_found here), so a silent clip is what we always get
  // and a silent Reel performs badly. The track is muxed in here instead: free, reusable, and the same
  // sound on every Reel. Looped to cover the video, faded in and out, and ducked well under speech level.
  const musicWanted = opts.musicPath || process.env.REEL_MUSIC_PATH || "";
  // A configured-but-missing track must degrade to a silent Reel, never fail the render.
  const musicPath = musicWanted && (opts.run || fs.existsSync(musicWanted)) ? musicWanted : "";
  if (musicWanted && !musicPath) { try { console.log(JSON.stringify({ evt: "reel_music_missing", path: musicWanted })); } catch { /* ignore */ } }
  const total = Number(opts.duration) || 0;
  if (musicPath) {
    const vol = Number.isFinite(opts.musicVolume) ? opts.musicVolume : 0.35;
    const outAt = total > 3 ? Math.round((total - 1.5) * 1000) / 1000 : 0;
    filter += `;[2:a]volume=${vol},afade=t=in:st=0:d=1` +
      (outAt ? `,afade=t=out:st=${outAt}:d=1.5` : "") +
      ",aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[aout]";
  }
  const filterFile = opts.filterFile || path.join(os.tmpdir(), `vbrand-${scenes.map((s) => s.label).join("-")}-${cuts.join("_")}.txt`);
  fs.writeFileSync(filterFile, filter, "utf8");
  try {
    const flag = opts.filterFlag || (await filterFileFlag(ffmpeg, run));
    // -stream_loop -1 so a short track covers a longer Reel; -shortest then trims it to the video.
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", inputPath, "-i", logoPath,
      ...(musicPath ? ["-stream_loop", "-1", "-i", musicPath] : []),
      // The graph is written to a FILE (it is far past any safe command-line length), so this must be
      // -filter_complex_script, NOT -filter_complex. ffmpeg rejects the whole arg list otherwise.
      flag, filterFile, "-map", "[vout]",
      ...(musicPath ? ["-map", "[aout]", "-shortest"] : ["-map", "0:a?"]),
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

module.exports = { detectCuts, resolveCuts, hasRealCuts, concatClips, probeDuration, filterFileFlag, buildBrandFilter, brandVideo, defaultRun, fgClean };

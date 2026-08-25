/**
 * video-qa.js — sample frames from a short VIDEO and run the cinematic QA reviewer over them.
 *
 * Claude's API takes images, not video, so we extract a handful of ORDERED frames with ffmpeg and hand
 * them to engine/generate.assessVideoQuality (a 15-yr travel-cinematographer reviewer that judges per-frame
 * craft AND cross-frame temporal artefacts — morphing, flicker, identity drift). Same pass/score/defects
 * contract as the image gate, so a video intake can gate on it exactly like a card scene.
 *
 * ffmpeg resolution (works locally AND on Vercel): FFMPEG_PATH env → the bundled @ffmpeg-installer/ffmpeg
 * static binary → plain `ffmpeg` on PATH. Everything is injectable (opts.assess, opts.ffmpegPath, opts.run)
 * so this is testable offline with no ffmpeg, no key, and no network.
 *
 *   node automation/video-qa.js <video-file> [--frames 6] [--min 7]
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

/** Resolve an ffmpeg binary: env override → bundled installer → PATH. */
function resolveFfmpeg(explicit) {
  if (explicit) return explicit;
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const p = require("@ffmpeg-installer/ffmpeg").path; if (p) return p; } catch { /* not installed — fall through */ }
  return "ffmpeg"; // rely on PATH (winget/apt install)
}

/** Run a binary and resolve with { code, stdout, stderr } (never rejects on a non-zero exit). */
function run(bin, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code == null ? 1 : err.code) : 0, stdout: stdout || "", stderr: stderr || (err ? String(err.message) : "") });
    });
  });
}

/** Parse "Duration: HH:MM:SS.xx" out of ffmpeg's stderr. Returns seconds or null. */
function parseDuration(stderr) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(stderr || ""));
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Extract `count` evenly-spaced JPEG frames from a video into a temp dir; return their buffers in order.
 * @returns { frames: Buffer[], duration, dir } — throws with a clear message if ffmpeg is missing/failed.
 */
async function sampleFrames(videoPath, opts = {}) {
  const count = Math.max(1, Math.min(Number.isFinite(opts.count) ? opts.count : 6, 12));
  const ffmpeg = resolveFfmpeg(opts.ffmpegPath);
  const runner = opts.run || run;
  if (!fs.existsSync(videoPath)) throw new Error(`video not found: ${videoPath}`);

  // 1) Duration (best-effort) → an even sampling rate that spans the WHOLE clip.
  const probe = await runner(ffmpeg, ["-hide_banner", "-i", videoPath]);
  if (/not recognized|ENOENT|command not found|is not installed/i.test(probe.stderr) && probe.code !== 0 && !/Duration:/.test(probe.stderr)) {
    throw new Error("ffmpeg not available — set FFMPEG_PATH, install ffmpeg, or add @ffmpeg-installer/ffmpeg. (" + probe.stderr.slice(0, 200) + ")");
  }
  const duration = parseDuration(probe.stderr);
  const fps = duration && duration > 0 ? Math.max(0.2, count / duration) : 2; // frames per second across the clip

  // 2) Extract to a fresh temp dir.
  const dir = opts.dir || fs.mkdtempSync(path.join(os.tmpdir(), "vqa-"));
  const pattern = path.join(dir, "f_%03d.jpg");
  const out = await runner(ffmpeg, ["-hide_banner", "-y", "-i", videoPath, "-vf", `fps=${fps}`, "-frames:v", String(count), "-q:v", "3", pattern]);
  const files = fs.readdirSync(dir).filter((f) => /^f_\d+\.jpg$/.test(f)).sort();
  if (!files.length) throw new Error("ffmpeg extracted no frames (" + String(out.stderr || "").slice(-200) + ")");
  const frames = files.slice(0, count).map((f) => fs.readFileSync(path.join(dir, f)));
  return { frames, duration, dir };
}

/** Sample frames from a video file and return the cinematic QA verdict. Cleans up its own temp frames. */
async function assessVideoFile(videoPath, opts = {}) {
  const assess = opts.assess || require("../engine/generate").assessVideoQuality;
  const { frames, duration, dir } = await sampleFrames(videoPath, opts);
  try {
    const verdict = await assess(frames, { client: opts.client, minScore: opts.minScore, maxFrames: opts.maxFrames, model: opts.model });
    return { ...verdict, duration, sampled: frames.length };
  } finally {
    // Frames are already in memory (Buffers); drop the temp dir we created (never a caller-supplied one)
    // so an unattended pipeline can't leak frame JPGs to disk on every run.
    if (!opts.dir && dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }
}

module.exports = { resolveFfmpeg, parseDuration, sampleFrames, assessVideoFile };

// ---- CLI ----
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const file = args.find((a) => !a.startsWith("--"));
    if (!file) { console.error("usage: node automation/video-qa.js <video-file> [--frames 6] [--min 7]"); process.exit(2); }
    const framesArg = args.indexOf("--frames"); const minArg = args.indexOf("--min");
    const count = framesArg >= 0 ? Number(args[framesArg + 1]) : 6;
    const minScore = minArg >= 0 ? Number(args[minArg + 1]) : 7;
    try { require("./load-env").loadEnv && require("./load-env").loadEnv(); } catch { /* optional */ }
    if (!process.env.ANTHROPIC_API_KEY) console.error("(no ANTHROPIC_API_KEY — QA will fail-open pass; set it for a real verdict)");
    try {
      const v = await assessVideoFile(file, { count, minScore });
      console.log(JSON.stringify({ pass: v.pass, score: v.score, frames: v.sampled, duration: v.duration, defects: v.defects }, null, 2));
      console.log(v.pass ? `\n✅ PASS — cinematic QA ${v.score == null ? "(skipped)" : v.score + "/10"}` : `\n❌ FAIL — ${v.note}`);
      process.exit(v.pass ? 0 : 1);
    } catch (e) { console.error("video-qa error:", String((e && e.message) || e)); process.exit(2); }
  })();
}

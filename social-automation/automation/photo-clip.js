/**
 * photo-clip.js — the owner's own PHOTO as a 10 s vertical clip (a slow push-in), for "Reel from this photo"
 * on the guided WhatsApp intake (wa-guide.js). The clip then goes through the same branding, music, hosting
 * and approval as every Reel (video-runner.js). No generation, no cost. Needs ffmpeg (GitHub Actions only).
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const W = 1080, H = 1920, FPS = 30;

/**
 * photoPath -> outPath: cover-crop to 9:16 at 2x, then a gentle centred zoom from 1.00 to about 1.12.
 * Rendering at 2x before zoompan avoids its known jitter at 1x.
 */
function makePhotoClip(photoPath, outPath, { seconds = 10, ffmpeg = "ffmpeg", run = spawnSync } = {}) {
  if (!fs.existsSync(photoPath)) throw new Error("photo-clip: no photo at " + photoPath);
  const frames = Math.round(seconds * FPS);
  const step = (0.12 / frames).toFixed(6);
  const vf = [
    `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase`,
    `crop=${W * 2}:${H * 2}`,
    `zoompan=z='min(zoom+${step},1.12)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`,
    "format=yuv420p",
  ].join(",");
  const args = ["-y", "-loglevel", "error", "-loop", "1", "-i", photoPath, "-vf", vf, "-t", String(seconds), "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", outPath];
  const r = run(ffmpeg, args, { encoding: "utf8", timeout: 180000 });
  if (r.status !== 0 || !fs.existsSync(outPath)) throw new Error("photo-clip: ffmpeg failed " + String(r.stderr || r.error || "").slice(0, 300));
  return outPath;
}

/** Download a hosted photo (our own Blob URL from the webhook) to a temp file. */
async function downloadPhoto(url, dir, { fetchImpl = fetch } = {}) {
  // only OUR Blob store (the webhook hosted the owner's photo there): the run never fetches a third-party URL
  let host = "";
  try { const u = new URL(String(url)); host = u.protocol === "https:" && !u.port ? u.hostname : ""; } catch { host = ""; }
  if (!/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(host)) throw new Error("photo-clip: the photo must be on our Blob store");
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`photo-clip: photo download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 20 * 1048576) throw new Error("photo-clip: photo over 20 MB");
  const out = path.join(dir, `wa-photo-${Date.now()}.jpg`);
  fs.writeFileSync(out, buf);
  return out;
}

module.exports = { makePhotoClip, downloadPhoto };

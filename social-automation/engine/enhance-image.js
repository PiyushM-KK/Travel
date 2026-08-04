/**
 * enhance-image.js — the image-enhance stage (v2). Turns a vendor's / user's raw photo
 * into a post-ready image BEFORE it goes to the client for approval.
 *
 * TWO modes (owner's decision 2026-08-03 = "safe-enhance + optional regenerate"):
 *   • safe (default)  — DETERMINISTIC pixel clean-up that keeps the real place REAL:
 *                       cover-fit to the platform's aspect, normalize, best-effort sharpen,
 *                       re-encode JPEG. No AI. Honours "never AI-fake real places" — it's
 *                       the same photo, just cleaner and correctly sized.
 *   • regenerate      — OPTIONAL AI relight/restyle via an EXTERNAL image model (Claude
 *                       cannot edit images). Off unless an `aiEnhancer` backend is wired
 *                       (owner-gated, B-22) AND the caller asks for it. Because AI can
 *                       misrepresent a real destination, the result is FLAGGED (aiAltered)
 *                       so the caption/QA + the human approval step can catch it — the
 *                       WhatsApp approval is the safety gate.
 *
 * ARCHITECTURE: pixel work is done by an INJECTED backend (jimp/sharp adapter) so this
 * module's LOGIC is testable offline with a fake. Nothing here requires a native image
 * lib at import. On ANY failure it returns the ORIGINAL bytes untouched — the post is
 * never lost or blocked by a bad enhance.
 *
 * SAFETY (from the Bug-Hunter + App-Security review): the bytes are attacker-influenceable
 * (a vendor email / WhatsApp photo). A small COMPRESSED image can decode to gigabytes (a
 * decompression bomb) and OOM-kill the runner — which would wedge the whole publish queue.
 * So we read the image's dimensions FROM THE HEADER (no decode) and skip enhance for
 * anything over a megapixel budget, and we validate the backend's OUTPUT is really an image.
 * A pre-decode dimension check is the effective guard (a Promise timeout can't interrupt a
 * synchronous CPU/alloc stall); the timeout below only helps the async AI path.
 *
 * NOTE on hosting: safe-enhance is deterministic, so it can be re-derived from the source
 * at publish time (fits the publish-time-only-hosting model). An AI-regenerated image is
 * NON-deterministic, so an APPROVED regenerated image must be persisted (it can't be
 * re-made identically later) — the runner handles that; see the wiring note in HANDOVER.
 */

const { redact } = require("./publish"); // never surface a secret in an enhance error/note

// Platform aspect targets (px). IG portrait 4:5 gives the most feed real estate and also
// reads fine when shared to a FB Page photo post. Override per call via opts.target.
const TARGETS = {
  instagram: { width: 1080, height: 1350, fit: "cover" },
  facebook: { width: 1080, height: 1350, fit: "cover" },
  square: { width: 1080, height: 1080, fit: "cover" },
};

// The deterministic clean-up applied in BOTH modes (regenerate still fits to target after).
const SAFE_OPS = Object.freeze(["cover-fit", "normalize", "jpeg"]);

// Decoded-pixel budget. A JPEG/PNG's header dimensions ARE what the decoder allocates
// (w*h*4 RGBA + op copies), so capping the header dims bounds the decode. 24 MP covers a
// real DSLR photo; a bomb (e.g. 25000×25000 in a sub-MB file) is far past it and skipped.
const DEFAULT_MAX_MEGAPIXELS = 24;
const AI_TIMEOUT_MS = 20000;

/**
 * Read pixel dimensions from an image header WITHOUT decoding it (bomb-safe). Supports the
 * formats the pipeline accepts post-sniff (jpeg/png/gif/webp). Returns {width,height} or
 * null if it can't be determined (caller treats null as "don't risk the decode").
 */
function readImageSize(b) {
  if (!Buffer.isBuffer(b) || b.length < 16) return null;
  // PNG: 89 50 4E 47 … IHDR width/height at bytes 16/20 (big-endian)
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  // GIF: "GIF" … little-endian width/height at 6/8
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  // WebP: RIFF … WEBP
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const fmt = b.toString("ascii", 12, 16);
    try {
      if (fmt === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (fmt === "VP8L") {
        const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
        return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
      }
      if (fmt === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    } catch { return null; }
    return null;
  }
  // JPEG: FF D8 … walk segments to a Start-Of-Frame marker
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
      const len = b.readUInt16BE(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: b.readUInt16BE(o + 5), width: b.readUInt16BE(o + 7) };
      }
      if (len < 2) return null;
      o += 2 + len;
    }
    return null;
  }
  return null;
}

/** Cheap magic-byte check that the bytes are a supported image (jpeg/png/webp/gif). */
function looksLikeImage(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return false;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;                       // jpeg
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;      // png
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true;                       // gif
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return true; // webp
  return false;
}

function targetFor(opts = {}) {
  if (opts.target && opts.target.width && opts.target.height) return opts.target;
  return TARGETS[opts.platform] || TARGETS.instagram;
}

/** Race a promise against a timeout so a hung async backend (AI) degrades to a fallback. */
function withTimeout(promise, ms) {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

/**
 * @param {object} input   { buffer:Buffer, contentType:string }
 * @param {object} opts
 *    platform   "instagram" | "facebook" | "square"   (or pass target:{width,height,fit})
 *    mode       "safe" (default) | "regenerate"
 *    backend    { transform(buffer, {...}) -> Promise<Buffer | {buffer,opsApplied[]}> }
 *    aiEnhancer optional { enhance(buffer, {prompt,contentType}) -> Promise<{buffer,contentType}> }  (B-22)
 *    prompt     optional guidance for the AI backend
 *    quality    JPEG quality 1-100 (default 82)
 *    maxMegapixels  decode budget (default 24) — images over it are passed through, not decoded
 * @returns {Promise<{buffer, contentType, target, mode, opsApplied:string[], aiAltered, enhanced, note}>}
 */
async function enhanceImage(input, opts = {}) {
  const orig = input || {};
  const passthrough = (note, extra = {}) => ({
    buffer: orig.buffer,
    contentType: orig.contentType || "image/jpeg",
    target: targetFor(opts),
    mode: opts.mode || "safe",
    opsApplied: [],
    aiAltered: false,
    enhanced: false,
    note,
    ...extra,
  });

  if (!orig.buffer || !Buffer.isBuffer(orig.buffer) || !orig.buffer.length) {
    return passthrough("no image bytes to enhance — passed through");
  }
  const backend = opts.backend;
  if (!backend || typeof backend.transform !== "function") {
    // No pixel backend wired (jimp/sharp not installed) — ship the original, never lose it.
    return passthrough("no image backend configured (install jimp/sharp — B-22) — original image used");
  }

  const target = targetFor(opts);
  const quality = Number(opts.quality) || 82;
  const maxMp = Number(opts.maxMegapixels) || DEFAULT_MAX_MEGAPIXELS;
  const wantRegen = opts.mode === "regenerate";
  const opsApplied = [];
  let working = orig.buffer;
  let workingType = orig.contentType || "image/jpeg";
  let aiAltered = false;
  let note = "";

  try {
    // 1) OPTIONAL AI regenerate FIRST (relight/restyle), then always fit deterministically.
    if (wantRegen) {
      if (opts.aiEnhancer && typeof opts.aiEnhancer.enhance === "function") {
        try {
          const out = await withTimeout(opts.aiEnhancer.enhance(working, { prompt: opts.prompt || "", contentType: workingType }), opts.aiTimeoutMs || AI_TIMEOUT_MS);
          if (out && out.buffer && out.buffer.length) {
            working = out.buffer;
            workingType = out.contentType || workingType;
            aiAltered = true;
            opsApplied.push("ai-regenerate");
          }
        } catch (e) {
          // AI failed/timed out — DON'T fail the post; fall back to safe-enhance on the original.
          // Keep the REASON (redacted) so the owner is TOLD why (e.g. a Claid credit limit),
          // not left guessing — the caller surfaces this note in the approval message.
          note = "AI enhance failed (" + redact(String((e && e.message) || e)) + ") — fell back to original; ";
        }
      } else {
        note = "regenerate requested but no AI enhancer configured (B-22) — safe-enhance only; ";
      }
    }

    // 2) BOMB GUARD (pre-decode): read the header dims of whatever the backend will decode.
    //    Skip enhance (ship what we have) if the header is unreadable or the image is over
    //    the megapixel budget — never hand a decompression bomb to the pixel library.
    const dims = readImageSize(working);
    if (!dims || !dims.width || !dims.height) {
      return passthrough(note + "could not read image dimensions from the header — enhance skipped (original used)");
    }
    if (dims.width * dims.height > maxMp * 1000000) {
      return passthrough(note + `image too large to enhance safely (${dims.width}×${dims.height} > ${maxMp}MP) — original used`);
    }

    // 3) DETERMINISTIC safe-enhance (always). The caller chooses the FIT: a PHOTO cover-fits
    //    (fills the 4:5 frame, a small crop is fine); a GRAPHIC/poster uses "pad" so its
    //    headline/prices/logo are never cropped. Default is cover; the publish path classifies
    //    the image and passes fit:"pad" for graphics.
    const fit = opts.fit || target.fit || "cover";
    const res = await backend.transform(working, {
      width: target.width, height: target.height, fit,
      sharpen: true, normalize: true, quality, format: "jpeg", maxMegapixels: maxMp,
    });
    const buffer = Buffer.isBuffer(res) ? res : res && res.buffer;
    const delivered = res && !Buffer.isBuffer(res) && Array.isArray(res.opsApplied) ? res.opsApplied : ["cover-fit", "normalize", "jpeg"];

    if (!buffer || !buffer.length) return passthrough(note + "backend returned empty — original image used");
    // 4) VALIDATE the OUTPUT is really an image — else a bad backend would make hosting throw
    //    (→ the row is held) instead of us gracefully shipping the original.
    if (!looksLikeImage(buffer)) return passthrough(note + "backend produced non-image bytes — original image used");

    delivered.forEach((o) => opsApplied.push(o));
    return {
      buffer,
      contentType: "image/jpeg",
      target,
      mode: opts.mode || "safe",
      opsApplied,
      aiAltered,
      enhanced: true,
      note: (note + `enhanced → ${target.width}×${target.height}${aiAltered ? " (AI-altered)" : ""}`).trim(),
    };
  } catch (e) {
    // Any pixel-op failure → ship the original untouched (secret-safe note). Never block a post.
    return passthrough(note + "enhance failed (" + redact(String((e && e.message) || e)) + ") — original image used");
  }
}

/**
 * A one-line human note for the WhatsApp approval message + a hard flag the caption/QA
 * agents use. If the image was AI-altered, the reviewer MUST be told so a fake-looking
 * destination can be caught before it's posted (the "never AI-fake real places" guard).
 * (Pass only the structured fields into any LLM prompt — never the free-text note.)
 */
function describeEnhancement(record = {}) {
  if (!record.enhanced) return { line: "Image sent as-is (not enhanced).", aiAltered: false, reviewFlag: null };
  if (record.aiAltered) {
    return {
      line: `⚠️ Image was AI-restyled and resized to ${record.target.width}×${record.target.height}. Please check it still looks like the REAL place before approving.`,
      aiAltered: true,
      reviewFlag: "AI-ALTERED IMAGERY — verify it still represents the real destination; do not post a misleading render.",
    };
  }
  return { line: `Image cleaned up + resized to ${record.target.width}×${record.target.height} (same photo).`, aiAltered: false, reviewFlag: null };
}

module.exports = { enhanceImage, describeEnhancement, readImageSize, looksLikeImage, TARGETS, SAFE_OPS, targetFor };

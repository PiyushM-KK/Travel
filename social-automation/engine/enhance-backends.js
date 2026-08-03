/**
 * enhance-backends.js — the deterministic pixel backend for enhance-image.js.
 *
 * SAFE-enhance only (no AI): jimp does the resize/crop/normalize/encode. jimp is pure-JS
 * (no native build), lazy-required so this module imports offline, and an OPTIONAL dep —
 * if it isn't installed, `resolveEnhanceBackend()` returns null and the enhance stage
 * ships the original image (never blocks a post). The AI regenerate backend is separate
 * and owner-provided (B-22).
 *
 * A backend is just: { transform(buffer, { width, height, fit, normalize, quality }) ->
 * Promise<{ buffer, opsApplied:string[] }> }. It reports what it ACTUALLY did so the
 * enhance record never over-claims an op.
 */

/** jimp adapter — cover-fit to the target aspect, normalize contrast, re-encode JPEG. */
function jimpBackend() {
  return {
    async transform(buffer, opts = {}) {
      const { Jimp } = require("jimp"); // lazy; throws if not installed (caller guards)
      const img = await Jimp.read(buffer);
      const opsApplied = [];
      const w = Number(opts.width), h = Number(opts.height);
      if (w && h) {
        if ((opts.fit || "cover") === "cover") { img.cover({ w, h }); opsApplied.push("cover-fit"); }
        else { img.contain({ w, h }); opsApplied.push("contain-fit"); }
      }
      if (opts.normalize && typeof img.normalize === "function") { img.normalize(); opsApplied.push("normalize"); }
      // sharpen is best-effort: jimp v1 core has no .sharpen(); apply a mild unsharp via
      // convolute if available, else skip (and don't claim it).
      if (opts.sharpen && typeof img.convolute === "function") {
        try { img.convolute([[0, -0.2, 0], [-0.2, 1.8, -0.2], [0, -0.2, 0]]); opsApplied.push("sharpen"); } catch { /* skip */ }
      }
      const quality = Math.max(1, Math.min(100, Number(opts.quality) || 82));
      const out = await img.getBuffer("image/jpeg", { quality });
      opsApplied.push("jpeg");
      return { buffer: out, opsApplied };
    },
  };
}

/** Return the safe-enhance backend if jimp is installed, else null (stage passes the original through). */
function resolveEnhanceBackend() {
  try { require.resolve("jimp"); return jimpBackend(); }
  catch { return null; }
}

module.exports = { jimpBackend, resolveEnhanceBackend };

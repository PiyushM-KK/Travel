/**
 * image-source.js — the publish-time-only hosting model (structural privacy fix).
 *
 * A queue row no longer carries a PUBLIC image URL while it's a draft. Instead it carries
 * an image SOURCE REFERENCE — a way to re-fetch the bytes on demand:
 *   { kind: "whatsapp", mediaId }   — re-fetch from the WhatsApp media endpoint
 *   { kind: "gmail",    uid }       — re-fetch the attachment from the inbox (email persists)
 *   { kind: "url",      url }       — an already-public link the sender pasted
 *   { kind: "bytes",    data, contentType }  — inline base64 (small/tests)
 *
 * The bytes are resolved TWICE and never sit on a public URL in between:
 *   • at DRAFT time — to run Claude vision / QA on the image (base64, no hosting)
 *   • at PUBLISH time — to host on the public Blob store, post, then delete.
 * A rejected / held / never-published image therefore NEVER touches public hosting.
 *
 * Transports are injectable so this is offline-testable.
 */

const { fetchWhatsAppMedia, assertImageBytes } = require("./image-host");
const { safeFetchBytes, hostAllowListFromEnv } = require("./net-guard");

/** Fetch image bytes from a plain https URL (timeout-guarded). */
// SSRF-safe (B-23): a row-supplied image URL (from a WhatsApp note / an email link) could
// point at an internal address, and the fetched bytes are hosted PUBLICLY — so this goes
// through net-guard, which ALWAYS blocks private/loopback/link-local/metadata IPs and
// applies the SOCIAL_IMAGE_HOSTS allow-list (if set) + a size cap.
async function fetchUrlBytes(url, opts = {}) {
  return safeFetchBytes(url, {
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
    maxBytes: opts.maxBytes,
    lookup: opts.lookup, // injectable DNS lookup for offline tests
    allowHosts: opts.allowHosts || hostAllowListFromEnv("SOCIAL_IMAGE_HOSTS"),
  });
}

/**
 * Resolve an image source reference to { buffer, contentType }, or null if there's no
 * source. Throws (surfaced, never silent) if a source is given but can't be fetched.
 *   opts.gmailFetch(uid) -> { buffer, contentType }   (injected; re-fetch a Gmail attachment)
 *   opts.fetchImpl / opts.token / opts.timeoutMs      (passed through per kind)
 */
async function resolveImageSourceBytes(src, opts = {}) {
  if (!src) return null;
  const kind = src.kind || (typeof src === "string" ? "url" : "");
  let out;
  if (kind === "whatsapp") {
    out = await fetchWhatsAppMedia(src.mediaId, opts);
  } else if (kind === "gmail") {
    if (typeof opts.gmailFetch !== "function") throw new Error("resolveImageSourceBytes(gmail) needs opts.gmailFetch to re-fetch the attachment");
    out = await opts.gmailFetch(src.uid, opts);
  } else if (kind === "url") {
    out = await fetchUrlBytes(src.url || src, opts);
  } else if (kind === "bytes") {
    out = { buffer: Buffer.from(src.data, "base64"), contentType: src.contentType || "image/jpeg" };
  } else {
    throw new Error(`resolveImageSourceBytes: unknown source kind "${kind}"`);
  }
  if (!out || !out.buffer) throw new Error("resolveImageSourceBytes: no bytes returned");
  // Same validation as hosting (type/size/magic bytes) — a source must be a real image.
  assertImageBytes(out.buffer, out.contentType, opts);
  return out;
}

/** True when a row carries a usable image source. */
function hasImageSource(src) {
  if (!src) return false;
  const kind = src.kind || (typeof src === "string" ? "url" : "");
  if (kind === "whatsapp") return !!src.mediaId;
  if (kind === "gmail") return src.uid != null;
  if (kind === "url") return !!(src.url || (typeof src === "string" && src));
  if (kind === "bytes") return !!src.data;
  return false;
}

module.exports = { resolveImageSourceBytes, fetchUrlBytes, hasImageSource };

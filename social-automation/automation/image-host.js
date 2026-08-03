/**
 * image-host.js — turn a client-sent photo into a PUBLIC https image URL
 * (AUTOMATION-PLAN §v2 "image hosting — the linchpin"). Instagram can only publish
 * from a public URL, and a WhatsApp photo arrives as a MEDIA ID (not a URL) while an
 * email photo arrives as ATTACHMENT BYTES — neither is publishable as-is. This module
 * hosts those bytes on Vercel Blob and hands back a public URL the post can attach.
 *
 *   hostImageBytes({buffer, contentType, keyHint})  -> { url, ... }   (any source)
 *   fetchWhatsAppMedia(mediaId)                       -> { buffer, contentType }
 *   hostWhatsAppImage(mediaId)                        -> "https://…"  (the two chained)
 *
 * Design mirrors the rest of the framework:
 *   - Lazy-required SDK (@vercel/blob) so this file imports OFFLINE; the real upload
 *     only runs when it's actually called.
 *   - Injectable transports (opts.put, opts.fetchImpl) so it's testable without a
 *     network or a real Blob store.
 *   - Owner-gated: needs BLOB_READ_WRITE_TOKEN. Without it, isConfigured() is false and
 *     the caller keeps going WITHOUT an image (no crash, no silent success) — same
 *     no-image behaviour as before, just now upgradable by setting one token.
 *   - Secrets (the Blob token, the WhatsApp token) are never logged — redact() on error.
 *
 * The Blob URL we mint is OURS (we uploaded it), so it doesn't go through the untrusted
 * SOCIAL_IMAGE_HOSTS allow-list that guards email-sourced links; it's https, which is
 * all the publish path's assertPublishableImage requires.
 */

const crypto = require("crypto");

const GRAPH = "https://graph.facebook.com/v21.0";

// Instagram image publishing accepts JPEG; PNG/WebP host fine but may be rejected at
// the IG publish step (surfaced there, not here) — we host what we're given and let the
// publish layer enforce its own format rules. Cap at IG's 8 MB image limit.
const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000; // a hung Meta socket must not stall the webhook (matches engine/publish graph())

/** Sniff the real image type from the leading magic bytes (don't trust the declared
 *  Content-Type — a non-image payload can claim image/jpeg). Returns "" if unrecognised. */
function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return "";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "";
}

/** fetch() with an AbortController timeout so a hung socket can't stall the caller. */
async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => { try { ac.abort(); } catch { /* ignore */ } }, timeoutMs);
  try { return await fetchImpl(url, { ...init, signal: ac.signal }); }
  finally { clearTimeout(timer); }
}

/** True when a Vercel Blob token is configured (owner-gated setup). */
function isConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

function extFromType(contentType) {
  return ALLOWED_IMAGE_TYPES[String(contentType || "").toLowerCase().split(";")[0].trim()] || "";
}

/** Validate bytes are a real, allowed, not-oversized image before we host or publish.
 *  Checks in cost order: presence → declared type → size → actual magic bytes (last, so
 *  a genuinely oversized upload is rejected by size before we bother sniffing). */
function assertImageBytes(buffer, contentType, opts = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("image-host: empty image");
  const ext = extFromType(contentType);
  if (!ext) throw new Error(`image-host: unsupported image type "${contentType}" (allowed: jpeg, png, webp)`);
  const max = opts.maxBytes || MAX_IMAGE_BYTES;
  if (buffer.length > max) throw new Error(`image-host: image is ${(buffer.length / 1048576).toFixed(1)}MB, over the ${(max / 1048576).toFixed(0)}MB limit`);
  // Don't trust the label: the bytes must actually BE a supported image.
  if (!sniffImageType(buffer)) throw new Error(`image-host: bytes are not a recognised image (declared "${contentType}")`);
  return ext;
}

/**
 * Upload image bytes to Vercel Blob and return a public URL.
 * The object key is derived from a content hash (deterministic, so the SAME image
 * re-sent produces the SAME URL — cheap idempotency + no duplicate blobs). Pass
 * opts.put to inject the uploader in tests; opts.token overrides the env token.
 */
async function hostImageBytes(input = {}, opts = {}) {
  const { buffer, contentType, keyHint = "img" } = input;
  const ext = assertImageBytes(buffer, contentType, opts);

  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const safeHint = String(keyHint).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "img";
  const key = opts.key || `social/${safeHint}-${hash}.${ext}`;

  const token = opts.token || process.env.BLOB_READ_WRITE_TOKEN;
  const put = opts.put || (await realPut());
  if (!opts.put && !token) throw new Error("image-host needs BLOB_READ_WRITE_TOKEN (owner-gated — create a Vercel Blob store)");

  try {
    // addRandomSuffix:false so our content-hash key stays stable (re-send -> same URL).
    const result = await put(key, buffer, { access: "public", contentType, token, addRandomSuffix: false });
    if (!result || !result.url) throw new Error("image-host: Blob upload returned no url");
    return { url: result.url, contentType, bytes: buffer.length, key };
  } catch (e) {
    const { redact } = require("../engine/publish");
    throw new Error(redact(`image-host: upload failed — ${String((e && e.message) || e)}`));
  }
}

/** The real Vercel Blob uploader, lazy-loaded so this module imports offline. */
async function realPut() {
  let mod;
  try { mod = require("@vercel/blob"); }
  catch { throw new Error("@vercel/blob is not installed — run npm install in SociaMedia_Auto to enable image hosting"); }
  return mod.put;
}

/**
 * Resolve a WhatsApp media ID to its bytes. Two authenticated Graph calls:
 *   1) GET /{mediaId}          -> { url, mime_type, file_size }
 *   2) GET that url (Bearer)   -> the raw image bytes
 * The media URL is short-lived and requires the token even to download, so both hops
 * carry Authorization. The token is never logged (redact() on error). fetchImpl is
 * injectable for offline tests.
 */
async function fetchWhatsAppMedia(mediaId, opts = {}) {
  if (!mediaId) throw new Error("fetchWhatsAppMedia: no media id");
  const token = opts.token || process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("fetchWhatsAppMedia needs WHATSAPP_TOKEN (owner-gated B-16)");
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const timeoutMs = opts.timeoutMs || FETCH_TIMEOUT_MS;
  const auth = { Authorization: `Bearer ${token}` };

  try {
    // Both hops are timeout-guarded: a hung socket here would stall the webhook past
    // its maxDuration, Meta would see no ack and re-deliver -> a duplicate intake.
    const metaRes = await fetchWithTimeout(fetchImpl, `${GRAPH}/${encodeURIComponent(mediaId)}`, { headers: auth }, timeoutMs);
    const meta = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok || !meta.url) throw new Error((meta.error && meta.error.message) || `media lookup HTTP ${metaRes.status}`);

    const contentType = (meta.mime_type || "").split(";")[0].trim() || "image/jpeg";
    if (meta.file_size && meta.file_size > (opts.maxBytes || MAX_IMAGE_BYTES)) {
      throw new Error(`media is ${(meta.file_size / 1048576).toFixed(1)}MB, over the limit`);
    }

    const binRes = await fetchWithTimeout(fetchImpl, meta.url, { headers: auth }, timeoutMs);
    if (!binRes.ok) throw new Error(`media download HTTP ${binRes.status}`);
    const buffer = Buffer.from(await binRes.arrayBuffer());
    return { buffer, contentType };
  } catch (e) {
    const { redact } = require("../engine/publish");
    throw new Error(redact(`fetchWhatsAppMedia: ${String((e && e.message) || e)}`));
  }
}

/** WhatsApp media ID -> hosted public URL (fetch bytes, then host them). */
async function hostWhatsAppImage(mediaId, opts = {}) {
  const { buffer, contentType } = await fetchWhatsAppMedia(mediaId, opts);
  const hosted = await hostImageBytes({ buffer, contentType, keyHint: `wa-${mediaId}` }, opts);
  return hosted.url;
}

/**
 * Delete a hosted blob by its public URL (or key). Best-effort. Used AFTER a post is
 * published — Meta keeps its own copy, so the public blob is pure liability and is
 * removed immediately (the publish-time-only hosting model: nothing lingers publicly).
 */
async function deleteHosted(urlOrKey, opts = {}) {
  if (!urlOrKey) return { deleted: false, reason: "nothing to delete" };
  const token = opts.token || process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const del = opts.del || (await realDel());
    await del(urlOrKey, token ? { token } : {});
    return { deleted: true };
  } catch (e) {
    const { redact } = require("../engine/publish");
    return { deleted: false, error: redact(String((e && e.message) || e)) };
  }
}

async function realDel() {
  let mod;
  try { mod = require("@vercel/blob"); }
  catch { throw new Error("@vercel/blob is not installed — run npm install in SociaMedia_Auto"); }
  return mod.del;
}

/**
 * Build the Claude vision content block from raw image BYTES (base64) — so drafting /
 * QA can analyse an image WITHOUT it being hosted on a public URL first (the structural
 * privacy fix: no public hosting until a post is approved).
 */
function claudeImageSource(buffer, contentType) {
  const media_type = String(contentType || "image/jpeg").split(";")[0].trim();
  return { type: "base64", media_type, data: Buffer.from(buffer).toString("base64") };
}

module.exports = {
  isConfigured,
  extFromType,
  sniffImageType,
  assertImageBytes,
  hostImageBytes,
  fetchWhatsAppMedia,
  hostWhatsAppImage,
  deleteHosted,
  claudeImageSource,
  fetchWithTimeout,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  FETCH_TIMEOUT_MS,
};

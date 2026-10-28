/**
 * post-image.js — a READY-MADE image (a Skyline card designed in Canva) into the NORMAL approval flow
 * (owner 2026-10-28: "post this current one"). Run by .github/workflows/post-image.yml:
 *   1. download the image - https only, from Canva's export hosts, image/png|jpeg, at most 15 MB;
 *   2. host it on Vercel Blob (Instagram publishes from a public URL; Canva's export link expires);
 *   3. create a planned row and let generateOne write + fact-check the caption (same options as WhatsApp's
 *      "Post this photo", the foreign-brand guard included);
 *   4. send the image + caption + "approve <code>" to the owner's WhatsApp.
 * It NEVER publishes: the post goes out only after the owner's approve, exactly like every other post.
 * Canva Pro photos are used only inside a finished Skyline design (Canva's licence); the photo register is
 * assets/canva-photos.json (one photo per card, never reused - tests/check_canva_photos.js).
 *
 *   POST_IMAGE_URL=<canva export url> POST_NOTE="<what the post is about>" node automation/post-image.js
 */

const ALLOWED_HOSTS = new Set(["export-download.canva.com", "document-export.canva.com"]); // Canva EXPORTS only
const MAX_BYTES = 15 * 1024 * 1024;
const AI_CAPTION_LINE = "Image is AI-generated and illustrative, not an actual photo. Actual sights, stays and decorations vary by date and season.";

function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch { throw new Error("POST_IMAGE_URL is not a URL"); }
  if (u.protocol !== "https:") throw new Error("POST_IMAGE_URL must be https");
  if (!ALLOWED_HOSTS.has(u.hostname)) throw new Error(`POST_IMAGE_URL host ${u.hostname} is not a Canva export host`);
  return u.toString();
}

async function download(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`download: HTTP ${res.status}`);
  const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`download: ${buf.length} bytes is over the ${MAX_BYTES} limit`);
  const png = buf[0] === 0x89 && buf[1] === 0x50, jpg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!png && !jpg) throw new Error(`download: not a PNG or JPEG (content-type ${type || "none"})`);
  return { buffer: buf, contentType: png ? "image/png" : "image/jpeg" };
}

async function postImage(o = {}) {
  const env = o.env || process.env;
  const url = checkUrl(o.url || env.POST_IMAGE_URL);
  const note = String(o.note || env.POST_NOTE || "").trim().slice(0, 500);
  if (!note) throw new Error("POST_NOTE is required (what the post is about - the caption is written from it and the facts)");
  // AI image unless told otherwise: the caption line below is then enforced in CODE (AI Security 2026-10-28)
  const aiImage = String(o.aiImage != null ? o.aiImage : (env.POST_AI_IMAGE || "true")).toLowerCase() !== "false";
  const platforms = String(o.platforms || env.POST_PLATFORMS || "instagram,facebook").split(",").map((s) => s.trim()).filter((p) => p === "instagram" || p === "facebook");

  const { makeStore } = require("./run");
  const { loadClient } = require("./clients");
  const { intakeDirect } = require("./intake-runner");
  const store = o.store || makeStore().store;
  const client = loadClient(env.SOCIAL_CLIENT || "skyline");

  const img = await download(url, o.fetch);
  // Instagram's API publishes JPEG only (engine/publish.js): a PNG card was approved and then refused (2026-10-28)
  const jpg = img.contentType === "image/jpeg" ? img.buffer : await (o.toJpeg || require("./reseller").toJpeg)(img.buffer);
  if (!(jpg[0] === 0xff && jpg[1] === 0xd8)) throw new Error("could not convert the card to JPEG (Instagram needs JPEG)");
  const host = o.hostImageBytes || require("./image-host").hostImageBytes;
  const hosted = await host({ buffer: jpg, contentType: "image/jpeg", keyHint: "canva-card" });

  const row = await intakeDirect(store, {
    client: client.id, hint: note, subject: note.slice(0, 60), source: "canva",
    imageUrl: hosted.url, imageSource: { kind: "url", url: hosted.url }, platforms,
  });
  const generateOne = o.generateOne || require("./generate-runner").generateOne;
  // autoApprove is forced off: a Canva card ALWAYS waits for the owner's approve (App Security 2026-10-28)
  const res = await generateOne(store, row, {
    runner: "post-image", facts: client.facts, profile: { ...(client.profile || {}), autoApprove: false },
    checkForeignBrand: true, clientName: client.label || "Skyline Travel Planner",
    useVision: true, useSmm: true, imageOpts: {},
  });
  let fresh = await store.get(row.id);
  if (res.outcome === "approved" || fresh.status === "approved") { // never publish without the owner: demote
    fresh = await store.update(row.id, { status: "pending_approval" });
  } else if (res.outcome !== "pending") {
    // the reviewer's one-line notes (cleaned, capped model text; no secrets) say WHY a draft was held
    return { ok: false, outcome: res.outcome, reason: [fresh.lastError || res.reason || "", res.reviewNotes || fresh.reviewNotes || ""].filter(Boolean).join(" - "), id: row.id };
  }

  if (aiImage && !/AI-generated/i.test(String(fresh.caption || ""))) {
    fresh = await store.update(fresh.id, { caption: String(fresh.caption || "").trimEnd() + "\n\n" + AI_CAPTION_LINE });
  }
  const { digestItem, renderDigestText } = require("./approval-channel");
  const wa = o.wa || require("./whatsapp");
  await wa.sendImage(env.WHATSAPP_TO, fresh.imageUrl || hosted.url, "🖼️ Canva card ready - caption + how to approve below 👇");
  await wa.sendText(env.WHATSAPP_TO, renderDigestText([digestItem(fresh)]));
  // stamped only after both sends: a failed send leaves it for the scheduled approve pass to resend
  await store.update(fresh.id, { digestedAt: new Date().toISOString() });
  return { ok: true, outcome: "pending", id: row.id, code: wa.shortCode ? wa.shortCode(row.id) : undefined };
}

module.exports = { postImage, checkUrl, download, ALLOWED_HOSTS, AI_CAPTION_LINE };

if (require.main === module) {
  postImage().then((r) => {
    console.log(JSON.stringify({ evt: "post_image", ok: r.ok, outcome: r.outcome, code: r.code || null, reason: r.reason || null }));
    process.exit(r.ok ? 0 : 1);
  }).catch((e) => {
    console.error(JSON.stringify({ evt: "post_image_error", error: require("../engine/publish").redact(String((e && e.message) || e)).slice(0, 300) }));
    process.exit(1);
  });
}

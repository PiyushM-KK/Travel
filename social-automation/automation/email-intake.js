/**
 * email-intake.js — the GMAIL vendor intake (the owner's 2nd of three intake ways).
 *
 * Flow (mirrors the WhatsApp webhook, but the trigger is a NEW vendor email):
 *   search Gmail for a new allow-listed vendor email → take its image → same pipeline
 *   (classify photo/graphic → enhance photos, pad+skip posters → grounded caption →
 *   fact-check + SMM) → SEND THE IMAGE to the owner on WhatsApp for approval BY NUMBER →
 *   (owner replies "approve <code>") → publish.
 *
 * WHY the image is sent: unlike a WhatsApp photo the owner took, the owner has NOT seen
 * the vendor's email image — so approval must show it. We host a preview (the enhanced
 * image for a photo, or the padded-whole image for a poster) and send it. The preview
 * blob is keyed `draft-<id>` so publish reuses it and reject cleans it up.
 *
 * Everything is injectable (reader, notify) so it's testable without markSeen'ing the real
 * inbox or sending a real WhatsApp — see check_email_intake / the dry-run flags.
 */

const { intakeFromGmail } = require("./intake-runner");
const { generateOne } = require("./generate-runner");
const { resolveImageSourceBytes } = require("./image-source");
const { classifyImageForEnhance } = require("../engine/generate");
const { shortCode } = require("./whatsapp");
const { digestItem, renderDigestText } = require("./approval-channel");

/** Host a preview of what will POST (enhanced photo, or padded-whole poster) for approval. */
async function hostPreview(row, deps) {
  if (row.imageUrl) return row.imageUrl; // an enhanced photo already hosted its preview
  if (!row.imageSource) return "";
  let { buffer, contentType } = await resolveImageSourceBytes(row.imageSource, { gmailFetch: deps.gmailFetch });
  const backend = deps.enhanceBackend;
  if (backend) {
    let fit = "pad"; // safe default: never crop
    try { fit = (await classifyImageForEnhance({ buffer, contentType }, deps.classifyOpts || {})) === "photo" ? "cover" : "pad"; } catch { fit = "pad"; }
    const en = await deps.enhanceImage({ buffer, contentType }, { platform: "instagram", mode: "safe", backend, fit });
    if (en.enhanced) { buffer = en.buffer; contentType = en.contentType; }
  }
  const hosted = await deps.hostImageBytes({ buffer, contentType, keyHint: `draft-${row.id}` });
  return hosted.url;
}

/**
 * @param store  the queue store
 * @param ctx    { reader, facts, profile, aiEnhancer, enhanceBackend, hostImageBytes,
 *                 sendImage, sendText, notifyTo, notify (default true), client }
 * @returns { intakeCreated, drafted, notified:[{id,code,outcome}], held:[...] }
 */
async function runEmailIntake(store, ctx = {}) {
  const reader = ctx.reader;
  if (!reader) throw new Error("runEmailIntake needs a Gmail `reader`");
  const gmailFetch = (uid) => reader.fetchAttachmentBytes(uid);
  const enhanceImage = ctx.enhanceImage || require("../engine/enhance-image").enhanceImage;
  const hostImageBytes = ctx.hostImageBytes || require("./image-host").hostImageBytes;
  const enhanceBackend = ctx.enhanceBackend || require("../engine/enhance-backends").resolveEnhanceBackend();
  const aiEnhancer = ctx.aiEnhancer || require("./ai-enhancer").resolveAiEnhancer();
  const notify = ctx.notify !== false;
  const to = ctx.notifyTo || process.env.WHATSAPP_TO;

  // 1. Pull new allow-listed vendor emails with an image into the queue (deduped, markSeen).
  const { created } = await intakeFromGmail(store, { reader, client: ctx.client || "skyline", language: "en" });

  const notified = [], held = [];
  for (const planned of created) {
    // 2. Draft it — same pipeline as WhatsApp (vision scene-only → caption → SMM), with
    //    enhancement gated to photos. gmailFetch re-fetches the attachment for vision/enhance.
    const res = await generateOne(store, planned, {
      runner: "email-intake", facts: ctx.facts, profile: ctx.profile,
      useVision: true, useSmm: true, imageOpts: { gmailFetch },
      ...(aiEnhancer ? { aiEnhancer, regenerate: true, hostImageBytes, enhanceBackend } : {}),
    });
    const fresh = await store.get(planned.id);
    if (res.outcome !== "pending" && res.outcome !== "approved") {
      held.push({ id: fresh.id, outcome: res.outcome, reason: res.reason || fresh.lastError || "" });
      continue;
    }
    // 3. Host the preview + SEND THE IMAGE to the owner on WhatsApp with an approve number.
    let url = "";
    try {
      url = await hostPreview(fresh, { gmailFetch, enhanceBackend, enhanceImage, hostImageBytes, classifyOpts: ctx.classifyOpts });
      if (url && fresh.imageUrl !== url) { await store.update(fresh.id, { imageUrl: url }); fresh.imageUrl = url; }
    } catch (e) { /* preview host failed — still notify with text */ }
    const code = shortCode(fresh.id);
    if (notify && to) {
      const from = (planned.hint || planned.subject || "").slice(0, 0); // provenance kept minimal
      const cap = `📧 New draft from a vendor email — please review.\n\n${(fresh.caption || "").trim()}\n\n${(fresh.hashtags || []).join(" ")}\n\n✅ Reply:  approve ${code}   |   reject ${code}   |   edit ${code} <new caption>`;
      try {
        if (url && ctx.sendImage) await ctx.sendImage(to, url, cap.slice(0, 1024));
        else if (ctx.sendText) await ctx.sendText(to, renderDigestText([digestItem(fresh)]));
      } catch (e) { /* best-effort notify */ }
    }
    notified.push({ id: fresh.id, code, outcome: res.outcome, hasImage: !!url });
  }
  return { intakeCreated: created.length, notified, held };
}

module.exports = { runEmailIntake, hostPreview };

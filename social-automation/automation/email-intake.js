/**
 * email-intake.js — GMAIL vendor intake, the "IDEA, not the poster" flow (owner decision
 * 2026-08-04, option #3 + the #2 guardrail).
 *
 * A vendor's B2B email is a SUPPLIER's branded poster (their logo/phone/website) — posting it
 * to the client's feed would advertise the SUPPLIER. So we do NOT post the vendor image. Instead:
 *   search Gmail for a new allow-listed vendor email → read ONLY the destinations/season from
 *   its image (describeOffer — excludes any brand/phone/price) → draft a SKYLINE post about
 *   planning a custom trip to those places, in Skyline's voice, grounded in Skyline's packages
 *   → send the IDEA to the owner on WhatsApp: attach a Skyline photo to post to IG+FB, or
 *   approve for a Facebook text post, or reject.
 *
 * The #2 guardrail (detectForeignBrand) lives in generate-runner and fires whenever an image IS
 * attached (e.g. the owner replies a photo, or the WhatsApp intake) — it HOLDS any image that
 * carries another company's branding. Here we simply never attach the vendor's image.
 *
 * Everything is injectable (reader, sendText, store) so it's testable without markSeen'ing the
 * real inbox or sending a real WhatsApp.
 */

const { generateOne } = require("./generate-runner");
const { resolveImageSourceBytes } = require("./image-source");
const { describeOffer, describeImage } = require("../engine/generate");
const { shortCode } = require("./whatsapp");

/**
 * @param store  the queue store
 * @param ctx    { reader, facts, profile, sendText, notifyTo, notify(default true),
 *                 client, clientName }
 * @returns { considered, notified:[{id,code,offer}], held:[...], skipped:[...] }
 */
async function runEmailIntake(store, ctx = {}) {
  const reader = ctx.reader;
  if (!reader) throw new Error("runEmailIntake needs a Gmail `reader`");
  const gmailFetch = (uid) => reader.fetchAttachmentBytes(uid);
  const to = ctx.notifyTo || process.env.WHATSAPP_TO;
  const notify = ctx.notify !== false;

  const items = (await reader.fetchNewImagePosts()) || [];
  const notified = [], held = [], skipped = [];

  for (const m of items) {
    if (!m || !m.messageId) continue;
    const smid = `gmail-${m.messageId}`;
    // Dedup — a re-fetched email must not queue twice (publish-time-only = no URL to dedup on).
    if (typeof store.findBySourceMessageId === "function") {
      const existing = await store.findBySourceMessageId(smid);
      if (existing) { try { await reader.markSeen && reader.markSeen(m.messageId); } catch (e) { /* */ } skipped.push(smid); continue; }
    }

    // Read the vendor image for (a) a short OFFER LABEL to show the owner and (b) the SCENE/theme
    // to brief the caption. We brief from the SCENE (not the destination list) + constrain to
    // "only what Skyline offers", so the model grounds to Skyline's own packages instead of
    // inventing a route the client doesn't sell (e.g. a Himachal+Ladakh combo). No brand/price.
    let offer = (m.subject || "").replace(/[^\w\s&,-]/g, " ").replace(/\s+/g, " ").trim();
    let scene = "";
    try {
      if (m.imageSource) {
        const bytes = await resolveImageSourceBytes(m.imageSource, { gmailFetch });
        const [d, s] = await Promise.all([describeOffer(bytes, ctx.offerOpts || {}), describeImage(bytes, ctx.sceneOpts || {})]);
        if (d) offer = d;
        if (s) scene = s;
      }
    } catch (e) { /* keep the subject-derived offer */ }

    // A SKYLINE idea post — text only (no vendor image). The brief forbids naming the supplier,
    // its prices, or any other brand, AND tells the model to reference ONLY destinations Skyline
    // actually offers — the fact-check + SMM keep it grounded in Skyline's own packages.
    const hint =
      `A travel supplier is promoting mountain/hill travel right now (scene: ${scene || offer}). ` +
      `Write a SHORT, warm SKYLINE post that invites people to plan a CUSTOM hill/mountain trip WITH ` +
      `SKYLINE. Reference ONLY destinations/regions that appear in your own packages — do NOT name ` +
      `any place you don't offer, the supplier, any prices, or any other brand. End with a WhatsApp CTA.`;
    const row = await store.create({
      status: "planned", source: "gmail", sourceMessageId: smid, client: ctx.client || "skyline",
      subject: (m.subject || "").slice(0, 80), hint, language: "en",
      platforms: ["facebook"], // text-only idea → Facebook; IG needs an image the owner attaches
    });
    try { await reader.markSeen && reader.markSeen(m.messageId); } catch (e) { /* dedup covers a re-fetch */ }

    // Draft (no image → useVision:false, no enhance). SMM verifies; fact-check keeps it grounded.
    const res = await generateOne(store, row, {
      runner: "email-idea", facts: ctx.facts, profile: ctx.profile,
      clientName: ctx.clientName, useVision: false, useSmm: true,
    });
    const fresh = await store.get(row.id);
    if (res.outcome !== "pending" && res.outcome !== "approved") {
      held.push({ id: fresh.id, outcome: res.outcome, reason: res.reason || fresh.lastError || "" });
      continue;
    }
    const code = shortCode(fresh.id);
    if (notify && to && ctx.sendText) {
      const msg =
        `📧 A supplier is promoting: ${offer.slice(0, 90)}\n\n` +
        `Here's a SKYLINE post idea (your brand, not theirs):\n\n${(fresh.caption || "").trim()}\n\n` +
        `${(fresh.hashtags || []).join(" ")}\n\n` +
        `📎 Reply a SKYLINE photo to attach it + post to IG + FB\n` +
        `✅ approve ${code}  → Facebook text post   |   reject ${code}`;
      try { await ctx.sendText(to, msg); } catch (e) { /* best-effort */ }
    }
    notified.push({ id: fresh.id, code, offer });
  }
  return { considered: items.length, notified, held, skipped };
}

module.exports = { runEmailIntake };

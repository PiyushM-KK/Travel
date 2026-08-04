/**
 * email-intake.js — GMAIL vendor intake → a SKYLINE-BRANDED CARD post (the reseller flow).
 *
 * Owner model (2026-08-04): resell a supplier's package under Skyline's brand at the vendor's
 * price +10%. We NEVER post the vendor's poster. For each new allow-listed vendor email:
 *   1. read the offer's destinations (describeOffer) + prices (extractPrices) from its image
 *   2. match it to the closest SKYLINE package (packages.matchPackage) — no match ⇒ HELD
 *      (Skyline can't sell it), so we never invent a destination
 *   3. reprice: vendor's price +10% (or Skyline's own catalogue price if the poster has none)
 *   4. build a SKYLINE CARD (engine/card.js): our logo + a real destination photo + the
 *      package name/route/repriced price — clean code-rendered text, no vendor traces
 *   5. write a grounded Skyline caption, host the card, and SEND THE CARD to the owner on
 *      WhatsApp with the full details (vendor From/Subject/Received, package, price, photo) +
 *      an approve number → on approval it posts to Instagram + Facebook.
 *
 * Everything is injectable (reader, sendImage/sendText, store) so it's testable offline.
 */

const path = require("path");
const { generateOne } = require("./generate-runner");
const { resolveImageSourceBytes } = require("./image-source");
const { describeOffer, extractPrices } = require("../engine/generate");
const { matchPackage, repricedLine } = require("./packages");
const { makeCard, pickPhoto } = require("../engine/card");
const { shortCode } = require("./whatsapp");

const ASSETS = path.join(__dirname, "..", "assets");
const PHOTOS = path.join(ASSETS, "destinations");
const LOGO = path.join(ASSETS, "Skyline_Logo.jpg");

async function runEmailIntake(store, ctx = {}) {
  const reader = ctx.reader;
  if (!reader) throw new Error("runEmailIntake needs a Gmail `reader`");
  const fs = ctx.fs || require("fs");
  const gmailFetch = (uid) => reader.fetchAttachmentBytes(uid);
  const hostImageBytes = ctx.hostImageBytes || require("./image-host").hostImageBytes;
  const to = ctx.notifyTo || process.env.WHATSAPP_TO;
  const notify = ctx.notify !== false;

  const items = (await reader.fetchNewImagePosts()) || [];
  const notified = [], held = [], skipped = [];

  for (const m of items) {
    if (!m || !m.messageId) continue;
    const smid = `gmail-${m.messageId}`;
    if (typeof store.findBySourceMessageId === "function") {
      const existing = await store.findBySourceMessageId(smid);
      if (existing) { try { reader.markSeen && (await reader.markSeen(m.messageId)); } catch (e) { /* */ } skipped.push(smid); continue; }
    }

    // 1. Read the vendor image → destinations + prices (brand/phone excluded by the prompts).
    let offer = (m.subject || ""), prices = [];
    if (m.imageSource) {
      try {
        const bytes = await resolveImageSourceBytes(m.imageSource, { gmailFetch });
        const [d, p] = await Promise.all([describeOffer(bytes, ctx.offerOpts || {}), extractPrices(bytes, ctx.priceOpts || {})]);
        if (d) offer = d;
        prices = p || [];
      } catch (e) { /* keep subject-derived offer */ }
    }

    // 2. Match to a Skyline package. No match ⇒ Skyline doesn't sell it → skip (silent).
    const match = matchPackage(offer + " " + (m.subject || ""));
    if (!match) { try { reader.markSeen && (await reader.markSeen(m.messageId)); } catch (e) { /* */ } held.push({ from: m.from, subject: m.subject, reason: "no Skyline package matches this offer" }); continue; }
    const pkg = match.pkg;
    const rp = repricedLine(prices, pkg); // vendor min +10%, or Skyline's own price

    // 3. Build the Skyline card (our logo + real photo + package + repriced price).
    let cardUrl = "";
    try {
      const photo = pickPhoto(fs, PHOTOS, match.slug);
      const cardBuf = await makeCard({
        photoPath: photo, logoPath: LOGO,
        headline: pkg.item, subtitle: String(pkg.route || "").replace(/·/g, "-"),
        price: rp.line, cta: "WhatsApp us to plan your trip",
        handle: "@skylinetravelplanner", credit: "Wikimedia CC",
      });
      const hosted = await hostImageBytes({ buffer: cardBuf, contentType: "image/jpeg", keyHint: `card-${smid}` });
      cardUrl = hosted.url;
    } catch (e) { held.push({ from: m.from, subject: m.subject, reason: "card render/host failed: " + String((e && e.message) || e) }); continue; }

    // 4. Create the row with the CARD as its image, then draft a grounded caption (no vision —
    //    the card IS the image; the caption complements it and must NOT restate the price).
    const hint = `Write a SHORT, warm Skyline post about the ${pkg.item} trip (${pkg.route}). Invite people to plan a CUSTOM trip with Skyline and message us on WhatsApp. Do NOT state any price (it's already on the image) and do not name any other company.`;
    const row = await store.create({
      status: "planned", source: "gmail", sourceMessageId: smid, client: ctx.client || "skyline",
      subject: (m.subject || "").slice(0, 80), hint, language: "en",
      platforms: ["instagram", "facebook"], imageUrl: cardUrl, imageSource: { kind: "url", url: cardUrl },
    });
    try { reader.markSeen && (await reader.markSeen(m.messageId)); } catch (e) { /* dedup covers re-fetch */ }

    const res = await generateOne(store, row, {
      runner: "email-card", facts: ctx.facts, profile: ctx.profile, clientName: ctx.clientName,
      useVision: false, useSmm: true,
    });
    const fresh = await store.get(row.id);
    // keep the card as the image even if generate cleared/normalised imageUrl
    if (fresh.imageUrl !== cardUrl) { await store.update(fresh.id, { imageUrl: cardUrl, imageSource: { kind: "url", url: cardUrl } }); fresh.imageUrl = cardUrl; }
    if (res.outcome !== "pending" && res.outcome !== "approved") { held.push({ id: fresh.id, reason: res.reason || fresh.lastError || "" }); continue; }

    // 5. Send the CARD + full details to the owner on WhatsApp with an approve number.
    const code = shortCode(fresh.id);
    let received = "";
    if (m.date) { try { received = new Date(m.date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) + " IST"; } catch (e) { received = String(m.date); } }
    const cap =
      `🧳 Skyline card ready — from a vendor offer\n` +
      `   From: ${m.from || "(unknown)"}\n` +
      `   Subject: ${(m.subject || "(no subject)").slice(0, 90)}\n` +
      (received ? `   Received: ${received}\n` : "") +
      `   Package: ${pkg.item} — ${pkg.route}\n` +
      `   Price on card: ${rp.line}${prices.length ? ` (vendor ${Math.min(...prices).toLocaleString("en-IN")} +10%)` : " (Skyline rate)"}\n\n` +
      `Caption:\n${(fresh.caption || "").trim()}\n\n` +
      `✅ approve ${code}  → posts to Instagram + Facebook   |   reject ${code}`;
    if (notify && to) {
      try { if (cardUrl && ctx.sendImage) await ctx.sendImage(to, cardUrl, cap.slice(0, 1024)); else if (ctx.sendText) await ctx.sendText(to, cap); }
      catch (e) { /* best-effort */ }
    }
    notified.push({ id: fresh.id, code, package: pkg.item, price: rp.line });
  }
  return { considered: items.length, notified, held, skipped };
}

module.exports = { runEmailIntake };

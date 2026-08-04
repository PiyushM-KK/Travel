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
const { BUSINESS } = require("../facts");

const ASSETS = path.join(__dirname, "..", "assets");
const PHOTOS = path.join(ASSETS, "destinations");
const LOGO = path.join(ASSETS, "Skyline_Logo.jpg");

// Instagram's Graph API accepts JPEG ONLY, and satori renders the card as PNG — so every hosted
// card is re-encoded to JPEG before it goes to Blob (and thus to IG/FB and the WhatsApp preview).
async function toJpeg(buffer) {
  if (buffer && buffer[0] === 0xff && buffer[1] === 0xd8) return buffer; // already JPEG (jimp fallback path)
  try { const { Jimp } = require("jimp"); return await (await Jimp.read(buffer)).getBuffer("image/jpeg", { quality: 90 }); }
  catch (e) { return buffer; } // last resort: host as-is (should not happen — jimp is a dependency)
}

async function runEmailIntake(store, ctx = {}) {
  const reader = ctx.reader;
  if (!reader) throw new Error("runEmailIntake needs a Gmail `reader`");
  const fs = ctx.fs || require("fs");
  const gmailFetch = (uid) => reader.fetchAttachmentBytes(uid);
  const hostImageBytes = ctx.hostImageBytes || require("./image-host").hostImageBytes;
  const deleteHosted = ctx.deleteHosted || require("./image-host").deleteHosted;
  // Re-encode the card to JPEG (IG requirement) then host it. One place so A + B are always JPEG.
  const hostCard = async (buffer, keyHint) => (await hostImageBytes({ buffer: await toJpeg(buffer), contentType: "image/jpeg", keyHint })).url;
  const to = ctx.notifyTo || process.env.WHATSAPP_TO;
  const notify = ctx.notify !== false;

  // Best-effort sweep of hosted card blobs when a post never reaches an approve/reject decision
  // (generate held it, etc.) — the email-card flow hosts A+B at DRAFT time, so an abandoned row
  // would otherwise orphan them. (An orphan sweep is the backstop; this just keeps it tidy.)
  async function sweepCards(urls) { for (const u of urls) { if (u) { try { await deleteHosted(u, ctx.imageOpts || {}); } catch { /* best-effort */ } } } }

  // COST CAP: generating a fresh gpt-image-1 scene per email is a paid call. Bound how many we
  // generate per run (the rest fall back to the free gradient decor) so a burst of allow-listed
  // vendor mail can't run up an unbounded image bill. Gmail already caps items/run (25).
  const imageGenMax = Number(ctx.imageGenMaxPerRun || process.env.IMAGE_GEN_MAX_PER_RUN || 8);
  let imageGenUsed = 0;

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

    // 3. Build BOTH Skyline cards from the SAME branded template:
    //      A = real destination photo (licensed).
    //      B = decorative — a FRESHLY GENERATED scene (owner path B, via OPENAI_API_KEY + the
    //          scene-prompt engine) if an image generator is configured; otherwise the code-drawn
    //          gradient decor. B is optional: if it fails we still offer A alone.
    const baseCard = {
      logoPath: LOGO, headline: pkg.item, subtitle: pkg.route || "",
      price: rp.main, priceSuffix: rp.suffix, priceShort: rp.short,
      cta: "WhatsApp us to plan", handle: BUSINESS.instagram || "@skylinetravelplanner",
      tagline: BUSINESS.slogan || "Your Journey, Our Passion",
      phone: (BUSINESS.locations && BUSINESS.locations[0] && BUSINESS.locations[0].phone) || "",
    };
    let cardUrlA = "";
    try {
      const photo = pickPhoto(fs, PHOTOS, match.slug);
      const bufA = await makeCard({ ...baseCard, photoPath: photo, credit: "Photo: Wikimedia CC" });
      cardUrlA = await hostCard(bufA, `card-a-${smid}`);
    } catch (e) { held.push({ from: m.from, subject: m.subject, reason: "card A render/host failed: " + String((e && e.message) || e) }); continue; }

    let cardUrlB = "", bStyle = "";
    try {
      const imageGen = ctx.imageGen || require("./image-gen").resolveImageGen();
      let bufB;
      if (imageGen && imageGenUsed < imageGenMax) {
        const { promptForSlug } = require("./scene-prompts");
        imageGenUsed++;
        const gen = await imageGen(promptForSlug(match.slug), ctx.imageGenOpts || {});
        bufB = await makeCard({ ...baseCard, photoBytes: gen.buffer, credit: "AI-generated scene · illustrative" });
        bStyle = "AI scene";
      } else {
        bufB = await makeCard({ ...baseCard, decor: true });
        bStyle = "decorative";
      }
      cardUrlB = await hostCard(bufB, `card-b-${smid}`);
    } catch (e) {
      // B is best-effort. If the generator failed, fall back to the gradient decor; if THAT fails, offer A only.
      try {
        const bufB = await makeCard({ ...baseCard, decor: true });
        cardUrlB = await hostCard(bufB, `card-b-${smid}`);
        bStyle = "decorative";
      } catch (e2) { cardUrlB = ""; bStyle = ""; }
    }

    const options = { A: cardUrlA }; if (cardUrlB) options.B = cardUrlB;

    // 4. Create the row (A is the default image). BOTH option URLs ride inside imageSource so the
    //    owner's A/B/both reply can choose which to publish — no Airtable schema change needed.
    const hint = `Write a SHORT, warm Skyline post inviting people to plan a CUSTOM ${pkg.item} trip with Skyline and message us on WhatsApp. You may name ONLY the destinations in this route: ${pkg.route}. Do NOT invent specific attractions, activities, sights, hotels, meals or day-by-day itinerary — none of those are provided, so they read as fabricated. Keep it about the FEELING/mood + the invitation to plan a custom trip. Do NOT state any price (it's already on the image) and do not name any other company.`;
    const row = await store.create({
      status: "planned", source: "gmail", sourceMessageId: smid, client: ctx.client || "skyline",
      subject: (m.subject || "").slice(0, 80), hint, language: "en",
      platforms: ["instagram", "facebook"], imageUrl: cardUrlA, imageSource: { kind: "url", url: cardUrlA, options },
    });
    try { reader.markSeen && (await reader.markSeen(m.messageId)); } catch (e) { /* dedup covers re-fetch */ }

    const res = await generateOne(store, row, {
      runner: "email-card", facts: ctx.facts, profile: ctx.profile, clientName: ctx.clientName,
      useVision: false, useSmm: true,
    });
    const fresh = await store.get(row.id);
    // keep card A as the default image even if generate cleared/normalised imageUrl (options preserved)
    if (fresh.imageUrl !== cardUrlA) { await store.update(fresh.id, { imageUrl: cardUrlA, imageSource: { kind: "url", url: cardUrlA, options } }); fresh.imageUrl = cardUrlA; }
    if (res.outcome !== "pending" && res.outcome !== "approved") { await sweepCards([cardUrlA, cardUrlB]); held.push({ id: fresh.id, reason: res.reason || fresh.lastError || "" }); continue; }

    // 5. Send BOTH cards + a selection prompt (A / B / both / reject) to the owner on WhatsApp.
    const code = shortCode(fresh.id);
    let received = "";
    if (m.date) { try { received = new Date(m.date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) + " IST"; } catch (e) { received = String(m.date); } }
    const details =
      `🧳 Skyline card ready — from a vendor offer\n` +
      `   From: ${m.from || "(unknown)"}\n` +
      `   Subject: ${(m.subject || "(no subject)").slice(0, 90)}\n` +
      (received ? `   Received: ${received}\n` : "") +
      `   Package: ${pkg.item} — ${pkg.route}\n` +
      `   Price on card: ${rp.line}${prices.length ? ` (vendor ${Math.min(...prices).toLocaleString("en-IN")} +10%)` : " (Skyline rate)"}`;
    const instr = cardUrlB
      ? `\n\nReply:\n🅰️ A ${code} → post the real-photo card\n🅱️ B ${code} → post the ${bStyle} card\n➕ both ${code} → post both\n❌ reject ${code}`
      : `\n\n✅ approve ${code} → posts to Instagram + Facebook   |   ❌ reject ${code}`;
    if (notify && to) {
      try {
        if (ctx.sendImage && cardUrlA) await ctx.sendImage(to, cardUrlA, (details + "\n\n🅰️ REAL PHOTO").slice(0, 1024));
        if (ctx.sendImage && cardUrlB) await ctx.sendImage(to, cardUrlB, `🅱️ ${bStyle.toUpperCase()} — ${pkg.item} ${pkg.route || ""}`.trim().slice(0, 1024));
        const tail = `Caption:\n${(fresh.caption || "").trim()}${instr}`;
        if (ctx.sendText) await ctx.sendText(to, tail.slice(0, 4000));
        else if (!cardUrlA && ctx.sendImage) { /* nothing to send */ }
      } catch (e) { /* best-effort */ }
    }
    notified.push({ id: fresh.id, code, package: pkg.item, price: rp.line, options: Object.keys(options).join("/"), bStyle });
  }
  return { considered: items.length, notified, held, skipped };
}

module.exports = { runEmailIntake };

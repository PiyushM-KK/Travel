/**
 * reseller.js — SHARED reseller-card builder.
 *
 * An offer image (a supplier poster forwarded by the client) → a SKYLINE-BRANDED card at the
 * vendor's price +10% (or Skyline's own catalogue rate). We NEVER repost the source poster (that's
 * the #2 foreign-brand guardrail's job, and AI garbles poster text) — we build Skyline's own card.
 *
 * Used by BOTH the Gmail vendor intake (email-intake.js) and the WhatsApp image intake
 * (api/whatsapp-webhook.js): the client sends a poster on WhatsApp → reprice +10% → Skyline card →
 * approve → post to Instagram + Facebook.
 *
 * Everything is injectable so it runs offline in tests (no network, no Claude, no Blob).
 */
const path = require("path");
const { describeOffer, extractPrices } = require("../engine/generate");
const { matchPackage, repricedLine } = require("./packages");
const { makeCard, pickPhoto } = require("../engine/card");
const { BUSINESS } = require("../facts");

const ASSETS = path.join(__dirname, "..", "assets");
const PHOTOS = path.join(ASSETS, "destinations");
const LOGO = path.join(ASSETS, "Skyline_Logo.jpg");

// IG's Graph API accepts JPEG only; satori renders PNG — re-encode every card to JPEG before hosting.
async function toJpeg(buffer) {
  if (buffer && buffer[0] === 0xff && buffer[1] === 0xd8) return buffer; // already JPEG
  try { const { Jimp } = require("jimp"); return await (await Jimp.read(buffer)).getBuffer("image/jpeg", { quality: 90 }); }
  catch (e) { return buffer; }
}

/**
 * Build Skyline reseller cards from an offer image.
 * @param {object} ctx  injectables: describeOffer, extractPrices, matchPackage, makeCard, pickPhoto,
 *   hostImageBytes|hostCard, imageGen (or null to force decor), fs, requirePrice, genUsed, imageGenMax
 * @param {object} opts { imageBytes, offerText?, smid }
 * @returns {object} { matched:false, reason } OR
 *   { matched:true, pkg, rp, prices, offer, cardUrlA, cardUrlB, bStyle, options, hint }
 */
async function buildResellerCards(ctx = {}, opts = {}) {
  const _describeOffer = ctx.describeOffer || describeOffer;
  const _extractPrices = ctx.extractPrices || extractPrices;
  const _matchPackage = ctx.matchPackage || matchPackage;
  const _makeCard = ctx.makeCard || makeCard;
  const _pickPhoto = ctx.pickPhoto || pickPhoto;
  const fs = ctx.fs || require("fs");
  const hostImageBytes = ctx.hostImageBytes || require("./image-host").hostImageBytes;
  const hostCard = ctx.hostCard ||
    (async (buffer, keyHint) => (await hostImageBytes({ buffer: await toJpeg(buffer), contentType: "image/jpeg", keyHint })).url);
  const smid = opts.smid || "wa";
  // Honest 0: an explicit ctx.imageGenMax=0 or IMAGE_GEN_MAX_PER_RUN=0 disables paid generation
  // (the `x || 8` idiom would treat 0 as unset). Falls back to 8 only when truly unset/blank.
  const _rawMax = process.env.IMAGE_GEN_MAX_PER_RUN;
  const imageGenMax = ctx.imageGenMax != null ? Number(ctx.imageGenMax) : (_rawMax != null && _rawMax !== "" ? Number(_rawMax) : 8);

  // 1. Read the offer's destinations + prices from the image (brand/phone excluded by the prompts).
  let offer = opts.offerText || "", prices = [];
  if (opts.imageBytes) {
    try {
      const [d, p] = await Promise.all([_describeOffer(opts.imageBytes, ctx.offerOpts || {}), _extractPrices(opts.imageBytes, ctx.priceOpts || {})]);
      if (d) offer = (offer ? offer + " " : "") + d;
      prices = p || [];
    } catch (e) { /* keep offerText */ }
  }

  // 2. Match to a Skyline package. No match ⇒ Skyline doesn't sell it → don't invent a destination.
  const match = _matchPackage(offer);
  if (!match) return { matched: false, reason: "no Skyline package matches this offer" };
  // GATE (WhatsApp): a genuine reseller poster carries a PRICE to mark up. When requirePrice is set,
  // an image with no detectable price is NOT treated as an offer (a plain holiday photo falls through
  // to the normal draft). Do this BEFORE building/hosting cards so we never orphan a blob.
  if (ctx.requirePrice && !(prices && prices.length)) return { matched: false, reason: "no price detected on the image" };

  const pkg = match.pkg;
  const rp = repricedLine(prices, pkg); // vendor min +10%, or Skyline's own catalogue price

  // 3. Build Skyline cards: A = real destination photo; B = AI scene (if a generator is wired) else decor.
  const baseCard = {
    logoPath: LOGO, headline: pkg.item, subtitle: pkg.route || "",
    price: rp.main, priceSuffix: rp.suffix, priceShort: rp.short,
    cta: "WhatsApp us to plan", handle: BUSINESS.instagram || "@skylinetravelplanner",
    tagline: BUSINESS.slogan || "Your Journey, Our Passion",
    phone: (BUSINESS.locations && BUSINESS.locations[0] && BUSINESS.locations[0].phone) || "",
  };
  let cardUrlA = "";
  try {
    const photo = _pickPhoto(fs, PHOTOS, match.slug);
    cardUrlA = await hostCard(await _makeCard({ ...baseCard, photoPath: photo, credit: "Photo: Wikimedia CC" }), `card-a-${smid}`);
  } catch (e) { return { matched: false, reason: "card A render/host failed: " + String((e && e.message) || e) }; }

  let cardUrlB = "", bStyle = "";
  try {
    const imageGen = ctx.imageGen !== undefined ? ctx.imageGen : require("./image-gen").resolveImageGen();
    let bufB;
    if (imageGen && (ctx.genUsed || 0) < imageGenMax) {
      const { promptForSlug } = require("./scene-prompts");
      const gen = await imageGen(promptForSlug(match.slug), ctx.imageGenOpts || {});
      bufB = await _makeCard({ ...baseCard, photoBytes: gen.buffer, credit: "AI-generated scene · illustrative" });
      bStyle = "AI scene";
    } else { bufB = await _makeCard({ ...baseCard, decor: true }); bStyle = "decorative"; }
    cardUrlB = await hostCard(bufB, `card-b-${smid}`);
  } catch (e) {
    // B is best-effort: fall back to the gradient decor; if THAT fails, offer A alone.
    try { cardUrlB = await hostCard(await _makeCard({ ...baseCard, decor: true }), `card-b-${smid}`); bStyle = "decorative"; }
    catch (e2) { cardUrlB = ""; bStyle = ""; }
  }

  const options = { A: cardUrlA }; if (cardUrlB) options.B = cardUrlB;
  const hint =
    `Write a SHORT, warm Skyline post inviting people to plan a CUSTOM ${pkg.item} trip with Skyline ` +
    `and message us on WhatsApp. You may name ONLY the destinations in this route: ${pkg.route}. ` +
    `Do NOT invent specific attractions, activities, sights, hotels, meals or day-by-day itinerary. ` +
    `Keep it about the FEELING/mood + the invitation to plan a custom trip. Do NOT state any price ` +
    `(it's already on the card) and do not name any other company.`;
  return { matched: true, pkg, rp, prices, offer, cardUrlA, cardUrlB, bStyle, options, hint };
}

module.exports = { buildResellerCards, toJpeg };

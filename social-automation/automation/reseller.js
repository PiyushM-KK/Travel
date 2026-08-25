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

  // 1. Read destinations + prices from the image with a strong vision model (brand/phone excluded by
  //    the prompts). The PRICE comes ONLY from the poster — the vendor's authoritative original price
  //    that we mark up +10%. We deliberately do NOT accept a price typed in the forwarding message
  //    (that's not the "original price" and would let free text set/underprice the card). The caption
  //    (opts.offerText) is used only as extra DESTINATION text for matching, never as a price. Reads
  //    happen BEFORE building/hosting anything, so a no-price abort orphans nothing.
  let visionOffer = "", prices = [];
  if (opts.imageBytes) {
    try {
      const [d, p] = await Promise.all([_describeOffer(opts.imageBytes, ctx.offerOpts || {}), _extractPrices(opts.imageBytes, ctx.priceOpts || {})]);
      if (d) visionOffer = d;
      prices = p || [];
    } catch (e) { /* keep caption-derived offer text for matching */ }
  }
  const offer = [opts.offerText || "", visionOffer].filter(Boolean).join(" ").trim();

  // 2. Match to a Skyline package. No match ⇒ Skyline doesn't sell it → don't invent a destination.
  const match = _matchPackage(offer);
  if (!match) return { matched: false, reason: "no_match", offer };
  const pkg = match.pkg;
  // 3. A +10% markup is MANDATORY, so we MUST have the vendor's original price. If the destination is
  //    one Skyline sells but no price was read (or typed), return no_price + the matched package so the
  //    caller can ask the owner for it — we NEVER post a reseller card without the +10%.
  if (!(prices && prices.length)) return { matched: false, reason: "no_price", pkg, offer };

  const rp = repricedLine(prices, pkg); // vendor min +10%

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

  let cardUrlB = "", bStyle = "", sceneMeta = null;
  try {
    const imageGen = ctx.imageGen !== undefined ? ctx.imageGen : require("./image-gen").resolveImageGen();
    let bufB;
    if (imageGen && (ctx.genUsed || 0) < imageGenMax) {
      // Card B = a FRESH AI scene — the SAME production path (and SAME image-QA gate, scene-qa.js) as the
      // own-catalogue cards: the dynamic Scene Generator (grounded to the matched Skyline package, avoiding
      // recent history) with the static SCENES pool as the fallback. A weird render is re-rolled; if every
      // attempt still looks broken we post the code-drawn decorative card, never an AI-broken image.
      const { resolveScenePrompt } = require("./scene-generator");
      const { resolveImageQaConfig, generateQaScene } = require("./scene-qa");
      const scene = await generateQaScene({
        nextScene: () => resolveScenePrompt({ pkg, slug: match.slug, store: ctx.store, client: ctx.client || "skyline", sceneGenClient: ctx.sceneGenClient, model: ctx.sceneModel, recent: ctx.recentScenes }),
        imageGen, imageGenOpts: ctx.imageGenOpts, cfg: resolveImageQaConfig(ctx),
      });
      if (scene.buffer) {
        sceneMeta = scene.sceneMeta;
        bufB = await _makeCard({ ...baseCard, photoBytes: scene.buffer, credit: "AI-generated scene · illustrative" });
        bStyle = "AI scene";
      } else {
        bufB = await _makeCard({ ...baseCard, decor: true }); bStyle = "decorative"; sceneMeta = null;
        try { console.warn(JSON.stringify({ evt: "image_qa_fallback_decor", src: "reseller", notes: scene.rejected })); } catch { /* ignore */ }
      }
    } else { bufB = await _makeCard({ ...baseCard, decor: true }); bStyle = "decorative"; }
    cardUrlB = await hostCard(bufB, `card-b-${smid}`);
  } catch (e) {
    // B is best-effort: fall back to the gradient decor; if THAT fails, offer A alone.
    try { cardUrlB = await hostCard(await _makeCard({ ...baseCard, decor: true }), `card-b-${smid}`); bStyle = "decorative"; sceneMeta = null; }
    catch (e2) { cardUrlB = ""; bStyle = ""; sceneMeta = null; }
  }
  if (bStyle !== "AI scene") sceneMeta = null; // only record a concept the AI scene actually used

  const options = { A: cardUrlA }; if (cardUrlB) options.B = cardUrlB;
  const hint =
    `Write a SHORT, warm Skyline post inviting people to plan a CUSTOM ${pkg.item} trip with Skyline ` +
    `and message us on WhatsApp. You may name ONLY the destinations in this route: ${pkg.route}. ` +
    `Do NOT invent specific attractions, activities, sights, hotels, meals or day-by-day itinerary. ` +
    `Keep it about the FEELING/mood + the invitation to plan a custom trip. Do NOT state any price ` +
    `(it's already on the card) and do not name any other company.`;
  return { matched: true, pkg, rp, prices, offer, cardUrlA, cardUrlB, bStyle, options, hint, sceneMeta };
}

module.exports = { buildResellerCards, toJpeg };

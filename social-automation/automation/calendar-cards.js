/**
 * calendar-cards.js — the CALENDAR intake as PUBLISHABLE posts (owner's 3rd intake channel).
 *
 * The base calendar (calendar.js) only produced photo-BRIEFS (text ideas with no image), which QA
 * holds — so they never publish on their own. This turns Skyline's OWN catalogue into complete posts:
 * one package per day (a stateless daily rotation) becomes the SAME two-candidate branded card the
 * vendor-email flow produces — A = a real destination photo, B = a fresh AI scene (or the gradient
 * decor if no image generator) — WhatsApp'd to the owner to pick A/B/both, then published to IG+FB.
 *
 * It uses Skyline's OWN price (no vendor markup) and stays grounded: the caption may name only the
 * package's route destinations, never invented sights/activities/prices. Injectable for tests.
 *
 * The card-build+draft core is factored into `buildAndDraftCard()` and REUSED by the twice-daily
 * `package-posts.js` intake (auto-publish path). Keep them sharing one builder so a card fix lands
 * in both.
 */

const path = require("path");
const { makeCard, pickPhoto } = require("../engine/card");
const { generateOne } = require("./generate-runner");
const { shortCode } = require("./whatsapp");
const { BUSINESS } = require("../facts");
const { allPackages, repricedLine, photoSlug } = require("./packages");

const ASSETS = path.join(__dirname, "..", "assets");
const PHOTOS = path.join(ASSETS, "destinations");
const LOGO = path.join(ASSETS, "Skyline_Logo.jpg");

// IG accepts JPEG only; satori renders PNG — re-encode before hosting.
async function toJpeg(buffer) {
  if (buffer && buffer[0] === 0xff && buffer[1] === 0xd8) return buffer;
  try { const { Jimp } = require("jimp"); return await (await Jimp.read(buffer)).getBuffer("image/jpeg", { quality: 90 }); }
  catch (e) { return buffer; }
}

/**
 * Only packages that have a REAL matching destination photo are eligible to auto-feature. The others
 * would fall back to the `generic` seed (a Himalayas-from-space shot) under the wrong headline — a real
 * photo of the WRONG place, which no agent catches (card A isn't vision-reviewed). So we exclude them
 * until real photos exist. Card B (AI scene) is fine for any slug; the gate is purely about card A.
 */
function featurablePackages() {
  return allPackages().filter((p) => photoSlug(p.item + " " + (p.route || "")) !== "generic");
}

/** The package to feature on a given day — a stateless round-robin through the FEATURABLE packages. */
function packageForDay(now) {
  const pkgs = featurablePackages();
  if (!pkgs.length) return null;
  const dayIndex = Math.floor((now ? now.getTime() : Date.now()) / 86400000);
  return pkgs[dayIndex % pkgs.length];
}

/**
 * The package for a given SLOT on a given day, for a multi-post-per-day schedule (twice-daily
 * package-posts). Stateless + deterministic: consecutive (day,slot) pairs walk consecutive packages,
 * so the two daily slots feature DISTINCT packages (as long as there is >1 featurable package) and the
 * rotation never repeats a package until the whole list is exhausted. slotsPerDay defaults to 2.
 */
function packageForSlot(now, slot = 0, slotsPerDay = 2) {
  const pkgs = featurablePackages();
  if (!pkgs.length) return null;
  const dayIndex = Math.floor((now ? now.getTime() : Date.now()) / 86400000);
  const s = Math.max(0, Math.min(slotsPerDay - 1, Number(slot) || 0));
  return pkgs[(dayIndex * slotsPerDay + s) % pkgs.length];
}

function dateKey(now) { return (now || new Date()).toISOString().slice(0, 10); }

/** hostCard / sweepCards closures over the ctx's (injectable) hosting transport. */
function makeCardHelpers(ctx) {
  const hostImageBytes = ctx.hostImageBytes || require("./image-host").hostImageBytes;
  const deleteHosted = ctx.deleteHosted || require("./image-host").deleteHosted;
  const hostCard = async (buffer, keyHint) => (await hostImageBytes({ buffer: await toJpeg(buffer), contentType: "image/jpeg", keyHint })).url;
  const sweepCards = async (urls) => { for (const u of urls) { if (u) { try { await deleteHosted(u, ctx.imageOpts || {}); } catch (e) { /* best-effort */ } } } };
  return { hostCard, sweepCards };
}

/**
 * Build the TWO-candidate branded card (A = real photo, B = AI/decor scene) for one package and draft
 * a grounded, fact-checked caption. Shared by the daily calendar-card (approval) flow and the
 * twice-daily package-post (auto-publish) flow. Idempotent via `smid`. Returns a normalized result:
 *   { status: "skipped", skipped:[reason], sweepCards }              — dedup hit / hosting not configured
 *   { status: "held",    held:[{id?,reason}], sweepCards }           — render/host/generate/fact-check hold
 *   { status: "drafted", fresh, cardUrlA, cardUrlB, bStyle, options, rp, pkg, res, sweepCards }
 * The caller owns the tail (approval-notify vs auto-publish). `ctx.useQa` gates the QA safety-net.
 */
async function buildAndDraftCard(store, ctx, { pkg, smid, source }) {
  const now = ctx.now || new Date();
  const fs = ctx.fs || require("fs");
  const { hostCard, sweepCards } = makeCardHelpers(ctx);
  const slug = photoSlug(pkg.item + " " + (pkg.route || ""));

  // Cheap dedup first (idempotent re-run): one feature per smid.
  if (typeof store.findBySourceMessageId === "function") {
    const existing = await store.findBySourceMessageId(smid);
    if (existing) return { status: "skipped", skipped: [smid], sweepCards };
  }

  // PREFLIGHT: a card is only useful if we can HOST its image (Instagram publishes from a public
  // URL). Without BLOB_READ_WRITE_TOKEN, hostCard throws and the card would only ever be held with a
  // buried "card A render/host failed" — so detect the gap here (after the cheap dedup, before any row
  // is created or paid image work runs) and skip with one clear reason. Tests inject ctx.hostImageBytes.
  if (!ctx.hostImageBytes && !require("./image-host").isConfigured()) {
    return { status: "skipped", skipped: ["image hosting not configured — set BLOB_READ_WRITE_TOKEN on this Vercel project; no card built (would only be held)"], sweepCards };
  }

  // Skyline's OWN catalogue price (no markup). Create the ROW FIRST (with the dedup smid, no image
  // yet) so a re-trigger / cron retry finds it via findBySourceMessageId and skips — closing the
  // check-then-create window BEFORE the paid image generation runs.
  const rp = repricedLine([], pkg);
  const hint = `Write a SHORT, warm Skyline post inviting people to plan a CUSTOM ${pkg.item} trip with Skyline and message us on WhatsApp. You may name ONLY the destinations in this route: ${pkg.route}. Do NOT invent specific attractions, activities, sights, hotels, meals or day-by-day itinerary — none are provided, so they read as fabricated. Keep it about the FEELING/mood + the invitation to plan a custom trip. Do NOT state any price (it's already on the image) and do not name any other company.`;
  let row;
  try {
    row = await store.create({ status: "planned", source, sourceMessageId: smid, client: ctx.client || "skyline", subject: pkg.item, hint, language: "en", platforms: ["instagram", "facebook"] });
  } catch (e) { return { status: "held", held: [{ pkg: pkg.item, reason: "row create failed: " + String((e && e.message) || e) }], sweepCards }; }

  const baseCard = {
    logoPath: LOGO, headline: pkg.item, subtitle: pkg.route || "",
    price: rp.main, priceSuffix: rp.suffix, priceShort: rp.short,
    cta: "WhatsApp us to plan", handle: BUSINESS.instagram || "@skylinetravelplanner",
    tagline: BUSINESS.slogan || "Your Journey, Our Passion",
    phone: (BUSINESS.locations && BUSINESS.locations[0] && BUSINESS.locations[0].phone) || "",
  };
  let cardUrlA = "", cardUrlB = "", bStyle = "";
  try {
    cardUrlA = await hostCard(await makeCard({ ...baseCard, photoPath: pickPhoto(fs, PHOTOS, slug), credit: "Photo: Wikimedia CC" }), `card-a-${smid}`);
  } catch (e) { await store.update(row.id, { status: "held", lastError: "card A render/host failed: " + String((e && e.message) || e) }); return { status: "held", held: [{ id: row.id, reason: "card A render/host failed" }], sweepCards }; }
  try {
    const imageGen = ctx.imageGen || require("./image-gen").resolveImageGen();
    let bufB;
    if (imageGen) { const { promptForSlug } = require("./scene-prompts"); const gen = await imageGen(promptForSlug(slug), ctx.imageGenOpts || {}); bufB = await makeCard({ ...baseCard, photoBytes: gen.buffer, credit: "AI-generated scene · illustrative" }); bStyle = "AI scene"; }
    else { bufB = await makeCard({ ...baseCard, decor: true }); bStyle = "decorative"; }
    cardUrlB = await hostCard(bufB, `card-b-${smid}`);
  } catch (e) {
    try { cardUrlB = await hostCard(await makeCard({ ...baseCard, decor: true }), `card-b-${smid}`); bStyle = "decorative"; }
    catch (e2) { cardUrlB = ""; bStyle = ""; }
  }
  const options = { A: cardUrlA }; if (cardUrlB) options.B = cardUrlB;
  await store.update(row.id, { imageUrl: cardUrlA, imageSource: { kind: "url", url: cardUrlA, options } });

  let res;
  try { res = await generateOne(store, await store.get(row.id), { runner: source, facts: ctx.facts, profile: ctx.profile, clientName: ctx.clientName, useVision: false, useSmm: true, useQa: ctx.useQa === true }); }
  catch (e) { await sweepCards([cardUrlA, cardUrlB]); await store.update(row.id, { status: "held", imageUrl: "", lastError: "generate threw: " + String((e && e.message) || e) }); return { status: "held", held: [{ id: row.id, reason: "generate threw" }], sweepCards }; }
  const fresh = await store.get(row.id);
  if (fresh.imageUrl !== cardUrlA) { await store.update(fresh.id, { imageUrl: cardUrlA, imageSource: { kind: "url", url: cardUrlA, options } }); fresh.imageUrl = cardUrlA; }
  if (res.outcome !== "pending" && res.outcome !== "approved") { await sweepCards([cardUrlA, cardUrlB]); return { status: "held", held: [{ id: fresh.id, reason: res.reason || fresh.lastError || "" }], sweepCards }; }

  return { status: "drafted", fresh, cardUrlA, cardUrlB, bStyle, options, rp, pkg, res, sweepCards };
}

async function runCalendarCards(store, ctx = {}) {
  const now = ctx.now || new Date();
  const to = ctx.notifyTo || process.env.WHATSAPP_TO;
  const notify = ctx.notify !== false;

  const pkg = ctx.pkg || packageForDay(now);
  if (!pkg) return { considered: 0, notified: [], held: [], skipped: ["no packages in catalogue"] };
  const slug = photoSlug(pkg.item + " " + (pkg.route || ""));
  const smid = `calendar-${slug}-${dateKey(now)}`; // one feature per package per day (idempotent re-run)

  const built = await buildAndDraftCard(store, ctx, { pkg, smid, source: "calendar-card" });
  if (built.status === "skipped") return { considered: built.skipped[0] === smid ? 1 : 0, notified: [], held: [], skipped: built.skipped };
  if (built.status === "held") return { considered: 1, notified: [], held: built.held, skipped: [] };

  const { fresh, cardUrlA, cardUrlB, bStyle, rp, options } = built;
  const code = shortCode(fresh.id);
  const details = `📅 Skyline package feature (auto)\n   Package: ${pkg.item} — ${pkg.route}\n   Price on card: ${rp.line} (Skyline rate)`;
  const instr = cardUrlB
    ? `\n\nReply:\n🅰️ A ${code} → post the real-photo card\n🅱️ B ${code} → post the ${bStyle} card\n➕ both ${code} → post both\n❌ reject ${code}`
    : `\n\n✅ approve ${code} → posts to Instagram + Facebook   |   ❌ reject ${code}`;
  if (notify && to) {
    try {
      if (ctx.sendImage && cardUrlA) await ctx.sendImage(to, cardUrlA, (details + "\n\n🅰️ REAL PHOTO").slice(0, 1024));
      if (ctx.sendImage && cardUrlB) await ctx.sendImage(to, cardUrlB, `🅱️ ${bStyle.toUpperCase()} — ${pkg.item} ${pkg.route || ""}`.trim().slice(0, 1024));
      if (ctx.sendText) await ctx.sendText(to, (`Caption:\n${(fresh.caption || "").trim()}${instr}`).slice(0, 4000));
    } catch (e) { /* best-effort */ }
  }
  return { considered: 1, notified: [{ id: fresh.id, code, package: pkg.item, price: rp.line, options: Object.keys(options).join("/"), bStyle }], held: [], skipped: [] };
}

module.exports = { runCalendarCards, buildAndDraftCard, makeCardHelpers, packageForDay, packageForSlot, dateKey, featurablePackages };

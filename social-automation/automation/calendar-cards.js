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
const { allPackages, repricedLine, photoSlug, categoryForItem } = require("./packages");

const ASSETS = path.join(__dirname, "..", "assets");
const PHOTOS = path.join(ASSETS, "destinations");
const LOGO = path.join(ASSETS, "Skyline_Logo.jpg");

// The bStyle label for a FRESHLY-GENERATED AI scene (card B). One constant so the assignment here and
// the "post the fresh scene, not the repeating photo" check in package-posts.js can never drift apart
// (a silent rename would otherwise revert auto-posts to the repeated stock photo with no error).
const AI_SCENE_STYLE = "AI scene";

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

/** Owner-facing IST timestamp for provenance ("Prepared: …"). */
function istStamp(now) {
  const d = now instanceof Date ? now : (now ? new Date(now) : new Date());
  try { return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) + " IST"; }
  catch (e) { return d.toISOString(); }
}

/** One provenance block telling the owner WHERE this content came from — Skyline's OWN website
 *  catalogue, which category page it's on, and when it was prepared. (Email/WhatsApp intakes carry
 *  their own From/Received provenance; this is the "package from the website" equivalent.) */
function sourceLine(pkg, now) {
  const cat = categoryForItem(pkg.item);
  const site = String(BUSINESS.website || "skylinetravelplanner.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `Source: Skyline website catalogue${cat ? " · " + cat : ""} (${site})\n   Prepared: ${istStamp(now)}`;
}

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
    // Make the outage LOUD in the logs — a silent considered:0 pass looks identical to a healthy
    // dormant one, and that indistinguishability is exactly how content can stop for days unnoticed.
    try { console.warn(JSON.stringify({ evt: "host_unconfigured", source, msg: "BLOB_READ_WRITE_TOKEN not set — no card built; content is stopped until it is configured" })); } catch { /* ignore */ }
    return { status: "skipped", skipped: ["image hosting not configured — set BLOB_READ_WRITE_TOKEN on this Vercel project; no card built (would only be held)"], sweepCards };
  }

  // Skyline's OWN catalogue price (no markup). Create the ROW FIRST (with the dedup smid, no image
  // yet) so a re-trigger / cron retry finds it via findBySourceMessageId and skips — closing the
  // check-then-create window BEFORE the paid image generation runs.
  const rp = repricedLine([], pkg);
  // Skyline's OWN catalogue price + WhatsApp number are GROUNDED facts (facts.js), so — unlike a
  // vendor poster — the caption SHOULD state them. Burying them on the image alone made the SMM's
  // accessibility rule flag EVERY card "price/CTA missing" → held/rejected → nothing auto-posted
  // (B-PKGCARD). State the price ONCE as an indicative "from …/person" (passes the price-hedge guard)
  // and give exactly ONE WhatsApp CTA (both verified by validate-post).
  const phone = (BUSINESS.locations && BUSINESS.locations[0] && BUSINESS.locations[0].phone) || "";
  const hint = `Write a SHORT, warm Skyline post inviting people to plan a CUSTOM ${pkg.item} trip with Skyline. You may name ONLY the destinations in this route: ${pkg.route}. Do NOT invent specific attractions, activities, sights, hotels, meals or day-by-day itinerary — none are provided, so they read as fabricated. Keep it about the FEELING/mood + the invitation to plan a custom trip. State the price ONCE, as an INDICATIVE starting-from figure phrased exactly like "from ${pkg.price} per person" — it is a starting-from estimate that changes with season and availability, so NEVER call it fixed, final or locked. End with exactly ONE clear call to action: message us on WhatsApp at ${phone}. Do not name any other company.`;
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
  // TRAINING FEEDBACK: read this client's structured rejection history once — used to (a) steer the AI
  // scene AWAY from images the owner rejected as "not good", and (b) caution the owner on the next post
  // of a package that was rejected for price/source. Best-effort; never sinks a draft.
  const { rejectionFeedback, feedbackCautionFor } = require("./feedback");
  let feedback = { avoidScenes: [], priceFlags: {}, sourceFlags: {} };
  try { feedback = await rejectionFeedback(store, { client: ctx.client || "skyline" }); } catch (e) { /* best-effort */ }
  const caution = feedbackCautionFor(feedback, pkg.item);

  let cardUrlA = "", cardUrlB = "", bStyle = "", sceneMeta = null;
  try {
    cardUrlA = await hostCard(await makeCard({ ...baseCard, photoPath: pickPhoto(fs, PHOTOS, slug), credit: "Photo: Wikimedia CC" }), `card-a-${smid}`);
  } catch (e) { await store.update(row.id, { status: "held", lastError: "card A render/host failed: " + String((e && e.message) || e) }); return { status: "held", held: [{ id: row.id, reason: "card A render/host failed" }], sweepCards }; }
  let qaNote = ""; // surfaced to the owner when an AI scene was re-rolled or replaced by the QA gate
  try {
    const imageGen = ctx.imageGen || require("./image-gen").resolveImageGen();
    let bufB;
    if (imageGen) {
      // Card B image prompt — the shared resolver: a fresh, unique DYNAMIC scene (grounded to the
      // package + avoiding recent history) when the AI Scene Generator is on, else the static SCENES
      // pool. The concept metadata rides on the row (imageSource.sceneMeta) so the next run avoids it.
      const { resolveScenePrompt } = require("./scene-generator");
      // IMAGE-QUALITY QA GATE: gpt-image-1 routinely emits "weird" renders (warped/melted architecture,
      // extra fingers, garbled signage, impossible geometry). A vision QA reviewer scores each scene; a
      // failing scene is RE-ROLLED with a fresh concept (resolveScenePrompt varies every call), and if
      // every attempt still looks broken we post the code-drawn DECORATIVE card rather than a bad image.
      const assessImage = ctx.assessImage || require("../engine/generate").assessAiSceneQuality;
      const qaOn = ctx.imageQa !== false && process.env.SOCIAL_IMAGE_QA !== "off" &&
        !!(process.env.ANTHROPIC_API_KEY || ctx.qaClient || ctx.assessImage);
      const maxTries = Number.isFinite(ctx.imageQaMaxTries) ? Math.max(1, ctx.imageQaMaxTries) : 2;
      let acceptedBuf = null; // bytes of a scene that passed QA (or the sole render when QA is off)
      const rejected = [];    // per-attempt QA notes (for the owner digest + function logs)
      for (let attempt = 1; attempt <= maxTries; attempt++) {
        const r = await resolveScenePrompt({ pkg, slug, store, client: ctx.client || "skyline", sceneGenClient: ctx.sceneGenClient, model: ctx.sceneModel, recent: ctx.recentScenes, avoid: feedback.avoidScenes });
        const gen = await imageGen(r.prompt, ctx.imageGenOpts || {});
        if (!qaOn) { acceptedBuf = gen.buffer; sceneMeta = r.sceneMeta; break; }
        const qa = await assessImage({ buffer: gen.buffer, contentType: gen.contentType || "image/png" }, { client: ctx.qaClient, minScore: ctx.imageQaMinScore });
        if (qa.pass) { acceptedBuf = gen.buffer; sceneMeta = r.sceneMeta; break; }
        rejected.push(qa.note || `attempt ${attempt} failed QA`);
        try { console.warn(JSON.stringify({ evt: "image_qa_reject", attempt, score: qa.score, defects: qa.defects })); } catch { /* ignore */ }
      }
      if (acceptedBuf) {
        bufB = await makeCard({ ...baseCard, photoBytes: acceptedBuf, credit: "AI-generated scene · illustrative" });
        bStyle = AI_SCENE_STYLE;
        if (rejected.length) qaNote = `🖼️ AI-scene QA re-rolled ${rejected.length} weird render(s) before this one.`;
      } else {
        // Every AI attempt looked broken → post the SAFE decorative card, never a weird scene.
        bufB = await makeCard({ ...baseCard, decor: true }); bStyle = "decorative"; sceneMeta = null;
        qaNote = `🖼️ AI scene skipped — ${rejected.length} render(s) failed quality QA (${rejected.slice(-1)[0] || "weird/broken"}). Posting the clean decorative card instead.`;
        try { console.warn(JSON.stringify({ evt: "image_qa_fallback_decor", tries: maxTries, notes: rejected })); } catch { /* ignore */ }
      }
    } else {
      // No image generator resolved → card B is the code-drawn DECORATIVE gradient, NOT an AI scene.
      // This is silent-by-design (it's a valid fallback), but a MISSING/misnamed OPENAI_API_KEY looks
      // identical to "intentionally off" — which is exactly how a typo'd env var (OPEN_API_KEY) shipped
      // decorative B for days unnoticed. Log it so the fallback is visible in the function logs.
      try { console.warn(JSON.stringify({ evt: "image_gen_unconfigured", note: "OPENAI_API_KEY (or IMAGE_API_KEY) not set — card B is the decorative gradient, not an AI scene" })); } catch { /* ignore */ }
      bufB = await makeCard({ ...baseCard, decor: true }); bStyle = "decorative";
    }
    cardUrlB = await hostCard(bufB, `card-b-${smid}`);
  } catch (e) {
    try { cardUrlB = await hostCard(await makeCard({ ...baseCard, decor: true }), `card-b-${smid}`); bStyle = "decorative"; sceneMeta = null; }
    catch (e2) { cardUrlB = ""; bStyle = ""; sceneMeta = null; }
  }
  // Invariant: only keep sceneMeta if the AI scene was actually the card we built (a fallback to the
  // photo/decor means that concept was never rendered, so it must not enter the history as "seen").
  if (bStyle !== AI_SCENE_STYLE) sceneMeta = null;
  const options = { A: cardUrlA }; if (cardUrlB) options.B = cardUrlB;
  const imgSrc = () => { const s = { kind: "url", url: cardUrlA, options }; if (sceneMeta) s.sceneMeta = sceneMeta; return s; };
  await store.update(row.id, { imageUrl: cardUrlA, imageSource: imgSrc() });

  let res;
  try { res = await generateOne(store, await store.get(row.id), { runner: source, facts: ctx.facts, profile: ctx.profile, clientName: ctx.clientName, useVision: false, useSmm: true, useQa: ctx.useQa === true }); }
  catch (e) { await sweepCards([cardUrlA, cardUrlB]); await store.update(row.id, { status: "held", imageUrl: "", lastError: "generate threw: " + String((e && e.message) || e) }); return { status: "held", held: [{ id: row.id, reason: "generate threw" }], sweepCards }; }
  const fresh = await store.get(row.id);
  if (fresh.imageUrl !== cardUrlA) { await store.update(fresh.id, { imageUrl: cardUrlA, imageSource: imgSrc() }); fresh.imageUrl = cardUrlA; }
  if (res.outcome !== "pending" && res.outcome !== "approved") { await sweepCards([cardUrlA, cardUrlB]); return { status: "held", held: [{ id: fresh.id, reason: res.reason || fresh.lastError || "" }], sweepCards }; }

  return { status: "drafted", fresh, cardUrlA, cardUrlB, bStyle, options, rp, pkg, res, sweepCards, sceneMeta, caution, qaNote };
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

  const { fresh, cardUrlA, cardUrlB, bStyle, rp, options, caution, qaNote } = built;
  const code = shortCode(fresh.id);
  const details = `📅 Skyline package feature (auto)\n   Package: ${pkg.item} — ${pkg.route}\n   Price on card: ${rp.line} (Skyline rate)\n   ${sourceLine(pkg, now)}${caution ? "\n   " + caution : ""}${qaNote ? "\n   " + qaNote : ""}`;
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

module.exports = { runCalendarCards, buildAndDraftCard, makeCardHelpers, packageForDay, packageForSlot, dateKey, featurablePackages, sourceLine, istStamp, AI_SCENE_STYLE };

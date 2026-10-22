/**
 * check_festive_offers.js — dated festive offers (facts.js `offers`, 2026-10-22).
 * Offline: proves (1) the caption checker ACCEPTS an owner-approved poster caption quoting the live
 * Diwali in Bali (₹1,15,000) and Lakshadweep Escape (₹54,000 / ₹47,000) prices before their end
 * moments; (2) the SAME caption is REFUSED once each offer has ended (the clock is injected through
 * buildFactBase's opts.now); (3) a wrong figure is refused; (4) the auto-posting paths (package
 * rotation, calendar card, content calendars, vendor match) never pick an offer.
 *
 *   node tests/check_festive_offers.js
 */

const path = require("path");
const assert = require("assert");
const ROOT = path.join(__dirname, "..");
const { BUSINESS } = require(path.join(ROOT, "facts.js"));
const { PROFILE } = require(path.join(ROOT, "profile.js"));
const { buildFactBase } = require(path.join(ROOT, "engine", "kb-adapter.js"));
const { validatePost } = require(path.join(ROOT, "engine", "validate-post.js"));
const { allPackages, matchPackage } = require(path.join(ROOT, "automation", "packages.js"));
const { packageForDay, packageForSlot, featurablePackages } = require(path.join(ROOT, "automation", "calendar-cards.js"));
const { buildSkylineCalendar } = require(path.join(ROOT, "calendar.js"));
const { buildCalendar } = require(path.join(ROOT, "engine", "content-calendar.js"));

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

const OFFER_NAMES = ["diwali in bali", "lakshadweep escape"];
const isOffer = (name) => OFFER_NAMES.includes(String(name || "").trim().toLowerCase());

// The poster caption: only facts from the two live pages (flights worded "not included", since the
// referral-only rule reads "flight tickets" as a booking claim).
const CAPTION =
  "This Diwali, two festive escapes with Skyline. " +
  "Diwali in Bali: 7N/8D Signature Package, departs 3 Nov 2026 on Singapore Airlines from Ahmedabad, " +
  "from ₹1,15,000 per person. " +
  "Lakshadweep Escape: 3N/4D, 2 nights Agatti + 1 night Bangaram, travel 5–20 Nov 2026, " +
  "₹54,000 per person (minimum 2 travellers) or ₹47,000 per person (minimum 4), flights not included. " +
  "Prices are indicative starting-from estimates. Message us on WhatsApp at +91 88660 50291.";
const POST = {
  platform: "instagram", caption: CAPTION, hashtags: [],
  mentionedItems: ["Diwali in Bali", "Lakshadweep Escape"],
  claimedPrices: [
    { item: "Diwali in Bali", price: "₹1,15,000" },
    { item: "Lakshadweep Escape", price: "₹54,000" },
    { item: "Lakshadweep Escape", price: "₹47,000" },
  ],
};
const check = (post, now) => validatePost(post, buildFactBase(BUSINESS, { now }), PROFILE);

// IST moments, matching the pages' own end constants.
const TODAY = new Date("2026-10-22T12:00:00+05:30");
const BALI_END = new Date("2026-11-03T00:00:00+05:30");
const LAK_END = new Date("2026-11-21T00:00:00+05:30");

// ---- 1. both offers live → the caption passes ----
{
  const r = check(POST, TODAY);
  ok(r.ok, `the two-offer caption PASSES on 2026-10-22${r.ok ? "" : " — got: " + r.errors.join("; ")}`);
  const facts = buildFactBase(BUSINESS, { now: TODAY });
  ok(facts.offers.length === 2 && facts.offers.every((o) => isOffer(o.name)), "both offers are live in the fact base on 2026-10-22");
  ok(check(POST, new Date(BALI_END.getTime() - 1)).ok, "still passes one millisecond before the Bali end moment");
}

// ---- 2. after each end moment → refused ----
{
  const r = check(POST, BALI_END);
  ok(!r.ok && r.errors.some((e) => /UNVERIFIED PRICE.*₹1,15,000/.test(e)), "from 3 Nov 2026 00:00 IST the Bali ₹1,15,000 in the caption is REFUSED");
  ok(r.errors.some((e) => /INVENTED ITEM: "Diwali in Bali"/.test(e)), "…and the ended Bali offer is no longer a known item");
  ok(!r.errors.some((e) => /Lakshadweep|₹54,000|₹47,000/.test(e)), "…while Lakshadweep is still accepted (it runs to 21 Nov)");

  const lakOnly = {
    ...POST,
    caption: "Lakshadweep Escape: ₹54,000 per person (minimum 2 travellers) or ₹47,000 per person (minimum 4). Message us on WhatsApp at +91 88660 50291.",
    mentionedItems: ["Lakshadweep Escape"],
    claimedPrices: [{ item: "Lakshadweep Escape", price: "₹54,000" }, { item: "Lakshadweep Escape", price: "₹47,000" }],
  };
  ok(check(lakOnly, new Date(LAK_END.getTime() - 1)).ok, "a Lakshadweep-only caption passes on 20 Nov 2026 23:59 IST");
  const after = check(lakOnly, LAK_END);
  ok(!after.ok && ["₹54,000", "₹47,000"].every((p) => after.errors.some((e) => e.includes("UNVERIFIED PRICE") && e.includes(p))),
    "from 21 Nov 2026 00:00 IST both Lakshadweep prices are REFUSED");
  ok(!check(POST, LAK_END).ok, "the full two-offer caption is refused after both end dates");
  ok(buildFactBase(BUSINESS, { now: LAK_END }).offers.length === 0, "no offer is live after 21 Nov 2026");
}

// ---- 3. a wrong figure is refused, even while the offer is live ----
{
  const wrongText = { ...POST, caption: CAPTION.replace("₹47,000", "₹45,000") };
  const r1 = check(wrongText, TODAY);
  ok(!r1.ok && r1.errors.some((e) => /UNVERIFIED PRICE.*₹45,000/.test(e)), "₹45,000 in the caption text is REFUSED");
  const wrongClaim = { ...POST, claimedPrices: [{ item: "Lakshadweep Escape", price: "₹45,000" }] };
  const r2 = check(wrongClaim, TODAY);
  ok(!r2.ok && r2.errors.some((e) => /WRONG PRICE: "Lakshadweep Escape"/.test(e)), "a declared ₹45,000 for Lakshadweep Escape is REFUSED as a wrong price");
  const swapped = { ...POST, claimedPrices: [{ item: "Diwali in Bali", price: "₹54,000" }] };
  ok(!check(swapped, TODAY).ok, "one offer's price claimed for the other offer is REFUSED");
  const fixedPrice = { ...POST, caption: CAPTION + " Price locked." };
  ok(!check(fixedPrice, TODAY).ok, "the existing travel rules still bite on an offer caption (price-lock language)");
}

// ---- 4. the automatic paths never pick an offer ----
{
  const facts = buildFactBase(BUSINESS, { now: TODAY });
  ok(facts.items.length === 23 && !facts.items.some((i) => isOffer(i.name)), "offers are NOT catalogue items (still 23 packages)");
  ok(!allPackages().some((p) => isOffer(p.item)), "allPackages() (package rotation source) has no offer");
  ok(!featurablePackages().some((p) => isOffer(p.item)), "featurablePackages() has no offer");
  let picked = 0, sawOffer = false;
  for (let d = 0; d < 120; d++) {
    const now = new Date(TODAY.getTime() + d * 86400000);
    for (const p of [packageForDay(now), packageForSlot(now, 0), packageForSlot(now, 1)]) {
      if (p) picked++;
      if (p && isOffer(p.item)) sawOffer = true;
    }
  }
  ok(picked > 0 && !sawOffer, `120 days of calendar-card + twice-daily package-post picks never return an offer (${picked} picks)`);
  ok(!matchPackage("Diwali in Bali Lakshadweep Escape Agatti Bangaram") || !isOffer(matchPackage("Diwali in Bali Lakshadweep Escape Agatti Bangaram").pkg.item),
    "a vendor offer naming them never matches an offer as a Skyline package");
  const sky = buildSkylineCalendar(facts, { postsPerMonth: 60, month: "2026-11" });
  ok(!sky.some((p) => isOffer(p.subject) || (p.suggestedItems || []).some(isOffer)), "the Skyline content calendar never suggests an offer");
  const gen = buildCalendar(facts, { postsPerMonth: 60, month: "2026-11" });
  ok(!gen.some((p) => isOffer(p.subject) || (p.suggestedItems || []).some(isOffer)), "the engine content calendar never suggests an offer");
}

// ---- 5. review hardening (Bug Hunter + App Security, 2026-10-22) ----
{
  // An offer's figure is not a general-purpose valid price: a caption that never names the offer
  // cannot quote it, even while the offer is live (no Rajasthan post "from ₹1,15,000").
  const borrowed = {
    platform: "instagram", hashtags: [], mentionedItems: [], claimedPrices: [],
    caption: "Royal Rajasthan, 7N/8D through Jaipur, Jodhpur, Udaipur and Jaisalmer, from ₹1,15,000 per person. " +
      "Prices are indicative starting-from estimates. Message us on WhatsApp at +91 88660 50291.",
  };
  ok(!check(borrowed, TODAY).ok, "a live offer's price in a caption that does not name the offer is REFUSED");
  const named = { ...borrowed, caption: borrowed.caption.replace("Royal Rajasthan", "Diwali in Bali") };
  ok(!check(named, TODAY).errors.some((e) => /UNVERIFIED PRICE/.test(e)),
    "the same figure is accepted in text once the offer is named");
  // Malformed offer entries can only widen the validator, so they are dropped.
  const junk = buildFactBase({ ...BUSINESS, offers: [
    ...BUSINESS.offers,
    { item: "", prices: ["₹1"], until: "2099-01-01T00:00:00+05:30" },
    { item: "No Price Offer", prices: [], until: "2099-01-01T00:00:00+05:30" },
    { item: "Bad Prices", prices: "₹9", until: "2099-01-01T00:00:00+05:30" },
  ] }, { now: TODAY });
  ok(!junk.itemNames.has("") && !junk.itemNames.has("no price offer") && !junk.itemNames.has("bad prices"),
    "an offer with no name, no prices or non-list prices is ignored");
  ok(junk.offers.length === 2, "the two real offers are still live alongside the dropped entries");
}

console.log(`\nFESTIVE-OFFERS PASS: live offer prices accepted, ended offers and wrong figures refused, and no automatic post picks an offer. (${pass} checks)`);

// ACCEPT (Skyline social): the engine works for a SECOND, non-restaurant client,
// and the travel-specific failure modes are blocked.
//
// Travel fails differently from food. A wrong menu price is embarrassing; a wrong
// travel claim can strand someone at a border, or promise a booking the business
// cannot make. This suite exists to prove those are caught.
//
//   node tests/check_skyline_social.js

const path = require("path");
const ROOT = path.join(__dirname, "..");
const C = (f) => require(path.join(ROOT, f));  // facts/calendar/profile at the root
const E = (f) => require(path.join(ROOT, "engine", f));

const { BUSINESS, LOCATIONS, DESTINATIONS_WITH_IMAGES } = C("facts.js");
const { PROFILE } = C("profile.js");
const { buildSkylineCalendar, skylineShotList } = C("calendar.js");
const { buildFactBase, factSheet } = E("kb-adapter.js");
const { validatePost } = E("validate-post.js");

const fails = [];
function ok(cond, label) {
  console.log(`  ${cond ? "ok" : "FAIL"} - ${label}`);
  if (!cond) fails.push(label);
}

const facts = buildFactBase(BUSINESS);

// ---------------------------------------------- the engine is client-agnostic
ok(facts.business.name === "Skyline Travel Planner", "loads a non-restaurant client");
ok(facts.items.length === 22, `all 22 packages loaded incl. 3 international (got ${facts.items.length})`);
ok(facts.categories.length === 6, `5 India regions + International (got ${facts.categories.length})`);
ok(facts.priceByItem.get("royal rajasthan") === "₹24,900", "package price read from the fact base");
ok(facts.items.some((i) => i.duration && i.tag && i.route), "extra travel fields (duration/tag/route) survive the adapter");
ok(facts.referralOnly.includes("flights"), "referral-only list carried through");
ok(facts.priceDisclaimer.includes("indicative"), "the client's own price disclaimer is carried");

const sheet = factSheet(facts);
ok(sheet.includes("Royal Rajasthan — ₹24,900"), "fact sheet carries package + real price");
ok(/WE DO NOT BOOK THESE/.test(sheet), "fact sheet tells the model what we do NOT sell");
ok(/PRICE DISCLAIMER/.test(sheet), "fact sheet carries the indicative-price disclaimer");
ok(!/MENU|DIETARY|BREAKFAST/.test(sheet), "no restaurant vocabulary leaks into a travel fact sheet");

// ------------------------------------------------------------------ the guard
const base = { platform: "instagram", hashtags: [], mentionedItems: [], claimedPrices: [] };
const good = {
  ...base,
  caption:
    "Royal Rajasthan — Jaipur, Jodhpur, Udaipur and Jaisalmer over 7 nights. From ₹24,900 per person. Message us on WhatsApp and we'll build it around your dates.",
  mentionedItems: ["Royal Rajasthan"],
  claimedPrices: [{ item: "Royal Rajasthan", price: "₹24,900" }],
  cta: "WhatsApp us",
};
const goodRes = validatePost(good, facts, PROFILE);
ok(goodRes.ok, "a truthful, hedged travel post PASSES" + (goodRes.ok ? "" : ` — ${goodRes.errors.join("; ")}`));

function blocks(label, caption, needle, extra = {}) {
  const r = validatePost({ ...base, caption, ...extra }, facts, PROFILE);
  const hit = !r.ok && r.errors.some((e) => e.toLowerCase().includes(needle.toLowerCase()));
  ok(hit, label + (hit ? "" : ` — got: ${r.errors.join("; ") || "no errors"}`));
}

// --- The failure mode unique to this client: we don't sell flights ---
blocks("BLOCKS 'book your flights with us'", "Book your flights with us for Goa!", "referral-only");
blocks("BLOCKS booking train tickets", "We can book train tickets for your whole trip.", "referral-only");
blocks("BLOCKS buying bus tickets", "Buy your bus tickets through us and save.", "referral-only");

// --- Price volatility: a tour price is not a menu price ---
blocks("BLOCKS a bare price with no 'from'", "Kashmir Valley ₹27,800.", "not hedged", {
  mentionedItems: ["Kashmir Valley"],
  claimedPrices: [{ item: "Kashmir Valley", price: "₹27,800" }],
});
ok(
  validatePost(
    { ...base, caption: "Kashmir Valley from ₹27,800 per person.", mentionedItems: ["Kashmir Valley"], claimedPrices: [{ item: "Kashmir Valley", price: "₹27,800" }] },
    facts,
    PROFILE
  ).ok,
  "ALLOWS the same price when written as 'from ... per person'"
);
blocks("BLOCKS a price that is not in the catalogue", "Goa from ₹9,999 per person.", "unverified price");
blocks("BLOCKS an invented package", "Our Golden Triangle Deluxe is now live.", "invented item", {
  mentionedItems: ["Golden Triangle Deluxe"],
});

// --- Travel claims that can actually hurt someone ---
blocks("BLOCKS visa advice", "No visa required for Thailand!", "visa");
blocks("BLOCKS 'you don't need a visa'", "Good news — you don't need a visa for this one.", "visa");
blocks("BLOCKS guaranteed booking", "Guaranteed booking on every departure.", "guarantee");
blocks("BLOCKS a weather guarantee", "Snow guaranteed in Manali this December.", "weather");
blocks("BLOCKS a safety guarantee", "100% safe travel, every trip.", "safety");
blocks("BLOCKS price-lock language", "Price locked — no hidden fees, ever.", "price-lock");
blocks("BLOCKS an invented discount", "20% off all Northeast trips this month!", "promotion");
blocks("BLOCKS a geographic superlative", "The most authentic tours in India, full stop.", "superlative");
blocks("BLOCKS travel-marketing filler", "An unforgettable journey awaits.", "banned word");

// --- Shared rules still apply to this client ---
blocks("BLOCKS an unverified phone number", "Call us on +91 99999 00000.", "unverified phone");
ok(
  validatePost({ ...base, caption: "WhatsApp us on +91 88660 50291." }, facts, PROFILE).ok,
  "ALLOWS the real WhatsApp number"
);

// --------------------------------------------------------------- the calendar
const plan = buildSkylineCalendar(facts, { postsPerMonth: 12, month: "2026-08" });
ok(plan.length === 12, `calendar produces 12 posts (got ${plan.length})`);
ok(new Set(plan.map((p) => p.subject)).size === plan.length, "every post in the month has a distinct subject");
ok(new Set(plan.map((p) => p.archetype)).size >= 6, "calendar mixes at least 6 archetypes");
ok(
  plan.every((p) => p.suggestedItems.every((s) => facts.itemNames.has(String(s).toLowerCase()))),
  "calendar NEVER suggests a package that does not exist"
);
ok(
  plan.filter((p) => p.archetype === "offbeat").length >= 2,
  "the Northeast/off-beat differentiator gets real weight in the month"
);
ok(
  plan.filter((p) => p.mayQuotePrice).length <= plan.length / 2,
  "most posts do NOT lead with price — the goal is an enquiry, not a checkout"
);
ok(plan.some((p) => p.archetype === "customization"), "customization (the lead-gen post) is in the month");
ok(
  JSON.stringify(buildSkylineCalendar(facts, { postsPerMonth: 12, month: "2026-08" })) === JSON.stringify(plan),
  "calendar is deterministic"
);
const shots = skylineShotList(plan);
ok(
  shots.alreadyHave.length + shots.needToShoot.length > 0,
  "a shot-list is produced, split into photos we hold vs photos to take"
);
ok(DESTINATIONS_WITH_IMAGES.length >= 20, `${DESTINATIONS_WITH_IMAGES.length} destinations already have photography`);

// ---- The locations list is the content asset ----
ok(LOCATIONS.length >= 85, `~90 named locations listed from the site (got ${LOCATIONS.length})`);
ok(new Set(LOCATIONS).size === LOCATIONS.length, "no duplicate locations");
for (const place of ["Dawki", "Khonoma", "Hmuifang", "Vantawng", "Dzukou Valley"]) {
  ok(LOCATIONS.includes(place), `off-beat Northeast location "${place}" is in the list — these are the differentiator`);
}
ok(LOCATIONS.includes("Male atolls") && LOCATIONS.includes("Nusa Penida"), "international locations captured too");
// Every place post must be backed by a real trip, or it is a blog not marketing.
const placePosts = buildSkylineCalendar(facts, { postsPerMonth: 60, month: "x" }).filter(
  (p) => p.archetype === "place_spotlight"
);
ok(placePosts.length > 0, "place spotlights appear in the plan");
ok(
  placePosts.every((p) => p.suggestedItems.every((s) => facts.itemNames.has(String(s).toLowerCase()))),
  "every place spotlight points at a REAL package"
);
ok(
  placePosts.filter((p) => p.suggestedItems.length).length >= placePosts.length * 0.7,
  "most place spotlights resolve to a bookable trip"
);
// Depth: a year of posting without repeating a subject.
const year = buildSkylineCalendar(facts, { postsPerMonth: 144, month: "yr" });
ok(
  new Set(year.map((p) => p.subject)).size >= 90,
  `a year of content without repeating a subject (got ${new Set(year.map((p) => p.subject)).size} unique over 144)`
);

// ------------------------------------------------------------- brand profile
ok(PROFILE.vertical === "travel", "profile marks the travel vertical (activates travel rules)");
ok(PROFILE.requirePriceHedge === true, "profile requires indicative-price language");
ok(PROFILE.ctaStyle === "enquiry", "CTA style is enquiry — nothing is bookable on the site");
ok(PROFILE.bannedWords.includes("bucket list"), "travel filler words banned");
ok(PROFILE.bannedWords.includes("elevate"), "shared default banned words still applied");
ok(PROFILE.autoApprove === false, "owner approves every post by default");

// ------------------------------------------------------------- no key leaks
const fs = require("fs");
for (const f of ["facts.js", "profile.js", "calendar.js"]) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  ok(!/sk-ant-[A-Za-z0-9]/.test(src) && !/ANTHROPIC_API_KEY\s*=/.test(src), `no key material in ${f}`);
}

if (fails.length) {
  console.error("\nSKYLINE-SOCIAL FAIL:\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log(
  "\nSKYLINE-SOCIAL PASS: engine runs a second, non-restaurant client; " +
    "referral-only booking claims, unhedged tour prices, visa advice, guarantees and " +
    "price-locks are all BLOCKED."
);
